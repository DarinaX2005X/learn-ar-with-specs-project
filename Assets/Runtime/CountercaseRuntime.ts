import { NativeMuseumFoley } from '../Scripts/TableKit/NativeMuseumFoley';
import { LensFoleyVoice, captureFoleyOrigin } from '../Scripts/TableKit/LensFoleyVoice';
import { MuseumGame } from "./MuseumGame";
import { MuseumScene } from "./MuseumScene";

/** Scene lifecycle only. Sessions own logical time; the renderer owns native art. */
@component
export class CountercaseRuntime extends BaseScriptComponent {
  @input recordingMaterial: Material;
  @input
  @allowUndefined
  fontRegular?: Font;
  @input
  @allowUndefined
  fontBold?: Font;
  @input cloth: AudioTrackAsset;
  @input engage: AudioTrackAsset;
  @input latch: AudioTrackAsset;

  @input museum_pin_01: AudioTrackAsset;
  @input museum_pin_02: AudioTrackAsset;
  @input museum_clock_01: AudioTrackAsset;
  @input museum_clock_02: AudioTrackAsset;
  @input museum_paper_01: AudioTrackAsset;
  @input museum_paper_02: AudioTrackAsset;
  @input museum_glass: AudioTrackAsset;
  @input museum_cloth: AudioTrackAsset;
  @input museum_latch: AudioTrackAsset;
  @input museum_stamp: AudioTrackAsset;
  @input
  @allowUndefined
  rubyKeyLight?: SceneObject;
  @input enableFacetFinish: boolean = false;
  @input enablePhysicalMirror: boolean = false;
  private foley: NativeMuseumFoley;
  private foleyVoices: LensFoleyVoice[] = [];
  private foleyAnchor: vec3 | undefined;
  setMuted(muted: boolean): void { this.foley?.setMuted(muted); }
  private game: MuseumGame;
  private presentation: MuseumScene;

  onAwake(): void {
    this.createEvent("OnStartEvent").bind(() => this.mount());
    this.createEvent("UpdateEvent").bind(() => {
      if (this.game) this.game.update(getDeltaTime());
      if(this.presentation)this.presentation.updateNativeFinish(this.rubyKeyLight,this.enableFacetFinish,this.enablePhysicalMirror);
    });
    this.createEvent("OnDisableEvent").bind(() => this.foley?.cancel());
    this.createEvent("OnDestroyEvent").bind(() => {
      this.foley?.cancel();
      this.foleyVoices.forEach(v=>v.dispose());
      if (this.game) this.game.dispose();
      if (this.presentation) this.presentation.dispose();
    });
  }

  private mount(): void {
    this.foleyAnchor=undefined;
    const clips: Record<string,AudioTrackAsset>={museum_pin_01:this.museum_pin_01,museum_pin_02:this.museum_pin_02,museum_clock_01:this.museum_clock_01,museum_clock_02:this.museum_clock_02,museum_paper_01:this.museum_paper_01,museum_paper_02:this.museum_paper_02,museum_glass:this.museum_glass,museum_cloth:this.museum_cloth,museum_latch:this.museum_latch,museum_stamp:this.museum_stamp};
    const makeVoice=()=>{const node=global.scene.createSceneObject('MuseumFoleyVoice');node.setParent(this.sceneObject);return new LensFoleyVoice(node,clips,()=>this.foleyAnchor);};
    const v1=makeVoice(),v2=makeVoice();this.foleyVoices=[v1,v2];
    this.foley=new NativeMuseumFoley([v1,v2],()=>getTime());
    const fonts = { regular: this.fontRegular, bold: this.fontBold };
    this.presentation = new MuseumScene(this.sceneObject, this.recordingMaterial, {
      cloth: this.cloth,
      engage: this.engage,
      latch: this.latch,
    }, fonts);
    this.game = new MuseumGame(this.sceneObject, {
      fonts,
      foley: this.foley,
      soundAnchor: object => { this.foleyAnchor=captureFoleyOrigin(object); },
      renderScene: (state, reveal) => this.presentation.render(state, reveal),
      clearScene: () => this.presentation.clear(),
      setLid: (closed) => this.presentation.setLid(closed),
      cancelInput: () => { this.foley?.cancel(); this.presentation.cancelInput(); },
      presentPose: (tick) => this.presentation.presentPose(tick),
      caseView: {
        readViewer: () => this.presentation.readCaseViewViewer(),
        finishTimeDrag: () => { this.foley?.cancel(); this.presentation.cancelInput(); },
        setPresentation: (view) => this.presentation.applyCaseView(view),
        setFrameCovered: (covered) => this.presentation.setCaseViewCovered(covered),
        setSecondaryLabelsVisible: (visible) =>
          this.presentation.setCaseViewSecondaryLabelsVisible(visible),
        stopSound: () => { this.foley?.cancel(); this.presentation.cancelInput(); },
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
      observations: (detective?.observations ?? []).map((clue) => ({
        id: clue.id,
        kind: clue.observation?.kind,
        role: clue.payload.fragments[0]?.role,
        roles: clue.payload.fragments.filter((f) => f.role).map((f) => f.role),
        actionKinds: clue.payload.actions.map((action) => action.kind),
        handPresent: clue.observation?.kind === "hand" ? clue.observation.present : undefined,
        exhibit: clue.payload.exhibit,
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
      nativeMirror: display.nativeMirror,
      articulationBindings: display.articulationBindings,
      authorView: state?.flow.mode === "author" && state.authorView ? {
        enabled: state.authorView.enabled, mode: state.authorView.mode,
        source: state.authorView.source, tick: state.authorView.tick,
        comparing: state.authorView.comparing, canCompare: state.authorView.canCompare,
        differences: state.authorView.differences,
        ...Object.fromEntries((["recording", "before", "after"] as const).map(key => {
          const value = state.authorView?.[key];
          return [key, value ? {board: value.board ? {caseId:value.board.caseId, rev:value.board.rev} : undefined,
            frame: value.frame ? {id:value.frame.id} : undefined, source:value.source, tick:value.tick} : undefined];
        }))
      } : {enabled:false},
      authorRecording: state?.flow.mode === "author" ? display.authorRecording : {
        camera: {enabled:false, roles:[], observationIds:[], caption:""},
        before: {enabled:false, roles:[], observationIds:[], caption:""},
        after: {enabled:false, roles:[], observationIds:[], caption:""},
      },
      view: state?.view,
    };
  }
}
