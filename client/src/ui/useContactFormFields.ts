/**
 * Load every contact-category form in the current project once and return a
 * pick-list of field names appropriate for `contact.X` comparisons.
 *
 * Plumbing rows are filtered out — `calculate`, `hidden`, `note`, media,
 * geopoint, barcode types and any name beginning with `_` or matching the
 * well-known XLSForm meta field names. Otherwise a form author would see
 * `_id`, `source`, `parent`, `__start` in the dropdown and have no idea
 * which one is "patient name".
 */
import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { useApp } from '../state/store.js';
import type { ContactFormFields } from './FieldPicker.js';

const INPUT_TYPES = new Set([
  'text',
  'string',
  'integer',
  'decimal',
  'date',
  'time',
  'datetime',
  'select_one',
  'select_multiple',
]);

const META_FIELDS = new Set([
  'source',
  'source_id',
  'parent',
  'meta',
  'start',
  'end',
  'today',
  'deviceid',
  'instanceid',
  'phone',
  'simserial',
  'subscriberid',
]);

export function useContactFormFields(): ContactFormFields[] {
  const formsList = useApp((s) => s.forms);
  const [contactForms, setContactForms] = useState<ContactFormFields[]>([]);

  useEffect(() => {
    const entries = formsList.filter((f) => f.category === 'contact');
    if (entries.length === 0) {
      setContactForms([]);
      return;
    }
    let alive = true;
    Promise.all(
      entries.map((f) =>
        api.getForm(f.id).then((res) => ({
          label: f.id.replace(/^contact:/, ''),
          fields: res.form.survey
            .filter((r) => {
              if (!r.name) return false;
              const lc = r.name.toLowerCase();
              if (lc.startsWith('_')) return false;
              if (META_FIELDS.has(lc)) return false;
              const t = r.type.trim().toLowerCase().replace(/\s+/g, '_');
              if (!INPUT_TYPES.has(t)) return false;
              return true;
            })
            .map((r) => r.name),
        })),
      ),
    )
      .then((out) => {
        if (alive) setContactForms(out.filter((f) => f.fields.length > 0));
      })
      .catch(() => {
        /* non-fatal — picker just won't appear */
      });
    return () => {
      alive = false;
    };
  }, [formsList]);

  return contactForms;
}
