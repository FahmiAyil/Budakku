// Docker view — service control, container management, log streaming
// Renders into #dockerView. Called when docker nav item is activated.

let _dockerPollInterval = null;
let _activeLogContainerId = null;

function stopDockerPolling() {
  if (_dockerPollInterval) { clearInterval(_dockerPollInterval); _dockerPollInterval = null; }
}

function showDockerBanner(parentEl, type, message) {
  const existing = parentEl.querySelector('.dk-banner');
  if (existing) existing.remove();
  const div = document.createElement('div');
  div.className = `dk-banner ${type}`;
  div.textContent = message;
  parentEl.prepend(div);
  if (type !== 'error') setTimeout(() => div.remove(), 3000);
}

function statusPillHTML(status) {
  const labels = { running: 'Running', stopped: 'Stopped', paused: 'Paused', other: 'Unknown' };
  return `<span class="status-pill ${status}"><span class="status-dot-sm"></span>${labels[status] || status}</span>`;
}

function containerActionsHTML(container) {
  if (container.status === 'running') {
    return `
      <button class="btn-xs stop" data-action="stop" data-id="${container.id}">■ Stop</button>
      <button class="btn-xs restart" data-action="restart" data-id="${container.id}">↺ Restart</button>
      <button class="btn-xs logs" data-action="logs" data-id="${container.id}" data-name="${container.name}">📋 Logs</button>
    `;
  }
  return `
    <button class="btn-xs start" data-action="start" data-id="${container.id}">▶ Start</button>
  `;
}

function renderContainerTable(containers) {
  if (!containers.length) {
    return `<div class="dk-empty">No containers found. Make sure Docker is running.</div>`;
  }
  const sorted = [...containers].sort((a, b) => (a.status === 'running' ? -1 : b.status === 'running' ? 1 : 0));
  const rows = sorted.map(c => `
    <tr>
      <td class="container-name-cell">${c.name}</td>
      <td class="container-image-cell">${c.image}</td>
      <td>${statusPillHTML(c.status)}</td>
      <td class="container-actions-cell">${containerActionsHTML(c)}</td>
    </tr>
  `).join('');
  return `
    <table class="container-table">
      <thead>
        <tr>
          <th>Name</th>
          <th>Image</th>
          <th>Status</th>
          <th style="text-align:right">Actions</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  `;
}

async function refreshDockerView() {
  const serviceBody = document.getElementById('dk-service-body');
  const containersBody = document.getElementById('dk-containers-body');
  if (!serviceBody || !containersBody) return;

  const [svcStatus, containers] = await Promise.all([
    window.dockerAPI.serviceStatus(),
    window.dockerAPI.listContainers(),
  ]);

  // Service card
  const running = svcStatus.running;
  serviceBody.innerHTML = `
    <div class="service-card">
      <div class="service-info">
        <span style="font-size:22px">🐳</span>
        <div>
          <div class="service-name">Docker Engine (WSL)</div>
          <div class="service-status-pill ${running ? 'running' : 'stopped'}">
            <span class="status-dot-sm"></span>
            ${running ? 'Running' : 'Stopped'}
          </div>
        </div>
      </div>
      <div style="display:flex;gap:8px">
        ${running
          ? `<button class="btn-secondary" id="dk-svc-stop">■ Stop Docker</button>`
          : `<button class="btn-primary" id="dk-svc-start">▶ Start Docker</button>`
        }
      </div>
    </div>
  `;

  // Service button handlers
  const startBtn = document.getElementById('dk-svc-start');
  const stopBtn = document.getElementById('dk-svc-stop');

  if (startBtn) {
    startBtn.addEventListener('click', async () => {
      startBtn.disabled = true;
      startBtn.textContent = '⏳ Starting…';
      const result = await window.dockerAPI.serviceStart();
      if (result.ok) {
        await refreshDockerView();
      } else {
        startBtn.disabled = false;
        startBtn.textContent = '▶ Start Docker';
        showDockerBanner(serviceBody, 'error', result.error || 'Failed to start Docker.');
      }
    });
  }

  if (stopBtn) {
    stopBtn.addEventListener('click', async () => {
      stopBtn.disabled = true;
      stopBtn.textContent = '⏳ Stopping…';
      const result = await window.dockerAPI.serviceStop();
      if (result.ok) {
        await refreshDockerView();
      } else {
        stopBtn.disabled = false;
        stopBtn.textContent = '■ Stop Docker';
        showDockerBanner(serviceBody, 'error', result.error || 'Failed to stop Docker.');
      }
    });
  }

  // Container table
  containersBody.innerHTML = renderContainerTable(containers);

  // Container action buttons
  containersBody.querySelectorAll('[data-action]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const { action, id, name } = btn.dataset;
      if (action === 'logs') {
        openLogsPanel(id, name || id);
        return;
      }
      btn.disabled = true;
      const result = await window.dockerAPI.containerAction(id, action);
      btn.disabled = false;
      if (result.ok) {
        await refreshDockerView();
      } else {
        showDockerBanner(containersBody, 'error', result.error || `Failed to ${action} container.`);
      }
    });
  });
}

function openLogsPanel(containerId, containerName) {
  // Stop any previous log stream
  if (_activeLogContainerId && _activeLogContainerId !== containerId) {
    window.dockerAPI.logsStop(_activeLogContainerId);
  }
  _activeLogContainerId = containerId;

  const logsSection = document.getElementById('dk-logs-section');
  if (!logsSection) return;

  logsSection.style.display = 'block';
  logsSection.innerHTML = `
    <div class="dk-section">
      <div class="dk-section-header">
        <span class="dk-section-title">Logs</span>
        <div style="display:flex;align-items:center;gap:8px">
          <span class="logs-container-badge">${containerName}</span>
          <button class="btn-xs" id="dk-logs-close">✕ Close</button>
        </div>
      </div>
      <div class="logs-body" id="dk-logs-body"></div>
    </div>
  `;

  document.getElementById('dk-logs-close').addEventListener('click', () => {
    window.dockerAPI.logsStop(containerId);
    _activeLogContainerId = null;
    logsSection.style.display = 'none';
    logsSection.innerHTML = '';
  });

  window.dockerAPI.logsStart(containerId);
}

async function renderDockerView() {
  stopDockerPolling();
  if (_activeLogContainerId) {
    window.dockerAPI.logsStop(_activeLogContainerId);
    _activeLogContainerId = null;
  }

  const el = document.getElementById('dockerView');
  if (!el) return;

  el.innerHTML = `
    <div class="docker-header">
      <div>
        <h2>Docker</h2>
        <div class="subtitle">Manage containers on WSL</div>
      </div>
      <button class="btn-secondary" id="dk-refresh">⟳ Refresh</button>
    </div>
    <div class="docker-body">
      <div class="dk-section">
        <div class="dk-section-header">
          <span class="dk-section-title">Docker Service</span>
        </div>
        <div class="dk-section-body" id="dk-service-body">
          <div class="dk-empty">Loading…</div>
        </div>
      </div>
      <div class="dk-section">
        <div class="dk-section-header">
          <span class="dk-section-title">Containers</span>
        </div>
        <div class="dk-section-body" style="padding:0" id="dk-containers-body">
          <div class="dk-empty">Loading…</div>
        </div>
      </div>
      <div id="dk-logs-section" style="display:none"></div>
    </div>
  `;

  // Listen for streamed log lines
  window.dockerAPI.onLogLine(({ containerId, line }) => {
    if (containerId !== _activeLogContainerId) return;
    const logsBody = document.getElementById('dk-logs-body');
    if (!logsBody) return;
    const div = document.createElement('div');
    div.className = 'log-line';
    div.innerHTML = `<span class="log-ts">${new Date().toTimeString().slice(0,8)}</span><span>${line}</span>`;
    logsBody.appendChild(div);
    logsBody.scrollTop = logsBody.scrollHeight;
  });

  document.getElementById('dk-refresh').addEventListener('click', refreshDockerView);

  await refreshDockerView();

  // Poll every 5 seconds while view is active
  _dockerPollInterval = setInterval(refreshDockerView, 5000);
}

window._renderDockerView = renderDockerView;
window._stopDockerPolling = stopDockerPolling;
