import {
  AuthorSession,
  AuthorSnapshot,
} from "./AuthorSession";
import {
  Board,
  AnswerValue,
  Field,
  DomainError,
  FrameClue,
  Verdict,
} from "../Domain/types";
import { compileCase, clone } from "../Domain/compile";
import { frameAt } from "../Domain/observe";

export interface AuthorRecording {
  board?: Board;
  frame?: FrameClue;
  tick: number;
  source: string;
  errors: DomainError[];
  verdict: Verdict | null;
}
export interface AuthorViewSnapshot {
  enabled: boolean;
  mode: "stage" | "recording" | "change";
  generation: number;
  source: string;
  tick: number;
  watching: boolean;
  canKeep: boolean;
  canDiscard: boolean;
  canCompare: boolean;
  comparing: boolean;
  differences: { field: Field; before: AnswerValue[]; after: AnswerValue[] }[];
  recording?: AuthorRecording;
  before?: AuthorRecording;
  after?: AuthorRecording;
  message: string;
}
type Intent =
  | { type: "watchView"; source: string }
  | {
      type:
        | "backToStage"
        | "tryChange"
        | "keepChange"
        | "discardChange"
        | "compareChange";
    };
export type AuthorViewAction = Intent & { generation?: number };
export interface AuthorViewPorts {
  isAuthorRole(): boolean;
  /** Switch the existing AuthorController, keeping CaseFlow's base session owned. */
  activate(session: AuthorSession): void;
  cancelInput(): void;
  /** Publish into MuseumGame state. The caller owns its normal render cycle. */
  present(snapshot: AuthorViewSnapshot): void;
  clear(): void;
}

/** A temporary author experiment. Neither trial edits nor public camera panes
 * become another case, a seal, or an editable detective input. */
export class AuthorViewSession {
  private trial?: AuthorSession;
  private reference?: AuthorSession;
  private originalAssessment: Verdict | null = null;
  private expectedRev?: number;
  private source = "";
  private watching = false;
  private generation = 0;
  private message = "";
  private disposed = false;
  private changing = false;
  private syncing = false;
  private cached = new Map<
    string,
    {
      board?: Board;
      frameSource: (source: string, tick: number) => FrameClue | undefined;
      errors: DomainError[];
    }
  >();
  private state: AuthorViewSnapshot = {
    enabled: false,
    mode: "stage",
    generation: 0,
    source: "",
    tick: 0,
    watching: false,
    canKeep: false,
    canDiscard: false,
    canCompare: false,
    comparing: false,
    differences: [],
    message: "",
  };
  constructor(
    private readonly base: AuthorSession,
    private readonly ports: AuthorViewPorts,
  ) {}
  activeSession(): AuthorSession {
    return this.trial ?? this.base;
  }
  snapshot(): AuthorViewSnapshot {
    return clone(this.state);
  }
  sync(): void {
    if (this.disposed || this.changing || this.syncing) return;
    this.syncing = true;
    try {
      if (!this.ports.isAuthorRole()) {
        if (this.trial || this.watching) {
          this.trial?.dispose();
          this.reference?.dispose();
          this.reference = undefined;
          this.originalAssessment = null;
          this.trial = undefined;
          this.expectedRev = undefined;
          this.watching = false;
          this.generation++;
          this.cached.clear();
          this.ports.clear();
        }
        this.state = {
          enabled: false,
          mode: "stage",
          generation: this.generation,
          source: "",
          tick: 0,
          watching: false,
          canKeep: false,
          canDiscard: false,
          canCompare: false,
          comparing: false,
          differences: [],
          message: "",
        };
        this.ports.present(this.snapshot());
        return;
      }
      const active = this.activeSession().snapshot();
      if (!active.draft.witnesses.some((w) => w.id === this.source))
        this.source = active.draft.witnesses[0]?.id ?? "";
      this.state = {
        enabled: true,
        mode: this.trial ? "change" : this.watching ? "recording" : "stage",
        generation: this.generation,
        source: this.source,
        tick: active.tick,
        watching: this.watching,
        canKeep:
          !!this.trial &&
          !active.preview &&
          this.base.getDraft().rev === this.expectedRev,
        canDiscard: !!this.trial,
        canCompare:
          !!this.trial &&
          !active.preview &&
          !active.testing &&
          !this.reference?.snapshot().testing,
        comparing: active.testing || !!this.reference?.snapshot().testing,
        differences: [],
        message: this.message,
      };
      if (this.watching) {
        if (this.trial) {
          this.state.before = this.recording(
            (this.reference ?? this.base).snapshot(),
            active.tick,
          );
          this.state.before.verdict =
            this.originalAssessment ?? this.state.before.verdict;
          this.state.after = this.recording(active, active.tick);
        } else this.state.recording = this.recording(active, active.tick);
        const errors =
          this.state.after?.errors ?? this.state.recording?.errors ?? [];
        if (errors.length) this.state.message = errors[0].message;
      }
      const before = this.state.before?.verdict,
        after = this.state.after?.verdict;
      if (
        before &&
        after &&
        !this.state.comparing &&
        ![before.status, after.status].some(
          (s) => s === "conflict" || s === "incomplete",
        )
      ) {
        const fields = [
          ...new Set([
            ...(this.reference?.getDraft().fields ?? ["taker"]),
            ...(active.draft.fields ?? ["taker"]),
          ]),
        ] as Field[];
        this.state.differences = fields
          .filter(
            (field) =>
              JSON.stringify([...(before.fieldValues[field] ?? [])].sort()) !==
              JSON.stringify([...(after.fieldValues[field] ?? [])].sort()),
          )
          .map((field) => ({
            field,
            before: clone(before.fieldValues[field] ?? []),
            after: clone(after.fieldValues[field] ?? []),
          }));
        this.state.message = this.state.differences.length
          ? "The possible answers changed"
          : "The same answers remain possible";
      }
      this.ports.present(this.snapshot());
    } finally {
      this.syncing = false;
    }
  }
  /** Only the isolated reference proof needs an extra scheduler. The existing
   * AuthorController keeps owning the active trial proof and gameplay time. */
  update(): boolean {
    if (this.disposed || !this.reference || !this.ports.isAuthorRole())
      return false;
    if (this.reference.snapshot().testing) {
      this.reference.advanceProof(4);
      const state = this.reference.snapshot();
      if (!state.testing) {
        this.originalAssessment = state.verdict;
        this.sync();
        return true;
      }
    }
    return false;
  }
  dispatch(action: AuthorViewAction): boolean {
    if (
      this.disposed ||
      this.changing ||
      !this.ports.isAuthorRole() ||
      (action.generation !== undefined && action.generation !== this.generation)
    )
      return false;
    this.changing = true;
    let accepted = false;
    try {
      switch (action.type) {
        case "watchView": {
          if (
            !this.activeSession()
              .getDraft()
              .witnesses.some((w) => w.id === action.source)
          )
            break;
          this.stopInput();
          this.source = action.source;
          this.watching = true;
          this.message = "Watch this view";
          accepted = true;
          break;
        }
        case "backToStage":
          this.stopInput();
          this.watching = false;
          this.message = "";
          accepted = true;
          break;
        case "tryChange": {
          if (this.trial) break;
          this.stopInput();
          this.expectedRev = this.base.getDraft().rev;
          this.trial = this.base.tryChange();
          this.reference = this.base.tryChange();
          const original = this.base.snapshot();
          this.originalAssessment =
            original.testedRev === original.draft.rev ? original.verdict : null;
          this.watching = true;
          this.message = "Try a change";
          this.ports.activate(this.trial);
          accepted = true;
          break;
        }
        case "compareChange": {
          if (!this.trial || !this.reference) break;
          this.stopInput();
          this.watching = true;
          const ensure = (session: AuthorSession) => {
            const s = session.snapshot();
            return (
              s.testing ||
              (s.testedRev === s.draft.rev &&
                !!s.verdict &&
                !["conflict", "incomplete"].includes(s.verdict.status)) ||
              session.startTest()
            );
          };
          const baseline = !!this.originalAssessment || ensure(this.reference),
            changed = ensure(this.trial);
          accepted = baseline && changed;
          this.message = accepted
            ? "Comparing the possible thefts"
            : "Finish staging the theft before comparing";
          break;
        }
        case "keepChange": {
          if (!this.trial || this.expectedRev === undefined) break;
          this.stopInput();
          const trial = this.trial,
            checkpoint = trial.checkpoint();
          if (!this.base.acceptChange(trial, this.expectedRev)) {
            this.message =
              this.base.snapshot().errors[0]?.message ??
              "Try this change again";
            break;
          }
          this.returnToBase(checkpoint.tick, checkpoint.selected);
          this.message = "Change kept";
          accepted = true;
          break;
        }
        case "discardChange": {
          if (!this.trial) break;
          this.stopInput();
          const checkpoint = this.trial.checkpoint();
          this.returnToBase(checkpoint.tick, checkpoint.selected);
          this.message = "Original case restored";
          accepted = true;
          break;
        }
      }
    } finally {
      this.changing = false;
      this.sync();
    }
    return accepted;
  }
  private stopInput(): void {
    this.generation++;
    this.ports.cancelInput();
    this.activeSession().cancelGesture();
    this.activeSession().pause();
  }
  private returnToBase(tick: number, selected: string | null): void {
    const trial = this.trial;
    this.trial = undefined;
    this.expectedRev = undefined;
    this.base.setTick(tick);
    const draft = this.base.getDraft();
    const valid =
      selected === null ||
      draft.tracks.some((t) => t.id === selected) ||
      draft.witnesses.some((w) => w.id === selected) ||
      [draft.room.exhibit, ...(draft.room.boxes ?? [])].some(
        (p) => p.id === selected,
      );
    this.base.select(valid ? selected : null);
    this.ports.activate(this.base);
    trial?.dispose();
    this.reference?.dispose();
    this.reference = undefined;
    this.originalAssessment = null;
    this.cached.clear();
  }
  private recording(snapshot: AuthorSnapshot, tick: number): AuthorRecording {
    const key = JSON.stringify(snapshot.draft);
    let cached = this.cached.get(key);
    if (!cached) {
      const compiled = compileCase(snapshot.draft);
      if (compiled.ok === true) {
        const tape = compiled.sealed.clues;
        cached = {
          board: compiled.sealed.board,
          errors: [],
          frameSource: (source, time) => frameAt(tape, source, time),
        };
      } else cached = { errors: compiled.errors, frameSource: () => undefined };
      if (this.cached.size >= 4) this.cached.clear();
      this.cached.set(key, cached);
    }
    // compileCase's tape is the actual observe(board, authoredHistory) result.
    // Only its fixed-source frame crosses this renderer boundary, never the vault.
    return {
      board: cached.board ? clone(cached.board) : undefined,
      frame: cached.frameSource(this.source, tick),
      tick,
      source: this.source,
      errors: clone(cached.errors),
      verdict: snapshot.verdict ? clone(snapshot.verdict) : null,
    };
  }
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.generation++;
    this.ports.cancelInput();
    this.trial?.dispose();
    this.reference?.dispose();
    this.reference = undefined;
    this.originalAssessment = null;
    this.trial = undefined;
    this.expectedRev = undefined;
    this.watching = false;
    this.cached.clear();
    this.ports.clear();
    this.state = {
      enabled: false,
      mode: "stage",
      generation: this.generation,
      source: "",
      tick: 0,
      watching: false,
      canKeep: false,
      canDiscard: false,
      canCompare: false,
      comparing: false,
      differences: [],
      message: "",
    };
  }
}
export interface AuthorViewControl {
  id: string;
  label: string;
  action: AuthorViewAction;
}
export function authorViewControls(
  snapshot: AuthorViewSnapshot,
  witnesses: readonly { id: string }[],
): AuthorViewControl[] {
  if (!snapshot.enabled) return [];
  const controls: AuthorViewControl[] = witnesses.map((w) => ({
    id: "WatchThisView-" + w.id,
    label: "Watch this view",
    action: {
      type: "watchView",
      source: w.id,
      generation: snapshot.generation,
    },
  }));
  if (snapshot.watching)
    controls.push({
      id: "BackToStage",
      label: "Back to staging",
      action: { type: "backToStage", generation: snapshot.generation },
    });
  if (snapshot.mode === "change")
    controls.push({
      id: "DiscardChange",
      label: "Discard this change",
      action: { type: "discardChange", generation: snapshot.generation },
    });
  else
    controls.push({
      id: "TryAChange",
      label: "Try a change",
      action: { type: "tryChange", generation: snapshot.generation },
    });
  if (snapshot.canKeep)
    controls.push({
      id: "KeepThisChange",
      label: "Keep this change",
      action: { type: "keepChange", generation: snapshot.generation },
    });
  if (snapshot.mode === "change")
    controls.push({
      id: "CompareThisChange",
      label: snapshot.comparing
        ? "Checking both versions"
        : "Compare this change",
      action: { type: "compareChange", generation: snapshot.generation },
    });
  return controls;
}
