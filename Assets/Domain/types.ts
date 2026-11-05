/** Metres, radians, integer logical ticks 0..24. No Lens/SDK dependencies. */
export const ROLES = ["Courier", "Guard", "Conservator"] as const;
export type Role = (typeof ROLES)[number];
export type TrackId = "A" | "B" | "C";
export interface Vec3 {
  x: number;
  y: number;
  z: number;
}
export interface Key {
  tick: number;
  x: number;
  z: number;
  y?: number;
  yaw: number;
  /** Outgoing route segment travels backward while facing its opposite heading. */
  backward?: boolean;
}
export interface Track {
  id: TrackId;
  keys: Key[];
  markerWidth?: number;
  markerHeight?: number;
}
export interface Wall {
  id: string;
  a: Vec3;
  b: Vec3;
  bottom: number;
  top: number;
}
/** normal points into the room; right/up are orthonormal plane axes. Aperture opens from left. */
export interface Mirror {
  id: string;
  origin: Vec3;
  normal: Vec3;
  right: Vec3;
  up: Vec3;
  width: number;
  height: number;
  aperture: number;
}
export interface Witness {
  id: string;
  position: Vec3;
  yaw: number;
  fov: number;
  verticalFov?: number;
  near?: number;
  far?: number;
}
export interface Place {
  id: string;
  position: Vec3;
}
export interface Room {
  width: number;
  depth: number;
  exhibit: Place;
  walls: Wall[];
  mirror?: Mirror;
  boxes?: Place[];
}
export type Event =
  | { kind: "Take" | "BrushRim"; track: TrackId; tick: number }
  | { kind: "Pass"; from: TrackId; to: TrackId; tick: number }
  | { kind: "Stash"; carrier: TrackId; box: string; tick: number };
export type Field =
  | "taker"
  | "recipient"
  | "cache"
  | "takeTick"
  | "passTick"
  | "stashTick";
export type AnswerValue = Role | string | number | "None";
export interface CaseDraft {
  id: string;
  rev: number;
  title: string;
  room: Room;
  witnesses: Witness[];
  tracks: Track[];
  casting: Record<TrackId, Role>;
  events: Event[];
  alarmTick: number;
  chain?: boolean;
  fields?: Field[];
}
export interface ActionWindows {
  take: TrackId[];
  brush: Record<TrackId, number[]>;
  pass: { from: TrackId; to: TrackId; tick: number }[];
  stash: { carrier: TrackId; box: string; tick: number }[];
}
/** Contains only public geometry, paths and grammar. Never casting or authored events. */
export interface Board {
  caseId: string;
  rev: number;
  room: Room;
  witnesses: Witness[];
  tracks: Track[];
  alarmTick: number;
  chain: boolean;
  fields: Field[];
  windows: ActionWindows;
}
export interface History {
  casting: Record<TrackId, Role>;
  take: TrackId;
  brushes: { track: TrackId; tick: number }[];
  pass?: { from: TrackId; to: TrackId; tick: number };
  stash?: { carrier: TrackId; box: string; tick: number };
}
export interface Fragment {
  position: Vec3;
  /** Public orientation of the sampled surface, not a hidden actor reference. */
  surfaceRight: Vec3;
  projection: { horizontal: number; vertical: number };
  via: "direct" | "mirror";
  role?: Role;
  segment: string;
}
export interface FramePayload {
  fragments: Fragment[];
  hands: { position: Vec3; via: "direct" | "mirror"; segment?: string }[];
  /** Positive visibility of an entire palm/gem-sized region. Missing means
   * unobserved, never an empty-hand assertion. No actor/track identifier. */
  palms?: PalmRegion[];
  actions: {
    kind: "Take" | "BrushRim" | "Pass" | "Stash";
    positions: Vec3[];
    box?: string;
    /** Actual visible contact; positions above are only already-visible public
     * participant anchors. Legacy slices may lack this geometric provenance. */
    contacts?: Vec3[];
    via?: "direct" | "mirror";
    projection?: { horizontal: number; vertical: number };
    surfaceRight?: Vec3;
  }[];
  exhibit?: boolean;
  exhibitSurface?: ObservedSurface;
}
export interface ObservedSurface {
  position: Vec3;
  surfaceRight: Vec3;
  projection: { horizontal: number; vertical: number };
  via: "direct" | "mirror";
}
export interface PalmRegion extends ObservedSurface {
  segment: string;
  present: boolean;
}
export interface FrameClue {
  id: string;
  witness: string;
  tick: number;
  kind: "Frame";
  payload: FramePayload;
  /** A selected crop is a positive constraint on one visible surface, not a new
   * camera recording and not evidence that the rest of the frame was empty. */
  observation?: {
    caseId: string;
    rev: number;
    frameId: string;
  } & (
    | { kind: "fragment"; segment: string }
    | {
        kind: "hand";
        position: Vec3;
        via: "direct" | "mirror";
        present: boolean;
        /** New visibility-backed channel. Absent retains legacy slice parsing. */
        segment?: string;
      }
    | { kind: "action"; index: number }
    | { kind: "exhibit" }
  );
}
export interface RimClue {
  id: string;
  kind: "Rim";
  surfaceId: string;
  shapes: Role[];
}
export interface BoxClue {
  id: string;
  kind: "Box";
  box: string;
  present: boolean;
}
export type Clue = FrameClue | RimClue | BoxClue;
export interface WitnessTape {
  caseId: string;
  rev: number;
  clues: Clue[];
}
export interface SealedCase {
  caseId: string;
  rev: number;
  board: Board;
  clues: WitnessTape;
}
export interface VaultEntry {
  sourceDraft: CaseDraft;
  actualHistory: History;
}
export interface DomainError {
  code: string;
  object: string;
  tick?: number;
  message: string;
}
export type CompileResult =
  | { ok: true; sealed: SealedCase; vault: VaultEntry }
  | { ok: false; errors: DomainError[] };
export type Claim =
  | Role
  | "Underdetermined"
  | Partial<Record<Field, AnswerValue | "Underdetermined">>;
export interface ProofOptions {
  /** Keep false for a complete result with sufficient, unminimized public grounds. */
  minimizeReasons?: boolean;
  maxHistories?: number;
  /** Search candidates per progress yield. Smaller batches suit a render loop. */
  batchSize?: number;
  cancelled?: () => boolean;
  reverse?: boolean;
}
export interface Verdict {
  status:
    | "proved"
    | "contradicted"
    | "needClue"
    | "ambiguous"
    | "conflict"
    | "incomplete";
  historyCount: number;
  possibleCulprits: Role[];
  examplesByCulprit: Partial<Record<Role, History>>;
  fieldValues: Partial<Record<Field, AnswerValue[]>>;
  examplesByField: Partial<Record<Field, History[]>>;
  reasonIds: string[];
  exclusions: Partial<Record<Role, string[]>>;
  scope: "selected" | "all";
  message?: string;
}
