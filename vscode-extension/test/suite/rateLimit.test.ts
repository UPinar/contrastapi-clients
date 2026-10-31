import * as assert from "assert";
import { RateTracker } from "../../src/utils/rateLimit";

function test(name: string, fn: () => void): void {
  try {
    fn();
    console.log(`  ✓ ${name}`);
  } catch (e) {
    console.error(`  ✗ ${name}`);
    throw e;
  }
}

console.log("rateLimit.test.ts");

test("starts with 30 remaining", () => {
  const tracker = new RateTracker();
  assert.strictEqual(tracker.getRemaining(), 30);
  assert.strictEqual(tracker.getLimit(), 30);
});

test("updates from server values", () => {
  const tracker = new RateTracker();
  tracker.updateFromServer(73, 100, 1800);
  assert.strictEqual(tracker.getRemaining(), 73);
  assert.strictEqual(tracker.getLimit(), 100);
});

test("updates with pro limit", () => {
  const tracker = new RateTracker();
  tracker.updateFromServer(950, 1000, 3200);
  assert.strictEqual(tracker.getRemaining(), 950);
  assert.strictEqual(tracker.getLimit(), 1000);
});

test("updates to zero remaining", () => {
  const tracker = new RateTracker();
  tracker.updateFromServer(0, 100, 600);
  assert.strictEqual(tracker.getRemaining(), 0);
});

test("successive updates replace previous values", () => {
  const tracker = new RateTracker();
  tracker.updateFromServer(90, 100, 3000);
  tracker.updateFromServer(42, 100, 1500);
  assert.strictEqual(tracker.getRemaining(), 42);
});

console.log("\nAll rate limit tests passed.");
