import { Track } from "../../Domain/types";
import {
  compilePlantedGait,
  samplePlantedGait,
  GaitPlan,
  PlantedPose,
  LensLegAdapter,
} from "../../Spatial/PlantedGait";

/** A mounted imported rig. All hierarchy reads and native handle lookup happen here once. */
export class ActorRig {
  private body: Transform;
  private bodyNode: SceneObject;
  private ownsBody = false;
  private ownedAnkles: SceneObject[] = [];
  private footwear: {
    node: SceneObject;
    parent: SceneObject;
    position: vec3;
    rotation: quat;
    scale: vec3;
  }[] = [];
  private legs: LensLegAdapter<vec3, quat> | undefined;
  private root: Transform;
  private plan: GaitPlan | undefined;
  private trackKey = "";
  private leftShoulder: Transform | undefined;
  private rightShoulder: Transform | undefined;
  constructor(
    private actor: SceneObject,
    private anonymous: boolean,
  ) {
    this.root = actor.getTransform();
    const find = (name: string, node: SceneObject): SceneObject | undefined => {
      if (node.name === name) return node;
      for (let i = 0; i < node.getChildrenCount(); i++) {
        const found = find(name, node.getChild(i));
        if (found) return found;
      }
      return undefined;
    };
    const left = find("Hip_L", actor),
      right = find("Hip_R", actor);
    const boneRoot = left?.getParent() ?? actor;
    let body = find("LocomotionBody", actor);
    if (!body) {
      this.ownsBody = true;
      body = global.scene.createSceneObject("LocomotionBody");
      body.setParent(boneRoot);
      const upper = find("UpperBody", actor);
      if (upper) upper.setParent(body);
      else {
        const children: SceneObject[] = [];
        for (let i = 0; i < boneRoot.getChildrenCount(); i++) {
          const child = boneRoot.getChild(i);
          if (
            child !== body &&
            !/^(Hip_|Boot_|Sole_|Foot_|BootWelt_)/.test(child.name)
          )
            children.push(child);
        }
        for (const child of children) child.setParent(body);
      }
    }
    this.bodyNode = body;
    this.body = body.getTransform();
    this.leftShoulder = find("Shoulder_L", actor)?.getTransform();
    this.rightShoulder = find("Shoulder_R", actor)?.getTransform();
    const mount = (side: "L" | "R", hip: SceneObject | undefined) => {
      const knee = find("Knee_" + side, actor);
      if (!hip || !knee) return undefined;
      let ankle = find("FootPivot_" + side, actor);
      if (!ankle) {
        ankle = global.scene.createSceneObject("FootPivot_" + side);
        ankle.setParent(knee);
        this.ownedAnkles.push(ankle);
        ankle.getTransform().setLocalPosition(new vec3(0, -0.0189, 0));
        for (const prefix of ["Boot_", "Sole_", "Foot_", "BootWelt_"]) {
          const part = find(prefix + side, actor);
          if (!part) continue;
          const t = part.getTransform();
          this.footwear.push({
            node: part,
            parent: part.getParent(),
            position: t.getLocalPosition(),
            rotation: t.getLocalRotation(),
            scale: t.getLocalScale(),
          });
          const position = t.getWorldPosition(),
            rotation = t.getWorldRotation(),
            scale = t.getWorldScale();
          part.setParent(ankle);
          t.setWorldPosition(position);
          t.setWorldRotation(rotation);
          t.setWorldScale(scale);
        }
      }
      // The portable adapter's interface remains SDK independent; native getTransform
      // handles are captured once, including missing optional shoulder nodes.
      const cached = (node: SceneObject) => {
        const transform = node.getTransform();
        return { getTransform: () => transform };
      };
      return { hip: cached(hip), knee: cached(knee), ankle: cached(ankle) };
    };
    const L = mount("L", left),
      R = mount("R", right);
    if (L && R)
      this.legs = new LensLegAdapter(
        { L, R },
        {
          vector: (x, y, z) => new vec3(x, y, z),
          quaternion: (x, y, z, w) => new quat(w, x, y, z),
        },
      );
  }
  /** Call on a changed canonical board/author snapshot, never per animation frame. */
  prepare(track: Track): void {
    const key = JSON.stringify(track);
    if (key !== this.trackKey) {
      this.trackKey = key;
      this.plan = compilePlantedGait(track);
    }
  }
  sample(tick: number): PlantedPose {
    if (!this.plan) throw new Error("Actor route was not prepared");
    const pose = samplePlantedGait(this.plan!, tick);
    this.root.setLocalRotation(
      quat.fromEulerAngles(0, pose.bodyYaw + Math.PI, 0),
    );
    this.legs?.apply(pose);
    const p = pose.upperBodyOffsetCm;
    this.body.setLocalPosition(
      new vec3(p[0] * 0.0006, p[1] * 0.0006, p[2] * 0.0006),
    );
    this.leftShoulder?.setLocalRotation(
      quat.fromEulerAngles(-pose.armSwing * 0.22, 0, 0),
    );
    if (this.anonymous) {
      this.rightShoulder?.setLocalRotation(
        quat.fromEulerAngles(pose.armSwing * 0.22, 0, 0),
      );
    }
    return pose;
  }
  /** Arm solver receives the translated body basis, keeping the actual target fixed. */
  armBasis(
    positionCm: readonly [number, number, number],
    pose: PlantedPose,
  ): readonly [number, number, number] {
    const o = pose.upperBodyOffsetCm,
      yaw = pose.bodyYaw + Math.PI,
      c = Math.cos(yaw),
      s = Math.sin(yaw);
    return [
      positionCm[0] + c * o[0] + s * o[2],
      positionCm[1] + o[1],
      positionCm[2] - s * o[0] + c * o[2],
    ];
  }
  dispose(): void {
    this.restore();
    for (const item of this.footwear) {
      item.node.setParent(item.parent);
      const t = item.node.getTransform();
      t.setLocalPosition(item.position);
      t.setLocalRotation(item.rotation);
      t.setLocalScale(item.scale);
    }
    for (const ankle of this.ownedAnkles) ankle.destroy();
    if (this.ownsBody) {
      const parent = this.bodyNode.getParent(),
        children: SceneObject[] = [];
      for (let i = 0; i < this.bodyNode.getChildrenCount(); i++)
        children.push(this.bodyNode.getChild(i));
      for (const child of children) child.setParent(parent);
      this.bodyNode.destroy();
    }
    this.footwear = [];
    this.ownedAnkles = [];
    this.plan = undefined;
  }
  clearRoute(): void {
    this.restore();
    this.plan = undefined;
    this.trackKey = "";
  }
  restore(): void {
    this.leftShoulder?.setLocalRotation(new quat(1, 0, 0, 0));
    if (this.anonymous)
      this.rightShoulder?.setLocalRotation(new quat(1, 0, 0, 0));
    this.legs?.restore();
    this.body.setLocalPosition(new vec3(0, 0, 0));
  }
}
