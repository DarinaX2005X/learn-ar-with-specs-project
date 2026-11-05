"""Build the connected, full-size Countercase museum. Run from any directory.

Story metres: +Y up, +Z deeper into building. Main hall [0,7]x[0,5].
No geometry is placed inside the authoritative main-hall sight-line region.
Static details are batched by room/material to keep render submission bounded.
"""

from pathlib import Path
import json
import math
import runpy
import numpy as np

SOURCE = Path(__file__).resolve().parent
kit = runpy.run_path(str(SOURCE / "generate_tablekit.py"))
Model = kit["Model"]
box = kit["box"]
tube = kit["tube"]
lathe = kit["ring_solid"]
ellip = kit["ellip"]
palette = kit["PALETTE"]
palette.update(
    {
        "plaster": ("#BE9F8C", 0, 0.94),
        "plasterLight": ("#D8C5AC", 0, 0.93),
        "parquetHoney": ("#946840", 0, 0.64),
        "parquetChestnut": ("#714B32", 0, 0.7),
        "parquetLight": ("#A37B52", 0, 0.61),
        "woodGrain": ("#523C2D", 0, 0.78),
        "slate": ("#496060", 0, 0.85),
        "paper": ("#EFE4CA", 0, 0.98),
        "paintBlue": ("#637D84", 0, 0.86),
        "paintOchre": ("#C59450", 0, 0.9),
    }
)


class Building(Model):
    def __init__(self):
        super().__init__("MuseumBuilding", 1)
        self.section = "Architecture"
        self.batches = {}
        self.images = []
        self.image_cache = {}
        self.textures = []
        self.samplers = [
            {"magFilter": 9729, "minFilter": 9987, "wrapS": 10497, "wrapT": 10497}
        ]

    def mesh(self, name, vertices, faces, material, parent=None, pos=(0, 0, 0)):
        key = (self.section, material)
        batch = self.batches.setdefault(key, [[], [], []])
        points = np.asarray(vertices) + np.asarray(pos)
        dimensions = np.ptp(points, axis=0)
        if material.startswith("parquet") or material in ["wood", "woodGrain"]:
            along = 2 if dimensions[2] > dimensions[0] else 0
            across = 0 if along == 2 else 2
            uv = np.stack([points[:, along] / 0.70, points[:, across] / 0.18], axis=1)
        else:
            normal_axis = int(np.argmin(dimensions))
            axes = [axis for axis in [0, 1, 2] if axis != normal_axis]
            uv = points[:, axes] / 1.6
        offset = len(batch[0])
        batch[0].extend(points.tolist())
        batch[1].extend((np.asarray(faces) + offset).tolist())
        batch[2].extend(uv.tolist())

    def finish(self):
        for (section, material), (vertices, faces, uv) in self.batches.items():
            Model.mesh(self, section + "__" + material, vertices, faces, material)
            points = np.asarray(vertices)
            triangles = np.asarray(faces)
            valid = (
                np.linalg.norm(
                    np.cross(
                        points[triangles[:, 1]] - points[triangles[:, 0]],
                        points[triangles[:, 2]] - points[triangles[:, 0]],
                    ),
                    axis=1,
                )
                >= 1e-10
            )
            flat_uv = np.asarray(uv, dtype="<f4")[triangles[valid].flatten()]
            self.meshes[-1]["primitives"][0]["attributes"]["TEXCOORD_0"] = (
                self.accessor(flat_uv, "VEC2", 5126)
            )
        for material in [
            "parquetHoney",
            "parquetChestnut",
            "parquetLight",
            "wood",
            "woodGrain",
        ]:
            self.surface_texture(material, "oak-albedo.jpg")
        for material in ["plaster", "plasterLight"]:
            self.surface_texture(material, "lime-plaster-albedo.jpg")
        return self.export()

    def surface_texture(self, material, filename):
        texture_file = kit["ROOT"].parent / "Collection" / filename
        if not texture_file.exists():
            return
        image_index = self.embed_image(material + "Surface", filename)
        self.textures.append({"sampler": 0, "source": image_index})
        index = list(palette).index(material)
        self.materials[index]["pbrMetallicRoughness"]["baseColorTexture"] = {
            "index": len(self.textures) - 1
        }

    def painting_material(self, name, filename):
        image_index = self.embed_image(name, filename)
        self.textures.append({"sampler": 0, "source": image_index})
        self.materials.append(
            {
                "name": name,
                "pbrMetallicRoughness": {
                    "baseColorFactor": [1, 1, 1, 1],
                    "baseColorTexture": {"index": len(self.textures) - 1},
                    "metallicFactor": 0,
                    "roughnessFactor": 0.86,
                },
            }
        )
        return len(self.materials) - 1

    def embed_image(self, name, filename):
        if filename in self.image_cache:
            return self.image_cache[filename]
        image_file = kit["ROOT"].parent / "Collection" / filename
        payload = image_file.read_bytes()
        while len(self.bin) % 4:
            self.bin += b"\0"
        offset = len(self.bin)
        self.bin += payload
        self.views.append(
            {"buffer": 0, "byteOffset": offset, "byteLength": len(payload)}
        )
        self.images.append(
            {"name": name, "mimeType": "image/jpeg", "bufferView": len(self.views) - 1}
        )
        image_index = len(self.images) - 1
        self.image_cache[filename] = image_index
        return image_index


def block(model, name, center, size, material, bevel=0.015):
    box(model, name, center, size, material, bevel=bevel)


def plane_prism(model, name, outline, axis, constant, depth, material):
    """Closed polygon extrusion in a wall plane, never an opaque doorway quad."""
    vertices = []
    for side in [-depth / 2, depth / 2]:
        for coordinate, height in outline:
            vertices.append(
                [coordinate, height, constant + side]
                if axis == "x"
                else [constant + side, height, coordinate]
            )
    count = len(outline)
    faces = []
    for i in range(1, count - 1):
        faces.extend([[0, i + 1, i], [count, count + i, count + i + 1]])
    for i in range(count):
        j = (i + 1) % count
        faces.extend([[i, j, j + count], [i, j + count, i + count]])
    if axis == "z":
        faces = [[a, c, b] for a, b, c in faces]
    model.mesh(name, vertices, faces, material)


def wall(model, name, axis, constant, start, end, material="plaster", door=None):
    def piece(a, b, bottom, top, suffix):
        center = (
            [(a + b) / 2, (bottom + top) / 2, constant]
            if axis == "x"
            else [constant, (bottom + top) / 2, (a + b) / 2]
        )
        size = (
            [b - a, top - bottom, 0.28] if axis == "x" else [0.28, top - bottom, b - a]
        )
        block(model, name + suffix, center, size, material)
        for y, height, depth, mat in [
            (0.16, 0.32, 0.34, "teal"),
            (1.02, 0.055, 0.32, "brass"),
            (3.65, 0.13, 0.38, "limestone"),
        ]:
            center = (
                [(a + b) / 2, y, constant]
                if axis == "x"
                else [constant, y, (a + b) / 2]
            )
            size = [b - a, height, depth] if axis == "x" else [depth, height, b - a]
            block(model, name + suffix + str(y), center, size, mat)

    if door is None:
        piece(start, end, 0, 3.8, "")
        return
    middle, width = door
    radius = width / 2
    spring = 2.12
    piece(start, middle - radius, 0, 3.8, "Left")
    piece(middle + radius, end, 0, 3.8, "Right")
    for i in range(18):
        a = math.pi * i / 18
        b = math.pi * (i + 1) / 18
        inner_a = (middle + radius * math.cos(a), spring + radius * math.sin(a))
        inner_b = (middle + radius * math.cos(b), spring + radius * math.sin(b))
        # Masonry above the arch is closed, the walkable arch itself stays empty.
        polygon = [inner_b, inner_a, (inner_a[0], 3.8), (inner_b[0], 3.8)]
        plane_prism(
            model, name + "Spandrel" + str(i), polygon, axis, constant, 0.28, material
        )
        outer_a = (
            middle + (radius + 0.17) * math.cos(a),
            spring + (radius + 0.17) * math.sin(a),
        )
        outer_b = (
            middle + (radius + 0.17) * math.cos(b),
            spring + (radius + 0.17) * math.sin(b),
        )
        plane_prism(
            model,
            name + "ArchStone" + str(i),
            [inner_b, inner_a, outer_a, outer_b],
            axis,
            constant,
            0.43,
            "limestone",
        )
    for side in [-1, 1]:
        p = middle + side * (radius + 0.09)
        center = [p, spring / 2, constant] if axis == "x" else [constant, spring / 2, p]
        size = [0.18, spring, 0.43] if axis == "x" else [0.43, spring, 0.18]
        block(model, name + "Jamb" + str(side), center, size, "limestone")


def column(model, x, z):
    lathe(
        model,
        "Column",
        [
            (0, 0.30, 0.30, x, z),
            (0.12, 0.31, 0.31, x, z),
            (0.22, 0.24, 0.24, x, z),
            (0.35, 0.20, 0.20, x, z),
            (3.15, 0.16, 0.16, x, z),
            (3.26, 0.23, 0.23, x, z),
            (3.43, 0.27, 0.27, x, z),
        ],
        "limestone",
        n=16,
    )
    for i in range(12):
        angle = i * math.tau / 12
        xx = x + 0.185 * math.cos(angle)
        zz = z + 0.185 * math.sin(angle)
        tube(model, "Flute", [(xx, 0.5, zz), (xx, 3.0, zz)], 0.009, "stoneShade", n=5)


def floor(model, name, x0, x1, z0, z1, kind):
    model.section = name + "Floor"
    block(
        model,
        "Foundation",
        ((x0 + x1) / 2, -0.14, (z0 + z1) / 2),
        (x1 - x0, 0.28, z1 - z0),
        "woodGrain",
    )
    if kind == "parquet":
        # Alternating short strips make directional herringbone in fitted panels.
        cell = 0.5
        for ix in range(round((x1 - x0) / cell)):
            for iz in range(round((z1 - z0) / cell)):
                for k in range(4):
                    along = (ix + iz) % 2 == 0
                    x = x0 + (ix + 0.5) * cell
                    z = z0 + (iz + 0.5) * cell
                    if along:
                        x += -0.1875 + k * 0.125
                    else:
                        z += -0.1875 + k * 0.125
                    size = (0.12, 0.018, 0.488) if along else (0.488, 0.018, 0.12)
                    mat = ["parquetHoney", "parquetChestnut", "parquetLight"][
                        (ix * 3 + iz + k) % 3
                    ]
                    block(model, "Parquet", (x, 0.009, z), size, mat, bevel=0.002)
                    # Sparse wood pore strokes follow each board, never noisy wallpaper.
                    if (ix + iz + k) % 4 == 0:
                        grain_size = (
                            (0.006, 0.002, 0.27) if along else (0.27, 0.002, 0.006)
                        )
                        block(
                            model,
                            "WoodPore",
                            (x, 0.019, z),
                            grain_size,
                            "woodGrain",
                            bevel=0.001,
                        )
    else:
        for ix in range(round(x1 - x0)):
            for iz in range(round(z1 - z0)):
                mat = "limestone" if (ix + iz) % 2 else "stoneShade"
                if kind == "slate":
                    mat = "slate" if (ix + iz) % 2 else "teal"
                block(
                    model,
                    "FittedSlab",
                    (x0 + ix + 0.5, 0.008, z0 + iz + 0.5),
                    (0.989, 0.016, 0.989),
                    mat,
                    bevel=0.003,
                )
    # A quiet path border gives the room a real finish at the wall contact.
    for z in [z0 + 0.18, z1 - 0.18]:
        block(
            model,
            "FloorBorder",
            ((x0 + x1) / 2, 0.021, z),
            (x1 - x0 - 0.36, 0.012, 0.075),
            "teal",
        )
    for x in [x0 + 0.18, x1 - 0.18]:
        block(
            model,
            "FloorBorder",
            (x, 0.021, (z0 + z1) / 2),
            (0.075, 0.012, z1 - z0 - 0.36),
            "teal",
        )


def table(model, x, z, width=1.8, depth=0.75):
    block(
        model, "TableTop", (x, 0.91, z), (width, 0.09, depth), "parquetChestnut", 0.035
    )
    block(
        model,
        "TableLip",
        (x, 0.945, z - depth / 2 + 0.045),
        (width - 0.06, 0.025, 0.035),
        "parquetLight",
    )
    for sx in [-1, 1]:
        for sz in [-1, 1]:
            block(
                model,
                "TableLeg",
                (x + sx * (width / 2 - 0.12), 0.435, z + sz * (depth / 2 - 0.1)),
                (0.09, 0.87, 0.09),
                "woodGrain",
            )
    block(model, "TableStretcher", (x, 0.27, z), (width - 0.2, 0.09, 0.08), "woodGrain")


def frame(model, x, y, z, width=1.8, height=1.2, axis="x", name="Painting"):
    def p(u, v, w):
        if axis == "x":
            return (x + u, y + v, z + w)
        if axis == "z":
            return (x - w, y + v, z + u)
        return (x + w, y + v, z - u)

    block(
        model,
        name + "Backing",
        p(0, 0, 0),
        (
            (width + 0.16, height + 0.16, 0.06)
            if axis == "x"
            else (0.06, height + 0.16, width + 0.16)
        ),
        "woodGrain",
    )
    for side in [-1, 1]:
        size = (
            (0.07, height + 0.14, 0.09) if axis == "x" else (0.09, height + 0.14, 0.07)
        )
        block(
            model,
            name + "Side",
            p(side * (width / 2 + 0.035), 0, -0.045),
            size,
            "brass",
        )
        size = (width + 0.14, 0.07, 0.09) if axis == "x" else (0.09, 0.07, width + 0.14)
        block(
            model,
            name + "Cross",
            p(0, side * (height / 2 + 0.035), -0.045),
            size,
            "brass",
        )
    # Canvas mesh is named and UV-ready for the two original Collection paintings.
    vertices = [
        p(-width / 2, -height / 2, -0.055),
        p(width / 2, -height / 2, -0.055),
        p(width / 2, height / 2, -0.055),
        p(-width / 2, height / 2, -0.055),
    ]
    faces = [[0, 2, 1], [0, 3, 2]]
    # Kept separate from batched architecture for material assignment in Studio.
    Model.mesh(model, name + "Canvas", vertices, faces, "paper")
    primitive = model.meshes[-1]["primitives"][0]
    # JPEG top row is v=0 in glTF UV convention.
    uv = np.array([[0, 1], [1, 0], [1, 1], [0, 1], [0, 0], [1, 0]], dtype="<f4")
    primitive["attributes"]["TEXCOORD_0"] = model.accessor(uv, "VEC2", 5126)
    filename = (
        "arrival-river.jpg" if name == "ArrivalRiver" else "conservator-tools.jpg"
    )
    primitive["material"] = model.painting_material(name, filename)


def anchors(model):
    positions = {
        "Entrance": (3.5, 0, -3.4),
        "RubyHall": (3.5, 0, 2.5),
        "Workshop": (-2.5, 0, 2.5),
        "Archive": (-2.5, 0, -2.5),
        "FileRack": (5.55, 1.02, -2.6),
        "EntryClock": (4.9, 1.15, -2.4),
        "HallClock": (5.4, 1.35, 0.26),
        "ConservationBench": (-3.5, 0.94, 3.8),
        "PinGlass": (-3.1, 1.00, 3.6),
        "CaseLid": (-3.9, 1.02, 3.8),
        "ArchiveRecorder": (-3.6, 1.15, -3.7),
        "EvidenceShelf": (-4.65, 1.25, -1.8),
    }
    for name, position in positions.items():
        model.node("Anchor_" + name, model.root, position)
    return positions


def main():
    model = Building()
    floor(model, "Foyer", 0, 7, -5, 0, "stone")
    floor(model, "RubyHall", 0, 7, 0, 5, "parquet")
    floor(model, "Workshop", -5, 0, 0, 5, "parquet")
    floor(model, "Archive", -5, 0, -5, 0, "slate")
    model.section = "OuterWalls"
    wall(model, "FrontFacade", "x", -5, -5, 7, door=(3.5, 2.2))
    wall(model, "WestFacade", "z", -5, -5, 5, "plasterLight")
    wall(model, "NorthFacade", "x", 5, -5, 7)
    wall(model, "EastFoyer", "z", 7, -5, 0)
    # Leave a dedicated boundary niche for the authoritative mirror on x=7.
    wall(model, "EastHallSouth", "z", 7, 0, 2.55)
    wall(model, "EastHallNorth", "z", 7, 3.85, 5)
    block(model, "MirrorNicheHeader", (7, 3.38, 3.2), (0.28, 0.84, 1.3), "plaster")
    model.section = "ConnectedDoorways"
    wall(model, "FoyerToRuby", "x", 0, 0, 7, door=(3.5, 2.4))
    wall(model, "FoyerToArchive", "z", 0, -5, 0, door=(-2.5, 2.0))
    wall(model, "WorkshopToRuby", "z", 0, 0, 5, door=(2.5, 2.0))
    wall(model, "ArchiveToWorkshop", "x", 0, -5, 0, door=(-2.5, 2.0))
    # Columns are integrated in exterior/boundary pilasters, outside the case area.
    model.section = "StoneOrder"
    for x, z in [
        (-5.16, -5.16),
        (7.3, -5.16),
        (-5.16, 5.16),
        (7.3, 5.16),
        (1.95, -0.18),
        (5.05, -0.18),
    ]:
        column(model, x, z)
    # Roof beams make a coherent building above the player, not an isolated floor.
    model.section = "RoofAndCoffers"
    for x0, x1, z0, z1 in [(0, 7, -5, 0), (0, 7, 0, 5), (-5, 0, 0, 5), (-5, 0, -5, 0)]:
        block(
            model,
            "Ceiling",
            ((x0 + x1) / 2, 3.88, (z0 + z1) / 2),
            (x1 - x0, 0.12, z1 - z0),
            "plasterLight",
        )
        for z in np.linspace(z0 + 0.45, z1 - 0.45, 4):
            block(
                model,
                "CrossBeam",
                ((x0 + x1) / 2, 3.65, z),
                (x1 - x0, 0.22, 0.16),
                "woodGrain",
                0.025,
            )
        for x in [x0 + 0.35, x1 - 0.35]:
            block(
                model,
                "CeilingLedger",
                (x, 3.67, (z0 + z1) / 2),
                (0.14, 0.2, z1 - z0),
                "parquetHoney",
            )
    model.section = "ReceptionFurniture"
    table(model, 5.3, -2.6, 2, 0.85)
    # Brass card rack with distinct thin paper edges, not identical crates.
    for x in [5.17, 5.5, 5.83]:
        block(model, "RackDivider", (x, 1.03, -2.55), (0.025, 0.18, 0.33), "brass")
        for i in range(5):
            block(
                model,
                "CaseCard",
                (x + 0.12, 1.015 + i * 0.014, -2.57),
                (0.21, 0.009, 0.28),
                "paper",
                0.002,
            )
    # Mechanical clock dial; the interactive hands can be mounted at its anchor.
    ellip(
        model,
        "ClockHousing",
        (4.9, 1.15, -2.4),
        (0.22, 0.22, 0.08),
        "brass",
        n=24,
        lat=8,
    )
    ellip(
        model,
        "ClockFace",
        (4.9, 1.15, -2.485),
        (0.186, 0.186, 0.009),
        "cream",
        n=24,
        lat=6,
    )
    for i in range(12):
        a = i * math.tau / 12
        tube(
            model,
            "ClockTick",
            [
                (4.9 + 0.15 * math.sin(a), 1.15 + 0.15 * math.cos(a), -2.5),
                (4.9 + 0.17 * math.sin(a), 1.15 + 0.17 * math.cos(a), -2.5),
            ],
            0.006,
            "ink",
            n=4,
        )
    tube(
        model, "ClockHand", [(4.9, 1.15, -2.51), (4.81, 1.27, -2.51)], 0.008, "ink", n=6
    )
    tube(
        model,
        "ClockHand",
        [(4.9, 1.15, -2.515), (5.02, 1.15, -2.515)],
        0.006,
        "ink",
        n=6,
    )
    model.section = "WorkshopFurniture"
    table(model, -3.5, 3.8, 2.4, 1.5)
    block(model, "BenchMat", (-3.5, 0.967, 3.8), (2.1, 0.014, 1.25), "clothTeal")
    block(model, "OpenCaseBase", (-3.5, 0.98, 3.65), (0.45, 0.08, 0.32), "leather")
    block(model, "CasePaper", (-3.5, 1.025, 3.65), (0.40, 0.014, 0.27), "paper", 0.008)
    block(model, "CaseLid", (-3.5, 1.15, 3.82), (0.45, 0.28, 0.035), "leather")
    # Three physical evidence panes and cameo cards are empty until observations exist.
    for i in range(3):
        x = -3.74 + 0.24 * i
        block(
            model,
            "EvidenceGlassSlot",
            (x, 0.986, 3.38),
            (0.20, 0.025, 0.18),
            "brass",
            0.008,
        )
        block(
            model,
            "EvidenceGlass",
            (x, 1.001, 3.38),
            (0.18, 0.012, 0.16),
            "glass",
            0.006,
        )
        block(model, "CameoCard", (x, 0.99, 3.86), (0.19, 0.018, 0.22), "paper", 0.01)
    for x, z, mat in [(-3.08, 3.6, "ruby"), (-3.5, 4.18, "teal")]:
        block(model, "StampPad", (x, 0.99, z), (0.15, 0.045, 0.16), mat, 0.01)
        lathe(
            model,
            "StampHandle",
            [
                (1.015, 0.055, 0.055, x, z),
                (1.08, 0.038, 0.038, x, z),
                (1.16, 0.065, 0.065, x, z),
            ],
            "wood",
            n=12,
        )
    block(model, "SaveFile", (-3.92, 0.99, 3.6), (0.15, 0.06, 0.16), "leather")
    block(model, "VersionFile", (-2.98, 1.0, 4.18), (0.22, 0.055, 0.2), "leather")
    block(
        model,
        "AlternativeVersionFile",
        (-4.02, 1.0, 4.18),
        (0.22, 0.055, 0.2),
        "leather",
    )
    block(model, "NoneFindingCard", (-2.98, 0.99, 3.66), (0.19, 0.018, 0.16), "paper")
    block(
        model, "UnknownFindingCard", (-2.98, 0.99, 3.86), (0.19, 0.018, 0.16), "paper"
    )
    tube(
        model,
        "LoupeHandle",
        [(-3.5, 1.025, 3.22), (-3.27, 1.025, 3.1)],
        0.025,
        "wood",
        n=10,
    )
    pts = [
        (
            -3.53 + 0.105 * math.cos(i * math.tau / 24),
            1.025,
            3.26 + 0.105 * math.sin(i * math.tau / 24),
        )
        for i in range(25)
    ]
    tube(model, "LoupeRim", pts, 0.017, "brass", n=8)
    for i in range(4):
        x = -4.15 + i * 0.18
        tube(
            model,
            "BrushHandle",
            [(x, 0.99, 3.49), (x + 0.07, 0.99, 3.15)],
            0.012,
            "wood",
            n=6,
        )
        tube(
            model,
            "BrushBristle",
            [(x + 0.07, 0.99, 3.15), (x + 0.085, 0.99, 3.07)],
            0.023,
            "cream",
            n=6,
        )
    for i in range(3):
        lathe(
            model,
            "PigmentJar",
            [
                (0.96, 0.055, 0.055, -2.75 + i * 0.17, 3.96),
                (1.09, 0.055, 0.055, -2.75 + i * 0.17, 3.96),
            ],
            ["ruby", "paintOchre", "paintBlue"][i],
            n=12,
        )
    # Shipping crates have different sizes, frame rails and inset panels.
    for x, z, w, h, d in [
        (-4.25, 0.72, 0.85, 0.75, 0.75),
        (-3.13, 0.72, 0.62, 0.48, 0.6),
        (-4.25, 1.67, 0.64, 0.95, 0.55),
    ]:
        block(model, "CrateInset", (x, h / 2, z), (w, h, d), "parquetHoney")
        for sx in [-1, 1]:
            block(
                model,
                "CrateRail",
                (x + sx * (w / 2 - 0.045), h / 2, z - d / 2 - 0.018),
                (0.075, h, 0.045),
                "woodGrain",
            )
        for y in [0.055, h - 0.055]:
            block(
                model,
                "CrateCross",
                (x, y, z - d / 2 - 0.02),
                (w, 0.08, 0.05),
                "parquetLight",
            )
    model.section = "ArchiveFurniture"
    table(model, -3.6, -3.7, 1.8, 0.75)
    block(model, "RecorderBody", (-3.6, 1.08, -3.7), (0.85, 0.3, 0.5), "teal")
    for x in [-3.82, -3.38]:
        ellip(
            model,
            "RecordingReel",
            (x, 1.16, -3.96),
            (0.16, 0.16, 0.02),
            "brass",
            n=20,
            lat=5,
        )
        ellip(
            model, "ReelHub", (x, 1.16, -3.985), (0.05, 0.05, 0.01), "ink", n=12, lat=4
        )
    for y in [0.35, 0.9, 1.45, 2.0]:
        block(
            model,
            "EvidenceShelf",
            (-4.65, y, -1.8),
            (0.52, 0.055, 1.5),
            "parquetChestnut",
        )
        for i in range(4):
            block(
                model,
                "EvidenceFolder",
                (-4.63, y + 0.09, -2.27 + i * 0.3),
                (0.4, 0.12, 0.22),
                ["leather", "cream", "clothTeal", "wood"][i],
            )
    for z in [-2.55, -1.05]:
        block(model, "ShelfUpright", (-4.67, 1.16, z), (0.09, 2.35, 0.085), "woodGrain")
    model.section = "OriginalArtFrames"
    frame(model, 6.8, 1.9, -2.8, 1.8, 1.2, "z-", "ArrivalRiver")
    frame(model, -2.65, 2.02, 4.82, 1.8, 1.2, "x", "ConservatorTools")
    # Sculptural amphora in the foyer, with a proper stone socle/contact.
    model.section = "FoyerSculpture"
    block(
        model, "SculptureSocle", (1.13, 0.32, -3.55), (0.68, 0.64, 0.68), "slate", 0.04
    )
    lathe(
        model,
        "Amphora",
        [
            (0.64, 0.16, 0.16, 1.13, -3.55),
            (0.74, 0.19, 0.19, 1.13, -3.55),
            (0.91, 0.1, 0.1, 1.13, -3.55),
            (1.2, 0.32, 0.25, 1.13, -3.55),
            (1.52, 0.24, 0.2, 1.13, -3.55),
            (1.65, 0.11, 0.11, 1.13, -3.55),
            (1.83, 0.12, 0.12, 1.13, -3.55),
            (1.86, 0.18, 0.18, 1.13, -3.55),
        ],
        "paintOchre",
        n=24,
    )
    for s in [-1, 1]:
        tube(
            model,
            "AmphoraHandle",
            [
                (1.13 + s * 0.12, 1.7, -3.55),
                (1.13 + s * 0.35, 1.64, -3.55),
                (1.13 + s * 0.4, 1.39, -3.55),
                (1.13 + s * 0.26, 1.27, -3.55),
            ],
            0.036,
            "parquetChestnut",
            n=10,
        )
    anchor_positions = anchors(model)
    record = model.finish()
    record.update(
        storyBoundsMetres={"x": [-5, 7], "z": [-5, 5]},
        heightMetres=3.94,
        roomCount=4,
        anchorsMetres=anchor_positions,
        importScale=100,
        forwardStory="+Z",
        paintingCanvasUV="Full 0..1, 3:2; assign Collection images",
    )
    (kit["ROOT"] / "MuseumBuilding.contract.json").write_text(
        json.dumps(record, indent=2), encoding="utf-8"
    )
    manifest_path = kit["ROOT"] / "manifest.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    manifest["resources"] = [
        r for r in manifest["resources"] if r["name"] != "MuseumBuilding"
    ] + [record]
    manifest_path.write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    print(
        json.dumps(
            {
                k: record[k]
                for k in ["name", "bytes", "triangles", "aabb_cm", "roomCount"]
            },
            indent=2,
        )
    )


if __name__ == "__main__":
    main()
