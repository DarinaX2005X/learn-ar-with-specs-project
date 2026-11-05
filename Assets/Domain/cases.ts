import { CaseDraft, Key, Track, Witness } from "./types";
/** Authored sample input. Compiler and solver contain no case-name dispatch. */
export function createMirrorCase(open = true): CaseDraft {
  const positions = [
    [2.55, 0.95],
    [2.3, 4],
    [5.6, 3.6],
  ];
  const tracks: Track[] = positions.map(([x, z], i) => ({
    id: (["A", "B", "C"] as const)[i],
    keys: [
      { tick: 0, x, z, yaw: 0 },
      { tick: 24, x, z, yaw: 0 },
    ],
  }));
  return {
    id: "missing-ruby",
    rev: open ? 1 : 2,
    title: "The Missing Ruby",
    alarmTick: 12,
    tracks,
    casting: { A: "Courier", B: "Conservator", C: "Guard" },
    events: [{ kind: "Take", track: "B", tick: 12 }],
    room: {
      width: 7,
      depth: 5,
      exhibit: { id: "plinth", position: { x: 2.3, y: 1, z: 4 } },
      walls: [
        {
          id: "east-screen",
          a: { x: 3, y: 0, z: 2 },
          b: { x: 3, y: 0, z: 4.4 },
          bottom: 0,
          top: 2,
        },
        {
          id: "entry-screen",
          a: { x: 1.45, y: 0, z: 2.3 },
          b: { x: 2.7, y: 0, z: 2.3 },
          bottom: 0,
          top: 2,
        },
      ],
      mirror: {
        id: "mirror",
        origin: { x: 7, y: 1, z: 3.135 },
        normal: { x: -1, y: 0, z: 0 },
        right: { x: 0, y: 0, z: 1 },
        up: { x: 0, y: 1, z: 0 },
        width: 0.43,
        height: 1,
        aperture: open ? 1 : 0,
      },
    },
    witnesses: [
      {
        id: "entrance",
        position: { x: 1, y: 1, z: 1 },
        yaw: Math.PI / 2,
        fov: Math.PI,
        verticalFov: Math.PI * 0.8,
      },
    ],
  };
}
/** Moving museum staging. The fixed numeric optics fixture above stays unchanged. */
export function createMuseumTheft(open = true): CaseDraft {
  const draft = createMirrorCase(open);
  draft.id = "museum-theft";
  // The actor reaches from beside the vitrine rather than standing inside it.
  draft.room.exhibit.position = { x: 2.7, y: 1, z: 4 };
  const entryScreen = draft.room.walls.find(wall => wall.id === "entry-screen")!;
  const eastScreen = draft.room.walls.find(wall => wall.id === "east-screen")!;
  entryScreen.b.x = 2.05;
  eastScreen.a.x = 3.2;
  eastScreen.b.x = 3.2;
  draft.tracks = [
    track("A", [
      [0, 1.8, 0.9],
      [6, 2.15, 0.92],
      [12, 2.55, 0.95],
      [18, 2.85, 1.05],
      [24, 3.1, 1.2],
    ]),
    track("B", [
      [0, 1.8, 3.2],
      [8, 2.15, 3.8],
      [12, 2.3, 4],
      [16, 2.5, 4.2],
      [24, 2.1, 3.4],
    ]),
    track("C", [
      [0, 5.2, 3.3],
      [8, 5.5, 3.4],
      [12, 5.6, 3.6],
      [16, 5.4, 3.9],
      [24, 5.2, 4.2],
    ]),
  ];
  return draft;
}
function track(id: "A" | "B" | "C", tuples: number[][]): Track {
  return {
    id,
    keys: tuples.map(([tick, x, z]): Key => ({ tick, x, z, yaw: 0, y: 1 })),
  };
}
export function createPackingCase(
  options: {
    rearCamera?: boolean;
    canvas?: boolean;
    recipient?: "B" | "C";
  } = {},
): CaseDraft {
  const witnesses: Witness[] = [
    {
      id: "entrance",
      position: { x: 0.7, y: 1, z: 1.05 },
      yaw: Math.atan2(1.5, 2.6),
      fov: (76 * Math.PI) / 180,
    },
  ];
  if (options.rearCamera)
    witnesses.push({
      id: "passage",
      position: { x: 6.6, y: 1, z: 3.7 },
      yaw: Math.atan2(-2.4, -0.05),
      fov: (56 * Math.PI) / 180,
    });
  const recipient = options.recipient ?? "B";
  return {
    id: "packing-room",
    rev: 1,
    title: "The Packing Room",
    alarmTick: 12,
    chain: true,
    fields: ["taker", "recipient", "cache"],
    tracks: [
      track("A", [
        [0, 1.3, 4.2],
        [7, 1.3, 4.2],
        [11, 2.2, 3.65],
        [12, 2.2, 3.65],
        [13, 2.9, 3.7],
        [14, 3.5, 3.7],
        [15, 4.05, 3.65],
        [16, 4.45, 3.65],
        [17, 4.98, 3.55],
        [18, 5.25, 3.65],
        [20, 5.4, 4.55],
        [24, 5.4, 4.55],
      ]),
      track("B", [
        [0, 6.4, 2.05],
        [14, 4.68, 3],
        [15, 4.15, 3.62],
        [16, 4.28, 3],
        [18, 4.1, 2.2],
        [20, 4.7, 1.3],
        [22, 5.7, 1.2],
        [24, 6.4, 1.4],
      ]),
      track("C", [
        [0, 1.6, 2.75],
        [5, 2.2, 3.65],
        [6, 2.2, 3.65],
        [8, 2.1, 4.55],
        [12, 3.8, 4.55],
        [16, 5.1, 4.35],
        [17, 5, 3.62],
        [18, 5.68, 3.36],
        [20, 6.1, 2.3],
        [22, 5.8, 1.32],
        [24, 5.25, 1.32],
      ]),
    ],
    casting: { A: "Conservator", B: "Courier", C: "Guard" },
    events: [
      { kind: "Take", track: "A", tick: 12 },
      { kind: "BrushRim", track: "C", tick: 6 },
      {
        kind: "Pass",
        from: "A",
        to: recipient,
        tick: recipient === "B" ? 15 : 17,
      },
      {
        kind: "Stash",
        carrier: recipient,
        box: options.canvas ? "canvas trunk" : "brass case",
        tick: options.canvas ? 20 : 22,
      },
    ],
    room: {
      width: 7,
      depth: 5,
      exhibit: { id: "plinth", position: { x: 2.2, y: 1, z: 3.65 } },
      walls: [
        {
          id: "partition",
          a: { x: 3.1, y: 0, z: 0 },
          b: { x: 3.1, y: 0, z: 3.43 },
          bottom: 0,
          top: 2,
        },
      ],
      boxes: [
        { id: "canvas trunk", position: { x: 4.6, y: 1, z: 1.4 } },
        { id: "brass case", position: { x: 5.75, y: 1, z: 1.2 } },
      ],
    },
    witnesses,
  };
}
