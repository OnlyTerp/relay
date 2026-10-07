const { I, esc, agentBadge, title, needs } = R;
var desk = window.desk;
const card = document.getElementById('card');
if (!desk) document.body.classList.add('web');

let view = 'list', sid = null, draft = '', lastKey = '', sel = 0, listening = false, attach = [];
let inf = null; // desktop settings/info

const hostLabel = (s) => (/^(localhost|)$/.test(s.host) ? 'this pc' : s.host);

function go(v, id = null) {
  view = v; if (id !== null) sid = id;
  if (v === 'detail' && sid) { R.send({ t: 'seen', sid }); desk && desk.focusSid(sid); }
  card.classList.remove('enter'); void card.offsetWidth; card.classList.add('enter');
  lastKey = ''; render();
}

// ---------------------------------------------------------------- list / inbox
function vList(list) {
  if (!list.length) return head('relay') + emptyAgents() + footAll(list);
  const groups = {};
  for (const s of list) (groups[`${s.project || s.agent}@${s.host}`] ||= []).push(s);
  let rows = '', i = 0;
  for (const items of Object.values(groups)) {
    const h = items[0];
    rows += `<div class="group">${esc(h.project || h.agent)} · on ${I.globe} ${esc(hostLabel(h))}</div>`;
    for (const s of items) rows += row(s, i++);
  }
  return head('relay') + `<div class="body">${rows}</div>` + footAll(list);
}
function row(s, i) {
  const q = s.question ? s.question.items.length : 0;
  return `<div class="row ${i === sel ? 'sel' : ''}" data-open="${s.id}">
    <span class="st ${s.status}"></span>${agentBadge(s.agent)}
    <span class="t">${esc(title(s))}${q > 1 ? `<span class="sub">⑂ ${q}</span>` : ''}</span>
    <span class="acts">${desk && s.live ? `<button class="ib" data-talk="${s.id}" title="Talk">${I.mic}</button>` : ''}<button class="ib" data-dismiss="${s.id}" title="${s.exited ? 'Remove' : 'Dismiss'}">${I.x}</button></span>
  </div>`;
}
function head(name, back) {
  return `<div class="head">${back ? `<button class="ib" data-back>${I.back}</button>` : ''}<span class="brand">${name}</span><span class="sp"></span>
    <button class="ib ${view === 'inbox' ? 'on' : ''}" data-view="inbox" title="Inbox">${I.inbox}</button>
    <button class="ib ${view === 'settings' ? 'on' : ''}" data-view="settings" title="Settings">${I.gear}</button></div>`;
}
function footAll(list) {
  const w = list.filter((s) => s.status === 'working').length, n = list.filter(needs).length;
  return `<div class="foot">${list.length} agent${list.length === 1 ? '' : 's'} · ${w} working · ${n} need${n === 1 ? 's' : ''} you</div>`;
}
function emptyAgents() {
  return `<div class="empty">${R.mascot}<div class="big">No agents yet.</div>
    <div class="small">Start one with <span class="mono">relay omp</span>, <span class="mono">relay grok</span>, <span class="mono">relay claude</span> or <span class="mono">relay codex</span>.</div></div>`;
}
function vInbox(list) {
  const n = list.filter(needs);
  if (!n.length) return head('Inbox', true) + `<div class="empty">${R.mascot}<div class="big">Nothing needs you.</div><div class="small">Suspiciously quiet. Questions land here.</div></div>`;
  return head('Inbox', true) + `<div class="body">${n.map(row).join('')}</div>`;
}

// ---------------------------------------------------------------- detail
function vDetail(s) {
  if (!s) { view = 'list'; return vList(R.sessions); }
  const q = s.question && s.question.items[s.question.index];
  let th = '';
  if (s.prompt) th += `<div class="b me">${esc(s.prompt)}</div>`;
  if (s.reply) th += `<div class="b ai">${esc(s.reply)}</div>`;
  else if (s.status !== 'working' && s.tail && !q) th += `<div class="b ai">${esc(cleanTail(s.tail))}</div>`;
  if (s.status === 'working') th += `<div class="b note"><span class="st working" style="display:inline-grid;vertical-align:-2px"></span> working…</div>`;
  if (s.note) th += `<div class="b note">${esc(s.note)}</div>`;
  if (q) {
    th += `${q.header || s.question.items.length > 1 ? `<div class="qh">${esc(q.header)}${s.question.items.length > 1 ? ` · ${s.question.index + 1}/${s.question.items.length}` : ''}</div>` : ''}<div class="q">${esc(q.text)}</div><div class="opts">`;
    q.options.forEach((o, i) => {
      const rec = /recommended/i.test(o.label);
      const picked = s.pending && s.pending.option === i;
      th += `<button class="opt ${rec ? 'rec' : ''} ${picked ? 'picked' : ''}" data-opt="${i}" ${s.pending ? 'disabled' : ''}><span class="n">${rec || picked ? I.check : i + 1}</span><span>${esc(o.label)}${o.description ? `<span class="d">${esc(o.description)}</span>` : ''}</span></button>`;
    });
    th += `</div>`;
  }
  if (s.exited) th += `<div class="b note">Session ended.</div>`;
  else if (!s.live) th += `<div class="b note">View only. Launch with <span class="mono">relay ${esc(s.agent)}</span> to answer from here.</div>`;

  const keys = s.live && !s.exited && !q && !s.pending && (s.status === 'waiting' || s.status === 'idle')
    ? `<div class="keys"><span>Keys</span><button data-keys="1,enter">1</button><button data-keys="2,enter">2</button><button data-keys="3,enter">3</button><button data-keys="up">↑</button><button data-keys="down">↓</button><button data-keys="enter">Enter</button><button data-keys="esc">Esc</button></div>` : '';
  const bottom = s.pending ? sentBar(s) : keys + composer(s, q);
  return `<div class="dhead"><button class="ib" data-back>${I.back}</button>${agentBadge(s.agent)}<span class="ttl">${esc(title(s))}</span>
      ${s.status === 'working' && s.live ? `<button class="ib" data-interrupt title="Interrupt (Esc)">${I.stop}</button>` : ''}
      <button class="ib" data-dismiss="${s.id}">${I.x}</button></div>
    <div class="meta"><span class="st ${s.status}"></span>${esc(s.project || s.agent)} · on ${I.globe.replace('<svg', '<svg width="12" height="12"')} ${esc(hostLabel(s))} · ${statusText(s)}</div>
    <div class="thread" id="thread">${th}</div>${bottom}
    <div class="listen ${listening ? '' : 'hide'}" id="listen"><i></i><span>${esc(draft) || 'Listening…'}</span></div>`;
}
const cleanTail = (t) => t.split('\n').map((l) => l.replace(/[─━│┃╭╮╰╯▐▛▜▝▘▟▙█▀▄]+/g, ' ').replace(/\s{3,}/g, '  ').trim()).filter((l) => l.length > 2).slice(-10).join('\n');
const statusText = (s) => ({ working: 'working', question: 'waiting for your answer', waiting: 'waiting for you', idle: 'idle', done: 'finished' }[s.status] || s.status);
function composer(s, q) {
  const dis = !s.live || s.exited;
  return `<div class="composer">
    <textarea id="ta" rows="1" placeholder="${q ? 'Pick 1–' + q.options.length + ', or type your own answer' : 'Reply to ' + esc(s.agent) + '…'}" ${dis ? 'disabled' : ''}>${esc(draft)}</textarea>
    ${attach.length ? `<span class="att" title="${esc(attach.join('\n'))}">${I.cam}${attach.length}</span>` : ''}
    ${desk ? `<button class="ib" data-shot title="Attach screenshot">${I.cam}</button><button class="ib mic ${listening ? 'on' : ''}" data-mic title="Talk (double-tap and hold Alt)">${I.mic}</button>` : webMic()}
    <button class="send" data-send ${dis ? 'disabled' : ''}>${I.send}</button></div>`;
}
const webMic = () => ('webkitSpeechRecognition' in window || 'SpeechRecognition' in window) ? `<button class="ib mic ${listening ? 'on' : ''}" data-webmic>${I.mic}</button>` : '';
function sentBar(s) {
  const left = Math.max(0, s.pending.ms - (Date.now() - s.pending.at));
  return `<div class="sent"><div class="l"><span class="ok">${I.check}</span><span>Answer sent</span><span class="sp"></span><button data-undo><span class="kbd">esc</span>to undo</button></div>
    <div class="bar" style="animation-duration:${left}ms"></div></div>`;
}

// ---------------------------------------------------------------- settings
const KEY_LABEL = (k) => (k || '').replace(/Control/g, 'Ctrl').replace(/\+/g, ' ');
function tog(key, on, label, hint) {
  return `<label class="set"><span><b>${label}</b>${hint ? `<i>${hint}</i>` : ''}</span><input type="checkbox" data-set="${key}" ${on ? 'checked' : ''}><span class="sw"></span></label>`;
}
function vSettings() {
  if (!desk) return head('Settings', true) + `<div class="body"><div class="sec"><p>Settings live in the desktop app.</p></div></div>`;
  if (!inf) { desk.info().then((i) => { inf = i; lastKey = ''; render(); }); return head('Settings', true) + '<div class="body"></div>'; }
  const c = inf.cfg;
  const hk = (k, label) => `<div class="set"><span><b>${label}</b></span><button class="hk" data-hk="${k}">${esc(KEY_LABEL(c.hotkeys[k]))}</button></div>`;
  const tunnelUrl = inf.tunnel.url;
  const lanUrl = `http://${inf.ips[0] || 'YOUR-PC-IP'}:${inf.port}/?token=${inf.token}`;
  const agents = [['omp', 'omp (oh-my-pi)'], ['grok', 'Grok Build / Grok Bot'], ['claude', 'Claude Code'], ['codex', 'Codex'], ['opencode', 'OpenCode'], ['gemini', 'Gemini CLI'], ['cursor-agent', 'Cursor Agent'], ['aider', 'Aider'], ['droid', 'Factory Droid']];
  return head('Settings', true) + `<div class="body settings">
    <div class="sh">Dock</div>
    <div class="sec">
      <div class="set"><span><b>Side</b></span><div class="seg"><button data-pick="side:left" class="${c.side === 'left' ? 'on' : ''}">Left</button><button data-pick="side:right" class="${c.side === 'right' ? 'on' : ''}">Right</button></div></div>
      <div class="set"><span><b>Screen</b></span><select data-sel="display"><option value="primary" ${c.display === 'primary' ? 'selected' : ''}>Main screen</option><option value="cursor" ${c.display === 'cursor' ? 'selected' : ''}>Screen with the mouse</option>${inf.displays.map((d) => `<option value="${d.id}" ${c.display === d.id ? 'selected' : ''}>${esc(d.label)}</option>`).join('')}</select></div>
      <div class="set"><span><b>Height on screen</b></span><input type="range" min="-500" max="500" step="10" value="${c.offset || 0}" data-range="offset"></div>
      ${tog('hidePanelOnBlur', c.hidePanelOnBlur, 'Hide panel when I click away')}
      ${tog('openAtLogin', inf.openAtLogin, 'Start with Windows')}
    </div>
    <div class="sh">Answering</div>
    <div class="sec">
      <div class="set"><span><b>Undo window</b><i>${(c.undoMs / 1000).toFixed(1)}s before an answer is typed in</i></span><input type="range" min="0" max="8000" step="500" value="${c.undoMs}" data-range="undoMs"></div>
      ${tog('notifications', c.notifications, 'Notify me when an agent needs me')}
      ${tog('sounds', c.sounds, 'Sounds')}
    </div>
    <div class="sh">Shortcuts</div>
    <div class="sec">
      ${hk('answer', 'Answer what’s waiting')}
      ${hk('talk', 'Talk (toggle)')}
      ${hk('list', 'Show all agents')}
      ${tog('doubleAltTalk', c.doubleAltTalk, 'Double-tap and hold Alt to talk')}
      ${tog('autoSendVoice', c.autoSendVoice, 'Send voice replies automatically', 'You still get the undo window')}
    </div>
    <div class="sh">Agents</div>
    <div class="sec">
      ${agents.map(([a, n]) => `<div class="ag-row">${agentBadge(a)}<span>${n}</span><span class="mono">relay ${a}</span></div>`).join('')}
      <p style="margin-top:8px">Exact events from omp, Grok, Claude and Codex. Every other CLI works through activity detection.</p>
      <button class="btn pri" data-install>Install / repair integrations</button><pre class="out" id="instOut"></pre>
    </div>
    <div class="sh">Phone</div>
    <div class="sec">
      ${tog('tunnel', c.tunnel, 'Reach Relay from anywhere', 'Private Cloudflare link. Works off Wi-Fi')}
      ${c.tunnel ? (tunnelUrl ? `${qr(tunnelUrl)}<p class="url"><span class="mono">${esc(tunnelUrl)}</span></p><p>Open it on your phone, then Share → Add to Home Screen.</p>` : `<p>${inf.tunnel.state === 'error' ? esc(inf.tunnel.error || 'Link failed') : 'Starting secure link…'}</p>`) : ''}
      ${tog('lan', c.lan, 'Allow on my Wi-Fi', 'Restarts Relay')}
      ${c.lan ? `${qr(lanUrl)}<p class="url"><span class="mono">${esc(lanUrl)}</span></p>` : ''}
    </div>
    <div class="sh">Remote machines</div>
    <div class="sec"><p>On a VPS: <span class="mono">ssh -R 7777:127.0.0.1:7777 you@vps</span>, install the CLI, <span class="mono">export RELAY_TOKEN=${esc(inf.token)}</span>, run <span class="mono">relay install</span>, then start agents with <span class="mono">relay omp</span>.</p></div>
    <div class="sec row2"><span class="small">Relay ${esc(inf.version)}</span><button class="btn" data-quit>Quit Relay</button></div>
  </div>`;
}
function qr(url) { try { const g = qrcode(0, 'M'); g.addData(url); g.make(); return `<div class="qr">${g.createSvgTag(4, 0)}</div>`; } catch { return ''; } }

// ---------------------------------------------------------------- render
function key(list) {
  const s = list.find((x) => x.id === sid);
  return JSON.stringify([view, sel, listening, attach.length, view === 'settings' ? inf : 0, list.map((x) => [x.id, x.status, x.title, x.project, x.live, x.exited, x.question, x.pending && x.pending.at]),
    s && [s.prompt, s.reply, s.note, view === 'detail' && !s.reply && s.status !== 'working' ? s.tail : 0], listening ? draft : 0]);
}
function render() {
  const list = R.sessions;
  const k = key(list);
  if (k === lastKey) return;
  lastKey = k;
  const ta = document.getElementById('ta');
  const hadFocus = ta && document.activeElement === ta;
  const caret = ta && ta.selectionStart;
  const scroll = document.querySelector('.body')?.scrollTop;
  card.innerHTML = view === 'detail' ? vDetail(list.find((s) => s.id === sid)) : view === 'inbox' ? vInbox(list) : view === 'settings' ? vSettings() : vList(list);
  if (scroll && view === 'settings') { const b = document.querySelector('.body'); if (b) b.scrollTop = scroll; }
  const t2 = document.getElementById('ta');
  if (t2) { grow(t2); if (hadFocus || (desk && view === 'detail')) { t2.focus(); try { t2.setSelectionRange(caret ?? draft.length, caret ?? draft.length); } catch {} } }
  const th = document.getElementById('thread'); if (th) th.scrollTop = th.scrollHeight;
}
R.on(render);

// ---------------------------------------------------------------- actions
const cur = () => R.sessions.find((s) => s.id === sid);
function sendAnswer(o) {
  const s = cur(); if (!s || !s.live || s.pending) return;
  let text = (o.text ?? draft).trim();
  if (attach.length) text = (text + '\n' + attach.map((p) => `[screenshot: ${p}]`).join('\n')).trim();
  if (o.option == null && !text) return;
  R.send({ t: 'answer', sid, option: o.option ?? null, text: o.option != null ? '' : text });
  draft = ''; attach = [];
  if (inf && inf.cfg.sounds) chime(660);
}
const grow = (t) => { t.style.height = 'auto'; t.style.height = Math.min(120, t.scrollHeight) + 'px'; };
let actx; function chime(f = 880) { try { actx ||= new AudioContext(); const o = actx.createOscillator(), g = actx.createGain(); o.frequency.value = f; o.type = 'sine'; g.gain.setValueAtTime(0.0001, actx.currentTime); g.gain.exponentialRampToValueAtTime(0.08, actx.currentTime + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, actx.currentTime + 0.35); o.connect(g).connect(actx.destination); o.start(); o.stop(actx.currentTime + 0.4); } catch {} }

async function setCfg(patch) { if (!desk) return; inf = await desk.set(patch); lastKey = ''; render(); }

card.addEventListener('input', (e) => { if (e.target.id === 'ta') { draft = e.target.value; grow(e.target); } });
card.addEventListener('change', (e) => {
  const t = e.target;
  if (t.dataset.set) setCfg({ [t.dataset.set]: t.checked });
  if (t.dataset.sel) setCfg({ [t.dataset.sel]: t.value });
  if (t.dataset.range) setCfg({ [t.dataset.range]: +t.value });
});
card.addEventListener('click', async (e) => {
  const b = e.target.closest('button,[data-open]');
  if (!b) return;
  const d = b.dataset;
  if ('dismiss' in d) { e.stopPropagation(); R.send({ t: 'dismiss', sid: d.dismiss }); if (view === 'detail') go('list'); return; }
  if ('talk' in d) { e.stopPropagation(); go('detail', d.talk); desk.talk(true); return; }
  if ('open' in d) return go('detail', d.open);
  if ('back' in d) return go('list');
  if ('view' in d) return go(view === d.view ? 'list' : d.view);
  if ('opt' in d) return sendAnswer({ option: +d.opt });
  if ('send' in d) return sendAnswer({});
  if ('undo' in d) return R.send({ t: 'undo', sid });
  if ('interrupt' in d) return R.send({ t: 'interrupt', sid });
  if ('keys' in d) return R.send({ t: 'keys', sid, keys: d.keys.split(',') });
  if ('shot' in d) { const p = await desk.screenshot(); attach.push(p); lastKey = ''; render(); return; }
  if ('mic' in d) return desk.talk(!listening);
  if ('webmic' in d) return webTalk();
  if ('install' in d) { const o = document.getElementById('instOut'); o.textContent = 'Installing…'; o.textContent = await desk.installHooks(); inf = await desk.info(); return; }
  if ('pick' in d) { const [k, v] = d.pick.split(':'); return setCfg({ [k]: v }); }
  if ('hk' in d) return captureHotkey(b, d.hk);
  if ('quit' in d) return desk.quit();
});

function captureHotkey(btn, which) {
  btn.textContent = 'Press keys…'; btn.classList.add('rec');
  const onKey = async (e) => {
    e.preventDefault(); e.stopPropagation();
    if (e.key === 'Escape') return done();
    if (['Control', 'Alt', 'Shift', 'Meta'].includes(e.key)) return;
    const mods = [e.ctrlKey && 'Control', e.altKey && 'Alt', e.shiftKey && 'Shift', e.metaKey && 'Super'].filter(Boolean);
    if (!mods.length) { btn.textContent = 'Add Ctrl / Alt / Shift'; return; }
    const k = e.code.startsWith('Key') ? e.code.slice(3) : e.code.startsWith('Digit') ? e.code.slice(5) : e.key === ' ' ? 'Space' : e.key.length === 1 ? e.key.toUpperCase() : e.key;
    await setCfg({ hotkeys: { [which]: [...mods, k].join('+') } });
    done();
  };
  const done = () => { window.removeEventListener('keydown', onKey, true); lastKey = ''; render(); };
  window.addEventListener('keydown', onKey, true);
}

document.addEventListener('keydown', (e) => {
  const s = cur();
  const inTa = e.target.id === 'ta';
  if (e.target.tagName === 'SELECT' || e.target.type === 'range') return;
  if (e.key === 'Escape') {
    if (view === 'detail' && s && s.pending) { R.send({ t: 'undo', sid }); e.preventDefault(); return; }
    if (view !== 'list') return go('list');
    return desk && desk.hide();
  }
  if (view === 'detail' && s) {
    const q = s.question && s.question.items[s.question.index];
    if (q && !draft && /^[1-9]$/.test(e.key) && +e.key <= q.options.length) { e.preventDefault(); return sendAnswer({ option: +e.key - 1 }); }
    if (inTa && e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); return sendAnswer({}); }
  }
  if ((view === 'list' || view === 'inbox') && !inTa) {
    const rows = [...document.querySelectorAll('.row')];
    if (e.key === 'ArrowDown' || e.key === 'j') { sel = Math.min(rows.length - 1, sel + 1); lastKey = ''; render(); }
    if (e.key === 'ArrowUp' || e.key === 'k') { sel = Math.max(0, sel - 1); lastKey = ''; render(); }
    if (e.key === 'Enter' && rows[sel]) go('detail', rows[sel].dataset.open);
  }
});

if (desk) {
  desk.info().then((i) => { inf = i; });
  desk.on('info', (i) => { inf = i; lastKey = ''; render(); });
  desk.on('open', ({ view: v, sid: id }) => { sel = 0; go(v || 'list', id || null); });
  desk.on('dictation', ({ state, text, autoSend }) => {
    listening = state === 'listening';
    if (text) draft = text;
    lastKey = ''; render();
    if (state === 'done' && text && cur() && autoSend) sendAnswer({ text });
  });
}
let prevNeed = 0;
R.on((list) => { const n = list.filter(needs).length; if (n > prevNeed && inf && inf.cfg.sounds && document.visibilityState === 'visible') chime(); prevNeed = n; });

// phone: browser speech recognition
let rec = null;
function webTalk() {
  if (rec) { rec.stop(); return; }
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  rec = new SR(); rec.interimResults = true; rec.continuous = false;
  listening = true; lastKey = ''; render();
  rec.onresult = (e) => { draft = [...e.results].map((r) => r[0].transcript).join(' '); const t = document.getElementById('ta'); if (t) t.value = draft; };
  rec.onend = () => { rec = null; listening = false; lastKey = ''; render(); };
  rec.start();
}
