interface ElectronAPI {
  getAppVersion: () => Promise<string>;
  getAiStatus: () => Promise<string>;
  platform: string;

  getNotificationsEnabled: () => Promise<boolean>;
  setNotificationsEnabled: (enabled: boolean) => Promise<boolean>;
  onNotificationsEnabledChanged: (callback: (enabled: boolean) => void) => () => void;

  getLaunchOnStartup: () => Promise<boolean>;
  setLaunchOnStartup: (enabled: boolean) => Promise<boolean>;
  onLaunchOnStartupChanged: (callback: (enabled: boolean) => void) => () => void;
}

interface Window {
  electronAPI?: ElectronAPI;
}
