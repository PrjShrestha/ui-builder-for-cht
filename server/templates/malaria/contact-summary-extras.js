// Helpers used by contact-summary.templated.js. Kept pure and small so the
// summary expression stays readable.

function isAlive(c) {
  return c && !c.date_of_death;
}

function isMuted(c) {
  return !!(c && c.muted);
}

function getField(report, path) {
  if (!report || !report.fields || !path) return undefined;
  return String(path)
    .split('.')
    .reduce(function (o, k) {
      return o ? o[k] : undefined;
    }, report.fields);
}

function addDays(date, n) {
  const d = new Date(date);
  d.setDate(d.getDate() + n);
  return d;
}

function daysSince(ts) {
  return Math.floor((Date.now() - new Date(ts).getTime()) / 86400000);
}

function latestReport(reports, form) {
  return (reports || [])
    .filter(function (r) {
      return r.form === form;
    })
    .sort(function (a, b) {
      return b.reported_date - a.reported_date;
    })[0];
}

module.exports = { isAlive, isMuted, getField, addDays, daysSince, latestReport };
