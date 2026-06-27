// Minimal contact-summary helpers for the mini-config Playwright fixture.
// Each helper is a small, deterministic predicate; together they exercise
// the helper-builder editor (the spec opens "Helpers (extras.js)" and
// expects at least one card to render).

/** Predicate — true when the contact has no `date_of_death` field set. */
function isAlive(contact) {
  return !contact?.date_of_death;
}

/** Predicate — true when the report array contains a recent (last 30 days)
 *  entry. Used to gate visit forms. */
function hasRecentVisit(reports) {
  if (!Array.isArray(reports) || reports.length === 0) return false;
  const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
  return reports.some((r) => r.reported_date && r.reported_date >= cutoff);
}

/** Predicate — true when the contact is a person of reproductive age. */
function isReproductiveAge(contact) {
  if (!contact?.date_of_birth) return false;
  const dob = new Date(contact.date_of_birth);
  const years = (Date.now() - dob.getTime()) / (365.25 * 24 * 60 * 60 * 1000);
  return years >= 15 && years <= 49;
}

module.exports = {
  isAlive,
  hasRecentVisit,
  isReproductiveAge,
};
