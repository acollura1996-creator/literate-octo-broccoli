// Electron main process: one secure window running the game.
//
// Security defaults: context isolation on, Node integration off, renderer sandbox on, no remote
// navigation or new windows, a strict Content Security Policy, and dev tools only when the app
// is not packaged. The packaged game is served from the custom `app://` protocol (not file://)
// so the CSP and relative asset URLs behave like a web origin.
import { app, BrowserWindow, Menu, ipcMain, net, protocol, session, shell } from 'electron';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const DEV_URL = process.env.VITE_DEV_SERVER_URL; // set by scripts/dev-electron.mjs
const log = (...a: unknown[]): void => {
  if (process.env.HE3D_DEBUG) console.log('[main]', ...a);
};
const DIST = path.join(__dirname, '..', 'dist');
const APP_ORIGIN = 'app://game';

// Until the Babylon renderer becomes the default (see MIGRATION.md), the desktop build opts in.
const START_QUERY = '?renderer=babylon';

protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } },
]);

const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' data: https://fonts.gstatic.com",
  "img-src 'self' data: blob:",
  "media-src 'self' data: blob:",
  "connect-src 'self' data: blob:",
  "worker-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'none'",
  "frame-ancestors 'none'",
].join('; ');

// The Vite dev server needs inline scripts and its HMR websocket.
const DEV_CSP = CSP.replace("script-src 'self'", "script-src 'self' 'unsafe-inline'").replace(
  "connect-src 'self' data: blob:",
  "connect-src 'self' data: blob: ws://localhost:* http://localhost:*",
);

function serveDist(): void {
  protocol.handle('app', async (request) => {
    const url = new URL(request.url);
    let rel = decodeURIComponent(url.pathname);
    if (rel === '/' || rel === '') rel = '/index.html';
    const file = path.normalize(path.join(DIST, rel));
    if (!file.startsWith(DIST)) return new Response('Forbidden', { status: 403 });
    const res = await net.fetch(pathToFileURL(file).toString());
    const headers = new Headers(res.headers);
    headers.set('Content-Security-Policy', CSP);
    return new Response(res.body, { status: res.status, headers });
  });
}

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1600,
    height: 900,
    minWidth: 1024,
    minHeight: 640,
    backgroundColor: '#000000',
    title: 'Heroes & Empires',
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      devTools: !app.isPackaged,
      spellcheck: false,
    },
  });
  win.once('ready-to-show', () => win.show());

  // No navigation away from the game and no pop-up windows.
  win.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith(APP_ORIGIN) && !(DEV_URL && url.startsWith(DEV_URL))) e.preventDefault();
  });
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) void shell.openExternal(url);
    return { action: 'deny' };
  });

  if (DEV_URL) void win.loadURL(`${DEV_URL}${START_QUERY}`);
  else void win.loadURL(`${APP_ORIGIN}/index.html${START_QUERY}`);
  return win;
}

// One window only: a second launch focuses the first.
if (!app.requestSingleInstanceLock()) {
  log('another instance is running');
  app.quit();
}

app.whenReady().then(() => {
  log('ready', app.isPackaged ? 'packaged' : 'unpacked', DEV_URL ?? 'app://');
  if (DEV_URL) {
    session.defaultSession.webRequest.onHeadersReceived((details, cb) => {
      cb({ responseHeaders: { ...details.responseHeaders, 'Content-Security-Policy': [DEV_CSP] } });
    });
  } else serveDist();

  // A minimal menu that only carries keyboard shortcuts (the bar itself stays hidden).
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      {
        label: 'Game',
        submenu: [
          { label: 'Toggle Fullscreen', accelerator: 'F11', click: (_i, w) => w?.setFullScreen(!w.isFullScreen()) },
          ...(app.isPackaged ? [] : [{ role: 'toggleDevTools' as const }, { role: 'reload' as const }]),
          { role: 'quit' as const },
        ],
      },
    ]),
  );

  ipcMain.handle('window:toggle-fullscreen', (e) => {
    const w = BrowserWindow.fromWebContents(e.sender);
    if (!w) return false;
    w.setFullScreen(!w.isFullScreen());
    return w.isFullScreen();
  });

  const win = createWindow();
  log('window created', win.id);
  win.webContents.on('did-finish-load', () => log('loaded', win.webContents.getURL()));
  win.webContents.on('did-fail-load', (_e, code, desc, url) => log('load failed', code, desc, url));
  // Development-only automated check: HE3D_SCREENSHOT=out.png captures the window after a delay,
  // prints the page's console messages, and quits (used to verify each migration milestone).
  const shotPath = process.env.HE3D_SCREENSHOT;
  if (shotPath && !app.isPackaged) {
    win.webContents.on('console-message', (event) => {
      const { level, message } = event as unknown as { level: string; message: string };
      console.log(`[renderer:${level}] ${message}`);
    });
    win.webContents.once('did-finish-load', () => {
      setTimeout(async () => {
        const info = await win.webContents.executeJavaScript(
          'JSON.stringify({ url: location.href, babylon: !!window.__babylon, desktop: typeof window.desktop, require: typeof window.require, process: typeof window.process })',
        );
        console.log('[check]', info);
        const img = await win.webContents.capturePage();
        writeFileSync(shotPath, img.toPNG());
        console.log('[check] screenshot', shotPath);
        app.quit();
      }, Number(process.env.HE3D_SCREENSHOT_DELAY ?? 5000));
    });
  }
  app.on('second-instance', () => {
    if (win.isMinimized()) win.restore();
    win.focus();
  });
});

app.on('window-all-closed', () => app.quit());
