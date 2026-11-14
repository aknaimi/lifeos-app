#!/usr/bin/env python3
"""Life OS app database, from the Mac. Claude's side of the phone app.

Run with the project venv:  ~/Desktop/Personal/lifeos-app/.venv/bin/python tools/lifeos.py <cmd>

  setup                    create tables, security rules and live updates (safe to re-run)
  config                   write docs/config.js (project URL + public anon key) for the app
  claim                    make the account Anton signed up with in the app the owner
  seed <dir>               upload a folder of <col>/<id>.json files (the artifact export)
  list <col>               print every doc in a collection as JSON lines
  get <col> <id>           print one doc
  set <col> <id> <json>    replace a doc        (json may be @file.json)
  update <col> <id> <json> merge fields into a doc
  delete <col> <id>        remove a doc
  export <dir>             write every doc to <dir>/<col>/<id>.json

Needs SUPABASE_DB_URL in ~/Desktop/Personal/lifeos-app/.env. Never prints it.
"""
import json
import pathlib
import sys

import psycopg
from psycopg.types.json import Jsonb

ROOT = pathlib.Path(__file__).resolve().parent.parent


def env():
    vals = {}
    f = ROOT / ".env"
    if not f.exists():
        sys.exit("No .env yet in " + str(ROOT) + ". Add SUPABASE_DB_URL there.")
    for line in f.read_text().splitlines():
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            k, v = line.split("=", 1)
            vals[k.strip()] = v.strip().strip('"').strip("'")
    if not vals.get("SUPABASE_DB_URL"):
        sys.exit("SUPABASE_DB_URL is missing from .env.")
    return vals


def write_config():
    e = env()
    if not e.get("SUPABASE_URL") or not e.get("SUPABASE_ANON_KEY"):
        sys.exit("SUPABASE_URL and SUPABASE_ANON_KEY are needed in .env.")
    js = "window.LIFEOS_CONFIG = " + json.dumps({"url": e["SUPABASE_URL"], "anonKey": e["SUPABASE_ANON_KEY"]}) + ";\n"
    (ROOT / "docs" / "config.js").write_text(js)
    print("Wrote docs/config.js")


def conn():
    return psycopg.connect(env()["SUPABASE_DB_URL"], autocommit=True)


def load_json(arg):
    if arg.startswith("@"):
        return json.loads(pathlib.Path(arg[1:]).read_text())
    return json.loads(arg)


def main(argv):
    if len(argv) < 2:
        print(__doc__)
        return
    cmd, a = argv[1], argv[2:]
    if cmd == "config":
        write_config()
        return
    with conn() as c, c.cursor() as cur:
        if cmd == "setup":
            cur.execute((ROOT / "tools" / "schema.sql").read_text())
            print("Tables and rules are in place.")
        elif cmd == "claim":
            cur.execute("select id, email, created_at from auth.users order by created_at")
            users = cur.fetchall()
            if not users:
                sys.exit("No account yet. Sign up in the app first.")
            if len(users) > 1:
                print("More than one account exists; claiming the first one.")
            uid, email, _ = users[0]
            cur.execute("insert into public.owners(uid) values (%s) on conflict do nothing", (uid,))
            cur.execute("update auth.users set email_confirmed_at = coalesce(email_confirmed_at, now()) where id = %s", (uid,))
            print("Owner set: " + email)
        elif cmd == "seed":
            base = pathlib.Path(a[0])
            n = 0
            for f in sorted(base.glob("*/*.json")):
                cur.execute(
                    "insert into public.docs(col,id,data) values (%s,%s,%s) "
                    "on conflict (col,id) do update set data = excluded.data",
                    (f.parent.name, f.stem, Jsonb(json.loads(f.read_text()))),
                )
                n += 1
            print("Uploaded " + str(n) + " docs.")
        elif cmd == "list":
            cur.execute("select id, data from public.docs where col=%s order by id", (a[0],))
            for i, d in cur.fetchall():
                print(json.dumps({"id": i, "data": d}, ensure_ascii=False))
        elif cmd == "get":
            cur.execute("select data from public.docs where col=%s and id=%s", (a[0], a[1]))
            r = cur.fetchone()
            print(json.dumps(r[0], ensure_ascii=False, indent=1) if r else "null")
        elif cmd == "set":
            cur.execute(
                "insert into public.docs(col,id,data) values (%s,%s,%s) "
                "on conflict (col,id) do update set data = excluded.data",
                (a[0], a[1], Jsonb(load_json(a[2]))),
            )
            print("Saved " + a[0] + "/" + a[1])
        elif cmd == "update":
            cur.execute(
                "insert into public.docs(col,id,data) values (%s,%s,%s) "
                "on conflict (col,id) do update set data = public.docs.data || excluded.data",
                (a[0], a[1], Jsonb(load_json(a[2]))),
            )
            print("Updated " + a[0] + "/" + a[1])
        elif cmd == "delete":
            cur.execute("delete from public.docs where col=%s and id=%s", (a[0], a[1]))
            print("Deleted " + a[0] + "/" + a[1])
        elif cmd == "export":
            out = pathlib.Path(a[0])
            cur.execute("select col, id, data from public.docs")
            rows = cur.fetchall()
            for col, i, d in rows:
                p = out / col / (i + ".json")
                p.parent.mkdir(parents=True, exist_ok=True)
                p.write_text(json.dumps(d, ensure_ascii=False, indent=1))
            print("Exported " + str(len(rows)) + " docs to " + str(out))
        else:
            print(__doc__)


if __name__ == "__main__":
    main(sys.argv)
