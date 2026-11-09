# Original score and sound design for the Sunfall film, synthesized in numpy.
# usage: python audio.py events.json out.wav
import json, sys, math
import numpy as np
from scipy.signal import butter, sosfilt, fftconvolve

SR = 48000
BPM = 96.0
BEAT = 60.0 / BPM
DUR = 77.0
rng = np.random.default_rng(11)

def n(sec): return int(round(sec * SR))
def env_adsr(length, a, d, s, r, sustain_len=None):
    L = n(length); e = np.zeros(L)
    A, D, R = n(a), n(d), n(r)
    S = max(0, L - A - D - R)
    i = 0
    e[i:i + A] = np.linspace(0, 1, A, endpoint=False); i += A
    e[i:i + D] = np.linspace(1, s, D, endpoint=False); i += D
    e[i:i + S] = s; i += S
    e[i:i + R] = np.linspace(s, 0, min(R, L - i)); return e
def lp(x, f, order=2):
    sos = butter(order, min(f, SR / 2 - 100), 'low', fs=SR, output='sos'); return sosfilt(sos, x)
def hp(x, f, order=2):
    sos = butter(order, f, 'high', fs=SR, output='sos'); return sosfilt(sos, x)
def bp(x, lo, hi, order=2):
    sos = butter(order, [lo, hi], 'band', fs=SR, output='sos'); return sosfilt(sos, x)
def midi(m): return 440.0 * 2 ** ((m - 69) / 12)
def saw(f, L, detune=0.0):
    t = np.arange(L) / SR; out = np.zeros(L)
    for d in (-detune, 0, detune):
        ph = (t * f * (1 + d)) % 1.0; out += 2 * ph - 1
    return out / 3
def sine(f, L, phase=0.0):
    t = np.arange(L) / SR; return np.sin(2 * np.pi * f * t + phase)

master = np.zeros((n(DUR) + SR * 3, 2))
def place(sig, t, gain=1.0, pan=0.0):
    i = n(t)
    if sig.ndim == 1:
        l = sig * gain * math.cos((pan + 1) * math.pi / 4); r = sig * gain * math.sin((pan + 1) * math.pi / 4)
        sig2 = np.stack([l, r], 1)
    else: sig2 = sig * gain
    if i < 0: sig2 = sig2[-i:]; i = 0
    e = min(len(master), i + len(sig2)); master[i:e] += sig2[:e - i]

# ---------- sections ----------
SEC = [  # (start, end, name), matches T in film.html
    (0, 9, 'journey'), (9, 13, 'title'), (13, 18.5, 'who'), (18.5, 32, 'journey'), (32, 43, 'day'),
    (43, 51, 'seasons'), (51, 62.5, 'how'), (62.5, 67, 'add'), (67, 72, 'measure'), (72, 77, 'end')]
# chord progression in D major: D  Bm  G  A   (warm, simple)
PROG = [[50, 54, 57, 62], [47, 50, 54, 59], [43, 47, 50, 55], [45, 49, 52, 57]]
BAR = BEAT * 4

def pad_chord(notes, L, bright=1800):
    out = np.zeros(L)
    for m in notes:
        out += saw(midi(m), L, 0.004) * 0.5 + sine(midi(m), L) * 0.5
    e = env_adsr(L / SR, 0.6, 0.4, 0.8, 0.9)
    return lp(out * e, bright) * 0.18

def kick(): L = n(0.45); t = np.arange(L) / SR; f = 50 + 90 * np.exp(-t * 30); ph = 2 * np.pi * np.cumsum(f) / SR; return np.sin(ph) * np.exp(-t * 7) * 0.9
def hat(o=False): L = n(0.25 if o else 0.06); x = rng.standard_normal(L); return hp(x, 7000) * np.exp(-np.arange(L) / SR * (12 if o else 60)) * 0.25
def snare(): L = n(0.3); t = np.arange(L) / SR; x = bp(rng.standard_normal(L), 1500, 6000) * np.exp(-t * 18); return x * 0.35 + sine(190, L) * np.exp(-t * 25) * 0.25
def pluck(m, dur=0.5, bright=3000):
    L = n(dur); t = np.arange(L) / SR
    x = saw(midi(m), L, 0.002) * 0.5 + sine(midi(m) * 2, L) * 0.2
    return lp(x * np.exp(-t * 6), bright) * 0.35
def bass(m, dur):
    L = n(dur); t = np.arange(L) / SR
    x = sine(midi(m), L) + 0.3 * saw(midi(m), L)
    return lp(x, 400) * env_adsr(dur, 0.01, 0.1, 0.8, 0.08) * 0.45

def section_of(t):
    for s, e, nm in SEC:
        if s <= t < e: return nm
    return 'end'

# ---- music layers bar by bar ----
t = 0.0; bar_i = 0
while t < DUR - 0.01:
    nm = section_of(t + 0.01)
    chord = PROG[bar_i % 4]
    L = n(BAR + 0.8)
    # pad everywhere, brighter in the drops, darker in the hook and the breakdown
    bright = {'hook': 900, 'title': 2600, 'who': 2000, 'journey': 2400, 'day': 3200, 'seasons': 700, 'how': 1800, 'add': 600, 'measure': 2400, 'end': 2800}[nm]
    place(pad_chord(chord, L, bright), t, 1.0 if nm not in ('add',) else 0.8)
    drums = nm in ('title', 'journey', 'day', 'measure', 'how')
    half = nm in ('who',)
    for b in range(4):
        bt = t + b * BEAT
        if bt >= DUR - 0.2: break
        if drums or half:
            if b % 2 == 0 or (drums and nm == 'day'): place(kick(), bt, 0.8 if not half else 0.55)
            if drums and b % 2 == 1: place(snare(), bt, 0.55 if nm != 'how' else 0.35)
            for h in range(2 if nm != 'day' else 4):
                place(hat(o=(h == 1 and nm == 'day')), bt + h * BEAT / (2 if nm != 'day' else 4), 0.6 + 0.2 * rng.random(), pan=0.3)
        if nm in ('title', 'journey', 'day', 'measure', 'end', 'who', 'how'):
            place(bass(chord[0] - 12, BEAT * 0.9), bt, 0.9 if b in (0, 2) else 0.6)
        # arpeggio motif: rising chord tones, the "sun" motif, opens up through the film
        if nm in ('hook', 'journey', 'day', 'end', 'measure', 'seasons'):
            steps = 2 if nm in ('hook', 'seasons') else 4
            for k in range(steps):
                m = chord[(b * steps + k) % 4] + 12 + (12 if (nm == 'day' and k % 2) else 0)
                place(pluck(m, 0.45, 2200 if nm == 'hook' else 3800), bt + k * BEAT / steps, 0.55 if nm != 'hook' else 0.4, pan=(-0.4 if k % 2 else 0.4))
    t += BAR; bar_i += 1

# ---------- sound design from picture events ----------
ev = json.load(open(sys.argv[1]))
def pop(var):
    L = n(0.12); t = np.arange(L) / SR
    f0 = 700 * (1 + 0.08 * (var - 0.5)); f = f0 * np.exp(-t * 14)
    ph = 2 * np.pi * np.cumsum(f) / SR
    return np.sin(ph) * np.exp(-t * 30) * 0.35 + bp(rng.standard_normal(L), 2000, 6000) * np.exp(-t * 200) * 0.08
def click():
    L = n(0.08); t = np.arange(L) / SR
    return bp(rng.standard_normal(L), 2500, 5000) * np.exp(-t * 120) * 0.4 + sine(160, L) * np.exp(-t * 40) * 0.3
def whoosh(length=0.6, rise=True):
    L = n(length); t = np.arange(L) / SR; x = rng.standard_normal(L)
    env = np.sin(np.pi * t / length) ** 2
    lo = np.linspace(300, 3000, L) if rise else np.linspace(3000, 300, L)
    out = np.zeros(L); step = 2400
    for i in range(0, L, step):
        seg_ = x[i:i + step]; f = lo[i]
        out[i:i + len(seg_)] = bp(seg_, max(80, f * 0.6), min(f * 1.6, 20000))
    return out * env * 0.5
def chime(m):
    L = n(1.6); t = np.arange(L) / SR; out = np.zeros(L)
    for k, (r, a) in enumerate([(1, 1), (2.76, .4), (5.4, .2), (8.9, .1)]):
        out += sine(midi(m) * r, L) * a * np.exp(-t * (3 + k * 2))
    return out * 0.18
def impact():
    L = n(1.4); t = np.arange(L) / SR; f = 55 * np.exp(-t * 1.5) + 30
    ph = 2 * np.pi * np.cumsum(f) / SR
    return np.sin(ph) * np.exp(-t * 3) * 0.8 + lp(rng.standard_normal(L), 3000) * np.exp(-t * 25) * 0.3
def riser(length):
    L = n(length); t = np.arange(L) / SR
    x = rng.standard_normal(L); out = np.zeros(L); step = 2400
    for i in range(0, L, step):
        f = 200 + 5000 * (i / L) ** 2
        out[i:i + step] = bp(x[i:i + step], f * 0.7, min(f * 1.4, 20000))
    return out * (t / length) ** 2 * 0.35

words = [e for e in ev if e['kind'] == 'word']
for i, e in enumerate(words):
    place(pop(rng.random()), e['t'] - 0.02, 0.6 + 0.25 * rng.random(), pan=(e['x'] - 0.5) * 1.2)
for e in ev:
    if e['kind'] == 'step': place(click(), e['t'], 0.8, pan=0.4)
    if e['kind'] == 'whip': place(whoosh(0.7), e['t'] - 0.35, 0.75, pan=float(rng.uniform(-0.3, 0.3)))
    if e['kind'] == 'action':
        place(click(), e['t'], 0.7, pan=0.2)
        if e['id'] in ('Amark2', 'Acard'): place(chime({'Amark2': 81, 'Acard': 78}[e['id']]), e['t'] + 0.3, 0.9)
place(impact(), 0.0, 0.45)
place(riser(1.6), 9.0 - 1.6, 0.8); place(impact(), 9.0, 0.8)
place(riser(2.0), 73.0 - 2.0, 0.8); place(impact(), 73.0, 1.0)
for tt, m in [(9.3, 74), (45.6, 81), (48.6, 74), (52.5, 81), (52.8, 74), (64.9, 78), (73.05, 74), (73.3, 81)]:
    place(chime(m), tt, 1.0)
# rolling numbers ticks under the degrees
for k in range(12): place(click(), 52.5 + k * 0.06, 0.25 + 0.02 * k, pan=0.5)

# ---------- reverb send and master ----------
ir_len = n(1.8); tt = np.arange(ir_len) / SR
ir = rng.standard_normal((ir_len, 2)) * np.exp(-tt * 3.2)[:, None] * 0.06
wet = np.stack([fftconvolve(master[:, c], ir[:, c])[:len(master)] for c in range(2)], 1)
mix = master * 0.85 + wet * 0.5
# fade the tail inside the film
end = n(DUR); fade = n(2.5)
mix[end - fade:end] *= np.linspace(1, 0, fade)[:, None]
mix = mix[:end]
mix /= max(1e-9, np.max(np.abs(mix))) / 0.8
import soundfile as sf
sf.write(sys.argv[2], mix.astype(np.float32), SR)
print('ok', mix.shape)
