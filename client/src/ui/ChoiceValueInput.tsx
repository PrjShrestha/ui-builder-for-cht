/**
 * Value input for rule builders that upgrades to a CHOICE DROPDOWN when
 * the compared field is a `select_one` / `select_multiple` with known
 * choices (geriatric handoff §1, docs/handoff-geriatric-blockers-2026-08-05.md).
 *
 * The no-code bar forbids hand-typing auto-generated choice slugs (e.g.
 * `फेल`'s slug) — the dropdown shows the choice LABEL and stores the
 * choice NAME, so emitted expressions are byte-identical to what the
 * typed path produced. "custom" is the escape hatch to the raw input
 * (off-list values, `${other_field}` refs); it is sticky only when the
 * user chose it — a stored value that appears in the (possibly
 * async-loaded) choice list automatically renders as the dropdown.
 *
 * When the field has no known choices, this renders the same bare
 * `<input>` the builders always had.
 */
import { useState } from 'react';
import type { ReportFieldChoice } from '@cht-ui/shared';

export function ChoiceValueInput(props: {
  value: string;
  onChange: (v: string) => void;
  /** The field's real choices; undefined/empty → plain text input. */
  choices: ReportFieldChoice[] | undefined;
  placeholder?: string;
  title?: string;
}) {
  const { value, onChange, choices } = props;
  const has = (choices?.length ?? 0) > 0;
  const inList = has && choices!.some((c) => c.name === value);
  const [customExplicit, setCustomExplicit] = useState(false);
  // Derived, not stored: a non-empty value that isn't in the list needs
  // the free input (it may be a legacy/off-list value); the moment the
  // list catches up (async fetch) the dropdown takes over — unless the
  // user explicitly clicked "custom".
  const useCustom = !has || customExplicit || (value !== '' && !inList);

  if (useCustom) {
    return (
      <>
        <input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={props.placeholder ?? 'value'}
          title={props.title}
        />
        {has && (
          <button
            type="button"
            className="link small"
            onClick={() => {
              setCustomExplicit(false);
              // An off-list value would immediately re-force custom mode;
              // clear it so the dropdown actually appears.
              if (!inList) onChange('');
            }}
            title="Pick from this field's choices"
          >
            pick
          </button>
        )}
      </>
    );
  }

  return (
    <>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        title={props.title ?? "Pick a value from this field's choices"}
        className="choice-value-select"
      >
        <option value="">— pick a value —</option>
        {choices!.map((c) => (
          <option key={c.name} value={c.name} title={c.name}>
            {c.label === c.name ? c.name : `${c.label} (${c.name})`}
          </option>
        ))}
      </select>
      <button
        type="button"
        className="link small"
        onClick={() => setCustomExplicit(true)}
        title="Type a custom value instead"
      >
        custom
      </button>
    </>
  );
}
