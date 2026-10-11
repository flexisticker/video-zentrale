// Grafikkarte (NVIDIA NVENC) zum Kodieren nutzen – mit Rückfall auf den Prozessor (libx264).
// In Unraid: Extra Parameters --runtime=nvidia, NVIDIA_VISIBLE_DEVICES=all, NVIDIA_DRIVER_CAPABILITIES=all.
import { spawn } from 'node:child_process';

let state = { checked: false, nvenc: false, error: '' };

function probe() {
  return new Promise((resolve) => {
    let err = '';
    const p = spawn('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=black:s=640x360:d=0.2',
      '-c:v', 'h264_nvenc', '-f', 'null', '-'], { stdio: ['ignore', 'ignore', 'pipe'] });
    p.stderr.on('data', (d) => { err += d; });
    p.on('error', (e) => resolve({ ok: false, err: e.message }));
    p.on('close', (c) => resolve({ ok: c === 0, err }));
  });
}

export async function check() {
  if (process.env.NO_GPU) { state = { checked: true, nvenc: false, error: 'abgeschaltet (NO_GPU)' }; return state; }
  const r = await probe();
  const lines = r.err.trim().split('\n').filter(Boolean);
  const why = lines.find((l) => /nvenc|cuda|libnvidia|Cannot load|No capable|driver/i.test(l)) || lines[0] || 'nicht verfügbar';
  state = { checked: true, nvenc: r.ok, error: r.ok ? '' : why.replace(/^\[[^\]]*\]\s*/, '').slice(0, 200) };
  return state;
}

export const status = () => ({ ...state });

// Encoder-Argumente für H.264 in guter Qualität
export function videoArgs(useGpu = state.nvenc) {
  return useGpu
    ? ['-c:v', 'h264_nvenc', '-preset', 'p5', '-rc', 'vbr', '-cq', '23', '-b:v', '0', '-pix_fmt', 'yuv420p']
    : ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '21', '-pix_fmt', 'yuv420p'];
}

// Erst mit Grafikkarte versuchen; schlägt das fehl, einmal mit dem Prozessor.
export async function encodeWithFallback(run) {
  if (state.nvenc) {
    const r = await run(videoArgs(true));
    if (r.code === 0) return { ...r, gpu: true };
    if (/nvenc|cuda|nvcuvid|No capable devices|OpenEncodeSessionEx|libnvidia/i.test(r.err)) {
      state = { ...state, nvenc: false, error: 'Fehler beim Kodieren auf der Grafikkarte – weiter mit Prozessor' };
    } else return r;
  }
  return { ...(await run(videoArgs(false))), gpu: false };
}
