import { FoleyVoice } from './NativeMuseumFoley';
import { MuseumAction } from './MuseumEffects';

/** Two instances only. A component without a successful player must never stop(). */
export class LensFoleyVoice implements FoleyVoice {
  private audio: AudioComponent;
  private started = false;
  private disposed = false;
  constructor(private node: SceneObject, private clips: Record<string, AudioTrackAsset>, private anchor: (action: MuseumAction)=>SceneObject) {
    this.audio=node.createComponent('Component.AudioComponent');
    this.audio.spatialAudio.enabled=true;
  }
  private alive(): boolean {
    return !this.disposed && !isNull(this.node) && !isNull(this.audio)
      && !this.node.isBeingDestroyed && !this.audio.isBeingDestroyed;
  }
  private enabled(): boolean {
    return this.alive() && this.audio.enabled && this.node.isEnabledInHierarchy;
  }
  play(clip: string, action: MuseumAction, volume: number): void {
    const track=this.clips[clip];
    if(!track || isNull(track) || !this.enabled()) return;
    const anchor=this.anchor(action);
    if(isNull(anchor) || !anchor.isEnabledInHierarchy) return;
    this.stop();
    this.node.getTransform().setWorldPosition(anchor.getTransform().getWorldPosition());
    this.audio.audioTrack=track;
    this.audio.volume=volume;
    // Errors from genuine playback deliberately propagate. No false started latch.
    this.audio.play(1);
    this.started=true;
  }
  stop(): void {
    if(!this.started) return;
    this.started=false;
    if(!this.enabled() || isNull(this.audio.audioTrack)) return;
    // Natural completion is not an active player; a second stop must be a no-op.
    if(this.audio.isPlaying() || this.audio.isPaused()) this.audio.stop(false);
  }
  dispose(): void {
    if(this.disposed) return;
    this.stop();
    this.disposed=true;
    if(!isNull(this.audio) && !this.audio.isBeingDestroyed) this.audio.destroy();
    if(!isNull(this.node) && !this.node.isBeingDestroyed) this.node.destroy();
  }
}
