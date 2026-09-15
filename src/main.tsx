import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";

// Prevent benign Vite HMR websocket reconnection noise in sandboxed containers
if (typeof window !== "undefined") {
  window.addEventListener("unhandledrejection", (event) => {
    const msg = (
      event.reason?.message || String(event.reason || "")
    ).toLowerCase();
    if (
      msg.includes("websocket") ||
      msg.includes("ws") ||
      msg.includes("vite")
    ) {
      event.preventDefault();
    }
  });

  window.addEventListener("error", (event) => {
    const msg = (event.message || "").toLowerCase();
    if (msg.includes("websocket") || msg.includes("vite")) {
      event.preventDefault();
    }
  });
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
