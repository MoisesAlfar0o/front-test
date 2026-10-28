// Cola de un solo worker + streaming SSE con replay (Last-Event-ID).
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { REPO, RUNS, AUTH, readJson, writeJson, featurePath, featureInfo, markVerified, httpErr } from './lib.js';
import { agentCommand, buildPrompt } from './agent-runner.js';

const win = process.platform === 'win32';
// ADR 0004: Playwright se lanza con node + CLI local, sin npx ni cmd (sin shell, sin inyección).
const PW_CLI = path.join(REPO, 'node_modules', '@playwright', 'test', 'cli.js');
const INDEX = path.join(RUNS, 'index.json');
const FINAL = ['DONE', 'FAILED', 'CANCELLED', 'AUTH_REQUIRED'];
const jobs = new Map();
const queue = [];
const clients = new Map();
let current = null;

const strip = (s) => s.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '');
const q = (x) => (/[\s"&|<>^]/.test(x) ? `"${x.replace(/"/g, '""')}"` : x);
const send = (res, ev, id) => res.write((id ? `id: ${id}\n` : '') + `data: ${JSON.stringify(ev)}\n\n`);

export async function listJobs() { return readJson(INDEX, []); }

async function persist(job) {
  const list = await listJobs();
  const s = { id: job.id, type: job.type, payload: job.payload, status: job.status, createdAt: job.createdAt, finishedAt: job.finishedAt };
  const i = list.findIndex((x) => x.id === job.id);
  if (i >= 0) list[i] = s; else list.unshift(s);
  await writeJson(INDEX, list.slice(0, 100));
}

function emit(job, ev) {
  if (ev.t === 'log') {
    job.lines.push(ev.text);
    fs.appendFile(path.join(RUNS, job.id + '.log'), ev.text + '\n', () => {});
  }
  for (const res of clients.get(job.id) ?? []) send(res, ev, ev.t === 'log' ? job.lines.length : undefined);
}

function line(job, l) {
  l = strip(l);
  if (/No hay una sesión guardada|La sesión guardada expiró/.test(l)) job.auth = true;
  emit(job, { t: 'log', text: l });
}

function kill(child) {
  if (!child) return;
  if (win) spawn('taskkill', ['/pid', String(child.pid), '/T', '/F']);
  else child.kill('SIGTERM');
}

function spawnLogged(job, cmd, args, useShell = false) {
  return new Promise((resolve) => {
    emit(job, { t: 'log', text: `$ ${path.basename(cmd)} ${args.join(' ')}` });
    const sh = useShell && win; // solo pnpm/agente en Windows; args fijos, nunca texto del usuario
    const child = spawn(cmd, sh ? args.map(q) : args, { cwd: REPO, shell: sh, windowsHide: true, env: { ...process.env, FORCE_COLOR: '0', PLAYWRIGHT_HTML_OPEN: 'never' } });
    job.child = child;
    for (const s of [child.stdout, child.stderr]) {
      let rest = '';
      s.setEncoding('utf8');
      s.on('data', (d) => { const parts = (rest + d).split(/\r?\n/); rest = parts.pop(); parts.forEach((l) => line(job, l)); });
      s.on('end', () => rest && line(job, rest));
    }
    child.on('error', (e) => { line(job, `No se pudo lanzar "${cmd}": ${e.message}`); resolve(1); });
    child.on('close', (code) => resolve(code ?? 1));
  });
}

async function exec(job) {
  const { type, payload: p } = job;
  if (type === 'draft' || type === 'implement') {
    const { cmd, args } = await agentCommand(job.id, buildPrompt(type, p));
    return spawnLogged(job, cmd, args, true);
  }
  if (p.all) return spawnLogged(job, 'pnpm', ['test'], true);
  let code = await spawnLogged(job, 'pnpm', ['bddgen'], true);
  if (code !== 0 || job.cancelled) return code;
  const txt = await fsp.readFile(featurePath(p.feature), 'utf8');
  const title = (txt.match(/^\s*Característica:\s*(.+)$/m) || [])[1]?.trim();
  const name = p.scenario ?? title;
  const grep = name ? ['--grep', name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')] : [];
  code = await spawnLogged(job, process.execPath, [PW_CLI, 'test', '--project=setup', '--project=bdd', ...grep]);
  if (code === 0 && !p.scenario) await markVerified(p.feature); // solo la corrida completa sella el hash // guarda implHash: base de IMPLEMENTATION_DRIFT
  return code;
}

function finish(job, status) {
  job.status = status;
  job.finishedAt = new Date().toISOString();
  job.child = null;
  emit(job, { t: 'status', status });
  for (const res of clients.get(job.id) ?? []) res.end();
  clients.delete(job.id);
  return persist(job);
}

async function pump() {
  if (current || !queue.length) return;
  const job = (current = queue.shift());
  job.status = 'RUNNING';
  emit(job, { t: 'status', status: 'RUNNING' });
  let code = 1;
  try { code = await exec(job); } catch (e) { line(job, 'Error: ' + e.message); }
  if (job.auth) line(job, '⚠ Sesión ausente o expirada: ejecuta `pnpm auth:manual` en tu terminal. La app nunca inicia sesión (ADR 0002).');
  await finish(job, job.cancelled ? 'CANCELLED' : job.auth ? 'AUTH_REQUIRED' : code === 0 ? 'DONE' : 'FAILED');
  current = null;
  pump();
}

export async function createJob(type, payload) {
  if (type !== 'draft') {
    if (!fs.existsSync(AUTH)) throw httpErr(409, 'AUTH_REQUIRED: no hay sesión guardada. Ejecuta `pnpm auth:manual` en tu terminal.');
    if (!payload.all) {
      const { status } = await featureInfo(payload.feature);
      if (!['APPROVED', 'VERIFIED'].includes(status))
        throw httpErr(409, status === 'IMPLEMENTATION_DRIFT'
          ? 'IMPLEMENTATION_DRIFT: los steps cambiaron desde la última verificación. Vuelve a aprobar el feature.'
          : `El feature está "${status}". Apruébalo primero.`);
    }
  }
  const job = { id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6), type, payload, status: 'QUEUED', createdAt: new Date().toISOString(), lines: [] };
  jobs.set(job.id, job);
  queue.push(job);
  await persist(job);
  pump();
  return { id: job.id };
}

export function cancel(id) {
  const job = jobs.get(id);
  if (!job || FINAL.includes(job.status)) return;
  job.cancelled = true;
  const i = queue.indexOf(job);
  if (i >= 0) { queue.splice(i, 1); finish(job, 'CANCELLED'); } else kill(job.child);
}

export function stream(req, res, id) {
  const job = jobs.get(id);
  if (!job) throw httpErr(404, 'Job no encontrado (la cola vive en memoria; reiniciar el servidor la limpia)');
  res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
  res.flushHeaders();
  const from = Number(req.headers['last-event-id']) || 0;
  job.lines.slice(from).forEach((text, i) => send(res, { t: 'log', text }, from + i + 1));
  send(res, { t: 'status', status: job.status });
  if (FINAL.includes(job.status)) return res.end();
  if (!clients.has(id)) clients.set(id, new Set());
  clients.get(id).add(res);
  req.on('close', () => clients.get(id)?.delete(res));
}
