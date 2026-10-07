#!/usr/bin/env node
// relay — launch any coding agent so Relay can see and answer it.
//   relay claude [args]      relay codex [args]      relay opencode [args]     relay <any command>
//   relay install            wire Claude Code + Codex hooks (run once per machine, incl. your VPS)
//   relay hook <claude|codex> (called by the agents themselves)
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const HOME = path.join(os.homedir(), '.relay');
const SELF = path.resolve(__filename);
const HUB = (process.env.RELAY_HUB || 'http://127.0.0.1:7777').replace(/\/$/, '');
const token = () => process.env.RELAY_TOKEN || (() => { try { return fs.readFileSync(path.join(HOME, 'token'), 'utf8').trim(); } catch { return ''; } })();
const host = () => process.env.RELAY_HOST_LABEL || os.hostname();

const [cmd, ...rest] = process.argv.slice(2);

if (!cmd || cmd === '-h' || cmd === '--help') {
  console.log(`relay <agent> [args]   e.g. relay claude | relay codex | relay opencode
relay install          add Claude Code + Codex hooks for this machine
relay hook <kind>      (internal)

Remote (VPS):  ssh -R 7777:127.0.0.1:7777 you@vps   then on the VPS:
               export RELAY_TOKEN=<token from Relay > More>   and run  relay claude`);
  process.exit(0);
}

// ---------------------------------------------------------------- run
function run(agent, args) {
  let pty;
  try { pty = require('node-pty'); }
  catch { try { pty = require('@homebridge/node-pty-prebuilt-multiarch'); } catch { console.error('relay: node-pty missing. Run `npm install` in the relay cli folder.'); process.exit(1); } }
  const WebSocket = require('ws');

  const id = crypto.randomBytes(6).toString('hex');
  const env = { ...process.env, RELAY_SID: id, RELAY_HUB: HUB, RELAY_TOKEN: token(), RELAY_AGENT: path.basename(agent).replace(/\.(cmd|exe|bat|ps1)$/i, '') };
  const cols = process.stdout.columns || 120, rows = process.stdout.rows || 32;
  const win = process.platform === 'win32';
  const term = pty.spawn(win ? (process.env.COMSPEC || 'cmd.exe') : agent, win ? ['/d', '/s', '/c', [agent, ...args].map(q).join(' ')] : args,
    { name: 'xterm-256color', cols, rows, cwd: process.cwd(), env, useConpty: true });

  // hub link (reconnects; agent keeps working if Relay is closed)
  let ws = null, buf = '', flushT = null, closed = false;
  const send = (o) => { if (ws && ws.readyState === 1) ws.send(JSON.stringify(o)); };
  const connect = () => {
    if (closed) return;
    ws = new WebSocket(`${HUB.replace(/^http/, 'ws')}/ws?role=agent&token=${encodeURIComponent(token())}`);
    ws.on('open', () => send({ t: 'hello', id, agent: path.basename(agent).replace(/\.(cmd|exe|bat)$/i, ''), cwd: process.cwd(), host: host(), args }));
    ws.on('message', async (raw) => {
      let m; try { m = JSON.parse(raw); } catch { return; }
      if (m.t === 'keys') for (const part of m.seq) { if (part) term.write(part); await sleep(140); }
    });
    ws.on('close', () => setTimeout(connect, 3000));
    ws.on('error', () => {});
  };
  connect();

  term.onData((d) => {
    process.stdout.write(d);
    buf += d;
    if (!flushT) flushT = setTimeout(() => { flushT = null; send({ t: 'out', d: buf.slice(-8000) }); buf = ''; }, 250);
  });
  term.onExit(({ exitCode }) => {
    send({ t: 'exit', code: exitCode }); closed = true;
    setTimeout(() => { try { ws && ws.close(); } catch {} process.exit(exitCode || 0); }, 150);
  });

  if (process.stdin.isTTY) process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stdin.on('data', (d) => { term.write(d.toString('utf8')); if (d.includes(13)) send({ t: 'in' }); });
  process.stdout.on('resize', () => term.resize(process.stdout.columns, process.stdout.rows));
}
const q = (a) => (/[\s"&|<>^]/.test(a) ? `"${a.replace(/"/g, '\\"')}"` : a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------- hooks
async function post(ev) {
  try {
    await fetch(`${HUB}/hook`, {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-relay-token': token() },
      body: JSON.stringify({ host: host(), ...ev }), signal: AbortSignal.timeout(1500),
    });
  } catch {}
}
const readStdin = () => new Promise((r) => { let s = ''; process.stdin.on('data', (c) => (s += c)); process.stdin.on('end', () => r(s)); setTimeout(() => r(s), 2000); });

async function hookMain([kind, ...extra]) {
  if (kind === 'claude') {
    // Claude Code and Grok (Grok reads ~/.claude/settings.json hooks; it adds camelCase fields)
    let p; try { p = JSON.parse(await readStdin()); } catch { return; }
    const grok = 'hookEventName' in p || 'workspaceRoot' in p || 'lastAssistantMessage' in p;
    const agent = process.env.RELAY_AGENT || (grok ? 'grok' : 'claude');
    const sessionId = p.session_id || p.sessionId || '';
    const sid = process.env.RELAY_SID || `${agent}-${String(sessionId).slice(0, 12)}`;
    const base = { sid, agent, cwd: p.cwd || p.workspaceRoot };
    const ev = p.hook_event_name || p.hookEventName;
    const tool = p.tool_name || p.toolName || '';
    const input = p.tool_input || p.toolInput || {};
    switch (ev) {
      case 'SessionStart': return post({ ...base, kind: 'start' });
      case 'UserPromptSubmit': return post({ ...base, kind: 'prompt', text: p.prompt || p.userPrompt || '' });
      case 'PreToolUse':
        if (/ask/i.test(tool) && Array.isArray(input.questions)) return post({ ...base, kind: 'question', questions: input.questions.map(normQ) });
        return;
      case 'Notification': {
        const t = p.notification_type || p.notificationType || '';
        if (t === 'idle_prompt') return post({ ...base, kind: 'stop', text: '' });
        return post({ ...base, kind: 'notify', text: p.message || t });
      }
      case 'Stop':
        if (p.reason && p.reason !== 'end_turn' && grok) return;
        return post({ ...base, kind: 'stop', text: p.lastAssistantMessage || p.last_assistant_message || lastAssistant(p.transcript_path) });
      case 'StopFailure': return post({ ...base, kind: 'notify', text: `Stopped: ${p.error || 'error'}${p.errorDetails ? ' · ' + String(p.errorDetails).slice(0, 160) : ''}` });
      case 'StopCancelled': return post({ ...base, kind: 'stop', text: p.lastAssistantMessage || '' });
      case 'SessionEnd': return post({ ...base, kind: 'end' });
    }
  } else if (kind === 'codex') {
    try { // pass the event on to any notify program Relay replaced
      const prev = JSON.parse(fs.readFileSync(path.join(HOME, 'codex-prev-notify.json'), 'utf8'));
      if (Array.isArray(prev) && prev.length) require('child_process').spawn(prev[0], [...prev.slice(1), ...extra], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
    } catch {}
    let p; try { p = JSON.parse(extra[extra.length - 1]); } catch { return; }
    if (p.type !== 'agent-turn-complete') return;
    const sid = process.env.RELAY_SID || `codex-${String(p['thread-id'] || p['turn-id'] || 'x').slice(0, 12)}`;
    const inputs = p['input-messages'] || [];
    return post({ sid, agent: 'codex', cwd: p.cwd, kind: 'turn', text: p['last-assistant-message'] || '', prompt: inputs[inputs.length - 1] || '' });
  }
}

function normQ(q) {
  return { question: q.question || q.text || '', header: q.header || '', multiSelect: !!(q.multiSelect || q.multi),
    options: (q.options || []).map((o) => (typeof o === 'string' ? { label: o } : { label: o.label, description: o.description || '' })) };
}

function lastAssistant(file) {
  try {
    const lines = fs.readFileSync(file, 'utf8').trim().split('\n').reverse();
    for (const l of lines) {
      const e = JSON.parse(l);
      if (e.type === 'assistant' && e.message && Array.isArray(e.message.content)) {
        const t = e.message.content.filter((c) => c.type === 'text').map((c) => c.text).join('\n').trim();
        if (t) return t.slice(0, 4000);
      }
    }
  } catch {}
  return '';
}

// ---------------------------------------------------------------- install
function install() {
  const node = process.execPath;
  const hookCmd = (k) => `"${node}" "${SELF}" hook ${k}`;

  // Claude Code: ~/.claude/settings.json
  const cdir = path.join(os.homedir(), '.claude');
  const cfile = path.join(cdir, 'settings.json');
  fs.mkdirSync(cdir, { recursive: true });
  let cs = {};
  try { cs = JSON.parse(fs.readFileSync(cfile, 'utf8')); fs.copyFileSync(cfile, cfile + '.relay-backup'); } catch {}
  cs.hooks = cs.hooks || {};
  const events = { SessionStart: '', UserPromptSubmit: '', PreToolUse: 'AskUserQuestion|ask_user.*|ask', Notification: '', Stop: '', StopFailure: '', StopCancelled: '', SessionEnd: '' };
  for (const [ev, matcher] of Object.entries(events)) {
    const list = (cs.hooks[ev] = (cs.hooks[ev] || []).filter((g) => !JSON.stringify(g).includes(' hook claude')));
    list.push({ matcher, hooks: [{ type: 'command', command: hookCmd('claude'), timeout: 5 }] });
  }
  fs.writeFileSync(cfile, JSON.stringify(cs, null, 2));
  console.log('✓ Claude Code hooks →', cfile);

  // Codex: ~/.codex/config.toml  notify = [...]  (existing notify program is kept and chained)
  const xdir = path.join(os.homedir(), '.codex');
  const xfile = path.join(xdir, 'config.toml');
  fs.mkdirSync(xdir, { recursive: true });
  let toml = ''; try { toml = fs.readFileSync(xfile, 'utf8'); fs.copyFileSync(xfile, xfile + '.relay-backup'); } catch {}
  const line = `notify = [${JSON.stringify(node)}, ${JSON.stringify(SELF)}, "hook", "codex"]`;
  const m = toml.match(/^\s*notify\s*=\s*(\[[^\]]*\])\s*$/m);
  if (m && !m[1].includes('"hook", "codex"') && !m[1].includes("'hook', 'codex'")) {
    try {
      const prev = JSON.parse(m[1].replace(/'/g, '"'));
      fs.mkdirSync(HOME, { recursive: true });
      fs.writeFileSync(path.join(HOME, 'codex-prev-notify.json'), JSON.stringify(prev));
      console.log('✓ Kept your existing Codex notify program (Relay passes events on to it)');
    } catch { console.log('! Could not parse existing Codex notify; it was replaced (backup: config.toml.relay-backup)'); }
  }
  toml = toml.replace(/^\s*notify\s*=.*$/m, '').trimEnd();
  const i = toml.search(/^\[/m);
  toml = i === -1 ? `${toml}\n${line}\n` : `${toml.slice(0, i)}${line}\n\n${toml.slice(i)}`;
  fs.writeFileSync(xfile, toml.replace(/^\n+/, ''));
  console.log('✓ Codex notify →', xfile);
  // omp (oh-my-pi): auto-discovered extension
  const odir = path.join(os.homedir(), '.omp', 'agent', 'extensions');
  try {
    fs.mkdirSync(odir, { recursive: true });
    fs.copyFileSync(path.join(__dirname, 'integrations', 'omp-relay.ts'), path.join(odir, 'relay.ts'));
    console.log('✓ omp extension →', path.join(odir, 'relay.ts'));
  } catch (e) { console.log('! omp extension not installed:', e.message); }
  console.log('✓ Grok (Build + Grok Bot) uses the Claude-compatible hooks above');
  console.log('✓ OpenCode and anything else: works via `relay <command>` (activity detection).');
  console.log('\nNow start agents with:  relay claude   relay codex   relay opencode');
}

// dispatch (last, so every helper above is initialised)
if (cmd === 'hook') hookMain(rest).finally(() => process.exit(0));
else if (cmd === 'install') install();
else run(cmd, rest);
