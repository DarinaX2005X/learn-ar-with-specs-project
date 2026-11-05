from pathlib import Path
import runpy,json,numpy as np
from shapely.geometry import Polygon,box
from shapely.ops import unary_union,triangulate
root=Path(__file__).resolve().parents[2];d=runpy.run_path(str(root/'Tools/TableKit/generate_tablekit.py'));out={}
for role in ['Guard','Courier','Conservator','anonymous']:
 m=d['anonymous_puppet']() if role=='anonymous' else d['make_figure'](role);head=next(i for i,n in enumerate(m.nodes) if n['name']=='Head');desc={head}
 def walk(i):
  for c in m.nodes[i]['children']:desc.add(c);walk(c)
 walk(head);h=np.concatenate([(v+m.world(node))*(100/6) for node,v,f,mat in m.raw if node in desc]);center=(h[:,:2].min(0)+h[:,:2].max(0))/2
 groups={}
 for node,v,faces,mat in m.raw:
  name=m.nodes[node]['name']
  if name not in ['Jacket','NeutralTorso','Collar','Neck','ApronSkirt']:continue
  q=(v+m.world(node))*(100/6);q=q[:,:2]-center
  for face in faces:
   p=Polygon(q[face]).intersection(box(-.4,-.52,.4,-.12))
   if p.area>1e-9:groups.setdefault((name,mat),[]).append(p)
 patches=[]
 order={'Jacket':0,'NeutralTorso':0,'ApronSkirt':1,'Collar':2,'Neck':3}
 for (name,mat),polys in sorted(groups.items(),key=lambda item:order[item[0][0]]):
  poly=unary_union(polys).buffer(0).simplify(.0015,preserve_topology=True);triangles=[]
  for tri in triangulate(poly):
   if poly.covers(tri):triangles.append([[round(x,6),round(y,6)] for x,y in list(tri.exterior.coords)[:3]])
  patches.append({'kind':name,'color':[.24,.29,.28] if role=='anonymous' else d['rgb'](d['PALETTE'][mat][0]),'triangles':triangles})
 out[role]=patches;print(role,[(p['kind'],len(p['triangles'])) for p in patches])
(root/'Assets/Runtime/MuseumScene/RecordedTorsoArt.ts').write_text('/** Static collar and upper-trunk regions from the shipped original GLB geometry. No arms, hands, pose or events. Coordinates share the observed head marker plane. */\nexport const RECORDED_TORSO_ART = '+json.dumps(out,separators=(',',':'))+' as const;\n',encoding='utf8')
