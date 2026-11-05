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
                        "material": next(
                            index
                            for index, material in enumerate(self.materials)
                            if material["name"] == mat
                        ),
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
                    float(self.world_points(node, v)[:, 1].min())
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
        if hasattr(self, "contract"):
            doc["asset"]["extras"]["tableKit"] = self.contract
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
            pts.extend(self.world_points(node, v))
        pts = np.array(pts)
        lo = pts.min(axis=0) * 100
        hi = pts.max(axis=0) * 100
        record = {
            "name": self.name,
            "path": self.name + ".glb",
            "bytes": len(blob),
            "aabb_cm": (hi - lo).round(4).tolist(),
            "aabb_min_cm": lo.round(4).tolist(),
            "aabb_center_offset_cm": ((lo + hi) / 2).round(4).tolist(),
            "nodeNames": [n["name"] for n in self.nodes],
            "triangles": sum(len(f) for _, _, f, _ in self.raw),
        }

        if hasattr(self, "contract"):
            record.update(self.contract)
        return record

    def world_matrix(self, index):
        node = self.nodes[index]
        x, y, z, w = node.get("rotation", [0, 0, 0, 1])
        matrix = np.eye(4)
        matrix[:3, :3] = np.array(
            [
                [1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)],
                [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
                [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)],
            ]
        ) @ np.diag(node.get("scale", [1, 1, 1]))
        matrix[:3, 3] = node.get("translation", [0, 0, 0])
        parent = next(
            (i for i, item in enumerate(self.nodes) if index in item["children"]), None
        )
        return matrix if parent is None else self.world_matrix(parent) @ matrix

    def world_points(self, index, vertices):
        matrix = self.world_matrix(index)
        return vertices @ matrix[:3, :3].T + matrix[:3, 3]

    def world(self, index):
        return self.world_matrix(index)[:3, 3]


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
    center_x = sum(point[0] for point in outline) / n
    center_z = sum(point[1] for point in outline) / n
    v.extend(
        [
            [center_x * levels[0][1], levels[0][0], center_z * levels[0][1]],
            [center_x * levels[-1][1], levels[-1][0], center_z * levels[-1][1]],
        ]
    )
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



def articulated_hand(m, side, sign, fore, material):
    """Physical common role/neutral hand; original arm lengths and wrist pivot."""
    hand=m.node("Hand_"+side,fore,(0,-1.92,0))
    ellip(m,"WristJoint_"+side,(0,.08,-.01),(.23,.16,.18),material,hand,n=12,lat=6)
    ring_solid(m,"Palm_"+side,[(-.68,.24,.12,0,-.02),(-.50,.32,.15,0,-.02),(-.17,.34,.15,0,-.02),(.06,.25,.12,0,-.02)],material,hand,n=12)
    # Values are the exact imported-table-cm contract, converted back to model units.
    digits=[("0",(-.1575,-.441,-.014),(.20,.15,.11),.043),
            ("1",(-.0525,-.441,-.014),(.215,.16,.115),.044),
            ("2",(.0525,-.441,-.014),(.20,.15,.105),.042),
            ("3",(.1575,-.42,-.014),(.18,.135,.10),.039),
            ("Thumb",(.22,-.15,-.014),(.23,.175,.12),.055)]
    for digit,base,lengths,radius in digits:
        thumb=digit=="Thumb"
        names=["Thumb_"+side,"ThumbMiddle_"+side,"ThumbDistal_"+side] if thumb else ["Finger_"+side+digit,"FingerMiddle_"+side+digit,"FingerDistal_"+side+digit]
        pos=(base[0]*sign/.7,base[1]/.7,base[2]/.7)
        parent=hand
        for i,(name,length) in enumerate(zip(names,lengths)):
            joint=m.node(name,parent,pos if i==0 else (0,-lengths[i-1]/.7,0))
            angle=[.12,.20,.13][i]
            m.nodes[joint]["rotation"]=[math.sin(angle/2),0,0,math.cos(angle/2)]
            r=radius/.7
            tube(m,name+"Bone",[(0,0,0),(0,-length/.7,0)],r,material,joint,n=8)
            ellip(m,name+"Knuckle",(0,0,0),(r,r,r),material,joint,n=8,lat=6)
            if i==2:ellip(m,name+"Pad",(0,-length/.7,0),(r,r,r),material,joint,n=8,lat=6)
            parent=joint
    return hand

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
        articulated_hand(m,side,s,fore,"cream" if role=="Conservator" else "skin")
    return m


def annular_surface(model, name, inner, outer, bottom, top, material, n=32):
    """A genuine closed annular solid; no cap across its opening."""
    vertices = []
    for (y, radii) in [(bottom, inner), (bottom, outer), (top, inner), (top, outer)]:
        for j in range(n):
            a = j * math.tau / n
            if callable(radii):
                (x, z) = radii(a)
            else:
                (x, z) = (radii[0] * math.cos(a), radii[1] * math.sin(a))
            vertices.append((x, y, z))
    faces = []
    for j in range(n):
        k = (j + 1) % n
        ib = j
        ob = n + j
        it = 2 * n + j
        ot = 3 * n + j
        faces.extend([[it, 2 * n + k, ot], [2 * n + k, 3 * n + k, ot], [ib, ob, k], [k, ob, n + k], [ob, ot, n + k], [n + k, ot, 3 * n + k], [ib, k, it], [k, 2 * n + k, it]])
    return model.mesh(name, vertices, faces, material)



def smooth_mesh_normals(model, node_index):
    """Area-weighted shell normals; retain real glass boundaries and all triangles."""
    primitive = model.meshes[model.nodes[node_index]['mesh']]['primitives'][0]
    normal_accessor = model.access[primitive['attributes']['NORMAL']]
    normal_view = model.views[normal_accessor['bufferView']]
    position_accessor = model.access[primitive['attributes']['POSITION']]
    position_view = model.views[position_accessor['bufferView']]
    count = position_accessor['count']
    positions = np.frombuffer(model.bin, dtype='<f4', count=count * 3,
                              offset=position_view['byteOffset']).reshape(-1, 3).copy()
    normals = np.frombuffer(model.bin, dtype='<f4', count=count * 3,
                            offset=normal_view['byteOffset']).reshape(-1, 3).copy()
    face_areas = np.linalg.norm(np.cross(positions[1::3]-positions[::3],
                                         positions[2::3]-positions[::3]), axis=1)
    areas = np.repeat(face_areas, 3)
    groups = {}
    for index, position in enumerate(positions):
        groups.setdefault(tuple(np.round(position, 7)), []).append(index)
    result = normals.copy()
    for indices in groups.values():
        for index in indices:
            neighbours = [other for other in indices if np.dot(normals[index], normals[other]) > .5]
            average = np.sum(normals[neighbours] * areas[neighbours, None], axis=0)
            length = np.linalg.norm(average)
            if length > 1e-12:
                result[index] = average / length
    data = result.astype('<f4').tobytes()
    start = normal_view['byteOffset']
    model.bin[start:start + len(data)] = data


def make_display_case():
    m = Model('DisplayCase')
    glass_material = next(material for material in m.materials if material['name'] == 'glass')
    glass_material['pbrMetallicRoughness']['baseColorFactor'][3] = .045
    glass_material['pbrMetallicRoughness']['roughnessFactor'] = .10
    glass_material['doubleSided'] = False
    for (name, colour) in [('socketVelvet', '#343032'), ('socketShadow', '#171E1C')]:
        m.materials.append({'name': name, 'pbrMetallicRoughness': {'baseColorFactor': rgb(colour) + [1], 'metallicFactor': 0, 'roughnessFactor': 0.99}})
    box(m, 'Foot', (0, 0.25, 0), (4.7, 0.5, 4.7), 'stoneShade', bevel=0.2)
    box(m, 'BaseStep', (0, 0.65, 0), (4.3, 0.4, 4.3), 'limestone', bevel=0.2)
    ring_solid(m, 'Pedestal', [(0.8, 2, 2, 0, 0), (1.2, 1.7, 1.7, 0, 0), (5, 1.55, 1.55, 0, 0), (5.4, 1.9, 1.9, 0, 0)], 'limestone', n=4, phase=math.pi / 4)
    box(m, 'Rim', (0, 5.55, 0), (4.4, 0.35, 4.4), 'stoneShade', bevel=0.15)
    for x in [-2.17, 2.17]:
        box(m, 'PlatformMetalEdge', (x, 5.72, 0), (0.045, 0.045, 4.34), 'brass', bevel=0.01)
    for z in [-2.17, 2.17]:
        box(m, 'PlatformMetalEdge', (0, 5.72, z), (4.34, 0.045, 0.045), 'brass', bevel=0.01)

    def cushion_boundary(a):
        (x, z) = (math.cos(a), math.sin(a))
        radius = min(1.9 / max(abs(x), 1e-09), 1.9 / max(abs(z), 1e-09), 3.6 / (abs(x) + abs(z)))
        return (radius * x, radius * z)
    annular_surface(m, 'VelvetCushion', (0.56, 0.47), cushion_boundary, 5.71, 6.01, 'velvet')
    profile_rings = [(6.12, 0.08, 0.07), (6.18, 0.3, 0.25), (6.25, 0.56, 0.47), (6.25, 0.68, 0.59), (6.01, 0.78, 0.69)]
    n = 32
    vertices = []
    for (y, rx, rz) in profile_rings:
        for j in range(n):
            a = j * math.tau / n
            vertices.append((rx * math.cos(a), y, rz * math.sin(a)))
    faces = []
    for ring in range(len(profile_rings) - 1):
        for j in range(n):
            a = ring * n + j
            b = ring * n + (j + 1) % n
            c = a + n
            d = b + n
            faces.extend([[a, b, c], [b, d, c]])
    vertices.append((0, 6.01, 0))
    centre = len(vertices) - 1
    for j in range(n):
        faces.append([centre, 4 * n + j, 4 * n + (j + 1) % n])
    m.mesh('RubySocket', vertices, faces, 'socketVelvet')
    floor = [(0, 6.12, 0)] + [(0.08 * math.cos(j * math.tau / n), 6.12, 0.07 * math.sin(j * math.tau / n)) for j in range(n)]
    m.mesh('SocketWellFloor', floor, [[0, 1 + (j + 1) % n, 1 + j] for j in range(n)], 'socketShadow')
    annular_surface(m, 'SocketNarrowRim', (0.655, 0.565), (0.68, 0.59), 6.235, 6.25, 'brass')
    m.node('SocketContact', m.root, (0, 6.12, 0))
    for x in [-2, 2]:
        for z in [-2, 2]:
            box(m, 'CaseUpright_' + str(x) + str(z), (x, 6.725, z), (0.1, 2.15, 0.1), 'brass', bevel=0.025)
            ring_solid(m, 'LiftPostSleeve', [(5.63, 0.085, 0.085, x, z), (6.1, 0.085, 0.085, x, z)], 'teal', n=12)
    for z in [-2, 2]:
        box(m, 'TopRailZ_' + str(z), (0, 7.8, z), (4.15, 0.1, 0.1), 'brass', bevel=0.025)
    for x in [-2, 2]:
        box(m, 'TopRailX_' + str(x), (x, 7.8, 0), (0.1, 0.1, 4.15), 'brass', bevel=0.025)
    rings = [(7.8, 2.0), (8.1, 1.9), (8.45, 1.57), (8.73, 1.1), (8.89, 0.45), (8.91, 0.02)]
    count = 40
    v = []
    for inward in [False, True]:
        for (y, r) in rings:
            radius = max(0.005, r - (0.015 if inward else 0))
            yy = y - (0.01 if inward and y > 7.8 else 0)
            for j in range(count):
                a = j * math.tau / count
                v.append((radius * math.cos(a), yy, radius * math.sin(a)))
    f = []
    layer = len(rings) * count
    for inside in [False, True]:
        offset = layer if inside else 0
        for ring in range(len(rings) - 1):
            for j in range(count):
                a = offset + ring * count + j
                b = offset + ring * count + (j + 1) % count
                c = a + count
                d = b + count
                faces_here = [[a, c, b], [b, c, d]]
                f.extend([[a, c, b] for (a, b, c) in faces_here] if inside else faces_here)
    for j in range(count):
        k = (j + 1) % count
        f.extend([[j, k, layer + j], [k, layer + k, layer + j]])
        a = (len(rings) - 1) * count + j
        b = (len(rings) - 1) * count + k
        f.extend([[a, layer + a, b], [b, layer + a, layer + b]])
    shell = m.mesh('LiftedClocheGlass', v, f, 'glass')
    smooth_mesh_normals(m, shell)
    grip = ellip(m, 'ClocheGrip', (0, 8.99, 0), (0.13, 0.1, 0.13), 'glass', n=20, lat=8)
    if grip is not None:
        smooth_mesh_normals(m, grip)
    ring_points = [(2.0 * math.cos(j * math.tau / 48), 7.8, 2.0 * math.sin(j * math.tau / 48)) for j in range(49)]
    tube(m, 'ClocheLowerBinding', ring_points, 0.025, 'brass', n=8)
    m.contract = {'kind': 'universally accessible exhibition vitrine', 'artVersion': 2, 'nativeModelScale': [65, 98.0392, 65], 'socketContactLocalTableCm': [0, 6.12, 0], 'seatRimTopLocalTableCm': 6.25, 'seatClearOpeningLocalTableCm': [1.12, 0.94], 'clocheUndersideLocalTableCm': 7.8, 'clocheAlwaysRaised': True, 'accessSides': ['-X', '+X', '-Z', '+Z'], 'collisionEnvelopeLocalTableCm': [4.7, 9.09, 4.7]}
    return m


def make_ruby():
    """A red cut stone: existing facet topology with restrained optical face variation."""
    m = Model("Ruby")
    finishes = [
        ("rubyCutBody", "#DA2638", .12),
        ("rubyCutDeep", "#9C1328", .15),
        ("rubyCutFire", "#F0443F", .10),
        ("rubyCutLit", "#FA7965", .09),
    ]
    material_indices = []
    for name, colour, roughness in finishes:
        material_indices.append(len(m.materials))
        m.materials.append({
            "name": name,
            "pbrMetallicRoughness": {
                "baseColorFactor": rgb(colour) + [1],
                "metallicFactor": .08,
                "roughnessFactor": roughness,
            },
        })
    light = next(material for material in m.materials if material["name"] == "rubyLight")
    light["pbrMetallicRoughness"].update(
        baseColorFactor=rgb("#FFB79C") + [1], metallicFactor=.08, roughnessFactor=.085)
    rx = .33 / math.cos(math.pi / 8)
    rz = .27 / math.cos(math.pi / 8)
    gem = ring_solid(m, "RubyGem", [
        (0, .04, .035, 0, 0),
        (.13, rx, rz, 0, 0),
        (.26, rx * .91, rz * .91, 0, 0),
        (.38, .18, .15, 0, 0),
    ], "ruby", n=8, phase=math.pi / 8)
    # Reuse every existing triangle, normal and vertex. Four material groups keep
    # the real planar cut legible even under a flat additive display light.
    # Adjacent crown faces vary as transmitted crimson, not alternating white paint.
    crown = [2, 0, 1, 2, 0, 3, 1, 0]
    girdle = [0, 1, 0, 0, 1, 2, 0, 1]
    pavilion = [1, 0, 1, 2, 1, 0, 1, 0]
    indices = [[], [], [], []]
    triangle_count = len(m.raw[-1][2])
    for triangle in range(triangle_count):
        if triangle < 48:
            band, side = triangle // 16, (triangle % 16) // 2
            group = [pavilion, girdle, crown][band][side]
        else:
            side = (triangle - 48) // 2
            group = 1 if triangle % 2 == 0 else [0, 2, 0, 2, 0, 2, 0, 2][side]
        indices[group].extend([triangle * 3, triangle * 3 + 1, triangle * 3 + 2])
    mesh = m.meshes[m.nodes[gem]["mesh"]]
    original = mesh["primitives"][0]
    mesh["primitives"] = [
        {"attributes": dict(original["attributes"]),
         "indices": m.accessor(np.array(group, dtype="<u4"), "SCALAR", 5125),
         "material": material_indices[index]}
        for index, group in enumerate(indices) if group
    ]
    m.mesh("RubyLightFacet", [(-.12, .381, -.05), (.04, .381, -.13),
                             (.15, .381, .03), (-.04, .381, .11)],
           [[0, 2, 1], [0, 3, 2]], "rubyLight")
    m.contract = {
        "kind": "handheld red faceted ruby", "artVersion": 3,
        "bottomPivotUnchanged": True, "nativeImportScale": 100,
        "fullSizeStoryCm": [11, 6.35, 9], "lightEmission": False,
        "cutMaterialGroups": 4, "totalPrimitives": 5,
    }
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
    out.extend([make_display_case(), make_ruby()])
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
    """One identical museum reconstruction puppet; no role-bearing accessories."""

    class PuppetModel(Model):
        def __init__(self):
            super().__init__("AnonymousTrack", 0.007)
            self.parts = {}

        def mesh(self, name, vertices, faces, material, parent=None, pos=(0, 0, 0)):
            parent = self.root if parent is None else parent
            key = (parent, material)
            entry = self.parts.setdefault(key, [name, [], []])
            offset = len(entry[1])
            entry[1].extend((np.asarray(vertices) + np.asarray(pos)).tolist())
            entry[2].extend((np.asarray(faces) + offset).tolist())

        def flush(self):
            for (parent, material), (name, vertices, faces) in self.parts.items():
                Model.mesh(self, name, vertices, faces, material, parent)

    m = PuppetModel()
    finishes = {
        "museumTimber": ("#B88A61", 0.04, 0.68),
        "museumCoat": ("#93816B", 0, 0.94),
        "museumVest": ("#62503E", 0, 0.91),
        "museumLinen": ("#BBA88D", 0, 0.97),
        "museumJoint": ("#6F5941", 0.12, 0.64),
        "museumBoot": ("#49392E", 0, 0.62),
        "museumSeam": ("#6D5E4C", 0, 0.96),
        "museumWear": ("#AE9576", 0, 0.84),
        "museumOrbit": ("#5E4835", 0, 0.8),
    }
    for name, (colour, metal, rough) in finishes.items():
        m.materials.append(
            {
                "name": name,
                "pbrMetallicRoughness": {
                    "baseColorFactor": rgb(colour) + [1],
                    "metallicFactor": metal,
                    "roughnessFactor": rough,
                },
            }
        )
    # Same skeletal node translations as the original public-track puppet.
    for sign, side in [(-1, "L"), (1, "R")]:
        hip = m.node("Hip_" + side, m.root, (sign * 0.72, 6.3, 0))
        ring_solid(
            m,
            "Thigh_" + side,
            [
                (-2.48, 0.40, 0.44, 0, 0),
                (-1.45, 0.49, 0.52, 0, 0),
                (-0.4, 0.56, 0.58, 0, 0),
                (0.10, 0.54, 0.56, 0, 0),
            ],
            "museumVest",
            hip,
            n=14,
        )
        knee = m.node("Knee_" + side, hip, (0, -2.7, 0))
        ellip(
            m,
            "KneeJoint_" + side,
            (0, 0, 0),
            (0.34, 0.34, 0.34),
            "museumJoint",
            knee,
            n=12,
            lat=6,
        )
        ring_solid(
            m,
            "Shin_" + side,
            [
                (-2.7, 0.36, 0.37, 0, 0),
                (-1.95, 0.39, 0.41, 0, 0),
                (-0.55, 0.43, 0.46, 0, 0),
                (0.10, 0.38, 0.42, 0, 0),
            ],
            "museumCoat",
            knee,
            n=14,
        )
        tube(
            m,
            "TrouserSeam_" + side,
            [
                (sign * 0.41, -0.45, 0.18),
                (sign * 0.39, -1.4, 0.17),
                (sign * 0.35, -2.50, 0.14),
            ],
            0.012,
            "museumSeam",
            knee,
            n=5,
        )
        # Boots belong to the moving knee hierarchy rather than remaining on the floor.
        box(
            m,
            "Foot_" + side,
            (0, -3.18, -0.45),
            (1.05, 0.62, 2.15),
            "museumBoot",
            knee,
            bevel=0.17,
        )
        box(
            m,
            "Sole_" + side,
            (0, -3.49, -0.45),
            (1.05, 0.22, 2.15),
            "museumOrbit",
            knee,
            bevel=0.075,
        )
        ring_solid(
            m,
            "BootShaft_" + side,
            [
                (-3.3, 0.45, 0.48, 0, -0.02),
                (-2.8, 0.43, 0.45, 0, 0),
                (-2.58, 0.42, 0.43, 0, 0),
            ],
            "museumBoot",
            knee,
            n=14,
        )
        for y in [-3.0, -2.85]:
            tube(
                m,
                "BootWelt_" + side,
                [
                    (sign * -0.31, y, -0.36),
                    (0, y - 0.025, -0.43),
                    (sign * 0.31, y, -0.36),
                ],
                0.015,
                "museumWear",
                knee,
                n=5,
            )
        shoulder = m.node("Shoulder_" + side, m.root, (sign * 1.75, 9.95, 0))
        ring_solid(
            m,
            "UpperArm_" + side,
            [
                (-2.10, 0.36, 0.38, sign * 0.33, 0),
                (-1.45, 0.43, 0.46, sign * 0.23, 0),
                (-0.35, 0.52, 0.51, sign * 0.12, 0),
                (0.22, 0.43, 0.43, 0, 0),
            ],
            "museumCoat",
            shoulder,
            n=16,
        )
        tube(
            m,
            "ShoulderStitch_" + side,
            [
                (sign * 0.41, -0.25, -0.12),
                (sign * 0.47, -0.65, -0.13),
                (sign * 0.42, -1.05, -0.14),
            ],
            0.012,
            "museumSeam",
            shoulder,
            n=5,
        )
        fore = m.node("Forearm_" + side, shoulder, (sign * 0.33, -2.3, 0))
        ellip(
            m,
            "Elbow_" + side,
            (0, 0, 0),
            (0.33, 0.33, 0.33),
            "museumJoint",
            fore,
            n=12,
            lat=6,
        )
        # This tailored fold retains the original exact outer X envelope.
        ring_solid(
            m,
            "ForeArm_" + side,
            [
                (-1.72, 0.30, 0.32, 0, 0),
                (-1.30, 0.33, 0.37, 0, 0),
                (-0.45, 0.441644264156714, 0.43, 0, 0),
                (0.12, 0.36, 0.39, 0, 0),
            ],
            "museumCoat",
            fore,
            n=16,
        )
        ring_solid(
            m,
            "Cuff_" + side,
            [(-1.78, 0.32, 0.34, 0, 0), (-1.55, 0.34, 0.36, 0, 0)],
            "museumLinen",
            fore,
            n=14,
        )
        tube(
            m,
            "ElbowClothFold_" + side,
            [(-0.25, -0.40, -0.34), (0, -0.47, -0.43), (0.25, -0.41, -0.34)],
            0.018,
            "museumSeam",
            fore,
            n=6,
        )
        articulated_hand(m,side,sign,fore,"museumTimber")
    # Sculpted working coat: shoulders, waist, skirt and an overlapping plain vest.
    ring_solid(
        m,
        "CoatBody",
        [
            (5.60, 1.47, 0.76, 0, 0.03),
            (5.86, 1.53, 0.78, 0, 0.03),
            (6.70, 1.30, 0.74, 0, 0.04),
            (8.10, 1.34, 0.80, 0, 0.05),
            (9.75, 1.51, 0.74, 0, 0.03),
            (10.40, 1.63, 0.69, 0, 0.03),
            (10.65, 1.22, 0.53, 0, 0.03),
        ],
        "museumCoat",
        n=16,
    )
    profile(
        m,
        "PlainVest",
        [
            (-0.62, 6.35),
            (0.62, 6.35),
            (0.68, 9.7),
            (0.35, 10.55),
            (-0.35, 10.55),
            (-0.68, 9.7),
        ],
        0.075,
        "museumVest",
        z=-0.78,
    )
    for sign in [-1, 1]:
        outline = [
            (sign * 0.25, 10.65),
            (sign * 1.15, 10.32),
            (sign * 0.74, 9.42),
            (sign * 0.22, 9.04),
            (sign * 0.48, 10.03),
        ]
        profile(m, "CoatLapel_" + str(sign), outline, 0.095, "museumCoat", z=-0.835)
        tube(
            m,
            "LapelTurn_" + str(sign),
            [
                (sign * 1.08, 10.28, -0.89),
                (sign * 0.72, 9.45, -0.90),
                (sign * 0.23, 9.10, -0.90),
            ],
            0.018,
            "museumWear",
            n=6,
        )
        tube(
            m,
            "CoatFrontSeam_" + str(sign),
            [
                (sign * 0.74, 8.95, -0.79),
                (sign * 0.76, 7.40, -0.78),
                (sign * 0.85, 5.78, -0.72),
            ],
            0.014,
            "museumSeam",
            n=6,
        )
        tube(
            m,
            "HemFold_" + str(sign),
            [
                (sign * 0.92, 6.48, -0.63),
                (sign * 1.12, 6.02, -0.59),
                (sign * 1.30, 5.72, -0.48),
            ],
            0.025,
            "museumWear",
            n=6,
        )
        profile(
            m,
            "CollarPoint_" + str(sign),
            [
                (sign * 0.15, 10.50),
                (sign * 0.67, 10.50),
                (sign * 0.58, 11.35),
                (sign * 0.20, 11.05),
            ],
            0.055,
            "museumLinen",
            z=-0.49,
        )
    for y in [7.15, 8.0, 8.85]:
        ellip(
            m,
            "VestFastener_" + str(y),
            (0.06, y, -0.852),
            (0.075, 0.075, 0.035),
            "museumJoint",
            n=9,
            lat=5,
        )
    tube(
        m,
        "CoatBackSeam",
        [(0, 6.05, 0.80), (0, 7.7, 0.842), (0, 9.4, 0.758)],
        0.008,
        "museumSeam",
        n=6,
    )
    ring_solid(
        m,
        "Neck",
        [
            (10.8, 0.38, 0.36, 0, 0),
            (11.1, 0.41, 0.39, 0, 0),
            (11.65, 0.34, 0.33, 0, 0),
            (12.3, 0.36, 0.34, 0, 0),
        ],
        "museumTimber",
        n=16,
    )
    ring_solid(
        m,
        "CollarBand",
        [
            (10.9, 0.52, 0.45, 0, 0),
            (11.35, 0.46, 0.41, 0, 0),
            (11.65, 0.44, 0.39, 0, 0),
        ],
        "museumLinen",
        n=16,
    )
    head = m.node("Head", m.root, (0, 12.8, 0))
    # A restrained generic carved face, identical for every unnamed track.
    ring_solid(
        m,
        "SculptedHead",
        [
            (-0.65, 0.33, 0.35, 0, -0.07),
            (-0.42, 0.57, 0.46, 0, -0.08),
            (0.02, 0.77, 0.57, 0, -0.03),
            (0.55, 0.84, 0.63, 0, 0.02),
            (1.12, 0.82, 0.64, 0, 0.04),
            (1.55, 0.74, 0.56, 0, 0.07),
            (1.73, 0.56, 0.44, 0, 0.06),
            (1.85, 0.12, 0.12, 0, 0.03),
        ],
        "museumTimber",
        head,
        n=16,
        phase=math.pi / 16,
    )
    for sign in [-1, 1]:
        ellip(
            m,
            "Ear_" + str(sign),
            (sign * 0.84, 0.58, 0.025),
            (0.16, 0.25, 0.12),
            "museumTimber",
            head,
            n=12,
            lat=6,
        )
        profile(
            m,
            "EyeOrbit_" + str(sign),
            [
                (sign * 0.17, 0.79),
                (sign * 0.37, 0.89),
                (sign * 0.59, 0.79),
                (sign * 0.36, 0.70),
            ],
            0.035,
            "museumOrbit",
            head,
            z=-0.611,
        )
        tube(
            m,
            "UpperLid_" + str(sign),
            [
                (sign * 0.17, 0.81, -0.644),
                (sign * 0.36, 0.90, -0.659),
                (sign * 0.58, 0.81, -0.621),
            ],
            0.025,
            "museumTimber",
            head,
            n=6,
        )
        ellip(
            m,
            "Eye_" + str(sign),
            (sign * 0.36, 0.795, -0.658),
            (0.055, 0.064, 0.021),
            "museumJoint",
            head,
            n=9,
            lat=5,
        )
        tube(
            m,
            "BrowPlane_" + str(sign),
            [
                (sign * 0.18, 1.02, -0.60),
                (sign * 0.39, 1.07, -0.63),
                (sign * 0.62, 1.00, -0.56),
            ],
            0.040,
            "museumTimber",
            head,
            n=6,
        )
    m.mesh(
        "NosePlanes",
        [
            (-0.14, 0.89, -0.59),
            (0.14, 0.89, -0.59),
            (0.16, 0.28, -0.59),
            (-0.16, 0.28, -0.59),
            (0, 0.40, -1.04),
        ],
        [[0, 1, 4], [1, 2, 4], [2, 3, 4], [3, 0, 4], [0, 3, 2], [0, 2, 1]],
        "museumTimber",
        head,
    )
    tube(
        m,
        "MouthIncision",
        [(-0.22, -0.12, -0.62), (0, -0.155, -0.67), (0.22, -0.12, -0.62)],
        0.021,
        "museumOrbit",
        head,
        n=6,
    )
    # Batch only within a rigid joint/material; every skeletal pivot stays independent.
    m.flush()
    # Fine timber grain comes from the original Collection albedo, never baked light.
    texture = ROOT.parent / "Collection" / "oak-albedo.jpg"
    if texture.exists():
        while len(m.bin) % 4:
            m.bin += b"\0"
        offset = len(m.bin)
        payload = texture.read_bytes()
        m.bin += payload
        m.views.append({"buffer": 0, "byteOffset": offset, "byteLength": len(payload)})
        m.images = [
            {
                "name": "CarvedTimberGrain",
                "mimeType": "image/jpeg",
                "bufferView": len(m.views) - 1,
            }
        ]
        m.samplers = [
            {"magFilter": 9729, "minFilter": 9987, "wrapS": 10497, "wrapT": 10497}
        ]
        m.textures = [{"sampler": 0, "source": 0}]
        next(
            material for material in m.materials if material["name"] == "museumTimber"
        )["pbrMetallicRoughness"]["baseColorTexture"] = {"index": 0}
        for node, vertices, _, material in m.raw:
            if material != "museumTimber":
                continue
            dimensions = np.ptp(vertices, axis=0)
            along = int(np.argmax(dimensions))
            across = next(
                axis for axis in np.argsort(dimensions)[::-1] if axis != along
            )
            physical = vertices * (100 / 6)
            uv = np.stack(
                [physical[:, along] / 0.70, physical[:, across] / 0.18], axis=1
            ).astype("<f4")
            m.meshes[m.nodes[node]["mesh"]]["primitives"][0]["attributes"][
                "TEXCOORD_0"
            ] = m.accessor(uv, "VEC2", 5126)
    m.contract = {
        "kind": "role-neutral reconstruction puppet",
        "artVersion": 2,
        "rigVersion": 1,
        "sameTemplateForEveryTrack": True,
        "roleAccessories": False,
        "forwardAxis": "-Z",
        "bindEnvelopeCm": [3.5303, 10.255, 1.6625],
        "jointNames": [
            "Head",
            "Hip_L",
            "Hip_R",
            "Knee_L",
            "Knee_R",
            "Shoulder_L",
            "Shoulder_R",
            "Forearm_L",
            "Forearm_R",
            "Hand_L",
            "Hand_R",
        ],
    }
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
    parser.add_argument(
        "--only",
        choices=["AnonymousTrack", "DisplayCase", "Ruby"],
        help="Regenerate one art resource and its manifest record",
    )
    args = parser.parse_args()
    if args.only:
        record = {"AnonymousTrack": anonymous_puppet, "DisplayCase": make_display_case, "Ruby": make_ruby}[args.only]().export()
        manifest_path = ROOT / "manifest.json"
        manifest = (
            json.loads(manifest_path.read_text(encoding="utf-8"))
            if manifest_path.exists()
            else {"version": 1, "resources": []}
        )
        manifest["resources"] = [
            item for item in manifest["resources"] if item["name"] != args.only
        ] + [record]
        manifest_path.write_text(json.dumps(manifest, indent=2), encoding="utf-8")
        print(
            json.dumps(
                {key: record[key] for key in ["name", "bytes", "triangles", "aabb_cm"]},
                indent=2,
            )
        )
        return
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
            if record["name"]
            in {"MuseumBuilding", "ExhibitionScreen", "ExhibitionScreenShort"}
            and (ROOT / record["path"]).exists()
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
