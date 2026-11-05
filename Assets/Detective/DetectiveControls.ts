import { DetectiveAction, DetectiveSession } from "./DetectiveSession";
export interface DetectiveControl {
  id: string;
  label: string;
  action: DetectiveAction;
}
/** The scene supplies real SIK/focus targets for these actions. Same action
 * object handles a pinch, glass drag/drop and a focusable equivalent. */
export function detectiveControls(
  session: DetectiveSession,
): DetectiveControl[] {
  const s = session.snapshot();
  const controls: DetectiveControl[] = [
    { id: "replay", label: "Replay the alarm", action: { type: "replay" } },
    {
      id: "freeze",
      label: s.playing ? "Pause" : "Play",
      action: { type: s.playing ? "freeze" : "play" },
    },
    {
      id: "previous",
      label: "Previous frame",
      action: { type: "step", delta: -1 },
    },
    { id: "next", label: "Next frame", action: { type: "step", delta: 1 } },
    { id: "table", label: "Back to table", action: { type: "table" } },
    { id: "inspect", label: "Watch this view", action: { type: "inspect" } },
  ];
  if (s.mode !== "reconstruction")
    for (const observation of s.observations) {
      const fragment = observation.payload.fragments[0];
      const label = fragment
        ? (fragment.role ?? "Observed shape") +
          (fragment.via === "mirror" ? " in reflection" : "")
        : observation.payload.actions[0]?.kind === "Take"
          ? "Ruby taken"
          : observation.payload.actions[0]?.kind === "Pass"
            ? "Hands meet"
            : observation.payload.actions.length
              ? "Observed action"
              : observation.payload.hands.length
                ? "Ruby in hand"
                : "Observed surface";
      controls.push({
        id: `select-observation-${observation.id}`,
        label,
        action: { type: "selectObservation", id: observation.id },
      });
    }
  if (s.mode !== "reconstruction")
    controls.push({
      id: "pin",
      label: "Pin evidence",
      action: { type: "pin" },
    });
  if (s.selected && s.glass.some((g) => g.id === s.selected))
    controls.push({
      id: "remove",
      label: "Remove evidence",
      action: { type: "remove" },
    });
  if (s.canUndoEvidence)
    controls.push({ id: "undo", label: "Undo", action: { type: "undo" } });
  for (const object of s.objects)
    controls.push({
      id: `inspect-object-${object.id}`,
      label:
        object.kind === "Rim"
          ? "Inspect rim"
          : object.kind === "Box"
            ? `Open ${object.box}`
            : "Inspect evidence",
      action: { type: "inspectObject", id: object.id },
    });
  for (const field of s.questionFields)
    controls.push({
      id: `field-${field}`,
      label:
        field === "taker"
          ? "Who took it"
          : field === "recipient"
            ? "Who received it"
            : field === "cache"
              ? "Where it ended"
              : field,
      action: { type: "selectField", field },
    });
  if (s.selectedField === "taker" || s.selectedField === "recipient")
    for (const role of ["Courier", "Guard", "Conservator"] as const)
      controls.push({
        id: `claim-${role}`,
        label: role,
        action: { type: "claimField", field: s.selectedField, value: role },
      });
  if (s.selectedField === "cache")
    for (const object of s.objects)
      if (object.kind === "Box")
        controls.push({
          id: `claim-cache-${object.box}`,
          label: object.box,
          action: { type: "claimField", field: "cache", value: object.box },
        });
  if (s.selectedField !== "taker")
    controls.push({
      id: "claim-none",
      label: "No transfer",
      action: { type: "claimField", field: s.selectedField, value: "None" },
    });
  controls.push({
    id: "claim-unknown",
    label: "Could be either",
    action: {
      type: "claimField",
      field: s.selectedField,
      value: "Underdetermined",
    },
  });
  controls.push(
    { id: "check", label: "Check accusation", action: { type: "check" } },
    { id: "all", label: "Different thefts fit", action: { type: "checkAll" } },
  );
  for (const source of session.sources())
    controls.push({
      id: "source-" + source,
      label: source,
      action: { type: "source", source },
    });
  if (s.glass.length > 3)
    controls.push(
      {
        id: "tabs-back",
        label: "Previous evidence",
        action: { type: "tabPage", delta: -1 },
      },
      {
        id: "tabs-next",
        label: "Next evidence",
        action: { type: "tabPage", delta: 1 },
      },
    );
  for (const glass of s.visibleGlass)
    controls.push({
      id: `glass-${glass.id}`,
      label:
        glass.clue.kind === "Frame"
          ? `${glass.clue.payload.fragments[0]?.role ?? (glass.clue.payload.actions.length ? "Action" : "Surface")} ${glass.clue.witness} ${(glass.clue.tick / 2).toFixed(1)}`
          : glass.clue.kind === "Rim"
            ? "Rim mark"
            : glass.clue.box,
      action: { type: "selectClue", id: glass.id },
    });
  for (const role of s.verdict?.possibleCulprits ?? [])
    controls.push({
      id: `version-${role}`,
      label: `See ${role.toLowerCase()} version`,
      action: { type: "version", role },
    });
  for (const [index, value] of (
    s.verdict?.fieldValues[s.selectedField] ?? []
  ).entries())
    controls.push({
      id: `field-version-${s.selectedField}-${index}`,
      label: `See ${value} version`,
      action: { type: "versionField", field: s.selectedField, index },
    });
  if ((s.verdict?.examplesByField[s.selectedField]?.length ?? 0) > 1)
    controls.push({
      id: "compare-versions",
      label: "Compare reconstructions",
      action: { type: "compareVersions", field: s.selectedField },
    });
  if (s.mode === "reconstruction")
    controls.push({
      id: "return",
      label: "Back to observations",
      action: { type: "returnObservations" },
    });
  if (s.completed)
    controls.push({
      id: "reveal",
      label: "Reveal the theft",
      action: { type: "reveal" },
    });
  return controls;
}
export interface DetectiveInputPort {
  bind(id: string, invoke: () => void): () => void;
}
/** Rebind when control identity changes, then dispose before changing roles. */
export function bindDetectiveControls(
  session: DetectiveSession,
  input: DetectiveInputPort,
): () => void {
  const unbind = detectiveControls(session).map((control) =>
    input.bind(control.id, () => session.dispatch(control.action)),
  );
  return () => unbind.forEach((dispose) => dispose());
}
