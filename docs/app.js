/* Life OS app, version 5. Data: one Supabase table `docs` (col, id, data).
   Opens instantly from a local cache, then syncs; writes made offline wait in a queue.
   Rooms: Home, Tonight, Health, Money, Think, People, Wishlist, Admin. */
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
const dayName = d => new Date(d+"T12:00:00").toLocaleDateString("en-GB",{weekday:"short",day:"numeric",month:"short"});
const rid = () => Math.random().toString(36).slice(2,12) + Date.now().toString(36);
const MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"];
const eur = n => "€" + Math.round(n).toLocaleString("en-GB");
const num = s => { const m = String(s||"").replace(/,/g,"").match(/-?\d+(\.\d+)?/); return m ? Number(m[0]) : 0; };
function ls(k, v){ try{ if (v === undefined) return JSON.parse(localStorage.getItem(k) || "null"); localStorage.setItem(k, JSON.stringify(v)); }catch(e){ return null; } }

/* ---------- Store ---------- */
let sb = null, store = ls("lifeos-cache") || {}, queue = ls("lifeos-queue") || [];
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
function write(op, col, id, data){ localWrite(op, col, id, data); queue.push({op, col, id, data}); persist(); flush(); }
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
const VIEWS = ["home","tonight","body","money","think","people","wish","admin"];
const TAB_OF = {tonight:"home", wish:"people"};
let route = "home";
function show(){
  let k = (location.hash || "#home").slice(1); if (k === "gifts") k = "people";
  route = VIEWS.includes(k) ? k : "home";
  const authed = !!(sb ? session : true);
  $("v-login").hidden = authed;
  $("tabs").hidden = !authed;
  VIEWS.forEach(v => { $("v-" + v).hidden = !authed || v !== route; });
  const tab = TAB_OF[route] || route;
  document.querySelectorAll(".tabs a").forEach(a => a.classList.toggle("on", a.dataset.tab === tab));
  window.scrollTo(0,0); render();
}
window.addEventListener("hashchange", show);
function toast(el, html, undo){
  el.innerHTML = html + (undo ? ' <button type="button">Undo</button>' : "");
  if (undo) el.querySelector("button").onclick = () => { undo(); el.textContent = "Undone."; };
}
function pop(xp, el){
  const fx = $("fx"); if (!fx) return; const r = el && el.getBoundingClientRect ? el.getBoundingClientRect() : {left:innerWidth/2, top:innerHeight/2, width:0};
  const b = document.createElement("span"); b.className = "plus"; b.textContent = typeof xp === "number" ? "+" + xp : xp; b.style.left = (r.left + r.width/2) + "px"; b.style.top = (r.top) + "px"; fx.appendChild(b); setTimeout(() => b.remove(), 1100);
  if (el && el.classList){ el.classList.remove("popped"); void el.offsetWidth; el.classList.add("popped"); }
  if (navigator.vibrate) try{ navigator.vibrate(12); }catch(e){}
}
function logWin(w, toastEl, el){
  const id = add("wins", {key:w.key, label:w.label, xp:w.xp, date:todayIso(), at:nowIso(), synced:false});
  pop(w.xp, el);
  if (toastEl) toast(toastEl, "Logged: " + esc(w.label) + " +" + w.xp, () => del("wins", id));
  return id;
}
function capture(text, toastEl){
  text = String(text || "").trim(); if (!text) return false;
  add("thoughts", {t:text, at:nowIso(), date:todayIso(), thread:"", src:"app"});
  toastEl.textContent = "Saved." + (new Date().getHours() >= 21 ? " It's past 21:00. Phone off?" : "");
  return true;
}

/* ---------- Home ---------- */
const home = () => get("meta","home") || {};
function xpNow(){ const pending = all("wins").filter(w => !w.synced).reduce((a,w) => a + (Number(w.xp)||0), 0); return (Number(home().xp)||0) + pending; }
function questsNow(){ const h = home(); let q = h.quests || null; if (h.questsNext && h.questsNext.week && mondayIso() >= h.questsNext.week) q = h.questsNext; return q; }
const MORE_WINS = [
  {key:"read",label:"Read 20 pages",xp:10},{key:"post",label:"Posted on X or LinkedIn",xp:20},{key:"nidra",label:"Yoga Nidra",xp:10},
  {key:"up6",label:"Up at 06:00",xp:10},{key:"phonefree",label:"Phone-free morning",xp:20},{key:"offday",label:"Offline day",xp:30},
  {key:"sauna",label:"Sauna",xp:10},{key:"family",label:"Called family",xp:10},{key:"giftsent",label:"Sent a gift",xp:20},
  {key:"prep",label:"Cooked or prep day",xp:10},{key:"pen",label:"Wrote with a pen",xp:10},{key:"learn",label:"Learned something new",xp:10},
  {key:"museum",label:"Museum or gallery",xp:20},{key:"kind",label:"Was kind to myself",xp:10}];
const MAIN8 = ["gym","padel","opener","date","phoneoff","spont","event","journal"], SKIP = ["pocket3","admin","gift"];
function winButtons(){ const m = get("meta","winButtons"); if (m && m.items) return m.items; const t = home().xpTable || []; return MAIN8.map(k => t.find(w => w.key === k)).filter(Boolean).map(w => ({key:w.key, label:w.key === "gym" ? "Gym" : w.key === "phoneoff" ? "Phone off 21:00" : w.label, xp:w.key === "gym" ? 20 : w.xp})); }
function moreWins(){ const mine = winButtons().map(w => w.key), t = (home().xpTable || []).filter(w => !SKIP.includes(w.key)).map(w => ({key:w.key, label:w.label, xp:w.xp})); const pool = t.concat(MORE_WINS.filter(w => !t.find(x => x.key === w.key))); return pool.filter(w => !mine.includes(w.key)); }
function saveButtons(items){ set("meta","winButtons",{items, updated:todayIso()}); }

function levelInfo(xp){
  const levels = home().levels || []; let cur = levels[0] || {n:1,title:"",xp:0}, nxt = null;
  levels.forEach((l,i) => { if (xp >= l.xp){ cur = l; nxt = levels[i+1] || null; } });
  return {levels, cur, nxt};
}
function tonightDoc(d){ return get("tonight", d || todayIso()) || {}; }
function tonightDays(){ return all("tonight").filter(t => t.done).map(t => t.id).sort(); }
function wakeUntil(){ return home().wakeUntil || ""; }

function renderHome(){
  const h = home(), xp = xpNow(), {levels, cur, nxt} = levelInfo(xp), top = levels[levels.length-1] || {xp:1000};
  $("home-date").textContent = new Date().toLocaleDateString("en-GB",{weekday:"long",day:"numeric",month:"short"});
  $("home-xp").textContent = Math.round(xp);
  const pct = nxt ? Math.max(0, Math.min(100, Math.round((xp - cur.xp)/(nxt.xp - cur.xp)*100))) : 100;
  $("home-ring").style.setProperty("--p", pct + "%");
  $("home-lvl").innerHTML = levels.length ? esc(cur.title) + (nxt ? "<br>" + (nxt.xp - xp) + " to " + esc(nxt.title) : "<br>top level") : "Your score arrives with the first sync.";
  const end = new Date((h.seasonEnd || "2026-12-31") + "T23:59:59"), days = Math.max(0, Math.ceil((end - new Date())/86400000));
  $("home-tonext").innerHTML = nxt ? esc(nxt.title) + "<small>at " + nxt.xp + " XP</small>" : "Top level";
  const mon = mondayIso(), wk = all("wins").filter(w => String(w.date) >= mon).reduce((a,w) => a + (Number(w.xp)||0), 0) + (Number(h.weekSynced)||0);
  const goal = Math.max(Math.ceil(Math.max(0, top.xp - xp) / Math.max(1, Math.ceil(days/7))), Number(h.weekTarget)||0);
  $("home-pace").innerHTML = wk + " / " + goal + "<small>" + (wk >= goal ? "Target hit" : (goal - wk) + " to go") + "</small>";
  $("home-record").innerHTML = (h.bestWeek || 0) + " XP<small>" + days + " days left</small>";
  const earned = (h.badges || []).filter(x => x.earned).length;
  $("home-bonus").innerHTML = (h.boss ? '<span class="bchip"><b>Boss</b> ' + esc(h.boss.name) + (h.boss.status === "won" ? " ✓" : "") + '</span>' : "") + '<span class="bchip"><b>' + earned + '</b> badges</span>';

  // Tonight card
  const td = tonightDoc(), wn = (td.wins||[]).filter(Boolean).length, gn = (td.grateful||[]).filter(Boolean).length, tdx = td.xp != null ? td.xp : 2*Math.min(wn+gn, 8), done = tonightDays();
  const dayN = done.includes(todayIso()) ? done.length : done.length + 1;
  $("home-tonight").innerHTML = '<div class="lab"><span>Tonight' + (new Date().getHours() < 18 ? " · from 18:00" : "") + '</span><span>day ' + Math.min(dayN,30) + ' of 30</span></div><div class="focus-s">' + (td.done ? "Saved tonight · +" + tdx : "Today's wins, no matter how small") + '</div><div class="small">' + (td.done ? wn + ' wins · ' + gn + ' grateful · tap to add' : '5 wins · 3 grateful · +2 a line')  + '</div>';

  // Quests (only this week's; stale ones hide until Saturday)
  const q = questsNow(), qd = get("quests", mon) || {}, qdone = qd.done || [];
  const fresh = q && q.week && q.week >= localIso(new Date(new Date(mon+"T12:00:00").getTime() - 6*86400000));
  if (q && q.items && q.items.length && fresh){
    $("home-questLab").innerHTML = "<span>This week's quests · " + qdone.length + " of " + q.items.length + "</span><span>+" + (q.bonus || 50) + " if all</span>";
    $("home-quests").innerHTML = q.items.map((it,i) => '<button class="quest' + (qdone.includes(i) ? " done" : "") + '" data-q="' + i + '"><span class="c">' + (qdone.includes(i) ? "✓" : "") + '</span><span class="qt">' + esc(it.t) + '</span></button>').join("")
      + (qdone.length === q.items.length && !qd.claimed ? '<button class="btn solid" id="home-claim" style="margin-top:10px">Claim the +' + (q.bonus || 50) + ' bonus</button>' : qd.claimed ? '<div class="small" style="margin-top:8px">Bonus claimed.</div>' : "");
  } else { $("home-questLab").textContent = "This week's quests"; $("home-quests").innerHTML = '<div class="empty">New quests arrive with Saturday\'s /life.</div>'; }

  // Tiles
  const b = get("meta","body") || {}, isos = weekDays().map(localIso);
  const gymN = all("wins").filter(w => (w.key === "gym" || w.key === "padel") && isos.includes(w.date)).length;
  const m = get("meta","money") || {}, subs = subsTotal(m);
  const nb = people()[0];
  let fourth;
  if (todayIso() <= wakeUntil()){
    const wd = isos.map(d => get("wake", d)), today = get("wake", todayIso());
    const hgt = t => { if (!t) return 0; const [H,M] = t.split(":").map(Number), mins = H*60+M; return Math.max(12, Math.min(100, 100 - (mins - 330)/3)); };
    fourth = '<button class="tile3 wake" id="home-wake"><div class="hd"><span>Wake · goal 06:00</span></div><div class="wbars">' + wd.map((w,i) => '<span class="wb' + (w ? (w.t <= "06:15" ? " ok" : " late") : "") + (isos[i] === todayIso() ? " today" : "") + '"><i style="height:' + (w ? hgt(w.t) : 8) + '%"></i><em>' + "MTWTFSS"[i] + '</em></span>').join("") + '</div><div class="small">' + (today ? "Up at <b>" + esc(today.t) + "</b> today" : "Tap when you're up") + '</div></button>';
  } else {
    const steps = all("admin"), nx = steps.filter(s => s.state !== "done").sort((a,c) => (a.order||0)-(c.order||0)).find(s => s.state === "you" || s.state === "due");
    fourth = '<a class="tile3" href="#admin"><div class="hd"><span>Admin</span><span>›</span></div><div><div class="n">' + esc(nx ? nx.t.split(" ").slice(0,2).join(" ") : "Clear") + '</div><div class="small">' + steps.filter(s => s.state === "done").length + ' of ' + steps.length + ' done</div></div></a>';
  }
  $("home-tiles").innerHTML =
    '<a class="tile3" href="#body"><div class="hd"><span>Health</span><span>›</span></div><div><div class="n">' + gymN + ' / ' + (b.minPerWeek || 2) + '</div><div class="small">sessions this week</div></div></a>' +
    '<a class="tile3" href="#money"><div class="hd"><span>Money</span><span>›</span></div><div><div class="n">' + (m.burn ? eur(m.burn.eur) : "…") + '</div><div class="small">a month · subs ' + eur(subs) + '</div></div></a>' +
    '<a class="tile3" href="#people"><div class="hd"><span>People</span><span>›</span></div><div><div class="n">' + (nb ? esc(inShort(nb.days)) : "…") + '</div><div class="small">' + (nb ? esc(nb.name.split(" ")[0]) + "'s birthday" : "birthdays") + '</div></div></a>' + fourth;

  // Wins
  $("home-wins").innerHTML = winButtons().map((w,i) => '<button class="chip" data-w="' + i + '">' + esc(w.label) + '<span>+' + w.xp + '</span></button>').join("");
  $("home-more").innerHTML = moreWins().map(w => '<span class="pair"><button class="chip" data-mw="' + esc(w.key) + '">' + esc(w.label) + '<span>+' + w.xp + '</span></button><button class="chip add" data-pin="' + esc(w.key) + '" aria-label="Pin ' + esc(w.label) + '">+</button></span>').join("");

  // Offline
  const off = get("meta","offline") || {}, wkOff = get("offline", mon) || {}, offDone = wkOff.done || [];
  $("home-strip").innerHTML = (off.recharges || []).map(r => { const on = offDone.includes(r.id), bg = r.img ? "url('" + esc(r.img) + "')" : esc(r.bg || "#555");
    return '<button class="tile' + (on ? " done" : "") + '" data-off="' + esc(r.id) + '" aria-pressed="' + on + '" style="background:' + bg + ';background-size:cover;background-position:center">' + (r.img ? "" : '<span class="em">' + esc(r.em || "") + '</span>') + '<span class="ck">' + (on ? "✓" : "") + '</span><span class="nm">' + esc(r.name) + (on ? "<small>Done this week · +10</small>" : "") + '</span></button>'; }).join("");

  $("home-badges").innerHTML = (h.badges || []).map(bd => '<div class="badge' + (bd.earned ? " on" : "") + '"><b>' + esc(bd.name) + '</b><span class="small">' + esc(bd.earned ? "Earned " + bd.earned : (bd.how || "")) + '</span>' + (!bd.earned && bd.of ? '<div class="bprog"><i style="width:' + Math.round((bd.have||0)/bd.of*100) + '%"></i></div><span class="small">' + (bd.have||0) + " of " + bd.of + "</span>" : "") + '</div>').join("");
}
document.addEventListener("click", e => {
  const w = e.target.closest("#home-wins .chip"); if (w){ const it = winButtons()[Number(w.dataset.w)]; if (it) logWin(it, $("home-winToast"), w); return; }
  const mw = e.target.closest("[data-mw]"); if (mw){ const it = moreWins().find(x => x.key === mw.dataset.mw); if (it) logWin(it, $("home-winToast"), mw); return; }
  const pn = e.target.closest("[data-pin]"); if (pn){ const it = moreWins().find(x => x.key === pn.dataset.pin); if (it){ saveButtons(winButtons().concat([Object.assign({}, it)])); $("home-winToast").textContent = "Pinned: " + it.label; } return; }
  const q = e.target.closest("#home-quests .quest");
  if (q){ const mon = mondayIso(), qd = Object.assign({}, get("quests", mon) || {}), d = (qd.done || []).slice(), i = Number(q.dataset.q), at = d.indexOf(i); if (at >= 0) d.splice(at,1); else d.push(i); qd.done = d; set("quests", mon, qd); return; }
  if (e.target.closest("#home-claim")){ const q2 = questsNow(), mon = mondayIso(); logWin({key:"quests", label:"Quest stack complete", xp:q2.bonus || 50}, $("home-questToast")); update("quests", mon, {claimed:true}); return; }
  const t = e.target.closest("#home-strip .tile");
  if (t){ const mon = mondayIso(), wk = Object.assign({}, get("offline", mon) || {}), d = (wk.done || []).slice(), at = d.indexOf(t.dataset.off), wins = Object.assign({}, wk.wins || {});
    const r = ((get("meta","offline") || {}).recharges || []).find(x => x.id === t.dataset.off) || {name:t.dataset.off};
    if (at >= 0){ d.splice(at,1); if (wins[t.dataset.off]) del("wins", wins[t.dataset.off]); delete wins[t.dataset.off]; $("home-offToast").textContent = ""; }
    else { d.push(t.dataset.off); wins[t.dataset.off] = logWin({key:"offline", label:"Offline · " + r.name, xp:10}, null, t); $("home-offToast").textContent = "Nice. +10."; }
    wk.done = d; wk.wins = wins; set("offline", mon, wk); return; }
  const wk = e.target.closest("#home-wake");
  if (wk){ const d = todayIso(), cur = get("wake", d), n = new Date();
    if (!cur && n.getHours() < 12){ const t2 = pad(n.getHours()) + ":" + pad(n.getMinutes()); set("wake", d, {date:d, t:t2, at:nowIso()}); pop(t2 <= "06:15" ? "On goal ✓" : "Up " + t2, wk); $("home-tileToast").textContent = "Up at " + t2 + ". Logged. Tap again to change it."; return; }
    $("wsheet-t").value = cur ? cur.t : "06:00"; $("wsheet").hidden = false; return; }
  const buy = e.target.closest("[data-buy]");
  if (buy){ const g = get("giftIdeas", buy.dataset.buy); if (!g) return; const id = buy.dataset.buy, now = nowIso();
    update("giftIdeas", id, {bought:true, boughtAt:now});
    const wid = add("wins", {key:"gift", label:"Gift · " + g.who, xp:20, date:now.slice(0,10), at:now, synced:false});
    toast($("gifts-toast"), "Done: " + esc(g.who) + ". +20 XP", () => { del("wins", wid); update("giftIdeas", id, {bought:false}); }); return; }
  const gx = e.target.closest("[data-gdel]");
  if (gx){ const id = gx.dataset.gdel, keep = get("giftIdeas", id); del("giftIdeas", id); toast($("gifts-toast"), "Deleted.", () => set("giftIdeas", id, keep)); return; }
});
$("wsheet-cancel").addEventListener("click", () => { $("wsheet").hidden = true; });
$("wsheet").addEventListener("click", e => { if (e.target.id === "wsheet") $("wsheet").hidden = true; });
$("wsheet-t").addEventListener("input", () => { const v = $("wsheet-t").value; $("wsheet-note").textContent = v && v <= "06:15" ? "On goal. Nice." : "Goal: 06:00"; });
$("wsheet-save").addEventListener("click", () => { const v = $("wsheet-t").value, d = todayIso(); if (!/^\d{2}:\d{2}$/.test(v)) return; set("wake", d, Object.assign({}, get("wake", d) || {}, {date:d, t:v, at:nowIso()})); $("wsheet").hidden = true; $("home-tileToast").textContent = "Up at " + v + ". Saved."; });
$("home-ring").addEventListener("click", () => { $("home-stats").open = !$("home-stats").open; });

/* Edit win buttons */
let editRows = null;
function sheetRender(){ $("sheet-rows").innerHTML = editRows.map((w,i) => '<div class="er"><input class="field" data-ei="' + i + '" data-ef="label" value="' + esc(w.label) + '" aria-label="Win name"><input class="field" data-ei="' + i + '" data-ef="xp" value="' + esc(w.xp) + '" inputmode="numeric" aria-label="XP"><button class="x" data-edel="' + i + '" aria-label="Remove ' + esc(w.label) + '">×</button></div>').join(""); }
$("home-editWins").addEventListener("click", () => { editRows = winButtons().map(w => Object.assign({}, w)); sheetRender(); $("sheet").hidden = false; });
$("sheet-rows").addEventListener("input", e => { const i = e.target.dataset.ei; if (i == null) return; editRows[i][e.target.dataset.ef] = e.target.dataset.ef === "xp" ? (Number(e.target.value)||0) : e.target.value; });
$("sheet-rows").addEventListener("click", e => { const d = e.target.closest("[data-edel]"); if (d){ editRows.splice(Number(d.dataset.edel),1); sheetRender(); } });
$("sheet-add").addEventListener("click", () => { editRows.push({key:"c" + rid().slice(0,6), label:"New win", xp:10}); sheetRender(); const f = $("sheet-rows").querySelectorAll("[data-ef=label]"); f[f.length-1].select(); });
function closeSheet(){ if (editRows){ saveButtons(editRows.filter(w => String(w.label).trim()).map(w => ({key:w.key || "c" + rid().slice(0,6), label:String(w.label).trim(), xp:Number(w.xp)||0}))); editRows = null; } $("sheet").hidden = true; }
$("sheet-done").addEventListener("click", closeSheet);
$("sheet").addEventListener("click", e => { if (e.target.id === "sheet") closeSheet(); });

/* ---------- Tonight ---------- */
let tnDraft = null, tnTimer = 0;
function renderTonight(){
  const d = todayIso(), doc = tonightDoc(d), done = tonightDays();
  if (!tnDraft || tnDraft.date !== d) tnDraft = {date:d, wins:(doc.wins||[]).slice(), grateful:(doc.grateful||[]).slice()};
  $("tn-date").textContent = dayName(d);
  const start = done[0] || d, s = new Date(start+"T12:00:00");
  const dayN = Math.min(30, Math.round((new Date(d+"T12:00:00") - s)/86400000) + 1);
  $("tn-day").textContent = "day " + dayN + " · " + done.length + " done";
  $("tn-dots").innerHTML = [...Array(30)].map((_,i) => { const di = new Date(s); di.setDate(s.getDate()+i); const iso = localIso(di); return '<i class="' + (done.includes(iso) ? "ok" : iso === d ? "now" : iso < d ? "miss" : "") + '" title="' + iso + '"></i>'; }).join("");
  const N = {wins:5, grateful:3};
  const box = (k, el) => { if (document.activeElement && document.activeElement.dataset && document.activeElement.dataset.tk === k) return; $(el).innerHTML = [...Array(N[k])].map((_,i) => '<input class="field line" data-tk="' + k + '" data-ti="' + i + '" placeholder="' + (i+1) + '." value="' + esc(tnDraft[k][i] || "") + '" enterkeyhint="next">').join(""); };
  box("wins","tn-wins"); box("grateful","tn-grat");
  const wn = tnDraft.wins.filter(x => x && x.trim()).length, gn = tnDraft.grateful.filter(x => x && x.trim()).length;
  $("tn-wn").textContent = wn + " / 5"; $("tn-gn").textContent = gn + " / 3";
  $("tn-done").textContent = doc.done ? "Saved · +" + (doc.xp || 0) + " ✓ (tap to update)" : "Save tonight · +" + 2*(wn+gn);
  $("tn-past").innerHTML = all("tonight").filter(t => t.id !== d && (t.wins||[]).some(Boolean)).sort((a,c) => c.id.localeCompare(a.id)).slice(0,7).map(t => '<details class="past"><summary class="row"><span class="t">' + esc(dayName(t.id)) + '<span>' + (t.wins||[]).filter(Boolean).length + ' wins · ' + (t.grateful||[]).filter(Boolean).length + ' grateful</span></span><span>›</span></summary><div class="small" style="padding:0 0 10px">' + (t.wins||[]).filter(Boolean).map(x => "· " + esc(x)).join("<br>") + '</div></details>').join("") || '<div class="empty">Your past nights show here.</div>';
}
function tnSave(){ const d = tnDraft.date, cur = get("tonight", d) || {}; set("tonight", d, Object.assign({}, cur, {date:d, wins:tnDraft.wins, grateful:tnDraft.grateful, at:nowIso()})); }
document.addEventListener("input", e => { const k = e.target.dataset && e.target.dataset.tk; if (!k) return; tnDraft[k][Number(e.target.dataset.ti)] = e.target.value;
  const wn = tnDraft.wins.filter(x => x && x.trim()).length, gn = tnDraft.grateful.filter(x => x && x.trim()).length; $("tn-wn").textContent = wn + " / 5"; $("tn-gn").textContent = gn + " / 3"; $("tn-done").textContent = "Save tonight · +" + 2*(wn+gn);
  clearTimeout(tnTimer); tnTimer = setTimeout(tnSave, 700); });
document.addEventListener("keydown", e => { if (e.key === "Enter" && e.target.dataset && e.target.dataset.tk){ e.preventDefault(); const n = e.target.nextElementSibling; if (n) n.focus(); else e.target.blur(); } });
$("tn-done").addEventListener("click", () => {
  const d = tnDraft.date, n = tnDraft.wins.slice(0,5).filter(x => x && x.trim()).length + tnDraft.grateful.slice(0,3).filter(x => x && x.trim()).length, cur = get("tonight", d) || {};
  if (!n){ $("tn-toast").textContent = "Write one line, even a small one."; return; }
  clearTimeout(tnTimer); const wid = "tonight-" + d, old = cur.win && cur.win !== wid ? get("wins", cur.win) : null, prev = cur.xp != null ? cur.xp : (old ? Number(old.xp)||0 : 0), xp = Math.max(2*n, prev), gain = xp - prev;
  if (old) del("wins", cur.win);
  set("wins", wid, {key:"tonight", label:"Tonight · " + n + " lines", xp, date:d, at:nowIso(), synced:false});
  set("tonight", d, Object.assign({}, cur, {date:d, wins:tnDraft.wins, grateful:tnDraft.grateful, done:true, xp, at:nowIso()}));
  if (gain > 0) pop(gain, $("tn-done"));
  $("tn-toast").textContent = gain > 0 ? "Saved. +" + gain + "." : "Saved.";
});

/* ---------- Health ---------- */
let pick = null, draft = {}, strEx = null;
function weekDays(){ const m = new Date(); m.setDate(m.getDate() - ((m.getDay()+6)%7)); return [...Array(7)].map((_,i) => { const d = new Date(m); d.setDate(m.getDate()+i); return d; }); }
function lastFor(n){ const sets = all("sets").sort((a,b) => String(b.at).localeCompare(String(a.at))); for (const s of sets){ const e = (s.ex||[]).find(x => x.n === n && x.kg != null); if (e) return e; } return null; }
function spark(pts, opts){
  if (pts.length < 2) return '<div class="empty" style="padding:14px 0">' + (opts.empty || "Log twice and your line appears here.") + '</div>';
  const W = 300, H = 80, xs = pts.map((_,i) => i/(pts.length-1)*W), vs = pts.map(p => p.v), lo = Math.min(...vs), hi = Math.max(...vs), rng = (hi - lo) || 1;
  const ys = vs.map(v => H - 8 - (v - lo)/rng*(H - 16));
  return '<svg viewBox="-6 0 312 ' + H + '" width="100%" height="' + H + '" role="img" aria-label="' + esc(opts.label) + '"><polyline fill="none" stroke="var(--glow)" stroke-width="2.5" stroke-linejoin="round" points="' + xs.map((x,i) => x.toFixed(1)+","+ys[i].toFixed(1)).join(" ") + '"/><circle cx="' + xs[xs.length-1] + '" cy="' + ys[ys.length-1] + '" r="4" fill="var(--glow)"/></svg><div class="bl"><span>' + esc(fmt(pts[0].d)) + '</span><span style="text-align:right">' + esc(fmt(pts[pts.length-1].d)) + '</span></div>';
}
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
    $("body-ex").innerHTML = sel ? (sel.exercises || []).map(e => { const l = lastFor(e.n), d = draft[e.n] || {}, beat = l && d.kg != null && d.reps != null && d.kg !== "" && d.reps !== "" && (d.kg > l.kg || (d.kg >= l.kg && d.reps > l.reps));
      return '<div class="ex' + (beat ? " beat" : "") + '" data-exn="' + esc(e.n) + '"><span class="t">' + esc(e.n) + '<span>' + esc(e.s) + (l ? " · last " + l.kg + " kg × " + l.reps : " · first time: set your baseline") + '</span></span><span style="display:flex;gap:6px"><input class="num" data-n="' + esc(e.n) + '" data-f="kg" type="number" step="0.5" inputmode="decimal" placeholder="kg" aria-label="' + esc(e.n) + ' kg" value="' + esc(d.kg ?? "") + '"><input class="num" data-n="' + esc(e.n) + '" data-f="reps" type="number" inputmode="numeric" placeholder="reps" aria-label="' + esc(e.n) + ' reps" value="' + esc(d.reps ?? "") + '" style="width:58px"></span></div>'; }).join("") : '<div class="empty">Your plan shows here after the first sync.</div>';
  // Strength line
  const names = [...new Set(plan.flatMap(p => (p.exercises||[]).map(e => e.n)))];
  if (!strEx || !names.includes(strEx)) strEx = names[0];
  const pts = all("sets").sort((a,c) => String(a.at).localeCompare(String(c.at))).map(s => { const e = (s.ex||[]).find(x => x.n === strEx && x.kg != null); return e ? {d:s.date, v:e.kg} : null; }).filter(Boolean);
  $("body-strN").textContent = pts.length >= 2 ? (pts[pts.length-1].v - pts[0].v >= 0 ? "+" : "") + (pts[pts.length-1].v - pts[0].v) + " kg since " + fmt(pts[0].d) : "";
  $("body-chart").innerHTML = spark(pts, {label:strEx + " weight over time", empty:"Log " + esc(strEx || "an exercise") + " twice and your strength line appears here."});
  $("body-strPick").innerHTML = names.map(n => '<button class="chip sm' + (n === strEx ? " on" : "") + '" data-str="' + esc(n) + '">' + esc(n) + '</button>').join("");
  // Fuel
  const F = [{k:"breakfast",t:"Breakfast"},{k:"lunch",t:"Lunch"},{k:"dinner",t:"Dinner"},{k:"shake",t:"Shake / yogurt"}];
  const td = get("fuel", todayIso()) || {};
  $("body-fuelN").textContent = "Food today · " + F.filter(f => td[f.k]).length + " of " + F.length;
  $("body-fuel").innerHTML = F.map(f => '<button class="chip sm' + (td[f.k] ? " on" : "") + '" data-fuel="' + esc(f.k) + '">' + (td[f.k] ? "✓ " : "") + esc(f.t) + '</button>').join("");
  // Weight
  const ws = all("weights").filter(w => w.kg).sort((a,c) => String(a.date).localeCompare(String(c.date)));
  $("body-kgNow").textContent = ws.length ? ws[ws.length-1].kg + " kg · " + fmt(ws[ws.length-1].date) : "";
  $("body-wchart").innerHTML = spark(ws.map(w => ({d:w.date, v:w.kg})), {label:"Weight over time", empty:"Two Saturdays in, your weight line appears here."});
  $("body-rules").innerHTML = (b.rules || []).map(r => '<div class="row" style="display:block"><b style="font-weight:500">' + esc(r.t) + '</b><div class="small">' + esc(r.w || "") + '</div></div>').join("");
  return sel;
}
document.addEventListener("click", e => {
  const p = e.target.closest("[data-pick]"); if (p){ pick = p.dataset.pick; draft = {}; render(); return; }
  const s = e.target.closest("[data-str]"); if (s){ strEx = s.dataset.str; render(); return; }
  const f = e.target.closest("[data-fuel]"); if (f){ const d = todayIso(), cur = Object.assign({}, get("fuel", d) || {}); cur[f.dataset.fuel] = !cur[f.dataset.fuel]; cur.date = d; set("fuel", d, cur); }
});
$("body-ex").addEventListener("input", e => { const i = e.target.closest(".num"); if (!i) return; (draft[i.dataset.n] = draft[i.dataset.n] || {})[i.dataset.f] = i.value === "" ? "" : Number(i.value);
  const row = i.closest(".ex"), l = lastFor(i.dataset.n), d = draft[i.dataset.n]; row.classList.toggle("beat", !!(l && d.kg !== "" && d.reps !== "" && d.kg != null && d.reps != null && (d.kg > l.kg || (d.kg >= l.kg && d.reps > l.reps)))); });
$("body-finish").addEventListener("click", () => {
  const sel = renderBody(); if (!sel) return;
  const ex = []; document.querySelectorAll("#body-ex .num[data-f=kg]").forEach(i => { const r = document.querySelector('#body-ex .num[data-f=reps][data-n="' + CSS.escape(i.dataset.n) + '"]'); const kg = i.value === "" ? null : Number(i.value), reps = r && r.value !== "" ? Number(r.value) : null; if (reps != null || kg != null) ex.push({n:i.dataset.n, kg, reps}); });
  const at = nowIso(), sid = add("sets", {date:todayIso(), at, session:sel.id, ex});
  const wid = add("wins", {key:"gym", label:"Gym · " + sel.id, session:sel.id, xp:20, date:todayIso(), at, synced:false});
  draft = {}; pick = null; pop(20, $("body-finish"));
  toast($("body-toast"), esc(sel.id) + " logged, " + ex.length + " exercises. +20 XP", () => { del("wins", wid); del("sets", sid); });
});
$("body-padel").addEventListener("click", () => logWin({key:"padel", label:"Padel", xp:10}, $("body-toast"), $("body-padel")));
$("body-saveKg").addEventListener("click", () => { const v = parseFloat($("body-kg").value);
  if (!(v >= 40 && v <= 150)){ $("body-kgToast").textContent = "Enter your weight in kg, like 76.4."; return; }
  set("weights", todayIso(), {date:todayIso(), kg:Math.round(v*10)/10, synced:false}); $("body-kg").value = ""; $("body-kgToast").textContent = "Saved " + (Math.round(v*10)/10) + " kg."; });

/* ---------- Money ---------- */
function subsPart(m){ return ((m.burn || {}).parts || []).find(p => /subscri/i.test(p.t)); }
function subsTotal(m){ const p = subsPart(m); if (!p) return 0; const s = (p.items || []).reduce((a,i) => a + num(i.v), 0); return s || num(p.v); }
const BIG = ["Watches","Trips"];
let moMonth = null;
function renderMoney(){
  const m = get("meta","money") || {}, burn = (m.burn || {}).eur || 0, subs = subsTotal(m), cuts = get("meta","subCuts") || {};
  $("mo-updated").textContent = m.updated ? "Updated " + m.updated : "";
  const sk = m.skillSpend || null;
  $("mo-tiles").innerHTML =
    '<div class="tile3"><div class="hd"><span>Saved</span></div><div><div class="n">' + esc(m.saved || "to fill") + '</div><div class="small">' + (m.emergencyFund ? "✓ emergency fund covered" : "emergency fund: to set") + '</div></div></div>' +
    '<div class="tile3"><div class="hd"><span>Spending</span></div><div><div class="n">' + eur(burn) + '</div><div class="small">a month, all in</div></div></div>' +
    '<button class="tile3" id="mo-subsJump"><div class="hd"><span>Subscriptions</span><span>›</span></div><div><div class="n">' + eur(subs) + '</div><div class="small">' + eur(subs*12) + ' a year</div></div></button>' +
    '<div class="tile3"><div class="hd"><span>On your skills</span></div><div><div class="n">' + (sk ? eur(sk.v) : "…") + '</div><div class="small">' + esc(sk ? sk.note || ("this month") : "coaching, tools, books · /life fills it") + '</div></div></div>';
  // Income: clickable bars + year to date
  const months = (m.months || []).slice(-8), hi = Math.max(1, ...months.map(x => x.v));
  const yr = String(new Date().getFullYear()), ytd = (m.months || []).filter(x => (x.y || inferYear(m.months, x)) === yr).reduce((a,x) => a + x.v, 0);
  if (moMonth == null || moMonth >= months.length) moMonth = months.length - 1;
  const sel = months[moMonth], best = months.reduce((a,x) => x.v > a.v ? x : a, {v:0});
  $("mo-income").innerHTML = '<div class="lab"><span>Coming in · FOCUS invoices</span><span>' + yr + ' so far ' + eur(ytd) + '</span></div>' + (sel ? '<div class="focus-s">' + esc(sel.m) + ' · ' + eur(sel.v) + (sel === best ? " · best month" : "") + '</div>' : "") + '<div class="bars">' + months.map((x,i) => '<button class="bar1' + (i === moMonth ? " on" : "") + '" data-mo="' + i + '" style="height:' + Math.round(x.v/hi*100) + '%" aria-label="' + esc(x.m + " " + eur(x.v)) + '"></button>').join("") + '</div><div class="bl">' + months.map(x => '<span>' + esc(x.m.slice(0,1)) + '</span>').join("") + '</div><div class="small" style="margin-top:6px">Tap a bar. Updated from your invoice each month.</div>';
  // Where it goes
  $("mo-burn").textContent = eur(burn);
  $("mo-parts").innerHTML = ((m.burn || {}).parts || []).map(p => { const isSubs = p === subsPart(m);
    return '<details' + (isSubs ? ' id="mo-subs"' : '') + '><summary class="row"><span class="t">' + esc(p.t) + '<span>' + esc(isSubs ? "Keep or cut each one" : (p.items || []).map(i => i.t).slice(0,3).join(", ")) + '</span></span><span class="' + (/not itemised/i.test(p.t) ? "warn" : "") + '">' + esc(p.v) + ' ›</span></summary>' +
      (p.items || []).map(i => { const id = slug(i.t), cut = !!cuts[id];
        return '<div class="row sub"><span class="t">' + esc(i.t) + (isSubs && num(i.v) ? '<span>' + eur(num(i.v)*12) + ' a year</span>' : "") + '</span><span class="rt">' + esc(i.v) + (isSubs && num(i.v) ? '<span class="kc"><button class="' + (cut ? "" : "sel") + '" data-keep="' + esc(id) + '">Keep</button><button class="' + (cut ? "sel cut" : "") + '" data-cut="' + esc(id) + '" data-cutname="' + esc(i.t) + '">Cut</button></span>' : "") + '</span></div>'; }).join("") + '</details>'; }).join("");
  const cutSum = (subsPart(m) ? subsPart(m).items : []).filter(i => cuts[slug(i.t)]).reduce((a,i) => a + num(i.v), 0);
  $("mo-toast").textContent = cutSum ? "Cutting saves " + eur(cutSum) + " a month, " + eur(cutSum*12) + " a year. Each cut is on your Admin list." : "";
  // Coming soon (planned costs)
  const soon = m.soon || [];
  $("mo-soon").hidden = !soon.length;
  $("mo-soon").innerHTML = '<div class="lab"><span>Coming soon</span><span>planned</span></div>' + soon.map(x => '<div class="row"><span class="t">' + esc(x.t) + '<span>' + esc(x.when || "") + '</span></span><span>' + esc(x.v) + '</span></div>').join("");
  // Ways to save
  const sv = m.save || [];
  $("mo-save").hidden = !sv.length;
  $("mo-save").innerHTML = '<div class="lab"><span>Ways to save</span><span>' + esc(m.saveTotal || "") + '</span></div>' + sv.map(x => '<div class="srow"><b>' + esc(x.v) + '</b><span>' + esc(x.t) + '</span></div>').join("");
  // Big wants
  const big = all("wish").filter(w => BIG.includes(w.cat) && w.state === "want").sort((a,b) => (b.price||0) - (a.price||0));
  $("mo-goals").hidden = !big.length;
  $("mo-goals").innerHTML = '<div class="lab"><span>Saving for</span><span>big wants</span></div>' + big.map(w => { const pot = (m.pots2 || {})[w.id] || 0, pr = w.price || num(w.pr);
    return '<div class="goal">' + (w.img ? '<img src="' + esc(w.img) + '" alt="">' : '<span class="gph"></span>') + '<span class="t"><b>' + esc(w.name) + '</b><span>' + esc(w.brand || w.cat) + (pr ? " · " + eur(pr) : "") + '</span><span class="meter sm"><i style="width:' + (pr ? Math.min(100, Math.round(pot/pr*100)) : 0) + '%"></i></span></span><span class="small">' + (pot ? eur(pot) : "pot opens") + '</span></div>'; }).join("");
}
function inferYear(list, x){ const i = list.indexOf(x), n = list.length, mi = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"]; let y = new Date().getFullYear(), last = mi.indexOf(list[n-1].m);
  for (let k = n-1; k > i; k--){ const a = mi.indexOf(list[k].m), b = mi.indexOf(list[k-1].m); if (b > a) y--; } return String(y); }
const slug = s => String(s).toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/^-|-$/g,"").slice(0,40);
document.addEventListener("click", e => {
  if (e.target.closest("#mo-subsJump")){ const d = $("mo-subs"); if (d){ d.open = true; d.scrollIntoView({behavior:"smooth", block:"start"}); } return; }
  const c = e.target.closest("[data-cut]");
  if (c){ const cuts = Object.assign({}, get("meta","subCuts") || {}), id = c.dataset.cut; if (cuts[id]) return;
    const aid = "cut-" + id; set("admin", aid, {t:"Cancel " + c.dataset.cutname.replace(/\s*\(.*\)$/,""), w:"Marked Cut in Money", state:"you", order:-Date.now()/1e9, date:"", src:"app"});
    cuts[id] = aid; set("meta","subCuts", cuts); return; }
  const k = e.target.closest("[data-keep]");
  if (k){ const cuts = Object.assign({}, get("meta","subCuts") || {}), id = k.dataset.keep; if (!cuts[id]) return; del("admin", cuts[id]); delete cuts[id]; set("meta","subCuts", cuts); $("mo-toast").textContent = ""; return; }
  const b = e.target.closest("[data-mo]"); if (b){ moMonth = Number(b.dataset.mo); render(); }
});

/* ---------- Think ---------- */
let openTheme = null, linkNote = null;
function renderThink(){
  const meta = get("meta","think") || {}, threads = all("threads"), thoughts = all("thoughts");
  const liveT = threads.filter(t => t.state !== "landed" && t.state !== "letgo").sort((a,b) => (a.order||0) - (b.order||0));
  const count = t => thoughts.filter(x => x.thread === t.id).length + (Number(t.base)||0);
  // Malmasson card
  const mal = meta.malmasson;
  $("think-mal").hidden = !mal;
  if (mal) $("think-mal").innerHTML = '<div class="lab"><span>For Malmasson · ' + esc(mal.week || "this week") + '</span><span>you send it</span></div>' +
    ['finished','loose'].filter(k => mal[k]).map(k => '<div class="msg"><div class="small">' + (k === "finished" ? "Ready to send" : "Fill in yourself") + '</div><p>' + esc(mal[k]) + '</p><button class="btn sm" data-copy="' + k + '">Copy</button></div>').join("");
  // Observations
  const obs = meta.observations || [];
  $("think-obs").hidden = !obs.length;
  $("think-obs").innerHTML = '<div class="lab"><span>Where you are</span><span>' + esc(meta.obsDate || "") + '</span></div>' + obs.map(o => '<div class="obs ' + esc(o.kind || "") + '"><span class="ok">' + esc(({bottleneck:"Bottleneck", pattern:"Pattern", next:"Next move"})[o.kind] || "Note") + '</span><div>' + esc(o.t) + '</div></div>').join("");
  // Web
  const W = 330, H = 300, cx = W/2, cy = H/2, R = 112, n = liveT.length || 1;
  const pos = {}; liveT.forEach((t,i) => { const a = -Math.PI/2 + i/n*2*Math.PI; pos[t.id] = {x: cx + R*Math.cos(a), y: cy + R*Math.sin(a)}; });
  const seen = new Set(), edges = []; liveT.forEach(t => (t.links || []).forEach(l => { const k = [t.id,l].sort().join("|"); if (pos[l] && !seen.has(k)){ seen.add(k); edges.push([t.id,l]); } }));
  const hot = new Set(obs.flatMap(o => o.themes || []));
  $("think-web").innerHTML = '<svg viewBox="-10 -20 ' + (W+20) + ' ' + (H+36) + '" width="100%" class="web" role="img" aria-label="Your themes and how they connect">' +
    liveT.map(t => '<line x1="' + cx + '" y1="' + cy + '" x2="' + pos[t.id].x.toFixed(1) + '" y2="' + pos[t.id].y.toFixed(1) + '" class="spoke"/>').join("") +
    edges.map(([a,b]) => '<line x1="' + pos[a].x.toFixed(1) + '" y1="' + pos[a].y.toFixed(1) + '" x2="' + pos[b].x.toFixed(1) + '" y2="' + pos[b].y.toFixed(1) + '" class="link"/>').join("") +
    '<circle cx="' + cx + '" cy="' + cy + '" r="26" class="me"/><text x="' + cx + '" y="' + (cy+5) + '" class="metx">You</text>' +
    liveT.map(t => { const c = count(t), r = 9 + Math.min(14, c*1.6), p2 = pos[t.id], lx = p2.x, ly = p2.y + (p2.y < cy ? -r - 7 : r + 15);
      return '<g class="node' + (openTheme === t.id ? " on" : "") + (hot.has(t.id) ? " hot" : "") + '" data-theme="' + esc(t.id) + '"><circle cx="' + p2.x.toFixed(1) + '" cy="' + p2.y.toFixed(1) + '" r="' + r.toFixed(1) + '"/><text x="' + lx.toFixed(1) + '" y="' + ly.toFixed(1) + '">' + esc(t.title.length > 16 ? t.title.slice(0,15) + "…" : t.title) + '</text></g>'; }).join("") + '</svg>';
  const ot = liveT.find(t => t.id === openTheme);
  $("think-open").innerHTML = ot ? '<div class="theme"><div class="focus-s">' + esc(ot.title) + '</div>' + (ot.q ? '<div class="small" style="margin:4px 0 8px">' + esc(ot.q) + '</div>' : "") + ((ot.links || []).length ? '<div class="small">Linked to: ' + ot.links.map(l => esc((threads.find(x => x.id === l) || {}).title || l)).join(", ") + '</div>' : "") + thoughts.filter(x => x.thread === ot.id).sort((a,b) => String(b.at).localeCompare(String(a.at))).slice(0,8).map(x => '<div class="note">' + esc(x.t) + '<span>' + esc(fmt(x.at)) + '</span></div>').join("") + '</div>' : '<div class="small">Bigger dots have more notes. Orange ones are where your bottlenecks sit.</div>';
  // Loose notes: link by tapping a theme chip
  const loose = thoughts.filter(x => !x.thread).sort((a,b) => String(b.at).localeCompare(String(a.at)));
  $("think-looseWrap").hidden = !loose.length;
  $("think-loose").innerHTML = loose.map(x => '<div class="note">' + esc(x.t) + '<span>' + esc(fmt(x.at)) + '</span><div class="chips scroll" style="margin-top:6px">' + liveT.map(t => '<button class="chip sm" data-file="' + esc(x.id) + '" data-to="' + esc(t.id) + '">' + esc(t.title) + '</button>').join("") + '</div></div>').join("");
  const side = (get("meta","side") || {}).projects || [];
  $("think-sLab").textContent = "Side projects · " + side.filter(p => p.on).length + " on";
  $("think-side").innerHTML = side.map(p => '<div class="row"' + (p.on ? "" : ' style="opacity:.55"') + '><span class="t"><b style="font-weight:500">' + esc(p.name) + '</b><span>Next: ' + esc(p.next || "") + '</span></span><span class="small">' + esc(p.progress ? p.progress.now + " / " + p.progress.goal : (p.status || "")) + '</span></div>').join("") || '<div class="empty">None yet.</div>';
}
$("think-save").addEventListener("click", () => { if (capture($("think-text").value, $("think-toast"))) $("think-text").value = ""; });
$("think-text").addEventListener("keydown", e => { if (e.key === "Enter") $("think-save").click(); });
document.addEventListener("click", e => {
  const g = e.target.closest("[data-theme]"); if (g){ openTheme = openTheme === g.dataset.theme ? null : g.dataset.theme; render(); return; }
  const f = e.target.closest("[data-file]"); if (f){ update("thoughts", f.dataset.file, {thread:f.dataset.to, filedBy:"you"}); return; }
  const c = e.target.closest("[data-copy]"); if (c){ const mal = (get("meta","think") || {}).malmasson || {}; const txt = mal[c.dataset.copy] || ""; (navigator.clipboard ? navigator.clipboard.writeText(txt) : Promise.reject()).then(() => { c.textContent = "Copied ✓"; }).catch(() => { c.textContent = "Hold the text to copy"; }); }
});

/* ---------- People ---------- */
const openGifts = () => all("giftIdeas").filter(g => !g.given && !g.bought).sort((a,b) => String(b.at).localeCompare(String(a.at)));
function giftRow(g){
  const done = g.given || g.bought;
  return '<div class="row"' + (done ? ' style="opacity:.55"' : '') + '><span class="t"><b style="font-weight:500">' + esc(g.who) + '</b> · ' + esc(g.t) + '<span>' + (done ? "done " + esc(fmt(g.boughtAt || g.givenAt || g.at)) : "saved " + esc(fmt(g.at))) + '</span></span><span style="display:flex;align-items:center;gap:2px">' + (done ? "" : '<button class="btn solid sm" data-buy="' + esc(g.id) + '">Bought +20</button>') + '<button class="x" data-gdel="' + esc(g.id) + '" aria-label="Delete idea for ' + esc(g.who) + '">×</button></span></div>';
}
function people(){
  const m = new Map(), P = get("meta","people") || {};
  const hid = new Set((P.hidden || []).map(x => String(x).toLowerCase()));
  (P.people || []).forEach(p => { if (!hid.has(p.name.toLowerCase())) m.set(p.name.toLowerCase(), Object.assign({}, p)); });
  all("birthdays").forEach(a => { if (!m.has(a.name.toLowerCase()) && !hid.has(a.name.toLowerCase())) m.set(a.name.toLowerCase(), {name:a.name, m:a.m, d:a.d, fresh:!a.synced}); });
  const t = new Date(); t.setHours(0,0,0,0);
  return [...m.values()].map(p => { let n = new Date(t.getFullYear(), p.m-1, p.d); if (n < t) n = new Date(t.getFullYear()+1, p.m-1, p.d); return Object.assign(p, {next:n, days:Math.round((n - t)/86400000)}); }).sort((a,b) => a.days - b.days);
}
const inText = n => n === 0 ? "Today" : n === 1 ? "Tomorrow" : "in " + n + " days";
const inShort = n => n === 0 ? "Today" : n === 1 ? "Tmrw" : n < 7 ? new Date(Date.now() + n*86400000).toLocaleDateString("en-GB",{weekday:"short"}) : n + " days";
function renderPeople(){
  const ps = people();
  $("pe-next").innerHTML = ps.slice(0,3).map(p => { const ideas = openGifts().filter(g => g.who.toLowerCase() === p.name.toLowerCase());
    return '<div class="row"><span class="t">' + esc(p.name) + '<span>birthday' + (ideas.length ? " · idea: " + esc(ideas[0].t) : p.days <= 14 ? " · a message or a gift?" : "") + '</span></span><span class="' + (p.days <= 7 ? "warn" : "small") + '">' + esc(p.days < 7 ? inShort(p.days) + " " + p.next.getDate() : p.next.getDate() + " " + MONTHS[p.next.getMonth()].slice(0,3)) + '</span></div>'; }).join("") || '<div class="empty">Birthdays show here after the first sync.</div>';
  const lastCall = all("wins").filter(w => w.key === "call" || w.key === "text" || w.key === "family").sort((a,c) => String(c.at).localeCompare(String(a.at)))[0];
  $("pe-callLast").textContent = lastCall ? "last one logged " + fmt(lastCall.date) : "nothing logged yet";
  const open = openGifts(), done = all("giftIdeas").filter(g => g.given || g.bought).sort((a,b) => String(b.boughtAt || b.givenAt || "").localeCompare(String(a.boughtAt || a.givenAt || ""))).slice(0,6);
  $("gifts-openLab").textContent = "Gifts to get · " + open.length;
  $("gifts-open").innerHTML = open.map(giftRow).join("") || '<div class="empty">Nothing to get right now.</div>';
  $("gifts-done").innerHTML = done.map(giftRow).join("");
  $("gifts-doneWrap").hidden = !done.length;
  $("gifts-names").innerHTML = ps.map(p => '<option value="' + esc(p.name) + '">').join("");
  const dt = get("meta","dating") || {}, h = home();
  const mon2 = mondayIso(), op = all("wins").filter(w => (w.key === "opener" || w.key === "date" || w.key === "event") && String(w.date) >= mon2);
  $("pe-dating").innerHTML = '<div class="lab"><span>Dating</span><span>' + esc(h.boss ? "Boss: " + h.boss.name : "") + '</span></div><div class="focus-s">' + esc(dt.title || "The life you're building room for.") + '</div>' +
    '<div class="dstats"><span><b>' + op.filter(w => w.key === "opener").length + '</b>openers this week</span><span><b>' + op.filter(w => w.key === "event").length + '</b>events</span><span><b>' + op.filter(w => w.key === "date").length + '</b>dates</span></div>' +
    '<div class="chips" style="margin:10px 0"><button class="chip sm" data-dw="opener">Talked to someone new <span>+20</span></button><button class="chip sm" data-dw="date">Date <span>+100</span></button></div>' +
    ((dt.where || []).length ? '<div class="lab" style="margin:8px 0 4px">Where this week</div>' + dt.where.map(x => '<div class="row"><span class="t">' + esc(x.t) + '<span>' + esc(x.w || "") + '</span></span></div>').join("") : "") +
    ((dt.rules || []).length ? '<details style="margin-top:8px"><summary class="lab" style="margin:0"><span>Your rules</span><span>▾</span></summary>' + dt.rules.map(r => '<div class="small" style="padding:4px 0">· ' + esc(r) + '</div>').join("") + ((dt.why || []).length ? '<div class="lab" style="margin:10px 0 4px">Why</div>' + dt.why.map(r => '<div class="small" style="padding:4px 0">' + esc(r) + '</div>').join("") : "") + '</details>' : "");
  const ws = all("wish"), want = ws.filter(w => w.state === "want").length, bought = ws.filter(w => w.state === "bought").length;
  $("pe-wish").innerHTML = '<div class="hd"><span>Wishlist</span><span>›</span></div><div><div class="n">' + want + ' wanted</div><div class="small">' + ws.length + ' things · ' + bought + ' bought</div></div>';
  let last = -1;
  $("bday-list").innerHTML = ps.map(p => { const mo = p.next.getMonth(), head = mo !== last ? '<div class="mon">' + MONTHS[mo] + '</div>' : ""; last = mo;
    return head + '<div class="bday' + (p.days <= 14 && !p.gentle ? " soon" : "") + '"><span class="d">' + p.d + '</span><span>' + esc(p.name) + '</span><span class="in">' + esc(inText(p.days)) + '<button class="x" data-bdel="' + esc(p.name) + '" aria-label="Remove ' + esc(p.name) + '">×</button></span></div>'; }).join("");
}
$("bday-day").innerHTML = '<option value="">Day</option>' + [...Array(31)].map((_,i) => "<option>" + (i+1) + "</option>").join("");
$("bday-month").innerHTML = '<option value="">Month</option>' + MONTHS.map((m,i) => '<option value="' + (i+1) + '">' + m.slice(0,3) + "</option>").join("");
document.addEventListener("click", e => {
  const d = e.target.closest("[data-bdel]"); if (d){ const P = get("meta","people") || {}, hidden = (P.hidden || []).concat([d.dataset.bdel]); update("meta","people",{hidden}); const b = all("birthdays").find(x => x.name === d.dataset.bdel); toast($("bday-toast"), "Removed " + esc(d.dataset.bdel) + ".", () => update("meta","people",{hidden:hidden.filter(x => x !== d.dataset.bdel)})); return; }
  const dw = e.target.closest("[data-dw]"); if (dw){ logWin(dw.dataset.dw === "date" ? {key:"date", label:"Date", xp:100} : {key:"opener", label:"Talked to someone new", xp:20}, $("pe-callToast"), dw); }
});
$("pe-called").addEventListener("click", () => logWin({key:"call", label:"Called someone I love", xp:10}, $("pe-callToast"), $("pe-called")));
$("pe-texted").addEventListener("click", () => logWin({key:"text", label:"Texted someone I love", xp:5}, $("pe-callToast"), $("pe-texted")));
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

/* ---------- Wishlist ---------- */
let wiCat = "Wanted";
function renderWish(){
  const ws = all("wish").filter(w => !BIG.includes(w.cat)).sort((a,b) => (a.order ?? 999) - (b.order ?? 999));
  const cats = ["Wanted","Drops"].concat([...new Set(ws.map(w => w.cat).filter(c => c && c !== "Drops"))]).concat(["Bought","Passed"]);
  $("wi-count").textContent = ws.filter(w => w.state === "bought").length + " bought";
  $("wi-cats").innerHTML = cats.map(c => '<button class="chip sm' + (c === wiCat ? " on" : "") + '" data-wcat="' + esc(c) + '">' + esc(c) + '</button>').join("");
  const pickList = wiCat === "Wanted" ? ws.filter(w => w.state === "want") : wiCat === "Bought" ? ws.filter(w => w.state === "bought") : wiCat === "Passed" ? ws.filter(w => w.state === "pass") : ws.filter(w => w.cat === wiCat && w.state !== "pass");
  if (wiCat === "Drops") pickList.sort((a,b) => String(b.at).localeCompare(String(a.at)));
  $("wi-list").innerHTML = pickList.length ? '<div class="shelf">' + pickList.map(w => '<div class="item"><a class="ph" ' + (w.url ? 'href="' + esc(w.url) + '" target="_blank" rel="noopener"' : "") + '>' + (w.img ? '<img src="' + esc(w.img) + '" alt="" loading="lazy">' : '<span>' + esc(w.brand || w.name) + '</span>') + (w.tag ? '<em>' + esc(w.tag) + '</em>' : "") + '</a><span class="br">' + esc(w.brand || "") + '</span><b>' + esc(w.name) + '</b><span class="s">' + esc([w.pr, w.why].filter(Boolean).join(" · ")) + '</span><div class="st">' + ["want","bought","pass"].map(s => '<button class="' + (w.state === s ? "sel" : "") + '" data-ws="' + esc(w.id) + '" data-st="' + s + '">' + ({want:"Want",bought:"Bought",pass:"Pass"})[s] + '</button>').join("") + '</div>' + (w.cat === "Drops" ? '<button class="x" data-wdel="' + esc(w.id) + '" aria-label="Delete">×</button>' : "") + '</div>').join("") + '</div>' : '<div class="empty" style="padding:0 6px">Nothing here yet.</div>';
}
document.addEventListener("click", e => {
  const c = e.target.closest("[data-wcat]"); if (c){ wiCat = c.dataset.wcat; render(); return; }
  const s = e.target.closest("[data-ws]"); if (s){ const w = get("wish", s.dataset.ws); if (!w) return; const st = w.state === s.dataset.st ? "" : s.dataset.st; update("wish", s.dataset.ws, {state:st, at:nowIso()}); return; }
  const d = e.target.closest("[data-wdel]"); if (d){ const id = d.dataset.wdel, keep = get("wish", id); del("wish", id); toast($("wi-toast"), "Deleted.", () => set("wish", id, keep)); }
});
$("wi-form").addEventListener("submit", e => { e.preventDefault(); const t = $("wi-text").value.trim(); if (!t) return;
  const isUrl = /^https?:\/\//i.test(t); let name = t; if (isUrl){ try{ name = new URL(t).hostname.replace(/^www\./,""); }catch(err){} }
  const id = add("wish", {cat:"Drops", brand:"", name, url:isUrl ? t : "", why:"", pr:"", img:"", state:"want", at:nowIso(), order:-1});
  $("wi-text").value = ""; wiCat = "Drops"; toast($("wi-toast"), "Added to Drops.", () => del("wish", id)); });

/* ---------- Admin ---------- */
function renderAdmin(){
  const steps = all("admin").sort((a,b) => (a.order||0) - (b.order||0)), done = steps.filter(s => s.state === "done").sort((a,b) => String(b.doneAt||"").localeCompare(String(a.doneAt||"")));
  const mstart = todayIso().slice(0,8) + "01", won = done.filter(s => String(s.doneAt||"") >= mstart).length;
  $("admin-count").textContent = won ? won + " won this month" : (steps.length ? done.length + " of " + steps.length + " done" : "");
  $("admin-bar").style.width = steps.length ? Math.round(done.length/steps.length*100) + "%" : "0%";
  const nx = steps.find(s => s.state === "you") || steps.find(s => s.state === "due");
  $("admin-next").innerHTML = nx ? '<div class="small">Next for you · ' + esc(nx.date || "") + '</div><div class="serif" style="font-size:24px;line-height:1.2">' + esc(nx.t) + '</div><div class="small">' + esc(nx.w || "") + '</div>' : '<div class="serif" style="font-size:24px">Nothing on you right now</div>';
  const row = s => '<div class="step' + (s.state === "done" ? " done" : "") + '"><button class="tick' + (s.state === "done" ? " on" : "") + '" data-tick="' + esc(s.id) + '" aria-label="' + (s.state === "done" ? "Mark not done: " : "Mark done: ") + esc(s.t) + '">' + (s.state === "done" ? "✓" : "") + '</button><span class="t"><b style="font-weight:500" data-aedit="' + esc(s.id) + '">' + esc(s.t) + '</b><span>' + esc([s.date, s.w].filter(Boolean).join(" · ")) + '</span>' + (s.state === "you" || s.state === "due" ? '<span class="pill you">On you</span>' : "") + '</span><button class="x" data-adel="' + esc(s.id) + '" aria-label="Delete ' + esc(s.t) + '">×</button></div>';
  $("admin-road").innerHTML = steps.filter(s => s.state !== "done").map(row).join("") || '<div class="empty">All clear.</div>';
  $("admin-done").innerHTML = done.map(row).join("");
}
document.addEventListener("click", e => {
  const x = e.target.closest("[data-adel]"); if (x){ const id = x.dataset.adel, keep = get("admin", id); del("admin", id); toast($("admin-toast"), "Deleted: " + esc(keep ? keep.t : ""), () => set("admin", id, keep)); return; }
  const t = e.target.closest("[data-tick]"); if (!t) return; const s = get("admin", t.dataset.tick); if (!s) return;
  const wid = "admin-" + t.dataset.tick;
  if (s.state === "done"){ update("admin", t.dataset.tick, {state:s.prev || "you", tickedByYou:false}); if (get("wins", wid)) del("wins", wid); }
  else { update("admin", t.dataset.tick, {prev:s.state, state:"done", tickedByYou:true, doneAt:todayIso()}); set("wins", wid, {key:"admin", label:"Admin · " + s.t, xp:10, date:todayIso(), at:nowIso(), synced:false}); pop(10, t); } });
document.addEventListener("click", e => { const a = e.target.closest("[data-aedit]"); if (!a || a.querySelector("input")) return; const id = a.dataset.aedit, s = get("admin", id); if (!s) return;
  a.innerHTML = '<input class="field" value="' + esc(s.t) + '" style="padding:6px 10px">'; const i = a.querySelector("input"); i.focus(); i.select();
  const done = () => { const v = i.value.trim(); if (v && v !== s.t) update("admin", id, {t:v}); else render(); };
  i.addEventListener("blur", done); i.addEventListener("keydown", ev => { if (ev.key === "Enter") i.blur(); if (ev.key === "Escape"){ i.value = s.t; i.blur(); } }); });
$("admin-form").addEventListener("submit", e => { e.preventDefault(); const t = $("admin-text").value.trim(); if (!t) return;
  const id = add("admin", {t, w:"Added in the app", state:"you", order:-Date.now()/1e9, date:"", src:"app"}); $("admin-text").value = "";
  toast($("admin-toast"), "Added.", () => del("admin", id)); });

/* ---------- Render ---------- */
let raf = 0;
const R = {home:renderHome, tonight:renderTonight, body:renderBody, money:renderMoney, think:renderThink, people:renderPeople, wish:renderWish, admin:renderAdmin};
function render(){ cancelAnimationFrame(raf); raf = requestAnimationFrame(() => { (R[route] || renderHome)(); }); }

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
document.querySelectorAll(".brand").forEach(b => { b.style.cursor = "pointer"; b.title = "Tap to refresh"; b.addEventListener("click", async () => { if (!sb || !session) return; setSync("Refreshing"); await flush(); await pull(); setSync("Up to date"); setTimeout(() => setSync(""), 1200); }); });
if ("serviceWorker" in navigator && location.protocol === "https:") navigator.serviceWorker.register("sw.js").catch(() => {});
boot();
})();
