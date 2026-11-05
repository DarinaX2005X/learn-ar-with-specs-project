import { Scenario } from "Leaf.lspkg/Scenarios/scenario/Scenario";

import { sleep, nextFrame } from "Leaf.lspkg/Utils/common/Utils";

import { read, target, sorted } from "./CountercaseLeafProbe";

import { stageCopy, tap } from "./MuseumJourney";

import {
  CurtainRailInput,
  withinCurtainDeadline,
  waitForCurtain as waitFor,
} from "./CurtainRailInput";

/** Real SIK input loss retains the tested draft; close and reverse each commit once. */

@component
export class CurtainCancelScenario extends Scenario {
  async run(): Promise<void> {
    await sleep(1500);
    const input = new CurtainRailInput();
    let cancelledEvents = 0,
      endedEvents = 0;
    const removals: (() => void)[] = [];

    try {
      const copy = await withinCurtainDeadline(
        "cancel ordinary stageCopy",
        () => stageCopy(input),
      );
      if (copy.aperture !== 1) throw new Error("Open source required");

      await tap(input, "Use_CaseLid");
      const before = await waitFor(
        "real tested open draft",
        (s) =>
          !s.testing &&
          s.testedRev === copy.revision &&
          s.canSeal &&
          s.possibleCulprits.length === 1,
      );
      if (sorted(before.possibleCulprits).join() !== "Conservator")
        throw new Error("Real open proof required before cancel");

      const handle = target("Use_CurtainHandle");
      removals.push(
        handle.onTriggerCanceled.add(() => {
          cancelledEvents++;
        }),
        handle.onTriggerEnd.add(() => endedEvents++),
      );

      await withinCurtainDeadline("real partial rail input", () =>
        input.partialClose(),
      );
      if (read().revision !== before.revision)
        throw new Error("Preview changed committed revision");

      input.lose();
      await waitFor(
        "actual cancelled input rollback",
        (s) =>
          cancelledEvents > 0 && !s.preview && s.aperture === before.aperture,
      );

      const after = read();
      if (
        endedEvents !== 0 ||
        after.revision !== before.revision ||
        after.caseId !== before.caseId ||
        after.tick !== before.tick ||
        after.testedRev !== before.testedRev ||
        after.canSeal !== before.canSeal ||
        JSON.stringify(sorted(after.possibleCulprits)) !==
          JSON.stringify(sorted(before.possibleCulprits))
      )
        throw new Error("Cancellation did not preserve original tested draft");

      await withinCurtainDeadline("input recovery", () => input.recover());
      await withinCurtainDeadline("repeated idle recovery", () =>
        input.recover(),
      );
      await nextFrame();
      const recovered = read();
      if (
        recovered.preview ||
        recovered.revision !== before.revision ||
        recovered.aperture !== before.aperture ||
        recovered.caseId !== before.caseId ||
        recovered.tick !== before.tick ||
        recovered.testedRev !== before.testedRev ||
        recovered.canSeal !== before.canSeal ||
        JSON.stringify(sorted(recovered.possibleCulprits)) !==
          JSON.stringify(sorted(before.possibleCulprits))
      )
        throw new Error("Recovery changed original tested draft");

      await input.dragTo(0);
      const closed = read();
      if (
        closed.revision !== before.revision + 1 ||
        closed.testedRev === closed.revision ||
        closed.canSeal
      )
        throw new Error("Closed edit reused old proof");

      await input.dragTo(1);
      if (
        read().revision !== closed.revision + 1 ||
        read().caseId !== before.caseId
      )
        throw new Error("Reverse did not commit exactly once");
    } finally {
      removals.forEach((remove) => remove());
      input.release();
    }
  }
}
