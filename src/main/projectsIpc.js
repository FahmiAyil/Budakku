const { ipcMain } = require('electron');
const pm = require('./projectsManager');

function registerProjectsIpc(getWebContents) {
  ipcMain.handle('projects-list', async () => pm.listProjects());

  // path and command come from the renderer (it already has them from listProjects).
  // This avoids a readYaml() call — and its blocking spawnSync — inside startProject.
  ipcMain.handle('projects-start', async (_e, { name, path, command }) => {
    const wc = getWebContents();
    if (!wc) return { ok: false, error: 'Dashboard window not available.' };
    return pm.startProject({ name, path, command, webContents: wc });
  });

  ipcMain.handle('projects-stop', async (_e, { name }) => pm.stopProject({ name }));

  // Returns buffered lines so the Logs panel shows output from before it was opened.
  ipcMain.handle('projects-get-buffer', async (_e, { name }) => pm.getBuffer(name));
}

module.exports = { registerProjectsIpc };
