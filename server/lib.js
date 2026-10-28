// Rutas, hashing SHA-256 determinista, aprobaciones y lectura de features. Zero-DB: todo en archivos.
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
export const APP = path.resolve(here, '..');
export const REPO = process.env.REPO_PATH || (fs.existsSync(path.resolve(APP, '..', 'features')) ? path.resolve(APP, '..') : APP);
export const DATA = path.join(APP, 'data');
export const RUNS = path.join(DATA, 'runs');
export const FEATURES = path.join(REPO, 'features');
export const STEPS = path.join(REPO, 'steps');
export const AUTH = path.join(REPO, 'test-results', '.auth', 'user.json');
export const AREAS = [
  'smoke', 'approvals', 'categories', 'channels', 'channels-catalog',
  'collect-configurations', 'countries', 'debts', 'global-cutoff',
  'notifications', 'packages', 'payment-event-trail', 'payments',
  'providers', 'services', 'settlements', 'tax-types'
];
export const APPROVALS = path.join(DATA, 'approvals.json');
export const AREA_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;

// Asegurar directorios requeridos
fs.mkdirSync(RUNS, { recursive: true });
fs.mkdirSync(FEATURES, { recursive: true });
fs.mkdirSync(STEPS, { recursive: true });

export const httpErr = (status, message) => Object.assign(new Error(message), { status });
export const norm = (s) => (s ?? '').replace(/\r\n|\r/g, '\n');
export const sha = (s) => crypto.createHash('sha256').update(norm(s), 'utf8').digest('hex');
export const posix = (p) => p.split(path.sep).join('/');

export async function readJson(file, fallback) {
  try { return JSON.parse(await fsp.readFile(file, 'utf8')); } catch { return fallback; }
}

export async function writeJson(file, data) {
  const tmp = file + '.tmp.' + Math.random().toString(36).slice(2);
  await fsp.mkdir(path.dirname(file), { recursive: true });
  await fsp.writeFile(tmp, JSON.stringify(data, null, 2), 'utf8');
  await fsp.rename(tmp, file);
}

export async function walk(dir, ext) {
  const out = [];
  if (!fs.existsSync(dir)) return out;
  for (const e of await fsp.readdir(dir, { withFileTypes: true }).catch(() => [])) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...(await walk(p, ext)));
    else if (p.endsWith(ext)) out.push(p);
  }
  return out.sort();
}

// Evita path traversal: solo .feature dentro de features/
export function featurePath(id) {
  if (typeof id !== 'string' || !id.endsWith('.feature')) {
    throw httpErr(400, 'ID de feature inválido: debe terminar en .feature');
  }
  if (id.includes('..') || path.isAbsolute(id)) {
    throw httpErr(400, 'Ruta inválida: intento de acceso fuera del directorio features/');
  }
  const p = path.resolve(FEATURES, id);
  if (!p.startsWith(FEATURES + path.sep)) {
    throw httpErr(400, 'Ruta inválida: intento de acceso fuera del directorio features/');
  }
  return p;
}

// Genera un blob determinista con todos los archivos de steps, ordenados alfabéticamente
export async function stepsBlob() {
  const files = await walk(STEPS, '.ts');
  const items = [];
  for (const p of files) {
    const rel = posix(path.relative(REPO, p));
    const content = norm(await fsp.readFile(p, 'utf8'));
    items.push({ rel, content });
  }
  // Ordenar deterministamente por ruta posix
  items.sort((a, b) => a.rel.localeCompare(b.rel));
  let s = '';
  for (const item of items) {
    s += '\0' + item.rel + '\0' + item.content;
  }
  return s;
}

// featureHash: solo el .feature. implHash: .feature + todos los steps/ (detecta deriva).
export async function hashes(id, blob) {
  const f = norm(await fsp.readFile(featurePath(id), 'utf8'));
  const currentStepsBlob = blob !== undefined ? blob : (await stepsBlob());
  return {
    featureHash: sha(f),
    implHash: sha(f + currentStepsBlob),
  };
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
  all[id] = {
    ...all[id],
    featureHash: h.featureHash,
    implHash: h.implHash,
    verifiedAt: new Date().toISOString(),
  };
  await writeJson(APPROVALS, all);
}

export function parseFeatureMeta(content) {
  const normContent = norm(content);
  const title = (normContent.match(/^\s*Característica:\s*(.+)$/m) || [])[1]?.trim() || '';
  const scenarios = [...normContent.matchAll(/^\s*(?:Escenario|Esquema del escenario):\s*(.+)$/gm)].map((m) => m[1].trim());
  const headerPart = normContent.split(/Característica:/)[0] || '';
  const tags = headerPart.match(/@[\w-]+/g) || [];
  const fixme = /@fixme/.test(normContent);
  const hasLanguageEs = /^\s*#\s*language:\s*es/m.test(normContent);

  return { title, scenarios, tags, fixme, hasLanguageEs };
}

export async function listFeatures() {
  const all = await readJson(APPROVALS, {});
  const blob = await stepsBlob();
  const out = [];
  for (const p of await walk(FEATURES, '.feature')) {
    const id = posix(path.relative(FEATURES, p));
    const txt = await fsp.readFile(p, 'utf8');
    const meta = parseFeatureMeta(txt);
    out.push({
      id,
      title: meta.title || id,
      tags: meta.tags,
      fixme: meta.fixme,
      hasLanguageEs: meta.hasLanguageEs,
      status: statusOf(all[id], await hashes(id, blob)),
    });
  }
  return out;
}

// Áreas = lista base + carpetas que ya existan en features/
export async function listAreas() {
  const dirs = (await fsp.readdir(FEATURES, { withFileTypes: true }).catch(() => []))
    .filter((e) => e.isDirectory())
    .map((e) => e.name);
  return [...new Set([...AREAS, ...dirs])].sort();
}
