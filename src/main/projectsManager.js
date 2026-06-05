const { spawnSync, spawn } = require('child_process');

const YAML_PATH = '/home/fahmi/Shark/HELPER/WebRunner/webrunner.yaml';

// Pure stdlib Python — no PyYAML needed.
function buildPythonScript(yamlPath) {
  return `import json, re
try:
    t = open("${yamlPath}").read()
    blocks = re.split(r'\\n\\s*-\\s+', t)
    projects = []
    for b in blocks[1:]:
        d = {}
        for l in b.split('\\n'):
            if ':' in l:
                k, _, v = l.partition(':')
                d[k.strip()] = v.strip()
        if 'name' in d:
            projects.append(d)
    print(json.dumps({"projects": projects}))
except FileNotFoundError:
    print(json.dumps({"error": "webrunner.yaml not found at expected path."}))
except Exception as e:
    print(json.dumps({"error": str(e)}))
`;
}

// Map<projectName, ChildProcess>
const _processes = new Map();

// Rolling buffer of last 500 lines per project — shown when user opens Logs panel
const _buffers = new Map();

const BUFFER_MAX = 500;

function _bufferLine(name, line) {
  const buf = _buffers.get(name) || [];
  buf.push(line);
  if (buf.length > BUFFER_MAX) buf.shift();
  _buffers.set(name, buf);
}

function getBuffer(name) {
  return (_buffers.get(name) || []).slice();
}

function readYaml() {
  const scriptB64 = Buffer.from(buildPythonScript(YAML_PATH)).toString('base64');
  const r = spawnSync('wsl', [
    '-e', 'bash', '-c',
    `echo "${scriptB64}" | base64 -d | python3 2>&1`
  ], { encoding: 'utf8', timeout: 10000 });

  if (r.error) return { error: 'WSL is not available.' };
  if (r.status !== 0) return { error: r.stdout.trim() || r.stderr.trim() || 'python3 failed in WSL.' };

  let parsed;
  try { parsed = JSON.parse(r.stdout.trim()); } catch {
    return { error: `Unexpected output from python3: ${r.stdout.trim().slice(0, 200)}` };
  }
  return parsed;
}

function listProjects() {
  const parsed = readYaml();
  if (parsed.error) return { error: parsed.error };

  return (parsed.projects || []).map(p => ({
    name: p.name,
    path: p.path,
    command: p.command,
    status: _processes.has(p.name) ? 'running' : 'stopped',
  }));
}

// path and command are passed directly from the renderer — no readYaml() needed here,
// which avoids the spawnSync blocking that was causing running processes to drop out.
function startProject({ name, path, command, webContents }) {
  if (_processes.has(name)) return { ok: false, error: `${name} is already running.` };

  // Load nvm explicitly so WSL-native node/yarn/npm are on PATH.
  // ~/.bashrc nvm block is often guarded by PS1 (interactive-only) so we bypass that.
  // stdbuf (when present) forces line-buffered stdout so log events fire promptly.
  const bashCmd = [
    'export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"',
    '[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"',
    `cd '${path}'`,
    `command -v stdbuf >/dev/null 2>&1 && exec stdbuf -oL -eL ${command} 2>&1 || exec ${command} 2>&1`,
  ].join('; ');
  const child = spawn('wsl', ['-e', 'bash', '-c', bashCmd]);
  _processes.set(name, child);
  _buffers.set(name, []); // reset buffer on fresh start

  const forward = (chunk) => {
    if (webContents.isDestroyed()) return;
    chunk.toString().split(/\r?\n/).forEach(line => {
      if (!line.trim()) return;
      _bufferLine(name, line);
      webContents.send('projects-log-line', { projectName: name, line });
    });
  };

  child.stdout.on('data', forward);
  child.stderr.on('data', forward);
  child.on('error', (err) => {
    if (!webContents.isDestroyed()) {
      const msg = `Process error: ${err.message}`;
      _bufferLine(name, msg);
      webContents.send('projects-log-line', { projectName: name, line: msg });
    }
    _processes.delete(name);
  });
  child.on('exit', (code) => {
    if (!webContents.isDestroyed()) {
      const msg = `Process exited (code ${code})`;
      _bufferLine(name, msg);
      webContents.send('projects-log-line', { projectName: name, line: msg });
    }
    _processes.delete(name);
  });

  return { ok: true };
}

function stopProject({ name }) {
  const child = _processes.get(name);
  if (child) {
    try { child.kill(); } catch {}
    _processes.delete(name);
  }
  return { ok: true };
}

function stopAllProjects() {
  for (const name of [..._processes.keys()]) stopProject({ name });
}

module.exports = { listProjects, startProject, stopProject, stopAllProjects, getBuffer, _processes };
