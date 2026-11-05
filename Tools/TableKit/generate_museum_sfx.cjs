// Original museum foley. No samples, music, UI chimes or hidden actor cues.
// Run: CLAD_SFX_ENGINE=<official build-sfx/tools> node generate_museum_sfx.cjs <absolute output directory>
const fs = require('fs');
const path = require('path');
if (!process.env.CLAD_SFX_ENGINE) throw new Error('Set CLAD_SFX_ENGINE to official build-sfx/tools');
const audio = require(path.resolve(process.env.CLAD_SFX_ENGINE));
const output = path.resolve(process.argv[2] || path.join(__dirname, '../../Assets/Audio/TableKit'));
fs.mkdirSync(output, { recursive: true });
const p = audio.sfx_presets;

function mono(buffer) {
  if (!buffer.left) return buffer;
  const result = new Float32Array(Math.max(buffer.left.length, buffer.right.length));
  for (let i = 0; i < result.length; i++) result[i] = ((buffer.left[i] || 0) + (buffer.right[i] || 0)) * .5;
  return result;
}
function combine(parts, duration) {
  const result = new Float32Array(Math.ceil(duration * audio.SAMPLE_RATE));
  for (const [buffer, delay, gain] of parts) audio.addInto(result, mono(buffer), Math.floor(delay * audio.SAMPLE_RATE), gain);
  return result;
}
function paper() {
  // Two short granular friction strokes with a soft board landing, not a whoosh.
  const friction = audio.granular.grainCloud({source:'pink',duration:.24,grainSizeMs:11,density:95,ampJitter:.65,panSpread:0,filter:{type:'bp',freq:3100,Q:.7}});
  return combine([[friction,0,.65],[p.impact({material:'soft',size:.12}),.115,.12]],.32);
}
function cloth() {
  const friction = audio.granular.grainCloud({source:'pink',duration:.36,grainSizeMs:22,density:120,ampJitter:.45,panSpread:0,filter:{type:'bp',freq:1650,Q:.8}});
  return combine([[friction,0,.7],[p.impact({material:'wood',size:.1}),.24,.055]],.44);
}
function glassTap() {
  // The glass impact preset includes breaking shards. A finger tap needs only
  // a felt transient and three quiet inharmonic vessel modes, no debris or chime.
  const result = new Float32Array(Math.ceil(.28 * audio.SAMPLE_RATE));
  const transient = audio.whiteNoise(.006, .25);
  audio.bandPass(transient, 2700, .7);
  audio.adsrExp(transient, .0008, .0015, 0, .0037, 3);
  audio.addInto(result, transient, 0, .7);
  for (const [frequency, gain, decay] of [[1780,.16,23],[4130,.045,31],[6870,.012,42]]) {
    const mode = audio.sine(frequency*(.985+Math.random()*.03), .28);
    for (let i=0;i<mode.length;i++) mode[i] *= gain*Math.exp(-decay*i/audio.SAMPLE_RATE)*(1-Math.exp(-1800*i/audio.SAMPLE_RATE));
    audio.addInto(result, mode, 0, 1);
  }
  return result;
}
const recipes = {
  museum_pin_01: [() => p.uiClick({character:'soft',pitch:-9}), .20, 4300],
  museum_pin_02: [() => p.uiClick({character:'soft',pitch:-8}), .20, 4300],
  museum_clock_01: [() => p.uiClick({character:'sharp',pitch:-13}), .12, 3200],
  museum_clock_02: [() => p.uiClick({character:'sharp',pitch:-11}), .12, 3200],
  museum_paper_01: [paper, .23, 6000],
  museum_paper_02: [paper, .23, 6000],
  museum_cloth: [cloth, .22, 4500],
  museum_latch: [() => combine([[p.impact({material:'wood',size:.17}),0,.60],[p.uiClick({character:'sharp',pitch:-7}),.022,.32]],.34), .28, 5000],
  museum_stamp: [() => combine([[p.impact({material:'soft',size:.3}),0,.64],[p.impact({material:'wood',size:.15}),.014,.26]],.29), .26, 3200],
  museum_glass: [glassTap, .17, 6500],
};
const only = process.argv[3];
const manifestPath = path.join(output,'museum-audio-manifest.json');
const records = only && fs.existsSync(manifestPath) ? JSON.parse(fs.readFileSync(manifestPath,'utf8')).resources.filter(record => record.name!==only) : [];
for (const [name, [render, level, lowpass]] of Object.entries(recipes)) {
  if (only && name !== only) continue;
  let buffer = mono(audio.mix_bus.applyFx(render(), {hpf:140,lpf:lowpass,gain:.7}));
  audio.mix_bus.masterChain(buffer, {normalize:'peak'});
  if (name === "museum_glass") buffer = buffer.slice(0, Math.floor(.28 * audio.SAMPLE_RATE));
  audio.removeDC(buffer);
  audio.fadeOut(buffer, name === "museum_glass" ? .06 : .012);
  let peak=0;
  for (const x of buffer) peak=Math.max(peak,Math.abs(x));
  const gain=level/Math.max(peak,1e-8);
  for(let i=0;i<buffer.length;i++) buffer[i]*=gain;
  const filename=path.join(output,name+'.wav');
  audio.WavBuilder.write(buffer,filename);
  if(fs.statSync(filename).size<=44) throw new Error('WAV_MISSING '+filename);
  records.push({name,bytes:fs.statSync(filename).size,duration:buffer.length/audio.SAMPLE_RATE,peak:level,channels:1,sampleRate:audio.SAMPLE_RATE});
}
fs.writeFileSync(path.join(output,'museum-audio-manifest.json'),JSON.stringify({provenance:'Original local algorithmic foley, official CLAD build-sfx engine; no recordings',triggerPolicy:'Explicit visible player mechanisms only; no actor/role/pickup timeline sounds',resources:records},null,2));
console.log(JSON.stringify(records,null,2));
