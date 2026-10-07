const { I, esc, agentBadge, title, needs } = R;
var desk = window.desk;
const card = document.getElementById('card');
if (!desk) document.body.classList.add('web');

let view = 'list', sid = null, draft = '', lastKey = '', sel = 0, attach = [];
let inf = null;                    // desktop settings/info
let voice = { state: 'idle', level: 0, progress: 0 };
let toast = null;
const L = { harnesses: null, harness: null, models: {}, modelsSrc: {}, model: '', modelQ: '', folder: '', prompt: '', busy: false, err: '', step: 0, setup: null };

const hostLabel = (s) => (/^(localhost|)$/.test(s.host) ? 'this pc' : s.host);
const shortModel = (m) => (m || '').split('/').pop();
const ago = (t) => { if (!t) return ''; const s = Math.max(0, (Date.now() - t) / 1000); return s < 60 ? `${Math.floor(s)}s` : s < 3600 ? `${Math.floor(s / 60)}m` : `${Math.floor(s / 3600)}h`; };
const P = (d) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
const IC = {
  plus: P('<path d="M12 5v14M5 12h14"/>'), folder: P('<path d="M3.5 7.5a2 2 0 0 1 2-2h4l2 2h7a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z"/>'),
  refresh: P('<path d="M20 11a8 8 0 1 0-2.3 5.7M20 5v6h-6"/>'), bolt: P('<path d="M13 3L5 14h6l-1 7 8-11h-6z"/>'), star: P('<path d="M12 4l2.4 5 5.6.6-4.2 3.8 1.2 5.6L12 16.3 7 19l1.2-5.6L4 9.6 9.6 9z"/>'),
  play: P('<path d="M8 5.5v13l10.5-6.5z"/>'), wave: P('<path d="M4 12h2M8 8v8M12 5v14M16 8v8M20 12h-2"/>'), chev: P('<path d="M9 6l6 6-6 6"/>'),
};

function go(v, id = null) {
  view = v; if (id !== null) sid = id;
  if (v === 'detail' && sid) { R.send({ t: 'seen', sid }); desk && desk.focusSid(sid); }
  if (v === 'new') initLauncher();
  card.classList.remove('enter'); void card.offsetWidth; card.classList.add('enter');
  lastKey = ''; render();
}
function say(msg, kind = 'ok') { toast = { msg, kind, at: Date.now() }; lastKey = ''; render(); setTimeout(() => { if (toast && Date.now() - toast.at >= 2400) { toast = null; lastKey = ''; render(); } }, 2500); }

// ---------------------------------------------------------------- shell
function head(name, back) {
  return `<div class="head">${back ? `<button class="ib" data-back title="Back">${I.back}</button>` : ''}<span class="brand">${name}</span><span class="sp"></span>
    ${desk ? `<button class="ib ${view === 'new' ? 'on' : ''}" data-view="new" title="New agent">${IC.plus}</button>` : ''}
    <button class="ib ${view === 'inbox' ? 'on' : ''}" data-view="inbox" title="Inbox">${I.inbox}</button>
    ${desk ? `<button class="ib ${view === 'settings' ? 'on' : ''}" data-view="settings" title="Settings">${I.gear}</button>` : ''}</div>`;
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
  const meta = s.status === 'working' ? ago(s.since) : shortModel(s.model);
  return `<div class="row ${i === sel ? 'sel' : ''} ${s.status}" data-open="${s.id}">
    <span class="st ${s.status}"></span>${agentBadge(s.agent)}
    <span class="t">${esc(title(s))}${q > 1 ? `<span class="sub">⑂ ${q}</span>` : ''}</span>
    ${meta ? `<span class="rm">${esc(meta)}</span>` : ''}
    <span class="acts">${desk && s.live ? `<button class="ib" data-talk="${s.id}" title="Talk">${I.mic}</button>` : ''}<button class="ib" data-dismiss="${s.id}" title="${s.exited ? 'Remove' : 'Dismiss'}">${I.x}</button></span>
  </div>`;
}
function footAll(list) {
  const w = list.filter((s) => s.status === 'working').length, n = list.filter(needs).length;
  return `<div class="foot"><span>${list.length} agent${list.length === 1 ? '' : 's'}</span><span class="dotsep"></span><span>${w} working</span><span class="dotsep"></span><span class="${n ? 'hot' : ''}">${n} need${n === 1 ? 's' : ''} you</span></div>`;
}
function emptyAgents() {
  const presets = (inf && inf.cfg.presets) || [];
  return `<div class="empty">${R.mascot}<div class="big">No agents running.</div>
    <div class="small">${desk ? 'Start one here, or run <span class="mono">relay omp</span> in any terminal.' : 'Agents you start on your PC show up here.'}</div>
    ${desk ? `<button class="btn pri big" data-view="new">${IC.plus} New agent</button>` : ''}
    ${presets.length ? `<div class="presets">${presets.map((p, i) => `<button class="chip" data-preset="${i}">${agentBadge(p.harness)}<span>${esc(p.name)}</span></button>`).join('')}</div>` : ''}
  </div>`;
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
  else if (s.status !== 'working' && s.tail && !q) th += `<div class="b ai term">${esc(cleanTail(s.tail))}</div>`;
  if (s.status === 'working') th += `<div class="b note working"><span class="st working"></span> working · ${ago(s.since)}</div>`;
  if (s.note) th += `<div class="b note">${esc(s.note)}</div>`;
  if (q) {
    th += `<div class="qwrap">${q.header || s.question.items.length > 1 ? `<div class="qh">${esc(q.header.replace(/_/g, ' '))}${s.question.items.length > 1 ? ` · ${s.question.index + 1} of ${s.question.items.length}` : ''}</div>` : ''}<div class="q">${esc(q.text)}</div><div class="opts">`;
    q.options.forEach((o, i) => {
      const rec = /recommended/i.test(o.label);
      const picked = s.pending && s.pending.option === i;
      th += `<button class="opt ${rec ? 'rec' : ''} ${picked ? 'picked' : ''}" data-opt="${i}" ${s.pending ? 'disabled' : ''}><span class="n">${rec || picked ? I.check : i + 1}</span><span>${esc(o.label)}${o.description ? `<span class="d">${esc(o.description)}</span>` : ''}</span></button>`;
    });
    th += `</div></div>`;
  }
  if (s.exited) th += `<div class="b note">Session ended.</div>`;
  else if (!s.live) th += `<div class="b note">View only. Start it with <span class="mono">relay ${esc(s.agent)}</span> to answer from here.</div>`;

  const keys = s.live && !s.exited && !q && !s.pending && (s.status === 'waiting' || s.status === 'idle')
    ? `<div class="keys"><button data-keys="1,enter">1</button><button data-keys="2,enter">2</button><button data-keys="3,enter">3</button><button data-keys="up">↑</button><button data-keys="down">↓</button><button data-keys="enter">↵ Enter</button><button data-keys="esc">Esc</button></div>` : '';
  const recording = voice.state === 'recording' || voice.state === 'transcribing';
  const bottom = s.pending ? sentBar(s) : recording ? voiceBar() : keys + composer(s, q);
  const meta = [esc(s.project || s.agent), `${I.globe.replace('<svg', '<svg width="11" height="11"')} ${esc(hostLabel(s))}`, s.model ? esc(shortModel(s.model)) : '', statusText(s)].filter(Boolean).join(' · ');
  return `<div class="dhead"><button class="ib" data-back>${I.back}</button>${agentBadge(s.agent)}<span class="ttl">${esc(title(s))}</span>
      ${s.status === 'working' && s.live ? `<button class="ib" data-interrupt title="Interrupt">${I.stop}</button>` : ''}
      <button class="ib" data-dismiss="${s.id}" title="Dismiss">${I.x}</button></div>
    <div class="meta"><span class="st ${s.status}"></span>${meta}</div>
    <div class="thread" id="thread">${th}</div>${bottom}`;
}
const cleanTail = (t) => t.split('\n').map((l) => l.replace(/[─━│┃╭╮╰╯▐▛▜▝▘▟▙█▀▄╎┊]+/g, ' ').replace(/\s{3,}/g, '  ').trim()).filter((l) => l.length > 2).slice(-10).join('\n');
const statusText = (s) => ({ working: 'working', question: 'needs an answer', waiting: 'waiting for you', idle: 'idle', done: 'finished' }[s.status] || s.status);
function composer(s, q) {
  const dis = !s.live || s.exited;
  return `<div class="composer ${dis ? 'dis' : ''}">
    <textarea id="ta" rows="1" placeholder="${q ? `Press 1–${q.options.length}, or type your own answer` : `Reply to ${esc(s.agent)}…`}" ${dis ? 'disabled' : ''}>${esc(draft)}</textarea>
    ${attach.length ? `<span class="att" title="${esc(attach.join('\n'))}">${I.cam}${attach.length}</span>` : ''}
    ${desk ? `<button class="ib" data-shot title="Attach a screenshot">${I.cam}</button><button class="ib mic" data-mic title="Talk · double-tap and hold Alt">${I.mic}</button>` : webMic()}
    <button class="send" data-send ${dis ? 'disabled' : ''} title="Send (Enter)">${I.send}</button></div>`;
}
function voiceBar() {
  if (voice.state === 'transcribing') return `<div class="voicebar tr"><span class="shimmer">Transcribing…</span></div>`;
  const bars = Array.from({ length: 24 }, (_, i) => { const h = 4 + Math.round(Math.max(0.08, voice.level) * 22 * (0.55 + 0.45 * Math.sin(i * 1.7 + Date.now() / 120))); return `<i style="height:${h}px"></i>`; }).join('');
  return `<div class="voicebar"><span class="rec"></span><div class="lv">${bars}</div><span class="hint">release to send · <span class="kbd">esc</span> cancel</span></div>`;
}
const webMic = () => ('webkitSpeechRecognition' in window || 'SpeechRecognition' in window) ? `<button class="ib mic" data-webmic>${I.mic}</button>` : '';
function sentBar(s) {
  const left = Math.max(0, s.pending.ms - (Date.now() - s.pending.at));
  return `<div class="sent"><div class="l"><span class="ok">${I.check}</span><span>Answer sent</span><span class="sp"></span><button data-undo><span class="kbd">esc</span>to undo</button></div>
    <div class="bar" style="animation-duration:${left}ms"></div></div>`;
}

// ---------------------------------------------------------------- new agent (launcher)
async function initLauncher() {
  if (!desk) return;
  if (!L.harnesses) {
    L.harnesses = await desk.agents();
    const c = inf ? inf.cfg : {};
    const installed = L.harnesses.filter((h) => h.path);
    L.harness = (installed.find((h) => h.id === c.lastHarness) || installed[0] || L.harnesses[0]).id;
    L.folder = (c.recentFolders || [])[0] || '';
  }
  pickHarness(L.harness);
}
async function pickHarness(id, refresh = false) {
  L.harness = id; L.err = '';
  L.model = (inf && inf.cfg.lastModel && inf.cfg.lastModel[id]) || '';
  L.modelQ = '';
  if (!L.models[id] || refresh) {
    L.modelsSrc[id] = 'loading'; lastKey = ''; render();
    const r = await desk.models(id, refresh);
    L.models[id] = r.models; L.modelsSrc[id] = r.source;
  }
  lastKey = ''; render();
}
function vNew() {
  if (!desk) return head('New agent', true) + `<div class="empty"><div class="small">Start agents from Relay on your PC.</div></div>`;
  if (!L.harnesses) return head('New agent', true) + `<div class="empty"><div class="spin"></div></div>`;
  const h = L.harnesses.find((x) => x.id === L.harness) || L.harnesses[0];
  const all = L.models[h.id] || [];
  const qq = L.modelQ.toLowerCase();
  const list = (qq ? all.filter((m) => m.toLowerCase().includes(qq)) : all).slice(0, 60);
  const src = L.modelsSrc[h.id];
  const recents = (inf && inf.cfg.recentFolders) || [];
  const presets = (inf && inf.cfg.presets) || [];
  const installed = L.harnesses.filter((x) => x.path), missing = L.harnesses.filter((x) => !x.path);
  return head('New agent', true) + `<div class="body launcher">
    ${presets.length ? `<div class="lab">Quick start</div><div class="presets">${presets.map((p, i) => `<button class="chip" data-preset="${i}" title="${esc(p.cwd)}">${agentBadge(p.harness)}<span>${esc(p.name)}</span><span class="x" data-delpreset="${i}">×</span></button>`).join('')}</div>` : ''}
    <div class="lab">Harness</div>
    <div class="hgrid">${installed.map((x) => `<button class="hcard ${x.id === h.id ? 'on' : ''}" data-harness="${x.id}" title="${esc(x.desc)}">${agentBadge(x.id)}<span><b>${esc(x.name)}</b><i>${esc(x.desc)}</i></span></button>`).join('')}</div>
    ${missing.length ? `<details class="more"><summary>${missing.length} not installed</summary><div class="hgrid dim">${missing.map((x) => `<div class="hcard off">${agentBadge(x.id)}<span><b>${esc(x.name)}</b><i>not found on PATH</i></span></div>`).join('')}</div></details>` : ''}
    ${h.flag ? `<div class="lab">Model <span class="src">${src === 'loading' ? 'loading…' : src === 'live' || src === 'cache' ? `live from ${esc(h.name)}` : 'type any model id'}${h.canList ? `<button class="ib tiny" data-refresh title="Refresh list">${IC.refresh}</button>` : ''}</span></div>
    <div class="msel">
      <input id="mq" placeholder="${L.model ? esc(L.model) : `Default model${all.length ? ' · search ' + all.length : ''}`}" value="${esc(L.modelQ)}" autocomplete="off" spellcheck="false">
      ${L.model ? `<button class="clear" data-model="" title="Use default">${I.x}</button>` : ''}
    </div>
    <div class="mlist">${list.map((m) => `<button class="mi ${m === L.model ? 'on' : ''}" data-model="${esc(m)}">${m.includes('/') ? `<span class="prov">${esc(m.split('/')[0])}/</span>` : ''}${esc(m.split('/').slice(1).join('/') || m)}</button>`).join('')}
      ${L.modelQ && !all.includes(L.modelQ) ? `<button class="mi custom" data-model="${esc(L.modelQ)}">Use “${esc(L.modelQ)}”</button>` : ''}
      ${!list.length && !L.modelQ && src !== 'loading' ? `<div class="mnone">No list for ${esc(h.name)}. Type a model id, or leave empty for its default.</div>` : ''}
    </div>` : ''}
    <div class="lab">Folder</div>
    <div class="folders">${recents.map((f) => `<button class="fi ${f === L.folder ? 'on' : ''}" data-folder="${esc(f)}">${IC.folder}<span>${esc(f.split(/[\\/]/).pop() || f)}</span><i>${esc(f)}</i></button>`).join('')}
      <button class="fi browse" data-browse>${IC.plus}<span>${L.folder && !recents.includes(L.folder) ? esc(L.folder) : 'Choose a folder…'}</span></button></div>
    ${h.prompt ? `<div class="lab">First message <span class="src">optional</span></div><textarea id="lp" class="lp" rows="2" placeholder="What should it work on?">${esc(L.prompt)}</textarea>` : ''}
    ${L.err ? `<div class="err">${esc(L.err)}</div>` : ''}
  </div>
  <div class="launchbar"><button class="btn ghost" data-savepreset ${!L.folder ? 'disabled' : ''} title="Save as a quick-start preset">${IC.star}</button>
    <button class="btn pri grow" data-launch ${!L.folder || L.busy ? 'disabled' : ''}>${IC.play}<span>${L.busy ? 'Starting…' : `Start ${esc(h.name)}${L.model ? ' · ' + esc(shortModel(L.model)) : ''}`}</span></button></div>`;
}
async function doLaunch(opts) {
  L.busy = true; L.err = ''; lastKey = ''; render();
  const r = await desk.launch(opts);
  L.busy = false;
  if (!r.ok) { L.err = r.error || 'Could not start'; lastKey = ''; render(); return; }
  L.prompt = ''; inf = await desk.info();
  go('list'); say(`Started ${opts.harness}${opts.model ? ' · ' + shortModel(opts.model) : ''}`);
}

// ---------------------------------------------------------------- welcome (first run)
function vWelcome() {
  const step = L.step;
  const dots = `<div class="steps">${[0, 1, 2, 3].map((i) => `<i class="${i === step ? 'on' : i < step ? 'done' : ''}"></i>`).join('')}</div>`;
  let body = '';
  if (step === 0) body = `<div class="hero">${R.mascot}<h1>Never keep an agent waiting.</h1>
      <p>Relay sits on the edge of your screen and watches every coding agent you run. When one needs you, answer in a keystroke or just say it.</p>
      <ul class="feat"><li>${I.inbox}<span>Every question from every agent, in one inbox</span></li><li>${I.mic}<span>Talk to agents. Private speech-to-text on your PC</span></li><li>${IC.bolt}<span>Start omp, Grok, Claude or Codex on any model</span></li></ul></div>`;
  if (step === 1) {
    const hs = L.harnesses || [];
    const st = L.setup;
    body = `<div class="hero left"><h2>Connect your agents</h2><p>Relay adds a small hook to each agent so their questions show up here. Your logins and settings stay untouched.</p>
      <div class="found">${hs.length ? hs.filter((h) => h.path).map((h) => `<div class="fr">${agentBadge(h.id)}<span>${esc(h.name)}</span><span class="ok2">${st && st.done ? `${I.check} connected` : 'found'}</span></div>`).join('') || '<div class="small">No agent CLIs found yet. You can install one later.</div>' : '<div class="spin"></div>'}</div>
      ${st && st.err ? `<div class="err">${esc(st.err)}</div>` : ''}</div>`;
  }
  if (step === 2) body = `<div class="hero left"><h2>Talk to your agents</h2><p>Double-tap and hold <span class="kbd">Alt</span>, speak, let go. Speech is turned into text by Whisper, right on this PC. Nothing is uploaded.</p>
      ${voiceQualityPicker()}${voiceStatusLine()}
      <button class="talktest ${voice.state === 'recording' ? 'on' : ''}" data-testmic>${I.mic}<span>${voice.state === 'recording' ? 'Listening… click to stop' : voice.state === 'transcribing' ? 'Transcribing…' : 'Click and say something'}</span></button>
      ${L.testText ? `<div class="heard">“${esc(L.testText)}”</div>` : ''}</div>`;
  if (step === 3) body = `<div class="hero left"><h2>You're set</h2><p>Relay starts with Windows and stays out of your way.</p>
      <div class="kbds"><div><span class="kbd">Ctrl Alt K</span><span>answer what's waiting</span></div><div><span class="kbd">Alt Alt</span><span>hold to talk</span></div><div><span class="kbd">1 – 9</span><span>pick an option</span></div><div><span class="kbd">Esc</span><span>undo an answer</span></div></div></div>`;
  const next = step === 0 ? `<button class="btn pri grow" data-wnext>Get started</button>`
    : step === 1 ? (L.setup && L.setup.done ? `<button class="btn pri grow" data-wnext>Continue</button>` : `<button class="btn pri grow" data-wsetup ${L.setup && L.setup.busy ? 'disabled' : ''}>${L.setup && L.setup.busy ? 'Connecting…' : 'Connect agents'}</button>`)
    : step === 2 ? `<button class="btn pri grow" data-wnext>Continue</button>`
    : `<button class="btn grow" data-wdone>Done</button><button class="btn pri grow" data-wfirst>${IC.plus} Start an agent</button>`;
  return `<div class="welcome">${dots}${body}<div class="wfoot">${step > 0 && step < 3 ? `<button class="btn ghost" data-wskip>Skip</button>` : ''}${next}</div></div>`;
}
function voiceQualityPicker() {
  const lv = (inf && inf.cfg.voice.level) || 'balanced';
  const opts = [['fast', 'Fast', '~150 MB'], ['balanced', 'Balanced', '~500 MB'], ['best', 'Best', '~1 GB · GPU']];
  return `<div class="vq">${opts.map(([k, n, d]) => `<button class="${lv === k ? 'on' : ''}" data-vlevel="${k}"><b>${n}</b><i>${d}</i></button>`).join('')}</div>`;
}
function voiceStatusLine() {
  const v = voice;
  if (v.state === 'downloading') return `<div class="vst"><div class="pbar"><i style="width:${Math.round(v.progress * 100)}%"></i></div><span>Downloading voice model · ${Math.round(v.progress * 100)}%</span></div>`;
  if (v.state === 'error') return `<div class="vst err">${esc(v.error || 'Voice failed to load')}</div>`;
  if (v.state === 'ready' || v.state === 'recording' || v.state === 'transcribing') return `<div class="vst okc">${I.check}<span>Ready${v.device === 'webgpu' ? ' · running on your GPU' : ' · running on CPU'}</span></div>`;
  return `<div class="vst"><span>Preparing voice…</span></div>`;
}

// ---------------------------------------------------------------- settings
const KEY_LABEL = (k) => (k || '').replace(/Control/g, 'Ctrl').replace(/\+/g, ' ');
function tog(key, on, label, hint) {
  return `<label class="set"><span><b>${label}</b>${hint ? `<i>${hint}</i>` : ''}</span><input type="checkbox" data-set="${key}" ${on ? 'checked' : ''}><span class="sw"></span></label>`;
}
function vSettings() {
  if (!inf) { desk.info().then((i) => { inf = i; lastKey = ''; render(); }); return head('Settings', true) + '<div class="body"></div>'; }
  const c = inf.cfg;
  const hk = (k, label) => `<div class="set"><span><b>${label}</b></span><button class="hk" data-hk="${k}">${esc(KEY_LABEL(c.hotkeys[k]))}</button></div>`;
  const tunnelUrl = inf.tunnel.url;
  const lanUrl = `http://${inf.ips[0] || 'YOUR-PC-IP'}:${inf.port}/?token=${inf.token}`;
  return head('Settings', true) + `<div class="body settings">
    <div class="sh">Voice</div>
    <div class="sec">${voiceQualityPicker()}${voiceStatusLine()}
      <div class="set"><span><b>Language</b></span><select data-voice="language"><option value="english" ${c.voice.language === 'english' ? 'selected' : ''}>English</option><option value="auto" ${c.voice.language === 'auto' ? 'selected' : ''}>Detect automatically</option></select></div>
      ${tog('doubleAltTalk', c.doubleAltTalk, 'Double-tap and hold Alt to talk')}
      ${tog('autoSendVoice', c.autoSendVoice, 'Send when I let go', 'You still get the undo window')}
    </div>
    <div class="sh">Dock</div>
    <div class="sec">
      <div class="set"><span><b>Side</b></span><div class="seg"><button data-pick="side:left" class="${c.side === 'left' ? 'on' : ''}">Left</button><button data-pick="side:right" class="${c.side === 'right' ? 'on' : ''}">Right</button></div></div>
      <div class="set"><span><b>Screen</b></span><select data-sel="display"><option value="primary" ${c.display === 'primary' ? 'selected' : ''}>Main screen</option><option value="cursor" ${c.display === 'cursor' ? 'selected' : ''}>Screen with the mouse</option>${inf.displays.map((d) => `<option value="${d.id}" ${c.display === d.id ? 'selected' : ''}>${esc(d.label)}</option>`).join('')}</select></div>
      <div class="set"><span><b>Height</b></span><input type="range" min="-500" max="500" step="10" value="${c.offset || 0}" data-range="offset"></div>
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
    <div class="sec">${hk('answer', 'Answer what’s waiting')}${hk('talk', 'Talk (toggle)')}${hk('list', 'Show all agents')}</div>
    <div class="sh">Agents</div>
    <div class="sec"><p>omp, Grok, Claude Code and Codex report questions and replies directly. Any other CLI works with <span class="mono">relay &lt;command&gt;</span>.</p>
      <button class="btn" data-install>Reconnect agents</button><pre class="out" id="instOut"></pre></div>
    <div class="sh">Phone</div>
    <div class="sec">
      ${tog('tunnel', c.tunnel, 'Reach Relay from anywhere', 'Private Cloudflare link. Works off Wi-Fi')}
      ${c.tunnel ? (tunnelUrl ? `${qr(tunnelUrl)}<p class="url"><span class="mono">${esc(tunnelUrl)}</span></p><p>Scan it, then Share → Add to Home Screen.</p>` : `<p>${inf.tunnel.state === 'error' ? esc(inf.tunnel.error || 'Link failed') : 'Starting secure link…'}</p>`) : ''}
      ${tog('lan', c.lan, 'Allow on my Wi-Fi', 'Restarts Relay')}
      ${c.lan ? `${qr(lanUrl)}<p class="url"><span class="mono">${esc(lanUrl)}</span></p>` : ''}
    </div>
    <div class="sh">Remote machines</div>
    <div class="sec"><p>On a VPS: <span class="mono">ssh -R 7777:127.0.0.1:7777 you@vps</span>, install the CLI, set <span class="mono">RELAY_TOKEN=${esc(inf.token)}</span>, run <span class="mono">relay install</span>, then <span class="mono">relay omp</span>.</p></div>
    <div class="sec row2"><span class="small">Relay ${esc(inf.version)}</span><span><button class="btn ghost" data-rewelcome>Setup guide</button> <button class="btn" data-quit>Quit</button></span></div>
  </div>`;
}
function qr(url) { try { const g = qrcode(0, 'M'); g.addData(url); g.make(); return `<div class="qr">${g.createSvgTag(4, 0)}</div>`; } catch { return ''; } }

// ---------------------------------------------------------------- render
function key(list) {
  const s = list.find((x) => x.id === sid);
  return JSON.stringify([view, sel, attach.length, toast && toast.msg, voice.state, Math.round(voice.progress * 50), view === 'detail' && voice.state === 'recording' ? Math.round(voice.level * 8) + (Date.now() >> 7) : 0,
    ['settings', 'welcome', 'new', 'list'].includes(view) ? [inf, L.step, L.setup, L.harness, L.model, L.modelQ, L.folder, L.busy, L.err, L.modelsSrc, L.harnesses && L.harnesses.length, L.testText] : 0,
    list.map((x) => [x.id, x.status, x.title, x.project, x.live, x.exited, x.question, x.pending && x.pending.at, x.model, x.status === 'working' ? ago(x.since) : 0]),
    s && [s.prompt, s.reply, s.note, view === 'detail' && !s.reply && s.status !== 'working' ? s.tail : 0, ago(s.since)]]);
}
function render() {
  const list = R.sessions;
  const k = key(list);
  if (k === lastKey) return;
  lastKey = k;
  const act = document.activeElement;
  const focusId = act && act.id, caret = act && act.selectionStart;
  const scroll = document.querySelector('.body')?.scrollTop;
  const html = view === 'detail' ? vDetail(list.find((s) => s.id === sid)) : view === 'inbox' ? vInbox(list) : view === 'settings' ? vSettings()
    : view === 'new' ? vNew() : view === 'welcome' ? vWelcome() : vList(list);
  card.innerHTML = html + (toast ? `<div class="toast ${toast.kind}">${I.check}<span>${esc(toast.msg)}</span></div>` : '');
  if (scroll && ['settings', 'new'].includes(view)) { const b = document.querySelector('.body'); if (b) b.scrollTop = scroll; }
  const t2 = document.getElementById('ta');
  if (t2) grow(t2);
  const f = focusId && document.getElementById(focusId);
  if (f) { f.focus(); try { f.setSelectionRange(caret, caret); } catch {} }
  else if (t2 && desk && view === 'detail') { t2.focus(); try { t2.setSelectionRange(draft.length, draft.length); } catch {} }
  const th = document.getElementById('thread'); if (th) th.scrollTop = th.scrollHeight;
}
R.on(render);
setInterval(() => { if (view === 'list' || view === 'detail') render(); }, 1000);

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
const grow = (t) => { t.style.height = 'auto'; t.style.height = Math.min(140, t.scrollHeight) + 'px'; };
let actx; function chime(f = 880) { try { actx ||= new AudioContext(); const o = actx.createOscillator(), g = actx.createGain(); o.frequency.value = f; o.type = 'sine'; g.gain.setValueAtTime(0.0001, actx.currentTime); g.gain.exponentialRampToValueAtTime(0.06, actx.currentTime + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, actx.currentTime + 0.35); o.connect(g).connect(actx.destination); o.start(); o.stop(actx.currentTime + 0.4); } catch {} }
async function setCfg(patch) { if (!desk) return; inf = await desk.set(patch); lastKey = ''; render(); }

card.addEventListener('input', (e) => {
  const t = e.target;
  if (t.id === 'ta') { draft = t.value; grow(t); }
  if (t.id === 'mq') { L.modelQ = t.value; lastKey = ''; render(); }
  if (t.id === 'lp') L.prompt = t.value;
});
card.addEventListener('change', (e) => {
  const t = e.target;
  if (t.dataset.set) setCfg({ [t.dataset.set]: t.checked });
  if (t.dataset.sel) setCfg({ [t.dataset.sel]: t.value });
  if (t.dataset.range) setCfg({ [t.dataset.range]: +t.value });
  if (t.dataset.voice) { setCfg({ voice: { [t.dataset.voice]: t.value } }); Voice.configure({ [t.dataset.voice]: t.value }); }
});
card.addEventListener('keydown', (e) => {
  if (e.target.id === 'mq' && e.key === 'Enter') { const v = e.target.value.trim(); if (v) { L.model = v; L.modelQ = ''; lastKey = ''; render(); } }
});
card.addEventListener('click', async (e) => {
  const b = e.target.closest('button,[data-open],[data-delpreset]');
  if (!b) return;
  const d = b.dataset;
  if ('delpreset' in d) { e.stopPropagation(); const ps = [...inf.cfg.presets]; ps.splice(+d.delpreset, 1); return setCfg({ presets: ps }); }
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
  if ('mic' in d) return desk.talk(voice.state !== 'recording');
  if ('webmic' in d) return webTalk();
  if ('install' in d) { const o = document.getElementById('instOut'); o.textContent = 'Connecting…'; o.textContent = await desk.installHooks(); inf = await desk.info(); return; }
  if ('pick' in d) { const [k, v] = d.pick.split(':'); return setCfg({ [k]: v }); }
  if ('hk' in d) return captureHotkey(b, d.hk);
  if ('quit' in d) return desk.quit();
  // launcher
  if ('harness' in d) return pickHarness(d.harness);
  if ('refresh' in d) return pickHarness(L.harness, true);
  if ('model' in d) { L.model = d.model; L.modelQ = ''; lastKey = ''; return render(); }
  if ('folder' in d) { L.folder = d.folder; lastKey = ''; return render(); }
  if ('browse' in d) { const f = await desk.pickFolder(); if (f) { L.folder = f; lastKey = ''; render(); } return; }
  if ('launch' in d) return doLaunch({ harness: L.harness, model: L.model, cwd: L.folder, prompt: L.prompt });
  if ('savepreset' in d) {
    const h = L.harnesses.find((x) => x.id === L.harness);
    const name = `${h.name}${L.model ? ' · ' + shortModel(L.model) : ''} · ${L.folder.split(/[\\/]/).pop()}`;
    await setCfg({ presets: [...(inf.cfg.presets || []), { name, harness: L.harness, model: L.model, cwd: L.folder }].slice(-8) });
    return say('Saved to quick start');
  }
  if ('preset' in d) { const p = inf.cfg.presets[+d.preset]; return doLaunch({ harness: p.harness, model: p.model, cwd: p.cwd, prompt: '' }); }
  // voice quality
  if ('vlevel' in d) { await setCfg({ voice: { level: d.vlevel } }); Voice.configure({ level: d.vlevel }); Voice.preload(); return; }
  if ('testmic' in d) {
    if (voice.state === 'recording') { const r = await Voice.stop(); L.testText = r.text || '(heard nothing)'; lastKey = ''; render(); }
    else { L.testText = ''; try { await Voice.start(); } catch (err) { L.testText = 'Microphone blocked: ' + err.message; lastKey = ''; render(); } }
    return;
  }
  // welcome
  if ('wnext' in d || 'wskip' in d) { L.step = Math.min(3, L.step + 1); if (L.step === 2) Voice.preload(); lastKey = ''; return render(); }
  if ('wsetup' in d) {
    L.setup = { busy: true }; lastKey = ''; render();
    try { await desk.setup(); L.setup = { done: true }; } catch (err) { L.setup = { err: err.message }; }
    inf = await desk.info(); lastKey = ''; return render();
  }
  if ('wdone' in d) { await setCfg({ onboarded: true, openAtLogin: true }); return go('list'); }
  if ('wfirst' in d) { await setCfg({ onboarded: true, openAtLogin: true }); return go('new'); }
  if ('rewelcome' in d) { L.step = 0; L.setup = null; if (!L.harnesses) L.harnesses = await desk.agents(); return go('welcome'); }
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
  if (['SELECT', 'INPUT'].includes(e.target.tagName) && e.key !== 'Escape') return;
  if (e.key === 'Escape') {
    if (voice.state === 'recording') { Voice.cancel(); desk && desk.voiceState('idle'); return; }
    if (view === 'detail' && s && s.pending) { R.send({ t: 'undo', sid }); e.preventDefault(); return; }
    if (view === 'welcome') return;
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
    if (e.key === 'n' && desk) go('new');
  }
  if (view === 'new' && e.key === 'Enter' && e.ctrlKey && L.folder) doLaunch({ harness: L.harness, model: L.model, cwd: L.folder, prompt: L.prompt });
});

// ---------------------------------------------------------------- boot
if (desk) {
  Voice.on((st) => { voice = st; if (['welcome', 'settings', 'detail'].includes(view)) render(); });
  desk.info().then((i) => {
    inf = i;
    Voice.configure(i.cfg.voice);
    if (i.cfg.onboarded) Voice.preload();
    lastKey = ''; render();
  });
  desk.on('info', (i) => { inf = i; lastKey = ''; render(); });
  desk.on('open', async ({ view: v, sid: id }) => {
    sel = 0;
    if (v === 'welcome' && !L.harnesses) L.harnesses = await desk.agents();
    go(v || 'list', id || null);
  });
  desk.on('voice', async ({ cmd, autoSend }) => {
    if (cmd === 'start') {
      try { await Voice.start(); desk.voiceState('listening'); }
      catch (err) { desk.voiceState('idle'); say('Microphone unavailable', 'bad'); }
    }
    if (cmd === 'stop' && voice.state === 'recording') {
      const r = await Voice.stop();
      desk.voiceState('idle');
      if (!r.text) { say('Didn’t catch that', 'bad'); return; }
      draft = (draft ? draft + ' ' : '') + r.text;
      lastKey = ''; render();
      if (autoSend && cur() && view === 'detail') sendAnswer({ text: draft });
    }
  });
}
let prevNeed = 0;
R.on((list) => { const n = list.filter(needs).length; if (n > prevNeed && inf && inf.cfg.sounds) chime(); prevNeed = n; });

// phone: browser speech recognition
let rec = null;
function webTalk() {
  if (rec) { rec.stop(); return; }
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  rec = new SR(); rec.interimResults = true; rec.continuous = false;
  voice = { ...voice, state: 'recording', level: 0.3 }; lastKey = ''; render();
  rec.onresult = (e) => { draft = [...e.results].map((r) => r[0].transcript).join(' '); };
  rec.onend = () => { rec = null; voice = { ...voice, state: 'idle' }; lastKey = ''; render(); };
  rec.start();
}
