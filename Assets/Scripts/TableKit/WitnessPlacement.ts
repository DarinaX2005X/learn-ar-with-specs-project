/** The domain exposes angular sample centres, not a full visible body mask.
 * This helper positions public samples on a fixed camera glass. It intentionally
 * does not expand a centre into a whole actor or infer yaw/ownership/hidden hands.
 */
import { Role, Vec3 } from "./TableKit";
export interface PublicSample {
  readonly position: {
    readonly x: number;
    readonly y: number;
    readonly z: number;
  };
  readonly projection: {
    readonly horizontal: number;
    readonly vertical: number;
  };
  readonly via: "direct" | "mirror";
  readonly role?: Role;
  readonly segment: string;
}
export interface RecordingGlass {
  readonly widthCm: number;
  readonly heightCm: number;
  readonly horizontalFovRad: number;
  readonly verticalFovRad: number;
}
export interface PlacedSample {
  readonly segment: string;
  readonly positionOnGlassCm: Vec3;
  readonly role?: Role;
  readonly via: "direct" | "mirror";
  readonly geometryRequiresObservedMask: true;
}
export function placeWitnessSample(
  fragment: PublicSample,
  glass: RecordingGlass,
): PlacedSample | undefined {
  const { horizontal: h, vertical: v } = fragment.projection;
  if (
    !Number.isFinite(h) ||
    !Number.isFinite(v) ||
    glass.horizontalFovRad <= 0 ||
    glass.verticalFovRad <= 0 ||
    Math.abs(h) >= Math.PI / 2 ||
    Math.abs(v) >= Math.PI / 2
  )
    return;
  const nx = Math.tan(h) / Math.tan(glass.horizontalFovRad / 2),
    ny = Math.tan(v) / Math.tan(glass.verticalFovRad / 2);
  if (Math.abs(nx) > 1 || Math.abs(ny) > 1) return;
  return {
    segment: fragment.segment,
    positionOnGlassCm: [(nx * glass.widthCm) / 2, (ny * glass.heightCm) / 2, 0],
    via: fragment.via,
    ...(fragment.role ? { role: fragment.role } : {}),
    geometryRequiresObservedMask: true,
  };
}
/** Split each uninterrupted segment. Never connect a route across a visibility gap. */
export function groupWitnessSegments(
  fragments: readonly PublicSample[],
): ReadonlyMap<string, readonly PublicSample[]> {
  const groups = new Map<string, PublicSample[]>();
  for (const f of fragments) {
    const group = groups.get(f.segment) || [];
    group.push(f);
    groups.set(f.segment, group);
  }
  return groups;
}
