import { Board, History, Vec3 } from "../Domain/types";
import { TableKit, WitnessView } from "../Scripts/TableKit/TableKit";
import { renderHistory, ActionPose } from "./Reconstruction";
export interface SpatialContext {
  tick: number;
  witnessId: string;
  selectedIds: string[];
  versionIndex: number;
  verdictKey?: string;
}
export interface Placement {
  originCm: readonly [number, number, number];
  scale: number;
  yawRad: number;
}
export interface SpatialPorts {
  wings: readonly [TableKit, TableKit];
  recording: TableKit;
  setWingPlacement(index: number, placement: Placement): void;
  setWingVisible(index: number, visible: boolean): void;
  /** Targets are world-space relative to the wing root, in story cm. Solve actual arm joints. */
  setHandTargets(index: number, targets: readonly ActionPose[]): void;
  setNestEmpty(index: number, empty: boolean): void;
  setCache(index: number, cache: string | undefined): void;
  setLabels(labels: readonly string[]): void;
  setFrameCovered(covered: boolean): void;
  setSecondaryLabelsVisible(visible: boolean): void;
  setReturnHandle(placement: Placement, label: string): void;
  finishTimeDrag(): void;
  stopSound(): void;
  clear(): void;
}
/** Mount once per case. No camera setter and no author/vault input are available. */
export class SpatialStage {
  private context: SpatialContext;
  private pair?: readonly [History, History];
  private playing = false;
  private disposed = false;
  private wide = true;
  private scale: "table" | "room" = "table";
  private table: Placement = {
    originCm: [-21, -25, -65],
    scale: 0.06,
    yawRad: 0,
  };
  private room?: Placement;
  constructor(
    private board: Board,
    context: SpatialContext,
    private ports: SpatialPorts,
    private recordingAt: (witnessId: string, tick: number) => WitnessView,
  ) {
    this.context = JSON.parse(JSON.stringify(context));
  }
  snapshot(): SpatialContext {
    return JSON.parse(JSON.stringify(this.context));
  }
  /** External game clock mode: call instead of play/update. Preserves wing
   * histories and scale while mirroring the authoritative detective snapshot. */
  syncContext(context: SpatialContext): void {
    if (this.disposed || !Number.isFinite(context.tick)) return;
    if (!this.board.witnesses.some((w) => w.id === context.witnessId)) return;
    this.context = JSON.parse(JSON.stringify(context));
    this.context.tick = Math.max(0, Math.min(24, context.tick));
    this.playing = false;
    this.render();
  }
  setVersions(
    pair: readonly [History, History],
    scope: "selected" | "all",
    wide = true,
  ): void {
    this.pair = JSON.parse(JSON.stringify(pair));
    this.wide = wide;
    this.playing = false;
    this.ports.setLabels(
      pair.map(
        (_, i) =>
          "Version " +
          (i + 1) +
          ": " +
          (scope === "all"
            ? "Fits the full recording"
            : "Fits your selected clues"),
      ),
    );
    this.render();
  }
  setVersion(index: number): void {
    if (index !== 0 && index !== 1) return;
    this.context.versionIndex = index;
    this.render();
  }
  seek(tick: number): void {
    if (!Number.isFinite(tick)) return;
    this.context.tick = Math.max(0, Math.min(24, tick));
    this.playing = false;
    this.render();
  }
  play(): void {
    if (this.pair) this.playing = true;
  }
  pause(): void {
    this.playing = false;
  }
  update(seconds: number): void {
    if (
      this.disposed ||
      !this.playing ||
      !Number.isFinite(seconds) ||
      seconds <= 0
    )
      return;
    this.context.tick = Math.min(
      24,
      this.context.tick + Math.min(seconds, 0.25) * 2,
    );
    if (this.context.tick === 24) this.playing = false;
    this.render();
  }
  /** Freeze captured drag before reading final context. Immediate covered relocation
   * avoids models sweeping through the eye; reduced motion has identical stable states.
   * Eye is cm; forward is a unit vector. This never changes the user's camera.
   */
  enterRoom(eye: Vec3, forward: Vec3, readContext: () => SpatialContext): void {
    this.ports.finishTimeDrag();
    this.context = JSON.parse(JSON.stringify(readContext()));
    this.playing = false;
    const witness = this.board.witnesses.find(
      (w) => w.id === this.context.witnessId,
    );
    if (!witness) throw new Error("Choose an available recording");
    const horizontal = Math.hypot(forward.x, forward.z);
    if (horizontal < 0.01) throw new Error("Look toward the case");
    const yaw = Math.atan2(forward.x, forward.z) - witness.yaw;
    const c = Math.cos(yaw),
      s = Math.sin(yaw);
    const wx = witness.position.x * 100,
      wz = witness.position.z * 100;
    this.room = {
      originCm: [
        eye.x - (wx * c + wz * s),
        eye.y - witness.position.y * 100,
        eye.z - (wz * c - wx * s),
      ],
      scale: 1,
      yawRad: yaw,
    };
    this.ports.setFrameCovered(true);
    this.scale = "room";
    this.ports.setSecondaryLabelsVisible(false);
    this.render();
    this.ports.setReturnHandle(
      {
        originCm: [
          eye.x + (forward.x / horizontal) * 70,
          eye.y - 25,
          eye.z + (forward.z / horizontal) * 70,
        ],
        scale: 1,
        yawRad: yaw,
      },
      "Back to table",
    );
    this.ports.setFrameCovered(false);
  }
  backToTable(): SpatialContext {
    this.playing = false;
    this.ports.setFrameCovered(true);
    this.scale = "table";
    this.ports.setSecondaryLabelsVisible(true);
    this.render();
    this.ports.setFrameCovered(false);
    return this.snapshot();
  }
  render(): void {
    if (this.disposed) return;
    const base = this.scale === "room" ? this.room! : this.table;
    for (let index = 0; index < 2; index++) {
      const visible =
        !!this.pair &&
        ((this.wide && this.scale === "table") ||
          index === this.context.versionIndex);
      this.ports.setWingVisible(index, visible);
      if (!visible) continue;
      const offset =
        this.wide && this.scale === "table" ? (index === 0 ? -23 : 23) : 0;
      this.ports.setWingPlacement(index, {
        ...base,
        originCm: [
          base.originCm[0] + offset,
          base.originCm[1],
          base.originCm[2],
        ],
      });
      const view = renderHistory(
        this.board,
        this.pair![index],
        this.context.tick,
      );
      this.ports.wings[index].render("hypothesis", view, this.context.tick, {
        playing: this.playing,
        muted: true,
      });
      this.ports.setHandTargets(index, view.hands);
      this.ports.setNestEmpty(index, view.nestEmpty);
      this.ports.setCache(index, view.cache);
    }
    this.ports.recording.render(
      "witness",
      this.recordingAt(this.context.witnessId, Math.round(this.context.tick)),
      this.context.tick,
      { playing: false, muted: true },
    );
  }
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.playing = false;
    this.pair = undefined;
    this.ports.stopSound();
    this.ports.setWingVisible(0, false);
    this.ports.setWingVisible(1, false);
    this.ports.clear();
  }
}
