// Orquesta un agente de IA externo (Claude Code, Cursor CLI...) en modo no interactivo.
// El prompt se escribe en un archivo y al agente solo se le pasa una instrucción fija:
// así el texto del usuario nunca pasa por el shell.
import fsp from 'node:fs/promises';
import path from 'node:path';
import { DATA, RUNS, readJson, writeJson } from './lib.js';

// ⚠ Flags SIN verificar contra tu versión instalada: ajústalos en app/data/config.json.
// Puede que necesites agregar flags de permisos para que el agente use el MCP y edite archivos.
const DEFAULT = {
  agent: 'claude',
  agents: {
    claude: { cmd: 'claude', args: ['-p', '{prompt}'] },
    cursor: { cmd: 'cursor-agent', args: ['-p', '{prompt}'] },
  },
};

export async function loadConfig() {
  const f = path.join(DATA, 'config.json');
  const c = await readJson(f, null);
  if (c) return c;
  await writeJson(f, DEFAULT);
  return DEFAULT;
}

export async function agentCommand(jobId, promptText) {
  await fsp.writeFile(path.join(RUNS, `${jobId}.prompt.md`), promptText);
  const cfg = await loadConfig();
  const a = cfg.agents?.[cfg.agent];
  if (!a) throw new Error(`Agente "${cfg.agent}" no definido en app/data/config.json`);
  const instr = `Lee y sigue exactamente las instrucciones de app/data/runs/${jobId}.prompt.md`;
  return { cmd: a.cmd, args: a.args.map((x) => x.replace('{prompt}', instr)) };
}

const REGLAS = `Lee primero las convenciones del repo (CLAUDE.md / AGENTS.md).
- Gherkin en español (# language: es). Nombres de archivo en inglés, kebab-case.
- Reutiliza literalmente las frases de steps existentes (steps/**/*.ts). Crea frases nuevas solo si ninguna sirve, con datos variables entre comillas.
- Etiqueta la característica con @<area>. @smoke solo en escenarios críticos y rápidos.
- Solo flujos de LECTURA (consultas, filtros, listados, navegación). Nunca acciones con efecto real.
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
