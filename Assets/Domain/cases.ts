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
  const entryScreen = draft.room.walls.find(
    (wall) => wall.id === "entry-screen",
  )!;
  const eastScreen = draft.room.walls.find(
    (wall) => wall.id === "east-screen",
  )!;
  entryScreen.b.x = 2.05;
  eastScreen.a.x = 3.2;
  eastScreen.b.x = 3.2;
  draft.tracks = [
    track("A", [
      [0, 1.8, 0.9, Math.atan2(0.45, -0.05)],
      [3, 1.8, 0.9, Math.atan2(0.45, -0.05)],
      [5, 2.25, 0.85, Math.atan2(0.45, -0.05)],
      [6, 2.25, 0.85, Math.atan2(0.3, 0.1)],
      [8, 2.55, 0.95, Math.atan2(0.3, 0.1)],
      [12, 2.55, 0.95, Math.atan2(0.3, 0.1)],
      [14, 2.85, 1.05, Math.atan2(0.3, 0.1)],
      [15, 2.85, 1.05, Math.atan2(0.25, 0.15)],
      [17, 3.1, 1.2, Math.atan2(0.25, 0.15)],
      [24, 3.1, 1.2, Math.atan2(0.25, 0.15)],
    ]),
    track("B", [
      [0, 1.8, 3.2, Math.atan2(0.4, 0.6)],
      [4, 1.8, 3.2, Math.atan2(0.4, 0.6)],
      [6, 2.2, 3.8, Math.atan2(0.4, 0.6)],
      [7, 2.2, 3.8, 0],
      [8, 2.2, 4, 0],
      [9, 2.2, 4, Math.PI / 2],
      [10, 2.3, 4, Math.PI / 2],
      [12, 2.3, 4, Math.PI / 2],
      [14, 2.3, 4, Math.PI / 2, true],
      [15, 2.15, 4, Math.PI / 2],
      [16, 2.15, 4, -Math.PI / 2],
      [17, 2.05, 4, -Math.PI / 2],
      [18, 2.05, 4, Math.atan2(-0.25, -0.8)],
      [21, 1.8, 3.2, Math.atan2(-0.25, -0.8)],
      [24, 1.8, 3.2, Math.atan2(-0.25, -0.8)],
    ]),
    track("C", [
      [0, 5.2, 3.3, Math.PI / 2],
      [4, 5.2, 3.3, Math.PI / 2],
      [6, 5.8, 3.3, Math.PI / 2],
      [7, 5.8, 3.3, Math.atan2(-0.2, 0.3)],
      [9, 5.6, 3.6, Math.atan2(-0.2, 0.3)],
      [12, 5.6, 3.6, Math.atan2(-0.2, 0.3)],
      [16, 5.6, 3.6, Math.atan2(-0.2, 0.3)],
      [20, 5.2, 4.2, Math.atan2(-0.2, 0.3)],
      [24, 5.2, 4.2, Math.atan2(-0.2, 0.3)],
    ]),
  ];
  return draft;
}
function track(
  id: "A" | "B" | "C",
  tuples: (number[] | [number, number, number, number, boolean])[],
): Track {
  return {
    id,
    keys: tuples.map(
      ([tick, x, z, yaw = 0, backward]): Key => ({
        tick,
        x,
        z,
        yaw,
        y: 1,
        ...(backward === true ? { backward: true } : {}),
      }),
    ),
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
        [10, 2.8, 4.2],
        [11, 2.8, 3.65, -Math.PI / 2],
        [12, 2.65, 3.65, -Math.PI / 2],
        [13, 2.65, 3.65, -Math.PI / 2],
        [14, 3.65, 3.65, Math.PI],
        [15, 3.65, 3.65, Math.PI],
        [16, ...(recipient === "B" ? [3.65, 3.65, Math.PI] : [4.4, 3.55, 0])],
        [17, 4.4, 3.55, 0],
        [18, 4.4, 3.55, 0],
        [20, 5.4, 4.55],
        [24, 5.4, 4.55],
      ]),
      track("B", [
        [0, 6.4, 2.05],
        [10, 6.4, 2.05],
        [14, 3.65, 3, 0],
        [15, 3.65, 3, 0],
        [16, 3.65, 3, 0],
        [18, 4.1, 2.2],
        [
          20,
          ...(options.canvas && recipient === "C" ? [5.2, 2.2] : [4.85, 1.4]),
          -Math.PI / 2,
        ],
        [22, 5.45, 1.2, Math.PI / 2],
        [23, 5.45, 1.2, Math.PI / 2],
        [24, 5.75, 0.6],
      ]),
      track("C", [
        [0, 1.6, 2.75],
        [2, 1.6, 2.75],
        [4, 1.6, 3.65, Math.PI / 2],
        [5, 1.75, 3.65, Math.PI / 2],
        [6, 1.75, 3.65, Math.PI / 2, true],
        [7, 1.6, 3.65, Math.PI / 2],
        [8, 1.6, 3.65, -Math.PI / 2],
        [9, 1.0, 3.65, -Math.PI / 2],
        [10, 1.0, 4.55, 0],
        [11, 1.0, 4.55, Math.PI / 2],
        [14, 3.8, 4.55],
        [16, 4.4, 4.2, Math.PI],
        [17, 4.4, 4.2, Math.PI],
        [18, 4.4, 4.2, Math.PI],
        [
          19,
          ...(options.canvas && recipient === "C" ? [3.9, 3.75] : [5.6, 4.4]),
        ],
        [
          20,
          ...(options.canvas && recipient === "C" ? [3.4, 3.3] : [6.1, 3.3]),
        ],
        [
          22,
          ...(options.canvas && recipient === "C" ? [4.35, 1.4] : [6.05, 1.2]),
          -Math.PI / 2,
        ],
        [
          23,
          ...(options.canvas && recipient === "C" ? [4.35, 1.4] : [6.05, 1.2]),
          -Math.PI / 2,
        ],
        [
          24,
          ...(options.canvas && recipient === "C" ? [4.35, 1.4] : [5.75, 1.8]),
        ],
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
        tick: options.canvas && recipient === "B" ? 20 : 22,
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
