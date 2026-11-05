// Original local foley synthesis, no recordings or external samples.
const fs = require("fs");
const path = require("path");
// Set CLAD_SFX_ENGINE to the installed official build-sfx/tools directory.
if (!process.env.CLAD_SFX_ENGINE)
  throw new Error(
    "Set CLAD_SFX_ENGINE to the installed CLAD build-sfx/tools directory",
  );
const audio = require(path.resolve(process.env.CLAD_SFX_ENGINE));
// Explicit project ownership overrides skill's default GeneratedSFX directory.
const PROJECT_ASSETS_SFX = path.resolve(
  __dirname,
  "../../Assets/Audio/TableKit",
);
fs.mkdirSync(PROJECT_ASSETS_SFX, { recursive: true });
const recipes = {
  latch: () => audio.sfx_presets.uiClick({ character: "sharp", pitch: -6 }),
  engage: () => audio.sfx_presets.uiClick({ character: "soft", pitch: -10 }),
  cloth: () =>
    audio.granular.grainCloud({
      source: "pink",
      duration: 0.38,
      grainSizeMs: 18,
      density: 130,
      ampJitter: 0.6,
      filter: { type: "bp", freq: 2400, Q: 1.5 },
      panSpread: 0.2,
    }),
};
for (const [name, render] of Object.entries(recipes)) {
  let buf = audio.mix_bus.applyFx(render(), {
    hpf: 100,
    lpf: name === "cloth" ? 5800 : 7000,
    gain: 0.65,
  });
  audio.mix_bus.masterChain(buf, { normalize: "peak" });
  // Retain gentle mechanical level after normalized master; no clipped transients.
  if (buf.left) {
    for (const channel of [buf.left, buf.right]) {
      audio.fadeOut(channel, 0.008);
      for (let i = 0; i < channel.length; i++) channel[i] *= 0.35;
    }
  } else {
    audio.fadeOut(buf, 0.008);
    for (let i = 0; i < buf.length; i++) buf[i] *= 0.35;
  }
  const output = path.join(PROJECT_ASSETS_SFX, name + ".wav");
  audio.WavBuilder.write(buf, output);
  if (fs.statSync(output).size <= 44) throw new Error("WAV_MISSING " + output);
  console.log(name, fs.statSync(output).size);
}
