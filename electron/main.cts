import { ChildProcess, spawn } from 'child_process';
import * as fs from 'fs';
import * as http from 'http';
import * as net from 'net';
import * as path from 'path';
import { app, BrowserWindow, dialog, ipcMain, session, shell } from 'electron';

let mainWindow: BrowserWindow | null = null;
let serverProcess: ChildProcess | null = null;
let serverPort = 0;
let isQuitting = false;

app.setName('YT Music Converter');

const BOOT_T0 = Date.now();

function bootLog(stage: string): void {
  const line = `[boot +${Date.now() - BOOT_T0}ms] ${stage}`;
  console.log(line);
  try {
    const dir = app.getPath('userData');
    fs.mkdirSync(dir, { recursive: true });
    fs.appendFileSync(
      path.join(dir, 'boot-times.log'),
      `${new Date().toISOString()} ${line}\n`,
      'utf8'
    );
  } catch {}
}

const DEV_URL = process.env.ELECTRON_DEV_URL || '';
const isDev = !!DEV_URL && !app.isPackaged;

function devPort(): number {
  try {
    const parsed = new URL(DEV_URL);
    return parsed.port ? Number(parsed.port) : 3000;
  } catch {
    return 3000;
  }
}

function cspPolicy(): string {
  const ws = isDev ? ' ws://127.0.0.1:* ws://localhost:*' : '';
  return [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "font-src 'self' data:",
    "img-src 'self' data: https:",
    "media-src 'self' blob:",
    `connect-src 'self' http://127.0.0.1:* http://localhost:*${ws}`,
    'frame-src https://www.youtube-nocookie.com https://www.youtube.com',
    "object-src 'none'",
    "base-uri 'self'",
    "frame-ancestors 'none'",
  ].join('; ');
}

function registerCsp(): void {
  const policy = cspPolicy();
  const filter = { urls: ['http://127.0.0.1/*', 'http://localhost/*'] };
  session.defaultSession.webRequest.onHeadersReceived(filter, (details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [policy],
      },
    });
  });
}

function defaultLibraryDir(): string {
  const dir = path.join(app.getPath('downloads'), 'YT Music');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function serverEntry(): string {
  const candidates = app.isPackaged
    ? [
        path.join(process.resourcesPath, 'server.cjs'),
        path.join(app.getAppPath(), 'dist', 'server.cjs'),
      ]
    : [path.join(app.getAppPath(), 'dist', 'server.cjs')];

  return candidates.find(candidate => fs.existsSync(candidate)) ?? candidates[0];
}

function findFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.unref();
    probe.on('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const addr = probe.address();
      if (addr && typeof addr === 'object') {
        const port = addr.port;
        probe.close(() => resolve(port));
      } else {
        probe.close(() => reject(new Error('Could not find a free port')));
      }
    });
  });
}

function retryServerPoll(
  attempt: () => void,
  start: number,
  timeoutMs: number,
  reject: (err: Error) => void
): void {
  if (Date.now() - start > timeoutMs) {
    reject(new Error('Backend did not become ready within 30s.'));
    return;
  }
  setTimeout(attempt, 250);
}

function waitForServer(port: number, timeoutMs = 30000): Promise<void> {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const attempt = () => {
      if (serverProcess === null && !isDev) {
        reject(new Error('Backend process exited before becoming ready.'));
        return;
      }
      const req = http.get(
        {
          hostname: '127.0.0.1',
          port,
          path: '/api/health',
          family: 4,
          timeout: 2000,
        },
        res => {
          res.resume();
          if (res.statusCode === 200) {
            resolve();
          } else {
            retryServerPoll(attempt, start, timeoutMs, reject);
          }
        }
      );
      req.on('error', () => retryServerPoll(attempt, start, timeoutMs, reject));
      req.on('timeout', () => {
        req.destroy();
        retryServerPoll(attempt, start, timeoutMs, reject);
      });
    };
    attempt();
  });
}

async function startBackend(): Promise<number> {
  if (isDev) {
    const port = devPort();
    await waitForServer(port);
    serverPort = port;
    return port;
  }
  if (serverProcess) return serverPort;

  const port = await findFreePort();
  const entry = serverEntry();
  if (!fs.existsSync(entry)) {
    throw new Error(
      `Backend bundle missing. Expected one of: ${entry}. Run npm run electron:build first.`
    );
  }

  const env: Record<string, string> = {
    ...(process.env as Record<string, string>),
    ELECTRON_RUN_AS_NODE: '1',
    NODE_ENV: 'production',
    PORT: String(port),
    HOST: '127.0.0.1',
    APP_DATA_DIR: app.getPath('userData'),
    APP_STATIC_DIR: path.join(app.getAppPath(), 'dist'),
    APP_DOWNLOADS_DIR: defaultLibraryDir(),
  };

  serverProcess = spawn(process.execPath, [entry], {
    env,
    cwd: path.dirname(entry),
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  serverProcess.on('error', err => {
    console.error(`[backend] Failed to launch: ${err.message}`);
  });

  serverProcess.stdout?.on('data', (chunk: Buffer) => {
    const line = chunk.toString().trim();
    if (line) console.log(`[backend] ${line}`);
  });
  serverProcess.stderr?.on('data', (chunk: Buffer) => {
    const line = chunk.toString().trim();
    if (line) console.error(`[backend:err] ${line}`);
  });
  serverProcess.on('exit', (code, signal) => {
    console.log(`Backend exited with ${code === null ? `signal ${signal}` : `code ${code}`}`);
    serverProcess = null;
  });

  await waitForServer(port);
  serverPort = port;
  return port;
}

function stopBackend(): Promise<void> {
  return new Promise(resolve => {
    const child = serverProcess;
    if (!child) {
      resolve();
      return;
    }
    let done = false;
    let killTimer: ReturnType<typeof setTimeout>;
    const finish = () => {
      if (done) return;
      done = true;
      clearTimeout(killTimer);
      if (serverProcess === child) serverProcess = null;
      resolve();
    };
    child.once('exit', finish);
    const pid = child.pid;
    try {
      if (process.platform === 'win32' && pid) {
        spawn('taskkill', ['/T', '/F', '/PID', String(pid)], {
          stdio: 'ignore',
        });
      } else {
        child.kill('SIGTERM');
      }
    } catch {
      finish();
      return;
    }
    killTimer = setTimeout(() => {
      try {
        if (process.platform === 'win32' && pid) {
          spawn('taskkill', ['/T', '/F', '/PID', String(pid)], {
            stdio: 'ignore',
          });
        } else {
          child.kill('SIGKILL');
        }
      } catch {}
      finish();
    }, 5000);
  });
}

function splashFile(): string | undefined {
  const candidates = [
    path.join(app.getAppPath(), 'dist', 'splash.html'),
    path.join(app.getAppPath(), 'public', 'splash.html'),
    path.join(__dirname, '..', 'public', 'splash.html'),
  ];
  for (const candidate of candidates) {
    try {
      if (fs.existsSync(candidate)) return candidate;
    } catch {}
  }
  return undefined;
}

function configurePortableDataDir(): void {
  if (!app.isPackaged) return;
  const exeDir = process.env.PORTABLE_EXECUTABLE_DIR || path.dirname(process.execPath);
  if (!exeDir) return;
  const dir = path.join(exeDir, 'data');
  try {
    fs.mkdirSync(dir, { recursive: true });
    fs.accessSync(dir, fs.constants.W_OK);
    app.setPath('userData', dir);
  } catch {}
}

configurePortableDataDir();

function sendSplashStatus(text: string): void {
  try {
    mainWindow?.webContents.send('splash:status', text);
  } catch {}
}

function splashPainted(): Promise<void> {
  const win = mainWindow;
  if (!win || win.isDestroyed()) return Promise.resolve();
  return new Promise(resolve => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(finish, 5000);
    win.webContents.once('did-finish-load', () => {
      bootLog('splash painted');
      finish();
    });
  });
}

function windowIcon(): string | undefined {
  const candidates = [
    path.join(app.getAppPath(), 'assets', 'icon.png'),
    path.join(__dirname, '..', 'assets', 'icon.png'),
  ];
  for (const candidate of candidates) {
    try {
      if (fs.existsSync(candidate)) return candidate;
    } catch {}
  }
  return undefined;
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: '#0B0B12',
    show: true,
    autoHideMenuBar: true,
    icon: windowIcon(),
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) {
      void shell.openExternal(url);
    }
    return { action: 'deny' };
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  const splash = splashFile();
  bootLog(splash ? `splash-file ${splash}` : 'splash-file missing');
  if (splash) {
    let version = '';
    try {
      version = app.getVersion();
    } catch {}
    void mainWindow.loadFile(splash, version ? { query: { v: version } } : undefined);
  }
}

function showApp(port: number): void {
  if (!mainWindow || mainWindow.isDestroyed()) {
    createWindow();
  }
  const win = mainWindow;
  if (!win || win.isDestroyed()) return;
  const target = isDev ? DEV_URL : `http://127.0.0.1:${port}`;
  if (isDev) {
    win.webContents.openDevTools({ mode: 'detach' });
  }
  win.webContents.once('did-finish-load', () => {
    bootLog('app painted');
    console.log(`[window] loaded ${target}`);
  });
  win.webContents.once('did-fail-load', (_event, errorCode, errorDescription, validatedURL) => {
    console.error(`[window] failed to load ${validatedURL}: ${errorDescription} (${errorCode})`);
  });
  void win.loadURL(target);
}

function focusWindow(): void {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.focus();
}

function registerIpc(): void {
  ipcMain.handle('desktop:get-downloads-default', () => defaultLibraryDir());

  ipcMain.handle('desktop:pick-folder', async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openDirectory', 'createDirectory'],
      defaultPath: defaultLibraryDir(),
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    return result.filePaths[0];
  });

  ipcMain.handle('desktop:reveal', async (_event, absolutePath: string) => {
    if (typeof absolutePath !== 'string' || !absolutePath) return;
    const resolved = path.resolve(absolutePath);
    if (!fs.existsSync(resolved)) return;
    shell.showItemInFolder(resolved);
  });

  ipcMain.handle('desktop:open-file', async (_event, absolutePath: string) => {
    if (typeof absolutePath !== 'string' || !absolutePath) return;
    const resolved = path.resolve(absolutePath);
    if (!fs.existsSync(resolved)) return;
    const err = await shell.openPath(resolved);
    if (err) console.error(`openPath failed: ${err}`);
  });

  ipcMain.handle('desktop:get-backend-port', () => (serverPort > 0 ? serverPort : null));

  ipcMain.handle('desktop:get-app-version', () => app.getVersion());
}

async function boot(): Promise<void> {
  bootLog('whenReady');
  try {
    const payload = fs.statSync(app.getAppPath());
    bootLog(
      `payload-birthtime ${payload.birthtime.toISOString()} portable=${process.env.PORTABLE_EXECUTABLE_DIR ? 'yes' : 'no'}`
    );
  } catch {}
  createWindow();
  bootLog('window created');
  registerIpc();
  registerCsp();
  sendSplashStatus('Starting backend…');
  try {
    await splashPainted();
    sendSplashStatus('Probing engine…');
    const port = await startBackend();
    bootLog('backend ready');
    sendSplashStatus('Loading library…');
    showApp(port);
  } catch (err) {
    console.error('Failed to start:', err);
    sendSplashStatus(`Startup failed: ${err instanceof Error ? err.message : String(err)}`);
    app.quit();
  }
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', focusWindow);

  void app.whenReady().then(() => boot());

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      if (isDev || serverPort > 0) {
        showApp(isDev ? devPort() : serverPort);
      } else {
        void boot();
      }
    }
  });

  app.on('window-all-closed', () => {
    app.quit();
  });

  app.on('before-quit', event => {
    if (isQuitting || !serverProcess) return;
    isQuitting = true;
    event.preventDefault();
    void stopBackend().then(() => app.quit());
  });
}

process.on('SIGINT', () => {
  void stopBackend().then(() => process.exit(0));
});
process.on('SIGTERM', () => {
  void stopBackend().then(() => process.exit(0));
});
