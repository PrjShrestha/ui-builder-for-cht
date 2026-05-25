/**
 * Editor for a form's .properties.json file.
 *
 * Schema (per gandaki pregnancy.properties.json):
 * {
 *   "title": [
 *     { "locale": "en", "content": "Pregnancy registration" },
 *     { "locale": "ne", "content": "गर्भवती दर्ता" }
 *   ],
 *   "context": {
 *     "place": false,
 *     "person": true,
 *     "expression": "contact.type === 'person' && summary.show_pregnancy_form && ..."
 *   },
 *   "icon": "icon-pregnancy"
 * }
 */
import { useEffect, useState } from 'react';
import { ContextExpressionBuilder } from './ContextExpressionBuilder.js';

interface TitleEntry {
  locale: string;
  content: string;
}

interface FormContext {
  place?: boolean;
  person?: boolean;
  expression?: string;
}

export interface FormProperties {
  title?: TitleEntry[];
  context?: FormContext;
  icon?: string;
  [k: string]: unknown;
}

interface Props {
  value: FormProperties;
  locales: string[];
  onChange: (next: FormProperties) => void;
  onClose: () => void;
}

export function PropertiesEditor(props: Props) {
  const [draft, setDraft] = useState<FormProperties>(props.value);
  useEffect(() => setDraft(props.value), [props.value]);

  function patch(next: FormProperties) {
    setDraft(next);
    props.onChange(next);
  }

  const titles = draft.title ?? [];

  function setTitle(locale: string, content: string) {
    const others = titles.filter((t) => t.locale !== locale);
    const nextTitles = content === '' ? others : [...others, { locale, content }];
    patch({ ...draft, title: nextTitles });
  }
  function setContext(field: keyof FormContext, value: unknown) {
    const nextCtx: FormContext = { ...(draft.context ?? {}), [field]: value };
    patch({ ...draft, context: nextCtx });
  }

  // Build a locale list that covers all known locales + any in the title array.
  const allLocales = [...new Set([...props.locales, ...titles.map((t) => t.locale)])];

  return (
    <div className="properties-editor card">
      <header className="row gap">
        <h3>Form properties</h3>
        <button className="link" onClick={props.onClose}>
          close
        </button>
      </header>

      <section>
        <h4>Title (per locale)</h4>
        {allLocales.length === 0 && <p className="muted">No locales yet.</p>}
        {allLocales.map((loc) => {
          const t = titles.find((tt) => tt.locale === loc);
          return (
            <label key={loc} className="row gap">
              <code className="locale-tag">{loc}</code>
              <input
                value={t?.content ?? ''}
                onChange={(e) => setTitle(loc, e.target.value)}
                placeholder={`title in ${loc}`}
              />
            </label>
          );
        })}
      </section>

      <section>
        <h4>Icon</h4>
        <input
          value={draft.icon ?? ''}
          onChange={(e) => patch({ ...draft, icon: e.target.value })}
          placeholder="icon-pregnancy"
        />
      </section>

      <section>
        <h4>Context (who sees this form)</h4>
        <label className="row gap">
          <input
            type="checkbox"
            checked={draft.context?.expression === 'false'}
            onChange={(e) => {
              if (e.target.checked) {
                setContext('expression', 'false');
              } else {
                setContext('expression', '');
              }
            }}
          />
          <strong>Task-only form (hidden from action menu)</strong>
          <span className="muted">— check this if the form is opened only by tasks; we'll set <code>expression: 'false'</code> for you</span>
        </label>
        <label className="row gap">
          <input
            type="checkbox"
            checked={draft.context?.person === true}
            onChange={(e) => setContext('person', e.target.checked)}
            disabled={draft.context?.expression === 'false'}
          />
          Available on people
        </label>
        <label className="row gap">
          <input
            type="checkbox"
            checked={draft.context?.place === true}
            onChange={(e) => setContext('place', e.target.checked)}
            disabled={draft.context?.expression === 'false'}
          />
          Available on places
        </label>
        <label className="expr-field">
          <span className="expr-label">
            <code>expression</code>
            <em className="muted">
              {' '}— form shows when these conditions are met
            </em>
          </span>
          <ContextExpressionBuilder
            value={draft.context?.expression ?? ''}
            onChange={(v) => setContext('expression', v)}
            disabled={draft.context?.expression === 'false'}
          />
        </label>
        <details>
          <summary className="muted">Other properties.json keys (preserved verbatim)</summary>
          {Object.entries(draft)
            .filter(([k]) => !['title', 'context', 'icon'].includes(k))
            .map(([k, v]) => (
              <div key={k} className="row gap">
                <code>{k}</code>
                <code className="muted">{JSON.stringify(v).slice(0, 80)}</code>
              </div>
            ))}
        </details>
      </section>
    </div>
  );
}
