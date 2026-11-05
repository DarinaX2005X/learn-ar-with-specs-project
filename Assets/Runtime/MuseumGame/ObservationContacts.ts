import { FrameClue } from "../../Domain/types";

export interface ObservationSurface {
  observationId?: string;
  kind?: "fragment" | "hand" | "action" | "exhibit";
  segment: string;
  via: "direct" | "mirror";
  centerCm: readonly [number, number, number];
  widthCm: number;
  heightCm: number;
}
export interface ObservationContact {
  slot: number;
  centerCm: readonly [number, number, number];
  widthCm: number;
  heightCm: number;
  observations: readonly FrameClue[];
}
export interface ObservationTargetView {
  readonly targetName: string;
  readonly observationId: string;
  readonly observationIds: readonly string[];
  readonly selectedObservationId?: string;
}
/** A hit belongs to visible marks in this one glass frame. Repeated deliberate
 * taps choose among overlapping marks; a pin never bundles their assertions. */
export function observationContacts(
  surfaces: readonly ObservationSurface[],
  observations: readonly FrameClue[],
): ObservationContact[] {
  const entries = surfaces
    .map((surface, slot) => {
      const observation = surface.observationId
        ? observations.find((view) => view.id === surface.observationId)
        : observations.find(
            (view) =>
              view.observation?.kind === "fragment" &&
              view.payload.fragments.some(
                (fragment) =>
                  fragment.segment === surface.segment &&
                  fragment.via === surface.via,
              ),
          );
      const width = Math.max(2, surface.widthCm + 1),
        height = Math.max(3, surface.heightCm + 1);
      return { surface, slot, observation, width, height };
    })
    .filter(
      (entry) =>
        entry.observation &&
        entry.surface.widthCm > 0 &&
        entry.surface.heightCm > 0 &&
        entry.surface.centerCm.every(Number.isFinite),
    );
  const sets = entries.map((_, index) => index);
  const root = (index: number): number =>
    sets[index] === index ? index : (sets[index] = root(sets[index]));
  for (let a = 0; a < entries.length; a++)
    for (let b = a + 1; b < entries.length; b++) {
      const x = entries[a],
        y = entries[b];
      if (
        Math.abs(x.surface.centerCm[0] - y.surface.centerCm[0]) <
          (x.width + y.width) / 2 &&
        Math.abs(x.surface.centerCm[1] - y.surface.centerCm[1]) <
          (x.height + y.height) / 2
      )
        sets[root(b)] = root(a);
    }
  const groups = new Map<number, typeof entries>();
  entries.forEach((entry, index) => {
    const key = root(index);
    const group = groups.get(key) ?? [];
    group.push(entry);
    groups.set(key, group);
  });
  return [...groups.values()]
    .map((group) => {
      const left = Math.min(
        ...group.map((entry) => entry.surface.centerCm[0] - entry.width / 2),
      );
      const right = Math.max(
        ...group.map((entry) => entry.surface.centerCm[0] + entry.width / 2),
      );
      const bottom = Math.min(
        ...group.map((entry) => entry.surface.centerCm[1] - entry.height / 2),
      );
      const top = Math.max(
        ...group.map((entry) => entry.surface.centerCm[1] + entry.height / 2),
      );
      return {
        slot: Math.min(...group.map((entry) => entry.slot)),
        centerCm: [
          (left + right) / 2,
          (bottom + top) / 2,
          Math.max(...group.map((entry) => entry.surface.centerCm[2])),
        ] as const,
        widthCm: right - left,
        heightCm: top - bottom,
        observations: [
          ...new Map(
            group.map((entry) => [entry.observation!.id, entry.observation!]),
          ).values(),
        ],
      };
    })
    .sort((a, b) => a.slot - b.slot);
}
export function nextObservation(
  contact: ObservationContact,
  focusedId?: string,
): FrameClue | undefined {
  if (!contact.observations.length) return undefined;
  const index = contact.observations.findIndex((view) => view.id === focusedId);
  return contact.observations[(index + 1) % contact.observations.length];
}
export function observationLabel(view: FrameClue): string {
  switch (view.observation?.kind) {
    case "fragment":
      return view.payload.fragments[0]?.role ?? "Visible silhouette";
    case "hand":
      return view.payload.hands.length
        ? "Ruby in this hand"
        : "Visible empty palm";
    case "action": {
      const action = view.payload.actions[0];
      return action?.kind === "Pass"
        ? "Visible ruby handoff"
        : action?.kind === "Take"
          ? "Ruby lifted here"
          : action?.kind === "Stash"
            ? "Ruby placed here"
            : "Visible rim touch";
    }
    case "exhibit":
      return view.payload.exhibit ? "Ruby in the case" : "Empty ruby nest";
    default:
      return "Visible mark";
  }
}
