// Test helper: a fetch replacement that records each call and answers from a script.
// It is not a test file; `node --test test/` loads it and finds no tests.

// The value the tests pass as apiKey; a plain marker string, so secret scanners stay quiet.
const MARK = ["marker", "zq", "marker"].join("-");
export { MARK as KEY };

/** A fetch that answers call N (1-based) with `answer(n, url, init)` and records every call. */
export function fakeFetch(answer = () => json(200, { ok: true })) {
  const calls = [];
  const fn = async (url, init) => {
    calls.push({ url, init });
    return answer(calls.length, url, init);
  };
  fn.calls = calls;
  return fn;
}

/** A fetch that answers the calls in order with the given response factories. */
export function sequence(...factories) {
  return fakeFetch((n) => {
    const f = factories[Math.min(n, factories.length) - 1];
    return f();
  });
}

export function json(status, body, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

export function text(status, body, headers = {}) {
  return new Response(body, { status, headers });
}

export function apiError(status, code, message, headers = {}) {
  return json(status, { error: { code, message } }, headers);
}

export const RL_HEADERS = Object.freeze({
  "X-RateLimit-Limit": "100",
  "X-RateLimit-Remaining": "97",
  "X-RateLimit-Reset-Machine": "1767225600",
  "X-RateLimit-Reset-Human": "2026-01-01 00:00:00 UTC",
});

/** Let pending promise chains run; setImmediate stays real while mock timers fake setTimeout. */
export async function flush() {
  for (let i = 0; i < 30; i++) await new Promise((r) => setImmediate(r));
}
