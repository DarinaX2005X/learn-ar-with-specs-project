import {
  CASE_TITLE_MAX_UNITS,
  Board,
  CaseDraft,
  CompileResult,
  DomainError,
  Event,
  History,
  ROLES,
  TrackId,
  Vec3,
} from "./types";
import { clear, distance, dot, EPSILON, poseAt } from "./geometry";
import { observe } from "./observe";
import { sampleTrackMotion } from "./TrackMotion";
export function clone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v));
}
export function freeze<T>(v: T): T {
  if (v && typeof v === "object") {
    Object.values(v as object).forEach(freeze);
    Object.freeze(v);
  }
  return v;
}
export function compileCase(input: CaseDraft): CompileResult {
  const errors: DomainError[] = [];
  const error = (
    code: string,
    object: string,
    message: string,
    tick?: number,
  ) =>
    errors.push({
      code,
      object,
      message,
      ...(tick === undefined ? {} : { tick }),
    });
  // Runtime structural boundary: malformed imports produce editable errors, never exceptions.
  if (
    !input ||
    !input.room ||
    !Array.isArray(input.tracks) ||
    !Array.isArray(input.events) ||
    !Array.isArray(input.witnesses) ||
    !input.casting
  )
    return {
      ok: false,
      errors: [
        {
          code: "STRUCTURE",
          object: "case",
          message: "Room, tracks, witnesses, casting and events are required.",
        },
      ],
    };
  if (
    input.tracks.some(
      (track) =>
        !track || !Array.isArray(track.keys) || track.keys.some((key) => !key),
    ) ||
    input.events.some((event) => !event) ||
    input.witnesses.some((witness) => !witness) ||
    (Array.isArray(input.room.walls) &&
      input.room.walls.some((wall) => !wall)) ||
    (Array.isArray(input.room.boxes) && input.room.boxes.some((box) => !box))
  ) {
    return {
      ok: false,
      errors: [
        {
          code: "STRUCTURE",
          object: "case",
          message: "Remove missing objects or restore their required fields.",
        },
      ],
    };
  }
  const d = clone(input),
    r = d.room;
  const finite = (n: number) => typeof n === "number" && Number.isFinite(n);
  const vec = (p: Vec3) => p && finite(p.x) && finite(p.y) && finite(p.z);
  const tick = (n: number) => Number.isInteger(n) && n >= 0 && n <= 24;
  if (
    !d.id ||
    !Number.isInteger(d.rev) ||
    d.rev < 0 ||
    !d.title?.trim() ||
    d.title.length > CASE_TITLE_MAX_UNITS
  )
    error(
      "CASE_ID",
      "case",
      "Use an ID, nonnegative revision and title of 1–160 characters.",
    );
  if (d.unplacedTracks !== undefined) {
    if (!Array.isArray(d.unplacedTracks) ||
      new Set(d.unplacedTracks).size !== d.unplacedTracks.length ||
      d.unplacedTracks.some(id => !["A", "B", "C"].includes(id)))
      error("ACTOR_PLACEMENT", "figures", "Restore the figures in the tray before testing");
    else for (const id of d.unplacedTracks)
      error("ACTOR_UNPLACED", id, "Place " + d.casting[id] + " from the tray before testing");
  }
  if (!tick(d.alarmTick))
    error("TICK", "alarm", "Alarm must be an integer tick from 0 to 24.");
  if (
    !finite(r.width) ||
    !finite(r.depth) ||
    r.width <= 0 ||
    r.depth <= 0 ||
    !r.exhibit ||
    !vec(r.exhibit.position) ||
    !Array.isArray(r.walls) ||
    r.walls.length > 4 ||
    !Array.isArray(r.boxes ?? []) ||
    (r.boxes ?? []).length > 2
  )
    return {
      ok: false,
      errors: [
        ...errors,
        {
          code: "ROOM",
          object: "room",
          message:
            "Use positive room dimensions, one exhibit, up to four walls and two boxes.",
        },
      ],
    };
  const inside = (p: Vec3) =>
    vec(p) && p.x >= 0 && p.x <= r.width && p.z >= 0 && p.z <= r.depth;
  for (const p of [r.exhibit, ...(r.boxes ?? [])])
    if (!p.id || !inside(p.position))
      error("PLACE", p.id ?? "place", "Place must be inside the room.");
  for (const wall of r.walls)
    if (
      !wall.id ||
      !vec(wall.a) ||
      !vec(wall.b) ||
      distance(wall.a, wall.b) < EPSILON ||
      !finite(wall.bottom) ||
      !finite(wall.top) ||
      wall.top <= wall.bottom
    )
      error(
        "WALL",
        wall.id ?? "wall",
        "Wall needs a nonzero segment and ordered finite heights.",
      );
  if (
    d.tracks.length !== 3 ||
    new Set(d.tracks.map((t) => t.id)).size !== 3 ||
    d.tracks.some((t) => !["A", "B", "C"].includes(t.id))
  )
    error("TRACKS", "tracks", "Provide exactly tracks A, B and C.");
  for (const t of d.tracks) {
    if (
      !Array.isArray(t.keys) ||
      t.keys.length < 2 ||
      t.keys[0].tick !== 0 ||
      t.keys[t.keys.length - 1].tick !== 24
    ) {
      error("PATH_ENDPOINTS", t.id, "Path must start at 0 and end at 24.");
      continue;
    }
    if (
      (t.markerWidth !== undefined &&
        (!finite(t.markerWidth) || t.markerWidth < 0)) ||
      (t.markerHeight !== undefined &&
        (!finite(t.markerHeight) || t.markerHeight < 0))
    )
      error("MARKER", t.id, "Marker dimensions must be nonnegative.");
    for (let i = 0; i < t.keys.length; i++) {
      const k = t.keys[i];
      if (
        !tick(k.tick) ||
        !finite(k.yaw) ||
        (k.backward !== undefined && typeof k.backward !== "boolean") ||
        !inside({ x: k.x, y: k.y ?? 1, z: k.z }) ||
        (i > 0 && k.tick <= t.keys[i - 1].tick)
      )
        error(
          "PATH_KEY",
          t.id,
          "Keys must be finite, ordered and inside the room.",
          k.tick,
        );
    }
  }
  if (
    new Set(Object.values(d.casting)).size !== 3 ||
    ["A", "B", "C"].some((id) => !ROLES.includes(d.casting[id as TrackId]))
  )
    error("CASTING", "casting", "Assign each role to one track.");
  if (d.witnesses.length < 1 || d.witnesses.length > 2)
    error("WITNESSES", "witnesses", "Use one or two witnesses.");
  for (const w of d.witnesses)
    if (
      !w.id ||
      !vec(w.position) ||
      !finite(w.yaw) ||
      !finite(w.fov) ||
      w.fov <= 0 ||
      w.fov > Math.PI * 2 ||
      (w.verticalFov !== undefined &&
        (!finite(w.verticalFov) ||
          w.verticalFov <= 0 ||
          w.verticalFov > Math.PI)) ||
      (w.near !== undefined && (!finite(w.near) || w.near < 0)) ||
      (w.far !== undefined && (!finite(w.far) || w.far <= (w.near ?? 0)))
    )
      error(
        "WITNESS",
        w.id ?? "witness",
        "Witness needs finite position, angles and depth range.",
      );
  const ids = [
    r.exhibit.id,
    ...(r.boxes ?? []).map((b) => b.id),
    ...r.walls.map((w) => w.id),
    ...d.witnesses.map((w) => w.id),
  ];
  if (new Set(ids).size !== ids.length)
    error("DUPLICATE_ID", "room", "Object and witness IDs must be unique.");
  if (r.mirror) {
    const m = r.mirror;
    if (
      !vec(m.origin) ||
      ![m.normal, m.right, m.up].every(
        (v) => vec(v) && Math.abs(dot(v, v) - 1) < EPSILON,
      ) ||
      Math.abs(dot(m.normal, m.right)) > EPSILON ||
      Math.abs(dot(m.normal, m.up)) > EPSILON ||
      Math.abs(dot(m.right, m.up)) > EPSILON ||
      !finite(m.width) ||
      !finite(m.height) ||
      m.width <= 0 ||
      m.height <= 0 ||
      !finite(m.aperture) ||
      m.aperture < 0 ||
      m.aperture > 1
    )
      error(
        "MIRROR",
        m.id,
        "Mirror needs orthonormal axes, positive size and aperture 0–1.",
      );
  }
  if (
    d.fields &&
    (!d.fields.length ||
      d.fields.some(
        (f) =>
          ![
            "taker",
            "recipient",
            "cache",
            "takeTick",
            "passTick",
            "stashTick",
          ].includes(f),
      ))
  )
    error("FIELDS", "question", "Choose supported question fields.");
  if (errors.length) return { ok: false, errors };
  for (const t of d.tracks)
    for (let i = 0; i < t.keys.length - 1; i++) {
      const a = t.keys[i],
        b = t.keys[i + 1];
      if (
        !clear(
          { x: a.x, y: a.y ?? 1, z: a.z },
          { x: b.x, y: b.y ?? 1, z: b.z },
          r.walls,
        )
      )
        error(
          "PATH_BLOCKED",
          t.id,
          "Path touches or crosses an opaque wall.",
          a.tick,
        );
    }
  const at = (id: TrackId, t: number) =>
    poseAt(d.tracks.find((p) => p.id === id)!, t);
  const reach = (a: Vec3, b: Vec3, radius: number) =>
    distance(a, b) <= radius + EPSILON && clear(a, b, r.walls);
  const passReach = (from: TrackId, to: TrackId, tick: number): boolean => {
    const a = at(from, tick),
      b = at(to, tick);
    // Preserve the v1 close-meeting grammar for already authored cases.
    if (reach(a, b, 0.3)) return true;
    if (distance(a, b) > 0.72 + EPSILON || !clear(a, b, r.walls)) return false;
    const target = {
      x: (a.x + b.x) / 2,
      y: Math.min(a.y, b.y) - 0.25,
      z: (a.z + b.z) / 2,
    };
    for (const id of [from, to]) {
      const p = sampleTrackMotion(d.tracks.find((t) => t.id === id)!, tick);
      const forward =
        (target.x - p.x) * Math.sin(p.yaw) + (target.z - p.z) * Math.cos(p.yaw);
      if (forward < -0.05 - EPSILON) return false;
      // Native right shoulder after model-forward correction (+PI), in metres.
      const shoulder = {
        x: p.x - (1.225 / 6) * Math.cos(p.yaw),
        y: p.y - 1 + 6.965 / 6,
        z: p.z + (1.225 / 6) * Math.sin(p.yaw),
      };
      const dx = p.x - target.x,
        dz = p.z - target.z;
      const length = Math.hypot(dx, dz) || 1;
      const wrist = {
        x: target.x + (0.05 * dx) / length,
        y: target.y + 0.024,
        z: target.z + (0.05 * dz) / length,
      };
      // Actual upper/lower arm plus bounded 12cm upper-body reach lean.
      const maxReach = (Math.hypot(0.231, 1.61) + 1.344 + 0.72) / 6;
      if (
        distance(shoulder, wrist) > maxReach + EPSILON ||
        !clear(shoulder, wrist, r.walls)
      )
        return false;
    }
    return true;
  };
  const windows: Board["windows"] = {
    take: [],
    brush: { A: [], B: [], C: [] },
    pass: [],
    stash: [],
  };
  for (const t of d.tracks)
    for (let n = 0; n <= 24; n++) {
      const p = at(t.id, n);
      if (reach(p, r.exhibit.position, 0.45)) {
        windows.brush[t.id].push(n);
        if (n === d.alarmTick) windows.take.push(t.id);
      }
      if (d.chain && n > d.alarmTick) {
        for (const other of d.tracks)
          if (other.id !== t.id && passReach(t.id, other.id, n))
            windows.pass.push({ from: t.id, to: other.id, tick: n });
        for (const box of r.boxes ?? [])
          if (reach(p, box.position, 0.32))
            windows.stash.push({ carrier: t.id, box: box.id, tick: n });
      }
    }
  const takes = d.events.filter(
    (e): e is Extract<Event, { track: TrackId }> => e.kind === "Take",
  );
  const brushes = d.events.filter(
    (e): e is Extract<Event, { track: TrackId }> => e.kind === "BrushRim",
  );
  const passes = d.events.filter(
    (e): e is Extract<Event, { kind: "Pass" }> => e.kind === "Pass",
  );
  const stashes = d.events.filter(
    (e): e is Extract<Event, { kind: "Stash" }> => e.kind === "Stash",
  );
  for (const e of d.events)
    if (
      !tick(e.tick) ||
      !["Take", "BrushRim", "Pass", "Stash"].includes(e.kind)
    )
      error(
        "EVENT",
        "events",
        "Use a supported event at an integer tick.",
        e.tick,
      );
  if (takes.length !== 1)
    error("TAKE_COUNT", "exhibit", "Exactly one Take is required.");
  if (
    passes.length > 1 ||
    stashes.length > 1 ||
    (!d.chain && (passes.length || stashes.length))
  )
    error(
      "CHAIN_COUNT",
      "events",
      "Allow at most one Pass and Stash in a chain-enabled case.",
    );
  const take = takes[0],
    pass = passes[0],
    stash = stashes[0];
  if (take && (take.tick !== d.alarmTick || !windows.take.includes(take.track)))
    error(
      "TAKE_REACH",
      take.track,
      "Take must be reachable at the alarm.",
      take.tick,
    );
  for (const b of brushes)
    if (
      !windows.brush[b.track]?.includes(b.tick) ||
      brushes.filter((x) => x.track === b.track).length > 1
    )
      error(
        "BRUSH_REACH",
        b.track,
        "One reachable rim contact per track is allowed.",
        b.tick,
      );
  if (
    pass &&
    (!take ||
      pass.from !== take.track ||
      !windows.pass.some(
        (p) => p.from === pass.from && p.to === pass.to && p.tick === pass.tick,
      ))
  )
    error(
      "PASS_REACH",
      pass.to,
      "Pass requires the current holder, a later tick and an unobstructed meeting.",
      pass.tick,
    );
  if (
    stash &&
    (!take ||
      stash.tick <= (pass?.tick ?? d.alarmTick) ||
      stash.carrier !== (pass?.to ?? take.track) ||
      !windows.stash.some(
        (s) =>
          s.carrier === stash.carrier &&
          s.box === stash.box &&
          s.tick === stash.tick,
      ))
  )
    error(
      "STASH_REACH",
      stash.box,
      "Stash requires the current holder at an accessible box on a later tick.",
      stash.tick,
    );
  if (errors.length) return { ok: false, errors };
  const board: Board = {
    caseId: d.id,
    rev: d.rev,
    room: r,
    witnesses: d.witnesses,
    tracks: d.tracks,
    alarmTick: d.alarmTick,
    chain: !!d.chain,
    fields: d.fields ?? ["taker"],
    windows,
  };
  const history: History = {
    casting: d.casting,
    take: take.track,
    brushes: brushes.map((b) => ({ track: b.track, tick: b.tick })),
    ...(pass
      ? { pass: { from: pass.from, to: pass.to, tick: pass.tick } }
      : {}),
    ...(stash
      ? { stash: { carrier: stash.carrier, box: stash.box, tick: stash.tick } }
      : {}),
  };
  return {
    ok: true,
    sealed: freeze({
      caseId: d.id,
      rev: d.rev,
      board,
      clues: observe(board, history),
    }),
    vault: freeze({ sourceDraft: clone(d), actualHistory: clone(history) }),
  };
}
