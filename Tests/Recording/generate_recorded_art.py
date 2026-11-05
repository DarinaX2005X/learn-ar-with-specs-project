from pathlib import Path
import runpy,json,numpy as np
from shapely.geometry import Polygon
from shapely.ops import unary_union,triangulate
root=Path(__file__).resolve().parents[2]
d=runpy.run_path(str(root/'Tools/TableKit/generate_tablekit.py'))
out={}
for role in ['Guard','Courier','Conservator']:
 m=d['make_figure'](role);head=next(i for i,n in enumerate(m.nodes) if n['name']=='Head');desc={head}
 def walk(i):
  for child in m.nodes[i]['children']:desc.add(child);walk(child)
 walk(head)
 allpolys=[];groups={'hat':[],'eyes':[],'features':[]}
 for node,v,faces,mat in m.raw:
  if node not in desc:continue
  name=m.nodes[node]['name'];v=(v+m.world(node))*(100/6)
  for tri in faces:
   p=Polygon(v[tri,:2])
   if p.area<1e-10:continue
   allpolys.append(p)
   if name.startswith(('HairCap','HairBun','HairWave','Curl','SoftCap','WidePeakedCap')):groups['hat'].append(p)
   if name.startswith(('EyeWhite','CapMark')):groups['eyes'].append(p)
   if name.startswith(('Eye_','Brow','Mouth','Moustache','Spectacle','CapBand','CapVisor','CapPeak')):groups['features'].append(p)
 total=unary_union(allpolys).buffer(0);b=total.bounds;cx=(b[0]+b[2])/2;cy=(b[1]+b[3])/2
 patches=[]
 for kind,polys in groups.items():
  poly=unary_union(polys).buffer(0).simplify(.0015,preserve_topology=True)
  triangles=[]
  for tri in triangulate(poly):
   if poly.covers(tri):triangles.append([[round(x-cx,6),round(y-cy,6)] for x,y in list(tri.exterior.coords)[:3]])
  mat=('uniform' if role=='Guard' else 'ochre' if role=='Courier' else 'hair') if kind=='hat' else 'cream' if kind=='eyes' else 'ink'
  patches.append({'kind':kind,'color':d['rgb'](d['PALETTE'][mat][0]),'triangles':triangles})
 out[role]={'base':d['rgb'](d['PALETTE']['skinLight'][0]),'patches':patches}
 print(role,[(p['kind'],len(p['triangles'])) for p in patches])
(root/'Assets/Runtime/MuseumScene/RecordedHeadArt.ts').write_text('/** Public frontal material regions derived from the shipped original GLB generator. Recognized marks only. Coordinates share RoleSilhouette marker centre. */\nexport const RECORDED_HEAD_ART = '+json.dumps(out,separators=(',',':'))+' as const;\n',encoding='utf8')


