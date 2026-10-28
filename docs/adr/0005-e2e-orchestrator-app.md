# 0005 — Plataforma web local de orquestación E2E para flujo BDD

- **Estado:** propuesta
- **Fecha:** 2026-10-27

## Contexto

El comando `/new-test` permite a personas técnicas y de QA/negocio crear y automatizar pruebas en lenguaje natural. Sin embargo, para perfiles no acostumbrados al terminal de línea de comandos (QA funcional, analistas de negocio, Product Owners), interactuar directamente con la CLI de Claude Code o Cursor presenta fricción:
- Falta de visibilidad gráfica del ciclo de vida del feature (Borrador -> Aprobado -> Steps generados -> Verificado).
- Necesidad de revisar diffs de git y estado de aprobación de forma accesible sin comandos git en consola.
- Dificultad para auditar en tiempo real si el código generado cumple las reglas de calidad (sin `waitForTimeout`, sin XPath, sin credenciales).

Además, debemos mantener la estricta política de seguridad del repositorio:
1. La aplicación **nunca inicia sesión** ni almacena credenciales (ADR 0002).
2. Compatibilidad multiplataforma en **Windows y macOS** sin comandos específicos de un solo sistema operativo (ADR 0004).
3. Cero dependencias de bases de datos pesadas (Zero-DB): todo el estado debe persistirse en archivos del repositorio.

## Decisión

Construir una plataforma web local liviana (`app/`) basada en React 18, Vite 5 y Express 5:

1. **Orquestación externa (No reimplementa el agente):**
   La app actúa como panel de control. Lanza el agente configurado (`claude -p`, `cursor-agent -p` o `fake-agent.js`) en modo no interactivo. El texto del usuario se escribe en un archivo seguro (`data/runs/<id>.prompt.md`) y al agente solo se le pasa una instrucción fija, evitando inyección de shell.

2. **Zero-DB & Hashing SHA-256 de Deriva (Implementation Drift):**
   - El estado de aprobación se almacena en `data/approvals.json` con el hash SHA-256 del archivo `.feature`.
   - Al completar la verificación (`pnpm test`), se almacena el `implHash` determinista (hash del `.feature` + todos los archivos `steps/**/*.ts`).
   - Si los steps cambian posteriormente, la app detecta automáticamente el estado `IMPLEMENTATION_DRIFT` y bloquea la ejecución hasta que se revise y apruebe nuevamente.

3. **Cola de un solo worker y recuperación de huérfanos:**
   La ejecución de pruebas y agentes se gestiona mediante una cola secuencial en memoria con streaming Server-Sent Events (SSE) y soporte de replay mediante `Last-Event-ID`. Al arrancar el servidor, los jobs que quedaron en estado `RUNNING` o `QUEUED` se marcan automáticamente como `FAILED` para evitar estados inconsistentes.

4. **Guardrails automáticos de código:**
   Tras la generación de steps, un analizador estático audita los archivos modificados en `steps/` para detectar y alertar de inmediato sobre violaciones de reglas (`waitForTimeout`, `networkidle`, XPath, credenciales o `.nth()`).

5. **Detección de steps pendientes:**
   La interfaz analiza el `.feature` contra los step definitions implementados, mostrando cuántas frases faltan y deshabilitando la generación si no hay pasos pendientes.

## Alternativas descartadas

- **Navegador web embebido dentro de la app:**
  Descartado. El servidor MCP de Playwright ya controla navegadores reales con el contexto de sesión (`seed/seed.spec.ts`), y Playwright provee su propio reporte HTML y visor UI interactivo (`pnpm test:ui`).
- **Base de datos SQLite o PostgreSQL local:**
  Descartado. Añadiría complejidad de migración, dependencias binarias nativas problemáticas entre Windows y macOS, y rompería la portabilidad del repositorio.
- **Llamadas directas a APIs de modelos en el cliente (bypass de CLI):**
  Descartado. Los agentes del equipo están configurados con permisos de herramientas MCP en `.claude/` y `.cursor/`. Reimplementar el agente en JavaScript rompería la coherencia con `/new-test`.

## Consecuencias

- QA funcional y negocio pueden redactar, revisar, editar y aprobar escenarios desde una interfaz visual intuitiva.
- Los desarrolladores y automatizadores conservan el control total del código en `features/` y `steps/` versionado en git.
- Se garantiza la ejecución reproducible y segura en Windows y macOS.
