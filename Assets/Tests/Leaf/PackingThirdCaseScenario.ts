import { Scenario } from "Leaf.lspkg/Scenarios/scenario/Scenario";
import { expect } from "Leaf.lspkg/Utils/common/Expect";
import { sleep } from "Leaf.lspkg/Utils/common/Utils";
import { FloorPointer } from "./FloorPointer";
import { read, waitFor } from "./CountercaseLeafProbe";
import {
  tap,
  stageCopy,
  testAndOpen,
  selectObservationId,
} from "./MuseumJourney";
import {
  openStored,
  readStage,
  waitStage,
} from "./RemainingProbe";

/** Add a witness to the packing case, then build a new theft from the tray
 * and prove it from the recording the next player receives. */
@component
export class PackingThirdCaseScenario extends Scenario {
  async run(): Promise<void> {
    const input = new FloorPointer();
    try {
    await waitFor("normal public entry", (s) => s.mode === "detective");
    await openStored(input, "packing-room", 1);
    const copy = await stageCopy(input);
    await tap(input, "Use_PropCamera");
    await input.floorHit(660, 370);
    await waitFor("real second camera edit", (s) => s.revision > copy.revision);
    await testAndOpen(input, ["Conservator"]);
    await tap(input, "Use_Sourceauthor-camera-1");
    for (let n = 0; n < 25 && read().tick !== 15; n++)
      await tap(
        input,
        read().tick < 15 ? "Use_EntryClockNext" : "Use_EntryClockPrevious",
      );
    expect(read().tick).toBe(15);
    await sleep(100);
    const recording = read();
    const actions = recording.observations.filter((o) => o.kind === "action" && ((o as any).actionKinds ?? []).includes("Pass"));
    const receivers = recording.observations.filter(
      (o) => o.kind === "fragment" && o.roles.includes("Courier"),
    );
    if (actions.length !== 1 || receivers.length !== 1)
      throw new Error(
        `Rear recording needs one actual handoff contact and one Courier mark, got ${actions.length}/${receivers.length}`,
      );
    for (const mark of [actions[0], receivers[0]]) {
      await selectObservationId(input, mark.id, "rear recording mark");
      await tap(input, "Use_PinGlass");
    }
    await tap(input, "Use_Findingrecipient");
    await tap(input, "Use_SuspectCourier");
    await tap(input, "Use_CheckStamp");
    const result = await waitStage(
      "rear recording proves recipient",
      (s) => s.fields?.recipient?.value === "Courier",
    );
    expect(result.verdictStatus).toBe("proved");
    expect(result.fields.recipient?.scope).toBe("selected");
    expect(result.completed).toBe(false);
    expect(readStage().caseId).toBe(copy.caseId);
    // Distinct third case, authored from the ordinary empty-room shelf folder.
    await tap(input,"Use_EmptyRoomFile");
    const empty=await waitFor("third case empty folder",s=>s.mode==="author");
    expect(empty.caseId===copy.caseId).toBe(false);
    expect(empty.caseId==="packing-room").toBe(false);
    expect(empty.canSeal).toBe(false);
    await tap(input,"Use_PropDisplay");await input.floorHit(350,250);
    const display=read();expect(display.revision>empty.revision).toBe(true);
    await tap(input,"Use_PropCamera");await input.floorHit(100,100);
    expect(read().revision>display.revision).toBe(true);
    await tap(input,"Use_PropFigureA");await input.floorHit(320,250);
    const onlyA=read();expect(onlyA.canSeal).toBe(false);
    // Real separate tray placements. These are the previous implicit stationary
    // B/C positions, behind this fixed camera. No new visible identity alibi.
    await tap(input,"Use_PropFigureB");await input.floorHit(130,60);
    const withB=await waitFor("third case Guard leaves its tray pocket",s=>s.revision>onlyA.revision);
    expect(withB.canSeal).toBe(false);
    await tap(input,"Use_PropFigureC");await input.floorHit(200,60);
    const withC=await waitFor("third case Conservator leaves its tray pocket",s=>s.revision>withB.revision);
    expect(withC.canSeal).toBe(false);
    await tap(input,"Use_QuestionTheft");
    for(let n=0;n<25&&(read().tick!==12||read().playing);n++)
      await tap(input,read().tick<12?"Use_WorkshopClockNext":"Use_WorkshopClockPrevious");
    expect(read().tick).toBe(12);expect(read().playing).toBe(false);
    // B/C placement changed the selected actor. Select the existing A body;
    // its tray pocket would begin another placement instead of selecting it.
    await tap(input,"Use_ActorBaseA");
    await tap(input,"Use_TakeRuby");
    await waitFor("third case actual reachable take",s=>s.errors.length===0);
    const authored=await testAndOpen(input,["Courier"]);
    expect(authored.caseId).toBe(empty.caseId);
    expect(authored.caseId===copy.caseId).toBe(false);
    await tap(input,"Use_Sourceauthor-camera-1");
    for(let n=0;n<25&&(read().tick!==12||read().playing);n++)
      await tap(input,read().tick<12?"Use_EntryClockNext":"Use_EntryClockPrevious");
    const third=read();
    expect(third.observations.some(o=>o.roles.includes("Guard")||o.roles.includes("Conservator"))).toBe(false);
    const take=third.observations.filter(o=>o.kind==="action"&&((o as any).actionKinds??[]).includes("Take"));
    const courier=third.observations.filter(o=>o.kind==="fragment"&&o.roles.includes("Courier"));
    if(take.length!==1||courier.length!==1)throw new Error(`Third authored recording needs actual Take and Courier surfaces: ${take.length}/${courier.length}`);
    for(const mark of [take[0],courier[0]]) {
      await selectObservationId(input,mark.id,"third authored public mark");await tap(input,"Use_PinGlass");
    }
    await tap(input,"Use_SuspectCourier");await tap(input,"Use_CheckStamp");
    const proved=await waitStage("friend proves third independently authored case",s=>s.verdictStatus==="proved");
    expect(proved.caseId).toBe(empty.caseId);
    expect(proved.completed).toBe(true);
    expect(proved.evidenceIds.length).toBe(2);
    expect(proved.evidenceIds.includes(take[0].id)).toBe(true);
    expect(proved.evidenceIds.includes(courier[0].id)).toBe(true);
    } finally {input.stopSelecting();}
  }
}
