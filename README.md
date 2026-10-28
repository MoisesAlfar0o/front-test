# Orquestador E2E · LAFISErvicios BackOffice

Plataforma gráfica local para orquestar la creación, revisión, implementación y ejecución de pruebas End-to-End con BDD (Gherkin en español) y agentes de IA (Claude Code, Cursor CLI o Fake Agent).

## Requisitos

- **Node.js:** Versión 22 LTS (compatible con `.nvmrc`).
- **Gestor de paquetes:** `pnpm` o `npm`.
- **Sistemas operativos:** Compatible con **Windows** y **macOS** (ADR 0004).
- **Sesión de pruebas:** Generada por la persona mediante `pnpm auth:manual` (ADR 0002).

## Arranque rápido

```bash
# Instalar dependencias
pnpm install # o npm install

# Iniciar en modo desarrollo (Express + Vite integrado en puerto 3000)
pnpm dev     # o npm run dev

# Compilar para producción
pnpm build   # o npm run build

# Iniciar servidor de producción
pnpm start   # o npm start

# Ejecutar suite de pruebas y linter
pnpm check   # o npm run check
```

Abre tu navegador en `http://localhost:3000`.

## Configuración de Agentes de IA (`data/config.json`)

El agente activo y sus parámetros se configuran en `data/config.json`:

```json
{
  "agent": "fake",
  "timeoutMs": 120000,
  "agents": {
    "fake": {
      "cmd": "node",
      "args": ["server/fake-agent.js", "{prompt}"],
      "description": "Agente simulado para desarrollo, pruebas y verificación local sin dependencias externas"
    },
    "claude": {
      "cmd": "claude",
      "args": ["-p", "{prompt}", "--dangerously-skip-permissions"],
      "description": "Claude Code CLI con ejecución no interactiva y permisos automáticos"
    },
    "cursor": {
      "cmd": "cursor-agent",
      "args": ["-p", "{prompt}"],
      "description": "Cursor Agent CLI en modo no interactivo"
    }
  }
}
```

- Puedes cambiar el agente activo en cualquier momento desde el selector en la cabecera de la UI.
- `fake`: No requiere suscripción ni CLI externo. Genera archivos `.feature` válidos y step definitions siguiendo las convenciones.
- `claude`: Requiere tener `claude` instalado y autenticado en el sistema.
- `cursor`: Requiere tener `cursor-agent` instalado en el sistema.

## Ciclo de Vida del Feature

1. **Borrador (NOT_APPROVED):** Se describe la prueba en lenguaje natural. El agente crea el archivo `.feature` en `features/<area>/`.
2. **Aprobado (APPROVED):** La persona revisa el `.feature`, realiza ajustes si es necesario y pulsa **Aprobar** (sella el hash SHA-256).
3. **Generar steps:** El agente implementa los step definitions en `steps/`.
4. **Verificado (VERIFIED):** Al ejecutar el feature completo (`pnpm test`), se sella el hash conjunto de `.feature` + `steps/**`.
5. **Deriva (IMPLEMENTATION_DRIFT):** Si los archivos de steps son modificados posteriormente, el estado pasa automáticamente a `IMPLEMENTATION_DRIFT` para exigir revisión humana antes de volver a ejecutar.

## Guardrails de Código Automáticos

Tras cada generación de steps, el analizador estático verifica que el código generado cumpla las reglas inquebrantables del repositorio:
- ❌ Prohibido `waitForTimeout` (usar aserciones web-first con `expect`).
- ❌ Prohibido `networkidle`.
- ❌ Prohibido XPath (`//`, `xpath=`).
- ❌ Prohibido almacenar contraseñas, secretos o credenciales.
- ⚠ Advertencia ante uso de `.nth()` sin justificación.

## Solución de Problemas

| Problema | Causa | Solución |
|---|---|---|
| `AUTH_REQUIRED` / "Sin sesión" | La sesión de prueba en `test-results/.auth/user.json` no existe o expiró. | Ejecuta `pnpm auth:manual` en tu terminal. La app nunca almacena credenciales (ADR 0002). |
| `Agente no instalado` | El comando del agente seleccionado (`claude` o `cursor-agent`) no está en el PATH. | Cambia al agente `fake` en la cabecera o instala la CLI oficial correspondiente. |
| `IMPLEMENTATION_DRIFT` | Los steps en `steps/` cambiaron desde la última verificación. | Haz clic en "Ver cambios (git)", revisa el diff y pulsa "Aprobar" para sellar los nuevos hashes. |
| Reporte HTML no disponible | Aún no se ha completado una corrida con Playwright. | Ejecuta la suite con el botón "Ejecutar" o `pnpm test`. El reporte se abrirá en `/report`. |
