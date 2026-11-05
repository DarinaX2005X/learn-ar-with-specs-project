import { MuseumFonts } from "./MuseumFonts";
import { NativeMirrorBridge } from '../Scripts/TableKit/NativeMirrorBridge';
import { RubyFacetFinish } from '../Scripts/TableKit/RubyFacetFinish';
import {mirrorCurtainPlacement} from "../Scripts/TableKit/MirrorFramePose";
import {
  Board,
  CaseDraft,
  History,
  Role,
  VaultEntry,
  FrameClue,
  placedDraftTracks,
  isTrackPlaced,
} from "../Domain/types";
import { PlayTableSnapshot } from "./PlayTable";
import { RecordedGlass } from "./RecordedGlass";
import { renderHistory } from "../Spatial/Reconstruction";
import { ActorRig } from "./MuseumScene/ActorRig";
import { LensArmAdapter, MountedArm } from "../Spatial/ArmIK";
import { curtainVisual } from "../Scripts/TableKit/TableKit";
import { poseAt } from "../Domain/geometry";
import { ComparisonHall } from "./ComparisonHall";
import {
  comparisonPoseTick,
  CaseViewPresentation,
  CaseViewViewer,
  CaseViewSnapshot,
} from "../Spatial/CaseViewRouting";

import { CaseViewHandles } from "./CaseViewHandles";
import { CasePaper } from "./CasePaper";
import { CaseTitleInk } from "./CaseTitleInk";
import { ArrivalFile } from "./ArrivalFile";
import { BenchCameos } from "./BenchCameos";
import { AuthorGlass } from "./MuseumScene/AuthorGlass";
import { AuthorViewSnapshot } from "../Author/AuthorViewSession";
import { PublicCradleTransport } from "./MuseumScene/PublicCradle";

/** Native museum binding. Persistent architecture is never recreated on a role change. */
export class MuseumScene {
  private rigs = new Map<SceneObject, ActorRig>();
  private digitBindings = new Map<Role, number>();
  private anonymousTemplateDigits = 0;
  private roleTracks = new Map<Role, Board["tracks"][number]>();
  private rig(actor: SceneObject, anonymous = false): ActorRig {
    let rig = this.rigs.get(actor);
    if (!rig) {
      rig = new ActorRig(actor, anonymous);
      this.rigs.set(actor, rig);
    }
    return rig;
  }
  private lastPoseTick: number | undefined;
  private theatre: SceneObject;
  private actors = new Map<Role, SceneObject>();
  private arms = new Map<Role, LensArmAdapter<vec3, quat>>();
  private glassRoot: SceneObject;
  private glass: RecordedGlass;
  private entryGlass: RecordedGlass | undefined;
  private frameKey = "";
  private frameId: string | undefined;
  private revision: number | undefined;
  private walls: SceneObject[] = [];
  private wallKey = "";
  private lidClosed = false;
  private lid: SceneObject | undefined;
  private audio = new Map<string, AudioComponent>();
  private aperture: number | undefined;
  private soundAt = -10;
  private initializedLid = false;
  private clockHands: SceneObject[] = [];
  private anonymous = new Map<string, SceneObject>();
  private hall: ComparisonHall;
  private comparisonActive = false;
  private covered = false;
  private labelsVisible = true;
  private casePresentation: CaseViewPresentation | undefined;
  private museumTransform: { position: vec3; rotation: quat; scale: vec3 };
  private poseCache:
    | {
        board: Board | undefined;
        history: History | undefined;
        publicRoutes: boolean;
        visible: boolean;
        publicPlaying: boolean;
        authorCasting: CaseDraft["casting"] | undefined;
      }
    | undefined;
  private viewer: SceneObject | undefined;
  private disposed = false;
  private viewHandles: CaseViewHandles;
  private paper: CasePaper;
  private caseTitleInk: CaseTitleInk;
  private arrivalFile: ArrivalFile;
  private benchCameos: BenchCameos;
  private cradle = new PublicCradleTransport();
  private authorGlass: AuthorGlass;
  private benchCaseParked = false;
  private ruby: SceneObject | undefined;
  private facetFinish: RubyFacetFinish;
  private liveFinish: NativeMirrorBridge;
  private finishMirrorMode:'author'|'reveal'|'public'='public';
  /** Final renderer-owned visibility and poses are already settled when called. */
  updateNativeFinish(keyLight:SceneObject|undefined, enabled:boolean, mirrorEnabled:boolean):void {
    this.arrivalFile?.update(getDeltaTime());
    if(this.disposed)return;
    const source=keyLight?.getComponent('Component.LightSource') as LightSource | undefined;
    const light=keyLight?.enabled && source?.enabled && source.lightType===LightType.Point && source.intensity>0
      ? keyLight.getTransform().getWorldPosition() : undefined;
    const viewer=this.readCaseViewViewer();
    this.facetFinish.update(viewer.eyeCm,enabled && light ? [light.x,light.y,light.z] : undefined);
    const cache=this.poseCache,board=cache?.board,authorized=this.finishMirrorMode!=='public';
    this.liveFinish.update({enabled:mirrorEnabled,authorized,mode:this.finishMirrorMode,
      frameKey:board ? [board.caseId,board.rev,board.room.mirror?.id].join('|') : '',
      visible:!!cache?.visible && !this.covered && !this.lidClosed && !this.comparisonActive && this.theatre.enabled,
      actors:authorized ? Array.from(this.actors.values()) : [],
      props:authorized ? [this.fixedProp('DisplayCase',this.theatre),this.ruby].filter((p):p is SceneObject=>!!p) : [],
      mirror:board?.room.mirror,walls:board?.room.walls ?? [],exhibit:board?.room.exhibit.position,
      eyeWorld:viewer.eyeCm,viewForwardWorld:viewer.forward});
  }
  private anonymousTemplate: SceneObject | undefined;
  private comparisonRoot: SceneObject | undefined;
  private jointCache = new WeakMap<
    SceneObject,
    Map<string, Transform | undefined>
  >();
  private transformCache = new WeakMap<SceneObject, Transform>();
  private tx(object: SceneObject): Transform {
    let transform = this.transformCache.get(object);
    if (!transform) {
      transform = object.getTransform();
      this.transformCache.set(object, transform);
    }
    return transform;
  }
  private joint(actor: SceneObject, name: string): Transform | undefined {
    let joints = this.jointCache.get(actor);
    if (!joints) {
      joints = new Map();
      this.jointCache.set(actor, joints);
    }
    if (!joints.has(name))
      joints.set(name, this.find(name, actor)?.getTransform());
    return joints.get(name);
  }
  private cameraCopies = new Map<string, SceneObject>();
  constructor(
    private root: SceneObject,
    private material: Material,
    sounds?: {
      cloth?: AudioTrackAsset;
      engage?: AudioTrackAsset;
      latch?: AudioTrackAsset;
    },
    private fonts: MuseumFonts = {},
  ) {
    const theatre = this.find("Theatre", root);
    if (!theatre) throw new Error("Museum Theatre is missing");
    this.theatre = theatre;
    this.ruby = this.find("Ruby", theatre);
    this.facetFinish=new RubyFacetFinish(this.ruby);
    this.liveFinish=new NativeMirrorBridge(theatre);
    this.anonymousTemplate = this.findGlobal("MuseumAnonymousTemplate");
    if (this.anonymousTemplate)
      for (const name of [
        "Thumb_R",
        "ThumbMiddle_R",
        "ThumbDistal_R",
        ...[0, 1, 2, 3].flatMap((i) => [
          "Finger_R" + i,
          "FingerMiddle_R" + i,
          "FingerDistal_R" + i,
        ]),
      ])
        if (this.find(name, this.anonymousTemplate))
          this.anonymousTemplateDigits++;
    const transform = theatre.getTransform();
    this.museumTransform = {
      position: transform.getLocalPosition(),
      rotation: transform.getLocalRotation(),
      scale: transform.getLocalScale(),
    };
    this.hall = new ComparisonHall(root, material, {
      stopSound: () => this.cancelInput(),
      setBenchCaseParked: (parked) => this.setBenchCaseParked(parked),
      setRoomQualification: (text) => this.viewHandles?.setQualification(text),
    }, fonts);
    this.viewHandles = new CaseViewHandles(root, material, fonts);
    this.paper = new CasePaper(root, fonts);
    this.caseTitleInk = new CaseTitleInk(root, fonts);
    this.arrivalFile = new ArrivalFile(root, material, fonts.bold ?? fonts.regular);
    this.benchCameos = new BenchCameos(root, material, fonts.bold ?? fonts.regular);
    this.authorGlass = new AuthorGlass(root, material, fonts);
    this.mountClock("Anchor_EntryClock", false);
    this.mountClock("Anchor_HallClock", true);
    for (const role of ["Courier", "Guard", "Conservator"] as Role[]) {
      const actor = this.find(role, theatre);
      if (actor) {
        this.actors.set(role, actor);
        this.bindArm(role, actor);
        actor.enabled = false;
      }
    }
    this.glassRoot = global.scene.createSceneObject("PublicRecordedGlass");
    this.glassRoot.setParent(root);
    this.glass = new RecordedGlass(this.glassRoot, material, true);
    for (const name of ["cloth", "engage", "latch"] as const) {
      const track = sounds?.[name];
      if (track) {
        const audio = root.createComponent("Component.AudioComponent");
        audio.audioTrack = track;
        this.audio.set(name, audio);
      }
    }
    const anchor = this.fixedProp("Anchor_PinGlass");
    if (anchor) {
      this.glassRoot
        .getTransform()
        .setWorldPosition(anchor.getTransform().getWorldPosition());
      this.glassRoot
        .getTransform()
        .setWorldRotation(anchor.getTransform().getWorldRotation());
    } else
      this.glassRoot.getTransform().setLocalPosition(new vec3(-660, 105, 110));
    // A vertical recording pane stands on the conservation bench, never in the viewer's face.
    this.glassRoot.getTransform().setLocalScale(new vec3(0.5, 0.5, 0.5));
    // Workshop loupe lies on its real bench surface, normal toward the reader.
    this.glassRoot
      .getTransform()
      .setWorldRotation(
        (
          anchor?.getTransform().getWorldRotation() ??
          root.getTransform().getWorldRotation()
        )
          .multiply(quat.fromEulerAngles(-Math.PI / 2, 0, 0))
          .multiply(quat.fromEulerAngles(0, 0, Math.PI)),
      );
    this.mountEntryGlass();
    this.lid = this.findGlobal("CaseLidPivot");
    if (!this.lid) {
      this.lid = global.scene.createSceneObject("MuseumCaseLid");
      this.lid.setParent(root);
      const hinge = this.findGlobal("Anchor_CaseLid");
      if (hinge) {
        this.lid
          .getTransform()
          .setWorldPosition(hinge.getTransform().getWorldPosition());
        this.lid
          .getTransform()
          .setWorldRotation(hinge.getTransform().getWorldRotation());
      } else
        this.lid.getTransform().setLocalPosition(new vec3(-722.5, 103.5, 115));
      const mesh = new MeshBuilder([
        { name: "position", components: 3 },
        { name: "normal", components: 3 },
        { name: "texture0", components: 2 },
      ]);
      mesh.topology = MeshTopology.Triangles;
      mesh.indexType = MeshIndexType.UInt16;
      const vertices: number[] = [];
      for (const y of [-1.25, 1.25])
        for (const z of [-16, 16])
          for (const x of [-22.5, 22.5]) vertices.push(x, y, z, 0, 1, 0, 0, 0);
      mesh.appendVerticesInterleaved(vertices);
      mesh.appendIndices([
        0, 1, 3, 0, 3, 2, 4, 6, 7, 4, 7, 5, 0, 4, 5, 0, 5, 1, 2, 3, 7, 2, 7, 6,
        0, 2, 6, 0, 6, 4, 1, 5, 7, 1, 7, 3,
      ]);
      mesh.updateMesh();
      const surface = global.scene.createSceneObject("CaseLidSurface");
      surface.setParent(this.lid);
      surface.getTransform().setLocalPosition(new vec3(22.5, 1.25, 0));
      const visual = surface.createComponent("Component.RenderMeshVisual");
      this.lid
        .getTransform()
        .setLocalRotation(quat.fromEulerAngles(0, 0, (Math.PI * 5) / 12));
      visual.mesh = mesh.getMesh();
      const leather = material.clone();
      leather.mainPass.baseColor = new vec4(0.12, 0.22, 0.2, 1);
      visual.mainMaterial = leather;
    }
  }
  private find(name: string, node: SceneObject): SceneObject | undefined {
    if (node.name === name) return node;
    for (let i = 0; i < node.getChildrenCount(); i++) {
      const found = this.find(name, node.getChild(i));
      if (found) return found;
    }
    return undefined;
  }
  /** Native dial planes are XY. Entry faces the foyer (-Z), hall faces into +Z.
   * The entry overlay sits in front of the two baked, stationary GLB hands. */
  private mountClock(anchorName: string, faceHall: boolean): void {
    const anchor = this.findGlobal(anchorName);
    if (!anchor) return;
    const dial = global.scene.createSceneObject(anchorName + "_LiveDial");
    dial.setParent(this.root);
    dial
      .getTransform()
      .setWorldPosition(anchor.getTransform().getWorldPosition());
    dial
      .getTransform()
      .setWorldRotation(anchor.getTransform().getWorldRotation());
    if (faceHall)
      dial.getTransform().setLocalRotation(quat.fromEulerAngles(0, Math.PI, 0));
    const ring = Array.from({ length: 48 }, (_, i) => {
      const angle = (i * Math.PI) / 24;
      return [Math.cos(angle) * 18.7, Math.sin(angle) * 18.7] as const;
    });
    this.extrusion(
      dial,
      "ClockFaceCover",
      ring,
      -12.8,
      1,
      new vec4(0.86, 0.8, 0.63, 1),
    );
    for (let i = 0; i < 12; i++) {
      const mark = this.extrusion(
        dial,
        "ClockMinuteMark",
        [
          [-0.45, 15],
          [0.45, 15],
          [0.45, 17],
          [-0.45, 17],
        ],
        -13.5,
        0.5,
        new vec4(0.09, 0.16, 0.15, 1),
      );
      mark
        .getTransform()
        .setLocalRotation(quat.fromEulerAngles(0, 0, (-i * Math.PI) / 6));
    }
    const hand = this.extrusion(
      dial,
      "ClockTimeHand",
      [
        [-0.9, -3],
        [0.9, -3],
        [0.9, 10],
        [0, 14.5],
        [-0.9, 10],
      ],
      -14.5,
      1.4,
      new vec4(0.05, 0.13, 0.12, 1),
    );
    this.clockHands.push(hand);
  }
  private extrusion(
    parent: SceneObject,
    name: string,
    outline: readonly (readonly [number, number])[],
    z: number,
    depth: number,
    color: vec4,
  ): SceneObject {
    const object = global.scene.createSceneObject(name);
    object.setParent(parent);
    const builder = new MeshBuilder([
      { name: "position", components: 3 },
      { name: "normal", components: 3 },
      { name: "texture0", components: 2 },
    ]);
    builder.topology = MeshTopology.Triangles;
    builder.indexType = MeshIndexType.UInt16;
    const vertices: number[] = [],
      indices: number[] = [],
      n = outline.length;
    for (const plane of [z, z + depth])
      for (const point of outline)
        vertices.push(point[0], point[1], plane, 0, 0, -1, 0, 0);
    for (let i = 1; i < n - 1; i++)
      indices.push(0, i + 1, i, n, n + i, n + i + 1);
    for (let i = 0; i < n; i++) {
      const next = (i + 1) % n;
      indices.push(i, next, n + next, i, n + next, n + i);
    }
    builder.appendVerticesInterleaved(vertices);
    builder.appendIndices(indices);
    builder.updateMesh();
    const visual = object.createComponent("Component.RenderMeshVisual");
    visual.mesh = builder.getMesh();
    const material = this.material.clone();
    material.mainPass.baseColor = color;
    visual.mainMaterial = material;
    return object;
  }
  private findGlobal(name: string): SceneObject | undefined {
    for (let i = 0; i < global.scene.getRootObjectsCount(); i++) {
      const found = this.find(name, global.scene.getRootObject(i));
      if (found) return found;
    }
    return undefined;
  }
  private mountEntryGlass(): void {
    if (this.entryGlass) return;
    const anchor = this.fixedProp("Anchor_EntryRecording");
    if (!anchor) return;
    const pane = global.scene.createSceneObject("EntryRecordedGlass");
    pane.setParent(this.root);
    pane
      .getTransform()
      .setWorldPosition(anchor.getTransform().getWorldPosition());
    pane
      .getTransform()
      .setWorldRotation(anchor.getTransform().getWorldRotation());
    this.entryGlass = new RecordedGlass(pane, this.material);
    this.frameKey = "";
  }
  private bindArm(role: Role, actor: SceneObject) {
    const shoulder = this.find("Shoulder_R", actor),
      elbow = this.find("Forearm_R", actor),
      wrist = this.find("Hand_R", actor);
    if (!shoulder || !elbow || !wrist) return;
    let upper = this.find("UpperBody", actor);
    if (!upper) {
      upper = global.scene.createSceneObject("UpperBody");
      upper.setParent(shoulder.getParent());
      const parent = shoulder.getParent();
      const children: SceneObject[] = [];
      for (let i = 0; i < parent.getChildrenCount(); i++) {
        const child = parent.getChild(i);
        if (
          child !== upper &&
          !/^Hip_|^Thigh_|^Knee_|^Boot_|^Sole_/.test(child.name)
        )
          children.push(child);
      }
      for (const child of children) child.setParent(upper);
    }
    const digits: NonNullable<MountedArm<vec3, quat>["digits"]> = {};
    for (const [digit, suffix] of [
      ["Index", "0"],
      ["Middle", "1"],
      ["Ring", "2"],
      ["Little", "3"],
      ["Thumb", ""],
    ] as const) {
      const proximal = this.find(
        digit === "Thumb" ? "Thumb_R" : "Finger_R" + suffix,
        actor,
      );
      const middle = this.find(
        digit === "Thumb" ? "ThumbMiddle_R" : "FingerMiddle_R" + suffix,
        actor,
      );
      const distal = this.find(
        digit === "Thumb" ? "ThumbDistal_R" : "FingerDistal_R" + suffix,
        actor,
      );
      if (proximal && middle && distal)
        digits[digit] = { proximal, middle, distal };
    }
    this.digitBindings.set(role, Object.keys(digits).length * 3);
    this.arms.set(
      role,
      new LensArmAdapter(
        { upperBody: upper, shoulder, elbow, wrist, digits },
        {
          vector: (x, y, z) => new vec3(x, y, z),
          quaternion: (x, y, z, w) => new quat(w, x, y, z),
        },
      ),
    );
  }
  private draftBoard(d: CaseDraft): Board {
    return {
      caseId: d.id,
      rev: d.rev,
      room: d.room,
      witnesses: d.witnesses,
      tracks: placedDraftTracks(d),
      alarmTick: d.alarmTick,
      chain: !!d.chain,
      fields: d.fields || ["taker"],
      windows: {
        take: [],
        brush: { A: [], B: [], C: [] },
        pass: [],
        stash: [],
      },
    };
  }
  private draftHistory(d: CaseDraft): History | undefined {
    if (d.events.some(e => e.kind === "Pass"
      ? !isTrackPlaced(d, e.from) || !isTrackPlaced(d, e.to)
      : !isTrackPlaced(d, e.kind === "Stash" ? e.carrier : e.track))) return undefined;
    const take = d.events.find((e) => e.kind === "Take");
    if (
      !take ||
      take.kind !== "Take" ||
      !d.tracks.some((track) => track.id === take.track)
    )
      return undefined;
    const pass = d.events.find((e) => e.kind === "Pass");
    const stash = d.events.find((e) => e.kind === "Stash");
    return {
      casting: d.casting,
      take: take.track,
      brushes: d.events
        .filter((e) => e.kind === "BrushRim")
        .map((e) => ({
          track: (e as Extract<typeof e, { track: unknown }>).track,
          tick: e.tick,
        })),
      ...(pass && pass.kind === "Pass"
        ? { pass: { from: pass.from, to: pass.to, tick: pass.tick } }
        : {}),
      ...(stash && stash.kind === "Stash"
        ? {
            stash: { carrier: stash.carrier, box: stash.box, tick: stash.tick },
          }
        : {}),
    };
  }
  private point(o: SceneObject | undefined, p: readonly number[]) {
    if (o)
      this.tx(o).setLocalPosition(
        new vec3(p[0] * 0.06 - 21, p[1] * 0.06, p[2] * 0.06 - 15),
      );
  }
  // Only authored objects with the lifetime of the museum belong here. Runtime
  // walls, witness copies, comparison parts and role objects have shorter lives.
  private readonly fixedProps = new Map<
    SceneObject | undefined,
    Map<string, SceneObject>
  >();
  private fixedProp(
    name: string,
    parent?: SceneObject,
  ): SceneObject | undefined {
    let props = this.fixedProps.get(parent);
    if (!props) {
      props = new Map();
      this.fixedProps.set(parent, props);
    }
    const cached = props.get(name);
    if (cached) return cached;
    const found = parent ? this.find(name, parent) : this.findGlobal(name);
    // The importer can attach a template after the museum is mounted.
    if (found) props.set(name, found);
    return found;
  }
  private renderWalls(board: Board) {
    const longTemplate = this.fixedProp("MuseumPartitionTemplate");
    const shortTemplate = this.fixedProp("MuseumPartitionShortTemplate");
    const key =
      JSON.stringify(board.room.walls) +
      ":" +
      !!longTemplate +
      ":" +
      !!shortTemplate;
    if (key === this.wallKey) return;
    this.wallKey = key;
    for (const wall of this.walls) wall.destroy();
    this.walls = [];
    for (const wall of board.room.walls) {
      const domainLength = Math.hypot(wall.b.x - wall.a.x, wall.b.z - wall.a.z);
      const useShort =
        !!shortTemplate &&
        (!longTemplate ||
          Math.abs(domainLength - 1.25) < Math.abs(domainLength - 2.4));
      const template = useShort ? shortTemplate : longTemplate;
      if (template) {
        // Finished reversible screen is raw GLB metres. Theatre's 100/6 scale
        // supplies the remaining cm conversion; decoration stays inside bounds.
        const screen = this.theatre.copyWholeHierarchy(template);
        screen.name = "PublicWall_" + wall.id;
        screen
          .getTransform()
          .setLocalPosition(
            new vec3(
              (wall.a.x + wall.b.x) * 3 - 21,
              wall.bottom * 6,
              (wall.a.z + wall.b.z) * 3 - 15,
            ),
          );
        screen
          .getTransform()
          .setLocalRotation(
            quat.fromEulerAngles(
              0,
              -Math.atan2(wall.b.z - wall.a.z, wall.b.x - wall.a.x),
              0,
            ),
          );
        screen
          .getTransform()
          .setLocalScale(
            new vec3(
              (6 * domainLength) / (useShort ? 1.25 : 2.4),
              (6 * (wall.top - wall.bottom)) / 2,
              6,
            ),
          );
        screen.enabled = true;
        this.walls.push(screen);
        continue;
      }
      // Preserve physical occlusion if an imported screen dependency is absent.
      // The normal mounted scene uses finished wood/cloth templates above.
      const object = global.scene.createSceneObject("PublicWall_" + wall.id);
      object.setParent(this.theatre);
      const dx = wall.b.x - wall.a.x,
        dz = wall.b.z - wall.a.z,
        length = Math.hypot(dx, dz) * 6,
        height = (wall.top - wall.bottom) * 6;
      object
        .getTransform()
        .setLocalPosition(
          new vec3(wall.a.x * 6 - 21, wall.bottom * 6, wall.a.z * 6 - 15),
        );
      object
        .getTransform()
        .setLocalRotation(quat.fromEulerAngles(0, -Math.atan2(dz, dx), 0));
      const mesh = new MeshBuilder([
        { name: "position", components: 3 },
        { name: "normal", components: 3 },
        { name: "texture0", components: 2 },
      ]);
      mesh.topology = MeshTopology.Triangles;
      mesh.indexType = MeshIndexType.UInt16;
      const vertices: number[] = [];
      for (const y of [0, height])
        for (const z of [-0.45, 0.45])
          for (const x of [0, length]) vertices.push(x, y, z, 0, 1, 0, 0, 0);
      mesh.appendVerticesInterleaved(vertices);
      mesh.appendIndices([
        0, 1, 3, 0, 3, 2, 4, 6, 7, 4, 7, 5, 0, 4, 5, 0, 5, 1, 2, 3, 7, 2, 7, 6,
        0, 2, 6, 0, 6, 4, 1, 5, 7, 1, 7, 3,
      ]);
      mesh.updateMesh();
      const visual = object.createComponent("Component.RenderMeshVisual");
      visual.mesh = mesh.getMesh();
      const stone = this.material.clone();
      stone.mainPass.baseColor = new vec4(0.45, 0.49, 0.42, 1);
      visual.mainMaterial = stone;
      this.walls.push(object);
    }
  }
  private renderPublicRoutes(
    board: Board | undefined,
    tick: number,
    enabled: boolean,
    prepare = false,
  ): void {
    const template = enabled ? this.anonymousTemplate : undefined;
    const active = new Set<string>();
    if (board && template && enabled)
      for (const track of board.tracks) {
        active.add(track.id);
        let actor = this.anonymous.get(track.id);
        if (!actor) {
          actor = this.theatre.copyWholeHierarchy(template);
          actor.name = "PublicRoute_" + track.id;
          actor.getTransform().setLocalScale(new vec3(100, 100, 100));
          this.anonymous.set(track.id, actor);
          this.rig(actor, true).prepare(track);
        }
        const pose = poseAt(track, tick);
        this.point(actor, [pose.x * 100, (pose.y - 1) * 100, pose.z * 100]);
        this.tx(actor).setLocalRotation(
          quat.fromEulerAngles(0, pose.yaw + Math.PI, 0),
        );
        actor.enabled = true;
        const rig = this.rig(actor, true);
        if (prepare) rig.prepare(track);
        rig.sample(tick);
      }
    for (const [track, actor] of this.anonymous)
      if (!active.has(track)) actor.enabled = false;
  }
  private drawHistoryPose(board: Board, history: History, tick: number): void {
    const ruby = this.ruby;
    const view = renderHistory(board, history, tick);
    for (const pose of view.actors) {
      const actor = this.actors.get(pose.role);
      if (!actor) continue;
      this.point(actor, pose.positionCm);
      this.tx(actor).setLocalRotation(
        quat.fromEulerAngles(0, pose.yawRad + Math.PI, 0),
      );
      const track = this.roleTracks.get(pose.role);
      const rig = this.rig(actor);
      const gait = track ? rig.sample(tick) : undefined;
      const hand = view.hands.find(
        (h) => history!.casting[h.track] === pose.role,
      );
      if (hand)
        this.arms.get(pose.role)?.apply(
          {
            ...pose,
            positionCm: gait
              ? rig.armBasis(pose.positionCm, gait)
              : pose.positionCm,
            yawRad: (gait?.bodyYaw ?? pose.yawRad) + Math.PI,
          },
          hand.handCm,
          (
            hand as typeof hand & {
              articulation?: {
                reach: number;
                curl: number;
                carry: number;
                touch?: number;
              };
            }
          ).articulation,
        );
    }
    if (ruby) {
      this.point(ruby, view.ruby.positionCm);
      ruby.enabled = view.ruby.visible && this.hasExhibit(board);
    }
  }
  private renderCameras(board: Board): void {
    const original = this.fixedProp("Camera", this.theatre);
    if (original) original.enabled = board.witnesses.length > 0;
    const active = new Set<string>();
    board.witnesses.forEach((witness, index) => {
      let camera = index === 0 ? original : this.cameraCopies.get(witness.id);
      if (!camera && original) {
        camera = this.theatre.copyWholeHierarchy(original);
        camera.name = "WitnessCamera_" + witness.id;
        this.cameraCopies.set(witness.id, camera);
      }
      if (!camera) return;
      if (index > 0) active.add(witness.id);
      camera.enabled = true;
      const yaw = witness.yaw + Math.PI;
      this.point(camera, [
        witness.position.x * 100 + Math.sin(yaw) * 37.333,
        witness.position.y * 100 - 66.667,
        witness.position.z * 100 + Math.cos(yaw) * 37.333,
      ]);
      camera.getTransform().setLocalRotation(quat.fromEulerAngles(0, yaw, 0));
    });
    for (const [id, camera] of this.cameraCopies)
      if (!active.has(id)) camera.enabled = false;
  }
  setBenchCaseParked(parked: boolean): void {
    this.benchCaseParked = parked;
    this.applyLidPose();
  }
  private applyLidPose(): void {
    const closed = this.lidClosed || this.benchCaseParked;
    if (this.lid)
      this.lid
        .getTransform()
        .setLocalRotation(
          quat.fromEulerAngles(0, 0, closed ? 0 : (Math.PI * 5) / 12),
        );
    this.paper?.setCovered(closed);
  }
  private hasExhibit(board: Board): boolean {
    const p = board.room.exhibit.position;
    return (
      [p.x, p.y, p.z].every(Number.isFinite) &&
      p.x >= 0 &&
      p.z >= 0 &&
      p.x <= board.room.width &&
      p.z <= board.room.depth
    );
  }
  /** An incomplete author draft has figures and a resting gem, not an invented Take. */
  private drawStagingPose(
    board: Board,
    casting: CaseDraft["casting"],
    tick: number,
  ): void {
    for (const track of board.tracks) {
      const role = casting[track.id],
        actor = this.actors.get(role);
      if (!actor) continue;
      const p = poseAt(track, tick),
        pose = {
          role,
          positionCm: [p.x * 100, (p.y - 1) * 100, p.z * 100] as const,
          yawRad: p.yaw + Math.PI,
        };
      this.point(actor, pose.positionCm);
      this.tx(actor).setLocalRotation(quat.fromEulerAngles(0, pose.yawRad, 0));
      const rig = this.rig(actor),
        gait = rig.sample(tick);
      this.arms.get(role)?.apply(
        {
          ...pose,
          positionCm: rig.armBasis(pose.positionCm, gait),
          yawRad: gait.bodyYaw + Math.PI,
        },
        [
          (p.x + 0.12 * Math.cos(gait.bodyYaw)) * 100,
          (p.y - 0.3) * 100,
          (p.z - 0.12 * Math.sin(gait.bodyYaw)) * 100,
        ],
      );
    }
    const ruby = this.ruby,
      exhibit = board.room.exhibit.position;
    if (ruby) {
      ruby.enabled = !this.lidClosed && this.hasExhibit(board);
      if (ruby.enabled)
        this.point(ruby, [exhibit.x * 100, exhibit.y * 100, exhibit.z * 100]);
    }
  }
  private drawPublicCradle(board: Board, tick: number, playing: boolean): void {
    const sample = this.cradle.sample(board, tick, playing),
      ruby = this.ruby;
    const exhibit = board.room.exhibit.position;
    this.point(ruby, [exhibit.x * 100, exhibit.y * 100, exhibit.z * 100]);
    if (ruby)
      ruby.enabled =
        !this.lidClosed && sample.present && this.hasExhibit(board);
    // Passive recorded alarm samples never trigger mechanism foley.
  }
  presentPose(tick: number): void {
    if (this.disposed) return;
    if (!Number.isFinite(tick) || !this.poseCache || this.lidClosed) return;
    const sampled = Math.max(0, Math.min(24, tick));
    if (this.lastPoseTick === sampled) return;
    this.lastPoseTick = sampled;
    for (const hand of this.clockHands)
      this.tx(hand).setLocalRotation(
        quat.fromEulerAngles(0, 0, (-sampled * Math.PI) / 12),
      );
    if (this.comparisonActive) {
      this.hall.presentPose(sampled);
      this.applyCoverState();
      return;
    }
    const cache = this.poseCache;
    this.renderPublicRoutes(cache.board, sampled, cache.publicRoutes);
    if (cache.publicRoutes && cache.board)
      this.drawPublicCradle(cache.board, sampled, cache.publicPlaying);
    if (cache.visible && cache.board && cache.history)
      this.drawHistoryPose(cache.board, cache.history, sampled);
    else if (cache.visible && cache.board && cache.authorCasting)
      this.drawStagingPose(cache.board, cache.authorCasting, sampled);
    this.applyCoverState();
  }
  render(
    snapshot: PlayTableSnapshot & {
      view?: CaseViewSnapshot;
      authorView?: AuthorViewSnapshot;
      reveal?: { tick: number; playing: boolean };
    },
    reveal?: VaultEntry,
  ): void {
    if (this.disposed) return;
    const previousComparison = this.hall.read();
    this.lastPoseTick = undefined;
    this.finishMirrorMode=snapshot.flow.mode==='author' ? 'author' : reveal ? 'reveal' : 'public';
    if(this.finishMirrorMode==='public')this.liveFinish.clear();
    const bench = this.fixedProp("Anchor_ConservationBench");
    const benchPoint =
      bench?.getTransform().getWorldPosition() ??
      this.root
        .getTransform()
        .getWorldTransform()
        .multiplyPoint(new vec3(-700, 94, 130));
    const benchDirection = (
      bench?.getTransform().getWorldRotation() ??
      this.root.getTransform().getWorldRotation()
    ).multiplyVec3(new vec3(0, 0, 1));
    this.viewHandles.render(snapshot.view, {
      originCm: [benchPoint.x, benchPoint.y, benchPoint.z],
      scale: 1,
      yawRad: Math.atan2(benchDirection.x, benchDirection.z),
    });
    this.paper.render(snapshot);
    this.caseTitleInk.render(snapshot.flow.title);
    this.arrivalFile.render(snapshot);
    this.authorGlass.render(
      snapshot.flow.mode === "author" ? snapshot.authorView : undefined,
      snapshot.flow.mode === "author" ? snapshot.author?.draft : undefined,
    );
    this.mountEntryGlass();
    if (this.glassRoot.getParent() === this.root) {
      const anchor = this.fixedProp("Anchor_PinGlass");
      if (anchor) {
        this.glassRoot
          .getTransform()
          .setWorldPosition(anchor.getTransform().getWorldPosition());
        this.glassRoot.getTransform().setWorldRotation(
          anchor
            .getTransform()
            .getWorldRotation()
            .multiply(quat.fromEulerAngles(-Math.PI / 2, 0, 0))
            .multiply(quat.fromEulerAngles(0, 0, Math.PI)),
        );
      }
    }
    let board = snapshot.board,
      history: History | undefined,
      tick =
        snapshot.reveal?.tick ??
        snapshot.detective?.tick ??
        snapshot.author?.tick ??
        0;
    for (const hand of this.clockHands)
      this.tx(hand).setLocalRotation(
        quat.fromEulerAngles(
          0,
          0,
          (-Math.max(0, Math.min(24, tick)) * Math.PI) / 12,
        ),
      );
    if (snapshot.flow.mode === "author" && snapshot.author) {
      board = this.draftBoard(snapshot.author.draft);
      history = board.tracks.length
        ? this.draftHistory(snapshot.author.draft)
        : undefined;
    } else if (reveal && snapshot.flow.mode === "finished") {
      board = this.draftBoard(reveal.sourceDraft);
      history = reveal.actualHistory;
    } else if (snapshot.detective?.mode === "reconstruction")
      history = snapshot.detective.reconstruction;
    const authorCasting =
      snapshot.flow.mode === "author" && !history
        ? snapshot.author?.draft.casting
        : undefined;
    const visible =
      (!!history || !!authorCasting) && !!board && !this.lidClosed;
    const publicRoutes =
      !history &&
      !this.lidClosed &&
      (snapshot.flow.mode === "ready" || snapshot.flow.mode === "detective") &&
      snapshot.detective?.mode !== "reconstruction";
    this.renderPublicRoutes(board, tick, publicRoutes, true);
    const casting = history?.casting ?? authorCasting;
    this.roleTracks.clear();
    if (board && casting)
      for (const track of board.tracks) {
        const role = casting[track.id],
          actor = this.actors.get(role);
        if (actor) {
          this.roleTracks.set(role, track);
          this.rig(actor).prepare(track);
        }
      }
    for (const [role, actor] of this.actors)
      actor.enabled =
        visible &&
        !!board &&
        !!casting &&
        board.tracks.some((track) => casting[track.id] === role);
    const ruby = this.ruby;
    if (ruby) ruby.enabled = visible;
    if (board) {
      this.renderWalls(board);
      const aperture = board.room.mirror?.aperture;
      // Aperture rendering is silent; accepted explicit author events own foley.
      this.aperture = aperture;
      const exhibit = board.room.exhibit.position;
      const display = this.fixedProp("DisplayCase", this.theatre);
      if (display) {
        display.enabled = this.hasExhibit(board);
        if (display.enabled)
          this.point(display, [exhibit.x * 100, 0, exhibit.z * 100]);
      }
      this.renderCameras(board);
      const mirror = board.room.mirror;
      for (const name of ["MirrorHousing", "Curtain", "CurtainHandle"]) {
        const object = this.fixedProp(name, this.theatre);
        if (object) object.enabled = !!mirror;
      }
      if (mirror) {
        const yaw = Math.atan2(-mirror.normal.x, -mirror.normal.z);
        const physicalCurtain = mirrorCurtainPlacement(mirror);
        for (const name of ["MirrorHousing", "Curtain"]) {
          const object = this.fixedProp(name, this.theatre);
          if (!object) continue;
          this.point(object, name === "Curtain" ? physicalCurtain.rootStoryCm : [mirror.origin.x * 100, mirror.origin.y * 100 - mirror.height * 60, mirror.origin.z * 100]);
          object
            .getTransform()
            .setLocalRotation(quat.fromEulerAngles(0, yaw, 0));
          object
            .getTransform()
            .setLocalScale(
              new vec3(mirror.width * 100, mirror.height * 60, 100),
            );
          object.enabled = true;
        }
        const curtain = this.fixedProp("Curtain", this.theatre),
          visual = curtainVisual(mirror.aperture);
        if (curtain)
          for (let i = 0; i < 12; i++)
            for (const prefix of ["Fold_", "Ring_"]) {
              const node = this.fixedProp(
                prefix + ("0" + i).slice(-2),
                curtain,
              );
              if (!node) continue;
              const transform = node.getTransform(),
                p = transform.getLocalPosition();
              const physical = physicalCurtain.folds[i];
              const position = prefix === "Fold_" ? physical.foldPosition : physical.ringPosition;
              transform.setLocalPosition(new vec3(position[0], p.y, position[2]));
              if (prefix === "Fold_") transform.setLocalScale(new vec3(...physical.foldScale));
            }
        const handle = curtain && this.fixedProp("Handle", curtain);
        if (handle) {
          const p = handle.getTransform().getLocalPosition();
          handle
            .getTransform()
            .setLocalPosition(new vec3(physicalCurtain.handleLocal[0], p.y, p.z));
          const target = this.fixedProp("CurtainHandle", this.theatre);
          if (target)
            target
              .getTransform()
              .setWorldPosition(handle.getTransform().getWorldPosition());
        }
      }
    }
    this.poseCache = {
      board,
      history,
      publicRoutes,
      visible,
      publicPlaying: snapshot.detective?.playing ?? false,
      authorCasting,
    };
    if (visible && board && history) this.drawHistoryPose(board, history, tick);
    else if (visible && board && authorCasting)
      this.drawStagingPose(board, authorCasting, tick);
    const frame = snapshot.detective?.frame;
    const publicFrame = frame?.kind === "Frame" ? frame : undefined;
    if (!history && board && publicRoutes)
      this.drawPublicCradle(board, tick, snapshot.detective?.playing ?? false);
    else this.cradle.suspend();
    const key =
      board && publicFrame && !this.lidClosed
        ? board.caseId + ":" + board.rev + ":" + publicFrame.id
        : "";
    if (key !== this.frameKey) {
      this.frameKey = key;
      this.frameId = key ? publicFrame?.id : undefined;
      this.revision = key && board ? board.rev : undefined;
      this.glass.clear();
      this.entryGlass?.clear();
      if (key && board) {
        this.glass.render(board, publicFrame, true);
        this.entryGlass?.render(board, publicFrame, true);
      }
    }
    const focused = snapshot.detective?.focusedObservation;
    this.glass.selectObservation(focused?.id);
    this.entryGlass?.selectObservation(focused?.id);
    const detective = snapshot.detective;
    const canCompare =
      !this.lidClosed &&
      !reveal &&
      (snapshot.flow.mode === "detective" || snapshot.flow.mode === "finished");
    this.comparisonActive = this.hall.sync(
      board,
      canCompare ? detective?.comparison : undefined,
      detective
        ? {
            // Keep the same fractional playback phase when changing only the
            // visible approved version between authoritative integer ticks.
            tick: comparisonPoseTick(tick,detective.playing,board,previousComparison),
            witnessId: detective.source,
            selectedIds: detective.glass.map((item) => item.id),
            versionIndex: this.casePresentation?.versionIndex ?? 0,
            verdictKey: detective.verdict?.scope,
          }
        : undefined,
    );
    if (this.comparisonActive) {
      for (const actor of this.actors.values()) actor.enabled = false;
      if (ruby) ruby.enabled = false;
      this.renderPublicRoutes(board, tick, false);
    }
    this.applyLidPose();
    this.comparisonRoot = this.comparisonActive
      ? this.find("ComparisonWorkbench", this.root)
      : undefined;
    this.applyCoverState();
  }
  applyCaseView(presentation: CaseViewPresentation | undefined): void {
    this.casePresentation = presentation;
    const transform = this.theatre.getTransform();
    this.hall.applyCaseView(
      presentation?.comparison ? presentation : undefined,
    );
    if(presentation?.comparison && this.hall.snapshot()?.versionIndex !== (presentation.versionIndex??0))
      this.hall.setVersion(presentation.versionIndex??0);
    if (!presentation) {
      transform.setLocalPosition(this.museumTransform.position);
      transform.setLocalRotation(this.museumTransform.rotation);
      transform.setLocalScale(this.museumTransform.scale);
    } else {
      const placement = presentation.placement,
        rotation = quat.fromEulerAngles(0, placement.yawRad, 0),
        offset = rotation.multiplyVec3(
          new vec3(350 * placement.scale, 0, 250 * placement.scale),
        );
      transform.setWorldPosition(
        new vec3(
          placement.originCm[0] + offset.x,
          placement.originCm[1] + offset.y,
          placement.originCm[2] + offset.z,
        ),
      );
      transform.setWorldRotation(rotation);
      transform.setWorldScale(
        new vec3(
          placement.scale / 0.06,
          placement.scale / 0.06,
          placement.scale / 0.06,
        ),
      );
    }
    this.applyCoverState();
  }
  setCaseViewCovered(covered: boolean): void {
    this.covered = covered;
    this.applyCoverState();
  }
  setCaseViewSecondaryLabelsVisible(visible: boolean): void {
    this.labelsVisible = visible;
    const visit = (node: SceneObject): void => {
      if (node.name === "SecondaryCaseInscription") node.enabled = visible;
      for (let i = 0; i < node.getChildrenCount(); i++) visit(node.getChild(i));
    };
    visit(this.root);
    this.applyCoverState();
  }
  private applyCoverState(): void {
    this.theatre.enabled =
      !this.covered &&
      !(this.comparisonActive && this.casePresentation?.comparison);
    if (this.comparisonRoot) this.comparisonRoot.enabled = !this.covered;
  }
  readCaseViewViewer(): CaseViewViewer {
    if (!this.viewer) {
      const find = (object: SceneObject): SceneObject | undefined => {
        if (object.enabled && object.getComponent("Component.Camera"))
          return object;
        for (let i = 0; i < object.getChildrenCount(); i++) {
          const result = find(object.getChild(i));
          if (result) return result;
        }
        return undefined;
      };
      for (
        let i = 0;
        i < global.scene.getRootObjectsCount() && !this.viewer;
        i++
      )
        this.viewer = find(global.scene.getRootObject(i));
    }
    if (!this.viewer) return { eyeCm: [NaN, NaN, NaN], forward: [0, 0, 0] };
    const transform = this.viewer.getTransform(),
      eye = transform.getWorldPosition(),
      forward = transform.forward;
    return {
      eyeCm: [eye.x, eye.y, eye.z],
      forward: [-forward.x, -forward.y, -forward.z],
    };
  }
  read() {
    return {
      frameObservedRoles:
        this.entryGlass?.renderedRoles ?? this.glass.renderedRoles,
      comparison: this.hall.read(),
      paper: this.paper.read(),
      publicCradle: this.cradle.read(),
      authorRecording: this.authorGlass.read(),
      nativeMirror: this.liveFinish.snapshotMetrics(),
      articulationBindings: {
        named: Object.fromEntries(this.digitBindings),
        anonymousTemplate: this.anonymousTemplateDigits,
      },
      recordingPanes: {
        entry: this.entryGlass?.surfaces ?? [],
        workshop: this.glass.surfaces,
      },
      frameRevision: this.revision,
      frameId: this.frameId,
    };
  }
  clear(): void {
    for (const rig of this.rigs.values()) rig.clearRoute();
    this.roleTracks.clear();
    this.lastPoseTick = undefined;
    if (this.disposed) return;
    this.comparisonRoot = undefined;
    this.hall.exit();
    this.authorGlass.clear();
    this.benchCaseParked = false;
    this.applyLidPose();
    this.viewHandles.setQualification(undefined);
    this.paper.clear();
    this.caseTitleInk.clear();
    this.arrivalFile.clear();
    this.viewHandles.clear();
    this.comparisonActive = false;
    this.poseCache = undefined;
    this.facetFinish.clear();
    this.finishMirrorMode='public';
    this.liveFinish.clear();
    this.cradle.clear();
    this.covered = false;
    this.labelsVisible = true;
    this.applyCaseView(undefined);
    for (const actor of this.anonymous.values()) actor.enabled = false;
    for (const actor of this.actors.values()) actor.enabled = false;
    const ruby = this.ruby;
    if (ruby) ruby.enabled = false;
    this.glass.clear();
    this.entryGlass?.clear();
    this.frameKey = "";
    this.frameId = undefined;
    this.revision = undefined;
    this.aperture = undefined;
    for (const audio of this.audio.values()) audio.stop(false);
  }
  setLid(closed: boolean): void {
    const changed = closed !== this.lidClosed;
    this.lidClosed = closed;
    this.applyLidPose();
    if (this.lid) this.lid.enabled = true;
    if (closed) this.clear();
    // Passive lid/reset changes stay silent.
    this.initializedLid = true;
  }
  dispose(): void {
    if (this.disposed) return;
    this.clear();
    this.facetFinish.dispose();
    this.liveFinish.dispose();
    this.hall.dispose();
    this.authorGlass.dispose();
    for (const camera of this.cameraCopies.values()) camera.destroy();
    this.cameraCopies.clear();
    this.paper.dispose();
    this.caseTitleInk.dispose();
    this.arrivalFile.dispose();
    this.benchCameos.dispose();
    this.viewHandles.dispose();
    this.glass.dispose();
    this.entryGlass?.dispose();
    this.entryGlass?.view().root.destroy();
    this.glassRoot.destroy();
    for (const hand of this.clockHands) hand.getParent().destroy();
    this.clockHands = [];
    for (const wall of this.walls) wall.destroy();
    this.walls = [];
    for (const rig of this.rigs.values()) rig.dispose();
    this.rigs.clear();
    for (const actor of this.anonymous.values()) actor.destroy();
    this.anonymous.clear();
    if (this.lid?.name === "MuseumCaseLid") this.lid.destroy();
    for (const audio of this.audio.values()) audio.destroy();
    this.audio.clear();
    this.disposed = true;
  }
  cancelInput(): void {
    for (const audio of this.audio.values()) audio.stop(false);
  }
}
