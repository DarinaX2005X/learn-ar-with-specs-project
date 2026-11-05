import { RimClue } from "../Domain/types";

/** Public observed roles only; absence is evidence too. Never implies a time or theft. */
export function rimFinding(clue: RimClue): string {
  if (!clue.shapes.length) return "No rim marks found";
  // At most two short role names per line keeps the existing narrow paper readable.
  const rows: string[] = [];
  for (let index = 0; index < clue.shapes.length; index += 2)
    rows.push(clue.shapes.slice(index, index + 2).join(", "));
  return "Rim marks\n" + rows.join("\n");
}
