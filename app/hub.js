// Relay hub: tracks every agent session, receives hook events, relays answers back into the agent's terminal.
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { WebSocketServer } = require('ws');

const HOME = path.join(os.homedir(), '.relay');
let UNDO_MS = 2500;
const IDLE_MS = 6000;

function loadToken() {
  fs.mkdirSync(HOME, { recursive: true });
  const f = path.join(HOME, 'token');
  if (!fs.existsSync(f)) fs.writeFileSync(f, crypto.randomBytes(18).toString('hex'));
  return fs.readFileSync(f, 'utf8').trim();
}

function loadConfig() {
  try { return JSON.parse(fs.readFileSync(path.join(HOME, 'config.json'), 'utf8')); } catch { return {}; }
}
function saveConfig(c) {
  fs.mkdirSync(HOME, { recursive: true });
  fs.writeFileSync(path.join(HOME, 'config.json'), JSON.stringify(c, null, 2));
}

const strip = (s) => s
  .replace(/\x1b\[(\d*)C/g, (_, n) => ' '.repeat(Math.min(+n || 1, 200)))
  .replace(/\x1b\[\d*;?\d*H/g, '\n')
  .replace(/\x1b\][^\x07]*(\x07|\x1b\\)/g, '')
  .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '')
  .replace(/\x1b[()][0-9A-Za-z]/g, '')
  .replace(/\x1b[=>78]/g, '')
  .replace(/[\x00-\x08\x0b-\x1f\x7f]/g, '');

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json' };

const short = (t) => { t = String(t || '').replace(/\s+/g, ' ').trim(); return t.length > 48 ? t.slice(0, 46).trimEnd() + '…' : t; };

function startHub({ port = 7777, lan = false, uiDir = path.join(__dirname, 'ui'), undoMs } = {}) {
  if (undoMs) UNDO_MS = undoMs;
  const token = loadToken();
  const sessions = new Map();   // id -> session
  const agents = new Map();     // id -> ws (live terminal channel)
  const uis = new Set();
  const timers = new Map();     // pending answer timers
  const listeners = new Set();

  const now = () => Date.now();
  const pub = (s) => {
    const { tail, ...rest } = s;
    return { ...rest, tail: (tail || '').slice(-1200), live: agents.has(s.id) };
  };
  const snapshot = () => [...sessions.values()].sort((a, b) => a.startedAt - b.startedAt).map(pub);

  let bTimer = null;
  function broadcast() {
    if (bTimer) return;
    bTimer = setTimeout(() => {
      bTimer = null;
      const msg = JSON.stringify({ t: 'state', sessions: snapshot() });
      for (const u of uis) if (u.readyState === 1) u.send(msg);
      for (const l of listeners) l(snapshot());
    }, 80);
  }

  function ensure(id, init = {}) {
    let s = sessions.get(id);
    if (!s) {
      s = {
        id, agent: init.agent || 'agent', host: init.host || os.hostname(), cwd: init.cwd || '',
        project: init.cwd ? path.basename(init.cwd.replace(/[\\/]+$/, '')) : '', title: '',
        status: 'idle', prompt: '', reply: '', note: '', question: null, pending: null,
        tail: '', lastOut: 0, startedAt: now(), updatedAt: now(), exited: false, unread: false,
      };
      sessions.set(id, s);
    }
    for (const k of ['agent', 'host', 'cwd']) if (init[k]) s[k] = init[k];
    if (init.cwd) s.project = path.basename(init.cwd.replace(/[\\/]+$/, ''));
    return s;
  }
  const set = (s, patch) => { Object.assign(s, patch, { updatedAt: now() }); broadcast(); };
  const needsYou = (s) => s.status === 'question' || s.status === 'waiting';

  function sendKeys(id, seq) {
    const ws = agents.get(id);
    if (!ws || ws.readyState !== 1) return false;
    ws.send(JSON.stringify({ t: 'keys', seq }));
    return true;
  }

  function deliver(s, ans) {
    const DOWN = '\x1b[B';
    let seq;
    const q = s.question && s.question.items[s.question.index];
    if (q && ans.option != null) {
      seq = [DOWN.repeat(ans.option), '\r'];
    } else if (q && ans.text) {
      // "Type something else" sits after the listed options
      seq = [DOWN.repeat(q.options.length), ans.text, '\r'];
    } else {
      seq = [ans.text || '', '\r'];
    }
    const ok = sendKeys(s.id, seq);
    const label = ans.option != null && q ? q.options[ans.option].label : ans.text;
    if (!ok) return set(s, { pending: null, note: 'Not connected. Start this agent with `relay` to answer it from here.' });
    if (q && s.question.index + 1 < s.question.items.length) {
      s.question.index++;
      return set(s, { pending: null, prompt: label, note: '' });
    }
    set(s, { pending: null, question: null, status: 'working', prompt: label, title: s.title || short(label), note: '', lastOut: now() });
  }

  function answer(id, ans) {
    const s = sessions.get(id);
    if (!s) return;
    clearTimeout(timers.get(id));
    set(s, { pending: { ...ans, at: now(), ms: UNDO_MS } });
    timers.set(id, setTimeout(() => { timers.delete(id); deliver(s, ans); }, UNDO_MS));
  }
  function undo(id) {
    const s = sessions.get(id);
    if (!s || !s.pending) return;
    clearTimeout(timers.get(id)); timers.delete(id);
    set(s, { pending: null });
  }

  // ---- hook events (from `relay hook ...`) ----
  function hook(ev) {
    const s = ensure(ev.sid, ev);
    s.hooked = true;
    switch (ev.kind) {
      case 'start': set(s, { status: 'idle' }); break;
      case 'working': if (s.status !== 'question') set(s, { status: 'working', lastOut: now() }); break;
      case 'prompt':
        set(s, { status: 'working', prompt: ev.text || s.prompt, title: s.title || short(ev.text), question: null, note: '', lastOut: now() });
        break;
      case 'question': {
        const items = (ev.questions || []).map((q) => ({
          text: q.question || q.text || '', header: q.header || '', multi: !!q.multiSelect,
          options: (q.options || []).map((o) => (typeof o === 'string' ? { label: o } : { label: o.label, description: o.description || '' })),
        })).filter((q) => q.options.length);
        if (items.length) set(s, { status: 'question', question: { items, index: 0 }, unread: true });
        break;
      }
      case 'notify': {
        const m = ev.text || '';
        if (s.status !== 'question') set(s, { status: 'waiting', note: m, unread: true });
        break;
      }
      case 'stop':
        set(s, { status: s.question ? 'question' : 'waiting', reply: ev.text || s.reply, note: '', unread: true });
        break;
      case 'turn': // codex agent-turn-complete
        set(s, { status: 'waiting', reply: ev.text || s.reply, prompt: ev.prompt || s.prompt, title: s.title || short(ev.prompt), unread: true });
        break;
      case 'end': set(s, { status: 'done', exited: true }); break;
    }
  }

  // idle heuristic for agents without hooks (opencode, others)
  setInterval(() => {
    for (const s of sessions.values()) {
      if (s.status === 'working' && agents.has(s.id) && s.lastOut && now() - s.lastOut > IDLE_MS) {
        set(s, { status: 'waiting', reply: s.hooked ? s.reply : (s.reply || lastLines(s.tail)), unread: true });
      }
    }
  }, 1000);
  const lastLines = (t) => t.split('\n').map((l) => l.trim()).filter((l) => l.length > 2).slice(-6).join('\n');

  // ---- HTTP ----
  const authed = (u) => u.searchParams.get('token') === token;
  const server = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    if (req.method === 'POST' && u.pathname === '/hook') {
      if (req.headers['x-relay-token'] !== token && !authed(u)) { res.writeHead(401); return res.end(); }
      let body = '';
      req.on('data', (c) => { body += c; if (body.length > 2e6) req.destroy(); });
      req.on('end', () => {
        try { hook(JSON.parse(body)); res.writeHead(200); res.end('ok'); } catch (e) { res.writeHead(400); res.end(String(e)); }
      });
      return;
    }
    if (u.pathname === '/api/state') {
      if (!authed(u)) { res.writeHead(401); return res.end(); }
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end(JSON.stringify(snapshot()));
    }
    let p = u.pathname === '/' ? '/index.html' : u.pathname === '/dock' ? '/dock.html' : u.pathname;
    const f = path.join(uiDir, path.normalize(p).replace(/^([/\\])+/, ''));
    if (!f.startsWith(uiDir) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'content-type': MIME[path.extname(f)] || 'application/octet-stream', 'cache-control': 'no-store' });
    fs.createReadStream(f).pipe(res);
  });

  const wss = new WebSocketServer({ noServer: true, maxPayload: 4e6 });
  server.on('upgrade', (req, sock, head) => {
    const u = new URL(req.url, 'http://x');
    if (u.pathname !== '/ws' || !authed(u)) return sock.destroy();
    wss.handleUpgrade(req, sock, head, (ws) => {
      const role = u.searchParams.get('role');
      role === 'agent' ? onAgent(ws) : onUi(ws);
    });
  });

  function onAgent(ws) {
    let id = null;
    ws.on('message', (raw) => {
      let m; try { m = JSON.parse(raw); } catch { return; }
      if (m.t === 'hello') {
        id = m.id; agents.set(id, ws);
        const s = ensure(id, m);
        set(s, { status: 'idle', exited: false, title: s.title || m.title || '' });
      } else if (!id) {
        return;
      } else if (m.t === 'out') {
        const s = sessions.get(id); if (!s) return;
        s.tail = (s.tail + strip(m.d)).slice(-6000);
        const big = m.d.length > 160;
        s.lastOut = now();
        if (big && s.status !== 'working' && s.status !== 'question' && !s.pending && (s.kick || 0) > now() - 15000) set(s, { status: 'working' });
        else broadcast();
      } else if (m.t === 'in') { // user pressed Enter in their own terminal
        const s = sessions.get(id); if (!s) return;
        s.kick = now();
        if (s.status !== 'question') set(s, { status: 'working', lastOut: now(), unread: false });
      } else if (m.t === 'exit') {
        const s = sessions.get(id); if (s) set(s, { status: 'done', exited: true });
      }
    });
    ws.on('close', () => { if (id && agents.get(id) === ws) { agents.delete(id); const s = sessions.get(id); if (s && !s.exited) set(s, { status: 'done', exited: true }); } });
  }

  function onUi(ws) {
    uis.add(ws);
    ws.send(JSON.stringify({ t: 'state', sessions: snapshot() }));
    ws.on('message', (raw) => {
      let m; try { m = JSON.parse(raw); } catch { return; }
      const s = m.sid && sessions.get(m.sid);
      if (m.t === 'answer' && s) { s.kick = now(); answer(m.sid, { option: m.option ?? null, text: (m.text || '').slice(0, 20000) }); }
      else if (m.t === 'undo') undo(m.sid);
      else if (m.t === 'seen' && s) set(s, { unread: false });
      else if (m.t === 'dismiss' && s) {
        if (s.exited || !agents.has(s.id)) { sessions.delete(s.id); broadcast(); }
        else set(s, { status: 'idle', question: null, unread: false });
      }
      else if (m.t === 'interrupt' && s) sendKeys(s.id, ['\x1b']);
      else if (m.t === 'keys' && s) {
        const K = { enter: '\r', esc: '\x1b', up: '\x1b[A', down: '\x1b[B', tab: '\t', 'shift-tab': '\x1b[Z' };
        const seq = (m.keys || []).map((k) => K[k] ?? (/^[0-9a-z]$/i.test(k) ? k : '')).filter(Boolean);
        if (seq.length) { sendKeys(s.id, seq); s.kick = now(); set(s, { status: s.status === 'question' ? 'question' : 'working', note: '', lastOut: now() }); }
      }
    });
    ws.on('close', () => uis.delete(ws));
  }

  server.listen(port, lan ? '0.0.0.0' : '127.0.0.1');
  return {
    token, port, server,
    state: snapshot,
    needsYou: () => snapshot().filter(needsYou),
    onChange: (fn) => listeners.add(fn),
    answer, undo,
    setUndo: (ms) => { UNDO_MS = ms; },
    close: () => server.close(),
  };
}

module.exports = { startHub, loadToken, loadConfig, saveConfig, HOME };

if (require.main === module) {
  const h = startHub({ port: +process.env.RELAY_PORT || 7777, lan: process.argv.includes('--lan') });
  console.log(`relay hub on :${h.port}  token=${h.token}`);
}
