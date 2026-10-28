// Orquestación de agentes de IA externos y simulados (Claude Code, Cursor CLI, Fake Agent).
// El prompt se escribe en un archivo seguro en app/data/runs/ y al proceso solo se le pasa
// una instrucción fija: ningún texto del usuario pasa por el shell.
import fsp from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { DATA, RUNS, readJson, writeJson } from './lib.js';

export const DEFAULT_CONFIG = {
  agent: 'fake',
  timeoutMs: 120000,
  agents: {
    fake: {
      cmd: 'node',
      args: ['server/fake-agent.js', '{prompt}'],
      description: 'Agente simulado para desarrollo, pruebas y verificación local sin dependencias externas',
    },
    claude: {
      cmd: 'claude',
      args: ['-p', '{prompt}', '--dangerously-skip-permissions'],
      description: 'Claude Code CLI con ejecución no interactiva y permisos automáticos',
    },
    cursor: {
      cmd: 'cursor-agent',
      args: ['-p', '{prompt}'],
      description: 'Cursor Agent CLI en modo no interactivo',
    },
  },
};

export async function loadConfig() {
  const f = path.join(DATA, 'config.json');
  const c = await readJson(f, null);
  if (c && c.agents) return c;
  await writeJson(f, DEFAULT_CONFIG);
  return DEFAULT_CONFIG;
}

export async function saveConfig(updates) {
  const current = await loadConfig();
  const merged = { ...current, ...updates };
  const f = path.join(DATA, 'config.json');
  await writeJson(f, merged);
  return merged;
}

export function isCommandAvailable(cmd) {
  if (!cmd) return false;
  if (cmd === 'node' || cmd === process.execPath) return true;
  const isWin = process.platform === 'win32';
  const checkCmd = isWin ? 'where' : 'which';
  try {
    const res = spawnSync(checkCmd, [cmd], { stdio: 'ignore', shell: isWin });
    return res.status === 0;
  } catch {
    return false;
  }
}

export async function getAgentStatus() {
  const cfg = await loadConfig();
  const currentAgent = cfg.agent || 'fake';
  const agentDef = cfg.agents?.[currentAgent];
  const isAvailable = agentDef ? isCommandAvailable(agentDef.cmd) : false;

  const warning = !agentDef
    ? `Agente "${currentAgent}" no está configurado en data/config.json.`
    : !isAvailable
      ? `El comando "${agentDef.cmd}" no se encuentra en el PATH del sistema. Configura el agente en data/config.json o selecciona el agente 'fake'.`
      : null;

  return {
    current: currentAgent,
    available: isAvailable,
    warning,
    timeoutMs: cfg.timeoutMs || 120000,
    options: Object.entries(cfg.agents || {}).map(([key, item]) => ({
      key,
      cmd: item.cmd,
      description: item.description,
      installed: isCommandAvailable(item.cmd),
    })),
  };
}

export async function agentCommand(jobId, promptText) {
  await fsp.writeFile(path.join(RUNS, `${jobId}.prompt.md`), promptText, 'utf8');
  const cfg = await loadConfig();
  const a = cfg.agents?.[cfg.agent];
  if (!a) throw new Error(`Agente "${cfg.agent}" no definido en app/data/config.json`);

  const instr = `Lee y sigue exactamente las instrucciones de app/data/runs/${jobId}.prompt.md`;
  return {
    cmd: a.cmd,
    args: a.args.map((x) => x.replace('{prompt}', instr)),
    timeoutMs: cfg.timeoutMs || 120000,
  };
}

const REGLAS = `Lee primero las convenciones del repo (CLAUDE.md / AGENTS.md).
- Gherkin en español (# language: es). Nombres de archivo en inglés, kebab-case.
- Reutiliza literalmente las frases de steps existentes (steps/**/*.ts). Crea frases nuevas solo si ninguna sirve, con datos variables entre comillas.
- Etiqueta la característica con @<area>. @smoke solo en escenarios críticos y rápidos.
- Solo flujos de LECTURA (consultas, filtros, listados, navegación). Nunca acciones con efecto real (ADR 0002).
- Selectores: getByRole > getByLabel > getByPlaceholder > getByText > getByTestId. Sin XPath ni clases CSS.
- Aserciones web-first con expect. Prohibido waitForTimeout y networkidle.
- Nunca edites .features-gen/. Sin credenciales ni datos reales. No hagas commit ni push.
- NUNCA inicies sesión ni escribas credenciales. Si falla la sesión ("No hay una sesión guardada" / "La sesión guardada expiró"), detente e indica que la persona ejecute pnpm auth:manual.
- Esto corre sin interacción: no hagas preguntas, toma la decisión más razonable.`;

export function buildPrompt(type, p) {
  if (type === 'draft') {
    return `Eres analista QA de LAFISErvicios (BackOffice LAFISE). Crea SOLO el archivo .feature de esta prueba. NO implementes steps.

Dónde: ${p.where}
Qué hace la persona: ${p.what}
Qué debe pasar: ${p.expect}
Área: ${p.area}

Escribe el resultado esperado tal como lo dio la persona; no lo deduzcas de lo que hace la aplicación hoy.
Archivo: features/${p.area}/<nombre-en-ingles>.feature (si ya existe uno de esa funcionalidad, agrega ahí el escenario).

${REGLAS}

Al final indica la ruta del archivo y la lista de frases nuevas que habrá que implementar.`;
  }

  return `Eres automatizador Playwright + playwright-bdd. Implementa los steps que faltan para features/${p.feature}. NO modifiques el .feature.

1. Ejecuta pnpm bddgen: lista las frases sin implementar. Si no falta ninguna, dilo y termina.
2. Ejecuta cada escenario afectado en el navegador real con el MCP playwright-test (seed/seed.spec.ts, proyecto seed; ya llega con la sesión iniciada) para sacar selectores comprobados.
3. Escribe los steps: genéricos en steps/common.steps.ts, los de un área en steps/<area>/<feature>.steps.ts. Importa Given/When/Then desde steps/fixtures.ts. Frase idéntica a la del .feature; {string} y {int} para datos.
4. Verifica: pnpm bddgen && npx playwright test --project=setup --project=bdd --grep "<escenario>" hasta que pase.
5. Si la aplicación no se comporta como dice el .feature, no cambies lo esperado: deja el step bien hecho, marca el escenario @fixme con "# POSIBLE DEFECTO: ..." y repórtalo.

${REGLAS}

Termina con un resumen: steps nuevos (frase y archivo), resultado y posibles defectos.`;
}
