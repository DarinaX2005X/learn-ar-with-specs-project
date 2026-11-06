import { Placement } from "../Spatial/SpatialStage";
interface SavedTransform {
  position: vec3;
  rotation: quat;
  scale: vec3;
}
/** One reversible presentation lease over the existing imported visual shell.
 * It never owns or reparents MuseumAnchor, Countercase, the tracked camera or input. */
export class RoomShellPresentation {
  private original?: SavedTransform;
  private hidden = new Map<SceneObject, boolean>();
  private overlayNodes?: SceneObject[];
  private appliedPlacement = "";
  constructor(
    private shell: SceneObject,
    private overlays: () => SceneObject[],
  ) {}
  apply(placement: Placement | undefined): void {
    if (!placement) {
      this.restore();
      return;
    }
    const key = JSON.stringify([
      placement.originCm,
      placement.yawRad,
      placement.scale,
    ]);
    if (key === this.appliedPlacement) return;
    const transform = this.shell.getTransform();
    if (!this.original)
      this.original = {
        position: transform.getLocalPosition(),
        rotation: transform.getLocalRotation(),
        scale: transform.getLocalScale(),
      };
    try {
      transform.setWorldPosition(new vec3(...placement.originCm));
      transform.setWorldRotation(quat.fromEulerAngles(0, placement.yawRad, 0));
      transform.setWorldScale(
        new vec3(
          100 * placement.scale,
          100 * placement.scale,
          100 * placement.scale,
        ),
      );
      this.appliedPlacement = key;
      this.hideOwnedOverlays();
    } catch (error) {
      this.restore();
      throw error;
    }
  }
  /** These six owner layers are constructed once, never per frame/case. Only
   * data-render may re-enable them; pose-only updates never enumerate a tree. */
  hideOwnedOverlays(): void {
    if (!this.original) return;
    this.overlayNodes ??= this.overlays();
    for (const overlay of this.overlayNodes) {
      if (!this.hidden.has(overlay)) this.hidden.set(overlay, overlay.enabled);
      if (overlay.enabled) overlay.enabled = false;
    }
  }
  restore(): void {
    if (this.original) {
      const transform = this.shell.getTransform();
      transform.setLocalPosition(this.original.position);
      transform.setLocalRotation(this.original.rotation);
      transform.setLocalScale(this.original.scale);
      this.original = undefined;
    }
    for (const [overlay, enabled] of this.hidden)
      if (!isNull(overlay)) overlay.enabled = enabled;
    this.hidden.clear();
    this.appliedPlacement = "";
  }
}
