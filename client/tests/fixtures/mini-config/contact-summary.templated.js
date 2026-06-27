// Minimal contact-summary for the mini-config Playwright fixture.
// Real CHT projects pull from contact-summary-extras and compute rich
// context flags + fields + cards; the test fixture only needs ENOUGH
// shape for the editor to find a context object + a fields list so the
// helper-builder spec can navigate to "Helpers (extras.js)".
const extras = require('./contact-summary-extras');
const { isAlive, hasRecentVisit } = extras;

const context = {
  alive: isAlive(contact),
  muted: false,
  show_visit_form: hasRecentVisit(reports),
};

const fields = [
  { label: 'Patient ID', value: contact.patient_id, width: 6 },
];

const cards = [];

return { context, fields, cards };
