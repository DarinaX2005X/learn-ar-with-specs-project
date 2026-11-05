"""Original Countercase articulated miniature assets. Python 3 + numpy, no borrowed meshes.
Run from any cwd. Export is standard glTF 2 GLB, metres, +Y up, face -Z.
Geometry authored as carved solids, layered cloth, profiled faces, separate brass joints.
"""

from pathlib import Path
import json, struct, math, argparse
import numpy as np

ROOT = Path(__file__).resolve().parents[2] / "Assets" / "Art" / "TableKit"
PALETTE = {
    "limestone": ("#EFE6D5", 0, 0.87),
    "stoneShade": ("#CDBB98", 0, 0.9),
    "teal": ("#163C3A", 0, 0.64),
    "clothTeal": ("#285A54", 0, 0.94),
    "brass": ("#C29B57", 0.65, 0.33),
    "edge": ("#D7FFF3", 0.15, 0.5),
    "ruby": ("#83243D", 0.25, 0.16),
    "rubyLight": ("#DF4A65", 0.3, 0.12),
    "velvet": ("#562B39", 0, 0.98),
    "wood": ("#603D2B", 0, 0.7),
    "ochre": ("#B67D32", 0, 0.96),
    "cream": ("#DDCFAD", 0, 0.95),
    "skin": ("#C99C70", 0, 0.77),
    "skinLight": ("#E6BD8D", 0, 0.79),
    "hair": ("#4B3427", 0, 0.85),
    "ink": ("#242D29", 0, 0.7),
    "leather": ("#694530", 0, 0.7),
    "uniform": ("#2E4A48", 0, 0.92),
    "glass": ("#BFE7DF", 0, 0.16),
}


def rgb(h):
    """glTF material factors are linear; palette hex values are sRGB."""
    return [
        channel / 12.92 if channel <= 0.04045 else ((channel + 0.055) / 1.055) ** 2.4
        for channel in srgb(h)
    ]


def srgb(h):
    """Display-space helper, used only by the optional offline proof raster."""
    return [int(h[i : i + 2], 16) / 255 for i in (1, 3, 5)]


class Model:
    def __init__(self, name, unit=0.01):
        self.name = name
        self.unit = unit
        self.nodes = []
        self.meshes = []
        self.materials = []
        self.access = []
        self.views = []
        self.bin = bytearray()
        self.raw = []
        for name, (h, m, r) in PALETTE.items():
            mat = {
                "name": name,
                "pbrMetallicRoughness": {
                    "baseColorFactor": rgb(h) + [0.12 if name == "glass" else 1],
                    "metallicFactor": m,
                    "roughnessFactor": r,
                },
            }
            if name == "glass":
                mat.update(alphaMode="BLEND", doubleSided=True)
            self.materials.append(mat)
        self.root = self.node(name)

    def node(self, name, parent=None, pos=(0, 0, 0)):
        i = len(self.nodes)
        self.nodes.append(
            {
                "name": name,
                "translation": (np.array(pos) * self.unit).tolist(),
                "children": [],
            }
        )
        if parent is not None:
            self.nodes[parent]["children"].append(i)
        return i

    def accessor(self, a, typ, component):
        while len(self.bin) % 4:
            self.bin += b"\0"
        offset = len(self.bin)
        data = a.tobytes()
        self.bin += data
        v = len(self.views)
        self.views.append({"buffer": 0, "byteOffset": offset, "byteLength": len(data)})
        d = {"bufferView": v, "componentType": component, "count": len(a), "type": typ}
        if typ == "VEC3":
            d.update(min=a.min(axis=0).tolist(), max=a.max(axis=0).tolist())
        self.access.append(d)
        return len(self.access) - 1

    def mesh(self, name, v, f, mat, parent=None, pos=(0, 0, 0)):
        v = np.array(v, dtype=float)
        f = np.array(f, dtype=int)
        verts = []
        norm = []
        # Flat carved planes: independent corners avoid smeared edges, glTF CCW normals.
        for face in f:
            tri = v[face]
            n = np.cross(tri[1] - tri[0], tri[2] - tri[0])
            l = np.linalg.norm(n)
            if l < 1e-10:
                continue
            verts.extend(tri * self.unit)
            norm.extend([n / l] * 3)
        if not verts:
            return
        verts = np.array(verts, dtype="<f4")
        norm = np.array(norm, dtype="<f4")
        indices = np.arange(len(verts), dtype="<u4")
        p = self.accessor(verts, "VEC3", 5126)
        n = self.accessor(norm, "VEC3", 5126)
        ind = self.accessor(indices, "SCALAR", 5125)
        self.meshes.append(
            {
                "name": name,
                "primitives": [
                    {
                        "attributes": {"POSITION": p, "NORMAL": n},
                        "indices": ind,
                        "material": list(PALETTE).index(mat),
                    }
                ],
            }
        )
        node = self.node(name, self.root if parent is None else parent, pos)
        self.nodes[node]["mesh"] = len(self.meshes) - 1
        self.raw.append((node, verts, np.arange(len(verts)).reshape(-1, 3), mat))
        return node

    def export(self):
        grounded = (
            abs(
                min(
                    float((v + self.world(node))[:, 1].min())
                    for node, v, _, _ in self.raw
                )
            )
            < 1e-7
        )
        doc = {
            "asset": {
                "version": "2.0",
                "generator": "Countercase original carved TableKit generator",
                "extras": {
                    "lsCanonical": {
                        "version": 1,
                        "forward_axis": "-Z",
                        "upright": True,
                        "grounded": grounded,
                    }
                },
            },
            "scene": 0,
            "scenes": [{"nodes": [self.root]}],
            "nodes": self.nodes,
            "meshes": self.meshes,
            "materials": self.materials,
            "accessors": self.access,
            "bufferViews": self.views,
            "buffers": [{"byteLength": len(self.bin)}],
        }
        for optional in ("images", "textures", "samplers"):
            if hasattr(self, optional):
                doc[optional] = getattr(self, optional)
        j = json.dumps(doc, separators=(",", ":")).encode()
        j += b" " * ((-len(j)) % 4)
        b = bytes(self.bin)
        b += b"\0" * ((-len(b)) % 4)
        blob = (
            struct.pack("<III", 0x46546C67, 2, 12 + 8 + len(j) + 8 + len(b))
            + struct.pack("<II", len(j), 0x4E4F534A)
            + j
            + struct.pack("<II", len(b), 0x004E4942)
            + b
        )
        (ROOT / (self.name + ".glb")).write_bytes(blob)
        pts = []
        for node, v, _, _ in self.raw:
            pts.extend(v + self.world(node))
        pts = np.array(pts)
        lo = pts.min(axis=0) * 100
        hi = pts.max(axis=0) * 100
        return {
            "name": self.name,
            "path": self.name + ".glb",
            "bytes": len(blob),
            "aabb_cm": (hi - lo).round(4).tolist(),
            "aabb_min_cm": lo.round(4).tolist(),
            "aabb_center_offset_cm": ((lo + hi) / 2).round(4).tolist(),
            "nodeNames": [n["name"] for n in self.nodes],
            "triangles": sum(len(f) for _, _, f, _ in self.raw),
        }

    def world(self, i):
        p = np.array(self.nodes[i]["translation"])
        parent = next((j for j, n in enumerate(self.nodes) if i in n["children"]), None)
        return p if parent is None else p + self.world(parent)


def ring_solid(model, name, rings, mat, parent=None, n=16, pos=(0, 0, 0), phase=0):
    """rings=(height, x radius, z radius, x offset, z offset); signed outward winding."""
    v = []
    for y, rx, rz, cx, cz in rings:
        for j in range(n):
            a = 2 * math.pi * j / n + phase
            v.append([cx + rx * math.cos(a), y, cz + rz * math.sin(a)])
    f = []
    for k in range(len(rings) - 1):
        for j in range(n):
            a = k * n + j
            b = k * n + (j + 1) % n
            c = (k + 1) * n + j
            d = (k + 1) * n + (j + 1) % n
            f.extend([[a, c, b], [b, c, d]])
    v.extend(
        [
            [rings[0][3], rings[0][0], rings[0][4]],
            [rings[-1][3], rings[-1][0], rings[-1][4]],
        ]
    )
    bot = len(v) - 2
    top = len(v) - 1
    for j in range(n):
        f.extend(
            [
                [bot, j, (j + 1) % n],
                [top, (len(rings) - 1) * n + (j + 1) % n, (len(rings) - 1) * n + j],
            ]
        )
    return model.mesh(name, v, f, mat, parent, pos)


def ellip(m, name, c, r, mat, parent=None, n=16, lat=9):
    rings = []
    for j in range(lat + 1):
        a = -math.pi / 2 + j * math.pi / lat
        s = max(0.001, math.cos(a))
        rings.append((c[1] + r[1] * math.sin(a), r[0] * s, r[2] * s, c[0], c[2]))
    return ring_solid(m, name, rings, mat, parent, n)


def box(m, name, c, s, mat, parent=None, bevel=0.1):
    x, y, z = c
    w, h, d = np.array(s) / 2
    b = min(bevel, w * 0.4, d * 0.4, h * 0.4)
    corners = [
        (-w + b, -d),
        (w - b, -d),
        (w, -d + b),
        (w, d - b),
        (w - b, d),
        (-w + b, d),
        (-w, d - b),
        (-w, -d + b),
    ]
    v = []
    for yy, fac in [(y - h, 0.92), (y - h + b, 1), (y + h - b, 1), (y + h, 0.92)]:
        v.extend([[x + xx * fac, yy, z + zz * fac] for xx, zz in corners])
    f = []
    for k in range(3):
        for j in range(8):
            a = k * 8 + j
            b1 = k * 8 + (j + 1) % 8
            f.extend([[a, a + 8, b1], [b1, a + 8, b1 + 8]])
    v.extend([[x, y - h, z], [x, y + h, z]])
    for j in range(8):
        f.extend([[32, j, (j + 1) % 8], [33, 24 + (j + 1) % 8, 24 + j]])
    return m.mesh(name, v, f, mat, parent)


def tube(m, name, points, radius, mat, parent=None, n=8):
    v = []
    for i, p in enumerate(points):
        p = np.array(p)
        d = np.array(points[min(i + 1, len(points) - 1)]) - np.array(
            points[max(i - 1, 0)]
        )
        d = d / np.linalg.norm(d)
        u = np.cross(d, [0, 0, 1] if abs(d[2]) < 0.9 else [0, 1, 0])
        u /= np.linalg.norm(u)
        w = np.cross(d, u)
        for j in range(n):
            v.append(
                p
                + radius
                * (math.cos(j * math.tau / n) * u + math.sin(j * math.tau / n) * w)
            )
    f = []
    for k in range(len(points) - 1):
        for j in range(n):
            a = k * n + j
            b = k * n + (j + 1) % n
            f.extend([[a, b, a + n], [b, b + n, a + n]])
    return m.mesh(name, v, f, mat, parent)


def footprint(m, name, outline, levels, mat):
    """Bevelled architectural footprint; chamfer is independent of thin height."""
    n = len(outline)
    v = [[x * scale, y, z * scale] for y, scale in levels for x, z in outline]
    f = []
    for k in range(len(levels) - 1):
        for j in range(n):
            a = k * n + j
            b = k * n + (j + 1) % n
            f.extend([[a, a + n, b], [b, a + n, b + n]])
    v.extend([[0, levels[0][0], 0], [0, levels[-1][0], 0]])
    bot = len(v) - 2
    top = len(v) - 1
    for j in range(n):
        f.extend(
            [
                [bot, j, (j + 1) % n],
                [top, (len(levels) - 1) * n + (j + 1) % n, (len(levels) - 1) * n + j],
            ]
        )
    return m.mesh(name, v, f, mat)


def profile(m, name, xy, depth, mat, parent=None, z=0):
    if (
        sum(
            xy[i][0] * xy[(i + 1) % len(xy)][1] - xy[(i + 1) % len(xy)][0] * xy[i][1]
            for i in range(len(xy))
        )
        < 0
    ):
        xy = list(reversed(xy))
    v = [[x, y, z - depth / 2] for x, y in xy] + [[x, y, z + depth / 2] for x, y in xy]
    n = len(xy)
    f = []
    # polygon XY is CCW, front toward -Z must reverse.
    for j in range(1, n - 1):
        f.extend([[0, j + 1, j], [n, n + j, n + j + 1]])
    for j in range(n):
        k = (j + 1) % n
        f.extend([[j, k, k + n], [j, k + n, j + n]])
    return m.mesh(name, v, f, mat, parent)


def make_figure(role):
    m = Model(role, 0.007)
    root = m.root
    cloth = {"Guard": "uniform", "Courier": "ochre", "Conservator": "clothTeal"}[role]
    # Tall, slender carved limbs. Metallic ball joints deliberately exposed.
    for side, s in [("L", -1), ("R", 1)]:
        hip = m.node("Hip_" + side, root, (s * 0.72, 6.3, 0))
        ellip(m, "Thigh_" + side, (0, -1.25, 0), (0.62, 1.65, 0.61), cloth, hip)
        knee = m.node("Knee_" + side, hip, (0, -2.7, 0))
        ellip(
            m,
            "KneeJoint_" + side,
            (0, 0, 0),
            (0.47, 0.47, 0.47),
            "brass",
            knee,
            n=10,
            lat=5,
        )
        ellip(m, "Shin_" + side, (0, -1.35, 0), (0.44, 1.35, 0.48), cloth, knee)
        box(
            m,
            "Boot_" + side,
            (s * 0.72, 0.38, -0.45),
            (1.05, 0.76, 2.15),
            "leather",
            bevel=0.22,
        )
        box(
            m,
            "Sole_" + side,
            (s * 0.72, 0.11, -0.45),
            (1.12, 0.22, 2.23),
            "ink",
            bevel=0.08,
        )
    ring_solid(
        m,
        "Jacket",
        [
            (6.0, 1.45, 0.86, 0, 0),
            (6.25, 1.65, 0.92, 0, 0),
            (7.1, 1.4, 0.85, 0, 0),
            (9.7, 1.8, 0.91, 0, 0),
            (10.5, 1.55, 0.78, 0, 0),
        ],
        cloth,
        n=12,
    )
    ring_solid(
        m, "Collar", [(10.2, 0.7, 0.66, 0, 0), (11.05, 0.64, 0.58, 0, 0)], "cream", n=12
    )
    ellip(m, "Neck", (0, 11.2, 0), (0.57, 0.75, 0.55), "skin")
    head = m.node("Head", root, (0, 11.5, 0))
    # Deliberate angular cheek/temple planes and protruding carved profile nose.
    ring_solid(
        m,
        "CarvedFace",
        [
            (0, 0.45, 0.46, 0, -0.04),
            (0.35, 0.78, 0.67, 0, -0.11),
            (1.0, 0.95, 0.73, 0, -0.03),
            (1.8, 0.96, 0.78, 0, 0.03),
            (2.5, 0.83, 0.7, 0, 0.06),
            (2.9, 0.55, 0.48, 0, 0.08),
        ],
        "skinLight",
        head,
        n=12,
        phase=math.pi / 12,
    )
    ellip(m, "Jaw", (0.05, 0.48, -0.22), (0.72, 0.48, 0.65), "skin", head, n=12, lat=5)
    for s in [-1, 1]:
        ellip(
            m,
            "Ear_" + str(s),
            (s * 0.95, 1.4, 0),
            (0.25, 0.47, 0.24),
            "skin",
            head,
            n=10,
            lat=5,
        )
        ellip(
            m,
            "EyeWhite_" + str(s),
            (s * 0.39, 1.78, -0.715),
            (0.28, 0.18, 0.09),
            "cream",
            head,
            n=10,
            lat=5,
        )
        ellip(
            m,
            "Eye_" + str(s),
            (s * 0.36, 1.76, -0.79),
            (0.1, 0.13, 0.06),
            "ink",
            head,
            n=8,
            lat=5,
        )
        tube(
            m,
            "Brow_" + str(s),
            [(s * 0.14, 2.06, -0.74), (s * 0.4, 2.15, -0.76), (s * 0.68, 2.08, -0.66)],
            0.075,
            "hair",
            head,
        )
    # asymmetric strong nose in side and front views
    m.mesh(
        "Nose",
        [
            [-0.2, 1.75, -0.7],
            [0.2, 1.75, -0.7],
            [0.18, 1.03, -0.72],
            [-0.18, 1.03, -0.72],
            [0, 1.2, -1.22],
        ],
        [[0, 1, 4], [1, 2, 4], [2, 3, 4], [3, 0, 4]],
        "skin",
        head,
    )
    tube(
        m,
        "Mouth",
        [(-0.33, 0.67, -0.78), (0, 0.61, -0.86), (0.29, 0.69, -0.79)],
        0.047,
        "hair",
        head,
    )
    ellip(m, "HairCap", (0, 2.65, 0.16), (0.95, 0.61, 0.82), "hair", head, n=14, lat=6)
    if role == "Guard":
        ring_solid(
            m,
            "CapBand",
            [(2.6, 1.0, 0.85, 0, 0), (2.98, 1.05, 0.88, 0, 0)],
            "ink",
            head,
            n=20,
        )
        ring_solid(
            m,
            "WidePeakedCap",
            [
                (2.95, 1.12, 0.9, 0, 0),
                (3.12, 1.4, 1.01, -0.12, 0.02),
                (3.52, 1.37, 0.99, -0.12, 0.02),
                (3.64, 1.07, 0.81, -0.12, 0.02),
            ],
            "uniform",
            head,
            n=20,
        )
        ellip(m, "CapVisor", (0, 2.77, -0.9), (1.08, 0.13, 0.65), "ink", head)
        box(m, "CapMark", (0, 3.17, -0.98), (0.36, 0.46, 0.12), "edge", head)
        for s in [-1, 1]:
            ellip(
                m,
                "Moustache_" + str(s),
                (s * 0.23, 0.92, -0.91),
                (0.3, 0.13, 0.1),
                "hair",
                head,
                n=10,
                lat=5,
            )
        for s in [-1, 1]:
            box(
                m,
                "Epaulette_" + str(s),
                (s * 1.48, 10.2, -0.05),
                (0.68, 0.18, 0.98),
                "brass",
            )
        box(m, "Belt", (0, 6.95, -0.1), (2.9, 0.42, 1.85), "leather")
        box(m, "Buckle", (0, 6.95, -1.08), (0.5, 0.43, 0.12), "brass")
        for y in [7.6, 8.3, 9.0, 9.7]:
            ellip(
                m,
                "Button_" + str(y),
                (0.18, y, -0.91),
                (0.12, 0.12, 0.08),
                "brass",
                n=8,
                lat=4,
            )
        profile(
            m,
            "RoleMark",
            [(-0.75, 9.7), (-0.15, 9.7), (-0.15, 9.25), (-0.45, 8.98), (-0.75, 9.25)],
            0.08,
            "edge",
            z=-0.96,
        )
    elif role == "Courier":
        ring_solid(
            m,
            "SoftCap",
            [
                (2.6, 0.96, 0.82, 0, 0),
                (3.0, 1.03, 0.88, 0, 0),
                (3.42, 0.83, 0.73, 0.12, 0.04),
                (3.58, 0.25, 0.4, 0.16, 0.03),
            ],
            "ochre",
            head,
            n=18,
        )
        ellip(m, "CapPeak", (0.1, 2.68, -0.87), (1.05, 0.12, 0.62), "leather", head)
        box(m, "Satchel", (2.0, 6.35, 0.1), (1.8, 2.4, 1.22), "leather", bevel=0.18)
        box(m, "SatchelFlap", (2, 7.25, -0.58), (1.84, 0.65, 0.22), "wood", bevel=0.12)
        for x in [1.55, 2.4]:
            box(m, "BagClasp_" + str(x), (x, 6.75, -0.65), (0.24, 0.44, 0.12), "brass")
        tube(
            m,
            "ShoulderStrap",
            [
                (-1.26, 10.3, -0.55),
                (-0.7, 9.4, -0.99),
                (0.5, 8.0, -1.0),
                (1.75, 7.1, -0.58),
            ],
            0.18,
            "leather",
        )
        box(m, "RoleMark", (-0.65, 9.38, -0.97), (0.63, 0.78, 0.1), "edge")
        for k in range(3):
            ellip(
                m,
                "Curl_" + str(k),
                (-0.75 + k * 0.48, 2.5, -0.64),
                (0.34, 0.3, 0.27),
                "hair",
                head,
                n=10,
                lat=5,
            )
    else:
        ellip(m, "HairBun", (0.4, 2.35, 0.86), (0.68, 0.68, 0.61), "hair", head)
        for k in range(5):
            ellip(
                m,
                "HairWave_" + str(k),
                (-0.74 + k * 0.34, 2.6, -0.48),
                (0.35, 0.34, 0.32),
                "hair",
                head,
                n=10,
                lat=5,
            )
        # round spectacle rims as real closed geometry, large enough for tabletop
        for s in [-1, 1]:
            pts = [
                (
                    s * 0.4 + 0.36 * math.cos(j * math.tau / 24),
                    1.76 + 0.3 * math.sin(j * math.tau / 24),
                    -0.83,
                )
                for j in range(25)
            ]
            tube(m, "Spectacles_" + str(s), pts, 0.044, "ink", head, n=6)
        tube(
            m,
            "SpectacleBridge",
            [(-0.08, 1.77, -0.88), (0.08, 1.77, -0.88)],
            0.04,
            "brass",
            head,
        )
        ring_solid(
            m,
            "ApronSkirt",
            [
                (4.9, 1.76, 1.16, 0, -0.19),
                (5.2, 1.81, 1.17, 0, -0.19),
                (6.3, 1.7, 1.07, 0, -0.13),
                (8.5, 1.22, 0.98, 0, -0.08),
                (10.1, 0.88, 0.97, 0, -0.05),
            ],
            "cream",
            n=12,
        )
        for s in [-1, 1]:
            tube(
                m,
                "ApronWaistTie_" + str(s),
                [(s * 1.35, 8.25, -0.6), (s * 1.6, 8.1, 0), (s * 1.25, 8.1, 0.75)],
                0.12,
                "cream",
            )
            tube(
                m,
                "ApronSideBow_" + str(s),
                [
                    (s * 1.5, 8.1, 0.15),
                    (s * 1.8, 8.0, 0.26),
                    (s * 1.75, 7.65, 0.3),
                    (s * 1.5, 8.1, 0.15),
                ],
                0.085,
                "cream",
            )
        box(
            m,
            "ApronPocket",
            (0, 7.0, -1.14),
            (1.2, 1.0, 0.15),
            "stoneShade",
            bevel=0.08,
        )
        for x in [-0.35, 0, 0.35]:
            tube(
                m, "Brush_" + str(x), [(x, 7.1, -1.26), (x, 8.15, -1.26)], 0.055, "wood"
            )
        profile(
            m,
            "RoleMark",
            [
                (-0.35, 9.2),
                (-0.15, 9.2),
                (-0.15, 9.65),
                (0.15, 9.65),
                (0.15, 9.2),
                (0.35, 9.2),
                (0.35, 8.95),
                (-0.35, 8.95),
            ],
            0.1,
            "edge",
            z=-1.09,
        )
    # shared articulated arm contract, large palm and individual curved fingers
    for side, s in [("L", -1), ("R", 1)]:
        shoulder = m.node("Shoulder_" + side, root, (s * 1.75, 9.95, 0))
        ellip(
            m,
            "ShoulderJoint_" + side,
            (0, 0, 0),
            (0.45, 0.45, 0.45),
            "brass",
            shoulder,
            n=10,
            lat=5,
        )
        ellip(
            m,
            "UpperSleeve_" + side,
            (s * 0.23, -1.12, 0),
            (0.58, 1.24, 0.6),
            cloth,
            shoulder,
        )
        fore = m.node("Forearm_" + side, shoulder, (s * 0.33, -2.3, 0))
        ellip(
            m,
            "Elbow_" + side,
            (0, 0, 0),
            (0.39, 0.39, 0.39),
            "brass",
            fore,
            n=10,
            lat=5,
        )
        ellip(m, "ForeSleeve_" + side, (0, -0.88, 0), (0.46, 0.93, 0.49), cloth, fore)
        ring_solid(
            m,
            "Cuff_" + side,
            [(-1.8, 0.49, 0.5, 0, 0), (-1.5, 0.49, 0.5, 0, 0)],
            "cream",
            fore,
            n=12,
        )
        hand = m.node("Hand_" + side, fore, (0, -1.92, 0))
        glove = "cream" if role == "Conservator" else "skin"
        ellip(
            m,
            "Palm_" + side,
            (0, -0.31, -0.02),
            (0.43, 0.53, 0.24),
            glove,
            hand,
            n=12,
            lat=6,
        )
        for j in range(4):
            x = -0.29 + j * 0.19
            tube(
                m,
                "Finger_" + side + str(j),
                [
                    (x, -0.48, -0.02),
                    (x, -0.8, -0.1),
                    (x, -0.95, -0.25),
                    (x, -0.87, -0.4),
                ],
                0.085,
                glove,
                hand,
                n=6,
            )
        tube(
            m,
            "Thumb_" + side,
            [
                (s * 0.3, -0.23, -0.02),
                (s * 0.57, -0.37, -0.15),
                (s * 0.55, -0.63, -0.32),
            ],
            0.12,
            glove,
            hand,
        )
    return m


def props():
    out = []
    m = Model("Plinth")
    outline = [
        (-22, -11),
        (-18, -16),
        (15, -16),
        (22, -10),
        (22, 10),
        (17, 16),
        (-16, 16),
        (-22, 11),
    ]
    footprint(
        m,
        "WalnutFoot",
        outline,
        [(-2.8, 0.97), (-2.55, 1), (-1.02, 1), (-0.8, 0.985)],
        "wood",
    )
    footprint(
        m,
        "TerracottaStep",
        outline,
        [(-0.8, 0.98), (-0.65, 0.985), (-0.28, 0.985), (-0.2, 0.97)],
        "velvet",
    )
    footprint(m, "BrassRim", outline, [(-0.2, 0.975), (-0.08, 0.975)], "brass")
    footprint(m, "LimestoneFloor", outline, [(-0.08, 0.967), (0.1, 0.967)], "limestone")
    footprint(m, "LowerBrassInlay", outline, [(-2.48, 1.001), (-2.4, 1.001)], "brass")
    # Fitted stone slabs with quiet seams, not a decorative grid.
    for x in [-14, -7, 0, 7, 14]:
        box(
            m,
            "FloorJointX_" + str(x),
            (x, 0.105, 0),
            (0.045, 0.012, 27),
            "stoneShade",
            bevel=0.002,
        )
    for z in [-7, 0, 7]:
        box(
            m,
            "FloorJointZ_" + str(z),
            (0, 0.106, z),
            (39, 0.012, 0.045),
            "stoneShade",
            bevel=0.002,
        )
    out.append(m)
    m = Model("DisplayCase")
    box(m, "Foot", (0, 0.25, 0), (4.7, 0.5, 4.7), "stoneShade", bevel=0.2)
    box(m, "BaseStep", (0, 0.65, 0), (4.3, 0.4, 4.3), "limestone", bevel=0.2)
    ring_solid(
        m,
        "Pedestal",
        [
            (0.8, 2.0, 2, 0, 0),
            (1.2, 1.7, 1.7, 0, 0),
            (5, 1.55, 1.55, 0, 0),
            (5.4, 1.9, 1.9, 0, 0),
        ],
        "limestone",
        n=4,
        phase=math.pi / 4,
    )
    box(m, "Rim", (0, 5.55, 0), (4.4, 0.35, 4.4), "brass", bevel=0.15)
    box(m, "VelvetCushion", (0, 5.86, 0), (3.8, 0.3, 3.8), "velvet", bevel=0.3)
    # Empty socket is visible after removal, a physical ring rather than painted ruby.
    ring_solid(
        m,
        "RubySocket",
        [(5.98, 0.82, 0.67, 0, 0), (6.08, 0.92, 0.77, 0, 0), (6.12, 0.67, 0.52, 0, 0)],
        "ruby",
        n=12,
    )
    for x in [-2, 2]:
        for z in [-2, 2]:
            box(
                m,
                "CaseUpright_" + str(x) + str(z),
                (x, 7.35, z),
                (0.12, 3.4, 0.12),
                "brass",
                bevel=0.04,
            )
    for z in [-2, 2]:
        box(
            m,
            "TopRailZ_" + str(z),
            (0, 9.03, z),
            (4.15, 0.12, 0.12),
            "brass",
            bevel=0.04,
        )
    for x in [-2, 2]:
        box(
            m,
            "TopRailX_" + str(x),
            (x, 9.03, 0),
            (0.12, 0.12, 4.15),
            "brass",
            bevel=0.04,
        )
    box(m, "GlassTop", (0, 9.0, 0), (3.88, 0.025, 3.88), "glass", bevel=0.005)
    # Glass sides remain optional; edge geometry survives additive displays.
    for x in [-1.96, 1.96]:
        box(
            m,
            "GlassSide_" + str(x),
            (x, 7.4, 0),
            (0.025, 3.1, 3.88),
            "glass",
            bevel=0.005,
        )
    for z in [-1.96, 1.96]:
        box(
            m,
            "GlassFront_" + str(z),
            (0, 7.4, z),
            (3.88, 3.1, 0.025),
            "glass",
            bevel=0.005,
        )
    out.append(m)
    m = Model("Ruby")
    ring_solid(
        m,
        "RubyGem",
        [
            (0, 0.58, 0.48, 0, 0),
            (0.35, 1.05, 0.86, 0, 0),
            (0.72, 1.02, 0.83, 0, 0),
            (1.06, 0.57, 0.49, 0, 0),
        ],
        "ruby",
        n=8,
        phase=math.pi / 8,
    )
    # One broad light facet, no emissive light that could leak identity.
    m.mesh(
        "RubyLightFacet",
        [
            [-0.5, 1.061, -0.2],
            [0.18, 1.061, -0.46],
            [0.53, 1.061, 0.1],
            [-0.15, 1.061, 0.4],
        ],
        [[0, 2, 1], [0, 3, 2]],
        "rubyLight",
    )
    out.append(m)
    m = Model("MirrorHousing")
    # Opening x[-3,3], y[1,11], plane z=0; opaque baffle is depth 1.2 behind opening.
    for x in [-3.4, 3.4]:
        box(m, "FrameSide_" + str(x), (x, 6, 0.1), (0.8, 11, 0.8), "brass", bevel=0.16)
    for y in [0.6, 11.4]:
        box(
            m,
            "FrameHorizontal_" + str(y),
            (0, y, 0.1),
            (7.6, 0.8, 0.8),
            "brass",
            bevel=0.16,
        )
    for x in [-3.13, 3.13]:
        box(
            m,
            "InnerLight_" + str(x),
            (x, 6, -0.34),
            (0.09, 10, 0.08),
            "edge",
            bevel=0.02,
        )
    for x in [-3.75, 3.75]:
        box(m, "ApertureSideBaffle_" + str(x), (x, 6, 1.1), (1.5, 12, 2.4), "teal")
    for y in [-0.1, 12.1]:
        box(m, "ApertureTopBottomBaffle_" + str(y), (0, y, 1.1), (9, 1.4, 2.4), "teal")
    # Back shell deliberately separate: integration must enable proxy only through front aperture.
    box(m, "OpaqueBack", (0, 6, 2.4), (9, 12.8, 0.3), "teal")
    for i in range(5):
        box(
            m,
            "Crown_" + str(i),
            ((i - 2) * 0.6, 12.05 + (0.5 - abs(i - 2) * 0.15), 0.1),
            (0.4, 0.7 - abs(i - 2) * 0.12, 0.45),
            "brass",
        )
    out.append(m)
    m = Model("Curtain")
    tube(m, "Rail", [(-3.7, 11.9, -0.7), (3.7, 11.9, -0.7)], 0.13, "brass", n=12)
    # Independent fold strips each with curved depth profile; runtime gathers each node.
    for j in range(12):
        x = -3 + (j + 0.5) * 0.5
        v = []
        f = []
        for y in [0.9, 2.5, 6, 9.3, 11.5]:
            for k in range(5):
                v.append(
                    [-0.25 + k * 0.125, y, -0.65 - 0.2 * math.cos(k * math.pi / 2)]
                )
        for row in range(4):
            for k in range(4):
                a = row * 5 + k
                f.extend([[a, a + 1, a + 5], [a + 1, a + 6, a + 5]])
        # Real thick cloth has back faces, never relies on reversing a solid's winding.
        front = list(f)
        v += [[a, b, c + 0.055] for a, b, c in v]
        f += [[a + 25, c + 25, b + 25] for a, b, c in front]
        m.mesh("Fold_" + str(j).zfill(2), v, f, "clothTeal", pos=(x, 0, 0))
        ellip(
            m,
            "Ring_" + str(j).zfill(2),
            (x, 11.72, -0.7),
            (0.2, 0.24, 0.12),
            "brass",
            n=10,
            lat=5,
        )
    handle = m.node("Handle", m.root, (-3, 5.3, -1.05))
    tube(
        m,
        "HandleLoop",
        [
            (-0.25, 0.4, 0),
            (-0.38, 0.15, 0),
            (-0.36, -0.25, 0),
            (0, -0.45, 0),
            (0.36, -0.25, 0),
            (0.38, 0.15, 0),
            (0.25, 0.4, 0),
        ],
        0.11,
        "brass",
        handle,
        n=10,
    )
    box(m, "HandleFocus", (0, 0, 0.03), (0.95, 1.15, 0.06), "edge", handle, bevel=0.18)
    out.append(m)
    m = Model("Camera")
    box(m, "CameraBase", (0, 0.15, 0), (2.2, 0.3, 2), "brass")
    tube(m, "Stem", [(0, 0.3, 0), (0, 3.6, 0)], 0.24, "brass", n=12)
    box(m, "CameraBody", (0, 4, 0), (2.6, 1.7, 3.2), "cream", bevel=0.25)
    ellip(m, "LensHood", (0, 4, -1.75), (0.8, 0.8, 0.6), "ink", n=20)
    ellip(m, "LensGlass", (0, 4, -2.24), (0.58, 0.58, 0.08), "teal", n=20)
    ellip(m, "LensCatchlight", (-0.22, 4.22, -2.32), (0.14, 0.14, 0.03), "edge", n=10)
    out.append(m)
    m = Model("MuseumWall")
    box(m, "WallMass", (0, 6.5, 0), (20, 13, 1), "stoneShade", bevel=0.3)
    # Three fitted masonry recesses keep a quiet middle and rhythm at the rear.
    for x in [-6.15, 0, 6.15]:
        width = 3.8 if x else 6.4
        box(
            m,
            "Recess_" + str(x),
            (x, 6.6, -0.54),
            (width, 9.7, 0.09),
            "velvet" if x else "teal",
            bevel=0.1,
        )
        for dx in [-width / 2, width / 2]:
            box(
                m,
                "RecessSide_" + str(x) + str(dx),
                (x + dx, 6.6, -0.67),
                (0.14, 9.9, 0.16),
                "limestone",
                bevel=0.03,
            )
        for y in [1.65, 11.55]:
            box(
                m,
                "RecessLedge_" + str(x) + str(y),
                (x, y, -0.7),
                (width + 0.35, 0.22, 0.3),
                "limestone",
                bevel=0.04,
            )
    # An arched limestone surround, assembled from real wedge solids.
    for i in range(13):
        a = i * math.pi / 13
        b = (i + 1) * math.pi / 13
        xy = [
            (3.22 * math.cos(a), 7.95 + 3.22 * math.sin(a)),
            (3.65 * math.cos(a), 7.95 + 3.65 * math.sin(a)),
            (3.65 * math.cos(b), 7.95 + 3.65 * math.sin(b)),
            (3.22 * math.cos(b), 7.95 + 3.22 * math.sin(b)),
        ]
        profile(m, "ArchVoussoir_" + str(i), xy, 0.3, "limestone", z=-0.79)
    for x in [-3.44, 3.44]:
        box(
            m,
            "ArchPier_" + str(x),
            (x, 4.8, -0.79),
            (0.43, 6.3, 0.3),
            "limestone",
            bevel=0.08,
        )
    # Original museum object: shallow amphora and fern fossil reliefs, not evidence.
    ring_solid(
        m,
        "AmphoraRelief",
        [
            (2.4, 0.48, 0.09, 0, -0.67),
            (2.6, 0.6, 0.11, 0, -0.67),
            (3.0, 0.35, 0.12, 0, -0.67),
            (4.4, 1.05, 0.16, 0, -0.67),
            (5.3, 0.8, 0.14, 0, -0.67),
            (5.9, 0.32, 0.1, 0, -0.67),
            (6.4, 0.34, 0.1, 0, -0.67),
            (6.55, 0.52, 0.12, 0, -0.67),
        ],
        "limestone",
        n=16,
    )
    for s in [-1, 1]:
        tube(
            m,
            "AmphoraHandle_" + str(s),
            [
                (s * 0.34, 6.1, -0.7),
                (s * 0.91, 6.02, -0.72),
                (s * 1.2, 5.4, -0.72),
                (s * 0.94, 4.9, -0.72),
            ],
            0.11,
            "stoneShade",
            n=8,
        )
    for x in [-6.15, 6.15]:
        box(
            m,
            "SpecimenPlaque_" + str(x),
            (x, 6.9, -0.67),
            (2.75, 5.7, 0.16),
            "stoneShade",
            bevel=0.12,
        )
        tube(
            m,
            "FossilStem_" + str(x),
            [
                (x, 4.5, -0.81),
                (x - 0.12, 5.6, -0.81),
                (x + 0.12, 7.5, -0.81),
                (x, 9.1, -0.81),
            ],
            0.07,
            "limestone",
            n=6,
        )
        for j in range(6):
            y = 5 + j * 0.59
            w = 0.9 - j * 0.09
            for s in [-1, 1]:
                profile(
                    m,
                    "FossilLeaf_" + str(x) + str(j) + str(s),
                    [
                        (x, y),
                        (x + s * w, y + 0.3),
                        (x + s * w * 0.72, y + 0.52),
                        (x + s * 0.14, y + 0.28),
                    ],
                    0.06,
                    "limestone",
                    z=-0.84,
                )
    for x in [-9, 9]:
        box(m, "Pilaster_" + str(x), (x, 6.5, -0.8), (1.3, 13, 1.0), "limestone")
        box(m, "Capital_" + str(x), (x, 12.4, -0.9), (1.9, 0.75, 1.3), "limestone")
        box(m, "Pediment_" + str(x), (x, 0.6, -0.9), (1.8, 1.2, 1.2), "limestone")
        for dx in [-0.32, 0, 0.32]:
            box(
                m,
                "Flute_" + str(x) + str(dx),
                (x + dx, 6.55, -1.315),
                (0.08, 9.8, 0.045),
                "stoneShade",
                bevel=0.015,
            )
        for k in range(4):
            box(
                m,
                "MasonryJoint_" + str(x) + str(k),
                (x, 2.3 + k * 2.4, -1.31),
                (1.2, 0.045, 0.025),
                "stoneShade",
                bevel=0.005,
            )
    for y in [0.5, 12.5]:
        box(m, "Cornice_" + str(y), (0, y, -0.65), (20, 1, 0.6), "limestone")
    out.append(m)
    return out


def anonymous_puppet():
    m = Model("AnonymousTrack", 0.007)
    for s, side in [(-1, "L"), (1, "R")]:
        hip = m.node("Hip_" + side, m.root, (s * 0.72, 6.3, 0))
        ellip(m, "Thigh_" + side, (0, -1.25, 0), (0.62, 1.65, 0.61), "stoneShade", hip)
        knee = m.node("Knee_" + side, hip, (0, -2.7, 0))
        ellip(
            m,
            "KneeJoint_" + side,
            (0, 0, 0),
            (0.43, 0.43, 0.43),
            "brass",
            knee,
            n=10,
            lat=5,
        )
        ellip(m, "Shin_" + side, (0, -1.35, 0), (0.44, 1.35, 0.48), "stoneShade", knee)
        box(
            m,
            "Foot_" + side,
            (s * 0.72, 0.38, -0.45),
            (1.05, 0.76, 2.15),
            "stoneShade",
            bevel=0.2,
        )
        shoulder = m.node("Shoulder_" + side, m.root, (s * 1.75, 9.95, 0))
        ellip(
            m,
            "UpperArm_" + side,
            (s * 0.23, -1.12, 0),
            (0.55, 1.24, 0.58),
            "stoneShade",
            shoulder,
        )
        fore = m.node("Forearm_" + side, shoulder, (s * 0.33, -2.3, 0))
        ellip(
            m,
            "Elbow_" + side,
            (0, 0, 0),
            (0.38, 0.38, 0.38),
            "brass",
            fore,
            n=10,
            lat=5,
        )
        ellip(
            m, "ForeArm_" + side, (0, -0.88, 0), (0.43, 0.93, 0.46), "stoneShade", fore
        )
        hand = m.node("Hand_" + side, fore, (0, -1.92, 0))
        ellip(
            m, "Palm_" + side, (0, -0.31, -0.02), (0.41, 0.53, 0.24), "limestone", hand
        )
    ring_solid(
        m,
        "NeutralTorso",
        [(6, 1.5, 0.85, 0, 0), (7.2, 1.45, 0.85, 0, 0), (10.5, 1.6, 0.8, 0, 0)],
        "stoneShade",
        n=12,
    )
    ellip(m, "Neck", (0, 11.2, 0), (0.5, 0.6, 0.5), "limestone")
    head = m.node("Head", m.root, (0, 12.8, 0))
    ellip(m, "BlankHead", (0, 0, 0), (0.95, 1.85, 0.8), "limestone", head, n=12, lat=7)
    return m


def role_mark_model(figure):
    m = Model("RoleMark" + figure.name, 1)
    for node, v, faces, mat in figure.raw:
        if figure.nodes[node]["name"] != "RoleMark":
            continue
        v = v + figure.world(node)
        center = (v.min(axis=0) + v.max(axis=0)) / 2
        m.mesh("RoleMark", v - center, faces, mat)
    return m


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--review-dir",
        type=Path,
        help="Optional output directory for an offline contact sheet",
    )
    args = parser.parse_args()
    figures = [make_figure(r) for r in ["Guard", "Courier", "Conservator"]]
    models = (
        figures + props() + [anonymous_puppet()] + [role_mark_model(f) for f in figures]
    )
    neutral = Model("RoleMarkAnonymous")
    box(neutral, "NeutralMark", (0, 0, 0), (0.5, 0.6, 0.09), "stoneShade", bevel=0.07)
    models.append(neutral)
    records = [m.export() for m in models]
    manifest = {
        "version": 1,
        "units": "metres in GLB, Lens import scale 100 produces cm",
        "axes": {"up": "+Y", "face": "-Z"},
        "tabletopHumanHeightCm": 10.598,
        "lifeSizeWrapperScale": 100 / 6,
        "backend": "original code-authored parametric GLB",
        "backend_reason": "articulated carved puppets, moving hand joints, parametric curtain mechanism; explicitly requested original local generator",
        "resources": records,
        "mirror": {
            "aperture_cm": {"x": [-3, 3], "y": [1, 11]},
            "plane_z_cm": 0,
            "front": "-Z",
            "warning": "housing is not a reflection renderer; use clipped observed proxy geometry only",
        },
        "lighting": {
            "keyDirection": [-0.6, 1, -0.7],
            "keyColor": "#FFF1D2",
            "fillColor": "#BFE7DF",
            "ambientRatio": 0.38,
        },
    }
    previous_manifest = ROOT / "manifest.json"
    if previous_manifest.exists():
        previous = json.loads(previous_manifest.read_text(encoding="utf-8"))
        manifest["resources"].extend(
            record
            for record in previous.get("resources", [])
            if record["name"] == "MuseumBuilding" and (ROOT / record["path"]).exists()
        )
    (ROOT / "manifest.json").write_text(
        json.dumps(manifest, indent=2), encoding="utf-8"
    )
    print(
        json.dumps(
            [
                {k: r[k] for k in ["name", "bytes", "triangles", "aabb_cm"]}
                for r in records
            ],
            indent=2,
        )
    )
    # deterministic offline geometry review, never represented as Lens Preview.
    if args.review_dir:
        render_contact_sheet(models, args.review_dir)


def render_contact_sheet(models, review_dir):
    from PIL import Image, ImageDraw, ImageFont

    im = Image.new("RGB", (1500, 1050), "#e4ddcb")
    d = ImageDraw.Draw(im)

    def draw_model(m, origin, scale, yaw=0.25):
        pixels = np.array(im)
        depth = np.full((im.height, im.width), np.inf)
        points = []
        s = math.sin(yaw)
        c = math.cos(yaw)
        rot = np.array([[c, 0, s], [0, 1, 0], [-s, 0, c]])
        for node, v, f, mat in m.raw:
            if mat == "glass":
                continue
            v = (v + m.world(node)) @ rot.T
            for tri in f:
                q = v[tri]
                n = np.cross(q[1] - q[0], q[2] - q[0])
                l = np.linalg.norm(n)
                if l == 0:
                    continue
                n /= l
                if np.dot(n, [0, 0.25, -1]) <= 0:
                    continue
                xy = [
                    (
                        origin[0] + p[0] * scale,
                        origin[1] - p[1] * scale - p[2] * scale * 0.25,
                    )
                    for p in q
                ]
                lum = 0.49 + 0.51 * max(0, np.dot(n, [-0.45, 0.75, -0.5]))
                col = tuple(int(min(255, x * 255 * lum)) for x in srgb(PALETTE[mat][0]))
                points.append((q[:, 2] - q[:, 1] * 0.25, xy, col))
        for zz, xy, col in points:
            tri = np.array(xy)
            lo = np.maximum(np.floor(tri.min(axis=0)).astype(int), [0, 0])
            hi = np.minimum(
                np.ceil(tri.max(axis=0)).astype(int), [im.width - 1, im.height - 1]
            )
            if np.any(hi < lo):
                continue
            xx, yy = np.meshgrid(
                np.arange(lo[0], hi[0] + 1) + 0.5, np.arange(lo[1], hi[1] + 1) + 0.5
            )
            a, b, c = tri
            den = (b[1] - c[1]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[1] - c[1])
            if abs(den) < 1e-7:
                continue
            u = ((b[1] - c[1]) * (xx - c[0]) + (c[0] - b[0]) * (yy - c[1])) / den
            v = ((c[1] - a[1]) * (xx - c[0]) + (a[0] - c[0]) * (yy - c[1])) / den
            w = 1 - u - v
            z = u * zz[0] + v * zz[1] + w * zz[2]
            sl = np.s_[lo[1] : hi[1] + 1, lo[0] : hi[0] + 1]
            mask = (u >= 0) & (v >= 0) & (w >= 0) & (z < depth[sl])
            depth[sl][mask] = z[mask]
            pixels[sl][mask] = col
        im.paste(Image.fromarray(pixels))

    font = ImageFont.load_default()
    d.text(
        (36, 20),
        "Countercase / original geometry contact sheet вЂ” offline artwork review",
        font=font,
        fill="#163c3a",
    )
    for i, m in enumerate(models[:3]):
        draw_model(m, (160 + i * 450, 440), 3100, 0.22)
        draw_model(m, (335 + i * 450, 440), 3100, 1.35)
        d.text(
            (75 + i * 450, 465),
            m.name + " / front + profile",
            font=font,
            fill="#163c3a",
        )
    for i, m in enumerate(models[3:10]):
        x = 180 + (i % 4) * 360
        y = 740 + (i // 4) * 270
        scale = (
            650
            if m.name == "Plinth"
            else 1600 if m.name in ["MirrorHousing", "Curtain", "MuseumWall"] else 2400
        )
        draw_model(m, (x, y), scale, 0.38)
        d.text((x - 110, y + 18), m.name, font=font, fill="#163c3a")
    review_dir.mkdir(parents=True, exist_ok=True)
    im.save(review_dir / "artwork-review.png")


if __name__ == "__main__":
    main()
