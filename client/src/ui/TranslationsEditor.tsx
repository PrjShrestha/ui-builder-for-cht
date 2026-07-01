/**
 * Translations editor — a key × locale grid over
 * `messages-<locale>.properties` files.
 *
 * Rows = keys (sorted union across every file discovered), columns = locale
 * files (root `translations/` first, then `app_settings/forms/translations/`).
 * Missing cells (key present in another locale, empty here) get a distinct
 * border + glyph so translators can spot gaps at a glance without relying on
 * colour alone.
 *
 * Saves are batched: edits are held in a per-cell dirty map until the user
 * clicks Save, then one PUT per file flushes only the changed keys through
 * `updateProperty` on the server — every unedited line stays byte-identical.
 */
import { useEffect, useMemo, useState } from 'react';
import type { PropertiesFile } from '@cht-ui/shared';
import { api } from '../api.js';
import { useApp } from '../state/store.js';

interface LocaleFile {
  locale: string;
  dir: string;
  path: string;
  entries: PropertiesFile;
}

/** Extract `{key: value}` from a PropertiesFile with Java's first-wins rule. */
function valuesByKey(file: PropertiesFile): Map<string, string> {
  const out = new Map<string, string>();
  for (const line of file) {
    if (line.kind === 'entry' && !out.has(line.key)) out.set(line.key, line.value);
  }
  return out;
}

/**
 * Per-file edit staging. Outer key = file.path, inner key = translation key.
 * A key present here overrides that file's on-disk value; deletion happens
 * when the user reverts a cell back to its original value.
 */
type Edits = Record<string, Record<string, string>>;

function editsCount(e: Edits): number {
  let n = 0;
  for (const path of Object.keys(e)) n += Object.keys(e[path]!).length;
  return n;
}

export function TranslationsEditor() {
  const setError = useApp((s) => s.setError);
  const setDirty = useApp((s) => s.setDirty);
  const setSaving = useApp((s) => s.setSaving);
  const dirtyFlag = useApp((s) => s.dirty['translations'] ?? false);
  const saving = useApp((s) => s.saving['translations'] ?? false);

  const [files, setFiles] = useState<LocaleFile[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('');
  const [edits, setEdits] = useState<Edits>({});

  useEffect(() => {
    let alive = true;
    setLoading(true);
    api
      .getTranslations()
      .then((res) => {
        if (!alive) return;
        setFiles(res.files);
        setEdits({});
        setDirty('translations', false);
        setLoading(false);
      })
      .catch((e: Error) => {
        if (!alive) return;
        setError(e.message);
        setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [setError, setDirty]);

  const valuesPerFile = useMemo(
    () => (files ?? []).map((f) => ({ file: f, values: valuesByKey(f.entries) })),
    [files],
  );

  const keys = useMemo(() => {
    const set = new Set<string>();
    for (const { values } of valuesPerFile) for (const k of values.keys()) set.add(k);
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [valuesPerFile]);

  const filteredKeys = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return keys;
    return keys.filter((k) => {
      if (k.toLowerCase().includes(q)) return true;
      for (const { file, values } of valuesPerFile) {
        const eff = edits[file.path]?.[k] ?? values.get(k) ?? '';
        if (eff.toLowerCase().includes(q)) return true;
      }
      return false;
    });
  }, [keys, filter, valuesPerFile, edits]);

  function setCell(path: string, key: string, value: string, original: string) {
    setEdits((prev) => {
      const perFile = { ...(prev[path] ?? {}) };
      if (value === original) delete perFile[key];
      else perFile[key] = value;
      const next: Edits = { ...prev };
      if (Object.keys(perFile).length === 0) delete next[path];
      else next[path] = perFile;
      setDirty('translations', editsCount(next) > 0);
      return next;
    });
  }

  async function save() {
    if (!files || editsCount(edits) === 0) return;
    setSaving('translations', true);
    try {
      for (const [path, perFile] of Object.entries(edits)) {
        const file = files.find((f) => f.path === path);
        if (!file) continue;
        const updates = Object.entries(perFile).map(([key, value]) => ({ key, value }));
        await api.putTranslations(file.locale, updates, file.dir);
      }
      // Re-fetch so the grid reflects what actually landed.
      const res = await api.getTranslations();
      setFiles(res.files);
      setEdits({});
      setDirty('translations', false);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving('translations', false);
    }
  }

  async function reload() {
    setLoading(true);
    try {
      const res = await api.getTranslations();
      setFiles(res.files);
      setEdits({});
      setDirty('translations', false);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  if (loading) return <div className="loading">Loading translations…</div>;
  if (!files) return <div className="loading">No translation data.</div>;

  return (
    <div className="translations-editor">
      <header className="page-header">
        <h1>Translations</h1>
        <div className="row gap">
          <button className="secondary" onClick={() => void reload()} disabled={saving}>
            Reload
          </button>
          <button onClick={() => void save()} disabled={!dirtyFlag || saving}>
            {saving ? 'Saving…' : dirtyFlag ? 'Save' : 'Saved'}
          </button>
        </div>
      </header>
      <p className="muted">
        Edits are batched. Save writes one <code>PUT</code> per locale; unedited
        lines stay byte-identical on disk.
      </p>

      {files.length === 0 && (
        <div className="translations-empty muted">
          No <code>messages-*.properties</code> files under
          <code> translations/</code> or
          <code> app_settings/forms/translations/</code>.
        </div>
      )}

      {files.length > 0 && (
        <>
          <div className="form-row translations-filter">
            <input
              type="search"
              placeholder="Filter by key or value…"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
            />
            <span className="muted small">
              {filteredKeys.length} / {keys.length} keys · {files.length} locale
              {files.length === 1 ? '' : 's'}
            </span>
          </div>

          <div className="translations-grid-scroll">
            <table className="translations-grid">
              <thead>
                <tr>
                  <th scope="col" className="translations-key-col">
                    Key
                  </th>
                  {files.map((f) => (
                    <th key={f.path} scope="col" title={f.path}>
                      <div className="translations-locale-label">{f.locale}</div>
                      <div className="muted small">{f.dir}</div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filteredKeys.map((key) => (
                  <tr key={key}>
                    <th scope="row" className="translations-key-col">
                      <code>{key}</code>
                    </th>
                    {valuesPerFile.map(({ file, values }) => {
                      const original = values.get(key) ?? '';
                      const edited = edits[file.path]?.[key];
                      const effective = edited ?? original;
                      const isDirty = edited !== undefined;
                      // A cell is "missing" when this file has no non-empty
                      // value for the key AND at least one sibling file does.
                      // Present-but-empty (`foo=`) counts the same as absent;
                      // an in-flight edit that filled the cell clears the flag
                      // so the user sees their fix land immediately.
                      const cellHasValue = effective.length > 0;
                      const siblingHasValue =
                        !cellHasValue &&
                        valuesPerFile.some(({ file: other, values: otherVals }) => {
                          if (other.path === file.path) return false;
                          const otherEdit = edits[other.path]?.[key];
                          const otherEff = otherEdit ?? otherVals.get(key) ?? '';
                          return otherEff.length > 0;
                        });
                      const isMissing = !cellHasValue && siblingHasValue;
                      const cls = [
                        'translations-cell',
                        isMissing ? 'missing' : '',
                        isDirty ? 'dirty' : '',
                      ]
                        .filter(Boolean)
                        .join(' ');
                      return (
                        <td key={file.path} className={cls}>
                          {isMissing && (
                            <span
                              className="translations-missing-glyph"
                              aria-label="missing translation"
                              title="Missing in this locale"
                            >
                              !
                            </span>
                          )}
                          <input
                            className="translations-input"
                            value={effective}
                            placeholder={isMissing ? 'Add translation…' : ''}
                            onChange={(e) =>
                              setCell(file.path, key, e.target.value, original)
                            }
                            spellCheck={false}
                          />
                        </td>
                      );
                    })}
                  </tr>
                ))}
                {filteredKeys.length === 0 && (
                  <tr>
                    <td colSpan={files.length + 1} className="muted">
                      No keys match “{filter}”.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

export default TranslationsEditor;
