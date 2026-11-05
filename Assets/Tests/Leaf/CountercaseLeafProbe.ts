import { sleep } from "Leaf.lspkg/Utils/common/Utils";
import { findInteractablesByName } from "Leaf.lspkg/Interactors/InteractableUtils";

export interface CountercaseSnapshot {
  revision: number;
  caseId: string;
  aperture: number;
  tick: number;
  observedRoles: string[];
  possibleCulprits: string[];
  frameId: string;
  frameRevision: string | number;
  frameObservedRoles: string[];
  mode: string;
  playing: boolean;
  preview: boolean;
  testing: boolean;
  testedRev: number | null;
  canSeal: boolean;
  needsAmbiguityConfirmation: boolean;
  evidenceIds: string[];
  observations: {
    id: string;
    roles: string[];
    kind?: "fragment" | "hand" | "action" | "exhibit";
  }[];
  observationTargets: {
    targetName: string;
    observationId: string;
    observationIds?: readonly string[];
    selectedObservationId?: string;
  }[];
  focusedObservationId: string | null;
  verdictStatus: string | null;
  errors: unknown[];
}

/** Read-only telemetry. No setter, compile call, or production action is invoked here. */
export function read(): CountercaseSnapshot {
  const hook = (global as any).countercaseLeaf;
  if (!hook || typeof hook.read !== "function")
    throw new Error("countercaseLeaf.read is not mounted");
  // Retain values, not references into mutable runtime arrays.
  return JSON.parse(JSON.stringify(hook.read())) as CountercaseSnapshot;
}

export function target(name: string) {
  const matches = findInteractablesByName(name, undefined, true);
  if (matches.length !== 1)
    throw new Error(
      `${name}: expected one enabled SIK Interactable, got ${matches.length}`,
    );
  return matches[0]!;
}

export async function waitFor(
  label: string,
  predicate: (s: CountercaseSnapshot) => boolean,
): Promise<CountercaseSnapshot> {
  for (let i = 0; i < 100; i++) {
    const state = read();
    if (predicate(state)) return state;
    await sleep(50);
  }
  throw new Error(
    `${label}: timed out after 5000ms; snapshot=${JSON.stringify(read())}`,
  );
}

export function sorted(values: string[]): string[] {
  return values.slice().sort();
}
