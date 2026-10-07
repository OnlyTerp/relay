// Mic capture + local Whisper. window.Voice.start() / stop() → text
window.Voice = (() => {
  let worker = null, stream = null, ctx = null, node = null, chunks = [], rate = 48000, level = 'balanced', language = 'english';
  let status = { state: 'idle', progress: 0, device: '' };
  const subs = new Set();
  const emit = (s) => { status = { ...status, ...s }; subs.forEach((f) => f(status)); };
  const waiters = new Map();
  let seq = 0;

  function ensureWorker() {
    if (worker) return worker;
    worker = new Worker('/stt-worker.js', { type: 'module' });
    worker.onmessage = ({ data }) => {
      if (data.type === 'progress') emit({ state: 'downloading', progress: data.progress, total: data.total, device: data.device });
      if (data.type === 'ready') emit({ state: 'ready', progress: 1, device: data.device, level: data.level });
      if (data.type === 'error') { emit({ state: 'error', error: data.message }); const w = waiters.get(data.id); if (w) { waiters.delete(data.id); w.reject(new Error(data.message)); } }
      if (data.type === 'text') { const w = waiters.get(data.id); if (w) { waiters.delete(data.id); w.resolve(data); } }
    };
    return worker;
  }

  function configure(opts = {}) {
    if (opts.level) level = opts.level;
    if (opts.language) language = opts.language;
  }
  function preload() { ensureWorker().postMessage({ type: 'load', level }); }

  async function start() {
    ensureWorker();
    stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
    ctx = new AudioContext();
    rate = ctx.sampleRate;
    const src = ctx.createMediaStreamSource(stream);
    node = ctx.createScriptProcessor(4096, 1, 1);
    chunks = [];
    node.onaudioprocess = (e) => {
      const d = e.inputBuffer.getChannelData(0);
      chunks.push(new Float32Array(d));
      let s = 0; for (let i = 0; i < d.length; i += 16) s += d[i] * d[i];
      emit({ state: 'recording', level: Math.min(1, Math.sqrt(s / (d.length / 16)) * 6) });
    };
    src.connect(node); node.connect(ctx.destination);
    emit({ state: 'recording', level: 0 });
  }

  async function stop() {
    if (!ctx) return { text: '' };
    const n = chunks.reduce((a, c) => a + c.length, 0);
    const all = new Float32Array(n); let o = 0; for (const c of chunks) { all.set(c, o); o += c.length; }
    try { node.disconnect(); } catch {}
    stream.getTracks().forEach((t) => t.stop());
    await ctx.close(); ctx = null; node = null; stream = null;
    if (n < rate * 0.3) { emit({ state: 'ready' }); return { text: '' }; }
    // resample to 16 kHz mono for Whisper
    const off = new OfflineAudioContext(1, Math.ceil(n * 16000 / rate), 16000);
    const buf = off.createBuffer(1, n, rate); buf.copyToChannel(all, 0);
    const s = off.createBufferSource(); s.buffer = buf; s.connect(off.destination); s.start();
    const audio = (await off.startRendering()).getChannelData(0);
    emit({ state: 'transcribing' });
    const id = ++seq;
    const p = new Promise((resolve, reject) => waiters.set(id, { resolve, reject }));
    worker.postMessage({ type: 'transcribe', id, audio, level, language }, [audio.buffer]);
    try { const r = await p; emit({ state: 'ready' }); return r; } catch (e) { emit({ state: 'error', error: e.message }); return { text: '' }; }
  }

  const cancel = async () => { try { node && node.disconnect(); stream && stream.getTracks().forEach((t) => t.stop()); ctx && (await ctx.close()); } catch {} ctx = null; emit({ state: 'ready' }); };
  return { configure, preload, start, stop, cancel, on: (f) => (subs.add(f), f(status)), get status() { return status; } };
})();
