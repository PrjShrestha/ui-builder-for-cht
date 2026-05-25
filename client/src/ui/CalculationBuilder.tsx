/**
 * DMN-style decision-table editor for an XLSForm `calculation` cell.
 *
 * Rows = rule cases (first match wins). Each rule has:
 *   - A condition (built via the existing RelevantRuleBuilder UI)
 *   - An output value (typed by the user; literal strings auto-quoted)
 * A final "otherwise" row holds the default value.
 *
 * Compiles to nested if(cond, then, ...). Raw fallback for expressions
 * we can't lift.
 */
import { useEffect, useState } from 'react';
import {
  parseCalculation,
  serializeCalculation,
  parseRelevant,
  type CalculationRule,
  type ParsedCalculation,
} from '@cht-ui/shared';
import { RelevantRuleBuilder } from './RelevantRuleBuilder.js';

interface Props {
  value: string;
  fieldOptions: string[];
  onSave: (v: string) => void;
  onCancel: () => void;
  title?: string;
}

export function CalculationBuilder(props: Props) {
  const [parsed, setParsed] = useState<ParsedCalculation>(() => parseCalculation(props.value));
  const [showRaw, setShowRaw] = useState<boolean>(parsed.shape === 'raw');
  const [rawText, setRawText] = useState<string>(props.value);
  const [editingCondIdx, setEditingCondIdx] = useState<number | null>(null);

  useEffect(() => {
    const p = parseCalculation(props.value);
    setParsed(p);
    setRawText(props.value);
    if (p.shape === 'raw') setShowRaw(true);
  }, [props.value]);

  function patch(next: ParsedCalculation) {
    setParsed(next);
  }
  function patchRule(idx: number, updater: (r: CalculationRule) => CalculationRule) {
    if (parsed.shape !== 'decision_table') return;
    patch({ ...parsed, rules: parsed.rules.map((r, i) => (i === idx ? updater(r) : r)) });
  }
  function addRule() {
    if (parsed.shape !== 'decision_table') return;
    patch({
      ...parsed,
      rules: [...parsed.rules, { condition: parseRelevant(''), output: "''" }],
    });
  }
  function removeRule(idx: number) {
    if (parsed.shape !== 'decision_table') return;
    patch({ ...parsed, rules: parsed.rules.filter((_, i) => i !== idx) });
  }

  function save() {
    if (showRaw) {
      props.onSave(rawText);
      return;
    }
    props.onSave(serializeCalculation(parsed));
  }

  return (
    <div className="rule-builder-modal" role="dialog">
      <div className="rule-builder-card calc-card">
        <header className="row gap">
          <h3>{props.title ?? 'Decision table — calculation'}</h3>
          <button className="link" onClick={props.onCancel}>cancel</button>
        </header>

        <div className="row gap">
          <button className={!showRaw ? 'active' : 'link'} onClick={() => setShowRaw(false)}>
            Decision table
          </button>
          <button className={showRaw ? 'active' : 'link'} onClick={() => setShowRaw(true)}>
            Raw XLSForm expression
          </button>
        </div>

        {!showRaw && parsed.shape === 'decision_table' && (
          <>
            <p className="muted">
              First matching rule wins. If no rule matches, the &quot;otherwise&quot; value is used.
            </p>
            <table className="decision-table">
              <thead>
                <tr>
                  <th style={{ width: 24 }}>#</th>
                  <th>If…</th>
                  <th style={{ width: 200 }}>Then output</th>
                  <th style={{ width: 60 }}></th>
                </tr>
              </thead>
              <tbody>
                {parsed.rules.map((rule, idx) => (
                  <tr key={idx}>
                    <td>{idx + 1}</td>
                    <td>
                      <div className="row gap">
                        <code className="cond-preview">
                          {serializeConditionSummary(rule.condition) || '(empty)'}
                        </code>
                        <button className="link" onClick={() => setEditingCondIdx(idx)}>
                          ✎
                        </button>
                      </div>
                    </td>
                    <td>
                      <input
                        value={rule.output}
                        onChange={(e) => patchRule(idx, (r) => ({ ...r, output: e.target.value }))}
                        placeholder="'yes' or 5"
                      />
                    </td>
                    <td>
                      <button className="link danger" onClick={() => removeRule(idx)}>×</button>
                    </td>
                  </tr>
                ))}
                <tr className="otherwise-row">
                  <td colSpan={2} style={{ textAlign: 'right' }}>
                    <strong>otherwise</strong>
                  </td>
                  <td>
                    <input
                      value={parsed.otherwise}
                      onChange={(e) => patch({ ...parsed, otherwise: e.target.value })}
                      placeholder="'no' or 0"
                    />
                  </td>
                  <td></td>
                </tr>
              </tbody>
            </table>
            <div className="row gap toolbar">
              <button onClick={addRule}>+ Rule</button>
            </div>
            <div className="preview">
              <strong className="muted">Compiled XLSForm expression:</strong>
              <pre>{serializeCalculation(parsed)}</pre>
            </div>
          </>
        )}

        {showRaw && (
          <textarea
            className="code-editor medium"
            value={rawText}
            onChange={(e) => setRawText(e.target.value)}
            spellCheck={false}
          />
        )}

        <footer className="row gap end">
          <button onClick={save}>Save</button>
          <button className="link" onClick={props.onCancel}>cancel</button>
        </footer>

        {editingCondIdx !== null && parsed.shape === 'decision_table' && parsed.rules[editingCondIdx] && (
          <RelevantRuleBuilder
            column={`rule #${editingCondIdx + 1} condition`}
            value={serializeRelevantStub(parsed.rules[editingCondIdx]!.condition)}
            fieldOptions={props.fieldOptions}
            onCancel={() => setEditingCondIdx(null)}
            onSave={(v) => {
              patchRule(editingCondIdx, (r) => ({ ...r, condition: parseRelevant(v) }));
              setEditingCondIdx(null);
            }}
          />
        )}
      </div>
    </div>
  );
}

/** Short human summary of a condition for the table cell. */
function serializeConditionSummary(cond: import('@cht-ui/shared').ParsedExpression): string {
  if (cond.rules.length === 0) return '';
  const parts = cond.rules.map((r) => {
    if (r.kind === 'comparison') {
      const v = r.valueIsString ? `'${r.value}'` : r.value;
      return `\${${r.field}} ${r.op} ${v}`;
    }
    if (r.kind === 'selected') {
      return `${r.negated ? 'not ' : ''}selected(\${${r.field}}, '${r.value}')`;
    }
    if (r.kind === 'answered') {
      return `\${${r.field}} ${r.negated ? 'is empty' : 'is answered'}`;
    }
    return r.text;
  });
  return parts.join(` ${cond.combinator} `);
}

function serializeRelevantStub(cond: import('@cht-ui/shared').ParsedExpression): string {
  // Reuse the project's relevant serializer by re-importing it lazily.
  // Implemented inline to avoid a dependency cycle.
  if (cond.rules.length === 0) return '';
  const parts = cond.rules.map((r) => {
    switch (r.kind) {
      case 'comparison': {
        const v = r.valueIsString ? `'${r.value.replace(/'/g, "\\'")}'` : r.value;
        return `\${${r.field}} ${r.op} ${v}`;
      }
      case 'selected': {
        const inner = `selected(\${${r.field}}, '${r.value.replace(/'/g, "\\'")}')`;
        return r.negated ? `not(${inner})` : inner;
      }
      case 'answered':
        return r.negated ? `\${${r.field}} = ''` : `\${${r.field}} != ''`;
      case 'raw':
        return r.text;
    }
  });
  return parts.join(` ${cond.combinator} `);
}
