#!/usr/bin/env python3
"""Verify GPX endpoints and produce site-consumable, non-sensitive status JSON.
The check distinguishes missing files from transient failure; no route is deleted.
"""
import concurrent.futures,datetime,json,pathlib,urllib.request,urllib.error,xml.etree.ElementTree as ET
ROOT=pathlib.Path(__file__).resolve().parents[1]; data=ROOT/'data';features=json.loads((data/'routes.geojson').read_text())['features']
try: previous=json.loads((data/'gpx-status.json').read_text()).get('items',{})
except Exception:previous={}
def check(f):
 p=f['properties'];id=p['id'];url=p.get('gpx');now=datetime.datetime.now(datetime.timezone.utc).isoformat()
 if not url:return id,{'status':'unavailable','reason':'Aucun lien','checkedAt':now}
 try:
  req=urllib.request.Request(url,headers={'User-Agent':'RUNdo-GPX-check/1.0 (+https://github.com/)', 'Accept':'application/gpx+xml,application/xml,text/xml,*/*'})
  with urllib.request.urlopen(req,timeout=18) as resp:
   body=resp.read(5*1024*1024+1);code=resp.status
   if len(body)>5*1024*1024:raise ValueError('Fichier > 5 Mo')
   if not body.strip().startswith(b'<'):raise ValueError('Réponse non XML')
   xml=ET.fromstring(body)
   if xml.tag.split('}')[-1].lower()!='gpx':raise ValueError('Document XML non GPX')
   if not any(el.tag.split('}')[-1] in ('trk','rte','wpt') for el in xml.iter()):raise ValueError('GPX sans élément de parcours')
   return id,{'status':'available','http':code,'checkedAt':now}
 except urllib.error.HTTPError as e:
  if e.code in (404,410):return id,{'status':'unavailable','http':e.code,'checkedAt':now}
  return id,{'status':'unknown','http':e.code,'reason':'Erreur HTTP non concluante','checkedAt':now}
 except Exception as e:return id,{'status':'unknown','reason':str(e)[:100],'checkedAt':now}
items={}
with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:
 for rid,status in pool.map(check,features):
  if status['status']=='unknown' and previous.get(rid,{}).get('status') in ('available','unavailable'):
   status['lastKnownStatus']=previous[rid]['status']
  items[rid]=status
out={'checkedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'items':items}
(data/'gpx-status.json').write_text(json.dumps(out,ensure_ascii=False,indent=2)+'\n')
from collections import Counter
print('GPX:',dict(Counter(x['status'] for x in items.values())))
