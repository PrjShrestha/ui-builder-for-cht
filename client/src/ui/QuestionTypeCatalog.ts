/**
 * UI metadata catalog for the question-type tile picker.
 *
 * The valid `xlsformType` strings come from `@cht-ui/shared`'s
 * QUESTION_TYPES / STRUCTURAL_TYPES; this file only adds presentational
 * metadata (label, description, category, icon, default extras for
 * synthesised entries like "rating" or "matrix"). Keep `xlsformType` aligned
 * with shared — don't invent type strings here.
 */

export type TileCategory =
  | 'choice'
  | 'text'
  | 'number'
  | 'datetime'
  | 'media'
  | 'location'
  | 'structural'
  | 'cht'
  | 'advanced';

export interface QuestionTypeTile {
  /** Stable id used for keys and lookups. */
  id: string;
  /** Display label on the tile, e.g. "Select one". */
  label: string;
  /** One-line hint shown under the label. */
  description: string;
  /** Small leading glyph (kept plain text to avoid bundling an icon set). */
  icon: string;
  category: TileCategory;
  /**
   * The exact `type:` cell value to set on the SurveyRow when the user picks
   * this tile. For selects this is just `select_one` — the picker appends a
   * list-name token at commit time.
   */
  xlsformType: string;
  /** Default `extras` entries (e.g. `appearance: likert` for Rating). */
  defaultExtras?: Record<string, string>;
  /** True for tiles that only exist in CHT (db:person, mrdt-verify, etc.). */
  chtOnly?: boolean;
  /** Hide in Simple mode (mirrors isHiddenInSimpleMode logic). */
  hiddenInSimple?: boolean;
  /** True for tiles that need extra setup before commit (selects → list_name). */
  needsListName?: boolean;
  /** True for tiles that insert a paired begin/end row. */
  isStructural?: boolean;
}

export const QUESTION_TYPE_TILES: QuestionTypeTile[] = [
  // ---- Text & basic ----
  {
    id: 'text',
    label: 'Text',
    description: 'Free-text answer (one line by default).',
    icon: 'abc',
    category: 'text',
    xlsformType: 'text',
  },
  {
    id: 'note',
    label: 'Note',
    description: 'Read-only instructions for the user.',
    icon: '¶',
    category: 'text',
    xlsformType: 'note',
  },
  {
    id: 'barcode',
    label: 'Barcode / QR',
    description: 'Scan a barcode or QR code.',
    icon: '▮▮',
    category: 'text',
    xlsformType: 'barcode',
  },
  {
    id: 'acknowledge',
    label: 'Acknowledge',
    description: 'A single checkbox to confirm something.',
    icon: '✓',
    category: 'text',
    xlsformType: 'acknowledge',
  },

  // ---- Choice ----
  {
    id: 'select_one',
    label: 'Select one',
    description: 'Pick one option from a list.',
    icon: '◉',
    category: 'choice',
    xlsformType: 'select_one',
    needsListName: true,
  },
  {
    id: 'select_multiple',
    label: 'Select many',
    description: 'Pick any number of options from a list.',
    icon: '☑',
    category: 'choice',
    xlsformType: 'select_multiple',
    needsListName: true,
  },
  {
    id: 'rating',
    label: 'Rating',
    description: 'Likert-style scale (1 to N stars/levels).',
    icon: '★',
    category: 'choice',
    xlsformType: 'select_one',
    defaultExtras: { appearance: 'likert' },
    needsListName: true,
  },
  {
    id: 'rank',
    label: 'Ranking',
    description: 'Rank items in priority order.',
    icon: '1▾',
    category: 'choice',
    xlsformType: 'rank',
    needsListName: true,
  },

  // ---- Number ----
  {
    id: 'integer',
    label: 'Number',
    description: 'Whole number.',
    icon: '123',
    category: 'number',
    xlsformType: 'integer',
  },
  {
    id: 'decimal',
    label: 'Decimal',
    description: 'Number with decimal places.',
    icon: '1.0',
    category: 'number',
    xlsformType: 'decimal',
  },
  {
    id: 'range',
    label: 'Range / slider',
    description: 'Number from a slider.',
    icon: '━━●━',
    category: 'number',
    xlsformType: 'range',
    defaultExtras: { appearance: 'slider' },
  },

  // ---- Date & time ----
  {
    id: 'date',
    label: 'Date',
    description: 'Calendar date.',
    icon: '📅',
    category: 'datetime',
    xlsformType: 'date',
  },
  {
    id: 'time',
    label: 'Time',
    description: 'Time of day.',
    icon: '⏱',
    category: 'datetime',
    xlsformType: 'time',
  },
  {
    id: 'dateTime',
    label: 'Date & time',
    description: 'Date and time together.',
    icon: '📅⏱',
    category: 'datetime',
    xlsformType: 'dateTime',
  },
  {
    id: 'bikram_sambat_date',
    label: 'Bikram Sambat date',
    description: 'Nepali calendar date picker.',
    icon: '📅',
    category: 'datetime',
    xlsformType: 'date',
    defaultExtras: { appearance: 'bikram-sambat-datepicker' },
    chtOnly: true,
  },

  // ---- Media ----
  {
    id: 'image',
    label: 'Photo',
    description: 'Capture or upload an image.',
    icon: '📷',
    category: 'media',
    xlsformType: 'image',
  },
  {
    id: 'signature',
    label: 'Signature',
    description: 'Draw a signature.',
    icon: '✍',
    category: 'media',
    xlsformType: 'image',
    defaultExtras: { appearance: 'signature' },
  },
  {
    id: 'audio',
    label: 'Audio',
    description: 'Record or upload audio.',
    icon: '🎤',
    category: 'media',
    xlsformType: 'audio',
  },
  {
    id: 'video',
    label: 'Video',
    description: 'Record or upload video.',
    icon: '🎬',
    category: 'media',
    xlsformType: 'video',
  },

  // ---- Location ----
  {
    id: 'geopoint',
    label: 'GPS point',
    description: 'Capture a single GPS coordinate.',
    icon: '📍',
    category: 'location',
    xlsformType: 'geopoint',
  },
  {
    id: 'geotrace',
    label: 'GPS line',
    description: 'Capture a sequence of GPS points.',
    icon: '〰',
    category: 'location',
    xlsformType: 'geotrace',
  },
  {
    id: 'geoshape',
    label: 'GPS area',
    description: 'Capture a polygon of GPS points.',
    icon: '⬛',
    category: 'location',
    xlsformType: 'geoshape',
  },

  // ---- CHT-specific ----
  {
    id: 'db_person',
    label: 'Pick person',
    description: 'Choose a person from the CHT contact tree.',
    icon: '👤',
    category: 'cht',
    xlsformType: 'db:person',
    defaultExtras: { appearance: 'db-object' },
    chtOnly: true,
  },
  {
    id: 'select_contact',
    label: 'Select contact',
    description: 'Modern contact picker (replaces db-object).',
    icon: '👥',
    category: 'cht',
    xlsformType: 'string',
    defaultExtras: { appearance: 'select-contact type-person' },
    chtOnly: true,
  },
  {
    id: 'countdown_timer',
    label: 'Countdown timer',
    description: 'Pauses the form until N seconds pass.',
    icon: '⏳',
    category: 'cht',
    xlsformType: 'note',
    defaultExtras: { appearance: 'countdown-timer' },
    chtOnly: true,
  },
  {
    id: 'mrdt_verify',
    label: 'RDT capture',
    description: 'Photograph an RDT and auto-read the result.',
    icon: '🧪',
    category: 'cht',
    xlsformType: 'string',
    defaultExtras: { appearance: 'mrdt-verify' },
    chtOnly: true,
  },

  // ---- Advanced / plumbing ----
  {
    id: 'calculate',
    label: 'Calculate',
    description: 'Compute a value from other fields (no input UI).',
    icon: 'ƒ',
    category: 'advanced',
    xlsformType: 'calculate',
    hiddenInSimple: true,
  },
  {
    id: 'hidden',
    label: 'Hidden',
    description: 'Carry a value through the form without showing it.',
    icon: '∅',
    category: 'advanced',
    xlsformType: 'hidden',
    hiddenInSimple: true,
  },

  // ---- Structural ----
  {
    id: 'begin_group',
    label: 'Group',
    description: 'Wrap a set of questions in one screen.',
    icon: '⊞',
    category: 'structural',
    xlsformType: 'begin group',
    isStructural: true,
    hiddenInSimple: true,
  },
  {
    id: 'begin_repeat',
    label: 'Repeat',
    description: 'Ask a block of questions multiple times.',
    icon: '↻',
    category: 'structural',
    xlsformType: 'begin repeat',
    isStructural: true,
    hiddenInSimple: true,
  },
];

export const CATEGORY_ORDER: TileCategory[] = [
  'text',
  'choice',
  'number',
  'datetime',
  'media',
  'location',
  'cht',
  'advanced',
  'structural',
];

export const CATEGORY_LABELS: Record<TileCategory, string> = {
  text: 'Text & basic',
  choice: 'Choice',
  number: 'Number',
  datetime: 'Date & time',
  media: 'Media',
  location: 'Location',
  cht: 'CHT-specific',
  advanced: 'Advanced',
  structural: 'Structure',
};

/** Look up a tile by id. */
export function getTileById(id: string): QuestionTypeTile | undefined {
  return QUESTION_TYPE_TILES.find((t) => t.id === id);
}

/**
 * Best-effort: given an existing `row.type` cell, find the tile that would
 * produce it. Used to pre-highlight the active tile when re-opening the
 * picker for an existing row. Falls back to undefined when the row uses a
 * type the catalog doesn't enumerate (raw fallback stays in the row editor).
 */
export function findTileForRowType(
  rowType: string,
  appearance: string,
): QuestionTypeTile | undefined {
  const t = rowType.trim().toLowerCase();
  const baseType = t.split(/\s+/)[0] ?? t;
  const app = appearance.trim().toLowerCase();
  const matches = QUESTION_TYPE_TILES.filter((tile) => {
    const tileBase = tile.xlsformType.split(/\s+/)[0]?.toLowerCase();
    return tileBase === baseType;
  });
  if (matches.length === 0) return undefined;
  // Prefer one whose defaultExtras.appearance matches the row's appearance.
  const withApp = matches.find(
    (m) => m.defaultExtras?.appearance && app.split(/\s+/).includes(m.defaultExtras.appearance),
  );
  if (withApp) return withApp;
  // Otherwise: the first plain entry (no defaultExtras.appearance).
  return matches.find((m) => !m.defaultExtras?.appearance) ?? matches[0];
}
