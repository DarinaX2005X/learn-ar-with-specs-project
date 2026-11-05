import {
  CaseDraft,
  CompileResult,
  SealedCase,
  VaultEntry,
  createMuseumTheft,
  createPackingCase,
  compileCase,
} from "../Domain/index";
import { DetectiveArchive } from "../Detective/DetectiveSession";
import { resolveObservation } from "../Domain/observe";
import { caseTitle as title, caseSpine, copiedCaseTitle, generatedCaseTitle } from "./CaseTitles";

export interface CaseRef {
  id: string;
  rev: number;
}
export interface ShelfItem extends CaseRef {
  title: string;
  spine: string;
  state: "Draft" | "Ready to open";
  solved: boolean;
}
interface StoredCase {
  title: string;
  sealed: SealedCase;
  vault: VaultEntry;
}
interface StoredDraft {
  draft: CaseDraft;
  checkpoint?: { tick: number; selected: string | null };
}
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));
function freeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.keys(value).forEach((key) => freeze((value as any)[key]));
    Object.freeze(value);
  }
  return value;
}
const key = (ref: CaseRef): string => JSON.stringify([ref.id, ref.rev]);

/** Private, session-only storage. Only list() and publicCase() may reach the shelf view. */
export class SessionShelf {
  private cases = new Map<string, StoredCase>();
  private drafts = new Map<string, StoredDraft>();
  private solved = new Set<string>();
  private attempts = new Map<string, DetectiveArchive>();
  private sequence = 0;
  private active: CaseRef = { id: "missing-ruby", rev: 1 };

  constructor() {
    // Presentation staging shares the tested optics, while the shelf keeps its
    // established public reference so saved selections and clue IDs stay stable.
    const starter = createMuseumTheft(true);
    starter.id = "missing-ruby";
    for (const draft of [starter, createPackingCase()]) {
      const result = compileCase(draft);
      if (result.ok === false) throw new Error("Reload case");
      this.store(result);
    }
  }
  list(): ShelfItem[] {
    const ready: ShelfItem[] = Array.from(this.cases.values()).map((entry) => ({
      id: entry.sealed.caseId,
      rev: entry.sealed.rev,
      title: entry.title,
      spine:
        caseSpine(entry.title),
      state: "Ready to open" as const,
      solved: this.solved.has(
        key({ id: entry.sealed.caseId, rev: entry.sealed.rev }),
      ),
    }));
    return ready.concat(
      Array.from(this.drafts.values()).map(({ draft }) => ({
        id: draft.id,
        rev: draft.rev,
        title: draft.title,
        spine:
          caseSpine(draft.title),
        state: "Draft" as const,
        solved: false,
      })),
    );
  }
  activeRef(): CaseRef {
    return clone(this.active);
  }
  select(ref: CaseRef): boolean {
    if (!this.cases.has(key(ref))) return false;
    this.active = clone(ref);
    return true;
  }
  publicCase(ref: CaseRef): SealedCase | undefined {
    return this.cases.get(key(ref))?.sealed;
  }
  caseTitle(ref: CaseRef): string | undefined {
    return this.cases.get(key(ref))?.title;
  }
  /** Idempotent for the same exact seal; a reused revision can never overwrite its original. */
  store(result: Extract<CompileResult, { ok: true }>): CaseRef {
    const ref = { id: result.sealed.caseId, rev: result.sealed.rev };
    if (
      ref.id !== result.vault.sourceDraft.id ||
      ref.rev !== result.vault.sourceDraft.rev ||
      ref.id !== result.sealed.clues.caseId ||
      ref.rev !== result.sealed.clues.rev
    )
      throw new Error("The case revision does not match its recording");
    const existing = this.cases.get(key(ref));
    if (existing) {
      if (JSON.stringify(existing.sealed) !== JSON.stringify(result.sealed))
        throw new Error("This revision is already sealed");
      return ref;
    }
    this.cases.set(
      key(ref),
      freeze({
        title: title(result.vault.sourceDraft.title),
        sealed: clone(result.sealed),
        vault: clone(result.vault),
      }),
    );
    this.drafts.delete(ref.id);
    return ref;
  }
  saveDraft(draft: CaseDraft, checkpoint?: StoredDraft["checkpoint"]): void {
    const saved = clone(draft);
    saved.title = title(saved.title);
    this.drafts.set(
      saved.id,
      freeze({
        draft: saved,
        checkpoint: checkpoint ? clone(checkpoint) : undefined,
      }),
    );
  }
  draft(id: string): StoredDraft | undefined {
    const value = this.drafts.get(id);
    return value ? clone(value) : undefined;
  }
  fork(ref: CaseRef): CaseDraft | undefined {
    const entry = this.cases.get(key(ref));
    if (!entry) return undefined;
    const draft = clone(entry.vault.sourceDraft);
    draft.id = "local-case-" + ++this.sequence;
    draft.rev = 1;
    draft.title = copiedCaseTitle(entry.title, this.sequence);
    return draft;
  }
  markSolved(ref: CaseRef): boolean {
    if (!this.cases.has(key(ref))) return false;
    this.solved.add(key(ref));
    return true;
  }
  saveAttempt(saved: DetectiveArchive): boolean {
    const ref = { id: saved.caseId, rev: saved.rev };
    const sealed = this.publicCase(ref);
    if (
      !sealed ||
      !Number.isInteger(saved.tick) ||
      saved.tick < 0 ||
      saved.tick > 24 ||
      saved.ids.some((id) => !resolveObservation(sealed.clues, id)) ||
      (saved.source !== "rim" &&
        !saved.source.startsWith("box:") &&
        !sealed.board.witnesses.some((source) => source.id === saved.source))
    )
      return false;
    this.attempts.set(key(ref), freeze(clone(saved)));
    return true;
  }
  attempt(ref: CaseRef): DetectiveArchive | undefined {
    const saved = this.attempts.get(key(ref));
    return saved ? clone(saved) : undefined;
  }
  /** Never infer completion from an accused name or hidden author truth. */
  reveal(ref: CaseRef): VaultEntry | undefined {
    if (!this.solved.has(key(ref))) return undefined;
    const vault = this.cases.get(key(ref))?.vault;
    return vault ? clone(vault) : undefined;
  }
  keepRoom(ref: CaseRef): CaseDraft | undefined {
    const draft = this.fork(ref);
    if (!draft) return undefined;
    draft.title = generatedCaseTitle(this.caseTitle(ref)!, "Room", this.sequence);
    draft.tracks = [
      {
        id: "A",
        keys: [
          { tick: 0, x: 0.6, z: 0.6, yaw: 0 },
          { tick: 24, x: 0.6, z: 0.6, yaw: 0 },
        ],
      },
      {
        id: "B",
        keys: [
          { tick: 0, x: 1.3, z: 0.6, yaw: 0 },
          { tick: 24, x: 1.3, z: 0.6, yaw: 0 },
        ],
      },
      {
        id: "C",
        keys: [
          { tick: 0, x: 2, z: 0.6, yaw: 0 },
          { tick: 24, x: 2, z: 0.6, yaw: 0 },
        ],
      },
    ];
    draft.casting = { A: "Courier", B: "Guard", C: "Conservator" };
    draft.unplacedTracks = ["A", "B", "C"];
    draft.events = [];
    draft.chain = false;
    draft.fields = ["taker"];
    return draft;
  }
  emptyRoom(): CaseDraft {
    const draft = this.keepRoom({ id: "missing-ruby", rev: 1 })!;
    draft.title = "Empty room";
    draft.room.walls = [];
    draft.room.mirror = undefined;
    draft.room.boxes = [];
    draft.witnesses = [];
    // The exhibit remains a tray item until the author places it on the floor.
    draft.room.exhibit.position = { x: -1, y: 1, z: -1 };
    return draft;
  }
}
