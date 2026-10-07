// Local Whisper speech-to-text (transformers.js). Runs off the UI thread.
import { pipeline, env } from '/vendor/transformers.min.js';

env.allowLocalModels = false;

const MODELS = {
  fast: 'onnx-community/whisper-base',
  balanced: 'onnx-community/whisper-small',
  best: 'onnx-community/whisper-large-v3-turbo',
};

let asr = null, loaded = null, loading = null, device = null;

async function pickDevice() {
  if (device) return device;
  try { device = (navigator.gpu && (await navigator.gpu.requestAdapter())) ? 'webgpu' : 'wasm'; } catch { device = 'wasm'; }
  return device;
}

async function load(level) {
  if (loaded === level && asr) return;
  if (loading) await loading;
  if (loaded === level && asr) return;
  const dev = await pickDevice();
  if (level === 'best' && dev !== 'webgpu') level = 'balanced'; // turbo is too slow on CPU
  const files = new Map();
  loading = pipeline('automatic-speech-recognition', MODELS[level], {
    device: dev,
    dtype: dev === 'webgpu'
      ? { encoder_model: level === 'best' ? 'fp16' : 'fp32', decoder_model_merged: 'q4' }
      : { encoder_model: 'fp32', decoder_model_merged: 'q4' },
    progress_callback: (p) => {
      if (p.status === 'progress' && p.file) {
        files.set(p.file, { loaded: p.loaded || 0, total: p.total || 0 });
        let l = 0, t = 0; for (const f of files.values()) { l += f.loaded; t += f.total; }
        postMessage({ type: 'progress', level, device: dev, progress: t ? l / t : 0, total: t });
      }
    },
  }).then(async (p) => {
    asr = p; loaded = level;
    await asr(new Float32Array(16000), { language: 'english' }).catch(() => {}); // warm up
  });
  try { await loading; postMessage({ type: 'ready', level, device: dev }); }
  catch (e) { postMessage({ type: 'error', message: String(e && e.message || e) }); throw e; }
  finally { loading = null; }
}

onmessage = async ({ data }) => {
  try {
    if (data.type === 'load') await load(data.level);
    if (data.type === 'transcribe') {
      await load(data.level);
      const t0 = performance.now();
      const opts = { task: 'transcribe', chunk_length_s: 30, stride_length_s: 5 };
      if (data.language && data.language !== 'auto') opts.language = data.language;
      const out = await asr(data.audio, opts);
      const text = (Array.isArray(out) ? out.map((o) => o.text).join(' ') : out.text || '').replace(/\s+/g, ' ').trim();
      postMessage({ type: 'text', id: data.id, text: /^\[?(blank_audio|silence|music)\]?$/i.test(text) ? '' : text, ms: Math.round(performance.now() - t0) });
    }
  } catch (e) { postMessage({ type: 'error', id: data.id, message: String(e && e.message || e) }); }
};
