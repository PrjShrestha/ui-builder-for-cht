// Generates the context the CHT app exposes to forms via
// instance('contact-summary'). Fields/cards arrays are static metadata;
// `context` is the dynamic JS object computed from the contact + reports.
//
// Edit via the Contact summary panel in the UI Builder.

module.exports = {
  context: function (contact, allReports) {
    return {};
  },
  fields: [],
  cards: [],
};
