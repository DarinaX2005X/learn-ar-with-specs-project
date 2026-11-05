import {
  AnswerValue,
  Board,
  Claim,
  Clue,
  Field,
  FrameClue,
  History,
  Role,
  SealedCase,
  Verdict,
  WitnessTape,
} from "../Domain/types";
import { proveSteps } from "../Domain/prove";
import {
  observe,
  getObservations,
  resolveObservation,
  compareObservations,
} from "../Domain/observe";
import { reconstructionIssue } from "./Reconstruction";

const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value));
export type DetectiveMode = "table" | "witness" | "reconstruction";
export interface EvidenceGlass {
  id: string;
  clue: Clue;
  selected: boolean;
}
export interface DetectiveState {
  caseId: string;
  rev: number;
  mode: DetectiveMode;
  tick: number;
  source: string;
  playing: boolean;
  selected?: string;
  glass: EvidenceGlass[];
  visibleGlass: EvidenceGlass[];
  glassPage: number;
  canUndoEvidence: boolean;
  frame?: Clue;
  observations: FrameClue[];
  focusedObservation?: FrameClue;
  objects: Clue[];
  selectedField: Field;
  questionFields: Field[];
  claim: Claim;
  checking: boolean;
  verdict?: Verdict;
  message: string;
  reconstruction?: History;
  comparison?: {
    pair: [History, History];
    scope: "all" | "selected";
    field: Field;
    tape: WitnessTape;
  };
  reasons: Clue[];
  completed: boolean;
  fields: Partial<
    Record<
      Field,
      { value: string | number; reasonIds: string[]; scope: "selected" | "all" }
    >
  >;
}
export interface DetectiveArchive {
  caseId: string;
  rev: number;
  tick: number;
  source: string;
  ids: string[];
  claim: Claim;
}
export interface DetectivePort {
  /** Render only this public snapshot. Never query an author renderer. */
  render(state: DetectiveState, board: Board): void;
  revealTheft?(caseId: string, rev: number): void;
  returnToCases?(): void;
  clear(): void;
}
export type DetectiveAction =
  | { type: "seek"; tick: number }
  | { type: "step"; delta: number }
  | {
      type:
        | "play"
        | "freeze"
        | "replay"
        | "table"
        | "inspect"
        | "pin"
        | "remove"
        | "undo"
        | "check"
        | "checkAll"
        | "returnObservations"
        | "reveal"
        | "finish";
    }
  | { type: "tabPage"; delta: number }
  | { type: "source"; source: string }
  | { type: "selectClue"; id: string }
  | { type: "selectObservation"; id: string }
  | { type: "pinClue"; id: string; caseId: string; rev: number }
  | { type: "inspectObject"; id: string }
  | { type: "selectField"; field: Field }
  | { type: "claimField"; field: Field; value: AnswerValue | "Underdetermined" }
  | { type: "versionField"; field: Field; index: number }
  | { type: "claim"; claim: Claim }
  | { type: "version"; role: Role }
  | { type: "hypothesis"; history: History; all?: boolean }
  | { type: "comparePair"; first: History; second: History; all?: boolean }
  | { type: "compareVersions"; field?: Field };

/** The sole investigation input is the sealed public snapshot. A gesture and
 * its accessible button dispatch the same action exactly once. */
export class DetectiveSession {
  private readonly sealed: SealedCase;
  private state: DetectiveState;
  private ids: string[] = [];
  private removed?: { id: string; index: number };
  private task?: Generator<{ work: number }, Verdict, void>;
  private generation = 0;
  private taskGeneration = 0;
  private disposed = false;
  private elapsed = 0;
  private slices = 0;
  private restore?: {
    mode: DetectiveMode;
    tick: number;
    source: string;
    selected?: string;
  };
  constructor(
    sealed: SealedCase,
    private readonly port: DetectivePort,
    private readonly workLimit = 100000,
  ) {
    if (
      sealed.caseId !== sealed.board.caseId ||
      sealed.rev !== sealed.board.rev ||
      sealed.clues.caseId !== sealed.caseId ||
      sealed.clues.rev !== sealed.rev
    )
      throw new Error("Open a matching sealed case");
    this.sealed = copy(sealed);
    this.state = {
      caseId: sealed.caseId,
      rev: sealed.rev,
      mode: "table",
      tick: sealed.board.alarmTick,
      source: sealed.board.witnesses[0]?.id ?? "",
      playing: false,
      glass: [],
      visibleGlass: [],
      glassPage: 0,
      canUndoEvidence: false,
      observations: [],
      objects: copy(sealed.clues.clues.filter((c) => c.kind !== "Frame")),
      selectedField: "taker",
      questionFields: [...sealed.board.fields],
      claim: {},
      checking: false,
      message: "Who took the ruby?",
      reasons: [],
      completed: false,
      fields: {},
    };
    this.emit();
  }
  sources(): string[] {
    return this.sealed.board.witnesses.map((w) => w.id);
  }
  snapshot(): DetectiveState {
    return copy(this.state);
  }
  presentationTick(): number {
    return Math.min(
      24,
      this.state.tick + (this.state.playing ? this.elapsed / 0.5 : 0),
    );
  }
  isCompleted(): boolean {
    return this.state.completed;
  }
  archive(): DetectiveArchive {
    return copy({
      caseId: this.sealed.caseId,
      rev: this.sealed.rev,
      tick: this.state.tick,
      source: this.state.source,
      ids: this.ids,
      claim: this.state.claim,
    });
  }
  restoreArchive(saved: DetectiveArchive): boolean {
    if (
      saved.caseId !== this.sealed.caseId ||
      saved.rev !== this.sealed.rev ||
      !Array.isArray(saved.ids) ||
      saved.ids.some((id) => !this.isPinnableObservation(id)) ||
      !this.sealed.board.witnesses.some((w) => w.id === saved.source) ||
      !Number.isFinite(saved.tick)
    )
      return false;
    this.ids = [...new Set(saved.ids)];
    this.state.source = saved.source;
    this.seek(saved.tick);
    this.state.claim = copy(saved.claim);
    this.state.mode = "table";
    this.state.reconstruction = undefined;
    this.state.comparison = undefined;
    this.restore = undefined;
    this.invalidate();
    this.emit();
    return true;
  }
  dispatch(action: DetectiveAction): void {
    if (this.disposed) return;
    switch (action.type) {
      case "seek":
        this.seek(action.tick);
        break;
      case "step":
        this.seek(this.state.tick + action.delta);
        break;
      case "play":
        this.state.selected = undefined;
        this.state.playing = true;
        break;
      case "freeze":
        this.state.playing = false;
        break;
      case "replay":
        this.seek(this.sealed.board.alarmTick);
        this.state.playing = true;
        break;
      case "tabPage":
        this.state.glassPage = Math.max(
          0,
          Math.min(
            Math.max(0, Math.ceil(this.ids.length / 3) - 1),
            this.state.glassPage + Math.sign(action.delta),
          ),
        );
        break;
      case "source":
        if (this.sealed.board.witnesses.some((w) => w.id === action.source)) {
          this.state.source = action.source;
          this.state.mode = "witness";
          this.state.selected = undefined;
        }
        break;
      case "inspect":
        this.state.mode = "witness";
        break;
      case "table":
        this.state.mode = "table";
        break;
      case "inspectObject":
        if (
          this.state.objects.some((c) => c.id === action.id) &&
          this.state.mode !== "reconstruction"
        )
          this.select(action.id);
        break;
      case "selectField":
        if (this.state.questionFields.includes(action.field))
          this.state.selectedField = action.field;
        break;
      case "claimField":
        if (this.state.questionFields.includes(action.field)) {
          this.state.claim = {
            ...(typeof this.state.claim === "string"
              ? { taker: this.state.claim }
              : this.state.claim),
            [action.field]: action.value,
          };
          this.state.selectedField = action.field;
          delete this.state.fields[action.field];
          this.invalidate([], true);
        }
        break;
      case "versionField": {
        const h =
          this.state.verdict?.examplesByField[action.field]?.[action.index];
        if (h) this.showVersion(h);
        break;
      }
      case "selectClue":
        this.select(action.id);
        break;
      case "selectObservation":
        if (
          this.state.mode !== "reconstruction" &&
          this.state.observations.some((c) => c.id === action.id)
        )
          this.select(action.id);
        break;
      case "pin": {
        const clue = this.currentObservation();
        if (clue) this.pin(clue.id);
        else this.state.message = "Choose a visible mark";
        break;
      }
      case "pinClue":
        if (
          action.caseId === this.sealed.caseId &&
          action.rev === this.sealed.rev
        )
          this.pin(action.id);
        else this.state.message = "Open evidence from this sealed case";
        break;
      case "remove": {
        const i = this.ids.indexOf(this.state.selected ?? "");
        if (i >= 0) {
          this.removed = { id: this.ids[i], index: i };
          const id = this.ids.splice(i, 1)[0];
          this.invalidate([id]);
          this.state.selected = this.ids[Math.min(i, this.ids.length - 1)];
        }
        break;
      }
      case "undo":
        if (this.removed) {
          this.ids.splice(this.removed.index, 0, this.removed.id);
          this.state.selected = this.removed.id;
          this.removed = undefined;
          this.invalidate();
        }
        break;
      case "claim":
        this.state.claim = copy(action.claim);
        for (const field of (typeof action.claim === "string"
          ? ["taker"]
          : Object.keys(action.claim)) as Field[])
          delete this.state.fields[field];
        this.invalidate([], true);
        break;
      case "check":
        this.check(this.state.claim);
        break;
      case "checkAll":
        this.check("Underdetermined");
        break;
      case "version": {
        const h = this.state.verdict?.examplesByCulprit[action.role];
        if (h) this.showVersion(h);
        break;
      }
      case "returnObservations":
        if (this.restore) {
          Object.assign(this.state, this.restore);
          this.restore = undefined;
          this.state.reconstruction = undefined;
          this.state.comparison = undefined;
        }
        break;
      case "comparePair":
        this.comparePair(action.first, action.second, !!action.all);
        break;
      case "compareVersions": {
        const field = action.field ?? this.state.selectedField;
        const examples = this.state.verdict?.examplesByField[field] ?? [];
        if (examples.length < 2) {
          this.state.message = "These observations allow only one value";
          break;
        }
        const scope = this.state.verdict!.scope;
        this.showVersion(examples[0]);
        this.state.comparison = {
          pair: [copy(examples[0]), copy(examples[1])],
          scope,
          field,
          tape: copy(this.sealed.clues),
        };
        this.state.message = "Possible reconstructions";
        break;
      }
      case "hypothesis":
        this.compare(action.history, !!action.all);
        break;
      case "reveal":
        if (this.state.completed)
          this.port.revealTheft?.(this.sealed.caseId, this.sealed.rev);
        break;
      case "finish":
        this.port.returnToCases?.();
        break;
    }
    this.emit();
  }
  /** At most two bounded solver slices per frame. Never run proof in render. */
  update(seconds: number): void {
    if (this.disposed) return;
    if (this.state.playing && Number.isFinite(seconds) && seconds > 0) {
      this.elapsed += Math.min(seconds, 0.25);
      while (this.elapsed >= 0.5) {
        this.elapsed -= 0.5;
        this.state.tick = Math.min(24, this.state.tick + 1);
        if (this.state.tick === 24) this.state.playing = false;
      }
    }
    if (this.task) {
      for (let i = 0; i < 2 && this.task; i++) {
        if (++this.slices > 4096) {
          this.task = undefined;
          this.state.checking = false;
          this.state.completed = false;
          this.state.message = "The check did not finish. Try again";
          break;
        }
        const result = this.task.next();
        if (result.done) {
          this.task = undefined;
          if (this.taskGeneration === this.generation)
            this.accept(result.value);
        }
      }
    }
    this.emit();
  }
  dispose(): void {
    this.disposed = true;
    this.task = undefined;
    this.port.clear();
  }
  private seek(tick: number): void {
    if (!Number.isFinite(tick)) return;
    this.state.tick = Math.max(0, Math.min(24, Math.round(tick)));
    this.state.playing = false;
    this.elapsed = 0;
    this.state.selected = undefined;
  }
  private showVersion(history: History): void {
    this.state.comparison = undefined;
    this.restore ??= {
      mode: this.state.mode,
      tick: this.state.tick,
      source: this.state.source,
      selected: this.state.selected,
    };
    this.state.mode = "reconstruction";
    this.state.reconstruction = copy(history);
    this.state.playing = false;
    this.state.message = "Possible reconstruction";
  }
  private currentObservation(): Clue | undefined {
    const object = this.state.objects.find((c) => c.id === this.state.selected);
    if (object) return object;
    const observations = getObservations(
      this.sealed.clues,
      this.state.source,
      this.state.tick,
    );
    return (
      observations.find((c) => c.id === this.state.selected) ??
      (observations.length === 1 ? observations[0] : undefined)
    );
  }
  private currentFrame(): Clue | undefined {
    return this.sealed.clues.clues.find(
      (c) =>
        c.kind === "Frame" &&
        c.witness === this.state.source &&
        c.tick === this.state.tick,
    );
  }
  private select(id: string): void {
    const c = resolveObservation(this.sealed.clues, id);
    if (!c) return;
    this.state.selected = id;
    this.state.playing = false;
    if (c.kind === "Frame") {
      this.state.tick = c.tick;
      this.state.source = c.witness;
      this.state.mode = "witness";
    } else this.state.mode = "table";
  }
  private pin(id: string): void {
    if (this.state.mode === "reconstruction") return;
    let c = resolveObservation(this.sealed.clues, id);
    if (!c) return;
    if (c.kind === "Frame" && !c.observation) {
      const candidates = getObservations(this.sealed.clues, c.witness, c.tick);
      if (candidates.length !== 1) {
        this.state.message = "Choose a visible mark";
        return;
      }
      c = candidates[0];
      id = c.id;
    }
    if (
      c.kind === "Frame" &&
      !c.payload.fragments.length &&
      !c.payload.actions.length &&
      !c.payload.hands.length &&
      !c.observation
    ) {
      this.state.message = "No one is identifiable in this frame";
      return;
    }
    if (!this.ids.includes(id)) {
      this.ids.push(id);
      this.invalidate([], true);
    }
    this.state.selected = id;
    this.state.glassPage = Math.floor(this.ids.indexOf(id) / 3);
  }
  private isPinnableObservation(id: string): boolean {
    const clue = resolveObservation(this.sealed.clues, id);
    return !!clue && (clue.kind !== "Frame" || !!clue.observation);
  }
  private invalidate(removed: string[] = [], preserveFields = false): void {
    if (this.restore) {
      Object.assign(this.state, this.restore);
      this.restore = undefined;
    }
    this.state.comparison = undefined;
    this.state.reconstruction = undefined;
    this.generation++;
    this.task = undefined;
    this.state.checking = false;
    this.state.verdict = undefined;
    this.state.completed = false;
    this.state.reasons = [];
    for (const field of Object.keys(this.state.fields) as Field[])
      if (
        !preserveFields &&
        (!removed.length ||
          (this.state.fields[field]!.scope === "selected" &&
            this.state.fields[field]!.reasonIds.some((id) =>
              removed.includes(id),
            )))
      )
        delete this.state.fields[field];
    this.state.message = "Check accusation";
  }
  private check(claim: Claim): void {
    if (this.task) return;
    if (typeof claim === "object" && !Object.keys(claim).length) {
      this.state.message = "Choose a person or a finding";
      return;
    }
    this.slices = 0;
    this.state.claim = copy(claim);
    this.taskGeneration = this.generation;
    const generation = this.generation;
    const fullRecording =
      claim === "Underdetermined" ||
      (typeof claim === "object" &&
        Object.values(claim).includes("Underdetermined"));
    this.task = proveSteps(
      this.sealed.board,
      this.sealed.clues,
      this.ids,
      claim,
      {
        maxHistories: this.workLimit,
        // Unknown findings need exhaustive compatible histories, not repeated
        // minimisation of grounds for a different, already excluded person.
        minimizeReasons: !fullRecording,
        cancelled: () => this.disposed || generation !== this.generation,
      },
    );
    this.state.checking = true;
    this.state.message = "Checking the evidence";
  }
  private accept(verdict: Verdict): void {
    this.state.checking = false;
    this.state.verdict = verdict;
    this.state.reasons = verdict.reasonIds
      .map((id) => resolveObservation(this.sealed.clues, id))
      .filter((c): c is Clue => !!c);
    this.state.completed = false;
    const messages: Record<Verdict["status"], string> = {
      proved: "The evidence proves this finding",
      contradicted: "This finding conflicts with the evidence",
      needClue: "The evidence leaves this finding open",
      ambiguous:
        verdict.possibleCulprits.length > 1
          ? "Different thefts fit every observation"
          : "Different histories fit every observation",
      conflict: "These observations cannot describe one case",
      incomplete: "The check did not finish. Try again",
    };
    this.state.message = messages[verdict.status];
    if (!["conflict", "incomplete", "contradicted"].includes(verdict.status)) {
      const claims =
        typeof this.state.claim === "string"
          ? { taker: this.state.claim }
          : this.state.claim;
      for (const field of Object.keys(claims) as Field[]) {
        const value = claims[field],
          values = verdict.fieldValues[field] ?? [];
        const known =
          value !== undefined &&
          value !== "Underdetermined" &&
          values.length === 1 &&
          values[0] === value;
        const unknown =
          value === "Underdetermined" &&
          verdict.scope === "all" &&
          values.length > 1;
        if (
          (known || unknown) &&
          this.state.fields[field]?.value !==
            (unknown ? "Could be either" : value)
        )
          this.state.fields[field] = {
            value: unknown ? "Could be either" : value!,
            scope: verdict.scope,
            reasonIds:
              verdict.scope === "all"
                ? this.sealed.clues.clues.map((c) => c.id)
                : [...this.ids],
          };
      }
      this.state.completed = this.state.questionFields.every(
        (field) => !!this.state.fields[field],
      );
    }
  }
  private comparePair(first: History, second: History, all: boolean): void {
    const issue =
      reconstructionIssue(this.sealed.board, first) ??
      reconstructionIssue(this.sealed.board, second);
    if (issue) {
      this.state.message = issue;
      return;
    }
    const a = observe(this.sealed.board, first),
      b = observe(this.sealed.board, second);
    const id = all
      ? compareObservations(a, b)[0]
      : this.ids.find(
          (id) =>
            JSON.stringify(resolveObservation(a, id)) !==
            JSON.stringify(resolveObservation(b, id)),
        );
    const different = id
      ? (resolveObservation(a, id) ?? resolveObservation(this.sealed.clues, id))
      : undefined;
    if (!different) {
      this.state.reasons = [];
      this.state.message = all
        ? "These two histories have the same observations"
        : "These two histories match the selected evidence";
      return;
    }
    this.select(different.id);
    this.state.reasons = [
      copy(different),
      copy(
        resolveObservation(b, different.id) ??
          b.clues.find(
            (c) =>
              c.id ===
              (different.kind === "Frame"
                ? different.observation?.frameId
                : undefined),
          )!,
      ),
    ];
    this.state.message = "These observations differ";
  }
  private compare(history: History, all: boolean): void {
    this.state.comparison = undefined;
    const issue = reconstructionIssue(this.sealed.board, history);
    if (issue) {
      this.state.message = issue;
      this.state.reasons = [];
      return;
    }
    const proposed = observe(this.sealed.board, copy(history));
    const id = compareObservations(
      this.sealed.clues,
      proposed,
      all ? undefined : this.ids,
    )[0];
    const mismatch = id ? resolveObservation(this.sealed.clues, id) : undefined;
    if (mismatch) {
      this.select(mismatch.id);
      this.state.reasons = [
        copy(mismatch),
        copy(
          resolveObservation(proposed, mismatch.id) ??
            proposed.clues.find(
              (c) =>
                c.id ===
                (mismatch.kind === "Frame"
                  ? mismatch.observation?.frameId
                  : undefined),
            )!,
        ),
      ].filter(Boolean);
      this.state.message = "These observations differ";
    } else
      this.state.message = all
        ? "These two histories have the same observations"
        : "These two histories match the selected evidence";
  }
  private emit(): void {
    this.state.canUndoEvidence = !!this.removed;
    this.state.frame =
      this.state.objects.find((c) => c.id === this.state.selected) ??
      this.currentFrame();
    this.state.observations = getObservations(
      this.sealed.clues,
      this.state.source,
      this.state.tick,
    );
    this.state.focusedObservation = this.state.observations.find(
      (c) => c.id === this.state.selected,
    );
    this.state.glass = this.ids.map((id) => ({
      id,
      clue: copy(resolveObservation(this.sealed.clues, id)!),
      selected: id === this.state.selected,
    }));
    this.state.visibleGlass = this.state.glass.slice(
      this.state.glassPage * 3,
      this.state.glassPage * 3 + 3,
    );
    this.port.render(this.snapshot(), copy(this.sealed.board));
  }
}
