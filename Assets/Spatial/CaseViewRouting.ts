import { clear } from "../Domain/geometry";
import { earnedEventVisibility } from "./EarnedEventVisibility";
import { entryPitch, raisedChoice, roomTools } from "./RoomPresentation";
import {earnedRoomAnchor} from "./EarnedRoomFocus";
import { Board } from "../Domain/types";
import { DetectiveState } from "../Detective/DetectiveSession";
import { Placement } from "./SpatialStage";
export type CaseViewKind = "table" | "room";
export type CaseViewAction =
  | {
      type:
        | "chooseView"
        | "viewFromHere"
        | "standByCase"
        | "backToTable"
        | "closeView";
    }
  | { type: "switchVersion"; generation: number }
  | { type: "setReducedMotion"; enabled: boolean };
export interface CaseViewPresentation {
  kind: CaseViewKind;
  /** World centimetres, story-minimum floor origin, scale .06 or 1. */
  placement: Placement;
  handlePlacement: Placement;
  source: string;
  tick: number;
  comparison: boolean;
  roomSource?: Placement;
  roomClock?: Placement;
  versionIndex?: 0 | 1;
  comparisonScope?: "all" | "selected";
}
export interface CaseViewSnapshot {
  mode: "museum" | "choice" | CaseViewKind;
  available: boolean;
  reducedMotion: boolean;
  generation?: number;
  caseId?: string;
  rev?: number;
  instruction?: string;
  presentation?: CaseViewPresentation;
  choicePlacement?: Placement;
  choiceBasePlacement?: Placement;
}
export interface CaseViewViewer {
  eyeCm: readonly [number, number, number];
  /** Actual tracked viewing direction. This API never has a camera setter. */
  forward: readonly [number, number, number];
  floorYcm?: number;
  horizontalFovRad?: number;
  verticalFovRad?: number;
}
export interface CaseViewPorts {
  readSession(): { board: Board; detective: DetectiveState } | undefined;
  readViewer(): CaseViewViewer;
  finishTimeDrag(): void;
  setPresentation(presentation: CaseViewPresentation | undefined): void;
  setFrameCovered(covered: boolean): void;
  setSecondaryLabelsVisible(visible: boolean): void;
  stopSound(): void;
}
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));
const validViewer = (viewer: CaseViewViewer) =>
  viewer.eyeCm.every(Number.isFinite) &&
  viewer.forward.every(Number.isFinite) &&
  Math.hypot(viewer.forward[0], viewer.forward[2]) > 0.01;
const matchingSession = (session: {
  board: Board;
  detective: DetectiveState;
}) =>
  session.board.caseId === session.detective.caseId &&
  session.board.rev === session.detective.rev &&
  session.board.witnesses.some((w) => w.id === session.detective.source);
/** Production view routing owns only display placement. The investigation and
 * its clock, evidence, verdict and histories stay in their existing session. */
export class CaseViewRouting {
  private state: CaseViewSnapshot = {
    mode: "museum",
    available: false,
    reducedMotion: false,
    generation: 0,
  };
  private pairIdentity = "";
  private anchorViewer?: CaseViewViewer;
  private disposed = false;
  private transitioning = false;
  private coverSeconds = 0;
  constructor(private readonly ports: CaseViewPorts) {
    this.sync();
  }
  snapshot(): CaseViewSnapshot {
    return clone(this.state);
  }
  update(seconds: number): void {
    if (this.disposed || this.transitioning) return;
    this.sync();
    if (this.coverSeconds > 0 && Number.isFinite(seconds) && seconds > 0) {
      this.coverSeconds = Math.max(
        0,
        this.coverSeconds - Math.min(0.25, seconds),
      );
      if (this.coverSeconds === 0) this.ports.setFrameCovered(false);
    }
  }
  sync(): void {
    if (this.disposed || this.transitioning) return;
    const session = this.ports.readSession();
    if (!session || !matchingSession(session)) {
      if (this.state.mode !== "museum" || this.state.available) this.reset();
      this.state.available = false;
      return;
    }
    if (
      this.state.caseId !== session.board.caseId ||
      this.state.rev !== session.board.rev
    ) {
      this.reset();
      this.state.caseId = session.board.caseId;
      this.state.rev = session.board.rev;
    }
    const comparison=session.detective.comparison;
    // Identity excludes the potentially large tape. Histories and scope are
    // already approved by DetectiveSession; evidence changes invalidate held input.
    const pairIdentity = comparison ? JSON.stringify([comparison.field,comparison.scope,comparison.pair,
      comparison.scope==="selected"?session.detective.glass.map(item=>item.id).sort():[]]) : "";
    const pairChanged=pairIdentity !== this.pairIdentity;
    if(pairChanged) {
      this.pairIdentity=pairIdentity;
      this.state.generation=(this.state.generation??0)+1;
      if(this.state.presentation)this.state.presentation.versionIndex=0;
    }
    this.state.available = true;
    if (!comparison && this.state.mode === "room" && this.state.presentation?.comparison) {
      this.present("table", false);
      return;
    }
    if (this.state.presentation) {
      if (this.state.presentation.source !== session.detective.source)
        this.present(this.state.presentation.kind, false);
      else if(pairChanged || this.state.presentation.tick!==session.detective.tick ||
        this.state.presentation.comparison!==!!comparison ||
        this.state.presentation.comparisonScope!==comparison?.scope) {
        this.state.presentation = {
          ...this.state.presentation,
          tick: session.detective.tick,
          comparison: !!session.detective.comparison,
          comparisonScope: session.detective.comparison?.scope,
        };
        this.ports.setPresentation(clone(this.state.presentation));
      }
    }
  }
  dispatch(action: CaseViewAction): boolean {
    if (this.disposed) return false;
    this.sync();
    if(action.type === "switchVersion") {
      const presentation=this.state.presentation;
      if(action.generation!==this.state.generation||this.state.mode!=="room"||!presentation?.comparison||!this.pairIdentity)return false;
      // Presentation selection only. Do not freeze, seek or recreate placement.
      this.state.generation=(this.state.generation??0)+1;
      this.state.presentation={...presentation,versionIndex:presentation.versionIndex===1?0:1};
      this.ports.setPresentation(clone(this.state.presentation));
      return true;
    }
    if (action.type === "setReducedMotion") {
      this.state.reducedMotion = action.enabled;
      return true;
    }
    if (action.type === "closeView") {
      this.reset();
      return true;
    }
    if (!this.state.available) return false;
    if (action.type === "chooseView") {
      this.ports.finishTimeDrag();
      this.state.generation=(this.state.generation??0)+1;
      let viewer: CaseViewViewer;
      try { viewer = this.ports.readViewer(); }
      catch { this.state.instruction = "Look toward the case"; return false; }
      if (!validViewer(viewer)) return false;
      this.state.choicePlacement = undefined;
      this.offerChoice(viewer, "Lift your gaze to the standing pull");
      return true;
    }
    if (action.type === "viewFromHere") return this.present("table", true);
    if (action.type === "standByCase") return this.present("room", true);
    if (action.type === "backToTable") return this.present("table", false);
    return false;
  }
  private choiceFor(viewer: CaseViewViewer): Placement {
    let pitch = (-13 * Math.PI) / 180;
    const session = this.ports.readSession();
    const witness = session?.board.witnesses.find(
      (candidate) => candidate.id === session.detective.source,
    );
    // A narrow display first frames the authorized hands, then a small natural
    // head movement reveals the face. This guides the existing pull, not camera.
    if (
      session?.detective.comparison &&
      witness &&
      matchingSession(session) &&
      viewer.verticalFovRad !== undefined &&
      viewer.verticalFovRad < (35 * Math.PI) / 180
    ) {
      const comparison = session.detective.comparison;
      const height =
        viewer.floorYcm === undefined
          ? 1.6
          : (viewer.eyeCm[1] - viewer.floorYcm) / 100;
      const anchor = earnedRoomAnchor(
        session.board,
        comparison.pair,
        comparison.field,
        session.detective.tick,
        witness.yaw,
        height,
        viewer.horizontalFovRad,
      );
      if (anchor) {
        const angles = comparison.pair.flatMap((history) =>
          earnedEventVisibility(
            session.board,
            history,
            comparison.field,
            session.detective.tick,
          ).targets.map((target) =>
            Math.atan2(
              target.y - anchor.eye.y,
              Math.hypot(target.x - anchor.eye.x, target.z - anchor.eye.z),
            ),
          ),
        );
        pitch = (Math.min(...angles) + Math.max(...angles)) / 2;
      }
    }
    return raisedChoice(viewer, pitch);
  }
  private offerChoice(viewer: CaseViewViewer, instruction: string): void {
    this.state.mode = "choice";
    this.state.choicePlacement ??= this.choiceFor(viewer);
    if (this.state.presentation?.kind === "table") {
      const base = clone(this.state.presentation.handlePlacement);
      base.originCm = [
        base.originCm[0],
        base.originCm[1] - 14,
        base.originCm[2],
      ];
      this.state.choiceBasePlacement ??= base;
    }
    this.state.instruction = instruction;
  }
  private present(kind: CaseViewKind, readViewer: boolean): boolean {
    if (this.transitioning) return false;
    this.transitioning = true;
    try {
      return this.applyPresentation(kind, readViewer);
    } finally {
      this.transitioning = false;
    }
  }
  private applyPresentation(kind: CaseViewKind, readViewer: boolean): boolean {
    this.ports.finishTimeDrag();
    const session = this.ports.readSession();
    if (!session || !matchingSession(session)) return false;
    const witness = session.board.witnesses.find(
      (w) => w.id === session.detective.source,
    );
    if (!witness) return false;
    let viewer: CaseViewViewer;
    try {
      viewer =
        readViewer || !this.anchorViewer
          ? this.ports.readViewer()
          : this.anchorViewer;
    } catch {
      this.state.instruction = "Look toward the case";
      return false;
    }
    if (!validViewer(viewer)) {
      this.state.instruction = "Look toward the case";
      return false;
    }
    if (kind === "room") {
      let reason: string | undefined;
      if (session.board.room.width > 7 || session.board.room.depth > 5) {
        reason = "Use View from here for this room";
      } else {
        const raised = this.state.choicePlacement ?? this.choiceFor(viewer);
        const target = raised.originCm;
        const pullPitch = Math.atan2(target[1] - viewer.eyeCm[1],
          Math.hypot(target[0] - viewer.eyeCm[0], target[2] - viewer.eyeCm[2]));
        if (Math.abs(entryPitch(viewer) - pullPitch) > 8 * Math.PI / 180) {
          reason = "Lift your gaze to the standing pull";
        }
      }
      if (reason) {
        this.offerChoice(viewer, reason);
        return false;
      }
    }
    this.anchorViewer = clone(viewer);
    const horizontal = Math.hypot(viewer.forward[0], viewer.forward[2]);
    const fx = viewer.forward[0] / horizontal,
      fz = viewer.forward[2] / horizontal;
    let earned: ReturnType<typeof earnedRoomAnchor>;
    const comparison = session.detective.comparison;
    if (kind === "room" && comparison) {
      earned = earnedRoomAnchor(
        session.board,
        comparison.pair,
        comparison.field,
        session.detective.tick,
        witness.yaw,
        viewer.floorYcm === undefined ? 1.6 : (viewer.eyeCm[1] - viewer.floorYcm) / 100,
        viewer.horizontalFovRad,
      );
      // If no common body-clear view exists, enter at the physically valid
      // witness XZ/yaw with a local Back handle. FOV alone never disables 1:1.
    }
    const measuredHeight = viewer.floorYcm === undefined ? undefined :
      (viewer.eyeCm[1] - viewer.floorYcm) / 100;
    const storyEye = earned?.eye ?? { ...witness.position,
      // Keep the ordinary witness XZ/yaw and fixed recording optics, while the
      // full-size shell floor stays at its original physical-world height.
      y: kind === "room" && measuredHeight !== undefined ? measuredHeight : witness.position.y,
    };
    if (kind === "room") {
      const onFloor = storyEye.x >= .25 && storyEye.z >= .25 &&
        storyEye.x <= session.board.room.width - .25 && storyEye.z <= session.board.room.depth - .25;
      const inPublicWall = [.5, 1, storyEye.y].some(height => {
        const point = { x: storyEye.x, y: height, z: storyEye.z };
        return !clear(point, point, session.board.room.walls);
      });
      if (!onFloor || inPublicWall) {
        this.offerChoice(viewer, "Use View from here for this room");
        return false;
      }
    }
    const yaw = Math.atan2(fx, fz) - (earned?.yaw ?? witness.yaw);
    const c = Math.cos(yaw),
      s = Math.sin(yaw);
    const rotate = (x: number, z: number): [number, number] => [
      x * c + z * s,
      z * c - x * s,
    ];
    const scale = kind === "table" ? 0.06 : 1;
    const anchor =
      kind === "table"
        ? rotate(
            session.board.room.width * 50 * scale,
            session.board.room.depth * 50 * scale,
          )
        : rotate(storyEye.x * 100, storyEye.z * 100);
    const originCm: [number, number, number] =
      kind === "table"
        ? [
            viewer.eyeCm[0] + fx * 80 - anchor[0],
            viewer.eyeCm[1] - 50,
            viewer.eyeCm[2] + fz * 80 - anchor[1],
          ]
        : [
            viewer.eyeCm[0] - anchor[0],
            viewer.eyeCm[1] - storyEye.y * 100,
            viewer.eyeCm[2] - anchor[1],
          ];
    const tools = kind === "room" ? roomTools(viewer, session.board, { originCm, scale, yawRad: yaw }) : undefined;
    const handleForwardCm = kind === "room" && !tools ? 35 : earned ? 65 : 55;
    const handleRightCm = kind === "room" && !tools ? 0 : earned ? 32 : 0;
    const presentation: CaseViewPresentation = {
      kind,
      placement: { originCm, scale, yawRad: yaw },
      roomSource: tools?.source,
      roomClock: tools?.clock,
      handlePlacement: tools?.handles ?? {
        originCm: [
          viewer.eyeCm[0] + fx * handleForwardCm + fz * handleRightCm,
          viewer.eyeCm[1] - 25,
          viewer.eyeCm[2] + fz * handleForwardCm - fx * handleRightCm,
        ],
        scale: 1,
        yawRad: Math.atan2(fx, fz),
      },
      source: session.detective.source,
      tick: session.detective.tick,
      comparison: !!session.detective.comparison,
      comparisonScope: session.detective.comparison?.scope,
      versionIndex: this.state.presentation?.versionIndex ?? 0,
    };
    // A brief physical frame cover hides instant relocation. No model sweeps
    // through the eyes, including reduced motion; there is no camera flight.
    this.ports.setFrameCovered(true);
    const previousPresentation = this.state.presentation;
    try {
      this.ports.setPresentation(clone(presentation));
      this.ports.setSecondaryLabelsVisible(kind === "table");
      this.state.generation=(this.state.generation??0)+1;
      this.state.mode = kind;
      this.state.presentation = presentation;
      this.state.choicePlacement = undefined;
      this.state.choiceBasePlacement = undefined;
      this.state.instruction = kind === "room" ? "Keep the space around you clear" : undefined;
    } catch (error) {
      this.ports.setPresentation(previousPresentation ? clone(previousPresentation) : undefined);
      this.state.instruction = "View could not open; use View from here";
      return false;
    } finally {
      this.coverSeconds = this.state.reducedMotion ? 0.08 : 0.12;
    }
    return true;
  }
  private reset(): void {
    this.coverSeconds = 0;
    this.state.generation=(this.state.generation??0)+1;
    this.pairIdentity="";
    this.ports.stopSound();
    this.ports.setFrameCovered(true);
    try {
      this.ports.setPresentation(undefined);
      this.ports.setSecondaryLabelsVisible(true);
      this.anchorViewer = undefined;
      this.state.mode = "museum";
      this.state.presentation = undefined;
      this.state.instruction = undefined;
      this.state.choicePlacement = undefined;
      this.state.choiceBasePlacement = undefined;
    } finally {
      this.ports.setFrameCovered(false);
    }
  }
  dispose(): void {
    if (this.disposed) return;
    this.reset();
    this.disposed = true;
    this.state.available = false;
  }
}

export interface CaseViewControl {
  id: string;
  label: string;
  action: CaseViewAction;
}
/** The same commands back physical handles and seated focus selection. */
export function caseViewControls(state: CaseViewSnapshot): CaseViewControl[] {
  if (!state.available) return [];
  if (state.mode === "museum")
    return [
      {
        id: "CaseViewHandle",
        label: "Stand by the case",
        action: { type: "chooseView" },
      },
    ];
  const close: CaseViewControl = {
    id: "CaseViewClose",
    label: "Return to museum",
    action: { type: "closeView" },
  };
  if (state.mode === "choice")
    return [
      {
        id: "CaseViewSeated",
        label: "View from here",
        action: { type: "viewFromHere" },
      },
      {
        id: "CaseViewStanding",
        label: "Stand by the case",
        action: { type: "standByCase" },
      },
      close,
    ];
  if (state.mode === "room")
    return [
      {
        id: "CaseViewBack",
        label: "Back to table",
        action: { type: "backToTable" },
      },
      ...(state.presentation?.comparison ? [{
        id:"CaseViewVersion",
        label:"Show version " + (state.presentation.versionIndex===1?"1":"2"),
        action:{type:"switchVersion" as const,generation:state.generation??0},
      }] : []),
      close,
    ];
  return [
    {
      id: "CaseViewStanding",
      label: "Stand by the case",
      action: { type: "standByCase" },
    },
    close,
  ];
}

/** A presentation-only version switch must not snap a running reconstruction
 * back to its integer recording frame. Explicit seek/pause and new cases do. */
export function comparisonPoseTick(tick:number,playing:boolean,
  board:{caseId:string;rev:number}|undefined,
  previous:{caseId?:string;rev?:number;tick?:number}):number {
  const phase=previous.tick;
  return playing && !!board && board.caseId===previous.caseId && board.rev===previous.rev &&
    phase!==undefined && Number.isFinite(phase) && phase>=tick && phase<tick+1 ? phase : tick;
}
