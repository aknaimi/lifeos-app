/* Life OS app. Data: one Supabase table `docs` (col, id, data), same shapes as the old artifact.
   Opens instantly from a local cache, then syncs; writes made offline wait in a queue. */
(function(){
"use strict";
const CFG = window.LIFEOS_CONFIG || {};
const $ = id => document.getElementById(id);
const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
const pad = n => String(n).padStart(2,"0");
const localIso = d => d.getFullYear()+"-"+pad(d.getMonth()+1)+"-"+pad(d.getDate());
const todayIso = () => localIso(new Date());
const nowIso = () => new Date().toISOString();
function mondayIso(){ const d = new Date(); d.setDate(d.getDate() - ((d.getDay()+6)%7)); return localIso(d); }
const fmt = d => { try{ return new Date(String(d).length === 10 ? d+"T12:00:00" : d).toLocaleDateString("en-GB",{day:"numeric",month:"short"}); }catch(e){ return ""; } };
const rid = () => Math.random().toString(36).slice(2,12) + Date.now().toString(36);
const MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"];
function ls(k, v){ try{ if (v === undefined) return JSON.parse(localStorage.getItem(k) || "null"); localStorage.setItem(k, JSON.stringify(v)); }catch(e){ return null; } }

/* ---------- Store ---------- */
let sb = null, store = ls("lifeos-cache") || {}, queue = ls("lifeos-queue") || [], online = false;
const all = col => Object.entries(store[col] || {}).map(([id, d]) => Object.assign({id}, d));
const get = (col, id) => (store[col] || {})[id] || null;
function persist(){ ls("lifeos-cache", store); ls("lifeos-queue", queue); }
function setSync(t){ const el = $("sync"); el.hidden = !t; el.textContent = t || ""; }
function localWrite(op, col, id, data){
  store[col] = store[col] || {};
  if (op === "del") delete store[col][id]; else store[col][id] = data;
  persist(); render();
}
async function flush(){
  if (!sb || !queue.length) { if (sb) setSync(""); return; }
  setSync("Syncing " + queue.length);
  while (queue.length){
    const w = queue[0];
    try{
      const r = w.op === "del"
        ? await sb.from("docs").delete().eq("col", w.col).eq("id", w.id)
        : await sb.from("docs").upsert({col:w.col, id:w.id, data:w.data});
      if (r.error) throw r.error;
      queue.shift(); persist();
    }catch(e){ setSync("Offline · " + queue.length + " waiting"); return; }
  }
  setSync("");
}
function write(op, col, id, data){
  localWrite(op, col, id, data);
  queue.push({op, col, id, data}); persist();
  flush();
}
const set = (col, id, data) => write("set", col, id, data);
const update = (col, id, patch) => write("set", col, id, Object.assign({}, get(col, id) || {}, patch));
const del = (col, id) => write("del", col, id);
const add = (col, data) => { const id = rid(); set(col, id, data); return id; };

async function pull(){
  if (!sb) return;
  const rows = [];
  for (let from = 0; ; from += 1000){
    const r = await sb.from("docs").select("col,id,data").range(from, from + 999);
    if (r.error) { setSync("Couldn't reach your data"); return; }
    rows.push(...r.data); if (r.data.length < 1000) break;
  }
  const next = {};
  rows.forEach(r => { (next[r.col] = next[r.col] || {})[r.id] = r.data; });
  queue.forEach(w => { next[w.col] = next[w.col] || {}; if (w.op === "del") delete next[w.col][w.id]; else next[w.col][w.id] = w.data; });
  store = next; persist(); render();
}
function live(){
  sb.channel("docs").on("postgres_changes", {event:"*", schema:"public", table:"docs"}, p => {
    const r = p.new && p.new.col ? p.new : p.old;
    if (!r || !r.col) return;
    store[r.col] = store[r.col] || {};
    if (p.eventType === "DELETE") delete store[r.col][r.id]; else store[r.col][r.id] = p.new.data;
    persist(); render();
  }).subscribe();
}

/* ---------- Router ---------- */
const VIEWS = ["home","think","gifts","body","admin"];
let route = "home";
function show(){
  const k = (location.hash || "#home").slice(1); route = VIEWS.includes(k) ? k : "home";
  const authed = !!(sb ? session : true);
  $("v-login").hidden = authed;
  $("tabs").hidden = !authed;
  VIEWS.forEach(v => { $("v-" + v).hidden = !authed || v !== route; });
  document.querySelectorAll(".tabs a").forEach(a => a.classList.toggle("on", a.dataset.tab === route));
  window.scrollTo(0,0); render();
}
window.addEventListener("hashchange", show);

function toast(el, html, undo){
  el.innerHTML = html + (undo ? ' <button type="button">Undo</button>' : "");
  if (undo) el.querySelector("button").onclick = () => { undo(); el.textContent = "Undone."; };
}

/* ---------- Home ---------- */
function home(){ return get("meta","home") || {}; }
function xpNow(){
  const h = home(), pending = all("wins").filter(w => !w.synced).reduce((a,w) => a + (Number(w.xp)||0), 0);
  return (Number(h.xp)||0) + pending;
}
function questsNow(){
  const h = home(); let q = h.quests || null;
  if (h.questsNext && h.questsNext.week && mondayIso() >= h.questsNext.week) q = h.questsNext;
  return q;
}
function renderHome(){
  const h = home(), xp = xpNow(), levels = h.levels || [];
  let cur = levels[0] || {n:1,title:"",xp:0}, nxt = null;
  levels.forEach((l,i) => { if (xp >= l.xp){ cur = l; nxt = levels[i+1] || null; } });
  const top = levels[levels.length-1] || {n:5,xp:1000};
  $("home-updated").textContent = h.updated ? "Updated " + h.updated : "";
  $("home-xp").textContent = Math.round(xp);
  const end = new Date((h.seasonEnd || "2026-12-31") + "T23:59:59"), days = Math.max(0, Math.ceil((end - new Date())/86400000));
  $("home-lvl").textContent = levels.length ? "Level " + cur.n + " of " + top.n + ", " + cur.title + ". " + days + " days left in the " + (h.season || "Takeoff Arc") + "." : "Your score arrives with the first sync.";
  if (nxt){ $("home-bar").style.width = Math.max(0, Math.min(100, Math.round((xp - cur.xp)/(nxt.xp - cur.xp)*100))) + "%"; $("home-tonext").innerHTML = esc(nxt.title) + "<small>" + (nxt.xp - xp) + " XP to go</small>"; }
  else if (levels.length){ $("home-bar").style.width = "100%"; $("home-tonext").textContent = "Top level"; }
  const mon = mondayIso();
  const wk = all("wins").filter(w => String(w.date) >= mon).reduce((a,w) => a + (Number(w.xp)||0), 0) + (Number(h.weekSynced)||0);
  const goal = Math.max(Math.ceil(Math.max(0, top.xp - xp) / Math.max(1, Math.ceil(days/7))), Number(h.weekTarget)||0);
  $("home-pace").innerHTML = wk + " / " + goal + "<small>" + (wk >= goal ? "Target hit" : (goal - wk) + " XP to go") + "</small>";
  $("home-record").innerHTML = (h.bestWeek || 0) + " XP<small>Streak " + (h.streak || 0) + "</small>";
  $("home-focus").textContent = h.focus || "Set on Saturday.";

  const q = questsNow(), qd = get("quests", mon) || {}, done = qd.done || [];
  if (q && q.items && q.items.length){
    $("home-questLab").textContent = "This week's quests · all three = +" + (q.bonus || 50);
    $("home-quests").innerHTML = q.items.map((it,i) => '<button class="quest' + (done.includes(i) ? " done" : "") + '" data-q="' + i + '"><span class="c">' + (done.includes(i) ? "✓" : "") + '</span><span><span class="k">' + esc(it.kind || "") + '</span><span class="qt">' + esc(it.t) + '</span></span></button>').join("")
      + (done.length === q.items.length && !qd.claimed ? '<button class="btn solid" id="home-claim" style="margin-top:10px">Claim the +' + (q.bonus || 50) + ' bonus</button>' : qd.claimed ? '<div class="small" style="margin-top:8px">Bonus claimed.</div>' : "");
  } else $("home-quests").innerHTML = '<div class="empty">Your three quests arrive with Saturday\'s chat.</div>';

  $("home-wins").innerHTML = (h.xpTable || []).map((w,i) => '<button class="chip" data-w="' + i + '">' + esc(w.label) + '<span>+' + w.xp + '</span></button>').join("");

  const open = openGifts();
  $("home-giftLab").textContent = "Gifts · " + open.length + " to get";
  $("home-gifts").innerHTML = open.length ? open.slice(0,8).map(g => giftRow(g, false)).join("") : '<div class="empty">Nothing to get right now.</div>';

  const off = get("meta","offline") || {}, wkOff = get("offline", mon) || {}, offDone = wkOff.done || [];
  const now = new Date(), dow = now.getDay(), hr = now.getHours();
  const isLive = k => (k === "sat" && dow === 6) || (k === "eve" && dow >= 1 && dow <= 5 && hr >= 20);
  $("home-rh").innerHTML = (off.rhythms || []).map(r => '<span' + (isLive(r.k) ? ' class="now"' : '') + '><b>' + esc(r.t) + '</b> · ' + esc(r.w) + (isLive(r.k) ? " · now" : "") + '</span>').join("");
  $("home-strip").innerHTML = (off.recharges || []).map(r => { const on = offDone.includes(r.id), bg = r.img ? "url('" + esc(r.img) + "')" : esc(r.bg || "#555");
    return '<button class="tile' + (on ? " done" : "") + '" data-off="' + esc(r.id) + '" aria-pressed="' + on + '" style="background:' + bg + ';background-size:cover;background-position:center">' + (r.img ? "" : '<span class="em">' + esc(r.em || "") + '</span>') + '<span class="ck">' + (on ? "✓" : "") + '</span><span class="nm">' + esc(r.name) + (on ? "<small>Done this week</small>" : "") + '</span></button>'; }).join("");

  const links = (get("meta","app") || {}).links || [];
  $("home-rooms").innerHTML = links.map(l => '<a class="room" href="' + esc(l.url) + '">' + esc(l.name) + ' <em>' + esc(l.note || "") + '</em></a>').join("") || '<div class="empty">Links to your other rooms arrive with the first sync.</div>';
  if (h.boss){ $("home-bossLab").textContent = "This month · " + (h.boss.month || ""); $("home-boss").textContent = h.boss.name + (h.boss.status === "won" ? " · won" : ""); }
  $("home-badges").innerHTML = (h.badges || []).map(b => '<div class="badge' + (b.earned ? " on" : "") + '"><b>' + esc(b.name) + '</b><span class="small">' + esc(b.earned ? "Earned " + b.earned : (b.how || "")) + '</span>' + (!b.earned && b.of ? '<div class="bprog"><i style="width:' + Math.round((b.have||0)/b.of*100) + '%"></i></div><span class="small">' + (b.have||0) + " of " + b.of + "</span>" : "") + '</div>').join("");
  const yrs = {}; (h.northStar || []).forEach(n => (yrs[n.r] = yrs[n.r] || []).push(n.t));
  $("home-north").innerHTML = Object.keys(yrs).sort().map(y => '<div class="row" style="display:block"><div class="small">' + esc(y) + '</div>' + yrs[y].map(t => '<div class="serif" style="font-size:20px;line-height:1.35">' + esc(t) + '</div>').join("") + '</div>').join("");
  $("home-quote").textContent = h.quote || "";
  $("home-lessons").innerHTML = (h.lessons || []).map(l => '<div class="row" style="display:block">' + esc(l) + '</div>').join("");
  const mine = all("wins").sort((a,b) => String(b.at).localeCompare(String(a.at))).slice(0,6).map(w => ({date:w.date, label:w.label + (w.synced ? "" : " · new"), xp:w.xp}));
  const recent = mine.concat((h.recent || []).slice(0, Math.max(0, 6 - mine.length)));
  $("home-recent").innerHTML = recent.map(r => '<div class="row"><span class="t">' + esc(r.label) + '<span>' + esc(fmt(r.date)) + '</span></span><span class="small">+' + r.xp + '</span></div>').join("") || '<div class="empty">Your recent wins show here.</div>';
}
function logWin(w, toastEl){
  const id = add("wins", {key:w.key, label:w.label, xp:w.xp, date:todayIso(), at:nowIso(), synced:false});
  toast(toastEl, "Logged: " + esc(w.label) + " +" + w.xp, () => del("wins", id));
  return id;
}
function capture(text, toastEl){
  text = String(text || "").trim(); if (!text) return false;
  add("thoughts", {t:text, at:nowIso(), date:todayIso(), thread:"", src:"app"});
  toastEl.textContent = "Saved." + (new Date().getHours() >= 21 ? " It's past 21:00. Phone off?" : "");
  return true;
}
document.addEventListener("click", e => {
  const w = e.target.closest("#home-wins .chip"); if (w){ const it = (home().xpTable || [])[Number(w.dataset.w)]; if (it) logWin(it, $("home-winToast")); return; }
  const q = e.target.closest("#home-quests .quest");
  if (q){ const mon = mondayIso(), qd = Object.assign({}, get("quests", mon) || {}), d = (qd.done || []).slice(), i = Number(q.dataset.q), at = d.indexOf(i); if (at >= 0) d.splice(at,1); else d.push(i); qd.done = d; set("quests", mon, qd); return; }
  if (e.target.closest("#home-claim")){ const q2 = questsNow(), mon = mondayIso(); logWin({key:"quests", label:"Quest stack complete", xp:q2.bonus || 50}, $("home-questToast")); update("quests", mon, {claimed:true}); return; }
  const t = e.target.closest("#home-strip .tile");
  if (t){ const mon = mondayIso(), wk = Object.assign({}, get("offline", mon) || {}), d = (wk.done || []).slice(), at = d.indexOf(t.dataset.off); if (at >= 0) d.splice(at,1); else d.push(t.dataset.off); wk.done = d; set("offline", mon, wk); $("home-offToast").textContent = at >= 0 ? "" : "Marked. Good for you."; return; }
  const buy = e.target.closest("[data-buy]");
  if (buy){ const g = get("giftIdeas", buy.dataset.buy); if (!g) return; const id = buy.dataset.buy, now = nowIso();
    update("giftIdeas", id, {bought:true, boughtAt:now});
    const wid = add("wins", {key:"gift", label:"Gift · " + g.who, xp:20, date:now.slice(0,10), at:now, synced:false});
    toast(buy.closest(".panel").querySelector(".toast"), "Done: " + esc(g.who) + ". +20 XP", () => { del("wins", wid); update("giftIdeas", id, {bought:false}); }); return; }
  const gx = e.target.closest("[data-gdel]");
  if (gx){ const id = gx.dataset.gdel, keep = get("giftIdeas", id); del("giftIdeas", id); toast(gx.closest(".panel").querySelector(".toast"), "Deleted.", () => set("giftIdeas", id, keep)); return; }
});
$("home-capGo").addEventListener("click", () => { if (capture($("home-cap").value, $("home-capToast"))) $("home-cap").value = ""; });
$("home-cap").addEventListener("keydown", e => { if (e.key === "Enter") $("home-capGo").click(); });

/* ---------- Gifts and birthdays ---------- */
const openGifts = () => all("giftIdeas").filter(g => !g.given && !g.bought).sort((a,b) => String(b.at).localeCompare(String(a.at)));
function giftRow(g, full){
  const done = g.given || g.bought;
  return '<div class="row"' + (done ? ' style="opacity:.55"' : '') + '><span class="t"><b style="font-weight:500">' + esc(g.who) + '</b> · ' + esc(g.t) + '<span>' + (done ? "done " + esc(fmt(g.boughtAt || g.givenAt || g.at)) : "saved " + esc(fmt(g.at))) + '</span></span><span style="display:flex;align-items:center;gap:2px">' + (done ? "" : '<button class="btn solid sm" data-buy="' + esc(g.id) + '">Bought · +20</button>') + (full ? '<button class="x" data-gdel="' + esc(g.id) + '" aria-label="Delete idea for ' + esc(g.who) + '">×</button>' : "") + '</span></div>';
}
function people(){
  const m = new Map(), P = get("meta","people") || {};
  (P.people || []).forEach(p => m.set(p.name.toLowerCase(), Object.assign({}, p)));
  all("birthdays").forEach(a => { if (!m.has(a.name.toLowerCase())) m.set(a.name.toLowerCase(), {name:a.name, m:a.m, d:a.d, fresh:!a.synced, bid:a.id}); });
  const t = new Date(); t.setHours(0,0,0,0);
  return [...m.values()].map(p => { let n = new Date(t.getFullYear(), p.m-1, p.d); if (n < t) n = new Date(t.getFullYear()+1, p.m-1, p.d); return Object.assign(p, {next:n, days:Math.round((n - t)/86400000)}); }).sort((a,b) => a.days - b.days);
}
const inText = n => n === 0 ? "Today" : n === 1 ? "Tomorrow" : "in " + n + " days";
function renderGifts(){
  const open = openGifts(), done = all("giftIdeas").filter(g => g.given || g.bought).sort((a,b) => String(b.boughtAt || b.givenAt || "").localeCompare(String(a.boughtAt || a.givenAt || ""))).slice(0,6);
  $("gifts-openLab").textContent = "To get · " + open.length;
  $("gifts-open").innerHTML = open.map(g => giftRow(g, true)).join("") || '<div class="empty">Nothing to get. Save the next idea above.</div>';
  $("gifts-done").innerHTML = done.map(g => giftRow(g, true)).join("");
  $("gifts-doneWrap").hidden = !done.length;
  const ps = people(), nx = ps.find(p => !p.gentle) || ps[0];
  $("gifts-names").innerHTML = ps.map(p => '<option value="' + esc(p.name) + '">').join("");
  if (nx){ const ideas = open.filter(g => g.who.toLowerCase() === nx.name.toLowerCase());
    $("gifts-next").innerHTML = '<div class="small">Next birthday · ' + esc(inText(nx.days)) + '</div><div class="h" style="margin:6px 0">' + esc(nx.name) + '</div><div class="small">' + nx.next.getDate() + " " + MONTHS[nx.next.getMonth()] + (ideas.length ? " · you saved: " + esc(ideas.map(i => i.t).join(", ")) : nx.days <= 14 ? " · time to pick a gift" : " · no idea saved yet") + '</div>'; }
  else $("gifts-next").innerHTML = '<div class="empty">Birthdays show here after the first sync.</div>';
  let last = -1;
  $("bday-list").innerHTML = ps.map(p => { const mo = p.next.getMonth(), head = mo !== last ? '<div class="mon">' + MONTHS[mo] + '</div>' : ""; last = mo;
    return head + '<div class="bday' + (p.days <= 14 && !p.gentle ? " soon" : "") + '"><span class="d">' + p.d + '</span><span>' + esc(p.name) + (p.fresh ? '<span class="small" style="display:block">pings added on Saturday</span>' : "") + '</span><span class="in">' + esc(inText(p.days)) + '</span></div>'; }).join("");
}
$("bday-day").innerHTML = '<option value="">Day</option>' + [...Array(31)].map((_,i) => "<option>" + (i+1) + "</option>").join("");
$("bday-month").innerHTML = '<option value="">Month</option>' + MONTHS.map((m,i) => '<option value="' + (i+1) + '">' + m.slice(0,3) + "</option>").join("");
$("gifts-form").addEventListener("submit", e => { e.preventDefault();
  const who = $("gifts-who").value.trim(), t = $("gifts-idea").value.trim();
  if (!who || !t){ $("gifts-toast").textContent = "Add who it's for and the idea."; return; }
  const id = add("giftIdeas", {who, t, at:nowIso(), given:false});
  $("gifts-who").value = ""; $("gifts-idea").value = "";
  toast($("gifts-toast"), "Saved for " + esc(who) + ".", () => del("giftIdeas", id)); });
$("bday-form").addEventListener("submit", e => { e.preventDefault();
  const name = $("bday-name").value.trim(), d = Number($("bday-day").value), m = Number($("bday-month").value);
  if (!name || !d || !m){ $("bday-toast").textContent = "Add a name, a day and a month."; return; }
  if (new Date(2024, m-1, d).getMonth() !== m-1){ $("bday-toast").textContent = MONTHS[m-1] + " doesn't have a " + d + "."; return; }
  const id = add("birthdays", {name, m, d, note:"", at:nowIso(), synced:false});
  $("bday-name").value = ""; $("bday-day").value = ""; $("bday-month").value = "";
  toast($("bday-toast"), "Saved " + esc(name) + ", " + d + " " + MONTHS[m-1] + ".", () => del("birthdays", id)); });

/* ---------- Think ---------- */
let openThread = null;
function renderThink(){
  const meta = get("meta","think") || {}, threads = all("threads"), thoughts = all("thoughts");
  $("think-why").textContent = meta.why || "";
  const liveT = threads.filter(t => t.state !== "landed" && t.state !== "letgo").sort((a,b) => (a.order||0) - (b.order||0));
  const count = t => thoughts.filter(x => x.thread === t.id).length + (Number(t.base)||0);
  $("think-threads").innerHTML = liveT.map(t => { const n = count(t), notes = thoughts.filter(x => x.thread === t.id).sort((a,b) => String(b.at).localeCompare(String(a.at)));
    return '<details class="th" data-id="' + esc(t.id) + '"' + (openThread === t.id ? " open" : "") + '><summary><span><span class="tt">' + esc(t.title) + '</span><span class="small" style="display:block">' + n + (n === 1 ? " note" : " notes") + (t.state === "ripe" || n >= (t.ripeAt || 6) ? " · ripe" : "") + '</span></span><span class="rb"><i style="width:' + Math.min(100, Math.round(n/(t.ripeAt||6)*100)) + '%"></i></span></summary>' + (t.q ? '<p class="serif" style="font-size:18px;color:var(--muted);margin:0 0 10px">' + esc(t.q) + '</p>' : "") + notes.map(x => '<div class="note">' + esc(x.t) + '<span>' + esc(fmt(x.at)) + '</span></div>').join("") + '</details>'; }).join("") || '<div class="empty">Your threads show here.</div>';
  const loose = thoughts.filter(x => !x.thread).sort((a,b) => String(b.at).localeCompare(String(a.at)));
  $("think-looseWrap").hidden = !loose.length;
  $("think-loose").innerHTML = loose.map(x => '<div class="note">' + esc(x.t) + '<span>' + esc(fmt(x.at)) + '</span><div class="chips" style="margin-top:6px">' + liveT.map(t => '<button class="btn sm" data-file="' + esc(x.id) + '" data-to="' + esc(t.id) + '">' + esc(t.title) + '</button>').join("") + '</div></div>').join("");
  const landed = threads.filter(t => t.state === "landed" || t.state === "letgo");
  $("think-landed").innerHTML = landed.map(t => '<div class="row" style="display:block"><div class="pill">' + esc((t.landing||{}).kind || "let go") + '</div><b style="font-weight:500">' + esc(t.title) + '</b><div>' + esc((t.landing||{}).t || "") + '</div></div>').join("") || '<div class="empty">Nothing landed yet.</div>';
}
$("think-save").addEventListener("click", () => { if (capture($("think-text").value, $("think-toast"))) $("think-text").value = ""; });
document.addEventListener("click", e => { const c = e.target.closest("[data-file]"); if (c) update("thoughts", c.dataset.file, {thread:c.dataset.to, filedBy:"you"}); });
document.addEventListener("toggle", e => { const d = e.target; if (d && d.matches && d.matches(".th")) openThread = d.open ? d.dataset.id : (openThread === d.dataset.id ? null : openThread); }, true);

/* ---------- Health ---------- */
let pick = null, draft = {};
function weekDays(){ const m = new Date(); m.setDate(m.getDate() - ((m.getDay()+6)%7)); return [...Array(7)].map((_,i) => { const d = new Date(m); d.setDate(m.getDate()+i); return d; }); }
function lastFor(n){ const sets = all("sets").sort((a,b) => String(b.at).localeCompare(String(a.at))); for (const s of sets){ const e = (s.ex||[]).find(x => x.n === n && x.kg != null); if (e) return e; } return null; }
function renderBody(){
  const b = get("meta","body") || {}, days = weekDays(), isos = days.map(localIso);
  const gyms = all("wins").filter(w => w.key === "gym" || w.key === "padel"), wk = gyms.filter(g => isos.includes(g.date));
  $("body-updated").textContent = b.updated ? "Updated " + b.updated : "";
  $("body-weekLab").textContent = "This week · " + wk.length + " of " + (b.minPerWeek || 2) + " minimum";
  $("body-week").innerHTML = days.map(d => { const di = localIso(d), g = wk.find(x => x.date === di); return '<div class="day' + (g ? " on" : "") + (di === todayIso() ? " today" : "") + '">' + d.toLocaleDateString("en-GB",{weekday:"short"}) + '<b>' + (g ? (g.key === "padel" ? "P" : (g.session || "✓")) : d.getDate()) + '</b></div>'; }).join("");
  const plan = b.plan || [], lastG = gyms.filter(g => g.session).sort((a,c) => String(c.at).localeCompare(String(a.at)))[0];
  let ni = plan.findIndex(p => p.id === (lastG ? lastG.session : b.lastSession)); ni = plan.length ? (ni + 1) % plan.length : -1;
  const sel = plan.find(p => p.id === pick) || plan[ni];
  $("body-picks").innerHTML = plan.map((p,i) => '<button class="pick' + (sel && p.id === sel.id ? " on" : "") + '" data-pick="' + esc(p.id) + '"><b>' + esc(p.id) + '</b><span>' + esc(i === ni ? "Next up" : (p.short || "")) + '</span></button>').join("");
  if (!document.activeElement || !document.activeElement.classList.contains("num"))
    $("body-ex").innerHTML = sel ? (sel.exercises || []).map(e => { const l = lastFor(e.n), d = draft[e.n] || {};
      return '<div class="ex"><span class="t">' + esc(e.n) + '<span>' + esc(e.s) + (l ? " · last " + l.kg + " kg × " + l.reps : "") + '</span></span><span style="display:flex;gap:6px"><input class="num" data-n="' + esc(e.n) + '" data-f="kg" type="number" step="0.5" inputmode="decimal" placeholder="kg" aria-label="' + esc(e.n) + ' kg" value="' + esc(d.kg ?? (l ? l.kg : "")) + '"><input class="num" data-n="' + esc(e.n) + '" data-f="reps" type="number" inputmode="numeric" placeholder="reps" aria-label="' + esc(e.n) + ' reps" value="' + esc(d.reps ?? "") + '" style="width:58px"></span></div>'; }).join("") : '<div class="empty">Your plan shows here after the first sync.</div>';
  const F = b.fuelItems || [{k:"breakfast",t:"Breakfast",w:"The whole thing"},{k:"lunch",t:"Protein lunch",w:"Palm of meat or fish"},{k:"dinner",t:"Protein dinner",w:"Palm of meat or fish"},{k:"shake",t:"Shake or snack",w:"Closes the 165 g"}];
  const td = get("fuel", todayIso()) || {};
  $("body-fuelN").textContent = F.filter(f => td[f.k]).length + "/" + F.length;
  $("body-fuel").innerHTML = F.map(f => '<button class="pick' + (td[f.k] ? " on" : "") + '" data-fuel="' + esc(f.k) + '"><b style="font-size:20px">' + esc(f.t) + '</b><span>' + esc(td[f.k] ? "Done" : f.w) + '</span></button>').join("");
  $("body-rules").innerHTML = (b.rules || []).map(r => '<div class="row" style="display:block"><b style="font-weight:500">' + esc(r.t) + '</b><div class="small">' + esc(r.w || "") + '</div></div>').join("");
  return sel;
}
document.addEventListener("click", e => {
  const p = e.target.closest("[data-pick]"); if (p){ pick = p.dataset.pick; draft = {}; render(); return; }
  const f = e.target.closest("[data-fuel]"); if (f){ const d = todayIso(), cur = Object.assign({}, get("fuel", d) || {}); cur[f.dataset.fuel] = !cur[f.dataset.fuel]; cur.date = d; set("fuel", d, cur); }
});
$("body-ex").addEventListener("input", e => { const i = e.target.closest(".num"); if (!i) return; (draft[i.dataset.n] = draft[i.dataset.n] || {})[i.dataset.f] = i.value === "" ? "" : Number(i.value); });
$("body-finish").addEventListener("click", () => {
  const sel = renderBody(); if (!sel) return;
  const ex = []; document.querySelectorAll("#body-ex .num[data-f=kg]").forEach(i => { const r = document.querySelector('#body-ex .num[data-f=reps][data-n="' + CSS.escape(i.dataset.n) + '"]'); const kg = i.value === "" ? null : Number(i.value), reps = r && r.value !== "" ? Number(r.value) : null; if (reps != null) ex.push({n:i.dataset.n, kg, reps}); });
  const at = nowIso(), sid = add("sets", {date:todayIso(), at, session:sel.id, ex});
  const wid = add("wins", {key:"gym", label:"Gym · " + sel.id, session:sel.id, xp:10, date:todayIso(), at, synced:false});
  draft = {}; pick = null;
  toast($("body-toast"), esc(sel.id) + " logged, " + ex.length + " exercises. +10 XP", () => { del("wins", wid); del("sets", sid); });
});
$("body-padel").addEventListener("click", () => logWin({key:"padel", label:"Padel", xp:10}, $("body-toast")));
$("body-saveKg").addEventListener("click", () => { const v = parseFloat($("body-kg").value);
  if (!(v >= 40 && v <= 150)){ $("body-kgToast").textContent = "Enter your weight in kg, like 76.4."; return; }
  set("weights", todayIso(), {date:todayIso(), kg:Math.round(v*10)/10, synced:false}); $("body-kg").value = ""; $("body-kgToast").textContent = "Saved " + (Math.round(v*10)/10) + " kg."; });

/* ---------- Admin ---------- */
function renderAdmin(){
  const steps = all("admin").sort((a,b) => (a.order||0) - (b.order||0)), done = steps.filter(s => s.state === "done");
  $("admin-count").textContent = steps.length ? done.length + " of " + steps.length + " done" : "";
  $("admin-bar").style.width = steps.length ? Math.round(done.length/steps.length*100) + "%" : "0%";
  const nx = steps.find(s => s.state === "you") || steps.find(s => s.state === "due");
  $("admin-next").innerHTML = nx ? '<div class="small">Next for you · ' + esc(nx.date || "") + '</div><div class="serif" style="font-size:24px;line-height:1.2">' + esc(nx.t) + '</div><div class="small">' + esc(nx.w || "") + '</div>' : '<div class="serif" style="font-size:24px">Nothing on you right now</div>';
  const row = s => '<div class="step' + (s.state === "done" ? " done" : "") + '"><button class="tick' + (s.state === "done" ? " on" : "") + '" data-tick="' + esc(s.id) + '" aria-label="' + (s.state === "done" ? "Mark not done: " : "Mark done: ") + esc(s.t) + '">' + (s.state === "done" ? "✓" : "") + '</button><span class="t"><b style="font-weight:500">' + esc(s.t) + '</b><span>' + esc([s.date, s.w].filter(Boolean).join(" · ")) + '</span>' + (s.state === "you" || s.state === "due" ? '<span class="pill you">On you</span>' : "") + '</span></div>';
  $("admin-road").innerHTML = steps.filter(s => s.state !== "done").map(row).join("") || '<div class="empty">All clear.</div>';
  $("admin-done").innerHTML = done.map(row).join("");
}
document.addEventListener("click", e => { const t = e.target.closest("[data-tick]"); if (!t) return; const s = get("admin", t.dataset.tick); if (!s) return;
  if (s.state === "done") update("admin", t.dataset.tick, {state:s.prev || "you", tickedByYou:false});
  else update("admin", t.dataset.tick, {prev:s.state, state:"done", tickedByYou:true, doneAt:todayIso()}); });

/* ---------- Render ---------- */
let raf = 0;
function render(){ cancelAnimationFrame(raf); raf = requestAnimationFrame(() => {
  if (route === "home") renderHome(); else if (route === "think") renderThink(); else if (route === "gifts") renderGifts(); else if (route === "body") renderBody(); else if (route === "admin") renderAdmin();
}); }

/* ---------- Boot ---------- */
let session = null;
async function boot(){
  if (window.supabase && CFG.url && CFG.anonKey){
    sb = window.supabase.createClient(CFG.url, CFG.anonKey, {auth:{persistSession:true, autoRefreshToken:true}});
    const r = await sb.auth.getSession(); session = r.data.session;
    sb.auth.onAuthStateChange((_e, s) => { const was = !!session; session = s; if (s && !was){ show(); pull(); live(); flush(); } else if (!s) show(); });
    show();
    if (session){ pull(); live(); flush(); }
    window.addEventListener("online", flush);
    document.addEventListener("visibilitychange", () => { if (!document.hidden && session){ pull(); flush(); } });
  } else {
    // Preview mode: no database configured. Loads a local copy if one sits next to the app.
    if (!Object.keys(store).length){ try{ const r = await fetch("seed.local.json"); if (r.ok){ store = await r.json(); persist(); } }catch(e){} }
    setSync("Preview · not synced"); show();
  }
}
$("login-form").addEventListener("submit", async e => { e.preventDefault();
  if (!sb) return; const r = await sb.auth.signInWithPassword({email:$("login-email").value.trim(), password:$("login-pass").value});
  $("login-toast").textContent = r.error ? "That didn't work: " + r.error.message : ""; });
$("login-new").addEventListener("click", async () => {
  if (!sb) return; const email = $("login-email").value.trim(), password = $("login-pass").value;
  if (!email || password.length < 8){ $("login-toast").textContent = "Type your email and a password of 8 or more characters first."; return; }
  const r = await sb.auth.signUp({email, password});
  $("login-toast").textContent = r.error ? "That didn't work: " + r.error.message : "Account created. Tell Claude, it unlocks your data in a minute.";
});
// Tap any room title to pull the latest from the database.
document.querySelectorAll(".brand").forEach(b => { b.style.cursor = "pointer"; b.title = "Tap to refresh"; b.addEventListener("click", async () => { if (!sb || !session) return; setSync("Refreshing"); await flush(); await pull(); setSync("Up to date"); setTimeout(() => setSync(""), 1200); }); });
if ("serviceWorker" in navigator && location.protocol === "https:") navigator.serviceWorker.register("sw.js").catch(() => {});
boot();
})();
