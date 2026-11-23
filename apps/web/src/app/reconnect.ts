export class Reconnect {
  private timer?: ReturnType<typeof setTimeout>;
  private delay = 500;

  schedule(connect: () => void) {
    this.cancel();
    this.timer = setTimeout(connect, this.delay);
    this.delay = Math.min(this.delay * 2, 30_000);
  }

  cancel() { clearTimeout(this.timer); }

  reset() { this.cancel(); this.delay = 500; }
}
