const { kv } = require('@vercel/kv');

// Thin wrapper so the rest of the app doesn't import @vercel/kv directly.
// If KV env vars aren't set (e.g. local testing without a provisioned store),
// this fails loudly rather than silently losing data.
async function getJSON(key) {
  const val = await kv.get(key);
  return val ?? null;
}

async function setJSON(key, value) {
  await kv.set(key, value);
}

module.exports = { getJSON, setJSON };
