import { NativeMuseumFoley, PublicMechanisms } from '../Scripts/TableKit/NativeMuseumFoley';
import {
  AuthorController,
  AuthorCommand,
  AuthorPresentationPort,
} from "../Author/AuthorController";
import { AuthorSession } from "../Author/AuthorSession";
import {
  AuthorViewAction,
  AuthorViewSession,
} from "../Author/AuthorViewSession";
import { CaseFlow, FlowState } from "../Cases/CaseFlow";
import {
  DetectiveAction,
  DetectiveSession,
} from "../Detective/DetectiveSession";
import { VaultEntry } from "../Domain/types";
import { SessionShelf } from "../Shelf/SessionShelf";
import { ObservationTargetView } from "./MuseumGame/ObservationContacts";
import { getObservations } from "../Domain/observe";
import { PlayTable, PlayTableSnapshot, CaseTargetView } from "./PlayTable";
import { RevealAction, RevealTransport } from "./MuseumGame/RevealTransport";
import {
  CaseViewAction,
  CaseViewPorts,
  CaseViewRouting,
  CaseViewSnapshot,
} from "../Spatial/CaseViewRouting";

export interface MuseumTable {
  readCaseTargets?(): readonly CaseTargetView[];
  finishTimeDrag?(): void;
  render(snapshot: PlayTableSnapshot): void;
  dispose(): void;
  readObservationTargets?(): readonly ObservationTargetView[];
}
export interface MuseumAuthorController {
  mount(session: AuthorSession, port: AuthorPresentationPort): void;
  dispatch(command: AuthorCommand): boolean;
  detach(): void;
}
export interface MuseumGamePorts {
  foley?: NativeMuseumFoley;
  soundAnchor?(object: SceneObject): void;
  caseView?: Omit<CaseViewPorts, "readSession">;
  /** Fractional poses only; observations and controls still use integer ticks. */
  presentPose?(tick: number): void;
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
  private authorView: AuthorViewSession | undefined;
  private swappingAuthor = false;
  private detective: DetectiveSession | undefined;
  private controller: MuseumAuthorController | undefined;
  private controllerObject: SceneObject | undefined;
  private state: (PlayTableSnapshot & { view?: CaseViewSnapshot }) | undefined;
  private revealed: VaultEntry | undefined;
  private revealView: PlayTableSnapshot | undefined;
  private disposed = false;
  private mounting = false;
  private shelf = new SessionShelf();
  private caseView: CaseViewRouting | undefined;
  private arrivalAlarm: number | undefined;
  private revealClock: RevealTransport | undefined;
  constructor(
    private root: SceneObject,
    private ports: MuseumGamePorts,
  ) {}
  mount(): void {
    if (this.flow || this.disposed) return;
    this.table = this.ports.createTable
      ? this.ports.createTable(this.root, (a, p) => this.dispatch(a, p))
      : new PlayTable(this.root, { dispatch: (a, p) => this.dispatch(a, p), soundAnchor: object => this.ports.soundAnchor?.(object), cancelSound: () => this.ports.foley?.cancel() });
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
    if (this.ports.caseView) {
      const native = this.ports.caseView;
      this.caseView = new CaseViewRouting({
        ...native,
        readSession: () => {
          const state = this.state;
          return !this.revealed &&
            state?.detective &&
            state.board &&
            (state.flow.mode === "detective" || state.flow.mode === "finished")
            ? { detective: state.detective, board: state.board }
            : undefined;
        },
        finishTimeDrag: () => {
          this.table?.finishTimeDrag?.();
          this.detective?.dispatch({ type: "freeze" });
          native.finishTimeDrag();
        },
      });
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
          this.authorView?.dispose();
          this.authorView = new AuthorViewSession(session, {
            isAuthorRole: () =>
              !this.disposed &&
              this.state?.flow.mode === "author" &&
              this.author === session,
            activate: (active) => this.activateAuthor(active),
            cancelInput: () => {
              this.table?.finishTimeDrag?.();
              this.ports.cancelInput();
            },
            present: (authorView) => {
              if (this.state?.flow.mode === "author")
                this.state = { ...this.state, authorView };
            },
            clear: () => {
              if (this.state) {
                const { authorView, ...rest } = this.state;
                this.state = rest;
              }
            },
          });
          this.activateAuthor(session);
          return {
            detach: () => {
              const previousMounting = this.mounting;
              this.mounting = true;
              try {
                const view = this.authorView;
                this.authorView = undefined;
                view?.dispose();
                this.controller!.detach();
                this.author = undefined;
              } finally {
                this.mounting = previousMounting;
              }
            },
          };
        },
        mountDetective: (sealed, _epoch, saved) => {
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
          if (saved) session.restoreArchive(saved);
          this.detective = session;
          this.mounting = false;
          return {
            archive: () => session.archive(),
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
          this.revealClock = new RevealTransport(
            this.state?.detective?.tick ?? vault.sourceDraft.alarmTick,
          );
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
    const alarm = this.state?.board?.alarmTick;
    if (alarm !== undefined && this.detective) {
      this.arrivalAlarm = alarm;
      this.detective.dispatch({ type: "seek", tick: Math.max(0, alarm - 4) });
      this.detective.dispatch({ type: "play" });
    }
  }
  /** Role flow retains the base; ordinary controller input follows only the
   * current base/trial session. A remount is atomic inside the same author role. */
  private activateAuthor(session: AuthorSession): void {
    const previousMounting = this.mounting,
      previousSwap = this.swappingAuthor;
    this.mounting = true;
    this.swappingAuthor = true;
    try {
      this.controller!.mount(session, {
        render: (author) => {
          if (this.state) {
            this.state = {
              flow: this.state.flow,
              author,
              authorView: this.authorView?.snapshot(),
            };
            if (!this.mounting) this.render();
          }
        },
        clear: () => {
          if (!this.swappingAuthor) this.clearRole();
        },
      });
    } finally {
      this.swappingAuthor = previousSwap;
      this.mounting = previousMounting;
    }
  }
  private clearRole(): void {
    const authorView = this.authorView;
    this.authorView = undefined;
    authorView?.dispose();
    this.revealClock?.dispose();
    this.revealClock = undefined;
    this.arrivalAlarm = undefined;
    this.revealed = undefined;
    if (this.state) this.state = { flow: this.state.flow };
    this.caseView?.sync();
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
        ? {
            author: (
              this.authorView?.activeSession() ?? this.author
            ).snapshot(),
          }
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
    if (this.revealed && this.revealClock) {
      const reveal = this.revealClock.snapshot();
      const detective = this.state.detective;
      const tape =
        detective &&
        this.shelf.publicCase({ id: detective.caseId, rev: detective.rev })
          ?.clues;
      this.state = {
        ...this.state,
        reveal,
        ...(detective
          ? {
              detective: {
                ...detective,
                tick: reveal.tick,
                frame: tape?.clues.find(
                  (clue) =>
                    clue.kind === "Frame" &&
                    clue.witness === detective.source &&
                    clue.tick === reveal.tick,
                ),
                observations: tape
                  ? getObservations(tape, detective.source, reveal.tick)
                  : [],
                focusedObservation: undefined,
              },
            }
          : {}),
      };
    }
    this.authorView?.sync();
    this.caseView?.sync();
    if (this.caseView)
      this.state = { ...this.state, view: this.caseView.snapshot() };
    this.ports.foley?.observe(this.mechanismState().identity);
    this.ports.renderScene(this.state, this.revealed);
    this.table?.render(this.state);
  }
  snapshot(): PlayTableSnapshot | undefined {
    return this.state ? JSON.parse(JSON.stringify(this.state)) : undefined;
  }
  readObservationTargets(): readonly ObservationTargetView[] {
    return (
      this.table?.readObservationTargets?.().map((target) => ({ ...target })) ??
      []
    );
  }
  readCaseTargets(): readonly CaseTargetView[] {
    return (
      this.table?.readCaseTargets?.().map((target) => ({ ...target })) ?? []
    );
  }
  update(seconds: number): void {
    if (this.disposed || !Number.isFinite(seconds) || seconds < 0) return;
    if (this.revealed && this.revealClock) {
      if (this.revealClock.update(seconds)) this.render();
      this.ports.presentPose?.(this.revealClock.presentationTick());
      this.caseView?.update(seconds);
      return;
    }
    if (this.authorView?.update()) this.render();
    const session = this.detective;
    session?.update(seconds);
    if (
      session &&
      session === this.detective &&
      this.arrivalAlarm !== undefined &&
      session.presentationTick() >= this.arrivalAlarm
    ) {
      const alarm = this.arrivalAlarm;
      this.arrivalAlarm = undefined;
      session.dispatch({ type: "seek", tick: alarm });
    }
    if (
      session &&
      session === this.detective &&
      session.isCompleted() &&
      this.state?.flow.mode === "detective"
    )
      this.flow?.markSolved();
    const poseTick =
      this.authorView?.activeSession().presentationTick() ??
      this.author?.presentationTick() ??
      this.detective?.presentationTick();
    if (poseTick !== undefined) this.ports.presentPose?.(poseTick);
    this.caseView?.update(seconds);
  }
  private mechanismState(): PublicMechanisms {
    const s=this.state, d=s?.detective, a=s?.author;
    return { identity: [s?.flow.mode === "finished" ? "detective" : s?.flow.mode,s?.flow.inputEpoch,d?.caseId ?? a?.draft.id,d?.rev ?? "author-edit",!!s?.reveal].join('|'),
      playing: s?.reveal?.playing ?? d?.playing ?? a?.playing ?? false,
      pins: d?.glass.map(g=>g.id).join('|') ?? '', page: d?.glassPage ?? 0,
      completed: d?.completed ?? false, checking: d?.checking ?? false, aperture: a?.draft.room.mirror?.aperture };
  }
  dispatch(action: string, payload?: unknown): boolean {
    const before=this.mechanismState();
    const accepted=this.dispatchCore(action,payload);
    const type=payload && typeof payload==='object' ? String((payload as {type?:string;kind?:string}).type ?? (payload as {kind?:string}).kind ?? '') : '';
    this.ports.foley?.accepted(action,type,accepted,before,this.mechanismState());
    return accepted;
  }
  private dispatchCore(action: string, payload?: unknown): boolean {
    if (this.disposed || !this.flow) return false;
    if (action === "reveal") {
      if (!this.revealed || !this.revealClock || !payload) return false;
      const accepted = this.revealClock.dispatch(payload as RevealAction);
      if (accepted) this.render();
      return accepted;
    }
    if (
      this.arrivalAlarm !== undefined &&
      ["flow", "author", "detective", "view"].includes(action)
    ) {
      this.arrivalAlarm = undefined;
      this.detective?.dispatch({ type: "freeze" });
    }
    if (action === "view") {
      if (!payload || !this.caseView) return false;
      const accepted = this.caseView.dispatch(payload as CaseViewAction);
      this.render();
      return accepted;
    }
    const mode = this.flow.snapshot().mode;
    if (action === "authorView") {
      if (mode !== "author" || !payload || !this.authorView || this.revealed)
        return false;
      const accepted = this.authorView.dispatch(payload as AuthorViewAction);
      this.render();
      return accepted;
    }
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
          "selectObservation",
          "pinClue",
          "claim",
          "version",
          "hypothesis",
          "comparePair",
          "inspectObject",
          "selectField",
          "claimField",
          "versionField",
          "compareVersions",
        ].includes(command.type)
      )
        return false;
      if (command.type === "reveal" && !this.detective.isCompleted())
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
          "compareVersions",
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
        if (this.authorView?.snapshot().mode === "change") return false;
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
    this.authorView?.dispose();
    this.authorView = undefined;
    this.caseView?.dispose();
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
