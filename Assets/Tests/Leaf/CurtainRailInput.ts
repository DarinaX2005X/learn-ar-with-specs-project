import { sleep, nextFrame } from "Leaf.lspkg/Utils/common/Utils";

import { DefaultLeafInteractor } from "Leaf.lspkg/Interactors/interactor/DefaultLeafInteractor";

import { read, target, waitFor as probeWaitFor } from "./CountercaseLeafProbe";

/** Report only the curtain state needed to diagnose a failed phase. */
function curtainDiagnostic(): string {
  const state = read();
  return JSON.stringify({
    caseId: state.caseId,
    revision: state.revision,
    aperture: state.aperture,
    preview: state.preview,
    testedRev: state.testedRev,
    canSeal: state.canSeal,
  });
}
function conciseFailure(error: unknown): string {
  return String(error).split("; snapshot=")[0];
}
/** Preserve the probe's polling cadence without exposing its full snapshot. */
export async function waitForCurtain(
  label: string,
  predicate: Parameters<typeof probeWaitFor>[1],
) {
  try {
    return await probeWaitFor(label, predicate);
  } catch (error) {
    throw new Error(conciseFailure(error) + "; curtain=" + curtainDiagnostic());
  }
}
export async function withinCurtainDeadline<T>(
  label: string,
  operation: () => Promise<T>,
  ms = 8000,
): Promise<T> {
  let done = false,
    result: T,
    error: unknown,
    failed = false;
  Promise.resolve()
    .then(operation)
    .then(
      (v) => {
        result = v;
        done = true;
      },
      (e) => {
        error = e;
        failed = true;
        done = true;
      },
    );
  const deadline = getTime() + ms / 1000;
  while (!done && getTime() < deadline) await sleep(50);
  if (!done)
    throw new Error(
      label + " exceeded " + ms + "ms; curtain=" + curtainDiagnostic(),
    );
  if (failed) throw new Error(label + ": " + conciseFailure(error));
  return result!;
}

function rail() {
  const closed = target("Use_CurtainClose").getTransform().getWorldPosition(),
    open = target("Use_CurtainOpen").getTransform().getWorldPosition(),
    handle = target("Use_CurtainHandle").getTransform().getWorldPosition();
  const travel = open.sub(closed);
  if (travel.length < 35 || travel.length > 50)
    throw new Error(
      "Ordinary full-scale 43 cm rail required, got " + travel.length,
    );
  return { closed, open, handle, travel };
}

/** Simulated SIK input for the opt-in curtain cancellation regression. */

export class CurtainRailInput extends DefaultLeafInteractor {
  private available = true;
  private released = false;

  constructor() {
    super("CountercaseCurtainRailInput");
    this.sikInteractor.isActive = () => this.available;
  }

  release() {
    if (this.released) return;
    this.released = true;
    this.stopSelecting();
    this.overrideDragVector = undefined;
    super.destroy();
  }

  async partialClose() {
    const r = rail(),
      handle = target("Use_CurtainHandle");
    let moved = false;
    const remove = handle.onDragUpdate.add(() => {
      if (read().preview && read().aperture < 1) {
        moved = true;
        this.overrideDragVector = vec3.zero();
      }
    });

    try {
      await this.enterHover(handle);
      this.startSelecting();
      await nextFrame();
      this.overrideDragVector = r.travel.uniformScale(-0.08);
      await waitForCurtain(
        "actual partial rail preview",
        (s) => moved && s.preview && s.aperture > 0 && s.aperture < 1,
      );
    } finally {
      remove();
    }
  }

  lose() {
    this.available = false;
  }

  async recover() {
    this.stopSelecting();
    this.overrideDragVector = undefined;
    await nextFrame();
    const hovered = this.overrideInteractable;
    // Availability loss has already emitted HoverExit. Never await that past event.
    // A still-active own hover can produce a fresh exit through LEAF's normal path.
    if (
      this.available &&
      hovered &&
      (hovered.hoveringInteractor & this.sikInteractor.inputType) !== 0
    )
      await withinCurtainDeadline(
        "remaining curtain hover exit",
        () => this.exitHover(),
        1500,
      );
    // LEAF updateState would otherwise restore its stale override on the next frame.
    this.overrideInteractable = undefined;
    this.sikInteractor.clearCurrentInteractable();
    this.resetStartEndPoint();
    await nextFrame();
    this.available = true;
    await nextFrame();
    await nextFrame();
    if (
      this.sikInteractor.currentInteractable !== null ||
      this.sikInteractor.currentDragVector !== null
    )
      throw new Error(
        "Recovered curtain pointer did not remain idle across fresh frames",
      );
  }

  async dragTo(to: 0 | 1) {
    const before = read(),
      r = rail(),
      handle = target("Use_CurtainHandle"),
      vector = r.travel.uniformScale((to - before.aperture) * 0.02);
    let started = getTime(),
      partial = false,
      earlyCommit = false;

    const begin = handle.onDragStart.add(() => {
      started = getTime();
    });
    const update = handle.onDragUpdate.add(() => {
      const s = read();
      partial =
        partial ||
        (s.preview &&
          s.aperture > 0 &&
          s.aperture < 1 &&
          s.revision === before.revision);
      earlyCommit = earlyCommit || s.revision !== before.revision;
      const fraction = Math.min(1, Math.max(0.02, (getTime() - started) / 1.6)),
        planned = before.aperture + (to - before.aperture) * fraction;
      let delta =
        to === 0
          ? Math.min(0, planned - s.aperture)
          : Math.max(0, planned - s.aperture);
      if (fraction === 1 && s.aperture !== to)
        delta = to - s.aperture + (to === 0 ? -1 : 1) * 0.00001;
      vector.x = r.travel.x * delta;
      vector.y = r.travel.y * delta;
      vector.z = r.travel.z * delta;
    });

    try {
      await withinCurtainDeadline(
        "physical rail drag to " + to,
        () => this.drag(handle, vector, 6000),
        8000,
      );
    } finally {
      begin();
      update();
    }

    if (!partial || earlyCommit)
      throw new Error("Real intermediate old-revision preview required");
    const after = await waitForCurtain(
      "one endpoint release",
      (s) =>
        !s.preview && s.aperture === to && s.revision === before.revision + 1,
    );
    this.stopSelecting();
    await nextFrame();
    this.stopSelecting();
    await sleep(100);
    if (read().revision !== after.revision)
      throw new Error("Duplicate release committed again");
  }
}
