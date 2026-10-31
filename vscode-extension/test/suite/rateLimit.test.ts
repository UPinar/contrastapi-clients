import * as assert from "assert";
import { RateTracker, creditLabel } from "../../src/utils/rateLimit";

interface FakeTimer {
  delay: number;
  fn: () => void;
  cleared: boolean;
}

const timers: FakeTimer[] = [];
const realSetTimeout = globalThis.setTimeout;
const realClearTimeout = globalThis.clearTimeout;

globalThis.setTimeout = ((fn: () => void, delay?: number) => {
  const timer: FakeTimer = { delay: delay ?? 0, fn, cleared: false };
  timers.push(timer);
  return timer;
}) as unknown as typeof setTimeout;
globalThis.clearTimeout = ((timer: FakeTimer | undefined) => {
  if (timer) {
    timer.cleared = true;
  }
}) as unknown as typeof clearTimeout;

const RESET_AT = 1767225600;

function nowBefore(seconds: number): number {
  return (RESET_AT - seconds) * 1000;
}

function test(name: string, fn: () => void): void {
  timers.length = 0;
  try {
    fn();
    console.log(`  ✓ ${name}`);
  } catch (e) {
    console.error(`  ✗ ${name}`);
    globalThis.setTimeout = realSetTimeout;
    globalThis.clearTimeout = realClearTimeout;
    throw e;
  }
}

console.log("rateLimit.test.ts");

test("holds no credit numbers before the first server answer", () => {
  const tracker = new RateTracker();
  assert.strictEqual(tracker.getRemaining(), undefined);
  assert.strictEqual(tracker.getLimit(), undefined);
});

test("creditLabel shows no number before the first server answer", () => {
  const label = creditLabel(undefined, undefined);
  assert.strictEqual(label.text, "$(shield) ContrastAPI");
  assert.ok(!/\d/.test(label.text), label.text);
  assert.ok(!/\d/.test(label.tooltip), label.tooltip);
});

test("creditLabel shows the server's numbers after an answer", () => {
  const tracker = new RateTracker();
  tracker.updateFromServer({ limit: 500, remaining: 487, resetAt: RESET_AT }, nowBefore(1800));
  const label = creditLabel(tracker.getRemaining(), tracker.getLimit());
  assert.strictEqual(label.text, "$(shield) ContrastAPI: 487/500");
  assert.strictEqual(label.tooltip, "487 credits remaining. Click to set an API key.");
});

test("updates from server values", () => {
  const tracker = new RateTracker();
  tracker.updateFromServer({ limit: 100, remaining: 73, resetAt: RESET_AT }, nowBefore(1800));
  assert.strictEqual(tracker.getRemaining(), 73);
  assert.strictEqual(tracker.getLimit(), 100);
});

test("updates with pro limit", () => {
  const tracker = new RateTracker();
  tracker.updateFromServer({ limit: 1000, remaining: 950, resetAt: RESET_AT }, nowBefore(3200));
  assert.strictEqual(tracker.getRemaining(), 950);
  assert.strictEqual(tracker.getLimit(), 1000);
});

test("updates to zero remaining", () => {
  const tracker = new RateTracker();
  tracker.updateFromServer({ limit: 100, remaining: 0, resetAt: RESET_AT }, nowBefore(600));
  assert.strictEqual(tracker.getRemaining(), 0);
});

test("successive updates replace previous values and the previous timer", () => {
  const tracker = new RateTracker();
  tracker.updateFromServer({ limit: 100, remaining: 90, resetAt: RESET_AT }, nowBefore(3000));
  tracker.updateFromServer({ limit: 100, remaining: 42, resetAt: RESET_AT }, nowBefore(1500));
  assert.strictEqual(tracker.getRemaining(), 42);
  assert.strictEqual(timers.length, 2);
  assert.strictEqual(timers[0].cleared, true);
  assert.strictEqual(timers[1].cleared, false);
});

test("reset wait is resetAt minus now (1800 s → 1 800 000 ms)", () => {
  const tracker = new RateTracker();
  tracker.updateFromServer({ limit: 50, remaining: 7, resetAt: RESET_AT }, nowBefore(1800));
  assert.strictEqual(timers.length, 1);
  assert.strictEqual(timers[0].delay, 1_800_000);
});

test("reset wait keeps sub-second precision of now", () => {
  const tracker = new RateTracker();
  tracker.updateFromServer({ limit: 50, remaining: 7, resetAt: RESET_AT }, nowBefore(1800) + 250);
  assert.strictEqual(timers[0].delay, 1_799_750);
});

test("reset wait is clamped to 7200 s", () => {
  const tracker = new RateTracker();
  tracker.updateFromServer({ limit: 50, remaining: 7, resetAt: RESET_AT }, nowBefore(7201));
  assert.strictEqual(timers[0].delay, 7_200_000);
});

test("resetAt now or in the past → no timer", () => {
  const tracker = new RateTracker();
  tracker.updateFromServer({ limit: 50, remaining: 7, resetAt: RESET_AT }, nowBefore(0));
  tracker.updateFromServer({ limit: 50, remaining: 7, resetAt: RESET_AT }, nowBefore(-60));
  assert.strictEqual(timers.length, 0);
});

test("when the timer fires, remaining goes back to the limit and onChange runs", () => {
  const tracker = new RateTracker();
  let changes = 0;
  tracker.setOnChange(() => changes++);
  tracker.updateFromServer({ limit: 50, remaining: 7, resetAt: RESET_AT }, nowBefore(60));
  timers[0].fn();
  assert.strictEqual(tracker.getRemaining(), 50);
  assert.strictEqual(changes, 1);
});

test("dispose clears the pending timer", () => {
  const tracker = new RateTracker();
  tracker.updateFromServer({ limit: 50, remaining: 7, resetAt: RESET_AT }, nowBefore(60));
  tracker.dispose();
  assert.strictEqual(timers[0].cleared, true);
});

globalThis.setTimeout = realSetTimeout;
globalThis.clearTimeout = realClearTimeout;
console.log("\nAll rate limit tests passed.");
