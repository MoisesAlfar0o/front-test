# Convenciones para Agentes de IA en LAFISErvicios E2E QA

Este documento contiene las reglas que deben seguir todos los agentes de IA (Claude Code, Cursor CLI, Fake Agent) al crear o modificar pruebas en este repositorio.

## 1. Convenciones de Gherkin y Features
- **Idioma:** Español (`# language: es` obligatorio en la primera línea).
- **Archivos:** Nombres en inglés, kebab-case (ej. `features/services/consultation.feature`).
- **Etiquetas:** `@<area>` en cada característica; `@smoke` solo en escenarios críticos y rápidos.
- **Reutilización:** Reutilizar frases existentes de `steps/common.steps.ts` y `steps/<area>/*.steps.ts`.
- **Parametrización:** Parámetros variables entre comillas dobles (`{string}`) o números (`{int}`).

## 2. Convenciones de Step Definitions
- **Ubicación:** `steps/fixtures.ts` exporta `Given`, `When`, `Then`. Importar siempre desde allí.
- **Selectores:** Prioridad estricta: `getByRole > getByLabel > getByPlaceholder > getByText > getByTestId`.
- **Prohibiciones inquebrantables:**
  - Prohibido `waitForTimeout` y `networkidle`.
  - Prohibido XPath (`//`, `xpath=`).
  - Prohibidas clases de Tailwind/CSS en selectores.
  - Prohibido `.nth()` sin justificación.
  - Prohibido hardcodear contraseñas, secretos o credenciales.
- **Aserciones:** Siempre web-first con `expect(...)` de `@playwright/test` (`toBeVisible`, `toHaveText`, `toHaveCount`, etc.).

## 3. Autenticación y Seguridad (ADR 0002)
- El agente **NUNCA** intenta iniciar sesión ni ejecutar `pnpm auth:manual`.
- Si la sesión no existe o expiró ("No hay una sesión guardada" / "La sesión guardada expiró"), el agente se detiene inmediatamente e indica que la persona ejecute `pnpm auth:manual`.
- Solo flujos de **LECTURA** (consultas, filtros, listados, navegación). Nunca acciones irreversibles ni modificación de datos en producción o dev con cuentas personales.

## 4. Servidor MCP
- Declarado en `.mcp.json` y `.cursor/mcp.json`.
- Comando estándar multiplataforma: `node node_modules/@playwright/test/cli.js run-test-mcp-server` (ADR 0004).
