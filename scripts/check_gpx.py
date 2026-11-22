#!/usr/bin/env python3
"""Check GPX links, distinguishing missing resources from transient failures."""
import concurrent.futures, datetime, json, pathlib, urllib.request, urllib.error
import xml.etree.ElementTree as ET
ROOT = pathlib.Path(__file__).resolve().parents[1]
DATA = ROOT / "data"
features = json.loads((DATA / "routes.geojson").read_text())["features"]
try:
    previous = json.loads((DATA / "gpx-status.json").read_text()).get("items", {})
except (FileNotFoundError, ValueError):
    previous = {}
def check(feature):
    props = feature["properties"]
    ident, url = props["id"], props.get("gpx")
    stamp = datetime.datetime.now(datetime.timezone.utc).isoformat()
    if not url:
        return ident, {"status": "unavailable", "reason": "Aucun lien", "checkedAt": stamp}
    try:
        request = urllib.request.Request(url, headers={"User-Agent": "RUNdo-GPX-check/1.0", "Accept": "application/gpx+xml,application/xml,*/*"})
        with urllib.request.urlopen(request, timeout=18) as response:
            contents = response.read(5 * 1024 * 1024 + 1)
            status = response.status
        if len(contents) > 5 * 1024 * 1024:
            raise ValueError("Fichier trop volumineux")
        root = ET.fromstring(contents)
        if root.tag.split("}")[-1].lower() != "gpx":
            raise ValueError("Le fichier n'est pas un GPX")
        if not any(x.tag.split("}")[-1] in ("trk", "rte", "wpt") for x in root.iter()):
            raise ValueError("GPX sans trace")
        return ident, {"status": "available", "http": status, "checkedAt": stamp}
    except urllib.error.HTTPError as exc:
        state = "unavailable" if exc.code in (404, 410) else "unknown"
        return ident, {"status": state, "http": exc.code, "checkedAt": stamp}
    except Exception as exc:
        return ident, {"status": "unknown", "reason": str(exc)[:100], "checkedAt": stamp}
with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:
    results = dict(pool.map(check, features))
for ident, result in results.items():
    if result["status"] == "unknown" and previous.get(ident, {}).get("status") in ("available", "unavailable"):
        result["lastKnownStatus"] = previous[ident]["status"]
DATA.mkdir(exist_ok=True)
(DATA / "gpx-status.json").write_text(json.dumps({"checkedAt": datetime.datetime.now(datetime.timezone.utc).isoformat(), "items": results}, ensure_ascii=False, indent=2) + "\n")
print("Checked", len(results), "GPX links")
