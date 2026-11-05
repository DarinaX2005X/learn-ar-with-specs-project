import {
  CaseDraft,
  CompileResult,
  SealedCase,
  VaultEntry,
} from "../Domain/index";
import {CaseRef, SessionShelf, ShelfItem} from '../Shelf/SessionShelf';

export type BuiltinId = "missing-ruby" | "packing-room";
export type FlowMode =
  "ready" | "author" | "handoff" | "detective" | "finished";
export interface AuthorCheckpoint {
  tick: number;
  selected: string | null;
}
export interface AuthorHandle {
  getDraft(): CaseDraft;
  checkpoint(): AuthorCheckpoint;
  seal(): CompileResult;
  dispose(): void;
}
/** A mount owns all its renderers, input subscriptions, audio and grabbed objects. */
export interface RoleMount {
  detach(): void;
}
export interface CasePorts {
  createAuthor(draft: CaseDraft, checkpoint?: AuthorCheckpoint): AuthorHandle;
  mountAuthor(author: AuthorHandle, inputEpoch: number): RoleMount;
  mountDetective(sealed: SealedCase, inputEpoch: number): RoleMount;
  /** Must remove privileged layers before displaying the closed lid. */
  closeLid(): void;
  openLid(): void;
  cancelInput(): void;
  show(state: FlowState): void;
  reveal?(vault: VaultEntry, inputEpoch: number): RoleMount;
}
export interface FlowState {
  mode: FlowMode;
  title: string;
  caseId: string;
  revision: number;
  primary: string;
  message: string;
  inputEpoch: number;
  hasDraft: boolean;
  tutorial: boolean;
  shelf: ShelfItem[];
}
interface ReadyCase {
  title: string;
  sealed: SealedCase;
}
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));
function freeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.keys(value).forEach((key) => freeze((value as any)[key]));
    Object.freeze(value);
  }
  return value;
}

/** Session-only role boundary. Public snapshots contain no draft, casting or vault. */
export class CaseFlow {
  private mode: FlowMode = "ready";
  private active: ReadyCase;
  private author: AuthorHandle | undefined;
  private mount: RoleMount | undefined;
  private pending: ReadyCase | undefined;
  private returnDraft: CaseDraft | undefined;
  private returnCheckpoint: AuthorCheckpoint | undefined;
  private shelf: SessionShelf;
  private epoch = 0;
  private tutorial = true;
  private message = "";

  constructor(private ports: CasePorts, shelf = new SessionShelf()) {
    this.shelf = shelf;
    const ref = shelf.activeRef();
    this.active = {title: shelf.caseTitle(ref)!, sealed: shelf.publicCase(ref)!};
    this.emit();
  }
  snapshot(): FlowState {
    const active = this.pending || this.active;
    const draft =
      this.mode === "author" && this.author
        ? this.author.getDraft()
        : undefined;
    return {
      mode: this.mode,
      title: draft ? draft.title : active.title,
      caseId: draft ? draft.id : active.sealed.caseId,
      revision: draft ? draft.rev : active.sealed.rev,
      primary:
        this.mode === "handoff"
          ? "Open the case"
          : this.mode === "ready"
            ? "Replay the alarm"
            : this.mode === "finished"
              ? "Replay the evidence"
              : "",
      message:
        this.message || (this.mode === "handoff" ? "Hand over the device" : ""),
      inputEpoch: this.epoch,
      hasDraft: !!this.author || !!this.returnDraft,
      tutorial: this.tutorial,
      shelf: this.shelf.list(),
    };
  }
  private emit(): void {
    this.ports.show(this.snapshot());
  }
  /** Reject callbacks from controls held across a role transition. */
  acceptsInput(epoch: number): boolean {
    return epoch === this.epoch;
  }
  private detach(): void {
    ++this.epoch;
    this.ports.cancelInput();
    if (this.mount) this.mount.detach();
    this.mount = undefined;
  }
  replayAlarm(): boolean {
    if (this.mode !== "ready") return false;
    this.detach();
    this.mode = "detective";
    this.mount = this.ports.mountDetective(this.active.sealed, this.epoch);
    this.ports.openLid();
    this.emit();
    return true;
  }
  skipTutorial(): void {
    this.tutorial = false;
    this.emit();
  }
  repeatHelp(): void {
    this.tutorial = true;
    this.emit();
  }
  stageTheft(): boolean {
    if (this.mode !== "ready") return false;
    const source = this.shelf.fork(this.activeRef());
    if (!source) return false;
    return this.edit(source);
  }
  resumeDraft(): boolean {
    if (this.mode !== "ready" || !this.returnDraft) return false;
    return this.edit(clone(this.returnDraft), this.returnCheckpoint);
  }
  leaveAuthor(): boolean {
    if (this.mode !== "author" || !this.author) return false;
    this.returnDraft = this.author.getDraft();
    this.returnCheckpoint = this.author.checkpoint();
    this.shelf.saveDraft(this.returnDraft, this.returnCheckpoint);
    this.detach();
    this.author.dispose();
    this.author = undefined;
    this.mode = "ready";
    this.message = "";
    this.ports.closeLid();
    this.emit();
    return true;
  }
  private edit(draft: CaseDraft, checkpoint?: AuthorCheckpoint): boolean {
    this.detach();
    this.author = this.ports.createAuthor(clone(draft), checkpoint);
    this.mode = "author";
    this.mount = this.ports.mountAuthor(this.author, this.epoch);
    this.ports.openLid();
    this.message = "";
    this.emit();
    return true;
  }
  /** Ask the author gate itself; callers cannot substitute an untested compile result. */
  passCase(): boolean {
    if (this.mode !== "author" || !this.author) return false;
    const result = this.author.seal();
    if (result.ok === false) {
      this.message =
        result.errors[0]?.message ||
        "Test this revision before handing it over";
      this.emit();
      return false;
    }
    const draft = this.author.getDraft();
    if (
      draft.id !== result.sealed.caseId ||
      draft.rev !== result.sealed.rev ||
      result.sealed.clues.caseId !== draft.id ||
      result.sealed.clues.rev !== draft.rev
    ) {
      this.message = "Test this revision before handing it over";
      this.emit();
      return false;
    }
    this.pending = freeze({ title: draft.title, sealed: clone(result.sealed) });
    this.returnDraft = clone(draft);
    this.returnCheckpoint = this.author.checkpoint();
    try { this.shelf.store(result); }
    catch (_) { this.pending = undefined; this.message = 'The case could not be sealed. Try again'; this.emit(); return false; }
    this.detach();
    this.author.dispose();
    this.author = undefined;
    this.ports.closeLid();
    this.mode = "handoff";
    this.message = "";
    this.emit();
    return true;
  }
  cancelHandoff(): boolean {
    if (this.mode !== "handoff" || !this.returnDraft) return false;
    this.pending = undefined;
    return this.edit(this.returnDraft, this.returnCheckpoint);
  }
  openCase(): boolean {
    if (this.mode !== "handoff" || !this.pending) return false;
    this.detach();
    this.active = this.pending;
    this.shelf.select(this.activeRef());
    this.pending = undefined;
    this.mode = "detective";
    // No author reference or privileged payload crosses this call.
    this.mount = this.ports.mountDetective(this.active.sealed, this.epoch);
    this.ports.openLid();
    this.emit();
    return true;
  }
  finishAttempt(confirmed: boolean): boolean {
    if (!confirmed || (this.mode !== "detective" && this.mode !== "finished"))
      return false;
    this.detach();
    this.mode = "ready";
    this.message = "";
    this.ports.closeLid();
    this.emit();
    return true;
  }
  markSolved(): boolean {
    if (this.mode !== "detective") return false;
    this.shelf.markSolved(this.activeRef());
    this.mode = "finished";
    this.emit();
    return true;
  }
  replayEvidence(): boolean {
    if (this.mode !== "finished") return false;
    this.detach();
    this.mode = "detective";
    this.mount = this.ports.mountDetective(this.active.sealed, this.epoch);
    this.emit();
    return true;
  }
  selectCase(id: BuiltinId): boolean {
    return this.selectSavedCase(id, 1);
  }
  private activeRef(): CaseRef { return {id: this.active.sealed.caseId, rev: this.active.sealed.rev}; }
  selectSavedCase(id: string, rev: number): boolean {
    if (this.mode !== 'ready') return false;
    const ref = {id, rev};
    const sealed = this.shelf.publicCase(ref);
    if (!sealed || !this.shelf.select(ref)) return false;
    this.active = {title: this.shelf.caseTitle(ref)!, sealed};
    this.message = ''; this.emit(); return true;
  }
  resumeSavedDraft(id: string): boolean {
    if (this.mode !== 'ready') return false;
    const saved = this.shelf.draft(id);
    return saved ? this.edit(saved.draft, saved.checkpoint) : false;
  }
  editThisCase(): boolean {
    if (this.mode !== 'finished') return false;
    const draft = this.shelf.fork(this.activeRef());
    return draft ? this.edit(draft) : false;
  }
  keepThisRoom(): boolean {
    if (this.mode !== 'finished') return false;
    const draft = this.shelf.keepRoom(this.activeRef());
    return draft ? this.edit(draft) : false;
  }
  emptyRoom(): boolean {
    if (this.mode !== 'ready' && this.mode !== 'finished') return false;
    return this.edit(this.shelf.emptyRoom());
  }
  revealTheft(caseId: string, rev: number): boolean {
    if (this.mode !== 'finished' || !this.ports.reveal || caseId !== this.active.sealed.caseId || rev !== this.active.sealed.rev) return false;
    const vault = this.shelf.reveal({id: caseId, rev});
    if (!vault) return false;
    this.detach(); this.mount = this.ports.reveal(vault, this.epoch); this.emit(); return true;
  }
  dispose(): void {
    this.detach();
    if (this.author) this.author.dispose();
    this.author = undefined;
    this.pending = undefined;
  }
}
