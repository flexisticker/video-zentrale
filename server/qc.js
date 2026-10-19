// Render-Prüfung: Bevor ein Short in die Freigabe kommt, wird die fertige Datei geprüft.
//  1. Maschine (kostenlos): schwarze Stellen, eingefrorenes Bild, lange Stille, Lautheit/Spitzen, Länge
//  2. Claude sieht einen Kontaktbogen des FERTIGEN Clips: Untertitel lesbar? Gesicht verdeckt/abgeschnitten?
//     Action im Bild? Hook sichtbar? Ende sauber? → Hinweise + Überarbeitungswunsch (fließt in die automatische v2)
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { db, DATA_DIR } from './store.js';
import * as vision from './vision.js';
import * as ai from './ai.js';

const TMP = path.join(DATA_DIR, 'tmp');

function probe(file) {
  return new Promise((resolve) => {
    let err = '';
    const p = spawn('nice', ['-n', '15', 'ffmpeg', '-hide_banner', '-nostdin', '-i', file,
      '-vf', 'blackdetect=d=0.5:pix_th=0.10,freezedetect=n=-60dB:d=2.5', '-af', 'silencedetect=n=-50dB:d=2.5,ebur128=peak=true', '-f', 'null', '-'],
    { stdio: ['ignore', 'ignore', 'pipe'] });
    p.stderr.on('data', (d) => { err = (err + d).slice(-200_000); });
    p.on('error', () => resolve(null));
    p.on('close', (c) => resolve(c === 0 ? err : null));
  });
}

// Maschinen-Prüfung → { issues[], lufs, peak }
export async function machine(file, { duration, freezes = 0 } = {}) {
  const log = await probe(file);
  if (!log) return { issues: ['Datei ließ sich nicht prüfen'], lufs: null, peak: null };
  const issues = [];
  const sum = (re) => [...log.matchAll(re)].reduce((s, m) => s + Number(m[1]), 0);
  const black = sum(/black_duration:\s*([\d.]+)/g);
  if (black >= 0.8) issues.push(`${black.toFixed(1)} s schwarzes Bild`);
  const frozen = sum(/freeze_duration:\s*([\d.]+)/g) - freezes * 1.2;
  if (frozen >= 2.5) issues.push(`${frozen.toFixed(1)} s eingefrorenes Bild`);
  const silent = sum(/silence_duration:\s*([\d.]+)/g);
  if (silent >= 2.5) issues.push(`${silent.toFixed(1)} s Stille`);
  const summary = log.slice(log.lastIndexOf('Summary:'));
  const lufs = Number((/I:\s*(-?[\d.]+) LUFS/.exec(summary) || [])[1]);
  const peak = Number((/Peak:\s*(-?[\d.]+) dBFS/.exec(summary) || [])[1]);
  if (Number.isFinite(lufs) && (lufs < -20 || lufs > -9)) issues.push(`Lautheit ${lufs.toFixed(1)} LUFS (Ziel −14)`);
  if (Number.isFinite(peak) && peak > -0.1) issues.push('Ton übersteuert');
  const dm = /Duration: (\d+):(\d+):([\d.]+)/.exec(log);
  const real = dm ? Number(dm[1]) * 3600 + Number(dm[2]) * 60 + Number(dm[3]) : null;
  if (duration && real && Math.abs(real - duration) > 1.5) issues.push(`Länge ${real.toFixed(1)} s statt ${duration.toFixed(1)} s`);
  return { issues, lufs: Number.isFinite(lufs) ? lufs : null, peak: Number.isFinite(peak) ? peak : null };
}

// Ganze Prüfung eines fertigen Shorts (nv = neuer Video-Eintrag, filePath = Datei). info: { duration, hook, layout, fxHow, title }
export async function check(nv, filePath, info = {}) {
  const res = { at: new Date().toISOString(), ok: true, issues: [], fixWish: '', score: null };
  try {
    const m = await machine(filePath, { duration: info.duration, freezes: info.freezes || 0 });
    res.issues.push(...m.issues); res.lufs = m.lufs;
  } catch (e) { res.issues.push('Prüfung: ' + e.message); }
  if (db().ai.apiKey && db().ai.qc !== false) {
    fs.mkdirSync(TMP, { recursive: true });
    const sheet = path.join(TMP, `${nv.id}-qc.jpg`);
    try {
      const vertical = !nv.width || nv.height >= nv.width;
      const ok = await vision.contactSheet(filePath, 0, Math.max(1, (info.duration || nv.duration || 30) - 0.2), sheet, { cols: 4, rows: 3, vertical, tile: vertical ? 200 : 320 });
      if (ok) {
        const r = await ai.reviewClip(sheet, { ...info, machine: res.issues });
        res.score = r.score; res.ok = r.ok; res.fixWish = r.fixWish; res.issues.push(...r.issues);
      }
    } catch (e) { res.issues.push('Claude-Prüfung: ' + e.message); }
    finally { fs.rmSync(sheet, { force: true }); }
  }
  if (res.issues.length && res.ok && res.issues.some((x) => /schwarz|eingefroren|übersteuert|Länge/.test(x))) res.ok = false;
  return res;
}
