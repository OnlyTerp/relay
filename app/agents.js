// Harness registry: detection, live model lists, and launching agents in a terminal.
const { execFile, spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const HOME = path.join(os.homedir(), '.relay');
const CACHE = path.join(HOME, 'models.json');

// flag: how to pass a model. prompt: how to pass a first message (null = not supported).
// list: command that prints models, parse: turn its stdout into ids. suggest: fallback picks.
const HARNESSES = [
  { id: 'omp', name: 'omp', desc: 'oh-my-pi · every provider', bin: 'omp', flag: '--model', prompt: 'arg', exact: true,
    list: ['models'], parse: parseOmp },
  { id: 'grok', name: 'Grok', desc: 'Grok Build', bin: 'grok', flag: '-m', prompt: 'arg', exact: true,
    list: ['models'], parse: (o) => [...o.matchAll(/^\s*[-*]\s+([\w.\-/:]+)/gm)].map((m) => m[1]) },
  { id: 'claude', name: 'Claude Code', desc: 'Anthropic', bin: 'claude', flag: '--model', prompt: 'arg', exact: true,
    suggest: ['opus', 'sonnet', 'haiku'] },
  { id: 'codex', name: 'Codex', desc: 'OpenAI', bin: 'codex', flag: '-m', prompt: 'arg', exact: true,
    suggest: [], fromConfig: () => { try { const m = fs.readFileSync(path.join(os.homedir(), '.codex', 'config.toml'), 'utf8').match(/^\s*model\s*=\s*"([^"]+)"/m); return m ? [m[1]] : []; } catch { return []; } } },
  { id: 'opencode', name: 'OpenCode', desc: 'any provider', bin: 'opencode', flag: '-m', prompt: '--prompt',
    list: ['models'], parse: (o) => o.split(/\r?\n/).map((l) => l.trim()).filter((l) => /^[\w.-]+\/[\w.:-]+$/.test(l)) },
  { id: 'cursor-agent', name: 'Cursor Agent', desc: 'Cursor', bin: 'cursor-agent', flag: '--model', prompt: 'arg',
    list: ['--list-models'], parse: (o) => [...o.matchAll(/^\s*(?:[-*•]\s*)?([a-z0-9][\w.\-]+(?:\[[^\]]*\])?)(?:\s+-|\s*$)/gim)].map((m) => m[1]).filter((x) => !/^(available|models?|usage)$/i.test(x)) },
  { id: 'gemini', name: 'Gemini CLI', desc: 'Google', bin: 'gemini', flag: '-m', prompt: null,
    suggest: [] },
  { id: 'aider', name: 'Aider', desc: 'any provider', bin: 'aider', flag: '--model', prompt: null, suggest: [] },
  { id: 'droid', name: 'Droid', desc: 'Factory', bin: 'droid', flag: null, prompt: null, suggest: [] },
  { id: 'qwen', name: 'Qwen Code', desc: 'Alibaba', bin: 'qwen', flag: '-m', prompt: null, suggest: [] },
  { id: 'amp', name: 'Amp', desc: 'Sourcegraph', bin: 'amp', flag: null, prompt: null, suggest: [] },
];

function parseOmp(out) {
  // tables grouped by "provider (N)"; ids become provider/model
  const ids = [];
  let provider = null;
  for (const line of out.split(/\r?\n/)) {
    const h = line.match(/^([a-z0-9][\w.\-]*)\s+\(\d+\)\s*$/i);
    if (h) { provider = h[1]; continue; }
    const r = line.match(/^│\s*([^│\s][^│]*?)\s*│/);
    if (r && provider && r[1] !== 'model') ids.push(`${provider}/${r[1]}`);
  }
  return ids;
}

const run = (cmd, args, ms = 20000) => new Promise((res) => {
  execFile(cmd, args, { timeout: ms, windowsHide: true, shell: process.platform === 'win32', maxBuffer: 8e6, env: { ...process.env, NO_COLOR: '1', FORCE_COLOR: '0' } },
    (err, out, errOut) => res({ ok: !err, out: String(out || '') + String(errOut || '') }));
});

async function which(bin) {
  const r = await run(process.platform === 'win32' ? 'where' : 'which', [bin], 5000);
  const first = r.out.split(/\r?\n/).map((s) => s.trim()).find(Boolean);
  return r.ok && first ? first : null;
}

let detected = null;
async function detect(force = false) {
  if (detected && !force) return detected;
  const res = await Promise.all(HARNESSES.map(async (h) => ({ ...pub(h), path: await which(h.bin) })));
  detected = res;
  return res;
}
const pub = (h) => ({ id: h.id, name: h.name, desc: h.desc, flag: !!h.flag, prompt: !!h.prompt, exact: !!h.exact, canList: !!h.list });

function readCache() { try { return JSON.parse(fs.readFileSync(CACHE, 'utf8')); } catch { return {}; } }
function writeCache(c) { fs.mkdirSync(HOME, { recursive: true }); fs.writeFileSync(CACHE, JSON.stringify(c)); }

async function models(id, refresh = false) {
  const h = HARNESSES.find((x) => x.id === id);
  if (!h) return { models: [], source: 'none' };
  const cache = readCache();
  if (!refresh && cache[id] && Date.now() - cache[id].at < 6 * 3600e3) return { models: cache[id].models, source: 'cache' };
  if (h.list) {
    const r = await run(h.bin, h.list, 30000);
    const list = [...new Set(h.parse(r.out.replace(/\x1b\[[0-9;]*m/g, '')))];
    if (list.length) { cache[id] = { at: Date.now(), models: list }; writeCache(cache); return { models: list, source: 'live' }; }
  }
  return { models: [...new Set([...(h.fromConfig ? h.fromConfig() : []), ...(h.suggest || [])])], source: 'suggested' };
}

// ---------------------------------------------------------------- launch
const q = (s) => (/[\s&|<>^"]/.test(s) ? `"${String(s).replace(/"/g, '""')}"` : s);
function relayCommand(cliDir) {
  // Prefer system node; fall back to Electron-as-node (installer users may not have node on PATH).
  return { node: process.env.RELAY_NODE || 'node', script: path.join(cliDir, 'relay.js') };
}
let lastLaunch = { key: '', at: 0 };
async function launch({ harness, model, cwd, prompt, title }, cliDir) {
  const k = JSON.stringify([harness, model, cwd, prompt]);
  if (k === lastLaunch.key && Date.now() - lastLaunch.at < 5000) return { ok: true, deduped: true };
  lastLaunch = { key: k, at: Date.now() };
  const h = HARNESSES.find((x) => x.id === harness);
  if (!h) throw new Error('Unknown harness');
  if (!cwd || !fs.existsSync(cwd)) throw new Error('Pick a folder that exists');
  const args = [];
  if (model && h.flag) args.push(h.flag, model);
  if (prompt && h.prompt === 'arg') args.push(prompt);
  if (prompt && h.prompt && h.prompt !== 'arg') args.push(h.prompt, prompt);
  const { node, script } = relayCommand(cliDir);
  const hasNode = (await which('node')) !== null;
  const prefix = hasNode ? `${q(node)} ${q(script)}` : `set ELECTRON_RUN_AS_NODE=1&& ${q(process.execPath)} ${q(script)}`;
  const line = `${prefix} ${h.bin} ${args.map(q).join(' ')}`.trim();
  const name = title || `${h.name}${model ? ' · ' + model.split('/').pop() : ''}`;
  if (process.platform !== 'win32') {
    spawn('x-terminal-emulator', ['-e', `bash -lc ${JSON.stringify(`cd ${JSON.stringify(cwd)} && ${line}`)}`], { detached: true, stdio: 'ignore' }).unref();
    return { ok: true, line };
  }
  const wt = await which('wt');
  if (wt) {
    spawn(wt, ['-w', '0', 'new-tab', '--title', name, '-d', cwd, 'cmd', '/k', line], { detached: true, stdio: 'ignore', windowsHide: false }).unref();
  } else {
    spawn('cmd.exe', ['/c', 'start', JSON.stringify(name), '/D', cwd, 'cmd', '/k', line], { detached: true, stdio: 'ignore', windowsVerbatimArguments: true }).unref();
  }
  return { ok: true, line };
}

// ---------------------------------------------------------------- `relay` on PATH (no npm needed)
async function ensureShim(cliDir) {
  if (process.platform !== 'win32') return { ok: false };
  const bin = path.join(HOME, 'bin');
  fs.mkdirSync(bin, { recursive: true });
  const script = path.join(cliDir, 'relay.js');
  // if/else, not && ||: an agent that exits with an error must not be started a second time.
  const shim = `@echo off\r\nwhere node >nul 2>nul\r\nif %errorlevel%==0 (\r\n  node "${script}" %*\r\n) else (\r\n  set ELECTRON_RUN_AS_NODE=1\r\n  "${process.execPath}" "${script}" %*\r\n)\r\n`;
  fs.writeFileSync(path.join(bin, 'relay.cmd'), shim);
  const ps = `$p=[Environment]::GetEnvironmentVariable('Path','User'); if(-not $p){$p=''}; if(($p -split ';') -notcontains '${bin}'){[Environment]::SetEnvironmentVariable('Path', ($p.TrimEnd(';')+';${bin}').TrimStart(';'), 'User'); 'added'} else {'present'}`;
  const r = await run('powershell.exe', ['-NoProfile', '-Command', ps], 15000);
  return { ok: true, bin, path: r.out.trim() };
}

module.exports = { HARNESSES, detect, models, launch, ensureShim };
