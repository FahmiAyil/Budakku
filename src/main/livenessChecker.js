/**
 * Liveness Checker
 * PID detection, transcript-based re-verification, 2-second interval process liveness check
 */

const path = require('path');
const os = require('os');
const fs = require('fs');

const sessionPids = new Map(); // sessionId → actual claude process PID

function isWsl2Agent(agent) {
  // WSL2 transcript paths are Linux absolute paths (start with /)
  return typeof agent.jsonlPath === 'string' && agent.jsonlPath.startsWith('/');
}

async function checkWsl2ProcessAlive(pid) {
  const { spawnSync } = require('child_process');
  const r = spawnSync('wsl', ['-e', 'bash', '-c', `kill -0 ${pid} 2>/dev/null && echo alive || echo dead`], {
    encoding: 'utf8',
    timeout: 3000
  });
  return !r.error && r.status === 0 && r.stdout.trim() === 'alive';
}

async function checkLivenessTier1(agentId, pid, agent) {
  if (agent && isWsl2Agent(agent)) {
    return checkWsl2ProcessAlive(pid);
  }
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return false;
  }
}

/**
 * Function to accurately find the Claude PID for a session using transcript_path
 * Linux/macOS: lsof -t <path>
 * Windows: Restart Manager API (find-file-owner.ps1)
 */
function detectClaudePidByTranscript(jsonlPath, callback) {
  const { execFile } = require('child_process');

  if (!jsonlPath) {
    detectClaudePidsFallback(callback);
    return;
  }

  const resolved = jsonlPath.startsWith('~')
    ? path.join(os.homedir(), jsonlPath.slice(1))
    : jsonlPath;

  if (process.platform === 'win32') {
    // WSL2 transcript paths start with / — use wsl lsof instead of Windows lsof
    if (resolved.startsWith('/')) {
      const { spawnSync } = require('child_process');
      const r = spawnSync('wsl', ['-e', 'bash', '-c', `lsof -t "${resolved}" 2>/dev/null`], {
        encoding: 'utf8', timeout: 5000
      });
      if (!r.error && r.stdout) {
        const pids = r.stdout.trim().split('\n').map(p => parseInt(p.trim(), 10)).filter(p => !isNaN(p) && p > 0);
        if (pids.length > 0) return callback(pids[0]);
      }
      return detectClaudePidsFallback(callback);
    }
    const scriptPath = path.join(__dirname, '..', 'find-file-owner.ps1');
    execFile('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', scriptPath, '-FilePath', resolved],
      { timeout: 5000 }, (err, stdout) => {
      if (!err && stdout) {
        const pids = stdout.trim().split('\n').map(p => parseInt(p.trim(), 10)).filter(p => !isNaN(p) && p > 0);
        if (pids.length > 0) {
          return callback(pids[0]);
        }
      }
      detectClaudePidsFallback(callback);
    });
  } else {
    execFile('lsof', ['-t', resolved], { timeout: 3000 }, (err, stdout) => {
      if (!err && stdout) {
        const pids = stdout.trim().split('\n').map(p => parseInt(p.trim(), 10)).filter(p => !isNaN(p) && p > 0);
        if (pids.length > 0) {
          return callback(pids[0]);
        }
      }
      detectClaudePidsFallback(callback);
    });
  }
}

function detectClaudePidsFallback(callback) {
  const { execFile } = require('child_process');
  if (process.platform === 'win32') {
    // Search only node.exe (exclude Claude Desktop App's claude.exe)
    const psCmd = `Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object { $_.Name -eq 'node.exe' -and $_.CommandLine -like '*claude*' } | Select-Object -ExpandProperty ProcessId`;
    execFile('powershell.exe', ['-NoProfile', '-Command', psCmd], { timeout: 6000 }, (err, stdout) => {
      if (err || !stdout) return callback(null);
      const pids = stdout.trim().split('\n').map(p => parseInt(p.trim(), 10)).filter(p => !isNaN(p) && p > 0);
      callback(pids.length > 0 ? pids : null);
    });
  } else {
    execFile('pgrep', ['-f', 'node.*claude'], { timeout: 3000 }, (err, stdout) => {
      if (err || !stdout) return callback(null);
      const pids = stdout.trim().split('\n').map(p => parseInt(p.trim(), 10)).filter(p => !isNaN(p) && p > 0);
      callback(pids.length > 0 ? pids : null);
    });
  }
}

// Re-detect agents with unregistered PIDs (prevent duplicate execution)
const _pidRetryRunning = new Set();
function retryPidDetection(sessionId, agentManager, debugLog) {
  if (_pidRetryRunning.has(sessionId) || sessionPids.has(sessionId)) return;
  _pidRetryRunning.add(sessionId);

  const agent = agentManager ? agentManager.getAgent(sessionId) : null;
  const jsonlPath = agent ? agent.jsonlPath : null;

  detectClaudePidByTranscript(jsonlPath, (result) => {
    _pidRetryRunning.delete(sessionId);
    if (!result) return;

    if (typeof result === 'number') {
      sessionPids.set(sessionId, result);
      debugLog(`[Live] PID assigned via transcript: ${sessionId.slice(0, 8)} → pid=${result}`);
    } else if (Array.isArray(result)) {
      const registeredPids = new Set(sessionPids.values());
      const newPid = result.find(p => !registeredPids.has(p));
      if (newPid) {
        sessionPids.set(sessionId, newPid);
        debugLog(`[Live] PID assigned via fallback: ${sessionId.slice(0, 8)} → pid=${newPid}`);
      }
    }
  });
}

/**
 * Count running Claude CLI processes (node.exe *claude*)
 */
function countClaudeProcesses(callback) {
  const { execFile } = require('child_process');
  if (process.platform === 'win32') {
    const psCmd = `(Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object { $_.Name -eq 'node.exe' -and $_.CommandLine -like '*claude*' }).Count`;
    execFile('powershell.exe', ['-NoProfile', '-Command', psCmd], { timeout: 6000 }, (err, stdout) => {
      if (err || !stdout) return callback(0);
      callback(parseInt(stdout.trim(), 10) || 0);
    });
  } else {
    execFile('pgrep', ['-fc', 'node.*claude'], { timeout: 3000 }, (err, stdout) => {
      callback(parseInt((stdout || '').trim(), 10) || 0);
    });
  }
}

/**
 * Get jsonl file mtime (0 if not found)
 */
function getJsonlMtime(jsonlPath) {
  if (!jsonlPath) return 0;
  try {
    const resolved = jsonlPath.startsWith('~')
      ? path.join(os.homedir(), jsonlPath.slice(1))
      : jsonlPath;
    return fs.statSync(resolved).mtimeMs;
  } catch { return 0; }
}

// Zombie sweep: compare process count vs main agent count, remove oldest by mtime
// WSL2 agents are excluded — their liveness is managed by the per-agent checkWsl2ProcessAlive check.
let _zombieSweepRunning = false;
function zombieSweep(agentManager, debugLog) {
  if (_zombieSweepRunning) return;
  _zombieSweepRunning = true;

  const allMain = agentManager.getAllAgents().filter(a => !a.isSubagent);
  // Only Windows agents participate in the Windows process count comparison
  const windowsAgents = allMain.filter(a => !isWsl2Agent(a));
  const mainCount = windowsAgents.length;
  if (mainCount <= 1) { _zombieSweepRunning = false; return; }

  countClaudeProcesses((processCount) => {
    _zombieSweepRunning = false;
    if (processCount >= mainCount) return; // no excess avatars

    const excess = mainCount - processCount;
    debugLog(`[Live] Zombie sweep: ${processCount} processes, ${mainCount} Windows agents → ${excess} excess`);

    // Sort by jsonl mtime ascending (oldest first)
    const sorted = windowsAgents
      .map(a => ({ agent: a, mtime: getJsonlMtime(a.jsonlPath) }))
      .sort((a, b) => a.mtime - b.mtime);

    for (let i = 0; i < excess; i++) {
      const { agent } = sorted[i];
      debugLog(`[Live] Zombie sweep: removing ${agent.id.slice(0, 8)} (mtime=${new Date(sorted[i].mtime).toISOString()})`);
      sessionPids.delete(agent.id);
      agentManager.removeAgent(agent.id);
    }
  });
}

const LIVENESS_INTERVAL = 2000;
const GRACE_MS = 10000;
const ZOMBIE_SWEEP_INTERVAL = 30000;

function startLivenessChecker({ agentManager, debugLog }) {
  const zombieSweepId = setInterval(() => {
    if (agentManager) zombieSweep(agentManager, debugLog);
  }, ZOMBIE_SWEEP_INTERVAL);

  const livenessCheckId = setInterval(async () => {
    if (!agentManager) return;
    for (const agent of agentManager.getAllAgents()) {
      if (agent.firstSeen && (Date.now() - agent.firstSeen) < GRACE_MS) continue;

      const pid = sessionPids.get(agent.id);
      // No PID — skip removal, rely on SessionEnd hook to clean up
      if (!pid) continue;

      const alive = await checkLivenessTier1(agent.id, pid, agent);
      if (alive) {
        if (agent.state === 'Offline') {
          agentManager.updateAgent({ ...agent, state: 'Waiting' }, 'live');
        }
        continue;
      }

      debugLog(`[Live] ${agent.id.slice(0, 8)} pid=${pid} dead → re-checking via transcript`);
      const newPid = await new Promise((resolve) => {
        detectClaudePidByTranscript(agent.jsonlPath, (result) => {
          if (typeof result === 'number') resolve(result);
          else if (Array.isArray(result)) {
            const registeredPids = new Set(sessionPids.values());
            resolve(result.find(p => !registeredPids.has(p) && p !== pid) || null);
          } else resolve(null);
        });
      });

      if (newPid) {
        sessionPids.set(agent.id, newPid);
        debugLog(`[Live] ${agent.id.slice(0, 8)} PID renewed: ${pid} → ${newPid}`);
        if (agent.state === 'Offline') {
          agentManager.updateAgent({ ...agent, state: 'Waiting' }, 'live');
        }
      } else {
        debugLog(`[Live] ${agent.id.slice(0, 8)} confirmed dead → removing`);
        sessionPids.delete(agent.id);
        agentManager.removeAgent(agent.id);
      }
    }
  }, LIVENESS_INTERVAL);

  return { zombieSweepId, livenessCheckId };
}

module.exports = { sessionPids, startLivenessChecker, detectClaudePidByTranscript };
