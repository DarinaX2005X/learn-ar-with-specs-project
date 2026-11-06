import { Placement } from "../Spatial/SpatialStage";
interface SavedNode {
  node: SceneObject;
  parent: SceneObject;
  position: vec3;
  rotation: quat;
  scale: vec3;
  enabled: boolean;
}
/** Temporarily articulates the original physical tool, original recording and its
 * existing SIK targets together. No recording or interaction is duplicated. */
export class ComparisonSourceRig {
  private saved: SavedNode[] = [];
  private root?: SceneObject;
  private deployed = false;
  private roomPose = "";
  private originalLocal?: vec3;
  private targetLocal?: vec3;
  private rotationLocal?: quat;
  constructor(
    private parent: SceneObject,
    private buildingRotation: quat,
    private originalCentre: vec3,
    private targetCentre: vec3,
    private name = "ComparisonOriginalRecordingRig",
  ) {}

  mount(nodes: readonly SceneObject[]): boolean {
    if (this.root || !nodes.length || new Set(nodes).size !== nodes.length) return false;
    // Only roots are moved. A nested target already follows its ancestor exactly.
    const roots = nodes.filter(node => {
      let ancestor = node.getParent();
      while (ancestor) {
        if (nodes.includes(ancestor)) return false;
        ancestor = ancestor.getParent();
      }
      return true;
    });
    if (roots.some(node => !node.getParent())) return false;
    this.root = global.scene.createSceneObject(this.name);
    this.root.setParent(this.parent);
    const rootTransform = this.root.getTransform();
    rootTransform.setWorldPosition(this.originalCentre);
    rootTransform.setWorldRotation(this.buildingRotation);
    rootTransform.setWorldScale(new vec3(1, 1, 1));
    this.originalLocal = rootTransform.getLocalPosition();
    this.rotationLocal = rootTransform.getLocalRotation();
    rootTransform.setWorldPosition(this.targetCentre);
    this.targetLocal = rootTransform.getLocalPosition();
    rootTransform.setWorldPosition(this.originalCentre);
    try {
      for (const node of roots) {
        const transform = node.getTransform();
        this.saved.push({
          node, parent: node.getParent(),
          position: transform.getLocalPosition(),
          rotation: transform.getLocalRotation(),
          scale: transform.getLocalScale(), enabled: node.enabled,
        });
        const position = transform.getWorldPosition();
        const rotation = transform.getWorldRotation();
        const scale = transform.getWorldScale();
        node.setParent(this.root);
        transform.setWorldPosition(position);
        transform.setWorldRotation(rotation);
        transform.setWorldScale(scale);
      }
      this.setDeployed(true);
      return true;
    } catch (_) {
      this.restore();
      return false;
    }
  }
  setDeployed(deployed: boolean): void {
    if (!this.root || this.deployed === deployed) return;
    this.roomPose = "";
    this.deployed = deployed;
    const transform = this.root.getTransform();
    transform.setLocalPosition(deployed ? this.targetLocal! : this.originalLocal!);
    transform.setLocalRotation(deployed
      ? this.rotationLocal!.multiply(quat.fromEulerAngles(-65 * Math.PI / 180, 0, 0))
      : this.rotationLocal!);
  }
  /** Move this one owned original pane and its registered targets together. */
  presentRoom(placement: Placement, tilt = -65 * Math.PI / 180): void {
    if (!this.root) return;
    const key = JSON.stringify([placement.originCm, placement.yawRad, tilt]);
    if (key === this.roomPose) return;
    this.roomPose = key;
    const transform = this.root.getTransform();
    transform.setWorldPosition(new vec3(...placement.originCm));
    transform.setWorldRotation(quat.fromEulerAngles(0, placement.yawRad, 0)
      .multiply(quat.fromEulerAngles(tilt, 0, 0)));
    transform.setWorldScale(new vec3(1, 1, 1));
  }
  read() { return { mounted: !!this.root, deployed: this.deployed, movedNodes: this.saved.length }; }
  restore(): void {
    // Persistent originals must leave the temporary hierarchy before destruction.
    for (const saved of this.saved) {
      if (isNull(saved.node) || isNull(saved.parent)) continue;
      saved.node.setParent(saved.parent);
      const transform = saved.node.getTransform();
      transform.setLocalPosition(saved.position);
      transform.setLocalRotation(saved.rotation);
      transform.setLocalScale(saved.scale);
      saved.node.enabled = saved.enabled;
    }
    this.saved = [];
    if (this.root && !isNull(this.root)) this.root.destroy();
    this.root = undefined;
    this.deployed = false;
    this.roomPose = "";
  }
}
