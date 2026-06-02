// Malaria surveillance tasks. The follow-up task fires 3 days after a
// screening report with result === 'positive', and resolves when the
// CHW submits a malaria_followup report within the event window.
const extras = require('./contact-summary-extras');
const taskExtras = require('./tasks-extras');
const { isAlive, isMuted, addDays, getField } = extras;
const { isFormSubmittedInWindow } = taskExtras;

module.exports = [
  {
    name: 'malaria.followup',
    icon: 'icon-fever',
    title: 'task.malaria.followup.title',
    appliesTo: 'reports',
    appliesToType: ['malaria_screening'],
    appliesIf: function (contact, report) {
      if (!isAlive(contact) || isMuted(contact)) {
        return false;
      }
      return getField(report, 'result') === 'positive';
    },
    resolvedIf: function (contact, report, event, dueDate) {
      const start = addDays(dueDate, -event.start).getTime();
      const end = addDays(dueDate, event.end).getTime();
      return isFormSubmittedInWindow(contact.reports, 'malaria_followup', start, end, report._id);
    },
    events: [
      {
        id: 'malaria-followup-d3',
        start: 1,
        end: 4,
        dueDate: function (event, contact, report) {
          return addDays(new Date(report.reported_date), 3);
        },
      },
    ],
    actions: [
      {
        type: 'report',
        form: 'malaria_followup',
        modifyContent: function (content, contact, report) {
          content.source_screening_id = report._id;
        },
      },
    ],
  },
];
