/**
 * WSL2 Hook Registration
 * Detects WSL2 and registers Claude Code hooks inside it,
 * pointing back to Budakku's HTTP server running on the Windows host.
 *
 * WHY: Claude Code running in WSL2 fires hooks inside the WSL2 VM.
 * By default those hooks POST to localhost:PORT inside WSL2 — which is
 * the WSL2 VM itself, not Windows. We need to register the hook URL as
 * the Windows host IP so they reach Budakku's server.
 */

const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const HOOK_EVENTS = [
  'SessionStart', 'SessionEnd', 'UserPromptSubmit',
  'PreToolUse', 'PostToolUse', 'PostToolUseFailure',
  'Stop', 'TaskCompleted', 'PermissionRequest', 'Notification',
  'SubagentStart', 'SubagentStop', 'TeammateIdle',
  'ConfigChange', 'WorktreeCreate', 'WorktreeRemove', 'PreCompact'
];

function wsl(args) {
  return spawnSync('wsl', args, { encoding: 'utf8', timeout: 8000 });
}

function isWsl2Available() {
  const r = wsl(['-e', 'echo', 'ok']);
  return !r.error && r.status === 0 && r.stdout.trim() === 'ok';
}

function getWindowsHostIp() {
  // Use the default route gateway — the actual Windows host IP for TCP connections in WSL2 NAT mode.
  // resolv.conf nameserver (10.255.255.254 in newer WSL2) is DNS-only and refuses TCP connections.
  const r = wsl(['-e', 'bash', '-c', "ip route show default | awk 'NR==1{print $3}'"]);
  if (r.error || r.status !== 0) return null;
  return r.stdout.trim() || null;
}

function readWsl2ClaudeConfig() {
  const r = wsl(['-e', 'bash', '-c', 'cat ~/.claude/settings.json 2>/dev/null || echo "{}"']);
  if (r.error || r.status !== 0) return {};
  try { return JSON.parse(r.stdout.trim()) || {}; } catch { return {}; }
}

function backupWsl2ClaudeConfig(debugLog) {
  // Backup to ~/.claude/settings.json.budakku-backup before every write
  const r = wsl(['-e', 'bash', '-c',
    'if [ -f ~/.claude/settings.json ]; then cp ~/.claude/settings.json ~/.claude/settings.json.budakku-backup && echo ok; else echo skip; fi'
  ]);
  if (r.error || r.status !== 0) {
    debugLog('[WSL2] Could not create backup, aborting write for safety');
    return false;
  }
  const result = r.stdout.trim();
  if (result === 'ok') debugLog('[WSL2] Backup saved → ~/.claude/settings.json.budakku-backup');
  return true;
}

function writeWsl2ClaudeConfig(config, debugLog) {
  // Always backup before touching the file
  if (!backupWsl2ClaudeConfig(debugLog)) return false;

  const tempFile = path.join(os.tmpdir(), `budakku-wsl2-${process.pid}.json`);
  try {
    fs.writeFileSync(tempFile, JSON.stringify(config, null, 2), 'utf8');
    // Convert Windows path to WSL2 /mnt/ path: C:\Foo\Bar -> /mnt/c/Foo/Bar
    const wslPath = tempFile.replace(/\\/g, '/').replace(/^([A-Za-z]):/, (_, d) => `/mnt/${d.toLowerCase()}`);
    const r = wsl(['-e', 'bash', '-c', `mkdir -p ~/.claude && cp "${wslPath}" ~/.claude/settings.json`]);
    if (r.error || r.status !== 0) {
      debugLog(`[WSL2] Write error: ${r.stderr || r.error}`);
      return false;
    }
    return true;
  } finally {
    try { fs.unlinkSync(tempFile); } catch {}
  }
}

function isOurHook(h, port) {
  return h.type === 'http' && typeof h.url === 'string' && h.url.includes(`:${port}/hook`);
}

function removeStaleHooks(config, port) {
  // Remove any old Budakku hook entries (identified by our port) so stale IPs don't accumulate
  for (const event of HOOK_EVENTS) {
    if (!Array.isArray(config.hooks[event])) continue;
    config.hooks[event] = config.hooks[event]
      .map(entry => {
        if (!Array.isArray(entry.hooks)) return entry;
        return { ...entry, hooks: entry.hooks.filter(h => !isOurHook(h, port)) };
      })
      .filter(entry => Array.isArray(entry.hooks) && entry.hooks.length > 0);
  }
}

function registerWsl2Hooks(debugLog, port) {
  debugLog('[WSL2] Checking for WSL2...');

  if (!isWsl2Available()) {
    debugLog('[WSL2] WSL2 not available, skipping');
    return false;
  }

  debugLog('[WSL2] WSL2 detected, resolving Windows host IP...');
  const hostIp = getWindowsHostIp();
  if (!hostIp) {
    debugLog('[WSL2] Could not determine Windows host IP, skipping');
    return false;
  }

  const hookUrl = `http://${hostIp}:${port}/hook`;
  debugLog(`[WSL2] Registering hooks → ${hookUrl}`);

  const config = readWsl2ClaudeConfig();
  config.hooks = config.hooks || {};

  // Always remove stale entries first (IP can change between restarts)
  removeStaleHooks(config, port);

  const ourEntry = { matcher: '*', hooks: [{ type: 'http', url: hookUrl }] };
  for (const event of HOOK_EVENTS) {
    if (!Array.isArray(config.hooks[event])) {
      config.hooks[event] = [ourEntry];
    } else {
      config.hooks[event].push(ourEntry);
    }
  }

  if (writeWsl2ClaudeConfig(config, debugLog)) {
    debugLog('[WSL2] Hook registration complete');
    return true;
  }

  debugLog('[WSL2] Hook registration failed');
  return false;
}

module.exports = { registerWsl2Hooks };
