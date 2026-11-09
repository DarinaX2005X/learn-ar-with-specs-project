# Animated SVG banner and stack pills for the README. Text is converted to outlines so GitHub shows the real fonts.
import math
from fontTools.ttLib import TTFont
from fontTools.varLib.instancer import instantiateVariableFont
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen

F = __import__('os').path.join(__import__('os').path.dirname(__file__), '..', 'fonts') + '/'
_cache = {}


def font(name, **axes):
    k = (name, tuple(sorted(axes.items())))
    if k not in _cache:
        _cache[k] = instantiateVariableFont(TTFont(F + name), axes)
    return _cache[k]


def text_path(f, s, x, y, size, track=0.0):
    gs = f.getGlyphSet(); cmap = f.getBestCmap(); upm = f['head'].unitsPerEm; sc = size / upm
    pen = SVGPathPen(gs); cx = x
    for ch in s:
        g = cmap.get(ord(ch))
        if g is None:
            cx += size * .3; continue
        gs[g].draw(TransformPen(pen, (sc, 0, 0, -sc, cx, y)))
        cx += gs[g].width * sc + track * size
    return pen.getCommands(), cx - x


def BRI(w): return font('BricolageGrotesque.ttf', wght=w, opsz=96, wdth=100)
def INT(w): return font('Inter.ttf', wght=w, opsz=14)


# ---------- banner ----------
W, H = 1600, 560
S = 0.74
OX, OY = 1150, 330
ZF, WH = 360, 220  # floor depth toward the viewer, wall height


def iso(x, y, z):
    # oblique view into the room: the window wall at z = 0 faces us, z grows toward the viewer
    return (OX + (x - 0.62 * z) * S, OY - (y - 0.5 * z) * S)


def clip(poly, f):
    out = []
    for i in range(len(poly)):
        a, b = poly[i], poly[(i + 1) % len(poly)]; fa, fb = f(a), f(b)
        if fa >= 0: out.append(a)
        if (fa >= 0) != (fb >= 0):
            u = fa / (fa - fb); out.append(tuple(a[k] + (b[k] - a[k]) * u for k in range(3)))
    return out


x0, x1, y0, y1 = -60, 120, 40, 190  # window on the back wall z = 0
xm, ym, g = (x0 + x1) / 2, (y0 + y1) / 2, 5
panes = []
for (a, b) in [((x0, xm - g), (y0, ym - g)), ((xm + g, x1), (y0, ym - g)), ((x0, xm - g), (ym + g, y1)), ((xm + g, x1), (ym + g, y1))]:
    panes.append([(a[0], b[0], 0), (a[1], b[0], 0), (a[1], b[1], 0), (a[0], b[1], 0)])

N = 40
floor_frames, wall_frames, sun_pts = [], [], []
for i in range(N + 1):
    k = i / N
    ang = -0.8 + 1.6 * k; el = 0.32 + 0.22 * math.sin(math.pi * k)
    d = (-math.sin(ang) * math.cos(el), -math.sin(el), math.cos(ang) * math.cos(el))
    fl, wl = [], []
    for p in panes:
        hit = [(c[0] + d[0] * (-c[1] / d[1]), 0, c[2] + d[2] * (-c[1] / d[1])) for c in p]
        f = clip(clip(clip(hit, lambda q: q[0] + 300), lambda q: 340 - q[0]), lambda q: ZF - q[2])
        fl.append(f)
        wh = []
        for c in p:
            if d[0] < -1e-6:
                t = (-300 - c[0]) / d[0]; wh.append((-300, c[1] + d[1] * t, c[2] + d[2] * t))
            else:
                wh.append((-300, -999, 0))
        wl.append(clip(clip(clip(wh, lambda q: q[1]), lambda q: ZF - q[2]), lambda q: WH - q[1]))
    floor_frames.append(fl); wall_frames.append(wl)
    sun_pts.append((OX + 30 + math.sin(ang) * 520, 190 - 150 * math.sin(math.pi * k)))


def pts(poly, keep=6):
    P = [iso(*q) for q in poly] or [iso(-300, 0, ZF)] * keep
    while len(P) < keep: P.append(P[-1])
    return ' '.join(f'{x:.1f},{y:.1f}' for x, y in P[:keep])


DUR = 18


def anim_poly(frames, idx):
    vals = ';'.join(pts(fr[idx]) for fr in frames + frames[-2::-1])
    return f'<animate attributeName="points" dur="{DUR}s" repeatCount="indefinite" values="{vals}"/>'


def ps(poly): return ' '.join(f'{x:.1f},{y:.1f}' for x, y in (iso(*q) for q in poly))


svg = [f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W} {H}" width="{W}" height="{H}">',
       '<defs><radialGradient id="g" cx="40%" cy="38%" r="60%"><stop offset="0" stop-color="#fff7e6"/><stop offset=".45" stop-color="#ffd88f"/><stop offset="1" stop-color="#f6a43c"/></radialGradient>',
       '<radialGradient id="h"><stop offset="0" stop-color="#ffb450" stop-opacity=".55"/><stop offset="1" stop-color="#ffb450" stop-opacity="0"/></radialGradient>',
       '<linearGradient id="bg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#f2e9de"/><stop offset="1" stop-color="#e8dac7"/></linearGradient>',
       f'<clipPath id="c"><rect width="{W}" height="{H}" rx="28"/></clipPath></defs>',
       f'<g clip-path="url(#c)"><rect width="{W}" height="{H}" fill="url(#bg)"/>']
arc = 'M' + ' L'.join(f'{x:.1f},{y:.1f}' for x, y in sun_pts)
svg.append(f'<path d="{arc}" fill="none" stroke="#e9a050" stroke-width="4" stroke-linecap="round" stroke-dasharray="2 12"/>')
svg.append(f'<polygon points="{ps([(-300, 0, 0), (340, 0, 0), (340, 0, ZF), (-300, 0, ZF)])}" fill="#dccdb8"/>')
svg.append(f'<polygon points="{ps([(-300, 0, 0), (-300, 0, ZF), (-300, WH, ZF), (-300, WH, 0)])}" fill="#cfbea6"/>')
svg.append(f'<polygon points="{ps([(-300, 0, 0), (340, 0, 0), (340, WH, 0), (-300, WH, 0)])}" fill="#e9ddcc"/>')
svg.append(f'<polygon points="{ps([(x0, y0, 0), (x1, y0, 0), (x1, y1, 0), (x0, y1, 0)])}" fill="#fff4e0" stroke="#2a211b" stroke-width="4" stroke-linejoin="round"/>')
svg.append(f'<polyline points="{ps([(xm, y0, 0), (xm, y1, 0)])}" stroke="#2a211b" stroke-width="4"/><polyline points="{ps([(x0, ym, 0), (x1, ym, 0)])}" stroke="#2a211b" stroke-width="4"/>')
for i in range(4):
    svg.append(f'<polygon fill="#ffbf66" fill-opacity=".92" points="{pts(floor_frames[0][i])}">{anim_poly(floor_frames, i)}</polygon>')
    svg.append(f'<polygon fill="#ffaa48" fill-opacity=".92" points="{pts(wall_frames[0][i])}">{anim_poly(wall_frames, i)}</polygon>')
sv = ';'.join(f'{x:.1f},{y:.1f}' for x, y in sun_pts + sun_pts[-2::-1])
svg.append(f'<g><circle r="70" fill="url(#h)"/><circle r="30" fill="url(#g)"/><animateTransform attributeName="transform" type="translate" dur="{DUR}s" repeatCount="indefinite" values="{sv}"/></g>')

d, _ = text_path(BRI(800), 'Sunfall', 84, 232, 168, -0.03)
svg.append(f'<path d="{d}" fill="#2a211b"/>')
l1, _ = text_path(BRI(650), 'Where will the', 90, 330, 50)
_, wl = text_path(BRI(650), 'Where will the ', 90, 330, 50)
sx = 90 + wl
sd, sw = text_path(BRI(650), 'sun', sx + 9, 330, 50)
svg.append(f'<path d="{l1}" fill="#2a211b"/>')
svg.append(f'<rect x="{sx - 1:.1f}" y="287" width="{sw + 20:.1f}" height="58" rx="13" fill="#f39431"/><path d="{sd}" fill="#fbf2e4"/>')
l2, _ = text_path(BRI(650), 'land in your room', 90, 394, 50)
svg.append(f'<path d="{l2}" fill="#2a211b"/>')
sm, _ = text_path(INT(500), 'A lens for Snap Specs, built in Lens Studio', 92, 466, 24)
svg.append(f'<path d="{sm}" fill="#6b5d51"/>')
svg.append('</g></svg>')
open('out/banner.svg', 'w', encoding='utf-8').write('\n'.join(svg))

# ---------- stack pills ----------
items = [('Lens Studio 5.23', '#2a211b', '#fbf2e4'), ('Snap Specs', '#2a211b', '#fbf2e4'), ('Spectacles Interaction Kit', '#2a211b', '#fbf2e4'),
         ('TypeScript', '#e6d9c7', '#2a211b'), ('NOAA solar ephemeris', '#ffd9a6', '#2a211b'), ('Lens Studio MCP', '#e6d9c7', '#2a211b'),
         ('Claude Code', '#e6d9c7', '#2a211b'), ('Python, Playwright, ffmpeg', '#e6d9c7', '#2a211b')]
x, y, out = 0, 0, []
H2, size, pad, gap = 48, 21, 22, 12
f = INT(600)
for name, bg, fg in items:
    _, tw = text_path(f, name, 0, 0, size)
    wpx = tw + pad * 2
    if x + wpx > 1000:
        x = 0; y += H2 + gap
    dp, _ = text_path(f, name, x + pad, y + 31, size)
    out.append(f'<rect x="{x:.1f}" y="{y}" width="{wpx:.1f}" height="{H2}" rx="24" fill="{bg}"/><path d="{dp}" fill="{fg}"/>')
    x += wpx + gap
open('out/stack.svg', 'w', encoding='utf-8').write(f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 {y + H2}" width="1000" height="{y + H2}">' + ''.join(out) + '</svg>')
print('ok')
