/**
 * Dashboard Dashboard Preload Script
 * Provides secure IPC bridge for Dashboard window
 */

const { contextBridge, ipcRenderer } = require('electron');

// Expose secure API to Dashboard window
contextBridge.exposeInMainWorld('dashboardAPI', {
  // Request initial agents
  getInitialAgents: () => {
    ipcRenderer.send('get-dashboard-agents');
    return new Promise(resolve => {
      const listener = (event, data) => {
        ipcRenderer.removeListener('dashboard-agents-response', listener);
        resolve(data);
      };
      ipcRenderer.on('dashboard-agents-response', listener);
    });
  },

  // Listen for initial data
  onInitialData: (callback) => {
    const listener = (event, data) => callback(data);
    ipcRenderer.on('dashboard-initial-data', listener);
    return () => ipcRenderer.removeListener('dashboard-initial-data', listener);
  },

  // Agent event listeners
  onAgentAdded: (callback) => {
    const listener = (event, data) => callback(data);
    ipcRenderer.on('dashboard-agent-added', listener);
    return () => ipcRenderer.removeListener('dashboard-agent-added', listener);
  },

  onAgentUpdated: (callback) => {
    const listener = (event, data) => callback(data);
    ipcRenderer.on('dashboard-agent-updated', listener);
    return () => ipcRenderer.removeListener('dashboard-agent-updated', listener);
  },

  onAgentRemoved: (callback) => {
    const listener = (event, data) => callback(data);
    ipcRenderer.on('dashboard-agent-removed', listener);
    return () => ipcRenderer.removeListener('dashboard-agent-removed', listener);
  },

  // Send commands to Budakku
  focusAgent: (agentId) => {
    ipcRenderer.send('dashboard-focus-agent', agentId);
  },

  // PiP
  togglePip: () => ipcRenderer.invoke('toggle-pip'),
  onPipStateChanged: (callback) => {
    const listener = (event, isOpen) => callback(isOpen);
    ipcRenderer.on('pip-state-changed', listener);
    return () => ipcRenderer.removeListener('pip-state-changed', listener);
  },

});

contextBridge.exposeInMainWorld('dockerAPI', {
  getConfig: () => ipcRenderer.invoke('docker-get-config'),
  listDistros: () => ipcRenderer.invoke('docker-list-distros'),
  saveConfig: (cfg) => ipcRenderer.invoke('docker-save-config', cfg),
  testConnection: (cfg) => ipcRenderer.invoke('docker-test-connection', cfg),
  serviceStatus: () => ipcRenderer.invoke('docker-service-status'),
  serviceStart: () => ipcRenderer.invoke('docker-service-start'),
  serviceStop: () => ipcRenderer.invoke('docker-service-stop'),
  listContainers: () => ipcRenderer.invoke('docker-list-containers'),
  containerAction: (id, action) => ipcRenderer.invoke('docker-container-action', { id, action }),
  logsStart: (id) => ipcRenderer.invoke('docker-logs-start', { id }),
  logsStop: (id) => ipcRenderer.invoke('docker-logs-stop', { id }),
  onLogLine: (cb) => {
    ipcRenderer.removeAllListeners('docker-log-line');
    ipcRenderer.on('docker-log-line', (event, data) => cb(data));
  },
});

contextBridge.exposeInMainWorld('projectsAPI', {
  list: () => ipcRenderer.invoke('projects-list'),
  start: (name, path, command) => ipcRenderer.invoke('projects-start', { name, path, command }),
  stop: (name) => ipcRenderer.invoke('projects-stop', { name }),
  getBuffer: (name) => ipcRenderer.invoke('projects-get-buffer', { name }),
  onLogLine: (cb) => {
    ipcRenderer.removeAllListeners('projects-log-line');
    ipcRenderer.on('projects-log-line', (event, data) => cb(data));
  },
});
