import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import * as L from '../../server/lib.js';

describe('Pruebas unitarias: Hashing y utilidades de lib.js', () => {
  test('Hashing SHA-256 es determinista con CRLF y LF', () => {
    const textLF = 'Característica: Consulta\n  Escenario: Buscar\n    Dado que estoy aquí\n';
    const textCRLF = 'Característica: Consulta\r\n  Escenario: Buscar\r\n    Dado que estoy aquí\r\n';
    const textCR = 'Característica: Consulta\r  Escenario: Buscar\r    Dado que estoy aquí\r';

    const hashLF = L.sha(textLF);
    const hashCRLF = L.sha(textCRLF);
    const hashCR = L.sha(textCR);

    assert.equal(hashLF, hashCRLF, 'Hash de CRLF debe ser idéntico al de LF');
    assert.equal(hashLF, hashCR, 'Hash de CR debe ser idéntico al de LF');
  });

  test('statusOf cubre todos los estados de feature del ciclo de vida', () => {
    const featureH = 'abc111';
    const implH = 'impl222';
    const currentH = { featureHash: featureH, implHash: implH };

    // 1. NOT_APPROVED: no existe entrada en approvals.json
    assert.equal(L.statusOf(null, currentH), 'NOT_APPROVED');

    // 2. CHANGED: el feature fue modificado después de aprobar
    const entryChanged = { featureHash: 'different-hash', approvedAt: '2026-10-20' };
    assert.equal(L.statusOf(entryChanged, currentH), 'CHANGED');

    // 3. APPROVED: el feature fue aprobado pero aún no se verificó con steps
    const entryApproved = { featureHash: featureH, approvedAt: '2026-10-20' };
    assert.equal(L.statusOf(entryApproved, currentH), 'APPROVED');

    // 4. VERIFIED: los steps corrieron y coinciden con la verificación
    const entryVerified = { featureHash: featureH, implHash: implH, verifiedAt: '2026-10-20' };
    assert.equal(L.statusOf(entryVerified, currentH), 'VERIFIED');

    // 5. IMPLEMENTATION_DRIFT: los steps cambiaron tras la verificación
    const entryDrift = { featureHash: featureH, implHash: 'old-impl-hash', verifiedAt: '2026-10-20' };
    assert.equal(L.statusOf(entryDrift, currentH), 'IMPLEMENTATION_DRIFT');
  });

  test('Validación de área con AREA_RE previene mayúsculas, espacios y caracteres especiales', () => {
    assert.ok(L.AREA_RE.test('services'));
    assert.ok(L.AREA_RE.test('channels-catalog'));
    assert.ok(L.AREA_RE.test('payment-event-trail'));

    assert.equal(L.AREA_RE.test('Services'), false, 'Mayúsculas no permitidas');
    assert.equal(L.AREA_RE.test('services/sub'), false, 'Barras no permitidas');
    assert.equal(L.AREA_RE.test('servicios con espacio'), false, 'Espacios no permitidos');
    assert.equal(L.AREA_RE.test('../malicious'), false, 'Path traversal no permitido');
    assert.equal(L.AREA_RE.test('área-tildada'), false, 'Tildes no permitidas');
  });

  test('featurePath previene path traversal y exige extensión .feature', () => {
    assert.throws(() => L.featurePath('something.txt'), /debe terminar en \.feature/);
    assert.throws(() => L.featurePath('../../etc/passwd.feature'), /fuera del directorio/);
    assert.throws(() => L.featurePath('../outside.feature'), /fuera del directorio/);

    const valid = L.featurePath('services/search-service.feature');
    assert.ok(valid.endsWith('search-service.feature'));
  });

  test('parseFeatureMeta extrae correctamente título, escenarios, tags y detecta # language: es', () => {
    const gherkin = `# language: es
@services @smoke
Característica: Consulta de cuentas bancarias

  Antecedentes:
    Dado que el usuario está autenticado

  Escenario: Filtrar por tipo de cuenta
    Cuando selecciona tipo "Ahorro"
    Entonces ve las cuentas de ahorro

  Esquema del escenario: Búsqueda con parámetros
    Cuando busca "<termino>"
    Entonces ve "<resultado>"
`;

    const meta = L.parseFeatureMeta(gherkin);
    assert.equal(meta.title, 'Consulta de cuentas bancarias');
    assert.equal(meta.scenarios.length, 2);
    assert.equal(meta.scenarios[0], 'Filtrar por tipo de cuenta');
    assert.equal(meta.scenarios[1], 'Búsqueda con parámetros');
    assert.ok(meta.tags.includes('@services'));
    assert.ok(meta.tags.includes('@smoke'));
    assert.equal(meta.hasLanguageEs, true);
    assert.equal(meta.fixme, false);
  });

  test('parseFeatureMeta detecta falta de # language: es y presencia de @fixme', () => {
    const gherkinWithoutLang = `@fixme
Característica: Prueba sin idioma
  Escenario: Algo
    Dado que algo
`;

    const meta = L.parseFeatureMeta(gherkinWithoutLang);
    assert.equal(meta.hasLanguageEs, false, 'Debe detectar ausencia de # language: es');
    assert.equal(meta.fixme, true, 'Debe detectar presencia de @fixme');
  });
});
