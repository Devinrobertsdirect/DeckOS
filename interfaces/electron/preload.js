const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("electronAPI", {
  getAppVersion: () => ipcRenderer.invoke("get-app-version"),
  getAiStatus: () => ipcRenderer.invoke("get-ai-status"),
  platform: process.platform,

  // Desktop notifications opt-in / opt-out
  getNotificationsEnabled: () => ipcRenderer.invoke("get-notifications-enabled"),
  setNotificationsEnabled: (enabled) => ipcRenderer.invoke("set-notifications-enabled", enabled),
  onNotificationsEnabledChanged: (callback) => {
    const handler = (_event, value) => callback(value);
    ipcRenderer.on("notifications-enabled-changed", handler);
    return () => ipcRenderer.removeListener("notifications-enabled-changed", handler);
  },

  // Launch at login (Windows startup / macOS Login Items)
  getLaunchOnStartup: () => ipcRenderer.invoke("get-launch-on-startup"),
  setLaunchOnStartup: (enabled) => ipcRenderer.invoke("set-launch-on-startup", enabled),
  onLaunchOnStartupChanged: (callback) => {
    const handler = (_event, value) => callback(value);
    ipcRenderer.on("launch-on-startup-changed", handler);
    return () => ipcRenderer.removeListener("launch-on-startup-changed", handler);
  },
});
