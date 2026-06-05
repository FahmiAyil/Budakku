// Projects view — list and run WSL frontend projects from webrunner.yaml
// Renders into #projectsView. Called when projects nav item is activated.

let _projectsLogName = null;

function escHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function projectActionsHTML(project) {
  const n = escHtml(project.name);
  const p = escHtml(project.path);
  const c = escHtml(project.command);
  if (project.status === 'running') {
    return `
      <button class="btn-xs stop" data-action="stop" data-name="${n}">&#9632; Stop</button>
      <button class="btn-xs logs" data-action="logs" data-name="${n}">&#128203; Logs</button>
    `;
  }
  return `
    <button class="btn-xs start" data-action="start" data-name="${n}" data-path="${p}" data-command="${c}">&#9654; Start</button>
  `;
}

function renderProjectTable(projects) {
  if (!projects.length) {
    return `<div class="dk-empty">No projects found in webrunner.yaml.</div>`;
  }
  const rows = projects.map(p => `
    <tr>
      <td class="container-name-cell">${escHtml(p.name)}</td>
      <td class="container-image-cell" style="font-size:0.75rem;color:var(--color-text-muted)">${escHtml(p.path)}</td>
      <td class="container-image-cell">${escHtml(p.command)}</td>
      <td><span class="status-pill ${p.status}"><span class="status-dot-sm"></span>${p.status === 'running' ? 'Running' : 'Stopped'}</span></td>
      <td class="container-actions-cell">${projectActionsHTML(p)}</td>
    </tr>
  `).join('');
  return `
    <table class="container-table">
      <thead>
        <tr>
          <th>Name</th>
          <th>Path</th>
          <th>Command</th>
          <th>Status</th>
          <th style="text-align:right">Actions</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  `;
}

function showProjectsBanner(parentEl, type, message) {
  const existing = parentEl.querySelector('.dk-banner');
  if (existing) existing.remove();
  const div = document.createElement('div');
  div.className = `dk-banner ${type}`;
  div.textContent = message;
  parentEl.prepend(div);
  if (type !== 'error') setTimeout(() => div.remove(), 3000);
}

function appendLogLine(logsBody, line) {
  const div = document.createElement('div');
  div.className = 'log-line';
  const ts = document.createElement('span');
  ts.className = 'log-ts';
  ts.textContent = new Date().toTimeString().slice(0, 8);
  const txt = document.createElement('span');
  txt.textContent = line; // textContent — no HTML injection risk
  div.appendChild(ts);
  div.appendChild(txt);
  logsBody.appendChild(div);
  logsBody.scrollTop = logsBody.scrollHeight;
}

async function refreshProjectsView() {
  const body = document.getElementById('pr-body');
  if (!body) return;

  let result;
  try {
    result = await window.projectsAPI.list();
  } catch (e) {
    body.innerHTML = `<div class="dk-banner error">Failed to load projects: ${escHtml(e.message)}</div>`;
    return;
  }

  if (result && result.error) {
    body.innerHTML = `<div class="dk-banner error">${escHtml(result.error)}</div>`;
    return;
  }

  body.innerHTML = renderProjectTable(result || []);

  body.querySelectorAll('[data-action]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const { action, name, path, command } = btn.dataset;

      if (action === 'logs') {
        openProjectLogs(name);
        return;
      }

      if (action === 'start') {
        btn.disabled = true;
        btn.textContent = 'Starting…';
        const res = await window.projectsAPI.start(name, path, command);
        if (!res.ok) {
          btn.disabled = false;
          btn.textContent = '▶ Start';
          showProjectsBanner(body, 'error', res.error || `Failed to start ${name}.`);
        } else {
          await refreshProjectsView();
        }
        return;
      }

      if (action === 'stop') {
        btn.disabled = true;
        btn.textContent = 'Stopping…';
        const res = await window.projectsAPI.stop(name);
        if (!res.ok) {
          btn.disabled = false;
          btn.textContent = '■ Stop';
          showProjectsBanner(body, 'error', res.error || `Failed to stop ${name}.`);
        } else {
          if (_projectsLogName === name) {
            _projectsLogName = null;
            const logsSection = document.getElementById('pr-logs-section');
            if (logsSection) { logsSection.style.display = 'none'; logsSection.innerHTML = ''; }
          }
          await refreshProjectsView();
        }
      }
    });
  });
}

async function openProjectLogs(projectName) {
  _projectsLogName = projectName;

  const logsSection = document.getElementById('pr-logs-section');
  if (!logsSection) return;

  logsSection.style.display = 'block';
  logsSection.innerHTML = `
    <div class="dk-section">
      <div class="dk-section-header">
        <span class="dk-section-title">Output &mdash; <span style="color:var(--color-text-muted)">${escHtml(projectName)}</span></span>
        <button class="btn-xs" id="pr-logs-close">&#10005; Close</button>
      </div>
      <div class="logs-body" id="pr-logs-body"></div>
    </div>
  `;

  document.getElementById('pr-logs-close').addEventListener('click', () => {
    _projectsLogName = null;
    logsSection.style.display = 'none';
    logsSection.innerHTML = '';
  });

  // Load buffered lines from before the panel was opened
  try {
    const buffer = await window.projectsAPI.getBuffer(projectName);
    const logsBody = document.getElementById('pr-logs-body');
    if (logsBody && buffer && buffer.length) {
      buffer.forEach(line => appendLogLine(logsBody, line));
    }
  } catch (_) { /* buffer fetch is best-effort */ }
}

async function renderProjectsView() {
  _projectsLogName = null;

  const el = document.getElementById('projectsView');
  if (!el) return;

  if (!window.projectsAPI) {
    el.innerHTML = `<div class="docker-header"><div><h2>Projects</h2></div></div><div class="docker-body"><div class="dk-banner error">Projects API not available. Please restart the app.</div></div>`;
    return;
  }

  el.innerHTML = `
    <div class="docker-header">
      <div>
        <h2>Projects</h2>
        <div class="subtitle">Run frontend projects on WSL</div>
      </div>
      <button class="btn-secondary" id="pr-refresh">&#8635; Refresh</button>
    </div>
    <div class="docker-body">
      <div class="dk-section">
        <div class="dk-section-header">
          <span class="dk-section-title">Projects</span>
        </div>
        <div class="dk-section-body" style="padding:0" id="pr-body">
          <div class="dk-empty">Loading&#8230;</div>
        </div>
      </div>
      <div id="pr-logs-section" style="display:none"></div>
    </div>
  `;

  // Listen for live log lines from running projects
  window.projectsAPI.onLogLine(({ projectName, line }) => {
    if (projectName !== _projectsLogName) return;
    const logsBody = document.getElementById('pr-logs-body');
    if (!logsBody) return;
    appendLogLine(logsBody, line);
  });

  document.getElementById('pr-refresh').addEventListener('click', refreshProjectsView);

  await refreshProjectsView();
}

window._renderProjectsView = renderProjectsView;
