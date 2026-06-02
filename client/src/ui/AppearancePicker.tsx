/**
 * Widget / appearance picker for the XLSForm `appearance` column.
 *
 * Appearance is technically a space-separated list of tokens — e.g.
 * `field-list summary`, `h1 blue center`. This picker presents a curated
 * catalog of CHT-and-Enketo-supported appearances (assembled from real
 * usage in chis forms + ODK / CHT docs), filtered by the row's question
 * type. The user can toggle tokens via checkboxes or fall back to a raw
 * text input for anything outside the catalog.
 *
 * Used from the FormEditor row editor as a popover.
 */
import { useMemo, useState } from 'react';

interface AppearanceEntry {
  name: string;
  description: string;
  appliesTo: string[];
  chtOnly: boolean;
  example: string;
}

/**
 * Curated appearance catalog. Sourced from the CHT docs and a real-usage
 * scan of D:\medic\config-nssd\chis. CHT-specific entries are flagged so
 * the UI can warn users who deploy to plain Enketo.
 */
export const APPEARANCES: AppearanceEntry[] = [
  // Layout
  { name: 'field-list', description: 'Render the group as a single scrolling page instead of one question per screen.', appliesTo: ['begin group', 'begin repeat'], chtOnly: false, example: 'Group all "danger signs" checkboxes onto one page.' },
  { name: 'summary', description: 'Read-only summary group shown at end of form for review before submit.', appliesTo: ['begin group'], chtOnly: false, example: 'Final "Review answers" page.' },
  { name: 'label', description: 'In a table-list group, marks the row that supplies column headers.', appliesTo: ['select_one', 'select_multiple'], chtOnly: false, example: 'Header row of a Likert table.' },
  { name: 'list-nolabel', description: 'In a table-list group, hides the question label and shows only the choice cells.', appliesTo: ['select_one', 'select_multiple'], chtOnly: false, example: 'Body rows of a Likert table.' },
  { name: 'table-list', description: 'Lay out child select questions as a shared-header table.', appliesTo: ['begin group'], chtOnly: false, example: 'Symptom severity grid.' },
  { name: 'horizontal', description: 'Lay out choices in a single horizontal row.', appliesTo: ['select_one', 'select_multiple'], chtOnly: false, example: 'Yes / No / Unknown on one line.' },
  { name: 'horizontal-compact', description: 'Horizontal layout that wraps choices densely.', appliesTo: ['select_one', 'select_multiple'], chtOnly: false, example: 'Short Likert options.' },
  { name: 'columns', description: 'Auto-sized multi-column grid for choices (Enketo).', appliesTo: ['select_one', 'select_multiple'], chtOnly: false, example: '12 symptom checkboxes in 3-4 columns.' },
  { name: 'columns-pack', description: 'Like columns but packs choices as tightly as possible.', appliesTo: ['select_one', 'select_multiple'], chtOnly: false, example: 'Long district list in a dense grid.' },
  { name: 'columns-1', description: 'Force 1-column choice layout.', appliesTo: ['select_one', 'select_multiple'], chtOnly: false, example: 'Stack vertically, override grid.' },
  { name: 'columns-2', description: 'Force 2-column choice layout.', appliesTo: ['select_one', 'select_multiple'], chtOnly: false, example: 'Two-column checkbox list.' },
  { name: 'columns-3', description: 'Force 3-column choice layout.', appliesTo: ['select_one', 'select_multiple'], chtOnly: false, example: 'Three-column checkbox list.' },
  { name: 'quick', description: 'Auto-advance to next question on choice.', appliesTo: ['select_one'], chtOnly: false, example: 'Single-tap "Yes/No" that skips ahead.' },

  // Input style
  { name: 'minimal', description: 'Render choices as a compact dropdown.', appliesTo: ['select_one', 'select_multiple'], chtOnly: false, example: 'Country picker with 200 options.' },
  { name: 'autocomplete', description: 'Type-ahead text filter over choices.', appliesTo: ['select_one', 'select_multiple'], chtOnly: false, example: 'Search a medication list.' },
  { name: 'search', description: 'Server / external-data search appearance.', appliesTo: ['select_one', 'select_multiple'], chtOnly: false, example: 'Search a village CSV by name.' },
  { name: 'slider', description: 'Render numeric input as a draggable slider.', appliesTo: ['integer', 'decimal', 'range'], chtOnly: false, example: 'Pain scale 0-10.' },
  { name: 'compact', description: 'Compact image-choice grid (with media).', appliesTo: ['select_one', 'select_multiple'], chtOnly: false, example: 'Icon-only mood emoji grid.' },
  { name: 'no-buttons', description: 'Plain tiles without radio/checkbox controls.', appliesTo: ['select_one', 'select_multiple'], chtOnly: false, example: 'Tap-a-picture symptom selector.' },
  { name: 'likert', description: 'Render choices as a Likert scale (Enketo).', appliesTo: ['select_one'], chtOnly: false, example: 'Strongly disagree → Strongly agree.' },
  { name: 'numbers', description: 'Force numeric keyboard on a text field.', appliesTo: ['text', 'string'], chtOnly: false, example: 'NID with leading zeros.' },
  { name: 'numbers-decimal', description: 'Numeric keyboard with decimal point.', appliesTo: ['text', 'string'], chtOnly: false, example: 'Weight as text to preserve formatting.' },
  { name: 'thousands-sep', description: 'Display large numbers with thousands separators.', appliesTo: ['integer', 'decimal'], chtOnly: false, example: 'Income shown as 1,250,000.' },
  { name: 'tel', description: 'Telephone input field.', appliesTo: ['text', 'string'], chtOnly: false, example: 'Phone number entry.' },
  { name: 'url', description: 'URL input field.', appliesTo: ['text', 'string'], chtOnly: false, example: 'Link to external record.' },
  { name: 'multiline', description: 'Multi-line textarea.', appliesTo: ['text', 'string'], chtOnly: false, example: 'Free-text clinical notes.' },

  // Date / time
  { name: 'month-year', description: 'Pick only month and year.', appliesTo: ['date'], chtOnly: false, example: 'Approximate LMP.' },
  { name: 'year', description: 'Pick only year.', appliesTo: ['date'], chtOnly: false, example: 'Year of birth when month/day unknown.' },
  { name: 'no-calendar', description: 'Spinners / text instead of calendar.', appliesTo: ['date'], chtOnly: false, example: 'Offline-friendly date.' },
  { name: 'bikram-sambat', description: 'Nepali Bikram Sambat calendar (CHT).', appliesTo: ['date'], chtOnly: true, example: 'BS date of last ANC visit, Nepal deployments.' },
  { name: 'bikram-sambat-datepicker', description: 'Full Bikram Sambat date-picker widget.', appliesTo: ['date'], chtOnly: true, example: 'Alternative form of the BS picker.' },

  // CHT-specific widgets
  { name: 'db-object', description: 'Pick a record from CHT database; pair with type "db:<contact_type>".', appliesTo: ['db:person', 'db:clinic', 'db:health_center'], chtOnly: true, example: 'Select the patient.' },
  { name: 'select-contact', description: 'Pick a contact from the CHT contact tree.', appliesTo: ['string'], chtOnly: true, example: 'Pick the household for a household visit.' },
  { name: 'mrdt-verify', description: 'CHT widget that captures a malaria RDT photo and runs image verification.', appliesTo: ['binary', 'image'], chtOnly: true, example: 'Confirm RDT from photo.' },
  { name: 'rapid-diagnostic-test', description: 'Generic RDT-capture widget.', appliesTo: ['binary', 'image'], chtOnly: true, example: 'Generic RDT image capture.' },
  { name: 'countdown-timer', description: 'Visual countdown that gates progress.', appliesTo: ['note'], chtOnly: true, example: 'Wait 15 minutes before reading an RDT.' },
  { name: 'multimedia', description: 'Render attached image / audio / video on a question.', appliesTo: ['note', 'select_one', 'select_multiple'], chtOnly: true, example: 'Instructional video next to a question.' },
  { name: 'hidden', description: 'Hide the field from the user but keep it in the model.', appliesTo: ['calculate', 'string', 'integer', 'select_one', 'begin group'], chtOnly: false, example: 'Carry a calculated patient_uuid silently.' },

  // Styling on notes
  { name: 'center', description: 'Center the note text.', appliesTo: ['note'], chtOnly: true, example: 'Centered section banner.' },
  { name: 'h1', description: 'Render note as a level-1 heading.', appliesTo: ['note'], chtOnly: true, example: 'Top-of-page section title.' },
  { name: 'h2', description: 'Render note as a level-2 heading.', appliesTo: ['note'], chtOnly: true, example: 'Subsection heading.' },
  { name: 'h3', description: 'Render note as a level-3 heading.', appliesTo: ['note'], chtOnly: true, example: 'Sub-subsection heading.' },
  { name: 'li', description: 'Render note as a list item.', appliesTo: ['note'], chtOnly: true, example: 'Bulleted instructions.' },
  { name: 'underline', description: 'Underline the note text.', appliesTo: ['note'], chtOnly: true, example: 'Key warning line.' },
  { name: 'red', description: 'Red note text (CHT styling).', appliesTo: ['note'], chtOnly: true, example: 'Critical warning callout.' },
  { name: 'green', description: 'Green note text.', appliesTo: ['note'], chtOnly: true, example: 'Positive confirmation.' },
  { name: 'blue', description: 'Blue note text.', appliesTo: ['note'], chtOnly: true, example: 'Informational callout.' },
  { name: 'yellow', description: 'Yellow / amber note text.', appliesTo: ['note'], chtOnly: true, example: 'Caution / soft warning.' },

  // Media / behavior
  { name: 'signature', description: 'Capture a finger / stylus signature.', appliesTo: ['image'], chtOnly: false, example: 'Patient consent signature.' },
  { name: 'draw', description: 'Blank drawing canvas.', appliesTo: ['image'], chtOnly: false, example: 'Sketch body-pain location.' },
  { name: 'annotate', description: 'Draw / annotate on a captured photo.', appliesTo: ['image'], chtOnly: false, example: 'Mark a wound location.' },
  { name: 'new', description: 'Force fresh capture (no gallery pick).', appliesTo: ['image', 'audio', 'video'], chtOnly: false, example: 'Force a new RDT photo.' },
  { name: 'new-front', description: 'Capture using the front-facing camera.', appliesTo: ['image', 'video'], chtOnly: false, example: 'CHW selfie verification.' },
  { name: 'placement-map', description: 'Tap on a map to set a geopoint.', appliesTo: ['geopoint'], chtOnly: false, example: 'Household location.' },
  { name: 'maps', description: 'Map-based geopoint capture.', appliesTo: ['geopoint'], chtOnly: false, example: 'GPS with map confirmation.' },
];

function tokensOf(value: string): string[] {
  return value
    .trim()
    .split(/\s+/)
    .filter((t) => t.length > 0);
}

function applicable(entry: AppearanceEntry, rowType: string): boolean {
  if (!rowType) return true;
  const t = rowType.trim().toLowerCase();
  return entry.appliesTo.some((a) => {
    const al = a.toLowerCase();
    if (al === t) return true;
    if (al.endsWith('group') && t.startsWith('begin group')) return true;
    if (al.startsWith('db:') && t.startsWith('db:')) return true;
    return false;
  });
}

export function AppearancePicker(props: {
  value: string;
  rowType: string;
  onChange: (next: string) => void;
  onCancel: () => void;
}) {
  const [filter, setFilter] = useState('');
  const [showAll, setShowAll] = useState(false);
  const current = useMemo(() => new Set(tokensOf(props.value)), [props.value]);

  const visible = APPEARANCES.filter((a) => {
    if (filter && !a.name.includes(filter.toLowerCase()) && !a.description.toLowerCase().includes(filter.toLowerCase())) {
      return false;
    }
    if (!showAll && !applicable(a, props.rowType)) return false;
    return true;
  });

  function toggle(name: string) {
    const next = new Set(current);
    if (next.has(name)) next.delete(name);
    else next.add(name);
    props.onChange(Array.from(next).join(' '));
  }

  return (
    <div className="modal-overlay" onClick={props.onCancel}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Pick appearance(s) — row type: <code>{props.rowType}</code></h2>
          <button className="link" onClick={props.onCancel}>✕</button>
        </div>
        <div className="modal-body">
          <div className="row gap">
            <input
              type="search"
              placeholder="Filter…"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              style={{ flex: 1 }}
            />
            <label className="row gap">
              <input type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} />
              show all (don't filter by type)
            </label>
          </div>
          <p className="muted small">
            Selected: <code>{Array.from(current).join(' ') || '(none)'}</code>
          </p>
          <ul className="appearance-list">
            {visible.map((a) => (
              <li key={a.name}>
                <label className="row gap">
                  <input
                    type="checkbox"
                    checked={current.has(a.name)}
                    onChange={() => toggle(a.name)}
                  />
                  <div style={{ flex: 1 }}>
                    <div>
                      <code>{a.name}</code>
                      {a.chtOnly && <span className="badge small" style={{ marginLeft: 6 }}>CHT</span>}
                    </div>
                    <div className="muted small">{a.description}</div>
                    <div className="muted small">e.g. {a.example}</div>
                  </div>
                </label>
              </li>
            ))}
            {visible.length === 0 && (
              <li className="muted">No appearances match. Try toggling "show all" or clearing the filter.</li>
            )}
          </ul>
        </div>
        <div className="modal-footer">
          <button onClick={props.onCancel}>Done</button>
        </div>
      </div>
    </div>
  );
}
