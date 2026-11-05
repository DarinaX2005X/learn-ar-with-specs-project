/** Imported TableKit geometry is authored at 6 cm per story metre. These helpers
 * mount story-centimetre poses around those meshes without changing their pivots.
 */
import { ReconstructionView, ActionPose } from "./Reconstruction";
export const TABLEKIT_MODEL_TO_STORY = 100 / 6;
export function tableKitModelView(
  view: ReconstructionView,
): ReconstructionView {
  const divide = (
    p: readonly [number, number, number],
  ): [number, number, number] => [
    p[0] / TABLEKIT_MODEL_TO_STORY,
    p[1] / TABLEKIT_MODEL_TO_STORY,
    p[2] / TABLEKIT_MODEL_TO_STORY,
  ];
  return {
    ...view,
    actors: view.actors.map((actor) => ({
      ...actor,
      positionCm: divide(actor.positionCm),
    })),
    ruby: { ...view.ruby, positionCm: divide(view.ruby.positionCm) },
    hands: view.hands.map((hand) => ({ ...hand, handCm: divide(hand.handCm) })),
  };
}
export interface NativeTransform<V, Q> {
  setLocalPosition(value: V): void;
  setLocalScale(value: V): void;
  setLocalRotation(value: Q): void;
}
export interface NativeNode<V, Q> {
  enabled: boolean;
  getTransform(): NativeTransform<V, Q>;
}
export interface NativeMath<V, Q> {
  vector(x: number, y: number, z: number): V;
  euler(x: number, y: number, z: number): Q;
}
/** Direct Lens SceneObject/Transform adapter, with constructors injected so
 * portable tests do not require Lens globals. geometryWrapper owns imported mesh
 * scaling, theatreRoot owns world placement. They must be distinct nodes.
 */
export class TheatreMount<V, Q> {
  constructor(
    private theatreRoot: NativeNode<V, Q>,
    private geometryWrapper: NativeNode<V, Q>,
    private math: NativeMath<V, Q>,
  ) {
    const n = TABLEKIT_MODEL_TO_STORY;
    geometryWrapper.getTransform().setLocalScale(math.vector(n, n, n));
  }
  place(
    origin: readonly [number, number, number],
    scale: number,
    yaw: number,
  ): void {
    const t = this.theatreRoot.getTransform();
    t.setLocalPosition(this.math.vector(...origin));
    t.setLocalScale(this.math.vector(scale, scale, scale));
    t.setLocalRotation(this.math.euler(0, yaw, 0));
  }
  show(visible: boolean): void {
    this.theatreRoot.enabled = visible;
  }
}
