#!/usr/bin/env node
// Agente simulado para pruebas locales rápidas, verificación E2E y suites automatizadas.
// No requiere tokens externos ni conexión de red.
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const APP = path.resolve(here, '..');
const REPO = process.env.REPO_PATH || (fs.existsSync(path.resolve(APP, '..', 'features')) ? path.resolve(APP, '..') : APP);
const FEATURES = path.join(REPO, 'features');
const STEPS = path.join(REPO, 'steps');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function main() {
  const promptArg = process.argv.slice(2).join(' ');
  console.log('[fake-agent] Iniciando agente de prueba...');
  console.log(`[fake-agent] Argumento recibido: ${promptArg}`);

  // Localizar archivo de prompt
  let promptText = '';
  const match = promptArg.match(/(?:app\/)?data\/runs\/([a-z0-9]+)\.prompt\.md/i);
  if (match) {
    const promptPath = path.join(APP, 'data', 'runs', `${match[1]}.prompt.md`);
    if (fs.existsSync(promptPath)) {
      promptText = await fsp.readFile(promptPath, 'utf8');
      console.log(`[fake-agent] Prompt cargado desde: ${promptPath}`);
    }
  }

  // Si no se pudo leer el archivo, usar el argumento directamente
  if (!promptText) {
    promptText = promptArg;
  }

  // Simulación de salida lenta si se solicita
  if (process.env.SIMULATE_SLOW === 'true' || promptText.includes('[simular-lento]')) {
    console.log('[fake-agent] Modo salida lenta activado...');
    await sleep(400);
  }

  // Simulación de fallo solicitado
  if (process.env.SIMULATE_FAILURE === 'true' || promptText.includes('[simular-fallo]')) {
    console.error('[fake-agent] Error simulado: fallo provocado durante la ejecución del agente.');
    process.exit(1);
  }

  // Simulación de sesión expirada solicitada
  if (process.env.SIMULATE_AUTH_EXPIRED === 'true' || promptText.includes('[simular-auth-expirada]')) {
    console.error('[fake-agent] ⚠ No hay una sesión guardada o la sesión guardada expiró. Ejecuta pnpm auth:manual en tu terminal.');
    process.exit(1);
  }

  // Detectar tipo de trabajo a partir del prompt
  const isDraft = promptText.includes('Crea SOLO el archivo .feature') || promptText.includes('Eres analista QA');
  const isImplement = promptText.includes('Implementa los steps que faltan') || promptText.includes('Eres automatizador Playwright');

  if (isDraft) {
    console.log('[fake-agent] Modo: Generación de borrador (.feature)...');
    console.log('[fake-agent] Leyendo convenciones del repositorio (CLAUDE.md / AGENTS.md)...');
    console.log('[fake-agent] Analizando vocabulario existente en steps/ y features/...');

    const areaMatch = promptText.match(/Área:\s*([\w-]+)/i);
    const whereMatch = promptText.match(/Dónde:\s*(.+)/i);
    const whatMatch = promptText.match(/Qué hace la persona:\s*(.+)/i);
    const expectMatch = promptText.match(/Qué debe pasar:\s*(.+)/i);

    const area = (areaMatch ? areaMatch[1].trim() : 'services').toLowerCase();
    const where = whereMatch ? whereMatch[1].trim() : 'Servicios';
    const what = whatMatch ? whatMatch[1].trim() : 'Consulta general';
    const expect = expectMatch ? expectMatch[1].trim() : 'Se visualizan los registros correctamente';

    const slug = what
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'consulta';

    const targetDir = path.join(FEATURES, area);
    await fsp.mkdir(targetDir, { recursive: true });
    const targetFile = path.join(targetDir, `${slug}.feature`);

    const gherkin = `# language: es
@${area}
Característica: ${where} - ${what}

  Como usuario con permisos en ${where}
  Quiero ${what.toLowerCase()}
  Para verificar que ${expect.toLowerCase()}

  Escenario: ${what}
    Dado que el usuario navega a la sección "${where}"
    Cuando ${what}
    Entonces ${expect}
`;

    await fsp.writeFile(targetFile, gherkin, 'utf8');
    console.log(`[fake-agent] ✓ Archivo .feature generado: features/${area}/${slug}.feature`);
    console.log('[fake-agent] Frases para implementar:');
    console.log(`  - Dado que el usuario navega a la sección "${where}"`);
    console.log(`  - Cuando ${what}`);
    console.log(`  - Entonces ${expect}`);
    console.log('[fake-agent] Borrador finalizado con éxito.');
    process.exit(0);
  }

  if (isImplement) {
    console.log('[fake-agent] Modo: Generación de step definitions...');
    const featMatch = promptText.match(/features\/([\w-]+\/[\w-]+\.feature)/i);
    const featRel = featMatch ? featMatch[1] : 'services/search-service.feature';
    console.log(`[fake-agent] Implementando steps para: features/${featRel}`);
    console.log('[fake-agent] Ejecutando verificación previa con navegador simulado...');

    const area = path.dirname(featRel);
    const base = path.basename(featRel, '.feature');
    const targetDir = path.join(STEPS, area);
    await fsp.mkdir(targetDir, { recursive: true });
    const targetFile = path.join(targetDir, `${base}.steps.ts`);

    const stepCode = `import { Given, When, Then } from '../fixtures.js';
import { expect } from '@playwright/test';

// Step definitions para features/${featRel}
// Generado automáticamente por fake-agent siguiendo ADR 0001

Given('que el usuario navega a la sección {string}', async ({ page }, seccion: string) => {
  await expect(page.getByRole('heading', { name: seccion })).toBeVisible();
});

When('busca {string} en el buscador', async ({ page }, texto: string) => {
  const buscador = page.getByPlaceholder('Buscar...');
  await buscador.fill(texto);
  await buscador.press('Enter');
});

Then('solo ve servicios cuyo nombre contiene {string}', async ({ page }, esperado: string) => {
  const filas = page.getByRole('row');
  await expect(filas.filter({ hasText: esperado })).toBeVisible();
});
`;

    await fsp.writeFile(targetFile, stepCode, 'utf8');
    console.log(`[fake-agent] ✓ Step definitions generados: steps/${area}/${base}.steps.ts`);
    console.log('[fake-agent] Reglas cumplidas: selectores accesibles, expect web-first, sin waitForTimeout.');
    process.exit(0);
  }

  console.log('[fake-agent] Operación general completada con éxito.');
  process.exit(0);
}

main().catch((err) => {
  console.error('[fake-agent] Error no capturado:', err);
  process.exit(1);
});
