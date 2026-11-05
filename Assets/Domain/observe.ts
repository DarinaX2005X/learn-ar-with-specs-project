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
  Witness,
} from "./types";
import { add, poseAt, project, sight, distance } from "./geometry";
import { sampleContactPose } from "./ContactPose";
type ContactSamples = ReturnType<typeof sampleContactPose>[];
const geometryCache = new WeakMap<
  Board,
  {
    sights: Map<string, Vec3 | undefined>;
    samples: Map<string, ContactSamples>;
    sightHits: number;
    sightComputations: number;
    sampleHits: number;
  }
>();
function cacheFor(board: Board) {
  // Tests/tools may mutate an unsealed board. Only immutable compiled geometry
  // may reuse visibility, so a real geometry edit cannot retain old evidence.
  if (!Object.isFrozen(board)) return;
  let cache = geometryCache.get(board);
  if (!cache) {
    cache = {
      sights: new Map(),
      samples: new Map(),
      sightHits: 0,
      sightComputations: 0,
      sampleHits: 0,
    };
    geometryCache.set(board, cache);
  }
  return cache;
}
function seen(board: Board, w: Witness, p: Vec3, via: "direct" | "mirror") {
  const cache = cacheFor(board);
  if (!cache) return sight(board, w, p, via);
  const key = [w.id, via, p.x, p.y, p.z].join("|");
  if (cache.sights.has(key)) {
    cache.sightHits++;
    return cache.sights.get(key);
  }
  cache.sightComputations++;
  const q = sight(board, w, p, via);
  if (cache.sights.size < 8192) cache.sights.set(key, q);
  return q;
}
/** Bounded counters for integration/performance tests; no identity or history. */
export function observationWork(board: Board) {
  const c = geometryCache.get(board);
  return c
    ? {
        sightHits: c.sightHits,
        sightComputations: c.sightComputations,
        sampleHits: c.sampleHits,
        sampleEntries: c.samples.size,
        sightEntries: c.sights.size,
      }
    : undefined;
}
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
export function observe(
  board: Board,
  h: History,
  legacyRecorder = false,
): WitnessTape {
  const clues: Clue[] = [];
  // Pose sampling is shared with Spatial, not a second hand-coordinate formula.
  const cache = cacheFor(board),
    sampleKey = JSON.stringify([h.take, h.brushes, h.pass, h.stash]);
  let samples = cache?.samples.get(sampleKey);
  if (samples) cache!.sampleHits++;
  else {
    samples = Array.from({ length: 25 }, (_, tick) =>
      sampleContactPose(board, h, tick),
    );
    if (cache && cache.samples.size < 256)
      cache.samples.set(sampleKey, samples);
  }
  for (const w of board.witnesses) {
    const starts: Record<string, number> = {};
    for (let tick = 0; tick <= 24; tick++) {
      const payload: FramePayload = legacyRecorder
        ? { fragments: [], hands: [], actions: [] }
        : { fragments: [], hands: [], actions: [], palms: [] };
      const sample = samples[tick];
      const fragments = new Map<string, string>();
      const surface = (
        p: Vec3,
        right: Vec3,
        via: "direct" | "mirror",
        radius = 0.025,
      ) => {
        const q = seen(board, w, p, via);
        if (!q) return;
        for (const x of [-radius, radius])
          for (const y of [-radius, radius])
            if (
              !seen(
                board,
                w,
                add(p, { x: right.x * x, y, z: right.z * x }),
                via,
              )
            )
              return;
        return {
          position: { ...p },
          surfaceRight: right,
          projection: project(w, q),
          via,
        };
      };
      for (const track of board.tracks) {
        const pose = sample.positions.get(track.id)!,
          p = { x: pose.x, y: pose.y, z: pose.z };
        const right = { x: Math.cos(pose.yaw), y: 0, z: -Math.sin(pose.yaw) };
        for (const via of ["direct", "mirror"] as const) {
          const key = track.id + via,
            q = seen(board, w, p, via);
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
          const recognizable = corners.every((c) => !!seen(board, w, c, via));
          const segment = `${w.id}:${via}:${board.tracks.indexOf(track)}:${starts[key]}`;
          payload.fragments.push({
            position: p,
            surfaceRight: right,
            projection: project(w, q),
            via,
            segment,
            ...(recognizable ? { role: h.casting[track.id] } : {}),
          });
          fragments.set(key, segment);
          if (legacyRecorder && carrierAt(board, h, tick) === track.id)
            payload.hands.push({ position: p, via });
        }
        if (legacyRecorder) continue;
        for (const via of ["direct", "mirror"] as const) {
          const key = track.id + "palm" + via,
            region = surface(sample.hands.get(track.id)!, right, via);
          if (!region) {
            delete starts[key];
            continue;
          }
          // Coincident palms at a transfer do not reveal which one owns the
          // shared gem. Record the visible contact event, never a guessed
          // receiver-full/donor-empty pair from the private carrier variable.
          if (
            board.tracks.some(
              (other) =>
                other.id !== track.id &&
                distance(sample.hands.get(other.id)!, region.position) < 0.06,
            )
          ) {
            delete starts[key];
            if (sample.carrier === track.id)
              payload.hands.push({ position: region.position, via });
            continue;
          }
          if (starts[key] === undefined) starts[key] = tick;
          const segment =
            fragments.get(track.id + via) ??
            `${w.id}:${via}:palm:${board.tracks.indexOf(track)}:${starts[key]}`;
          const present = sample.carrier === track.id;
          payload.palms!.push({ ...region, segment, present });
          if (present)
            payload.hands.push({ position: region.position, via, segment });
        }
      }
      const exhibit = board.room.exhibit.position;
      if (legacyRecorder) {
        // Exact v1 projection for an already-sealed v1 tape only. Do not attach
        // v2 palm provenance or offer these legacy assumptions as new evidence.
        const visible = (p: Vec3) =>
          seen(board, w, p, "direct") || seen(board, w, p, "mirror");
        const point = (id: TrackId) => {
          const p = sample.positions.get(id)!;
          return { x: p.x, y: p.y, z: p.z };
        };
        if (visible(exhibit)) payload.exhibit = tick < board.alarmTick;
        if (
          tick === board.alarmTick &&
          visible(point(h.take)) &&
          visible(exhibit)
        )
          payload.actions.push({ kind: "Take", positions: [point(h.take)] });
        for (const brush of h.brushes)
          if (
            brush.tick === tick &&
            visible(point(brush.track)) &&
            visible(exhibit)
          )
            payload.actions.push({
              kind: "BrushRim",
              positions: [point(brush.track)],
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
      } else {
        for (const via of ["direct", "mirror"] as const) {
          const right = { x: Math.cos(w.yaw), y: 0, z: -Math.sin(w.yaw) },
            region = surface(exhibit, right, via, 0.04);
          // A palm covering the socket is a gap, not proof of an empty socket.
          if (
            region &&
            !Array.from(sample.hands.values()).some(
              (p) => distance(p, exhibit) < 0.06,
            )
          ) {
            payload.exhibit = tick < board.alarmTick;
            payload.exhibitSurface = region;
            break;
          }
        }
        for (const event of sample.contacts)
          for (const via of ["direct", "mirror"] as const) {
            const pose = sample.positions.get(event.tracks[0])!,
              right = { x: Math.cos(pose.yaw), y: 0, z: -Math.sin(pose.yaw) };
            const contact = surface(event.position, right, via);
            const positions = event.tracks.map((id) => {
              const p = sample.positions.get(id)!;
              return { x: p.x, y: p.y, z: p.z };
            });
            if (contact && positions.every((p) => !!seen(board, w, p, via)))
              payload.actions.push({
                kind: event.kind,
                positions,
                contacts: [contact.position],
                via,
                projection: contact.projection,
                surfaceRight: right,
                ...(event.box ? { box: event.box } : {}),
              });
          }
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
    if (frame.payload.palms === undefined) {
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
  }
  for (const palm of frame.payload.palms ?? []) {
    const hand = frame.payload.hands.find(
      (h) => h.segment === palm.segment && h.via === palm.via,
    );
    result.push(
      view(
        "hand:" + encodeURIComponent(palm.segment),
        {
          fragments: [],
          hands: palm.present && hand ? [JSON.parse(JSON.stringify(hand))] : [],
          actions: [],
          palms: [JSON.parse(JSON.stringify(palm))],
        },
        {
          ...base,
          kind: "hand",
          position: JSON.parse(JSON.stringify(palm.position)),
          via: palm.via,
          present: palm.present,
          segment: palm.segment,
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
          ...(frame.payload.exhibitSurface
            ? {
                exhibitSurface: JSON.parse(
                  JSON.stringify(frame.payload.exhibitSurface),
                ),
              }
            : {}),
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
      if (selected.segment !== undefined) {
        if (ignoreBrush) return true;
        const expectedPalm = expected.payload.palms?.[0];
        return (
          !!expectedPalm &&
          !!actualRoot.payload.palms?.some(
            (palm) => JSON.stringify(palm) === JSON.stringify(expectedPalm),
          )
        );
      }
      const atPosition = (candidate: {
        position: Vec3;
        via: "direct" | "mirror";
      }) =>
        candidate.via === selected.via &&
        JSON.stringify(candidate.position) ===
          JSON.stringify(selected.position);
      if (actualRoot.payload.palms !== undefined) {
        if (ignoreBrush) return true;
        const fragment = actualRoot.payload.fragments.find(atPosition);
        const palm =
          fragment &&
          actualRoot.payload.palms.find(
            (p) => p.segment === fragment.segment && p.via === selected.via,
          );
        return !!palm && palm.present === selected.present;
      }
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
        actualRoot.payload.actions.some((action) =>
          (ignoreBrush && expected.payload.actions[0].contacts) ||
          (!expected.payload.actions[0].contacts && !!action.contacts)
            ? JSON.stringify({
                kind: action.kind,
                positions: action.positions,
                box: action.box,
              }) ===
              JSON.stringify({
                kind: expected.payload.actions[0].kind,
                positions: expected.payload.actions[0].positions,
                box: expected.payload.actions[0].box,
              })
            : JSON.stringify(action) ===
              JSON.stringify(expected.payload.actions[0]),
        )
      );
    }
    if (ignoreBrush && expected.payload.exhibitSurface) return true;
    return (
      actualRoot.payload.exhibit === expected.payload.exhibit &&
      (!expected.payload.exhibitSurface ||
        JSON.stringify(actualRoot.payload.exhibitSurface) ===
          JSON.stringify(expected.payload.exhibitSurface))
    );
  }
  const cleaned = (clue: Clue) =>
    clue.kind === "Frame" && ignoreBrush
      ? {
          ...clue,
          payload: {
            ...clue.payload,
            actions: clue.payload.actions
              .filter((action) => action.kind !== "BrushRim")
              .map((action) =>
                clue.payload.palms !== undefined
                  ? {
                      kind: action.kind,
                      positions: action.positions,
                      ...(action.box ? { box: action.box } : {}),
                    }
                  : action,
              ),
            // Brush choreography can move a visible empty palm and can move a
            // gem held by that same hand. Only the relaxed solver prefilter may
            // ignore it; exact merged matching below restores every channel.
            ...(clue.payload.palms !== undefined
              ? {
                  palms: [],
                  hands: [],
                  exhibit: undefined,
                  exhibitSurface: undefined,
                }
              : {}),
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
