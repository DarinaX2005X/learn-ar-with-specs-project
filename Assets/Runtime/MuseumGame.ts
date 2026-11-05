import {
  AuthorController,
  AuthorCommand,
  AuthorPresentationPort,
} from "../Author/AuthorController";
import { AuthorSession } from "../Author/AuthorSession";
import { CaseFlow, FlowState } from "../Cases/CaseFlow";
import {
  DetectiveAction,
  DetectiveSession,
} from "../Detective/DetectiveSession";
import { VaultEntry } from "../Domain/types";
import { SessionShelf } from "../Shelf/SessionShelf";
import { PlayTable, PlayTableSnapshot } from "./PlayTable";

export interface MuseumTable {
  render(snapshot: PlayTableSnapshot): void;
  dispose(): void;
}
export interface MuseumAuthorController {
  mount(session: AuthorSession, port: AuthorPresentationPort): void;
  dispatch(command: AuthorCommand): boolean;
  detach(): void;
}
export interface MuseumGamePorts {
  renderScene(snapshot: PlayTableSnapshot, reveal?: VaultEntry): void;
  clearScene(): void;
  setLid(closed: boolean): void;
  cancelInput(): void;
  createTable?(
    root: SceneObject,
    dispatch: (action: string, payload?: unknown) => boolean,
  ): MuseumTable;
  /** Tests may supply a controller; production uses the real Lens component and its UpdateEvent. */
  createAuthorController?(root: SceneObject): MuseumAuthorController;
}

/** Owns role lifetimes. The author controller owns author time; update owns detective time. */
export class MuseumGame {
  private flow: CaseFlow | undefined;
  private table: MuseumTable | undefined;
  private author: AuthorSession | undefined;
  private detective: DetectiveSession | undefined;
  private controller: MuseumAuthorController | undefined;
  private controllerObject: SceneObject | undefined;
  private state: PlayTableSnapshot | undefined;
  private revealed: VaultEntry | undefined;
  private revealView: PlayTableSnapshot | undefined;
  private disposed = false;
  private mounting = false;
  private shelf = new SessionShelf();
  constructor(
    private root: SceneObject,
    private ports: MuseumGamePorts,
  ) {}
  mount(): void {
    if (this.flow || this.disposed) return;
    this.table = this.ports.createTable
      ? this.ports.createTable(this.root, (a, p) => this.dispatch(a, p))
      : new PlayTable(this.root, { dispatch: (a, p) => this.dispatch(a, p) });
    if (this.ports.createAuthorController)
      this.controller = this.ports.createAuthorController(this.root);
    else {
      this.controllerObject =
        global.scene.createSceneObject("AuthorController");
      this.controllerObject.setParent(this.root);
      this.controller = this.controllerObject.createComponent(
        AuthorController.getTypeName(),
      ) as AuthorController;
    }
    this.flow = new CaseFlow(
      {
        createAuthor: (draft, checkpoint) => {
          const session = new AuthorSession(draft, checkpoint);
          this.author = session;
          return session;
        },
        mountAuthor: (handle) => {
          const session = handle as AuthorSession;
          this.author = session;
          this.mounting = true;
          this.controller!.mount(session, {
            render: (author) => {
              if (this.state) {
                this.state = { flow: this.state.flow, author };
                if (!this.mounting) this.render();
              }
            },
            clear: () => this.clearRole(),
          });
          this.mounting = false;
          return {
            detach: () => {
              this.controller!.detach();
              this.author = undefined;
            },
          };
        },
        mountDetective: (sealed) => {
          this.mounting = true;
          const session = new DetectiveSession(sealed, {
            render: (detective, board) => {
              if (this.state) {
                this.state = { flow: this.state.flow, detective, board };
                if (!this.mounting) this.render();
              }
            },
            clear: () => this.clearRole(),
            revealTheft: (id, rev) => {
              this.flow!.markSolved();
              this.flow!.revealTheft(id, rev);
            },
            returnToCases: () => this.flow!.finishAttempt(true),
          });
          this.detective = session;
          this.mounting = false;
          return {
            detach: () => {
              session.dispose();
              if (this.detective === session) this.detective = undefined;
            },
          };
        },
        closeLid: () => this.ports.setLid(true),
        openLid: () => this.ports.setLid(false),
        cancelInput: () => this.ports.cancelInput(),
        show: (flow) => this.show(flow),
        reveal: (vault) => {
          this.revealed = vault;
          if (this.revealView) this.state = this.revealView;
          this.revealView = undefined;
          return {
            detach: () => {
              this.revealed = undefined;
              this.clearRole();
            },
          };
        },
      },
      this.shelf,
    );
    // The player arrives inside the public room. Role choice belongs to the
    // physical case on the workbench, rather than an entry menu.
    this.flow.replayAlarm();
  }
  private clearRole(): void {
    this.revealed = undefined;
    if (this.state) this.state = { flow: this.state.flow };
    this.ports.clearScene();
  }
  private show(flow: FlowState): void {
    const old = this.state;
    const readyBoard =
      flow.mode === "ready"
        ? this.shelf.publicCase({ id: flow.caseId, rev: flow.revision })?.board
        : undefined;
    this.state = {
      flow,
      ...(readyBoard ? { board: readyBoard } : {}),
      ...(flow.mode === "author" && this.author
        ? { author: this.author.snapshot() }
        : {}),
      ...((flow.mode === "detective" || flow.mode === "finished") &&
      old?.detective
        ? { detective: old.detective, board: old.board }
        : {}),
    };
    this.render();
  }
  private render(): void {
    if (!this.state || this.disposed) return;
    this.table?.render(this.state);
    this.ports.renderScene(this.state, this.revealed);
  }
  snapshot(): PlayTableSnapshot | undefined {
    return this.state ? JSON.parse(JSON.stringify(this.state)) : undefined;
  }
  update(seconds: number): void {
    if (this.disposed || !Number.isFinite(seconds) || seconds < 0) return;
    const session = this.detective;
    session?.update(seconds);
    if (
      session &&
      session === this.detective &&
      session.snapshot().completed &&
      this.flow?.snapshot().mode === "detective"
    )
      this.flow.markSolved();
  }
  dispatch(action: string, payload?: unknown): boolean {
    if (this.disposed || !this.flow) return false;
    const mode = this.flow.snapshot().mode;
    if (action === "author")
      return (
        mode === "author" &&
        !!payload &&
        this.controller!.dispatch(payload as AuthorCommand) === true
      );
    if (action === "detective") {
      if (
        (mode !== "detective" && mode !== "finished") ||
        !this.detective ||
        !payload ||
        this.revealed
      )
        return false;
      const command = payload as DetectiveAction;
      if (
        ![
          "seek",
          "step",
          "play",
          "freeze",
          "replay",
          "table",
          "inspect",
          "pin",
          "remove",
          "undo",
          "check",
          "checkAll",
          "returnObservations",
          "reveal",
          "finish",
          "tabPage",
          "source",
          "selectClue",
          "pinClue",
          "claim",
          "version",
          "hypothesis",
          "comparePair",
          "inspectObject",
          "selectField",
          "claimField",
          "versionField",
        ].includes(command.type)
      )
        return false;
      if (command.type === "reveal" && !this.detective.snapshot().completed)
        return false;
      if (
        mode === "finished" &&
        ![
          "seek",
          "step",
          "play",
          "freeze",
          "replay",
          "table",
          "inspect",
          "returnObservations",
          "source",
          "version",
          "versionField",
          "reveal",
          "finish",
          "selectClue",
          "tabPage",
        ].includes(command.type)
      )
        return false;
      if (command.type === "reveal") this.revealView = this.state;
      this.detective.dispatch(command);
      return true;
    }
    if (action !== "flow" || !payload) return false;
    const p = payload as {
      type: string;
      id?: string;
      rev?: number;
      confirmed?: boolean;
    };
    switch (p.type) {
      case "replayAlarm":
        return this.flow.replayAlarm();
      case "stageTheft":
        if (
          (mode === "detective" || mode === "finished") &&
          p.confirmed === true
        ) {
          if (!this.flow.finishAttempt(true)) return false;
        }
        return this.flow.stageTheft();
      case "resumeDraft":
        return this.flow.resumeDraft();
      case "leaveAuthor":
        return this.flow.leaveAuthor();
      case "passCase":
        return this.flow.passCase();
      case "cancelHandoff":
        return this.flow.cancelHandoff();
      case "openCase":
        return this.flow.openCase();
      case "replayEvidence":
        return this.flow.replayEvidence();
      case "finishAttempt":
        return this.flow.finishAttempt(p.confirmed === true);
      case "selectCase":
        return (
          p.id !== undefined && this.flow.selectSavedCase(p.id, p.rev ?? 1)
        );
      case "resumeSavedDraft":
        return p.id !== undefined && this.flow.resumeSavedDraft(p.id);
      case "editThisCase":
        return this.flow.editThisCase();
      case "keepThisRoom":
        return this.flow.keepThisRoom();
      case "emptyRoom":
        return this.flow.emptyRoom();
      case "skipTutorial":
        this.flow.skipTutorial();
        return true;
      case "repeatHelp":
        this.flow.repeatHelp();
        return true;
      default:
        return false;
    }
  }
  dispose(): void {
    if (this.disposed) return;
    this.flow?.dispose();
    this.controller?.detach();
    this.table?.dispose();
    this.controllerObject?.destroy();
    this.ports.clearScene();
    this.disposed = true;
    this.author = undefined;
    this.detective = undefined;
    this.state = undefined;
  }
}
