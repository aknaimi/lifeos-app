#!/usr/bin/env python3
"""Pings the Life OS database so the free Supabase project never pauses (7 days idle = pause).
Run daily by launchd (com.anton.lifeos-keepalive). A run missed while the Mac sleeps fires on wake."""
import json, pathlib, re, urllib.request, datetime
root = pathlib.Path(__file__).resolve().parent.parent
cfg = (root / "docs" / "config.js").read_text()
url = re.search(r'"url": "([^"]+)"', cfg).group(1)
key = re.search(r'"anonKey": "([^"]+)"', cfg).group(1)
req = urllib.request.Request(url + "/rest/v1/docs?select=id&limit=1", headers={"apikey": key, "Authorization": "Bearer " + key})
try:
    code = urllib.request.urlopen(req, timeout=20).status
except Exception as e:
    code = "error " + type(e).__name__
log = root / ".tmp" / "keepalive.log"
log.parent.mkdir(exist_ok=True)
with log.open("a") as f:
    f.write(datetime.datetime.now().isoformat(timespec="minutes") + " " + str(code) + "\n")
