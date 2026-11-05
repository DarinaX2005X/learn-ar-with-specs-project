"""Create only the bounded mirror-recess finish, using the museum's own palette/UVs.
Run: python generate_mirror_niche.py --tools <Tools/TableKit> --output <directory>
Does not write or modify MuseumBuilding. Coordinates are story metres, +Y up/+Z deep.
"""
from pathlib import Path
import argparse, runpy, json, hashlib

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
