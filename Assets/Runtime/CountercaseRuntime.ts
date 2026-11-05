import { MuseumGame } from "./MuseumGame";
import { MuseumScene } from "./MuseumScene";

/** Scene lifecycle only. Sessions own logical time; the renderer owns native art. */
@component
export class CountercaseRuntime extends BaseScriptComponent {
  @input recordingMaterial: Material;
  @input cloth: AudioTrackAsset;
  @input engage: AudioTrackAsset;
  @input latch: AudioTrackAsset;

  private game: MuseumGame;
  private presentation: MuseumScene;

  onAwake(): void {
    this.createEvent("OnStartEvent").bind(() => this.mount());
    this.createEvent("UpdateEvent").bind(() => {
      if (this.game) this.game.update(getDeltaTime());
    });
    this.createEvent("OnDestroyEvent").bind(() => {
      if (this.game) this.game.dispose();
      if (this.presentation) this.presentation.dispose();
    });
  }

  private mount(): void {
    this.presentation = new MuseumScene(this.sceneObject, this.recordingMaterial, {
      cloth: this.cloth,
      engage: this.engage,
      latch: this.latch,
    });
    this.game = new MuseumGame(this.sceneObject, {
      renderScene: (state, reveal) => this.presentation.render(state, reveal),
      clearScene: () => this.presentation.clear(),
      setLid: (closed) => this.presentation.setLid(closed),
      cancelInput: () => this.presentation.cancelInput(),
      presentPose: (tick) => this.presentation.presentPose(tick),
      caseView: {
        readViewer: () => this.presentation.readCaseViewViewer(),
        finishTimeDrag: () => this.presentation.cancelInput(),
        setPresentation: (view) => this.presentation.applyCaseView(view),
        setFrameCovered: (covered) => this.presentation.setCaseViewCovered(covered),
        setSecondaryLabelsVisible: (visible) =>
          this.presentation.setCaseViewSecondaryLabelsVisible(visible),
        stopSound: () => this.presentation.cancelInput(),
      },
    });
    this.game.mount();
    (global as any).countercaseLeaf = { read: () => this.readSnapshot() };
    print("COUNTERCASE mounted in museum");
  }

  /** Read-only observation surface for native tests. No vault or commands cross it. */
  private readSnapshot() {
    const state = this.game.snapshot();
    const detective = state?.detective;
    const author = state?.author;
    const board = state?.board;
    const frame = detective?.frame?.kind === "Frame" ? detective.frame : undefined;
    const display = this.presentation.read();
    return {
      caseId: detective?.caseId ?? author?.draft.id ?? state?.flow.caseId ?? "",
      revision: detective?.rev ?? author?.draft.rev ?? 0,
      aperture: board?.room.mirror?.aperture ?? author?.draft.room.mirror?.aperture ?? 0,
      tick: state?.reveal?.tick ?? detective?.tick ?? author?.tick ?? 0,
      observedRoles: frame?.payload.fragments.filter((f) => f.role).map((f) => f.role) ?? [],
      possibleCulprits: author?.verdict?.possibleCulprits ?? detective?.verdict?.possibleCulprits ?? [],
      frameId: display.frameId ?? "",
      frameRevision: display.frameRevision ?? 0,
      frameObservedRoles: display.frameObservedRoles,
      mode: state?.flow.mode ?? "starting",
      revealed: !!state?.reveal,
      playing: state?.reveal?.playing ?? author?.playing ?? detective?.playing ?? false,
      preview: author?.preview ?? false,
      testing: author?.testing ?? false,
      testedRev: author?.testedRev ?? null,
      canSeal: author?.canSeal ?? false,
      needsAmbiguityConfirmation: author?.needsAmbiguityConfirmation ?? false,
      evidenceIds: detective?.glass.map((g) => g.id) ?? [],
      observations: (detective?.observations ?? [])
        .filter((clue) => clue.observation?.kind === "fragment")
        .map((clue) => ({
          id: clue.id,
          roles: clue.payload.fragments.filter((f) => f.role).map((f) => f.role),
        })),
      observationTargets: this.game.readObservationTargets(),
      focusedObservationId: detective?.focusedObservation?.id ?? null,
      verdictStatus: detective?.verdict?.status ?? null,
      errors: author?.errors ?? [],
      inputEpoch: state?.flow.inputEpoch ?? 0,
      shelf: state?.flow.shelf ?? [],
      caseTargets: this.game.readCaseTargets(),
      objects: detective?.objects ?? [],
      boxes: board?.room.boxes ?? [],
      fields: detective?.fields ?? {},
      completed: detective?.completed ?? false,
      checking: detective?.checking ?? false,
      message: detective?.message ?? "",
      verdictScope: detective?.verdict?.scope,
      comparison: display.comparison,
      view: state?.view,
    };
  }
}
