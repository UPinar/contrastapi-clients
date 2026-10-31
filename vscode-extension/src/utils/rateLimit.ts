import type { RateLimitInfo } from "../mcp/client";

const MAX_RESET_SECONDS = 7200;

/** CreditLabel is the status bar item's text and tooltip. */
export interface CreditLabel {
  text: string;
  tooltip: string;
}

/**
 * creditLabel returns the status bar text for a credit state.
 * Before the first server answer there is no state, so the text shows no number.
 * A guessed number would be wrong for a key, whose limit differs from the anonymous one.
 */
export function creditLabel(remaining: number | undefined, limit: number | undefined): CreditLabel {
  if (remaining === undefined || limit === undefined) {
    return {
      text: "$(shield) ContrastAPI",
      tooltip: "Credits show after the first call. Click to set an API key.",
    };
  }
  return {
    text: `$(shield) ContrastAPI: ${remaining}/${limit}`,
    tooltip: `${remaining} credits remaining. Click to set an API key.`,
  };
}

/**
 * Tracks the credits left for the status bar.
 * It holds no numbers until the first server answer.
 * It refills the counter itself at the reset time, so the bar stays right between calls.
 */
export class RateTracker {
  private remaining: number | undefined;
  private limit: number | undefined;
  private resetTimer: ReturnType<typeof setTimeout> | null = null;
  private onChange?: () => void;

  setOnChange(callback: () => void): void {
    this.onChange = callback;
  }

  /**
   * Stores the server's credit state and schedules the refill.
   * The server sends the refill time as Unix seconds, so the wait is resetAt minus nowMs.
   * nowMs is a parameter, so tests can fix the clock.
   * The wait is capped at MAX_RESET_SECONDS, so a wrong header cannot freeze the counter for days.
   */
  updateFromServer(info: RateLimitInfo, nowMs: number): void {
    this.limit = Math.max(1, Math.min(info.limit, 10000));
    this.remaining = Math.max(0, Math.min(info.remaining, this.limit));

    if (this.resetTimer) {
      clearTimeout(this.resetTimer);
      this.resetTimer = null;
    }
    const waitMs = info.resetAt * 1000 - nowMs;
    if (waitMs > 0) {
      const clamped = Math.min(waitMs, MAX_RESET_SECONDS * 1000);
      this.resetTimer = setTimeout(() => {
        this.remaining = this.limit;
        this.onChange?.();
      }, clamped);
    }
  }

  /** Returns the credits left, or undefined before the first server answer. */
  getRemaining(): number | undefined {
    return this.remaining;
  }

  /** Returns the credit limit, or undefined before the first server answer. */
  getLimit(): number | undefined {
    return this.limit;
  }

  dispose(): void {
    if (this.resetTimer) {
      clearTimeout(this.resetTimer);
      this.resetTimer = null;
    }
  }
}
