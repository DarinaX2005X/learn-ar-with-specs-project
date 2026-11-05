"""Exact frontal projected head boundaries of the original TableKit GLBs.
Uses local geometry generator + shapely; no reference raster is sampled.
"""

from pathlib import Path
import runpy, json, numpy as np
from shapely.geometry import Polygon
from shapely.ops import unary_union

root = Path(__file__).resolve().parents[2]
d = runpy.run_path(str(Path(__file__).with_name("generate_tablekit.py")))
result = {}
for name in ["Guard", "Courier", "Conservator", "AnonymousTrack"]:
    m = d["anonymous_puppet"]() if name == "AnonymousTrack" else d["make_figure"](name)
    head = next(i for i, n in enumerate(m.nodes) if n["name"] == "Head")
    descendants = {head}

    def descend(i):
        for child in m.nodes[i]["children"]:
            descendants.add(child)
            descend(child)

    descend(head)
    polys = []
    for node, v, faces, _ in m.raw:
        if node not in descendants:
            continue
        v = (v + m.world(node)) * (100 / 6)
        for tri in faces:
            p = Polygon(v[tri, :2])
            if p.area > 1e-10:
                polys.append(p)
    union = unary_union(polys).buffer(0)
    if union.geom_type == "MultiPolygon":
        union = max(union.geoms, key=lambda p: p.area)
    # Silhouette keeps broad cheek, cap brim and bun; removes submillimetre facets.
    union = union.simplify(0.001, preserve_topology=True)
    coords = np.array(union.exterior.coords[:-1])
    center = (coords.min(axis=0) + coords.max(axis=0)) / 2
    coords -= center
    result["anonymous" if name == "AnonymousTrack" else name] = np.round(
        coords, 6
    ).tolist()
    assert 0.15 < np.ptp(coords[:, 0]) < 0.4 and 0.25 < np.ptp(coords[:, 1]) < 0.5
out = root / "Assets" / "Scripts" / "TableKit" / "RoleSilhouette.ts"
out.write_text(
    """/** Exact frontal projected boundary of the TableKit head + hat geometry.
 * Coordinates: [horizontal, vertical] metres, centred around observed marker.
 * This is a fixed public recording proxy, not a recovered private actor pose.
 * Always call with undefined for an unrecognised mark; clip through domain sight.
 * Generated from original 3D head triangle union; no room/ref image is embedded.
 */
import { Role } from './TableKit';
export type OutlineUV = readonly (readonly [number, number])[];
const OUTLINES: Readonly<Record<Role | 'anonymous', OutlineUV>> = """
    + json.dumps(result, indent=2)
    + """;
export function roleSilhouette(role?: Role): OutlineUV {
  return OUTLINES[role || 'anonymous'];
}
""",
    encoding="utf-8",
)
print([(name, len(points)) for name, points in result.items()])
