// shared: hub connection + icons
window.R = (() => {
  const qs = new URLSearchParams(location.search);
  const token = qs.get('token') || localStorage.getItem('relay-token') || '';
  try { if (qs.get('token')) localStorage.setItem('relay-token', token); } catch {}
  let ws, sessions = [], subs = new Set();
  const connect = () => {
    ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws?role=ui&token=${encodeURIComponent(token)}`);
    ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.t === 'state') { sessions = m.sessions; subs.forEach((f) => f(sessions)); } };
    ws.onclose = () => setTimeout(connect, 1500);
  };
  connect();
  const send = (o) => ws && ws.readyState === 1 && ws.send(JSON.stringify(o));
  const P = (d, extra = '') => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" ${extra}>${d}</svg>`;
  const I = {
    inbox: P('<path d="M3 13h5l1.5 3h5L16 13h5"/><path d="M5.5 5h13L21 13v6H3v-6z"/>'),
    mic: P('<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/>'),
    cam: P('<path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/>'),
    x: P('<path d="M6 6l12 12M18 6L6 18"/>'),
    more: P('<circle cx="5" cy="12" r="1.2" fill="currentColor"/><circle cx="12" cy="12" r="1.2" fill="currentColor"/><circle cx="19" cy="12" r="1.2" fill="currentColor"/>'),
    back: P('<path d="M15 5l-7 7 7 7"/>'),
    send: P('<path d="M12 19V5M6 11l6-6 6 6"/>'),
    check: P('<path d="M5 12.5l4.5 4.5L19 7.5"/>', 'stroke-width="3"'),
    globe: P('<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c3 3.5 3 14.5 0 18M12 3c-3 3.5-3 14.5 0 18"/>'),
    laptop: P('<rect x="4" y="5" width="16" height="11" rx="1.5"/><path d="M2 19h20"/>'),
    stop: P('<rect x="7" y="7" width="10" height="10" rx="2"/>'),
    gear: P('<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1L7 17M17 7l2.1-2.1"/>'),
  };
  const mascot = `<svg class="mascot" viewBox="0 0 64 64"><rect x="6" y="10" width="52" height="40" rx="20" fill="#f2f2f2"/><path d="M20 50l-4 9 12-9z" fill="#f2f2f2"/><circle cx="25" cy="30" r="4" fill="#141414"/><circle cx="39" cy="30" r="4" fill="#141414"/></svg>`;
  const AG = [[/^omp|pi$/i, 'omp', 'π'], [/grok/i, 'grok', 'G'], [/claude/i, 'claude', 'C'], [/codex/i, 'codex', 'X'], [/opencode/i, 'opencode', 'O'],
    [/gemini/i, 'gemini', '✦'], [/cursor/i, 'cursor', 'Cu'], [/aider/i, 'aider', 'A'], [/droid/i, 'droid', 'D'], [/amp/i, 'amp', '⚡'], [/qwen/i, 'qwen', 'Q']];
  const agentBadge = (a) => {
    const m = AG.find(([re]) => re.test(a || ''));
    const [k, ch] = m ? [m[1], m[2]] : ['other', (a || '?')[0].toUpperCase()];
    return `<span class="ag ${k}" title="${esc(a)}">${ch}</span>`;
  };
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const title = (s) => s.title || s.project || s.agent;
  const needs = (s) => s.status === 'question' || s.status === 'waiting';
  return { send, on: (f) => (subs.add(f), f(sessions)), get sessions() { return sessions; }, I, mascot, agentBadge, esc, title, needs, token, desk: window.desk };
})();
