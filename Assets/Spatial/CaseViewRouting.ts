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
  | { type: "setReducedMotion"; enabled: boolean };
export interface CaseViewPresentation {
  kind: CaseViewKind;
  /** World centimetres, story-minimum floor origin, scale .06 or 1. */
  placement: Placement;
  handlePlacement: Placement;
  source: string;
  tick: number;
  comparison: boolean;
}
export interface CaseViewSnapshot {
  mode: "museum" | "choice" | CaseViewKind;
  available: boolean;
  reducedMotion: boolean;
  caseId?: string;
  rev?: number;
  instruction?: string;
  presentation?: CaseViewPresentation;
}
export interface CaseViewViewer {
  eyeCm: readonly [number, number, number];
  /** Actual tracked viewing direction. This API never has a camera setter. */
  forward: readonly [number, number, number];
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
  };
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
    this.state.available = true;
    if (this.state.presentation) {
      if (this.state.presentation.source !== session.detective.source)
        this.present(this.state.presentation.kind, false);
      else {
        this.state.presentation = {
          ...this.state.presentation,
          tick: session.detective.tick,
          comparison: !!session.detective.comparison,
        };
        this.ports.setPresentation(clone(this.state.presentation));
      }
    }
  }
  dispatch(action: CaseViewAction): boolean {
    if (this.disposed) return false;
    this.sync();
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
      this.state.mode = "choice";
      this.state.instruction = "Keep space around the case clear";
      return true;
    }
    if (action.type === "viewFromHere") return this.present("table", true);
    if (action.type === "standByCase") return this.present("room", true);
    if (action.type === "backToTable") return this.present("table", false);
    return false;
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
    this.anchorViewer = clone(viewer);
    const horizontal = Math.hypot(viewer.forward[0], viewer.forward[2]);
    const fx = viewer.forward[0] / horizontal,
      fz = viewer.forward[2] / horizontal;
    const yaw = Math.atan2(fx, fz) - witness.yaw;
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
        : rotate(witness.position.x * 100, witness.position.z * 100);
    const originCm: [number, number, number] =
      kind === "table"
        ? [
            viewer.eyeCm[0] + fx * 80 - anchor[0],
            viewer.eyeCm[1] - 50,
            viewer.eyeCm[2] + fz * 80 - anchor[1],
          ]
        : [
            viewer.eyeCm[0] - anchor[0],
            viewer.eyeCm[1] - witness.position.y * 100,
            viewer.eyeCm[2] - anchor[1],
          ];
    const presentation: CaseViewPresentation = {
      kind,
      placement: { originCm, scale, yawRad: yaw },
      handlePlacement: {
        originCm: [
          viewer.eyeCm[0] + fx * 55,
          viewer.eyeCm[1] - 25,
          viewer.eyeCm[2] + fz * 55,
        ],
        scale: 1,
        yawRad: Math.atan2(fx, fz),
      },
      source: session.detective.source,
      tick: session.detective.tick,
      comparison: !!session.detective.comparison,
    };
    // A brief physical frame cover hides instant relocation. No model sweeps
    // through the eyes, including reduced motion; there is no camera flight.
    this.ports.setFrameCovered(true);
    try {
      this.ports.setPresentation(clone(presentation));
      this.ports.setSecondaryLabelsVisible(kind === "table");
      this.state.mode = kind;
      this.state.presentation = presentation;
      this.state.instruction =
        kind === "room" ? "Keep the space around you clear" : undefined;
    } finally {
      this.coverSeconds = this.state.reducedMotion ? 0.08 : 0.12;
    }
    return true;
  }
  private reset(): void {
    this.coverSeconds = 0;
    this.ports.stopSound();
    this.ports.setFrameCovered(true);
    try {
      this.ports.setPresentation(undefined);
      this.ports.setSecondaryLabelsVisible(true);
      this.anchorViewer = undefined;
      this.state.mode = "museum";
      this.state.presentation = undefined;
      this.state.instruction = undefined;
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
