// Runs `fn` over `items` with at most `limit` in flight at once.
// Plain Promise.all over ~300+ episodes (8 shows x ~45 episodes each) is what
// tripped Simplecast's account-level rate limit during testing — this keeps
// bursts bounded instead of relying solely on retry/backoff to absorb it.
async function mapWithConcurrency(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;

  async function worker() {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i], i);
    }
  }

  const workers = Array.from({ length: Math.min(limit, items.length) }, worker);
  await Promise.all(workers);
  return results;
}

module.exports = { mapWithConcurrency };
