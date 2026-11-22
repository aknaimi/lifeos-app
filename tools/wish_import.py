#!/usr/bin/env python3
"""One-off: move the old claude.ai Wishlist board into the app.

  wish_import.py <items.json> <img_dir> <picks.json>

items.json: [{id, cat, brand, name, pr, price, url, why, tag, img}] scraped from the old board.
picks.json: {id: state} (want / bought / pass).
Shrinks each photo to 480px, uploads it to the public Supabase storage bucket `wish`
(product photos only, no personal data), and writes one `wish` doc per item.
Needs SUPABASE_URL and SUPABASE_SERVICE_KEY in .env. Never prints them.
"""
import json, pathlib, subprocess, sys, tempfile, urllib.error, urllib.request
sys.path.insert(0, str(pathlib.Path(__file__).parent))
import lifeos

E = lifeos.env()
URL, KEY = E["SUPABASE_URL"].rstrip("/"), E["SUPABASE_SERVICE_KEY"]
H = {"apikey": KEY, "Authorization": "Bearer " + KEY}


def call(method, path, body=None, ctype="application/json"):
    data = body if isinstance(body, (bytes, type(None))) else json.dumps(body).encode()
    req = urllib.request.Request(URL + path, data=data, method=method, headers=dict(H, **{"Content-Type": ctype, "x-upsert": "true"}))
    try:
        return urllib.request.urlopen(req, timeout=30).status
    except urllib.error.HTTPError as e:
        return e.code


def main(items_p, img_dir, picks_p):
    items = json.loads(pathlib.Path(items_p).read_text())
    picks = json.loads(pathlib.Path(picks_p).read_text())
    call("POST", "/storage/v1/bucket", {"id": "wish", "name": "wish", "public": True})
    with tempfile.TemporaryDirectory() as tmp, lifeos.conn() as c, c.cursor() as cur:
        for i, it in enumerate(items):
            img = ""
            if it.get("img"):
                src = pathlib.Path(img_dir) / it["img"].split("/")[-1]
                out = pathlib.Path(tmp) / (it["id"] + ".jpg")
                subprocess.run(["sips", "-s", "format", "jpeg", "-s", "formatOptions", "70", "-Z", "480", str(src), "--out", str(out)], capture_output=True, check=True)
                code = call("POST", "/storage/v1/object/wish/" + out.name, out.read_bytes(), "image/jpeg")
                if code in (200, 201):
                    img = URL + "/storage/v1/object/public/wish/" + out.name
                else:
                    print("upload failed", it["id"], code)
            doc = {k: it.get(k, "") for k in ("cat", "brand", "name", "pr", "url", "why", "tag")}
            doc.update(price=float(it["price"]) if it.get("price") else None, img=img, order=i,
                       state=picks.get(it["id"], it.get("state", "")), at=it.get("at", "2026-10-10"))
            cur.execute("insert into public.docs(col,id,data) values (%s,%s,%s) on conflict (col,id) do update set data = excluded.data", ("wish", it["id"], lifeos.Jsonb(doc)))
    print("imported", len(items))


if __name__ == "__main__":
    main(*sys.argv[1:4])
