import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

const MAX = 5000;
const FINAL = ['DONE', 'FAILED', 'CANCELLED', 'AUTH_REQUIRED'];
const LABEL = {
  NOT_APPROVED: 'Sin aprobar',
  CHANGED: 'Editado tras aprobar',
  APPROVED: 'Aprobado',
  VERIFIED: 'Verificado',
  IMPLEMENTATION_DRIFT: 'Deriva de implementación',
  QUEUED: 'En cola',
  RUNNING: 'En curso',
  DONE: 'Terminado',
  FAILED: 'Falló',
  CANCELLED: 'Cancelado',
  AUTH_REQUIRED: 'Requiere sesión',
};
const KIND = { draft: 'Borrador', implement: 'Generar steps', run: 'Ejecución' };

const slug = (s) =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

const api = async (path, o = {}) => {
  const headers = {
    'Content-Type': 'application/json',
    'X-Orchestrator': '1',
    ...(o.headers || {}),
  };
  const r = await fetch('/api' + path, {
    ...o,
    headers,
    body: o.body && JSON.stringify(o.body),
  });
  const j = r.status === 204 ? {} : await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || r.statusText);
  return j;
};

// Los eventos SSE se acumulan en un ref; un solo setState cada 120 ms.
function useThrottledLog() {
  const buf = useRef([]);
  const [lines, setLines] = useState([]);
  useEffect(() => {
    const t = setInterval(() => {
      if (!buf.current.length) return;
      const batch = buf.current;
      buf.current = [];
      setLines((prev) => {
        const n = prev.concat(batch);
        return n.length > MAX ? n.slice(-MAX) : n;
      });
    }, 120);
    return () => clearInterval(t);
  }, []);
  const push = useCallback((t) => buf.current.push(t), []);
  const reset = useCallback(() => {
    buf.current = [];
    setLines([]);
  }, []);
  return { lines, push, reset };
}

// Scroll-lock: solo sigue el final si el scroll está cerca del final
function Console({ lines }) {
  const ref = useRef(null);
  const stick = useRef(true);
  const [atEnd, setAtEnd] = useState(true);

  const onScroll = () => {
    const e = ref.current;
    if (!e) return;
    stick.current = e.scrollHeight - e.scrollTop - e.clientHeight < 30;
    setAtEnd(stick.current);
  };

  useLayoutEffect(() => {
    if (stick.current && ref.current) {
      ref.current.scrollTop = ref.current.scrollHeight;
    }
  }, [lines]);

  const jump = () => {
    stick.current = true;
    if (ref.current) {
      ref.current.scrollTop = ref.current.scrollHeight;
      setAtEnd(true);
    }
  };

  return (
    <div className="console-wrap">
      <pre
        ref={ref}
        onScroll={onScroll}
        className="console"
        role="region"
        aria-label="Registro de ejecución y salida de agentes"
      >
        {lines.length
          ? lines.join('\n')
          : 'Aquí aparece la actividad del agente de IA, validaciones y salida de pruebas Playwright.'}
      </pre>
      {!atEnd && (
        <button className="jump" onClick={jump}>
          ↓ Ir al final
        </button>
      )}
    </div>
  );
}

// Recorrido de 4 etapas del feature
function Track({ status, hasSteps }) {
  const approved = ['APPROVED', 'VERIFIED'].includes(status);
  const stepsDone = approved && hasSteps;
  const verified = status === 'VERIFIED';

  const done = [true, approved, stepsDone, verified];
  const now = done.indexOf(false);
  const names = ['Borrador', 'Aprobado', 'Steps generados', 'Verificado'];

  return (
    <div className="track-wrap">
      <ol className="track" aria-label="Línea de avance del feature">
        {names.map((n, i) => (
          <li
            key={n}
            className={done[i] ? 'done' : i === now ? 'now' : ''}
            aria-current={i === now ? 'step' : undefined}
          >
            {n}
          </li>
        ))}
      </ol>
    </div>
  );
}

function NewTest({ areas, busy, onSubmit }) {
  const [f, setF] = useState({
    area: areas.includes('services') ? 'services' : areas[0] || 'services',
    custom: '',
    where: '',
    what: '',
    expect: '',
  });

  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const other = f.area === '__other';
  const area = other ? slug(f.custom) : f.area;

  return (
    <form
      className="new"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit({ area, where: f.where, what: f.what, expect: f.expect });
      }}
    >
      <div>
        <h2>Nueva prueba E2E</h2>
        <p className="hint">
          Describe la prueba en lenguaje de negocio (dónde, qué haces y qué debe pasar).
          El agente escribirá el archivo <code>.feature</code> en Gherkin en español.
          No se ejecutarán acciones hasta que lo revises y apruebes (ADR 0002).
        </p>
      </div>

      <label>
        Área funcional (LAFISErvicios)
        <select value={f.area} onChange={set('area')} aria-label="Selecciona área funcional">
          {areas.map((a) => (
            <option key={a} value={a}>
              {a}
            </option>
          ))}
          <option value="__other">Otra área personalizada…</option>
        </select>
      </label>

      {other && (
        <label>
          Nombre del área nueva (kebab-case)
          <input
            value={f.custom}
            onChange={set('custom')}
            placeholder="ejemplo: bank-transfers"
            required
          />
          <small className="hint">Se guardará en <code>features/{area || '…'}/</code></small>
        </label>
      )}

      <label>
        Dónde (pantalla o sección)
        <input
          value={f.where}
          onChange={set('where')}
          placeholder="Servicios, país Nicaragua"
          required
        />
      </label>

      <label>
        Qué hace la persona (acciones del usuario)
        <input
          value={f.what}
          onChange={set('what')}
          placeholder='Busco "Agua" en el campo de búsqueda'
          required
        />
      </label>

      <label>
        Qué debe pasar (resultado esperado de negocio)
        <textarea
          rows={3}
          value={f.expect}
          onChange={set('expect')}
          placeholder='Solo se visualizan los servicios cuyo nombre contiene "Agua"'
          required
        />
      </label>

      <div className="bar">
        <button type="submit" className="primary" disabled={busy || !area}>
          {busy ? 'Generando...' : 'Generar .feature con IA'}
        </button>
      </div>
    </form>
  );
}

export default function App() {
  const [meta, setMeta] = useState(null);
  const [features, setFeatures] = useState([]);
  const [jobs, setJobs] = useState([]);
  const [guards, setGuards] = useState([]);
  const [missing, setMissing] = useState(null);
  const [filterText, setFilterText] = useState('');
  const [filterStatus, setFilterStatus] = useState('ALL');

  const [mode, setMode] = useState('new');
  const [sel, setSel] = useState(null);
  const [text, setText] = useState('');
  const [saved, setSaved] = useState('');
  const [status, setStatus] = useState('');
  const [scenarios, setScenarios] = useState([]);
  const [target, setTarget] = useState('');
  const [job, setJob] = useState(null);
  const [dock, setDock] = useState('consola');
  const [mine, setMine] = useState(true);
  const [diff, setDiff] = useState('');
  const [err, setErr] = useState('');

  const log = useThrottledLog();
  const es = useRef(null);
  const selRef = useRef(null);
  const draft = useRef(null);

  const refresh = useCallback(async () => {
    const [m, f, j, g] = await Promise.all([
      api('/meta'),
      api('/features'),
      api('/jobs'),
      api('/guards'),
    ]);
    setMeta(m);
    setFeatures(f);
    setJobs(j);
    setGuards(g.issues || []);
  }, []);

  const open = useCallback(async (id) => {
    const f = await api('/feature?id=' + encodeURIComponent(id));
    selRef.current = id;
    setSel(id);
    setText(f.content);
    setSaved(f.content);
    setStatus(f.status);
    setScenarios(f.scenarios || []);
    setMissing(f.missingSteps || null);
    setTarget('');
    setDiff('');
    setMode('feature');
  }, []);

  useEffect(() => {
    refresh().catch((e) => setErr(e.message));
  }, [refresh]);

  const guardAction = (fn) => async (...a) => {
    setErr('');
    try {
      await fn(...a);
    } catch (e) {
      setErr(e.message);
    }
  };

  const watch = guardAction(async (id, known) => {
    es.current?.close();
    log.reset();
    setDock('consola');
    setJob({ id, status: known ?? 'QUEUED' });

    if (known && FINAL.includes(known)) {
      const r = await api(`/jobs/${id}/log`);
      r.text
        .replace(/\n$/, '')
        .split('\n')
        .forEach((l) => log.push(l));
      return;
    }

    const s = new EventSource(`/api/jobs/${id}/stream`);
    es.current = s;
    s.onmessage = async (m) => {
      const ev = JSON.parse(m.data);
      if (ev.t === 'log') return log.push(ev.text);
      if (ev.t === 'warnings') setGuards(ev.warnings || []);
      setJob({ id, status: ev.status });

      if (!FINAL.includes(ev.status)) return;
      s.close();
      await refresh();
      const d = draft.current;
      if (d?.id === id) {
        draft.current = null;
        const fresh = await api('/features');
        const n = fresh.find((x) => !d.before.has(x.id));
        if (n) return open(n.id);
      }
      if (selRef.current) open(selRef.current);
    };
  });

  const start = guardAction(async (type, body) => {
    const j = await api('/jobs', { method: 'POST', body: { type, ...body } });
    if (type === 'draft') {
      draft.current = { id: j.id, before: new Set(features.map((f) => f.id)) };
    }
    watch(j.id);
    refresh();
  });

  const save = guardAction(async () => {
    const r = await api('/feature', { method: 'PUT', body: { id: sel, content: text } });
    setSaved(text);
    setStatus(r.status);
    open(sel);
    refresh();
  });

  const approve = guardAction(async () => {
    const r = await api('/approve', { method: 'POST', body: { id: sel } });
    setStatus(r.status);
    open(sel);
    refresh();
  });

  const showDiff = guardAction(async () => {
    const r = await api('/diff');
    setDiff(r.text);
  });

  const changeAgent = guardAction(async (agentName) => {
    await api('/config', { method: 'POST', body: { agent: agentName } });
    refresh();
  });

  const addLanguageHeader = () => {
    setText((prev) => `# language: es\n${prev.replace(/^\s*#\s*language:\s*[^\n]+\n?/, '')}`);
  };

  const dirty = text !== saved;
  const busy = !!job && !FINAL.includes(job.status);
  const ready = ['APPROVED', 'VERIFIED'].includes(status);
  const hasSteps = jobs.some(
    (j) => j.type === 'implement' && j.status === 'DONE' && j.payload?.feature === sel
  );
  const current = features.find((f) => f.id === sel);
  const history = jobs.filter(
    (j) => !mine || !sel || j.payload?.feature === sel || j.payload?.all
  );

  const hasLanguageEs = /^\s*#\s*language:\s*es/m.test(text);
  const noMissingSteps = missing && missing.count === 0;

  // Filtrado de features en barra lateral
  const filteredFeatures = features.filter((f) => {
    const matchText =
      !filterText ||
      f.id.toLowerCase().includes(filterText.toLowerCase()) ||
      f.title.toLowerCase().includes(filterText.toLowerCase());
    const matchStatus = filterStatus === 'ALL' || f.status === filterStatus;
    return matchText && matchStatus;
  });

  return (
    <div className="app">
      <header className="top">
        <div className="brand">
          <span className="brand-badge">E2E QA</span>
          <h1>
            Orquestador E2E <small>LAFISErvicios BackOffice</small>
          </h1>
        </div>

        <div className="header-tools">
          <div className="session-box">
            <span
              className={'dot ' + (meta?.auth.exists ? 'ok' : 'warn')}
              title={meta?.auth.exists ? 'Sesión activa en test-results/.auth/' : 'Sesión ausente'}
            />
            <span>
              {meta?.auth.exists ? 'Sesión guardada' : 'Sin sesión: ejecuta pnpm auth:manual'}
            </span>
          </div>

          <div className="agent-selector">
            <span>Agente:</span>
            <select
              value={meta?.agent || 'fake'}
              onChange={(e) => changeAgent(e.target.value)}
              aria-label="Seleccionar agente de IA activo"
            >
              <option value="fake">Fake (Local / Tests)</option>
              <option value="claude">Claude Code CLI</option>
              <option value="cursor">Cursor CLI</option>
            </select>
            <span
              className={
                'pill ' +
                (meta?.agentStatus?.available || meta?.agent === 'fake' ? 'DONE' : 'FAILED')
              }
              title={meta?.agentStatus?.warning || 'Agente listo'}
            >
              {meta?.agentStatus?.available || meta?.agent === 'fake'
                ? 'Conectado'
                : 'No instalado'}
            </span>
          </div>
        </div>
      </header>

      {err && (
        <div className="alert-strip error" role="alert">
          <span>{err}</span>
          <button onClick={() => setErr('')}>Cerrar</button>
        </div>
      )}

      {meta?.agentStatus?.warning && meta?.agent !== 'fake' && (
        <div className="alert-strip warning" role="alert">
          <span>{meta.agentStatus.warning}</span>
          <button onClick={() => changeAgent('fake')}>Usar agente Fake</button>
        </div>
      )}

      <div className="body">
        <nav className="rail" aria-label="Navegación de características">
          <div className="rail-head">
            <button className="primary" onClick={() => setMode('new')}>
              + Nueva prueba
            </button>
            <input
              type="search"
              className="rail-search"
              placeholder="Buscar feature o área..."
              value={filterText}
              onChange={(e) => setFilterText(e.target.value)}
              aria-label="Filtrar características"
            />
            <div className="rail-filters">
              <span>Estado:</span>
              <select
                value={filterStatus}
                onChange={(e) => setFilterStatus(e.target.value)}
                aria-label="Filtrar por estado"
              >
                <option value="ALL">Todos ({features.length})</option>
                <option value="NOT_APPROVED">Sin aprobar</option>
                <option value="APPROVED">Aprobado</option>
                <option value="VERIFIED">Verificado</option>
                <option value="IMPLEMENTATION_DRIFT">Con deriva</option>
              </select>
            </div>
          </div>

          {!filteredFeatures.length && (
            <p className="hint">
              {features.length ? 'Ningún feature coincide con el filtro.' : 'Aún no hay archivos .feature.'}
            </p>
          )}

          <ul>
            {filteredFeatures.map((f) => (
              <li key={f.id}>
                <button
                  className={
                    'item ' + f.status + (f.id === sel && mode === 'feature' ? ' active' : '')
                  }
                  onClick={guardAction(() => open(f.id))}
                >
                  <strong>{f.title}</strong>
                  <small>{f.id}</small>
                  <span className={'pill ' + f.status}>
                    {LABEL[f.status]}
                    {f.fixme ? ' · @fixme' : ''}
                  </span>
                </button>
              </li>
            ))}
          </ul>

          <div style={{ marginTop: 'auto', paddingTop: 10 }}>
            <button
              style={{ width: '100%' }}
              onClick={() => start('run', { all: true })}
              disabled={busy}
            >
              Ejecutar toda la suite
            </button>
          </div>
        </nav>

        <div className="work">
          <section className="stage">
            {mode === 'new' && meta ? (
              <NewTest
                areas={meta.areas}
                busy={busy}
                onSubmit={(f) => start('draft', f)}
              />
            ) : sel ? (
              <>
                <div className="head">
                  <h2>{current?.title || sel}</h2>
                  <span className={'pill ' + status}>{LABEL[status]}</span>
                  <span className="path-badge">features/{sel}</span>
                </div>

                <Track status={status} hasSteps={hasSteps} />

                {/* Banner de missing steps */}
                {missing && (
                  <div className={'missing-banner ' + (noMissingSteps ? 'clean' : '')}>
                    {noMissingSteps ? (
                      <span>✓ Todos los pasos están implementados en <code>steps/</code>.</span>
                    ) : (
                      <span>
                        Faltan <strong>{missing.count}</strong> paso(s) por implementar:{' '}
                        {missing.missing.slice(0, 2).map((m) => `"${m}"`).join(', ')}
                        {missing.missing.length > 2 ? '...' : ''}
                      </span>
                    )}
                  </div>
                )}

                {/* Banner si falta # language: es */}
                {!hasLanguageEs && (
                  <div className="missing-banner">
                    <span>⚠ Falta la directiva <code># language: es</code> en la cabecera.</span>
                    <button onClick={addLanguageHeader}>Agregar encabezado</button>
                  </div>
                )}

                <div className="editor-container">
                  <div className="editor-header">
                    <span>Editor Gherkin (español)</span>
                    {dirty && <span>● Cambios sin guardar</span>}
                  </div>
                  <textarea
                    className="editor"
                    spellCheck={false}
                    value={text}
                    onChange={(e) => setText(e.target.value)}
                    aria-label="Contenido del archivo .feature"
                  />
                </div>

                <div className="bar">
                  <button onClick={save} disabled={!dirty}>
                    Guardar
                  </button>
                  <button
                    className="primary"
                    onClick={approve}
                    disabled={dirty || ready}
                  >
                    Aprobar
                  </button>
                  <span className="sep" />
                  <button
                    onClick={() => start('implement', { feature: sel })}
                    disabled={!ready || busy || noMissingSteps}
                    title={noMissingSteps ? 'Todos los steps ya están implementados' : 'Generar steps con el agente'}
                  >
                    Generar steps con IA {noMissingSteps ? '(Completo)' : ''}
                  </button>
                  <select
                    value={target}
                    onChange={(e) => setTarget(e.target.value)}
                    aria-label="Seleccionar escenario para ejecutar"
                  >
                    <option value="">Todo el feature</option>
                    {scenarios.map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </select>
                  <button
                    className="primary"
                    onClick={() =>
                      start('run', {
                        feature: sel,
                        ...(target ? { scenario: target } : {}),
                      })
                    }
                    disabled={!ready || busy}
                  >
                    Ejecutar
                  </button>
                  <span className="sep" />
                  <button onClick={showDiff}>Ver cambios (git)</button>
                  <a className="btn" href="/report" target="_blank" rel="noreferrer">
                    Reporte HTML ↗
                  </a>
                </div>

                {dirty && <p className="hint">Guarda los cambios antes de aprobar.</p>}
                {status === 'IMPLEMENTATION_DRIFT' && (
                  <p className="hint" style={{ color: 'var(--warn)' }}>
                    ⚠ Deriva de implementación: los steps cambiaron desde la última verificación.
                    Revisa los cambios en git y vuelve a aprobar.
                  </p>
                )}

                {diff && <pre className="diff">{diff}</pre>}
              </>
            ) : (
              <p className="hint">Elige un feature de la barra lateral o crea una prueba nueva.</p>
            )}
          </section>

          <section className="dock">
            <div className="tabs" role="tablist">
              <button
                role="tab"
                aria-selected={dock === 'consola'}
                onClick={() => setDock('consola')}
              >
                Consola {job && <span className={'pill ' + job.status}>{LABEL[job.status]}</span>}
              </button>
              <button
                role="tab"
                aria-selected={dock === 'historial'}
                onClick={() => setDock('historial')}
              >
                Historial ({history.length})
              </button>
              <button
                role="tab"
                aria-selected={dock === 'guards'}
                onClick={() => setDock('guards')}
              >
                Guardrails {guards.length > 0 && <span className="pill FAILED">{guards.length}</span>}
              </button>
              {busy && (
                <button
                  className="danger"
                  onClick={guardAction(() => api('/jobs/' + job.id, { method: 'DELETE' }))}
                >
                  Cancelar job
                </button>
              )}
            </div>

            {dock === 'consola' ? (
              <Console lines={log.lines} />
            ) : dock === 'historial' ? (
              <div className="history">
                {sel && (
                  <label className="check" style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                    <input
                      type="checkbox"
                      checked={mine}
                      onChange={(e) => setMine(e.target.checked)}
                    />
                    Solo ejecuciones de este feature
                  </label>
                )}
                {!history.length && <p className="hint">Sin ejecuciones registradas.</p>}
                <ul>
                  {history.map((j) => (
                    <li key={j.id}>
                      <strong>{KIND[j.type] || j.type}</strong>
                      <span className="grow">
                        {j.payload?.scenario || j.payload?.feature || j.payload?.area || 'Toda la suite'}
                      </span>
                      <time>{new Date(j.createdAt).toLocaleTimeString()}</time>
                      <span className={'pill ' + j.status}>{LABEL[j.status] || j.status}</span>
                      <button onClick={() => watch(j.id, j.status)}>Ver log</button>
                      {j.type !== 'draft' && (
                        <button onClick={() => start(j.type, j.payload)} disabled={busy}>
                          Repetir
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            ) : (
              <div className="guards-panel">
                {!guards.length ? (
                  <p className="hint">
                    ✓ Sin advertencias: todos los step definitions cumplen las reglas del repositorio (sin waitForTimeout, sin networkidle, sin XPath).
                  </p>
                ) : (
                  guards.map((g, idx) => (
                    <div key={idx} className="guard-card">
                      <strong>[{g.level}] Regla: {g.rule}</strong>
                      <span>{g.message}</span>
                      <code>{g.file}:{g.line}</code>
                      {g.snippet && <pre style={{ margin: 0, opacity: 0.8 }}>{g.snippet}</pre>}
                    </div>
                  ))
                )}
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
