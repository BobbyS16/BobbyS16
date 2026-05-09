import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { createClient } from "@supabase/supabase-js";
import confetti from "canvas-confetti";
import { calculateTrainingPoints } from "./utils/trainingPoints.js";
import { usePushSubscription } from "./hooks/usePushSubscription.js";

const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY
);

// Capture Strava OAuth callback synchronously at module load, before Supabase
// can consume the URL params. Persist via sessionStorage so a re-render or
// rewrite doesn't lose the code.
const STRAVA_PENDING_KEY = "strava_pending_code";
(function captureStravaCallback(){
  try {
    const params = new URLSearchParams(window.location.search);
    const code = params.get("code");
    const state = params.get("state");
    const scope = params.get("scope");
    console.log("[Strava] capture URL", { hasCode: !!code, state, scope, search: window.location.search });
    if (code && (state === "strava" || (scope && scope.includes("activity:read")))) {
      sessionStorage.setItem(STRAVA_PENDING_KEY, code);
      console.log("[Strava] code mis en attente dans sessionStorage", code.slice(0,8)+"...");
      const url = new URL(window.location.href);
      url.searchParams.delete("code");
      url.searchParams.delete("state");
      url.searchParams.delete("scope");
      window.history.replaceState({}, "", url.pathname + (url.search ? "?"+url.search.replace(/^\?/, "") : "") + url.hash);
      console.log("[Strava] URL nettoyée:", window.location.href);
    }
  } catch (e) {
    console.error("[Strava] capture failed", e);
  }
})();

const DISCIPLINES = {
  "5km":      { label:"5 km",                icon:"🏃", category:"running",   refTime:13*60,        prestige:1.0 },
  "10km":     { label:"10 km",               icon:"🏃", category:"running",   refTime:27*60,        prestige:1.0 },
  "semi":     { label:"Semi-marathon",       icon:"🏃", category:"running",   refTime:58*60,        prestige:1.1 },
  "marathon": { label:"Marathon",            icon:"🏃", category:"running",   refTime:2*3600+2*60,  prestige:1.2 },
  "trail-s":  { label:"Trail Court (<30km)", icon:"⛰️", category:"trail",     refTime:2*3600+30*60, prestige:1.1, refDplus:1500 },
  "trail-m":  { label:"Trail Moyen (30-60)", icon:"⛰️", category:"trail",     refTime:5*3600+30*60, prestige:1.2, refDplus:2500 },
  "trail-l":  { label:"Trail Long (60-100)", icon:"⛰️", category:"trail",     refTime:10*3600,      prestige:1.3, refDplus:4500 },
  "trail-xl": { label:"Ultra Trail (100+)",  icon:"⛰️", category:"trail",     refTime:20*3600,      prestige:1.5, refDplus:9000 },
  "tri-s":    { label:"Triathlon S",         icon:"🏊", category:"triathlon", refTime:55*60,        prestige:1.1, refDplus:100 },
  "tri-m":    { label:"Triathlon Olympique", icon:"🏊", category:"triathlon", refTime:1*3600+50*60, prestige:1.2, refDplus:400 },
  "tri-l":    { label:"Half Ironman",        icon:"🏊", category:"triathlon", refTime:2*3600+56*60, prestige:1.3, refDplus:1000 },
  "tri-xl":   { label:"Ironman",             icon:"🏊", category:"triathlon", refTime:5*3600+50*60, prestige:1.5, refDplus:2000 },
  "hyrox-open":   { label:"Hyrox Open",      icon:"🔥", category:"hyrox",     refTime:50*60+38,     prestige:1.2 },
  "hyrox-pro":    { label:"Hyrox Pro",       icon:"🔥", category:"hyrox",     refTime:51*60+59,     prestige:1.4 },
  "hyrox-double": { label:"Hyrox Doubles",   icon:"🔥", category:"hyrox",     refTime:47*60+57,     prestige:1.1 },
  "hyrox-relay":  { label:"Hyrox Relay",     icon:"🔥", category:"hyrox",     refTime:45*60+43,     prestige:1.0 },
};

const TRAINING_SPORTS = ["All","Run","Vélo","Natation","Trail"];
const MONTHS_FR = ["Jan","Fév","Mar","Avr","Mai","Jun","Jul","Aoû","Sep","Oct","Nov","Déc"];
const CY = new Date().getFullYear();

const AGE_CATEGORIES = [
  {label:"Benjamins",min:12,max:13},{label:"Minimes",min:14,max:15},
  {label:"Cadets",min:16,max:17},{label:"Juniors",min:18,max:19},
  {label:"Seniors 1",min:20,max:24},{label:"Seniors 2",min:25,max:29},
  {label:"Seniors 3",min:30,max:34},{label:"Seniors 4",min:35,max:39},
  {label:"Master 1",min:40,max:44},{label:"Master 2",min:45,max:49},
  {label:"Master 3",min:50,max:54},{label:"Master 4",min:55,max:59},
  {label:"Master 5",min:60,max:64},{label:"Master 6",min:65,max:69},
  {label:"Master 7",min:70,max:74},{label:"Master 8",min:75,max:79},
  {label:"Master 9",min:80,max:84},{label:"Master 10",min:85,max:99},
];
function getAgeCat(birthYear) {
  if (!birthYear) return null;
  const age = CY - parseInt(birthYear);
  return AGE_CATEGORIES.find(c => age >= c.min && age <= c.max)?.label || null;
}

function CategoryTooltip({birthYear}){
  const [open,setOpen]=useState(false);
  const [pos,setPos]=useState(null);
  const triggerRef=useRef(null);
  useEffect(()=>{
    if(!open){setPos(null);return;}
    const rect=triggerRef.current?.getBoundingClientRect();
    if(!rect) return;
    const bubbleH=28;
    const margin=8;
    const above=rect.top-bubbleH-6;
    const placement=above<margin?"below":"above";
    setPos({
      top: placement==="above"?rect.top-6:rect.bottom+6,
      left: rect.left+rect.width/2,
      placement,
    });
    const close=(e)=>{if(triggerRef.current&&!triggerRef.current.contains(e.target))setOpen(false);};
    document.addEventListener("click",close);
    return ()=>document.removeEventListener("click",close);
  },[open]);
  if(!birthYear) return null;
  const age=CY-parseInt(birthYear);
  const cat=AGE_CATEGORIES.find(c=>age>=c.min&&age<=c.max);
  if(!cat) return null;
  return (
    <span ref={triggerRef} onClick={(e)=>{e.stopPropagation();setOpen(o=>!o);}} style={{borderBottom:"1px dotted rgba(240,237,232,0.4)",cursor:"pointer",fontFamily:"'Barlow',sans-serif"}}>
      {cat.label}
      {open&&pos&&(
        <span style={{position:"fixed",top:pos.top,left:pos.left,transform:pos.placement==="above"?"translate(-50%,-100%)":"translate(-50%,0)",background:"rgba(20,20,20,0.95)",border:"1px solid rgba(240,237,232,0.15)",padding:"6px 10px",borderRadius:6,fontSize:11,color:"#F0EDE8",fontFamily:"'Barlow',sans-serif",whiteSpace:"nowrap",zIndex:10000,pointerEvents:"none",boxShadow:"0 4px 12px rgba(0,0,0,0.4)"}}>{cat.min}-{cat.max} ans</span>
      )}
    </span>
  );
}

function calcPoints(discipline, timeSeconds, elevation) {
  const d = DISCIPLINES[discipline];
  if (!d || !timeSeconds) return 0;
  let effTime = timeSeconds;
  if ((d.category === "trail" || d.category === "triathlon") && d.refDplus && elevation && elevation > 0) {
    // 6 sec / mètre : plus de D+ que la référence → temps effectif réduit (bonus),
    // moins de D+ → temps effectif augmenté (malus). Plancher à 60% pour éviter
    // qu'un D+ démesuré n'inflate le score.
    effTime = Math.max(timeSeconds * 0.6, timeSeconds - (elevation - d.refDplus) * 6);
  }
  return Math.max(0, Math.min(Math.round(1000 * Math.pow(d.refTime / effTime, 2) * d.prestige), 2000));
}
function sumBestPts(results) {
  const best={};
  results.forEach(r=>{const p=calcPoints(r.discipline,r.time,r.elevation);if(!best[r.discipline]||p>best[r.discipline])best[r.discipline]=p;});
  return Object.values(best).reduce((s,p)=>s+p,0);
}
const resultDate=r=>r.race_date||(r.year?`${r.year}-12-31`:null);
function raceBonusPts(seasonResults, allUserResults) {
  if(!seasonResults||seasonResults.length===0) return 0;
  let bonus=0;
  seasonResults.forEach(r=>{
    const rd=resultDate(r);
    const earlier=(allUserResults||[]).filter(x=>x.id!==r.id&&x.discipline===r.discipline&&resultDate(x)&&rd&&resultDate(x)<rd);
    if(earlier.every(p=>p.time>r.time)) bonus+=100;
  });
  const dated=seasonResults.filter(r=>resultDate(r));
  if(dated.length>0){
    const earliest=[...dated].sort((a,b)=>resultDate(a).localeCompare(resultDate(b)))[0];
    if(earliest) bonus+=30;
  }
  return bonus;
}
async function checkAndNotifyOvertake(userId){
  if(!userId)return;
  try{
    const season=CY;
    const lsKey=`last_season_pts_${userId}_${season}`;
    const[{data:myResults},{data:myTrainings}]=await Promise.all([
      supabase.from("results").select("*").eq("user_id",userId),
      supabase.from("trainings").select("*").eq("user_id",userId),
    ]);
    const mySR=(myResults||[]).filter(r=>rYear(r)===season);
    const mySTr=(myTrainings||[]).filter(t=>new Date(t.date).getFullYear()===season);
    const myRP=sumBestPts(mySR);
    const myTP=mySTr.reduce((s,t)=>s+(effectiveTrainingPts(t)),0);
    const myBP=raceBonusPts(mySR,myResults||[])+trainingBonusPts(mySTr);
    const myNew=myRP+myTP+myBP;
    let lastPts=parseInt(localStorage.getItem(lsKey));
    if(isNaN(lastPts)){try{localStorage.setItem(lsKey,String(myNew));}catch{}return;}
    if(myNew<=lastPts){try{localStorage.setItem(lsKey,String(myNew));}catch{}return;}
    const{data:fs}=await supabase.from("friendships").select("friend_id").eq("user_id",userId).eq("status","accepted");
    const friendIds=(fs||[]).map(f=>f.friend_id);
    if(friendIds.length>0){
      const[{data:fRes},{data:fTr}]=await Promise.all([
        supabase.from("results").select("*").in("user_id",friendIds),
        supabase.from("trainings").select("*").in("user_id",friendIds),
      ]);
      const overtaken=friendIds.filter(fid=>{
        const fSR=(fRes||[]).filter(r=>r.user_id===fid&&rYear(r)===season);
        const fSTr=(fTr||[]).filter(t=>t.user_id===fid&&new Date(t.date).getFullYear()===season);
        const fAllRes=(fRes||[]).filter(r=>r.user_id===fid);
        const fPts=sumBestPts(fSR)+fSTr.reduce((s,t)=>s+(effectiveTrainingPts(t)),0)+raceBonusPts(fSR,fAllRes)+trainingBonusPts(fSTr);
        return fPts>=lastPts&&fPts<myNew;
      });
      if(overtaken.length>0){
        console.log(`[overtake] notification envoyée à ${overtaken.length} ami(s)`);
        await supabase.from("notifications").insert(overtaken.map(fid=>({user_id:fid,from_user_id:userId,type:"friend_overtake",read:false,payload:{season,by_pts:Math.max(0,myNew-lastPts)}})));
      }
    }
    try{localStorage.setItem(lsKey,String(myNew));}catch{}
  }catch(e){console.error("[overtake] check failed",e);}
}

// detectLeagueOvertakes — type d du brief notifs auto-générées.
// Compare les rangs intra-ligue (peers du même league_group_id sur week_points)
// avant/après save d'un result. Si le user a amélioré son rang ET certains peers
// l'ont vu monter au-dessus d'eux, insère 2 notifs par paire (overtaker direction
// 'up', overtaken direction 'down'). Snapshot via localStorage pour comparer
// avec l'état précédent. Dedup 1h sur (user_id, from_user_id, type) côté DB.
async function detectLeagueOvertakes(userId) {
  if (!userId) return;
  try {
    const { data: myLeague } = await supabase
      .from("user_leagues")
      .select("league_group_id, current_league, week_points")
      .eq("user_id", userId)
      .maybeSingle();
    if (!myLeague?.league_group_id) return;

    const { data: peers } = await supabase
      .from("user_leagues")
      .select("user_id, week_points")
      .eq("league_group_id", myLeague.league_group_id);
    if (!peers || peers.length < 2) return;

    const sorted = [...peers].sort((a, b) => (b.week_points || 0) - (a.week_points || 0));
    const ranksNow = Object.fromEntries(sorted.map((p, i) => [p.user_id, i + 1]));

    const cacheKey = `league_ranks_${myLeague.league_group_id}_${userId}`;
    let ranksPrev = {};
    try { ranksPrev = JSON.parse(localStorage.getItem(cacheKey) || "{}"); } catch {}

    const myRankNow = ranksNow[userId];
    const myRankPrev = ranksPrev[userId];

    // Premier passage : on initialise le cache et on sort, pas de comparaison.
    if (myRankPrev === undefined) {
      try { localStorage.setItem(cacheKey, JSON.stringify(ranksNow)); } catch {}
      return;
    }

    if (myRankNow < myRankPrev) {
      // Peers que j'ai dépassés : ils étaient au-dessus de mon nouveau rang
      // (rangPrev <= myRankPrev) et ils ont vu leur rang descendre.
      const overtaken = peers.filter(p => {
        if (p.user_id === userId) return false;
        const pPrev = ranksPrev[p.user_id];
        const pNow = ranksNow[p.user_id];
        return pPrev !== undefined
          && pNow !== undefined
          && pNow > pPrev
          && pPrev >= myRankNow
          && pPrev <= myRankPrev;
      });

      if (overtaken.length > 0) {
        const myWeekPts = myLeague.week_points || 0;
        const oneHourAgo = new Date(Date.now() - 3600 * 1000).toISOString();

        for (const peer of overtaken) {
          const peerWeekPts = peer.week_points || 0;
          const byPts = Math.max(0, myWeekPts - peerWeekPts);
          const leagueName = myLeague.current_league;

          // Dedup côté DB : si on a déjà notifié ce couple direct dans la
          // dernière heure, skip les 2 inserts pour rester cohérent.
          const { data: existing } = await supabase
            .from("notifications")
            .select("id")
            .eq("type", "league_overtake")
            .eq("user_id", userId)
            .eq("from_user_id", peer.user_id)
            .gt("created_at", oneHourAgo)
            .limit(1);
          if (existing && existing.length > 0) continue;

          await supabase.from("notifications").insert([
            {
              user_id: userId,
              from_user_id: peer.user_id,
              type: "league_overtake",
              read: false,
              payload: {
                old_rank: myRankPrev,
                new_rank: myRankNow,
                league_name: leagueName,
                by_pts: byPts,
                direction: "up",
              },
            },
            {
              user_id: peer.user_id,
              from_user_id: userId,
              type: "league_overtake",
              read: false,
              payload: {
                old_rank: ranksPrev[peer.user_id],
                new_rank: ranksNow[peer.user_id],
                league_name: leagueName,
                by_pts: byPts,
                direction: "down",
              },
            },
          ]);
        }
      }
    }

    try { localStorage.setItem(cacheKey, JSON.stringify(ranksNow)); } catch {}
  } catch (e) {
    console.error("[league-overtake] detection failed", e);
  }
}

// ── CELEBRATION + OVERTAKES ───────────────────────────────────────────────────
const PACERANK_COLORS = ["#E63946","#FFD700","#F0EDE8","#4ADE80","#FF6B35"];
function fireBurst(opts={}) {
  try { confetti({ particleCount:80, spread:70, origin:{y:0.6}, colors:PACERANK_COLORS, ...opts }); } catch {}
}
function fireCelebration(durationMs=2500) {
  const end = Date.now() + durationMs;
  (function frame(){
    try {
      confetti({ particleCount:4, angle:60, spread:55, origin:{x:0,y:0.7}, colors:PACERANK_COLORS });
      confetti({ particleCount:4, angle:120, spread:55, origin:{x:1,y:0.7}, colors:PACERANK_COLORS });
    } catch {}
    if (Date.now() < end) requestAnimationFrame(frame);
  })();
}

const OVERTAKE_CACHE_KEY = (uid) => `overtake_state_${uid}`;
const OVERTAKE_NOTIF_KEY = (uid, fid, dir) => `overtake_notif_${uid}_${fid}_${dir}`;
const OVERTAKE_THROTTLE_MS = 24 * 3600 * 1000;
const OVERTAKE_INACTIVE_DAYS = 30;

async function fetchProfilesByIds(ids) {
  if (!ids || ids.length === 0) return [];
  const {data} = await supabase.from("profiles").select("id,name,avatar").in("id", ids);
  return data || [];
}

async function getActiveFriendIds(userId) {
  const {data:fs} = await supabase.from("friendships").select("friend_id").eq("user_id", userId).eq("status","accepted");
  const ids = (fs||[]).map(f=>f.friend_id);
  if (ids.length === 0) return [];
  const cutoff = new Date(Date.now() - OVERTAKE_INACTIVE_DAYS*86400000).toISOString().slice(0,10);
  const [recentTr, recentRes] = await Promise.all([
    supabase.from("trainings").select("user_id").in("user_id", ids).gte("date", cutoff),
    supabase.from("results").select("user_id").in("user_id", ids).gte("race_date", cutoff),
  ]);
  const active = new Set([
    ...(recentTr.data||[]).map(r=>r.user_id),
    ...(recentRes.data||[]).map(r=>r.user_id),
  ]);
  return ids.filter(id => active.has(id));
}

async function computeSeasonPtsMap(userIds, season) {
  if (userIds.length === 0) return {};
  const [resR, trR] = await Promise.all([
    supabase.from("results").select("*").in("user_id", userIds),
    supabase.from("trainings").select("*").in("user_id", userIds),
  ]);
  const allRes = resR.data || [];
  const allTr = trR.data || [];
  const map = {};
  for (const uid of userIds) {
    const userAllRes = allRes.filter(r => r.user_id === uid);
    const userAllTr = allTr.filter(t => t.user_id === uid);
    const seasonRes = userAllRes.filter(r => rYear(r) === season);
    const seasonTr = userAllTr.filter(t => new Date(t.date).getFullYear() === season);
    const racePts = sumBestPts(seasonRes);
    const trainPts = seasonTr.reduce((s,t) => s + effectiveTrainingPts(t), 0);
    const bonusPts = raceBonusPts(seasonRes, userAllRes) + trainingBonusPts(seasonTr);
    map[uid] = racePts + trainPts + bonusPts;
  }
  return map;
}

async function detectOvertakes(userId, mode="afterSave") {
  if (!userId) return [];
  try {
    const friendIds = await getActiveFriendIds(userId);
    if (friendIds.length === 0) return [];
    const ptsMap = await computeSeasonPtsMap([userId, ...friendIds], CY);
    const myPts = ptsMap[userId] || 0;
    let cache = {};
    try { cache = JSON.parse(localStorage.getItem(OVERTAKE_CACHE_KEY(userId))) || {}; } catch {}
    const oldMyPts = (typeof cache.myPts === "number") ? cache.myPts : myPts;
    const oldFriends = cache.friendsPts || {};
    const overtakes = [];
    const now = Date.now();
    for (const fid of friendIds) {
      const fPts = ptsMap[fid] || 0;
      const oldFPts = (typeof oldFriends[fid] === "number") ? oldFriends[fid] : fPts;
      const condA = mode === "afterSave" && oldFPts > oldMyPts && fPts < myPts;
      const condB = mode === "onLoad" && oldFPts < oldMyPts && fPts > myPts;
      if (!condA && !condB) continue;
      const dir = condA ? "a" : "b";
      const k = OVERTAKE_NOTIF_KEY(userId, fid, dir);
      const last = parseInt(localStorage.getItem(k) || "0");
      if (now - last < OVERTAKE_THROTTLE_MS) continue;
      overtakes.push({ friendId:fid, gap: condA ? (myPts - fPts) : (fPts - myPts), dir });
      try { localStorage.setItem(k, String(now)); } catch {}
    }
    try { localStorage.setItem(OVERTAKE_CACHE_KEY(userId), JSON.stringify({ myPts, friendsPts: ptsMap })); } catch {}
    return overtakes;
  } catch (e) {
    console.error("[overtake] detection failed", e);
    return [];
  }
}

// New PR detection: returns true if the just-saved race is the user's best time on this discipline.
async function isNewPR(userId, discipline, time) {
  if (!userId || !discipline || !time) return false;
  try {
    const {data} = await supabase.from("results").select("time").eq("user_id", userId).eq("discipline", discipline);
    if (!data || data.length === 0) return false;
    const previousBest = Math.min(...data.filter(r => r.time !== time).map(r => r.time));
    return !isFinite(previousBest) ? true : time <= previousBest;
  } catch { return false; }
}

function OvertakeCelebrationModal({ overtakes, profiles, onClose }) {
  useEffect(() => {
    fireCelebration(2500);
    try { navigator.vibrate?.(50); } catch {}
  }, []);
  if (!overtakes || overtakes.length === 0) return null;
  const friendNames = overtakes.map(o => {
    const p = profiles.find(p => p.id === o.friendId);
    return (p?.name || "un ami").split(" ")[0];
  });
  const totalGap = overtakes.reduce((s,o)=>s+o.gap, 0);
  const friendList = friendNames.length === 1
    ? friendNames[0]
    : friendNames.length === 2
      ? `${friendNames[0]} et ${friendNames[1]}`
      : `${friendNames.slice(0,-1).join(", ")} et ${friendNames[friendNames.length-1]}`;
  return (
    <div onClick={onClose} style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.92)",backdropFilter:"blur(20px)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:600,padding:24}}>
      <div onClick={e=>e.stopPropagation()} style={{textAlign:"center",maxWidth:420,width:"100%"}}>
        <div style={{display:"flex",justifyContent:"center",gap:8,marginBottom:18}}>
          {overtakes.slice(0,4).map(o => {
            const p = profiles.find(pp => pp.id === o.friendId);
            return (
              <div key={o.friendId} style={{position:"relative"}}>
                <Avatar profile={p} size={42}/>
                <div style={{position:"absolute",bottom:-6,right:-6,fontSize:18}}>↘️</div>
              </div>
            );
          })}
        </div>
        <div style={{fontSize:74,marginBottom:6,animation:"celeb-bounce 0.9s cubic-bezier(.34,1.56,.64,1)"}}>🔥</div>
        <div style={{fontFamily:"'Bebas Neue'",fontSize:28,letterSpacing:1.5,color:"#F0EDE8",lineHeight:1.05,marginBottom:10,padding:"0 8px"}}>
          TU AS DÉPASSÉ {friendList.toUpperCase()} !
        </div>
        <div style={{fontFamily:"'Barlow',sans-serif",fontSize:13,color:"rgba(240,237,232,0.7)",marginBottom:26}}>
          +{totalGap} pts d'avance désormais
        </div>
        <button onClick={onClose} style={{background:"#E63946",border:"none",borderRadius:14,padding:"13px 28px",color:"#fff",fontFamily:"'Barlow',sans-serif",fontWeight:700,fontSize:15,cursor:"pointer",letterSpacing:0.5}}>
          On continue 🔥
        </button>
      </div>
    </div>
  );
}

function OvertakenDetailModal({ overtakes, profiles, onClose, onAddActivity }) {
  if (!overtakes || overtakes.length === 0) return null;
  const top = overtakes[0];
  const profile = profiles.find(p => p.id === top.friendId);
  const firstName = (profile?.name || "Ton ami").split(" ")[0];
  const sessionsToCatchUp = Math.max(1, Math.ceil(top.gap / 25));
  return (
    <Modal onClose={onClose}>
      <div style={{textAlign:"center",paddingTop:8}}>
        <Avatar profile={profile} size={72}/>
        <div style={{fontFamily:"'Bebas Neue'",fontSize:22,color:"#F0EDE8",letterSpacing:1.2,marginTop:14,lineHeight:1.1}}>
          {firstName.toUpperCase()} T'A DOUBLÉ
        </div>
        <div style={{fontSize:13,color:"rgba(240,237,232,0.65)",fontFamily:"'Barlow',sans-serif",marginTop:6,marginBottom:18}}>
          de <span style={{color:"#FC4C02",fontWeight:700}}>{top.gap} pts</span> cette saison
        </div>
        <div style={{background:"rgba(252,76,2,0.08)",border:"1px solid rgba(252,76,2,0.2)",borderRadius:12,padding:"12px 14px",marginBottom:16,textAlign:"left"}}>
          <div style={{fontSize:11,color:"rgba(240,237,232,0.45)",fontFamily:"'Barlow',sans-serif",fontWeight:700,letterSpacing:1,textTransform:"uppercase",marginBottom:6}}>Comment repasser devant</div>
          <div style={{fontSize:14,color:"#F0EDE8",fontFamily:"'Barlow',sans-serif",lineHeight:1.4}}>
            ≈ <span style={{color:"#FFD700",fontWeight:700}}>{sessionsToCatchUp} séance{sessionsToCatchUp>1?"s":""}</span> de footing 30 min ou une bonne course officielle.
          </div>
        </div>
        <Btn onClick={()=>{onClose();onAddActivity?.();}} mb={6}>+ Ajouter une activité</Btn>
        <Btn onClick={onClose} variant="secondary" mb={0}>Plus tard</Btn>
      </div>
    </Modal>
  );
}

// ── LEAGUE PROMO + POINTS MILESTONES ──────────────────────────────────────────
// NB: les `id` (bronze/silver/gold/diamond/elite) restent les valeurs stockées
// en BDD (last_league_seen, user_leagues.current_league). Seuls les labels
// affichés sont renommés (Rookie/Pro/Elite/Legend/Mythic). Une migration SQL
// pourra renommer les ids plus tard si besoin.
const LEAGUE_ORDER = ["bronze","silver","gold","diamond","elite"];
const LEAGUE_PALETTES = {
  bronze:  ["#27AE60","#1FA053","#F0EDE8"],
  silver:  ["#4A90D9","#3A80C9","#F0EDE8"],
  gold:    ["#9B59B6","#8B49A6","#F0EDE8"],
  diamond: ["#FF6B35","#EF5B25","#F0EDE8"],
  elite:   ["#FF073A","#E60030","#F0EDE8"],
};
const LEAGUE_TAGLINES = {
  bronze:  "C'est parti, le voyage commence 🔥",
  silver:  "Tu progresses, continue comme ça 💪",
  gold:    "Tu fais partie de l'élite 🥇",
  diamond: "Tu joues dans la cour des grands 💎",
  elite:   "Tu es au sommet 👑",
};
const POINTS_MILESTONES = [1000, 2000, 5000, 10000, 20000, 50000];
const MILESTONE_TAGLINES = {
  1000:  "Premier cap, t'es lancé 🔥",
  2000:  "Tu prends le rythme 💪",
  5000:  "Sérieusement bien joué ⚡",
  10000: "Tu fais partie des dingues 🚀",
  20000: "Machine de guerre 💀",
  50000: "Tu es entré dans la légende 👑",
};

const CELEB_ENABLED_KEY = "celebrations_enabled";
function celebrationsEnabled() {
  try { return localStorage.getItem(CELEB_ENABLED_KEY) !== "false"; } catch { return true; }
}
function setCelebrationsEnabledLocal(v) {
  try { localStorage.setItem(CELEB_ENABLED_KEY, String(!!v)); } catch {}
}

function fireLeagueCelebration(leagueId) {
  const colors = LEAGUE_PALETTES[leagueId] || PACERANK_COLORS;
  const end = Date.now() + 3000;
  (function frame(){
    try {
      confetti({ particleCount:5, angle:60, spread:60, origin:{x:0,y:0.7}, colors });
      confetti({ particleCount:5, angle:120, spread:60, origin:{x:1,y:0.7}, colors });
    } catch {}
    if (Date.now() < end) requestAnimationFrame(frame);
  })();
}

async function detectLeaguePromotion(userId, lastLeagueSeen) {
  if (!userId) return null;
  try {
    const {data:row} = await supabase.from("user_leagues").select("current_league").eq("user_id", userId).maybeSingle();
    const currentLeague = row?.current_league || "bronze";
    const lastIdx = LEAGUE_ORDER.indexOf(lastLeagueSeen || "bronze");
    const curIdx = LEAGUE_ORDER.indexOf(currentLeague);
    if (curIdx > lastIdx) return currentLeague;
    return null;
  } catch (e) {
    console.error("[league-promo] detection failed", e);
    return null;
  }
}

function detectPointsMilestone(currentPoints, lastMilestone) {
  const last = lastMilestone || 0;
  let highestCrossed = null;
  for (const m of POINTS_MILESTONES) {
    if (m > last && currentPoints >= m) highestCrossed = m;
  }
  return highestCrossed;
}

function LeaguePromotionModal({ leagueId, onClose, onViewRanking }) {
  const league = LEAGUES.find(l => l.id === leagueId) || LEAGUES[0];
  useEffect(() => {
    if (!celebrationsEnabled()) return;
    fireLeagueCelebration(leagueId);
    try { navigator.vibrate?.([50,30,50,30,100]); } catch {}
  }, [leagueId]);
  return (
    <div onClick={onClose} style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.94)",backdropFilter:"blur(20px)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:600,padding:24}}>
      <div onClick={e=>e.stopPropagation()} style={{textAlign:"center",maxWidth:420,width:"100%"}}>
        <div style={{display:"inline-block",animation:"celeb-bounce 0.9s cubic-bezier(.34,1.56,.64,1)"}}>
          <div style={{width:120,height:120,borderRadius:"50%",background:league.bg,border:`4px solid ${league.color}`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:64,marginBottom:18,boxShadow:`0 0 40px ${league.color}66`}}>
            {league.icon}
          </div>
        </div>
        <div style={{fontFamily:"'Bebas Neue'",fontSize:32,letterSpacing:2,color:league.color,lineHeight:1,marginBottom:6}}>PROMOTION !</div>
        <div style={{fontFamily:"'Bebas Neue'",fontSize:20,letterSpacing:1,color:"#F0EDE8",marginBottom:8}}>Bienvenue en Ligue {league.label} 🏆</div>
        <div style={{fontFamily:"'Barlow',sans-serif",fontSize:13,color:"rgba(240,237,232,0.7)",marginBottom:26,padding:"0 12px",lineHeight:1.4}}>
          {LEAGUE_TAGLINES[leagueId]}
        </div>
        <button onClick={()=>{onClose();onViewRanking?.();}} style={{background:league.color,border:"none",borderRadius:14,padding:"12px 24px",color:"#1a1a1a",fontFamily:"'Barlow',sans-serif",fontWeight:700,fontSize:14,cursor:"pointer",letterSpacing:0.5,marginRight:8}}>
          Voir mon classement
        </button>
        <button onClick={onClose} style={{background:"rgba(255,255,255,0.08)",border:"none",borderRadius:14,padding:"12px 24px",color:"#F0EDE8",fontFamily:"'Barlow',sans-serif",fontWeight:700,fontSize:14,cursor:"pointer",letterSpacing:0.5}}>
          Continuer 🚀
        </button>
      </div>
    </div>
  );
}

function CelebrationToast({ item, onClose }) {
  useEffect(() => {
    const t = setTimeout(onClose, 2800);
    return () => clearTimeout(t);
  }, [onClose]);
  let label = "";
  if (item.type === "league") label = `🏆 Promotion en Ligue ${LEAGUES.find(l=>l.id===item.leagueId)?.label||item.leagueId}`;
  else if (item.type === "milestone") label = `🎯 Cap des ${item.milestone.toLocaleString("fr-FR")} pts franchi`;
  else if (item.type === "overtake") {
    const names = item.overtakes.slice(0,2).map(o => (item.profiles.find(p=>p.id===o.friendId)?.name||"un ami").split(" ")[0]).join(", ");
    label = `🔥 Tu as dépassé ${names}${item.overtakes.length>2?` +${item.overtakes.length-2}`:""}`;
  }
  return (
    <div onClick={onClose} style={{position:"fixed",top:"calc(env(safe-area-inset-top, 0px) + 14px)",left:"50%",transform:"translateX(-50%)",background:"rgba(22,22,22,0.96)",border:"1px solid rgba(74,222,128,0.4)",color:"#4ADE80",fontFamily:"'Barlow',sans-serif",fontWeight:700,fontSize:13,padding:"9px 18px",borderRadius:12,zIndex:600,boxShadow:"0 4px 20px rgba(0,0,0,0.4)",cursor:"pointer",animation:"ptr-toast-in 0.18s ease",maxWidth:"calc(100% - 32px)",whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{label}</div>
  );
}

function CelebrationQueueRenderer({ queue, paused, onClose, onViewRanking }) {
  if (paused || queue.length === 0) return null;
  const item = queue[0];
  if (!celebrationsEnabled()) {
    return <CelebrationToast item={item} onClose={onClose}/>;
  }
  if (item.type === "league") return <LeaguePromotionModal leagueId={item.leagueId} onClose={onClose} onViewRanking={onViewRanking}/>;
  if (item.type === "milestone") return <PointsMilestoneModal milestone={item.milestone} prevPoints={item.prevPoints} newPoints={item.newPoints} onClose={onClose}/>;
  if (item.type === "overtake") return <OvertakeCelebrationModal overtakes={item.overtakes} profiles={item.profiles} onClose={onClose}/>;
  return null;
}

function PointsMilestoneModal({ milestone, prevPoints, newPoints, onClose }) {
  const [displayPts, setDisplayPts] = useState(prevPoints || 0);
  useEffect(() => {
    if (!celebrationsEnabled()) return;
    fireCelebration(2500);
    try { navigator.vibrate?.([30,50,30]); } catch {}
    const start = Date.now();
    const duration = 1400;
    const from = prevPoints || 0;
    const to = newPoints || milestone;
    const tick = () => {
      const elapsed = Date.now() - start;
      const t = Math.min(1, elapsed/duration);
      const eased = 1 - Math.pow(1-t, 3);
      setDisplayPts(Math.round(from + (to - from) * eased));
      if (t < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }, [milestone, prevPoints, newPoints]);

  return (
    <div onClick={onClose} style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.92)",backdropFilter:"blur(20px)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:600,padding:24}}>
      <div onClick={e=>e.stopPropagation()} style={{textAlign:"center",maxWidth:420,width:"100%"}}>
        <div style={{fontSize:64,marginBottom:8,animation:"celeb-bounce 0.8s cubic-bezier(.34,1.56,.64,1)"}}>🏆</div>
        <div style={{fontFamily:"'Bebas Neue'",fontSize:46,letterSpacing:2,color:"#FFD700",lineHeight:1,marginBottom:6,textShadow:"0 0 20px rgba(255,215,0,0.5)"}}>{displayPts.toLocaleString("fr-FR")}</div>
        <div style={{fontFamily:"'Bebas Neue'",fontSize:20,letterSpacing:1.5,color:"#F0EDE8",marginBottom:12}}>POINTS !</div>
        <div style={{fontFamily:"'Barlow',sans-serif",fontSize:13,color:"rgba(240,237,232,0.7)",marginBottom:26,padding:"0 12px",lineHeight:1.4}}>
          {MILESTONE_TAGLINES[milestone] || `Cap des ${milestone.toLocaleString("fr-FR")} points franchi !`}
        </div>
        <button onClick={onClose} style={{background:"#E63946",border:"none",borderRadius:14,padding:"13px 28px",color:"#fff",fontFamily:"'Barlow',sans-serif",fontWeight:700,fontSize:15,cursor:"pointer",letterSpacing:0.5}}>
          On continue 🔥
        </button>
      </div>
    </div>
  );
}

function trainingBonusPts(seasonTrainings) {
  if(!seasonTrainings||seasonTrainings.length===0) return 0;
  let bonus=0;
  const days=[...new Set(seasonTrainings.map(t=>t.date).filter(Boolean))].sort();
  if(days.length>0){
    const streaks=[];
    let cur=1;
    for(let i=1;i<days.length;i++){
      const diff=(new Date(days[i])-new Date(days[i-1]))/86400000;
      if(Math.round(diff)===1) cur++;
      else { streaks.push(cur); cur=1; }
    }
    streaks.push(cur);
    streaks.forEach(len=>{
      if(len>=30) bonus+=500;
      else if(len>=7) bonus+=100;
    });
  }
  const byMonth={};
  seasonTrainings.forEach(t=>{if(!t.date)return;const m=t.date.slice(0,7);byMonth[m]=(byMonth[m]||0)+(t.distance||0);});
  Object.values(byMonth).forEach(km=>{ if(km>=100) bonus+=200; });
  return bonus;
}
function fmtDuration(sec){if(!sec)return"";const h=Math.floor(sec/3600),m=Math.floor((sec%3600)/60),s=sec%60;return h>0?`${h}h${String(m).padStart(2,"0")}`:`${String(m).padStart(2,"0")}:${String(s).padStart(2,"0")}`;}
function parseDurStr(s){if(!s)return 0;const p=s.split(":").map(Number);return(p[0]||0)*3600+(p[1]||0)*60+(p[2]||0);}
function getSwimIntensity(paceSecPer100m) {
  if (paceSecPer100m <= 80)  return 12;
  if (paceSecPer100m <= 90)  return 10;
  if (paceSecPer100m <= 100) return 8;
  if (paceSecPer100m <= 110) return 7;
  if (paceSecPer100m <= 120) return 6;
  if (paceSecPer100m <= 130) return 5;
  if (paceSecPer100m <= 140) return 4;
  return 2;
}
function calcTrainingPts(distKm, sport, durationSec) {
  const d = distKm||0;
  if(!d) return 0;
  const sec = parseInt(durationSec)||0;
  if(sport==="Natation"){
    if(sec<=0) return 0;
    const distM = d*1000;
    const paceSec100 = sec*100/distM;
    return Math.round((distM/100) * getSwimIntensity(paceSec100) * 0.4);
  }
  let intensity = 3;
  if(sec > 0) {
    if(sport==="Run"||sport==="Trail"){
      const pace = (sec/60)/d;
      intensity = pace<4?10:pace<5?7:pace<6?5:3;
    } else if(sport==="Vélo"){
      const speed = d/(sec/3600);
      intensity = speed>=40?10:speed>=32?7:speed>=25?5:3;
    }
  }
  return Math.round(d * intensity * 0.2);
}
function effectiveTrainingPts(t) {
  if (!t) return 0;
  if (t.is_official_race) return 0;
  return t.points || calcTrainingPts(t.distance, t.sport, t.duration);
}
function normalizeText(s) {
  if (!s) return "";
  return s.toString().toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g,"");
}
const OFFICIAL_RACE_KEYWORDS = [
  // Forts
  "marathon","semi-marathon","semi marathon","trail","ultra","triathlon","ironman","hyrox","championnat","championnats","utmb",
  // Faibles / explicites
  "10 km","10km","5 km","5km","tri ","iron","half iron","70.3","olympique","sprint distance","h race",
  "course de","officiel","competition","edition","race","compet",
];
function detectOfficialRace(title) {
  const norm = normalizeText(title);
  if (!norm) return false;
  if (OFFICIAL_RACE_KEYWORDS.some(k => norm.includes(k))) return true;
  // Patterns numériques courants : "10k", "5k", "21k", "42k"
  if (/\b(5|10|15|21|42)\s*k(m)?\b/.test(norm)) return true;
  return false;
}
function detectRaceFormat(title) {
  const norm = normalizeText(title);
  if (!norm) return null;
  if (/\b5\s*k(m)?\b/.test(norm)) return "5km";
  if (/\b10\s*k(m)?\b/.test(norm)) return "10km";
  if (/semi[\s-]?marathon|\bsemi\b/.test(norm)) return "semi";
  if (/\bmarathon\b/.test(norm)) return "marathon";
  if (/utmb/.test(norm)) return "trail-xl";
  if (/\bultra\b/.test(norm)) return "trail-xl";
  if (/ironman|\b70\.?3\b|half[\s-]?iron/.test(norm)) return /ironman/.test(norm) && !/half/.test(norm) ? "tri-xl" : "tri-l";
  if (/olympique/.test(norm)) return "tri-m";
  if (/\bsprint\b/.test(norm)) return "tri-s";
  if (/triathlon|\btri\b/.test(norm)) return "tri-m";
  if (/hyrox.*pro/.test(norm)) return "hyrox-pro";
  if (/hyrox.*relay/.test(norm)) return "hyrox-relay";
  if (/hyrox.*double/.test(norm)) return "hyrox-double";
  if (/hyrox/.test(norm)) return "hyrox-open";
  if (/trail/.test(norm)) return "trail-m";
  return null;
}
const RACE_FORMAT_OPTIONS = [
  {value:"5km", label:"Course · 5 km"},
  {value:"10km", label:"Course · 10 km"},
  {value:"semi", label:"Course · Semi-marathon"},
  {value:"marathon", label:"Course · Marathon"},
  {value:"trail-s", label:"Trail S (<25 km)"},
  {value:"trail-m", label:"Trail M (25-50 km)"},
  {value:"trail-l", label:"Trail L (>50 km)"},
  {value:"trail-xl", label:"Ultra (>80 km)"},
  {value:"tri-s", label:"Triathlon · Sprint"},
  {value:"tri-m", label:"Triathlon · Olympique (M)"},
  {value:"tri-l", label:"Triathlon · Half-Iron"},
  {value:"tri-xl", label:"Triathlon · Ironman"},
  {value:"hyrox-pro", label:"Hyrox · Pro"},
  {value:"hyrox-open", label:"Hyrox · Open"},
  {value:"hyrox-double", label:"Hyrox · Doubles"},
  {value:"hyrox-relay", label:"Hyrox · Relay"},
];
function getLevel(pts) {
  if (pts >= 900) return {label:"Master",  color:"#E63946"};
  if (pts >= 700) return {label:"Diamant", color:"#00D4FF"};
  if (pts >= 500) return {label:"Platine", color:"#5DADE2"};
  if (pts >= 350) return {label:"Or",      color:"#FFD700"};
  if (pts >= 200) return {label:"Argent",  color:"#C0C0C0"};
  return                 {label:"Bronze",  color:"#CD7F32"};
}
function getSeasonLevel(pts) {
  if (pts >= 9000) return {label:"UltraStar", color:"#FF1493"};
  if (pts >= 6500) return {label:"SuperStar", color:"#FF6B35"};
  if (pts >= 4500) return {label:"Star",      color:"#00D4FF"};
  if (pts >= 3000) return {label:"Élite",     color:"#FFD700"};
  if (pts >= 2000) return {label:"Expert",    color:"#C0C0C0"};
  if (pts >= 1300) return {label:"Avancé",    color:"#CD7F32"};
  if (pts >= 700)  return {label:"Confirmé",  color:"#9B59B6"};
  if (pts >= 300)  return {label:"Interméd.", color:"#4A90D9"};
  return                  {label:"Débutant",  color:"#27AE60"};
}
function fmtTime(s) {
  if (!s && s !== 0) return "--:--:--";
  const h=Math.floor(s/3600),m=Math.floor((s%3600)/60),sec=s%60;
  return `${String(h).padStart(2,"0")}:${String(m).padStart(2,"0")}:${String(sec).padStart(2,"0")}`;
}

const BADGES = [
  // Course à pied
  {id:"finisher_marathon", cat:"Course",     emoji:"🏁", label:"Finisher Marathon",  color:"#E63946", check:({results})=>results.some(r=>r.discipline==="marathon")},
  {id:"sub4_marathon",     cat:"Course",     emoji:"🥉", label:"Sub-4h Marathon",    color:"#CD7F32", check:({results})=>results.some(r=>r.discipline==="marathon"&&r.time<4*3600)},
  {id:"sub3h30_marathon",  cat:"Course",     emoji:"🥈", label:"Sub-3h30 Marathon",  color:"#C0C0C0", check:({results})=>results.some(r=>r.discipline==="marathon"&&r.time<3*3600+30*60)},
  {id:"sub3_marathon",     cat:"Course",     emoji:"🥇", label:"Sub-3h Marathon",    color:"#FFD700", check:({results})=>results.some(r=>r.discipline==="marathon"&&r.time<3*3600)},
  {id:"sub1h40_semi",      cat:"Course",     emoji:"⚡", label:"Sub-1h40 Semi",      color:"#FF6B35", check:({results})=>results.some(r=>r.discipline==="semi"&&r.time<1*3600+40*60)},
  {id:"sub1h30_semi",      cat:"Course",     emoji:"⚡", label:"Sub-1h30 Semi",      color:"#FFD700", check:({results})=>results.some(r=>r.discipline==="semi"&&r.time<1*3600+30*60)},
  {id:"sub50_10k",         cat:"Course",     emoji:"🏃", label:"Sub-50 10km",        color:"#FF6B35", check:({results})=>results.some(r=>r.discipline==="10km"&&r.time<50*60)},
  {id:"sub40_10k",         cat:"Course",     emoji:"🏃", label:"Sub-40 10km",        color:"#FFD700", check:({results})=>results.some(r=>r.discipline==="10km"&&r.time<40*60)},
  {id:"sub30_5k",          cat:"Course",     emoji:"💨", label:"Sub-30 5km",         color:"#FF6B35", check:({results})=>results.some(r=>r.discipline==="5km"&&r.time<30*60)},
  {id:"sub18_5k",          cat:"Course",     emoji:"🚀", label:"Sub-18 5km",         color:"#FFD700", check:({results})=>results.some(r=>r.discipline==="5km"&&r.time<18*60)},
  {id:"finisher_100k",     cat:"Course",     emoji:"💯", label:"Finisher 100 km",    color:"#27AE60", check:({results,trainings})=>results.some(r=>r.discipline==="trail-xl")||(trainings||[]).some(t=>(t.distance||0)>=100)},

  // Trail
  {id:"first_trail",       cat:"Trail",      emoji:"⛰️", label:"Premier trail",      color:"#27AE60", check:({results})=>results.some(r=>DISCIPLINES[r.discipline]?.category==="trail")},
  {id:"ultra_trail",       cat:"Trail",      emoji:"🏔️", label:"Ultra traileur",     color:"#27AE60", check:({results})=>results.some(r=>r.discipline==="trail-xl")},

  // Triathlon
  {id:"first_tri",         cat:"Triathlon",  emoji:"🏊", label:"Premier triathlon",  color:"#3498DB", check:({results})=>results.some(r=>DISCIPLINES[r.discipline]?.category==="triathlon")},
  {id:"triple_crown",      cat:"Triathlon",  emoji:"👑", label:"Triple couronne",    color:"#FFD700", check:({results})=>{const ds=new Set(results.map(r=>r.discipline));return ds.has("tri-s")&&ds.has("tri-m")&&ds.has("tri-l");}},
  {id:"quad_crown",        cat:"Triathlon",  emoji:"👑", label:"Quadruple couronne", color:"#FFD700", check:({results})=>{const ds=new Set(results.map(r=>r.discipline));return ds.has("tri-s")&&ds.has("tri-m")&&ds.has("tri-l")&&ds.has("tri-xl");}},
  {id:"ironman",           cat:"Triathlon",  emoji:"🦾", label:"Ironman",            color:"#E63946", check:({results})=>results.some(r=>r.discipline==="tri-xl")},

  // Régularité
  {id:"active_3_months",   cat:"Régularité", emoji:"📅", label:"Actif 3 mois",       color:"#3498DB", check:({trainings})=>{
    const ms=[...new Set((trainings||[]).map(t=>t.date?.slice(0,7)).filter(Boolean))].sort();
    let streak=0,prev=null;
    for(const m of ms){
      if(!prev){streak=1;}else{const[py,pm]=prev.split("-").map(Number),[y,mo]=m.split("-").map(Number);if(y*12+mo===py*12+pm+1)streak++;else streak=1;}
      if(streak>=3)return true;
      prev=m;
    }
    return false;
  }},
  {id:"ten_races_year",    cat:"Régularité", emoji:"🔟", label:"10 courses / an",    color:"#FF6B35", check:({results})=>{const by={};results.forEach(r=>{by[r.year]=(by[r.year]||0)+1;});return Object.values(by).some(n=>n>=10);}},
  {id:"four_seasons",      cat:"Régularité", emoji:"🍂", label:"4 saisons",          color:"#9B59B6", check:({results})=>{const yq={};(results||[]).forEach(r=>{if(!r.race_date)return;const d=new Date(r.race_date);if(isNaN(d))return;const y=d.getFullYear(),q=Math.floor(d.getMonth()/3);if(!yq[y])yq[y]=new Set();yq[y].add(q);});return Object.values(yq).some(qs=>qs.size>=4);}},
  {id:"loyal",             cat:"Régularité", emoji:"⭐", label:"Toujours là",        color:"#FFD700", check:({profile})=>!!profile?.created_at&&(Date.now()-new Date(profile.created_at).getTime())>=2*365*24*3600*1000},

  // Social
  {id:"first_friend",      cat:"Social",     emoji:"🤝", label:"Premier ami",        color:"#E63946", check:({friendCount})=>friendCount>=1},
  {id:"five_friends",      cat:"Social",     emoji:"👥", label:"5 amis",             color:"#FF6B35", check:({friendCount})=>friendCount>=5},
  {id:"twenty_friends",    cat:"Social",     emoji:"👨‍👩‍👧", label:"20 amis",         color:"#FFD700", check:({friendCount})=>friendCount>=20},
  {id:"fifty_friends",     cat:"Social",     emoji:"🎉", label:"50 amis",            color:"#FFD700", check:({friendCount})=>friendCount>=50},
  {id:"group_creator",     cat:"Social",     emoji:"🏠", label:"Créateur de groupe", color:"#3498DB", check:({groupsCreated})=>groupsCreated>=1},
  {id:"profile_photo",     cat:"Social",     emoji:"📸", label:"Profil complet",     color:"#27AE60", check:({profile})=>!!profile?.avatar},

  // Fun
  {id:"comeback",          cat:"Fun",        emoji:"💪", label:"Comeback",           color:"#E63946", check:({trainings,results})=>{
    const ds=[...(results||[]).map(r=>r.race_date).filter(Boolean),...(trainings||[]).map(t=>t.date).filter(Boolean)].map(d=>new Date(d).getTime()).filter(n=>!isNaN(n)).sort((a,b)=>a-b);
    if(ds.length<2)return false;
    const six=6*30*24*3600*1000;
    for(let i=1;i<ds.length;i++)if(ds[i]-ds[i-1]>=six)return true;
    return false;
  }},
  {id:"obsessed",          cat:"Fun",        emoji:"🔥", label:"Obsédé",             color:"#FF6B35", check:({trainings})=>{if(!trainings?.length)return false;const by={};(trainings||[]).forEach(t=>{if(!t.date)return;const m=t.date.slice(0,7);by[m]=(by[m]||0)+1;});return Object.values(by).some(n=>n>=10);}},
  {id:"rookie",            cat:"Fun",        emoji:"🌱", label:"Rookie",             color:"#27AE60", check:({trainings,results,profile})=>{
    if(!profile?.created_at)return false;
    const t0=new Date(profile.created_at).getTime(),end=t0+7*24*3600*1000;
    const acts=[...(results||[]).map(r=>r.race_date||r.created_at).filter(Boolean),...(trainings||[]).map(t=>t.date||t.created_at).filter(Boolean)].map(d=>new Date(d).getTime()).filter(n=>!isNaN(n));
    return acts.filter(n=>n>=t0&&n<=end).length>=3;
  }},
];
const BADGE_CATEGORIES=[
  {key:"Course",     label:"🏃 Course à pied"},
  {key:"Trail",      label:"⛰️ Trail"},
  {key:"Triathlon",  label:"🏊 Triathlon"},
  {key:"Régularité", label:"📅 Régularité"},
  {key:"Social",     label:"👥 Social"},
  {key:"Fun",        label:"🔥 Fun"},
];
function computeBadges(ctx={}) {
  const c={results:[],trainings:[],profile:null,friendCount:0,groupsCreated:0,...ctx};
  return BADGES.filter(b=>b.check(c));
}

// ── DRUM PICKER ───────────────────────────────────────────────────────────────
function DrumPicker({values,selectedIndex,onChange,width=80,loop=false}) {
  const ref=useRef(null), IH=34;
  const N=values.length;
  const COPIES=loop?21:1;
  const MIDDLE=Math.floor(COPIES/2);
  const SAFE=Math.floor(COPIES/3); // si on quitte la zone centrale, on téléporte
  const settleTimer=useRef(null);

  useEffect(()=>{
    if(!ref.current)return;
    const target=(MIDDLE*N+selectedIndex)*IH;
    ref.current.scrollTop=target;
    const t=setTimeout(()=>{if(ref.current)ref.current.scrollTop=target;},80);
    return()=>clearTimeout(t);
  },[]);

  const onScroll=useCallback(()=>{
    if(!ref.current)return;
    const absIdx=Math.round(ref.current.scrollTop/IH);
    const mod=loop?((absIdx%N)+N)%N:Math.max(0,Math.min(N-1,absIdx));
    if(mod!==selectedIndex)onChange(mod);
    if(loop){
      clearTimeout(settleTimer.current);
      settleTimer.current=setTimeout(()=>{
        if(!ref.current)return;
        const cur=Math.round(ref.current.scrollTop/IH);
        if(cur<SAFE*N||cur>=(COPIES-SAFE)*N){
          const m=((cur%N)+N)%N;
          ref.current.scrollTop=(MIDDLE*N+m)*IH;
        }
      },180);
    }
  },[N,onChange,selectedIndex,loop,COPIES,MIDDLE,SAFE]);

  return (
    <div style={{position:"relative",width,height:IH*3,overflow:"hidden",flexShrink:0}}>
      <div style={{position:"absolute",inset:0,zIndex:2,pointerEvents:"none",background:"linear-gradient(to bottom,#161616 0%,transparent 30%,transparent 70%,#161616 100%)"}}/>
      <div style={{position:"absolute",top:"50%",left:4,right:4,transform:"translateY(-50%)",height:IH,background:"rgba(230,57,70,0.1)",border:"1px solid rgba(230,57,70,0.3)",borderRadius:10,zIndex:1,pointerEvents:"none"}}/>
      <div ref={ref} onScroll={onScroll} data-scroll="1"
        style={{height:"100%",overflowY:"scroll",scrollbarWidth:"none",msOverflowStyle:"none",
          scrollSnapType:"y mandatory",overscrollBehavior:"contain",
          WebkitOverflowScrolling:"touch",touchAction:"pan-y"}}>
        <div style={{height:IH,flexShrink:0}}/>
        {Array.from({length:COPIES}).map((_,copy)=>(
          values.map((v,i)=>(
            <div key={`${copy}-${i}`}
              onClick={()=>{
                if(ref.current)ref.current.scrollTop=(loop?MIDDLE*N+i:i)*IH;
                onChange(i);
              }}
              style={{height:IH,display:"flex",alignItems:"center",justifyContent:"center",
                scrollSnapAlign:"center",flexShrink:0,
                fontFamily:"'Bebas Neue',sans-serif",fontSize:22,
                color:i===selectedIndex?"#F0EDE8":"rgba(240,237,232,0.18)",
                cursor:"pointer",userSelect:"none"}}>
              {v}
            </div>
          ))
        ))}
        <div style={{height:IH*2,flexShrink:0}}/>
      </div>
    </div>
  );
}

const H_VALS=Array.from({length:24},(_,i)=>String(i).padStart(2,"0"));
const M_VALS=Array.from({length:60},(_,i)=>String(i).padStart(2,"0"));
const DAY_VALS=Array.from({length:31},(_,i)=>String(i+1).padStart(2,"0"));
const MON_VALS=["Jan","Fév","Mar","Avr","Mai","Jun","Jul","Aoû","Sep","Oct","Nov","Déc"];
const YR_VALS=Array.from({length:15},(_,i)=>String(CY-14+i));
const BIRTH_YEARS=Array.from({length:CY-10-1920+1},(_,i)=>String(CY-10-i));
const NATIONALITIES=["Française","Algérienne","Allemande","Américaine","Argentine","Australienne","Belge","Brésilienne","Britannique","Bulgare","Camerounaise","Canadienne","Chilienne","Chinoise","Coréenne","Croate","Danoise","Égyptienne","Espagnole","Finlandaise","Grecque","Hongroise","Indienne","Iranienne","Irlandaise","Israélienne","Italienne","Ivoirienne","Japonaise","Libanaise","Luxembourgeoise","Marocaine","Mexicaine","Néerlandaise","Néo-zélandaise","Norvégienne","Polonaise","Portugaise","Roumaine","Russe","Sénégalaise","Sud-africaine","Suédoise","Suisse","Tchèque","Tunisienne","Turque","Ukrainienne","Autre"];

function TimePicker({value,onChange}) {
  const parse=v=>{if(v&&v.includes(":")){const[h,m,s]=v.split(":").map(x=>parseInt(x)||0);return[h,m,s];}return[0,0,0];};
  const [hms,setHms]=useState(()=>parse(value));
  const update=n=>{setHms(n);onChange(`${String(n[0]).padStart(2,"0")}:${String(n[1]).padStart(2,"0")}:${String(n[2]).padStart(2,"0")}`);};
  return (
    <div>
      <div style={{display:"flex",justifyContent:"space-around",marginBottom:4}}>
        {["Heures","Min","Sec"].map(l=><div key={l} style={{fontSize:9,color:"rgba(240,237,232,0.3)",letterSpacing:1.5,textTransform:"uppercase",fontFamily:"'Barlow',sans-serif",textAlign:"center"}}>{l}</div>)}
      </div>
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:2}}>
        <DrumPicker values={H_VALS} selectedIndex={hms[0]} onChange={v=>update([v,hms[1],hms[2]])} width={90} loop/>
        <span style={{fontFamily:"'Bebas Neue'",fontSize:28,color:"rgba(230,57,70,0.5)"}}>:</span>
        <DrumPicker values={M_VALS} selectedIndex={hms[1]} onChange={v=>update([hms[0],v,hms[2]])} width={90} loop/>
        <span style={{fontFamily:"'Bebas Neue'",fontSize:28,color:"rgba(230,57,70,0.5)"}}>:</span>
        <DrumPicker values={M_VALS} selectedIndex={hms[2]} onChange={v=>update([hms[0],hms[1],v])} width={90} loop/>
      </div>
    </div>
  );
}

function DatePicker({value,onChange}) {
  const parse=v=>{if(v){const d=new Date(v);if(!isNaN(d))return[d.getDate()-1,d.getMonth(),Math.max(0,YR_VALS.indexOf(String(d.getFullYear())))];}const n=new Date();return[n.getDate()-1,n.getMonth(),Math.max(0,YR_VALS.indexOf(String(n.getFullYear())))];};
  const [dmy,setDmy]=useState(()=>parse(value));
  const update=n=>{setDmy(n);const day=parseInt(DAY_VALS[n[0]]),mo=n[1]+1,yr=parseInt(YR_VALS[n[2]]);onChange(`${yr}-${String(mo).padStart(2,"0")}-${String(day).padStart(2,"0")}`);};
  return (
    <div>
      <div style={{display:"flex",justifyContent:"space-around",marginBottom:4}}>
        {["Jour","Mois","Année"].map(l=><div key={l} style={{fontSize:9,color:"rgba(240,237,232,0.3)",letterSpacing:1.5,textTransform:"uppercase",fontFamily:"'Barlow',sans-serif",textAlign:"center"}}>{l}</div>)}
      </div>
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:2}}>
        <DrumPicker values={DAY_VALS} selectedIndex={Math.max(0,dmy[0])} onChange={v=>update([v,dmy[1],dmy[2]])} width={78} loop/>
        <DrumPicker values={MON_VALS} selectedIndex={Math.max(0,dmy[1])} onChange={v=>update([dmy[0],v,dmy[2]])} width={78} loop/>
        <DrumPicker values={YR_VALS}  selectedIndex={Math.max(0,dmy[2])} onChange={v=>update([dmy[0],dmy[1],v])} width={94}/>
      </div>
    </div>
  );
}

// ── CHARTS ────────────────────────────────────────────────────────────────────
function BarChart({data,color="#E63946",unit="km",title=""}) {
  const max=Math.max(...data.map(d=>d.value),1);
  return (
    <div>
      {title&&<div style={{fontFamily:"'Barlow',sans-serif",fontSize:11,color:"rgba(240,237,232,0.4)",letterSpacing:1.5,textTransform:"uppercase",marginBottom:12}}>{title}</div>}
      <div style={{display:"flex",alignItems:"flex-end",gap:3,height:110}}>
        {data.map((d,i)=>(
          <div key={i} style={{flex:1,display:"flex",flexDirection:"column",alignItems:"center",gap:3}}>
            <div style={{fontSize:10,color:"#F0EDE8",fontFamily:"'Barlow',sans-serif",fontWeight:600}}>{d.value>0?`${d.value}${unit}`:""}</div>
            <div style={{width:"100%",background:color,borderRadius:"3px 3px 0 0",height:`${(d.value/max)*75}px`,minHeight:d.value>0?3:0,transition:"height 0.5s"}}/>
            <div style={{fontSize:10,color:"#F0EDE8",fontFamily:"'Barlow',sans-serif",textAlign:"center",fontWeight:600}}>{d.label}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function LineChart({data,color="#E63946",title="",invert=false,formatY=null}) {
  if(!data||data.length<2) return <div style={{textAlign:"center",color:"rgba(240,237,232,0.2)",fontSize:12,padding:"20px 0",fontFamily:"'Barlow',sans-serif"}}>Ajoute au moins 2 résultats</div>;
  const vals=data.map(d=>d.value),min=Math.min(...vals),max=Math.max(...vals),range=max-min||1;
  const W=300,H=90,P=10,PL=formatY?30:10;
  const getY=v=>invert?P+(v-min)/range*(H-P*2):P+(1-(v-min)/range)*(H-P*2);
  const pts=data.map((d,i)=>({x:PL+(i/(data.length-1))*(W-PL-P),y:getY(d.value),...d}));
  const path=pts.map((p,i)=>`${i===0?"M":"L"}${p.x},${p.y}`).join(" ");
  const yTicks=formatY?[min,min+range/2,max]:[];
  return (
    <div>
      {title&&<div style={{fontFamily:"'Barlow',sans-serif",fontSize:13,color:"#F0EDE8",fontWeight:700,letterSpacing:1.5,textTransform:"uppercase",marginBottom:12}}>{title}</div>}
      <svg viewBox={`0 0 ${W} ${H}`} style={{width:"100%",overflow:"visible"}}>
        <defs><linearGradient id="lg" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={color} stopOpacity="0.3"/><stop offset="100%" stopColor={color} stopOpacity="0"/></linearGradient></defs>
        {formatY&&yTicks.map((v,i)=><text key={i} x={PL-4} y={getY(v)+3} textAnchor="end" fill="#F0EDE8" fontSize="10" fontWeight="600" fontFamily="Barlow,sans-serif">{formatY(v)}</text>)}
        <path d={`${path} L${pts[pts.length-1].x},${H} L${pts[0].x},${H} Z`} fill="url(#lg)"/>
        <path d={path} fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
        {pts.map((p,i)=>(<g key={i}><circle cx={p.x} cy={p.y} r="4" fill={color}/><text x={p.x} y={H+10} textAnchor="middle" fill="#F0EDE8" fontSize="10" fontWeight="600" fontFamily="Barlow,sans-serif">{p.label}</text></g>))}
      </svg>
    </div>
  );
}

// ── SWIPE ROW ─────────────────────────────────────────────────────────────────
function SwipeRow({children,onEdit,onDelete,actions,radius=12,mb=6}){
  const btns=actions||[
    ...(onEdit?[{icon:"✏️",bg:"rgba(255,255,255,0.12)",onClick:onEdit}]:[]),
    ...(onDelete?[{icon:"Supprimer",bg:"rgba(230,57,70,0.18)",color:"#E63946",fontSize:13,fontWeight:700,onClick:onDelete}]:[]),
  ];
  const [offset,setOffset]=useState(0);
  const startX=useRef(null);
  const dragging=useRef(false);
  const W=btns.length===1?100:btns.length*60;
  const onTouchStart=e=>{startX.current=e.touches[0].clientX;dragging.current=true;};
  const onTouchMove=e=>{
    if(!dragging.current)return;
    const dx=e.touches[0].clientX-startX.current;
    if(dx<0)setOffset(Math.max(dx,-W));
    else setOffset(Math.min(dx+offset,0));
  };
  const onTouchEnd=()=>{dragging.current=false;setOffset(o=>o<-W/2?-W:0);};
  const close=()=>setOffset(0);
  const tr=dragging.current?"none":"transform 0.25s ease";
  return(
    <div style={{overflow:"hidden",borderRadius:radius,marginBottom:mb}}>
      <div style={{position:"relative"}}>
        <div onTouchStart={onTouchStart} onTouchMove={onTouchMove} onTouchEnd={onTouchEnd}
          style={{transform:`translateX(${offset}px)`,transition:tr}}>
          {children}
        </div>
        <div style={{position:"absolute",top:0,bottom:0,right:0,width:W,display:"flex",
          transform:`translateX(${W+offset}px)`,transition:tr}}>
          {btns.map((b,i)=>(
            <button key={i} onClick={()=>{close();b.onClick();}} style={{flex:1,background:b.bg,border:"none",color:b.color||"#F0EDE8",fontSize:b.fontSize||20,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",fontWeight:b.fontWeight||700,fontFamily:"'Barlow',sans-serif",letterSpacing:0.3}}>{b.icon}</button>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── UI PRIMITIVES ─────────────────────────────────────────────────────────────
// ── STRAVA BRAND ASSETS ───────────────────────────────────────────────────────
// Conformité Brand Guidelines : https://developers.strava.com/guidelines/
const STRAVA_ORANGE="#FC4C02";
function StravaLogoMark({size=20,color="#fff"}){
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <path fill={color} d="M15.387 17.944l-2.089-4.116h-3.065L15.387 24l5.15-10.172h-3.066m-7.008-5.599l2.836 5.598h4.172L10.463 0l-7 13.828h4.169"/>
    </svg>
  );
}
function ConnectWithStravaButton({onClick,disabled=false}){
  return (
    <button onClick={onClick} type="button" style={{display:"flex",alignItems:"center",justifyContent:"center",gap:10,width:"100%",padding:"12px 18px",background:STRAVA_ORANGE,border:"none",borderRadius:4,color:"#fff",fontFamily:"'Barlow',sans-serif",fontWeight:700,fontSize:14,letterSpacing:0.3,cursor:disabled?"default":"pointer",boxSizing:"border-box"}}>
      <StravaLogoMark size={18} color="#fff"/>
      <span>Connect with Strava</span>
    </button>
  );
}
function PoweredByStrava({align="center"}){
  return (
    <div style={{display:"flex",alignItems:"center",justifyContent:align==="center"?"center":"flex-start",gap:6,padding:"10px 0",opacity:0.55}}>
      <span style={{fontSize:10,color:"rgba(240,237,232,0.7)",fontFamily:"'Barlow',sans-serif",letterSpacing:1.5,textTransform:"uppercase"}}>Powered by</span>
      <StravaLogoMark size={14} color="rgba(240,237,232,0.85)"/>
      <span style={{fontSize:11,color:"rgba(240,237,232,0.7)",fontFamily:"'Barlow',sans-serif",fontWeight:700,letterSpacing:0.5}}>Strava</span>
    </div>
  );
}
function ActivitySourceBadge({source}){
  if(source==="strava"){
    return (
      <span style={{display:"inline-flex",alignItems:"center",gap:3,padding:"2px 6px",background:"rgba(252,76,2,0.12)",border:"1px solid rgba(252,76,2,0.35)",borderRadius:4,fontSize:9,color:STRAVA_ORANGE,fontFamily:"'Barlow',sans-serif",fontWeight:700,letterSpacing:0.5,textTransform:"uppercase",flexShrink:0}}>
        <StravaLogoMark size={9} color={STRAVA_ORANGE}/>via Strava
      </span>
    );
  }
  if(source==="garmin"){
    return (
      <span style={{display:"inline-flex",alignItems:"center",gap:3,padding:"2px 6px",background:"rgba(0,122,196,0.12)",border:"1px solid rgba(0,122,196,0.35)",borderRadius:4,fontSize:9,color:"#007AC4",fontFamily:"'Barlow',sans-serif",fontWeight:700,letterSpacing:0.5,textTransform:"uppercase",flexShrink:0}}>via Garmin</span>
    );
  }
  return null;
}

function Modal({onClose,children,fullScreen=false}) {
  const [dy,setDy]=useState(0);
  const startY=useRef(null);
  const dragging=useRef(false);
  const scrollRef=useRef(null);
  const overlayRef=useRef(null);

  useEffect(()=>{
    const prev=document.body.style.overflow;
    document.body.style.overflow="hidden";
    return()=>{document.body.style.overflow=prev;};
  },[]);
  const onHandleTouch=e=>{startY.current=e.touches[0].clientY;dragging.current=true;};
  const onHandleMove=e=>{
    if(!dragging.current)return;
    const d=e.touches[0].clientY-startY.current;
    if(d>0)setDy(d);
  };
  const onHandleEnd=()=>{dragging.current=false;if(dy>80)onClose();else setDy(0);};
  return (
    <div ref={overlayRef} onClick={onClose} style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.85)",backdropFilter:"blur(10px)",display:"flex",alignItems:fullScreen?"stretch":"flex-end",justifyContent:"center",zIndex:300}}>
      <div onClick={e=>e.stopPropagation()}
        style={{background:"#161616",border:fullScreen?"none":"1px solid rgba(255,255,255,0.09)",borderRadius:fullScreen?0:"22px 22px 0 0",width:"100%",maxWidth:480,maxHeight:fullScreen?"100dvh":"92dvh",height:fullScreen?"100dvh":"auto",display:"flex",flexDirection:"column",transform:`translateY(${dy}px)`,transition:dragging.current?"none":"transform 0.25s ease",paddingTop:fullScreen?"env(safe-area-inset-top)":0}}>
        <div onTouchStart={onHandleTouch} onTouchMove={onHandleMove} onTouchEnd={onHandleEnd}
          style={{padding:"10px 20px 10px",flexShrink:0,cursor:"grab",touchAction:"none",userSelect:"none",position:"relative"}}>
          <div style={{width:48,height:5,background:"rgba(255,255,255,0.3)",borderRadius:3,margin:"0 auto"}}/>
          {fullScreen&&<button onClick={onClose} aria-label="Fermer" style={{position:"absolute",top:12,right:14,width:32,height:32,borderRadius:"50%",background:"rgba(255,255,255,0.08)",border:"none",color:"rgba(240,237,232,0.7)",fontSize:16,cursor:"pointer",lineHeight:1,display:"flex",alignItems:"center",justifyContent:"center"}}>✕</button>}
        </div>
        <div ref={scrollRef} style={{overflowY:"auto",padding:"0 20px",paddingBottom:"calc(44px + env(safe-area-inset-bottom))",flex:1,WebkitOverflowScrolling:"touch"}}>
          {children}
        </div>
      </div>
    </div>
  );
}
function Lbl({c}){return <div style={{fontSize:10,letterSpacing:1.5,textTransform:"uppercase",color:"rgba(240,237,232,0.35)",fontFamily:"'Barlow',sans-serif",marginBottom:4}}>{c}</div>;}
function Inp({value,onChange,placeholder,type="text"}){return <input value={value} onChange={e=>onChange(e.target.value)} placeholder={placeholder} type={type} style={{width:"100%",background:"rgba(255,255,255,0.05)",border:"1px solid rgba(255,255,255,0.1)",borderRadius:12,padding:"10px 14px",color:"#F0EDE8",fontSize:15,fontFamily:"'Barlow',sans-serif",outline:"none",boxSizing:"border-box",marginBottom:10}}/>;}
function Sel({value,onChange,children}){return <select value={value} onChange={e=>onChange(e.target.value)} style={{width:"100%",background:"#1e1e1e",border:"1px solid rgba(255,255,255,0.1)",borderRadius:12,padding:"10px 14px",color:"#F0EDE8",fontSize:14,fontFamily:"'Barlow',sans-serif",outline:"none",boxSizing:"border-box",marginBottom:10,appearance:"none"}}>{children}</select>;}
function Btn({children,onClick,variant="primary",mb=6,disabled=false,style={}}){
  const v={primary:{background:"#E63946",color:"#fff"},secondary:{background:"rgba(255,255,255,0.07)",color:"rgba(240,237,232,0.7)"},danger:{background:"rgba(230,57,70,0.15)",color:"#E63946"}};
  return <button onClick={onClick} disabled={disabled} style={{border:"none",borderRadius:14,cursor:"pointer",fontFamily:"'Barlow',sans-serif",fontWeight:700,fontSize:14,padding:"11px 0",width:"100%",transition:"opacity 0.2s",marginBottom:mb,...v[variant],...style,opacity:disabled?0.4:1}}>{children}</button>;
}
// ── PULL TO REFRESH ───────────────────────────────────────────────────────────
function PullToRefresh({onRefresh, children, paddingTop=0, paddingBottom="calc(110px + env(safe-area-inset-bottom))", paddingX="0 16px"}) {
  const [pullDistance, setPullDistance] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const [toast, setToast] = useState(null);
  const scrollRef = useRef(null);
  const startY = useRef(null);
  const isPulling = useRef(false);
  const vibrated = useRef(false);
  const isDragging = useRef(false);
  const THRESHOLD = 80;
  const MAX_PULL = 140;

  const showToast = (text, type="success") => {
    setToast({text, type});
    setTimeout(() => setToast(null), 1500);
  };

  const handleStart = (e) => {
    if (refreshing) return;
    if (!scrollRef.current) return;
    if (scrollRef.current.scrollTop > 0) return;
    startY.current = e.touches[0].clientY;
    isPulling.current = true;
    isDragging.current = true;
    vibrated.current = false;
  };

  const handleMove = (e) => {
    if (!isPulling.current || refreshing) return;
    if (scrollRef.current && scrollRef.current.scrollTop > 0) {
      isPulling.current = false;
      isDragging.current = false;
      setPullDistance(0);
      return;
    }
    const dy = e.touches[0].clientY - startY.current;
    if (dy <= 0) {
      setPullDistance(0);
      return;
    }
    const resisted = Math.min(MAX_PULL, dy * 0.55);
    setPullDistance(resisted);
    if (resisted >= THRESHOLD && !vibrated.current) {
      vibrated.current = true;
      try { navigator.vibrate?.(10); } catch {}
    }
    if (resisted < THRESHOLD - 10) vibrated.current = false;
  };

  const handleEnd = async () => {
    if (!isPulling.current) return;
    isPulling.current = false;
    isDragging.current = false;
    const distAtRelease = pullDistance;
    if (distAtRelease < THRESHOLD || refreshing) {
      setPullDistance(0);
      return;
    }
    setRefreshing(true);
    setPullDistance(90);
    const minDelay = new Promise(r => setTimeout(r, 1100));
    try {
      const [result] = await Promise.all([onRefresh(), minDelay]);
      showToast(result === "uptodate" ? "À jour ✓" : "Actualisé ✓", "success");
    } catch (err) {
      console.error("[ptr] refresh error", err);
      await minDelay;
      showToast("Erreur, réessaie", "error");
    } finally {
      setRefreshing(false);
      setPullDistance(0);
    }
  };

  const reached = pullDistance >= THRESHOLD;
  const runnerScale = 1 + Math.min(0.25, pullDistance / 640);
  const showLabel = pullDistance > 16 || refreshing;

  return (
    <div style={{flex:1, minHeight:0, position:"relative", overflow:"hidden"}}>
      <div aria-hidden="true" style={{
        position:"absolute",
        top:0, left:0, right:0,
        height: pullDistance,
        display:"flex",
        flexDirection:"column",
        alignItems:"center",
        justifyContent:"flex-end",
        pointerEvents:"none",
        overflow:"hidden",
        zIndex:5,
        transition: isDragging.current ? "none" : "height 0.25s ease",
      }}>
        <div style={{
          fontSize: 32,
          lineHeight: 1,
          transform: refreshing ? "none" : `scale(${runnerScale})`,
          animation: refreshing ? "ptr-runner-bounce 0.5s ease-in-out infinite" : "none",
          transition: refreshing ? "none" : "transform 0.12s ease",
          filter: reached ? "drop-shadow(0 0 8px rgba(230,57,70,0.4))" : "none",
        }}>🏃</div>
        {showLabel && (
          <div style={{
            fontSize: 11,
            color: "rgba(240,237,232,0.6)",
            fontFamily: "'Barlow',sans-serif",
            fontWeight: 600,
            marginTop: 6,
            marginBottom: 6,
            letterSpacing: 0.3,
            whiteSpace: "nowrap",
          }}>
            {refreshing ? "En route..." : reached ? "Relâche pour partir 🏁" : "Tire pour actualiser"}
          </div>
        )}
      </div>
      <div
        ref={scrollRef}
        onTouchStart={handleStart}
        onTouchMove={handleMove}
        onTouchEnd={handleEnd}
        onTouchCancel={handleEnd}
        style={{
          height: "100%",
          overflowY: "auto",
          WebkitOverflowScrolling: "touch",
          overscrollBehavior: "contain",
          padding: paddingX,
          paddingTop,
          paddingBottom,
          boxSizing: "border-box",
          transform: pullDistance > 0 ? `translateY(${pullDistance}px)` : "none",
          transition: isDragging.current ? "none" : "transform 0.25s ease",
          willChange: "transform",
        }}
      >
        {children}
      </div>
      {toast && (
        <div style={{
          position: "fixed",
          top: "calc(env(safe-area-inset-top, 0px) + 14px)",
          left: "50%",
          transform: "translateX(-50%)",
          background: toast.type === "error" ? "#E63946" : "rgba(22,22,22,0.96)",
          border: `1px solid ${toast.type === "error" ? "#E63946" : "rgba(74,222,128,0.4)"}`,
          color: toast.type === "error" ? "#fff" : "#4ADE80",
          fontFamily: "'Barlow',sans-serif",
          fontWeight: 700,
          fontSize: 13,
          padding: "9px 18px",
          borderRadius: 12,
          zIndex: 250,
          boxShadow: "0 4px 20px rgba(0,0,0,0.4)",
          pointerEvents: "none",
          animation: "ptr-toast-in 0.18s ease",
        }}>{toast.text}</div>
      )}
    </div>
  );
}

function PhotoViewer({src,onClose}){
  return (
    <div onClick={onClose} style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.96)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:500,cursor:"pointer",padding:20}}>
      <img src={src} style={{maxWidth:"100%",maxHeight:"100%",borderRadius:12,boxShadow:"0 10px 40px rgba(0,0,0,0.5)"}}/>
      <button onClick={onClose} style={{position:"absolute",top:"env(safe-area-inset-top, 20px)",right:20,width:40,height:40,borderRadius:"50%",background:"rgba(255,255,255,0.12)",color:"#fff",border:"none",fontSize:20,cursor:"pointer"}}>✕</button>
    </div>
  );
}

const AVATAR_PALETTE=[
  ["#E63946","#F77F00"],["#3498DB","#9B59B6"],["#27AE60","#16A085"],
  ["#FF6B35","#FFD700"],["#9B59B6","#3498DB"],["#16A085","#3498DB"],
  ["#E91E63","#9C27B0"],["#FFC107","#FF9800"],["#1ABC9C","#27AE60"],
  ["#F39C12","#E67E22"],["#2980B9","#8E44AD"],["#C0392B","#E74C3C"],
];
function avatarColors(name){
  const s=name||"?";
  let h=0; for(let i=0;i<s.length;i++) h=(h*31+s.charCodeAt(i))|0;
  return AVATAR_PALETTE[Math.abs(h)%AVATAR_PALETTE.length];
}
function Avatar({profile,size=48,highlight=false}){
  const [imgError,setImgError]=useState(false);
  useEffect(()=>{setImgError(false);},[profile?.avatar]);
  const initials=(profile?.name||"?").split(" ").map(w=>w[0]).join("").slice(0,2).toUpperCase();
  const hc=typeof highlight==="string"?highlight:"#E63946";
  const showImg=!!profile?.avatar&&!imgError;
  const [c1,c2]=avatarColors(profile?.name);
  const bgStyle=showImg
    ?{backgroundColor:highlight?hc:"rgba(255,255,255,0.1)"}
    :(highlight
      ?{backgroundColor:hc}
      :{backgroundColor:c1,backgroundImage:`linear-gradient(135deg, ${c1}, ${c2})`});
  return (
    <div style={{width:size,height:size,borderRadius:"50%",overflow:"hidden",flexShrink:0,...bgStyle,border:highlight?`3px solid ${hc}`:"2px solid rgba(255,255,255,0.1)",display:"flex",alignItems:"center",justifyContent:"center",fontFamily:"'Bebas Neue'",fontSize:size*0.42,color:"#fff",letterSpacing:1,textShadow:showImg?"none":"0 1px 2px rgba(0,0,0,0.25)"}}>
      {showImg?<img key={profile.avatar} src={profile.avatar} style={{width:"100%",height:"100%",objectFit:"cover"}} onError={()=>setImgError(true)}/>:initials}
    </div>
  );
}

// ── RESULT MODAL ──────────────────────────────────────────────────────────────
function ResultModal({existing,userId,onSave,onClose,initialDiscipline}){
  const [discipline,setDisc]=useState(existing?.discipline||initialDiscipline||"10km");
  const [timeStr,setTime]=useState(existing?fmtTime(existing.time):"00:00:00");
  const [raceName,setRace]=useState(existing?.race||"");
  const [elevation,setElevation]=useState(existing?.elevation?String(existing.elevation):"");
  const today=(()=>{const n=new Date();return `${n.getFullYear()}-${String(n.getMonth()+1).padStart(2,"0")}-${String(n.getDate()).padStart(2,"0")}`;})();
  const [raceDate,setDate]=useState(existing?.race_date||today);
  const [loading,setLoading]=useState(false);
  const [error,setError]=useState("");
  const [linkedTraining,setLinkedTraining]=useState(null);
  const cat=DISCIPLINES[discipline]?.category;
  const hasElevation=cat==="trail"||cat==="triathlon";

  useEffect(() => {
    if (!existing?.id) return;
    supabase.from("trainings").select("*").eq("linked_result_id", existing.id).maybeSingle()
      .then(({data}) => setLinkedTraining(data||null));
  }, [existing?.id]);

  const reclassifyAsTraining = async () => {
    if (!linkedTraining || !existing?.id) return;
    if (!window.confirm("Reclasser cette course en entraînement ? Le résultat officiel sera supprimé et l'activité retournera dans tes entraînements.")) return;
    setLoading(true);
    const recomputedPts = calcTrainingPts(linkedTraining.distance, linkedTraining.sport, linkedTraining.duration);
    await supabase.from("trainings").update({
      is_official_race: false,
      classification_status: "classified_as_training",
      official_race_format: null,
      official_race_name: null,
      official_race_location: null,
      linked_result_id: null,
      points: recomputedPts,
    }).eq("id", linkedTraining.id);
    await supabase.from("results").delete().eq("id", existing.id);
    setLoading(false);
    onSave();
  };
  const handleSave=async()=>{
    const[h,m,s]=timeStr.split(":").map(Number);const t=h*3600+m*60+s;
    if(!t){setError("Sélectionne un temps valide");return;}
    setLoading(true);setError("");
    const year=raceDate?parseInt(raceDate.slice(0,4)):CY;
    const payload={discipline,time:t,race:raceName||DISCIPLINES[discipline].label,year,race_date:raceDate||null,elevation:hasElevation&&elevation?parseInt(elevation)||null:null};
    console.log("[result-save]",existing?"UPDATE":"INSERT",existing?.id,payload);
    let err,data;
    if(existing){({error:err,data}=await supabase.from("results").update(payload).eq("id",existing.id).select());}
    else{({error:err,data}=await supabase.from("results").insert({...payload,user_id:userId}).select());}
    setLoading(false);
    console.log("[result-save] résultat",{err,data});
    if(err){setError("Erreur : "+(err.message||err.details||JSON.stringify(err)));return;}
    if(existing&&(!data||data.length===0)){setError("Aucune ligne modifiée — RLS Supabase bloque peut-être l'UPDATE pour cet utilisateur");return;}
    if (!existing) {
      const isPR = await isNewPR(userId, discipline, t);
      if (isPR && celebrationsEnabled()) {
        fireCelebration(2200);
        try { navigator.vibrate?.([30,40,30]); } catch {}
      }
    }
    onSave();
  };
  return (
    <Modal onClose={onClose}>
      <div style={{fontFamily:"'Bebas Neue'",fontSize:18,color:"#F0EDE8",letterSpacing:1,marginBottom:8}}>{existing?"Modifier":"Ajouter"} un résultat</div>
      <Lbl c="Discipline"/><Sel value={discipline} onChange={setDisc}>{Object.entries(DISCIPLINES).map(([k,v])=><option key={k} value={k}>{v.icon} {v.label}</option>)}</Sel>
      <Lbl c="Temps"/>
      <div style={{background:"rgba(255,255,255,0.03)",borderRadius:12,padding:"6px",marginBottom:8}}><TimePicker value={timeStr} onChange={setTime}/></div>
      <Lbl c="Nom de la course (optionnel)"/><Inp value={raceName} onChange={setRace} placeholder="Ex: Marathon de Paris"/>
      {hasElevation&&(<>
        <Lbl c={`Dénivelé+ (m) — réf ${DISCIPLINES[discipline]?.refDplus}m`}/>
        <Inp value={elevation} onChange={setElevation} placeholder={`Ex: ${DISCIPLINES[discipline]?.refDplus}`} type="number"/>
      </>)}
      <Lbl c="Date"/>
      <div style={{background:"rgba(255,255,255,0.03)",borderRadius:12,padding:"6px",marginBottom:8}}><DatePicker value={raceDate} onChange={setDate}/></div>
      {error&&<div style={{color:"#E63946",fontSize:12,marginBottom:8,fontFamily:"'Barlow',sans-serif"}}>{error}</div>}
      <Btn onClick={handleSave} mb={6}>{loading?"Enregistrement...":"Valider"}</Btn>
      <Btn onClick={onClose} variant="secondary" mb={linkedTraining?6:0}>Annuler</Btn>
      {linkedTraining && (
        <button onClick={reclassifyAsTraining} disabled={loading} style={{width:"100%",background:"transparent",border:"1px solid rgba(240,237,232,0.15)",borderRadius:14,padding:"9px 0",color:"rgba(240,237,232,0.6)",fontFamily:"'Barlow',sans-serif",fontWeight:700,fontSize:12,cursor:"pointer",letterSpacing:0.3,opacity:loading?0.5:1}}>↩ Reclasser en entraînement</button>
      )}
    </Modal>
  );
}

// ── TRAINING MODAL ────────────────────────────────────────────────────────────
const SPORT_TO_DISCIPLINE={Run:"running",Trail:"trail","Vélo":"cycling",Natation:"swimming"};
function computePaceOrSpeed(discipline,distanceKm,durationSec){
  if(!distanceKm||!durationSec) return 0;
  if(discipline==="running"||discipline==="trail") return durationSec/distanceKm;
  if(discipline==="cycling") return distanceKm/(durationSec/3600);
  if(discipline==="swimming") return durationSec/(distanceKm*10);
  return 0;
}
function TrainingModal({existing,userId,onSave,onClose,onConvertToRace}){
  const [sport,setSport]=useState(existing?.sport||"Run");
  const [title,setTitle]=useState(existing?.title||"");
  const [dist,setDist]=useState(existing?String(existing.distance||""):"");
  const [deniv,setDeniv]=useState(existing?.elevation_gain_m!=null?String(existing.elevation_gain_m):"");
  const [duration,setDur]=useState(existing?fmtTime(existing.duration||0):"00:00:00");
  const [date,setDate]=useState(existing?.date||"");
  const [loading,setLoading]=useState(false);
  const [error,setErr]=useState("");
  const needsElevation=sport==="Trail"||sport==="Vélo";
  useEffect(()=>{if(!needsElevation) setDeniv("");},[needsElevation]);
  const handleSave=async()=>{
    if(!dist){setErr("La distance est obligatoire");return;}
    if(needsElevation&&deniv===""){setErr("Le dénivelé est obligatoire pour le trail et le vélo");return;}
    setLoading(true);setErr("");
    const durationSec=parseDurStr(duration);
    const distanceKm=parseFloat(dist)||0;
    const elevationGainM=needsElevation?(parseInt(deniv)||0):null;
    const discipline=SPORT_TO_DISCIPLINE[sport];
    let pts=0;
    try{
      pts=calculateTrainingPoints({
        discipline,
        duration_min:durationSec/60,
        distance_km:distanceKm,
        elevation_gain_m:elevationGainM,
        pace_or_speed:computePaceOrSpeed(discipline,distanceKm,durationSec),
      });
    }catch(e){
      setLoading(false);setErr(e.message||"Erreur de calcul des points");return;
    }
    const trimmedTitle = title.trim();
    const payload={sport,title:trimmedTitle||null,distance:distanceKm,elevation_gain_m:elevationGainM,duration:durationSec,date:date||new Date().toISOString().split("T")[0],points:pts};
    let err;
    if(existing){({error:err}=await supabase.from("trainings").update(payload).eq("id",existing.id));}
    else{
      const insertPayload={...payload,user_id:userId};
      if(detectOfficialRace(trimmedTitle)) insertPayload.auto_detected_official=true;
      ({error:err}=await supabase.from("trainings").insert(insertPayload));
    }
    setLoading(false);
    if(err){setErr(err.message||err.details||JSON.stringify(err));return;}
    onSave();
  };
  return (
    <Modal onClose={onClose}>
      <div style={{fontFamily:"'Bebas Neue'",fontSize:18,color:"#F0EDE8",letterSpacing:1,marginBottom:8}}>{existing?"Modifier":"Ajouter"} un entraînement</div>
      <Lbl c="Sport"/><Sel value={sport} onChange={setSport}>{TRAINING_SPORTS.filter(s=>s!=="All").map(s=><option key={s} value={s}>{s}</option>)}</Sel>
      <Lbl c="Titre (optionnel)"/><Inp value={title} onChange={setTitle} placeholder="Ex: Bassin matinal, Sortie longue…"/>
      <Lbl c="Distance (km)"/><Inp value={dist} onChange={setDist} placeholder="Ex: 12.5" type="number"/>
      {needsElevation&&<><Lbl c="Dénivelé positif (m)"/><Inp value={deniv} onChange={setDeniv} placeholder={sport==="Vélo"?"Ex: 1200":"Ex: 800"} type="number"/></>}
      <Lbl c="Durée"/>
      <div style={{background:"rgba(255,255,255,0.03)",borderRadius:12,padding:"6px",marginBottom:8}}><TimePicker value={duration} onChange={setDur}/></div>
      <Lbl c="Date"/>
      <div style={{background:"rgba(255,255,255,0.03)",borderRadius:12,padding:"6px",marginBottom:8}}><DatePicker value={date} onChange={setDate}/></div>
      {error&&<div style={{color:"#E63946",fontSize:12,marginBottom:8,fontFamily:"'Barlow',sans-serif"}}>{error}</div>}
      <Btn onClick={handleSave} mb={6}>{loading?"Enregistrement...":"Valider"}</Btn>
      <Btn onClick={onClose} variant="secondary" mb={existing&&onConvertToRace?6:0}>Annuler</Btn>
      {existing && onConvertToRace && !existing.is_official_race && (
        <button onClick={()=>{onClose();onConvertToRace(existing);}} style={{width:"100%",background:"transparent",border:"1px solid rgba(230,57,70,0.3)",borderRadius:14,padding:"9px 0",color:"#E63946",fontFamily:"'Barlow',sans-serif",fontWeight:700,fontSize:12,cursor:"pointer",letterSpacing:0.3}}>🏁 Convertir en course officielle</button>
      )}
    </Modal>
  );
}

// ── RACE CLASSIFICATION MODAL ─────────────────────────────────────────────────
async function convertTrainingToRace({training, format, name, location, userId}) {
  const yr = parseInt((training.date||"").slice(0,4)) || CY;
  const racePayload = {
    user_id: userId,
    discipline: format,
    time: training.duration||0,
    race: name||DISCIPLINES[format]?.label||"Course",
    year: yr,
    race_date: training.date||null,
    elevation: null,
  };
  const {data:result, error:resErr} = await supabase.from("results").insert(racePayload).select();
  if (resErr) return {error:resErr};
  const linkedId = result?.[0]?.id || null;
  const {error:upErr} = await supabase.from("trainings").update({
    is_official_race: true,
    classification_status: "classified_as_race",
    official_race_format: format,
    official_race_name: name||null,
    official_race_location: location||null,
    linked_result_id: linkedId,
    points: 0,
  }).eq("id", training.id);
  return {error:upErr, resultId:linkedId};
}
async function markTrainingAsTraining(trainingId) {
  return supabase.from("trainings").update({
    classification_status: "classified_as_training",
  }).eq("id", trainingId);
}

function RaceClassificationModal({pending, userId, onDone, onClose, singleMode=false}) {
  const [idx, setIdx] = useState(0);
  const [step, setStep] = useState(singleMode ? "form" : "ask");
  const [confirmed, setConfirmed] = useState(0);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const current = pending[idx];
  const [format, setFormat] = useState("marathon");
  const [name, setName] = useState("");
  const [location, setLocation] = useState("");

  useEffect(() => {
    if (!current) return;
    setFormat(detectRaceFormat(current.title) || "marathon");
    setName((current.title||"").trim());
    setLocation("");
    setStep(singleMode ? "form" : "ask");
    setErr("");
  }, [idx, current?.id, singleMode]);

  if (!current) {
    onDone(confirmed);
    return null;
  }

  const next = () => {
    if (idx + 1 >= pending.length) {
      onDone(confirmed);
    } else {
      setIdx(idx + 1);
    }
  };

  const onSayTraining = async () => {
    setBusy(true);
    await markTrainingAsTraining(current.id);
    setBusy(false);
    next();
  };

  const onSayRace = () => setStep("form");

  const onConfirmRace = async () => {
    if (!format) { setErr("Choisis un format"); return; }
    setBusy(true);
    setErr("");
    const {error} = await convertTrainingToRace({training:current, format, name:name.trim(), location:location.trim(), userId});
    setBusy(false);
    if (error) { setErr(error.message||"Erreur d'enregistrement"); return; }
    setConfirmed(c => c + 1);
    next();
  };

  const distLabel = current.distance ? `${current.distance} km` : "";
  const durLabel = current.duration ? fmtTime(current.duration) : "";
  const dateLabel = current.date ? fmtFrShortDate(current.date) : "";
  const sportIcon = {Run:"🏃","Vélo":"🚴",Natation:"🏊",Trail:"⛰️"}[current.sport]||"🏁";

  return (
    <Modal onClose={onClose}>
      <div style={{fontFamily:"'Bebas Neue'",fontSize:22,color:"#F0EDE8",letterSpacing:1,marginBottom:4}}>Classer cette activité</div>
      {pending.length>1 && <div style={{fontSize:11,color:"rgba(240,237,232,0.45)",fontFamily:"'Barlow',sans-serif",marginBottom:14}}>{idx+1} / {pending.length}</div>}
      <div style={{background:"rgba(255,255,255,0.03)",border:"1px solid rgba(255,255,255,0.06)",borderRadius:14,padding:"14px",marginBottom:14}}>
        <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:8}}>
          <div style={{fontSize:22}}>{sportIcon}</div>
          <div style={{flex:1,minWidth:0}}>
            <div style={{fontFamily:"'Barlow',sans-serif",fontWeight:700,fontSize:14,color:"#F0EDE8",whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{current.title||"(sans titre)"}</div>
            <div style={{fontSize:11,color:"rgba(240,237,232,0.5)",fontFamily:"'Barlow',sans-serif",marginTop:3}}>
              {[current.sport, distLabel, durLabel, dateLabel].filter(Boolean).join(" · ")}
            </div>
          </div>
        </div>
      </div>

      {step === "ask" ? (
        <>
          <div style={{fontSize:13,color:"rgba(240,237,232,0.7)",fontFamily:"'Barlow',sans-serif",marginBottom:14,lineHeight:1.4}}>
            Le titre suggère une course officielle. Confirmer ou laisser comme entraînement ?
          </div>
          <Btn onClick={onSayRace} mb={8}>🏁 C'est une course officielle</Btn>
          <Btn onClick={onSayTraining} variant="secondary" mb={0} disabled={busy}>{busy?"…":"Non, c'est un entraînement"}</Btn>
        </>
      ) : (
        <>
          <Lbl c="Nom officiel de l'événement"/>
          <Inp value={name} onChange={setName} placeholder="Ex: Marathon de Paris"/>
          <Lbl c="Format"/>
          <Sel value={format} onChange={setFormat}>
            {RACE_FORMAT_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </Sel>
          <Lbl c="Lieu (optionnel)"/>
          <Inp value={location} onChange={setLocation} placeholder="Ex: Paris"/>
          {err && <div style={{color:"#E63946",fontSize:12,marginBottom:12,fontFamily:"'Barlow',sans-serif"}}>{err}</div>}
          <Btn onClick={onConfirmRace} mb={8} disabled={busy}>{busy?"Enregistrement…":(idx+1>=pending.length?"Confirmer":"Confirmer et passer à la suivante")}</Btn>
          {!singleMode && <Btn onClick={()=>setStep("ask")} variant="secondary" mb={0}>← Retour</Btn>}
        </>
      )}
    </Modal>
  );
}

// ── EDIT PROFILE MODAL ────────────────────────────────────────────────────────
function EditProfileModal({profile,onSave,onClose}){
  const [name,setName]=useState(profile.name||"");
  const [city,setCity]=useState(profile.city||"");
  const [birthYear,setBirth]=useState(profile.birth_year||"");
  const [gender,setGender]=useState(profile.gender||"");
  const [nat,setNat]=useState(profile.nationality||"");
  const [celebOn,setCelebOn]=useState(profile.celebrations_enabled !== false);
  const [avFile,setAvFile]=useState(null);
  const [avPreview,setAvPreview]=useState(null);
  const [loading,setLoading]=useState(false);
  const [error,setError]=useState("");
  const fileRef=useRef(null);
  const onPick=e=>{
    const f=e.target.files?.[0];
    if(!f)return;
    setAvFile(f);
    const reader=new FileReader();
    reader.onload=ev=>setAvPreview(ev.target.result);
    reader.onerror=()=>setError("Impossible de lire le fichier");
    reader.readAsDataURL(f);
  };
  const handleSave=async()=>{
    setLoading(true);setError("");
    let avatar_url=profile.avatar;
    if(avFile){
      const ext=(avFile.name.split(".").pop()||"jpg").toLowerCase();
      const path=`${profile.id}.${ext}`;
      const{error:upErr}=await supabase.storage.from("avatars").upload(path,avFile,{upsert:true,contentType:avFile.type||"image/jpeg"});
      if(upErr){setError("Upload échoué : "+(upErr.message||"")); setLoading(false); return;}
      const{data}=supabase.storage.from("avatars").getPublicUrl(path);
      avatar_url=data.publicUrl+"?t="+Date.now();
    }
    const{error:updErr}=await supabase.from("profiles").update({name,city,birth_year:birthYear?parseInt(birthYear):null,gender,nationality:nat,avatar:avatar_url,celebrations_enabled:celebOn}).eq("id",profile.id);
    setLoading(false);
    if(updErr){setError("Sauvegarde échouée : "+updErr.message);return;}
    setCelebrationsEnabledLocal(celebOn);
    onSave();
  };
  return (
    <Modal onClose={onClose}>
      <div style={{fontFamily:"'Bebas Neue'",fontSize:26,color:"#F0EDE8",letterSpacing:1,marginBottom:20}}>Modifier le profil</div>
      <Lbl c="Photo de profil"/>
      <label style={{display:"flex",alignItems:"center",gap:12,marginBottom:8,cursor:"pointer"}}>
        <Avatar profile={{...profile,avatar:avPreview||profile.avatar}} size={56}/>
        <span style={{padding:"10px 14px",borderRadius:12,background:"rgba(230,57,70,0.12)",border:"1px solid rgba(230,57,70,0.3)",color:"#E63946",fontFamily:"'Barlow',sans-serif",fontWeight:700,fontSize:13}}>📷 Changer la photo</span>
        <input ref={fileRef} type="file" accept="image/*" onChange={onPick} style={{position:"absolute",width:1,height:1,padding:0,margin:-1,overflow:"hidden",clip:"rect(0,0,0,0)",whiteSpace:"nowrap",border:0}}/>
      </label>
      {avFile&&<div style={{fontSize:11,color:"rgba(240,237,232,0.5)",fontFamily:"'Barlow',sans-serif",marginBottom:16,paddingLeft:2}}>📎 {avFile.name} · {(avFile.size/1024/1024).toFixed(2)} Mo</div>}
      {error&&<div style={{color:"#E63946",fontSize:12,marginBottom:12,fontFamily:"'Barlow',sans-serif"}}>{error}</div>}
      <Lbl c="Nom complet"/><Inp value={name} onChange={setName} placeholder="Ton nom"/>
      <Lbl c="Ville"/><Inp value={city} onChange={setCity} placeholder="Ta ville"/>
      <Lbl c="Année de naissance"/>
      <div style={{background:"rgba(255,255,255,0.03)",borderRadius:14,padding:"12px",display:"flex",justifyContent:"center",marginBottom:16}}>
        <DrumPicker values={BIRTH_YEARS} selectedIndex={Math.max(0,BIRTH_YEARS.indexOf(String(birthYear||CY-30)))} onChange={i=>setBirth(BIRTH_YEARS[i])} width={120}/>
      </div>
      <Lbl c="Sexe"/>
      <div style={{display:"flex",gap:10,marginBottom:16}}>
        {[{v:"H",l:"👨 Homme"},{v:"F",l:"👩 Femme"}].map(({v,l})=>(
          <button key={v} type="button" onClick={()=>setGender(v)} style={{flex:1,padding:"14px 0",borderRadius:12,border:`1px solid ${gender===v?"#E63946":"rgba(255,255,255,0.1)"}`,background:gender===v?"rgba(230,57,70,0.15)":"rgba(255,255,255,0.05)",color:gender===v?"#E63946":"#F0EDE8",cursor:"pointer",fontFamily:"'Barlow',sans-serif",fontWeight:700,fontSize:14}}>{l}</button>
        ))}
      </div>
      <Lbl c="Nationalité"/>
      <Sel value={nat} onChange={setNat}>
        <option value="">— Choisir —</option>
        {NATIONALITIES.map(n=><option key={n} value={n}>{n}</option>)}
      </Sel>
      <div onClick={()=>setCelebOn(!celebOn)} style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"12px 14px",background:"rgba(255,255,255,0.04)",border:"1px solid rgba(255,255,255,0.08)",borderRadius:12,marginBottom:16,cursor:"pointer"}}>
        <div>
          <div style={{fontFamily:"'Barlow',sans-serif",fontWeight:700,fontSize:13,color:"#F0EDE8"}}>Animations de célébration</div>
          <div style={{fontSize:11,color:"rgba(240,237,232,0.5)",fontFamily:"'Barlow',sans-serif",marginTop:2}}>Confetti, modales et vibrations sur PR / promo / paliers</div>
        </div>
        <div style={{width:42,height:24,borderRadius:14,background:celebOn?"#E63946":"rgba(255,255,255,0.15)",position:"relative",flexShrink:0,transition:"background 0.2s"}}>
          <div style={{position:"absolute",top:2,left:celebOn?20:2,width:20,height:20,borderRadius:"50%",background:"#fff",transition:"left 0.2s"}}/>
        </div>
      </div>
      <Btn onClick={handleSave} mb={8}>{loading?"Enregistrement...":"Sauvegarder"}</Btn>
      <Btn onClick={onClose} variant="secondary" mb={0}>Annuler</Btn>
    </Modal>
  );
}

// ── DELETE ACCOUNT MODAL ──────────────────────────────────────────────────────
function DeleteAccountModal({onClose}){
  const [confirm,setConfirm]=useState("");
  const [loading,setLoading]=useState(false);
  const handleDelete=async()=>{
    if(confirm!=="SUPPRIMER")return;setLoading(true);
    const{data:{user}}=await supabase.auth.getUser();
    await supabase.from("results").delete().eq("user_id",user.id);
    await supabase.from("trainings").delete().eq("user_id",user.id);
    await supabase.from("profiles").delete().eq("id",user.id);
    await supabase.auth.signOut();
  };
  return (
    <Modal onClose={onClose}>
      <div style={{fontFamily:"'Bebas Neue'",fontSize:26,color:"#E63946",letterSpacing:1,marginBottom:12}}>Supprimer le compte</div>
      <div style={{fontSize:13,color:"rgba(240,237,232,0.6)",fontFamily:"'Barlow',sans-serif",marginBottom:20,lineHeight:1.6}}>Action irréversible. Toutes tes données seront supprimées.<br/>Tape <strong style={{color:"#E63946"}}>SUPPRIMER</strong> pour confirmer.</div>
      <Inp value={confirm} onChange={setConfirm} placeholder="SUPPRIMER"/>
      <Btn onClick={handleDelete} variant="danger" mb={8} disabled={confirm!=="SUPPRIMER"}>{loading?"Suppression...":"Supprimer définitivement"}</Btn>
      <Btn onClick={onClose} variant="secondary" mb={0}>Annuler</Btn>
    </Modal>
  );
}

// ── HOW IT WORKS MODAL ────────────────────────────────────────────────────────
function HowItWorksModal({onClose}){
  const Section=({title,children})=>(
    <div style={{marginBottom:22}}>
      <div style={{fontFamily:"'Bebas Neue'",fontSize:20,color:"#E63946",letterSpacing:1.5,marginBottom:10}}>{title}</div>
      {children}
    </div>
  );
  const P=({children})=>(<div style={{fontSize:13,color:"rgba(240,237,232,0.75)",fontFamily:"'Barlow',sans-serif",lineHeight:1.6,marginBottom:8}}>{children}</div>);
  const Bullet=({emoji,bold,children})=>(
    <div style={{display:"flex",gap:10,alignItems:"flex-start",marginBottom:6,fontSize:13,color:"rgba(240,237,232,0.75)",fontFamily:"'Barlow',sans-serif",lineHeight:1.5}}>
      {emoji&&<div style={{flexShrink:0,fontSize:14}}>{emoji}</div>}
      <div><span style={{color:"#F0EDE8",fontWeight:700}}>{bold}</span>{children}</div>
    </div>
  );
  const RefRow=({label,time,prestige,color})=>(
    <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"8px 12px",background:"rgba(255,255,255,0.03)",borderRadius:10,marginBottom:5,border:"1px solid rgba(255,255,255,0.05)",borderLeft:`3px solid ${color}`}}>
      <div style={{fontFamily:"'Barlow',sans-serif",fontSize:12,color:"#F0EDE8",fontWeight:600}}>{label}</div>
      <div style={{display:"flex",gap:10,alignItems:"center"}}>
        <div style={{fontFamily:"'Bebas Neue'",fontSize:14,color:"#F0EDE8",letterSpacing:0.5}}>{time}</div>
        <div style={{fontSize:10,color:"rgba(240,237,232,0.5)",fontFamily:"'Barlow',sans-serif",fontWeight:700}}>×{prestige}</div>
      </div>
    </div>
  );
  const LEVELS=[
    {label:"Bronze", min:0,  color:"#CD7F32"},
    {label:"Argent", min:200,color:"#C0C0C0"},
    {label:"Or",     min:350,color:"#FFD700"},
    {label:"Platine",min:500,color:"#5DADE2"},
    {label:"Diamant",min:700,color:"#00D4FF"},
    {label:"Master", min:900,color:"#E63946"},
  ];
  return (
    <Modal onClose={onClose}>
      <div style={{fontFamily:"'Bebas Neue'",fontSize:28,color:"#F0EDE8",letterSpacing:2,marginBottom:4}}>Comment ça marche</div>
      <div style={{fontSize:11,color:"rgba(240,237,232,0.4)",letterSpacing:1.5,textTransform:"uppercase",fontFamily:"'Barlow',sans-serif",marginBottom:22}}>Le système PaceRank expliqué</div>

      <Section title="1 · Points de course officielle">
        <P>Ton temps est comparé au temps de référence d'un athlète <span style={{color:"#FFD700",fontWeight:700}}>élite mondial</span> sur la même distance. Plus tu t'en approches, plus tu marques de points.</P>
        <P>Un coefficient <span style={{color:"#F0EDE8",fontWeight:700}}>prestige</span> est associé à chaque épreuve selon sa difficulté : plus la course est longue et exigeante, plus il est élevé (×1.0 sur un 10 km, jusqu'à ×1.5 sur un Ironman ou un Ultra Trail).</P>
        <P>Pour le <span style={{color:"#27AE60",fontWeight:700}}>trail</span> et le <span style={{color:"#9B59B6",fontWeight:700}}>triathlon</span>, le <span style={{color:"#F0EDE8",fontWeight:700}}>dénivelé positif</span> est aussi pris en compte : si tu cours sur une course plus pentue que la référence, ton temps est ajusté à la baisse (bonus) — et inversement (malus) si moins de D+. Compte ≈ 6 sec par mètre d'écart avec la référence.</P>
        <div style={{fontSize:11,color:"rgba(240,237,232,0.4)",letterSpacing:1.5,textTransform:"uppercase",fontFamily:"'Barlow',sans-serif",fontWeight:700,marginTop:14,marginBottom:8}}>Temps de référence élite</div>
        <RefRow label="🏃 5 km"              time="13:00"   prestige="1.0" color="#4A90D9"/>
        <RefRow label="🏃 10 km"             time="27:00"   prestige="1.0" color="#4A90D9"/>
        <RefRow label="🏃 Semi-marathon"     time="58:00"   prestige="1.1" color="#4A90D9"/>
        <RefRow label="🏃 Marathon"          time="2h02"    prestige="1.2" color="#4A90D9"/>
        <RefRow label="⛰️ Trail Court (<30km)" time="2h30"  prestige="1.1" color="#27AE60"/>
        <RefRow label="⛰️ Trail Moyen (30-60)" time="5h30"  prestige="1.2" color="#27AE60"/>
        <RefRow label="⛰️ Trail Long (60-100)" time="10h00" prestige="1.3" color="#27AE60"/>
        <RefRow label="⛰️ Ultra Trail (100+)"  time="20h00" prestige="1.5" color="#27AE60"/>
        <RefRow label="🏊 Triathlon S"          time="55:00" prestige="1.1" color="#9B59B6"/>
        <RefRow label="🏊 Triathlon Olympique"  time="1h50"  prestige="1.2" color="#9B59B6"/>
        <RefRow label="🏊 Half Ironman"         time="2h56"  prestige="1.3" color="#9B59B6"/>
        <RefRow label="🏊 Ironman"              time="5h50"  prestige="1.5" color="#9B59B6"/>
        <RefRow label="🔥 Hyrox Open"           time="50:38" prestige="1.2" color="#E63946"/>
        <RefRow label="🔥 Hyrox Pro"            time="51:59" prestige="1.4" color="#E63946"/>
        <RefRow label="🔥 Hyrox Doubles"        time="47:57" prestige="1.1" color="#E63946"/>
        <RefRow label="🔥 Hyrox Relay"          time="45:43" prestige="1.0" color="#E63946"/>
      </Section>

      <Section title="2 · Calcul des points d'entraînement">
        <P>Les points d'entraînement sont basés sur la <span style={{color:"#F0EDE8",fontWeight:700}}>charge d'entraînement</span>, une approximation de l'effort que ton corps doit fournir pour récupérer après une activité (concept proche de l'EPOC mesuré par les montres connectées).</P>
        <div style={{padding:"10px 14px",background:"rgba(230,57,70,0.08)",border:"1px solid rgba(230,57,70,0.2)",borderRadius:10,margin:"10px 0 12px",fontFamily:"'Barlow',sans-serif",fontSize:13,color:"#F0EDE8",textAlign:"center",lineHeight:1.5}}>
          Points = Durée × Intensité<sup style={{fontSize:9}}>1.92</sup> × Coefficient × 0.02
        </div>
        <P><span style={{color:"#F0EDE8",fontWeight:700}}>Intensité (RPE 1-10)</span> : déterminée automatiquement à partir de ton allure (course/trail), de ta vitesse moyenne (vélo) ou de ton pace (natation). Plus c'est rapide, plus l'intensité est élevée.</P>
        <div style={{fontSize:11,color:"rgba(240,237,232,0.4)",letterSpacing:1.5,textTransform:"uppercase",fontFamily:"'Barlow',sans-serif",fontWeight:700,marginTop:14,marginBottom:8}}>Coefficient par discipline</div>
        <Bullet emoji="🏃" bold="Course / Trail ">→ ×1.0</Bullet>
        <Bullet emoji="🚴" bold="Vélo ">→ ×0.75 (moins traumatisant)</Bullet>
        <Bullet emoji="🏊" bold="Natation ">→ ×1.15 (coût énergétique élevé)</Bullet>
        <div style={{fontSize:11,color:"rgba(240,237,232,0.4)",letterSpacing:1.5,textTransform:"uppercase",fontFamily:"'Barlow',sans-serif",fontWeight:700,marginTop:14,marginBottom:8}}>Bonus dénivelé (Trail et Vélo)</div>
        <Bullet emoji="⛰️" bold="Trail ">: chaque 100 m de D+ par km augmente l'intensité</Bullet>
        <Bullet emoji="🚴" bold="Vélo ">: chaque 1% de pente moyenne augmente l'intensité</Bullet>
        <div style={{fontSize:11,color:"rgba(240,237,232,0.4)",letterSpacing:1.5,textTransform:"uppercase",fontFamily:"'Barlow',sans-serif",fontWeight:700,marginTop:14,marginBottom:8}}>Exemples</div>
        <Bullet emoji="🏃" bold="Footing 10 km en 1h ">→ <span style={{color:"#E63946",fontWeight:700}}>~26 pts</span></Bullet>
        <Bullet emoji="⚡" bold="10 km tempo en 45 min ">→ <span style={{color:"#E63946",fontWeight:700}}>~38 pts</span></Bullet>
        <Bullet emoji="⛰️" bold="Trail 15 km / 1h45 / 1000 m D+ ">→ <span style={{color:"#E63946",fontWeight:700}}>~68 pts</span></Bullet>
        <Bullet emoji="🚴" bold="Vélo 60 km / 2h / 1200 m D+ ">→ <span style={{color:"#E63946",fontWeight:700}}>~91 pts</span></Bullet>
        <Bullet emoji="🏊" bold="Natation 1 km en 25 min ">→ <span style={{color:"#E63946",fontWeight:700}}>~13 pts</span></Bullet>
        <P><span style={{color:"#F0EDE8",fontWeight:700,display:"block",marginTop:14,marginBottom:4}}>Pourquoi les entraînements rapportent moins que les courses ?</span>PaceRank valorise la compétition. Une course officielle peut rapporter <span style={{color:"#FFD700",fontWeight:700}}>5 à 10 fois plus</span> qu'un entraînement équivalent. L'entraînement régulier reste essentiel pour progresser et accumuler des points sur l'année, mais les courses restent les moments forts du classement.</P>
      </Section>

      <Section title="3 · Niveaux par course">
        <P>Chaque course te donne un niveau selon les points obtenus sur cette course-là. Plus tu approches du temps élite, plus le niveau monte.</P>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginTop:10}}>
          {LEVELS.map(l=>(
            <div key={l.label} style={{padding:"10px 12px",background:`${l.color}12`,border:`1px solid ${l.color}55`,borderRadius:10,borderLeft:`3px solid ${l.color}`}}>
              <div style={{fontFamily:"'Bebas Neue'",fontSize:16,color:l.color,letterSpacing:0.5}}>{l.label}</div>
              <div style={{fontSize:10,color:"rgba(240,237,232,0.5)",fontFamily:"'Barlow',sans-serif",letterSpacing:1,textTransform:"uppercase",marginTop:1}}>dès {l.min} pts</div>
            </div>
          ))}
        </div>
      </Section>

      <Section title="4 · Statut saison">
        <P>Tes points de la saison (courses + entraînements + bonus) te placent sur une échelle de 9 paliers, du <span style={{color:"#27AE60",fontWeight:700}}>Débutant</span> à l'<span style={{color:"#FF1493",fontWeight:700}}>UltraStar</span>. Ton statut s'affiche à côté de tes points sur ta carte de profil.</P>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:6,marginTop:10}}>
          {[
            {label:"Débutant",min:0,color:"#27AE60"},
            {label:"Interméd.",min:300,color:"#4A90D9"},
            {label:"Confirmé",min:700,color:"#9B59B6"},
            {label:"Avancé",min:1300,color:"#CD7F32"},
            {label:"Expert",min:2000,color:"#C0C0C0"},
            {label:"Élite",min:3000,color:"#FFD700"},
            {label:"Star",min:4500,color:"#00D4FF"},
            {label:"SuperStar",min:6500,color:"#FF6B35"},
            {label:"UltraStar",min:9000,color:"#FF1493"},
          ].map(l=>(
            <div key={l.label} style={{padding:"8px 6px",background:`${l.color}12`,border:`1px solid ${l.color}55`,borderRadius:8,borderLeft:`3px solid ${l.color}`,textAlign:"center"}}>
              <div style={{fontFamily:"'Bebas Neue'",fontSize:13,color:l.color,letterSpacing:0.4,lineHeight:1}}>{l.label}</div>
              <div style={{fontSize:9,color:"rgba(240,237,232,0.5)",fontFamily:"'Barlow',sans-serif",letterSpacing:0.5,marginTop:3}}>dès {l.min} pts</div>
            </div>
          ))}
        </div>
      </Section>

      <Section title="5 · Points bonus">
        <div style={{fontSize:11,color:"rgba(240,237,232,0.4)",letterSpacing:1.5,textTransform:"uppercase",fontFamily:"'Barlow',sans-serif",fontWeight:700,marginBottom:8}}>Courses</div>
        <Bullet emoji="🏆" bold="Record personnel battu ">→ <span style={{color:"#E63946",fontWeight:700}}>+100 pts</span></Bullet>
        <Bullet emoji="🥇" bold="Top 3 de ta catégorie ">→ <span style={{color:"#E63946",fontWeight:700}}>+300 pts</span></Bullet>
        <Bullet emoji="🎖️" bold="Top 10% de ta catégorie ">→ <span style={{color:"#E63946",fontWeight:700}}>+150 pts</span></Bullet>
        <Bullet emoji="🚀" bold="Première course de la saison ">→ <span style={{color:"#E63946",fontWeight:700}}>+30 pts</span></Bullet>
        <div style={{fontSize:11,color:"rgba(240,237,232,0.4)",letterSpacing:1.5,textTransform:"uppercase",fontFamily:"'Barlow',sans-serif",fontWeight:700,marginTop:14,marginBottom:8}}>Entraînement</div>
        <Bullet emoji="🔥" bold="7 jours consécutifs d'activité ">→ <span style={{color:"#E63946",fontWeight:700}}>+100 pts</span></Bullet>
        <Bullet emoji="⚡" bold="30 jours consécutifs ">→ <span style={{color:"#E63946",fontWeight:700}}>+500 pts</span></Bullet>
        <Bullet emoji="📏" bold="100 km parcourus dans le mois ">→ <span style={{color:"#E63946",fontWeight:700}}>+200 pts</span></Bullet>
      </Section>

      <Section title="6 · Le Streak">
        <P>Le streak compte le nombre de <span style={{color:"#F0EDE8",fontWeight:700}}>semaines consécutives</span> avec au moins une activité enregistrée (course ou entraînement).</P>
        <P>Tant que tu fais bouger la machine au moins une fois par semaine, ton streak grimpe. Si tu rates une semaine entière, il repart à zéro.</P>
      </Section>

      <Section title="7 · Les Ligues">
        <P>Chaque semaine, tu affrontes <span style={{color:"#F0EDE8",fontWeight:700}}>20 athlètes</span> de ton niveau dans une ligue. Le classement est basé uniquement sur tes <span style={{color:"#F0EDE8",fontWeight:700}}>points d'entraînement de la semaine</span> (les courses officielles ne comptent pas).</P>
        <div style={{display:"grid",gridTemplateColumns:"repeat(5,1fr)",gap:6,marginTop:10,marginBottom:10}}>
          {[
            {label:"Rookie",icon:"🌱",color:"#27AE60"},
            {label:"Pro",   icon:"🎯",color:"#4A90D9"},
            {label:"Elite", icon:"🏆",color:"#9B59B6"},
            {label:"Legend",icon:"⚡",color:"#FF6B35"},
            {label:"Mythic",icon:"💎",color:"#FF073A"},
          ].map(l=>(
            <div key={l.label} style={{padding:"10px 4px",background:`${l.color}15`,border:`1px solid ${l.color}50`,borderRadius:10,textAlign:"center"}}>
              <div style={{fontSize:18}}>{l.icon}</div>
              <div style={{fontFamily:"'Barlow',sans-serif",fontWeight:700,fontSize:10,color:l.color,letterSpacing:0.5,marginTop:2,textTransform:"uppercase"}}>{l.label}</div>
            </div>
          ))}
        </div>
        <P>Les nouveaux athlètes démarrent en <span style={{color:"#27AE60",fontWeight:700}}>Rookie</span> et progressent jusqu'à <span style={{color:"#FF073A",fontWeight:700}}>Mythic</span>.</P>
        <Bullet emoji="🏆" bold="TOP 5 ">→ promotion à la ligue supérieure le lundi suivant</Bullet>
        <Bullet emoji="🛡️" bold="Du 6e au 15e ">→ maintien dans la ligue actuelle</Bullet>
        <Bullet emoji="⚠️" bold="BOTTOM 5 ">→ relégation à la ligue inférieure</Bullet>
        <P>Les points <span style={{color:"#F0EDE8",fontWeight:700}}>remettent à 0 chaque lundi à 00h</span> : nouvelle semaine, nouveau classement.</P>
      </Section>

      <Section title="8 · Les disciplines">
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
          {[
            {icon:"🏃",label:"Course à pied",color:"#4A90D9",desc:"5 km · 10 km · semi · marathon"},
            {icon:"⛰️",label:"Trail",color:"#27AE60",desc:"Court · Moyen · Long · Ultra"},
            {icon:"🏊",label:"Triathlon",color:"#9B59B6",desc:"S · Olympique · Half · Ironman"},
            {icon:"🔥",label:"Hyrox",color:"#E63946",desc:"Solo · Double"},
          ].map(d=>(
            <div key={d.label} style={{padding:"12px",background:`${d.color}10`,border:`1px solid ${d.color}40`,borderRadius:12}}>
              <div style={{fontSize:22,marginBottom:4}}>{d.icon}</div>
              <div style={{fontFamily:"'Bebas Neue'",fontSize:15,color:d.color,letterSpacing:1}}>{d.label}</div>
              <div style={{fontSize:11,color:"rgba(240,237,232,0.55)",fontFamily:"'Barlow',sans-serif",marginTop:2,lineHeight:1.4}}>{d.desc}</div>
            </div>
          ))}
        </div>
      </Section>

      <Btn onClick={onClose} mb={0}>Compris</Btn>
    </Modal>
  );
}

// ── HOME TAB ──────────────────────────────────────────────────────────────────
const rYear=r=>r.race_date?parseInt(r.race_date.slice(0,4)):(r.year||CY);

// ── NOTIFS — registre de types ────────────────────────────────────────────────
// Libellés legacy : utilisés en fallback quand `payload IS NULL` (notifs créées
// avant l'introduction de payload). Les notifs v1 (avec payload) passent par
// `renderNotifLabel` qui peut intégrer des variables dynamiques.
const NOTIF_LEGACY_LABEL = {
  friend_added:     "t'a ajouté en ami",
  like_result:      "a aimé ta course",
  like_training:    "a aimé ton entraînement",
  comment_result:   "a commenté ta course",
  comment_training: "a commenté ton entraînement",
  friend_overtake:  "🚀 t'a dépassé au classement saison",
};
const NOTIF_ICON = {
  friend_added:        "👋",
  like_result:         "❤️",
  like_training:       "❤️",
  comment_result:      "💬",
  comment_training:    "💬",
  friend_overtake:     "🚀",
  friend_official_race:"🏁",
  friend_pr:           "🏆",
  league_overtake:     "📉",
  level_up_imminent:   "⭐",
};
// Types qui ont un acteur (from_user_id) et donc affichent "<nom> <verbe>".
// Les autres ont un libellé impersonnel.
const NOTIF_HAS_ACTOR = {
  friend_added: true, like_result: true, like_training: true,
  comment_result: true, comment_training: true, friend_overtake: true,
  friend_official_race: true, friend_pr: true,
  league_overtake: false, level_up_imminent: false,
};
function renderNotifLabel(n) {
  // Si payload existe → format v1 (variables dynamiques)
  if (n.payload && typeof n.payload === "object") {
    const p = n.payload || {};
    switch (n.type) {
      case "friend_pr":            return `a battu son record en ${p.discipline || "course"}`;
      case "friend_official_race": return "a participé à une course";
      case "friend_overtake":      return "t'a dépassé au classement saison";
      case "league_overtake": {
        const drop = (p.new_rank||0) - (p.old_rank||0);
        if (drop > 0) return `Tu as perdu ${drop} place${drop>1?"s":""} dans ta ligue ${p.league_name||""}`.trim();
        if (drop < 0) return `Tu as gagné ${-drop} place${-drop>1?"s":""} dans ta ligue ${p.league_name||""}`.trim();
        return "Changement de rang dans ta ligue";
      }
      case "level_up_imminent": {
        const remaining = Math.max(0, (p.next_level_points||0) - (p.current_points||0));
        return `Plus que ${remaining} pts avant ${p.next_level_name||"niveau supérieur"}`;
      }
      // legacy types : si jamais un payload est fourni, on retombe sur libellé legacy
      default: return NOTIF_LEGACY_LABEL[n.type] || "";
    }
  }
  // Pas de payload → libellé legacy hardcodé
  return NOTIF_LEGACY_LABEL[n.type] || "";
}

function NotificationsModal({onClose,onNotifsChange,inAppEnabled=true,onNavigateLeague,onNavigateProfile}){
  const [notifs,setNotifs]=useState([]);
  const [loading,setLoading]=useState(true);
  const [openFriend,setOpenFriend]=useState(null);
  const [myId,setMyId]=useState(null);
  const load=async()=>{
    setLoading(true);
    const{data:{user}}=await supabase.auth.getUser();
    if(!user){setLoading(false);return;}
    setMyId(user.id);
    // Historique chronologique complet (lues + non-lues)
    const{data}=await supabase.from("notifications").select("*, from_user:profiles!notifications_from_user_id_fkey(id,name,avatar,city,birth_year)").eq("user_id",user.id).order("created_at",{ascending:false}).limit(100);
    setNotifs(data||[]);setLoading(false);
  };
  useEffect(()=>{ if(inAppEnabled) load(); else setLoading(false); },[inAppEnabled]);
  const markRead=async id=>{
    await supabase.from("notifications").update({read:true}).eq("id",id);
    setNotifs(n=>n.map(x=>x.id===id?{...x,read:true}:x));
    onNotifsChange&&onNotifsChange();
  };
  const markAll=async()=>{
    const unread=notifs.filter(n=>!n.read);
    if(unread.length===0)return;
    const{data:{user}}=await supabase.auth.getUser();
    await supabase.from("notifications").update({read:true}).eq("user_id",user.id).eq("read",false);
    setNotifs(n=>n.map(x=>({...x,read:true})));
    onNotifsChange&&onNotifsChange();
  };
  const handleClick=async n=>{
    if(!n.read) await markRead(n.id);
    if (n.type==="league_overtake") { onNavigateLeague&&onNavigateLeague(); onClose&&onClose(); return; }
    if (n.type==="level_up_imminent") { onNavigateProfile&&onNavigateProfile(); onClose&&onClose(); return; }
    if (NOTIF_HAS_ACTOR[n.type] && n.from_user) { setOpenFriend(n.from_user); return; }
  };
  const hasUnread = notifs.some(n=>!n.read);
  return (
    <Modal onClose={onClose}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:14}}>
        <div style={{fontFamily:"'Bebas Neue'",fontSize:26,letterSpacing:1,color:"#F0EDE8"}}>🔔 Notifications</div>
        {hasUnread&&<button onClick={markAll} style={{background:"rgba(255,255,255,0.07)",border:"none",borderRadius:10,padding:"7px 11px",color:"rgba(240,237,232,0.65)",fontFamily:"'Barlow',sans-serif",fontWeight:700,fontSize:11,cursor:"pointer"}}>Tout marquer lu</button>}
      </div>
      {!inAppEnabled
        ? <div style={{textAlign:"center",color:"rgba(240,237,232,0.45)",padding:"40px 12px",fontFamily:"'Barlow',sans-serif",fontSize:13,lineHeight:1.5}}>Notifications dans l'app désactivées.<br/>Réactive-les depuis ton profil pour voir l'historique.</div>
        : loading?<div style={{textAlign:"center",color:"#444",padding:"30px 0",fontFamily:"'Barlow',sans-serif",fontSize:13}}>Chargement…</div>
        : notifs.length===0
          ? <div style={{textAlign:"center",color:"#444",padding:"40px 0",fontFamily:"'Barlow',sans-serif",fontSize:13}}>Aucune notification 🎉</div>
          : notifs.map(n=>{
              const txt = renderNotifLabel(n);
              const hasActor = NOTIF_HAS_ACTOR[n.type] !== false;
              const icon = NOTIF_ICON[n.type] || "🔔";
              const muted = n.read;
              return (
                <div key={n.id} onClick={()=>handleClick(n)} style={{display:"flex",alignItems:"center",gap:12,padding:"10px 14px",background:muted?"rgba(255,255,255,0.025)":"rgba(230,57,70,0.08)",borderRadius:14,marginBottom:7,border:`1px solid ${muted?"rgba(255,255,255,0.06)":"rgba(230,57,70,0.2)"}`,opacity:muted?0.6:1,cursor:"pointer"}}>
                  {hasActor && n.from_user
                    ? <Avatar profile={n.from_user} size={36}/>
                    : <div style={{width:36,height:36,borderRadius:"50%",background:"rgba(255,255,255,0.06)",border:"1px solid rgba(255,255,255,0.08)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:18,flexShrink:0}}>{icon}</div>}
                  <div style={{flex:1,minWidth:0}}>
                    <div style={{fontFamily:"'Barlow',sans-serif",fontSize:13,color:"#F0EDE8",lineHeight:1.4}}>
                      {hasActor && <><strong>{n.from_user?.name||"Quelqu'un"}</strong>{" "}</>}
                      {txt}
                    </div>
                    <div style={{fontSize:10,color:"rgba(240,237,232,0.4)",fontFamily:"'Barlow',sans-serif",marginTop:2}}>{new Date(n.created_at).toLocaleDateString("fr-FR",{day:"numeric",month:"short",hour:"2-digit",minute:"2-digit"})}</div>
                  </div>
                  {!muted && <span aria-hidden="true" style={{width:8,height:8,borderRadius:"50%",background:"#E63946",flexShrink:0,boxShadow:"0 0 6px rgba(230,57,70,0.6)"}}/>}
                </div>
              );
            })}
      {openFriend&&<FriendProfileModal friend={openFriend} myId={myId} onClose={()=>setOpenFriend(null)}/>}
    </Modal>
  );
}

// `id` = clé stockée en BDD (user_leagues.current_league, last_league_seen).
// `label` = nom affiché — découplé pour permettre un renommage UI sans migration BDD.
const LEAGUES=[
  {id:"bronze", label:"Rookie", icon:"🌱",color:"#27AE60",bg:"rgba(39,174,96,0.1)", border:"rgba(39,174,96,0.3)"},
  {id:"silver", label:"Pro",    icon:"🎯",color:"#4A90D9",bg:"rgba(74,144,217,0.1)",border:"rgba(74,144,217,0.3)"},
  {id:"gold",   label:"Elite",  icon:"🏆",color:"#9B59B6",bg:"rgba(155,89,182,0.1)",border:"rgba(155,89,182,0.3)"},
  {id:"diamond",label:"Legend", icon:"⚡",color:"#FF6B35",bg:"rgba(255,107,53,0.1)",border:"rgba(255,107,53,0.3)"},
  {id:"elite",  label:"Mythic", icon:"💎",color:"#FF073A",bg:"rgba(255,7,58,0.1)",  border:"rgba(255,7,58,0.3)"},
];
const SPORT_EMOJI={Run:"🏃","Vélo":"🚴",Natation:"🏊",Trail:"⛰️"};
const DAY_FR=["Dim","Lun","Mar","Mer","Jeu","Ven","Sam"];

function LeagueBadge({league,size=40,active=false}){
  return (
    <div style={{width:size,height:size,borderRadius:"50%",
      background:active?league.bg:"rgba(255,255,255,0.04)",
      border:`2px solid ${active?league.border:"rgba(255,255,255,0.08)"}`,
      display:"flex",alignItems:"center",justifyContent:"center",
      fontSize:size*0.45,flexShrink:0,
      boxShadow:active?`0 0 16px ${league.color}55`:undefined,
      transition:"all 0.3s"}}>
      {league.icon}
    </div>
  );
}

function LeagueView({players,myLeague,mySessions,onAddTraining,onOpenFriend}){
  const [now,setNow]=useState(Date.now());
  useEffect(()=>{const t=setInterval(()=>setNow(Date.now()),1000);return()=>clearInterval(t);},[]);
  const d=new Date(now);
  const day=d.getDay();
  const offsetToMonday=day===0?-6:1-day;
  const monday=new Date(d.getFullYear(),d.getMonth(),d.getDate()+offsetToMonday);
  const nextMonday=new Date(monday.getTime()+7*86400000);
  const remaining=Math.max(0,nextMonday.getTime()-now);
  const days=Math.floor(remaining/86400000);
  const hours=Math.floor((remaining%86400000)/3600000);

  const myIdx=players.findIndex(p=>p.isMe);
  const myRow=myIdx>=0?players[myIdx]:null;
  const myPos=myIdx>=0?myIdx+1:players.length+1;
  const myPts=myRow?.trainPts||0;
  const mySessionCount=mySessions.length;
  const totalSessionPts=mySessions.reduce((s,m)=>s+m.pts,0);
  const myLeagueIdx=LEAGUES.findIndex(l=>l.id===myLeague.id);
  const nextLeague=LEAGUES[Math.min(myLeagueIdx+1,LEAGUES.length-1)];

  return (
    <div>
      {/* Info banner */}
      <div style={{background:"rgba(255,255,255,0.03)",border:"1px solid rgba(255,255,255,0.06)",borderRadius:12,padding:"10px 14px",marginBottom:12,display:"flex",alignItems:"center",gap:10}}>
        <span style={{fontSize:18}}>📅</span>
        <div style={{fontSize:11,color:"rgba(240,237,232,0.5)",lineHeight:1.5,fontFamily:"'Barlow',sans-serif"}}>
          La ligue est basée sur tes <strong style={{color:"#F0EDE8"}}>points d'entraînement</strong> de la semaine. Repart à 0 chaque lundi.
        </div>
      </div>

      {/* League header */}
      <div style={{background:myLeague.bg,border:`1px solid ${myLeague.border}`,borderRadius:18,padding:16,marginBottom:12}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:14}}>
          <div style={{display:"flex",alignItems:"center",gap:10}}>
            <LeagueBadge league={myLeague} size={48} active/>
            <div>
              <div style={{fontFamily:"'Bebas Neue'",fontSize:24,color:myLeague.color,letterSpacing:1,lineHeight:1}}>Ligue {myLeague.label}</div>
              <div style={{fontSize:10,color:"rgba(240,237,232,0.4)",fontFamily:"'Barlow',sans-serif",marginTop:3}}>{players.length} athlète{players.length>1?"s":""} · semaine en cours</div>
            </div>
          </div>
          <div style={{background:"rgba(0,0,0,0.3)",borderRadius:10,padding:"6px 10px",textAlign:"center"}}>
            <div style={{fontSize:8,color:"rgba(240,237,232,0.4)",letterSpacing:1,fontFamily:"'Barlow',sans-serif"}}>FIN DANS</div>
            <div style={{fontFamily:"'Bebas Neue'",fontSize:18,color:"#F0EDE8",letterSpacing:0.5,lineHeight:1.1,marginTop:2}}>{days}j {String(hours).padStart(2,"0")}h</div>
          </div>
        </div>

        {/* Stats row */}
        <div style={{display:"flex",gap:8,marginBottom:12}}>
          {[
            {l:"Position",v:myIdx>=0?`#${myPos}`:"—",c:myLeague.color},
            {l:"Pts semaine",v:myPts,c:"#F0EDE8"},
            {l:"Sessions",v:mySessionCount,c:"#F0EDE8"},
          ].map(({l,v,c})=>(
            <div key={l} style={{flex:1,background:"rgba(0,0,0,0.2)",borderRadius:10,padding:"8px 6px",textAlign:"center"}}>
              <div style={{fontSize:8,color:"rgba(240,237,232,0.4)",marginBottom:3,letterSpacing:1,fontFamily:"'Barlow',sans-serif"}}>{l}</div>
              <div style={{fontFamily:"'Bebas Neue'",fontSize:22,color:c,letterSpacing:1,lineHeight:1}}>{v}</div>
            </div>
          ))}
        </div>

        {/* Zones */}
        <div style={{display:"flex",gap:5}}>
          {[
            {c:"#FFD700",bg:"rgba(255,215,0,0.1)",border:"rgba(255,215,0,0.2)",t:"🏆 TOP 5",s:"Promotion"},
            {c:"rgba(240,237,232,0.4)",bg:"rgba(255,255,255,0.04)",border:"rgba(255,255,255,0.08)",t:"Maintien",s:"Reste en ligue"},
            {c:"#E63946",bg:"rgba(230,57,70,0.08)",border:"rgba(230,57,70,0.15)",t:"⚠️ BOTTOM 5",s:"Relégation"},
          ].map(({c,bg,border,t,s})=>(
            <div key={t} style={{flex:1,background:bg,border:`1px solid ${border}`,borderRadius:8,padding:"6px 6px",textAlign:"center"}}>
              <div style={{fontSize:8,color:c,fontWeight:700,letterSpacing:0.3,fontFamily:"'Barlow',sans-serif"}}>{t}</div>
              <div style={{fontSize:7,color:"rgba(240,237,232,0.35)",marginTop:1,fontFamily:"'Barlow',sans-serif"}}>{s}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Leaderboard */}
      <div>
          {players.map((p,i)=>{
            const isTop5=i<5;
            const isBottom5=i>=players.length-5&&players.length>=10;
            const isMe=p.isMe;
            let rowBg="rgba(255,255,255,0.02)";
            let rowBorder="rgba(255,255,255,0.04)";
            if(isMe){rowBg="rgba(255,215,0,0.08)";rowBorder="rgba(255,215,0,0.3)";}
            else if(isTop5){rowBg="rgba(255,215,0,0.03)";rowBorder="rgba(255,215,0,0.08)";}
            else if(isBottom5&&p.trainPts===0){rowBg="rgba(230,57,70,0.04)";rowBorder="rgba(230,57,70,0.1)";}
            const initials=(p.name||"?").split(" ").map(w=>w[0]).join("").slice(0,2).toUpperCase();
            return (
              <div key={p.id||i}>
                {i===5&&<div style={{display:"flex",alignItems:"center",gap:8,margin:"8px 0 6px"}}>
                  <div style={{flex:1,height:1,background:"rgba(255,215,0,0.15)"}}/>
                  <div style={{fontSize:8,color:"rgba(255,215,0,0.55)",letterSpacing:1,whiteSpace:"nowrap",fontFamily:"'Barlow',sans-serif",fontWeight:700,textTransform:"uppercase"}}>↑ Promotion</div>
                  <div style={{flex:1,height:1,background:"rgba(255,215,0,0.15)"}}/>
                </div>}
                {i===players.length-5&&players.length>=10&&<div style={{display:"flex",alignItems:"center",gap:8,margin:"8px 0 6px"}}>
                  <div style={{flex:1,height:1,background:"rgba(230,57,70,0.2)"}}/>
                  <div style={{fontSize:8,color:"rgba(230,57,70,0.65)",letterSpacing:1,whiteSpace:"nowrap",fontFamily:"'Barlow',sans-serif",fontWeight:700,textTransform:"uppercase"}}>↓ Relégation</div>
                  <div style={{flex:1,height:1,background:"rgba(230,57,70,0.2)"}}/>
                </div>}
                <div onClick={()=>!isMe&&onOpenFriend&&onOpenFriend(p)} style={{display:"flex",alignItems:"center",gap:8,padding:"9px 12px",borderRadius:12,marginBottom:4,background:rowBg,border:`1px solid ${rowBorder}`,cursor:isMe?"default":"pointer"}}>
                  <div style={{fontFamily:"'Bebas Neue'",fontSize:15,
                    color:i===0?"#FFD700":i===1?"#C0C0C0":i===2?"#CD7F32":isBottom5&&p.trainPts===0?"rgba(230,57,70,0.6)":"rgba(240,237,232,0.55)",
                    width:20,textAlign:"center",flexShrink:0}}>
                    {i===0?"🥇":i===1?"🥈":i===2?"🥉":isBottom5&&p.trainPts===0?"↓":i+1}
                  </div>
                  <div style={{width:30,height:30,borderRadius:"50%",flexShrink:0,
                    background:isMe?"rgba(255,215,0,0.15)":"rgba(255,255,255,0.07)",
                    border:isMe?"1px solid rgba(255,215,0,0.3)":"1px solid rgba(255,255,255,0.05)",
                    display:"flex",alignItems:"center",justifyContent:"center",
                    fontFamily:"'Bebas Neue'",fontSize:12,color:"#F0EDE8",overflow:"hidden"}}>
                    {p.avatar?<img src={p.avatar} style={{width:"100%",height:"100%",objectFit:"cover"}} onError={e=>{e.target.style.display="none";}}/>:initials}
                  </div>
                  <div style={{flex:1,minWidth:0}}>
                    <div style={{fontFamily:"'Bebas Neue'",fontSize:14,
                      color:isMe?"#FFD700":"#F0EDE8",letterSpacing:0.5,
                      overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>
                      {p.name}{isMe?" ← toi":""}
                    </div>
                    <div style={{fontSize:9,color:"rgba(240,237,232,0.3)",fontFamily:"'Barlow',sans-serif",marginTop:1}}>
                      {p.sessions>0?`${p.sessions} session${p.sessions>1?"s":""}${p.sports?.length?` · ${p.sports.map(s=>SPORT_EMOJI[s]||"·").join("")}`:""}`:"Aucune session"}
                    </div>
                  </div>
                  <div style={{textAlign:"right",flexShrink:0}}>
                    <div style={{fontFamily:"'Bebas Neue'",fontSize:18,
                      color:isMe?"#FFD700":p.trainPts>0?"#F0EDE8":"#444",letterSpacing:1,lineHeight:1}}>
                      {p.trainPts}
                    </div>
                    <div style={{fontSize:7,color:"rgba(240,237,232,0.25)",letterSpacing:1,fontFamily:"'Barlow',sans-serif",marginTop:2}}>PTS</div>
                  </div>
                </div>
              </div>
            );
          })}

          {/* Progress bar top 5 */}
          {myIdx>=0&&(()=>{
            const hasFullField=players.length>=5;
            const fifthPts=hasFullField?(players[4]?.trainPts||0):0;
            const target=hasFullField?fifthPts+1:Math.max(30,myPts+30);
            const inTop5=myPos<=5;
            const fillPct=target>0?Math.min(100,(myPts/target)*100):0;
            let labelTop,labelBottom;
            if(!hasFullField){
              labelTop="La ligue se remplit";
              labelBottom="Continue tes séances pour valider ta place dans le top 5";
            }else if(inTop5){
              labelTop="🏆 Tu es dans le top 5";
              labelBottom=`Tiens jusqu'à lundi pour monter en ${nextLeague.label}`;
            }else{
              labelTop=`+${Math.max(1,target-myPts)} pts pour le top 5`;
              labelBottom=`${myPts} / ${target} pts cette semaine`;
            }
            return (
              <div style={{marginTop:12,background:"linear-gradient(135deg,rgba(255,215,0,0.12),rgba(255,215,0,0.04))",border:"1px solid rgba(255,215,0,0.22)",borderRadius:14,padding:"14px 16px"}}>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10,gap:10}}>
                  <div style={{fontFamily:"'Bebas Neue'",fontSize:15,color:"#FFD700",letterSpacing:1,minWidth:0,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{labelTop}</div>
                  <button onClick={onAddTraining} style={{background:"#FFD700",border:"none",borderRadius:8,padding:"6px 10px",fontFamily:"'Bebas Neue'",fontSize:11,color:"#111",cursor:"pointer",letterSpacing:1,flexShrink:0}}>+ SÉANCE</button>
                </div>
                <div style={{height:8,background:"rgba(0,0,0,0.3)",borderRadius:4,overflow:"hidden",marginBottom:6}}>
                  <div style={{width:`${fillPct}%`,height:"100%",backgroundImage:"linear-gradient(90deg,#FFD700,#FFA500)",transition:"width 0.4s"}}/>
                </div>
                <div style={{fontSize:10,color:"rgba(240,237,232,0.5)",fontFamily:"'Barlow',sans-serif"}}>{labelBottom}</div>
              </div>
            );
          })()}
      </div>

      {/* Progression frize */}
      <div style={{marginTop:16,background:"rgba(255,255,255,0.02)",border:"1px solid rgba(255,255,255,0.04)",borderRadius:14,padding:"14px"}}>
        <div style={{fontSize:9,letterSpacing:1.5,textTransform:"uppercase",color:"rgba(240,237,232,0.35)",fontFamily:"'Barlow',sans-serif",marginBottom:12}}>
          Progression des ligues
        </div>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
          {LEAGUES.map((l,i)=>(
            <div key={l.id} style={{display:"flex",alignItems:"center"}}>
              <div style={{display:"flex",flexDirection:"column",alignItems:"center",gap:5}}>
                <LeagueBadge league={l} size={34} active={l.id===myLeague.id}/>
                <div style={{fontSize:8,color:l.id===myLeague.id?l.color:"rgba(240,237,232,0.4)",
                  fontFamily:"'Barlow',sans-serif",fontWeight:700,letterSpacing:0.5,textTransform:"uppercase"}}>{l.label}</div>
              </div>
              {i<LEAGUES.length-1&&<div style={{width:14,height:1,background:"rgba(255,255,255,0.08)",margin:"0 2px"}}/>}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
const shortName=n=>{if(!n)return"Anonyme";const p=n.trim().split(/\s+/);return p.length>1?`${p[0]} ${p[1][0].toUpperCase()}.`:p[0];};

function AddPickerModal({onPickTraining,onPickRace,onClose}){
  const opts=[
    {icon:"🏋️",label:"Entraînement",desc:"Run, Vélo, Natation, Trail",color:"#4ade80",cb:onPickTraining},
    {icon:"🏅",label:"Course officielle",desc:"5km, 10km, marathon, trail, triathlon, hyrox…",color:"#E63946",cb:onPickRace},
  ];
  return (
    <Modal onClose={onClose}>
      <div style={{fontFamily:"'Bebas Neue'",fontSize:24,letterSpacing:1.5,color:"#F0EDE8",marginBottom:6}}>Ajouter une activité</div>
      <div style={{fontSize:12,color:"rgba(240,237,232,0.5)",fontFamily:"'Barlow',sans-serif",marginBottom:18,lineHeight:1.5}}>Choisis le type d'activité — la discipline se choisira ensuite.</div>
      {opts.map(o=>(
        <button key={o.label} onClick={()=>{onClose();o.cb();}} style={{display:"flex",alignItems:"center",gap:14,width:"100%",padding:"16px 18px",background:`${o.color}10`,border:`1px solid ${o.color}40`,borderRadius:14,marginBottom:10,cursor:"pointer",textAlign:"left"}}>
          <div style={{width:48,height:48,borderRadius:12,background:`${o.color}22`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:24,flexShrink:0}}>{o.icon}</div>
          <div style={{flex:1,minWidth:0}}>
            <div style={{fontFamily:"'Bebas Neue'",fontSize:18,color:o.color,letterSpacing:1}}>{o.label}</div>
            <div style={{fontSize:11,color:"rgba(240,237,232,0.55)",fontFamily:"'Barlow',sans-serif",marginTop:2,lineHeight:1.4}}>{o.desc}</div>
          </div>
          <div style={{color:o.color,fontSize:18,flexShrink:0}}>›</div>
        </button>
      ))}
      <Btn onClick={onClose} variant="secondary" mb={0}>Annuler</Btn>
    </Modal>
  );
}

function HomeTab({profile,userId,onAddTraining,onAddRace,refreshKey,onOpenProfile,notifCount=0,onNotifsChange,overtakenBanner,onDismissOvertakenBanner,onOpenOvertakenDetail,pushOptedIn,pushBannerDismissed,onEnablePush,onDismissPushBanner,onOpenLeague}){
  const [showNotifs,setShowNotifs]=useState(false);
  const [showPicker,setShowPicker]=useState(false);
  const [results,setResults]=useState([]);
  const [trainings,setTrainings]=useState([]);
  const [pendingClassif,setPendingClassif]=useState([]);
  const [classifModalOpen,setClassifModalOpen]=useState(false);
  const [classifToast,setClassifToast]=useState("");
  const [friendIds,setFriendIds]=useState(new Set());

  const loadPendingClassif = useCallback(async () => {
    if (!userId) return;
    const {data} = await supabase.from("trainings")
      .select("*")
      .eq("user_id", userId)
      .eq("auto_detected_official", true)
      .eq("classification_status", "pending")
      .order("date", {ascending:false});
    setPendingClassif(data||[]);
  }, [userId]);

  useEffect(()=>{
    if(!userId)return;
    supabase.from("results").select("*").eq("user_id",userId)
      .then(({data})=>setResults(data||[]));
    supabase.from("trainings").select("*").eq("user_id",userId)
      .then(({data,error})=>{if(!error)setTrainings(data||[]);});
    (async () => {
      const lsKey = `retro_classif_${userId}`;
      if (!localStorage.getItem(lsKey)) {
        const {data:all} = await supabase.from("trainings")
          .select("id,title,classification_status,auto_detected_official")
          .eq("user_id", userId)
          .eq("classification_status", "pending")
          .eq("auto_detected_official", false);
        const toFlag = (all||[]).filter(t => detectOfficialRace(t.title)).map(t => t.id);
        if (toFlag.length > 0) {
          await supabase.from("trainings").update({auto_detected_official:true}).in("id", toFlag);
        }
        try { localStorage.setItem(lsKey, "1"); } catch {}
      }
      loadPendingClassif();
    })();
  },[userId,refreshKey,loadPendingClassif]);

  const seasons=useMemo(()=>{
    const base=[CY-3,CY-2,CY-1,CY];
    const fromData=results.map(rYear);
    return [...new Set([...base,...fromData])].sort((a,b)=>a-b);
  },[results]);
  const [season,setSeason]=useState(CY);
  const seasonsRef=useRef(null);
  useEffect(()=>{
    if(seasons.length>0){
      setSeason(seasons[seasons.length-1]);
      setTimeout(()=>{if(seasonsRef.current)seasonsRef.current.scrollLeft=seasonsRef.current.scrollWidth;},50);
    }
  },[seasons]);
  const [rankFilter,setRankFilter]=useState("amis");
  const [discFilter,setDiscFilter]=useState("All");
  const [rankData,setRankData]=useState([]);
  const [openFriend,setOpenFriend]=useState(null);
  const [leagueData,setLeagueData]=useState({players:[],myLeague:LEAGUES[0],mySessions:[]});

  useEffect(()=>{loadRanking();},[season,rankFilter,discFilter]);
  useEffect(()=>{
    if(!userId)return;
    supabase.from("friendships").select("friend_id").eq("user_id",userId).eq("status","accepted")
      .then(({data})=>setFriendIds(new Set((data||[]).map(f=>f.friend_id))));
  },[userId]);

  const refreshHome = async () => {
    if (!userId) return;
    const [r1, t1] = await Promise.all([
      supabase.from("results").select("*").eq("user_id",userId),
      supabase.from("trainings").select("*").eq("user_id",userId),
    ]);
    if (!r1.error) setResults(r1.data||[]);
    if (!t1.error) setTrainings(t1.data||[]);
    await loadPendingClassif();
    await loadRanking();
  };

  const handleAddFriend=async id=>{
    setFriendIds(s=>{const n=new Set(s);n.add(id);return n;});
    const{error}=await supabase.rpc("add_friend",{p_friend_id:id});
    if(error)setFriendIds(s=>{const n=new Set(s);n.delete(id);return n;});
  };
  const handleCancelFriend=async id=>{
    setFriendIds(s=>{const n=new Set(s);n.delete(id);return n;});
    const{error}=await supabase.rpc("remove_friend",{p_friend_id:id});
    if(error)setFriendIds(s=>{const n=new Set(s);n.add(id);return n;});
  };

  const loadRanking=async()=>{
    const{data:{user}}=await supabase.auth.getUser();
    const{data:allResultsFull}=await supabase.from("results").select("*");
    const{data:allProfilesRaw}=await supabase.from("profiles").select("*");
    const{data:allTrainings}=await supabase.from("trainings").select("user_id,sport,distance,duration,points,date");
    if(!allResultsFull||!allProfilesRaw)return;
    const allProfiles=allProfilesRaw.filter(p=>!p.ranking_hidden);
    const allResults=allResultsFull.filter(r=>rYear(r)===season);
    const seasonTrainings=(allTrainings||[]).filter(t=>new Date(t.date).getFullYear()===season);

    if(rankFilter==="ligue"){
      const now=new Date();
      const day=now.getDay();
      const offsetToMonday=day===0?-6:1-day;
      const monday=new Date(now.getFullYear(),now.getMonth(),now.getDate()+offsetToMonday);
      const nextMonday=new Date(monday.getTime()+7*86400000);
      console.log("[league] semaine du",monday.toISOString(),"au",nextMonday.toISOString());

      let myLeagueRow=null;
      try{
        const r=await supabase.from("user_leagues").select("*").eq("user_id",user.id).maybeSingle();
        if(r.error){throw r.error;}
        myLeagueRow=r.data;
        if(!myLeagueRow){
          const ins=await supabase.from("user_leagues").insert({user_id:user.id,current_league:"bronze"}).select().maybeSingle();
          myLeagueRow=ins.data||{user_id:user.id,current_league:"bronze",league_group_id:null};
        }
      }catch(e){
        console.error("[league] user_leagues indisponible — fallback Bronze solo",e?.message||e);
        myLeagueRow={user_id:user.id,current_league:"bronze",league_group_id:null};
      }
      const tier=myLeagueRow.current_league||"bronze";
      const groupId=myLeagueRow.league_group_id;

      let memberIds=[user.id];
      try{
        let q=supabase.from("user_leagues").select("user_id,league_group_id").eq("current_league",tier);
        if(groupId)q=q.eq("league_group_id",groupId);else q=q.is("league_group_id",null);
        const{data:mates,error}=await q;
        if(error)throw error;
        if(mates&&mates.length>0)memberIds=[...new Set([user.id,...mates.map(m=>m.user_id)])];
      }catch(e){
        console.error("[league] requête mates échouée — solo dans la ligue",e?.message||e);
      }
      const memberSet=new Set(memberIds);
      let memberProfiles=allProfiles.filter(p=>memberSet.has(p.id));
      if(!memberProfiles.some(p=>p.id===user.id)){
        const myProf=allProfiles.find(p=>p.id===user.id);
        if(myProf)memberProfiles=[...memberProfiles,myProf];
      }
      const weekTrainings=(allTrainings||[]).filter(t=>{
        if(!t.date||!memberSet.has(t.user_id))return false;
        const d=new Date(t.date);
        return d>=monday&&d<nextMonday;
      });
      console.log(`[league] ${memberProfiles.length} membres, ${weekTrainings.length} trainings cette semaine`);
      const players=memberProfiles.map(p=>{
        const pTrains=weekTrainings.filter(t=>t.user_id===p.id);
        const trainPts=pTrains.reduce((s,t)=>s+(effectiveTrainingPts(t)),0);
        const sports=[...new Set(pTrains.map(t=>t.sport).filter(Boolean))];
        return{id:p.id,name:p.name||"Athlète",avatar:p.avatar,trainPts,sessions:pTrains.length,sports,isMe:p.id===user.id};
      }).sort((a,b)=>b.trainPts-a.trainPts).slice(0,20);
      const myWeekTrainings=weekTrainings.filter(t=>t.user_id===user.id);
      const mySessions=myWeekTrainings.map(t=>{
        const dt=t.date?new Date(t.date):null;
        const dlbl=dt?DAY_FR[dt.getDay()]:"";
        const pts=effectiveTrainingPts(t);
        return{sport:t.sport,dist:t.distance,day:dlbl,pts};
      }).sort((a,b)=>b.pts-a.pts);
      const myLeague=LEAGUES.find(l=>l.id===tier)||LEAGUES[0];
      console.log(`[league] mes pts cette semaine: ${players.find(p=>p.isMe)?.trainPts||0}`);
      setLeagueData({players,myLeague,mySessions});
      return;
    }

    let pool=allProfiles;
    if(rankFilter==="amis"){
      const{data:fs}=await supabase.from("friendships").select("friend_id").eq("user_id",user.id).eq("status","accepted");
      const ids=new Set([user.id,...(fs||[]).map(f=>f.friend_id)]);
      pool=allProfiles.filter(p=>ids.has(p.id));
    }
    const ranked=pool.map(p=>{
      const pRes=allResults.filter(r=>r.user_id===p.id&&(discFilter==="All"||DISCIPLINES[r.discipline]?.category===discFilter));
      const pAllRes=allResultsFull.filter(r=>r.user_id===p.id);
      const pSeasonTrainings=seasonTrainings.filter(t=>t.user_id===p.id);
      const racePts=sumBestPts(pRes);
      const trainPts=discFilter==="All"?pSeasonTrainings.reduce((s,t)=>s+(effectiveTrainingPts(t)),0):0;
      const bonusPts=discFilter==="All"?raceBonusPts(pRes,pAllRes)+trainingBonusPts(pSeasonTrainings):0;
      const pts=racePts+trainPts+bonusPts;
      const badges=computeBadges({results:allResultsFull.filter(r=>r.user_id===p.id),trainings:(allTrainings||[]).filter(t=>t.user_id===p.id),profile:p});
      return{...p,pts,badges,_hasDiscRes:pRes.length>0};
    }).filter(p=>discFilter==="All"||p._hasDiscRes).sort((a,b)=>b.pts-a.pts);
    setRankData(ranked);
  };

  const seasonResults=results.filter(r=>rYear(r)===season);
  const seasonTrainings=trainings.filter(t=>new Date(t.date).getFullYear()===season);
  const trainingPts=seasonTrainings.reduce((s,t)=>s+(t.points||0),0);
  const totalPts=sumBestPts(seasonResults)+trainingPts+raceBonusPts(seasonResults,results)+trainingBonusPts(seasonTrainings);
  const bests=Object.values(seasonResults.reduce((acc,r)=>{if(!acc[r.discipline]||r.time<acc[r.discipline].time)acc[r.discipline]=r;return acc;},{}))
    .sort((a,b)=>calcPoints(b.discipline,b.time,b.elevation)-calcPoints(a.discipline,a.time,a.elevation));
  const myBadges=computeBadges({results,profile});
  const myLv=getSeasonLevel(totalPts);
  const DISC_TABS=[{k:"All",l:"All"},{k:"running",l:"🏃 Run"},{k:"triathlon",l:"🏊 Tri"},{k:"trail",l:"⛰️ Trail"},{k:"hyrox",l:"🔥 Hyrox"}];

  const [copied,setCopied]=useState(false);
  const handleShare=()=>{
    const url=window.location.origin;
    if(navigator.share){navigator.share({title:"PaceRank",text:"Rejoins-moi sur PaceRank !",url});}
    else{navigator.clipboard.writeText(url).then(()=>{setCopied(true);setTimeout(()=>setCopied(false),2000);});}
  };

  return (
    <div style={{flex:1,minHeight:0,display:"flex",flexDirection:"column",overflow:"hidden"}}>
      <div style={{padding:"0 16px",flexShrink:0}}>
      {/* Header */}
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",paddingTop:"clamp(10px, 2.5dvh, 20px)",paddingBottom:"clamp(8px, 1.6dvh, 14px)"}}>
        <div>
          <div style={{fontFamily:"'Bebas Neue'",fontSize:"clamp(28px, 8vw, 42px)",letterSpacing:3,lineHeight:1}}>
            <span style={{color:"#F0EDE8"}}>PACE</span><span style={{color:"#E63946"}}>RANK</span>
          </div>
          <div style={{fontSize:"clamp(9px, 2.2vw, 11px)",color:"#F0EDE8",letterSpacing:3,fontFamily:"'Barlow',sans-serif",fontWeight:600,marginTop:4}}>RUN · TRIATHLON · TRAIL · HYROX</div>
        </div>
        <div style={{display:"flex",gap:8,alignItems:"center"}}>
          {profile?.in_app_enabled !== false && (
          <button onClick={()=>setShowNotifs(true)} aria-label="Notifications" style={{position:"relative",background:"rgba(255,255,255,0.07)",border:"none",borderRadius:12,padding:"7px 10px",boxSizing:"border-box",color:"rgba(240,237,232,0.7)",cursor:"pointer",fontSize:11,lineHeight:1.2,fontFamily:"'Barlow',sans-serif",fontWeight:700,textAlign:"center"}}>
            🔔
            {notifCount>0&&<span style={{position:"absolute",top:-4,right:-4,background:"#E63946",borderRadius:"50%",minWidth:16,height:16,padding:"0 4px",display:"inline-flex",alignItems:"center",justifyContent:"center",fontSize:9,color:"#fff",fontFamily:"'Bebas Neue'",fontWeight:700,lineHeight:1,border:"2px solid #0e0e0e",boxSizing:"content-box"}}>{notifCount>9?"9+":notifCount}</span>}
          </button>
          )}
          <button onClick={handleShare} style={{background:"rgba(255,255,255,0.07)",border:"none",borderRadius:12,padding:"7px 10px",minWidth:80,boxSizing:"border-box",color:copied?"#27AE60":"rgba(240,237,232,0.6)",fontFamily:"'Barlow',sans-serif",fontWeight:700,fontSize:11,lineHeight:1.2,cursor:"pointer",textAlign:"center"}}>
            {copied?"✓ Copié !":"🔗 Inviter"}
          </button>
        </div>
      </div>
      </div>

      <PullToRefresh onRefresh={refreshHome} paddingBottom="calc(110px + env(safe-area-inset-bottom))">
      {pushOptedIn===false && !pushBannerDismissed && (
        <div style={{background:"linear-gradient(135deg, rgba(99,102,241,0.14), rgba(99,102,241,0.04))",border:"1px solid rgba(99,102,241,0.35)",borderRadius:14,padding:"12px 14px",marginBottom:12,display:"flex",alignItems:"center",gap:12}}>
          <div style={{fontSize:22,flexShrink:0}}>🔔</div>
          <div style={{flex:1,minWidth:0}}>
            <div style={{fontFamily:"'Bebas Neue'",fontSize:15,letterSpacing:1,color:"#A5B4FC"}}>ACTIVE LES NOTIFS</div>
            <div style={{fontSize:11,color:"rgba(240,237,232,0.6)",fontFamily:"'Barlow',sans-serif",marginTop:2,lineHeight:1.35}}>Reçois un push quand un ami te dépasse ou bat un record.</div>
          </div>
          <button type="button" onClick={onEnablePush} style={{flexShrink:0,background:"#6366F1",border:"none",borderRadius:10,padding:"8px 14px",color:"#fff",fontFamily:"'Barlow',sans-serif",fontWeight:700,fontSize:12,cursor:"pointer",letterSpacing:0.3,touchAction:"manipulation",WebkitTapHighlightColor:"rgba(255,255,255,0.2)"}}>Activer</button>
          <button type="button" onClick={onDismissPushBanner} aria-label="Plus tard" style={{flexShrink:0,background:"transparent",border:"none",color:"rgba(240,237,232,0.4)",fontSize:18,cursor:"pointer",padding:4,lineHeight:1,touchAction:"manipulation"}}>✕</button>
        </div>
      )}
      {overtakenBanner && overtakenBanner.overtakes.length > 0 && (() => {
        const top = overtakenBanner.overtakes[0];
        const fp = overtakenBanner.profiles.find(p => p.id === top.friendId);
        const firstName = (fp?.name || "Ton ami").split(" ")[0];
        const others = overtakenBanner.overtakes.length - 1;
        return (
          <div style={{background:"linear-gradient(135deg, rgba(252,76,2,0.12), rgba(230,57,70,0.04))",border:"1px solid rgba(252,76,2,0.3)",borderRadius:14,padding:"12px 14px",marginBottom:12,display:"flex",alignItems:"center",gap:12}}>
            <Avatar profile={fp} size={38}/>
            <div style={{flex:1,minWidth:0}}>
              <div style={{fontFamily:"'Bebas Neue'",fontSize:14,letterSpacing:0.8,color:"#FC4C02",lineHeight:1.1}}>👀 {firstName.toUpperCase()} VIENT DE TE PASSER {others>0?`(+${others})`:""}</div>
              <div style={{fontSize:11,color:"rgba(240,237,232,0.6)",fontFamily:"'Barlow',sans-serif",marginTop:3,lineHeight:1.3}}>{top.gap} pts d'avance · Reprends ta place 🔥</div>
            </div>
            <button onClick={onOpenOvertakenDetail} style={{flexShrink:0,background:"rgba(252,76,2,0.2)",border:"1px solid rgba(252,76,2,0.4)",borderRadius:10,padding:"7px 12px",color:"#FC4C02",fontFamily:"'Barlow',sans-serif",fontWeight:700,fontSize:11,cursor:"pointer",letterSpacing:0.3}}>Voir</button>
            <button onClick={onDismissOvertakenBanner} aria-label="Fermer" style={{flexShrink:0,background:"transparent",border:"none",color:"rgba(240,237,232,0.4)",fontSize:18,cursor:"pointer",padding:4,lineHeight:1}}>✕</button>
          </div>
        );
      })()}
      {pendingClassif.length>0 && (
        <div style={{background:"linear-gradient(135deg, rgba(230,57,70,0.12), rgba(230,57,70,0.04))",border:"1px solid rgba(230,57,70,0.3)",borderRadius:14,padding:"12px 14px",marginBottom:12,display:"flex",alignItems:"center",gap:12}}>
          <div style={{fontSize:22,flexShrink:0}}>🏁</div>
          <div style={{flex:1,minWidth:0}}>
            <div style={{fontFamily:"'Bebas Neue'",fontSize:15,letterSpacing:1,color:"#E63946"}}>{pendingClassif.length} activité{pendingClassif.length>1?"s":""} à classer</div>
            <div style={{fontSize:11,color:"rgba(240,237,232,0.55)",fontFamily:"'Barlow',sans-serif",marginTop:2,lineHeight:1.35}}>Une activité ressemble à une course officielle. Veux-tu la classer ?</div>
          </div>
          <button onClick={()=>setClassifModalOpen(true)} style={{flexShrink:0,background:"#E63946",border:"none",borderRadius:10,padding:"8px 14px",color:"#fff",fontFamily:"'Barlow',sans-serif",fontWeight:700,fontSize:12,cursor:"pointer",letterSpacing:0.3}}>Classer</button>
        </div>
      )}
      {classifToast && (
        <div style={{background:"rgba(74,222,128,0.12)",border:"1px solid rgba(74,222,128,0.35)",borderRadius:12,padding:"9px 12px",marginBottom:12,fontSize:13,color:"#4ADE80",fontFamily:"'Barlow',sans-serif",fontWeight:600}}>
          {classifToast}
        </div>
      )}
      {/* My card */}
      <div onClick={onOpenProfile} style={{background:`${myLv.color}12`,border:`1px solid ${myLv.color}44`,borderRadius:18,padding:"16px",marginBottom:16,cursor:"pointer"}}>
        <div style={{display:"flex",alignItems:"center",gap:12,marginBottom:bests.length>0?12:0}}>
          <div style={{position:"relative"}}>
            <Avatar profile={profile} size={52} highlight={myLv.color}/>
            {myBadges.length>0&&<div style={{position:"absolute",bottom:-2,right:-2,background:myLv.color,borderRadius:"50%",width:18,height:18,display:"flex",alignItems:"center",justifyContent:"center",fontSize:9,color:"#fff",fontFamily:"'Bebas Neue'"}}>{myBadges.length}</div>}
          </div>
          <div style={{flex:1,minWidth:0}}>
            <div style={{fontFamily:"'Bebas Neue'",fontSize:20,color:"#F0EDE8",letterSpacing:1,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{(profile?.name||"MON PROFIL").toUpperCase()}</div>
            <div style={{display:"flex",gap:5,flexWrap:"wrap",marginTop:4}}>
              {myBadges.slice(0,4).map(b=><span key={b.id} style={{fontSize:15}}>{b.emoji}</span>)}
              {myBadges.length>4&&<span style={{fontSize:10,color:"#555",fontFamily:"'Barlow',sans-serif",alignSelf:"center"}}>+{myBadges.length-4}</span>}
            </div>
          </div>
          <div style={{textAlign:"right",flexShrink:0}}>
            <div style={{fontFamily:"'Bebas Neue'",fontSize:34,color:getSeasonLevel(totalPts).color,letterSpacing:1,lineHeight:1}}>{totalPts}</div>
            <div style={{fontSize:9,color:"rgba(240,237,232,0.5)",letterSpacing:1.5,textTransform:"uppercase",fontFamily:"'Barlow',sans-serif"}}>pts saison</div>
            <div style={{fontSize:8,color:"rgba(240,237,232,0.35)",fontFamily:"'Barlow',sans-serif"}}>t:{trainings.length} pts:{trainingPts}</div>
          </div>
        </div>
        {bests.length>0&&(
          <div style={{borderTop:"1px solid rgba(255,255,255,0.07)",paddingTop:12,display:"grid",gridTemplateColumns:"1fr 1fr",gap:"10px 16px"}}>
            {bests.map((r,i)=>{const pts=calcPoints(r.discipline,r.time,r.elevation);const lv=getLevel(pts);return(
              <div key={i}>
                <div style={{fontSize:10,color:"rgba(240,237,232,0.35)",fontFamily:"'Barlow',sans-serif",marginBottom:2}}>{DISCIPLINES[r.discipline]?.icon} {DISCIPLINES[r.discipline]?.label}</div>
                <div style={{fontFamily:"'Bebas Neue'",fontSize:18,color:"#F0EDE8",letterSpacing:1}}>{fmtTime(r.time)}</div>
                <div style={{fontSize:11,color:lv.color,fontFamily:"'Barlow',sans-serif",fontWeight:700}}>{pts} pts</div>
              </div>
            );})}
          </div>
        )}
      </div>

      {/* Season */}
      <div ref={seasonsRef} style={{display:"flex",alignItems:"center",gap:8,marginBottom:16,overflowX:"auto",scrollbarWidth:"none",WebkitOverflowScrolling:"touch",paddingBottom:4}}>
        {seasons.map(y=>(
          <button key={y} onClick={()=>setSeason(y)} style={{flex:"0 0 calc((100% - 24px) / 4)",padding:"7px 0",borderRadius:20,border:"none",cursor:"pointer",background:season===y?"#E63946":"rgba(255,255,255,0.06)",color:season===y?"#fff":"rgba(240,237,232,0.4)",fontFamily:"'Bebas Neue'",fontSize:18,letterSpacing:1,display:"flex",alignItems:"center",justifyContent:"center",gap:6}}>
            {y}
            {y===CY&&<span style={{width:6,height:6,borderRadius:"50%",background:season===y?"rgba(255,255,255,0.9)":"#27AE60",flexShrink:0}}/>}
          </button>
        ))}
      </div>

      {/* Rank toggle */}
      <div style={{display:"flex",gap:6,marginBottom:12}}>
        {[["amis","👥 Amis"],["general","🌍 Général"],["ligue","🏆 Ligue"]].map(([k,l])=>(
          <button key={k} onClick={()=>setRankFilter(k)} style={{flex:1,padding:"9px 0",borderRadius:12,border:"none",cursor:"pointer",background:rankFilter===k?"rgba(255,255,255,0.1)":"rgba(255,255,255,0.04)",color:rankFilter===k?"#F0EDE8":"rgba(240,237,232,0.4)",fontFamily:"'Barlow',sans-serif",fontWeight:700,fontSize:12}}>{l}</button>
        ))}
      </div>

      {rankFilter!=="ligue"&&(
        <div style={{display:"flex",gap:6,marginBottom:14,overflowX:"auto",scrollbarWidth:"none"}}>
          {DISC_TABS.map(({k,l})=>(
            <button key={k} onClick={()=>setDiscFilter(k)} style={{flexShrink:0,padding:"5px 12px",borderRadius:20,border:"none",cursor:"pointer",background:discFilter===k?"#E63946":"rgba(255,255,255,0.06)",color:discFilter===k?"#fff":"rgba(240,237,232,0.5)",fontFamily:"'Barlow',sans-serif",fontWeight:600,fontSize:12}}>{l}</button>
          ))}
        </div>
      )}

      {rankFilter==="ligue"
        ?<LeagueView players={leagueData.players} myLeague={leagueData.myLeague} mySessions={leagueData.mySessions} onAddTraining={onAddTraining} onOpenFriend={p=>setOpenFriend(p)}/>
        :rankData.length===0
          ?<div style={{textAlign:"center",color:"#444",padding:"30px 0",fontFamily:"'Barlow',sans-serif",fontSize:13}}>{rankFilter==="amis"?"Ajoute des amis pour voir le classement !":"Aucun résultat pour cette saison"}</div>
          :rankData.map((p,i)=>{
            const lv=getSeasonLevel(p.pts);
            const inCommunity=rankFilter==="general"&&p.id!==profile?.id;
            const isFriend=friendIds.has(p.id);
            const rowActions=!inCommunity
              ?null
              :isFriend
                ?[{icon:"✕",bg:"rgba(255,255,255,0.12)",color:"rgba(240,237,232,0.75)",onClick:()=>handleCancelFriend(p.id)}]
                :[{icon:"+",bg:"rgba(230,57,70,0.25)",color:"#E63946",onClick:()=>handleAddFriend(p.id)}];
            const isMe=p.id===profile?.id;
            const row=(
              <div onClick={()=>setOpenFriend(p)} style={{display:"flex",alignItems:"center",gap:10,padding:"11px 14px",background:`${lv.color}0d`,border:`1px solid ${lv.color}${isMe?"66":"33"}`,borderRadius:14,cursor:"pointer"}}>
                <div style={{fontFamily:"'Bebas Neue'",fontSize:18,color:i<3?"#FFD700":"#444",width:22,textAlign:"center",flexShrink:0}}>{i===0?"🥇":i===1?"🥈":i===2?"🥉":""}</div>
                <Avatar profile={p} size={36}/>
                <div style={{flex:1,minWidth:0}}>
                  <div style={{fontFamily:"'Bebas Neue'",fontSize:15,color:"#F0EDE8",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{shortName(p.name)}</div>
                  <div style={{display:"flex",flexWrap:"wrap",gap:3,marginTop:2,alignItems:"center"}}>{p.badges.slice(0,6).map(b=><span key={b.id} style={{fontSize:11}}>{b.emoji}</span>)}{p.badges.length>6&&<span style={{fontSize:9,color:"rgba(240,237,232,0.45)",fontFamily:"'Barlow',sans-serif",fontWeight:700,marginLeft:1}}>+{p.badges.length-6}</span>}</div>
                </div>
                <div style={{textAlign:"right",flexShrink:0}}>
                  <div style={{fontSize:14,color:"#F0EDE8",fontFamily:"'Barlow',sans-serif",fontWeight:700,letterSpacing:0.5}}>{i+1}/{rankData.length}</div>
                  <div style={{fontFamily:"'Bebas Neue'",fontSize:22,color:lv.color,letterSpacing:1}}>{p.pts}</div>
                </div>
              </div>
            );
            return rowActions
              ?<SwipeRow key={p.id} radius={14} mb={8} actions={rowActions}>{row}</SwipeRow>
              :<div key={p.id} style={{marginBottom:8}}>{row}</div>;
          })}
      </PullToRefresh>
      <button onClick={()=>setShowPicker(true)} style={{position:"fixed",bottom:"clamp(74px, 11dvh, 90px)",right:"clamp(14px, 4vw, 20px)",zIndex:99,width:"clamp(44px, 7vw, 56px)",height:"clamp(44px, 7vw, 56px)",borderRadius:"50%",background:"#E63946",border:"none",color:"#fff",fontSize:"clamp(22px, 5vw, 28px)",cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",boxShadow:"0 4px 20px rgba(230,57,70,0.5)"}}>+</button>
      {showPicker&&<AddPickerModal onPickTraining={onAddTraining} onPickRace={onAddRace} onClose={()=>setShowPicker(false)}/>}
      {openFriend&&<FriendProfileModal friend={openFriend} myId={profile?.id} onClose={()=>setOpenFriend(null)}/>}
      {showNotifs&&<NotificationsModal onClose={()=>setShowNotifs(false)} onNotifsChange={onNotifsChange} inAppEnabled={profile?.in_app_enabled !== false} onNavigateLeague={onOpenLeague} onNavigateProfile={onOpenProfile}/>}
      {classifModalOpen && pendingClassif.length>0 && (
        <RaceClassificationModal
          pending={pendingClassif}
          userId={userId}
          onClose={()=>{ setClassifModalOpen(false); loadPendingClassif(); }}
          onDone={(count)=>{
            setClassifModalOpen(false);
            loadPendingClassif();
            if (count>0) {
              setClassifToast(`✅ ${count} course${count>1?"s":""} officielle${count>1?"s":""} ajoutée${count>1?"s":""}`);
              setTimeout(()=>setClassifToast(""), 4000);
            }
          }}
        />
      )}
    </div>
  );
}

// ── RANKING TAB ───────────────────────────────────────────────────────────────
function RankingTab({myProfile}){
  const [filter,setFilter]=useState("discipline");
  const [season,setSeason]=useState(CY);
  const seasonsRef=useRef(null);
  const [discFilter,setDisc]=useState("marathon");
  const [players,setPlayers]=useState([]);
  const [loading,setLoading]=useState(true);
  const [groups,setGroups]=useState([]);
  const [selGroup,setSelGroup]=useState(null);
  const [openFriend,setOpenFriend]=useState(null);
  const SEASONS=Array.from({length:6},(_,i)=>CY-5+i);

  useEffect(()=>{
    if(filter==="discipline")return;
    setTimeout(()=>{if(seasonsRef.current)seasonsRef.current.scrollLeft=seasonsRef.current.scrollWidth;},50);
  },[filter]);
  useEffect(()=>{loadPlayers();},[filter,discFilter,selGroup,season]);
  useEffect(()=>{loadMyGroups();},[]);

  const loadMyGroups=async()=>{
    const{data:{user}}=await supabase.auth.getUser();
    const{data}=await supabase.from("group_members").select("*, group:groups(*)").eq("user_id",user.id);
    setGroups(data?.map(d=>d.group)||[]);
  };

  const loadPlayers=async()=>{
    setLoading(true);
    if(filter==="group"&&!selGroup){setPlayers([]);setLoading(false);return;}
    const{data:profilesRaw}=await supabase.from("profiles").select("*");
    const profiles=(profilesRaw||[]).filter(p=>!p.ranking_hidden);
    const{data:results}=await supabase.from("results").select("*");
    const{data:trainings}=await supabase.from("trainings").select("user_id,date,points");
    if(!profiles||!results){setLoading(false);return;}
    const seasonResults=results.filter(r=>rYear(r)===season);
    const seasonTrainings=(trainings||[]).filter(t=>new Date(t.date).getFullYear()===season);
    let pool=profiles;
    if(filter==="group"&&selGroup){const{data:members}=await supabase.from("group_members").select("user_id").eq("group_id",selGroup);const ids=new Set(members?.map(m=>m.user_id)||[]);pool=profiles.filter(p=>ids.has(p.id));}
    let display=pool.map(p=>{
      const pRes=seasonResults.filter(r=>r.user_id===p.id);
      const pAllRes=results.filter(r=>r.user_id===p.id);
      const pTrainings=seasonTrainings.filter(t=>t.user_id===p.id);
      let bestTime=null,racePts;
      if(filter==="discipline"){
        const b=pAllRes.filter(r=>r.discipline===discFilter).sort((a,b)=>a.time-b.time)[0];
        if(b){bestTime=b.time;racePts=calcPoints(discFilter,b.time,b.elevation);}else{racePts=0;}
      }else{racePts=sumBestPts(pRes);}
      const tPts=filter==="discipline"?0:pTrainings.reduce((s,t)=>s+(t.points||0),0);
      const bonusPts=filter==="discipline"?0:raceBonusPts(pRes,pAllRes)+trainingBonusPts(pTrainings);
      const badges=computeBadges({results:pRes,trainings:pTrainings,profile:p});
      return{...p,pts:racePts+tPts+bonusPts,bestTime,badges};
    }).sort((a,b)=>b.pts-a.pts);
    const myAgeCat=getAgeCat(myProfile?.birth_year);
    if(filter==="age_cat") display=display.filter(p=>getAgeCat(p.birth_year)===myAgeCat);
    if(filter==="gender")  display=display.filter(p=>p.gender===myProfile?.gender);
    if(filter==="city")    display=display.filter(p=>p.city&&myProfile?.city&&p.city.trim().toLowerCase()===myProfile.city.trim().toLowerCase());
    setPlayers(display);setLoading(false);
  };

  const FILTERS=[{k:"discipline",l:"🏅 Discipline"},{k:"group",l:"👥 Groupe"},{k:"age_cat",l:"📅 Catégorie"},{k:"gender",l:"⚧ Sexe"},{k:"city",l:"🏙️ Ville"}];

  return (
    <div style={{flex:1,minHeight:0,display:"flex",flexDirection:"column",overflow:"hidden"}}>
      <div style={{padding:"0 16px",flexShrink:0}}>
        <div style={{fontFamily:"'Bebas Neue'",fontSize:28,letterSpacing:2,color:"#F0EDE8",paddingTop:20,paddingBottom:12}}>Rank</div>
      </div>
      <PullToRefresh onRefresh={async()=>{await loadPlayers();await loadMyGroups();}} paddingBottom="calc(100px + env(safe-area-inset-bottom))">
      <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:6,marginBottom:12}}>
        {FILTERS.map(f=><button key={f.k} onClick={()=>setFilter(f.k)} style={{padding:"7px 4px",borderRadius:20,border:"none",cursor:"pointer",background:filter===f.k?"#E63946":"rgba(255,255,255,0.06)",color:filter===f.k?"#fff":"rgba(240,237,232,0.5)",fontFamily:"'Barlow',sans-serif",fontWeight:600,fontSize:12,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{f.l}</button>)}
      </div>
      {/* Season selector — caché en mode discipline (all-time) */}
      {filter!=="discipline"&&(
        <div ref={seasonsRef} style={{display:"flex",alignItems:"center",gap:8,marginBottom:16,overflowX:"auto",scrollbarWidth:"none",WebkitOverflowScrolling:"touch",paddingBottom:4}}>
          {SEASONS.map(y=>(
            <button key={y} onClick={()=>setSeason(y)} style={{flex:"0 0 calc((100% - 24px) / 4)",padding:"7px 0",borderRadius:20,border:"none",cursor:"pointer",background:season===y?"#E63946":"rgba(255,255,255,0.06)",color:season===y?"#fff":"rgba(240,237,232,0.4)",fontFamily:"'Bebas Neue'",fontSize:18,letterSpacing:1,display:"flex",alignItems:"center",justifyContent:"center",gap:6}}>
              {y}
              {y===CY&&<span style={{width:6,height:6,borderRadius:"50%",background:season===y?"rgba(255,255,255,0.9)":"#27AE60",flexShrink:0}}/>}
            </button>
          ))}
        </div>
      )}
      {filter==="discipline"&&<Sel value={discFilter} onChange={setDisc}>{Object.entries(DISCIPLINES).map(([k,v])=><option key={k} value={k}>{v.icon} {v.label}</option>)}</Sel>}
      {filter==="group"&&selGroup&&(
        <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:12}}>
          <button onClick={()=>setSelGroup(null)} style={{padding:"6px 12px",borderRadius:10,background:"rgba(255,255,255,0.06)",color:"rgba(240,237,232,0.7)",border:"none",cursor:"pointer",fontFamily:"'Barlow',sans-serif",fontWeight:700,fontSize:12}}>← Groupes</button>
          <div style={{fontFamily:"'Bebas Neue'",fontSize:18,color:"#F0EDE8",letterSpacing:1,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>🏠 {groups.find(g=>g.id===selGroup)?.name||""}</div>
        </div>
      )}
      {filter==="group"&&!selGroup?(
        groups.length===0?
          <div style={{textAlign:"center",color:"#444",padding:"40px 0",fontFamily:"'Barlow',sans-serif"}}>Aucun groupe — rejoins-en un dans Social</div>
        :groups.map(g=>(
          <button key={g.id} onClick={()=>setSelGroup(g.id)} style={{display:"flex",alignItems:"center",gap:12,width:"100%",padding:"13px 14px",background:"rgba(255,255,255,0.04)",borderRadius:14,marginBottom:8,border:"1px solid rgba(255,255,255,0.06)",cursor:"pointer",textAlign:"left"}}>
            <div style={{width:40,height:40,borderRadius:12,background:"rgba(230,57,70,0.12)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:20,flexShrink:0}}>🏠</div>
            <div style={{flex:1,minWidth:0}}>
              <div style={{fontFamily:"'Bebas Neue'",fontSize:18,color:"#F0EDE8",letterSpacing:1,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{g.name}</div>
              <div style={{fontSize:11,color:"rgba(240,237,232,0.35)",fontFamily:"'Barlow',sans-serif",letterSpacing:1.5}}>Code : <span style={{color:"#E63946",fontWeight:700}}>{g.code}</span></div>
            </div>
            <div style={{color:"rgba(240,237,232,0.4)",fontSize:18,flexShrink:0}}>›</div>
          </button>
        ))
      ):loading?<div style={{textAlign:"center",color:"#444",padding:"40px 0",fontFamily:"'Barlow',sans-serif"}}>Chargement…</div>
      :players.length===0?<div style={{textAlign:"center",color:"#444",padding:"40px 0",fontFamily:"'Barlow',sans-serif"}}>Aucun résultat</div>
      :players.map((p,i)=>{const lv=getSeasonLevel(p.pts);const isMe=p.id===myProfile?.id;return(
        <div key={p.id} onClick={()=>setOpenFriend(p)} style={{display:"flex",alignItems:"center",gap:10,padding:"11px 14px",borderRadius:14,marginBottom:8,background:`${lv.color}0d`,border:`1px solid ${lv.color}${isMe?"66":"33"}`,cursor:"pointer"}}>
          <div style={{fontFamily:"'Bebas Neue'",fontSize:18,color:i<3?"#FFD700":"#444",width:22,textAlign:"center",flexShrink:0}}>{i===0?"🥇":i===1?"🥈":i===2?"🥉":""}</div>
          <Avatar profile={p} size={36}/>
          <div style={{flex:1,minWidth:0}}>
            <div style={{fontFamily:"'Bebas Neue'",fontSize:15,color:"#F0EDE8",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{shortName(p.name)}</div>
            {filter==="discipline"&&p.bestTime
              ?<div style={{fontFamily:"'Bebas Neue'",fontSize:13,color:"rgba(240,237,232,0.7)",letterSpacing:0.5,marginTop:1}}>{fmtTime(p.bestTime)}</div>
              :<div style={{display:"flex",flexWrap:"wrap",gap:3,marginTop:2,alignItems:"center"}}>{(p.badges||[]).slice(0,6).map(b=><span key={b.id} style={{fontSize:11}}>{b.emoji}</span>)}{(p.badges||[]).length>6&&<span style={{fontSize:9,color:"rgba(240,237,232,0.45)",fontFamily:"'Barlow',sans-serif",fontWeight:700,marginLeft:1}}>+{(p.badges||[]).length-6}</span>}</div>
            }
          </div>
          <div style={{textAlign:"right",flexShrink:0}}>
            <div style={{fontSize:14,color:"#F0EDE8",fontFamily:"'Barlow',sans-serif",fontWeight:700,letterSpacing:0.5}}>{i+1}/{players.length}</div>
            <div style={{fontFamily:"'Bebas Neue'",fontSize:22,color:lv.color,letterSpacing:1}}>{p.pts}</div>
          </div>
        </div>
      );})}
      </PullToRefresh>
      {openFriend&&<FriendProfileModal friend={openFriend} myId={myProfile?.id} onClose={()=>setOpenFriend(null)}/>}
    </div>
  );
}

// ── TRAINING TAB ──────────────────────────────────────────────────────────────
function TrainingTab({userId, onActivityChange}){
  const [trainings,setTrainings]=useState([]);
  const [selSport,setSelSport]=useState("All");
  const [selYear,setSelYear]=useState(CY);
  const [editTraining,setEditTraining]=useState(null);
  const [convertTraining,setConvertTraining]=useState(null);
  const [planView,setPlanView]=useState(null);
  const [plan,setPlan]=useState(null);

  useEffect(()=>{loadTrainings();},[]);
  useEffect(()=>{
    if(!userId)return;
    try{const raw=localStorage.getItem(`trainingPlan_${userId}`);if(raw)setPlan(JSON.parse(raw));}catch{}
  },[userId]);

  const loadTrainings=async()=>{
    const{data}=await supabase.from("trainings").select("*").eq("user_id",userId).order("date",{ascending:false});
    setTrainings(data||[]);
  };
  const deleteTraining=async id=>{await supabase.from("trainings").delete().eq("id",id);loadTrainings();};

  const filtered=trainings.filter(t=>!t.is_official_race&&(selSport==="All"||t.sport===selSport)&&new Date(t.date).getFullYear()===selYear);
  const monthlyDist=MONTHS_FR.map((label,i)=>({label,value:Math.round(filtered.filter(t=>new Date(t.date).getMonth()===i).reduce((s,t)=>s+(t.distance||0),0))}));
  const totalDist=filtered.reduce((s,t)=>s+(t.distance||0),0);
  const totalPts=filtered.reduce((s,t)=>s+(effectiveTrainingPts(t)),0);
  const weeklyRunKm=computeWeeklyVolumeKm(trainings.filter(t=>t.sport==="Run"&&!t.is_official_race));

  return (
    <div style={{flex:1,minHeight:0,display:"flex",flexDirection:"column",boxSizing:"border-box"}}>
      <div style={{flexShrink:0,padding:"0 16px"}}>
        <div style={{paddingTop:20,paddingBottom:10}}>
          <div style={{fontFamily:"'Bebas Neue'",fontSize:28,letterSpacing:2,color:"#F0EDE8"}}>Training</div>
        </div>
      </div>
      <PullToRefresh onRefresh={loadTrainings} paddingBottom="calc(100px + env(safe-area-inset-bottom))">
      <div style={{display:"flex",justifyContent:"flex-end",marginBottom:12}}>
        <button onClick={()=>setPlanView(plan?"detail":"setup")} style={{background:"#F0EDE8",border:"none",borderRadius:10,padding:"9px 14px",color:"#1a1a1a",fontFamily:"'Barlow',sans-serif",fontWeight:700,fontSize:12,cursor:"pointer",letterSpacing:0.5}}>📋 {plan?"Mon plan d'entraînement":"Générer plan d'entraînement"}</button>
      </div>
      {plan&&(()=>{
        const today=new Date();today.setHours(0,0,0,0);
        const target=plan.date?new Date(plan.date):null;
        const daysLeft=target?Math.ceil((target-today)/86400000):null;
        const discLabel=DISCIPLINES[plan.discipline]?.label||plan.discipline;
        return(
          <div onClick={()=>setPlanView("detail")} style={{marginBottom:12,padding:"10px 14px",background:"rgba(230,57,70,0.08)",border:"1px solid rgba(230,57,70,0.25)",borderRadius:12,cursor:"pointer",display:"flex",alignItems:"center",gap:10}}>
            <div style={{fontSize:18}}>🎯</div>
            <div style={{flex:1,minWidth:0}}>
              <div style={{fontFamily:"'Bebas Neue'",fontSize:15,color:"#F0EDE8",letterSpacing:1}}>{discLabel}{plan.targetTime?` · ${plan.targetTime}`:""}</div>
              <div style={{fontSize:11,color:"rgba(240,237,232,0.55)",fontFamily:"'Barlow',sans-serif",marginTop:2}}>{daysLeft!==null?(daysLeft>0?`Dans ${daysLeft} j`:daysLeft===0?"Aujourd'hui":`Il y a ${-daysLeft} j`):""}{plan.sessionsPerWeek?` · ${plan.sessionsPerWeek} séances/sem`:""}{plan.level?` · ${plan.level}`:""}</div>
            </div>
            <div style={{color:"rgba(240,237,232,0.4)",fontSize:18}}>›</div>
          </div>
        );
      })()}
      <div style={{display:"flex",gap:5,overflowX:"auto",paddingBottom:8,marginBottom:12,scrollbarWidth:"none"}}>
        {TRAINING_SPORTS.map(s=><button key={s} onClick={()=>setSelSport(s)} style={{flexShrink:0,padding:"6px 12px",borderRadius:20,border:"none",cursor:"pointer",background:selSport===s?"#E63946":"rgba(255,255,255,0.06)",color:selSport===s?"#fff":"rgba(240,237,232,0.5)",fontFamily:"'Barlow',sans-serif",fontWeight:600,fontSize:12}}>{s}</button>)}
      </div>
      <div style={{display:"flex",gap:6,marginBottom:14}}>
        {[CY-1,CY].map(y=><button key={y} onClick={()=>setSelYear(y)} style={{flex:1,padding:"7px 0",borderRadius:10,border:"none",cursor:"pointer",background:selYear===y?"rgba(230,57,70,0.15)":"rgba(255,255,255,0.04)",color:selYear===y?"#E63946":"rgba(240,237,232,0.4)",fontFamily:"'Barlow',sans-serif",fontWeight:700,fontSize:14}}>{y}</button>)}
      </div>
      <div style={{display:"flex",gap:8,marginBottom:14,flexWrap:"wrap"}}>
        {[
          {l:"Distance",v:`${totalDist.toFixed(1)} km`},
          {l:"Points training",v:totalPts},
          {l:"Run / sem (28j)",v:`${weeklyRunKm.toFixed(1)} km`},
        ].map(({l,v})=>(
          <div key={l} style={{flex:1,minWidth:80,padding:"10px",background:"rgba(255,255,255,0.03)",borderRadius:12,border:"1px solid rgba(255,255,255,0.06)",textAlign:"center"}}>
            <div style={{fontFamily:"'Bebas Neue'",fontSize:20,color:"#F0EDE8",letterSpacing:1}}>{v}</div>
            <div style={{fontSize:9,color:"rgba(240,237,232,0.3)",letterSpacing:1,textTransform:"uppercase",fontFamily:"'Barlow',sans-serif",marginTop:2}}>{l}</div>
          </div>
        ))}
      </div>
      <div style={{background:"rgba(255,255,255,0.03)",borderRadius:14,padding:"14px",marginBottom:14,border:"1px solid rgba(255,255,255,0.06)"}}>
        <BarChart data={monthlyDist} color="#E63946" unit="km" title={`Distance par mois (${selYear})`}/>
      </div>
      <div style={{fontSize:11,color:"rgba(240,237,232,0.35)",letterSpacing:1.5,textTransform:"uppercase",fontFamily:"'Barlow',sans-serif",marginBottom:10}}>Sessions récentes</div>
      {filtered.slice(0,15).map((t,i)=>(
        <SwipeRow key={t.id||i} onDelete={()=>deleteTraining(t.id)} mb={0}>
          <ActivityCard myId={userId} activityType="training" activityId={t.id}>
            <div onClick={()=>setEditTraining(t)} style={{display:"flex",justifyContent:"space-between",alignItems:"center",cursor:"pointer",gap:10}}>
              <div style={{minWidth:0,flex:1}}>
                <div style={{display:"flex",alignItems:"center",gap:6}}>
                  <div style={{fontFamily:"'Barlow',sans-serif",fontWeight:600,fontSize:13,color:"#F0EDE8",whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis",minWidth:0,flex:1}}>{t.title?.trim()||`${t.sport} · ${t.distance} km`}</div>
                  <ActivitySourceBadge source={t.source}/>
                </div>
                <div style={{fontSize:11,color:"rgba(240,237,232,0.35)",marginTop:2,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{t.title?.trim()?`${t.sport} · ${t.distance} km · `:""}{t.date?.split("-").reverse().join("-")}{t.duration?` · ${fmtDuration(t.duration)}`:""}</div>
              </div>
              <div style={{fontFamily:"'Bebas Neue'",fontSize:15,color:"#E63946",flexShrink:0}}>+{effectiveTrainingPts(t)}pts</div>
            </div>
          </ActivityCard>
        </SwipeRow>
      ))}
      {filtered.length===0&&<div style={{textAlign:"center",color:"#444",padding:"30px 0",fontFamily:"'Barlow',sans-serif"}}>Aucune session !</div>}
      {filtered.some(t=>t.source==="strava")&&<PoweredByStrava/>}
      </PullToRefresh>
      {editTraining&&<TrainingModal existing={editTraining} userId={userId} onSave={()=>{setEditTraining(null);loadTrainings();onActivityChange?.();}} onClose={()=>setEditTraining(null)} onConvertToRace={(t)=>setConvertTraining(t)}/>}
      {convertTraining&&<RaceClassificationModal pending={[convertTraining]} userId={userId} singleMode={true} onClose={()=>{setConvertTraining(null);loadTrainings();onActivityChange?.();}} onDone={()=>{setConvertTraining(null);loadTrainings();onActivityChange?.();}}/>}
      {planView==="detail"&&plan&&<TrainingPlanDetailModal plan={plan} onEdit={()=>setPlanView("setup")} onClose={()=>setPlanView(null)}/>}
      {planView==="setup"&&<TrainingPlanModal userId={userId} existing={plan} onSave={p=>{setPlan(p);setPlanView("detail");}} onDelete={()=>{setPlan(null);setPlanView(null);}} onClose={()=>setPlanView(plan?"detail":null)}/>}
    </div>
  );
}

// ── TRAINING PLAN CALENDAR HELPERS ────────────────────────────────────────────
const SESSION_STYLES = {
  rest:     {label:"Repos",             icon:"😴",  color:"rgba(240,237,232,0.45)",bg:"rgba(255,255,255,0.02)"},
  easy:     {label:"Endurance facile",  icon:"🌿",  color:"#27AE60", bg:"rgba(39,174,96,0.08)"},
  tempo:    {label:"Tempo / Seuil",     icon:"🎯",  color:"#FF6B35", bg:"rgba(255,107,53,0.08)"},
  interval: {label:"Fractionné / VMA",  icon:"⚡",  color:"#E63946", bg:"rgba(230,57,70,0.08)"},
  long:     {label:"Sortie longue",     icon:"🏔️", color:"#9B59B6", bg:"rgba(155,89,182,0.08)"},
  recovery: {label:"Récupération",      icon:"💧",  color:"#3498DB", bg:"rgba(52,152,219,0.08)"},
  swim:     {label:"Natation",          icon:"🏊",  color:"#3498DB", bg:"rgba(52,152,219,0.08)"},
  bike:     {label:"Vélo",              icon:"🚴",  color:"#27AE60", bg:"rgba(39,174,96,0.08)"},
  run:      {label:"Course à pied",     icon:"🏃",  color:"#E63946", bg:"rgba(230,57,70,0.08)"},
  brick:    {label:"Brick (vélo+run)",  icon:"🔗",  color:"#9B59B6", bg:"rgba(155,89,182,0.08)"},
  race:     {label:"Jour J — course",   icon:"🏁",  color:"#FFD700", bg:"rgba(255,215,0,0.12)"},
};
const SESSION_DETAIL = {
  rest:"Récupération complète — pas d'activité",
  easy:"30–60 min · allure confortable",
  tempo:"20–30 min · allure seuil soutenue",
  interval:"VMA — ex. 8×400 m ou 5×1000 m",
  long:"1 h–2 h 30 · endurance selon l'objectif",
  recovery:"20–40 min · très relâché",
  swim:"30–60 min · technique + séries",
  bike:"1 h–2 h · endurance ou côtes",
  run:"40–60 min · footing ou allure",
  brick:"Vélo 1 h puis course 15–25 min",
  race:"Objectif ! Profite et donne tout.",
};
const PHASE_INFO = {
  base:  {label:"Base · Endurance",  color:"#27AE60"},
  build: {label:"Construction",      color:"#4A90D9"},
  peak:  {label:"Pic spécifique",    color:"#FF6B35"},
  taper: {label:"Affûtage",          color:"#9B59B6"},
  race:  {label:"Semaine course",    color:"#FFD700"},
};
function phaseForWeek(weekIdx,totalWeeks){
  if(!totalWeeks||totalWeeks<=1)return "race";
  const wn=weekIdx+1;
  if(wn===totalWeeks)return "race";
  const p=wn/totalWeeks;
  if(p>=0.9)return "taper";
  if(p>=0.7)return "peak";
  if(p>=0.4)return "build";
  return "base";
}
function runPhase(tpl,phase){
  if(phase==="race")return ["rest","easy","rest","rest","easy","rest","race"];
  if(phase==="base")return tpl.map(t=>t==="interval"?"easy":t);
  if(phase==="taper")return tpl.map(t=>(t==="interval"||t==="long")?"easy":t);
  return tpl;
}
function triPhase(tpl,phase){
  if(phase==="race")return ["rest","swim","rest","easy","easy","rest","race"];
  if(phase==="taper")return tpl.map(t=>t==="brick"?"easy":t);
  return tpl;
}
const RUN_TEMPLATE = {
  2:['rest','easy','rest','rest','rest','rest','long'],
  3:['rest','interval','rest','tempo','rest','rest','long'],
  4:['rest','interval','rest','tempo','rest','easy','long'],
  5:['easy','interval','rest','tempo','rest','easy','long'],
  6:['easy','interval','easy','tempo','rest','easy','long'],
  7:['easy','interval','recovery','tempo','easy','easy','long'],
};
const TRI_TEMPLATE = {
  2:['rest','bike','rest','run','rest','rest','swim'],
  3:['rest','bike','rest','run','rest','swim','rest'],
  4:['rest','bike','swim','run','rest','rest','brick'],
  5:['swim','bike','rest','run','rest','swim','brick'],
  6:['swim','bike','run','swim','rest','bike','brick'],
  7:['swim','bike','run','swim','recovery','bike','brick'],
};

// ── TRAINING PLAN DETAIL MODAL ────────────────────────────────────────────────
function TrainingPlanDetailModal({plan,onEdit,onClose}){
  const today=new Date();today.setHours(0,0,0,0);
  const tgt=plan.date?new Date(plan.date):null;
  if(tgt)tgt.setHours(0,0,0,0);
  const daysLeft=tgt?Math.ceil((tgt-today)/86400000):null;
  const weeksLeft=daysLeft!=null?Math.max(0,Math.ceil(daysLeft/7)):null;
  const disc=DISCIPLINES[plan.discipline];
  const discLabel=disc?.label||plan.discipline;
  const tgtStr=tgt&&!isNaN(tgt)?tgt.toLocaleDateString("fr-FR",{weekday:"long",day:"numeric",month:"long",year:"numeric"}):"";
  const weekStart=d=>{const x=new Date(d);x.setHours(0,0,0,0);const dow=x.getDay()||7;x.setDate(x.getDate()-(dow-1));return x;};
  const currentMonday=weekStart(today);
  const raceMonday=tgt?weekStart(tgt):null;
  const totalWeeks=raceMonday?Math.max(1,Math.round((raceMonday-currentMonday)/(7*86400000))+1):0;
  const [selWeek,setSelWeek]=useState(0);
  const clampedWeek=Math.max(0,Math.min(selWeek,totalWeeks>0?totalWeeks-1:0));
  const selMonday=new Date(currentMonday);selMonday.setDate(currentMonday.getDate()+clampedWeek*7);
  const selSunday=new Date(selMonday);selSunday.setDate(selMonday.getDate()+6);
  const weekScrollRef=useRef(null);
  useEffect(()=>{if(weekScrollRef.current)weekScrollRef.current.scrollLeft=clampedWeek*52;},[clampedWeek]);
  return (
    <Modal onClose={onClose}>
      <div style={{fontFamily:"'Bebas Neue'",fontSize:22,color:"#F0EDE8",letterSpacing:1,marginBottom:12}}>Plan d'entraînement</div>
      <div style={{background:"rgba(230,57,70,0.08)",border:"1px solid rgba(230,57,70,0.25)",borderRadius:14,padding:"20px 16px",marginBottom:16,textAlign:"center"}}>
        <div style={{fontSize:44,lineHeight:1}}>{disc?.icon||"🎯"}</div>
        <div style={{fontFamily:"'Bebas Neue'",fontSize:26,color:"#F0EDE8",letterSpacing:1,marginTop:6}}>{discLabel}</div>
        {plan.targetTime&&<div style={{fontSize:14,color:"#E63946",fontFamily:"'Barlow',sans-serif",fontWeight:700,marginTop:4,letterSpacing:0.5}}>Objectif : {plan.targetTime}</div>}
        {plan.elevation&&disc?.category==="trail"&&<div style={{fontSize:13,color:"rgba(240,237,232,0.7)",fontFamily:"'Barlow',sans-serif",marginTop:4}}>⛰️ {plan.elevation} m D+</div>}
        {tgtStr&&<div style={{fontSize:12,color:"rgba(240,237,232,0.55)",fontFamily:"'Barlow',sans-serif",marginTop:8}}>📅 {tgtStr}</div>}
        {daysLeft!=null&&(
          <div style={{marginTop:10,fontFamily:"'Bebas Neue'",fontSize:20,color:daysLeft<14?"#E63946":"#F0EDE8",letterSpacing:1}}>
            {daysLeft>0?`${daysLeft} j · ≈ ${weeksLeft} semaines`:daysLeft===0?"C'est aujourd'hui !":`Il y a ${-daysLeft} j`}
          </div>
        )}
      </div>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:16}}>
        <div style={{background:"rgba(255,255,255,0.04)",borderRadius:12,padding:"12px",textAlign:"center",border:"1px solid rgba(255,255,255,0.06)"}}>
          <div style={{fontFamily:"'Bebas Neue'",fontSize:24,color:"#F0EDE8"}}>{plan.sessionsPerWeek||"-"}</div>
          <div style={{fontSize:10,color:"rgba(240,237,232,0.45)",fontFamily:"'Barlow',sans-serif",letterSpacing:1,textTransform:"uppercase",marginTop:2}}>Séances/sem</div>
        </div>
        <div style={{background:"rgba(255,255,255,0.04)",borderRadius:12,padding:"12px",textAlign:"center",border:"1px solid rgba(255,255,255,0.06)"}}>
          <div style={{fontFamily:"'Bebas Neue'",fontSize:18,color:"#F0EDE8",letterSpacing:0.5}}>{plan.level||"-"}</div>
          <div style={{fontSize:10,color:"rgba(240,237,232,0.45)",fontFamily:"'Barlow',sans-serif",letterSpacing:1,textTransform:"uppercase",marginTop:4}}>Niveau</div>
        </div>
      </div>
      {weeksLeft!=null&&weeksLeft>0&&plan.sessionsPerWeek&&(
        <div style={{marginBottom:16,padding:"12px 14px",background:"rgba(255,255,255,0.03)",border:"1px solid rgba(255,255,255,0.06)",borderRadius:12}}>
          <div style={{fontSize:10,color:"rgba(240,237,232,0.35)",letterSpacing:1.5,textTransform:"uppercase",fontFamily:"'Barlow',sans-serif",marginBottom:6}}>Charge prévisionnelle</div>
          <div style={{fontFamily:"'Barlow',sans-serif",fontSize:13,color:"rgba(240,237,232,0.8)",lineHeight:1.5}}>
            Environ <span style={{color:"#F0EDE8",fontWeight:700}}>{plan.sessionsPerWeek*weeksLeft} séances</span> d'ici l'objectif.
          </div>
        </div>
      )}
      {plan.sessionsPerWeek&&totalWeeks>0&&(()=>{
        const DAYS=["Lun","Mar","Mer","Jeu","Ven","Sam","Dim"];
        const isTri=disc?.category==="triathlon";
        const baseTpl=(isTri?TRI_TEMPLATE:RUN_TEMPLATE)[plan.sessionsPerWeek]||(isTri?TRI_TEMPLATE[4]:RUN_TEMPLATE[4]);
        const phase=phaseForWeek(clampedWeek,totalWeeks);
        const rawTpl=(isTri?triPhase:runPhase)(baseTpl,phase);
        const tpl=Array.isArray(plan.trainingDays)&&plan.trainingDays.length>0?(()=>{
          const nonRest=rawTpl.filter(t=>t!=="rest");
          const out=Array(7).fill("rest");
          plan.trainingDays.slice(0,nonRest.length).forEach((di,i)=>{out[di]=nonRest[i];});
          return out;
        })():rawTpl;
        const pInfo=PHASE_INFO[phase];
        const fmt=d=>`${String(d.getDate()).padStart(2,"0")}/${String(d.getMonth()+1).padStart(2,"0")}`;
        return (
          <div style={{marginBottom:16}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
              <div style={{fontSize:10,color:"rgba(240,237,232,0.35)",letterSpacing:1.5,textTransform:"uppercase",fontFamily:"'Barlow',sans-serif"}}>Programme semaine par semaine</div>
              <div style={{fontSize:11,color:"rgba(240,237,232,0.5)",fontFamily:"'Barlow',sans-serif",fontWeight:700}}>S{clampedWeek+1}/{totalWeeks}</div>
            </div>
            {totalWeeks>1&&(
              <div ref={weekScrollRef} style={{display:"flex",gap:5,overflowX:"auto",scrollbarWidth:"none",WebkitOverflowScrolling:"touch",marginBottom:10,paddingBottom:2}}>
                {Array.from({length:totalWeeks}).map((_,i)=>{
                  const wPhase=phaseForWeek(i,totalWeeks);
                  const wc=PHASE_INFO[wPhase].color;
                  const isSel=i===clampedWeek;
                  const isRace=i===totalWeeks-1;
                  return(
                    <button key={i} onClick={()=>setSelWeek(i)} style={{flexShrink:0,minWidth:46,padding:"6px 10px",borderRadius:10,border:`1px solid ${isSel?wc:"rgba(255,255,255,0.06)"}`,cursor:"pointer",background:isSel?`${wc}22`:"rgba(255,255,255,0.04)",color:isSel?wc:"rgba(240,237,232,0.6)",fontFamily:"'Barlow',sans-serif",fontWeight:700,fontSize:11,letterSpacing:0.3,display:"flex",flexDirection:"column",alignItems:"center",gap:1}}>
                      <span>{isRace?"🏁":`S${i+1}`}</span>
                    </button>
                  );
                })}
              </div>
            )}
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
              <div style={{display:"inline-block",padding:"3px 10px",borderRadius:10,background:`${pInfo.color}22`,border:`1px solid ${pInfo.color}55`,color:pInfo.color,fontFamily:"'Barlow',sans-serif",fontSize:10,fontWeight:700,letterSpacing:0.8,textTransform:"uppercase"}}>{pInfo.label}</div>
              <div style={{fontSize:11,color:"rgba(240,237,232,0.55)",fontFamily:"'Barlow',sans-serif",fontWeight:700}}>{fmt(selMonday)} — {fmt(selSunday)}</div>
            </div>
            <div style={{display:"flex",flexDirection:"column",gap:5}}>
              {DAYS.map((dn,i)=>{
                const d=new Date(selMonday);d.setDate(selMonday.getDate()+i);
                const type=tpl[i];const s=SESSION_STYLES[type];
                const isToday=d.getTime()===today.getTime();
                const isRaceDay=type==="race"&&tgt&&d.getTime()===tgt.getTime();
                return (
                  <div key={i} style={{display:"flex",alignItems:"center",gap:10,padding:"9px 11px",background:s.bg,border:`1px solid ${isToday||isRaceDay?s.color:"rgba(255,255,255,0.06)"}`,borderRadius:10}}>
                    <div style={{width:32,textAlign:"center",flexShrink:0}}>
                      <div style={{fontSize:9,color:"rgba(240,237,232,0.5)",fontFamily:"'Barlow',sans-serif",fontWeight:700,letterSpacing:0.5,textTransform:"uppercase"}}>{dn}</div>
                      <div style={{fontFamily:"'Bebas Neue'",fontSize:17,color:isToday||isRaceDay?s.color:"#F0EDE8",letterSpacing:0.5,lineHeight:1.1}}>{d.getDate()}</div>
                    </div>
                    <div style={{fontSize:18,flexShrink:0}}>{s.icon}</div>
                    <div style={{flex:1,minWidth:0}}>
                      <div style={{fontFamily:"'Barlow',sans-serif",fontWeight:700,fontSize:12,color:s.color,letterSpacing:0.3}}>{s.label}{isToday&&<span style={{marginLeft:6,fontSize:9,color:"rgba(240,237,232,0.5)",fontWeight:600}}>AUJOURD'HUI</span>}</div>
                      <div style={{fontSize:11,color:"rgba(240,237,232,0.6)",fontFamily:"'Barlow',sans-serif",marginTop:1,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{SESSION_DETAIL[type]}</div>
                    </div>
                  </div>
                );
              })}
            </div>
            <div style={{fontSize:10,color:"rgba(240,237,232,0.35)",fontFamily:"'Barlow',sans-serif",marginTop:8,fontStyle:"italic",lineHeight:1.4}}>Modèle indicatif — volume et intensité ajustés selon la phase ; adapte selon tes sensations.</div>
          </div>
        );
      })()}
      {plan.notes&&(
        <div style={{marginBottom:16}}>
          <div style={{fontSize:10,color:"rgba(240,237,232,0.35)",letterSpacing:1.5,textTransform:"uppercase",fontFamily:"'Barlow',sans-serif",marginBottom:6}}>Notes</div>
          <div style={{background:"rgba(255,255,255,0.03)",border:"1px solid rgba(255,255,255,0.06)",borderRadius:12,padding:"12px 14px",fontSize:13,color:"rgba(240,237,232,0.85)",fontFamily:"'Barlow',sans-serif",whiteSpace:"pre-wrap",lineHeight:1.5}}>{plan.notes}</div>
        </div>
      )}
      <Btn onClick={onEdit} mb={8}>✏️ Modifier le plan</Btn>
      <Btn onClick={onClose} variant="secondary" mb={0}>Fermer</Btn>
    </Modal>
  );
}

// ── TRAINING PLAN MODAL ───────────────────────────────────────────────────────
function TrainingPlanModal({userId,existing,onSave,onDelete,onClose}){
  const DAYS_SHORT=["Lun","Mar","Mer","Jeu","Ven","Sam","Dim"];
  const DEFAULT_DAYS_BY_COUNT={2:[1,6],3:[1,3,6],4:[1,3,5,6],5:[0,1,3,5,6],6:[0,1,2,3,5,6],7:[0,1,2,3,4,5,6]};
  const planDisciplines=Object.entries(DISCIPLINES).filter(([,v])=>v.category!=="hyrox");
  const initialDisc=existing?.discipline&&DISCIPLINES[existing.discipline]?.category!=="hyrox"?existing.discipline:"marathon";
  const [discipline,setDisc]=useState(initialDisc);
  const [date,setDate]=useState(existing?.date||"");
  const [level,setLevel]=useState(existing?.level||"Intermédiaire");
  const [trainingDays,setTrainingDays]=useState(()=>{
    if(Array.isArray(existing?.trainingDays)&&existing.trainingDays.length>0)return [...existing.trainingDays].sort((a,b)=>a-b);
    const spw=existing?.sessionsPerWeek||4;
    return DEFAULT_DAYS_BY_COUNT[spw]||DEFAULT_DAYS_BY_COUNT[4];
  });
  const [targetTime,setTargetTime]=useState(existing?.targetTime||"");
  const [elevation,setElevation]=useState(existing?.elevation||"");
  const [notes,setNotes]=useState(existing?.notes||"");
  const toggleDay=i=>setTrainingDays(d=>d.includes(i)?d.filter(x=>x!==i):[...d,i].sort((a,b)=>a-b));
  const sessionsPerWeek=trainingDays.length;
  const isTrail=DISCIPLINES[discipline]?.category==="trail";
  const handleSave=()=>{
    if(sessionsPerWeek<2)return;
    const payload={discipline,date,level,sessionsPerWeek,trainingDays,targetTime:targetTime.trim(),elevation:isTrail&&elevation?parseInt(elevation)||null:null,notes:notes.trim(),updatedAt:new Date().toISOString()};
    try{localStorage.setItem(`trainingPlan_${userId}`,JSON.stringify(payload));}catch{}
    onSave(payload);
  };
  const handleDelete=()=>{
    try{localStorage.removeItem(`trainingPlan_${userId}`);}catch{}
    onDelete();
  };
  const today=new Date();today.setHours(0,0,0,0);
  const tgt=date?new Date(date):null;
  const daysLeft=tgt?Math.ceil((tgt-today)/86400000):null;
  const weeksLeft=daysLeft!=null?Math.max(0,Math.ceil(daysLeft/7)):null;
  return (
    <Modal onClose={onClose}>
      <div style={{fontFamily:"'Bebas Neue'",fontSize:22,color:"#F0EDE8",letterSpacing:1,marginBottom:4}}>Plan d'entraînement</div>
      <div style={{fontSize:12,color:"rgba(240,237,232,0.45)",fontFamily:"'Barlow',sans-serif",marginBottom:16}}>Définis ton objectif et la cadence de préparation.</div>
      <Lbl c="Objectif"/>
      <Sel value={discipline} onChange={setDisc}>{planDisciplines.map(([k,v])=><option key={k} value={k}>{v.icon} {v.label}</option>)}</Sel>
      {isTrail&&(<>
        <Lbl c="Dénivelé positif (m)"/>
        <Inp value={elevation} onChange={setElevation} placeholder="Ex: 1500" type="number"/>
      </>)}
      <Lbl c="Date de l'objectif"/>
      <div style={{background:"rgba(255,255,255,0.03)",borderRadius:14,padding:"12px",marginBottom:12}}><DatePicker value={date} onChange={setDate}/></div>
      {weeksLeft!=null&&(
        <div style={{fontSize:11,color:weeksLeft<4?"#E63946":"rgba(240,237,232,0.55)",fontFamily:"'Barlow',sans-serif",marginBottom:12,marginTop:-4}}>
          {weeksLeft>0?`≈ ${weeksLeft} semaines de préparation`:daysLeft===0?"C'est aujourd'hui !":"Date passée"}
        </div>
      )}
      <Lbl c="Niveau"/>
      <Sel value={level} onChange={setLevel}>{["Débutant","Intermédiaire","Avancé","Expert"].map(l=><option key={l} value={l}>{l}</option>)}</Sel>
      <Lbl c={`Jours d'entraînement (${sessionsPerWeek} séance${sessionsPerWeek>1?"s":""}/sem)`}/>
      <div style={{display:"flex",gap:5,marginBottom:sessionsPerWeek<2?4:16}}>
        {DAYS_SHORT.map((d,i)=>{const on=trainingDays.includes(i);return(
          <button key={i} type="button" onClick={()=>toggleDay(i)} style={{flex:1,padding:"10px 0",borderRadius:10,border:"1px solid "+(on?"rgba(230,57,70,0.4)":"rgba(255,255,255,0.08)"),background:on?"rgba(230,57,70,0.15)":"rgba(255,255,255,0.04)",color:on?"#E63946":"rgba(240,237,232,0.5)",fontFamily:"'Barlow',sans-serif",fontWeight:700,fontSize:12,letterSpacing:0.3,cursor:"pointer"}}>{d}</button>
        );})}
      </div>
      {sessionsPerWeek<2&&<div style={{fontSize:11,color:"#E63946",fontFamily:"'Barlow',sans-serif",marginBottom:16}}>Sélectionne au moins 2 jours.</div>}
      <Lbl c="Temps visé (optionnel)"/>
      <Inp value={targetTime} onChange={setTargetTime} placeholder="Ex: Sub-3h30, 1h45, …"/>
      <Lbl c="Notes (optionnel)"/>
      <div style={{marginBottom:16}}>
        <textarea value={notes} onChange={e=>setNotes(e.target.value)} placeholder="Objectifs intermédiaires, contraintes, etc." rows={3} style={{width:"100%",background:"rgba(255,255,255,0.05)",border:"1px solid rgba(255,255,255,0.1)",borderRadius:12,padding:"12px 14px",color:"#F0EDE8",fontSize:14,fontFamily:"'Barlow',sans-serif",outline:"none",boxSizing:"border-box",resize:"vertical"}}/>
      </div>
      <Btn onClick={handleSave} mb={8}>{existing?"Mettre à jour":"Créer le plan"}</Btn>
      {existing&&<Btn onClick={handleDelete} variant="secondary" mb={8}>Supprimer le plan</Btn>}
      <Btn onClick={onClose} variant="secondary" mb={0}>Annuler</Btn>
    </Modal>
  );
}

// ── PERF TAB ──────────────────────────────────────────────────────────────────
const PR_DISCIPLINES = [
  {key:"course", label:"Course", icon:"🏃", formats:[
    {label:"5 km", disc:"5km"},
    {label:"10 km", disc:"10km"},
    {label:"Semi-marathon", disc:"semi"},
    {label:"Marathon", disc:"marathon"},
  ]},
  {key:"triathlon", label:"Triathlon", icon:"🏊", formats:[
    {label:"Sprint", disc:"tri-s"},
    {label:"M (Olympique)", disc:"tri-m"},
    {label:"Half-Iron", disc:"tri-l"},
    {label:"Ironman", disc:"tri-xl"},
  ]},
  {key:"trail", label:"Trail", icon:"⛰️", formats:[
    {label:"Trail S (<25 km)", disc:"trail-s"},
    {label:"Trail M (25-50 km)", disc:"trail-m"},
    {label:"Trail L (>50 km)", disc:"trail-l"},
    {label:"Ultra (>80 km)", disc:"trail-xl"},
  ]},
  {key:"hyrox", label:"Hyrox", icon:"🔥", formats:[
    {label:"Pro", disc:"hyrox-pro"},
    {label:"Open", disc:"hyrox-open"},
    {label:"Doubles", disc:"hyrox-double"},
    {label:"Relay", disc:"hyrox-relay"},
  ]},
  {key:"velo", label:"Vélo", icon:"🚴", formats:[
    {label:"40 km", disc:null},
    {label:"100 km", disc:null},
    {label:"160 km", disc:null},
  ]},
  {key:"natation", label:"Natation", icon:"🏊", formats:[
    {label:"750 m", refDist:750},
    {label:"1500 m", refDist:1500},
    {label:"1900 m", refDist:1900},
    {label:"3800 m", refDist:3800},
    {label:"5 km", refDist:5000},
  ]},
];

const DISC_DIST_KM = {
  "5km":5, "10km":10, "semi":21.1, "marathon":42.2,
  "trail-s":20, "trail-m":45, "trail-l":80, "trail-xl":120,
  "tri-s":25.75, "tri-m":51.5, "tri-l":113, "tri-xl":226,
  "hyrox-open":8, "hyrox-pro":8, "hyrox-double":8, "hyrox-relay":8,
};

const DISCIPLINE_TABS = [
  {key:"points", label:"Points"},
  ...PR_DISCIPLINES.map(d => ({key:d.key, label:d.label, icon:d.icon})),
];

function formatLabelFromDisc(discKey) {
  for (const d of PR_DISCIPLINES) {
    for (const f of d.formats) {
      if (f.disc === discKey) return f.label;
    }
  }
  return DISCIPLINES[discKey]?.label || discKey;
}

function pluralFormat(label, count) {
  const lower = label.toLowerCase();
  if (/\d/.test(lower) || count <= 1) return lower;
  if (lower.endsWith("s") || lower.endsWith("x")) return lower;
  return lower + "s";
}

const monthLabel = i => MONTHS_FR[i].normalize("NFD").replace(/[̀-ͯ]/g,"").toUpperCase();

function fmtRaceTime(s) {
  if (s==null) return "—";
  const h=Math.floor(s/3600), m=Math.floor((s%3600)/60);
  if (h>0) return `${h}H${String(m).padStart(2,"0")}`;
  const sec=Math.round(s%60);
  return `${m}'${String(sec).padStart(2,"0")}`;
}
function fmtTimeShort(s) {
  if (s==null) return "—";
  const h=Math.floor(s/3600), m=Math.floor((s%3600)/60), sec=Math.round(s%60);
  if (h>0) return `${h}:${String(m).padStart(2,"0")}`;
  return `${m}:${String(sec).padStart(2,"0")}`;
}
function fmtPace(secPerKm) {
  if (!secPerKm || !isFinite(secPerKm)) return "—";
  const m=Math.floor(secPerKm/60), s=Math.round(secPerKm%60);
  return `${m}'${String(s).padStart(2,"0")}`;
}
function fmtFrShortDate(d) {
  if (!d) return "";
  const date = new Date(d);
  if (isNaN(date)) return "";
  const months = ["jan","fév","mar","avr","mai","jun","jul","aoû","sep","oct","nov","déc"];
  return `${date.getDate()} ${months[date.getMonth()]} ${date.getFullYear()}`;
}

function buildMonthlyPoints(results) {
  const now=new Date();
  const months=[];
  for (let i=11; i>=0; i--) {
    const d=new Date(now.getFullYear(), now.getMonth()-i, 1);
    months.push({
      key:`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}`,
      label:monthLabel(d.getMonth()),
      year:d.getFullYear(),
      month:d.getMonth(),
      value:0,
    });
  }
  results.forEach(r=>{
    const date=r.race_date||(r.year?`${r.year}-12-31`:null);
    if(!date)return;
    const m=months.find(x=>x.key===date.slice(0,7));
    if(m) m.value+=calcPoints(r.discipline,r.time,r.elevation);
  });
  return months;
}
function buildPrev12Total(results) {
  const now=new Date();
  const start=new Date(now.getFullYear(), now.getMonth()-23, 1);
  const end=new Date(now.getFullYear(), now.getMonth()-11, 1);
  let total=0;
  results.forEach(r=>{
    const date=r.race_date||(r.year?`${r.year}-12-31`:null);
    if(!date)return;
    const d=new Date(date);
    if(d>=start && d<end) total+=calcPoints(r.discipline,r.time,r.elevation);
  });
  return total;
}

// ── PREDICTIONS DE COURSE (Riegel adaptatif) ──────────────────────────────────
// T2 = T1 × (D2/D1)^k — exposant ajusté au volume hebdo (k bas = endurance ++).
const PREDICT_TARGETS = [
  {disc:"5km",      label:"5 km",          km:5,    icon:"🏃"},
  {disc:"10km",     label:"10 km",         km:10,   icon:"🏃"},
  {disc:"semi",     label:"Semi-marathon", km:21.1, icon:"🏃"},
  {disc:"marathon", label:"Marathon",      km:42.2, icon:"🏃"},
];
const PREDICT_WINDOW_DAYS = 90;
const PREDICT_VOLUME_WINDOW_DAYS = 28;
const PREDICT_MIN_DIST_KM = 3;

function riegelExponent(weeklyVolumeKm) {
  if (weeklyVolumeKm < 30) return 1.08;
  if (weeklyVolumeKm < 50) return 1.06;
  if (weeklyVolumeKm < 70) return 1.05;
  return 1.04;
}

function predictRaceTime(refDistanceKm, refTimeSeconds, targetDistanceKm, weeklyVolumeKm = 0) {
  if (!refTimeSeconds || !refDistanceKm || !targetDistanceKm) return null;
  const exponent = riegelExponent(weeklyVolumeKm);
  return refTimeSeconds * Math.pow(targetDistanceKm / refDistanceKm, exponent);
}

function computeWeeklyVolumeKm(runTrainings) {
  const cutoff = Date.now() - PREDICT_VOLUME_WINDOW_DAYS * 86400 * 1000;
  const totalKm = (runTrainings || []).reduce((sum, t) => {
    const ts = t.date ? new Date(t.date).getTime() : 0;
    if (!ts || ts < cutoff) return sum;
    return sum + (parseFloat(t.distance) || 0);
  }, 0);
  return totalKm / (PREDICT_VOLUME_WINDOW_DAYS / 7);
}

function buildRacePredictions(runTrainings) {
  const now = Date.now();
  const cutoff = now - PREDICT_WINDOW_DAYS * 86400 * 1000;
  const eligible = (runTrainings || []).filter(t => {
    const d = parseFloat(t.distance) || 0;
    const dur = parseInt(t.duration) || 0;
    if (d < PREDICT_MIN_DIST_KM || dur <= 0) return false;
    const ts = t.date ? new Date(t.date).getTime() : 0;
    return ts && ts >= cutoff;
  });
  const weeklyKm = computeWeeklyVolumeKm(runTrainings);
  const out = {};
  PREDICT_TARGETS.forEach(t => {
    const lo = t.km * 0.5, hi = t.km * 2;
    const cands = eligible.filter(tr => {
      const d = parseFloat(tr.distance) || 0;
      return d >= lo && d <= hi;
    });
    if (cands.length === 0) { out[t.disc] = null; return; }
    let best = null;
    cands.forEach(tr => {
      const d = parseFloat(tr.distance);
      const dur = parseInt(tr.duration);
      const proj = predictRaceTime(d, dur, t.km, weeklyKm);
      if (proj != null && (!best || proj < best.time)) {
        best = { time: proj, source: tr };
      }
    });
    out[t.disc] = best;
  });
  return { predictions: out, sampleCount: eligible.length, weeklyKm, exponent: riegelExponent(weeklyKm) };
}

function PerfTab({userId, refreshKey, onActivityChange}) {
  const [results, setResults] = useState([]);
  const [swimTrainings, setSwimTrainings] = useState([]);
  const [runTrainings, setRunTrainings] = useState([]);
  const [editResult, setEditResult] = useState(null);
  const [editSwim, setEditSwim] = useState(null);
  const [editRun, setEditRun] = useState(null);
  const [activeDisc, setActiveDisc] = useState("course");
  const [progDisc, setProgDisc] = useState("points");
  const [progFormat, setProgFormat] = useState("all");
  const season = CY;

  const onSelectProgDisc = (key) => {
    setProgDisc(key);
    setProgFormat("all");
  };

  useEffect(() => {
    if (!userId) return;
    Promise.all([
      supabase.from("results").select("*").eq("user_id", userId).order("race_date", {ascending:false}),
      supabase.from("trainings").select("*").eq("user_id", userId).eq("sport", "Natation").order("date", {ascending:false}),
      supabase.from("trainings").select("*").eq("user_id", userId).eq("sport", "Run").order("date", {ascending:false}),
    ]).then(([{data:r},{data:t},{data:rt}]) => {
      setResults(r || []);
      setSwimTrainings(t || []);
      setRunTrainings(rt || []);
    });
  }, [userId, refreshKey]);

  const reload = () => Promise.all([
    supabase.from("results").select("*").eq("user_id",userId).order("race_date",{ascending:false}),
    supabase.from("trainings").select("*").eq("user_id",userId).eq("sport","Natation").order("date",{ascending:false}),
    supabase.from("trainings").select("*").eq("user_id",userId).eq("sport","Run").order("date",{ascending:false}),
  ]).then(([{data:r},{data:t},{data:rt}]) => { setResults(r||[]); setSwimTrainings(t||[]); setRunTrainings(rt||[]); });

  const swimRecords = useMemo(() => {
    const map = {};
    swimTrainings.forEach(t => {
      const d = parseFloat(t.distance) || 0;
      const dur = parseInt(t.duration) || 0;
      if (d <= 0 || dur <= 0) return;
      const distM = d * 1000;
      const paceSec100 = dur * 100 / distM;
      [750, 1500, 1900, 3800, 5000].forEach(refDist => {
        if (refDist > distM) return;
        const projected = paceSec100 * (refDist / 100);
        if (!map[refDist] || projected < map[refDist].time) {
          map[refDist] = { time: projected, source: t, isProjection: refDist !== distM };
        }
      });
    });
    return map;
  }, [swimTrainings]);

  const bestByDisc = useMemo(() => {
    const map = {};
    results.forEach(r => {
      if (!map[r.discipline] || r.time < map[r.discipline].time) map[r.discipline] = r;
    });
    return map;
  }, [results]);

  const seasonResults = useMemo(() => results.filter(r => rYear(r) === season), [results, season]);
  const lastSeasonResults = useMemo(() => results.filter(r => rYear(r) === season - 1), [results, season]);

  const courseCount = seasonResults.length;
  const courseDelta = courseCount - lastSeasonResults.length;
  const totalKm = useMemo(() => seasonResults.reduce((s, r) => s + (DISC_DIST_KM[r.discipline] || 0), 0), [seasonResults]);
  const totalKmLast = useMemo(() => lastSeasonResults.reduce((s, r) => s + (DISC_DIST_KM[r.discipline] || 0), 0), [lastSeasonResults]);
  const totalElev = useMemo(() => seasonResults.reduce((s, r) => s + (r.elevation || 0), 0), [seasonResults]);
  const totalElevLast = useMemo(() => lastSeasonResults.reduce((s, r) => s + (r.elevation || 0), 0), [lastSeasonResults]);
  const totalPts = useMemo(() => sumBestPts(seasonResults), [seasonResults]);
  const totalPtsLast = useMemo(() => sumBestPts(lastSeasonResults), [lastSeasonResults]);
  const bestPerf = useMemo(() => {
    if (seasonResults.length === 0) return null;
    return [...seasonResults].sort((a,b) => calcPoints(b.discipline,b.time,b.elevation) - calcPoints(a.discipline,a.time,a.elevation))[0];
  }, [seasonResults]);

  const monthlyData = useMemo(() => buildMonthlyPoints(results), [results]);
  const last12Total = useMemo(() => monthlyData.reduce((s, m) => s + m.value, 0), [monthlyData]);
  const prev12Total = useMemo(() => buildPrev12Total(results), [results]);
  const yoyDelta = prev12Total > 0 ? ((last12Total / prev12Total - 1) * 100) : null;
  const bestMonth = useMemo(() => monthlyData.reduce((b,m) => m.value > (b?.value||0) ? m : b, null), [monthlyData]);

  const racePred = useMemo(() => buildRacePredictions(runTrainings), [runTrainings]);

  const availableFormats = useMemo(() => {
    if (progDisc === "points") return [];
    const disc = PR_DISCIPLINES.find(d => d.key === progDisc);
    if (!disc) return [];
    return disc.formats.filter(fmt => fmt.disc && results.some(r => r.discipline === fmt.disc));
  }, [progDisc, results]);

  const progRaces = useMemo(() => {
    if (progDisc === "points") return [];
    const disc = PR_DISCIPLINES.find(d => d.key === progDisc);
    if (!disc) return [];
    const allKeys = disc.formats.map(f => f.disc).filter(Boolean);
    return results
      .filter(r => progFormat === "all" ? allKeys.includes(r.discipline) : r.discipline === progFormat)
      .map(r => ({...r, _date: r.race_date || (r.year ? `${r.year}-06-15` : null)}))
      .filter(r => r._date)
      .sort((a, b) => a._date.localeCompare(b._date));
  }, [progDisc, progFormat, results]);

  const noRaces = results.length === 0 && swimTrainings.length === 0;
  const activeDiscObj = PR_DISCIPLINES.find(d => d.key === activeDisc) || PR_DISCIPLINES[0];

  return (
    <div style={{flex:1,minHeight:0,display:"flex",flexDirection:"column",overflow:"hidden"}}>
      <div style={{flexShrink:0,padding:"0 16px"}}>
        <div style={{fontFamily:"'Bebas Neue'",fontSize:28,letterSpacing:2,color:"#F0EDE8",paddingTop:20,paddingBottom:12}}>Stats</div>
      </div>
      <PullToRefresh onRefresh={reload} paddingBottom="calc(100px + env(safe-area-inset-bottom))">
        {noRaces ? (
          <div style={{textAlign:"center",padding:"60px 20px",color:"rgba(240,237,232,0.5)",fontFamily:"'Barlow',sans-serif"}}>
            <div style={{fontSize:48,marginBottom:16}}>🏁</div>
            <div style={{fontSize:14}}>Pas encore de course enregistrée.</div>
            <div style={{fontSize:13,marginTop:6}}>Ajoute ta première course !</div>
          </div>
        ) : (
          <>
            <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:12}}>
              <div style={{fontFamily:"'Bebas Neue'",fontSize:18,letterSpacing:1.5,color:"#F0EDE8"}}>🏆 Records personnels</div>
              <div style={{fontSize:11,color:"rgba(240,237,232,0.5)",fontFamily:"'Barlow',sans-serif",fontWeight:700,letterSpacing:0.5,textTransform:"uppercase"}}>All-time</div>
            </div>
            <div style={{display:"flex",flexWrap:"wrap",gap:5,marginBottom:14}}>
              {PR_DISCIPLINES.map(d => (
                <button key={d.key} onClick={()=>setActiveDisc(d.key)} style={{padding:"6px 11px",borderRadius:14,border:"none",cursor:"pointer",background:activeDisc===d.key?"#E63946":"rgba(255,255,255,0.06)",color:activeDisc===d.key?"#fff":"rgba(240,237,232,0.5)",fontFamily:"'Barlow',sans-serif",fontWeight:600,fontSize:11,whiteSpace:"nowrap",letterSpacing:0.2}}>
                  {`${d.icon} ${d.label}`}
                </button>
              ))}
            </div>
            <div style={{marginBottom:24}}>
              {activeDiscObj.formats.map(fmt => {
                let prTime=null, prSubtitle="", onClickPr=null, prIcon=DISCIPLINES[fmt.disc]?.icon||activeDiscObj.icon, isSwimProj=false;
                if (fmt.refDist) {
                  const rec = swimRecords[fmt.refDist];
                  if (rec) {
                    prTime = rec.time;
                    isSwimProj = rec.isProjection;
                    const titleLabel = (rec.source.title && rec.source.title.trim())
                      ? rec.source.title.trim()
                      : (isSwimProj ? `Projection ${(rec.source.distance||0)} km` : "Entraînement piscine");
                    prSubtitle = `${titleLabel}${rec.source.date?` · ${fmtFrShortDate(rec.source.date)}`:""}`;
                    onClickPr = () => setEditSwim(rec.source);
                  }
                } else if (fmt.disc) {
                  const pr = bestByDisc[fmt.disc];
                  if (pr) {
                    prTime = pr.time;
                    const dateStr = pr.race_date ? fmtFrShortDate(pr.race_date) : (pr.year || "");
                    prSubtitle = `${pr.race || "Course"}${dateStr?` · ${dateStr}`:""}`;
                    onClickPr = () => setEditResult(pr);
                  }
                }
                if (prTime != null) {
                  return (
                    <div key={fmt.label} onClick={onClickPr} style={{display:"flex",alignItems:"center",gap:12,padding:"12px 14px",background:"linear-gradient(135deg, rgba(255,215,0,0.04), rgba(255,255,255,0.02))",border:"1px solid rgba(255,215,0,0.2)",borderRadius:14,marginBottom:8,cursor:"pointer"}}>
                      <div style={{width:38,height:38,borderRadius:"50%",background:"rgba(255,215,0,0.1)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:18,flexShrink:0}}>
                        {prIcon}
                      </div>
                      <div style={{flex:1,minWidth:0}}>
                        <div style={{fontFamily:"'Bebas Neue'",fontSize:15,color:"#F0EDE8",letterSpacing:0.5}}>{fmt.label}</div>
                        <div style={{fontSize:11,color:"rgba(240,237,232,0.55)",fontFamily:"'Barlow',sans-serif",marginTop:2,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>
                          {prSubtitle}
                        </div>
                      </div>
                      <div style={{textAlign:"right",flexShrink:0}}>
                        <div style={{fontFamily:"'Bebas Neue'",fontSize:22,color:"#FFD700",letterSpacing:1,lineHeight:1}}>{fmtTime(Math.round(prTime))}</div>
                        <div style={{fontSize:9,color:"#FFD700",fontFamily:"'Barlow',sans-serif",fontWeight:700,letterSpacing:1,textTransform:"uppercase",marginTop:3}}>{isSwimProj?"RECORD ✦":"RECORD"}</div>
                      </div>
                    </div>
                  );
                }
                return (
                  <div key={fmt.label} style={{display:"flex",alignItems:"center",gap:12,padding:"12px 14px",background:"rgba(255,255,255,0.02)",border:"1px solid rgba(255,255,255,0.05)",borderRadius:14,marginBottom:8,opacity:0.55}}>
                    <div style={{width:38,height:38,borderRadius:"50%",background:"rgba(255,255,255,0.04)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:14,flexShrink:0,color:"rgba(240,237,232,0.3)"}}>—</div>
                    <div style={{flex:1,minWidth:0}}>
                      <div style={{fontFamily:"'Bebas Neue'",fontSize:15,color:"rgba(240,237,232,0.6)",letterSpacing:0.5}}>{fmt.label}</div>
                      <div style={{fontSize:11,color:"rgba(240,237,232,0.3)",fontFamily:"'Barlow',sans-serif",marginTop:2}}>Pas encore couru</div>
                    </div>
                    <div style={{fontFamily:"'Bebas Neue'",fontSize:22,color:"rgba(240,237,232,0.25)",letterSpacing:1}}>—</div>
                  </div>
                );
              })}
            </div>

            <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:12}}>
              <div style={{fontFamily:"'Bebas Neue'",fontSize:18,letterSpacing:1.5,color:"#F0EDE8"}}>🔮 Prédictions de course</div>
              <div style={{fontSize:10,color:"rgba(240,237,232,0.45)",fontFamily:"'Barlow',sans-serif",fontWeight:700,letterSpacing:0.5,textTransform:"uppercase"}}>
                {racePred.sampleCount > 0 ? `${racePred.sampleCount} run${racePred.sampleCount>1?"s":""} · ${PREDICT_WINDOW_DAYS}j` : `${PREDICT_WINDOW_DAYS} derniers jours`}
              </div>
            </div>
            <div style={{fontSize:11,color:"rgba(240,237,232,0.4)",fontFamily:"'Barlow',sans-serif",marginBottom:10,lineHeight:1.5}}>
              Estimations basées sur tes entraînements <span style={{color:"#F0EDE8",fontWeight:700}}>Run</span> récents (Riegel, exposant {racePred.exponent.toFixed(2)} · volume {Math.round(racePred.weeklyKm)} km/sem).
            </div>
            <div style={{marginBottom:24}}>
              {racePred.sampleCount === 0 ? (
                <div style={{padding:"18px 14px",background:"rgba(255,255,255,0.02)",border:"1px dashed rgba(255,255,255,0.08)",borderRadius:14,textAlign:"center",fontFamily:"'Barlow',sans-serif",fontSize:12,color:"rgba(240,237,232,0.45)"}}>
                  Pas assez d'entraînements Run récents (≥ {PREDICT_MIN_DIST_KM} km) pour estimer.
                </div>
              ) : PREDICT_TARGETS.map(t => {
                const pred = racePred.predictions[t.disc];
                const pr = bestByDisc[t.disc];
                if (!pred) {
                  return (
                    <div key={t.disc} style={{display:"flex",alignItems:"center",gap:12,padding:"12px 14px",background:"rgba(255,255,255,0.02)",border:"1px solid rgba(255,255,255,0.05)",borderRadius:14,marginBottom:8,opacity:0.55}}>
                      <div style={{width:38,height:38,borderRadius:"50%",background:"rgba(255,255,255,0.04)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:16,flexShrink:0}}>{t.icon}</div>
                      <div style={{flex:1,minWidth:0}}>
                        <div style={{fontFamily:"'Bebas Neue'",fontSize:15,color:"rgba(240,237,232,0.6)",letterSpacing:0.5}}>{t.label}</div>
                        <div style={{fontSize:11,color:"rgba(240,237,232,0.3)",fontFamily:"'Barlow',sans-serif",marginTop:2}}>Pas d'entraînement assez proche de {t.km} km</div>
                      </div>
                      <div style={{fontFamily:"'Bebas Neue'",fontSize:22,color:"rgba(240,237,232,0.25)",letterSpacing:1}}>—</div>
                    </div>
                  );
                }
                const predTime = Math.round(pred.time);
                let deltaTxt = "", deltaColor = "rgba(240,237,232,0.45)";
                if (pr) {
                  const diff = predTime - pr.time;
                  if (Math.abs(diff) < 1) { deltaTxt = `= PR (${fmtTime(pr.time)})`; }
                  else if (diff < 0) { deltaTxt = `↓ ${fmtTime(Math.abs(diff))} sous PR (${fmtTime(pr.time)})`; deltaColor = "#4ADE80"; }
                  else { deltaTxt = `↑ ${fmtTime(diff)} au-dessus PR (${fmtTime(pr.time)})`; deltaColor = "#FF6B35"; }
                }
                const src = pred.source;
                const srcLabel = `${(parseFloat(src.distance)||0).toFixed(1)} km en ${fmtTime(parseInt(src.duration)||0)}${src.date?` · ${fmtFrShortDate(src.date)}`:""}`;
                return (
                  <div key={t.disc} onClick={()=>setEditRun(src)} style={{display:"flex",alignItems:"center",gap:12,padding:"12px 14px",background:"linear-gradient(135deg, rgba(74,144,217,0.06), rgba(255,255,255,0.02))",border:"1px solid rgba(74,144,217,0.2)",borderRadius:14,marginBottom:8,cursor:"pointer"}}>
                    <div style={{width:38,height:38,borderRadius:"50%",background:"rgba(74,144,217,0.12)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:18,flexShrink:0}}>{t.icon}</div>
                    <div style={{flex:1,minWidth:0}}>
                      <div style={{fontFamily:"'Bebas Neue'",fontSize:15,color:"#F0EDE8",letterSpacing:0.5}}>{t.label}</div>
                      <div style={{fontSize:11,color:"rgba(240,237,232,0.55)",fontFamily:"'Barlow',sans-serif",marginTop:2,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>
                        {srcLabel}
                      </div>
                      {deltaTxt && (
                        <div style={{fontSize:10,color:deltaColor,fontFamily:"'Barlow',sans-serif",fontWeight:700,marginTop:3,letterSpacing:0.3}}>{deltaTxt}</div>
                      )}
                    </div>
                    <div style={{textAlign:"right",flexShrink:0}}>
                      <div style={{fontFamily:"'Bebas Neue'",fontSize:22,color:"#4A90D9",letterSpacing:1,lineHeight:1}}>{fmtTime(predTime)}</div>
                      <div style={{fontSize:9,color:"#4A90D9",fontFamily:"'Barlow',sans-serif",fontWeight:700,letterSpacing:1,textTransform:"uppercase",marginTop:3}}>PRÉDICTION</div>
                    </div>
                  </div>
                );
              })}
            </div>

            <div style={{fontFamily:"'Bebas Neue'",fontSize:18,letterSpacing:1.5,color:"#F0EDE8",marginBottom:12}}>📈 Progression</div>
            <div style={{background:"rgba(255,255,255,0.03)",border:"1px solid rgba(255,255,255,0.06)",borderRadius:14,padding:14,marginBottom:24}}>
              <div style={{display:"flex",flexWrap:"wrap",gap:5,marginBottom:8}}>
                {DISCIPLINE_TABS.map(t => (
                  <button key={t.key} onClick={()=>onSelectProgDisc(t.key)} style={{padding:"6px 11px",borderRadius:14,border:"none",cursor:"pointer",background:progDisc===t.key?"rgba(230,57,70,0.15)":"rgba(255,255,255,0.04)",color:progDisc===t.key?"#E63946":"rgba(240,237,232,0.45)",fontFamily:"'Barlow',sans-serif",fontWeight:700,fontSize:11,letterSpacing:0.2,whiteSpace:"nowrap"}}>
                    {t.icon?`${t.icon} ${t.label}`:t.label}
                  </button>
                ))}
              </div>
              {progDisc !== "points" && availableFormats.length > 0 && (
                <div style={{display:"flex",flexWrap:"wrap",gap:4,marginBottom:10}}>
                  <button onClick={()=>setProgFormat("all")} style={{padding:"4px 10px",borderRadius:12,border:"none",cursor:"pointer",background:progFormat==="all"?"#E63946":"rgba(255,255,255,0.05)",color:progFormat==="all"?"#fff":"rgba(240,237,232,0.5)",fontFamily:"'Barlow',sans-serif",fontWeight:600,fontSize:10,whiteSpace:"nowrap",letterSpacing:0.2}}>Tous</button>
                  {availableFormats.map(fmt => (
                    <button key={fmt.disc} onClick={()=>setProgFormat(fmt.disc)} style={{padding:"4px 10px",borderRadius:12,border:"none",cursor:"pointer",background:progFormat===fmt.disc?"#E63946":"rgba(255,255,255,0.05)",color:progFormat===fmt.disc?"#fff":"rgba(240,237,232,0.5)",fontFamily:"'Barlow',sans-serif",fontWeight:600,fontSize:10,whiteSpace:"nowrap",letterSpacing:0.2}}>{fmt.label}</button>
                  ))}
                </div>
              )}
              {progDisc === "points"
                ? <PointsProgressionChart monthlyData={monthlyData} last12Total={last12Total} yoyDelta={yoyDelta} bestMonth={bestMonth}/>
                : <DisciplineProgressionChart progDisc={progDisc} progFormat={progFormat} races={progRaces}/>}
            </div>

            <div style={{fontFamily:"'Bebas Neue'",fontSize:18,letterSpacing:1.5,color:"#F0EDE8",marginBottom:12}}>📊 Saison en chiffres</div>
            <div style={{background:"linear-gradient(135deg, rgba(230,57,70,0.08), rgba(230,57,70,0.02))",border:"1px solid rgba(230,57,70,0.15)",borderRadius:16,padding:16,marginBottom:14}}>
              <div style={{display:"flex",alignItems:"baseline",justifyContent:"space-between",marginBottom:14}}>
                <div style={{fontFamily:"'Bebas Neue'",fontSize:20,letterSpacing:2,color:"#F0EDE8"}}>SAISON {season}</div>
                <div style={{fontSize:11,color:"rgba(240,237,232,0.45)",fontFamily:"'Barlow',sans-serif",fontWeight:700}}>vs {season-1}</div>
              </div>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:14}}>
                <KPICard label="Courses" value={courseCount} delta={courseDelta} year={season-1}/>
                <KPICard label="Volume km" value={`${Math.round(totalKm)} km`} delta={Math.round(totalKm-totalKmLast)} year={season-1} suffix=" km"/>
                <KPICard label="Dénivelé+" value={`${totalElev} m`} delta={totalElev-totalElevLast} year={season-1} suffix=" m"/>
                <KPICard label="Total points" value={totalPts} delta={totalPts-totalPtsLast} year={season-1} suffix=" pts"/>
              </div>
              {bestPerf && (
                <div onClick={()=>setEditResult(bestPerf)} style={{background:"rgba(255,215,0,0.08)",border:"1px solid rgba(255,215,0,0.2)",borderRadius:12,padding:"10px 14px",display:"flex",alignItems:"center",gap:12,cursor:"pointer"}}>
                  <div style={{fontSize:22}}>🏆</div>
                  <div style={{flex:1,minWidth:0}}>
                    <div style={{fontSize:9,color:"#FFD700",fontFamily:"'Barlow',sans-serif",fontWeight:700,letterSpacing:1.2,textTransform:"uppercase",marginBottom:2}}>MEILLEURE PERF</div>
                    <div style={{fontFamily:"'Bebas Neue'",fontSize:15,color:"#FFD700",letterSpacing:1,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>
                      {(DISCIPLINES[bestPerf.discipline]?.label||bestPerf.discipline).toUpperCase()} · {fmtRaceTime(bestPerf.time)}{bestPerf.race?` · ${bestPerf.race.toUpperCase()}`:""}
                    </div>
                  </div>
                </div>
              )}
            </div>
          </>
        )}
      </PullToRefresh>
      {editResult && <ResultModal existing={editResult} userId={userId} onSave={()=>{setEditResult(null);reload();onActivityChange?.();}} onClose={()=>setEditResult(null)}/>}
      {editSwim && <TrainingModal existing={editSwim} userId={userId} onSave={()=>{setEditSwim(null);reload();onActivityChange?.();}} onClose={()=>setEditSwim(null)}/>}
      {editRun && <TrainingModal existing={editRun} userId={userId} onSave={()=>{setEditRun(null);reload();onActivityChange?.();}} onClose={()=>setEditRun(null)}/>}
    </div>
  );
}

function KPICard({label, value, delta, year, suffix=""}) {
  let deltaText="", deltaColor="rgba(240,237,232,0.4)";
  if (delta>0) { deltaText=`↗ +${delta}${suffix} vs ${year}`; deltaColor="#4ADE80"; }
  else if (delta===0) { deltaText=`= stable vs ${year}`; }
  else { deltaText=`vs ${year}`; }
  return (
    <div style={{background:"rgba(255,255,255,0.03)",borderRadius:12,padding:"10px 12px"}}>
      <div style={{fontSize:9,color:"rgba(240,237,232,0.4)",fontFamily:"'Barlow',sans-serif",fontWeight:700,letterSpacing:1,textTransform:"uppercase",marginBottom:4}}>{label}</div>
      <div style={{fontFamily:"'Bebas Neue'",fontSize:24,color:"#F0EDE8",letterSpacing:1,lineHeight:1}}>{value}</div>
      <div style={{fontSize:10,color:deltaColor,fontFamily:"'Barlow',sans-serif",fontWeight:700,marginTop:6,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{deltaText}</div>
    </div>
  );
}

function ChartStat({label, value, color}) {
  return (
    <div style={{flex:1,background:"rgba(255,255,255,0.03)",borderRadius:10,padding:"8px 10px",textAlign:"center",minWidth:0}}>
      <div style={{fontFamily:"'Bebas Neue'",fontSize:14,color:color||"#F0EDE8",letterSpacing:0.5,lineHeight:1.1,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{value}</div>
      <div style={{fontSize:8,color:"rgba(240,237,232,0.4)",fontFamily:"'Barlow',sans-serif",fontWeight:700,letterSpacing:1,textTransform:"uppercase",marginTop:4}}>{label}</div>
    </div>
  );
}

function PointsProgressionChart({monthlyData, last12Total, yoyDelta, bestMonth}) {
  const W=320, H=110, PL=12, PR=12, PT=12, PB=22;
  const chartW=W-PL-PR, chartH=H-PT-PB;
  const max=Math.max(...monthlyData.map(m=>m.value), 1);
  const xOf=i => PL + (i/(monthlyData.length-1))*chartW;
  const yOf=v => PT + (1 - v/max)*chartH;
  const pts=monthlyData.map((m,i)=>({x:xOf(i), y:yOf(m.value), ...m}));
  const path=pts.map((p,i)=>`${i===0?"M":"L"}${p.x},${p.y}`).join(" ");
  const lastPt=pts[pts.length-1];
  const labelIdxs=monthlyData.map((_,i)=>i).filter(i=>i%2===0||i===monthlyData.length-1);

  return (
    <div>
      <div style={{fontSize:11,color:"rgba(240,237,232,0.45)",fontFamily:"'Barlow',sans-serif",fontWeight:600,marginBottom:10}}>Sur les 12 derniers mois</div>
      <svg viewBox={`0 0 ${W} ${H}`} style={{width:"100%",overflow:"visible",marginBottom:10}}>
        <defs>
          <linearGradient id="ptsGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#E63946" stopOpacity="0.4"/>
            <stop offset="100%" stopColor="#E63946" stopOpacity="0"/>
          </linearGradient>
        </defs>
        <path d={`${path} L${lastPt.x},${PT+chartH} L${pts[0].x},${PT+chartH} Z`} fill="url(#ptsGrad)"/>
        <path d={path} fill="none" stroke="#E63946" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/>
        <circle cx={lastPt.x} cy={lastPt.y} r="6" fill="#E63946" opacity="0.4">
          <animate attributeName="r" values="5;13;5" dur="1.6s" repeatCount="indefinite"/>
          <animate attributeName="opacity" values="0.5;0;0.5" dur="1.6s" repeatCount="indefinite"/>
        </circle>
        <circle cx={lastPt.x} cy={lastPt.y} r="3.5" fill="#E63946"/>
        {labelIdxs.map(i => (
          <text key={i} x={xOf(i)} y={H-6} textAnchor="middle" fill="rgba(240,237,232,0.4)" fontSize="9" fontFamily="Barlow,sans-serif" fontWeight="600" letterSpacing="0.5">{monthlyData[i].label}</text>
        ))}
      </svg>
      <div style={{display:"flex",gap:8}}>
        <ChartStat label="Points 12 mois" value={last12Total}/>
        <ChartStat label="Vs an dernier" value={yoyDelta!==null?`${yoyDelta>=0?"+":""}${yoyDelta.toFixed(0)}%`:"—"} color={yoyDelta!==null && yoyDelta>0?"#4ADE80":undefined}/>
        <ChartStat label="Meilleur mois" value={bestMonth && bestMonth.value>0?`${bestMonth.label} ${String(bestMonth.year).slice(-2)}`:"—"}/>
      </div>
    </div>
  );
}

function DisciplineProgressionChart({progDisc, progFormat, races}) {
  const discObj = PR_DISCIPLINES.find(d => d.key === progDisc);
  const discLabel = discObj?.label || progDisc;
  const isAll = progFormat === "all";
  const formatObj = !isAll ? discObj?.formats.find(f => f.disc === progFormat) : null;
  const formatLabel = formatObj?.label || progFormat;

  if (races.length === 0) {
    return (
      <div style={{textAlign:"center",padding:"40px 12px",color:"rgba(240,237,232,0.5)",fontFamily:"'Barlow',sans-serif",fontSize:13}}>
        Aucune course de ce type. Lance-toi !
      </div>
    );
  }

  const firstYear = rYear(races[0]);
  const subTitle = isAll
    ? `Toutes tes courses ${discLabel} depuis ${firstYear}`
    : `Tes ${races.length} ${pluralFormat(formatLabel, races.length)} depuis ${firstYear}`;

  const ptsOf = r => calcPoints(r.discipline, r.time, r.elevation);
  const yvalOf = r => isAll ? ptsOf(r) : r.time;
  const labelOf = r => isAll ? `${ptsOf(r)}` : fmtTimeShort(r.time);

  const prRace = isAll
    ? [...races].sort((a,b) => ptsOf(b) - ptsOf(a))[0]
    : [...races].sort((a,b) => a.time - b.time)[0];
  const prVal = yvalOf(prRace);

  if (races.length === 1) {
    const r = races[0];
    return (
      <div>
        <div style={{fontSize:11,color:"rgba(240,237,232,0.45)",fontFamily:"'Barlow',sans-serif",fontWeight:600,marginBottom:14}}>{subTitle}</div>
        <div style={{display:"flex",alignItems:"center",justifyContent:"center",padding:"22px 12px",gap:14}}>
          <div style={{width:14,height:14,borderRadius:"50%",background:"#FFD700",boxShadow:"0 0 0 6px rgba(255,215,0,0.25)"}}/>
          <div>
            <div style={{fontFamily:"'Bebas Neue'",fontSize:22,color:"#FFD700",letterSpacing:1,lineHeight:1}}>
              {isAll ? `${labelOf(r)} pts` : labelOf(r)}
            </div>
            <div style={{fontSize:10,color:"rgba(240,237,232,0.4)",fontFamily:"'Barlow',sans-serif",marginTop:4}}>{rYear(r)}</div>
          </div>
        </div>
        <div style={{textAlign:"center",fontSize:12,color:"rgba(240,237,232,0.5)",fontFamily:"'Barlow',sans-serif",marginTop:6,marginBottom:8}}>Encore 1 course pour voir ta progression</div>
        <div style={{display:"flex",gap:8,marginTop:10}}>
          {isAll ? <>
            <ChartStat label="Total points" value={prVal}/>
            <ChartStat label="Meilleure" value={`${formatLabelFromDisc(prRace.discipline)} · ${prVal} pts`} color="#FFD700"/>
            <ChartStat label="Courses" value={races.length}/>
          </> : <>
            <ChartStat label="Record actuel" value={fmtTimeShort(prVal)} color="#FFD700"/>
            <ChartStat label="Courses" value={races.length}/>
          </>}
        </div>
      </div>
    );
  }

  const W=320, H=140, PL=14, PR_PAD=14, PT=26, PB=22;
  const chartW=W-PL-PR_PAD, chartH=H-PT-PB;
  const vals = races.map(yvalOf);
  const min = Math.min(...vals), max = Math.max(...vals), range = (max-min)||1;
  const xOf = i => PL + (i/(races.length-1))*chartW;
  const yOf = v => isAll
    ? PT + (1 - (v-min)/range) * chartH
    : PT + ((v-min)/range) * chartH;
  const pts = races.map((r,i) => ({x:xOf(i), y:yOf(yvalOf(r)), r, isPR: yvalOf(r) === prVal}));
  const path = pts.map((p,i) => `${i===0?"M":"L"}${p.x},${p.y}`).join(" ");
  const years = [...new Set(races.map(r => rYear(r)))].sort((a,b) => a-b);
  const yearXs = years.map(y => {
    const idx = races.findIndex(r => rYear(r) === y);
    return {y, x:xOf(idx)};
  });

  const totalPts = races.reduce((s, r) => s + ptsOf(r), 0);
  const bestRaceLabel = `${formatLabelFromDisc(prRace.discipline)} · ${ptsOf(prRace)} pts`;
  const firstVal = yvalOf(races[0]);
  const diff = firstVal - prVal;
  const diffStr = (() => {
    const m = Math.floor(diff/60), s = Math.round(diff%60);
    return m > 0 ? `-${m}'${String(s).padStart(2,"0")}` : `-${s}s`;
  })();

  return (
    <div>
      <div style={{fontSize:11,color:"rgba(240,237,232,0.45)",fontFamily:"'Barlow',sans-serif",fontWeight:600,marginBottom:10}}>{subTitle}</div>
      <svg viewBox={`0 0 ${W} ${H}`} style={{width:"100%",overflow:"visible",marginBottom:10}}>
        <defs>
          <linearGradient id="discGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#E63946" stopOpacity="0.4"/>
            <stop offset="100%" stopColor="#E63946" stopOpacity="0"/>
          </linearGradient>
        </defs>
        <path d={`${path} L${pts[pts.length-1].x},${PT+chartH} L${pts[0].x},${PT+chartH} Z`} fill="url(#discGrad)"/>
        <path d={path} fill="none" stroke="#E63946" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/>
        {pts.map((p,i) => p.isPR ? (
          <g key={i}>
            <circle cx={p.x} cy={p.y} r="11" fill="#FFD700" opacity="0.25"/>
            <circle cx={p.x} cy={p.y} r="6" fill="#FFD700"/>
            <text x={p.x} y={p.y-14} textAnchor="middle" fill="#FFD700" fontSize="10" fontWeight="700" fontFamily="Bebas Neue" letterSpacing="0.5">
              {isAll ? `${labelOf(p.r)} pts PR` : `${labelOf(p.r)} PR`}
            </text>
          </g>
        ) : (
          <g key={i}>
            <circle cx={p.x} cy={p.y} r="4" fill="#E63946"/>
            <text x={p.x} y={p.y-9} textAnchor="middle" fill="rgba(240,237,232,0.7)" fontSize="9" fontWeight="600" fontFamily="Barlow,sans-serif">{labelOf(p.r)}</text>
          </g>
        ))}
        {yearXs.map(({y,x})=>(
          <text key={y} x={x} y={H-6} textAnchor="middle" fill="rgba(240,237,232,0.4)" fontSize="9" fontFamily="Barlow,sans-serif" fontWeight="600">{y}</text>
        ))}
      </svg>
      <div style={{display:"flex",gap:8}}>
        {isAll ? <>
          <ChartStat label="Total points" value={totalPts}/>
          <ChartStat label="Meilleure course" value={bestRaceLabel} color="#FFD700"/>
          <ChartStat label="Courses" value={races.length}/>
        </> : <>
          <ChartStat label="Record actuel" value={fmtTimeShort(prVal)} color="#FFD700"/>
          <ChartStat label={`Vs 1er ${formatLabel.toLowerCase()}`} value={diff>0?diffStr:"—"} color={diff>0?"#4ADE80":undefined}/>
          <ChartStat label="Courses" value={races.length}/>
        </>}
      </div>
    </div>
  );
}

// ── CHAT MODAL ────────────────────────────────────────────────────────────────
function ChatModal({myId,title,table,filterCol,filterId,friendId,onClose}){
  const [messages,setMessages]=useState([]);
  const [profiles,setProfiles]=useState({});
  const [text,setText]=useState("");
  const bottomRef=useRef(null);

  const load=async()=>{
    let q=supabase.from(table).select("*").order("created_at",{ascending:true});
    if(table==="direct_messages") q=q.or(`and(sender_id.eq.${myId},receiver_id.eq.${friendId}),and(sender_id.eq.${friendId},receiver_id.eq.${myId})`);
    else q=q.eq(filterCol,filterId);
    const{data}=await q;
    setMessages(data||[]);
    const ids=[...new Set((data||[]).map(m=>m.sender_id))];
    if(ids.length){
      const{data:ps}=await supabase.from("profiles").select("id,name,avatar").in("id",ids);
      const map={};(ps||[]).forEach(p=>map[p.id]=p);setProfiles(map);
    }
  };

  useEffect(()=>{
    load();
    const channel=supabase.channel(`chat-${table}-${filterId}`)
      .on("postgres_changes",{event:"INSERT",schema:"public",table},(payload)=>{
        setMessages(m=>[...m,payload.new]);
        if(payload.new.sender_id!==myId){
          supabase.from("profiles").select("id,name,avatar").eq("id",payload.new.sender_id).single()
            .then(({data})=>{if(data)setProfiles(p=>({...p,[data.id]:data}));});
        }
      }).subscribe();
    return()=>supabase.removeChannel(channel);
  },[filterId]);

  useEffect(()=>{bottomRef.current?.scrollIntoView({behavior:"smooth"});},[messages]);

  const send=async()=>{
    if(!text.trim())return;
    const payload=table==="direct_messages"
      ?{sender_id:myId,receiver_id:friendId,content:text.trim()}
      :{[filterCol]:filterId,sender_id:myId,content:text.trim()};
    await supabase.from(table).insert(payload);
    setText("");
  };

  const onKey=e=>{if(e.key==="Enter"&&!e.shiftKey){e.preventDefault();send();}};

  return(
    <Modal onClose={onClose}>
      <div style={{fontFamily:"'Bebas Neue'",fontSize:22,color:"#F0EDE8",letterSpacing:1,marginBottom:12}}>{title}</div>
      <div style={{height:"clamp(240px, 48dvh, 380px)",overflowY:"auto",display:"flex",flexDirection:"column",gap:8,marginBottom:12,paddingRight:4}}>
        {messages.length===0&&<div style={{textAlign:"center",color:"#444",padding:"40px 0",fontFamily:"'Barlow',sans-serif",fontSize:13}}>Aucun message</div>}
        {messages.map((m,i)=>{
          const mine=m.sender_id===myId;
          const sender=profiles[m.sender_id];
          return(
            <div key={i} style={{display:"flex",flexDirection:mine?"row-reverse":"row",alignItems:"flex-end",gap:6}}>
              {!mine&&<Avatar profile={sender} size={26}/>}
              <div style={{maxWidth:"72%"}}>
                {!mine&&<div style={{fontSize:10,color:"rgba(240,237,232,0.35)",fontFamily:"'Barlow',sans-serif",marginBottom:2,marginLeft:4}}>{sender?.name||"?"}</div>}
                <div style={{background:mine?"#E63946":"rgba(255,255,255,0.08)",borderRadius:mine?"14px 14px 4px 14px":"14px 14px 14px 4px",padding:"8px 12px",color:"#F0EDE8",fontFamily:"'Barlow',sans-serif",fontSize:13,lineHeight:1.4}}>
                  {m.content}
                </div>
                <div style={{fontSize:9,color:"rgba(240,237,232,0.2)",fontFamily:"'Barlow',sans-serif",marginTop:2,textAlign:mine?"right":"left"}}>
                  {new Date(m.created_at).toLocaleTimeString("fr-FR",{hour:"2-digit",minute:"2-digit"})}
                </div>
              </div>
            </div>
          );
        })}
        <div ref={bottomRef}/>
      </div>
      <div style={{display:"flex",gap:8,alignItems:"flex-end",marginBottom:12}}>
        <textarea value={text} onChange={e=>setText(e.target.value)} onKeyDown={onKey}
          placeholder="Message…" rows={1}
          style={{flex:1,background:"rgba(255,255,255,0.06)",border:"1px solid rgba(255,255,255,0.1)",borderRadius:12,padding:"10px 14px",color:"#F0EDE8",fontSize:16,fontFamily:"'Barlow',sans-serif",outline:"none",resize:"none",boxSizing:"border-box"}}/>
        <button onClick={send} style={{background:"#E63946",border:"none",borderRadius:12,width:42,height:42,cursor:"pointer",fontSize:18,flexShrink:0,display:"flex",alignItems:"center",justifyContent:"center"}}>➤</button>
      </div>
    </Modal>
  );
}

// ── SOCIAL TAB ────────────────────────────────────────────────────────────────
function SocialTab({myProfile,onNotifsChange}){
  const [tab,setTab]=useState("friends");
  const [friends,setFriends]=useState([]);
  const [groups,setGroups]=useState([]);
  const [notifs,setNotifs]=useState([]);
  const [search,setSearch]=useState("");
  const [searchRes,setSearchRes]=useState([]);
  const [showCreate,setCreate]=useState(false);
  const [showJoin,setJoin]=useState(false);
  const [groupName,setGroupName]=useState("");
  const [joinCode,setJoinCode]=useState("");
  const [loading,setLoading]=useState(false);
  const [chat,setChat]=useState(null);
  const [openFriend,setOpenFriend]=useState(null);

  useEffect(()=>{loadFriends();loadGroups();loadNotifs();},[]);

  const loadFriends=async()=>{
    const{data:{user}}=await supabase.auth.getUser();
    const{data:fs}=await supabase.from("friendships").select("*").eq("user_id",user.id).eq("status","accepted");
    if(!fs||fs.length===0){setFriends([]);return;}
    const ids=fs.map(f=>f.friend_id);
    const{data:profiles}=await supabase.from("profiles").select("id,name,avatar,city,birth_year").in("id",ids);
    const byId=Object.fromEntries((profiles||[]).map(p=>[p.id,p]));
    setFriends(fs.map(f=>({...f,friend:byId[f.friend_id]||null})));
  };
  const loadNotifs=async()=>{
    const{data:{user}}=await supabase.auth.getUser();
    const{data}=await supabase.from("notifications").select("*, from_user:profiles!notifications_from_user_id_fkey(id,name,avatar,city,birth_year)").eq("user_id",user.id).eq("read",false).order("created_at",{ascending:false});
    setNotifs(data||[]);
  };
  const dismissNotif=async id=>{
    await supabase.from("notifications").update({read:true}).eq("id",id);
    setNotifs(n=>n.filter(x=>x.id!==id));
    onNotifsChange&&onNotifsChange();
  };
  const markAllNotifsRead=async()=>{
    if(notifs.length===0)return;
    const{data:{user}}=await supabase.auth.getUser();
    await supabase.from("notifications").update({read:true}).eq("user_id",user.id).eq("read",false);
    setNotifs([]);
    onNotifsChange&&onNotifsChange();
  };
  const loadGroups=async()=>{
    const{data:{user}}=await supabase.auth.getUser();
    const{data}=await supabase.from("group_members").select("*, group:groups(*)").eq("user_id",user.id);
    setGroups(data?.map(d=>d.group)||[]);
  };
  const handleSearch=async q=>{
    setSearch(q);if(q.length<2){setSearchRes([]);return;}
    const{data:{user}}=await supabase.auth.getUser();
    const{data}=await supabase.from("profiles").select("*").ilike("name",`%${q}%`).neq("id",user.id).limit(10);
    setSearchRes(data||[]);
  };
  const addFriend=async friendId=>{
    const stub=searchRes.find(p=>p.id===friendId);
    if(stub)setFriends(f=>f.some(x=>x.friend?.id===friendId)?f:[...f,{friend:{id:stub.id,name:stub.name,avatar:stub.avatar,city:stub.city,birth_year:stub.birth_year}}]);
    const{error}=await supabase.rpc("add_friend",{p_friend_id:friendId});
    if(error){setFriends(f=>f.filter(x=>x.friend?.id!==friendId));return;}
    loadFriends();
  };
  const removeFriend=async friendId=>{
    setFriends(f=>f.filter(x=>x.friend?.id!==friendId));
    await supabase.rpc("remove_friend",{p_friend_id:friendId});
    loadFriends();loadNotifs();onNotifsChange&&onNotifsChange();
  };
  const createGroup=async()=>{
    if(!groupName)return;setLoading(true);
    const{data:{user}}=await supabase.auth.getUser();
    const code=Math.random().toString(36).substring(2,8).toUpperCase();
    const{data:g}=await supabase.from("groups").insert({name:groupName,created_by:user.id,code}).select().single();
    if(g)await supabase.from("group_members").insert({group_id:g.id,user_id:user.id});
    setGroupName("");setCreate(false);setLoading(false);loadGroups();
  };
  const joinGroup=async()=>{
    if(!joinCode)return;setLoading(true);
    const{data:{user}}=await supabase.auth.getUser();
    const{data:g}=await supabase.from("groups").select("*").eq("code",joinCode.toUpperCase()).single();
    if(g)await supabase.from("group_members").upsert({group_id:g.id,user_id:user.id},{onConflict:"group_id,user_id"});
    setJoinCode("");setJoin(false);setLoading(false);loadGroups();
  };
  const deleteGroup=async groupId=>{
    const{data:{user}}=await supabase.auth.getUser();
    await supabase.from("group_members").delete().eq("group_id",groupId).eq("user_id",user.id);
    loadGroups();
  };

  return (
    <div style={{flex:1,minHeight:0,display:"flex",flexDirection:"column",overflow:"hidden"}}>
      <div style={{flexShrink:0,padding:"0 16px"}}>
        <div style={{fontFamily:"'Bebas Neue'",fontSize:28,letterSpacing:2,color:"#F0EDE8",paddingTop:20,paddingBottom:12}}>Social</div>
      </div>
      <div style={{flex:1,overflowY:"auto",padding:"0 16px",paddingBottom:"calc(100px + env(safe-area-inset-bottom))",WebkitOverflowScrolling:"touch",boxSizing:"border-box"}}>
      <div style={{display:"flex",gap:6,marginBottom:14}}>
        {[["groups","🏠 Groupes"],["friends","💬 Tchat"],["search","🔍 Chercher"]].map(([k,l])=>(
          <button key={k} onClick={()=>setTab(k)} style={{flex:1,padding:"8px 0",borderRadius:12,border:"none",cursor:"pointer",background:tab===k?"#E63946":"rgba(255,255,255,0.06)",color:tab===k?"#fff":"rgba(240,237,232,0.5)",fontFamily:"'Barlow',sans-serif",fontWeight:600,fontSize:12,position:"relative"}}>
            {l}
            {k==="friends"&&myProfile?.in_app_enabled!==false&&notifs.length>0&&<span style={{position:"absolute",top:4,right:6,background:"#E63946",borderRadius:"50%",minWidth:16,height:16,padding:"0 4px",display:"inline-flex",alignItems:"center",justifyContent:"center",fontSize:9,color:"#fff",fontFamily:"'Bebas Neue'",fontWeight:700,lineHeight:1,border:tab===k?"1.5px solid #fff":"none"}}>{notifs.length>9?"9+":notifs.length}</span>}
          </button>
        ))}
      </div>
      {tab==="search"&&<div><Inp value={search} onChange={handleSearch} placeholder="Recherche par nom…"/>{searchRes.map(p=>{
        const isFriend=friends.some(f=>f.friend?.id===p.id);
        return(
        <div key={p.id} style={{display:"flex",alignItems:"center",gap:12,padding:"11px 14px",background:"rgba(255,255,255,0.03)",borderRadius:14,marginBottom:7,border:"1px solid rgba(255,255,255,0.05)"}}>
          <Avatar profile={p} size={36}/><div style={{flex:1}}><div style={{fontFamily:"'Barlow',sans-serif",fontWeight:700,fontSize:14,color:"#F0EDE8"}}>{p.name}</div><div style={{fontSize:11,color:"rgba(240,237,232,0.35)"}}>{p.city||""}</div></div>
          {isFriend
            ?<button onClick={()=>removeFriend(p.id)} style={{padding:"6px 12px",borderRadius:10,background:"rgba(255,255,255,0.06)",color:"rgba(240,237,232,0.7)",border:"1px solid rgba(255,255,255,0.12)",cursor:"pointer",fontFamily:"'Barlow',sans-serif",fontWeight:700,fontSize:12}}>Annuler</button>
            :<button onClick={()=>addFriend(p.id)} style={{padding:"6px 12px",borderRadius:10,background:"rgba(230,57,70,0.15)",color:"#E63946",border:"1px solid rgba(230,57,70,0.3)",cursor:"pointer",fontFamily:"'Barlow',sans-serif",fontWeight:700,fontSize:12}}>+ Ajouter</button>}
        </div>);})}</div>}
      {tab==="friends"&&<div>
        {myProfile?.in_app_enabled!==false && notifs.length>0&&<div style={{marginBottom:14}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
            <div style={{fontFamily:"'Barlow',sans-serif",fontSize:11,letterSpacing:1.5,textTransform:"uppercase",color:"rgba(240,237,232,0.5)",fontWeight:700}}>🔔 Notifications</div>
            <button onClick={markAllNotifsRead} style={{background:"none",border:"none",color:"rgba(240,237,232,0.4)",fontFamily:"'Barlow',sans-serif",fontSize:11,cursor:"pointer",fontWeight:600}}>Tout marquer lu</button>
          </div>
          {notifs.map(n=>{
            const txt = renderNotifLabel(n);
            const hasActor = NOTIF_HAS_ACTOR[n.type] !== false;
            const icon = NOTIF_ICON[n.type] || "🔔";
            return (
              <div key={n.id} style={{display:"flex",alignItems:"center",gap:12,padding:"10px 14px",background:"rgba(230,57,70,0.08)",borderRadius:14,marginBottom:7,border:"1px solid rgba(230,57,70,0.2)"}}>
                {hasActor && n.from_user
                  ? <div onClick={()=>setOpenFriend(n.from_user)} style={{cursor:"pointer"}}><Avatar profile={n.from_user} size={32}/></div>
                  : <div style={{width:32,height:32,borderRadius:"50%",background:"rgba(255,255,255,0.06)",border:"1px solid rgba(255,255,255,0.08)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:16,flexShrink:0}}>{icon}</div>}
                <div onClick={()=>hasActor && n.from_user && setOpenFriend(n.from_user)} style={{flex:1,minWidth:0,cursor:hasActor && n.from_user?"pointer":"default"}}>
                  <div style={{fontFamily:"'Barlow',sans-serif",fontSize:13,color:"#F0EDE8"}}>
                    {hasActor && <><strong>{n.from_user?.name||"Quelqu'un"}</strong>{" "}</>}
                    {txt}
                  </div>
                </div>
                <button onClick={()=>dismissNotif(n.id)} style={{padding:"5px 9px",borderRadius:10,background:"rgba(255,255,255,0.07)",color:"rgba(240,237,232,0.7)",border:"none",cursor:"pointer",fontSize:12}}>✕</button>
              </div>
            );
          })}
        </div>}
        {friends.length===0&&<div style={{textAlign:"center",color:"#444",padding:"40px 0",fontFamily:"'Barlow',sans-serif"}}>Aucun ami — utilise la recherche !</div>}
        {friends.map(f=>{
          const dmId=[myProfile?.id,f.friend_id].sort().join("_");
          return(
            <div key={f.id} onClick={()=>setChat({type:"dm",id:dmId,title:f.friend?.name||"Message",friendId:f.friend_id})} style={{display:"flex",alignItems:"center",gap:12,padding:"8px 4px",borderBottom:"1px solid rgba(255,255,255,0.04)",cursor:"pointer"}}>
              <Avatar profile={f.friend} size={36}/>
              <div style={{flex:1,minWidth:0}}>
                <div style={{fontFamily:"'Barlow',sans-serif",fontWeight:600,fontSize:14,color:"#F0EDE8",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{f.friend?.name||"Anonyme"}</div>
                <div style={{fontSize:11,color:"rgba(240,237,232,0.35)",marginTop:1}}><CategoryTooltip birthYear={f.friend?.birth_year}/>{getAgeCat(f.friend?.birth_year)&&f.friend?.city?" · ":""}{f.friend?.city||""}</div>
              </div>
              <div style={{color:"rgba(240,237,232,0.3)",fontSize:18,flexShrink:0}}>›</div>
            </div>
          );
        })}

      </div>}
      {tab==="groups"&&<div>
        <div style={{display:"flex",gap:8,marginBottom:14}}>
          <button onClick={()=>setCreate(true)} style={{flex:1,padding:"10px 0",borderRadius:12,background:"rgba(230,57,70,0.1)",color:"#E63946",border:"1px solid rgba(230,57,70,0.3)",cursor:"pointer",fontFamily:"'Barlow',sans-serif",fontWeight:700,fontSize:13}}>+ Créer</button>
          <button onClick={()=>setJoin(true)} style={{flex:1,padding:"10px 0",borderRadius:12,background:"rgba(255,255,255,0.06)",color:"rgba(240,237,232,0.6)",border:"none",cursor:"pointer",fontFamily:"'Barlow',sans-serif",fontWeight:700,fontSize:13}}>Rejoindre</button>
        </div>
        {groups.map(g=>(
          <div key={g.id} style={{padding:"13px 16px",background:"rgba(255,255,255,0.03)",borderRadius:14,marginBottom:8,border:"1px solid rgba(255,255,255,0.05)",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
            <div style={{flex:1,minWidth:0}}>
              <div style={{fontFamily:"'Barlow',sans-serif",fontWeight:700,fontSize:14,color:"#F0EDE8"}}>{g.name}</div>
              <div style={{fontSize:11,color:"rgba(240,237,232,0.3)",marginTop:3,letterSpacing:2,fontFamily:"'Barlow',sans-serif"}}>Code : <span style={{color:"#E63946",fontWeight:700}}>{g.code}</span></div>
            </div>
            <div style={{display:"flex",gap:6,flexShrink:0}}>
              <button onClick={()=>setChat({type:"group",id:g.id,title:g.name})} style={{padding:"6px 10px",borderRadius:10,background:"rgba(255,255,255,0.07)",color:"rgba(240,237,232,0.7)",border:"none",cursor:"pointer",fontSize:15}}>💬</button>
              <button onClick={()=>deleteGroup(g.id)} style={{padding:"6px 12px",borderRadius:10,background:"rgba(230,57,70,0.1)",color:"#E63946",border:"none",cursor:"pointer",fontSize:12,fontFamily:"'Barlow',sans-serif",fontWeight:700}}>Quitter</button>
            </div>
          </div>
        ))}
        {groups.length===0&&<div style={{textAlign:"center",color:"#444",padding:"30px 0",fontFamily:"'Barlow',sans-serif"}}>Aucun groupe</div>}
      </div>}
      {showCreate&&<Modal onClose={()=>setCreate(false)}><div style={{fontFamily:"'Bebas Neue'",fontSize:24,color:"#F0EDE8",marginBottom:20}}>Créer un groupe</div><Lbl c="Nom du groupe"/><Inp value={groupName} onChange={setGroupName} placeholder="Ex: Club de tri Paris"/><Btn onClick={createGroup} mb={0}>{loading?"Création...":"Créer"}</Btn></Modal>}
      {showJoin&&<Modal onClose={()=>setJoin(false)}><div style={{fontFamily:"'Bebas Neue'",fontSize:24,color:"#F0EDE8",marginBottom:20}}>Rejoindre un groupe</div><Lbl c="Code du groupe"/><Inp value={joinCode} onChange={setJoinCode} placeholder="Ex: ABC123"/><Btn onClick={joinGroup} mb={0}>{loading?"Recherche...":"Rejoindre"}</Btn></Modal>}
      {chat?.type==="dm"&&<ChatModal myId={myProfile?.id} title={`💬 ${chat.title}`} table="direct_messages" filterCol="sender_id" filterId={chat.id} friendId={chat.friendId} onClose={()=>setChat(null)}/>}
      {chat?.type==="group"&&<ChatModal myId={myProfile?.id} title={`🏠 ${chat.title}`} table="group_messages" filterCol="group_id" filterId={chat.id} onClose={()=>setChat(null)}/>}
      {openFriend&&<FriendProfileModal friend={openFriend} myId={myProfile?.id} onClose={()=>setOpenFriend(null)}/>}
    </div>
    </div>
  );
}

// ── BADGES BY CATEGORY ────────────────────────────────────────────────────────
function BadgesByCategory({badges}){
  const unlockedIds=new Set(badges.map(b=>b.id));
  return (
    <div style={{marginBottom:18}}>
      <div style={{fontSize:10,color:"rgba(240,237,232,0.35)",letterSpacing:1.5,textTransform:"uppercase",fontFamily:"'Barlow',sans-serif",marginBottom:10}}>Badges ({badges.length}/{BADGES.length})</div>
      {BADGE_CATEGORIES.map(cat=>{
        const items=BADGES.filter(b=>b.cat===cat.key);
        if(!items.length) return null;
        return (
          <div key={cat.key} style={{marginBottom:12}}>
            <div style={{fontSize:11,color:"rgba(240,237,232,0.5)",letterSpacing:1,fontFamily:"'Barlow',sans-serif",fontWeight:700,marginBottom:6}}>{cat.label}</div>
            <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
              {items.map(b=>{
                const un=unlockedIds.has(b.id);
                return (
                  <div key={b.id} title={b.label} style={{background:un?"rgba(255,255,255,0.04)":"rgba(255,255,255,0.02)",borderRadius:12,padding:"8px 10px",border:`1px solid ${un?b.color+"44":"rgba(255,255,255,0.05)"}`,textAlign:"center",opacity:un?1:0.45,minWidth:74}}>
                    <div style={{fontSize:20,filter:un?"none":"grayscale(1)"}}>{un?b.emoji:"🔒"}</div>
                    <div style={{fontSize:9,color:un?b.color:"rgba(240,237,232,0.35)",fontFamily:"'Barlow',sans-serif",fontWeight:700,marginTop:2,whiteSpace:"nowrap"}}>{b.label}</div>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── PROFILE MODAL ─────────────────────────────────────────────────────────────
function ProfileModal({profile,results,onRefresh,onClose,pushOptedIn,onEnablePush,onDisablePush}){
  const [showEdit,setShowEdit]=useState(false);
  const [showDelAcc,setDelAcc]=useState(false);
  const [showHelp,setShowHelp]=useState(false);
  const [friendCount,setFriendCount]=useState(0);
  const [trainings,setTrainings]=useState([]);
  const [groupsCreated,setGroupsCreated]=useState(0);
  const [showPhoto,setShowPhoto]=useState(false);
  const [season,setSeason]=useState(CY);
  const [panel,setPanel]=useState("races");
  const [friendsList,setFriendsList]=useState([]);
  const [openFriend,setOpenFriend]=useState(null);
  const [racesSearch,setRacesSearch]=useState("");
  const [racesDiscFilter,setRacesDiscFilter]=useState("Toutes");
  const [racesYearFilter,setRacesYearFilter]=useState("Toutes");
  const [editResult,setEditResult]=useState(null);
  const handleDeleteResult=async id=>{
    await supabase.from("results").delete().eq("id",id);
    onRefresh();
  };
  const [hidden,setHidden]=useState(!!profile?.ranking_hidden);
  useEffect(()=>{setHidden(!!profile?.ranking_hidden);},[profile?.ranking_hidden]);
  const [stravaTokens,setStravaTokens]=useState(null);
  const [stravaBusy,setStravaBusy]=useState(false);
  const [stravaMsg,setStravaMsg]=useState("");
  const [showStravaPending,setShowStravaPending]=useState(false);
  const [showDisconnectConfirm,setShowDisconnectConfirm]=useState(false);
  const [disconnecting,setDisconnecting]=useState(false);
  const [profileToast,setProfileToast]=useState("");
  useEffect(()=>{
    if(!profileToast)return;
    const t=setTimeout(()=>setProfileToast(""),3500);
    return()=>clearTimeout(t);
  },[profileToast]);
  useEffect(()=>{
    try{const raw=localStorage.getItem(`strava_${profile.id}`);if(raw)setStravaTokens(JSON.parse(raw));}catch{}
  },[profile.id]);
  // Strava est désactivé tant que la demande de quota n'est pas validée.
  // Garder cette constante en haut pour pouvoir la flipper à `true` quand
  // Strava aura validé — le reste de l'UI reste au format Brand Guidelines.
  const STRAVA_ENABLED=false;
  const connectStrava=()=>{
    if(!STRAVA_ENABLED){setShowStravaPending(true);return;}
    const url=`https://www.strava.com/oauth/authorize?client_id=230065&response_type=code&redirect_uri=${encodeURIComponent(window.location.origin)}&approval_prompt=auto&scope=read,activity:read&state=strava`;
    window.location.href=url;
  };
  const performDisconnectStrava=async()=>{
    setDisconnecting(true);
    try{
      const token=stravaTokens?.access_token;
      if(token){
        try{
          await fetch("/api/strava/deauthorize",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({access_token:token})});
        }catch(e){console.error("[Strava] deauthorize failed",e);}
      }
      const{error}=await supabase.from("trainings").delete().eq("user_id",profile.id).eq("source","strava");
      if(error)console.error("[Strava] purge trainings failed",error);
      try{localStorage.removeItem(`strava_${profile.id}`);}catch{}
      setStravaTokens(null);
      setStravaMsg("");
      setShowDisconnectConfirm(false);
      setProfileToast("✅ Strava déconnecté. Tes données importées seront purgées.");
      onRefresh();
    }finally{
      setDisconnecting(false);
    }
  };
  const ensureFreshToken=async()=>{
    let t=stravaTokens;
    if(!t)return null;
    if(t.expires_at&&t.expires_at>Date.now()/1000+30) return t;
    const r=await fetch("/api/strava/refresh",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({refresh_token:t.refresh_token})});
    const data=await r.json();
    if(!data?.access_token)throw new Error("Refresh échoué");
    const merged={...t,access_token:data.access_token,refresh_token:data.refresh_token||t.refresh_token,expires_at:data.expires_at};
    try{localStorage.setItem(`strava_${profile.id}`,JSON.stringify(merged));}catch{}
    setStravaTokens(merged);return merged;
  };
  const importStrava=async()=>{
    setStravaBusy(true);setStravaMsg("");
    try{
      const t=await ensureFreshToken();
      if(!t){setStravaMsg("Connexion Strava expirée");return;}
      const r=await fetch("https://www.strava.com/api/v3/athlete/activities?per_page=50",{headers:{Authorization:`Bearer ${t.access_token}`}});
      const acts=await r.json();
      if(!Array.isArray(acts)){setStravaMsg("Impossible de récupérer les activités");return;}
      const sportMap={Run:"Run",TrailRun:"Trail",Hike:"Trail",Ride:"Vélo",VirtualRide:"Vélo",MountainBikeRide:"Vélo",GravelRide:"Vélo",EBikeRide:"Vélo",Swim:"Natation"};
      const{data:existing}=await supabase.from("trainings").select("date,distance,sport").eq("user_id",profile.id);
      const seen=new Set((existing||[]).map(t=>`${t.date}|${t.sport}|${Math.round((t.distance||0)*10)}`));
      const inserts=[];
      acts.forEach(a=>{
        const sport=sportMap[a.type];if(!sport)return;
        const distance=+(a.distance/1000).toFixed(2);
        const duration=a.moving_time||0;
        const date=(a.start_date_local||a.start_date||"").slice(0,10);
        if(!date||!distance)return;
        const key=`${date}|${sport}|${Math.round(distance*10)}`;
        if(seen.has(key))return;
        seen.add(key);
        inserts.push({user_id:profile.id,sport,title:a.name||null,distance,duration,date,points:calcTrainingPts(distance,sport,duration),auto_detected_official:detectOfficialRace(a.name||""),source:"strava"});
      });
      if(inserts.length===0){setStravaMsg("Aucune nouvelle activité à importer");return;}
      const{error}=await supabase.from("trainings").insert(inserts);
      if(error){setStravaMsg("Erreur d'import : "+error.message);return;}
      setStravaMsg(`${inserts.length} activité${inserts.length>1?"s":""} importée${inserts.length>1?"s":""}`);
      onRefresh();
    }catch(e){setStravaMsg(e.message||"Import échoué");}
    finally{setStravaBusy(false);}
  };
  const seasonsRef=useRef(null);
  const badges=computeBadges({results,trainings,profile,friendCount,groupsCreated});
  const seasonResults=results.filter(r=>rYear(r)===season);
  const seasonTrainings=trainings.filter(t=>new Date(t.date).getFullYear()===season);
  const seasonPts=sumBestPts(seasonResults)+seasonTrainings.reduce((s,t)=>s+(effectiveTrainingPts(t)),0)+raceBonusPts(seasonResults,results)+trainingBonusPts(seasonTrainings);
  const lv=getSeasonLevel(seasonPts);

  useEffect(()=>{
    (async()=>{
      const{data:fs,count}=await supabase.from("friendships").select("friend_id",{count:"exact"}).eq("user_id",profile.id).eq("status","accepted");
      setFriendCount(count||0);
      const ids=(fs||[]).map(f=>f.friend_id);
      if(ids.length>0){
        const{data:profs}=await supabase.from("profiles").select("id,name,avatar,city,birth_year").in("id",ids);
        setFriendsList(profs||[]);
      }else{setFriendsList([]);}
    })();
    supabase.from("trainings").select("date,distance,duration,sport,points").eq("user_id",profile.id)
      .then(({data})=>setTrainings(data||[]));
    supabase.from("groups").select("id",{count:"exact",head:true}).eq("created_by",profile.id)
      .then(({count})=>setGroupsCreated(count||0));
  },[profile.id]);
  useEffect(()=>{setTimeout(()=>{if(seasonsRef.current)seasonsRef.current.scrollLeft=seasonsRef.current.scrollWidth;},50);},[]);

  return (
    <Modal onClose={onClose}>
      <div style={{position:"sticky",top:0,zIndex:5,background:"#161616",margin:"0 -20px",padding:"0 20px"}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16}}>
        <div style={{fontFamily:"'Bebas Neue'",fontSize:24,letterSpacing:2,color:"#F0EDE8"}}>Mon Profil</div>
        <div style={{display:"flex",gap:6}}>
          <button onClick={()=>setShowEdit(true)} style={{padding:"7px 12px",borderRadius:10,background:"rgba(255,255,255,0.07)",border:"none",color:"rgba(240,237,232,0.6)",cursor:"pointer",fontFamily:"'Barlow',sans-serif",fontSize:12,fontWeight:600}}>✏️ Éditer</button>
          <button onClick={async()=>{
            const newVal=!hidden;
            console.log("[hide-toggle] basculement vers",newVal);
            setHidden(newVal);
            const{error:err}=await supabase.from("profiles").update({ranking_hidden:newVal}).eq("id",profile.id);
            if(err){
              console.error("[hide-toggle] échec update",err);
              setHidden(!newVal);
              alert("Impossible de modifier la visibilité : "+(err.message||"erreur inconnue")+"\n\nAs-tu bien exécuté le SQL dans Supabase ? (alter table profiles add column ranking_hidden boolean default false;)");
              return;
            }
            console.log("[hide-toggle] OK");
            onRefresh();
          }} title={hidden?"Caché : me ré-afficher dans les classements":"Visible : me retirer des classements"} style={{padding:"7px 12px",borderRadius:10,background:hidden?"rgba(230,57,70,0.15)":"rgba(255,255,255,0.07)",border:hidden?"1px solid rgba(230,57,70,0.4)":"none",color:hidden?"#E63946":"rgba(240,237,232,0.6)",cursor:"pointer",fontFamily:"'Barlow',sans-serif",fontSize:12,fontWeight:600}}>{hidden?"🙈 Caché":"👁️ Visible"}</button>
        </div>
      </div>
      <div style={{display:"flex",gap:14,alignItems:"center",marginBottom:16}}>
        <div onClick={()=>profile?.avatar&&setShowPhoto(true)} style={{cursor:profile?.avatar?"pointer":"default"}}><Avatar profile={profile} size={64} highlight={lv.color}/></div>
        <div style={{flex:1,minWidth:0}}>
          <div style={{fontFamily:"'Bebas Neue'",fontSize:22,letterSpacing:1,color:"#F0EDE8",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{profile.name||"Athlète"}</div>
          <div style={{fontSize:12,color:"rgba(240,237,232,0.4)",fontFamily:"'Barlow',sans-serif",marginTop:2}}>{[profile.city,profile.birth_year&&<CategoryTooltip key="cat" birthYear={profile.birth_year}/>,profile.gender,profile.nationality].filter(Boolean).map((el,i,arr)=><span key={i}>{el}{i<arr.length-1?" · ":""}</span>)}</div>
          <div style={{marginTop:4}}><span style={{fontFamily:"'Bebas Neue'",fontSize:17,color:lv.color,letterSpacing:1}}>{lv.label}</span></div>
        </div>
        <div style={{textAlign:"right",flexShrink:0}}>
          <div style={{fontFamily:"'Bebas Neue'",fontSize:34,color:lv.color,letterSpacing:1,lineHeight:1}}>{seasonPts}</div>
          <div style={{fontSize:9,color:"rgba(240,237,232,0.5)",letterSpacing:1.5,textTransform:"uppercase",fontFamily:"'Barlow',sans-serif"}}>pts saison</div>
        </div>
      </div>
      <div style={{display:"flex",gap:10,marginBottom:18}}>
        <div onClick={()=>setPanel("amis")} style={{flex:1,background:panel==="amis"?"rgba(230,57,70,0.12)":"rgba(255,255,255,0.04)",borderRadius:12,padding:"12px",textAlign:"center",border:`1px solid ${panel==="amis"?"rgba(230,57,70,0.4)":"rgba(255,255,255,0.06)"}`,cursor:"pointer"}}>
          <div style={{fontFamily:"'Bebas Neue'",fontSize:26,color:panel==="amis"?"#E63946":"#F0EDE8"}}>{friendCount}</div>
          <div style={{fontSize:10,color:panel==="amis"?"#E63946":"rgba(240,237,232,0.35)",fontFamily:"'Barlow',sans-serif",letterSpacing:1,textTransform:"uppercase",fontWeight:panel==="amis"?700:400}}>Amis</div>
        </div>
        <div onClick={()=>setPanel("races")} style={{flex:1,background:panel==="races"?"rgba(230,57,70,0.12)":"rgba(255,255,255,0.04)",borderRadius:12,padding:"12px",textAlign:"center",border:`1px solid ${panel==="races"?"rgba(230,57,70,0.4)":"rgba(255,255,255,0.06)"}`,cursor:"pointer"}}>
          <div style={{fontFamily:"'Bebas Neue'",fontSize:26,color:panel==="races"?"#E63946":"#F0EDE8"}}>{results.length}</div>
          <div style={{fontSize:10,color:panel==="races"?"#E63946":"rgba(240,237,232,0.35)",fontFamily:"'Barlow',sans-serif",letterSpacing:1,textTransform:"uppercase",fontWeight:panel==="races"?700:400}}>Courses</div>
        </div>
        <div onClick={()=>setPanel("badges")} style={{flex:1,background:panel==="badges"?"rgba(230,57,70,0.12)":"rgba(255,255,255,0.04)",borderRadius:12,padding:"12px",textAlign:"center",border:`1px solid ${panel==="badges"?"rgba(230,57,70,0.4)":"rgba(255,255,255,0.06)"}`,cursor:"pointer"}}>
          <div style={{fontFamily:"'Bebas Neue'",fontSize:26,color:panel==="badges"?"#E63946":"#F0EDE8"}}>{badges.length}</div>
          <div style={{fontSize:10,color:panel==="badges"?"#E63946":"rgba(240,237,232,0.35)",fontFamily:"'Barlow',sans-serif",letterSpacing:1,textTransform:"uppercase",fontWeight:panel==="badges"?700:400}}>Badges</div>
        </div>
      </div>
      <div ref={seasonsRef} style={{display:"flex",alignItems:"center",gap:8,marginBottom:14,overflowX:"auto",scrollbarWidth:"none",WebkitOverflowScrolling:"touch",paddingBottom:4}}>
        {[CY-5,CY-4,CY-3,CY-2,CY-1,CY].map(y=>(
          <button key={y} onClick={()=>setSeason(y)} style={{flex:"0 0 calc((100% - 24px) / 4)",padding:"7px 0",borderRadius:20,border:"none",cursor:"pointer",background:season===y?"#E63946":"rgba(255,255,255,0.06)",color:season===y?"#fff":"rgba(240,237,232,0.4)",fontFamily:"'Bebas Neue'",fontSize:18,letterSpacing:1,display:"flex",alignItems:"center",justifyContent:"center",gap:6}}>
            {y}
            {y===CY&&<span style={{width:6,height:6,borderRadius:"50%",background:season===y?"rgba(255,255,255,0.9)":"#27AE60",flexShrink:0}}/>}
          </button>
        ))}
      </div>
      </div>
      <div style={{paddingTop:8}}>
      {panel==="amis"?(
        friendsList.length===0?
          <div style={{padding:"30px 20px",textAlign:"center",background:"rgba(255,255,255,0.03)",border:"1px solid rgba(255,255,255,0.06)",borderRadius:14,marginBottom:14}}>
            <div style={{fontSize:32,marginBottom:8}}>👥</div>
            <div style={{fontFamily:"'Barlow',sans-serif",fontSize:13,color:"rgba(240,237,232,0.55)"}}>Aucun ami pour le moment — utilise la recherche dans Social pour en ajouter !</div>
          </div>
        :<div style={{marginBottom:14}}>
          {friendsList.map(p=>(
            <div key={p.id} onClick={()=>setOpenFriend(p)} style={{display:"flex",alignItems:"center",gap:12,padding:"8px 4px",borderBottom:"1px solid rgba(255,255,255,0.04)",cursor:"pointer"}}>
              <Avatar profile={p} size={32}/>
              <div style={{flex:1,minWidth:0}}>
                <div style={{fontFamily:"'Barlow',sans-serif",fontWeight:600,fontSize:14,color:"#F0EDE8",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{p.name||"Athlète"}</div>
                <div style={{fontSize:11,color:"rgba(240,237,232,0.4)",fontFamily:"'Barlow',sans-serif",marginTop:1}}>{(()=>{const parts=[p.city,p.birth_year&&getAgeCat(p.birth_year)&&<CategoryTooltip key="cat" birthYear={p.birth_year}/>].filter(Boolean);return parts.length?parts.map((el,i,arr)=><span key={i}>{el}{i<arr.length-1?" · ":""}</span>):"—";})()}</div>
              </div>
              <div style={{color:"rgba(240,237,232,0.3)",fontSize:16,flexShrink:0}}>›</div>
            </div>
          ))}
        </div>
      ):panel==="badges"?(
        <BadgesByCategory badges={badges}/>
      ):(()=>{
        const DISC_CHIPS=[
          {k:"Toutes",cat:null},
          {k:"Course",cat:"running"},
          {k:"Trail",cat:"trail"},
          {k:"Triathlon",cat:"triathlon"},
          {k:"Hyrox",cat:"hyrox"},
        ];
        const years=[...new Set(results.map(r=>rYear(r)))].sort((a,b)=>b-a);
        const prByDisc=results.reduce((acc,r)=>{if(!acc[r.discipline]||r.time<acc[r.discipline].time)acc[r.discipline]=r;return acc;},{});
        const q=racesSearch.trim().toLowerCase();
        const filtered=[...results].filter(r=>{
          if(racesDiscFilter!=="Toutes"){
            const cat=DISC_CHIPS.find(c=>c.k===racesDiscFilter)?.cat;
            if(cat&&DISCIPLINES[r.discipline]?.category!==cat)return false;
            if(!cat)return false;
          }
          if(racesYearFilter!=="Toutes"&&String(rYear(r))!==String(racesYearFilter))return false;
          if(q){
            const hay=`${r.race||""} ${DISCIPLINES[r.discipline]?.label||""}`.toLowerCase();
            if(!hay.includes(q))return false;
          }
          return true;
        }).sort((a,b)=>(b.race_date||`${b.year}-12-31`).localeCompare(a.race_date||`${a.year}-12-31`));
        return (
          <div style={{marginBottom:14}}>
            <div style={{fontFamily:"'Bebas Neue'",fontSize:22,letterSpacing:1.5,color:"#F0EDE8",marginBottom:12,display:"flex",alignItems:"center",gap:8}}>🏁 Mes courses</div>
            <div style={{position:"relative",marginBottom:10}}>
              <span style={{position:"absolute",left:12,top:"50%",transform:"translateY(-50%)",fontSize:14,color:"rgba(240,237,232,0.4)",pointerEvents:"none"}}>🔍</span>
              <input value={racesSearch} onChange={e=>setRacesSearch(e.target.value)} placeholder="Rechercher une course…" style={{width:"100%",background:"rgba(255,255,255,0.05)",border:"1px solid rgba(255,255,255,0.1)",borderRadius:12,padding:"10px 12px 10px 36px",color:"#F0EDE8",fontSize:16,fontFamily:"'Barlow',sans-serif",outline:"none",boxSizing:"border-box"}}/>
            </div>
            <div style={{display:"flex",gap:5,overflowX:"auto",scrollbarWidth:"none",WebkitOverflowScrolling:"touch",marginBottom:8,paddingBottom:2}}>
              {DISC_CHIPS.map(({k})=>(
                <button key={k} onClick={()=>setRacesDiscFilter(k)} style={{flexShrink:0,padding:"5px 12px",borderRadius:20,border:"none",cursor:"pointer",background:racesDiscFilter===k?"#E63946":"rgba(255,255,255,0.06)",color:racesDiscFilter===k?"#fff":"rgba(240,237,232,0.5)",fontFamily:"'Barlow',sans-serif",fontWeight:600,fontSize:12}}>{k}</button>
              ))}
            </div>
            <div style={{display:"flex",gap:5,overflowX:"auto",scrollbarWidth:"none",WebkitOverflowScrolling:"touch",marginBottom:14,paddingBottom:2}}>
              {["Toutes",...years].map(y=>(
                <button key={y} onClick={()=>setRacesYearFilter(y)} style={{flexShrink:0,padding:"5px 12px",borderRadius:20,border:"none",cursor:"pointer",background:String(racesYearFilter)===String(y)?"#E63946":"rgba(255,255,255,0.06)",color:String(racesYearFilter)===String(y)?"#fff":"rgba(240,237,232,0.5)",fontFamily:"'Barlow',sans-serif",fontWeight:600,fontSize:12}}>{y}</button>
              ))}
            </div>
            {results.length===0?(
              <div style={{textAlign:"center",color:"#444",padding:"30px 0",fontFamily:"'Barlow',sans-serif",fontSize:13}}>Aucune course enregistrée</div>
            ):filtered.length===0?(
              <div style={{textAlign:"center",color:"#444",padding:"30px 0",fontFamily:"'Barlow',sans-serif",fontSize:13}}>Aucune course trouvée</div>
            ):filtered.map(r=>{
              const pts=calcPoints(r.discipline,r.time,r.elevation);
              const ptsLv=getLevel(pts);
              const isPR=prByDisc[r.discipline]?.id===r.id;
              return(
                <SwipeRow key={r.id} radius={12} mb={6} onDelete={()=>handleDeleteResult(r.id)}>
                  <div onClick={()=>setEditResult(r)} style={{display:"flex",justifyContent:"space-between",alignItems:"center",gap:10,padding:"11px 14px",background:"rgba(255,255,255,0.03)",borderRadius:12,border:"1px solid rgba(255,255,255,0.05)",cursor:"pointer"}}>
                    <div style={{flex:1,minWidth:0}}>
                      <div style={{fontSize:10,color:"rgba(240,237,232,0.45)",fontFamily:"'Barlow',sans-serif",marginBottom:2}}>{DISCIPLINES[r.discipline]?.icon} {DISCIPLINES[r.discipline]?.label} · {rYear(r)}</div>
                      <div style={{display:"flex",alignItems:"center",gap:6,flexWrap:"wrap"}}>
                        <div style={{fontFamily:"'Bebas Neue'",fontSize:18,color:"#F0EDE8",letterSpacing:1}}>{fmtTime(r.time)}</div>
                        {isPR&&<span style={{background:"rgba(255,215,0,0.15)",border:"1px solid rgba(255,215,0,0.35)",color:"#FFD700",fontSize:9,padding:"2px 5px",borderRadius:4,fontWeight:700,letterSpacing:0.5,fontFamily:"'Barlow',sans-serif"}}>PR</span>}
                      </div>
                      {r.race&&<div style={{fontSize:11,color:"rgba(240,237,232,0.5)",fontFamily:"'Barlow',sans-serif",marginTop:2,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{r.race}</div>}
                    </div>
                    <div style={{textAlign:"right",flexShrink:0}}>
                      <div style={{fontFamily:"'Bebas Neue'",fontSize:20,color:ptsLv.color,letterSpacing:1}}>{pts}</div>
                      <div style={{fontSize:9,color:"rgba(240,237,232,0.35)",fontFamily:"'Barlow',sans-serif",letterSpacing:1,textTransform:"uppercase"}}>pts</div>
                    </div>
                  </div>
                </SwipeRow>
              );
            })}
          </div>
        );
      })()}
      {openFriend&&<FriendProfileModal friend={openFriend} myId={profile?.id} onClose={()=>setOpenFriend(null)}/>}
      <div style={{paddingTop:10}}>
      <div style={{fontSize:11,color:"rgba(240,237,232,0.35)",letterSpacing:1.5,textTransform:"uppercase",fontFamily:"'Barlow',sans-serif",marginBottom:8}}>Connexions externes</div>
      <div style={{padding:"12px 14px",background:"rgba(255,255,255,0.03)",border:"1px solid rgba(255,255,255,0.06)",borderRadius:14,marginBottom:10}}>
        {!stravaTokens&&(
          <div style={{marginBottom:10}}>
            <div onClick={connectStrava} style={{cursor:STRAVA_ENABLED?"pointer":"not-allowed",opacity:STRAVA_ENABLED?1:0.7}}>
              <div style={{pointerEvents:"none"}}>
                <ConnectWithStravaButton onClick={undefined} disabled={!STRAVA_ENABLED}/>
              </div>
            </div>
            {!STRAVA_ENABLED&&(
              <div style={{textAlign:"center",fontSize:12,color:"rgba(240,237,232,0.6)",fontFamily:"'Barlow',sans-serif",marginTop:8}}>🔒 En attente de validation par Strava</div>
            )}
          </div>
        )}
        {stravaTokens&&(
          <>
            <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:10}}>
              <StravaLogoMark size={22}/>
              <div style={{flex:1,minWidth:0}}>
                <div style={{fontFamily:"'Barlow',sans-serif",fontWeight:700,fontSize:14,color:"#F0EDE8"}}>Strava</div>
                <div style={{fontSize:11,color:"#27AE60",fontFamily:"'Barlow',sans-serif",marginTop:1}}>● Connecté</div>
              </div>
            </div>
            <button onClick={importStrava} disabled={stravaBusy} style={{width:"100%",padding:"10px 0",borderRadius:10,background:"rgba(252,76,2,0.12)",border:"1px solid rgba(252,76,2,0.4)",color:"#FC4C02",cursor:stravaBusy?"wait":"pointer",fontFamily:"'Barlow',sans-serif",fontWeight:700,fontSize:13,marginBottom:8}}>{stravaBusy?"Import en cours…":"Importer mes activités"}</button>
            {stravaMsg&&<div style={{fontSize:11,color:"rgba(240,237,232,0.6)",fontFamily:"'Barlow',sans-serif",textAlign:"center",marginBottom:8}}>{stravaMsg}</div>}
          </>
        )}
        <button
          onClick={stravaTokens?()=>setShowDisconnectConfirm(true):undefined}
          disabled={!stravaTokens}
          title={stravaTokens?undefined:"Aucun compte Strava connecté"}
          style={{width:"100%",padding:"10px 0",borderRadius:10,background:"transparent",border:`1px solid ${stravaTokens?"rgba(230,57,70,0.4)":"rgba(255,255,255,0.08)"}`,color:stravaTokens?"#E63946":"rgba(240,237,232,0.35)",cursor:stravaTokens?"pointer":"not-allowed",fontFamily:"'Barlow',sans-serif",fontWeight:700,fontSize:13,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",gap:2}}
        >
          <span>🔌 Déconnecter Strava</span>
          {!stravaTokens&&<span style={{fontSize:10,fontWeight:500,color:"rgba(240,237,232,0.35)",letterSpacing:0.3}}>Aucun compte Strava connecté</span>}
        </button>
      </div>
      <div style={{marginBottom:10,padding:"12px 14px",borderRadius:14,background:"rgba(255,255,255,0.04)",border:"1px solid rgba(255,255,255,0.08)"}}>
        <div style={{fontFamily:"'Barlow',sans-serif",fontSize:11,letterSpacing:1.5,textTransform:"uppercase",color:"rgba(240,237,232,0.5)",fontWeight:700,marginBottom:10}}>🔔 Notifications</div>
        <button
          onClick={()=>{
            // One-way data flow : on agit sur OneSignal (source unique de
            // vérité), le listener du hook synchronise la DB. Aucune écriture
            // directe de profile.push_enabled ici.
            if(pushOptedIn) onDisablePush?.(); else onEnablePush?.();
          }}
          style={{width:"100%",padding:"10px 12px",borderRadius:10,background:"transparent",border:"none",color:"#F0EDE8",cursor:"pointer",fontFamily:"'Barlow',sans-serif",fontWeight:600,fontSize:13,display:"flex",alignItems:"center",justifyContent:"space-between",touchAction:"manipulation"}}
        >
          <span style={{flex:1,textAlign:"left"}}>Notifications push</span>
          <span aria-hidden="true" style={{width:36,height:20,borderRadius:999,background:pushOptedIn?"#4ADE80":"rgba(255,255,255,0.12)",position:"relative",transition:"background 0.2s",flexShrink:0}}>
            <span style={{position:"absolute",top:2,left:pushOptedIn?18:2,width:16,height:16,borderRadius:"50%",background:"#fff",transition:"left 0.2s"}}/>
          </span>
        </button>
        <button
          onClick={async()=>{
            const next = profile?.in_app_enabled===false;
            try{ await supabase.from("profiles").update({in_app_enabled:next}).eq("id",profile.id); onRefresh&&onRefresh(); }catch(e){console.error("[in_app_enabled] update failed",e);}
          }}
          style={{width:"100%",padding:"10px 12px",borderRadius:10,background:"transparent",border:"none",borderTop:"1px solid rgba(255,255,255,0.06)",color:"#F0EDE8",cursor:"pointer",fontFamily:"'Barlow',sans-serif",fontWeight:600,fontSize:13,display:"flex",alignItems:"center",justifyContent:"space-between",touchAction:"manipulation",marginTop:4}}
        >
          <span style={{flex:1,textAlign:"left"}}>Notifications dans l'app</span>
          <span aria-hidden="true" style={{width:36,height:20,borderRadius:999,background:profile?.in_app_enabled!==false?"#4ADE80":"rgba(255,255,255,0.12)",position:"relative",transition:"background 0.2s",flexShrink:0}}>
            <span style={{position:"absolute",top:2,left:profile?.in_app_enabled!==false?18:2,width:16,height:16,borderRadius:"50%",background:"#fff",transition:"left 0.2s"}}/>
          </span>
        </button>
      </div>
      <button onClick={()=>setShowHelp(true)} style={{width:"100%",padding:"12px 0",borderRadius:14,background:"rgba(255,255,255,0.05)",border:"1px solid rgba(255,255,255,0.08)",color:"#F0EDE8",cursor:"pointer",fontFamily:"'Barlow',sans-serif",fontWeight:700,fontSize:13,marginBottom:10}}>❓ Comment ça marche</button>
      <a href="/privacy-policy" target="_blank" rel="noopener noreferrer" style={{display:"block",width:"100%",padding:"12px 0",borderRadius:14,background:"rgba(255,255,255,0.05)",border:"1px solid rgba(255,255,255,0.08)",color:"#F0EDE8",fontFamily:"'Barlow',sans-serif",fontWeight:700,fontSize:13,marginBottom:10,textAlign:"center",textDecoration:"none",boxSizing:"border-box"}}>🔒 Confidentialité</a>
      <button onClick={async()=>{await supabase.auth.signOut();}} style={{width:"100%",padding:"12px 0",borderRadius:14,background:"rgba(255,255,255,0.05)",border:"1px solid rgba(255,255,255,0.08)",color:"rgba(240,237,232,0.7)",cursor:"pointer",fontFamily:"'Barlow',sans-serif",fontWeight:700,fontSize:13,marginBottom:10}}>🚪 Se déconnecter</button>
      <button onClick={()=>setDelAcc(true)} style={{width:"100%",padding:"11px 0",borderRadius:14,background:"transparent",border:"1px solid rgba(230,57,70,0.2)",color:"rgba(230,57,70,0.5)",cursor:"pointer",fontFamily:"'Barlow',sans-serif",fontWeight:600,fontSize:13,marginBottom:14}}>Supprimer mon compte</button>
      <PoweredByStrava/>
      </div>
      </div>
      {showEdit&&<EditProfileModal profile={profile} onSave={()=>{setShowEdit(false);onRefresh();}} onClose={()=>setShowEdit(false)}/>}
      {showPhoto&&profile?.avatar&&<PhotoViewer src={profile.avatar} onClose={()=>setShowPhoto(false)}/>}
      {showDelAcc&&<DeleteAccountModal onClose={()=>setDelAcc(false)}/>}
      {showHelp&&<HowItWorksModal onClose={()=>setShowHelp(false)}/>}
      {editResult&&<ResultModal existing={editResult} userId={profile.id} onSave={()=>{setEditResult(null);onRefresh();}} onClose={()=>setEditResult(null)}/>}
      {showStravaPending&&(
        <Modal onClose={()=>setShowStravaPending(false)}>
          <div style={{fontFamily:"'Bebas Neue'",fontSize:22,letterSpacing:1.5,color:"#F0EDE8",marginBottom:8}}>Bientôt disponible</div>
          <div style={{fontSize:13,color:"rgba(240,237,232,0.7)",fontFamily:"'Barlow',sans-serif",marginBottom:18,lineHeight:1.5}}>Synchronisation Strava bientôt disponible. En attente de validation par Strava.</div>
          <Btn onClick={()=>setShowStravaPending(false)} mb={0}>OK</Btn>
        </Modal>
      )}
      {showDisconnectConfirm&&(
        <Modal onClose={()=>!disconnecting&&setShowDisconnectConfirm(false)}>
          <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:12}}>
            <StravaLogoMark size={26}/>
            <div style={{fontFamily:"'Bebas Neue'",fontSize:22,letterSpacing:1.5,color:"#F0EDE8"}}>Déconnecter Strava ?</div>
          </div>
          <div style={{fontSize:13,color:"rgba(240,237,232,0.75)",fontFamily:"'Barlow',sans-serif",marginBottom:18,lineHeight:1.55}}>Cette action supprimera immédiatement toutes tes activités importées de Strava et révoquera l'accès. Tu pourras reconnecter Strava plus tard si tu le souhaites.</div>
          <Btn onClick={performDisconnectStrava} disabled={disconnecting} variant="danger" mb={8}>{disconnecting?"Déconnexion…":"Oui, déconnecter Strava"}</Btn>
          <Btn onClick={()=>setShowDisconnectConfirm(false)} disabled={disconnecting} variant="secondary" mb={0}>Annuler</Btn>
        </Modal>
      )}
      {profileToast&&(
        <div style={{position:"fixed",left:16,right:16,bottom:"calc(20px + env(safe-area-inset-bottom))",zIndex:500,background:"rgba(20,20,20,0.97)",backdropFilter:"blur(12px)",border:"1px solid rgba(39,174,96,0.4)",borderRadius:14,padding:"12px 14px",color:"#F0EDE8",fontFamily:"'Barlow',sans-serif",fontSize:13,maxWidth:460,margin:"0 auto",boxShadow:"0 8px 24px rgba(0,0,0,0.45)",textAlign:"center"}}>{profileToast}</div>
      )}
    </Modal>
  );
}

// ── FRIEND PROFILE MODAL ──────────────────────────────────────────────────────
function ActivityCard({myId,activityType,activityId,children}){
  const [likes,setLikes]=useState([]);
  const [comments,setComments]=useState([]);
  const [showComments,setShowComments]=useState(false);
  const [text,setText]=useState("");
  const [sending,setSending]=useState(false);
  const liked=likes.some(l=>l.user_id===myId);

  useEffect(()=>{loadLikes();loadComments();},[activityId]);

  const loadLikes=async()=>{
    const{data}=await supabase.from("activity_likes").select("user_id").eq("activity_type",activityType).eq("activity_id",activityId);
    setLikes(data||[]);
  };
  const loadComments=async()=>{
    const{data}=await supabase.from("activity_comments").select("*, user:profiles(id,name,avatar)").eq("activity_type",activityType).eq("activity_id",activityId).order("created_at",{ascending:true});
    setComments(data||[]);
  };
  const toggleLike=async()=>{
    if(liked){
      await supabase.from("activity_likes").delete().eq("user_id",myId).eq("activity_type",activityType).eq("activity_id",activityId);
      setLikes(l=>l.filter(x=>x.user_id!==myId));
    }else{
      await supabase.from("activity_likes").insert({user_id:myId,activity_type:activityType,activity_id:activityId});
      setLikes(l=>[...l,{user_id:myId}]);
    }
  };
  const sendComment=async()=>{
    if(!text.trim()||sending)return;
    setSending(true);
    const{data}=await supabase.from("activity_comments").insert({user_id:myId,activity_type:activityType,activity_id:activityId,content:text.trim()}).select("*, user:profiles(id,name,avatar)").single();
    if(data)setComments(c=>[...c,data]);
    setText("");setSending(false);
  };
  const deleteComment=async id=>{
    await supabase.from("activity_comments").delete().eq("id",id);
    setComments(c=>c.filter(x=>x.id!==id));
  };

  return (
    <div style={{background:"rgba(255,255,255,0.03)",borderRadius:14,padding:"12px 14px",marginBottom:8,border:"1px solid rgba(255,255,255,0.05)"}}>
      {children}
      <div style={{display:"flex",gap:14,alignItems:"center",marginTop:10,paddingTop:10,borderTop:"1px solid rgba(255,255,255,0.05)"}}>
        <button onClick={toggleLike} style={{background:"none",border:"none",cursor:"pointer",display:"flex",alignItems:"center",gap:5,padding:0,color:liked?"#E63946":"rgba(240,237,232,0.5)",fontFamily:"'Barlow',sans-serif",fontSize:13,fontWeight:600}}>
          <span style={{fontSize:15}}>{liked?"❤️":"🤍"}</span>{likes.length>0&&likes.length}
        </button>
        <button onClick={()=>setShowComments(s=>!s)} style={{background:"none",border:"none",cursor:"pointer",display:"flex",alignItems:"center",gap:5,padding:0,color:"rgba(240,237,232,0.5)",fontFamily:"'Barlow',sans-serif",fontSize:13,fontWeight:600}}>
          <span style={{fontSize:14}}>💬</span>{comments.length>0&&comments.length}
        </button>
      </div>
      {showComments&&(
        <div style={{marginTop:10,paddingTop:10,borderTop:"1px solid rgba(255,255,255,0.05)"}}>
          {comments.map(c=>(
            <div key={c.id} style={{display:"flex",gap:8,marginBottom:8,alignItems:"flex-start"}}>
              <Avatar profile={c.user} size={26}/>
              <div style={{flex:1,minWidth:0,background:"rgba(255,255,255,0.04)",borderRadius:10,padding:"6px 10px"}}>
                <div style={{fontFamily:"'Barlow',sans-serif",fontSize:11,color:"rgba(240,237,232,0.5)",fontWeight:700}}>{c.user?.name||"?"}</div>
                <div style={{fontFamily:"'Barlow',sans-serif",fontSize:13,color:"#F0EDE8",marginTop:2,wordBreak:"break-word"}}>{c.content}</div>
              </div>
              {c.user_id===myId&&<button onClick={()=>deleteComment(c.id)} style={{background:"none",border:"none",color:"rgba(230,57,70,0.6)",cursor:"pointer",fontSize:11,padding:"2px 4px"}}>✕</button>}
            </div>
          ))}
          <div style={{display:"flex",gap:6,marginTop:6}}>
            <input value={text} onChange={e=>setText(e.target.value)} onKeyDown={e=>{if(e.key==="Enter")sendComment();}} placeholder="Commenter…" style={{flex:1,background:"rgba(255,255,255,0.05)",border:"1px solid rgba(255,255,255,0.08)",borderRadius:10,padding:"8px 12px",color:"#F0EDE8",fontSize:13,fontFamily:"'Barlow',sans-serif",outline:"none"}}/>
            <button onClick={sendComment} disabled={!text.trim()||sending} style={{background:"#E63946",border:"none",borderRadius:10,padding:"0 14px",color:"#fff",fontFamily:"'Barlow',sans-serif",fontWeight:700,fontSize:13,cursor:"pointer",opacity:!text.trim()||sending?0.4:1}}>OK</button>
          </div>
        </div>
      )}
    </div>
  );
}

function FriendProfileModal({friend,myId,onClose}){
  const [results,setResults]=useState([]);
  const [trainings,setTrainings]=useState([]);
  const [fullProfile,setFullProfile]=useState(friend);
  const [friendCount,setFriendCount]=useState(0);
  const [friendsList,setFriendsList]=useState([]);
  const [myFriendIds,setMyFriendIds]=useState(new Set());
  const [groupsCreated,setGroupsCreated]=useState(0);
  const [season,setSeason]=useState(CY);
  const [tab,setTab]=useState("races");
  const [panel,setPanel]=useState("courses");
  const [loading,setLoading]=useState(true);
  const [showPhoto,setShowPhoto]=useState(false);
  const [nestedFriend,setNestedFriend]=useState(null);
  const seasonsRef=useRef(null);

  useEffect(()=>{loadAll();},[friend.id]);
  useEffect(()=>{
    if(!myId)return;
    supabase.from("friendships").select("friend_id").eq("user_id",myId).eq("status","accepted")
      .then(({data})=>setMyFriendIds(new Set((data||[]).map(f=>f.friend_id))));
  },[myId]);
  const handleAddMyFriend=async(p)=>{
    setMyFriendIds(s=>{const n=new Set(s);n.add(p.id);return n;});
    const{error}=await supabase.rpc("add_friend",{p_friend_id:p.id});
    if(error){
      console.error("[add_friend]",error);
      setMyFriendIds(s=>{const n=new Set(s);n.delete(p.id);return n;});
    }
  };
  useEffect(()=>{setTimeout(()=>{if(seasonsRef.current)seasonsRef.current.scrollLeft=seasonsRef.current.scrollWidth;},50);},[]);

  const loadAll=async()=>{
    setLoading(true);
    const[{data:r},{data:t},{data:prof},{data:fs,count:fc},{count:gc}]=await Promise.all([
      supabase.from("results").select("*").eq("user_id",friend.id).order("year",{ascending:false}),
      supabase.from("trainings").select("*").eq("user_id",friend.id).order("date",{ascending:false}),
      supabase.from("profiles").select("*").eq("id",friend.id).single(),
      supabase.from("friendships").select("friend_id",{count:"exact"}).eq("user_id",friend.id).eq("status","accepted"),
      supabase.from("groups").select("id",{count:"exact",head:true}).eq("created_by",friend.id),
    ]);
    setResults(r||[]);setTrainings(t||[]);
    if(prof)setFullProfile(prof);
    setFriendCount(fc||0);setGroupsCreated(gc||0);
    const friendIds=(fs||[]).map(f=>f.friend_id);
    if(friendIds.length>0){
      const{data:profs}=await supabase.from("profiles").select("id,name,avatar,city,birth_year").in("id",friendIds);
      setFriendsList(profs||[]);
    }else{setFriendsList([]);}
    setLoading(false);
  };

  const seasonResults=results.filter(r=>r.year===season);
  const seasonTrainings=trainings.filter(t=>new Date(t.date).getFullYear()===season);
  const seasonPts=sumBestPts(seasonResults)+seasonTrainings.reduce((s,t)=>s+(effectiveTrainingPts(t)),0)+raceBonusPts(seasonResults,results)+trainingBonusPts(seasonTrainings);
  const lv=getSeasonLevel(seasonPts);
  const badges=computeBadges({results,trainings,profile:fullProfile,friendCount,groupsCreated});

  return (
    <Modal onClose={onClose} fullScreen>
      <div style={{display:"flex",gap:14,alignItems:"center",marginBottom:14}}>
        <div onClick={()=>fullProfile?.avatar&&setShowPhoto(true)} style={{cursor:fullProfile?.avatar?"pointer":"default"}}><Avatar profile={fullProfile} size={64} highlight={lv.color}/></div>
        <div style={{flex:1,minWidth:0}}>
          <div style={{fontFamily:"'Bebas Neue'",fontSize:22,letterSpacing:1,color:"#F0EDE8",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{fullProfile?.name||friend.name||"Athlète"}</div>
          <div style={{fontSize:12,color:"rgba(240,237,232,0.4)",fontFamily:"'Barlow',sans-serif",marginTop:2}}>{[fullProfile?.city,fullProfile?.birth_year&&<CategoryTooltip key="cat" birthYear={fullProfile.birth_year}/>,fullProfile?.gender,fullProfile?.nationality].filter(Boolean).map((el,i,arr)=><span key={i}>{el}{i<arr.length-1?" · ":""}</span>)}</div>
          <div style={{marginTop:4}}><span style={{fontFamily:"'Bebas Neue'",fontSize:17,color:lv.color,letterSpacing:1}}>{lv.label}</span></div>
        </div>
      </div>

      <div style={{background:`${lv.color}10`,border:`1px solid ${lv.color}33`,borderRadius:14,padding:"12px 16px",marginBottom:14,display:"flex",alignItems:"baseline",justifyContent:"center",gap:10}}>
        <div style={{fontFamily:"'Bebas Neue'",fontSize:34,color:lv.color,letterSpacing:1,lineHeight:1}}>{seasonPts}</div>
        <div style={{fontSize:10,color:"rgba(240,237,232,0.55)",letterSpacing:1.5,textTransform:"uppercase",fontFamily:"'Barlow',sans-serif",fontWeight:700}}>pts saison</div>
      </div>

      <div style={{display:"flex",gap:10,marginBottom:14}}>
        <div onClick={()=>setPanel("amis")} style={{flex:1,background:panel==="amis"?"rgba(230,57,70,0.12)":"rgba(255,255,255,0.04)",borderRadius:12,padding:"12px",textAlign:"center",border:`1px solid ${panel==="amis"?"rgba(230,57,70,0.4)":"rgba(255,255,255,0.06)"}`,cursor:"pointer"}}>
          <div style={{fontFamily:"'Bebas Neue'",fontSize:26,color:panel==="amis"?"#E63946":"#F0EDE8"}}>{friendCount}</div>
          <div style={{fontSize:10,color:panel==="amis"?"#E63946":"rgba(240,237,232,0.35)",fontFamily:"'Barlow',sans-serif",letterSpacing:1,textTransform:"uppercase",fontWeight:panel==="amis"?700:400}}>Amis</div>
        </div>
        <div onClick={()=>setPanel("courses")} style={{flex:1,background:panel==="courses"?"rgba(230,57,70,0.12)":"rgba(255,255,255,0.04)",borderRadius:12,padding:"12px",textAlign:"center",border:`1px solid ${panel==="courses"?"rgba(230,57,70,0.4)":"rgba(255,255,255,0.06)"}`,cursor:"pointer"}}>
          <div style={{fontFamily:"'Bebas Neue'",fontSize:26,color:panel==="courses"?"#E63946":"#F0EDE8"}}>{results.length}</div>
          <div style={{fontSize:10,color:panel==="courses"?"#E63946":"rgba(240,237,232,0.35)",fontFamily:"'Barlow',sans-serif",letterSpacing:1,textTransform:"uppercase",fontWeight:panel==="courses"?700:400}}>Courses</div>
        </div>
        <div onClick={()=>setPanel("badges")} style={{flex:1,background:panel==="badges"?"rgba(230,57,70,0.12)":"rgba(255,255,255,0.04)",borderRadius:12,padding:"12px",textAlign:"center",border:`1px solid ${panel==="badges"?"rgba(230,57,70,0.4)":"rgba(255,255,255,0.06)"}`,cursor:"pointer"}}>
          <div style={{fontFamily:"'Bebas Neue'",fontSize:26,color:panel==="badges"?"#E63946":"#F0EDE8"}}>{badges.length}</div>
          <div style={{fontSize:10,color:panel==="badges"?"#E63946":"rgba(240,237,232,0.35)",fontFamily:"'Barlow',sans-serif",letterSpacing:1,textTransform:"uppercase",fontWeight:panel==="badges"?700:400}}>Badges</div>
        </div>
      </div>

      {panel==="courses"&&(<>
        <div ref={seasonsRef} style={{display:"flex",alignItems:"center",gap:8,marginBottom:16,overflowX:"auto",scrollbarWidth:"none",WebkitOverflowScrolling:"touch",paddingBottom:4}}>
          {[CY-5,CY-4,CY-3,CY-2,CY-1,CY].map(y=>(
            <button key={y} onClick={()=>setSeason(y)} style={{flex:"0 0 calc((100% - 24px) / 4)",padding:"7px 0",borderRadius:20,border:"none",cursor:"pointer",background:season===y?"#E63946":"rgba(255,255,255,0.06)",color:season===y?"#fff":"rgba(240,237,232,0.4)",fontFamily:"'Bebas Neue'",fontSize:18,letterSpacing:1,display:"flex",alignItems:"center",justifyContent:"center",gap:6}}>
              {y}
              {y===CY&&<span style={{width:6,height:6,borderRadius:"50%",background:season===y?"rgba(255,255,255,0.9)":"#27AE60",flexShrink:0}}/>}
            </button>
          ))}
        </div>
        <div style={{display:"flex",gap:6,marginBottom:14}}>
          {[["races",`🏁 Courses (${seasonResults.length})`],["trainings",`🏋️ Entraînements (${seasonTrainings.length})`]].map(([k,l])=>(
            <button key={k} onClick={()=>setTab(k)} style={{flex:1,padding:"8px 0",borderRadius:12,border:"none",cursor:"pointer",background:tab===k?"rgba(255,255,255,0.1)":"rgba(255,255,255,0.04)",color:tab===k?"#F0EDE8":"rgba(240,237,232,0.4)",fontFamily:"'Barlow',sans-serif",fontWeight:700,fontSize:12}}>{l}</button>
          ))}
        </div>
        {loading?(
          <div style={{textAlign:"center",color:"#444",padding:"30px 0",fontFamily:"'Barlow',sans-serif"}}>Chargement…</div>
        ):tab==="races"?(
          seasonResults.length===0?
            <div style={{textAlign:"center",color:"#444",padding:"30px 0",fontFamily:"'Barlow',sans-serif",fontSize:13}}>Aucune course pour cette saison</div>
          :seasonResults.map(r=>{
            const pts=calcPoints(r.discipline,r.time,r.elevation);
            const ptsLv=getLevel(pts);
            return (
              <ActivityCard key={r.id} myId={myId} activityType="result" activityId={r.id}>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",gap:10}}>
                  <div style={{flex:1,minWidth:0}}>
                    <div style={{fontSize:10,color:"rgba(240,237,232,0.4)",fontFamily:"'Barlow',sans-serif",marginBottom:3}}>{DISCIPLINES[r.discipline]?.icon} {DISCIPLINES[r.discipline]?.label}</div>
                    <div style={{fontFamily:"'Bebas Neue'",fontSize:20,color:"#F0EDE8",letterSpacing:1}}>{fmtTime(r.time)}</div>
                    {r.race&&<div style={{fontSize:11,color:"rgba(240,237,232,0.5)",fontFamily:"'Barlow',sans-serif",marginTop:2,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{r.race}</div>}
                  </div>
                  <div style={{textAlign:"right",flexShrink:0}}>
                    <div style={{fontFamily:"'Bebas Neue'",fontSize:20,color:ptsLv.color,letterSpacing:1}}>{pts}</div>
                    <div style={{fontSize:9,color:"rgba(240,237,232,0.35)",fontFamily:"'Barlow',sans-serif",letterSpacing:1,textTransform:"uppercase"}}>pts</div>
                  </div>
                </div>
              </ActivityCard>
            );
          })
        ):(
          seasonTrainings.length===0?
            <div style={{textAlign:"center",color:"#444",padding:"30px 0",fontFamily:"'Barlow',sans-serif",fontSize:13}}>Aucun entraînement pour cette saison</div>
          :<>
            {seasonTrainings.map(t=>{
              const pts=effectiveTrainingPts(t);
              return (
                <ActivityCard key={t.id} myId={myId} activityType="training" activityId={t.id}>
                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",gap:10}}>
                    <div style={{flex:1,minWidth:0}}>
                      <div style={{display:"flex",alignItems:"center",gap:6}}>
                        <div style={{fontFamily:"'Barlow',sans-serif",fontWeight:700,fontSize:14,color:"#F0EDE8",minWidth:0,flex:1}}>{t.sport} · {t.distance} km</div>
                        <ActivitySourceBadge source={t.source}/>
                      </div>
                      <div style={{fontSize:11,color:"rgba(240,237,232,0.4)",marginTop:2,fontFamily:"'Barlow',sans-serif"}}>{t.date?.split("-").reverse().join("-")}{t.duration?` · ${fmtDuration(t.duration)}`:""}</div>
                    </div>
                    <div style={{fontFamily:"'Bebas Neue'",fontSize:16,color:"#E63946",flexShrink:0}}>+{pts}pts</div>
                  </div>
                </ActivityCard>
              );
            })}
            {seasonTrainings.some(t=>t.source==="strava")&&<PoweredByStrava/>}
          </>
        )}
      </>)}

      {panel==="badges"&&<BadgesByCategory badges={badges}/>}

      {panel==="amis"&&(
        loading?<div style={{textAlign:"center",color:"#444",padding:"30px 0",fontFamily:"'Barlow',sans-serif"}}>Chargement…</div>
        :friendsList.length===0?
          <div style={{padding:"30px 20px",textAlign:"center",background:"rgba(255,255,255,0.03)",border:"1px solid rgba(255,255,255,0.06)",borderRadius:14}}>
            <div style={{fontSize:32,marginBottom:8}}>👥</div>
            <div style={{fontFamily:"'Barlow',sans-serif",fontSize:13,color:"rgba(240,237,232,0.55)"}}>Aucun ami pour le moment</div>
          </div>
        :friendsList.filter(p=>p.id!==myId).map(p=>{
          const isMine=myFriendIds.has(p.id);
          return (
            <div key={p.id} onClick={()=>setNestedFriend(p)} style={{display:"flex",alignItems:"center",gap:12,padding:"8px 4px",borderBottom:"1px solid rgba(255,255,255,0.04)",cursor:"pointer"}}>
              <Avatar profile={p} size={32}/>
              <div style={{flex:1,minWidth:0}}>
                <div style={{fontFamily:"'Barlow',sans-serif",fontWeight:600,fontSize:14,color:"#F0EDE8",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{p.name||"Athlète"}</div>
                <div style={{fontSize:11,color:"rgba(240,237,232,0.4)",fontFamily:"'Barlow',sans-serif",marginTop:1}}>{(()=>{const parts=[p.city,p.birth_year&&getAgeCat(p.birth_year)&&<CategoryTooltip key="cat" birthYear={p.birth_year}/>].filter(Boolean);return parts.length?parts.map((el,i,arr)=><span key={i}>{el}{i<arr.length-1?" · ":""}</span>):"—";})()}</div>
              </div>
              {isMine
                ?<div style={{fontSize:10,color:"rgba(39,174,96,0.85)",fontFamily:"'Barlow',sans-serif",fontWeight:700,letterSpacing:0.5,padding:"4px 8px",background:"rgba(39,174,96,0.1)",border:"1px solid rgba(39,174,96,0.25)",borderRadius:8,flexShrink:0}}>✓ Ami</div>
                :<button onClick={e=>{e.stopPropagation();handleAddMyFriend(p);}} style={{padding:"5px 10px",borderRadius:8,background:"rgba(230,57,70,0.15)",border:"1px solid rgba(230,57,70,0.35)",color:"#E63946",cursor:"pointer",fontFamily:"'Barlow',sans-serif",fontWeight:700,fontSize:11,letterSpacing:0.3,flexShrink:0}}>+ Ajouter</button>
              }
            </div>
          );
        })
      )}
      {nestedFriend&&<FriendProfileModal friend={nestedFriend} myId={myId} onClose={()=>setNestedFriend(null)}/>}
      {showPhoto&&fullProfile?.avatar&&<PhotoViewer src={fullProfile.avatar} onClose={()=>setShowPhoto(false)}/>}
    </Modal>
  );
}


// ── NAV BAR ───────────────────────────────────────────────────────────────────
function NavBar({tab,onChange,notifCount=0}){
  const items=[
    {k:"home",    icon:"🏠",label:"Home"},
    {k:"ranking", icon:"🏆",label:"Rank"},
    {k:"training",icon:"🏋️",label:"Training"},
    {k:"perf",    icon:"📈",label:"Stats"},
    {k:"social",  icon:"👥",label:"Social"},
  ];
  return (
    <div style={{position:"fixed",bottom:0,left:0,right:0,background:"rgba(14,14,14,0.97)",backdropFilter:"blur(20px)",borderTop:"1px solid rgba(255,255,255,0.07)",display:"flex",paddingTop:"clamp(4px, 1dvh, 8px)",paddingBottom:"max(env(safe-area-inset-bottom), clamp(10px, 2.2dvh, 20px))",zIndex:100}}>
      {items.map(({k,icon,label})=>(
        <button key={k} onClick={()=>onChange(k)} style={{flex:1,display:"flex",flexDirection:"column",alignItems:"center",gap:2,background:"none",border:"none",cursor:"pointer",padding:"4px 0",position:"relative"}}>
          <span style={{fontSize:"clamp(15px, 4vw, 19px)",opacity:tab===k?1:0.3,transition:"opacity 0.2s",position:"relative"}}>
            {icon}
            {k==="social"&&notifCount>0&&(
              <span style={{position:"absolute",top:-4,right:-8,background:"#E63946",borderRadius:"50%",minWidth:14,height:14,padding:"0 3px",display:"flex",alignItems:"center",justifyContent:"center",fontSize:9,color:"#fff",fontFamily:"'Bebas Neue'",fontWeight:700,lineHeight:1}}>{notifCount>9?"9+":notifCount}</span>
            )}
          </span>
          <span style={{fontSize:"clamp(7px, 1.8vw, 10px)",letterSpacing:0.3,textTransform:"uppercase",fontFamily:"'Barlow',sans-serif",fontWeight:700,color:tab===k?"#E63946":"rgba(240,237,232,0.3)",transition:"color 0.2s"}}>{label}</span>
        </button>
      ))}
    </div>
  );
}

// ── AUTH SCREEN ───────────────────────────────────────────────────────────────
function OnboardingScreen({profile,onDone}){
  const [name,setName]=useState(profile?.name||"");
  const [city,setCity]=useState(profile?.city||"");
  const [birthYear,setBirth]=useState(profile?.birth_year||"");
  const [gender,setGender]=useState(profile?.gender||"");
  const [nat,setNat]=useState(profile?.nationality||"");
  const [loading,setLoading]=useState(false);
  const [error,setError]=useState("");
  const yearNum=parseInt(birthYear);
  const valid=name.trim()&&city.trim()&&birthYear&&!isNaN(yearNum)&&yearNum>=1920&&yearNum<=CY-10&&gender&&nat.trim();
  const handleSave=async()=>{
    if(!valid){setError("Tous les champs sont requis.");return;}
    setLoading(true);setError("");
    const{error:updErr}=await supabase.from("profiles").update({name:name.trim(),city:city.trim(),birth_year:yearNum,gender,nationality:nat.trim()}).eq("id",profile.id);
    setLoading(false);
    if(updErr){setError("Sauvegarde échouée : "+updErr.message);return;}
    onDone();
  };
  return (
    <div style={{minHeight:"100vh",background:"#0e0e0e",color:"#F0EDE8",display:"flex",flexDirection:"column",alignItems:"center",padding:"40px 20px",boxSizing:"border-box",overflowY:"auto"}}>
      <link href="https://fonts.googleapis.com/css2?family=Bebas+Neue&family=Barlow:wght@400;500;600;700&display=swap" rel="stylesheet"/>
      <div style={{fontFamily:"'Bebas Neue'",fontSize:48,lineHeight:1,letterSpacing:4,marginBottom:6}}><span style={{color:"#F0EDE8"}}>PACE</span><span style={{color:"#E63946"}}>RANK</span></div>
      <div style={{fontSize:10,color:"rgba(240,237,232,0.4)",letterSpacing:3,textTransform:"uppercase",fontFamily:"'Barlow',sans-serif",marginBottom:28}}>Bienvenue — complète ton profil</div>
      <div style={{width:"100%",maxWidth:420}}>
        <div style={{fontSize:13,color:"rgba(240,237,232,0.6)",fontFamily:"'Barlow',sans-serif",marginBottom:20,lineHeight:1.5}}>Ces informations sont nécessaires pour activer les classements (âge, ville, sexe, nationalité).</div>
        <Lbl c="Nom complet *"/><Inp value={name} onChange={setName} placeholder="Ton nom"/>
        <Lbl c="Ville *"/><Inp value={city} onChange={setCity} placeholder="Ta ville"/>
        <Lbl c="Année de naissance *"/>
        <div style={{background:"rgba(255,255,255,0.03)",borderRadius:14,padding:"12px",display:"flex",justifyContent:"center",marginBottom:16}}>
          <DrumPicker values={BIRTH_YEARS} selectedIndex={Math.max(0,BIRTH_YEARS.indexOf(String(birthYear||CY-30)))} onChange={i=>setBirth(BIRTH_YEARS[i])} width={120}/>
        </div>
        <Lbl c="Sexe *"/>
        <div style={{display:"flex",gap:10,marginBottom:16}}>
          {[{v:"H",l:"👨 Homme"},{v:"F",l:"👩 Femme"}].map(({v,l})=>(
            <button key={v} type="button" onClick={()=>setGender(v)} style={{flex:1,padding:"14px 0",borderRadius:12,border:`1px solid ${gender===v?"#E63946":"rgba(255,255,255,0.1)"}`,background:gender===v?"rgba(230,57,70,0.15)":"rgba(255,255,255,0.05)",color:gender===v?"#E63946":"#F0EDE8",cursor:"pointer",fontFamily:"'Barlow',sans-serif",fontWeight:700,fontSize:14}}>{l}</button>
          ))}
        </div>
        <Lbl c="Nationalité *"/>
        <Sel value={nat} onChange={setNat}>
          <option value="">— Choisir —</option>
          {NATIONALITIES.map(n=><option key={n} value={n}>{n}</option>)}
        </Sel>
        {error&&<div style={{color:"#E63946",fontSize:12,marginBottom:12,fontFamily:"'Barlow',sans-serif"}}>{error}</div>}
        <Btn onClick={handleSave} disabled={!valid||loading} mb={8}>{loading?"Enregistrement...":"Commencer"}</Btn>
        <button onClick={async()=>{await supabase.auth.signOut();}} style={{width:"100%",padding:"10px 0",background:"transparent",border:"none",color:"rgba(240,237,232,0.4)",fontFamily:"'Barlow',sans-serif",fontSize:12,cursor:"pointer"}}>Se déconnecter</button>
      </div>
    </div>
  );
}

// ── ONBOARDING TOUR (5 écrans, 1ère connexion uniquement) ────────────────────
function OnboardingTour({profile, results, onComplete, onAddRace}) {
  const [screen, setScreen] = useState(1);
  const [toast, setToast] = useState("");
  const [saving, setSaving] = useState(false);

  const PR_RED = "#ED2A37";
  const PR_GOLD = "#FFB800";
  const BG = "#0a0a0a";
  const TEXT = "#F0EDE8";
  const DIM = "rgba(240,237,232,0.5)";
  const BORDER = "rgba(240,237,232,0.08)";

  const best10K = useMemo(() => {
    const tens = (results||[]).filter(r => r.discipline === "10km" && r.time);
    if (tens.length === 0) return null;
    return tens.reduce((a,b) => a.time < b.time ? a : b);
  }, [results]);
  const userTimeSec = best10K ? best10K.time : 39*60+34;
  const userTimeStr = best10K ? fmtTime(best10K.time).replace(/^00:/,"") : "39:34";
  const userPts = calcPoints("10km", userTimeSec);

  const finish = useCallback(async () => {
    if (saving) return;
    setSaving(true);
    try {
      await supabase.from("profiles").update({onboarding_completed: true}).eq("id", profile.id);
    } catch (e) {
      console.error("[onboarding-tour] save failed", e);
    }
    onComplete();
  }, [saving, profile?.id, onComplete]);

  const next = () => setScreen(s => Math.min(s+1, 5));
  const skip = () => finish();

  const handleInvite = async () => {
    const url = `${window.location.origin}/?ref=${profile.id}`;
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(url);
        setToast("Lien copié 📋");
      } else {
        setToast(url);
      }
    } catch {
      setToast("Échec de la copie");
    }
    setTimeout(() => setToast(""), 2500);
  };

  const handleAddRace = (disc) => {
    finish().then(() => onAddRace?.(disc));
  };

  const ProgressDots = ({active}) => (
    <div style={{display:"flex",gap:6,justifyContent:"center",marginTop:24,marginBottom:14}}>
      {[1,2,3,4].map(i => (
        <div key={i} style={{width:24,height:3,borderRadius:2,background:i<=active?PR_RED:"rgba(240,237,232,0.15)",transition:"background 0.3s"}}/>
      ))}
    </div>
  );

  const SkipBtn = () => (
    <button onClick={skip} style={{position:"absolute",top:"calc(8px + env(safe-area-inset-top))",right:12,padding:"8px 14px",background:"transparent",border:"none",color:DIM,fontFamily:"'Barlow',sans-serif",fontSize:12,fontWeight:600,cursor:"pointer",letterSpacing:0.5,zIndex:5}}>
      Passer
    </button>
  );

  const PrimaryBtn = ({children, onClick, color=PR_RED}) => (
    <button onClick={onClick} disabled={saving} style={{width:"100%",padding:"14px 0",background:color,color:"#fff",border:"none",borderRadius:12,fontFamily:"'Barlow',sans-serif",fontWeight:700,fontSize:15,cursor:saving?"default":"pointer",letterSpacing:0.3,opacity:saving?0.6:1}}>
      {children}
    </button>
  );

  const SecondaryBtn = ({children, onClick}) => (
    <button onClick={onClick} disabled={saving} style={{width:"100%",padding:"14px 0",background:"transparent",border:`1px solid ${BORDER}`,color:DIM,borderRadius:12,fontFamily:"'Barlow',sans-serif",fontWeight:600,fontSize:14,cursor:saving?"default":"pointer",marginTop:10}}>
      {children}
    </button>
  );

  const screenWrap = (children, withSkip=true) => (
    <div style={{position:"relative",minHeight:"100dvh",background:BG,color:TEXT,display:"flex",flexDirection:"column",padding:"24px 22px calc(28px + env(safe-area-inset-bottom))",boxSizing:"border-box",animation:"onb-fade 0.32s ease",paddingTop:"calc(24px + env(safe-area-inset-top))"}}>
      <link href="https://fonts.googleapis.com/css2?family=Bebas+Neue&family=Barlow:wght@400;500;600;700&display=swap" rel="stylesheet"/>
      <style>{`@keyframes onb-fade{from{opacity:0;transform:translateX(8px);}to{opacity:1;transform:translateX(0);}}`}</style>
      {withSkip && <SkipBtn/>}
      {children}
      {toast && (
        <div style={{position:"fixed",top:80,left:"50%",transform:"translateX(-50%)",background:"rgba(255,255,255,0.95)",color:"#0a0a0a",padding:"10px 18px",borderRadius:12,fontFamily:"'Barlow',sans-serif",fontWeight:700,fontSize:13,zIndex:1000,boxShadow:"0 6px 24px rgba(0,0,0,0.3)"}}>{toast}</div>
      )}
    </div>
  );

  // ─── SCREEN 1 ────────────────────────────────────────────────────────────
  if (screen === 1) return screenWrap(
    <div style={{flex:1,display:"flex",flexDirection:"column",justifyContent:"center",alignItems:"center",textAlign:"center"}}>
      <div style={{fontFamily:"'Bebas Neue'",fontSize:72,lineHeight:1,letterSpacing:6,marginBottom:8}}>
        <span style={{color:TEXT}}>PACE</span><span style={{color:PR_RED}}>RANK</span>
      </div>
      <div style={{fontSize:10,color:"rgba(240,237,232,0.45)",letterSpacing:4,textTransform:"uppercase",fontFamily:"'Barlow',sans-serif",marginBottom:80}}>
        Run · Triathlon · Trail · Hyrox
      </div>
      <div style={{fontFamily:"'Bebas Neue'",fontSize:38,letterSpacing:1.5,lineHeight:1.05,marginBottom:14,maxWidth:360}}>
        Bienvenue dans le club.
      </div>
      <div style={{fontSize:15,color:DIM,fontFamily:"'Barlow',sans-serif",lineHeight:1.5,maxWidth:340,marginBottom:60}}>
        Compare tes perfs avec tes amis, peu importe la discipline.
      </div>
      <div style={{width:"100%",maxWidth:380}}>
        <PrimaryBtn onClick={next}>C'est parti</PrimaryBtn>
      </div>
    </div>,
    false
  );

  // ─── SCREEN 2 ────────────────────────────────────────────────────────────
  if (screen === 2) return screenWrap(
    <>
      <ProgressDots active={1}/>
      <div style={{flex:1,display:"flex",flexDirection:"column",justifyContent:"center",maxWidth:420,margin:"0 auto",width:"100%"}}>
        <div style={{fontFamily:"'Bebas Neue'",fontSize:34,letterSpacing:1.2,lineHeight:1.1,marginBottom:14}}>
          Comment tu marques <span style={{color:PR_RED}}>des points</span>.
        </div>
        <div style={{fontSize:14,color:DIM,fontFamily:"'Barlow',sans-serif",lineHeight:1.55,marginBottom:24}}>
          Ton temps est comparé à celui d'un athlète <span style={{color:TEXT,fontWeight:700}}>élite mondial</span> sur la même distance. Plus tu t'en approches, plus tu marques.
        </div>
        <div style={{background:"rgba(255,255,255,0.02)",border:`1px solid ${BORDER}`,borderRadius:16,padding:18,marginBottom:18}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"10px 0"}}>
            <div style={{fontSize:12,color:DIM,fontFamily:"'Barlow',sans-serif",letterSpacing:0.5,textTransform:"uppercase",fontWeight:700}}>Élite — 10 km</div>
            <div style={{fontFamily:"'Bebas Neue'",fontSize:24,color:PR_GOLD,letterSpacing:1}}>27:00</div>
          </div>
          <div style={{height:1,background:BORDER,margin:"4px 0"}}/>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"10px 0"}}>
            <div style={{fontSize:12,color:DIM,fontFamily:"'Barlow',sans-serif",letterSpacing:0.5,textTransform:"uppercase",fontWeight:700}}>Toi — 10 km</div>
            <div style={{fontFamily:"'Bebas Neue'",fontSize:24,color:PR_RED,letterSpacing:1}}>{userTimeStr}</div>
          </div>
          <div style={{textAlign:"center",fontSize:18,color:DIM,margin:"4px 0"}}>↓</div>
          <div style={{textAlign:"center",padding:"12px 0",background:`rgba(237,42,55,0.1)`,border:`1px solid rgba(237,42,55,0.4)`,borderRadius:12,marginBottom:14}}>
            <div style={{fontFamily:"'Bebas Neue'",fontSize:30,color:PR_RED,letterSpacing:2,lineHeight:1}}>{userPts} PTS</div>
          </div>
          <div style={{display:"flex",gap:6,flexWrap:"wrap",justifyContent:"center"}}>
            {[
              {l:"10K",mult:"×1.0"},
              {l:"Marathon",mult:"×1.2"},
              {l:"Ironman",mult:"×1.5"},
            ].map(p => (
              <div key={p.l} style={{padding:"6px 12px",background:`rgba(255,184,0,0.12)`,border:`1px solid rgba(255,184,0,0.4)`,borderRadius:20,fontFamily:"'Barlow',sans-serif",fontWeight:700,fontSize:11,color:PR_GOLD,letterSpacing:0.5}}>
                {p.l} {p.mult}
              </div>
            ))}
          </div>
        </div>
      </div>
      <div style={{maxWidth:420,margin:"0 auto",width:"100%"}}>
        <PrimaryBtn onClick={next}>Suivant</PrimaryBtn>
      </div>
    </>
  );

  // ─── SCREEN 3 ────────────────────────────────────────────────────────────
  if (screen === 3) {
    const levels = [
      {label:"Bronze", color:"#CD7F32"},
      {label:"Argent", color:"#C0C0C0"},
      {label:"Or",     color:"#FFD700"},
      {label:"Platine",color:"#E5E4E2"},
      {label:"Diamant",color:"#B9F2FF"},
      {label:"Master", color:PR_RED},
    ];
    const leagues = [
      {icon:"🌱",label:"Rookie",color:"#27AE60"},
      {icon:"🎯",label:"Pro",   color:"#4A90D9"},
      {icon:"🏆",label:"Elite", color:"#9B59B6"},
      {icon:"⚡",label:"Legend",color:"#FF6B35"},
      {icon:"💎",label:"Mythic",color:"#FF073A"},
    ];
    return screenWrap(
      <>
        <ProgressDots active={2}/>
        <div style={{flex:1,display:"flex",flexDirection:"column",justifyContent:"center",maxWidth:420,margin:"0 auto",width:"100%"}}>
          <div style={{fontFamily:"'Bebas Neue'",fontSize:34,letterSpacing:1.2,lineHeight:1.1,marginBottom:14}}>
            Niveaux <span style={{color:PR_RED}}>& ligues</span>.
          </div>
          <div style={{fontSize:14,color:DIM,fontFamily:"'Barlow',sans-serif",lineHeight:1.55,marginBottom:22}}>
            Chaque course te donne un <span style={{color:TEXT,fontWeight:700}}>niveau</span>. Tes points cumulés te placent dans une <span style={{color:TEXT,fontWeight:700}}>ligue</span> hebdo contre 20 athlètes.
          </div>
          <div style={{fontSize:11,color:DIM,fontFamily:"'Barlow',sans-serif",fontWeight:700,letterSpacing:1.5,textTransform:"uppercase",marginBottom:10}}>Niveaux par course</div>
          <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:8,marginBottom:22}}>
            {levels.map(l => (
              <div key={l.label} style={{padding:"10px 8px",background:`${l.color}18`,border:`1px solid ${l.color}55`,borderRadius:10,textAlign:"center",fontFamily:"'Barlow',sans-serif",fontWeight:700,fontSize:12,color:l.color,letterSpacing:0.5}}>
                {l.label}
              </div>
            ))}
          </div>
          <div style={{fontSize:11,color:DIM,fontFamily:"'Barlow',sans-serif",fontWeight:700,letterSpacing:1.5,textTransform:"uppercase",marginBottom:10}}>Ligues hebdo</div>
          <div style={{display:"flex",flexDirection:"column",gap:6}}>
            {leagues.map(l => (
              <div key={l.label} style={{display:"flex",alignItems:"center",gap:12,padding:"10px 14px",background:`${l.color}10`,border:`1px solid ${l.color}40`,borderRadius:10}}>
                <div style={{fontSize:18}}>{l.icon}</div>
                <div style={{fontFamily:"'Barlow',sans-serif",fontWeight:700,fontSize:13,color:l.color,letterSpacing:0.5}}>{l.label}</div>
              </div>
            ))}
          </div>
        </div>
        <div style={{maxWidth:420,margin:"20px auto 0",width:"100%"}}>
          <PrimaryBtn onClick={next}>Suivant</PrimaryBtn>
        </div>
      </>
    );
  }

  // ─── SCREEN 4 ────────────────────────────────────────────────────────────
  if (screen === 4) {
    const peers = [
      {x:"50%",y:"6%",   color:"#CD7F32",init:"JD"},
      {x:"96%",y:"42%",  color:"#C0C0C0",init:"MA"},
      {x:"4%", y:"42%",  color:"#FFD700",init:"SL"},
      {x:"50%",y:"94%",  color:"#5DADE2",init:"AT"},
    ];
    return screenWrap(
      <>
        <ProgressDots active={3}/>
        <div style={{flex:1,display:"flex",flexDirection:"column",justifyContent:"center",maxWidth:420,margin:"0 auto",width:"100%"}}>
          <div style={{fontFamily:"'Bebas Neue'",fontSize:34,letterSpacing:1.2,lineHeight:1.1,marginBottom:14}}>
            PaceRank, c'est mieux <span style={{color:PR_RED}}>à plusieurs</span>.
          </div>
          <div style={{fontSize:14,color:DIM,fontFamily:"'Barlow',sans-serif",lineHeight:1.55,marginBottom:24}}>
            Invite tes potes runners, triathlètes ou trailers. Le vrai jeu commence quand vous comparez vos perfs.
          </div>
          <div style={{position:"relative",width:240,height:240,margin:"10px auto 30px"}}>
            {peers.map((p,i) => (
              <div key={i} style={{position:"absolute",left:p.x,top:p.y,transform:"translate(-50%,-50%)",width:54,height:54,borderRadius:"50%",background:`${p.color}1A`,border:`2px solid ${p.color}`,display:"flex",alignItems:"center",justifyContent:"center",fontFamily:"'Bebas Neue'",fontSize:18,color:p.color,letterSpacing:1}}>
                {p.init}
              </div>
            ))}
            <div style={{position:"absolute",left:"50%",top:"50%",transform:"translate(-50%,-50%)",width:80,height:80,borderRadius:"50%",background:`linear-gradient(135deg, ${PR_RED}, #B0212C)`,border:`2px solid ${PR_RED}`,display:"flex",alignItems:"center",justifyContent:"center",fontFamily:"'Bebas Neue'",fontSize:36,color:"#fff",letterSpacing:1,boxShadow:`0 0 32px rgba(237,42,55,0.4)`}}>
              P
            </div>
          </div>
        </div>
        <div style={{maxWidth:420,margin:"0 auto",width:"100%"}}>
          <PrimaryBtn onClick={handleInvite}>Inviter par lien</PrimaryBtn>
          <SecondaryBtn onClick={next}>Plus tard</SecondaryBtn>
        </div>
      </>
    );
  }

  // ─── SCREEN 5 ────────────────────────────────────────────────────────────
  const shortcuts = [
    {label:"🏃 10 km",        disc:"10km"},
    {label:"🏃 Semi-marathon",disc:"semi"},
    {label:"🏃 Marathon",     disc:"marathon"},
    {label:"⛰️ Trail",         disc:"trail-s"},
  ];
  return screenWrap(
    <>
      <ProgressDots active={4}/>
      <div style={{flex:1,display:"flex",flexDirection:"column",justifyContent:"center",maxWidth:420,margin:"0 auto",width:"100%"}}>
        <div style={{fontFamily:"'Bebas Neue'",fontSize:34,letterSpacing:1.2,lineHeight:1.1,marginBottom:14}}>
          Ajoute ta meilleure <span style={{color:PR_RED}}>perf récente</span>.
        </div>
        <div style={{fontSize:14,color:DIM,fontFamily:"'Barlow',sans-serif",lineHeight:1.55,marginBottom:22}}>
          Une course ou un PR pour démarrer. Tes points, ton niveau et ton statut s'activeront aussitôt.
        </div>
        <div style={{display:"flex",justifyContent:"center",marginBottom:22}}>
          <div style={{width:90,height:90,borderRadius:"50%",background:`linear-gradient(135deg, ${PR_RED}, #B0212C)`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:42,boxShadow:`0 0 36px rgba(237,42,55,0.35)`}}>
            🏁
          </div>
        </div>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginBottom:6}}>
          {shortcuts.map(s => (
            <button key={s.disc} onClick={()=>handleAddRace(s.disc)} disabled={saving} style={{padding:"12px 10px",background:"rgba(255,255,255,0.03)",border:`1px solid ${BORDER}`,borderRadius:12,color:TEXT,fontFamily:"'Barlow',sans-serif",fontWeight:700,fontSize:13,cursor:saving?"default":"pointer",letterSpacing:0.3,textAlign:"left"}}>
              {s.label}
            </button>
          ))}
        </div>
      </div>
      <div style={{maxWidth:420,margin:"22px auto 0",width:"100%"}}>
        <PrimaryBtn onClick={()=>handleAddRace()}>Ajouter une course</PrimaryBtn>
        <SecondaryBtn onClick={finish}>Plus tard</SecondaryBtn>
      </div>
    </>
  );
}

function AuthScreen(){
  const signIn=async()=>{await supabase.auth.signInWithOAuth({provider:"google",options:{redirectTo:window.location.origin}});};
  return (
    <div style={{minHeight:"100vh",background:"#0e0e0e",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",padding:24}}>
      <div style={{fontFamily:"'Bebas Neue'",fontSize:72,lineHeight:1,letterSpacing:6}}><span style={{color:"#F0EDE8"}}>PACE</span><span style={{color:"#E63946"}}>RANK</span></div>
      <div style={{fontSize:11,color:"rgba(240,237,232,0.3)",letterSpacing:4,textTransform:"uppercase",fontFamily:"'Barlow',sans-serif",marginBottom:60}}>Run · Trail · Triathlon · Hyrox</div>
      <button onClick={signIn} style={{background:"#fff",color:"#111",border:"none",borderRadius:16,padding:"16px 40px",fontFamily:"'Barlow',sans-serif",fontWeight:700,fontSize:16,cursor:"pointer",display:"flex",alignItems:"center",gap:12}}>
        <svg width="20" height="20" viewBox="0 0 48 48"><path fill="#FFC107" d="M43.6 20H24v8h11.3C33.6 33.1 29.3 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3 0 5.7 1.1 7.8 2.9l5.7-5.7C34.1 6.6 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20c11 0 19.7-8 19.7-20 0-1.3-.1-2.7-.1-4z"/><path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.6 15.1 18.9 12 24 12c3 0 5.7 1.1 7.8 2.9l5.7-5.7C34.1 6.6 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 44c5.2 0 9.9-1.9 13.5-5l-6.2-5.2C29.4 35.5 26.8 36 24 36c-5.3 0-9.6-3-11.3-7.5l-6.6 5.1C9.5 39.5 16.2 44 24 44z"/><path fill="#1976D2" d="M43.6 20H24v8h11.3c-.9 2.5-2.5 4.6-4.6 6l6.2 5.2C41 35.6 44 30.2 44 24c0-1.3-.1-2.7-.4-4z"/></svg>
        Continuer avec Google
      </button>
      <div style={{marginTop:18,fontSize:12,color:"rgba(240,237,232,0.5)",fontFamily:"'Barlow',sans-serif",textAlign:"center",lineHeight:1.5,maxWidth:320}}>
        En créant un compte, j'accepte la{" "}
        <a href="/privacy-policy" target="_blank" rel="noopener noreferrer" style={{color:"#E63946",fontFamily:"'Barlow',sans-serif",fontSize:12,textDecoration:"underline"}}>Politique de confidentialité</a>
      </div>
    </div>
  );
}

// ── INSTALL PROMPT ────────────────────────────────────────────────────────────
function InstallPrompt(){
  const [show,setShow]=useState(false);
  const [showHelp,setShowHelp]=useState(false);
  const [deferred,setDeferred]=useState(null);
  const [platform,setPlatform]=useState(null);

  useEffect(()=>{
    const isStandalone=window.matchMedia("(display-mode: standalone)").matches||window.navigator.standalone===true;
    if(isStandalone)return;
    const dismissedAt=parseInt(localStorage.getItem("installPromptDismissedAt")||"0");
    if(dismissedAt&&Date.now()-dismissedAt<7*24*3600*1000)return;
    const ua=navigator.userAgent;
    const isIOS=/iPad|iPhone|iPod/.test(ua)&&!window.MSStream;
    const isInIOSWebView=isIOS&&!/Safari/.test(ua);
    if(isIOS&&!isInIOSWebView){
      setPlatform("ios");
      const t=setTimeout(()=>setShow(true),10000);
      return()=>clearTimeout(t);
    }
    const handler=e=>{
      e.preventDefault();
      setDeferred(e);
      setPlatform("android");
      setShow(true);
    };
    window.addEventListener("beforeinstallprompt",handler);
    return()=>window.removeEventListener("beforeinstallprompt",handler);
  },[]);

  const dismiss=()=>{
    try{localStorage.setItem("installPromptDismissedAt",String(Date.now()));}catch{}
    setShow(false);setShowHelp(false);
  };
  const installAndroid=async()=>{
    if(!deferred){setShowHelp(true);return;}
    deferred.prompt();
    const{outcome}=await deferred.userChoice;
    setDeferred(null);setShow(false);
    if(outcome==="dismissed")dismiss();
  };

  if(!show&&!showHelp)return null;

  return (<>
    {show&&(
      <div style={{position:"fixed",left:12,right:12,bottom:"calc(80px + env(safe-area-inset-bottom))",zIndex:200,background:"rgba(20,20,20,0.97)",backdropFilter:"blur(12px)",border:"1px solid rgba(255,255,255,0.1)",borderRadius:14,padding:"11px 13px",display:"flex",alignItems:"center",gap:10,maxWidth:460,margin:"0 auto",boxShadow:"0 8px 24px rgba(0,0,0,0.45)"}}>
        <div onClick={()=>platform==="android"?installAndroid():setShowHelp(true)} style={{flex:1,minWidth:0,cursor:"pointer",color:"#F0EDE8",fontFamily:"'Barlow',sans-serif",fontSize:13,lineHeight:1.4}}>
          📱 Installe PaceRank sur ton écran d'accueil pour un accès rapide
        </div>
        {platform==="android"&&<button onClick={installAndroid} style={{padding:"7px 12px",borderRadius:10,background:"#E63946",border:"none",color:"#fff",cursor:"pointer",fontFamily:"'Barlow',sans-serif",fontWeight:700,fontSize:12,flexShrink:0}}>Installer</button>}
        <button onClick={dismiss} aria-label="Fermer" style={{padding:"6px 9px",borderRadius:8,background:"rgba(255,255,255,0.07)",border:"none",color:"rgba(240,237,232,0.55)",cursor:"pointer",fontSize:14,flexShrink:0,lineHeight:1}}>✕</button>
      </div>
    )}
    {showHelp&&(
      <Modal onClose={()=>setShowHelp(false)}>
        <div style={{fontFamily:"'Bebas Neue'",fontSize:24,letterSpacing:1,color:"#F0EDE8",marginBottom:6}}>Installer PaceRank</div>
        <div style={{fontSize:13,color:"rgba(240,237,232,0.6)",fontFamily:"'Barlow',sans-serif",marginBottom:18,lineHeight:1.5}}>Ajoute l'app à ton écran d'accueil iOS en 3 étapes :</div>
        {[
          {n:"1",icon:"⬆️",title:"Tape sur le bouton Partager",desc:"En bas de Safari, l'icône carré avec une flèche vers le haut"},
          {n:"2",icon:"🏠",title:"Choisis « Sur l'écran d'accueil »",desc:"Fais défiler le menu Partager si besoin"},
          {n:"3",icon:"✅",title:"Confirme en haut à droite",desc:"L'icône PaceRank apparaît sur ton écran d'accueil"},
        ].map(s=>(
          <div key={s.n} style={{display:"flex",gap:12,alignItems:"flex-start",padding:"12px 14px",background:"rgba(255,255,255,0.04)",border:"1px solid rgba(255,255,255,0.07)",borderRadius:12,marginBottom:8}}>
            <div style={{width:30,height:30,flexShrink:0,borderRadius:"50%",background:"rgba(230,57,70,0.15)",border:"1px solid rgba(230,57,70,0.45)",display:"flex",alignItems:"center",justifyContent:"center",fontFamily:"'Bebas Neue'",fontSize:15,color:"#E63946"}}>{s.n}</div>
            <div style={{flex:1,minWidth:0}}>
              <div style={{fontFamily:"'Barlow',sans-serif",fontWeight:700,fontSize:14,color:"#F0EDE8"}}>{s.icon} {s.title}</div>
              <div style={{fontSize:12,color:"rgba(240,237,232,0.55)",fontFamily:"'Barlow',sans-serif",marginTop:2,lineHeight:1.4}}>{s.desc}</div>
            </div>
          </div>
        ))}
        <Btn onClick={()=>setShowHelp(false)} mb={0}>C'est compris</Btn>
      </Modal>
    )}
  </>);
}

// ── MAIN APP ──────────────────────────────────────────────────────────────────
export default function App(){
  const [session,setSession]=useState(null);
  const [profile,setProfile]=useState(null);
  const [results,setResults]=useState([]);
  const [tab,setTab]=useState("home");
  const [loading,setLoading]=useState(true);
  const [resultsKey,setResultsKey]=useState(0);
  const [showProfile,setShowProfile]=useState(false);
  const [addMode,setAddMode]=useState(null); // null | "result" | "training"
  const [pendingResultDisc,setPendingResultDisc]=useState(null); // pré-sélection discipline (onboarding)
  const [notifCount,setNotifCount]=useState(0);
  const [celebQueue,setCelebQueue]=useState([]);
  const [celebPaused,setCelebPaused]=useState(false);
  const [overtakenBanner,setOvertakenBanner]=useState(null);
  const [overtakenDetail,setOvertakenDetail]=useState(false);
  const [pushBannerDismissed,setPushBannerDismissed]=useState(()=>{
    try{
      const t=parseInt(localStorage.getItem("pushBannerDismissedAt")||"0");
      return t>0&&Date.now()-t<7*24*3600*1000;
    }catch{return false;}
  });

  const enqueueCelebration = useCallback((item) => {
    setCelebQueue(q => {
      const priority = { league: 1, milestone: 2, overtake: 3 };
      return [...q, item].sort((a,b) => (priority[a.type]||99) - (priority[b.type]||99));
    });
  }, []);
  const closeCurrentCelebration = useCallback(() => {
    setCelebQueue(q => q.slice(1));
    setCelebPaused(true);
    setTimeout(() => setCelebPaused(false), 300);
  }, []);

  useEffect(()=>{
    supabase.auth.getSession().then(({data:{session}})=>{setSession(session);if(!session)setLoading(false);});
    const{data:{subscription}}=supabase.auth.onAuthStateChange((_,session)=>setSession(session));
    return()=>subscription.unsubscribe();
  },[]);

  useEffect(()=>{if(session){loadProfile();loadResults();loadNotifCount();}},[session]);

  const { optedIn: pushOptedIn, optIn: enablePush, optOut: disablePush } =
    usePushSubscription(profile);

  const dismissPushBanner=useCallback(async()=>{
    const nowIso = new Date().toISOString();
    try{ localStorage.setItem("pushBannerDismissedAt",String(Date.now())); }catch{}
    setPushBannerDismissed(true);
    if(profile?.id){
      try{ await supabase.from("profiles").update({push_banner_dismissed_at:nowIso}).eq("id",profile.id); }
      catch(e){ console.error("[push-banner] DB dismiss failed",e); }
    }
  },[profile?.id]);

  // Réconciliation DB → localStorage : push_banner_dismissed_at est la source
  // de vérité (multi-device). localStorage sert juste de cache instantané pour
  // éviter le flash de bannière au mount.
  useEffect(()=>{
    if(!profile) return;
    const dbAt = profile.push_banner_dismissed_at ? new Date(profile.push_banner_dismissed_at).getTime() : 0;
    const within7d = dbAt > 0 && (Date.now() - dbAt) < 7*24*3600*1000;
    if (within7d) {
      try{ localStorage.setItem("pushBannerDismissedAt",String(dbAt)); }catch{}
      setPushBannerDismissed(true);
    } else if (dbAt === 0) {
      // DB = NULL → bannière doit être visible. On purge le cache localStorage
      // (sinon un dismiss antérieur sur ce device la maintient masquée alors
      // que le serveur a reset).
      try{ localStorage.removeItem("pushBannerDismissedAt"); }catch{}
      setPushBannerDismissed(false);
    } else {
      // dismiss en DB > 7j → bannière à nouveau visible
      try{ localStorage.removeItem("pushBannerDismissedAt"); }catch{}
      setPushBannerDismissed(false);
    }
  },[profile?.push_banner_dismissed_at]);

  useEffect(()=>{
    try{
      if(localStorage.getItem("push_cleanup_v1")==="1") return;
      ["ios_push_registered_v1"].forEach(k=>{ try{localStorage.removeItem(k);}catch{} });
      localStorage.setItem("push_cleanup_v1","1");
    }catch{}
  },[]);

  useEffect(() => {
    if (!profile?.id) return;
    if (typeof profile.celebrations_enabled === "boolean") setCelebrationsEnabledLocal(profile.celebrations_enabled);
    (async () => {
      const overtakes = await detectOvertakes(profile.id, "onLoad");
      if (overtakes.length > 0) {
        const profs = await fetchProfilesByIds(overtakes.map(o => o.friendId));
        setOvertakenBanner({overtakes, profiles: profs});
      }
      const newLeague = await detectLeaguePromotion(profile.id, profile.last_league_seen);
      if (newLeague) {
        enqueueCelebration({type:"league", leagueId: newLeague});
        await supabase.from("profiles").update({last_league_seen: newLeague}).eq("id", profile.id);
      }
    })();
  }, [profile?.id, profile?.last_league_seen, profile?.celebrations_enabled, enqueueCelebration]);

  useEffect(()=>{
    if(!profile?.id)return;
    const flag=`trainingPtsFormula_${profile.id}`;
    const CURRENT="v3-2026-04";
    if(localStorage.getItem(flag)===CURRENT)return;
    (async()=>{
      console.log("[sync-train-pts] re-calcul des points training pour",profile.id);
      const{data}=await supabase.from("trainings").select("id,distance,duration,sport,points").eq("user_id",profile.id);
      if(!data)return;
      const updates=data.map(t=>{const fresh=calcTrainingPts(t.distance,t.sport,t.duration);return fresh!==t.points?{id:t.id,points:fresh}:null;}).filter(Boolean);
      if(updates.length){
        console.log(`[sync-train-pts] ${updates.length} entraînements à corriger`);
        await Promise.all(updates.map(u=>supabase.from("trainings").update({points:u.points}).eq("id",u.id)));
        setResultsKey(k=>k+1);
      } else {
        console.log("[sync-train-pts] tous les points sont déjà à jour");
      }
      try{localStorage.setItem(flag,CURRENT);}catch{}
    })();
  },[profile?.id]);

  useEffect(()=>{
    if(!session)return;
    const ch=supabase.channel("notifs").on("postgres_changes",{event:"*",schema:"public",table:"notifications"},loadNotifCount).subscribe();
    return()=>supabase.removeChannel(ch);
  },[session]);

  useEffect(()=>{
    if(!profile?.id){console.log("[Strava] effect attendant profile.id");return;}
    let pendingCode=null;
    try{pendingCode=sessionStorage.getItem(STRAVA_PENDING_KEY);}catch(e){console.error("[Strava] sessionStorage read failed",e);}
    if(!pendingCode){
      const params=new URLSearchParams(window.location.search);
      const code=params.get("code");
      const state=params.get("state");
      if(code&&state==="strava"){
        console.log("[Strava] code trouvé dans l'URL (fallback)",code.slice(0,8)+"...");
        pendingCode=code;
      }
    }
    if(!pendingCode){console.log("[Strava] aucun code en attente, effect ignoré");return;}
    console.log("[Strava] échange du code pour profil",profile.id);
    try{sessionStorage.removeItem(STRAVA_PENDING_KEY);}catch{}
    fetch("/api/strava/exchange",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({code:pendingCode})})
      .then(async r=>{
        const data=await r.json().catch(()=>({}));
        console.log("[Strava] réponse /api/strava/exchange",r.status,data);
        if(!r.ok){throw new Error(data?.error||data?.message||`HTTP ${r.status}`);}
        return data;
      })
      .then(data=>{
        if(data?.access_token){
          const payload={access_token:data.access_token,refresh_token:data.refresh_token,expires_at:data.expires_at,athlete:data.athlete};
          try{
            localStorage.setItem(`strava_${profile.id}`,JSON.stringify(payload));
            console.log("[Strava] tokens stockés dans localStorage sous strava_"+profile.id);
          }catch(e){console.error("[Strava] localStorage write failed",e);}
          const url=new URL(window.location.href);
          url.searchParams.delete("code");url.searchParams.delete("state");url.searchParams.delete("scope");
          window.history.replaceState({},"",url.pathname+(url.search?url.search:"")+url.hash);
          setShowProfile(true);
          console.log("[Strava] connexion réussie, modale Profil ouverte");
        } else {
          console.error("[Strava] réponse sans access_token",data);
        }
      })
      .catch(err=>{
        console.error("[Strava] exchange a échoué",err);
        const url=new URL(window.location.href);
        url.searchParams.delete("code");url.searchParams.delete("state");url.searchParams.delete("scope");
        window.history.replaceState({},"",url.pathname+(url.search?url.search:"")+url.hash);
      });
  },[profile?.id]);

  const loadProfile=async()=>{
    const{data:{user}}=await supabase.auth.getUser();
    let{data}=await supabase.from("profiles").select("*").eq("id",user.id).single();
    if(!data){await supabase.from("profiles").insert({id:user.id,name:user.user_metadata?.full_name||"",avatar:user.user_metadata?.avatar_url||""});({data}=await supabase.from("profiles").select("*").eq("id",user.id).single());}
    setProfile(data);setLoading(false);
  };
  const loadResults=async()=>{
    const{data:{user}}=await supabase.auth.getUser();
    const{data}=await supabase.from("results").select("*").eq("user_id",user.id).order("year",{ascending:false});
    setResults(data||[]);
  };
  const refresh=async()=>{
    loadProfile();
    loadResults();
    setResultsKey(k=>k+1);
    if (profile?.id) {
      checkAndNotifyOvertake(profile.id);
      // type d : dépassements intra-ligue → INSERT notifs (up + down) par paire
      detectLeagueOvertakes(profile.id);
      // Détection dépassement (cas A)
      const overtakes = await detectOvertakes(profile.id, "afterSave");
      if (overtakes.length > 0) {
        const profs = await fetchProfilesByIds(overtakes.map(o => o.friendId));
        enqueueCelebration({type:"overtake", overtakes, profiles: profs});
      }
      // Détection palier de points (level_up + level_up_imminent)
      try {
        const [{data:fresh}] = await Promise.all([
          supabase.from("profiles").select("last_points_milestone").eq("id", profile.id).maybeSingle(),
        ]);
        const lastMilestone = fresh?.last_points_milestone || 0;
        const [resR, trR] = await Promise.all([
          supabase.from("results").select("*").eq("user_id", profile.id),
          supabase.from("trainings").select("*").eq("user_id", profile.id),
        ]);
        const seasonRes = (resR.data||[]).filter(r => rYear(r) === CY);
        const seasonTr = (trR.data||[]).filter(t => new Date(t.date).getFullYear() === CY);
        const allRes = resR.data || [];
        const newPts = sumBestPts(seasonRes) + seasonTr.reduce((s,t) => s + effectiveTrainingPts(t), 0) + raceBonusPts(seasonRes, allRes) + trainingBonusPts(seasonTr);
        const milestone = detectPointsMilestone(newPts, lastMilestone);
        if (milestone) {
          enqueueCelebration({type:"milestone", milestone, prevPoints: lastMilestone, newPoints: newPts});
          // type e : INSERT notif level_up. La dedup vient de l'UPDATE
          // last_points_milestone ci-dessous : detectPointsMilestone retourne
          // null si le milestone est déjà atteint, donc on ne re-INSERT pas.
          await supabase.from("notifications").insert({
            user_id: profile.id,
            type: "level_up",
            read: false,
            payload: { milestone, points_at_levelup: newPts },
          });
          await supabase.from("profiles").update({last_points_milestone: milestone}).eq("id", profile.id);
        } else {
          // type f : level_up_imminent. Si on est à <100 pts d'un milestone
          // pas encore atteint, et qu'on n'a jamais notifié pour ce milestone-là.
          const nextMilestone = POINTS_MILESTONES.find(m => m > newPts);
          if (nextMilestone) {
            const pointsToGo = nextMilestone - newPts;
            if (pointsToGo > 0 && pointsToGo <= 100) {
              const { data: existing } = await supabase
                .from("notifications")
                .select("id, payload")
                .eq("user_id", profile.id)
                .eq("type", "level_up_imminent");
              const alreadyNotified = (existing || []).some(n =>
                Number(n.payload?.next_milestone) === nextMilestone
              );
              if (!alreadyNotified) {
                await supabase.from("notifications").insert({
                  user_id: profile.id,
                  type: "level_up_imminent",
                  read: false,
                  payload: {
                    current_points: newPts,
                    next_milestone: nextMilestone,
                    points_to_go: pointsToGo,
                  },
                });
              }
            }
          }
        }
      } catch (e) { console.error("[milestone] detection failed", e); }
    }
  };
  const loadNotifCount=async()=>{
    const{data:{user}}=await supabase.auth.getUser();
    if(!user)return;
    const{count}=await supabase.from("notifications").select("id",{count:"exact",head:true}).eq("user_id",user.id).eq("read",false);
    setNotifCount(count||0);
  };

  if(loading) return <div style={{minHeight:"100vh",background:"#0e0e0e",display:"flex",alignItems:"center",justifyContent:"center"}}><link href="https://fonts.googleapis.com/css2?family=Bebas+Neue&family=Barlow:wght@400;500;600;700&display=swap" rel="stylesheet"/><div style={{fontFamily:"'Bebas Neue'",fontSize:40,letterSpacing:4}}><span style={{color:"#F0EDE8"}}>PACE</span><span style={{color:"#E63946"}}>RANK</span></div></div>;
  if(!session) return <><link href="https://fonts.googleapis.com/css2?family=Bebas+Neue&family=Barlow:wght@400;500;600;700&display=swap" rel="stylesheet"/><AuthScreen/></>;
  if(profile&&!(profile.name&&profile.city&&profile.birth_year&&profile.gender&&profile.nationality)) return <OnboardingScreen profile={profile} onDone={loadProfile}/>;
  if(profile&&profile.onboarding_completed===false) return <OnboardingTour profile={profile} results={results} onComplete={loadProfile} onAddRace={(disc)=>{setPendingResultDisc(disc||null);setAddMode("result");}}/>;

  return (
    <div style={{background:"#0e0e0e",height:"100dvh",color:"#F0EDE8",maxWidth:480,margin:"0 auto",position:"relative",overflow:"hidden",paddingTop:"env(safe-area-inset-top)",boxSizing:"border-box",display:"flex",flexDirection:"column"}}>
      <link href="https://fonts.googleapis.com/css2?family=Bebas+Neue&family=Barlow:wght@400;500;600;700&display=swap" rel="stylesheet"/>
      {tab==="home"    &&<HomeTab    profile={profile} userId={profile?.id} onAddTraining={()=>setAddMode("training")} onAddRace={()=>setAddMode("result")} refreshKey={resultsKey} onOpenProfile={()=>setShowProfile(true)} notifCount={notifCount} onNotifsChange={loadNotifCount} overtakenBanner={overtakenBanner} onDismissOvertakenBanner={()=>setOvertakenBanner(null)} onOpenOvertakenDetail={()=>setOvertakenDetail(true)} pushOptedIn={pushOptedIn} pushBannerDismissed={pushBannerDismissed} onEnablePush={enablePush} onDismissPushBanner={dismissPushBanner} onOpenLeague={()=>setTab("ranking")}/>}
      {tab==="ranking" &&<RankingTab myProfile={profile}/>}
      {tab==="training"&&<TrainingTab userId={profile?.id} onActivityChange={refresh}/>}
      {tab==="perf"    &&<PerfTab    userId={profile?.id} refreshKey={resultsKey} onActivityChange={refresh}/>}
      {tab==="social"  &&<SocialTab  myProfile={profile} onNotifsChange={loadNotifCount}/>}
      <NavBar tab={tab} onChange={setTab} notifCount={notifCount}/>
      {addMode==="result"&&<ResultModal userId={profile?.id} initialDiscipline={pendingResultDisc} onSave={()=>{setAddMode(null);setPendingResultDisc(null);refresh();}} onClose={()=>{setAddMode(null);setPendingResultDisc(null);}}/>}
      {addMode==="training"&&<TrainingModal userId={profile?.id} onSave={()=>{setAddMode(null);refresh();}} onClose={()=>setAddMode(null)}/>}
      {showProfile&&<ProfileModal profile={profile} results={results} onRefresh={refresh} onClose={()=>setShowProfile(false)} pushOptedIn={pushOptedIn} onEnablePush={enablePush} onDisablePush={disablePush}/>}
      <CelebrationQueueRenderer queue={celebQueue} paused={celebPaused} onClose={closeCurrentCelebration} onViewRanking={()=>setTab("ranking")}/>
      {overtakenDetail && overtakenBanner && <OvertakenDetailModal overtakes={overtakenBanner.overtakes} profiles={overtakenBanner.profiles} onClose={()=>setOvertakenDetail(false)} onAddActivity={()=>{setOvertakenDetail(false);setAddMode("training");}}/>}
      <InstallPrompt/>
    </div>
  );
}
