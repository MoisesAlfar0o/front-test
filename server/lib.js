// Rutas, hashing SHA-256, aprobaciones y lectura de features. Zero-DB: todo en archivos.
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
export const APP = path.resolve(here, '..');
export const REPO = path.resolve(APP, '..');
export const DATA = path.join(APP, 'data');
export const RUNS = path.join(DATA, 'runs');
export const FEATURES = path.join(REPO, 'features');
export const STEPS = path.join(REPO, 'steps');
export const AUTH = path.join(REPO, 'test-results', '.auth', 'user.json');
export const AREAS = ['smoke', 'approvals', 'categories', 'channels', 'channels-catalog', 'collect-configurations', 'countries', 'debts', 'global-cutoff', 'notifications', 'packages', 'payment-event-trail', 'payments', 'providers', 'services', 'settlements', 'tax-types'];
const APPROVALS = path.join(DATA, 'approvals.json');
export const AREA_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
fs.mkdirSync(RUNS, { recursive: true });

export const httpErr = (status, message) => Object.assign(new Error(message), { status });
const norm = (s) => s.replace(/\r\n/g, '\n');
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
const posix = (p) => p.split(path.sep).join('/');

export async function readJson(file, fallback) {
  try { return JSON.parse(await fsp.readFile(file, 'utf8')); } catch { return fallback; }
}
export async function writeJson(file, data) {
  const tmp = file + '.tmp';
  await fsp.writeFile(tmp, JSON.stringify(data, null, 2));
  await fsp.rename(tmp, file);
}

async function walk(dir, ext) {
  const out = [];
  for (const e of await fsp.readdir(dir, { withFileTypes: true }).catch(() => [])) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...(await walk(p, ext)));
    else if (p.endsWith(ext)) out.push(p);
  }
  return out.sort();
}

// Evita path traversal: solo .feature dentro de features/
export function featurePath(id) {
  if (typeof id !== 'string' || !id.endsWith('.feature')) throw httpErr(400, 'id de feature inválido');
  const p = path.resolve(FEATURES, id);
  if (!p.startsWith(FEATURES + path.sep)) throw httpErr(400, 'ruta fuera de features/');
  return p;
}

async function stepsBlob() {
  let s = '';
  for (const p of await walk(STEPS, '.ts')) s += '\0' + posix(path.relative(REPO, p)) + '\0' + norm(await fsp.readFile(p, 'utf8'));
  return s;
}

// featureHash: solo el .feature. implHash: .feature + todos los steps/ (detecta deriva).
export async function hashes(id, blob) {
  const f = norm(await fsp.readFile(featurePath(id), 'utf8'));
  return { featureHash: sha(f), implHash: sha(f + (blob ?? (await stepsBlob()))) };
}

export function statusOf(entry, h) {
  if (!entry) return 'NOT_APPROVED';
  if (entry.featureHash !== h.featureHash) return 'CHANGED';
  if (!entry.implHash) return 'APPROVED';
  return entry.implHash === h.implHash ? 'VERIFIED' : 'IMPLEMENTATION_DRIFT';
}

export async function featureInfo(id) {
  const all = await readJson(APPROVALS, {});
  return { status: statusOf(all[id], await hashes(id)) };
}

export async function approve(id) {
  const h = await hashes(id);
  const all = await readJson(APPROVALS, {});
  all[id] = { featureHash: h.featureHash, approvedAt: new Date().toISOString() };
  await writeJson(APPROVALS, all);
}

export async function markVerified(id) {
  const h = await hashes(id);
  const all = await readJson(APPROVALS, {});
  all[id] = { ...all[id], featureHash: h.featureHash, implHash: h.implHash, verifiedAt: new Date().toISOString() };
  await writeJson(APPROVALS, all);
}

export async function listFeatures() {
  const all = await readJson(APPROVALS, {});
  const blob = await stepsBlob();
  const out = [];
  for (const p of await walk(FEATURES, '.feature')) {
    const id = posix(path.relative(FEATURES, p));
    const txt = await fsp.readFile(p, 'utf8');
    out.push({
      id,
      title: (txt.match(/^\s*Característica:\s*(.+)$/m) || [])[1] || id,
      tags: txt.split(/Característica:/)[0].match(/@[\w-]+/g) || [],
      fixme: /@fixme/.test(txt),
      status: statusOf(all[id], await hashes(id, blob)),
    });
  }
  return out;
}

// Áreas = lista base + carpetas que ya existan en features/ (cualquier área nueva aparece sola).
export async function listAreas() {
  const dirs = (await fsp.readdir(FEATURES, { withFileTypes: true }).catch(() => [])).filter((e) => e.isDirectory()).map((e) => e.name);
  return [...new Set([...AREAS, ...dirs])].sort();
}
