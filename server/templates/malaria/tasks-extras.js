// Helpers for tasks.js. Keep small and pure so they stay testable.

function isFormSubmittedInWindow(reports, formId, start, end, sourceId) {
  return (reports || []).some(function (r) {
    if (r.form !== formId) return false;
    if (r.reported_date < start || r.reported_date > end) return false;
    if (!sourceId) return true;
    const f = r.fields || {};
    return f.source_id === sourceId || f.source_screening_id === sourceId;
  });
}

module.exports = { isFormSubmittedInWindow };
