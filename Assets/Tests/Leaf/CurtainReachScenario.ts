import { Scenario } from "Leaf.lspkg/Scenarios/scenario/Scenario";
import { sleep, nextFrame } from "Leaf.lspkg/Utils/common/Utils";
import { IKBodyInteractor } from "Leaf.lspkg/Interactors/interactor/ik/IKBodyInteractor";
import { WRIST_MAX_REACH_CM } from "Leaf.lspkg/IKSolver/ArmModel";
import { DiagnosticRecorder } from "Leaf.lspkg/Diagnostic/DiagnosticRecorder";
import WorldCameraFinderProvider from "SpectaclesInteractionKit.lspkg/Providers/CameraProvider/WorldCameraFinderProvider";
import { InteractorInputType } from "SpectaclesInteractionKit.lspkg/Core/Interactor/Interactor";
import { read, target } from "./CountercaseLeafProbe";
import { stageCopy } from "./MuseumJourney";
import { CurtainRailInput, withinCurtainDeadline, waitForCurtain } from "./CurtainRailInput";

// First activation starts at LEAF's absolute hidden wrist, about 868 cm from
// this relocated fixture. Native-calibrated traversal needs about 9.3 seconds.
const DIRECT_DEADLINE_MS = 15000;
const xyz = (p: vec3) => [p.x, p.y, p.z];

/** Opt-in only: real direct close/reopen, no fallback, avatar or target movement. */
@component
export class CurtainReachScenario extends Scenario {
  async run(): Promise<void> {
    await sleep(1500);
    const setup = new CurtainRailInput();
    const recorder = DiagnosticRecorder.getInstance(), policy = recorder.policy;
    const removals: (() => void)[] = [];
    let ik: IKBodyInteractor | undefined;
    let pending: Promise<void> | undefined;
    try {
      const before = await withinCurtainDeadline("ordinary stage copy", () => stageCopy(setup));
      setup.release();
      if (before.aperture !== 1) throw new Error("Start with the original open mirror");
      const handle = target("Use_CurtainHandle").getTransform().getWorldPosition();
      const open = target("Use_CurtainOpen").getTransform().getWorldPosition();
      const closed = target("Use_CurtainClose").getTransform().getWorldPosition();
      const rail = open.sub(closed);
      if (rail.length < 35 || rail.length > 50) throw new Error("Full-scale 43 cm curtain rail required");
      const normal = rail.normalize().cross(vec3.up()).normalize();
      print("[REACH] PREPOSITION " + JSON.stringify({
        handle: xyz(handle),
        commands: [
          { action: "setPosition", x: handle.x + normal.x * 45, y: handle.y + 52, z: handle.z + normal.z * 45 },
          { action: "lookAt", x: (handle.x + open.x) / 2, y: (handle.y + open.y) / 2, z: (handle.z + open.z) / 2 },
        ],
      }));
      // Only the operator may adjust the player viewpoint using Preview controls.
      let fresh = false, down = false;
      const press = this.createEvent("KeyPressEvent"), release = this.createEvent("KeyReleaseEvent");
      (press as KeyPressEvent).bind(e => { if (e.key === Keys.K) { if (!down) fresh = true; down = true; } });
      (release as KeyReleaseEvent).bind(e => { if (e.key === Keys.K) down = false; });
      removals.push(() => this.removeEvent(press), () => this.removeEvent(release));
      print("[REACH] READY_EXTERNAL_POSE use the printed Preview commands, then a fresh K within 15 seconds");
      const gate = getTime() + 15;
      while (!fresh && getTime() < gate) await sleep(50);
      if (!fresh) throw new Error("No fresh K; no direct pinch attempted");

      recorder.setPolicy("fail-fast");
      await withinCurtainDeadline("IK arm warmup", async () => {
        ik = new IKBodyInteractor();
        await nextFrame(); await nextFrame(); await nextFrame();
      });
      const camera = WorldCameraFinderProvider.getInstance();
      const cameraTransform = camera.getComponent().getTransform();
      const eye = cameraTransform.getWorldPosition(), rotation = cameraTransform.getWorldRotation();
      for (const name of ["Use_CurtainHandle", "Use_CurtainOpen"]) {
        const control = target(name), position = control.getTransform().getWorldPosition();
        const shoulder = ik!.right.currentArmKeypoints?.shoulder;
        if (!shoulder || !camera.inFoV(position) || ik!.right.isIndirect(control)
          || position.distance(shoulder) > WRIST_MAX_REACH_CM - 3) {
          throw new Error("Direct/FOV comfort precondition failed; use PREPOSITION before a fresh run");
        }
      }
      for (const [name, aperture] of [["Use_CurtainHandle", 0], ["Use_CurtainOpen", 1]] as const) {
        const control = target(name), start = read();
        const events = { hover: 0, start: 0, end: 0, cancel: 0, foreign: 0 };
        const count = (key: "hover" | "start" | "end" | "cancel") =>
          (event: { interactor: { inputType: number } }) => {
            events[key]++;
            if (event.interactor.inputType !== InteractorInputType.RightHand) events.foreign++;
          };
        removals.push(
          control.onHoverEnter.add(count("hover")),
          control.onTriggerStart.add(count("start")),
          control.onTriggerEnd.add(count("end")),
          control.onTriggerCanceled.add(count("cancel")),
        );
        const operation = ik!.right.trigger(control, false);
        pending = operation.then(() => {}, () => {});
        const used = await withinCurtainDeadline("direct pinch " + name, () => operation, DIRECT_DEADLINE_MS);
        pending = undefined;
        if (!used) throw new Error("Official IK declined direct pinch; fallback prohibited");
        await waitForCurtain("one direct commit " + name, state => state.aperture === aperture
          && state.revision === start.revision + 1 && !state.preview);
        const after = read();
        if (!events.hover || events.start !== 1 || events.end !== 1 || events.cancel || events.foreign) {
          throw new Error("One real hover/start/end on " + name + " required; events=" + JSON.stringify(events));
        }
        if (after.caseId !== before.caseId || after.mode !== "author" || after.tick !== start.tick) {
          throw new Error("Direct action changed case, role or clock");
        }
        const currentRotation = cameraTransform.getWorldRotation();
        if (cameraTransform.getWorldPosition().distance(eye) > 1e-4
          || currentRotation.multiplyVec3(vec3.back()).distance(rotation.multiplyVec3(vec3.back())) > 1e-4
          || currentRotation.multiplyVec3(vec3.up()).distance(rotation.multiplyVec3(vec3.up())) > 1e-4) {
          throw new Error("Viewer moved during direct pinch");
        }
      }
    } finally {
      removals.forEach(remove => remove());
      try {
        ik?.destroy();
        // Official in-flight strategy may unwind its existing hover/end awaits.
        if (pending) await withinCurtainDeadline("join destroyed direct operation", () => pending!, 5000);
      } finally {
        setup.release();
        recorder.setPolicy(policy);
      }
    }
  }
}
