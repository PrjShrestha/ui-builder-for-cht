/**
 * Modal that previews the diff between two XLSForms before saving.
 * The user can review what's about to change and either confirm or cancel.
 */
import { isEmptyDiff, type XLSFormDiff } from '@cht-ui/shared';

interface Props {
  diff: XLSFormDiff;
  onConfirm: () => void;
  onCancel: () => void;
}

export function SaveDiffModal({ diff, onConfirm, onCancel }: Props) {
  const empty = isEmptyDiff(diff);
  return (
    <div className="rule-builder-modal" role="dialog">
      <div className="rule-builder-card">
        <header className="row gap">
          <h3>Confirm save</h3>
          <button className="link" onClick={onCancel}>
            cancel
          </button>
        </header>
        {empty && <p className="muted">No structural changes detected. Save anyway?</p>}

        {diff.surveyReordered && (
          <p>
            <span className="badge warn">Reordered</span> Survey row order changed.
          </p>
        )}

        <Section title={`Added rows (${diff.surveyAdded.length})`} items={diff.surveyAdded.map((r) => `${r.type}  ${r.name}`)} />
        <Section title={`Removed rows (${diff.surveyRemoved.length})`} items={diff.surveyRemoved.map((r) => `${r.type}  ${r.name}`)} />
        <Section
          title={`Modified rows (${diff.surveyModified.length})`}
          items={diff.surveyModified.map(
            (m) => `${m.after?.name ?? m.before?.name}: ${m.changedFields.join(', ')}`,
          )}
        />
        <Section
          title={`Added choices (${diff.choicesAdded.length})`}
          items={diff.choicesAdded.map((c) => `${c.list_name} / ${c.name}`)}
        />
        <Section
          title={`Removed choices (${diff.choicesRemoved.length})`}
          items={diff.choicesRemoved.map((c) => `${c.list_name} / ${c.name}`)}
        />
        <Section
          title={`Modified choices (${diff.choicesModified.length})`}
          items={diff.choicesModified.map(
            (m) => `${m.after?.list_name ?? m.before?.list_name} / ${m.after?.name ?? m.before?.name}: ${m.changedFields.join(', ')}`,
          )}
        />
        <Section
          title={`Settings changed (${diff.settingsChanged.length})`}
          items={diff.settingsChanged.map(
            (s) => `${s.key}: "${s.before ?? '∅'}" → "${s.after ?? '∅'}"`,
          )}
        />

        <footer className="row gap end">
          <button onClick={onConfirm}>Save</button>
          <button className="link" onClick={onCancel}>
            cancel
          </button>
        </footer>
      </div>
    </div>
  );
}

function Section({ title, items }: { title: string; items: string[] }) {
  if (items.length === 0) return null;
  return (
    <details open={items.length <= 5}>
      <summary>
        <strong>{title}</strong>
      </summary>
      <ul className="diff-list">
        {items.map((it, i) => (
          <li key={i}>
            <code>{it}</code>
          </li>
        ))}
      </ul>
    </details>
  );
}
