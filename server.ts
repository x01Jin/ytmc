import "dotenv/config";
import { spawn } from "child_process";
import crypto from "crypto";
import express from "express";
import fs from "fs";
import path from "path";
import {
  BGUTIL_PATH,
  HOST,
  PORT,
  POT_PORT,
  STATIC_DIR,
} from "./server/config.js";
import { apiRouter } from "./server/routes/api.js";
import { FileService } from "./server/services/fileService.js";
import { refreshSidecarReachability } from "./server/services/potService.js";
import { ensureYtDlp, ensureFfmpeg } from "./server/services/ytdlpRunner.js";

/** Per-process token that mutating same-origin API calls must echo back. */
export const LOOPBACK_TOKEN = crypto.randomUUID();

let potProcess: any = null;

function startPotServer(): void {
  if (fs.existsSync(BGUTIL_PATH)) {
    try {
      potProcess = spawn(
        BGUTIL_PATH,
        ["server", "-p", String(POT_PORT), "--host", "127.0.0.1"],
        {
          detached: false,
          stdio: "ignore",
        },
      );
      potProcess.on("error", (err: any) => {
        console.warn("POT sidecar process error:", err.message);
      });
      console.log(
        `Background POT sidecar server started on 127.0.0.1:${POT_PORT}`,
      );
      void refreshSidecarReachability().then((ok) => {
        console.log(
          ok
            ? `POT sidecar reachable on 127.0.0.1:${POT_PORT}`
            : `WARNING: POT sidecar spawned but not reachable on 127.0.0.1:${POT_PORT}; extractions will use the no-POT fallback.`,
        );
      });
    } catch (err: any) {
      console.warn("Could not launch POT server:", err.message);
    }
  } else {
    console.warn(
      `POT sidecar binary not found at ${BGUTIL_PATH}; extractions will use the no-POT player-client fallback. ` +
        `See docs/session-authentication.md to install it for strictly-checked uploads.`,
    );
  }
}

function isLoopbackHostname(hostname: string): boolean {
  const host = hostname.split(":")[0].toLowerCase();
  return (
    host === "127.0.0.1" ||
    host === "localhost" ||
    host === "::1" ||
    host === "[::1]" ||
    host === ""
  );
}

export interface StartedServer {
  port: number;
  close: () => Promise<void>;
}

export async function startServer(): Promise<StartedServer> {
  // Start POT server sidecar
  startPotServer();
  // Probe the yt-dlp launch chain once so failures are loud at boot
  await ensureYtDlp();
  await ensureFfmpeg();
  void refreshSidecarReachability();
  FileService.sweepPartFiles();

  const app = express();

  // Loopback guard: refuse requests that arrived via a non-loopback Host
  // header (DNS-rebinding defense for the desktop sidecar).
  app.use((req, res, next) => {
    const host = req.headers.host ?? "";
    if (!isLoopbackHostname(host)) {
      res
        .status(403)
        .json({ success: false, error: "Forbidden: loopback only" });
      return;
    }
    next();
  });

  // Middleware for parsing JSON and form payloads
  app.use(express.json({ limit: "10mb" }));
  app.use(express.urlencoded({ extended: true, limit: "10mb" }));

  // Token check for mutating API calls. The renderer fetches the token
  // from /api/health (same-origin) and echoes it back. GET stays open.
  app.use("/api", (req, res, next) => {
    if (req.method === "GET" || req.path === "/health") {
      next();
      return;
    }
    if (req.headers["x-loopback-token"] !== LOOPBACK_TOKEN) {
      res
        .status(403)
        .json({ success: false, error: "Missing or invalid loopback token" });
      return;
    }
    next();
  });

  // Mount API routes first
  app.use("/api", apiRouter);

  // Health check endpoint (also publishes the loopback token + readiness)
  app.get("/api/health", (req, res) => {
    res.json({
      status: "ok",
      time: new Date().toISOString(),
      loopbackToken: LOOPBACK_TOKEN,
    });
  });

  // Vite development middleware or production static serving.
  if (process.env.NODE_ENV !== "production") {
    const { createServer: createViteServer } = await import("vite");
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        hmr: false,
      },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = STATIC_DIR;
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  return new Promise<StartedServer>((resolve, reject) => {
    const server = app.listen(PORT, HOST, () => {
      const addr = server.address();
      const actualPort = typeof addr === "object" && addr ? addr.port : PORT;
      console.log(
        `YouTube to Music Converter server running on http://${HOST}:${actualPort}`,
      );
      // Machine-readable line for the Electron sidecar host.
      console.log(`PORT_READY=${actualPort}`);
      resolve({
        port: actualPort,
        close: () =>
          new Promise<void>((done) => {
            try {
              potProcess?.kill();
            } catch {}
            server.close(() => done());
          }),
      });
    });

    server.on("error", (err: any) => {
      if (err?.code === "EADDRINUSE") {
        console.error(
          `Port ${PORT} on ${HOST} is already in use. Stop the other server (Ctrl+C) ` +
            `or retry with a different port, e.g. PORT=3100 npm run dev`,
        );
      } else {
        console.error("Server error:", err);
      }
      reject(err);
    });
  });
}

const cleanup = () => {
  if (potProcess) {
    try {
      potProcess.kill();
    } catch {}
  }
  process.exit(0);
};

process.on("SIGINT", cleanup);
process.on("SIGTERM", cleanup);

// Auto-start when run as a process (dev CLI or Electron sidecar child).
// Importers (tests, future in-process hosts) set NO_AUTO_START=1.
if (process.env.NO_AUTO_START !== "1") {
  startServer().catch((err) => {
    console.error("Failed to start server:", err);
    process.exit(1);
  });
}
