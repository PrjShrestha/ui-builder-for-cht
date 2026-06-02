// Computes the per-contact summary object exposed to forms and tasks.
// `context.show_malaria_form` gates whether the screening form appears on
// the patient profile.
const extras = require('./contact-summary-extras');
const { isAlive, getField, daysSince, latestReport } = extras;

const thisContact = contact;
const allReports = reports || [];

const latestScreening = latestReport(allReports, 'malaria_screening');
const latestFollowup = latestReport(allReports, 'malaria_followup');

const hasResolvedFollowup =
  latestFollowup &&
  getField(latestFollowup, 'still_symptomatic') === 'no' &&
  daysSince(latestFollowup.reported_date) < 30;

const showMalariaForm =
  thisContact.contact_type === 'patient' &&
  isAlive(thisContact) &&
  !hasResolvedFollowup;

const fields = [
  { appliesToType: 'patient', label: 'contact.age', value: thisContact.date_of_birth, width: 4, filter: 'age' },
  {
    appliesToType: 'patient',
    appliesIf: function () {
      return latestScreening;
    },
    label: 'malaria.last_screening',
    value: latestScreening && latestScreening.reported_date,
    filter: 'simpleDate',
    width: 6,
  },
  {
    appliesToType: 'patient',
    appliesIf: function () {
      return latestScreening;
    },
    label: 'malaria.last_result',
    value: latestScreening && getField(latestScreening, 'result'),
    translate: true,
    width: 6,
  },
];

const cards = [];
const context = { show_malaria_form: showMalariaForm };

module.exports = { fields, cards, context };
