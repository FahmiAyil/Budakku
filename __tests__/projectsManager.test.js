jest.mock('child_process', () => ({
  spawnSync: jest.fn(),
  spawn: jest.fn(),
}));

function loadFresh() {
  jest.resetModules();
  jest.mock('child_process', () => ({ spawnSync: jest.fn(), spawn: jest.fn() }));
  return require('../src/main/projectsManager');
}

const GOOD_OUTPUT = JSON.stringify({
  projects: [
    { name: 'BO Frontend', path: '/home/fahmi/Shark/BOFRAME/BO', command: 'yarn localdev' },
    { name: 'Admin', path: '/home/fahmi/Shark/ADMINVITE', command: 'yarn localdev' },
  ]
});

describe('projectsManager', () => {
  let pm;

  beforeEach(() => {
    jest.clearAllMocks();
    pm = loadFresh();
  });

  describe('listProjects', () => {
    test('parses yaml output and returns project array', () => {
      const { spawnSync } = require('child_process');
      spawnSync.mockReturnValue({ status: 0, stdout: GOOD_OUTPUT, stderr: '', error: null });
      const projects = pm.listProjects();
      expect(projects).toHaveLength(2);
      expect(projects[0]).toEqual({ name: 'BO Frontend', path: '/home/fahmi/Shark/BOFRAME/BO', command: 'yarn localdev', status: 'stopped' });
      expect(projects[1]).toEqual({ name: 'Admin', path: '/home/fahmi/Shark/ADMINVITE', command: 'yarn localdev', status: 'stopped' });
    });

    test('returns error when yaml file not found', () => {
      const { spawnSync } = require('child_process');
      spawnSync.mockReturnValue({ status: 0, stdout: JSON.stringify({ error: 'webrunner.yaml not found at expected path.' }), stderr: '', error: null });
      expect(pm.listProjects()).toEqual({ error: 'webrunner.yaml not found at expected path.' });
    });

    test('returns error when WSL unavailable', () => {
      const { spawnSync } = require('child_process');
      spawnSync.mockReturnValue({ status: null, stdout: '', stderr: '', error: new Error('ENOENT') });
      expect(pm.listProjects()).toEqual({ error: 'WSL is not available.' });
    });

    test('reflects running status for active processes', () => {
      const { spawnSync } = require('child_process');
      spawnSync.mockReturnValue({ status: 0, stdout: GOOD_OUTPUT, stderr: '', error: null });
      pm._processes.set('BO Frontend', { killed: false });
      const projects = pm.listProjects();
      expect(projects[0].status).toBe('running');
      expect(projects[1].status).toBe('stopped');
    });
  });

  describe('startProject', () => {
    test('spawns process and adds to map', () => {
      const { spawn } = require('child_process');
      const mockChild = { stdout: { on: jest.fn() }, stderr: { on: jest.fn() }, on: jest.fn() };
      spawn.mockReturnValue(mockChild);

      const wc = { isDestroyed: () => false, send: jest.fn() };
      const result = pm.startProject({ name: 'BO Frontend', path: '/path', command: 'yarn dev', webContents: wc });

      expect(result).toEqual({ ok: true });
      expect(pm._processes.has('BO Frontend')).toBe(true);
    });

    test('returns error if already running', () => {
      pm._processes.set('BO Frontend', {});
      const result = pm.startProject({ name: 'BO Frontend', path: '/p', command: 'yarn dev', webContents: {} });
      expect(result.ok).toBe(false);
    });
  });

  describe('stopProject', () => {
    test('kills process and removes from map', () => {
      const mockKill = jest.fn();
      pm._processes.set('BO Frontend', { kill: mockKill });
      const result = pm.stopProject({ name: 'BO Frontend' });
      expect(mockKill).toHaveBeenCalled();
      expect(pm._processes.has('BO Frontend')).toBe(false);
      expect(result).toEqual({ ok: true });
    });

    test('returns ok when project not running', () => {
      expect(pm.stopProject({ name: 'NonExistent' })).toEqual({ ok: true });
    });
  });

  describe('getBuffer', () => {
    test('returns empty array for unknown project', () => {
      expect(pm.getBuffer('Unknown')).toEqual([]);
    });
  });
});
