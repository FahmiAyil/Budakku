const { spawnSync, spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const { app, safeStorage } = require('electron');

const CONFIG_FILE = () => path.join(app.getPath('userData'), 'docker-config.json');

// Active log streaming processes: Map<containerId, ChildProcess>
const logProcesses = new Map();

function isValidContainerId(id) {
  return typeof id === 'string' && /^[a-f0-9]{12,64}$/.test(id);
}

function readConfigFile() {
  const file = CONFIG_FILE();
  if (!fs.existsSync(file)) return {};
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return {}; }
}

function writeConfigFile(data) {
  const file = CONFIG_FILE();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf8');
}

function encryptPassword(password) {
  if (!password) return '';
  if (safeStorage.isEncryptionAvailable()) {
    return safeStorage.encryptString(password).toString('hex');
  }
  console.warn('[dockerManager] safeStorage unavailable — storing password as plaintext');
  return Buffer.from(password).toString('hex');
}

function decryptPassword(hex) {
  if (!hex) return '';
  const buf = Buffer.from(hex, 'hex');
  if (safeStorage.isEncryptionAvailable()) {
    try { return safeStorage.decryptString(buf); } catch { return ''; }
  }
  return buf.toString('utf8');
}

function getConfig() {
  const raw = readConfigFile();
  return {
    distro: raw.distro || '',
    passwordSet: Boolean(raw.passwordEnc),
  };
}

function saveConfig({ distro, password }) {
  const raw = readConfigFile();
  raw.distro = distro || raw.distro || '';
  if (password !== undefined && password !== null) {
    raw.passwordEnc = encryptPassword(password);
  }
  writeConfigFile(raw);
  return { ok: true };
}

function getDecryptedPassword() {
  const raw = readConfigFile();
  return decryptPassword(raw.passwordEnc || '');
}

function getDistro() {
  return readConfigFile().distro || '';
}

function wsl(distro, command, opts = {}) {
  const args = distro
    ? ['-d', distro, '-e', 'bash', '-c', command]
    : ['-e', 'bash', '-c', command];
  return spawnSync('wsl', args, { encoding: 'utf8', timeout: 15000, ...opts });
}

function listDistros() {
  const r = spawnSync('wsl', ['--list', '--quiet'], { encoding: 'utf16le', timeout: 8000 });
  if (r.error || r.status !== 0) return [];
  return r.stdout
    .split(/\r?\n/)
    .map(s => s.replace(/\0/g, '').trim())
    .filter(Boolean);
}

function getServiceStatus() {
  const distro = getDistro();
  const r = wsl(distro, 'service docker status 2>/dev/null');
  if (r.error) return { running: false };
  const running = !r.error && r.status === 0;
  return { running };
}

function serviceStart() {
  const distro = getDistro();
  const password = getDecryptedPassword();
  if (!password) return { ok: false, error: 'No sudo password configured. Go to Settings.' };
  const r = wsl(distro, `printf '%s\\n' '${password.replace(/'/g, "'\\''")}' | sudo -S service docker start 2>&1`);
  if (r.error) return { ok: false, error: 'WSL not available.' };
  if (r.status !== 0 && /incorrect password|authentication failure/i.test(r.stdout + r.stderr)) {
    return { ok: false, error: 'Incorrect password. Update it in Settings.' };
  }
  if (r.status !== 0) return { ok: false, error: r.stderr || r.stdout || 'Failed to start Docker.' };
  return { ok: true };
}

function serviceStop() {
  const distro = getDistro();
  const password = getDecryptedPassword();
  if (!password) return { ok: false, error: 'No sudo password configured. Go to Settings.' };
  const r = wsl(distro, `printf '%s\\n' '${password.replace(/'/g, "'\\''")}' | sudo -S service docker stop 2>&1`);
  if (r.error) return { ok: false, error: 'WSL not available.' };
  if (r.status !== 0) return { ok: false, error: r.stderr || r.stdout || 'Failed to stop Docker.' };
  return { ok: true };
}

function parseStatus(statusStr) {
  if (!statusStr) return 'other';
  const s = statusStr.toLowerCase();
  if (s.startsWith('up')) return 'running';
  if (s.startsWith('exited') || s.startsWith('stopped')) return 'stopped';
  if (s.includes('paused')) return 'paused';
  return 'other';
}

function listContainers() {
  const distro = getDistro();
  // format: ID\tName\tImage\tStatus  (no header)
  const r = wsl(distro, "docker ps -a --format '{{.ID}}\\t{{.Names}}\\t{{.Image}}\\t{{.Status}}' 2>&1");
  if (r.error || r.status !== 0) return [];
  return r.stdout
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean)
    .map(line => {
      const [id, name, image, ...statusParts] = line.split('\t');
      return { id, name, image, status: parseStatus(statusParts.join(' ')) };
    });
}

function containerAction({ id, action }) {
  if (!isValidContainerId(id)) return { ok: false, error: 'Invalid container ID.' };
  const distro = getDistro();
  const allowed = ['start', 'stop', 'restart'];
  if (!allowed.includes(action)) return { ok: false, error: 'Invalid action.' };
  const r = wsl(distro, `docker ${action} ${id} 2>&1`);
  if (r.error) return { ok: false, error: 'WSL not available.' };
  if (r.status !== 0) return { ok: false, error: r.stderr || r.stdout || `Failed to ${action} container.` };
  return { ok: true };
}

function testConnection({ distro, password } = {}) {
  const d = distro || getDistro();
  const p = password || getDecryptedPassword();
  // Try docker version without sudo first (works if docker group is set up)
  let r = wsl(d, 'docker version --format "{{.Server.Version}}" 2>&1');
  if (r.status === 0 && r.stdout.trim()) {
    return { ok: true, version: r.stdout.trim() };
  }
  // Fall back: start service with sudo then try again
  if (p) {
    wsl(d, `printf '%s\\n' '${p.replace(/'/g, "'\\''")}' | sudo -S service docker start 2>&1`);
    r = wsl(d, 'docker version --format "{{.Server.Version}}" 2>&1');
    if (r.status === 0 && r.stdout.trim()) return { ok: true, version: r.stdout.trim() };
  }
  if (r.error) return { ok: false, error: 'WSL is not available. Make sure WSL2 is installed and running.' };
  if (/not found|no such file/i.test(r.stdout + r.stderr)) {
    return { ok: false, error: 'Docker not found in WSL. Install Docker inside your WSL distro first.' };
  }
  return { ok: false, error: r.stderr || r.stdout || 'Could not connect to Docker.' };
}

function logsStart({ id, webContents }) {
  if (!isValidContainerId(id)) return { ok: false, error: 'Invalid container ID.' };
  if (logProcesses.has(id)) logsStop({ id });
  const distro = getDistro();
  const args = distro
    ? ['-d', distro, '-e', 'bash', '-c', `docker logs -f --tail 100 ${id} 2>&1`]
    : ['-e', 'bash', '-c', `docker logs -f --tail 100 ${id} 2>&1`];
  const child = spawn('wsl', args);
  logProcesses.set(id, child);
  child.stdout.on('data', (chunk) => {
    if (webContents.isDestroyed()) return;
    chunk.toString().split('\n').forEach(line => {
      if (line.trim()) webContents.send('docker-log-line', { containerId: id, line });
    });
  });
  child.stderr.on('data', (chunk) => {
    if (webContents.isDestroyed()) return;
    chunk.toString().split('\n').forEach(line => {
      if (line.trim()) webContents.send('docker-log-line', { containerId: id, line });
    });
  });
  child.on('error', () => logProcesses.delete(id));
  child.on('exit', () => logProcesses.delete(id));
  return { ok: true };
}

function logsStop({ id }) {
  const child = logProcesses.get(id);
  if (child) { try { child.kill(); } catch {} logProcesses.delete(id); }
  return { ok: true };
}

function stopAllLogs() {
  for (const id of [...logProcesses.keys()]) logsStop({ id });
}

module.exports = {
  getConfig,
  saveConfig,
  listDistros,
  getServiceStatus,
  serviceStart,
  serviceStop,
  listContainers,
  containerAction,
  testConnection,
  logsStart,
  logsStop,
  stopAllLogs,
};
