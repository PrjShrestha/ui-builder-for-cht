/**
 * XLSForm parser.
 *
 * Reads an xlsx file into the typed XLSForm representation. The cardinal
 * rule: anything we don't understand goes into `extras` (per row) or
 * `extraSheets` (per sheet) so we can serialize it back unchanged.
 */
import ExcelJS from 'exceljs';
import type {
  ChoiceRow,
  ChoicesHeaderInfo,
  FormSettings,
  LocaleMap,
  RawSheet,
  SurveyHeaderInfo,
  SurveyRow,
  XLSForm,
} from './types.js';

/** Match `label`, `label::xx`, `label:xx` (single-colon variant seen in some XLSForms). */
const LABEL_HEADER_RE = /^label(?:::|:)?([a-z]{2,3}(?:[-_][A-Za-z0-9]+)?)?$/i;

/** Parse a buffer (the contents of an .xlsx file) into an XLSForm. */
export async function parseXlsForm(buffer: ArrayBuffer | Buffer): Promise<XLSForm> {
  const wb = new ExcelJS.Workbook();
  // exceljs's Buffer typing is brittle across Node versions; cast through any.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await wb.xlsx.load(buffer as any);

  const surveySheet = findSheet(wb, 'survey');
  const choicesSheet = findSheet(wb, 'choices');
  const settingsSheet = findSheet(wb, 'settings');

  const survey = surveySheet ? parseSurveySheet(surveySheet) : emptySurveyResult();
  const choices = choicesSheet ? parseChoicesSheet(choicesSheet) : emptyChoicesResult();
  const settings = settingsSheet ? parseSettingsSheet(settingsSheet) : emptySettings();

  const knownSheetNames = new Set(['survey', 'choices', 'settings']);
  const extraSheets: RawSheet[] = [];
  wb.eachSheet((ws) => {
    if (!knownSheetNames.has(ws.name.toLowerCase())) {
      extraSheets.push(readRawSheet(ws));
    }
  });

  const locales = collectLocales(survey.headers.labelLocales, choices.headers.labelLocales);

  return {
    locales,
    surveyHeaders: survey.headers,
    choicesHeaders: choices.headers,
    survey: survey.rows,
    choices: choices.rows,
    settings,
    extraSheets,
  };
}

function findSheet(wb: ExcelJS.Workbook, name: string): ExcelJS.Worksheet | undefined {
  let found: ExcelJS.Worksheet | undefined;
  wb.eachSheet((ws) => {
    if (ws.name.toLowerCase() === name.toLowerCase()) found = ws;
  });
  return found;
}

/* ------------------------- survey sheet ------------------------- */

function parseSurveySheet(ws: ExcelJS.Worksheet): {
  headers: SurveyHeaderInfo;
  rows: SurveyRow[];
} {
  const headers = readHeaderRow(ws);
  const labelLocales: string[] = [];
  for (const h of headers) {
    const loc = labelLocale(h);
    if (loc !== null && !labelLocales.includes(loc)) labelLocales.push(loc);
  }

  const rows: SurveyRow[] = [];
  let rowCounter = 0;
  ws.eachRow({ includeEmpty: false }, (excelRow, rowNumber) => {
    if (rowNumber === 1) return; // skip header
    const cells = readRow(excelRow, headers.length);
    if (cells.every((c) => c === '' || c === null)) return;

    const row: SurveyRow = {
      rowId: `r_${++rowCounter}`,
      type: '',
      name: '',
      labels: {},
      extras: {},
    };

    for (let i = 0; i < headers.length; i++) {
      const h = headers[i];
      const v = cells[i] ?? '';
      if (!h) continue;
      const hk = h.trim();
      const hkl = hk.toLowerCase();
      const loc = labelLocale(hk);
      if (loc !== null) {
        if (v) row.labels[loc] = v;
        continue;
      }
      if (hkl === 'type') {
        row.type = v;
        continue;
      }
      if (hkl === 'name') {
        row.name = v;
        continue;
      }
      if (hkl === 'required') {
        if (v) row.required = v;
        continue;
      }
      if (v !== '') row.extras[hk] = v;
    }
    rows.push(row);
  });

  return {
    headers: {
      ordered: headers.map((h) => (h ?? '').toString()),
      labelLocales,
    },
    rows,
  };
}

/* ------------------------- choices sheet ------------------------ */

function parseChoicesSheet(ws: ExcelJS.Worksheet): {
  headers: ChoicesHeaderInfo;
  rows: ChoiceRow[];
} {
  const headers = readHeaderRow(ws);
  const labelLocales: string[] = [];
  for (const h of headers) {
    const loc = labelLocale(h);
    if (loc !== null && !labelLocales.includes(loc)) labelLocales.push(loc);
  }

  const rows: ChoiceRow[] = [];
  let rowCounter = 0;
  ws.eachRow({ includeEmpty: false }, (excelRow, rowNumber) => {
    if (rowNumber === 1) return;
    const cells = readRow(excelRow, headers.length);
    if (cells.every((c) => c === '' || c === null)) return;

    const row: ChoiceRow = {
      rowId: `c_${++rowCounter}`,
      list_name: '',
      name: '',
      labels: {},
      extras: {},
    };

    for (let i = 0; i < headers.length; i++) {
      const h = headers[i];
      const v = cells[i] ?? '';
      if (!h) continue;
      const hk = h.trim();
      const hkl = hk.toLowerCase();
      const loc = labelLocale(hk);
      if (loc !== null) {
        if (v) row.labels[loc] = v;
        continue;
      }
      if (hkl === 'list_name') {
        row.list_name = v;
        continue;
      }
      if (hkl === 'name') {
        row.name = v;
        continue;
      }
      if (v !== '') row.extras[hk] = v;
    }

    if (
      !row.list_name &&
      !row.name &&
      Object.keys(row.labels).length === 0 &&
      Object.keys(row.extras).length === 0
    ) {
      return;
    }
    rows.push(row);
  });

  return {
    headers: {
      ordered: headers.map((h) => (h ?? '').toString()),
      labelLocales,
    },
    rows,
  };
}

/* ------------------------ settings sheet ------------------------ */

function parseSettingsSheet(ws: ExcelJS.Worksheet): FormSettings {
  const headers = readHeaderRow(ws);
  const settings: FormSettings = { extras: {} };
  ws.eachRow({ includeEmpty: false }, (excelRow, rowNumber) => {
    if (rowNumber !== 2) return;
    const cells = readRow(excelRow, headers.length);
    for (let i = 0; i < headers.length; i++) {
      const h = headers[i];
      const v = cells[i] ?? '';
      if (!h || v === '') continue;
      const hk = h.trim();
      const hkl = hk.toLowerCase();
      if (hkl === 'form_title') settings.form_title = v;
      else if (hkl === 'form_id') settings.form_id = v;
      else if (hkl === 'version') settings.version = v;
      else if (hkl === 'default_language') settings.default_language = v;
      else settings.extras[hk] = v;
    }
  });
  return settings;
}

/* --------------------------- helpers ---------------------------- */

function readHeaderRow(ws: ExcelJS.Worksheet): (string | null)[] {
  const headerRow = ws.getRow(1);
  const headers: (string | null)[] = [];
  const maxCol = Math.max(ws.actualColumnCount ?? 0, ws.columnCount ?? 0);
  for (let c = 1; c <= maxCol; c++) {
    const v = headerRow.getCell(c).value;
    if (v === null || v === undefined || v === '') {
      headers.push(null);
    } else {
      headers.push(String(v));
    }
  }
  while (headers.length > 0 && headers[headers.length - 1] === null) headers.pop();
  return headers;
}

function readRow(excelRow: ExcelJS.Row, len: number): string[] {
  const cells: string[] = [];
  for (let c = 1; c <= len; c++) {
    cells.push(cellToString(excelRow.getCell(c).value));
  }
  return cells;
}

function cellToString(v: ExcelJS.CellValue | undefined): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  if (v instanceof Date) return v.toISOString();
  if (typeof v === 'object') {
    if ('richText' in v && Array.isArray((v as { richText: { text: string }[] }).richText)) {
      return (v as { richText: { text: string }[] }).richText.map((r) => r.text).join('');
    }
    if ('text' in v && typeof (v as { text: string }).text === 'string') {
      return (v as { text: string }).text;
    }
    if ('result' in v) {
      const r = (v as { result: unknown }).result;
      return r === null || r === undefined ? '' : String(r);
    }
    if ('formula' in v) {
      const f = v as { formula?: string; result?: unknown };
      if (f.result !== undefined) return String(f.result);
      return f.formula ?? '';
    }
  }
  return String(v);
}

function labelLocale(header: string | null): string | null {
  if (header === null) return null;
  const m = LABEL_HEADER_RE.exec(header.trim());
  if (!m) return null;
  return (m[1] ?? '_').toLowerCase();
}

function readRawSheet(ws: ExcelJS.Worksheet): RawSheet {
  const headers = readHeaderRow(ws);
  const rows: (string | null)[][] = [];
  ws.eachRow({ includeEmpty: true }, (excelRow) => {
    const cells: (string | null)[] = [];
    for (let c = 1; c <= Math.max(headers.length, 1); c++) {
      const v = excelRow.getCell(c).value;
      cells.push(v === null || v === undefined ? null : cellToString(v));
    }
    rows.push(cells);
  });
  return { name: ws.name, headers, rows };
}

function collectLocales(...lists: string[][]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const list of lists) {
    for (const l of list) {
      if (!seen.has(l) && l !== '_') {
        seen.add(l);
        out.push(l);
      }
    }
  }
  return out;
}

/* --------------------------- shells ---------------------------- */

function emptySurveyResult() {
  return {
    headers: { ordered: [] as string[], labelLocales: [] as string[] },
    rows: [] as SurveyRow[],
  };
}

function emptyChoicesResult() {
  return {
    headers: { ordered: [] as string[], labelLocales: [] as string[] },
    rows: [] as ChoiceRow[],
  };
}

function emptySettings(): FormSettings {
  return { extras: {} };
}

export type { LocaleMap };
