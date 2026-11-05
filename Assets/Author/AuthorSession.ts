import { CaseDraft, CompileResult, DomainError, Event, Field, Key, Role, TrackId, Vec3, Verdict, Wall, Witness } from "../Domain/types";
import { clone, compileCase, freeze } from "../Domain/compile";
import { proveSteps } from "../Domain/prove";

export type AuthorEdit =
  | { kind: "setPathKey"; track: TrackId; key: Key }
  | { kind: "setPath"; track: TrackId; keys: Key[] }
  | { kind: "assignRole"; track: TrackId; role: Role }
  | { kind: "movePlace"; id: string; position: Vec3 }
  | { kind: "setWitness"; witness: Witness }
  | { kind: "setWall"; wall: Wall }
  | { kind: "setAperture"; aperture: number }
  | { kind: "setAlarm"; tick: number }
  | { kind: "stageTake"; track: TrackId; tick: number }
  | { kind: "setEvent"; event: Event }
  | { kind: "removeEvent"; eventKind: Event["kind"]; track?: TrackId }
  | { kind: "setQuestions"; chain: boolean; fields: Field[] };

export interface AuthorCheckpoint { tick: number; selected: string | null }
export interface AuthorSnapshot extends AuthorCheckpoint {
  draft: CaseDraft;
  preview: boolean;
  playing: boolean;
  recordingTrack: TrackId | null;
  errors: DomainError[];
  testing: boolean;
  verdict: Verdict | null;
  testedRev: number | null;
  canSeal: boolean;
  needsAmbiguityConfirmation: boolean;
  canUndo: boolean;
}
export type AuthorSealResult = CompileResult | { ok: false; errors: DomainError[] };
type GoodCompile = Extract<CompileResult, { ok: true }>;
const tickValid = (tick: number) => Number.isInteger(tick) && tick >= 0 && tick <= 24;
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** Owns only the author's mutable copy. All public evidence comes from the domain compiler. */
export class AuthorSession {
  private draft: CaseDraft;
  private tick = 0;
  private selected: string | null = null;
  private playing = false;
  private remainder = 0;
  private preview: CaseDraft | null = null;
  private recording: TrackId | null = null;
  private recordingPoint: { x: number; z: number; yaw: number } | null = null;
  private undoStack: CaseDraft[] = [];
  private errors: DomainError[] = [];
  private tested: GoodCompile | null = null;
  private verdict: Verdict | null = null;
  private confirmedRev: number | null = null;
  private proof: ReturnType<typeof proveSteps> | null = null;
  private proofRev: number | null = null;
  private sealed: GoodCompile | null = null;
  private listeners: ((snapshot: AuthorSnapshot) => void)[] = [];
  private disposed = false;

  constructor(source: CaseDraft, checkpoint?: AuthorCheckpoint) {
    this.draft = clone(source);
    if (checkpoint) { this.setTick(checkpoint.tick); this.selected = checkpoint.selected; }
  }

  static createCopy(source: CaseDraft, id: string): AuthorSession {
    const draft = clone(source);
    draft.id = id;
    draft.rev = 0;
    draft.title = `${source.title.slice(0, 35)} Copy`;
    return new AuthorSession(draft);
  }

  getDraft(): CaseDraft { return clone(this.draft); }
  checkpoint(): AuthorCheckpoint { return { tick: this.tick, selected: this.selected }; }
  /** Read the existing playback clock without changing recorded observation time. */
  presentationTick(): number { return Math.min(24, this.tick + (this.playing ? this.remainder / .5 : 0)); }
  snapshot(): AuthorSnapshot {
    const ambiguous = (this.verdict?.possibleCulprits.length ?? 0) > 1;
    return freeze({
      ...this.checkpoint(), draft: clone(this.preview ?? this.draft), preview: !!this.preview,
      playing: this.playing, recordingTrack: this.recording, errors: clone(this.errors), testing: !!this.proof,
      verdict: this.verdict ? clone(this.verdict) : null,
      testedRev: this.tested?.sealed.rev ?? null,
      canSeal: !this.disposed && !this.preview && !!this.tested && !this.proof &&
        this.tested.sealed.rev === this.draft.rev && !!this.verdict &&
        !["conflict", "incomplete"].includes(this.verdict.status) &&
        this.verdict.possibleCulprits.length > 0 && (!ambiguous || this.confirmedRev === this.draft.rev),
      needsAmbiguityConfirmation: ambiguous && this.confirmedRev !== this.draft.rev,
      canUndo: this.undoStack.length > 0,
    });
  }
  subscribe(listener: (snapshot: AuthorSnapshot) => void): () => void {
    this.listeners.push(listener); listener(this.snapshot());
    return () => { this.listeners = this.listeners.filter(x => x !== listener); };
  }
  private emit(): void { if (!this.disposed) { const value = this.snapshot(); this.listeners.slice().forEach(fn => fn(value)); } }
  private fail(code: string, object: string, message: string, tick?: number): false {
    this.errors = [{ code, object, message, ...(tick === undefined ? {} : { tick }) }]; this.emit(); return false;
  }
  select(id: string | null): void { this.cancelGesture(); this.selected = id; this.emit(); }
  setTick(tick: number): boolean {
    if (!tickValid(tick)) return this.fail("TICK", "clock", "Choose a step from 0 to 24.");
    this.tick = tick; this.remainder = 0; this.emit(); return true;
  }
  stepTick(delta: -1 | 1): void { this.pause(); this.setTick(Math.max(0, Math.min(24, this.tick + delta))); }
  play(): void { this.cancelGesture(); if (this.tick === 24) this.tick = 0; this.playing = true; this.emit(); }
  pause(): void { this.playing = false; this.emit(); }
  advanceTime(seconds: number): void {
    if (!this.playing || !Number.isFinite(seconds) || seconds <= 0) return;
    this.remainder += seconds;
    const steps = Math.floor(this.remainder / 0.5);
    if (!steps) return;
    this.remainder -= steps * 0.5;
    const end = Math.min(24, this.tick + steps);
    while (this.tick < end) {
      this.tick++;
      if (this.recording && this.recordingPoint) this.previewEdit({
        kind: "setPathKey", track: this.recording, key: { tick: this.tick, ...this.recordingPoint },
      });
    }
    if (this.tick === 24) this.playing = false;
    this.emit();
  }
  beginGesture(): void { if (this.disposed) return; this.pause(); this.preview = clone(this.draft); this.errors = []; this.emit(); }
  beginRecording(track: TrackId): void {
    this.cancelGesture(); this.beginGesture(); this.tick = 0; this.selected = track;
    this.recording = track; this.recordingPoint = null; this.playing = true; this.remainder = 0; this.emit();
  }
  recordPoint(point: { x: number; z: number; yaw: number }): boolean {
    if (!this.recording) return false;
    if (!this.previewEdit({ kind: "setPathKey", track: this.recording, key: { tick: this.tick, ...point } })) return false;
    this.recordingPoint = { ...point }; return true;
  }
  cancelGesture(): void {
    if (!this.preview) return;
    if (this.recording) this.playing = false;
    this.recording = null; this.recordingPoint = null; this.preview = null; this.errors = []; this.emit();
  }
  previewEdit(edit: AuthorEdit): boolean {
    if (!this.preview) this.beginGesture();
    const candidate = clone(this.preview!);
    if (!this.apply(candidate, edit)) return false;
    this.preview = candidate; this.errors = this.validate(candidate); this.emit(); return true;
  }
  commitGesture(): boolean {
    if (!this.preview) return false;
    if (this.recording) this.playing = false;
    this.recording = null; this.recordingPoint = null;
    const candidate = this.preview; this.preview = null;
    return this.commit(candidate);
  }
  edit(edit: AuthorEdit): boolean {
    if (this.disposed) return false;
    this.cancelGesture(); const candidate = clone(this.draft);
    if (!this.apply(candidate, edit)) return false;
    return this.commit(candidate);
  }
  private apply(d: CaseDraft, edit: AuthorEdit): boolean {
    // The alarm sounds when the chosen player lifts the ruby. Validate both
    // changes on this candidate so an unreachable attempt leaves the case intact.
    if (edit.kind === "stageTake") {
      d.alarmTick = edit.tick;
      edit = { kind: "setEvent", event: { kind: "Take", track: edit.track, tick: edit.tick } };
    }
    switch (edit.kind) {
      case "setPathKey": {
        const track = d.tracks.find(t => t.id === edit.track);
        if (!track) return this.fail("TRACK", edit.track, "Choose a figure.");
        const keys = track.keys.filter(k => k.tick !== edit.key.tick);
        keys.push({ ...edit.key, y: 1 }); keys.sort((a,b) => a.tick-b.tick); track.keys = keys; break;
      }
      case "setPath": {
        const track = d.tracks.find(t => t.id === edit.track);
        if (!track) return this.fail("TRACK", edit.track, "Choose a figure.");
        track.keys = edit.keys.map(k => ({ ...k, y: 1 })); break;
      }
      case "assignRole": {
        const other = d.tracks.find(t => d.casting[t.id] === edit.role);
        if (!other) return this.fail("CASTING", edit.track, "Choose a museum figure.");
        d.casting[other.id] = d.casting[edit.track]; d.casting[edit.track] = edit.role; break;
      }
      case "movePlace": {
        const place = [d.room.exhibit, ...(d.room.boxes ?? [])].find(p => p.id === edit.id);
        if (!place) return this.fail("PLACE", edit.id, "Choose the display or a box.");
        place.position = { ...edit.position, y: 1 }; break;
      }
      case "setWitness": {
        const index = d.witnesses.findIndex(w => w.id === edit.witness.id);
        if (index < 0 && d.witnesses.length === 2) return this.fail("WITNESSES", edit.witness.id, "Keep at most two cameras.");
        if (index < 0) d.witnesses.push(clone(edit.witness)); else d.witnesses[index] = clone(edit.witness); break;
      }
      case "setWall": {
        const index = d.room.walls.findIndex(w => w.id === edit.wall.id);
        if (index < 0) d.room.walls.push(clone(edit.wall)); else d.room.walls[index] = clone(edit.wall); break;
      }
      case "setAperture":
        if (!d.room.mirror) return this.fail("MIRROR", "mirror", "Choose a case with a mirror.");
        d.room.mirror.aperture = edit.aperture; break;
      case "setAlarm":
        if (!tickValid(edit.tick)) return this.fail("TICK", "alarm", "Choose a step from 0 to 24.");
        d.alarmTick = edit.tick;
        d.events = d.events.map(e => e.kind === "Take" ? { ...e, tick: edit.tick } : e); break;
      case "setEvent": {
        const e = edit.event;
        d.events = d.events.filter(x => x.kind !== e.kind || (e.kind === "BrushRim" && "track" in x && x.track !== e.track));
        d.events.push(clone(e)); break;
      }
      case "removeEvent":
        d.events = d.events.filter(e => e.kind !== edit.eventKind || (edit.track !== undefined && "track" in e && e.track !== edit.track)); break;
      case "setQuestions": d.chain = edit.chain; d.fields = [...edit.fields]; break;
    }
    const errors = this.validate(d);
    // Geometry may invalidate an existing event. Keep that visible and editable.
    // A newly offered transfer itself must already be physically possible.
    const blocking = errors.filter(e =>
      !["TAKE_COUNT", "TAKE_REACH", "BRUSH_REACH", "PASS_REACH", "STASH_REACH", "CHAIN_COUNT"].includes(e.code) ||
      (edit.kind === "setEvent" && (
        (edit.event.kind === "Take" && ["TAKE_REACH", "TAKE_COUNT"].includes(e.code)) ||
        (edit.event.kind === "BrushRim" && e.code === "BRUSH_REACH") ||
        (edit.event.kind === "Pass" && ["PASS_REACH", "CHAIN_COUNT"].includes(e.code)) ||
        (edit.event.kind === "Stash" && ["STASH_REACH", "CHAIN_COUNT"].includes(e.code))
      )));
    if (blocking.length) { this.errors = blocking; this.emit(); return false; }
    return true;
  }
  private validate(d: CaseDraft): DomainError[] { const result = compileCase(d); return result.ok === false ? result.errors : []; }
  private invalidate(): void {
    this.proof = null; this.proofRev = null; this.tested = null; this.verdict = null;
    this.confirmedRev = null; this.sealed = null;
  }
  private commit(candidate: CaseDraft): boolean {
    if (same(candidate, this.draft)) { this.emit(); return true; }
    this.undoStack.push(clone(this.draft));
    if (this.undoStack.length > 32) this.undoStack.shift();
    candidate.rev = this.draft.rev + 1; this.draft = clone(candidate);
    this.invalidate(); this.errors = this.validate(this.draft); this.emit(); return true;
  }
  undo(): boolean {
    this.cancelGesture(); const previous = this.undoStack.pop(); if (!previous) return false;
    previous.rev = this.draft.rev + 1; this.draft = previous; this.invalidate();
    this.errors = this.validate(this.draft); this.emit(); return true;
  }
  startTest(): boolean {
    if (this.disposed || this.preview || this.proof) return false;
    const result = compileCase(this.draft); this.invalidate();
    if (result.ok === false) { this.errors = result.errors; this.emit(); return false; }
    this.errors = []; this.tested = result; this.proofRev = this.draft.rev;
    this.proof = proveSteps(result.sealed.board, result.sealed.clues, [], "Underdetermined");
    this.emit(); return true;
  }
  advanceProof(budget = 4): void {
    const task = this.proof; if (!task) return;
    for (let i = 0; i < Math.max(1, Math.min(32, budget)); i++) {
      const step = task.next();
      if (step.done) {
        if (this.proof === task && this.proofRev === this.draft.rev) {
          this.verdict = step.value; this.proof = null; this.emit();
        }
        return;
      }
    }
  }
  cancelTest(): void { this.invalidate(); this.emit(); }
  confirmAmbiguity(): boolean {
    if (!this.tested || this.tested.sealed.rev !== this.draft.rev || this.proof ||
      !this.verdict || this.verdict.status !== "ambiguous") return false;
    this.confirmedRev = this.draft.rev; this.emit(); return true;
  }
  seal(): AuthorSealResult {
    if (!this.snapshot().canSeal || !this.tested) return { ok: false, errors: [{
      code: "TEST_REQUIRED", object: "case", message: "Test this version before passing the case.",
    }] };
    if (!this.sealed) this.sealed = freeze(clone(this.tested));
    return this.sealed;
  }
  /** Try a change in isolation; accepting it remains one reversible author edit. */
  tryChange(): AuthorSession { return new AuthorSession(this.draft, this.checkpoint()); }
  acceptChange(trial: AuthorSession, expectedRev: number): boolean {
    if (expectedRev !== this.draft.rev) return this.fail("REVISION", "case", "The case changed. Try this change again.");
    const candidate = trial.getDraft(); candidate.id = this.draft.id; candidate.rev = this.draft.rev;
    return this.commit(candidate);
  }
  dispose(): void {
    this.cancelGesture(); this.pause(); this.invalidate(); this.listeners = []; this.disposed = true;
  }
}
