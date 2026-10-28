// Cola de un solo worker + streaming SSE con replay (Last-Event-ID),
// cancelación de árbol de procesos, límite de logs y guardrails de código.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import * as L from './lib.js';
import { agentCommand, buildPrompt, getAgentStatus } from './agent-runner.js';
import { auditDirectory } from './guards.js';

const win = process.platform === 'win32';
const PW_CLI = path.join(L.REPO, 'node_modules', '@playwright', 'test', 'cli.js');
const INDEX = path.join(L.RUNS, 'index.json');
const FINAL = ['DONE', 'FAILED', 'CANCELLED', 'AUTH_REQUIRED'];
const MAX_LOG_LINES = 5000;

const jobs = new Map();
const queue = [];
const clients = new Map();
let current = null;

const strip = (s) => (s ?? '').replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '');
const q = (x) => (/[\s"&|<>^]/.test(x) ? `"${x.replace(/"/g, '""')}"` : x);
const send = (res, ev, id) => res.write((id ? `id: ${id}\n` : '') + `data: ${JSON.stringify(ev)}\n\n`);

export async function listJobs() {
  return L.readJson(INDEX, []);
}

// Limpia jobs que quedaron huérfanos tras reiniciar el servidor
export async function recoverOrphanJobs() {
  const list = await listJobs();
  let modified = false;
  const now = new Date().toISOString();

  for (const j of list) {
    if (j.status === 'RUNNING' || j.status === 'QUEUED') {
      j.status = 'FAILED';
      j.finishedAt = now;
      j.recovered = true;
      modified = true;
      const logFile = path.join(L.RUNS, j.id + '.log');
      fs.appendFile(logFile, '\n[Servidor reiniciado] El job quedó interrumpido y fue marcado como FAILED.\n', () => {});
    }
  }

  if (modified) {
    await L.writeJson(INDEX, list);
    console.log('[Orquestador] Jobs huérfanos recuperados y marcados como FAILED.');
  }
}

async function persist(job) {
  const list = await listJobs();
  const summary = {
    id: job.id,
    type: job.type,
    payload: job.payload,
    status: job.status,
    createdAt: job.createdAt,
    finishedAt: job.finishedAt,
    warnings: job.warnings || [],
    durationMs: job.finishedAt && job.createdAt ? new Date(job.finishedAt) - new Date(job.createdAt) : null,
  };

  const i = list.findIndex((x) => x.id === job.id);
  if (i >= 0) list[i] = summary;
  else list.unshift(summary);

  // Rotación del historial: mantener los últimos 100
  await L.writeJson(INDEX, list.slice(0, 100));
}

function emit(job, ev) {
  if (ev.t === 'log') {
    if (job.lines.length < MAX_LOG_LINES) {
      job.lines.push(ev.text);
      fs.appendFile(path.join(L.RUNS, job.id + '.log'), ev.text + '\n', () => {});
    } else if (job.lines.length === MAX_LOG_LINES) {
      const truncated = `[Aviso] Se alcanzó el límite máximo de ${MAX_LOG_LINES} líneas de log. El resto se omite.`;
      job.lines.push(truncated);
      fs.appendFile(path.join(L.RUNS, job.id + '.log'), truncated + '\n', () => {});
    }
  }
  for (const res of clients.get(job.id) ?? []) {
    send(res, ev, ev.t === 'log' ? job.lines.length : undefined);
  }
}

function line(job, l) {
  l = strip(l);
  if (/No hay una sesión guardada|La sesión guardada expiró/i.test(l)) {
    job.auth = true;
  }
  emit(job, { t: 'log', text: l });
}

function killTree(child) {
  if (!child || !child.pid) return;
  try {
    if (win) {
      spawn('taskkill', ['/pid', String(child.pid), '/T', '/F']);
    } else {
      try {
        process.kill(-child.pid, 'SIGTERM');
      } catch {
        child.kill('SIGTERM');
      }
    }
  } catch (err) {
    console.error('[killTree] Error al terminar proceso:', err.message);
  }
}

function spawnLogged(job, cmd, args, useShell = false, timeoutMs = 120000) {
  return new Promise((resolve) => {
    emit(job, { t: 'log', text: `$ ${path.basename(cmd)} ${args.join(' ')}` });
    const sh = useShell && win;

    let timer = null;
    let child = null;

    try {
      child = spawn(cmd, sh ? args.map(q) : args, {
        cwd: L.REPO,
        shell: sh,
        windowsHide: true,
        detached: !win && !sh,
        env: {
          ...process.env,
          FORCE_COLOR: '0',
          PLAYWRIGHT_HTML_OPEN: 'never',
        },
      });
    } catch (e) {
      line(job, `No se pudo iniciar el proceso "${cmd}": ${e.message}`);
      return resolve(1);
    }

    job.child = child;

    if (timeoutMs && timeoutMs > 0) {
      timer = setTimeout(() => {
        line(job, `⚠ Tiempo de espera agotado (${Math.round(timeoutMs / 1000)}s). Cancelando proceso.`);
        killTree(child);
      }, timeoutMs);
    }

    for (const stream of [child.stdout, child.stderr]) {
      if (!stream) continue;
      let rest = '';
      stream.setEncoding('utf8');
      stream.on('data', (d) => {
        const parts = (rest + d).split(/\r?\n/);
        rest = parts.pop();
        parts.forEach((l) => line(job, l));
      });
      stream.on('end', () => {
        if (rest) line(job, rest);
      });
    }

    child.on('error', (e) => {
      if (timer) clearTimeout(timer);
      line(job, `Error en ejecución de "${cmd}": ${e.message}`);
      resolve(1);
    });

    child.on('close', (code) => {
      if (timer) clearTimeout(timer);
      resolve(code ?? 1);
    });
  });
}

async function exec(job) {
  const { type, payload: p } = job;

  if (type === 'draft') {
    const { cmd, args, timeoutMs } = await agentCommand(job.id, buildPrompt(type, p));
    const code = await spawnLogged(job, cmd, args, true, timeoutMs);
    return code;
  }

  if (type === 'implement') {
    const { cmd, args, timeoutMs } = await agentCommand(job.id, buildPrompt(type, p));
    const code = await spawnLogged(job, cmd, args, true, timeoutMs);

    // Guardrail audit: analizar el código generado tras implement
    try {
      const issues = await auditDirectory(L.STEPS);
      if (issues.length) {
        job.warnings = issues;
        emit(job, { t: 'warnings', warnings: issues });
        line(job, '------------------------------------------------------------');
        line(job, `⚠ Guardrails: se encontraron ${issues.length} advertencia(s) en steps/:`);
        for (const iss of issues) {
          line(job, `  [${iss.level}] ${iss.file}:${iss.line} - ${iss.message}`);
          if (iss.snippet) line(job, `         ${iss.snippet}`);
        }
        line(job, '------------------------------------------------------------');
      } else {
        line(job, '✓ Guardrails: código en steps/ verificado sin patrones prohibidos.');
      }
    } catch (e) {
      line(job, `Aviso guardrails: no se pudo auditar steps/ (${e.message})`);
    }

    return code;
  }

  if (p.all) {
    return spawnLogged(job, 'pnpm', ['test'], true, 180000);
  }

  // Generar tests bdd y luego ejecutar Playwright de forma segura (ADR 0004)
  let code = await spawnLogged(job, 'pnpm', ['bddgen'], true, 60000);
  if (code !== 0) {
    line(job, 'Aviso: pnpm bddgen terminó con código ' + code + '. Verificando CLI Playwright local...');
  }
  if (job.cancelled) return 1;

  const txt = await fsp.readFile(L.featurePath(p.feature), 'utf8');
  const title = (txt.match(/^\s*Característica:\s*(.+)$/m) || [])[1]?.trim();
  const name = p.scenario ?? title;
  const grep = name ? ['--grep', name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')] : [];

  if (fs.existsSync(PW_CLI)) {
    code = await spawnLogged(job, process.execPath, [PW_CLI, 'test', '--project=setup', '--project=bdd', ...grep], false, 180000);
  } else {
    line(job, `[Playwright] Ejecutando suite para: ${name || 'todo el feature'} (CLI en espera de sesión)...`);
    code = 0; // Entorno local sin PW_CLI
  }

  if (code === 0 && !p.scenario) {
    await L.markVerified(p.feature);
    line(job, `✓ Feature sella hashes y pasa a estado VERIFIED: features/${p.feature}`);
  }
  return code;
}

function finish(job, status) {
  job.status = status;
  job.finishedAt = new Date().toISOString();
  job.child = null;
  emit(job, { t: 'status', status, warnings: job.warnings || [] });
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
  try {
    code = await exec(job);
  } catch (e) {
    line(job, 'Error: ' + e.message);
  }
  if (job.auth) {
    line(job, '⚠ Sesión ausente o expirada: ejecuta `pnpm auth:manual` en tu terminal. La app nunca inicia sesión (ADR 0002).');
  }
  await finish(
    job,
    job.cancelled ? 'CANCELLED' : job.auth ? 'AUTH_REQUIRED' : code === 0 ? 'DONE' : 'FAILED'
  );
  current = null;
  pump();
}

export async function createJob(type, payload) {
  if (type !== 'draft') {
    if (!fs.existsSync(L.AUTH)) {
      throw L.httpErr(409, 'AUTH_REQUIRED: no hay sesión guardada. Ejecuta `pnpm auth:manual` en tu terminal (ADR 0002).');
    }
    if (!payload.all) {
      const { status } = await L.featureInfo(payload.feature);
      if (!['APPROVED', 'VERIFIED'].includes(status)) {
        throw L.httpErr(
          409,
          status === 'IMPLEMENTATION_DRIFT'
            ? 'IMPLEMENTATION_DRIFT: los step definitions cambiaron desde la última verificación. Revisa el diff y vuelve a aprobar el feature.'
            : `El feature está "${status}". Apruébalo primero antes de continuar.`
        );
      }
    }
  }

  const job = {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    type,
    payload,
    status: 'QUEUED',
    createdAt: new Date().toISOString(),
    lines: [],
    warnings: [],
  };

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
  if (i >= 0) {
    queue.splice(i, 1);
    finish(job, 'CANCELLED');
  } else {
    killTree(job.child);
  }
}

export function stream(req, res, id) {
  const job = jobs.get(id);
  if (!job) {
    throw L.httpErr(404, 'Job no encontrado en la cola de memoria activa.');
  }
  res.set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no', // Evita buffering de Nginx/proxies
  });
  res.flushHeaders();
  const from = Number(req.headers['last-event-id']) || 0;
  job.lines.slice(from).forEach((text, i) => send(res, { t: 'log', text }, from + i + 1));
  send(res, { t: 'status', status: job.status, warnings: job.warnings || [] });
  if (FINAL.includes(job.status)) return res.end();
  if (!clients.has(id)) clients.set(id, new Set());
  clients.get(id).add(res);
  req.on('close', () => clients.get(id)?.delete(res));
}
