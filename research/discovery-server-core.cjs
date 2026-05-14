function parseEnvText(text) {
  const env = {};
  for (const rawLine of String(text || '').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const idx = line.indexOf('=');
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    let value = line.slice(idx + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (key) env[key] = value;
  }
  return env;
}

const researchCore = require('./prospect-research-core.js');

function leadMergeKey(lead = {}) {
  return researchCore.leadMergeKey(lead);
}

function mergeLeadLists(existing = [], incoming = []) {
  return researchCore.mergeLeadLists(existing, incoming);
}

function sanitizeKnownLeadKeys(keys = [], limit = 1000) {
  return researchCore.sanitizeIdentityKeys(keys, limit);
}

function normalizeNewLeadTarget(value, fallback = 10) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(1, Math.min(100, Math.round(n)));
}

module.exports = {
  leadMergeKey,
  mergeLeadLists,
  normalizeNewLeadTarget,
  parseEnvText,
  sanitizeKnownLeadKeys,
};
