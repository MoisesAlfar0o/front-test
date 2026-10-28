# Architecture Decision Records (ADR)

Registro de las decisiones de diseño de este repositorio: **qué** se decidió, **por qué** y sus
**consecuencias**. Cada ADR es un archivo numerado que no se borra: si una decisión se reemplaza, se
marca como tal y se escribe una nueva.

## Convención

- Un archivo por decisión: `NNNN-titulo-en-ingles.md` (numeración incremental, nombre en inglés,
  kebab-case). El contenido puede ir en español.
- Estados: `propuesta`, `aceptada`, `reemplazada`, `rechazada`.
- Estructura: Contexto → Decisión → Consecuencias.

## Índice

| # | Decisión | Estado |
|---|---|---|
| [0001](0001-ai-agents-with-bdd.md) | Agentes de IA propios para trabajar con BDD (Gherkin) | aceptada |
| [0002](0002-temporary-manual-login.md) | Login fuera de este repo; login manual temporal mientras tanto | aceptada (temporal) |
| [0003](0003-run-without-login-in-pipeline.md) | Correr las pruebas sin login (para pipeline) | propuesta |
| [0004](0004-cross-platform-mcp-server-command.md) | Comando del servidor MCP compatible con Windows y macOS | aceptada |
| [0005](0005-e2e-orchestrator-app.md) | Plataforma web local de orquestación E2E para flujo BDD | propuesta |
