#!/usr/bin/env python3
"""What Anton wrote and did in Life OS, as one short read for Claude.

Run:  ~/Desktop/Personal/lifeos-app/.venv/bin/python ~/Desktop/Personal/lifeos-app/tools/life_digest.py [--days 7]

Prints markdown to the screen, newest day first: his Tonight lines (wins, grateful) in his
own words, his notes (thoughts), the wins he tapped, wake time, food and gym. Then a totals
block for the window. Read-only. It writes nothing, because the data's home stays the app.
Used by /life (weekly), /monthly-review (--days 31) and any chat that needs Anton's current context.
"""
import collections
import datetime as dt
import sys

from lifeos import conn

COLS = ["tonight", "thoughts", "wins", "wake", "fuel", "weights", "sets", "daily"]


def main(argv):
    days = 7
    if "--days" in argv:
        days = int(argv[argv.index("--days") + 1])
    start = (dt.date.today() - dt.timedelta(days=days - 1)).isoformat()
    by_day = collections.defaultdict(lambda: collections.defaultdict(list))
    with conn() as c, c.cursor() as cur:
        cur.execute("select col, id, data from public.docs where col = any(%s)", (COLS,))
        for col, i, d in cur.fetchall():
            date = str(d.get("date") or (i if len(i) == 10 else "") or str(d.get("at", ""))[:10])
            if date >= start:
                by_day[date][col].append(d)

    tot = collections.Counter()
    out = ["# Life OS, last %d days (from %s)" % (days, start), ""]
    for date in sorted(by_day, reverse=True):
        day = by_day[date]
        name = dt.date.fromisoformat(date).strftime("%a %d %b")
        out.append("## " + name)
        for t in day["tonight"]:
            w = [x.strip() for x in t.get("wins", []) if x and x.strip()]
            g = [x.strip() for x in t.get("grateful", []) if x and x.strip()]
            if w or g:
                tot["tonight nights"] += 1
            if w:
                out.append("- Wins: " + "; ".join(w))
            if g:
                out.append("- Grateful: " + "; ".join(g))
        for th in sorted(day["thoughts"], key=lambda x: str(x.get("at", ""))):
            out.append("- Note%s: %s" % (" [" + th["thread"] + "]" if th.get("thread") else "", th.get("t", "")))
            tot["notes"] += 1
        taps = [w for w in day["wins"] if w.get("key") != "tonight"]
        if taps:
            out.append("- Tapped: " + ", ".join("%s +%s" % (w.get("label"), w.get("xp")) for w in taps))
            for w in taps:
                tot[w.get("key", "?")] += 1
        xp = sum(int(w.get("xp") or 0) for w in day["wins"])
        tot["xp"] += xp
        extra = []
        for w in day["wake"]:
            extra.append("up " + str(w.get("t")))
            tot["wake logs"] += 1
        for f in day["fuel"]:
            done = [k for k, v in f.items() if v is True]
            if done:
                extra.append("food " + ", ".join(done))
        for h in day["daily"]:
            if h.get("done"):
                extra.append("daily " + ", ".join(h["done"]))
        for s in day["sets"]:
            extra.append("gym " + str(s.get("session", "")))
        for wt in day["weights"]:
            extra.append("weight %s kg" % wt.get("kg"))
        if extra or xp:
            out.append("- Day: " + "; ".join(extra + ["%d XP" % xp]))
        out.append("")

    out.append("## Totals")
    out.append(", ".join("%s %s" % (k, v) for k, v in tot.most_common()) or "Nothing logged in this window.")
    print("\n".join(out))


if __name__ == "__main__":
    main(sys.argv)
