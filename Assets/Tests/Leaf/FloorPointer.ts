
import { DefaultLeafInteractor } from "Leaf.lspkg/Interactors/interactor/DefaultLeafInteractor";
import { sleep } from "Leaf.lspkg/Utils/common/Utils";

import { read, target, waitFor } from "./CountercaseLeafProbe";


/** LEAF already simulates SIK input. This supplies a bounded floor hit instead of
 * the default target centre; it never moves a SceneObject or calls game code. */
export class FloorPointer extends DefaultLeafInteractor {
  async floorHit(xCm: number, zCm: number): Promise<void> {
    if (xCm < 0 || xCm > 700 || zCm < 0 || zCm > 500)
      throw new Error("Floor hit outside author room");
    const floor = target("Use_PropPlacementFloor");
    const local = new vec3(xCm, -1, zCm);
    const point = floor
      .getSceneObject()
      .getParent()
      .getTransform()
      .getWorldTransform()
      .multiplyPoint(local);
    const descriptor = Object.getOwnPropertyDescriptor(
      this.sikInteractor,
      "targetHitPosition",
    );
    if (!descriptor?.configurable)
      throw new Error("Official LEAF SIK hit simulation unavailable");
    Object.defineProperty(this.sikInteractor, "targetHitPosition", {
      configurable: true,
      get: () => point,
    });
    try {
      await this.trigger(floor);
    } finally {
      Object.defineProperty(
        this.sikInteractor,
        "targetHitPosition",
        descriptor,
      );
    }
    await sleep(100);
  }
}

