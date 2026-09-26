# Original 120 BPM electronic launch track, synthesized from scratch (no samples, no copyright).
import numpy as np, wave
from scipy.signal import butter, sosfilt

SR = 44100; DUR = 57.5; BEAT = 0.5; BAR = 2.0
N = int(SR * DUR); t = np.arange(N) / SR
L = np.zeros(N); R = np.zeros(N)
rng = np.random.default_rng(7)

def lp(x, f, o=2): return sosfilt(butter(o, f, 'low', fs=SR, output='sos'), x)
def hp(x, f, o=2): return sosfilt(butter(o, f, 'high', fs=SR, output='sos'), x)
def bp(x, lo, hi): return sosfilt(butter(2, [lo, hi], 'band', fs=SR, output='sos'), x)
def saw(f, tt): return 2 * ((f * tt) % 1) - 1
def midi(m): return 440 * 2 ** ((m - 69) / 12)
def add(sig, start, gl=1.0, gr=None):
    i = int(start * SR); j = min(N, i + len(sig))
    if j <= i: return
    L[i:j] += sig[:j - i] * gl; R[i:j] += sig[:j - i] * (gl if gr is None else gr)
def env(n, a, d):  # attack/decay in seconds
    x = np.arange(n) / SR
    return np.minimum(1, x / max(a, 1e-4)) * np.exp(-x / d)

# sections: intro 0-8, drop 8-20, breakdown 20-28, drop 28-46.4, peak 46.4-51, outro 51-57.5
def active(sec, s, e): return s <= sec < e
chords = [[57, 60, 64], [53, 57, 60], [48, 52, 55], [55, 59, 62]]  # Am F C G
roots = [45, 41, 36, 43]

# sidechain envelope (ducks on every beat when the kick is playing)
kick_times = [b * BEAT for b in range(int(DUR / BEAT)) if active(b * BEAT, 8, 20) or active(b * BEAT, 28, 51)]
duck = np.ones(N)
for kt in kick_times:
    i = int(kt * SR); n = int(0.45 * SR); j = min(N, i + n)
    duck[i:j] = np.minimum(duck[i:j], 1 - 0.65 * np.exp(-np.arange(j - i) / SR / 0.09))

# pads: detuned supersaw per bar, swelling in the intro
pad = np.zeros(N)
for bar in range(int(DUR / BAR) + 1):
    s = bar * BAR; c = chords[bar % 4]
    n = int(BAR * SR) + int(0.3 * SR); tt = np.arange(n) / SR
    x = sum(saw(midi(m) * (1 + d), tt) for m in c for d in (-0.006, -0.002, 0.002, 0.006)) / 12
    e = np.minimum(1, tt / 0.25) * np.minimum(1, np.maximum(0, (BAR + 0.3 - tt) / 0.3))
    i = int(s * SR); j = min(N, i + n)
    if j > i: pad[i:j] += (x * e)[:j - i]
cut = np.interp(t, [0, 7.8, 8, 20, 22, 27.8, 28, 51, 57.5], [400, 2400, 4500, 4500, 1200, 3000, 5000, 5000, 900])
pad_f = np.zeros(N)
for a in range(0, N, SR // 4):  # piecewise-static filter sweep
    b = min(N, a + SR // 4); pad_f[a:b] = lp(pad[max(0, a - 2000):b], cut[a])[-(b - a):]
pad_gain = np.interp(t, [0, 7.5, 8, 51, 55, 57.5], [0.05, 0.5, 0.45, 0.45, 0.5, 0])
add(pad_f * pad_gain * duck * 0.55, 0, 1.0, 0.0); add(np.roll(pad_f * pad_gain * duck * 0.55, 600), 0, 0.0, 1.0)

# kick
kn = int(0.4 * SR); kt_ = np.arange(kn) / SR
kick = np.sin(2 * np.pi * np.cumsum(45 + 110 * np.exp(-kt_ / 0.03)) / SR) * np.exp(-kt_ / 0.16)
kick += 0.3 * rng.standard_normal(kn) * np.exp(-kt_ / 0.004)
for kt in kick_times: add(kick * 0.95, kt)

# clap on 2 & 4, hats on offbeats (hats also in late intro/breakdown)
cn = int(0.25 * SR)
clap = bp(rng.standard_normal(cn), 900, 3000) * env(cn, 0.001, 0.06) * 0.9
hn = int(0.06 * SR)
hat = hp(rng.standard_normal(hn), 7000) * env(hn, 0.0005, 0.018) * 0.35
for b in range(int(DUR / BEAT)):
    tb = b * BEAT
    if (active(tb, 8, 20) or active(tb, 28, 51)) and b % 2 == 1: add(clap, tb, 0.8, 1.0)
    if active(tb, 4, 51): add(hat, tb + BEAT / 2, 1.0, 0.7)
    if active(tb, 8, 51) and b % 2 == 0: add(hat * 0.5, tb + BEAT / 4, 0.6, 1.0)

# bass: 8th-note saw on the root, lowpassed, sidechained
bass = np.zeros(N)
for step in range(int(DUR / (BEAT / 2))):
    ts = step * BEAT / 2
    if not (active(ts, 8, 20) or active(ts, 28, 51)): continue
    r = roots[int(ts // BAR) % 4]; n = int(0.24 * SR); tt = np.arange(n) / SR
    oct_ = 12 if step % 4 == 3 else 0
    x = (saw(midi(r + oct_), tt) + 0.6 * np.sin(2 * np.pi * midi(r - 12) * tt)) * env(n, 0.003, 0.18)
    i = int(ts * SR); j = min(N, i + n); bass[i:j] += x[:j - i]
add(lp(bass, 700, 4) * duck * 0.55, 0)

# pluck arp: 16ths over chord tones, 2 octaves up
arp = np.zeros(N); pattern = [0, 1, 2, 1, 0, 2, 1, 2]
for step in range(int(DUR / (BEAT / 4))):
    ts = step * BEAT / 4
    if not (active(ts, 8, 51)): continue
    c = chords[int(ts // BAR) % 4]; m = c[pattern[step % 8]] + 12
    n = int(0.2 * SR); tt = np.arange(n) / SR
    x = (saw(midi(m), tt) * 0.6 + np.sin(2 * np.pi * midi(m + 12) * tt) * 0.4) * env(n, 0.001, 0.07)
    i = int(ts * SR); j = min(N, i + n); arp[i:j] += x[:j - i]
arp = lp(arp, 3800) * np.interp(t, [8, 20, 20.1, 28, 51], [0.22, 0.22, 0.3, 0.3, 0.22])
add(arp, 0, 1.0, 0.0); add(np.roll(arp, int(0.1875 * SR)) * 0.8 + arp * 0.3, 0, 0.3, 1.0)  # ping-pong-ish

# risers into drops, impacts on drops
def riser(dur):
    n = int(dur * SR); tt = np.arange(n) / SR
    noise = rng.standard_normal(n); out = np.zeros(n)
    for a in range(0, n, 2205):
        f = 300 + 7000 * (a / n) ** 2; b = min(n, a + 2205)
        out[a:b] = bp(noise[max(0, a - 2000):b], f, f * 1.6)[-(b - a):]
    sweep = np.sin(2 * np.pi * np.cumsum(200 + 1400 * (tt / dur) ** 2) / SR) * 0.15
    return (out * 0.5 + sweep) * (tt / dur) ** 2
def impact():
    n = int(2.5 * SR); tt = np.arange(n) / SR
    boom = np.sin(2 * np.pi * np.cumsum(30 + 90 * np.exp(-tt / 0.08)) / SR) * np.exp(-tt / 0.7)
    crash = hp(rng.standard_normal(n), 4000) * np.exp(-tt / 0.9) * 0.25
    return boom * 0.9 + crash
for start, dur in [(5.0, 3.0), (25.0, 3.0), (44.4, 2.0), (49.0, 2.0)]: add(riser(dur) * 0.55, start, 0.9, 1.0)
for at in [8.0, 28.0, 46.4, 51.0]: add(impact(), at)

# master: fade in/out, glue, soft clip
mix = np.stack([L, R])
mix *= np.interp(t, [0, 0.3, 55.5, 57.5], [0, 1, 1, 0])
mix /= np.max(np.abs(mix)) + 1e-9
mix = np.tanh(mix * 1.6) / np.tanh(1.6) * 0.92
pcm = (mix.T * 32767).astype(np.int16)
with wave.open('music.wav', 'wb') as w:
    w.setnchannels(2); w.setsampwidth(2); w.setframerate(SR); w.writeframes(pcm.tobytes())
print('ok', pcm.shape[0] / SR)
