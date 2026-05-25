/**
 * XLSForm serializer.
 *
 * Writes an XLSForm back to an .xlsx buffer. Critical invariant: rows are
 * written in the original column order (`surveyHeaders.ordered`,
 * `choicesHeaders.ordered`), and every unknown column is preserved from
 * `row.extras`. Sheets that aren't survey/choices/settings are written
 * verbatim from `extraSheets`.
 */
import ExcelJS from 'exceljs';
import type { ChoiceRow, RawSheet, SurveyRow, XLSForm } from './types.js';

const LABEL_HEADER_RE = /^label(?:::|:)?([a-z]{2,3}(?:[-_][A-Za-z0-9]+)?)?$/i;

/** Serialize a parsed XLSForm back to an xlsx buffer. */
export async function serializeXlsForm(form: XLSForm): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'CHT UI Builder';
  wb.created = new Date();

  writeSurveySheet(wb, form);
  writeChoicesSheet(wb, form);
  writeSettingsSheet(wb, form);
  for (const sheet of form.extraSheets) writeRawSheet(wb, sheet);

  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf);
}

/* ------------------------- survey sheet ------------------------- */

function writeSurveySheet(wb: ExcelJS.Workbook, form: XLSForm): void {
  const ws = wb.addWorksheet('survey');
  const headers = ensureSurveyHeaders(form);
  ws.addRow(headers);

  for (const row of form.survey) {
    const cells = headers.map((h) => valueForSurveyCell(row, h));
    ws.addRow(cells);
  }
}

function ensureSurveyHeaders(form: XLSForm): string[] {
  const headers = [...form.surveyHeaders.ordered];

  // Ensure mandatory columns exist (type, name).
  const lc = (s: string) => s.trim().toLowerCase();
  if (!headers.some((h) => lc(h) === 'type')) headers.unshift('type');
  if (!headers.some((h) => lc(h) === 'name')) {
    const typeIdx = headers.findIndex((h) => lc(h) === 'type');
    headers.splice(typeIdx + 1, 0, 'name');
  }

  // Ensure at least one label column.
  const hasLabel = headers.some((h) => LABEL_HEADER_RE.test(h.trim()));
  if (!hasLabel) headers.push('label::en');

  // Add any locale label columns that exist in row data but not yet in headers.
  const labelLocalesInHeaders = new Set(
    headers.map((h) => labelLocale(h)).filter((l): l is string => l !== null),
  );
  const localesInRows = new Set<string>();
  for (const r of form.survey) for (const l of Object.keys(r.labels)) localesInRows.add(l);
  for (const l of localesInRows) {
    if (!labelLocalesInHeaders.has(l)) headers.push(localeToHeader(l));
  }

  // Add any new extras columns that aren't in headers yet.
  const headerSet = new Set(headers.map((h) => h.trim()));
  for (const r of form.survey) {
    for (const ek of Object.keys(r.extras)) {
      if (!headerSet.has(ek.trim())) {
        headers.push(ek);
        headerSet.add(ek.trim());
      }
    }
  }

  return headers;
}

function valueForSurveyCell(row: SurveyRow, header: string): string {
  const h = header.trim();
  const hl = h.toLowerCase();
  const loc = labelLocale(h);
  if (loc !== null) return row.labels[loc] ?? '';
  if (hl === 'type') return row.type;
  if (hl === 'name') return row.name;
  if (hl === 'required') return row.required ?? '';
  return row.extras[h] ?? '';
}

/* ------------------------- choices sheet ------------------------ */

function writeChoicesSheet(wb: ExcelJS.Workbook, form: XLSForm): void {
  const ws = wb.addWorksheet('choices');
  const headers = ensureChoicesHeaders(form);
  ws.addRow(headers);

  for (const row of form.choices) {
    const cells = headers.map((h) => valueForChoicesCell(row, h));
    ws.addRow(cells);
  }
}

function ensureChoicesHeaders(form: XLSForm): string[] {
  const headers = [...form.choicesHeaders.ordered];
  const lc = (s: string) => s.trim().toLowerCase();
  if (!headers.some((h) => lc(h) === 'list_name')) headers.unshift('list_name');
  if (!headers.some((h) => lc(h) === 'name')) {
    const idx = headers.findIndex((h) => lc(h) === 'list_name');
    headers.splice(idx + 1, 0, 'name');
  }
  const hasLabel = headers.some((h) => LABEL_HEADER_RE.test(h.trim()));
  if (!hasLabel) headers.push('label::en');

  const labelLocalesInHeaders = new Set(
    headers.map((h) => labelLocale(h)).filter((l): l is string => l !== null),
  );
  const localesInRows = new Set<string>();
  for (const r of form.choices) for (const l of Object.keys(r.labels)) localesInRows.add(l);
  for (const l of localesInRows) {
    if (!labelLocalesInHeaders.has(l)) headers.push(localeToHeader(l));
  }

  const headerSet = new Set(headers.map((h) => h.trim()));
  for (const r of form.choices) {
    for (const ek of Object.keys(r.extras)) {
      if (!headerSet.has(ek.trim())) {
        headers.push(ek);
        headerSet.add(ek.trim());
      }
    }
  }

  return headers;
}

function valueForChoicesCell(row: ChoiceRow, header: string): string {
  const h = header.trim();
  const hl = h.toLowerCase();
  const loc = labelLocale(h);
  if (loc !== null) return row.labels[loc] ?? '';
  if (hl === 'list_name') return row.list_name;
  if (hl === 'name') return row.name;
  return row.extras[h] ?? '';
}

/* ------------------------ settings sheet ------------------------ */

function writeSettingsSheet(wb: ExcelJS.Workbook, form: XLSForm): void {
  const ws = wb.addWorksheet('settings');

  // Collect headers from known fields + extras, preserving sensible order.
  const orderedKnown = ['form_title', 'form_id', 'version', 'default_language'];
  const extras = Object.keys(form.settings.extras);
  const headers = [...orderedKnown, ...extras];

  ws.addRow(headers);
  ws.addRow(
    headers.map((h) => {
      const hl = h.toLowerCase();
      if (hl === 'form_title') return form.settings.form_title ?? '';
      if (hl === 'form_id') return form.settings.form_id ?? '';
      if (hl === 'version') return form.settings.version ?? '';
      if (hl === 'default_language') return form.settings.default_language ?? '';
      return form.settings.extras[h] ?? '';
    }),
  );
}

/* --------------------------- raw sheet -------------------------- */

function writeRawSheet(wb: ExcelJS.Workbook, sheet: RawSheet): void {
  const ws = wb.addWorksheet(sheet.name);
  for (const row of sheet.rows) {
    ws.addRow(row.map((c) => (c === null ? '' : c)));
  }
}

/* --------------------------- helpers ---------------------------- */

function labelLocale(header: string): string | null {
  const m = LABEL_HEADER_RE.exec(header.trim());
  if (!m) return null;
  return (m[1] ?? '_').toLowerCase();
}

function localeToHeader(locale: string): string {
  if (locale === '_') return 'label';
  return `label::${locale}`;
}

