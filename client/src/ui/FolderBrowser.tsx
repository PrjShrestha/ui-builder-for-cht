import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api.js';

interface Entry {
  name: string;
  isDirectory: boolean;
  isProjectRoot: boolean;
}

interface SearchHit {
  path: string;
  name: string;
  isProjectRoot: boolean;
}

export function FolderBrowser(props: {
  initialPath?: string;
  onSelect: (path: string) => void;
  onCancel: () => void;
}) {
  const [path, setPath] = useState(props.initialPath ?? '');
  const [pathInput, setPathInput] = useState(props.initialPath ?? '');
  const [parent, setParent] = useState<string | null>(null);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [shortcuts, setShortcuts] = useState<Array<{ label: string; path: string }>>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [searchResults, setSearchResults] = useState<SearchHit[] | null>(null);
  const [searching, setSearching] = useState(false);
  const searchAbort = useRef<AbortController | null>(null);

  async function load(p: string) {
    setLoading(true);
    setError(null);
    try {
      const res = await api.browse(p);
      setPath(res.path);
      setPathInput(res.path);
      setParent(res.parent);
      setEntries(res.entries);
      setQuery('');
      setSearchResults(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load(props.initialPath ?? '');
    void api
      .browseShortcuts()
      .then((res) => setShortcuts(res.shortcuts))
      .catch(() => {});
  }, [props.initialPath]);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedQuery(query.trim()), 250);
    return () => clearTimeout(t);
  }, [query]);

  useEffect(() => {
    if (!debouncedQuery || !path) {
      setSearchResults(null);
      return;
    }
    searchAbort.current?.abort();
    const ctl = new AbortController();
    searchAbort.current = ctl;
    setSearching(true);
    api
      .browseSearch(path, debouncedQuery)
      .then((res) => {
        if (ctl.signal.aborted) return;
        setSearchResults(res.results);
      })
      .catch(() => {})
      .finally(() => {
        if (!ctl.signal.aborted) setSearching(false);
      });
  }, [debouncedQuery, path]);

  const breadcrumbs = useMemo(() => {
    if (!path) return [];
    const isWin = /^[A-Za-z]:[\\/]/.test(path);
    const sep = isWin ? '\\' : '/';
    const parts = path.split(/[\\/]+/).filter(Boolean);
    const crumbs: Array<{ label: string; path: string }> = [];
    if (isWin) {
      const drive = parts[0]!;
      crumbs.push({ label: drive + sep, path: drive + sep });
      for (let i = 1; i < parts.length; i++) {
        crumbs.push({ label: parts[i]!, path: parts.slice(0, i + 1).join(sep) });
      }
    } else {
      let cur = '';
      for (const p of parts) {
        cur = cur + '/' + p;
        crumbs.push({ label: p, path: cur });
      }
    }
    return crumbs;
  }, [path]);

  function joinChild(name: string): string {
    if (!path) return name;
    if (path.endsWith(':\\') || path.endsWith('/')) return path + name;
    const sep = /^[A-Za-z]:[\\/]/.test(path) ? '\\' : '/';
    return path + sep + name;
  }

  const showSearch = debouncedQuery.length > 0;
  const tiles: Array<{ name: string; path: string; isProjectRoot: boolean }> = showSearch
    ? (searchResults ?? []).map((r) => ({ name: r.name, path: r.path, isProjectRoot: r.isProjectRoot }))
    : entries.map((e) => ({ name: e.name, path: joinChild(e.name), isProjectRoot: e.isProjectRoot }));

  return (
    <div className="modal-overlay" onClick={props.onCancel}>
      <div className="modal modal-drive" onClick={(e) => e.stopPropagation()}>
        <header className="drive-header">
          <div className="drive-title">Select a project folder</div>
          <div className="drive-search-wrap">
            <span className="drive-search-icon">🔍</span>
            <input
              className="drive-search"
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={
                path ? `Search in ${shortName(path)}` : 'Pick a location first'
              }
              disabled={!path}
            />
            {searching && <span className="muted small">searching…</span>}
          </div>
          <button className="link drive-close" onClick={props.onCancel} aria-label="Close">
            ✕
          </button>
        </header>

        <div className="drive-body">
          <aside className="drive-sidebar">
            <div className="sidebar-section-label">Quick access</div>
            {shortcuts.map((s) => (
              <button
                key={s.path}
                className={`sidebar-shortcut ${path === s.path ? 'active' : ''}`}
                onClick={() => void load(s.path)}
                title={s.path}
              >
                <span className="sidebar-icon">{s.label === 'Home' ? '🏠' : '💽'}</span>
                <span>{s.label}</span>
              </button>
            ))}
          </aside>

          <div className="drive-main">
            <div className="drive-toolbar">
              <button
                onClick={() => void load(parent ?? '')}
                disabled={loading || (!parent && !path)}
                title="Up one level"
                className="secondary icon-btn"
              >
                ↑
              </button>
              <div className="breadcrumbs">
                {breadcrumbs.length === 0 ? (
                  <span className="muted">This PC</span>
                ) : (
                  breadcrumbs.map((c, i) => (
                    <span key={c.path}>
                      {i > 0 && <span className="bc-sep">›</span>}
                      <button className="link bc-crumb" onClick={() => void load(c.path)}>
                        {c.label}
                      </button>
                    </span>
                  ))
                )}
              </div>
              <input
                className="path-input"
                type="text"
                value={pathInput}
                onChange={(e) => setPathInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void load(pathInput);
                }}
                placeholder="Paste a path"
              />
            </div>

            {error && <div className="error-banner">{error}</div>}

            {showSearch && (
              <div className="muted small drive-result-count">
                {searchResults
                  ? `${searchResults.length} result${searchResults.length === 1 ? '' : 's'} in ${shortName(path)}`
                  : 'Searching…'}
              </div>
            )}

            {tiles.length === 0 && !loading && !searching ? (
              <div className="drive-empty">
                {showSearch ? 'No folders match.' : path ? 'Empty folder.' : 'Pick a drive on the left.'}
              </div>
            ) : (
              <div className="drive-grid">
                {tiles.map((t) => (
                  <button
                    key={t.path}
                    className={`drive-tile ${t.isProjectRoot ? 'is-project' : ''}`}
                    onDoubleClick={() => void load(t.path)}
                    onClick={() => void load(t.path)}
                    title={t.path}
                  >
                    <div className="tile-icon">{t.isProjectRoot ? '📦' : '📁'}</div>
                    <div className="tile-name">{t.name}</div>
                    {showSearch && (
                      <div className="tile-sub muted small">{parentOf(t.path)}</div>
                    )}
                    {t.isProjectRoot && (
                      <div className="tile-actions">
                        <span className="badge">cht-conf</span>
                        <span
                          className="tile-select"
                          role="button"
                          tabIndex={0}
                          onClick={(e) => {
                            e.stopPropagation();
                            props.onSelect(t.path);
                          }}
                        >
                          Open this
                        </span>
                      </div>
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        <footer className="drive-footer">
          <div className="muted small footer-hint">
            Click a folder to drill in · use Search to find any folder under the current location · click <strong>Open this</strong> on a cht-conf tile to select it
          </div>
          <button onClick={props.onCancel} className="secondary">
            Cancel
          </button>
          <button onClick={() => props.onSelect(path)} disabled={!path}>
            Select this folder
          </button>
        </footer>
      </div>
    </div>
  );
}

function shortName(p: string): string {
  const parts = p.split(/[\\/]+/).filter(Boolean);
  if (parts.length === 0) return p;
  return parts[parts.length - 1] ?? p;
}

function parentOf(p: string): string {
  const m = p.match(/^(.*)[\\/][^\\/]+$/);
  return m ? (m[1] ?? '') : '';
}
