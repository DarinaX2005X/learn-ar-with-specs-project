import { Board } from "../../Domain/types";
type PublicAlarm = Pick<Board, "caseId" | "rev" | "alarmTick">;
/** The public grammar fixes Take at the alarm in every legal history.
 * This describes the room's cradle, never the security camera's observation. */
export function publicCradlePresent(
  board: Pick<Board, "alarmTick">,
  tick: number,
): boolean {
  return Number.isFinite(tick) && tick >= 0 && tick < board.alarmTick;
}
/** Consumes the session's existing time; it never advances a clock or reads a history. */
export class PublicCradleTransport {
  private previous: { key: string; tick: number } | undefined;
  private heard = new Set<string>();
  private current:
    | { caseId: string; rev: number; tick: number; present: boolean }
    | undefined;
  sample(
    board: PublicAlarm,
    tick: number,
    playing: boolean,
  ): { present: boolean; alarm: boolean } {
    const present = publicCradlePresent(board, tick);
    if (!Number.isFinite(tick)) return { present: false, alarm: false };
    const key = JSON.stringify([board.caseId, board.rev, board.alarmTick]);
    const alarm =
      playing &&
      !this.heard.has(key) &&
      this.previous?.key === key &&
      this.previous.tick < board.alarmTick &&
      tick >= board.alarmTick;
    if (alarm) this.heard.add(key);
    this.previous = { key, tick };
    this.current = { caseId: board.caseId, rev: board.rev, tick, present };
    return { present, alarm };
  }
  read() {
    return this.current ? { ...this.current } : undefined;
  }
  suspend(): void {
    this.previous = undefined;
    this.current = undefined;
  }
  clear(): void {
    this.previous = undefined;
    this.current = undefined;
    this.heard.clear();
  }
}
