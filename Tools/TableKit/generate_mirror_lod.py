"""Deterministic per-part vertex clustering of SHIPPED GLB binary geometry.
Keeps source node coordinates/material separation; no new character design.
"""
import pathlib,json,struct,hashlib,argparse,numpy as np
from scipy.spatial import ConvexHull
from PIL import Image,ImageDraw
parser=argparse.ArgumentParser();parser.add_argument('--models',type=pathlib.Path,required=True);parser.add_argument('--out',type=pathlib.Path,required=True);parser.add_argument('--review',type=pathlib.Path);args=parser.parse_args()
ROOT=pathlib.Path(__file__).resolve().parents[2]
result={};metrics={}
preview=Image.new('RGB',(2400,900),(228,222,207));drawing=ImageDraw.Draw(preview)
def reduce(v,f,target):
 best=(v,f)
 lo=v.min(0);span=np.maximum(v.max(0)-lo,1e-12)
 for resolution in range(1,33):
  cells=np.round((v-lo)/span*resolution).astype(int)
  _,inverse=np.unique(cells,axis=0,return_inverse=True)
  count=np.bincount(inverse);points=np.stack([np.bincount(inverse,weights=v[:,k])/count for k in range(3)],axis=1)
  faces=inverse[f];faces=faces[(faces[:,0]!=faces[:,1])&(faces[:,1]!=faces[:,2])&(faces[:,0]!=faces[:,2])]
  _,keep=np.unique(np.sort(faces,axis=1),axis=0,return_index=True);faces=faces[np.sort(keep)]
  if 0<len(faces)<=target:best=(points,faces)
  elif len(faces)>target:break
 if len(best[1])>target:
  # Closed carved solids: choose actual extreme source vertices, then their
  # convex shell. No holes from dropped triangle sampling; per-part material
  # boundaries and rig pivots survive. Explicitly a visual LOD approximation.
  unique=np.unique(v,axis=0);normalized=(unique-lo)/span;selected=[int(np.argmin(normalized[:,0]))]
  for _ in range(min(len(unique),max(4,(target+4)//2))-1):
   distances=np.min(np.stack([np.sum((normalized-normalized[k])**2,axis=1) for k in selected]),axis=0);selected.append(int(np.argmax(distances)))
  points=unique[selected]
  try:
   hull=ConvexHull(points);faces=hull.simplices.copy();center=points.mean(0)
   for face in faces:
    a,b,c=points[face]
    if np.dot(np.cross(b-a,c-a),(a+b+c)/3-center)<0:face[1],face[2]=face[2],face[1]
   best=(points,faces)
  except Exception:pass
 # Individual selected source parts are closed carved solids; vertex clustering
 # can otherwise leave cracked rings. Close the reduced shell. Keep thin/holed
 # spectacle parts exact so their empty centres remain actual holes.
 if len(best[1])<len(f):
  points=best[0]
  try:
   hull=ConvexHull(points);faces=hull.simplices.copy();center=points.mean(0)
   for face in faces:
    a,b,c=points[face]
    if np.dot(np.cross(b-a,c-a),(a+b+c)/3-center)<0:face[1],face[2]=face[2],face[1]
   best=(points,faces)
  except Exception:pass
 return best
def reduce_spectacle(v,f):
 # Shipped tube topology: 24 longitudinal sections x6 radial segments x2 faces.
 # Keep every third original ring and every second original radial vertex.
 # Connect the sampled source rings; preserve the actual empty lens opening.
 assert len(f)==288
 points=[]
 for k in range(0,25,3):
  for radial in [0,2,4]:
   tri=(min(k,23)*12+radial*2)
   points.append(v[f[tri,2 if k==24 else 0]])
 faces=[]
 for k in range(8):
  for radial in range(3):
   a=k*3+radial;b=k*3+(radial+1)%3;faces.extend([[a,b,a+3],[b,b+3,a+3]])
 return np.array(points),np.array(faces)
for role in ['Guard','Courier','Conservator','AnonymousTrack','DisplayCase','Ruby']:
 path=args.models/f'{role}.glb';b=path.read_bytes();n=struct.unpack_from('<I',b,12)[0];j=json.loads(b[20:20+n]);binary=b[28+n:]
 def accessor(i):
  a=j['accessors'][i];view=j['bufferViews'][a['bufferView']];dim={'VEC3':3,'SCALAR':1}[a['type']];dtype={5126:'<f4',5125:'<u4',5123:'<u2'}[a['componentType']]
  return np.frombuffer(binary,dtype=dtype,count=a['count']*dim,offset=view.get('byteOffset',0)+a.get('byteOffset',0)).reshape(-1,dim)
 head=next((i for i,node in enumerate(j['nodes']) if node['name']=='Head'),None);chosen=set()
 def descendants(i):
  chosen.add(i)
  for c in j['nodes'][i].get('children',[]):descendants(c)
 if head is not None:descendants(head)
 chosen.update(i for i,node in enumerate(j['nodes']) if node['name'] in ['Jacket','Collar','Neck','ApronSkirt','CoatBody','PlainVest'] or node['name'].startswith(('RoleMark','LapelTurn','CoatFrontSeam','CollarPoint','VestFastener')))
 chosen.update(i for i,node in enumerate(j['nodes']) if node['name'].startswith(('Thigh_','KneeJoint_','Shin_','Boot_','Sole_','Foot_','BootWelt_','UpperSleeve_','ForeSleeve_','UpperArm_','ForeArm_','Palm_','Cuff_')))
 if role in ['DisplayCase','Ruby']:chosen.update(i for i,node in enumerate(j['nodes']) if 'mesh' in node and node['name'] not in ['LiftedClocheGlass','ClocheGrip'])
 parents={c:i for i,node in enumerate(j['nodes']) for c in node.get('children',[])}
 def matrix(i):
  node=j['nodes'][i];x,y,z,w=node.get('rotation',[0,0,0,1]);q=np.array([[1-2*(y*y+z*z),2*(x*y-z*w),2*(x*z+y*w)],[2*(x*y+z*w),1-2*(x*x+z*z),2*(y*z-x*w)],[2*(x*z-y*w),2*(y*z+x*w),1-2*(x*x+y*y)]])
  m=np.eye(4);m[:3,:3]=q@np.diag(node.get('scale',[1,1,1]));m[:3,3]=node.get('translation',[0,0,0]);return matrix(parents[i])@m if i in parents else m
 nodes={};source_count=0;original_parts=[]
 for i in sorted(chosen):
  node=j['nodes'][i]
  if 'mesh' not in node:continue
  primitives=j['meshes'][node['mesh']]['primitives'];p=primitives[0];vertices=[];faces=[];offset=0
  for primitive in primitives:
   vv=accessor(primitive['attributes']['POSITION']).astype(float);ff=accessor(primitive['indices']).reshape(-1,3);vertices.append(vv);faces.append(ff+offset);offset+=len(vv)
  v=np.concatenate(vertices);f=np.concatenate(faces);source_count+=len(f)
  name=node['name'];target=96 if name=='SculptedHead' else 64 if name in ['CarvedFace','CoatBody'] else 40 if name in ['Jacket','WidePeakedCap','SoftCap','HairCap','ApronSkirt','PlainVest'] else 12
  if role=='DisplayCase':target=16 if name in ['Foot','BaseStep','Pedestal','Rim','VelvetCushion'] else 8
  if role=='Ruby':target=64
  points,faces=(v,f) if name.startswith('RoleMark') or (role=='AnonymousTrack' and name in ['SculptedHead','EyeOrbit_-1','Eye_-1']) else reduce_spectacle(v,f) if name.startswith('Spectacles_') else reduce(v,f,target)
  mat=j['materials'][p['material']]['pbrMetallicRoughness']['baseColorFactor']
  original_parts.append((v,f,matrix(i),mat))
  nodes[name]={'positions':np.round(points,8).reshape(-1).tolist(),'indices':faces.reshape(-1).tolist(),'color':mat,'restMatrix':np.round(matrix(i),9).reshape(-1).tolist(),'sourceTriangles':len(f)}
 result[role]=nodes;metrics[role]={'glbSHA256':hashlib.sha256(b).hexdigest(),'nodes':len(nodes),'sourceTriangles':source_count,'lodTriangles':sum(len(x['indices'])//3 for x in nodes.values())}
 for row,parts in enumerate([original_parts,[(np.array(x['positions']).reshape(-1,3),np.array(x['indices']).reshape(-1,3),np.array(x['restMatrix']).reshape(4,4),x['color']) for x in nodes.values()]]):
  ox=['Guard','Courier','Conservator','AnonymousTrack','DisplayCase','Ruby'].index(role)*400;oy=row*450;triangles=[]
  drawing.text((ox+15,oy+12),f'{role}: '+('SHIPPED GLB' if row==0 else 'DERIVED LOD'),fill=(25,44,41))
  for vertices,faces,transform,color in parts:
   world=(vertices@transform[:3,:3].T+transform[:3,3])*100/6
   for face in faces:
    q=world[face];normal=np.cross(q[1]-q[0],q[2]-q[0]);normal/=max(1e-12,np.linalg.norm(normal));shade=.62+.38*max(0,np.dot(normal,[.2,.4,-.9]));rgb=tuple(int((max(0,c*shade)**(1/2.2))*255) for c in color[:3]);triangles.append((q[:,2].mean(),[(ox+200+x*260,oy+430-(y-.62)*280) for x,y,z in q],rgb))
  for depth,points,color in sorted(triangles,reverse=True,key=lambda x:x[0]):drawing.polygon(points,fill=color)
 print(role,metrics[role])
out=args.out;out.mkdir(parents=True,exist_ok=True)
(out/'NativeMirrorLOD.ts').write_text('/** Offline reduced SHIPPED GLB head/torso parts. Native node transforms remain authoritative. */\nexport interface MirrorLODPart { positions:number[];indices:number[];color:number[];restMatrix:number[];sourceTriangles:number }\nexport const LIVE_MIRROR_LOD:Record<string,Record<string,MirrorLODPart>> = '+json.dumps(result,separators=(',',':'))+';\n')
(out/'NativeMirrorLOD.manifest.json').write_text(json.dumps(metrics,indent=2))
if args.review:
 args.review.mkdir(parents=True,exist_ok=True);preview.save(args.review/'source-vs-lod.png')
