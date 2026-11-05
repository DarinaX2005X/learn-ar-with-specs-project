"""Two finished reversible museum screens within exact case-wall bounds.

Run: python Tools/TableKit/generate_partitions.py
Long axis +X, front -Z, ground Y=0. Both sides are authored, not blank backs.
"""

from pathlib import Path
import json
import math
import runpy

source = Path(__file__).resolve().parent
museum = runpy.run_path(str(source / "generate_museum.py"))
kit = museum["kit"]
palette = museum["palette"]
palette.update(
    {
        "screenForest": ("#254941", 0, 0.97),
        "screenAubergine": ("#4C3745", 0, 0.97),
        "driedLeaf": ("#A4A779", 0, 0.91),
        "driedStem": ("#8A7B4E", 0, 0.84),
    }
)
block = museum["block"]
tube = kit["tube"]
ellip = kit["ellip"]


def leaf(model, name, start, end, width, side):
    """A shallow folded leaf with a raised midrib and a proper reverse surface."""
    x0, y0 = start
    x1, y1 = end
    dx, dy = x1 - x0, y1 - y0
    length = math.hypot(dx, dy)
    nx, ny = -dy / length * width, dx / length * width
    z = side * 0.064
    vertices = [
        (x0, y0, z),
        ((x0 + x1) / 2 + nx, (y0 + y1) / 2 + ny, z),
        (x1, y1, z),
        ((x0 + x1) / 2 - nx, (y0 + y1) / 2 - ny, z),
        ((x0 + x1) / 2, (y0 + y1) / 2, z + side * 0.006),
    ]
    faces = [[0, 1, 4], [1, 2, 4], [2, 3, 4], [3, 0, 4], [0, 3, 2], [0, 2, 1]]
    if side > 0:
        faces = [[a, c, b] for a, b, c in faces]
    model.mesh(name, vertices, faces, "driedLeaf")
    tube(
        model,
        name + "Vein",
        [(x0, y0, z + side * 0.007), (x1, y1, z + side * 0.007)],
        0.002,
        "driedStem",
        n=5,
    )


def make_screen(name, width):
    model = museum["Building"]()
    model.name = name
    model.nodes[0]["name"] = name
    model.section = "Joinery"
    block(
        model, "DarkWalnutPlinth", (0, 0.08, 0), (width, 0.16, 0.15), "woodGrain", 0.018
    )
    block(
        model,
        "UpperRail",
        (0, 1.955, 0),
        (width, 0.09, 0.145),
        "parquetChestnut",
        0.014,
    )
    for s in [-1, 1]:
        block(
            model,
            "CarvedStile" + str(s),
            (s * (width / 2 - 0.045), 1.04, 0),
            (0.09, 1.84, 0.15),
            "woodGrain",
            0.013,
        )
        for side in [-1, 1]:
            # Fine fitted inlay catches a grazing edge without a crown or feet.
            block(
                model,
                "StileInlay",
                (s * (width / 2 - 0.045), 1.04, side * 0.074),
                (0.008, 1.75, 0.002),
                "brass",
                0.0004,
            )
    block(
        model,
        "LowerRail",
        (0, 0.205, 0),
        (width - 0.15, 0.075, 0.135),
        "parquetChestnut",
        0.01,
    )
    model.section = "UpholsteredPanels"
    block(
        model,
        "RigidCore",
        (0, 1.075, 0),
        (width - 0.16, 1.68, 0.085),
        "woodGrain",
        0.012,
    )
    for side, material in [(-1, "screenForest"), (1, "screenAubergine")]:
        block(
            model,
            "ClothFace" + str(side),
            (0, 1.075, side * 0.048),
            (width - 0.19, 1.65, 0.014),
            material,
            0.012,
        )
        for x in [-width / 2 + 0.105, width / 2 - 0.105]:
            tube(
                model,
                "ClothPiping",
                [(x, 0.27, side * 0.059), (x, 1.875, side * 0.059)],
                0.004,
                "leather",
                n=6,
            )
    # Botanical specimens belong to an exhibition partition, not to the UI.
    model.section = "BotanicalSpecimens"
    for side in [-1, 1]:
        offsets = [-0.34, 0.34] if width > 1.5 else [0]
        for plant, offset in enumerate(offsets):
            bend = 0.09 * (1 if plant % 2 else -1)
            tube(
                model,
                "HerbariumStem",
                [
                    (offset - 0.03, 0.38, side * 0.064),
                    (offset, 0.85, side * 0.066),
                    (offset + bend, 1.32, side * 0.066),
                    (offset + bend * 0.7, 1.7, side * 0.064),
                ],
                0.006,
                "driedStem",
                n=7,
            )
            for level in range(5):
                y = 0.57 + level * 0.205
                for direction in [-1, 1]:
                    reach = (0.20 - level * 0.018) * (1 if width > 1.5 else 0.95)
                    x = offset + bend * (y - 0.38) / 1.32
                    leaf(
                        model,
                        "PressedLeaf",
                        (x, y),
                        (x + direction * reach, y + 0.14),
                        0.035 - level * 0.003,
                        side,
                    )
            for y in [0.43, 1.52]:
                ellip(
                    model,
                    "SpecimenPin",
                    (offset + bend * (y - 0.38) / 1.32, y, side * 0.071),
                    (0.011, 0.011, 0.003),
                    "brass",
                    n=8,
                    lat=4,
                )
    record = model.finish()
    record.update(
        authoredWidthMetres=width,
        authoredHeightMetres=2,
        authoredThicknessMetres=0.15,
        longAxis="+X",
        frontAxis="-Z",
        origin="ground at centre X/Z",
        reversible=True,
        importScale=100,
    )
    return record


def main():
    records = [
        make_screen("ExhibitionScreen", 2.4),
        make_screen("ExhibitionScreenShort", 1.25),
    ]
    path = kit["ROOT"] / "manifest.json"
    manifest = json.loads(path.read_text(encoding="utf-8"))
    names = {record["name"] for record in records}
    manifest["resources"] = [
        record for record in manifest["resources"] if record["name"] not in names
    ] + records
    path.write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    print(
        json.dumps(
            [
                {key: r[key] for key in ["name", "bytes", "triangles", "aabb_cm"]}
                for r in records
            ],
            indent=2,
        )
    )


if __name__ == "__main__":
    main()
