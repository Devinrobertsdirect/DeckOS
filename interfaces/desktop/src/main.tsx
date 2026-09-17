import { createRoot } from "react-dom/client";
import App from "./App";
import { initScreenMode } from "./lib/screenMode";
import "./index.css";

initScreenMode();
createRoot(document.getElementById("root")!).render(<App />);
