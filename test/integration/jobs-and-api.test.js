import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import fsp from 'node:fs/promises';
import path from 'node:path';
import * as L from '../../server/lib.js';
import * as J from '../../server/jobs.js';
import { saveConfig } from '../../server/agent-runner.js';

describe('Pruebas de integración: Jobs, fake-agent y flujo BDD', () => {
  before(async () => {
    // Asegurar que el agente activo para pruebas sea 'fake'
    await saveConfig({ agent: 'fake' });
  });

  test('Crear job de tipo draft genera un nuevo archivo .feature con fake-agent', async () => {
    const payload = {
      area: 'services',
      where: 'Módulo de Servicios',
      what: 'Consulta de servicios activos',
      expect: 'Solo veo servicios activos',
    };

    const { id } = await J.createJob('draft', payload);
    assert.ok(id, 'Debe devolver un ID de job');

    // Esperar a que el job termine (el fake agent tarda ~100-300ms)
    let jobRecord = null;
    for (let i = 0; i < 30; i++) {
      const list = await J.listJobs();
      jobRecord = list.find((x) => x.id === id);
      if (jobRecord && (jobRecord.status === 'DONE' || jobRecord.status === 'FAILED')) {
        break;
      }
      await new Promise((r) => setTimeout(r, 100));
    }

    assert.ok(jobRecord, 'El job debe persistirse');
    assert.equal(jobRecord.status, 'DONE', 'El job draft debe terminar en DONE');

    // Verificar que el archivo .feature fue creado
    const featurePath = path.join(L.FEATURES, 'services', 'consulta-de-servicios-activos.feature');
    const exists = await fsp.stat(featurePath).then(() => true).catch(() => false);
    assert.ok(exists, 'El archivo .feature debe existir en disco');

    const content = await fsp.readFile(featurePath, 'utf8');
    assert.ok(content.includes('Característica: Módulo de Servicios'));
  });

  test('Flujo de aprobación y transición a APPROVED', async () => {
    const featureId = 'services/consulta-de-servicios-activos.feature';

    // Limpiar entrada previa para idempotencia
    const approvals = await L.readJson(L.APPROVALS, {});
    delete approvals[featureId];
    await L.writeJson(L.APPROVALS, approvals);

    // Antes de aprobar: NOT_APPROVED
    const infoBefore = await L.featureInfo(featureId);
    assert.equal(infoBefore.status, 'NOT_APPROVED');

    // Aprobar
    await L.approve(featureId);

    // Después de aprobar: APPROVED
    const infoAfter = await L.featureInfo(featureId);
    assert.equal(infoAfter.status, 'APPROVED');
  });

  test('Cancelación de job en cola', async () => {
    // Encolar dos jobs consecutivos
    const job1 = await J.createJob('draft', {
      area: 'payments',
      where: 'Pagos',
      what: 'Prueba cancelacion',
      expect: 'No debe terminar',
    });

    // Cancelar de inmediato
    J.cancel(job1.id);

    // Esperar a que finalice
    await new Promise((r) => setTimeout(r, 200));
    const list = await J.listJobs();
    const canceled = list.find((x) => x.id === job1.id);
    assert.ok(canceled);
    assert.ok(['CANCELLED', 'DONE'].includes(canceled.status));
  });

  test('recoverOrphanJobs marca jobs en QUEUED o RUNNING como FAILED', async () => {
    // Simular un job que quedó huérfano en index.json
    const list = await J.listJobs();
    const orphanId = 'orphan_' + Date.now();
    list.unshift({
      id: orphanId,
      type: 'draft',
      payload: { area: 'smoke' },
      status: 'RUNNING',
      createdAt: new Date().toISOString(),
    });
    await L.writeJson(path.join(L.RUNS, 'index.json'), list);

    // Ejecutar recuperación
    await J.recoverOrphanJobs();

    const updated = await J.listJobs();
    const orphan = updated.find((x) => x.id === orphanId);
    assert.ok(orphan);
    assert.equal(orphan.status, 'FAILED', 'El job huérfano debe pasar a FAILED');
    assert.equal(orphan.recovered, true);
  });

  test('Detección de IMPLEMENTATION_DRIFT cuando los steps cambian tras la verificación', async () => {
    const featureId = 'services/search-service.feature';
    // Asegurar que está aprobado y verificado
    await L.approve(featureId);
    await L.markVerified(featureId);

    const info1 = await L.featureInfo(featureId);
    assert.equal(info1.status, 'VERIFIED');

    // Simular deriva de implementación usando un blob de steps diferente
    const hashes = await L.hashes(featureId, '\0fake_diff_step\0contenido_modificado');
    const all = await L.readJson(L.APPROVALS, {});
    const driftStatus = L.statusOf(all[featureId], hashes);
    assert.equal(driftStatus, 'IMPLEMENTATION_DRIFT', 'Debe detectar IMPLEMENTATION_DRIFT si los steps cambian');
  });
});
