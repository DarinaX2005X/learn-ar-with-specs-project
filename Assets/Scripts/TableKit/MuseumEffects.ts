/** Pure material and tactile timing contract. No actor, role or private history inputs. */
export type V3 = readonly [number, number, number];
export type MuseumAction = 'pin' | 'clock' | 'paper' | 'glass' | 'cloth' | 'latch' | 'stamp';
export interface EffectContext {
  /** Monotonic real seconds, never the reconstruction timeline. */
  now: number;
  revision: string;
  enabled: boolean;
  muted: boolean;
  seeking: boolean;
  reducedMotion: boolean;
}
export interface MechanismCue {
  id: string;
  action: MuseumAction;
  /** World receiver is an already-visible physical mechanism. */
  visible: boolean;
  userInitiated: boolean;
}
export interface CuePlan {
  sound: string | undefined;
  volume: number;
  duration: number;
  /** Local displacement in cm along the mechanism's real press axis. */
  travelCm: number;
}
const CLIPS: Record<MuseumAction, readonly string[]> = {
  pin: ['museum_pin_01', 'museum_pin_02'],
  clock: ['museum_clock_01', 'museum_clock_02'],
  paper: ['museum_paper_01', 'museum_paper_02'],
  glass: ['museum_glass'],
  cloth: ['museum_cloth'],
  latch: ['museum_latch'],
  stamp: ['museum_stamp'],
};
const TRAVEL: Record<MuseumAction, number> = {
  pin: .14, clock: 0, paper: 0, glass: 0, cloth: 0, latch: .06, stamp: .24,
};
const COOLDOWN: Record<MuseumAction, number> = {
  pin: .10, clock: .12, paper: .20, glass: .28, cloth: .30, latch: .20, stamp: .22,
};

/** Bounded explicit-event dedup. Cancel/revision/seek never replay queued sounds. */
export class MuseumFeedback {
  private revision: string | undefined;
  private seen = new Set<string>();
  private last = new Map<MuseumAction, number>();
  private variants = new Map<MuseumAction, number>();
  private voicesUntil: number[] = [];

  cancel(): void {
    this.last.clear();
    this.voicesUntil = [];
  }

  plan(cue: MechanismCue, context: EffectContext): CuePlan | undefined {
    if (this.revision !== context.revision) {
      this.cancel();
      this.seen.clear();
      this.revision = context.revision;
    }
    if (!Number.isFinite(context.now)) return undefined;
    // Consume IDs even when muted/seeking: turning sound on never replays an old event.
    if (this.seen.has(cue.id)) return undefined;
    this.seen.add(cue.id);
    if (this.seen.size > 128) this.seen.delete(this.seen.values().next().value as string);
    if (!context.enabled || context.seeking || !cue.visible || !cue.userInitiated) return undefined;
    if (context.now - (this.last.get(cue.action) ?? -Infinity) < COOLDOWN[cue.action]) return undefined;
    this.last.set(cue.action, context.now);
    const clips = CLIPS[cue.action];
    const index = this.variants.get(cue.action) ?? 0;
    this.variants.set(cue.action, index + 1);
    this.voicesUntil = this.voicesUntil.filter(until => until > context.now);
    const audible = !context.muted && this.voicesUntil.length < 2;
    if (audible) this.voicesUntil.push(context.now + ({pin:.08,clock:.08,paper:.32,glass:.48,cloth:.44,latch:.34,stamp:.29}[cue.action]));
    return {
      sound: audible ? clips[index % clips.length] : undefined,
      volume: cue.action === 'clock' ? .20 : .34,
      duration: cue.action === 'stamp' ? .17 : .13,
      travelCm: context.reducedMotion ? 0 : TRAVEL[cue.action],
    };
  }
}

/** No spring overshoot: press to contact once, then settle. Hitboxes stay fixed. */
export function contactTravel(plan: CuePlan, elapsed: number): number {
  if (!Number.isFinite(elapsed) || elapsed <= 0 || elapsed >= plan.duration) return 0;
  const phase = elapsed / plan.duration;
  return plan.travelCm * Math.pow(Math.sin(Math.PI * phase), 2);
}

function unit(v: V3): V3 | undefined {
  const length = Math.hypot(...v);
  return Number.isFinite(length) && length > 1e-8 ? [v[0]/length,v[1]/length,v[2]/length] : undefined;
}
function dot(a: V3, b: V3): number { return a[0]*b[0]+a[1]*b[1]+a[2]*b[2]; }

/** On the actual facet only: camera/light reflection; never time-pulsed or a billboard. */
export function rubyFacetReflection(input: {
  visible: boolean;
  facetWorldNormal: V3;
  towardEye: V3;
  towardLight: V3;
}): number {
  if (!input.visible) return 0;
  const n=unit(input.facetWorldNormal),v=unit(input.towardEye),l=unit(input.towardLight);
  if (!n || !v || !l || dot(n,v)<=0 || dot(n,l)<=0) return 0;
  const half=unit([v[0]+l[0],v[1]+l[1],v[2]+l[2]]);
  return half ? Math.pow(Math.max(0,dot(n,half)),48)*.55 : 0;
}

/** Real glass shell Fresnel fallback, no glow, no screen-space reflection pass. */
export function clocheEdgeOpacity(normal: V3, towardEye: V3): number {
  const n=unit(normal),v=unit(towardEye);
  if (!n || !v) return .045;
  return .035+.10*Math.pow(1-Math.abs(dot(n,v)),5);
}

/** A seated, visible gem may shade velvet; hidden/carried gems leave no tell. */
export function visibleGemContact(visible: boolean, seated: boolean): number {
  return visible && seated ? .20 : 0;
}

export const MUSEUM_MATERIAL_FINISH = {
  ruby: { roughness: .12, metallic: .08, reflectionMaximum: .55 },
  cloche: { faceOpacity: .035, grazingOpacity: .135, roughness: .10 },
  velvet: { roughness: .99, metallic: 0 },
  brass: { roughness: .31, metallic: .72 },
  wood: { roughness: .67, metallic: 0 },
} as const;
