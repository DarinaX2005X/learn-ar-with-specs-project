import WorldCameraFinderProvider from "SpectaclesInteractionKit.lspkg/Providers/CameraProvider/WorldCameraFinderProvider";

/** Optional audio must never prevent the museum from mounting or updating. */
export class MuseumAudioListener {
  private owned: AudioListenerComponent | undefined;
  private head: Camera | undefined;
  private provider: WorldCameraFinderProvider | undefined;
  private cameras: Camera[] = [];
  private listeners: AudioListenerComponent[] = [];
  private previous: unknown[] | undefined;
  private lastReason: string | undefined;
  private disposed = false;
  private liveTargetUnavailable = false;
  private captureTargetUnavailable = false;

  update(_now?: number): void {
    if (this.disposed) return;
    try {
      const current = this.dependencies();
      if (this.previous && this.same(current, this.previous)) return;
      this.previous = current;
      try {
        this.resolve();
      } catch (error) {
        this.report("listener setup deferred: " + String(error));
      }
      // Creating/removing our component is not a new external dependency change.
      this.previous = this.dependencies();
    } catch (error) {
      this.report("listener setup deferred: " + String(error));
    }
  }

  /** References and enabled flags only: no descendant walk on the stable path. */
  private dependencies(): unknown[] {
    const output = this.outputTarget();
    const values: unknown[] = [output];
    for (let i = 0; i < global.scene.getRootObjectsCount(); i++)
      values.push(global.scene.getRootObject(i));
    if (this.provider) values.push(this.provider.getComponent());
    for (const component of [...this.cameras, ...this.listeners]) {
      const alive = !isNull(component) && !component.isBeingDestroyed;
      values.push(component, alive);
      if (alive) {
        values.push(
          component.enabled,
          component.getSceneObject().isEnabledInHierarchy,
        );
        if (this.cameras.includes(component as Camera))
          values.push(
            (component as Camera).type,
            output ? (component as Camera).renderTarget : undefined,
          );
      }
    }
    if (this.head && !isNull(this.head) && !this.head.isBeingDestroyed)
      values.push(
        this.head.getSceneObject().getComponent("Component.DeviceTracking"),
        ...this.head
          .getSceneObject()
          .getComponents("Component.AudioListenerComponent"),
      );
    return values;
  }

  /** Platform-specific getters are lazy; an unavailable API stays cached for this run. */
  private outputTarget(): Texture | undefined {
    if (!this.liveTargetUnavailable) {
      try {
        const live = global.scene.liveTarget;
        if (live) return live;
      } catch (_) {
        this.liveTargetUnavailable = true;
      }
    }
    if (!this.captureTargetUnavailable) {
      try {
        return global.scene.captureTarget ?? undefined;
      } catch (_) {
        this.captureTargetUnavailable = true;
      }
    }
    return undefined;
  }

  private same(a: unknown[], b: unknown[]): boolean {
    return (
      a.length === b.length &&
      a.every((value, index) => {
        const other = b[index];
        if (value === other) return true;
        return (
          !!value &&
          !!other &&
          typeof value === "object" &&
          typeof other === "object" &&
          typeof (value as ScriptObject).isSame === "function" &&
          (value as ScriptObject).isSame(other as ScriptObject)
        );
      })
    );
  }

  /** One inventory at mount; repeat only after a camera/target/listener/root change. */
  private resolve(): void {
    const cameras: Camera[] = [],
      listeners: AudioListenerComponent[] = [];
    const pending: SceneObject[] = [];
    for (let i = 0; i < global.scene.getRootObjectsCount(); i++)
      pending.push(global.scene.getRootObject(i));
    while (pending.length) {
      const object = pending.pop()!;
      if (isNull(object) || object.isBeingDestroyed) continue;
      const camera = object.getComponent("Component.Camera");
      if (camera) cameras.push(camera);
      listeners.push(
        ...object.getComponents("Component.AudioListenerComponent"),
      );
      for (let i = 0; i < object.getChildrenCount(); i++)
        pending.push(object.getChild(i));
    }
    this.cameras = cameras;
    this.listeners = listeners.filter(
      (component) => !isNull(component) && !component.isBeingDestroyed,
    );
    const output = this.outputTarget();
    const tracked = cameras.filter(
      (camera) =>
        camera.enabled &&
        camera.getSceneObject().isEnabledInHierarchy &&
        camera.type === Camera.Type.Perspective &&
        camera.getSceneObject().getComponent("Component.DeviceTracking"),
    );
    let active: Camera[];
    if (output) {
      active = tracked.filter((camera) => camera.renderTarget.isSame(output));
    } else {
      // Do not let a cached provider conceal a genuinely ambiguous active camera set.
      if (tracked.length !== 1) {
        this.report(
          "output texture API unavailable; expected one active tracked camera, found " +
            tracked.length,
        );
        return;
      }
      if (!this.provider)
        this.provider = WorldCameraFinderProvider.getInstance();
      if (!this.same([this.provider.getComponent()], [tracked[0]])) {
        this.report(
          "output texture API unavailable; SIK head does not match the sole active tracked camera",
        );
        return;
      }
      active = tracked;
    }
    if (active.length !== 1) {
      this.report(
        "expected one active tracked output camera; found " + active.length,
      );
      return;
    }
    const head = active[0],
      object = head.getSceneObject();
    // SIK provides the normal head identity; inventory also covers temporary profile switches.
    if (!this.provider) this.provider = WorldCameraFinderProvider.getInstance();
    this.head = head;
    const foreign = this.listeners.filter(
      (component) => !this.owned || !this.same([component], [this.owned]),
    );
    if (foreign.length > 1) {
      this.releaseOwned();
      this.report(
        "multiple foreign listeners; leave their ownership unchanged",
      );
      return;
    }
    if (foreign.length === 1) {
      this.releaseOwned();
      if (
        !foreign[0].enabled ||
        !foreign[0].getSceneObject().isEnabledInHierarchy
      )
        this.report(
          "foreign listener is disabled or inactive; waiting for its owner",
        );
      else if (!this.same([foreign[0].getSceneObject()], [object]))
        this.report("foreign listener is not on the active head camera");
      else this.lastReason = undefined; // Borrow only; never reconfigure or destroy it.
      return;
    }
    if (
      this.owned &&
      !isNull(this.owned) &&
      !this.owned.isBeingDestroyed &&
      this.same([this.owned.getSceneObject()], [object])
    ) {
      if (!this.owned.enabled)
        this.report("owned listener is disabled; waiting for enable");
      else this.lastReason = undefined;
      return;
    }
    this.releaseOwned();
    this.owned = object.createComponent("Component.AudioListenerComponent");
    this.listeners.push(this.owned);
    this.lastReason = undefined;
  }

  private report(reason: string): void {
    if (reason !== this.lastReason) print("Museum spatial audio: " + reason);
    this.lastReason = reason;
  }

  private releaseOwned(): void {
    if (this.owned && !isNull(this.owned) && !this.owned.isBeingDestroyed)
      this.owned.destroy();
    this.owned = undefined;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    try {
      this.releaseOwned();
    } catch (error) {
      this.report("owned listener cleanup deferred: " + String(error));
    }
  }
}
