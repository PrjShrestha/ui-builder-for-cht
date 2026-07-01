/**
 * Choice-list name field with auto-slugify + "Fix" affordance.
 *
 * Enforces the no-code invariant from decision_nocode_names_autoderived:
 * users can type free-form (including spaces / punctuation), but the value
 * that lands in ChoiceRow.name is coerced to a valid XLSForm identifier so
 * `cht convert-app-forms` doesn't reject the deploy with e.g. "Choice names
 * with spaces cannot be added to multiple choice selects".
 *
 * Behavior:
 *  - Free-form during typing (per-keystroke stays exactly what the user types).
 *  - On blur, if the value contains any character outside [A-Za-z0-9_] OR
 *    starts with a digit, coerce to `slugifyHierarchyId(value)`.
 *  - Inline "Fix" button appears next to an invalid value while the input
 *    isn't focused — one-click coerce for values loaded from disk.
 *  - On focus of an empty input, if `fromLabel` is non-empty, prefill with
 *    `slugifyHierarchyId(fromLabel)`. User's manual edit after that is
 *    respected (no auto-rederive on subsequent label changes).
 *
 * Not in scope (out for MVP): rewriting `selected(${list}, '<oldName>')` /
 * `choice_filter` refs elsewhere in the form. Choice names are usually not
 * referenced by string literal in expressions; if they are, the user can
 * find/replace them manually. Ref-rewrite would need to walk survey
 * relevant/calculation/constraint columns AND `choice_filter` values — a
 * bigger surface than the survey-row rename macro.
 */
import { useRef, useState } from 'react';
import { slugifyHierarchyId } from '@cht-ui/shared';

interface Props {
  value: string;
  onChange: (next: string) => void;
  /**
   * Atomic rename: fired on blur (if the value changed from the focus
   * baseline) and on Fix-button click. When provided, the parent should
   * route through `renameChoiceValue(form, list, oldName, newName)` so
   * every `selected(${x}, 'oldName')` / `${x} = 'oldName'` reference in
   * expressions on rows bound to `list` gets rewritten in lockstep.
   *
   * If NOT provided, we fall back to `onChange(newName)` — the choice
   * name changes but expression refs are left as-is (typical for the
   * inline editor if the caller opts out).
   */
  onRename?: (opts: { oldName: string; newName: string }) => void;
  /** Label in the current locale — used to prefill the name when it's empty on focus. */
  fromLabel?: string;
  placeholder?: string;
  /** Extra className passthrough for the outer wrapper. */
  className?: string;
}

const XLSFORM_ID = /^[A-Za-z_][A-Za-z0-9_]*$/;

export function ChoiceNameInput(props: Props) {
  const [focused, setFocused] = useState(false);
  const focusBaselineRef = useRef<string | null>(null);
  const value = props.value;
  const isValid = value === '' || XLSFORM_ID.test(value);
  const suggested = isValid ? '' : slugifyHierarchyId(value);

  function commitRename(oldName: string, newName: string) {
    if (!oldName || !newName || oldName === newName) return;
    if (props.onRename) {
      props.onRename({ oldName, newName });
    } else {
      props.onChange(newName);
    }
  }

  function handleFocus() {
    setFocused(true);
    focusBaselineRef.current = value;
    if (value === '' && props.fromLabel && props.fromLabel.trim() !== '') {
      const derived = slugifyHierarchyId(props.fromLabel);
      if (derived) props.onChange(derived);
    }
  }

  function handleBlur() {
    setFocused(false);
    const baseline = focusBaselineRef.current;
    focusBaselineRef.current = null;
    // If the on-blur value is invalid, coerce first and treat the coerced
    // form as the "new" name for the rename macro.
    let finalValue = value;
    if (!isValid && suggested) {
      finalValue = suggested;
      props.onChange(suggested);
    }
    // Fire the atomic rename (ref-rewrite) if the value actually
    // changed vs the focus baseline.
    if (baseline !== null && baseline !== finalValue) {
      commitRename(baseline, finalValue);
    }
  }

  function applyFix() {
    if (!suggested) return;
    // The Fix button rewrites refs from the current (invalid) value to
    // the slug. We skip the intermediate onChange so the tree only
    // patches once.
    commitRename(value, suggested);
    // Ensure the input reflects the fixed value even if the parent's
    // commitRename doesn't push a re-render (defensive: renameChoiceValue
    // updates `choices[].name`, which flows back through props.value).
    focusBaselineRef.current = null;
  }

  return (
    <span className={`choice-name-input ${props.className ?? ''}`.trim()}>
      <input
        value={value}
        onChange={(e) => props.onChange(e.target.value)}
        onFocus={handleFocus}
        onBlur={handleBlur}
        placeholder={props.placeholder ?? 'yes'}
        className={!isValid ? 'invalid' : ''}
        aria-invalid={!isValid || undefined}
        title={
          isValid
            ? undefined
            : `XLSForm choice names must be identifiers (no spaces, no punctuation). Will auto-fix to '${suggested}' on blur or via Fix button.`
        }
      />
      {!isValid && !focused && suggested && (
        <button
          type="button"
          className="link small"
          onClick={applyFix}
          title={`Rename to '${suggested}'`}
        >
          Fix → {suggested}
        </button>
      )}
    </span>
  );
}
