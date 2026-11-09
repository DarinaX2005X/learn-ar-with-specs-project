# Python port of Assets/Sunfall/Solar.ts and the sun-hour test in Room.ts, used to draw README diagrams from real numbers.
import math, json
import numpy as np
RAD = math.pi / 180
LAT, LON = 40.7128, -74.006
def utc_off(d): return -4 if 67 <= d < 305 else -5
def sun_angles(day, minutes, year=2026):
    utc_min = minutes - utc_off(day) * 60
    import datetime
    ms = (datetime.datetime(year, 1, 1, tzinfo=datetime.timezone.utc).timestamp() * 1000) + (day - 1) * 86400000 + utc_min * 60000
    n = ms / 86400000 + 2440587.5 - 2451545.0
    L = (280.46 + 0.9856474 * n) % 360
    g = ((357.528 + 0.9856003 * n) % 360) * RAD
    lam = (L + 1.915 * math.sin(g) + 0.02 * math.sin(2 * g)) * RAD
    eps = (23.439 - 0.0000004 * n) * RAD
    ra = math.atan2(math.cos(eps) * math.sin(lam), math.cos(lam))
    dec = math.asin(math.sin(eps) * math.sin(lam))
    gmst = (18.697374558 + 24.06570982441908 * n) % 24
    lst = gmst * 15 + LON
    H = (lst - ra / RAD) * RAD
    lat = LAT * RAD
    el = math.asin(math.sin(lat) * math.sin(dec) + math.cos(lat) * math.cos(dec) * math.cos(H))
    az = math.atan2(-math.sin(H), math.tan(dec) * math.cos(lat) - math.sin(lat) * math.cos(H))
    return (az / RAD) % 360, el / RAD
def sun_vec(az, el, win_az=200):
    e = el * RAD; th = (az - win_az) * RAD
    return np.array([math.cos(e) * math.cos(th), math.sin(e), math.cos(e) * math.sin(th)])
FLOOR_Y, WALL_X, FAR_Z, BACK_Z, LEFT_X = -178, 220, -540, 80, -270
WINDOWS = [(-120, -24, -125, 81), (-293, -194, -125, 81), (-473, -369, -125, 81)]
BOXES = [((-150, FLOOR_Y, -150), (130, -128, -38), 'sofa'), ((-150, FLOOR_Y, -38), (130, -95, -8), 'sofa'),
         ((90, FLOOR_Y, -150), (132, -106, -8), 'sofa'), ((-152, FLOOR_Y, -150), (-112, -106, -8), 'sofa'),
         ((-250, -158, -540), (160, -143, -500), 'console'), ((-60, FLOOR_Y, 35), (215, -100, 80), 'desk')]
OCC = [(np.array(a, float), np.array(b, float)) for a, b, _ in BOXES] + [(np.array((-62, FLOOR_Y, -352.)), np.array((62, -145, -228.)))]
def slab(o, d, mn, mx):
    tmin, tmax = -1e9, 1e9
    for k in range(3):
        if abs(d[k]) < 1e-6:
            if o[k] < mn[k] or o[k] > mx[k]: return None
            continue
        t1, t2 = (mn[k] - o[k]) / d[k], (mx[k] - o[k]) / d[k]
        if t1 > t2: t1, t2 = t2, t1
        tmin = max(tmin, t1); tmax = min(tmax, t2)
        if tmin > tmax: return None
    return tmin if tmin > 0 else None
def sees_sun(p, s):
    if s[0] <= 0.01 or s[1] <= 0: return False
    t = (WALL_X - p[0]) / s[0]; y = p[1] + s[1] * t; z = p[2] + s[2] * t
    if not any(z0 < z < z1 and y0 < y < y1 for z0, z1, y0, y1 in WINDOWS): return False
    for mn, mx in OCC:
        h = slab(p, s, mn, mx)
        if h is not None and 1 < h < t: return False
    return True
def blocked(x, z):
    return any(mn[0] - 2 < x < mx[0] + 2 and mn[2] - 2 < z < mx[2] + 2 for mn, mx in OCC)
def hours_map(day, step=8, dt=10):
    xs = np.arange(LEFT_X + step / 2, WALL_X, step); zs = np.arange(FAR_Z + step / 2, BACK_Z, step)
    H = np.zeros((len(xs), len(zs)))
    sv = []
    for m in range(240, 1260, dt):
        az, el = sun_angles(day, m)
        if el > 0: sv.append(sun_vec(az, el))
    for i, x in enumerate(xs):
        for j, z in enumerate(zs):
            if blocked(x, z): H[i, j] = -1; continue
            p = np.array([x, FLOOR_Y + 0.5, z])
            H[i, j] = sum(dt / 60 for s in sv if sees_sun(p, s))
    return xs, zs, H
if __name__ == '__main__':
    out = {}
    for name, day in [('dec', 355), ('nov', 313), ('jun', 172)]:
        xs, zs, H = hours_map(day)
        out[name] = {'day': day, 'xs': xs.tolist(), 'zs': zs.tolist(), 'H': H.round(2).tolist(), 'max': float(H.max())}
        print(name, 'max hours', H.max(), 'lit cells', int((H > 0).sum()))
    # sun paths seen from the window, for the drag diagram
    paths = {}
    for name, day in [('jun', 172), ('nov', 313), ('dec', 355)]:
        pts = []
        for m in range(240, 1261, 5):
            az, el = sun_angles(day, m)
            if el > -2: pts.append([m, round(az, 2), round(el, 2)])
        paths[name] = pts
    grid = []
    for day in range(172, 356, 3):
        for m in range(240, 1261, 6):
            az, el = sun_angles(day, m)
            if el > 0: grid.append([day, m, round(az, 2), round(el, 2)])
    out['paths'] = paths; out['grid'] = grid
    print('table size (sun above horizon):', len(grid), 'of', len(range(172, 356, 3)) * len(range(240, 1261, 6)))
    print('jun noon max el', max(p[2] for p in paths['jun']), 'dec', max(p[2] for p in paths['dec']))
    json.dump(out, open('sundata.json', 'w'))
    # diagrams.html is opened from disk, so the data is also written as a script it can load
    open('sundata.js', 'w').write('window.SUN=' + json.dumps(out) + ';')
