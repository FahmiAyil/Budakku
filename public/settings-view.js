// Settings view — Docker (WSL) configuration
// Renders into #settingsView, called when the settings nav item is activated.

async function renderSettingsView() {
  const el = document.getElementById('settingsView');
  if (!el) return;

  el.innerHTML = `
    <div class="settings-header">
      <div>
        <h2>Settings</h2>
        <div class="subtitle">App configuration</div>
      </div>
    </div>
    <div class="settings-body">
      <div class="st-section">
        <div class="st-section-header">
          <span class="st-section-title">Docker (WSL)</span>
        </div>
        <div class="st-section-body">
          <div class="st-form-row">
            <label class="st-label">WSL Distro</label>
            <div class="st-input-wrap">
              <select class="st-select" id="st-distro">
                <option value="">Loading...</option>
              </select>
            </div>
            <span class="st-hint">Which WSL distribution has Docker installed.</span>
          </div>
          <div class="st-form-row">
            <label class="st-label">WSL Sudo Password</label>
            <div class="st-input-wrap">
              <input class="st-input" type="password" id="st-password"
                placeholder="Enter your WSL sudo password" autocomplete="new-password" />
              <button class="btn-secondary" id="st-toggle-pw" title="Show/hide password"
                style="padding:7px 10px;flex-shrink:0">👁</button>
            </div>
            <span class="st-hint">
              Used with <code style="font-family:var(--font-mono);color:var(--color-text-muted)">sudo -S</code>
              to start/stop Docker. Stored encrypted on your machine only.
            </span>
          </div>
          <div class="st-actions">
            <button class="btn-primary" id="st-save">Save</button>
            <button class="btn-secondary" id="st-test">⚡ Test Connection</button>
            <span class="st-test-result" id="st-test-result" style="display:none"></span>
          </div>
        </div>
      </div>
    </div>
  `;

  const distroEl = document.getElementById('st-distro');
  const passwordEl = document.getElementById('st-password');
  const saveBtn = document.getElementById('st-save');
  const testBtn = document.getElementById('st-test');
  const testResult = document.getElementById('st-test-result');
  const togglePw = document.getElementById('st-toggle-pw');

  // Load current config + distro list
  const [cfg, distros] = await Promise.all([
    window.dockerAPI.getConfig(),
    window.dockerAPI.listDistros(),
  ]);

  distroEl.innerHTML = distros.length
    ? distros.map(d => `<option value="${d}" ${d === cfg.distro ? 'selected' : ''}>${d}</option>`).join('')
    : `<option value="">No WSL distros found</option>`;

  if (cfg.passwordSet) {
    passwordEl.placeholder = '••••••••  (password saved — enter new to change)';
  }

  // Show/hide password toggle
  togglePw.addEventListener('click', () => {
    passwordEl.type = passwordEl.type === 'password' ? 'text' : 'password';
  });

  // Save
  saveBtn.addEventListener('click', async () => {
    saveBtn.disabled = true;
    saveBtn.textContent = 'Saving…';
    const payload = { distro: distroEl.value };
    if (passwordEl.value) payload.password = passwordEl.value;
    const result = await window.dockerAPI.saveConfig(payload);
    saveBtn.disabled = false;
    saveBtn.textContent = 'Save';
    if (result.ok) {
      showTestResult(true, 'Saved.');
      passwordEl.value = '';
      passwordEl.placeholder = '••••••••  (password saved — enter new to change)';
    } else {
      showTestResult(false, result.error || 'Save failed.');
    }
  });

  // Test connection
  testBtn.addEventListener('click', async () => {
    testBtn.disabled = true;
    testBtn.textContent = 'Testing…';
    testResult.style.display = 'none';
    const payload = { distro: distroEl.value };
    if (passwordEl.value) payload.password = passwordEl.value;
    const result = await window.dockerAPI.testConnection(payload);
    testBtn.disabled = false;
    testBtn.textContent = '⚡ Test Connection';
    if (result.ok) {
      showTestResult(true, `✓ Docker v${result.version}`);
    } else {
      showTestResult(false, result.error || 'Connection failed.');
    }
  });

  function showTestResult(ok, msg) {
    testResult.style.display = 'inline-block';
    testResult.className = `st-test-result ${ok ? 'ok' : 'fail'}`;
    testResult.textContent = msg;
  }
}

window._renderSettingsView = renderSettingsView;
