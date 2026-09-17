import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";

createRoot(document.getElementById("root")!).render(<App />);

// Register the PWA service worker so Nobi is installable + offline-capable.
// BASE_URL resolves to the deploy base ("/mobile/" in production, "/" in dev),
// which also scopes the worker to just the mobile app.
if ("serviceWorker" in navigator) {
  const base = import.meta.env.BASE_URL || "/";
  window.addEventListener("load", () => {
    navigator.serviceWorker.register(`${base}sw.js`, { scope: base }).catch(() => {
      /* offline install is a progressive enhancement — ignore failures */
    });
  });
}
