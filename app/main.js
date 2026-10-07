// Relay desktop (Windows): floating edge dock + panel, settings, hotkeys, push-to-talk, screenshots, phone access, tray.
const { app, BrowserWindow, screen, ipcMain, globalShortcut, Tray, Menu, nativeImage, desktopCapturer, shell, Notification } = require('electron');
const path = require('path');
const os = require('os');
const fs = require('fs');
const { spawn, execFile } = require('child_process');
const { startHub, loadConfig, saveConfig } = require('./hub');

if (!app.requestSingleInstanceLock()) app.quit();
app.setAppUserModelId('app.relay.desktop');

const DEFAULTS = {
  side: 'right', display: 'primary', offset: 0,
  undoMs: 2500, notifications: true, sounds: true, hidePanelOnBlur: true,
  hotkeys: { answer: 'Control+Alt+K', talk: 'Control+Alt+Space', list: 'Control+Alt+O' },
  doubleAltTalk: true, autoSendVoice: true,
  lan: false, tunnel: false, port: 7777,
};
const DOCK_W = 56;
const PANEL_W = 400, PANEL_H = 560;

let hub, dock, panel, tray, cfg, tunnel = { proc: null, url: '', state: 'off', error: '' };
let talking = null, lastSid = null, uio = null;

const merge = (a, b) => ({ ...a, ...b, hotkeys: { ...a.hotkeys, ...(b.hotkeys || {}) } });
const base = (p) => `http://127.0.0.1:${hub.port}${p}${p.includes('?') ? '&' : '?'}token=${hub.token}`;

// ---------------------------------------------------------------- placement
function targetDisplay() {
  const all = screen.getAllDisplays();
  if (cfg.display === 'primary') return screen.getPrimaryDisplay();
  if (cfg.display === 'cursor') return screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  return all.find((d) => String(d.id) === String(cfg.display)) || screen.getPrimaryDisplay();
}
let dockH = 240;
function placeDock() {
  const wa = targetDisplay().workArea;
  const x = cfg.side === 'left' ? wa.x : wa.x + wa.width - DOCK_W;
  const y = Math.round(wa.y + wa.height / 2 - dockH / 2 + (cfg.offset || 0));
  dock.setBounds({ x, y: Math.max(wa.y, Math.min(y, wa.y + wa.height - dockH)), width: DOCK_W, height: dockH });
}
function placePanel() {
  const d = dock.getBounds();
  const wa = targetDisplay().workArea;
  const y = Math.max(wa.y + 8, Math.min(d.y + d.height / 2 - PANEL_H / 2, wa.y + wa.height - PANEL_H - 8));
  const x = cfg.side === 'left' ? d.x + d.width + 6 : d.x - PANEL_W - 6;
  panel.setBounds({ x, y: Math.round(y), width: PANEL_W, height: PANEL_H });
}

// rounded rectangles as a stack of rects, so the dock is floating pills (no transparency needed)
function roundRects(x, y, w, h, r) {
  r = Math.min(r, Math.floor(w / 2), Math.floor(h / 2));
  const out = [];
  for (let i = 0; i < r; i++) {
    const dy = r - i - 0.5;
    const inset = Math.ceil(r - Math.sqrt(r * r - dy * dy));
    out.push({ x: x + inset, y: y + i, width: w - inset * 2, height: 1 });
    out.push({ x: x + inset, y: y + h - 1 - i, width: w - inset * 2, height: 1 });
  }
  out.push({ x, y: y + r, width: w, height: h - 2 * r });
  return out;
}
function shapeWin(win, pills) {
  if (process.platform !== 'win32' && process.platform !== 'linux') return;
  try { win.setShape(pills.flatMap((p) => roundRects(Math.round(p.x), Math.round(p.y), Math.round(p.w), Math.round(p.h), Math.round(p.r)))); } catch {}
}

// ---------------------------------------------------------------- windows
function createDock() {
  dock = new BrowserWindow({
    width: DOCK_W, height: dockH, frame: false, transparent: false, backgroundColor: '#0d0d0d',
    resizable: false, movable: false, minimizable: false, maximizable: false, skipTaskbar: true, alwaysOnTop: true,
    hasShadow: false, focusable: true, show: false, thickFrame: false,
    webPreferences: { preload: path.join(__dirname, 'preload.js') },
  });
  dock.setAlwaysOnTop(true, 'screen-saver');
  dock.setVisibleOnAllWorkspaces(true);
  dock.loadURL(base('/dock?desktop=1'));
  dock.once('ready-to-show', () => { placeDock(); dock.showInactive(); });
}
function createPanel() {
  panel = new BrowserWindow({
    width: PANEL_W, height: PANEL_H, frame: false, transparent: false, backgroundColor: '#141414',
    resizable: false, minimizable: false, maximizable: false, skipTaskbar: true, alwaysOnTop: true, show: false, hasShadow: true, thickFrame: false,
    webPreferences: { preload: path.join(__dirname, 'preload.js') },
  });
  panel.setAlwaysOnTop(true, 'pop-up-menu');
  panel.loadURL(base('/?desktop=1'));
  panel.webContents.once('did-finish-load', () => shapeWin(panel, [{ x: 0, y: 0, w: PANEL_W, h: PANEL_H, r: 16 }]));
  panel.on('blur', () => { if (cfg.hidePanelOnBlur && !talking && !panel.webContents.isDevToolsOpened()) panel.hide(); });
}
function openPanel(view = 'list', sid = null) {
  placePanel();
  panel.show(); panel.focus();
  panel.webContents.send('open', { view, sid });
}
function togglePanel(view, sid) { panel.isVisible() && !sid ? panel.hide() : openPanel(view, sid); }
const topNeed = () => { const n = hub.needsYou(); return n.length ? n[0].id : null; };

// ---------------------------------------------------------------- push to talk (offline Windows speech)
const PS_DICTATE = `
Add-Type -AssemblyName System.Speech
$r = New-Object System.Speech.Recognition.SpeechRecognitionEngine
$r.LoadGrammar((New-Object System.Speech.Recognition.DictationGrammar))
$r.SetInputToDefaultAudioDevice()
while ($true) { $res = $r.Recognize([TimeSpan]::FromSeconds(30)); if ($res) { [Console]::Out.WriteLine($res.Text); [Console]::Out.Flush() } }
`;
function talkStart(sid) {
  if (talking) return;
  sid = sid || topNeed() || lastSid;
  openPanel(sid ? 'detail' : 'list', sid);
  const p = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', PS_DICTATE], { windowsHide: true });
  talking = { p, text: '' };
  const send = (d) => { panel.webContents.send('dictation', d); dock.webContents.send('dictation', d); };
  send({ state: 'listening', text: '' });
  p.stdout.on('data', (d) => { if (!talking) return; talking.text += (talking.text ? ' ' : '') + d.toString().trim(); send({ state: 'listening', text: talking.text }); });
  p.on('error', () => send({ state: 'error', text: '' }));
  talking.send = send;
}
function talkStop() {
  if (!talking) return;
  const t = talking;
  setTimeout(() => { try { t.p.kill(); } catch {} talking = null; t.send({ state: 'done', text: t.text, autoSend: cfg.autoSendVoice }); }, 900);
}
function setupDoubleAlt() {
  if (uio || !cfg.doubleAltTalk) return;
  try { uio = require('uiohook-napi'); } catch { return; }
  const { uIOhook, UiohookKey } = uio;
  const ALT = new Set([UiohookKey.Alt, UiohookKey.AltRight]);
  let down = false, lastUp = 0, armed = false, other = false;
  uIOhook.on('keydown', (e) => {
    if (!cfg.doubleAltTalk) return;
    if (!ALT.has(e.keycode)) { other = true; return; }
    if (down) return;
    down = true; other = false;
    if (Date.now() - lastUp < 350) { armed = true; talkStart(); }
  });
  uIOhook.on('keyup', (e) => {
    if (!ALT.has(e.keycode)) return;
    down = false;
    if (armed) { armed = false; talkStop(); lastUp = 0; return; }
    lastUp = other ? 0 : Date.now();
  });
  uIOhook.start();
}

// ---------------------------------------------------------------- hotkeys
function registerHotkeys() {
  globalShortcut.unregisterAll();
  const res = {};
  const reg = (k, fn) => { if (!k) return; try { res[k] = globalShortcut.register(k, fn); } catch { res[k] = false; } };
  reg(cfg.hotkeys.answer, () => { const sid = topNeed(); sid ? openPanel('detail', sid) : togglePanel('inbox'); });
  reg(cfg.hotkeys.talk, () => (talking ? talkStop() : talkStart()));
  reg(cfg.hotkeys.list, () => togglePanel('list'));
  return res;
}

// ---------------------------------------------------------------- phone from anywhere (Cloudflare quick tunnel)
function findCloudflared() {
  const c = ['C:\\Program Files (x86)\\cloudflared\\cloudflared.exe', 'C:\\Program Files\\cloudflared\\cloudflared.exe', path.join(os.homedir(), '.relay', 'cloudflared.exe')];
  return c.find((p) => fs.existsSync(p)) || 'cloudflared';
}
function tunnelStart() {
  if (tunnel.proc) return;
  tunnel = { proc: null, url: '', state: 'starting', error: '' };
  const p = spawn(findCloudflared(), ['tunnel', '--no-autoupdate', '--url', `http://127.0.0.1:${hub.port}`], { windowsHide: true });
  tunnel.proc = p;
  const scan = (d) => {
    const m = d.toString().match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
    if (m && !tunnel.url) { tunnel.url = m[0]; tunnel.state = 'on'; pushInfo(); }
  };
  p.stdout.on('data', scan); p.stderr.on('data', scan);
  p.on('error', (e) => { tunnel = { proc: null, url: '', state: 'error', error: 'cloudflared not found. Install it: winget install Cloudflare.cloudflared' }; pushInfo(); });
  p.on('exit', () => { if (tunnel.proc === p) { tunnel = { ...tunnel, proc: null, state: cfg.tunnel ? 'error' : 'off', url: '' }; pushInfo(); } });
}
function tunnelStop() { if (tunnel.proc) { const p = tunnel.proc; tunnel.proc = null; try { p.kill(); } catch {} } tunnel = { proc: null, url: '', state: 'off', error: '' }; }
const lanIps = () => Object.values(os.networkInterfaces()).flat().filter((i) => i && i.family === 'IPv4' && !i.internal && !/^169\.254/.test(i.address)).map((i) => i.address);
function info() {
  return {
    cfg, token: hub.token, port: hub.port, ips: lanIps(), version: app.getVersion(),
    openAtLogin: app.getLoginItemSettings().openAtLogin,
    displays: screen.getAllDisplays().map((d, i) => ({ id: String(d.id), label: `${d.label || 'Display ' + (i + 1)} (${d.size.width}×${d.size.height})${d.id === screen.getPrimaryDisplay().id ? ' · main' : ''}` })),
    tunnel: { state: tunnel.state, url: tunnel.url ? `${tunnel.url}/?token=${hub.token}` : '', error: tunnel.error },
    hooks: hookStatus(),
  };
}
const pushInfo = () => { if (panel && !panel.isDestroyed()) panel.webContents.send('info', info()); };
function hookStatus() {
  const r = { claude: false, codex: false };
  try { r.claude = fs.readFileSync(path.join(os.homedir(), '.claude', 'settings.json'), 'utf8').includes(' hook claude'); } catch {}
  try { r.codex = /"hook", "codex"/.test(fs.readFileSync(path.join(os.homedir(), '.codex', 'config.toml'), 'utf8')); } catch {}
  return r;
}

// ---------------------------------------------------------------- settings
function applySettings(patch) {
  const before = cfg;
  cfg = merge(cfg, patch);
  saveConfig(cfg);
  if (patch.undoMs) hub.setUndo(cfg.undoMs);
  if ('openAtLogin' in patch) app.setLoginItemSettings({ openAtLogin: !!patch.openAtLogin });
  if (patch.hotkeys) registerHotkeys();
  if ('doubleAltTalk' in patch && cfg.doubleAltTalk) setupDoubleAlt();
  if ('side' in patch || 'display' in patch || 'offset' in patch) { placeDock(); if (panel.isVisible()) placePanel(); }
  if ('tunnel' in patch) (cfg.tunnel ? tunnelStart() : tunnelStop());
  if ('lan' in patch && before.lan !== cfg.lan) { app.relaunch(); app.exit(0); return; }
  pushInfo();
  dock.webContents.send('cfg', cfg);
}

// ---------------------------------------------------------------- IPC
ipcMain.on('toggle', (_e, a = {}) => togglePanel(a.view, a.sid));
ipcMain.on('open', (_e, a = {}) => openPanel(a.view, a.sid));
ipcMain.on('hide', () => panel.hide());
ipcMain.on('focus-sid', (_e, sid) => { lastSid = sid; });
ipcMain.on('dock-layout', (_e, { h, pills }) => {
  dockH = Math.max(80, Math.round(h));
  placeDock();
  shapeWin(dock, pills);
});
ipcMain.on('talk', (_e, on) => (on ? talkStart(lastSid) : talkStop()));
ipcMain.handle('screenshot', async () => {
  panel.hide(); await new Promise((r) => setTimeout(r, 250));
  const d = targetDisplay();
  const sz = { width: Math.round(d.size.width * d.scaleFactor), height: Math.round(d.size.height * d.scaleFactor) };
  const srcs = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: sz });
  const src = srcs.find((s) => s.display_id === String(d.id)) || srcs[0];
  const dir = path.join(os.tmpdir(), 'relay-shots'); fs.mkdirSync(dir, { recursive: true });
  const f = path.join(dir, `shot-${Date.now()}.png`);
  fs.writeFileSync(f, src.thumbnail.toPNG());
  openPanel(lastSid ? 'detail' : 'list', lastSid);
  return f;
});
ipcMain.handle('info', () => info());
ipcMain.handle('set', (_e, patch) => { applySettings(patch); return info(); });
ipcMain.handle('check-hotkey', (_e, k) => { try { const ok = globalShortcut.isRegistered(k) || (globalShortcut.register(k, () => {}) && (globalShortcut.unregister(k), true)); return ok; } catch { return false; } });
ipcMain.handle('install-hooks', () => new Promise((res) => {
  const cliDir = app.isPackaged ? path.join(process.resourcesPath, 'cli') : path.join(__dirname, '..', 'cli');
  execFile(process.execPath, [path.join(cliDir, 'relay.js'), 'install'], { env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' } },
    (err, out, errOut) => { res((out || '') + (errOut || '') + (err ? '\n' + err.message : '')); pushInfo(); });
}));
ipcMain.on('open-external', (_e, u) => shell.openExternal(u));
ipcMain.on('quit', () => app.quit());

// ---------------------------------------------------------------- notifications
const notified = new Set();
function watchNeeds(list) {
  for (const s of list) {
    const need = s.status === 'question' || s.status === 'waiting';
    if (need && s.unread && !notified.has(s.id) && !panel.isVisible() && cfg.notifications && Notification.isSupported()) {
      notified.add(s.id);
      const q = s.question && s.question.items[s.question.index];
      const n = new Notification({ title: s.title || s.project || s.agent, body: q ? q.text : (s.note || 'Waiting for you'), silent: !cfg.sounds });
      n.on('click', () => openPanel('detail', s.id));
      n.show();
    }
    if (!need) notified.delete(s.id);
  }
}

// ---------------------------------------------------------------- boot
app.whenReady().then(() => {
  cfg = merge(DEFAULTS, loadConfig());
  hub = startHub({ port: cfg.port, lan: !!cfg.lan, uiDir: path.join(__dirname, 'ui'), undoMs: cfg.undoMs });
  hub.onChange(watchNeeds);
  createDock(); createPanel();
  registerHotkeys();
  setupDoubleAlt();
  if (cfg.tunnel) tunnelStart();

  const icon = nativeImage.createFromPath(path.join(__dirname, 'ui', 'icon.png'));
  tray = new Tray(icon.isEmpty() ? nativeImage.createEmpty() : icon.resize({ width: 16, height: 16 }));
  tray.setToolTip('Relay');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Open Relay', click: () => openPanel('list') },
    { label: 'Inbox', click: () => openPanel('inbox') },
    { label: 'Settings', click: () => openPanel('settings') },
    { label: 'Show / hide dock', click: () => (dock.isVisible() ? dock.hide() : dock.showInactive()) },
    { type: 'separator' },
    { label: 'Quit Relay', click: () => app.quit() },
  ]));
  tray.on('click', () => togglePanel('list'));
  screen.on('display-metrics-changed', placeDock);
  screen.on('display-added', placeDock);
  screen.on('display-removed', placeDock);
});
app.on('second-instance', () => openPanel('list'));
app.on('will-quit', () => { globalShortcut.unregisterAll(); tunnelStop(); try { uio && uio.uIOhook.stop(); } catch {} });
app.on('window-all-closed', (e) => e.preventDefault());
