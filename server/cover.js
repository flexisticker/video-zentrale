// Titelbild als erstes Bild ins Video (für Vorschauen, die das erste Bild zeigen – vor allem Shorts/TikTok).
// Das Original bleibt unverändert: beim Hochladen wird eine Kopie mit dem Titelbild vorne gebaut und danach gelöscht.
//   'bild' = genau ein Bild (beim Abspielen praktisch unsichtbar)   'kurz' = 0,4 s stehendes Titelbild
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { DATA_DIR } from './store.js';
import * as profiles from './profiles.js';
import * as gpu from './gpu.js';

export const MODES = { aus: 'aus', bild: 'als erstes Bild (unsichtbar beim Abspielen)', kurz: '0,4 Sekunden stehend' };
const TMP = path.join(DATA_DIR, 'tmp');

// Einstellung am Video (aus/bild/kurz) › Vorgabe des Kanals › aus
export function modeOf(v) {
  if (MODES[v.coverFrame]) return v.coverFrame;
  const p = profiles.effective(v);
  return MODES[p?.coverFrame] ? p.coverFrame : 'aus';
}

function probe(file) {
  return new Promise((resolve) => {
    let out = '';
    const p = spawn('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_type,width,height,avg_frame_rate', '-of', 'json', file], { stdio: ['ignore', 'pipe', 'ignore'] });
    p.stdout.on('data', (d) => { out += d; });
    p.on('error', () => resolve(null));
    p.on('close', () => {
      try {
        const s = JSON.parse(out).streams || [];
        const v = s.find((x) => x.codec_type === 'video');
        const [a, b] = String(v?.avg_frame_rate || '30/1').split('/').map(Number);
        const fps = b ? a / b : a;
        resolve({ w: v?.width, h: v?.height, fps: fps > 1 && fps < 241 ? fps : 30, audio: s.some((x) => x.codec_type === 'audio') });
      } catch { resolve(null); }
    });
  });
}

function ffmpeg(args) {
  return new Promise((resolve) => {
    let err = '';
    const p = spawn('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-nostdin', ...args], { stdio: ['ignore', 'ignore', 'pipe'] });
    p.stderr.on('data', (d) => { err = (err + d).slice(-3000); });
    p.on('error', (e) => resolve({ code: -1, err: e.message }));
    p.on('close', (code) => resolve({ code, err }));
  });
}

// → Pfad der Kopie mit Titelbild vorne (vom Aufrufer nach dem Upload zu löschen) oder null, wenn nicht gewünscht/möglich
export async function build(v, file, img, mode = modeOf(v)) {
  if (mode === 'aus' || !img || !fs.existsSync(img)) return null;
  const info = await probe(file);
  if (!info?.w || !info?.h) throw new Error('Titelbild vorne: Video nicht lesbar.');
  const even = (x) => Math.max(2, Math.round(x / 2) * 2);
  const W = even(info.w), H = even(info.h);
  const fps = Math.round(info.fps * 1000) / 1000;
  const dur = mode === 'kurz' ? 0.4 : 1 / fps;
  fs.mkdirSync(TMP, { recursive: true });
  const out = path.join(TMP, `${v.id}-titelbild-vorne${path.extname(file).toLowerCase() === '.mov' ? '.mov' : '.mp4'}`);
  // Titelbild in Videogröße: passt das Seitenverhältnis nicht (16:9-Bild auf Short), unscharf gefüllter Hintergrund
  let g = `[0:v]split[ca][cb];[ca]scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},boxblur=20:2,eq=brightness=-0.06[bg];`
    + `[cb]scale=${W}:${H}:force_original_aspect_ratio=decrease:flags=lanczos[fg];[bg][fg]overlay=(W-w)/2:(H-h)/2,`
    + `fps=${fps},trim=duration=${dur.toFixed(4)},setsar=1,format=yuv420p[c];`
    + `[1:v:0]scale=${W}:${H},fps=${fps},setsar=1,format=yuv420p[m];[c][m]concat=n=2:v=1:a=0[v]`;
  // Ton um genau diese Zeit nach hinten (bleibt synchron zum Bild)
  if (info.audio) g += `;[1:a:0]adelay=${Math.round(dur * 1000)}:all=1,aresample=48000[a]`;
  const r = await gpu.encodeWithFallback((venc) => ffmpeg(['-loop', '1', '-framerate', String(fps), '-t', (dur + 0.2).toFixed(3), '-i', img, '-i', file,
    '-filter_complex', g, '-map', '[v]', ...(info.audio ? ['-map', '[a]', '-c:a', 'aac', '-b:a', '192k'] : []), ...venc,
    '-movflags', '+faststart', '-y', out]), { hq: true });
  if (r.code !== 0) { fs.rmSync(out, { force: true }); throw new Error('Titelbild vorne: ' + (r.err.trim().split('\n').pop() || 'ffmpeg-Fehler')); }
  return out;
}
