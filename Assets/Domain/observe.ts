import {
  Board,
  Clue,
  Field,
  FrameClue,
  FramePayload,
  History,
  TrackId,
  Vec3,
  WitnessTape,
} from "./types";
import { add, poseAt, project, sight } from "./geometry";
export function carrierAt(
  board: Board,
  h: History,
  tick: number,
): TrackId | undefined {
  if (tick < board.alarmTick || (h.stash && tick >= h.stash.tick)) return;
  return h.pass && tick >= h.pass.tick ? h.pass.to : h.take;
}
export function answer(
  board: Board,
  h: History,
  field: Field,
): string | number {
  switch (field) {
    case "taker":
      return h.casting[h.take];
    case "recipient":
      return h.pass ? h.casting[h.pass.to] : "None";
    case "cache":
      return h.stash?.box ?? "None";
    case "takeTick":
      return board.alarmTick;
    case "passTick":
      return h.pass?.tick ?? "None";
    case "stashTick":
      return h.stash?.tick ?? "None";
  }
}
/** Fragment identity is local to one uninterrupted visible segment, never an actor ID. */
export function observe(board: Board, h: History): WitnessTape {
  const clues: Clue[] = [];
  for (const w of board.witnesses) {
    const starts: Record<string, number> = {};
    for (let tick = 0; tick <= 24; tick++) {
      const payload: FramePayload = { fragments: [], hands: [], actions: [] };
      const visible = (p: Vec3) =>
        sight(board, w, p, "direct") || sight(board, w, p, "mirror");
      for (const track of board.tracks) {
        const pose = poseAt(track, tick),
          p = { x: pose.x, y: pose.y, z: pose.z };
        const right = { x: Math.cos(pose.yaw), y: 0, z: -Math.sin(pose.yaw) };
        for (const via of ["direct", "mirror"] as const) {
          const key = track.id + via,
            q = sight(board, w, p, via);
          if (!q) {
            delete starts[key];
            continue;
          }
          if (starts[key] === undefined) starts[key] = tick;
          const hw = (track.markerWidth ?? 0.08) / 2,
            hh = (track.markerHeight ?? 0.08) / 2;
          const corners = [
            [-hw, -hh],
            [-hw, hh],
            [hw, -hh],
            [hw, hh],
          ].map(([x, y]) => add(p, { x: right.x * x, y, z: right.z * x }));
          const recognizable = corners.every((c) => !!sight(board, w, c, via));
          payload.fragments.push({
            position: p,
            surfaceRight: right,
            projection: project(w, q),
            via,
            segment: `${w.id}:${via}:${board.tracks.indexOf(track)}:${starts[key]}`,
            ...(recognizable ? { role: h.casting[track.id] } : {}),
          });
          if (carrierAt(board, h, tick) === track.id)
            payload.hands.push({ position: p, via });
        }
      }
      const point = (id: TrackId) => {
        const p = poseAt(board.tracks.find((t) => t.id === id)!, tick);
        return { x: p.x, y: p.y, z: p.z };
      };
      const exhibit = board.room.exhibit.position;
      if (visible(exhibit)) payload.exhibit = tick < board.alarmTick;
      if (
        tick === board.alarmTick &&
        visible(point(h.take)) &&
        visible(exhibit)
      )
        payload.actions.push({ kind: "Take", positions: [point(h.take)] });
      for (const b of h.brushes)
        if (b.tick === tick && visible(point(b.track)) && visible(exhibit))
          payload.actions.push({
            kind: "BrushRim",
            positions: [point(b.track)],
          });
      if (
        h.pass &&
        h.pass.tick === tick &&
        visible(point(h.pass.from)) &&
        visible(point(h.pass.to))
      )
        payload.actions.push({
          kind: "Pass",
          positions: [point(h.pass.from), point(h.pass.to)],
        });
      if (h.stash && h.stash.tick === tick) {
        const box = board.room.boxes!.find((b) => b.id === h.stash!.box)!;
        if (visible(point(h.stash.carrier)) && visible(box.position))
          payload.actions.push({
            kind: "Stash",
            positions: [point(h.stash.carrier), box.position],
            box: box.id,
          });
      }
      payload.actions.sort((a, b) =>
        JSON.stringify(a).localeCompare(JSON.stringify(b)),
      );
      clues.push({
        id: `frame:${w.id}:${tick}`,
        witness: w.id,
        tick,
        kind: "Frame",
        payload,
      });
    }
  }
  clues.push({
    id: "rim:" + board.room.exhibit.id,
    kind: "Rim",
    surfaceId: board.room.exhibit.id,
    shapes: h.brushes.map((b) => h.casting[b.track]).sort(),
  });
  for (const box of board.room.boxes ?? [])
    clues.push({
      id: "box:" + box.id,
      kind: "Box",
      box: box.id,
      present: h.stash?.box === box.id,
    });
  return { caseId: board.caseId, rev: board.rev, clues };
}
/** Exact discrete frame only: never bridges gaps or interpolates a hidden identity. */
export function frameAt(
  tape: WitnessTape,
  witness: string,
  tick: number,
): FrameClue | undefined {
  return tape.clues.find(
    (c): c is FrameClue =>
      c.kind === "Frame" && c.witness === witness && c.tick === tick,
  );
}
/** Public crops are derived views, not duplicate facts inserted into the tape.
 * IDs include case/revision/source/tick/segment and never include an actor role. */
export function getObservations(
  tape: WitnessTape,
  witness: string,
  tick: number,
): FrameClue[] {
  const frame = frameAt(tape, witness, tick);
  if (!frame) return [];
  const prefix = `observation:${encodeURIComponent(tape.caseId)}:${tape.rev}:${frame.id}`;
  const base = { caseId: tape.caseId, rev: tape.rev, frameId: frame.id };
  const view = (
    suffix: string,
    payload: FramePayload,
    observation: NonNullable<FrameClue["observation"]>,
  ): FrameClue => ({
    id: prefix + "/" + suffix,
    kind: "Frame",
    witness: frame.witness,
    tick: frame.tick,
    payload,
    observation,
  });
  const result: FrameClue[] = [];
  for (const fragment of frame.payload.fragments) {
    result.push(
      view(
        "fragment:" + encodeURIComponent(fragment.segment),
        {
          fragments: [JSON.parse(JSON.stringify(fragment))],
          hands: [],
          actions: [],
        },
        { ...base, kind: "fragment", segment: fragment.segment },
      ),
    );
    const hand = frame.payload.hands.find(
      (hand) =>
        hand.via === fragment.via &&
        JSON.stringify(hand.position) === JSON.stringify(fragment.position),
    );
    result.push(
      view(
        "hand:" + encodeURIComponent(fragment.segment),
        {
          fragments: [],
          hands: hand ? [JSON.parse(JSON.stringify(hand))] : [],
          actions: [],
        },
        {
          ...base,
          kind: "hand",
          position: JSON.parse(JSON.stringify(fragment.position)),
          via: fragment.via,
          present: !!hand,
        },
      ),
    );
  }
  frame.payload.actions.forEach((action, index) =>
    result.push(
      view(
        "action:" + index,
        {
          fragments: [],
          hands: [],
          actions: [JSON.parse(JSON.stringify(action))],
        },
        { ...base, kind: "action", index },
      ),
    ),
  );
  if (frame.payload.exhibit !== undefined)
    result.push(
      view(
        "exhibit",
        {
          fragments: [],
          hands: [],
          actions: [],
          exhibit: frame.payload.exhibit,
        },
        { ...base, kind: "exhibit" },
      ),
    );
  return result;
}
/** Resolve roots, timeless object evidence and derived crops through one boundary. */
export function resolveObservation(
  tape: WitnessTape,
  id: string,
): Clue | undefined {
  const root = tape.clues.find((clue) => clue.id === id);
  if (root) return root;
  for (const frame of tape.clues)
    if (frame.kind === "Frame") {
      const found = getObservations(tape, frame.witness, frame.tick).find(
        (view) => view.id === id,
      );
      if (found) return found;
    }
  return undefined;
}
/** Compare a crop against its complete candidate source. Other visible surfaces,
 * hands, contacts and empty regions are unconstrained by a fragment-only pin. */
export function matchesObservation(
  expected: Clue,
  actualRoot: Clue | undefined,
  ignoreBrush = false,
): boolean {
  if (!actualRoot) return false;
  if (expected.kind === "Frame" && expected.observation) {
    if (
      actualRoot.kind !== "Frame" ||
      actualRoot.id !== expected.observation.frameId ||
      actualRoot.witness !== expected.witness ||
      actualRoot.tick !== expected.tick
    )
      return false;
    const selected = expected.observation;
    if (selected.kind === "fragment")
      return (
        expected.payload.fragments.length === 1 &&
        actualRoot.payload.fragments.some(
          (candidate) =>
            JSON.stringify(candidate) ===
            JSON.stringify(expected.payload.fragments[0]),
        )
      );
    if (selected.kind === "hand") {
      const atPosition = (candidate: {
        position: Vec3;
        via: "direct" | "mirror";
      }) =>
        candidate.via === selected.via &&
        JSON.stringify(candidate.position) ===
          JSON.stringify(selected.position);
      return (
        actualRoot.payload.fragments.some(atPosition) &&
        actualRoot.payload.hands.some(atPosition) === selected.present
      );
    }
    if (selected.kind === "action") {
      if (ignoreBrush && expected.payload.actions[0]?.kind === "BrushRim")
        return true;
      return (
        expected.payload.actions.length === 1 &&
        actualRoot.payload.actions.some(
          (action) =>
            JSON.stringify(action) ===
            JSON.stringify(expected.payload.actions[0]),
        )
      );
    }
    return actualRoot.payload.exhibit === expected.payload.exhibit;
  }
  const cleaned = (clue: Clue) =>
    clue.kind === "Frame" && ignoreBrush
      ? {
          ...clue,
          payload: {
            ...clue.payload,
            actions: clue.payload.actions.filter(
              (action) => action.kind !== "BrushRim",
            ),
          },
        }
      : clue;
  return (
    JSON.stringify(cleaned(expected)) === JSON.stringify(cleaned(actualRoot))
  );
}
export function compareObservations(
  expected: WitnessTape,
  actual: WitnessTape,
  ids?: readonly string[],
): string[] {
  const selected = ids ?? expected.clues.map((clue) => clue.id);
  if (expected.caseId !== actual.caseId || expected.rev !== actual.rev)
    return [...selected];
  const index = new Map(actual.clues.map((clue) => [clue.id, clue]));
  return selected.filter((id) => {
    const view = resolveObservation(expected, id);
    if (!view) return true;
    const rootId =
      view.kind === "Frame" && view.observation
        ? view.observation.frameId
        : view.id;
    return !matchesObservation(view, index.get(rootId));
  });
}
