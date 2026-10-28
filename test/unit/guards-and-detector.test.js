import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { auditStepContent } from '../../server/guards.js';
import { extractFeatureSteps, phraseToPattern } from '../../server/step-detector.js';

describe('Pruebas unitarias: Guardrails de código y detector de steps', () => {
  test('auditStepContent detecta waitForTimeout prohibido', () => {
    const badCode = `
      await page.goto('/services');
      await page.waitForTimeout(5000);
    `;
    const issues = auditStepContent(badCode, 'test.steps.ts');
    assert.ok(issues.some((i) => i.rule === 'NO_WAIT_FOR_TIMEOUT'));
  });

  test('auditStepContent detecta networkidle prohibido', () => {
    const badCode = `
      await page.waitForLoadState('networkidle');
    `;
    const issues = auditStepContent(badCode, 'test.steps.ts');
    assert.ok(issues.some((i) => i.rule === 'NO_NETWORKIDLE'));
  });

  test('auditStepContent detecta XPath prohibido', () => {
    const badCode1 = `const el = page.locator('xpath=//div[@class="btn"]');`;
    const badCode2 = `const el = page.locator('//button[text()="Buscar"]');`;

    const issues1 = auditStepContent(badCode1, 'test.steps.ts');
    const issues2 = auditStepContent(badCode2, 'test.steps.ts');

    assert.ok(issues1.some((i) => i.rule === 'NO_XPATH'));
    assert.ok(issues2.some((i) => i.rule === 'NO_XPATH'));
  });

  test('auditStepContent detecta posibles credenciales o secretos', () => {
    const badCode = `const password = 'SuperSecretPassword123';`;
    const issues = auditStepContent(badCode, 'test.steps.ts');
    assert.ok(issues.some((i) => i.rule === 'NO_CREDENTIALS'));
  });

  test('auditStepContent emite advertencia para .nth()', () => {
    const code = `const item = page.getByRole('row').nth(2);`;
    const issues = auditStepContent(code, 'test.steps.ts');
    assert.ok(issues.some((i) => i.rule === 'AVOID_NTH'));
  });

  test('auditStepContent aprueba código limpio que sigue las buenas prácticas', () => {
    const goodCode = `
      import { Given, When, Then } from '../fixtures.js';
      import { expect } from '@playwright/test';

      Given('que el usuario navega a la sección {string}', async ({ page }, seccion: string) => {
        await expect(page.getByRole('heading', { name: seccion })).toBeVisible();
      });

      When('busca {string} en el buscador', async ({ page }, texto: string) => {
        const input = page.getByPlaceholder('Buscar...');
        await input.fill(texto);
      });
    `;
    const issues = auditStepContent(goodCode, 'clean.steps.ts');
    assert.equal(issues.length, 0, 'Código limpio no debe tener advertencias');
  });

  test('extractFeatureSteps extrae todas las frases de pasos sin duplicados', () => {
    const featureText = `
      Característica: Demo
        Escenario: Uno
          Dado que estoy en "Inicio"
          Cuando busco "Hola"
          Y selecciono "Opción 1"
          Entonces veo "Resultado"
          Pero no veo "Error"
    `;
    const steps = extractFeatureSteps(featureText);
    assert.equal(steps.length, 5);
    assert.equal(steps[0], 'que estoy en "Inicio"');
    assert.equal(steps[1], 'busco "Hola"');
    assert.equal(steps[2], 'selecciono "Opción 1"');
    assert.equal(steps[3], 'veo "Resultado"');
    assert.equal(steps[4], 'no veo "Error"');
  });

  test('phraseToPattern hace matching exacto con strings e enteros parametrizados', () => {
    const pattern = phraseToPattern('que el usuario navega a {string} y tiene {int} items');
    assert.ok(pattern.test('que el usuario navega a "Servicios" y tiene 5 items'));
    assert.equal(pattern.test('que el usuario navega a Servicios y tiene 5 items'), false, 'Sin comillas debe fallar');
  });
});
