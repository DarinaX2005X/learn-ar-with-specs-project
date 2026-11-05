/** One raised writing surface, fixed to the existing conservation bench by
 * four braced legs. The two studies share a continuous, supported surface. */
export class ComparisonFolio {
  readonly root: SceneObject;
  private readonly wood: Material;
  private readonly brass: Material;
  constructor(parent: SceneObject, material: Material) {
    this.root = global.scene.createSceneObject("ComparisonFoldout");
    this.root.setParent(parent);
    this.wood = material.clone();
    this.wood.mainPass.baseColor = new vec4(.12,.22,.19,1);
    this.brass = material.clone();
    this.brass.mainPass.baseColor = new vec4(.58,.39,.16,1);
    // Coordinates relative to the bench anchor at story (-350,94,380).
    this.box(this.root,"ContinuousWorkSurface",[0,28.8,-10],[110,2.4,42],this.wood);
    for (const x of [-52,52]) {
      for (const z of [-27,7]) {
        this.box(this.root,"BenchFixedLeg",[x,16.3,z],[3,25.8,3],this.wood);
        this.box(this.root,"BrassFoot",[x,4.2,z],[5,1.6,5],this.brass);
        this.box(this.root,"HingeSocket",[x,27.6,z],[4,2,5],this.brass);
      }
      this.box(this.root,"SideBrace",[x,10,-10],[2,2,34],this.wood);
    }
    for (const x of [-30,30]) {
      this.box(this.root,"StudyBorder",[x,30.15,-10],[30,.3,30],this.brass);
      this.box(this.root,"StudyFloor",[x,30.35,-10],[28,.1,28],this.wood);
      this.box(this.root,"InscriptionBracket",[x,25,-34],[2,2,8],this.brass);
      this.box(this.root,"AttachedInscriptionPlate",[x,25,-38],[29,8,1],this.wood);
    }
    // The real loupe is carried by a short bracket from the same supported surface.
    this.box(this.root,"LoupeArm",[0,23,-46],[3,3,30],this.brass);
    this.box(this.root,"LoupeCradleCrossbar",[0,23,-61],[23,3,3],this.brass);
    for (const x of [-10,10]) this.box(this.root,"LoupeCradleFork",[x,26,-61],[2,6,3],this.brass);
  }
  private box(
    parent: SceneObject,
    name: string,
    centre: readonly [number, number, number],
    size: readonly [number, number, number],
    material: Material,
  ): void {
    const node = global.scene.createSceneObject(name);
    node.setParent(parent);
    node.getTransform().setLocalPosition(new vec3(...centre));
    const mesh = new MeshBuilder([
      { name: "position", components: 3 },
      { name: "normal", components: 3 },
      { name: "texture0", components: 2 },
    ]);
    mesh.topology = MeshTopology.Triangles;
    mesh.indexType = MeshIndexType.UInt16;
    const vertices: number[] = [],
      indices: number[] = [];
    const faces = [
      [
        [1, 0, 0],
        [1, -1, -1],
        [1, 1, -1],
        [1, 1, 1],
        [1, -1, 1],
      ],
      [
        [-1, 0, 0],
        [-1, -1, 1],
        [-1, 1, 1],
        [-1, 1, -1],
        [-1, -1, -1],
      ],
      [
        [0, 1, 0],
        [-1, 1, -1],
        [-1, 1, 1],
        [1, 1, 1],
        [1, 1, -1],
      ],
      [
        [0, -1, 0],
        [-1, -1, 1],
        [-1, -1, -1],
        [1, -1, -1],
        [1, -1, 1],
      ],
      [
        [0, 0, 1],
        [-1, -1, 1],
        [1, -1, 1],
        [1, 1, 1],
        [-1, 1, 1],
      ],
      [
        [0, 0, -1],
        [1, -1, -1],
        [-1, -1, -1],
        [-1, 1, -1],
        [1, 1, -1],
      ],
    ];
    for (const face of faces) {
      const start = vertices.length / 8,
        normal = face[0];
      for (const point of face.slice(1))
        vertices.push(
          (point[0] * size[0]) / 2,
          (point[1] * size[1]) / 2,
          (point[2] * size[2]) / 2,
          ...normal,
          0,
          0,
        );
      indices.push(start, start + 1, start + 2, start, start + 2, start + 3);
    }
    mesh.appendVerticesInterleaved(vertices);
    mesh.appendIndices(indices);
    mesh.updateMesh();
    const visual = node.createComponent("Component.RenderMeshVisual");
    visual.mesh = mesh.getMesh();
    visual.mainMaterial = material;
  }
  dispose(): void { this.root.destroy(); }
}
