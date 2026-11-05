export interface RevealPlayback {
  tick: number;
  playing: boolean;
}
export type RevealAction =
  | { type: "play" | "pause" | "replay" }
  | { type: "seek"; tick: number }
  | { type: "step"; delta: -1 | 1 };

/** One replacement transport, created after the investigation has detached. */
export class RevealTransport {
  private tick: number;
  private playing = false;
  private elapsed = 0;
  private disposed = false;
  constructor(tick: number) {
    this.tick = Math.max(0, Math.min(24, Math.round(tick)));
  }
  snapshot(): RevealPlayback {
    return { tick: this.tick, playing: this.playing };
  }
  presentationTick(): number {
    return Math.min(24, this.tick + (this.playing ? this.elapsed / 0.5 : 0));
  }
  dispatch(action: RevealAction): boolean {
    if (this.disposed) return false;
    switch (action.type) {
      case "play":
        if (this.tick === 24) this.seek(0);
        this.playing = true;
        return true;
      case "pause":
        this.playing = false;
        return true;
      case "replay":
        this.seek(0);
        this.playing = true;
        return true;
      case "seek":
        return this.seek(action.tick);
      case "step":
        return (
          (action.delta === -1 || action.delta === 1) &&
          this.seek(this.tick + action.delta)
        );
      default:
        return false;
    }
  }
  update(seconds: number): boolean {
    if (
      this.disposed ||
      !this.playing ||
      !Number.isFinite(seconds) ||
      seconds <= 0
    )
      return false;
    const before = this.tick;
    this.elapsed += Math.min(0.25, seconds);
    while (this.elapsed >= 0.5 && this.tick < 24) {
      this.elapsed -= 0.5;
      this.tick++;
    }
    if (this.tick === 24) {
      this.playing = false;
      this.elapsed = 0;
    }
    return this.tick !== before;
  }
  private seek(tick: number): boolean {
    if (!Number.isFinite(tick)) return false;
    this.tick = Math.max(0, Math.min(24, Math.round(tick)));
    this.elapsed = 0;
    this.playing = false;
    return true;
  }
  dispose(): void {
    this.playing = false;
    this.elapsed = 0;
    this.disposed = true;
  }
}
