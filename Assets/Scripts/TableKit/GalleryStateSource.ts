import { AuthorSession, AuthorSnapshot } from "../../Author/AuthorSession";
import { createMuseumTheft } from "../../Domain/cases";
import { compileCase } from "../../Domain/compile";
import { renderHistory } from "../../Spatial/Reconstruction";
import { CurtainVisual, galleryStates, TableKit } from "./TableKit";

export interface GallerySampleState {
  descriptor: ReturnType<typeof galleryStates>[number];
  author: AuthorSnapshot;
  curtain: CurtainVisual;
  previewAperture?: number;
  returnedAperture?: number;
}

/** Six fixed inspection samples, constructed through the production author and
 * TableKit state transitions. This owns no update loop, solver or saved case. */
export function buildGallerySamples(enabled: boolean): GallerySampleState[] {
  return galleryStates(enabled).map((descriptor) => {
    const draft = createMuseumTheft(true);
    draft.id = "tablekit-state-" + descriptor.name.toLowerCase().replace(/ /g, "-");
    draft.room.mirror!.aperture = descriptor.aperture;
    const session = new AuthorSession(draft);
    session.setTick(descriptor.tick);
    let curtain: CurtainVisual | undefined;
    const kit = new TableKit({
      clearActors() {}, drawActor() {}, drawObserved() {}, drawRuby() {},
      drawCurtain: value => { curtain = value; },
      playAtCurtain() { throw new Error("The static state gallery must stay silent"); },
    });
    const render = (grab: typeof descriptor.grab) => {
      const current = session.snapshot().draft;
      const compiled = compileCase(current);
      if (!compiled.ok) throw new Error("The gallery source case must compile");
      kit.render("author", renderHistory(compiled.sealed.board, compiled.vault.actualHistory, descriptor.tick), descriptor.tick,
        { playing: false, muted: true, curtainGrab: grab });
    };
    kit.setCommittedCurtain(descriptor.aperture);
    render("free");
    let previewAperture: number | undefined, returnedAperture: number | undefined;
    if (descriptor.grab === "grabbed") {
      session.beginGesture();
      if (!session.previewEdit({ kind: "setAperture", aperture: descriptor.aperture }))
        throw new Error("The gallery grab must use a valid author preview");
      render("grabbed");
    } else if (descriptor.grab === "cancelled") {
      session.beginGesture();
      if (!session.previewEdit({ kind: "setAperture", aperture: 0.5 }))
        throw new Error("The cancellation sample must have a real preview");
      previewAperture = session.snapshot().draft.room.mirror!.aperture;
      render("grabbed");
      session.cancelGesture();
      returnedAperture = kit.cancelCurtain();
      if (session.snapshot().draft.room.mirror!.aperture !== returnedAperture)
        throw new Error("Author and TableKit cancellation must return to the same committed aperture");
    }
    const author = session.snapshot();
    session.dispose();
    if (!curtain) throw new Error("TableKit did not publish a curtain state");
    return { descriptor, author, curtain, previewAperture, returnedAperture };
  });
}
