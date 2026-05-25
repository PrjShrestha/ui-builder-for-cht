import { useApp } from '../state/store.js';

export function ErrorBanner() {
  const lastError = useApp((s) => s.lastError);
  const setError = useApp((s) => s.setError);
  if (!lastError) return null;
  return (
    <div className="error-banner" role="alert">
      <span>{lastError}</span>
      <button onClick={() => setError(null)} aria-label="dismiss">
        ×
      </button>
    </div>
  );
}
