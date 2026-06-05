const { ipcMain } = require('electron');
const dm = require('./dockerManager');

function registerDockerIpc(getWebContents) {
  ipcMain.handle('docker-get-config', async () => dm.getConfig());

  ipcMain.handle('docker-list-distros', async () => dm.listDistros());

  ipcMain.handle('docker-save-config', async (_e, { distro, password }) =>
    dm.saveConfig({ distro, password })
  );

  ipcMain.handle('docker-test-connection', async (_e, { distro, password } = {}) =>
    dm.testConnection({ distro, password })
  );

  ipcMain.handle('docker-service-status', async () => dm.getServiceStatus());

  ipcMain.handle('docker-service-start', async () => dm.serviceStart());

  ipcMain.handle('docker-service-stop', async () => dm.serviceStop());

  ipcMain.handle('docker-list-containers', async () => dm.listContainers());

  ipcMain.handle('docker-container-action', async (_e, { id, action }) =>
    dm.containerAction({ id, action })
  );

  ipcMain.handle('docker-logs-start', async (event, { id }) => {
    const wc = getWebContents();
    if (!wc) return { ok: false, error: 'Dashboard window not available.' };
    return dm.logsStart({ id, webContents: wc });
  });

  ipcMain.handle('docker-logs-stop', async (_e, { id }) => dm.logsStop({ id }));
}

module.exports = { registerDockerIpc };
