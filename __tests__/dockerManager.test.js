const path = require('path');

jest.mock('child_process', () => ({
  spawnSync: jest.fn(),
  spawn: jest.fn(),
}));

jest.mock('electron', () => ({
  app: { getPath: jest.fn(() => '/tmp/test-userData') },
  safeStorage: {
    isEncryptionAvailable: jest.fn(() => true),
    encryptString: jest.fn((s) => Buffer.from('enc:' + s)),
    decryptString: jest.fn((b) => b.toString().replace('enc:', '')),
  },
}), { virtual: true });

jest.mock('fs', () => ({
  existsSync: jest.fn(),
  readFileSync: jest.fn(),
  writeFileSync: jest.fn(),
  mkdirSync: jest.fn(),
}));

const { spawnSync } = require('child_process');
const fs = require('fs');

let dockerManager;
function loadFresh() {
  jest.resetModules();
  // re-apply mocks after resetModules
  jest.mock('child_process', () => ({ spawnSync: jest.fn(), spawn: jest.fn() }));
  jest.mock('electron', () => ({
    app: { getPath: jest.fn(() => '/tmp/test-userData') },
    safeStorage: {
      isEncryptionAvailable: jest.fn(() => true),
      encryptString: jest.fn((s) => Buffer.from('enc:' + s)),
      decryptString: jest.fn((b) => b.toString().replace('enc:', '')),
    },
  }), { virtual: true });
  jest.mock('fs', () => ({
    existsSync: jest.fn(),
    readFileSync: jest.fn(),
    writeFileSync: jest.fn(),
    mkdirSync: jest.fn(),
  }));
  dockerManager = require('../src/main/dockerManager');
  return dockerManager;
}

describe('dockerManager', () => {
  beforeEach(() => { jest.clearAllMocks(); loadFresh(); });

  describe('getConfig', () => {
    test('returns defaults when config file does not exist', () => {
      const fs = require('fs');
      fs.existsSync.mockReturnValue(false);
      const cfg = dockerManager.getConfig();
      expect(cfg.distro).toBe('');
      expect(cfg.passwordSet).toBe(false);
    });

    test('returns passwordSet true when passwordEnc is present', () => {
      const fs = require('fs');
      fs.existsSync.mockReturnValue(true);
      fs.readFileSync.mockReturnValue(JSON.stringify({ distro: 'Ubuntu', passwordEnc: '6162' }));
      const cfg = dockerManager.getConfig();
      expect(cfg.distro).toBe('Ubuntu');
      expect(cfg.passwordSet).toBe(true);
    });
  });

  describe('saveConfig', () => {
    test('encrypts password and writes JSON', () => {
      const fs = require('fs');
      fs.existsSync.mockReturnValue(true);
      dockerManager.saveConfig({ distro: 'Ubuntu', password: 'secret' });
      expect(fs.writeFileSync).toHaveBeenCalled();
      const written = JSON.parse(fs.writeFileSync.mock.calls[0][1]);
      expect(written.distro).toBe('Ubuntu');
      expect(written.passwordEnc).toBeTruthy();
    });
  });

  describe('listDistros', () => {
    test('returns array of distro names from wsl --list --quiet', () => {
      const { spawnSync } = require('child_process');
      spawnSync.mockReturnValue({ status: 0, stdout: 'Ubuntu\r\nDebian\r\n', stderr: '', error: null });
      const distros = dockerManager.listDistros();
      expect(distros).toEqual(['Ubuntu', 'Debian']);
    });

    test('returns empty array on wsl error', () => {
      const { spawnSync } = require('child_process');
      spawnSync.mockReturnValue({ status: 1, stdout: '', stderr: 'error', error: new Error('not found') });
      const distros = dockerManager.listDistros();
      expect(distros).toEqual([]);
    });
  });

  describe('getServiceStatus', () => {
    test('returns running:true when docker service is active', () => {
      const { spawnSync } = require('child_process');
      spawnSync.mockReturnValue({ status: 0, stdout: 'active\n', stderr: '', error: null });
      // inject a distro via saveConfig first (mock fs)
      const fs = require('fs');
      fs.existsSync.mockReturnValue(true);
      fs.readFileSync.mockReturnValue(JSON.stringify({ distro: 'Ubuntu', passwordEnc: '' }));
      const result = dockerManager.getServiceStatus();
      expect(result.running).toBe(true);
    });

    test('returns running:false when docker is inactive', () => {
      const { spawnSync } = require('child_process');
      spawnSync.mockReturnValue({ status: 1, stdout: 'inactive\n', stderr: '', error: null });
      const fs = require('fs');
      fs.existsSync.mockReturnValue(true);
      fs.readFileSync.mockReturnValue(JSON.stringify({ distro: 'Ubuntu', passwordEnc: '' }));
      const result = dockerManager.getServiceStatus();
      expect(result.running).toBe(false);
    });
  });

  describe('listContainers', () => {
    test('parses docker ps -a output into Container array', () => {
      const { spawnSync } = require('child_process');
      const psOutput = 'abc123\tweb-app\tnginx:latest\tUp 2 hours\n' +
                       'def456\tpostgres\tpostgres:16\tExited (0)\n';
      spawnSync.mockReturnValue({ status: 0, stdout: psOutput, stderr: '', error: null });
      const fs = require('fs');
      fs.existsSync.mockReturnValue(true);
      fs.readFileSync.mockReturnValue(JSON.stringify({ distro: 'Ubuntu', passwordEnc: '' }));
      const containers = dockerManager.listContainers();
      expect(containers).toHaveLength(2);
      expect(containers[0]).toEqual({ id: 'abc123', name: 'web-app', image: 'nginx:latest', status: 'running' });
      expect(containers[1]).toEqual({ id: 'def456', name: 'postgres', image: 'postgres:16', status: 'stopped' });
    });

    test('returns empty array when docker ps fails', () => {
      const { spawnSync } = require('child_process');
      spawnSync.mockReturnValue({ status: 1, stdout: '', stderr: 'Cannot connect', error: null });
      const fs = require('fs');
      fs.existsSync.mockReturnValue(true);
      fs.readFileSync.mockReturnValue(JSON.stringify({ distro: 'Ubuntu', passwordEnc: '' }));
      const containers = dockerManager.listContainers();
      expect(containers).toEqual([]);
    });
  });

  describe('containerAction', () => {
    test('rejects invalid container id', () => {
      const fs = require('fs');
      fs.existsSync.mockReturnValue(true);
      fs.readFileSync.mockReturnValue(JSON.stringify({ distro: 'Ubuntu', passwordEnc: '' }));
      const result = dockerManager.containerAction({ id: '$(rm -rf ~)', action: 'stop' });
      expect(result.ok).toBe(false);
      expect(result.error).toMatch(/invalid container id/i);
    });

    test('rejects invalid action', () => {
      const { spawnSync } = require('child_process');
      const fs = require('fs');
      fs.existsSync.mockReturnValue(true);
      fs.readFileSync.mockReturnValue(JSON.stringify({ distro: 'Ubuntu', passwordEnc: '' }));
      const result = dockerManager.containerAction({ id: 'abc123def456', action: 'delete' });
      expect(result.ok).toBe(false);
      expect(result.error).toMatch(/invalid action/i);
    });

    test('calls docker stop for valid container', () => {
      const { spawnSync } = require('child_process');
      spawnSync.mockReturnValue({ status: 0, stdout: 'abc123def456\n', stderr: '', error: null });
      const fs = require('fs');
      fs.existsSync.mockReturnValue(true);
      fs.readFileSync.mockReturnValue(JSON.stringify({ distro: 'Ubuntu', passwordEnc: '' }));
      const result = dockerManager.containerAction({ id: 'abc123def456', action: 'stop' });
      expect(result.ok).toBe(true);
    });
  });
});
