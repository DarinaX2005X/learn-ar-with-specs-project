"""Create only the bounded mirror-recess finish, using the museum's own palette/UVs.
Run: python generate_mirror_niche.py --tools <Tools/TableKit> --output <directory>
Does not write or modify MuseumBuilding. Coordinates are story metres, +Y up/+Z deep.
"""
from pathlib import Path
import argparse, runpy, json, hashlib
import numpy as np

parser = argparse.ArgumentParser()
parser.add_argument('--tools', type=Path, default=Path(__file__).resolve().parent)
parser.add_argument('--output', type=Path)
parser.add_argument('--asset-only', action='store_true', help='Export only GLB for reproducibility checking; leave collection manifest unchanged')
args = parser.parse_args()
args.tools = args.tools.resolve()
args.output = args.output.resolve() if args.output else args.tools.parents[1] / 'Assets' / 'Art' / 'TableKit'
manifest_path = args.output / 'manifest.json'
if not args.asset_only and not manifest_path.is_file():
    raise RuntimeError('An existing checked TableKit manifest is required; use --asset-only only for isolated reproduction')
g = runpy.run_path(str(args.tools.resolve() / 'generate_museum.py'))
Building, block, Model = g['Building'], g['block'], g['Model']
m = Building()
m.name = 'MuseumMirrorNiche'
m.nodes[m.root]['name'] = m.name
m.section = 'MirrorNicheFinish'
# Back face remains 6.5cm beyond the deepest original housing extent x7.425.
block(m, 'RecessBack', (7.55, 1.48, 3.2), (.12, 2.96, 1.3), 'plaster', .005)
block(m, 'RecessBackPlinth', (7.535, .16, 3.2), (.15, .32, 1.3), 'teal', .005)
block(m, 'RecessBackBelt', (7.539, 1.02, 3.2), (.142, .055, 1.3), 'brass', .003)
# Returns meet existing wall jambs. No coincident exposed faces or floor overlap.
for z in [2.55, 3.85]:
    block(m, 'RecessReturn', (7.245, 1.48, z), (.49, 2.96, .10), 'plaster', .005)
    block(m, 'RecessReturnPlinth', (7.245, .159, z), (.49, .318, .12), 'teal', .005)
    block(m, 'RecessReturnBelt', (7.245, 1.02, z), (.49, .053, .11), 'brass', .003)
block(m, 'RecessFloor', (7.245, -.024, 3.2), (.49, .08, 1.30), 'limestone', 0)
block(m, 'RecessSoffit', (7.315, 2.99, 3.2), (.35, .06, 1.30), 'plaster', .003)
# Existing exporter writes only this model to explicit output after embedding textures.
args.output.mkdir(parents=True, exist_ok=True)
original = Model.export

def export_to_output(self):
    state = original.__globals__
    previous = state['ROOT']
    state['ROOT'] = args.output.resolve()
    try:
        return original(self)
    finally:
        state['ROOT'] = previous

Model.export = export_to_output

def trim_exposed_return_caps(model):
    """Remove plaster hidden by the real trim on the two front return caps.

    Both materials share X=7.0. Their long faces and bevels remain unchanged;
    only covered flat-cap polygons are removed, retaining interpolated UVs.
    The plinth/belt caps contain the entire plaster cap width in Z.
    """
    vertices, faces, uv = model.batches[('MirrorNicheFinish', 'plaster')]
    plane = 7.0
    bands = []
    for material in ['teal', 'brass']:
        vv, ff, _ = model.batches[('MirrorNicheFinish', material)]
        points = np.asarray(vv)
        caps = [points[f] for f in ff
                if np.max(abs(points[f, 0] - plane)) < 1e-8]
        cap = np.concatenate(caps)
        bands.append((float(cap[:, 1].min()), float(cap[:, 1].max())))
    rebuilt = []
    for face in faces:
        points = np.asarray([vertices[i] for i in face])
        if np.max(abs(points[:, 0] - plane)) >= 1e-8:
            rebuilt.append(face)
            continue
        polygons = [[np.r_[vertices[i], uv[i]] for i in face]]
        def clip(polygon, edge, keep_above):
            result = []
            for a, b in zip(polygon, polygon[1:] + polygon[:1]):
                da = (a[1] - edge) * (1 if keep_above else -1)
                db = (b[1] - edge) * (1 if keep_above else -1)
                if da >= -1e-12:
                    result.append(a)
                if (da >= 0) != (db >= 0):
                    result.append(a + (b-a) * da/(da-db))
            return result
        for low, high in bands:
            polygons = [part for polygon in polygons
                        for part in [clip(polygon, low, False),
                                     clip(polygon, high, True)] if len(part) >= 3]
        for polygon in polygons:
            start = len(vertices)
            vertices.extend([point[:3].tolist() for point in polygon])
            uv.extend([point[3:].tolist() for point in polygon])
            for i in range(1, len(polygon)-1):
                rebuilt.append([start, start+i, start+i+1])
    faces[:] = rebuilt

trim_exposed_return_caps(m)

record = m.finish()
record['sha256'] = hashlib.sha256((args.output / record['path']).read_bytes()).hexdigest()
record['generator'] = 'Tools/TableKit/generate_mirror_niche.py'
record['generatorSha256'] = hashlib.sha256(Path(__file__).read_bytes()).hexdigest()
record['mount'] = {'parent': 'MuseumAnchor', 'localPosition': [0, 0, 0], 'localRotation': [0, 0, 0], 'localScale': [100, 100, 100]}
if not args.asset_only:
    manifest = json.loads(manifest_path.read_text(encoding='utf-8'))
    manifest['resources'] = [item for item in manifest['resources'] if item['name'] != record['name']] + [record]
    manifest_path.write_text(json.dumps(manifest, indent=2), encoding='utf-8')
print(json.dumps(record, indent=2))
