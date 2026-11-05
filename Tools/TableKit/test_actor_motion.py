"""Fresh-clone test: python Tools/TableKit/test_actor_motion.py.
Requires Python+numpy and Node/npm. TypeScript5.9.3 compiles in a removed tempdir.
Optional --project-root / --motion-root / --cases support isolated candidates.
"""
from pathlib import Path
import argparse,json,os,shutil,struct,subprocess,tempfile
import numpy as np


def actual_foot_bounds(project):
    fixtures={}
    for name in ['Guard','Courier','Conservator','AnonymousTrack']:
        blob=(project/'Assets/Art/TableKit'/f'{name}.glb').read_bytes()
        length=struct.unpack_from('<I',blob,12)[0]
        document=json.loads(blob[20:20+length]);binary=blob[28+length:]
        parents={child:i for i,node in enumerate(document['nodes']) for child in node.get('children',[])}
        def matrix(index):
            node=document['nodes'][index];value=np.eye(4)
            value[:3,3]=node.get('translation',[0,0,0])
            return matrix(parents[index])@value if index in parents else value
        sides={}
        for side,sign in [('L',-1),('R',1)]:
            points=[]
            names={f'{prefix}_{side}' for prefix in ['Boot','Foot','Sole','BootWelt']}
            for i,node in enumerate(document['nodes']):
                if node['name'] not in names or 'mesh' not in node:continue
                for primitive in document['meshes'][node['mesh']]['primitives']:
                    accessor=document['accessors'][primitive['attributes']['POSITION']]
                    view=document['bufferViews'][accessor['bufferView']]
                    vertices=np.frombuffer(binary,dtype='<f4',count=accessor['count']*3,offset=view['byteOffset']).reshape(-1,3)
                    points.append((vertices+matrix(i)[:3,3])*10000/6-np.array([sign*8.4,10.5,0]))
            if not points:raise RuntimeError(f'{name} missing actual {side} footwear')
            vertices=np.concatenate(points);lo=vertices.min(axis=0);hi=vertices.max(axis=0)
            sides[side]={'corners':[[x,y,z] for x in [lo[0],hi[0]] for y in [lo[1],hi[1]] for z in [lo[2],hi[2]]]}
        fixtures[name]=sides
    return fixtures


def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('--project-root',type=Path,default=Path(__file__).resolve().parents[2])
    parser.add_argument('--motion-root',type=Path)
    parser.add_argument('--cases',type=Path)
    args=parser.parse_args();project=args.project_root.resolve()
    motion=(args.motion_root or project/'Assets').resolve()
    npm=shutil.which('npm.cmd' if os.name=='nt' else 'npm');node=shutil.which('node')
    if not npm or not node:raise RuntimeError('Node/npm required for pinned TypeScript compile')
    with tempfile.TemporaryDirectory(prefix='countercase-gait-') as temporary:
        temp=Path(temporary);source=temp/'source';compiled=temp/'compiled'
        for relative in ['Domain/TrackMotion.ts','Spatial/PlantedGait.ts']:
            target=source/relative;target.parent.mkdir(parents=True,exist_ok=True);shutil.copyfile(motion/relative,target)
        for name in ['cases.ts','types.ts']:
            original=args.cases.resolve() if name=='cases.ts' and args.cases else project/'Assets/Domain'/name
            shutil.copyfile(original,source/'Domain'/name)
        bounds=temp/'foot-bounds.json';bounds.write_text(json.dumps(actual_foot_bounds(project)))
        subprocess.run([npm,'exec','--yes','--package=typescript@5.9.3','--','tsc','--strict','--target','es2021','--module','commonjs','--outDir',str(compiled),*[str(p) for p in source.rglob('*.ts')]],check=True,cwd=temp)
        environment=dict(os.environ,ACTOR_MOTION_COMPILED=str(compiled),ACTOR_MOTION_FOOT_BOUNDS=str(bounds))
        subprocess.run([node,str(Path(__file__).with_name('verify_actor_motion.cjs'))],check=True,env=environment)
    print('PASS actor motion; temporary compilation removed')


if __name__=='__main__':main()
