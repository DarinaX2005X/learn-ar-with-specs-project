import { CASE_TITLE_MAX_UNITS } from "../Domain/types";
/** Public names retain their full normalized input. Only generated derivatives
 * reserve room for a suffix; physical spines have a separate display budget. */
export const caseTitle = (value: string): string =>
  value.trim().replace(/\s+/g, " ") || "Untitled case";
export const caseSpine = (value: string): string => {
  const title = caseTitle(value), points = Array.from(title);
  return points.length > 28
    ? points.slice(0, 19).join("") + "…" + points.slice(-8).join("")
    : title;
};
/** Budget in UTF16 units like the compiler, but cut only between code points.
 * The source/user title is never mutated or shortened by this operation. */
export function generatedCaseTitle(value: string, kind: "Copy" | "Room", number = 1): string {
  let base = caseTitle(value);
  let ordinal = Number.isSafeInteger(number) && number > 0 ? number : 1;
  const previous = base.match(new RegExp(" " + kind + "(?: (\\d+))?$"));
  if (previous && Number.isSafeInteger(Number(previous[1] ?? 1))) {
    ordinal = Math.max(ordinal, Number(previous[1] ?? 1) + 1);
    base = base.slice(0, previous.index);
  }
  const suffix = " " + kind + (ordinal > 1 ? " " + ordinal : "");
  const budget = CASE_TITLE_MAX_UNITS - suffix.length;
  if (base.length > budget) {
    let prefix = "";
    for (const point of base) {
      if (prefix.length + point.length > budget - 1) break;
      prefix += point;
    }
    base = prefix.trimEnd() + "…";
  }
  return base + suffix;
}
export const copiedCaseTitle = (value: string, number = 1): string =>
  generatedCaseTitle(value, "Copy", number);
