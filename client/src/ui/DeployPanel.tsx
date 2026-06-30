/**
 * cht-conf integration panel. Surfaces every cht-conf action as a button,
 * grouped by category, with an inline log viewer that streams stdout/stderr
 * from the spawned binary via Server-Sent Events.
 *
 * Auth & target: deploy actions (anything that hits an instance) are gated
 * behind a target form (--local | --instance | --url) plus a username.
 * Passwords are typed each run and never persisted.
 */
import { useEffect, useRef, useState } from 'react';
import { api, type DeployConfig } from '../api.js';
import { useApp } from '../state/store.js';

interface FriendlyHint {
  patternId: string;
  friendly: string;
  hint?: string;
  docsUrl?: string;
  knownUpstreamBug?: boolean;
  rawLine: string;
}

type Category =
  | 'validate'
  | 'compile'
  | 'convert'
  | 'compress'
  | 'backup'
  | 'upload'
  | 'danger'
  | 'utility';

interface Action {
  name: string;
  category: Category;
  requiresInstance: boolean;
  dangerous: boolean;
  label: string;
}

/**
 * cht-conf actions that accept positional `-- <basenames>` for targeted form
 * deploys. See docs/plans/deploy-targeted-forms.md §2. Each one is paired with
 * the form category whose basenames it consumes (app vs contact).
 */
const FORM_SCOPED_ACTIONS: Record<string, 'app' | 'contact'> = {
  'convert-app-forms': 'app',
  'upload-app-forms': 'app',
  'upload-contact-forms': 'contact',
};

interface FormListItem {
  formId: string;
  category: 'app' | 'contact';
  basename: string;
}

const CATEGORY_ORDER: Category[] = [
  'validate',
  'compile',
  'convert',
  'compress',
  'backup',
  'upload',
  'utility',
  'danger',
];

const CATEGORY_LABELS: Record<Category, string> = {
  validate: 'Validate / Health check',
  compile: 'Compile',
  convert: 'Convert (xlsx → xml)',
  compress: 'Compress media',
  backup: 'Backup from instance',
  upload: 'Deploy to instance',
  utility: 'Utility',
  danger: 'Danger zone',
};

const CATEGORY_HINTS: Record<Category, string> = {
  validate: 'Read-only checks. Safe to run anytime.',
  compile: 'Compiles app_settings.json from tasks.js, contact-summary, schedules.',
  convert: 'Builds form XML from XLSX. Run before deploying forms.',
  compress: 'Image / SVG / PNG optimisers. Local only.',
  backup: 'Reads from the configured CHT instance. Saves to ./backups.',
  upload: 'Writes to the configured CHT instance. Authenticate first.',
  utility: 'CSV imports, hierarchy moves, user provisioning.',
  danger: 'Destructive — irreversible. Requires explicit confirmation.',
};

export function DeployPanel() {
  const [actions, setActions] = useState<Action[]>([]);
  const [binaryAvailable, setBinaryAvailable] = useState<boolean>(true);
  const [chtConfVersion, setChtConfVersion] = useState<string | null>(null);
  const [config, setConfig] = useState<DeployConfig | null>(null);
  const [password, setPassword] = useState('');
  const [pendingAction, setPendingAction] = useState<Action | null>(null);
  // Targeted-deploy state: which forms exist + which are changed in git.
  // pickerAction is set when the user clicks a form-scoped action; the picker
  // hands selected basenames back to launch() as `extraArgs = ['--', ...names]`.
  const [allForms, setAllForms] = useState<FormListItem[]>([]);
  const [changedFormIds, setChangedFormIds] = useState<Set<string>>(new Set());
  const [hasGit, setHasGit] = useState<boolean>(false);
  const [pickerAction, setPickerAction] = useState<Action | null>(null);
  // Bridge between picker confirm and the password-gate detour: when a
  // form-scoped action needs a password, the picker's chosen extraArgs have
  // to survive across pendingAction → launch().
  const [pickerExtraArgsForPending, setPickerExtraArgsForPending] = useState<string[] | null>(null);
  const [runId, setRunId] = useState<string | null>(null);
  const [lines, setLines] = useState<string[]>([]);
  const [hints, setHints] = useState<FriendlyHint[]>([]);
  const [dryRun, setDryRun] = useState(false);
  const [running, setRunning] = useState(false);
  const [exitCode, setExitCode] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Inline result of the Test-connection probe. Tracked separately from
  // the cht-conf run log so the user can see the auth/version result
  // even after they start an unrelated action and the log scrolls.
  const [connectionResult, setConnectionResult] = useState<
    | null
    | {
        ok: boolean;
        status?: number;
        version?: string;
        couchVersion?: string;
        authenticatedAs?: string;
        error?: string;
        redactedUrl: string;
        at: number;
      }
  >(null);
  const [testingConnection, setTestingConnection] = useState(false);
  const logEndRef = useRef<HTMLDivElement>(null);
  const eventSourceRef = useRef<EventSource | null>(null);

  async function runTestConnection(): Promise<void> {
    setTestingConnection(true);
    setConnectionResult(null);
    try {
      const r = await api.testConnection(password);
      setConnectionResult({ ...r, at: Date.now() });
    } catch (e) {
      setConnectionResult({
        ok: false,
        error: (e as Error).message,
        redactedUrl: '',
        at: Date.now(),
      });
    } finally {
      setTestingConnection(false);
    }
  }

  useEffect(() => {
    void api.chtConfActions().then((r) => {
      setActions(r.actions);
      setBinaryAvailable(r.binaryAvailable);
      setChtConfVersion(r.version);
    });
    void api.getDeployConfig().then((r) => setConfig(r.config ?? { target: 'local' }));
    void api.listForms().then((r) => {
      setAllForms(
        r.forms.map((f) => ({
          formId: f.id,
          category: f.category,
          basename: f.filename.replace(/\.xlsx$/i, ''),
        })),
      );
    });
    void api.getChangedForms().then((r) => {
      setHasGit(r.git);
      setChangedFormIds(new Set(r.changed.map((c) => c.formId)));
    });
  }, []);

  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [lines]);

  useEffect(() => {
    return () => {
      eventSourceRef.current?.close();
    };
  }, []);

  async function saveConfig(next: DeployConfig) {
    setConfig(next);
    try {
      await api.setDeployConfig(next);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function runAction(action: Action) {
    setError(null);
    if (action.dangerous) {
      const ok = window.confirm(
        `"${action.label}" is destructive and will affect the configured CHT instance.\n\nContinue?`,
      );
      if (!ok) return;
    }
    // Form-scoped actions (convert-app-forms, upload-app-forms,
    // upload-contact-forms) open the picker first; default-all preserves
    // today's whole-config behaviour, and "Select changed" narrows it.
    if (action.name in FORM_SCOPED_ACTIONS) {
      // Refresh git changes whenever the picker opens — the working tree may
      // have advanced since the panel mounted.
      void api.getChangedForms().then((r) => {
        setHasGit(r.git);
        setChangedFormIds(new Set(r.changed.map((c) => c.formId)));
      });
      setPickerAction(action);
      return;
    }
    if (action.requiresInstance && !password) {
      setPendingAction(action);
      return;
    }
    await launch(action, password);
  }

  /**
   * Resume launching after the form picker confirms. Splits in two paths
   * because requiresInstance actions still need the password gate, and we
   * have to forward `extraArgs` through that gate too.
   */
  function launchFromPicker(action: Action, basenames: string[]) {
    setPickerAction(null);
    const extraArgs = basenames.length > 0 ? ['--', ...basenames] : undefined;
    if (action.requiresInstance && !password) {
      setPendingAction(action);
      setPickerExtraArgsForPending(extraArgs ?? null);
      return;
    }
    void launch(action, password, extraArgs);
  }

  async function runMacro(macro: DeployMacroSpec) {
    setError(null);
    const needsPassword = macro.actions.some(
      (a) => actions.find((x) => x.name === a)?.requiresInstance,
    );
    if (needsPassword && !password) {
      setError(`"${macro.label}" needs a password — enter one above first.`);
      return;
    }
    // Extra confirm for the broadest deploy — it touches forms AND settings
    // on the live instance. Forms-only and settings-only macros don't
    // double-confirm; this is just for "Deploy everything".
    if (macro.id === 'deploy-everything') {
      const ok = window.confirm(
        `"${macro.label}" will upload app forms AND app settings to the configured CHT instance. Continue?`,
      );
      if (!ok) return;
    }
    setLines([]);
    setHints([]);
    setExitCode(null);
    setRunning(true);
    try {
      const res = await api.runChtConfSequence(macro.actions, needsPassword ? password : undefined, dryRun);
      setRunId(res.runId);
      streamRun(res.runId);
    } catch (e) {
      setError((e as Error).message);
      setRunning(false);
    }
  }

  async function launch(action: Action, pw: string, extraArgs?: string[]) {
    setError(null);
    setLines([]);
    setHints([]);
    setExitCode(null);
    setRunning(true);
    try {
      const res = await api.runChtConfAction(
        action.name,
        action.requiresInstance ? pw : undefined,
        extraArgs,
        dryRun,
      );
      setRunId(res.runId);
      streamRun(res.runId);
    } catch (e) {
      setError((e as Error).message);
      setRunning(false);
    }
  }

  function streamRun(id: string) {
    eventSourceRef.current?.close();
    const es = new EventSource(`/api/cht-conf/runs/${encodeURIComponent(id)}/stream`);
    eventSourceRef.current = es;
    es.addEventListener('line', (e) => {
      const { line } = JSON.parse((e as MessageEvent).data) as { line: string };
      setLines((prev) => [...prev, line]);
    });
    es.addEventListener('hint', (e) => {
      const hint = JSON.parse((e as MessageEvent).data) as FriendlyHint;
      setHints((prev) => [...prev, hint]);
    });
    es.addEventListener('done', (e) => {
      const { exitCode: code } = JSON.parse((e as MessageEvent).data) as { exitCode: number | null };
      setRunning(false);
      setExitCode(code);
      es.close();
    });
    es.onerror = () => {
      es.close();
      setRunning(false);
    };
  }

  async function cancelRun() {
    if (!runId) return;
    try {
      await api.cancelChtConfRun(runId);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  const grouped = new Map<Category, Action[]>();
  for (const a of actions) {
    if (!grouped.has(a.category)) grouped.set(a.category, []);
    grouped.get(a.category)!.push(a);
  }

  return (
    <div className="deploy-panel">
      <header className="page-header">
        <h1>Deploy</h1>
        <div className="row gap">
          <span className="muted small">
            cht-conf {chtConfVersion ?? '?'}{' '}
            {!binaryAvailable && <span className="badge warn">binary missing</span>}
          </span>
        </div>
      </header>

      {error && <div className="error-banner">{error}</div>}

      <DeployTargetForm
        config={config}
        password={password}
        onChangePassword={setPassword}
        onChangeConfig={saveConfig}
        onTestConnection={() => void runTestConnection()}
        testingConnection={testingConnection}
        connectionResult={connectionResult}
      />

      {/* Onboarding §5 — deploy-readiness checklist. Non-blocking; the
          deploy buttons stay enabled regardless. The point is to flag
          the silent-failure mode (hierarchy empty / contact form missing
          for a defined type / no app forms shipped) BEFORE the author
          pushes to the instance. The checklist + the user's "I see it,
          deploy anyway" is the gate. */}
      <DeployReadinessChecklist allForms={allForms} hasGit={hasGit} />

      <DeployMacros
        running={running}
        password={password}
        binaryAvailable={binaryAvailable}
        onRun={(macro) => void runMacro(macro)}
      />

      <div className="card" style={{ padding: '10px 14px' }}>
        <label className="row gap" style={{ alignItems: 'center', cursor: 'pointer' }}>
          <input type="checkbox" checked={dryRun} onChange={(e) => setDryRun(e.target.checked)} />
          <strong>Dry-run mode</strong>
          <span className="muted small">
            replay scripted output, do not contact cht-conf or the instance — useful to rehearse a deploy or to demo the tool
          </span>
        </label>
      </div>

      {pendingAction && (
        <div className="card">
          <p>
            <strong>Enter password</strong> for <code>{config?.user ?? '(no user)'}</code> to run{' '}
            <code>{pendingAction.name}</code>
            {pickerExtraArgsForPending && pickerExtraArgsForPending.length > 1 && (
              <>
                {' '}on{' '}
                <code>{pickerExtraArgsForPending.slice(1).join(' ')}</code>
              </>
            )}
            .
          </p>
          <div className="row gap">
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="password"
              autoFocus
              onKeyDown={(e) => {
                if (e.key === 'Enter' && password) {
                  void launch(pendingAction, password, pickerExtraArgsForPending ?? undefined);
                  setPendingAction(null);
                  setPickerExtraArgsForPending(null);
                }
              }}
            />
            <button
              onClick={() => {
                void launch(pendingAction, password, pickerExtraArgsForPending ?? undefined);
                setPendingAction(null);
                setPickerExtraArgsForPending(null);
              }}
              disabled={!password}
            >
              Run
            </button>
            <button
              className="link"
              onClick={() => {
                setPendingAction(null);
                setPickerExtraArgsForPending(null);
              }}
            >
              cancel
            </button>
          </div>
        </div>
      )}

      {pickerAction && (
        <DeployFormPicker
          action={pickerAction}
          category={FORM_SCOPED_ACTIONS[pickerAction.name]!}
          allForms={allForms}
          changedFormIds={changedFormIds}
          hasGit={hasGit}
          config={config}
          onConfirm={(basenames) => launchFromPicker(pickerAction, basenames)}
          onCancel={() => setPickerAction(null)}
        />
      )}

      <div className="deploy-grid">
        {CATEGORY_ORDER.filter((c) => (grouped.get(c)?.length ?? 0) > 0).map((cat) => (
          <section
            key={cat}
            className={`deploy-category ${cat === 'danger' ? 'is-danger' : ''}`}
          >
            <h3>{CATEGORY_LABELS[cat]}</h3>
            <p className="muted small">{CATEGORY_HINTS[cat]}</p>
            <div className="deploy-actions">
              {(grouped.get(cat) ?? []).map((a) => (
                <button
                  key={a.name}
                  className={`action-btn ${a.dangerous ? 'danger' : ''}`}
                  onClick={() => void runAction(a)}
                  disabled={running}
                  title={a.name}
                >
                  <span className="action-label">{a.label}</span>
                  <code className="action-code">{a.name}</code>
                  {a.requiresInstance && <span className="badge small">needs instance</span>}
                </button>
              ))}
            </div>
          </section>
        ))}
      </div>

      <section className="deploy-log">
        <div className="row gap log-toolbar">
          <h3>Log</h3>
          {running && (
            <button className="link danger" onClick={() => void cancelRun()}>
              Cancel run
            </button>
          )}
          {!running && exitCode !== null && (
            <span className={`badge ${exitCode === 0 ? '' : 'warn'}`}>
              Exit code: {exitCode}
            </span>
          )}
          {lines.length > 0 && (
            <button className="link" onClick={() => { setLines([]); setHints([]); }} disabled={running}>
              clear
            </button>
          )}
        </div>

        {hints.length > 0 && (
          <div className="deploy-hints">
            {hints.map((h, i) => (
              <div
                key={`${h.patternId}-${i}`}
                className={`deploy-hint${h.knownUpstreamBug ? ' known-bug' : ''}`}
              >
                <div className="deploy-hint-head">
                  <strong>{h.friendly}</strong>
                  {h.knownUpstreamBug && (
                    <span
                      className="badge small"
                      title="This is a known cht-conf upstream bug — not caused by your project files."
                    >
                      upstream — tracked
                    </span>
                  )}
                </div>
                {h.hint && <p className="deploy-hint-body">{h.hint}</p>}
                {h.docsUrl && (
                  <p className="deploy-hint-link">
                    <a href={h.docsUrl} target="_blank" rel="noreferrer">
                      open docs / upstream issue ↗
                    </a>
                  </p>
                )}
                <details className="deploy-hint-raw">
                  <summary>raw output that triggered this</summary>
                  <code>{h.rawLine}</code>
                </details>
              </div>
            ))}
          </div>
        )}
        <pre className="log-view">
          {lines.length === 0 ? (
            <span className="muted">No output yet. Click an action above to run it.</span>
          ) : (
            lines.join('\n')
          )}
          <div ref={logEndRef} />
        </pre>
      </section>
    </div>
  );
}

function DeployTargetForm(props: {
  config: DeployConfig | null;
  password: string;
  onChangePassword: (v: string) => void;
  onChangeConfig: (c: DeployConfig) => void;
  onTestConnection: () => void;
  testingConnection: boolean;
  connectionResult: null | {
    ok: boolean;
    status?: number;
    version?: string;
    couchVersion?: string;
    authenticatedAs?: string;
    error?: string;
    redactedUrl: string;
    at: number;
  };
}) {
  const { config } = props;
  if (!config) return <p className="muted">Loading deploy config…</p>;

  return (
    <section className="deploy-target card">
      <h3>Deploy target</h3>
      <div className="row gap">
        <label>
          <input
            type="radio"
            name="target"
            checked={config.target === 'local'}
            onChange={() => props.onChangeConfig({ ...config, target: 'local' })}
          />
          <strong>--local</strong> (localhost:5985)
        </label>
        <label>
          <input
            type="radio"
            name="target"
            checked={config.target === 'instance'}
            onChange={() => props.onChangeConfig({ ...config, target: 'instance' })}
          />
          <strong>--instance</strong>
          <input
            value={config.instance ?? ''}
            onChange={(e) => props.onChangeConfig({ ...config, instance: e.target.value })}
            placeholder="e.g. demo (→ demo.dev.medicmobile.org)"
            disabled={config.target !== 'instance'}
          />
        </label>
        <label>
          <input
            type="radio"
            name="target"
            checked={config.target === 'url'}
            onChange={() => props.onChangeConfig({ ...config, target: 'url' })}
          />
          <strong>--url</strong>
          <input
            value={config.url ?? ''}
            onChange={(e) => props.onChangeConfig({ ...config, url: e.target.value })}
            placeholder="https://your-instance.medicmobile.org"
            disabled={config.target !== 'url'}
            style={{ minWidth: 280 }}
          />
        </label>
      </div>
      <div className="row gap">
        <label>
          <span>User</span>
          <input
            value={config.user ?? ''}
            onChange={(e) => props.onChangeConfig({ ...config, user: e.target.value })}
            placeholder="medic"
          />
        </label>
        <label>
          <span>Password</span>
          <input
            type="password"
            value={props.password}
            onChange={(e) => props.onChangePassword(e.target.value)}
            placeholder="never stored — typed each session"
          />
        </label>
      </div>
      <div className="row gap">
        <button
          onClick={props.onTestConnection}
          className="secondary"
          disabled={props.testingConnection}
        >
          {props.testingConnection ? 'Testing…' : '🔌 Test connection'}
        </button>
        <span className="muted small">
          Hits <code>&lt;target&gt;/api/info</code> directly with your user + password
          — no cht-conf, no version gate.
        </span>
      </div>
      {props.connectionResult && (
        <div
          className={`deploy-test-result ${props.connectionResult.ok ? 'ok' : 'fail'}`}
          role="status"
        >
          {props.connectionResult.ok ? (
            <>
              <strong>✓ Connection OK.</strong>{' '}
              {props.connectionResult.authenticatedAs && (
                <>
                  Authenticated as{' '}
                  <code>{props.connectionResult.authenticatedAs}</code>.{' '}
                </>
              )}
              {props.connectionResult.version && (
                <>
                  CHT <code>{props.connectionResult.version}</code>
                  {props.connectionResult.couchVersion && (
                    <>
                      {' '}
                      / CouchDB <code>{props.connectionResult.couchVersion}</code>
                    </>
                  )}
                  .
                </>
              )}
            </>
          ) : (
            <>
              <strong>✗ Could not connect.</strong> {props.connectionResult.error}
            </>
          )}
          {props.connectionResult.redactedUrl && (
            <div className="muted small">
              probed <code>{props.connectionResult.redactedUrl}</code>
            </div>
          )}
        </div>
      )}
      <p className="muted small">
        Password is held in memory only, not saved to disk. Target + user persist in
        <code> ~/.cht-ui-builder/state.json</code>.
        Need a local CHT to test against? See{' '}
        <a
          href="https://docs.communityhealthtoolkit.org/contribute/code/dev-environment/"
          target="_blank"
          rel="noreferrer"
        >
          Run a local CHT
        </a>
        {' '}— Docker image starts on{' '}
        <code>localhost:5988</code> and the <code>--local</code> radio points at it.
      </p>
    </section>
  );
}

/* -------------------- Deploy macros (chained runs) -------------------- */

interface DeployMacroSpec {
  id: string;
  label: string;
  description: string;
  /** Ordered cht-conf action names to run. */
  actions: string[];
  /** Marks macros that touch the CHT instance. */
  needsInstance: boolean;
}

const DEPLOY_MACROS: DeployMacroSpec[] = [
  {
    id: 'deploy-forms',
    label: 'Deploy app forms',
    description: 'validate → convert → upload',
    actions: ['validate-app-forms', 'convert-app-forms', 'upload-app-forms'],
    needsInstance: true,
  },
  {
    id: 'deploy-contact-forms',
    label: 'Deploy contact forms',
    description: 'validate → convert → upload (the place/person create+edit forms)',
    actions: [
      'validate-contact-forms',
      'convert-contact-forms',
      'upload-contact-forms',
    ],
    needsInstance: true,
  },
  {
    id: 'deploy-settings',
    label: 'Deploy app settings',
    description: 'compile → upload',
    actions: ['compile-app-settings', 'upload-app-settings'],
    needsInstance: true,
  },
  {
    id: 'deploy-everything',
    label: 'Deploy everything',
    description: 'validate → compile → convert (app + contact) → upload (app + contact) → upload settings',
    actions: [
      // App forms first — the "Available on X" context refers to the app form.
      'validate-app-forms',
      'compile-app-settings',
      'convert-app-forms',
      'upload-app-forms',
      // Contact forms — without these, every contact_type's create_form
      // promise in base_settings.json points at a non-existent form doc
      // on the instance (silent breakage: the instance accepts the
      // app_settings but can't actually OPEN any contact-creation form).
      'validate-contact-forms',
      'convert-contact-forms',
      'upload-contact-forms',
      // Settings last so the hierarchy / contact_types references resolve
      // to real form docs at lookup time.
      'upload-app-settings',
    ],
    needsInstance: true,
  },
  {
    id: 'validate-only',
    label: 'Validate everything (no upload)',
    description: 'validate → compile → convert (app + contact) — safe rehearsal',
    actions: [
      'validate-app-forms',
      'compile-app-settings',
      'convert-app-forms',
      'validate-contact-forms',
      'convert-contact-forms',
    ],
    needsInstance: false,
  },
];

/**
 * Pre-built macros that chain the most common cht-conf sequences. The
 * individual-button grid below still exists for power users; this is the
 * "what most people actually need" shortcut layer.
 */
function DeployMacros(props: {
  running: boolean;
  password: string;
  binaryAvailable: boolean;
  onRun: (macro: DeployMacroSpec) => void;
}) {
  return (
    <section className="deploy-macros card">
      <h3>Common deploys</h3>
      <p className="muted small">
        One click runs a sequence of cht-conf actions in order, streaming everything to the log.
        Stops on the first failure.
      </p>
      <div className="deploy-macros-grid">
        {DEPLOY_MACROS.map((m) => {
          const missingPassword = m.needsInstance && !props.password;
          const disabled = props.running || !props.binaryAvailable || missingPassword;
          return (
            <button
              key={m.id}
              className="deploy-macro-btn"
              onClick={() => props.onRun(m)}
              disabled={disabled}
              title={missingPassword ? 'Enter the password above first' : m.actions.join(' → ')}
            >
              <span className="deploy-macro-label">{m.label}</span>
              <span className="deploy-macro-desc">{m.description}</span>
              <span className="deploy-macro-steps">
                {m.actions.map((a, i) => (
                  <span key={a} className="deploy-macro-step">
                    {i > 0 && <span className="muted"> → </span>}
                    <code>{a}</code>
                  </span>
                ))}
              </span>
              {missingPassword && (
                <span className="muted small" style={{ color: '#b45309' }}>
                  ⚠ enter password above first
                </span>
              )}
            </button>
          );
        })}
      </div>
    </section>
  );
}

/* ------------------------- Targeted-form picker ------------------------- */

/**
 * Build the cht-conf `--target ...` prefix the way the server's buildArgs
 * does, but redacted for display: passwords appear as `***`. Kept in sync
 * with [server/src/routes/cht-conf.ts:buildArgs] — the goal is "the user can
 * read this line and predict what the server will spawn." See
 * docs/plans/deploy-targeted-forms.md §2: command-preview honesty matters
 * for non-technical owners who decide whether to click Run.
 */
function previewTargetPrefix(config: DeployConfig | null): string {
  if (!config) return '';
  if (config.target === 'local') return '--local';
  if (config.target === 'instance' && config.instance) {
    const userFlag = config.user ? ` --user=${config.user}` : '';
    return `--instance=${config.instance}${userFlag}`;
  }
  if (config.target === 'url' && config.url) {
    try {
      // eslint-disable-next-line no-undef
      const u = new URL(config.url);
      const userinfo = config.user ? `${encodeURIComponent(config.user)}:***@` : '';
      return `--url=${u.protocol}//${userinfo}${u.host}${u.pathname}${u.search}`;
    } catch {
      return `--url=${config.url}`;
    }
  }
  return '';
}

/**
 * Modal-ish checklist for targeted form deploys. Default = every form in the
 * action's category checked (preserves today's whole-config behaviour); the
 * "Select changed (N)" button narrows it to working-tree changes from
 * `git status`. The command preview at the bottom mirrors exactly what the
 * server will spawn (with the password redacted).
 *
 * Out of scope here: chaining convert→upload as one click. The plan defers
 * that to a sequence-endpoint follow-up (see §4); MVP = two clicks of the
 * picker against the two actions.
 */
function DeployFormPicker(props: {
  action: Action;
  category: 'app' | 'contact';
  allForms: FormListItem[];
  changedFormIds: Set<string>;
  hasGit: boolean;
  config: DeployConfig | null;
  onConfirm: (basenames: string[]) => void;
  onCancel: () => void;
}) {
  const eligible = props.allForms.filter((f) => f.category === props.category);
  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(eligible.map((f) => f.basename)),
  );

  const changedInCategory = eligible.filter((f) => props.changedFormIds.has(f.formId));
  const noneSelected = selected.size === 0;
  const allSelected = selected.size === eligible.length && eligible.length > 0;

  function toggle(basename: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(basename)) next.delete(basename);
      else next.add(basename);
      return next;
    });
  }

  function selectAll() {
    setSelected(new Set(eligible.map((f) => f.basename)));
  }
  function selectNone() {
    setSelected(new Set());
  }
  function selectChanged() {
    setSelected(new Set(changedInCategory.map((f) => f.basename)));
  }

  // Command preview — the server's buildArgs will append `-- <names>` after
  // the action when extraArgs is non-empty. If the user un-selects everything,
  // the cht-conf default (all forms) kicks in — surface that explicitly so
  // they aren't surprised by a blank checklist running the whole category.
  const targetPrefix = previewTargetPrefix(props.config);
  const selectedBasenames = eligible
    .filter((f) => selected.has(f.basename))
    .map((f) => f.basename);
  const cmd = noneSelected || allSelected
    ? `cht ${targetPrefix} ${props.action.name}`.trim()
    : `cht ${targetPrefix} ${props.action.name} -- ${selectedBasenames.join(' ')}`.trim();

  return (
    <div className="card">
      <div className="row gap" style={{ alignItems: 'baseline', justifyContent: 'space-between' }}>
        <h3 style={{ margin: 0 }}>
          {props.action.label} — pick forms
        </h3>
        <button className="link" onClick={props.onCancel}>cancel</button>
      </div>
      <p className="muted small">
        Default is every {props.category} form — leave as-is to deploy the whole category
        (same as before). Narrow it to deploy only the forms you changed.
      </p>

      <div className="row gap" style={{ flexWrap: 'wrap' }}>
        <button className="link" onClick={selectAll} disabled={allSelected}>
          select all
        </button>
        <button className="link" onClick={selectNone} disabled={noneSelected}>
          deselect all
        </button>
        {props.hasGit && (
          <button
            className="link"
            onClick={selectChanged}
            disabled={changedInCategory.length === 0}
            title={
              changedInCategory.length === 0
                ? 'No working-tree changes in this category'
                : `Check exactly the ${changedInCategory.length} changed ${props.category} form(s)`
            }
          >
            Select changed ({changedInCategory.length})
          </button>
        )}
      </div>

      {eligible.length === 0 ? (
        <p className="muted">No {props.category} forms found in this project.</p>
      ) : (
        <ul className="deploy-form-picker">
          {eligible.map((f) => {
            const isChanged = props.changedFormIds.has(f.formId);
            return (
              <li key={f.formId}>
                <label className="row gap" style={{ alignItems: 'center', cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={selected.has(f.basename)}
                    onChange={() => toggle(f.basename)}
                  />
                  <code>{f.basename}</code>
                  {isChanged && <span className="badge small">changed</span>}
                </label>
              </li>
            );
          })}
        </ul>
      )}

      <div className="deploy-cmd-preview">
        <div className="muted small">Command preview:</div>
        <pre><code>{cmd}</code></pre>
        {noneSelected && eligible.length > 0 && (
          <p className="muted small">
            Nothing selected — cht-conf will deploy <strong>all {props.category} forms</strong>{' '}
            (default behaviour when no <code>--</code> args are passed).
          </p>
        )}
      </div>

      <div className="row gap">
        <button
          onClick={() => props.onConfirm(noneSelected || allSelected ? [] : selectedBasenames)}
          disabled={eligible.length === 0}
        >
          {noneSelected || allSelected
            ? `Run ${props.action.name} (all)`
            : `Run on ${selectedBasenames.length} form${selectedBasenames.length === 1 ? '' : 's'}`}
        </button>
        <button className="link" onClick={props.onCancel}>cancel</button>
      </div>
    </div>
  );
}

/* --------------------- Deploy-readiness checklist --------------------- */

/**
 * Onboarding §5 — pre-deploy readiness checklist. NON-BLOCKING by design:
 * CHT will run on the legacy default hierarchy if `contact_types` is
 * empty, and a missing contact form / app form / task isn't a deploy
 * error — it's a silent runtime drift. The checklist surfaces these
 * before the author pushes, so they're seen-and-acknowledged rather
 * than discovered in field.
 *
 * Checks (each cheap; we fetch hierarchy once on mount):
 *   1. Hierarchy: ≥1 contact_type defined.
 *   2. Contact form per place type: every non-person type has a
 *      `<type>-create.xlsx`. (`-edit` is optional in v1.)
 *   3. ≥1 app form exists.
 *   4. `tasks.js` present.
 *
 * Deeper checks (do app-form `select-contact type-X` references
 * resolve to defined types?) are deferred — they'd need a survey
 * scan per form, which is too much for the checklist phase.
 */
function DeployReadinessChecklist(props: {
  allForms: FormListItem[];
  hasGit: boolean;
}) {
  const project = useApp((s) => s.project);
  type ContactTypeRow = { id: string; person?: boolean };
  const [contactTypes, setContactTypes] = useState<ContactTypeRow[] | null>(null);
  const [hierarchyError, setHierarchyError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    void api
      .getHierarchy()
      .then((h) => {
        if (!alive) return;
        setContactTypes(h.contact_types as unknown as ContactTypeRow[]);
      })
      .catch((e: Error) => {
        if (alive) setHierarchyError(e.message);
      });
    return () => {
      alive = false;
    };
  }, []);

  if (!project) return null;

  const hierarchyKnown = contactTypes !== null;
  const placeTypes = (contactTypes ?? []).filter((t) => !t.person);
  const contactFormBasenames = new Set(
    props.allForms
      .filter((f) => f.category === 'contact')
      .map((f) => f.basename.toLowerCase()),
  );
  const missingCreateForms = placeTypes.filter(
    (t) => !contactFormBasenames.has(`${t.id.toLowerCase()}-create`),
  );

  type CheckState = 'pass' | 'fail' | 'unknown' | 'info';
  interface Check {
    label: string;
    state: CheckState;
    detail?: string;
  }

  const checks: Check[] = [
    {
      label: 'Hierarchy defined (≥1 contact type)',
      state: hierarchyError
        ? 'unknown'
        : !hierarchyKnown
          ? 'unknown'
          : (contactTypes ?? []).length > 0
            ? 'pass'
            : 'fail',
      detail: hierarchyError
        ? hierarchyError
        : !hierarchyKnown
          ? 'loading…'
          : (contactTypes ?? []).length === 0
            ? 'CHT will fall back to the legacy default hierarchy. Forms referencing undefined types fail silently at runtime.'
            : `${(contactTypes ?? []).length} types defined.`,
    },
    {
      label: 'Contact create-form per place type',
      state: !hierarchyKnown
        ? 'unknown'
        : placeTypes.length === 0
          ? 'info'
          : missingCreateForms.length === 0
            ? 'pass'
            : 'fail',
      detail: !hierarchyKnown
        ? 'loading…'
        : placeTypes.length === 0
          ? 'No place types yet — add them in Hierarchy.'
          : missingCreateForms.length === 0
            ? `${placeTypes.length} place types, all have a create form.`
            : `Missing: ${missingCreateForms.map((t) => `${t.id}-create.xlsx`).join(', ')}.`,
    },
    {
      label: 'App forms exist',
      state: project.hasAppForms ? 'pass' : 'info',
      detail: project.hasAppForms
        ? `${props.allForms.filter((f) => f.category === 'app').length} app forms.`
        : 'No app forms yet — the user-facing reports/visits live here.',
    },
    {
      label: 'tasks.js present',
      state: project.hasTasks ? 'pass' : 'info',
      detail: project.hasTasks
        ? 'tasks.js is defined.'
        : 'No tasks defined — tasks.js controls follow-up reminders + workflows.',
    },
    {
      label: 'Git project (for "Select changed" + deploy traceability)',
      state: props.hasGit ? 'pass' : 'info',
      detail: props.hasGit
        ? 'Working tree is a git repo — targeted deploys can use changed-only.'
        : 'Not a git repo — Select-changed is unavailable.',
    },
  ];

  const fails = checks.filter((c) => c.state === 'fail').length;
  const passes = checks.filter((c) => c.state === 'pass').length;
  const totalGated = checks.filter((c) => c.state === 'pass' || c.state === 'fail').length;

  return (
    <section className="card deploy-readiness">
      <header className="row gap" style={{ alignItems: 'baseline' }}>
        <strong>Deploy-readiness checklist</strong>
        <span className="muted small">
          {passes}/{totalGated} passing{fails > 0 ? `, ${fails} need attention` : ''} —
          non-blocking; deploy buttons stay enabled.
        </span>
      </header>
      <ul className="deploy-readiness-list">
        {checks.map((c, i) => (
          <li key={i} className={`deploy-readiness-row state-${c.state}`}>
            <span className="deploy-readiness-glyph" aria-hidden="true">
              {c.state === 'pass' ? '✓' : c.state === 'fail' ? '✗' : c.state === 'unknown' ? '…' : 'ⓘ'}
            </span>
            <span className="deploy-readiness-label">{c.label}</span>
            {c.detail && <span className="muted small">— {c.detail}</span>}
          </li>
        ))}
      </ul>
    </section>
  );
}
