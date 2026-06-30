// Generates the context the CHT app exposes to forms via
// instance('contact-summary'). Fields/cards arrays are static metadata;
// `context` is the dynamic JS object computed from the contact + reports.
//
// `contact`, `reports`, `lineage` are globally available inside this file
// (CHT injects them at evaluation time). Lineage is the ancestor-doc
// chain from the contact's parent up to the root — passing it through
// `filter: 'lineage'` is what makes CHT render the clickable
// "Belongs to" breadcrumb users expect on a contact card.
//
// IMPORTANT: this file MUST end with `module.exports = { context,
// cards, fields };` — not a bare `return`. cht-conf webpacks this
// file with `libraryTarget: 'ContactSummary'`, which bridges
// module.exports onto the global the CHT app reads. A bare `return`
// returns from the entry function but the value is discarded by
// webpack, leaving the app with an empty contact_summary (no fields).

const thisContact = contact;
const thisLineage = lineage;
const allReports = reports;
void allReports;

const context = {
  alive: thisContact && !thisContact.date_of_death,
  muted: thisContact ? thisContact.muted === true : false,
};

const fields = [
  // ─────────────────── person-type cards ───────────────────
  // CHT renders these in declaration order. The lineage trail (Belongs
  // to) is the load-bearing one — it's clickable up to the root.
  { appliesToType: 'person', label: 'patient_id', value: thisContact.patient_id, width: 6 },
  { appliesToType: 'person', label: 'contact.age', value: thisContact.date_of_birth, width: 6, filter: 'age' },
  { appliesToType: 'person', label: 'contact.sex', value: 'contact.sex.' + thisContact.sex, translate: true, width: 6 },
  { appliesToType: 'person', label: 'person.field.phone', value: thisContact.phone, width: 6 },
  { appliesToType: 'person', label: 'contact.notes', value: thisContact.notes, width: 12 },
  { appliesToType: 'person', label: 'contact.parent', value: thisLineage, filter: 'lineage' },

  // ─────────────────── place-type cards ───────────────────
  { appliesToType: '!person', label: 'contact', value: thisContact.contact && thisContact.contact.name, width: 6 },
  { appliesToType: '!person', label: 'contact.phone', value: thisContact.contact && thisContact.contact.phone, width: 6 },
  { appliesToType: '!person', label: 'contact.notes', value: thisContact.notes, width: 12 },
  {
    appliesToType: '!person',
    appliesIf: function () {
      return thisContact.parent && thisLineage[0];
    },
    label: 'contact.parent',
    value: thisLineage,
    filter: 'lineage',
  },
];

// No cards configured yet (cards = report-driven summaries, e.g. an
// active-pregnancy badge). Leave empty until a per-report card is
// designed.
const cards = [];

module.exports = { context: context, cards: cards, fields: fields };
