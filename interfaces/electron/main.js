const { app, BrowserWindow, ipcMain, shell, Tray, Menu, nativeImage, Notification } = require("electron");
const path = require("path");
const fs = require("fs");
const { spawn } = require("child_process");
const http = require("http");

const API_PORT = 8080;
const STARTUP_TIMEOUT_MS = 20_000;
let apiProcess = null;
let tray = null;
let mainWindow = null;

// True when the app was launched automatically at login (via --startup arg).
// In this mode we start hidden in the tray instead of opening the main window.
const startMinimized = process.argv.includes("--startup");

// ─── AI Status ───────────────────────────────────────────────────────────────
// Possible states: "offline" | "online" | "speaking"
let aiStatus = "offline";
let speakingTimer = null;
let wsClient = null;

// ─── Desktop Notifications ────────────────────────────────────────────────────
let notificationsEnabled = true;

// Cooldown map: eventType → last-fired timestamp (ms)
// Prevents notification spam for high-frequency events.
const NOTIFICATION_COOLDOWN_MS = 60_000;
const notifCooldowns = new Map();

function getSettingsPath() {
  return path.join(app.getPath("userData"), "settings.json");
}

function loadSettings() {
  try {
    const raw = fs.readFileSync(getSettingsPath(), "utf8");
    const data = JSON.parse(raw);
    if (typeof data.notificationsEnabled === "boolean") {
      notificationsEnabled = data.notificationsEnabled;
    }
  } catch {
    // No settings file yet — use defaults
  }
}

function saveSettings() {
  try {
    fs.writeFileSync(getSettingsPath(), JSON.stringify({ notificationsEnabled }), "utf8");
  } catch (err) {
    console.error("[deck-win] Failed to save settings:", err.message);
  }
}

function showNotification(cooldownKey, title, body) {
  if (!notificationsEnabled) return;
  if (!Notification.isSupported()) return;

  const now = Date.now();
  const lastFired = notifCooldowns.get(cooldownKey) ?? 0;
  if (now - lastFired < NOTIFICATION_COOLDOWN_MS) return;
  notifCooldowns.set(cooldownKey, now);

  const notif = new Notification({ title, body, silent: false });

  notif.on("click", () => {
    if (mainWindow) {
      if (!mainWindow.isVisible()) mainWindow.show();
      mainWindow.focus();
    }
  });

  notif.show();
}

function handleWsEventForNotification(msg) {
  const type = msg.type || msg.event;
  const payload = msg.payload ?? {};

  switch (type) {
    case "system.resource.alert": {
      const resource = payload.resource ?? "resource";
      const value = payload.value != null ? ` (${Math.round(payload.value)}%)` : "";
      showNotification(
        `system.resource.alert.${resource}`,
        "JARVIS — System Alert",
        `High ${resource} usage detected${value}. Check the System tab.`
      );
      break;
    }

    case "plugin.error": {
      const pluginId = payload.pluginId ?? payload.plugin ?? "plugin";
      showNotification(
        `plugin.error.${pluginId}`,
        "JARVIS — Plugin Error",
        `Plugin "${pluginId}" encountered an error.`
      );
      break;
    }

    case "notification.created": {
      const title = payload.title ?? "New Notification";
      const body = payload.body ?? payload.message ?? "";
      showNotification(
        `notification.created.${title}`,
        `JARVIS — ${title}`,
        body
      );
      break;
    }

    case "routine.completed": {
      const name = payload.name ?? payload.routineName ?? "Routine";
      showNotification(
        `routine.completed.${name}`,
        "JARVIS — Routine Complete",
        `"${name}" finished successfully.`
      );
      break;
    }

    case "system.error": {
      const message = payload.message ?? payload.error ?? "An unexpected system error occurred.";
      showNotification(
        "system.error",
        "JARVIS — System Error",
        message
      );
      break;
    }

    case "ai.inference_completed": {
      // Only notify when the window is hidden — not useful if user is looking at the chat
      if (mainWindow && !mainWindow.isVisible()) {
        showNotification(
          "ai.inference_completed",
          "JARVIS — Response Ready",
          payload.summary ?? "AI inference completed."
        );
      }
      break;
    }
  }
}

// ─── Tray icons (16×16 colored circles) ──────────────────────────────────────
// Each icon is a raw 16×16 RGBA bitmap passed to nativeImage.createFromBuffer.
// No extra image files are required.
function makeDotIcon(colorHex) {
  // Fill pixels inside a circle radius=6, centered in a 16×16 RGBA buffer
  const size = 16;
  const buf = Buffer.alloc(size * size * 4, 0);
  const r = parseInt(colorHex.slice(1, 3), 16);
  const g = parseInt(colorHex.slice(3, 5), 16);
  const b = parseInt(colorHex.slice(5, 7), 16);
  const cx = 7.5;
  const cy = 7.5;
  const radius = 6;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = x - cx;
      const dy = y - cy;
      if (dx * dx + dy * dy <= radius * radius) {
        const i = (y * size + x) * 4;
        buf[i] = r;
        buf[i + 1] = g;
        buf[i + 2] = b;
        buf[i + 3] = 255;
      }
    }
  }
  return nativeImage.createFromBuffer(buf, { width: size, height: size });
}

const ICONS = {
  offline: makeDotIcon("#555555"),
  online: makeDotIcon("#3f84f3"),
  speaking: makeDotIcon("#00e5ff"),
};

const STATUS_LABELS = {
  offline: "JARVIS — Offline",
  online: "JARVIS — Online",
  speaking: "JARVIS — Speaking",
};

// ─── Helpers ──────────────────────────────────────────────────────────────────
function getResourcePath(...parts) {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, ...parts);
  }
  return path.join(__dirname, "..", ...parts);
}

function waitForApi(port, timeoutMs) {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + timeoutMs;
    const check = () => {
      http
        .get(`http://127.0.0.1:${port}/api/health`, (res) => {
          if (res.statusCode < 500) {
            resolve();
          } else {
            retry();
          }
        })
        .on("error", retry);
    };
    const retry = () => {
      if (Date.now() > deadline) {
        reject(new Error("API server did not start in time"));
      } else {
        setTimeout(check, 400);
      }
    };
    check();
  });
}

function startApiServer() {
  const apiDist = getResourcePath("api-dist");
  const serverEntry = path.join(apiDist, "index.mjs");
  const frontendDist = getResourcePath("frontend-dist");

  apiProcess = spawn(process.execPath, [serverEntry], {
    env: {
      ...process.env,
      NODE_ENV: "production",
      PORT: String(API_PORT),
      ELECTRON_STATIC: "1",
      ELECTRON_FRONTEND_DIST: frontendDist,
    },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });

  apiProcess.stdout.on("data", (d) => process.stdout.write(d));
  apiProcess.stderr.on("data", (d) => process.stderr.write(d));
  apiProcess.on("exit", (code) => {
    console.log(`[deck-win] API process exited with code ${code}`);
    setAiStatus("offline");
  });
}

// ─── Tray ─────────────────────────────────────────────────────────────────────
function setAiStatus(status) {
  if (aiStatus === status) return;
  aiStatus = status;
  updateTray();
}

function updateTray() {
  if (!tray) return;
  tray.setImage(ICONS[aiStatus] || ICONS.offline);
  tray.setToolTip(STATUS_LABELS[aiStatus] || STATUS_LABELS.offline);
}

function buildTrayMenu() {
  const launchOnStartup = app.getLoginItemSettings().openAtLogin;

  return Menu.buildFromTemplate([
    {
      label: "Open Deck OS",
      click: () => {
        if (mainWindow) {
          mainWindow.show();
          mainWindow.focus();
        }
      },
    },
    { type: "separator" },
    {
      label: notificationsEnabled ? "Mute Desktop Notifications" : "Unmute Desktop Notifications",
      click: () => {
        notificationsEnabled = !notificationsEnabled;
        saveSettings();
        // Rebuild the tray menu to reflect the updated label
        tray.setContextMenu(buildTrayMenu());
        // Notify the renderer if it's listening
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send("notifications-enabled-changed", notificationsEnabled);
        }
      },
    },
    {
      label: launchOnStartup ? "Disable Launch at Login" : "Enable Launch at Login",
      click: () => {
        const next = !launchOnStartup;
        app.setLoginItemSettings({
          openAtLogin: next,
          args: next && process.platform === "win32" ? ["--startup"] : [],
        });
        tray.setContextMenu(buildTrayMenu());
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send("launch-on-startup-changed", next);
        }
      },
    },
    { type: "separator" },
    {
      label: "Quit",
      click: () => {
        app.isQuitting = true;
        app.quit();
      },
    },
  ]);
}

function createTray() {
  tray = new Tray(ICONS.offline);
  tray.setToolTip(STATUS_LABELS.offline);
  tray.setContextMenu(buildTrayMenu());

  tray.on("double-click", () => {
    if (mainWindow) {
      mainWindow.show();
      mainWindow.focus();
    }
  });
}

// ─── WebSocket AI status monitor ──────────────────────────────────────────────
function connectStatusWs() {
  const WebSocket = require("ws");

  const connect = () => {
    if (wsClient) return;
    const ws = new WebSocket(`ws://127.0.0.1:${API_PORT}/api/ws`);
    wsClient = ws;

    ws.on("open", () => {
      setAiStatus("online");
      console.log("[deck-win] Status WebSocket connected");
    });

    ws.on("message", (raw) => {
      let msg;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        return;
      }

      const type = msg.type || msg.event;

      if (type === "ai.chat.token" || type === "ai.tts.speaking") {
        // Mark speaking; auto-clear 3 s after last token
        setAiStatus("speaking");
        clearTimeout(speakingTimer);
        speakingTimer = setTimeout(() => setAiStatus("online"), 3000);
      } else if (type === "ai.inference_completed" || type === "ai.inference_started") {
        if (aiStatus !== "speaking") {
          setAiStatus("online");
        }
      } else if (type === "system.shutdown") {
        setAiStatus("offline");
      } else if (type === "system.boot" || type === "ws.connected") {
        setAiStatus("online");
      }

      // Desktop notifications for key events
      handleWsEventForNotification(msg);
    });

    ws.on("close", () => {
      wsClient = null;
      setAiStatus("offline");
      console.log("[deck-win] Status WebSocket closed — will retry in 5 s");
      setTimeout(connect, 5000);
    });

    ws.on("error", () => {
      ws.terminate();
    });
  };

  // Wait for API to be ready before first connect attempt
  setTimeout(connect, 1000);
}

// ─── Main window ──────────────────────────────────────────────────────────────
async function createWindow() {
  loadSettings();
  createTray();
  startApiServer();

  // When auto-launched at login (--startup) skip the splash entirely so the
  // app starts silently in the background without flashing any window.
  let splash = null;
  if (!startMinimized) {
    splash = new BrowserWindow({
      width: 480,
      height: 320,
      frame: false,
      transparent: true,
      resizable: false,
      alwaysOnTop: true,
      icon: path.join(__dirname, "build", "icon.png"),
      webPreferences: { nodeIntegration: false, contextIsolation: true },
    });

    splash.loadURL(
      "data:text/html,<html><body style='background:#000;display:flex;align-items:center;justify-content:center;height:100vh;margin:0'>" +
        "<img src='file://" +
        path.join(__dirname, "build", "icon.png").replace(/\\/g, "/") +
        "' style='width:220px;filter:drop-shadow(0 0 24px #3f84f3);animation:p 2s ease-in-out infinite' />" +
        "<style>@keyframes p{0%,100%{opacity:.6}50%{opacity:1}}</style></body></html>"
    );
  }

  try {
    await waitForApi(API_PORT, STARTUP_TIMEOUT_MS);
  } catch (err) {
    console.error("[deck-win]", err.message);
  }

  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 900,
    minHeight: 620,
    icon: path.join(__dirname, "build", "icon.png"),
    title: "Deck OS — JARVIS Command Center",
    backgroundColor: "#000000",
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    },
  });

  mainWindow.loadURL(`http://127.0.0.1:${API_PORT}/`);

  mainWindow.once("ready-to-show", () => {
    if (splash) splash.destroy();
    // When auto-launched (--startup) keep the window hidden so the app lives
    // silently in the tray; the user can open it from the tray or taskbar.
    if (!startMinimized) {
      mainWindow.show();
    }
    connectStatusWs();
    tray.setContextMenu(buildTrayMenu());
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });

  // Minimize to tray instead of closing
  mainWindow.on("close", (e) => {
    if (!app.isQuitting) {
      e.preventDefault();
      mainWindow.hide();
    }
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
    if (apiProcess) {
      apiProcess.kill();
      apiProcess = null;
    }
  });
}

// ─── App lifecycle ────────────────────────────────────────────────────────────
app.whenReady().then(createWindow);

app.on("window-all-closed", () => {
  // On macOS keep the app running in tray; on other platforms quit only when
  // the user explicitly chooses Quit from the tray menu (app.isQuitting = true).
  if (process.platform !== "darwin" && app.isQuitting) {
    if (apiProcess) apiProcess.kill();
    app.quit();
  }
});

app.on("activate", () => {
  if (mainWindow) {
    mainWindow.show();
    mainWindow.focus();
  } else {
    createWindow();
  }
});

app.on("before-quit", () => {
  app.isQuitting = true;
  if (wsClient) {
    wsClient.terminate();
    wsClient = null;
  }
  if (apiProcess) {
    apiProcess.kill();
    apiProcess = null;
  }
});

// ─── IPC ──────────────────────────────────────────────────────────────────────
ipcMain.handle("get-app-version", () => app.getVersion());
ipcMain.handle("get-ai-status", () => aiStatus);
ipcMain.handle("get-notifications-enabled", () => notificationsEnabled);
ipcMain.handle("set-notifications-enabled", (_event, enabled) => {
  notificationsEnabled = Boolean(enabled);
  saveSettings();
  tray.setContextMenu(buildTrayMenu());
  // Keep all renderer listeners in sync regardless of who triggered the change
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("notifications-enabled-changed", notificationsEnabled);
  }
  return notificationsEnabled;
});

ipcMain.handle("get-launch-on-startup", () => {
  return app.getLoginItemSettings().openAtLogin;
});

ipcMain.handle("set-launch-on-startup", (_event, enabled) => {
  const openAtLogin = Boolean(enabled);
  app.setLoginItemSettings({
    openAtLogin,
    // Pass --startup so the app can detect it was auto-launched and start hidden
    args: openAtLogin && process.platform === "win32" ? ["--startup"] : [],
  });
  tray.setContextMenu(buildTrayMenu());
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("launch-on-startup-changed", openAtLogin);
  }
  return openAtLogin;
});
