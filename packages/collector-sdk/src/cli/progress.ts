// A status line for `pnpm collect`: step, % bar and a rough time left, kept at the bottom of the
// terminal while log lines scroll above it. Only a reference: time left assumes the rest of a step
// goes as fast as what is done so far.

const WIDTH = 20;

export function bar(fraction: number): string {
  const f = Math.min(1, Math.max(0, fraction));
  const filled = Math.round(f * WIDTH);
  return `[${'█'.repeat(filled)}${'░'.repeat(WIDTH - filled)}] ${String(Math.floor(f * 100)).padStart(3)}%`;
}

export function timeLeft(elapsedMs: number, fraction: number): string {
  if (fraction < 0.03 || elapsedMs < 5_000) return 'estimating…';
  if (fraction >= 1) return 'done';
  const ms = (elapsedMs / fraction) * (1 - fraction);
  const min = Math.round(ms / 60_000);
  return min < 1 ? '<1 min left' : `~${min} min left`;
}

export class Progress {
  private line = '';
  private stepStart = Date.now();
  private step = 0;
  private lastPrinted = -1;
  private readonly tty = Boolean(process.stdout.isTTY);

  constructor(private readonly steps: number) {}

  /** Starts the next step (e.g. "snkrdunk"). */
  next(label: string): void {
    this.step++;
    this.stepStart = Date.now();
    this.lastPrinted = -1;
    this.update(label, 0);
  }

  /** `fraction` of the current step is done; `detail` e.g. "12/23". */
  update(label: string, fraction: number, detail = ''): void {
    const text = [
      bar(fraction),
      `step ${this.step}/${this.steps} ${label}`,
      detail,
      timeLeft(Date.now() - this.stepStart, fraction),
    ]
      .filter(Boolean)
      .join(' · ');
    if (this.tty) {
      this.line = text;
      process.stdout.write(`\r\x1b[2K${text}`);
    } else {
      // Logs to a file (cron): a plain line every 10 %.
      const tenth = Math.floor(fraction * 10);
      if (tenth !== this.lastPrinted) {
        this.lastPrinted = tenth;
        console.log(text);
      }
    }
  }

  /** A log line above the status line. */
  log = (message: string): void => {
    if (!this.tty) return console.log(message);
    process.stdout.write(`\r\x1b[2K${message}\n${this.line}`);
  };

  /** Clears the status line (before the final summary). */
  done(): void {
    if (this.tty && this.line) process.stdout.write('\r\x1b[2K');
    this.line = '';
  }
}
