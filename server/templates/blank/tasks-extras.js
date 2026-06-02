// Helper functions shared across task definitions.
// Add functions here and require() them in tasks.js.

function isAlive(contact) {
  return !contact.date_of_death;
}

function isMuted(contact) {
  return Boolean(contact.muted);
}

module.exports = { isAlive, isMuted };
