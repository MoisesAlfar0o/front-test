import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

const MAX = 4000;
const FINAL = ['DONE', 'FAILED', 'CANCELLED', 'AUTH_REQUIRED'];
const LABEL = {
  NOT_APPROVED: 'Sin aprobar', CHANGED: 'Editado tras aprobar', APPROVED: 'Aprobado', VERIFIED: 'Verificado',
  IMPLEMENTATION_DRIFT: 'Deriva de implementación', QUEUED: 'En cola', RUNNING: 'En curso', DONE: 'Terminado',
  FAILED: 'Falló', CANCELLED: 'Cancelado', AUTH_REQUIRED: 'Requiere sesión',
};
const KIND = { draft: 'Borrador', implement: 'Generar steps', run: 'Ejecución' };
const slug = (s) => s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

const api = async (path, o = {}) => {
  const r = await fetch('/api' + path, { headers: { 'Content-Type': 'application/json' }, ...o, body: o.body && JSON.stringify(o.body) });
  const j = r.status === 204 ? {} : await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || r.statusText);
  return j;
};

// Los eventos SSE se acumulan en un ref; un solo setState cada 150 ms.
function useThrottledLog() {
  const buf = useRef([]);
  const [lines, setLines] = useState([]);
  useEffect(() => {
    const t = setInterval(() => {
      if (!buf.current.length) return;
      const batch = buf.current;
      buf.current = [];
      setLines((prev) => { const n = prev.concat(batch); return n.length > MAX ? n.slice(-MAX) : n; });
    }, 150);
    return () => clearInterval(t);
  }, []);
  const push = useCallback((t) => buf.current.push(t), []);
  const reset = useCallback(() => { buf.current = []; setLines([]); }, []);
  return { lines, push, reset };
}

// Scroll-lock: solo sigue el final si estás a menos de 24 px de él.
function Console({ lines }) {
  const ref = useRef(null);
  const stick = useRef(true);
  const [atEnd, setAtEnd] = useState(true);
  const onScroll = () => {
    const e = ref.current;
    stick.current = e.scrollHeight - e.scrollTop - e.clientHeight < 24;
    setAtEnd(stick.current);
  };
  useLayoutEffect(() => { if (stick.current) ref.current.scrollTop = ref.current.scrollHeight; }, [lines]);
  const jump = () => { stick.current = true; ref.current.scrollTop = ref.current.scrollHeight; setAtEnd(true); };
  return (
    <div className="console-wrap">
      <pre ref={ref} onScroll={onScroll} className="console">{lines.length ? lines.join('\n') : 'Aquí aparece lo que hace el agente y lo que imprime Playwright.'}</pre>
      {!atEnd && <button className="jump" onClick={jump}>Ir al final</button>}
    </div>
  );
}

// El recorrido de un feature: lo único que hay que entender de un vistazo.
function Track({ status, hasSteps }) {
  const approved = ['APPROVED', 'VERIFIED'].includes(status);
  const done = [true, approved, approved && hasSteps, status === 'VERIFIED'];
  const now = done.indexOf(false);
  const names = ['Borrador', 'Aprobado', 'Steps generados', 'Verificado'];
  return (
    <ol className="track" aria-label="Avance del feature">
      {names.map((n, i) => <li key={n} className={done[i] ? 'done' : i === now ? 'now' : ''} aria-current={i === now ? 'step' : undefined}>{n}</li>)}
    </ol>
  );
}

function NewTest({ areas, busy, onSubmit }) {
  const [f, setF] = useState({ area: areas.includes('services') ? 'services' : areas[0], custom: '', where: '', what: '', expect: '' });
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const other = f.area === '__other';
  const area = other ? slug(f.custom) : f.area;
  return (
    <form className="new" onSubmit={(e) => { e.preventDefault(); onSubmit({ area, where: f.where, what: f.what, expect: f.expect }); }}>
      <h2>Nueva prueba</h2>
      <p className="hint">Describe la prueba y la IA escribe el .feature. Todavía no se generan steps ni se ejecuta nada: primero lo revisas y lo apruebas. Solo flujos de lectura (consultas, filtros, listados, navegación).</p>
      <label>Área
        <select value={f.area} onChange={set('area')}>
          {areas.map((a) => <option key={a}>{a}</option>)}
          <option value="__other">Otra área…</option>
        </select>
      </label>
      {other && (
        <label>Nombre del área nueva
          <input value={f.custom} onChange={set('custom')} placeholder="por ejemplo: bank-accounts" />
          <small className="hint">Se guardará en features/{area || '…'}/</small>
        </label>
      )}
      <label>Dónde<input value={f.where} onChange={set('where')} placeholder="Servicios, país Nicaragua" required /></label>
      <label>Qué haces<input value={f.what} onChange={set('what')} placeholder='Busco "Agua" en el buscador' required /></label>
      <label>Qué debe pasar<textarea rows={3} value={f.expect} onChange={set('expect')} placeholder='Solo veo servicios cuyo nombre contiene "Agua"' required /></label>
      <button className="primary" disabled={busy || !area}>Generar .feature</button>
    </form>
  );
}

export default function App() {
  const [meta, setMeta] = useState(null);
  const [features, setFeatures] = useState([]);
  const [jobs, setJobs] = useState([]);
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
    const [m, f, j] = await Promise.all([api('/meta'), api('/features'), api('/jobs')]);
    setMeta(m); setFeatures(f); setJobs(j);
  }, []);
  const open = useCallback(async (id) => {
    const f = await api('/feature?id=' + encodeURIComponent(id));
    selRef.current = id; setSel(id); setText(f.content); setSaved(f.content); setStatus(f.status);
    setScenarios(f.scenarios); setTarget(''); setDiff(''); setMode('feature');
  }, []);
  useEffect(() => { refresh().catch((e) => setErr(e.message)); }, [refresh]);

  const guard = (fn) => async (...a) => { setErr(''); try { await fn(...a); } catch (e) { setErr(e.message); } };

  const watch = guard(async (id, known) => {
    es.current?.close();
    log.reset();
    setDock('consola');
    setJob({ id, status: known ?? 'QUEUED' });
    if (known && FINAL.includes(known)) { // historial: el log completo vive en app/data/runs
      const r = await api(`/jobs/${id}/log`);
      r.text.replace(/\n$/, '').split('\n').forEach((l) => log.push(l));
      return;
    }
    const s = new EventSource(`/api/jobs/${id}/stream`);
    es.current = s;
    s.onmessage = async (m) => {
      const ev = JSON.parse(m.data);
      if (ev.t === 'log') return log.push(ev.text);
      setJob({ id, status: ev.status });
      if (!FINAL.includes(ev.status)) return;
      s.close();
      await refresh();
      const d = draft.current;
      if (d?.id === id) { // un borrador recién creado se abre solo
        draft.current = null;
        const n = (await api('/features')).find((x) => !d.before.has(x.id));
        if (n) return open(n.id);
      }
      if (selRef.current) open(selRef.current);
    };
  });

  const start = guard(async (type, body) => {
    const j = await api('/jobs', { method: 'POST', body: { type, ...body } });
    if (type === 'draft') draft.current = { id: j.id, before: new Set(features.map((f) => f.id)) };
    watch(j.id);
    refresh();
  });
  const save = guard(async () => { const r = await api('/feature', { method: 'PUT', body: { id: sel, content: text } }); setSaved(text); setStatus(r.status); refresh(); });
  const approve = guard(async () => { const r = await api('/approve', { method: 'POST', body: { id: sel } }); setStatus(r.status); refresh(); });
  const showDiff = guard(async () => setDiff((await api('/diff')).text));

  const dirty = text !== saved;
  const busy = !!job && !FINAL.includes(job.status);
  const ready = ['APPROVED', 'VERIFIED'].includes(status);
  const hasSteps = jobs.some((j) => j.type === 'implement' && j.status === 'DONE' && j.payload?.feature === sel);
  const current = features.find((f) => f.id === sel);
  const history = jobs.filter((j) => !mine || !sel || j.payload?.feature === sel || j.payload?.all);

  return (
    <div className="app">
      <header className="top">
        <h1>Orquestador E2E <small>LAFISErvicios</small></h1>
        <div className="session">
          <span className={'dot ' + (meta?.auth.exists ? 'ok' : 'warn')} />
          {meta?.auth.exists ? 'Sesión guardada' : 'Sin sesión: ejecuta pnpm auth:manual en tu terminal'}
          {meta && <span className="chip">Agente: {meta.agent}</span>}
        </div>
      </header>
      {err && <div className="error" role="alert">{err}</div>}

      <div className="body">
        <nav className="rail" aria-label="Features">
          <button className="primary" onClick={() => setMode('new')}>Nueva prueba</button>
          {!features.length && <p className="hint">Aún no hay archivos .feature.</p>}
          <ul>
            {features.map((f) => (
              <li key={f.id}>
                <button className={'item ' + f.status + (f.id === sel && mode === 'feature' ? ' active' : '')} onClick={guard(() => open(f.id))}>
                  <strong>{f.title}</strong>
                  <small>{f.id}</small>
                  <span className={'pill ' + f.status}>{LABEL[f.status]}{f.fixme ? ' · @fixme' : ''}</span>
                </button>
              </li>
            ))}
          </ul>
          <button onClick={() => start('run', { all: true })} disabled={busy}>Ejecutar toda la suite</button>
        </nav>

        <div className="work">
          <section className="stage">
            {mode === 'new' && meta ? (
              <NewTest areas={meta.areas} busy={busy} onSubmit={(f) => start('draft', f)} />
            ) : sel ? (
              <>
                <div className="head">
                  <h2>{current?.title ?? sel}</h2>
                  <span className={'pill ' + status}>{LABEL[status]}</span>
                </div>
                <code className="path">features/{sel}</code>
                <Track status={status} hasSteps={hasSteps} />
                <textarea className="editor" spellCheck={false} value={text} onChange={(e) => setText(e.target.value)} aria-label="Contenido del .feature" />
                <div className="bar">
                  <button onClick={save} disabled={!dirty}>Guardar</button>
                  <button className="primary" onClick={approve} disabled={dirty || ready}>Aprobar</button>
                  <span className="sep" />
                  <button onClick={() => start('implement', { feature: sel })} disabled={!ready || busy}>Generar steps con IA</button>
                  <select value={target} onChange={(e) => setTarget(e.target.value)} aria-label="Qué ejecutar">
                    <option value="">Todo el feature</option>
                    {scenarios.map((s) => <option key={s} value={s}>{s}</option>)}
                  </select>
                  <button className="primary" onClick={() => start('run', { feature: sel, ...(target ? { scenario: target } : {}) })} disabled={!ready || busy}>Ejecutar</button>
                  <span className="sep" />
                  <button onClick={showDiff}>Ver cambios (git)</button>
                  <a className="btn" href="/report/" target="_blank" rel="noreferrer">Reporte HTML</a>
                </div>
                {dirty && <p className="hint">Guarda los cambios antes de aprobar.</p>}
                {status === 'IMPLEMENTATION_DRIFT' && <p className="hint">Los steps cambiaron desde la última verificación. Revisa los cambios y vuelve a aprobar.</p>}
                {target && <p className="hint">Ejecutar un solo escenario no marca el feature como verificado.</p>}
                {diff && <pre className="diff">{diff}</pre>}
              </>
            ) : (
              <p className="hint">Elige un feature de la izquierda o crea una prueba nueva.</p>
            )}
          </section>

          <section className="dock">
            <div className="tabs" role="tablist">
              <button role="tab" aria-selected={dock === 'consola'} onClick={() => setDock('consola')}>Consola {job && <span className={'pill ' + job.status}>{LABEL[job.status]}</span>}</button>
              <button role="tab" aria-selected={dock === 'historial'} onClick={() => setDock('historial')}>Historial ({history.length})</button>
              {busy && <button className="danger" onClick={guard(() => api('/jobs/' + job.id, { method: 'DELETE' }))}>Cancelar</button>}
            </div>
            {dock === 'consola' ? <Console lines={log.lines} /> : (
              <div className="history">
                {sel && <label className="check"><input type="checkbox" checked={mine} onChange={(e) => setMine(e.target.checked)} /> Solo este feature</label>}
                {!history.length && <p className="hint">Sin ejecuciones todavía.</p>}
                <ul>
                  {history.map((j) => (
                    <li key={j.id}>
                      <span>{KIND[j.type]}</span>
                      <span className="grow">{j.payload?.scenario ?? j.payload?.feature ?? j.payload?.area ?? 'toda la suite'}</span>
                      <time>{new Date(j.createdAt).toLocaleString()}</time>
                      <span className={'pill ' + j.status}>{LABEL[j.status]}</span>
                      <button onClick={() => watch(j.id, j.status)}>Ver log</button>
                      {j.type !== 'draft' && <button onClick={() => start(j.type, j.payload)} disabled={busy}>Repetir</button>}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
