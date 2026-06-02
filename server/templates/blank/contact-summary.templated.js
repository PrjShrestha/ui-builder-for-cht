// Generates the context the CHT app exposes to forms via
// instance('contact-summary'). Fields/cards arrays are static metadata;
// `context` is the dynamic JS object computed from the contact + reports.
const extras = require('./contact-summary-extras');

module.exports = {
  context: function (contact, allReports) {
    return {
      muted: Boolean(contact && contact.muted),
      alive: !contact || !contact.date_of_death,
    };
  },
  fields: [],
  cards: [],
};
