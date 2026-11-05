import type { AuthorEdit } from "../Author/AuthorSession";
import type { CaseDraft, DomainError } from "../Domain/types";

/** An author may keep an incomplete construction, but never seal it as a case.
 * Only the explicit tray sentinel and absent camera are structural omissions.
 * Invalid coordinates, malformed walls/cameras and over-capacity stay rejected. */
export function blockingAuthorEditErrors(
  draft: CaseDraft,
  edit: AuthorEdit,
  errors: DomainError[],
): DomainError[] {
  const relationship = new Set([
    "TAKE_COUNT",
    "TAKE_REACH",
    "BRUSH_REACH",
    "PASS_REACH",
    "STASH_REACH",
    "CHAIN_COUNT",
    "PATH_BLOCKED",
  ]);
  return errors.filter((error) => {
    if (error.code === "FIELDS" && draft.fields?.length === 0) return false;
    if (error.code === "WITNESSES" && draft.witnesses.length === 0)
      return false;
    if (
      error.code === "PLACE" &&
      error.object === draft.room.exhibit.id &&
      draft.room.exhibit.position.x === -1 &&
      draft.room.exhibit.position.z === -1 &&
      !(edit.kind === "movePlace" && edit.id === draft.room.exhibit.id)
    )
      return false;
    if (!relationship.has(error.code)) return true;
    if (edit.kind !== "setEvent") return false;
    const event = edit.event;
    return (
      (event.kind === "Take" &&
        ["TAKE_REACH", "TAKE_COUNT"].includes(error.code)) ||
      (event.kind === "BrushRim" && error.code === "BRUSH_REACH") ||
      (event.kind === "Pass" &&
        ["PASS_REACH", "CHAIN_COUNT"].includes(error.code)) ||
      (event.kind === "Stash" &&
        ["STASH_REACH", "CHAIN_COUNT"].includes(error.code))
    );
  });
}
