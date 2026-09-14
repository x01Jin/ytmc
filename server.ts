import 'dotenv/config';
import { spawn } from 'child_process';
import express from 'express';
import fs from 'fs';
import path from 'path';
import { BGUTIL_PATH, HOST, PORT } from './server/config.js';
import { apiRouter } from './server/routes/api.js';

let potProcess: any = null;

function startPotServer(): void {
  if (fs.existsSync(BGUTIL_PATH)) {
    try {
      potProcess = spawn(BGUTIL_PATH, ['server', '-p', '4416', '--host', '127.0.0.1'], {
        detached: false,
        stdio: 'ignore'
      });
      potProcess.on('error', (err: any) => {
        console.warn('POT sidecar process error:', err.message);
      });
      console.log('Background POT sidecar server started on 127.0.0.1:4416');
    } catch (err: any) {
      console.warn('Could not launch POT server:', err.message);
    }
  }
}

async function startServer() {
  // Start POT server sidecar
  startPotServer();

  const app = express();

  // Middleware for parsing JSON and form payloads
  app.use(express.json({ limit: '10mb' }));
  app.use(express.urlencoded({ extended: true, limit: '10mb' }));

  // Mount API routes first
  app.use('/api', apiRouter);

  // Health check endpoint
  app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', time: new Date().toISOString() });
  });

  // Vite development middleware or production static serving.
  // NOTE: vite is dynamically imported so production bundles never
  // initialize Vite (or its WebSocket server) at runtime.
  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        hmr: false,
      },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  const server = app.listen(PORT, HOST, () => {
    const addr = server.address();
    const actualPort = typeof addr === 'object' && addr ? addr.port : PORT;
    console.log(`YouTube to Music Converter server running on http://${HOST}:${actualPort}`);
  });

  server.on('error', (err: any) => {
    if (err?.code === 'EADDRINUSE') {
      console.error(
        `Port ${PORT} on ${HOST} is already in use. Stop the other server (Ctrl+C) ` +
        `or retry with a different port, e.g. PORT=3100 npm run dev`
      );
      process.exit(1);
    }
    console.error('Server error:', err);
    process.exit(1);
  });

  const cleanup = () => {
    if (potProcess) {
      try {
        potProcess.kill();
      } catch {}
    }
    server.close();
    process.exit(0);
  };

  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
