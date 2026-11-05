import {
  Board,
  Claim,
  Clue,
  Field,
  History,
  ProofOptions,
  Role,
  ROLES,
  TrackId,
  Verdict,
  WitnessTape,
} from "./types";
import {
  answer,
  observe,
  resolveObservation,
  matchesObservation,
} from "./observe";
import { clone } from "./compile";

const same = (a: unknown, b: unknown) =>
  JSON.stringify(a) === JSON.stringify(b);
const permutations: Role[][] = [];
for (const a of ROLES)
  for (const b of ROLES)
    for (const c of ROLES)
      if (new Set([a, b, c]).size === 3) permutations.push([a, b, c]);
const fields: Field[] = [
  "taker",
  "recipient",
  "cache",
  "takeTick",
  "passTick",
  "stashTick",
];
const observationCache = new WeakMap<Board, Map<string, WitnessTape>>();
function recorded(
  board: Board,
  h: History,
  legacyRecorder = false,
): WitnessTape {
  let cache = observationCache.get(board);
  if (!cache) {
    cache = new Map();
    observationCache.set(board, cache);
  }
  const key = (legacyRecorder ? "v1:" : "v2:") + JSON.stringify(h);
  let tape = cache.get(key);
  if (!tape) {
    tape = observe(board, h, legacyRecorder);
    if (cache.size < 5000) cache.set(key, tape);
  }
  return tape;
}
interface Search {
  count: number;
  examples: History[];
  incomplete: boolean;
  work: number;
}
/** Contacts factor by track: roles are a permutation and each track may brush at most once.
 * This counts every allowed contact combination without multiplying it by every chain. */
function* searchSteps(
  board: Board,
  clues: Clue[],
  options: ProofOptions,
  legacyRecorder = false,
): Generator<{ work: number }, Search, void> {
  let count = 0,
    work = 0,
    incomplete = false;
  const examples: History[] = [];
  const limit = options.maxHistories ?? 1000000;
  const batchSize = Math.max(
    1,
    Math.min(256, Math.floor(options.batchSize ?? 8)),
  );
  const spend = () => {
    work++;
    if (work > limit || options.cancelled?.()) {
      incomplete = true;
      return false;
    }
    return true;
  };
  const order = options.reverse ? [...permutations].reverse() : permutations;
  for (const roles of order) {
    const casting = { A: roles[0], B: roles[1], C: roles[2] };
    // A contact's only observable effect is its timed action and final role-shaped mark.
    const marks: { track: TrackId; tick: number }[][] = [];
    let combinations = 1;
    for (const id of ["A", "B", "C"] as TrackId[]) {
      const valid: { track: TrackId; tick: number }[] = [];
      for (const tick of [-1, ...board.windows.brush[id]]) {
        if (!spend()) return { count, examples, incomplete, work };
        if (work % batchSize === 0) yield { work };
        const brush = tick < 0 ? [] : [{ track: id, tick }];
        const fake: History = {
          casting,
          take: board.windows.take[0] ?? "A",
          brushes: brush,
        };
        const rim = clues.find((c) => c.kind === "Rim");
        if (
          rim &&
          rim.kind === "Rim" &&
          rim.shapes.includes(casting[id]) !== tick >= 0
        )
          continue;
        // Compare just this track's contact channel, including explicit absence.
        const relevant = clues.filter(
          (c) => c.kind === "Frame" && !c.observation,
        );
        const tape = relevant.length
          ? recorded(board, fake, legacyRecorder)
          : undefined;
        let fits = true;
        for (const c of relevant)
          if (c.kind === "Frame") {
            const actual = tape!.clues.find((x) => x.id === c.id);
            if (!actual || actual.kind !== "Frame") {
              fits = false;
              break;
            }
            // Track position is public. At intersections two contacts are indistinguishable;
            // defer such cases to exact merged matching below.
            const expected = c.payload.actions.filter(
              (a) => a.kind === "BrushRim",
            );
            const emitted = actual.payload.actions.filter(
              (a) => a.kind === "BrushRim",
            );
            if (emitted.some((a) => !expected.some((e) => same(e, a)))) {
              fits = false;
              break;
            }
          }
        if (fits) valid.push({ track: id, tick });
      }
      if (!valid.length) {
        combinations = 0;
        break;
      }
      marks.push(valid);
      combinations *= valid.length;
    }
    if (!combinations) continue;
    for (const take of options.reverse
      ? [...board.windows.take].reverse()
      : board.windows.take) {
      const passes = [
        undefined,
        ...(board.chain
          ? board.windows.pass.filter((p) => p.from === take)
          : []),
      ];
      for (const pass of passes) {
        const carrier = pass?.to ?? take,
          start = pass?.tick ?? board.alarmTick;
        const stashes = [
          undefined,
          ...(board.chain
            ? board.windows.stash.filter(
                (s) => s.carrier === carrier && s.tick > start,
              )
            : []),
        ];
        for (const stash of stashes) {
          if (!spend()) return { count, examples, incomplete, work };
          if (work % batchSize === 0) yield { work };
          const base: History = {
            casting,
            take,
            brushes: [],
            ...(pass ? { pass } : {}),
            ...(stash ? { stash } : {}),
          };
          const publicTape = recorded(board, base, legacyRecorder);
          const indexes = new Map(publicTape.clues.map((c) => [c.id, c]));
          let fits = true;
          for (const c of clues) {
            const rootId =
              c.kind === "Frame" && c.observation
                ? c.observation.frameId
                : c.id;
            const actual = indexes.get(rootId);
            if (!actual) {
              fits = false;
              break;
            }
            if (c.kind === "Rim") continue;
            if (!matchesObservation(c, actual, true)) {
              fits = false;
              break;
            }
          }
          if (!fits) continue;
          // If no timed contact was selected, independence gives an exact product.
          const timed = clues.some(
            (c) =>
              c.kind === "Frame" &&
              (c.payload.actions.some((a) => a.kind === "BrushRim") ||
                c.payload.palms !== undefined ||
                c.observation?.kind === "hand" ||
                !!c.payload.exhibitSurface ||
                c.payload.actions.some((a) => !!a.contacts)),
          );
          if (!timed) {
            count += combinations;
            examples.push({
              ...base,
              brushes: marks.map((m) => m[0]).filter((m) => m.tick >= 0),
            });
          } else {
            for (const a of marks[0])
              for (const b of marks[1])
                for (const c of marks[2]) {
                  if (!spend()) return { count, examples, incomplete, work };
                  if (work % batchSize === 0) yield { work };
                  const h = {
                    ...base,
                    brushes: [a, b, c].filter((m) => m.tick >= 0),
                  };
                  const actual = recorded(board, h, legacyRecorder),
                    byId = new Map(actual.clues.map((c) => [c.id, c]));
                  if (
                    clues.every((c) =>
                      matchesObservation(
                        c,
                        byId.get(
                          c.kind === "Frame" && c.observation
                            ? c.observation.frameId
                            : c.id,
                        ),
                      ),
                    )
                  ) {
                    count++;
                    examples.push(h);
                  }
                }
          }
        }
      }
    }
  }
  return { count, examples, incomplete, work };
}
export function* proveSteps(
  board: Board,
  tape: WitnessTape,
  selectedIds: readonly string[],
  claim: Claim,
  options: ProofOptions = {},
): Generator<{ work: number }, Verdict, void> {
  const all =
    claim === "Underdetermined" ||
    (typeof claim === "object" &&
      Object.values(claim).includes("Underdetermined"));
  const scope = all ? "all" : "selected";
  const out: Verdict = {
    status: "incomplete",
    historyCount: 0,
    possibleCulprits: [],
    examplesByCulprit: {},
    fieldValues: {},
    examplesByField: {},
    reasonIds: [],
    exclusions: {},
    scope,
  };
  if (tape.caseId !== board.caseId || tape.rev !== board.rev)
    return {
      ...out,
      status: "conflict",
      message: "Evidence belongs to a different case revision.",
    };
  // Sealed recorder semantics are selected solely from public payload schema.
  // Never compare a legitimate v1 frame with invented v2 palm provenance.
  const formats = new Set(
    tape.clues
      .filter((c) => c.kind === "Frame")
      .map((c) =>
        c.kind === "Frame"
          ? !c.payload ||
            !Array.isArray(c.payload.fragments) ||
            !Array.isArray(c.payload.hands) ||
            !Array.isArray(c.payload.actions)
            ? "unknown"
            : c.payload.palms === undefined
              ? "v1"
              : Array.isArray(c.payload.palms)
                ? "v2"
                : "unknown"
          : "unknown",
      ),
  );
  if (formats.has("unknown") || formats.size > 1)
    return {
      ...out,
      status: "incomplete",
      message:
        "This recording mixes incompatible or unknown formats. Reopen one complete sealed recording before checking evidence.",
    };
  const legacyRecorder = formats.has("v1");
  if (
    new Set(tape.clues.map((c) => c.id)).size !== tape.clues.length ||
    selectedIds.some((id) => !resolveObservation(tape, id))
  )
    return {
      ...out,
      status: "conflict",
      message: "Duplicate or unknown evidence ID.",
    };
  const clues = all
    ? tape.clues
    : [...new Set(selectedIds)].map((id) => resolveObservation(tape, id)!);
  const malformedRim = clues.some(
    (c) =>
      c.kind === "Rim" &&
      (new Set(c.shapes).size !== c.shapes.length ||
        c.shapes.some((r) => !ROLES.includes(r)) ||
        c.surfaceId !== board.room.exhibit.id),
  );
  if (malformedRim)
    return {
      ...out,
      status: "conflict",
      message: "Rim evidence violates the public one-contact-per-role rule.",
    };
  const result = yield* searchSteps(board, clues, options, legacyRecorder);
  if (result.incomplete)
    return {
      ...out,
      message:
        "Search cancelled or work limit reached; no uniqueness conclusion.",
    };
  out.historyCount = result.count;
  for (const h of result.examples) {
    const culprit = h.casting[h.take];
    if (!out.possibleCulprits.includes(culprit)) {
      out.possibleCulprits.push(culprit);
      out.examplesByCulprit[culprit] = clone(h);
    }
    for (const field of fields) {
      const value = answer(board, h, field),
        values = out.fieldValues[field] ?? (out.fieldValues[field] = []);
      if (!values.includes(value)) {
        values.push(value);
        (out.examplesByField[field] ?? (out.examplesByField[field] = [])).push(
          clone(h),
        );
      }
    }
  }
  out.possibleCulprits.sort();
  if (!result.count)
    return { ...out, status: "conflict", reasonIds: clues.map((c) => c.id) };
  const claims = typeof claim === "string" ? { taker: claim } : claim;
  let ambiguous = false,
    contradicted = false,
    unknown = false;
  for (const field of Object.keys(claims) as Field[]) {
    const value = claims[field],
      values = out.fieldValues[field] ?? [];
    if (value === "Underdetermined") {
      if (values.length < 2) contradicted = true;
      else ambiguous = true;
    } else if (!values.includes(value!)) contradicted = true;
    else if (values.length > 1) unknown = true;
  }
  // Projected values describe the same histories. Never accept a tuple assembled
  // from values which occur only in mutually incompatible reconstructions.
  const concreteFields = (Object.keys(claims) as Field[]).filter(
    (field) => claims[field] !== "Underdetermined",
  );
  const jointHistoryExists = result.examples.some((history) =>
    concreteFields.every(
      (field) => answer(board, history, field) === claims[field],
    ),
  );
  if (!jointHistoryExists) contradicted = true;
  out.status = contradicted
    ? "contradicted"
    : unknown
      ? "needClue"
      : ambiguous
        ? "ambiguous"
        : "proved";
  // Inclusion-minimal sufficient grounds per excluded suspect; not advertised as minimum size.
  for (const role of ROLES)
    if (!out.possibleCulprits.includes(role)) {
      let reasons = [...clues];
      for (const c of options.minimizeReasons === false ? [] : [...reasons]) {
        const trial = reasons.filter((x) => x.id !== c.id);
        const r = yield* searchSteps(board, trial, options, legacyRecorder);
        if (options.cancelled?.()) {
          return {
            status: "incomplete",
            historyCount: 0,
            possibleCulprits: [],
            examplesByCulprit: {},
            fieldValues: {},
            examplesByField: {},
            reasonIds: [],
            exclusions: {},
            scope,
            message: "Search cancelled before its explanation completed.",
          };
        }
        if (
          !r.incomplete &&
          !r.examples.some((h) => h.casting[h.take] === role)
        )
          reasons = trial;
      }
      out.exclusions[role] = reasons.map((c) => c.id);
    }
  out.reasonIds = [...new Set(Object.values(out.exclusions).flat())];
  if (typeof claim === "object") {
    // The complete selected evidence is a sufficient (not necessarily minimal)
    // justification for fields other than taker and for a joint contradiction.
    out.reasonIds = clues.map((clue) => clue.id);
  }
  return out;
}

/** Synchronous convenience API. Lens can drain proveSteps in bounded Update batches instead. */
export function prove(
  board: Board,
  tape: WitnessTape,
  selectedIds: readonly string[],
  claim: Claim,
  options: ProofOptions = {},
): Verdict {
  const task = proveSteps(board, tape, selectedIds, claim, options);
  let step = task.next();
  while (!step.done) step = task.next();
  return step.value;
}
