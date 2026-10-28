import express from 'express';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import * as L from './lib.js';
import * as J from './jobs.js';
import { loadConfig } from './agent-runner.js';

const app = express();
app.use(express.json({ limit: '300kb' }));

// Solo orígenes locales (la API puede lanzar procesos en esta máquina).
app.use((req, res, next) => {
  const o = req.headers.origin;
  if (o && !/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(o)) return res.status(403).json({ error: 'origen no permitido' });
  next();
});

const str = (v, max, min = 0) => {
  const s = String(v ?? '').trim();
  if (s.length < min || s.length > max) throw L.httpErr(400, `Campo inválido (${min}-${max} caracteres)`);
  return s;
};

function clean(type, b) {
  if (type === 'draft') {
    if (!L.AREA_RE.test(String(b.area))) throw L.httpErr(400, 'Área inválida: usa minúsculas y guiones (kebab-case)');
    return { area: b.area, where: str(b.where, 600, 3), what: str(b.what, 600, 3), expect: str(b.expect, 600, 5) };
  }
  if (type === 'run' && b.all) return { all: true };
  if (type === 'run' || type === 'implement') {
    L.featurePath(b.feature);
    return { feature: b.feature, ...(type === 'run' && b.scenario ? { scenario: str(b.scenario, 200, 1) } : {}) };
  }
  throw L.httpErr(400, 'Tipo de job inválido');
}

function capture(cmd, args) {
  return new Promise((resolve) => {
    let out = '';
    const c = spawn(cmd, args, { cwd: L.REPO });
    c.stdout.on('data', (d) => (out += d));
    c.on('error', () => resolve('(git no disponible)'));
    c.on('close', () => resolve(out));
  });
}

app.get('/api/meta', async (_q, res) => {
  const st = await fsp.stat(L.AUTH).catch(() => null);
  res.json({ areas: await L.listAreas(), auth: { exists: !!st, mtime: st?.mtime ?? null }, agent: (await loadConfig()).agent });
});
app.get('/api/features', async (_q, res) => res.json(await L.listFeatures()));
app.get('/api/feature', async (req, res) => {
  const id = String(req.query.id);
  const content = await fsp.readFile(L.featurePath(id), 'utf8');
  const scenarios = [...content.matchAll(/^\s*(?:Escenario|Esquema del escenario):\s*(.+)$/gm)].map((m) => m[1].trim());
  res.json({ id, content, scenarios, ...(await L.featureInfo(id)) });
});
app.put('/api/feature', async (req, res) => {
  const { id, content } = req.body;
  const p = L.featurePath(id);
  if (typeof content !== 'string' || !fs.existsSync(p)) throw L.httpErr(400, 'Contenido o feature inválido');
  await fsp.writeFile(p, content);
  res.json(await L.featureInfo(id));
});
app.post('/api/approve', async (req, res) => {
  L.featurePath(req.body.id);
  await L.approve(req.body.id);
  res.json(await L.featureInfo(req.body.id));
});
app.get('/api/jobs', async (_q, res) => res.json(await J.listJobs()));
app.post('/api/jobs', async (req, res) => {
  const { type, ...body } = req.body;
  res.status(202).json(await J.createJob(type, clean(type, body)));
});
app.delete('/api/jobs/:id', (req, res) => { J.cancel(req.params.id); res.status(204).end(); });
app.get('/api/jobs/:id/stream', (req, res) => J.stream(req, res, req.params.id));
app.get('/api/jobs/:id/log', async (req, res) => {
  const id = String(req.params.id);
  if (!/^[a-z0-9]+$/.test(id)) throw L.httpErr(400, 'id inválido');
  res.json({ text: await fsp.readFile(path.join(L.RUNS, id + '.log'), 'utf8').catch(() => '') });
});
app.get('/api/diff', async (_q, res) => {
  const status = await capture('git', ['status', '--porcelain', '--', 'features', 'steps']);
  const diff = await capture('git', ['diff', '--no-color', '--', 'features', 'steps']);
  res.json({ text: `${status}\n${diff}`.trim() || 'Sin cambios en features/ ni steps/.' });
});

app.use('/report', express.static(path.join(L.REPO, 'playwright-report'))); // reporte HTML de Playwright
const dist = path.join(L.APP, 'dist');
if (fs.existsSync(dist)) app.use(express.static(dist));

app.use((err, _req, res, _next) => res.status(err.status || 500).json({ error: err.message }));
app.listen(4000, '127.0.0.1', () => console.log('API en http://127.0.0.1:4000 · repo:', L.REPO));
