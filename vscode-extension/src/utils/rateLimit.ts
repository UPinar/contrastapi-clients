const DEFAULT_LIMIT = 30;
const MAX_RESET_SECONDS = 7200;

export class RateTracker {
  private remaining = DEFAULT_LIMIT;
  private limit = DEFAULT_LIMIT;
  private resetTimer: ReturnType<typeof setTimeout> | null = null;
  private onChange?: () => void;

  setOnChange(callback: () => void): void {
    this.onChange = callback;
  }

  updateFromServer(remaining: number, limit: number, resetSeconds: number): void {
    this.limit = Math.max(1, Math.min(limit, 10000));
    this.remaining = Math.max(0, Math.min(remaining, this.limit));

    if (this.resetTimer) {
      clearTimeout(this.resetTimer);
      this.resetTimer = null;
    }
    if (resetSeconds > 0) {
      const clamped = Math.min(resetSeconds, MAX_RESET_SECONDS);
      this.resetTimer = setTimeout(() => {
        this.remaining = this.limit;
        this.onChange?.();
      }, clamped * 1000);
    }
  }

  getRemaining(): number {
    return this.remaining;
  }

  getLimit(): number {
    return this.limit;
  }

  dispose(): void {
    if (this.resetTimer) {
      clearTimeout(this.resetTimer);
      this.resetTimer = null;
    }
  }
}
