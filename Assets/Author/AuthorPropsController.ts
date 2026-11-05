import type { AuthorCommand } from "../Author/AuthorController";
import type { AuthorEdit, AuthorSnapshot } from "../Author/AuthorSession";
import type {
  CaseDraft,
  Field,
  TrackId,
  Vec3,
  Wall,
  Witness,
} from "../Domain/types";
import { poseAt } from "../Domain/geometry";

export const questionLabel: Record<Field, string> = {
  taker: "who takes it",
  recipient: "who receives it",
  cache: "where the ruby ends",
  takeTick: "theft time",
  passTick: "transfer time",
  stashTick: "hiding time",
};
export type PropTool =
  | { kind: "exhibit" }
  | { kind: "camera"; id: string }
  | { kind: "screen"; id: string }
  | { kind: "actor"; track: TrackId; wholeStationaryTrack: boolean };
export interface AuthorPropsPorts {
  changed?(): void;
  mode(): string;
  scope(): string;
  read(): AuthorSnapshot | undefined;
  author(command: AuthorCommand): void;
  flow(
    type: "finishAttempt" | "emptyRoom" | "keepThisRoom",
    confirmed?: boolean,
  ): void;
}
const copy = <T>(value: T): T =>
  value === undefined ? value : JSON.parse(JSON.stringify(value));
const same = (a: unknown, b: unknown) =>
  JSON.stringify(a) === JSON.stringify(b);
const finite = (n: number) => Number.isFinite(n);
const inside = (d: CaseDraft, p: Vec3) =>
  finite(p.x) &&
  finite(p.z) &&
  p.x >= 0 &&
  p.z >= 0 &&
  p.x <= d.room.width &&
  p.z <= d.room.depth;
const centre = (wall: Wall): Vec3 => ({
  x: (wall.a.x + wall.b.x) / 2,
  y: 0,
  z: (wall.a.z + wall.b.z) / 2,
});
export function unplacedDisplay(d: CaseDraft): boolean {
  return !inside(d, d.room.exhibit.position);
}

/** Pure interaction controller. Every mutation goes through existing AuthorCommand/FlowAction.
 * The scope includes both inputEpoch and the real held-input generation. */
export class AuthorPropsController {
  private tool: PropTool | null = null;
  private scope = "";
  private moving = false;
  private moveSerial = 0;
  private invalidDrop = false;
  message = "";
  constructor(private ports: AuthorPropsPorts) {}
  activeTool(): PropTool | null {
    this.sync();
    return this.tool ? copy(this.tool) : null;
  }
  isPlacing(): boolean {
    return !!this.activeTool();
  }
  isMoving(): boolean {
    this.sync();
    return this.moving;
  }
  moveToken(): number {
    this.sync();
    return this.moving ? this.moveSerial : 0;
  }
  sync(): void {
    if (
      this.ports.mode() !== "author" ||
      (this.scope && this.scope !== this.ports.scope()) ||
      (this.moving && !this.ports.read()?.preview)
    ) {
      this.tool = null;
      this.moving = false;
      this.invalidDrop = false;
      this.message = "";
    }
  }
  setQuestionMode(chain: boolean): boolean {
    const a = this.author();
    if (!a) return false;
    this.cancel();
    this.ports.author({
      kind: "edit",
      edit: {
        kind: "setQuestions",
        chain,
        fields: [...(a.draft.fields ?? ["taker"])],
      },
    });
    this.ports.changed?.();
    return this.author()?.draft.chain === chain;
  }
  toggleQuestion(field: Field): boolean {
    const a = this.author();
    if (!a) return false;
    this.cancel();
    const old = a.draft.fields ?? ["taker"];
    const fields = old.includes(field)
      ? old.filter((f) => f !== field)
      : [...old, field];
    this.ports.author({
      kind: "edit",
      edit: { kind: "setQuestions", chain: !!a.draft.chain, fields },
    });
    this.ports.changed?.();
    return same(this.author()?.draft.fields, fields);
  }
  questionSummary(): string {
    const a = this.author();
    if (!a) return "Questions for your friend";
    const fields = a.draft.fields ?? ["taker"];
    return `${a.draft.chain ? "Transfer allows passing and hiding" : "Simple theft requires a theft"}. Your friend must prove ${fields.length ? fields.map((f) => questionLabel[f]).join(", ") : "choose at least one finding"}. ${a.errors.length ? "Draft needs repairs before testing" : "Ready to test"}`;
  }
  startEmpty(): boolean {
    const mode = this.ports.mode();
    if (mode === "detective") this.ports.flow("finishAttempt", true);
    if (!["ready", "finished"].includes(this.ports.mode())) return false;
    this.ports.flow("emptyRoom");
    return this.ports.mode() === "author";
  }
  keepRoom(): boolean {
    if (this.ports.mode() !== "finished") return false;
    this.ports.flow("keepThisRoom");
    return this.ports.mode() === "author";
  }
  choose(tool: PropTool): boolean {
    this.cancel();
    const a = this.author();
    if (!a) return false;
    this.ports.author({
      kind: "select",
      id: tool.kind === "actor" ? tool.track : null,
    });
    if (!this.author()) return false;
    this.scope = this.ports.scope();
    this.tool = copy(tool);
    this.message = "";
    this.ports.changed?.();
    return true;
  }
  chooseExhibit(): boolean {
    return this.choose({ kind: "exhibit" });
  }
  chooseNewCamera(): boolean {
    const a = this.author();
    if (!a || a.draft.witnesses.length >= 2) return false;
    let id = "author-camera-1",
      n = 1;
    while (a.draft.witnesses.some((w) => w.id === id))
      id = "author-camera-" + ++n;
    return this.choose({ kind: "camera", id });
  }
  chooseNewScreen(): boolean {
    const a = this.author();
    if (!a || a.draft.room.walls.length >= 4) return false;
    let id = "author-screen-1",
      n = 1;
    while (a.draft.room.walls.some((w) => w.id === id))
      id = "author-screen-" + ++n;
    return this.choose({ kind: "screen", id });
  }
  chooseActor(track: TrackId): boolean {
    const a = this.author(),
      keys = a?.draft.tracks.find((t) => t.id === track)?.keys;
    if (!keys) return false;
    const first = keys[0];
    return this.choose({
      kind: "actor",
      track,
      wholeStationaryTrack: keys.every(
        (k) => k.x === first.x && k.z === first.z && k.yaw === first.yaw,
      ),
    });
  }
  point(tool = this.activeTool()): Vec3 | undefined {
    const d = this.author()?.draft;
    if (!d || !tool) return undefined;
    if (tool.kind === "exhibit") return copy(d.room.exhibit.position);
    if (tool.kind === "camera")
      return copy(d.witnesses.find((w) => w.id === tool.id)?.position);
    if (tool.kind === "screen") {
      const w = d.room.walls.find((w) => w.id === tool.id);
      return w ? centre(w) : undefined;
    }
    const t = d.tracks.find((t) => t.id === tool.track),
      tick = this.author()!.tick;
    const before = t?.keys.filter((k) => k.tick <= tick).pop() ?? t?.keys[0];
    return before ? { x: before.x, y: 1, z: before.z } : undefined;
  }
  place(point: Vec3): boolean {
    const a = this.author(),
      tool = this.activeTool();
    if (!a || !tool) return false;
    const edit = this.plan(a, tool, point);
    if (!edit) return false;
    this.ports.author({ kind: "edit", edit });
    if (!this.matches(edit, this.author()?.draft)) {
      this.message =
        this.author()?.errors[0]?.message ?? "Choose a free floor point";
      return false;
    }
    this.tool = null;
    this.message = "";
    this.ports.changed?.();
    return true;
  }
  beginMove(tool: PropTool): boolean {
    if (!this.choose(tool)) return false;
    this.ports.author({ kind: "beginGesture" });
    this.moving = !!this.author()?.preview;
    if (this.moving) this.moveSerial++;
    this.ports.changed?.();
    return this.moving;
  }
  preview(point: Vec3, token?: number): boolean {
    if (token !== undefined && token !== this.moveToken()) return false;
    const a = this.author(),
      tool = this.activeTool();
    if (!a || !tool || !this.moving) return false;
    const edit = this.plan(a, tool, point);
    if (!edit) {
      this.invalidDrop = true;
      return false;
    }
    this.ports.author({ kind: "preview", edit });
    this.invalidDrop = !this.matches(edit, this.author()?.draft);
    return !this.invalidDrop;
  }
  finishMove(token?: number): boolean {
    if (token !== undefined && token !== this.moveToken()) return false;
    this.sync();
    if (!this.moving || !this.author()?.preview) {
      this.tool = null;
      this.moving = false;
      return false;
    }
    if (this.invalidDrop) {
      this.cancel();
      return false;
    }
    this.ports.author({ kind: "commitGesture" });
    this.tool = null;
    this.moving = false;
    this.ports.changed?.();
    return true;
  }
  cancel(): void {
    const cancelReal =
      this.moving &&
      this.scope === this.ports.scope() &&
      this.ports.mode() === "author";
    this.tool = null;
    this.moving = false;
    this.invalidDrop = false;
    this.message = "";
    if (cancelReal) this.ports.author({ kind: "cancelGesture" });
    else this.ports.changed?.();
  }
  cancelMove(token: number): void {
    if (token > 0 && token === this.moveToken()) this.cancel();
  }
  turnCamera(id: string): boolean {
    const a = this.author(),
      w = a?.draft.witnesses.find((w) => w.id === id);
    if (!a || !w) return false;
    const edit: AuthorEdit = {
      kind: "setWitness",
      witness: { ...copy(w), yaw: w.yaw + Math.PI / 12 },
    };
    this.ports.author({ kind: "edit", edit });
    return this.matches(edit, this.author()?.draft);
  }
  turnScreen(id: string): boolean {
    const a = this.author(),
      w = a?.draft.room.walls.find((w) => w.id === id);
    if (!a || !w) return false;
    const c = centre(w),
      dx = (w.b.x - w.a.x) / 2,
      dz = (w.b.z - w.a.z) / 2;
    const wall = {
      ...copy(w),
      a: { x: c.x + dz, y: 0, z: c.z - dx },
      b: { x: c.x - dz, y: 0, z: c.z + dx },
    };
    if (!inside(a.draft, wall.a) || !inside(a.draft, wall.b)) {
      this.message = "Keep the screen inside the room";
      return false;
    }
    const edit: AuthorEdit = { kind: "setWall", wall };
    this.ports.author({ kind: "edit", edit });
    return this.matches(edit, this.author()?.draft);
  }
  private author(): AuthorSnapshot | undefined {
    return this.ports.mode() === "author" ? this.ports.read() : undefined;
  }
  private plan(
    a: AuthorSnapshot,
    tool: PropTool,
    p: Vec3,
  ): AuthorEdit | undefined {
    const d = a.draft;
    if (!inside(d, p)) {
      this.message = "Choose a floor point inside the room";
      return undefined;
    }
    if (tool.kind === "exhibit")
      return {
        kind: "movePlace",
        id: d.room.exhibit.id,
        position: { x: p.x, y: 1, z: p.z },
      };
    if (tool.kind === "camera") {
      const existing = d.witnesses.find((w) => w.id === tool.id);
      if (!existing && d.witnesses.length >= 2) return undefined;
      const aim = unplacedDisplay(d)
        ? { x: d.room.width / 2, z: d.room.depth / 2 }
        : d.room.exhibit.position;
      const witness: Witness = existing
        ? {
            ...copy(existing),
            position: { x: p.x, y: existing.position.y, z: p.z },
          }
        : {
            id: tool.id,
            position: { x: p.x, y: 1.6, z: p.z },
            yaw: Math.atan2(aim.x - p.x, aim.z - p.z),
            fov: Math.PI / 2,
            verticalFov: Math.PI / 3,
            near: 0.05,
            far: Math.hypot(d.room.width, d.room.depth) + 2,
          };
      return { kind: "setWitness", witness };
    }
    if (tool.kind === "screen") {
      const existing = d.room.walls.find((w) => w.id === tool.id);
      if (!existing && d.room.walls.length >= 4) return undefined;
      const halfX = existing ? (existing.b.x - existing.a.x) / 2 : 0.625,
        halfZ = existing ? (existing.b.z - existing.a.z) / 2 : 0;
      const wall: Wall = {
        id: tool.id,
        a: { x: p.x - halfX, y: 0, z: p.z - halfZ },
        b: { x: p.x + halfX, y: 0, z: p.z + halfZ },
        bottom: existing?.bottom ?? 0,
        top: existing?.top ?? 2,
      };
      if (!inside(d, wall.a) || !inside(d, wall.b)) {
        this.message = "Keep both screen feet inside the room";
        return undefined;
      }
      return { kind: "setWall", wall };
    }
    const track = d.tracks.find((t) => t.id === tool.track),
      key = track?.keys[0];
    if (!track || !key) return undefined;
    if (tool.wholeStationaryTrack)
      return {
        kind: "setPath",
        track: tool.track,
        keys: [
          { tick: 0, x: p.x, y: 1, z: p.z, yaw: key.yaw },
          { tick: 24, x: p.x, y: 1, z: p.z, yaw: key.yaw },
        ],
      };
    return {
      kind: "setPathKey",
      track: tool.track,
      key: {
        tick: a.tick,
        x: p.x,
        y: 1,
        z: p.z,
        yaw: poseAt(track, a.tick).yaw,
      },
    };
  }
  private matches(edit: AuthorEdit, d: CaseDraft | undefined): boolean {
    if (!d) return false;
    if (edit.kind === "movePlace")
      return same(d.room.exhibit.position, edit.position);
    if (edit.kind === "setWitness")
      return same(
        d.witnesses.find((w) => w.id === edit.witness.id),
        edit.witness,
      );
    if (edit.kind === "setWall")
      return same(
        d.room.walls.find((w) => w.id === edit.wall.id),
        edit.wall,
      );
    if (edit.kind === "setPath")
      return same(d.tracks.find((t) => t.id === edit.track)?.keys, edit.keys);
    if (edit.kind === "setPathKey")
      return same(
        d.tracks
          .find((t) => t.id === edit.track)
          ?.keys.find((k) => k.tick === edit.key.tick),
        edit.key,
      );
    return false;
  }
}
