import { AuthorEdit, AuthorSession, AuthorSnapshot } from "./AuthorSession";
import { TrackId } from "../Domain/types";

export type AuthorCommand =
  | { kind: "edit"; edit: AuthorEdit }
  | { kind: "preview"; edit: AuthorEdit }
  | { kind: "select"; id: string | null }
  | { kind: "setTick"; tick: number }
  | { kind: "stepTick"; delta: -1 | 1 }
  | { kind: "beginRecording"; track: TrackId }
  | { kind: "recordPoint"; point: { x: number; z: number; yaw: number } }
  | { kind: "play" | "pause" | "beginGesture" | "commitGesture" | "cancelGesture" |
      "undo" | "startTest" | "cancelTest" | "confirmAmbiguity" };

/** Integration renders through TableKit and binds SIK to dispatch, never a second clock. */
export interface AuthorPresentationPort {
  render(snapshot: AuthorSnapshot): void;
  /** Remove paths, preview copies, role labels, author input targets and subscriptions. */
  clear(): void;
}

@component
export class AuthorController extends BaseScriptComponent {
  private session: AuthorSession | null = null;
  private port: AuthorPresentationPort | null = null;
  private unsubscribe: (() => void) | null = null;

  onAwake(): void {
    this.createEvent("UpdateEvent").bind(() => {
      if (!this.session) return;
      this.session.advanceTime(getDeltaTime());
      this.session.advanceProof(4);
    });
    this.createEvent("OnDisableEvent").bind(() => this.detach());
    this.createEvent("OnDestroyEvent").bind(() => this.detach());
  }

  mount(session: AuthorSession, port: AuthorPresentationPort): void {
    this.detach(); this.session = session; this.port = port;
    this.unsubscribe = session.subscribe(snapshot => port.render(snapshot));
  }

  dispatch(command: AuthorCommand): boolean {
    const session = this.session; if (!session) return false;
    switch (command.kind) {
      case "edit": return session.edit(command.edit);
      case "preview": return session.previewEdit(command.edit);
      case "select": session.select(command.id); return true;
      case "setTick": return session.setTick(command.tick);
      case "stepTick": session.stepTick(command.delta); return true;
      case "beginRecording": session.beginRecording(command.track); return true;
      case "recordPoint": return session.recordPoint(command.point);
      case "play": session.play(); return true;
      case "pause": session.pause(); return true;
      case "beginGesture": session.beginGesture(); return true;
      case "commitGesture": return session.commitGesture();
      case "cancelGesture": session.cancelGesture(); return true;
      case "undo": return session.undo();
      case "startTest": return session.startTest();
      case "cancelTest": session.cancelTest(); return true;
      case "confirmAmbiguity": return session.confirmAmbiguity();
    }
  }

  /** Role flow retains its session if it needs to reopen; the controller retains nothing. */
  detach(): void {
    if (this.unsubscribe) this.unsubscribe();
    this.unsubscribe = null;
    if (this.session) {
      this.session.cancelGesture(); this.session.pause();
      if (this.session.snapshot().testing) this.session.cancelTest();
    }
    this.session = null;
    if (this.port) this.port.clear();
    this.port = null;
  }
}
