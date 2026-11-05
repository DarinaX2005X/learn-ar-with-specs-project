import { MuseumFeedback, MuseumAction } from './MuseumEffects';

export interface PublicMechanisms {
  identity: string;
  playing: boolean;
  pins: string;
  page: number;
  completed: boolean;
  checking?: boolean;
  aperture?: number;
}
export interface FoleyVoice {
  play(clip: string, action: MuseumAction, volume: number): void;
  stop(): void;
}
const lengths: Record<MuseumAction, number> = {pin:.08,clock:.08,paper:.32,glass:.48,cloth:.44,latch:.34,stamp:.29};

/** Accepts public before/after mechanism state, never histories or timeline samples. */
export class NativeMuseumFoley {
  private feedback = new MuseumFeedback();
  private until = [0, 0];
  private serial = 0;
  private muted = false;
  private identity = '';
  private gestureAperture: number | undefined;
  constructor(private voices: readonly [FoleyVoice, FoleyVoice], private now: () => number) {}
  cancel(): void { this.voices.forEach(v=>v.stop()); this.until=[0,0]; this.feedback.cancel(); this.gestureAperture=undefined; }
  setMuted(value: boolean): void { if(value!==this.muted) this.cancel(); this.muted=value; }
  observe(identity: string): void { if(identity!==this.identity) { this.cancel(); this.identity=identity; } }
  accepted(action: string, type: string, accepted: boolean, before: PublicMechanisms, after: PublicMechanisms): void {
    this.observe(after.identity);
    // Seeking/cancellation clears native voices even if a command was rejected.
    if(['seek','setTick','replay','cancelGesture','cancelTest'].includes(type)) { this.cancel(); return; }
    if(!accepted || before.identity!==after.identity) return;
    if(action==='author' && type==='beginGesture') this.gestureAperture=before.aperture;
    let cue: MuseumAction | undefined;
    if(action==='detective' && ['pin','pinClue','remove','undo'].includes(type) && before.pins!==after.pins) cue='pin';
    if(action==='detective' && type==='tabPage' && before.page!==after.page) cue='paper';
    if(['play','pause','freeze'].includes(type) && before.playing!==after.playing) cue='clock';
    if(action==='detective' && ['check','checkAll','finish'].includes(type) && ((!before.completed && after.completed) || (!before.checking && after.checking))) cue='stamp';
    const apertureBefore=type==='commitGesture' ? this.gestureAperture ?? before.aperture : before.aperture;
    if(action==='author' && ['edit','commitGesture'].includes(type) && apertureBefore!==after.aperture && apertureBefore!==undefined && after.aperture!==undefined) cue=after.aperture===0 || after.aperture===1 ? 'latch':'cloth';
    if(type==='commitGesture') this.gestureAperture=undefined;
    if(cue) this.emit(cue);
  }
  /** Only explicit visible user mechanisms may use this boundary. */
  explicit(action: 'cloth'|'latch', changed: boolean): void { if(changed) this.emit(action); }
  private emit(action: MuseumAction): void {
    const now=this.now();
    const plan=this.feedback.plan({id:'native:'+ ++this.serial, action,visible:true,userInitiated:true}, {now,revision:this.identity,enabled:true,muted:this.muted,seeking:false,reducedMotion:true});
    if(!plan?.sound) return;
    const slot=this.until.findIndex(t=>t<=now);
    if(slot<0) return;
    this.voices[slot].stop();
    this.voices[slot].play(plan.sound,action,plan.volume);
    this.until[slot]=now+lengths[action];
  }
}
