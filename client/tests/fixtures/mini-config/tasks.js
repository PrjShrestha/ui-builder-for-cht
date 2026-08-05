module.exports = [
  {
    name: 'pregnancy-follow-up',
    icon: 'icon-pregnancy',
    title: 'task.pregnancy_follow_up.title',
    appliesTo: 'reports',
    appliesToType: ['pregnancy'],
    appliesIf: function (contact, report) {
      return true;
    },
    events: [{ id: 'pregnancy-follow-up', days: 7, start: 2, end: 2 }],
    actions: [{ form: 'pregnancy' }],
  },
];
