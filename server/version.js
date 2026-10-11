// Versionierung: Version aus package.json, Build-Nummer/Commit/Datum setzt die GitHub Action (build-args).
// Update-Prüfung: liest die Labels des Tags :latest auf ghcr.io (Paket ist öffentlich → anonymer Lese-Token).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CHANGELOG } from './changelog.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));

export const APP_NAME = 'Micha’s Video-Zentrale';
export const VERSION = pkg.version;
export const BUILD = {
  version: pkg.version,
  build: process.env.BUILD_NUMBER || '',
  commit: (process.env.GIT_COMMIT || '').slice(0, 7),
  date: process.env.BUILD_DATE || '',
};

const REGISTRY = process.env.UPDATE_REGISTRY || 'https://ghcr.io';
const IMAGE = process.env.UPDATE_IMAGE || 'flexisticker/video-zentrale';
const TAG = process.env.UPDATE_TAG || 'latest';
let latest = { checkedAt: 0, version: '', build: '', error: '' };

// "1.10.0" > "1.9.2"
export function newer(a, b) {
  const pa = String(a || '').split('.').map(Number), pb = String(b || '').split('.').map(Number);
  for (let i = 0; i < 3; i++) { if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) > (pb[i] || 0); }
  return false;
}

async function fetchLatest() {
  const t = await fetch(`${REGISTRY}/token?scope=repository:${IMAGE}:pull&service=ghcr.io`);
  const { token } = await t.json().catch(() => ({}));
  const auth = token ? { Authorization: 'Bearer ' + token } : {};
  const accept = 'application/vnd.oci.image.index.v1+json, application/vnd.docker.distribution.manifest.list.v2+json, '
    + 'application/vnd.oci.image.manifest.v1+json, application/vnd.docker.distribution.manifest.v2+json';
  let r = await fetch(`${REGISTRY}/v2/${IMAGE}/manifests/${TAG}`, { headers: { ...auth, Accept: accept } });
  if (!r.ok) throw new Error('Registry ' + r.status);
  let m = await r.json();
  if (m.manifests) { // Index (mehrere Plattformen / Attestierungen) → amd64-Manifest
    const d = m.manifests.find((x) => x.platform?.architecture === 'amd64') || m.manifests[0];
    r = await fetch(`${REGISTRY}/v2/${IMAGE}/manifests/${d.digest}`, { headers: { ...auth, Accept: accept } });
    if (!r.ok) throw new Error('Registry ' + r.status);
    m = await r.json();
  }
  const c = await fetch(`${REGISTRY}/v2/${IMAGE}/blobs/${m.config.digest}`, { headers: auth });
  if (!c.ok) throw new Error('Registry ' + c.status);
  const labels = (await c.json()).config?.Labels || {};
  return { version: labels['de.flexisticker.version'] || '', build: labels['de.flexisticker.build'] || '', created: labels['org.opencontainers.image.created'] || '' };
}

export async function checkUpdate(force = false) {
  if (!force && Date.now() - latest.checkedAt < 6 * 3600_000 && latest.checkedAt) return latest;
  try { latest = { ...(await fetchLatest()), checkedAt: Date.now(), error: '' }; }
  catch (e) { latest = { ...latest, checkedAt: Date.now(), error: e.message }; }
  return latest;
}

export function info() {
  const upd = latest.version && (newer(latest.version, VERSION) || (latest.version === VERSION && latest.build && BUILD.build && Number(latest.build) > Number(BUILD.build)));
  return { name: APP_NAME, ...BUILD, latest: { ...latest }, updateAvailable: !!upd, changelog: CHANGELOG };
}

export function init() {
  if (process.env.NO_UPDATE_CHECK) return;
  setTimeout(() => checkUpdate(true), 20_000);
  setInterval(() => checkUpdate(true), 6 * 3600_000).unref();
}
