import { DefaultLeafInteractor } from "Leaf.lspkg/Interactors/interactor/DefaultLeafInteractor";
import { sleep } from "Leaf.lspkg/Utils/common/Utils";
import { expect } from "Leaf.lspkg/Utils/common/Expect";
import {
  read,
  target,
  waitFor,
  sorted,
  CountercaseSnapshot,
} from "./CountercaseLeafProbe";

export async function tap(
  input: DefaultLeafInteractor,
  name: string,
): Promise<void> {
  let control: ReturnType<typeof target>;
  try {
    control = target(name);
  } catch (error) {
    throw new Error(`[SIK ${name} lookup] ${String(error)}`);
  }
  try {
    await input.trigger(control);
  } catch (error) {
    throw new Error(`[SIK ${name} trigger] ${String(error)}`);
  }
  await sleep(100);
}

export async function stageCopy(
  input: DefaultLeafInteractor,
): Promise<CountercaseSnapshot> {
  const publicState = await waitFor(
    "normal public museum entry",
    (s) => s.mode === "detective",
  );
  await tap(input, "Use_StagingFile");
  const copy = await waitFor(
    "author copy from rack",
    (s) => s.mode === "author",
  );
  expect(copy.caseId === publicState.caseId).toBe(false);
  expect(copy.aperture).toBe(publicState.aperture);
  return copy;
}

/** Normal lid actions start proof, confirm ambiguity, seal and open the public recording. */
export async function testAndOpen(
  input: DefaultLeafInteractor,
  culprits: string[],
): Promise<CountercaseSnapshot> {
  const draft = read();
  expect(draft.mode).toBe("author");
  await tap(input, "Use_CaseLid");
  const tested = await waitFor(
    "real author test result",
    (s) =>
      !s.testing &&
      s.testedRev === draft.revision &&
      s.possibleCulprits.length > 0,
  );
  expect(sorted(tested.possibleCulprits)).toEqual(sorted(culprits));
  expect(tested.errors).toEqual([]);
  if (tested.needsAmbiguityConfirmation) {
    await tap(input, "Use_CaseLid");
    await waitFor("explicit ambiguity confirmation", (s) => s.canSeal);
  }
  expect(read().canSeal).toBe(true);
  await tap(input, "Use_CaseLid");
  await waitFor("sealed case cover", (s) => s.mode === "handoff");
  await tap(input, "Use_CaseLid");
  const opened = await waitFor(
    "public opens sealed copy",
    (s) => s.mode === "detective" && s.caseId === draft.caseId,
  );
  expect(opened.revision).toBe(draft.revision);
  expect(opened.aperture).toBe(draft.aperture);
  return opened;
}

export async function alarmFrame(
  input: DefaultLeafInteractor,
): Promise<CountercaseSnapshot> {
  await waitFor("public recording controls", (s) => s.mode === "detective");
  // A clock toggle can race the natural intro stop. Physical step actions
  // always seek and pause, even if the intro finishes during this gesture.
  if (read().playing && read().tick === 12)
    await tap(input, "Use_EntryClockPrevious");
  for (
    let step = 0;
    step < 25 && (read().tick !== 12 || read().playing);
    step++
  ) {
    await tap(
      input,
      read().tick < 12 ? "Use_EntryClockNext" : "Use_EntryClockPrevious",
    );
  }
  expect(read().tick).toBe(12);
  expect(read().playing).toBe(false);
  await tap(input, "Use_Sourceentrance");
  return waitFor(
    "rendered public alarm recording",
    (s) =>
      s.mode === "detective" &&
      s.tick === 12 &&
      !!s.frameId &&
      s.frameObservedRoles.length > 0,
  );
}

/** The public player pins what was actually rendered and checks a concrete claim. */
export async function publicProof(
  input: DefaultLeafInteractor,
  claim: "Guard" | "Conservator",
  culprits: string[],
): Promise<void> {
  for (const role of read().observedRoles) {
    await selectObservation(input, role);
    await tap(input, "Use_PinGlass");
  }
  await tap(input, "Use_Suspect" + claim);
  await tap(input, "Use_CheckStamp");
  const checked = await waitFor(
    "public evidence verdict",
    (s) => s.possibleCulprits.length > 0,
  );
  expect(sorted(checked.possibleCulprits)).toEqual(sorted(culprits));
}

/** Resolve a public mark to its actual enabled physical surface target. */
export async function selectObservation(
  input: DefaultLeafInteractor,
  role: string,
): Promise<void> {
  const marks = read().observations.filter((mark) => mark.roles.includes(role));
  if (marks.length !== 1)
    throw new Error(
      `Expected one public ${role} observation, got ${marks.length}`,
    );
  const id = marks[0]!.id;
  await selectObservationId(input, id, role);
}

/** Cycle a real physical group, with one-target compatibility and no retries beyond its size. */
export async function selectObservationId(
  input: DefaultLeafInteractor,
  id: string,
  label = id,
): Promise<void> {
  const contains = (t: ReturnType<typeof read>["observationTargets"][number]) =>
    (t.observationIds ?? [t.observationId]).includes(id);
  const state = await waitFor(`${label} physical selection target`, (s) =>
    s.observationTargets.some(contains),
  );
  const binding = state.observationTargets.find(contains)!;
  const ids = [...(binding.observationIds ?? [binding.observationId])];
  if (!ids.length || new Set(ids).size !== ids.length)
    throw new Error(`${label}: invalid physical group`);
  const caseId = state.caseId,
    rev = state.revision,
    tick = state.tick;
  for (let step = 0; step <= ids.length; step++) {
    const now = read();
    if (now.caseId !== caseId || now.revision !== rev || now.tick !== tick)
      throw new Error(`${label}: recording changed during selection`);
    const current = now.observationTargets.find(
      (t) => t.targetName === binding.targetName,
    );
    if (
      !current ||
      JSON.stringify(current.observationIds ?? [current.observationId]) !==
        JSON.stringify(ids)
    )
      throw new Error(`${label}: physical group changed during selection`);
    if (now.focusedObservationId === id) return;
    if (step === ids.length) break;
    await tap(input, binding.targetName);
  }
  throw new Error(
    `${label}: physical group exhausted after ${ids.length} taps without selecting public ID`,
  );
}
