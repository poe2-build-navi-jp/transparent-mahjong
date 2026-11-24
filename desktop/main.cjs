// 透明麻雀 PC版（Electron）。Steam 用のビルドで使う。
// - 画面は Web 版と同じもの（../dist を app/ にコピーして同梱）を app:// で読み込む
// - Steam クライアントが動いていれば steamworks.js で実績・認証チケットを使う
const { app, BrowserWindow, ipcMain, protocol, net, shell, Menu } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const { pathToFileURL } = require('node:url');

/** Steam の App ID。steam_appid.txt（開発用）か環境変数から読む。未設定なら Steam なしで起動 */
function steamAppId() {
  const env = Number(process.env.STEAM_APP_ID || 0);
  if (env) return env;
  for (const dir of [process.cwd(), path.dirname(process.execPath), __dirname]) {
    try {
      const n = Number(fs.readFileSync(path.join(dir, 'steam_appid.txt'), 'utf8').trim());
      if (n) return n;
    } catch { /* なし */ }
  }
  return 0;
}

let steam = null;
const appId = steamAppId();
if (appId) {
  try {
    const sw = require('steamworks.js');
    steam = sw.init(appId);
    // Steam オーバーレイ（Shift+Tab）を Electron の画面で使えるようにする
    sw.electronEnableSteamOverlay();
  } catch (e) {
    console.warn('Steam を初期化できませんでした:', e && e.message);
    steam = null;
  }
}

// app:// を通常の https と同じ扱いにする（localStorage・fetch・WebSocket が使える）
protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } },
]);

const ROOT = path.join(__dirname, 'app');

function createWindow() {
  const win = new BrowserWindow({
    width: 1600,
    height: 900,
    minWidth: 960,
    minHeight: 540,
    backgroundColor: '#04100f',
    title: '透明麻雀',
    icon: path.join(__dirname, 'build', 'icon.png'),
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  Menu.setApplicationMenu(null);
  // 外部リンク（クレジット・規約など）は既定のブラウザで開く
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith('app://')) { e.preventDefault(); if (/^https?:/.test(url)) void shell.openExternal(url); }
  });
  void win.loadURL('app://local/index.html');
  return win;
}

app.whenReady().then(() => {
  protocol.handle('app', (req) => {
    const { pathname } = new URL(req.url);
    let file = path.normalize(path.join(ROOT, decodeURIComponent(pathname)));
    // app/ の外は読ませない
    if (!file.startsWith(ROOT)) return new Response('forbidden', { status: 403 });
    if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(ROOT, 'index.html');
    return net.fetch(pathToFileURL(file).toString());
  });

  ipcMain.handle('fullscreen:set', (e, on) => { BrowserWindow.fromWebContents(e.sender)?.setFullScreen(!!on); });
  ipcMain.handle('fullscreen:get', (e) => !!BrowserWindow.fromWebContents(e.sender)?.isFullScreen());
  ipcMain.on('app:quit', () => app.quit());

  ipcMain.handle('steam:available', () => steam !== null);
  ipcMain.handle('steam:achievement', (_e, id) => {
    if (!steam || typeof id !== 'string' || !/^[A-Z0-9_]{1,64}$/.test(id)) return false;
    try { return steam.achievement.activate(id); } catch { return false; }
  });
  ipcMain.handle('steam:ticket', async () => {
    if (!steam) return null;
    try {
      // 対戦サーバーの Steam Web API 認証で使う（identity はサーバーと同じ文字列にする）
      const t = await steam.auth.getAuthTicketForWebApi('transparent-mahjong');
      return t.getBytes().toString('hex');
    } catch { return null; }
  });
  ipcMain.handle('steam:name', () => { try { return steam ? steam.localplayer.getName() : null; } catch { return null; } });
  // Steam クラウド（戦績・実績のバックアップ）
  ipcMain.handle('steam:cloud-read', (_e, name) => {
    if (!steam || !/^[a-z0-9_.-]{1,64}$/.test(String(name))) return null;
    try { return steam.cloud.isEnabledForApp() && steam.cloud.fileExists(name) ? steam.cloud.readFile(name) : null; } catch { return null; }
  });
  ipcMain.handle('steam:cloud-write', (_e, name, content) => {
    if (!steam || !/^[a-z0-9_.-]{1,64}$/.test(String(name)) || typeof content !== 'string' || content.length > 512 * 1024) return false;
    try { return steam.cloud.isEnabledForApp() ? steam.cloud.writeFile(name, content) : false; } catch { return false; }
  });
  ipcMain.handle('steam:language', () => { try { return steam ? steam.apps.currentGameLanguage() : null; } catch { return null; } });

  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

app.on('window-all-closed', () => app.quit());
