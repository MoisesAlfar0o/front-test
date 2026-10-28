import express from 'express';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import * as L from './lib.js';
import * as J from './jobs.js';
import { loadConfig, saveConfig, getAgentStatus } from './agent-runner.js';
import { detectMissingSteps } from './step-detector.js';
import { auditDirectory } from './guards.js';

// Recuperar jobs huérfanos al arrancar el servidor
await J.recoverOrphanJobs();

const app = express();
app.use(express.json({ limit: '300kb' }));

// Seguridad local y CSRF: validación de origen y encabezado personalizado
app.use((req, res, next) => {
  const origin = req.headers.origin;
  const host = req.headers.host;

  // Si hay origin, verificar que sea localhost, 127.0.0.1, ais-dev o coincida con el Host
  if (origin) {
    const isLocal = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
    const isAIS = /^https:\/\/ais-[a-z0-9\-]+\.run\.app$/.test(origin);
    const matchesHost = host && origin.endsWith(host);
    if (!isLocal && !isAIS && !matchesHost) {
      return res.status(403).json({ error: 'Origen no permitido por la política de seguridad local.' });
    }
  }

  // En métodos de modificación de estado, exigir encabezado o verificar origen seguro
  const isMutation = ['POST', 'PUT', 'DELETE'].includes(req.method);
  if (isMutation && req.path.startsWith('/api')) {
    const customHeader = req.headers['x-orchestrator'] || req.headers['x-requested-with'];
    // Se acepta si trae encabezado personalizado o si viene del mismo origen validado
    if (!customHeader && !origin && !host) {
      return res.status(403).json({ error: 'Petición rechazada: encabezado de seguridad X-Orchestrator requerido.' });
    }
  }

  next();
});

const str = (v, max, min = 0) => {
  const s = String(v ?? '').trim();
  if (s.length < min || s.length > max) {
    throw L.httpErr(400, `Campo inválido (${min}-${max} caracteres)`);
  }
  return s;
};

function clean(type, b) {
  if (type === 'draft') {
    if (!L.AREA_RE.test(String(b.area))) {
      throw L.httpErr(400, 'Área inválida: usa minúsculas y guiones (kebab-case sin tildes ni espacios)');
    }
    return {
      area: b.area,
      where: str(b.where, 600, 3),
      what: str(b.what, 600, 3),
      expect: str(b.expect, 600, 5),
    };
  }
  if (type === 'run' && b.all) return { all: true };
  if (type === 'run' || type === 'implement') {
    L.featurePath(b.feature);
    return {
      feature: b.feature,
      ...(type === 'run' && b.scenario ? { scenario: str(b.scenario, 200, 1) } : {}),
    };
  }
  throw L.httpErr(400, 'Tipo de job inválido');
}

function capture(cmd, args) {
  return new Promise((resolve) => {
    let out = '';
    const c = spawn(cmd, args, { cwd: L.REPO });
    c.stdout.on('data', (d) => (out += d));
    c.stderr.on('data', (d) => (out += d));
    c.on('error', () => resolve('(git no disponible)'));
    c.on('close', () => resolve(out));
  });
}

// Metadatos generales del entorno
app.get('/api/meta', async (_q, res) => {
  const st = await fsp.stat(L.AUTH).catch(() => null);
  const agentStatus = await getAgentStatus();
  res.json({
    areas: await L.listAreas(),
    auth: { exists: !!st, mtime: st?.mtime ?? null, path: L.AUTH },
    agent: agentStatus.current,
    agentStatus,
  });
});

// Configuración de agentes
app.get('/api/config', async (_q, res) => {
  res.json(await loadConfig());
});

app.post('/api/config', async (req, res) => {
  const { agent, timeoutMs } = req.body;
  const cfg = await loadConfig();
  if (agent && !cfg.agents?.[agent]) {
    throw L.httpErr(400, `El agente "${agent}" no existe en la configuración.`);
  }
  const updated = await saveConfig({
    ...(agent ? { agent } : {}),
    ...(timeoutMs ? { timeoutMs: Number(timeoutMs) } : {}),
  });
  res.json(updated);
});

// Features
app.get('/api/features', async (_q, res) => res.json(await L.listFeatures()));

app.get('/api/feature', async (req, res) => {
  const id = String(req.query.id);
  const p = L.featurePath(id);
  const content = await fsp.readFile(p, 'utf8');
  const meta = L.parseFeatureMeta(content);
  const info = await L.featureInfo(id);
  const missing = await detectMissingSteps(p, L.STEPS);

  res.json({
    id,
    content,
    title: meta.title,
    scenarios: meta.scenarios,
    tags: meta.tags,
    fixme: meta.fixme,
    hasLanguageEs: meta.hasLanguageEs,
    missingSteps: missing,
    ...info,
  });
});

app.get('/api/feature/missing-steps', async (req, res) => {
  const id = String(req.query.id);
  const p = L.featurePath(id);
  res.json(await detectMissingSteps(p, L.STEPS));
});

app.put('/api/feature', async (req, res) => {
  const { id, content } = req.body;
  const p = L.featurePath(id);
  if (typeof content !== 'string' || !fs.existsSync(p)) {
    throw L.httpErr(400, 'Contenido o feature inválido');
  }
  await fsp.writeFile(p, content, 'utf8');
  res.json(await L.featureInfo(id));
});

app.post('/api/approve', async (req, res) => {
  const id = req.body.id;
  L.featurePath(id);
  await L.approve(id);
  res.json(await L.featureInfo(id));
});

// Auditoría de guardrails de código
app.get('/api/guards', async (_q, res) => {
  const issues = await auditDirectory(L.STEPS);
  res.json({ count: issues.length, issues });
});

// Jobs
app.get('/api/jobs', async (_q, res) => res.json(await J.listJobs()));

app.post('/api/jobs', async (req, res) => {
  const { type, ...body } = req.body;
  res.status(202).json(await J.createJob(type, clean(type, body)));
});

app.delete('/api/jobs/:id', (req, res) => {
  J.cancel(req.params.id);
  res.status(204).end();
});

app.get('/api/jobs/:id/stream', (req, res) => J.stream(req, res, req.params.id));

app.get('/api/jobs/:id/log', async (req, res) => {
  const id = String(req.params.id);
  if (!/^[a-z0-9]+$/.test(id)) throw L.httpErr(400, 'ID de job inválido');
  res.json({ text: await fsp.readFile(path.join(L.RUNS, id + '.log'), 'utf8').catch(() => '') });
});

// Vista de cambios git completa: tracked y untracked files
app.get('/api/diff', async (_q, res) => {
  const status = await capture('git', ['status', '--porcelain', '--', 'features', 'steps']);
  const diff = await capture('git', ['diff', '--no-color', '--', 'features', 'steps']);

  let untrackedContent = '';
  const lines = status.split('\n');
  for (const line of lines) {
    if (line.startsWith('?? ')) {
      const fileRel = line.slice(3).trim();
      if (fileRel.startsWith('features/') || fileRel.startsWith('steps/')) {
        const fullPath = path.join(L.REPO, fileRel);
        try {
          const stats = await fsp.stat(fullPath);
          if (stats.isFile() && stats.size <= 50000) {
            const content = await fsp.readFile(fullPath, 'utf8');
            untrackedContent += `\n--- /dev/null\n+++ b/${fileRel} (archivo nuevo sin seguimiento)\n`;
            untrackedContent += content.split('\n').map((l) => '+' + l).join('\n') + '\n';
          }
        } catch {}
      }
    }
  }

  const combined = `${status}\n${diff}\n${untrackedContent}`.trim();
  res.json({ text: combined || 'Sin cambios pendientes en features/ ni steps/.' });
});

// Reporte HTML de Playwright
const reportDir = path.join(L.REPO, 'playwright-report');
app.use('/report', express.static(reportDir));
app.get('/report*', (_req, res) => {
  if (fs.existsSync(path.join(reportDir, 'index.html'))) {
    return res.sendFile(path.join(reportDir, 'index.html'));
  }
  res.send(`<!DOCTYPE html>
<html lang="es">
<head><meta charset="utf-8"><title>Reporte de Pruebas · LAFISErvicios</title>
<style>body{font-family:system-ui,sans-serif;padding:32px;background:#f6f8fa;color:#0d1b2e;line-height:1.6}
.box{max-width:540px;margin:40px auto;background:#fff;padding:24px;border:1px solid #c9d3de;border-radius:6px}</style>
</head><body><div class="box">
<h2>Reporte HTML aún no generado</h2>
<p>El reporte de Playwright se creará automáticamente cuando ejecutes las pruebas con <code>pnpm test</code> o desde la plataforma.</p>
<p><a href="/">Volver a la plataforma</a></p>
</div></body></html>`);
});

const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '0.0.0.0';

if (process.env.NODE_ENV === 'production') {
  const dist = path.join(L.APP, 'dist');
  if (fs.existsSync(dist)) {
    app.use(express.static(dist));
    app.get('*', (_req, res) => res.sendFile(path.join(dist, 'index.html')));
  }
} else {
  const { createServer: createViteServer } = await import('vite');
  const vite = await createViteServer({
    server: { middlewareMode: true, hmr: false },
    appType: 'spa',
  });
  app.use(vite.middlewares);
}

app.use((err, _req, res, _next) => {
  res.status(err.status || 500).json({ error: err.message });
});

app.listen(PORT, HOST, () => {
  console.log(`[Orquestador E2E] Servidor iniciado en http://${HOST}:${PORT} · repo: ${L.REPO}`);
});
