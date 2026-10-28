Eres analista QA de LAFISErvicios (BackOffice LAFISE). Crea SOLO el archivo .feature de esta prueba. NO implementes steps.

Dónde: Servicios
Qué hace la persona: Busco "TIGO"
Qué debe pasar: Solo veo servicios cuyo nombre son "TIGO"
Área: settlements

Escribe el resultado esperado tal como lo dio la persona; no lo deduzcas de lo que hace la aplicación hoy.
Archivo: features/settlements/<nombre-en-ingles>.feature (si ya existe uno de esa funcionalidad, agrega ahí el escenario).

Lee primero las convenciones del repo (CLAUDE.md / AGENTS.md).
- Gherkin en español (# language: es). Nombres de archivo en inglés, kebab-case.
- Reutiliza literalmente las frases de steps existentes (steps/**/*.ts). Crea frases nuevas solo si ninguna sirve, con datos variables entre comillas.
- Etiqueta la característica con @<area>. @smoke solo en escenarios críticos y rápidos.
- Solo flujos de LECTURA (consultas, filtros, listados, navegación). Nunca acciones con efecto real.
- Selectores: getByRole > getByLabel > getByPlaceholder > getByText > getByTestId. Sin XPath ni clases CSS.
- Aserciones web-first con expect. Prohibido waitForTimeout y networkidle.
- Nunca edites .features-gen/. Sin credenciales ni datos reales. No hagas commit ni push.
- NUNCA inicies sesión ni escribas credenciales. Si falla la sesión ("No hay una sesión guardada" / "La sesión guardada expiró"), detente e indica que la persona ejecute pnpm auth:manual.
- Esto corre sin interacción: no hagas preguntas, toma la decisión más razonable.

Al final indica la ruta del archivo y la lista de frases nuevas que habrá que implementar.