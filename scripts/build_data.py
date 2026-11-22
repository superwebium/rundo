#!/usr/bin/env python3
"""Convert a uMap backup into static RUNdo GeoJSON and metadata."""
import json,sys,pathlib,hashlib
source=pathlib.Path(sys.argv[1]); dst=pathlib.Path(__file__).resolve().parents[1]/'data';dst.mkdir(exist_ok=True)
d=json.loads(source.read_text()); routes=[];points=[]
def number(v):
 try:return float(str(v).replace(',','.'))
 except:return None
for f in d['layers'][1]['features']:
 p=f.get('properties') or {};g=f.get('geometry') or {}
 if not p.get('ID') or g.get('type') not in ('LineString','MultiLineString'):continue
 rid=p['ID'];routes.append({'type':'Feature','geometry':g,'properties':{'id':rid,'name':p.get('name') or 'Sans nom','distance':number(p.get('Distance')),'ascent':number(p.get('Dénivelé positif')),'descent':number(p.get('Dénivelé négatif')),'difficulty':number(p.get('Ratio difficulté')),'gpx':p.get('Lien GPX') or None,'initialDone':str(p.get('Terminé','')).strip().lower()=='ok'}})
for f in d['layers'][2]['features']:
 p=f.get('properties') or {};geom=f.get('geometry') or {};coord=geom.get('coordinates')
 if geom.get('type')=='Polygon':
  try: coord=coord[0][0]
  except:continue
 if geom.get('type') not in ('Point','Polygon') or not coord:continue
 points.append({'type':'Feature','geometry':{'type':'Point','coordinates':coord[:2]},'properties':{'id':p.get('osm_id'),'commune':p.get('com_nom'),'name':p.get('name') or 'Point d’eau','bottle':p.get('accepts_bottle'),'fee':p.get('fee')}})
(dst/'routes.geojson').write_text(json.dumps({'type':'FeatureCollection','features':routes},ensure_ascii=False,separators=(',',':')))
(dst/'water.geojson').write_text(json.dumps({'type':'FeatureCollection','features':points},ensure_ascii=False,separators=(',',':')))
(dst/'boundary.geojson').write_text(json.dumps({'type':'FeatureCollection','features':d['layers'][0]['features']},ensure_ascii=False,separators=(',',':')))
(dst/'gpx-status.json').write_text(json.dumps({'checkedAt':None,'items':{}},indent=2))
print('Routes',len(routes),'Completed',sum(f['properties']['initialDone'] for f in routes),'Water',len(points))
