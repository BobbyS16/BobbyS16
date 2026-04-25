import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { createClient } from "@supabase/supabase-js";

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
  "trail-s":  { label:"Trail Court (<30km)", icon:"⛰️", category:"trail",     refTime:2*3600+30*60, prestige:1.1 },
  "trail-m":  { label:"Trail Moyen (30-60)", icon:"⛰️", category:"trail",     refTime:5*3600+30*60, prestige:1.2 },
  "trail-l":  { label:"Trail Long (60-100)", icon:"⛰️", category:"trail",     refTime:10*3600,      prestige:1.3 },
  "trail-xl": { label:"Ultra Trail (100+)",  icon:"⛰️", category:"trail",     refTime:20*3600,      prestige:1.5 },
  "tri-s":    { label:"Triathlon S",         icon:"🏊", category:"triathlon", refTime:55*60,        prestige:1.1 },
  "tri-m":    { label:"Triathlon Olympique", icon:"🏊", category:"triathlon", refTime:1*3600+50*60, prestige:1.2 },
  "tri-l":    { label:"Half Ironman",        icon:"🏊", category:"triathlon", refTime:2*3600+56*60, prestige:1.3 },
  "tri-xl":   { label:"Ironman",             icon:"🏊", category:"triathlon", refTime:5*3600+50*60, prestige:1.5 },
  "hyrox-solo":   { label:"Hyrox Solo",      icon:"🔥", category:"hyrox",     refTime:55*60,        prestige:1.2 },
  "hyrox-double": { label:"Hyrox Double",    icon:"🔥", category:"hyrox",     refTime:50*60,        prestige:1.1 },
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

function calcPoints(discipline, timeSeconds) {
  const d = DISCIPLINES[discipline];
  if (!d || !timeSeconds) return 0;
  return Math.max(0, Math.min(Math.round(1000 * Math.pow(d.refTime / timeSeconds, 2) * d.prestige), 2000));
}
function sumBestPts(results) {
  const best={};
  results.forEach(r=>{const p=calcPoints(r.discipline,r.time);if(!best[r.discipline]||p>best[r.discipline])best[r.discipline]=p;});
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
function calcTrainingPts(distKm, sport, durationSec) {
  const d = distKm||0;
  if(!d) return 0;
  const sec = parseInt(durationSec)||0;
  let intensity = 3;
  if(sec > 0) {
    if(sport==="Run"||sport==="Trail"){
      const pace = (sec/60)/d; // min/km
      intensity = pace<4?10:pace<5?7:pace<6?5:3;
    } else if(sport==="Vélo"){
      const speed = d/(sec/3600); // km/h
      intensity = speed>=40?10:speed>=32?7:speed>=25?5:3;
    } else if(sport==="Natation"){
      const pace100 = (sec/60)/(d*10); // min/100m
      intensity = pace100<2?10:pace100<2.5?7:pace100<3?5:3;
    }
  }
  return Math.round(d * intensity * 0.2);
}
function getLevel(pts) {
  if (pts >= 900) return {label:"Élite",       color:"#FFD700"};
  if (pts >= 700) return {label:"Expert",      color:"#C0C0C0"};
  if (pts >= 500) return {label:"Avancé",      color:"#CD7F32"};
  if (pts >= 350) return {label:"Confirmé",    color:"#9B59B6"};
  if (pts >= 200) return {label:"Interméd.",   color:"#4A90D9"};
  return                 {label:"Débutant",    color:"#27AE60"};
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
  const ref=useRef(null), IH=40;
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
    ...(onDelete?[{icon:"🗑️",bg:"rgba(255,255,255,0.07)",onClick:onDelete}]:[]),
  ];
  const [offset,setOffset]=useState(0);
  const startX=useRef(null);
  const dragging=useRef(false);
  const W=btns.length===1?70:btns.length*60;
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
            <button key={i} onClick={()=>{close();b.onClick();}} style={{flex:1,background:b.bg,border:"none",color:b.color||"#F0EDE8",fontSize:20,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",fontWeight:700}}>{b.icon}</button>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── UI PRIMITIVES ─────────────────────────────────────────────────────────────
function Modal({onClose,children}) {
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
    <div ref={overlayRef} onClick={onClose} style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.85)",backdropFilter:"blur(10px)",display:"flex",alignItems:"flex-end",justifyContent:"center",zIndex:300}}>
      <div onClick={e=>e.stopPropagation()}
        style={{background:"#161616",border:"1px solid rgba(255,255,255,0.09)",borderRadius:"22px 22px 0 0",width:"100%",maxWidth:480,maxHeight:"92dvh",display:"flex",flexDirection:"column",transform:`translateY(${dy}px)`,transition:dragging.current?"none":"transform 0.25s ease"}}>
        <div onTouchStart={onHandleTouch} onTouchMove={onHandleMove} onTouchEnd={onHandleEnd}
          style={{padding:"18px 20px 18px",flexShrink:0,cursor:"grab",touchAction:"none",userSelect:"none"}}>
          <div style={{width:48,height:5,background:"rgba(255,255,255,0.3)",borderRadius:3,margin:"0 auto"}}/>
        </div>
        <div ref={scrollRef} style={{overflowY:"auto",padding:"0 20px",paddingBottom:"calc(44px + env(safe-area-inset-bottom))",flex:1,WebkitOverflowScrolling:"touch"}}>
          {children}
        </div>
      </div>
    </div>
  );
}
function Lbl({c}){return <div style={{fontSize:10,letterSpacing:1.5,textTransform:"uppercase",color:"rgba(240,237,232,0.35)",fontFamily:"'Barlow',sans-serif",marginBottom:6}}>{c}</div>;}
function Inp({value,onChange,placeholder,type="text"}){return <input value={value} onChange={e=>onChange(e.target.value)} placeholder={placeholder} type={type} style={{width:"100%",background:"rgba(255,255,255,0.05)",border:"1px solid rgba(255,255,255,0.1)",borderRadius:12,padding:"12px 14px",color:"#F0EDE8",fontSize:16,fontFamily:"'Barlow',sans-serif",outline:"none",boxSizing:"border-box",marginBottom:16}}/>;}
function Sel({value,onChange,children}){return <select value={value} onChange={e=>onChange(e.target.value)} style={{width:"100%",background:"#1e1e1e",border:"1px solid rgba(255,255,255,0.1)",borderRadius:12,padding:"12px 14px",color:"#F0EDE8",fontSize:14,fontFamily:"'Barlow',sans-serif",outline:"none",boxSizing:"border-box",marginBottom:16,appearance:"none"}}>{children}</select>;}
function Btn({children,onClick,variant="primary",mb=8,disabled=false,style={}}){
  const v={primary:{background:"#E63946",color:"#fff"},secondary:{background:"rgba(255,255,255,0.07)",color:"rgba(240,237,232,0.7)"},danger:{background:"rgba(230,57,70,0.15)",color:"#E63946"}};
  return <button onClick={onClick} disabled={disabled} style={{border:"none",borderRadius:14,cursor:"pointer",fontFamily:"'Barlow',sans-serif",fontWeight:700,fontSize:14,padding:"13px 0",width:"100%",transition:"opacity 0.2s",marginBottom:mb,...v[variant],...style,opacity:disabled?0.4:1}}>{children}</button>;
}
function PhotoViewer({src,onClose}){
  return (
    <div onClick={onClose} style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.96)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:500,cursor:"pointer",padding:20}}>
      <img src={src} style={{maxWidth:"100%",maxHeight:"100%",borderRadius:12,boxShadow:"0 10px 40px rgba(0,0,0,0.5)"}}/>
      <button onClick={onClose} style={{position:"absolute",top:"env(safe-area-inset-top, 20px)",right:20,width:40,height:40,borderRadius:"50%",background:"rgba(255,255,255,0.12)",color:"#fff",border:"none",fontSize:20,cursor:"pointer"}}>✕</button>
    </div>
  );
}

function Avatar({profile,size=48,highlight=false}){
  const initials=(profile?.name||"?").split(" ").map(w=>w[0]).join("").slice(0,2).toUpperCase();
  const hc=typeof highlight==="string"?highlight:"#E63946";
  return (
    <div style={{width:size,height:size,borderRadius:"50%",overflow:"hidden",flexShrink:0,background:highlight?hc:"rgba(255,255,255,0.1)",border:highlight?`3px solid ${hc}`:"2px solid rgba(255,255,255,0.1)",display:"flex",alignItems:"center",justifyContent:"center",fontFamily:"'Bebas Neue'",fontSize:size*0.35,color:"#fff",letterSpacing:1}}>
      {profile?.avatar?<img key={profile.avatar} src={profile.avatar} style={{width:"100%",height:"100%",objectFit:"cover"}} onError={e=>{e.target.style.display="none";}}/>:initials}
    </div>
  );
}

// ── RESULT MODAL ──────────────────────────────────────────────────────────────
function ResultModal({existing,userId,onSave,onClose}){
  const [discipline,setDisc]=useState(existing?.discipline||"10km");
  const [timeStr,setTime]=useState(existing?fmtTime(existing.time):"00:00:00");
  const [raceName,setRace]=useState(existing?.race||"");
  const today=(()=>{const n=new Date();return `${n.getFullYear()}-${String(n.getMonth()+1).padStart(2,"0")}-${String(n.getDate()).padStart(2,"0")}`;})();
  const [raceDate,setDate]=useState(existing?.race_date||today);
  const [loading,setLoading]=useState(false);
  const [error,setError]=useState("");
  const handleSave=async()=>{
    const[h,m,s]=timeStr.split(":").map(Number);const t=h*3600+m*60+s;
    if(!t){setError("Sélectionne un temps valide");return;}
    setLoading(true);setError("");
    const year=raceDate?parseInt(raceDate.slice(0,4)):CY;
    const payload={discipline,time:t,race:raceName||DISCIPLINES[discipline].label,year,race_date:raceDate||null};
    let err;
    if(existing){({error:err}=await supabase.from("results").update(payload).eq("id",existing.id));}
    else{({error:err}=await supabase.from("results").insert({...payload,user_id:userId}));}
    setLoading(false);
    if(err){setError("Erreur lors de l'enregistrement");return;}
    onSave();
  };
  return (
    <Modal onClose={onClose}>
      <div style={{fontFamily:"'Bebas Neue'",fontSize:22,color:"#F0EDE8",letterSpacing:1,marginBottom:12}}>{existing?"Modifier":"Ajouter"} un résultat</div>
      <Lbl c="Discipline"/><Sel value={discipline} onChange={setDisc}>{Object.entries(DISCIPLINES).map(([k,v])=><option key={k} value={k}>{v.icon} {v.label}</option>)}</Sel>
      <Lbl c="Temps"/>
      <div style={{background:"rgba(255,255,255,0.03)",borderRadius:14,padding:"12px",marginBottom:12}}><TimePicker value={timeStr} onChange={setTime}/></div>
      <Lbl c="Nom de la course (optionnel)"/><Inp value={raceName} onChange={setRace} placeholder="Ex: Marathon de Paris"/>
      <Lbl c="Date de la course"/>
      <div style={{background:"rgba(255,255,255,0.03)",borderRadius:14,padding:"12px",marginBottom:12}}><DatePicker value={raceDate} onChange={setDate}/></div>
      {error&&<div style={{color:"#E63946",fontSize:12,marginBottom:12,fontFamily:"'Barlow',sans-serif"}}>{error}</div>}
      <Btn onClick={handleSave} mb={8}>{loading?"Enregistrement...":"Valider"}</Btn>
      <Btn onClick={onClose} variant="secondary" mb={0}>Annuler</Btn>
    </Modal>
  );
}

// ── TRAINING MODAL ────────────────────────────────────────────────────────────
function TrainingModal({existing,userId,onSave,onClose}){
  const [sport,setSport]=useState(existing?.sport||"Run");
  const [dist,setDist]=useState(existing?String(existing.distance||""):"");
  const [deniv,setDeniv]=useState("");
  const [duration,setDur]=useState(existing?fmtTime(existing.duration||0):"00:00:00");
  const [date,setDate]=useState(existing?.date||"");
  const [loading,setLoading]=useState(false);
  const [error,setErr]=useState("");
  const handleSave=async()=>{
    if(!dist)return;
    setLoading(true);setErr("");
    const durationSec=parseDurStr(duration);
    const pts=calcTrainingPts(parseFloat(dist)||0,sport,durationSec);
    const payload={sport,distance:parseFloat(dist)||0,duration:durationSec,date:date||new Date().toISOString().split("T")[0],points:pts};
    let err;
    if(existing){({error:err}=await supabase.from("trainings").update(payload).eq("id",existing.id));}
    else{({error:err}=await supabase.from("trainings").insert({...payload,user_id:userId}));}
    setLoading(false);
    if(err){setErr(err.message||err.details||JSON.stringify(err));return;}
    onSave();
  };
  return (
    <Modal onClose={onClose}>
      <div style={{fontFamily:"'Bebas Neue'",fontSize:22,color:"#F0EDE8",letterSpacing:1,marginBottom:12}}>{existing?"Modifier":"Ajouter"} un entraînement</div>
      <Lbl c="Sport"/><Sel value={sport} onChange={setSport}>{TRAINING_SPORTS.filter(s=>s!=="All").map(s=><option key={s} value={s}>{s}</option>)}</Sel>
      <Lbl c="Distance (km)"/><Inp value={dist} onChange={setDist} placeholder="Ex: 12.5" type="number"/>
      {sport==="Trail"&&<><Lbl c="Dénivelé (m)"/><Inp value={deniv} onChange={setDeniv} placeholder="Ex: 800" type="number"/></>}
      <Lbl c="Durée"/>
      <div style={{background:"rgba(255,255,255,0.03)",borderRadius:14,padding:"12px",marginBottom:12}}><TimePicker value={duration} onChange={setDur}/></div>
      <Lbl c="Date"/>
      <div style={{background:"rgba(255,255,255,0.03)",borderRadius:14,padding:"12px",marginBottom:12}}><DatePicker value={date} onChange={setDate}/></div>
      {error&&<div style={{color:"#E63946",fontSize:12,marginBottom:12,fontFamily:"'Barlow',sans-serif"}}>{error}</div>}
      <Btn onClick={handleSave} mb={8}>{loading?"Enregistrement...":"Valider"}</Btn>
      <Btn onClick={onClose} variant="secondary" mb={0}>Annuler</Btn>
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
    const{error:updErr}=await supabase.from("profiles").update({name,city,birth_year:birthYear?parseInt(birthYear):null,gender,nationality:nat,avatar:avatar_url}).eq("id",profile.id);
    setLoading(false);
    if(updErr){setError("Sauvegarde échouée : "+updErr.message);return;}
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
      <Lbl c="Année de naissance"/><Inp value={birthYear} onChange={setBirth} placeholder="Ex: 1990" type="number"/>
      <Lbl c="Sexe"/><Sel value={gender} onChange={setGender}><option value="">Non précisé</option><option value="H">Homme</option><option value="F">Femme</option></Sel>
      <Lbl c="Nationalité"/><Inp value={nat} onChange={setNat} placeholder="Ex: Française"/>
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
    {label:"Débutant",min:0,color:"#27AE60"},
    {label:"Intermédiaire",min:200,color:"#4A90D9"},
    {label:"Confirmé",min:350,color:"#9B59B6"},
    {label:"Avancé",min:500,color:"#CD7F32"},
    {label:"Expert",min:700,color:"#C0C0C0"},
    {label:"Élite",min:900,color:"#FFD700"},
  ];
  return (
    <Modal onClose={onClose}>
      <div style={{fontFamily:"'Bebas Neue'",fontSize:28,color:"#F0EDE8",letterSpacing:2,marginBottom:4}}>Comment ça marche</div>
      <div style={{fontSize:11,color:"rgba(240,237,232,0.4)",letterSpacing:1.5,textTransform:"uppercase",fontFamily:"'Barlow',sans-serif",marginBottom:22}}>Le système PaceRank en 5 points</div>

      <Section title="1 · Calcul des points">
        <P>Ton temps est comparé au temps de référence d'un athlète <span style={{color:"#FFD700",fontWeight:700}}>élite mondial</span> sur la même distance. Plus tu t'en approches, plus tu marques de points.</P>
        <P>Un coefficient <span style={{color:"#F0EDE8",fontWeight:700}}>prestige</span> est associé à chaque épreuve selon sa difficulté : plus la course est longue et exigeante, plus il est élevé (×1.0 sur un 10 km, jusqu'à ×1.5 sur un Ironman ou un Ultra Trail).</P>
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
        <RefRow label="🔥 Hyrox Solo"           time="55:00" prestige="1.2" color="#E63946"/>
        <RefRow label="🔥 Hyrox Double"         time="50:00" prestige="1.1" color="#E63946"/>
      </Section>

      <Section title="2 · Niveaux par course">
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

      <Section title="3 · Points bonus">
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

      <Section title="4 · Le Streak">
        <P>Le streak compte le nombre de <span style={{color:"#F0EDE8",fontWeight:700}}>semaines consécutives</span> avec au moins une activité enregistrée (course ou entraînement).</P>
        <P>Tant que tu fais bouger la machine au moins une fois par semaine, ton streak grimpe. Si tu rates une semaine entière, il repart à zéro.</P>
      </Section>

      <Section title="5 · Les Ligues">
        <P>Chaque semaine, tu affrontes <span style={{color:"#F0EDE8",fontWeight:700}}>20 athlètes</span> de ton niveau dans une ligue. Le classement est basé uniquement sur tes <span style={{color:"#F0EDE8",fontWeight:700}}>points d'entraînement de la semaine</span> (les courses officielles ne comptent pas).</P>
        <div style={{display:"grid",gridTemplateColumns:"repeat(5,1fr)",gap:6,marginTop:10,marginBottom:10}}>
          {[
            {label:"Bronze",icon:"🥉",color:"#CD7F32"},
            {label:"Argent",icon:"🥈",color:"#C0C0C0"},
            {label:"Or",icon:"🥇",color:"#FFD700"},
            {label:"Platine",icon:"💎",color:"#4A90D9"},
            {label:"Élite",icon:"🔥",color:"#E63946"},
          ].map(l=>(
            <div key={l.label} style={{padding:"10px 4px",background:`${l.color}15`,border:`1px solid ${l.color}50`,borderRadius:10,textAlign:"center"}}>
              <div style={{fontSize:18}}>{l.icon}</div>
              <div style={{fontFamily:"'Barlow',sans-serif",fontWeight:700,fontSize:10,color:l.color,letterSpacing:0.5,marginTop:2,textTransform:"uppercase"}}>{l.label}</div>
            </div>
          ))}
        </div>
        <P>Les nouveaux athlètes démarrent en <span style={{color:"#CD7F32",fontWeight:700}}>Bronze</span> et progressent jusqu'à <span style={{color:"#E63946",fontWeight:700}}>Élite</span>.</P>
        <Bullet emoji="🏆" bold="TOP 5 ">→ promotion à la ligue supérieure le lundi suivant</Bullet>
        <Bullet emoji="🛡️" bold="Du 6e au 15e ">→ maintien dans la ligue actuelle</Bullet>
        <Bullet emoji="⚠️" bold="BOTTOM 5 ">→ relégation à la ligue inférieure</Bullet>
        <P>Les points <span style={{color:"#F0EDE8",fontWeight:700}}>remettent à 0 chaque lundi à 00h</span> : nouvelle semaine, nouveau classement.</P>
      </Section>

      <Section title="6 · Les disciplines">
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

const LEAGUES=[
  {id:"bronze", label:"Bronze", icon:"🥉",color:"#CD7F32",bg:"rgba(205,127,50,0.1)", border:"rgba(205,127,50,0.3)"},
  {id:"silver", label:"Argent", icon:"🥈",color:"#C0C0C0",bg:"rgba(192,192,192,0.1)",border:"rgba(192,192,192,0.3)"},
  {id:"gold",   label:"Or",     icon:"🥇",color:"#FFD700",bg:"rgba(255,215,0,0.1)",  border:"rgba(255,215,0,0.3)"},
  {id:"diamond",label:"Platine",icon:"💎",color:"#4A90D9",bg:"rgba(74,144,217,0.1)", border:"rgba(74,144,217,0.3)"},
  {id:"elite",  label:"Élite",  icon:"🔥",color:"#E63946",bg:"rgba(230,57,70,0.1)",  border:"rgba(230,57,70,0.3)"},
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
  const ptsToPromote=players.length>=5&&myPos>5?Math.max(1,players[4].trainPts-myPts+1):0;

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

          {/* CTA */}
          {ptsToPromote>0?(
            <div style={{marginTop:12,background:"linear-gradient(135deg,rgba(255,215,0,0.15),rgba(255,215,0,0.05))",
              border:"1px solid rgba(255,215,0,0.25)",borderRadius:14,padding:"14px 16px",
              display:"flex",alignItems:"center",gap:12}}>
              <span style={{fontSize:24,flexShrink:0}}>{nextLeague.icon}</span>
              <div style={{flex:1,minWidth:0}}>
                <div style={{fontFamily:"'Bebas Neue'",fontSize:15,color:"#FFD700",letterSpacing:1}}>
                  +{ptsToPromote} pts pour la {nextLeague.label} !
                </div>
                <div style={{fontSize:10,color:"rgba(240,237,232,0.45)",fontFamily:"'Barlow',sans-serif",marginTop:1}}>
                  Ajoute un entraînement pour grimper
                </div>
              </div>
              <button onClick={onAddTraining} style={{background:"#FFD700",border:"none",borderRadius:10,
                padding:"8px 12px",fontFamily:"'Bebas Neue'",fontSize:12,
                color:"#111",cursor:"pointer",letterSpacing:1,flexShrink:0}}>
                + SÉANCE
              </button>
            </div>
          ):myIdx>=0&&myPos<=5?(
            <div style={{marginTop:12,background:"rgba(255,215,0,0.08)",border:"1px solid rgba(255,215,0,0.25)",borderRadius:14,padding:"14px 16px",textAlign:"center"}}>
              <div style={{fontFamily:"'Bebas Neue'",fontSize:15,color:"#FFD700",letterSpacing:1}}>🔥 Tu es en zone promotion !</div>
              <div style={{fontSize:10,color:"rgba(240,237,232,0.5)",fontFamily:"'Barlow',sans-serif",marginTop:2}}>Tiens ta place jusqu'à lundi pour monter en {nextLeague.label}.</div>
            </div>
          ):null}
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

function HomeTab({profile,userId,onAddTraining,onAddRace,refreshKey,onOpenProfile}){
  const [results,setResults]=useState([]);
  const [trainings,setTrainings]=useState([]);
  const [fabOpen,setFabOpen]=useState(false);
  const [friendIds,setFriendIds]=useState(new Set());
  useEffect(()=>{
    if(!userId)return;
    supabase.from("results").select("*").eq("user_id",userId)
      .then(({data})=>setResults(data||[]));
    supabase.from("trainings").select("*").eq("user_id",userId)
      .then(({data,error})=>{if(!error)setTrainings(data||[]);});
  },[userId,refreshKey]);

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
        const trainPts=pTrains.reduce((s,t)=>s+(t.points||calcTrainingPts(t.distance,t.sport,t.duration)),0);
        const sports=[...new Set(pTrains.map(t=>t.sport).filter(Boolean))];
        return{id:p.id,name:p.name||"Athlète",avatar:p.avatar,trainPts,sessions:pTrains.length,sports,isMe:p.id===user.id};
      }).sort((a,b)=>b.trainPts-a.trainPts).slice(0,20);
      const myWeekTrainings=weekTrainings.filter(t=>t.user_id===user.id);
      const mySessions=myWeekTrainings.map(t=>{
        const dt=t.date?new Date(t.date):null;
        const dlbl=dt?DAY_FR[dt.getDay()]:"";
        const pts=t.points||calcTrainingPts(t.distance,t.sport,t.duration);
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
      const trainPts=discFilter==="All"?pSeasonTrainings.reduce((s,t)=>s+(t.points||calcTrainingPts(t.distance,t.sport,t.duration)),0):0;
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
    .sort((a,b)=>calcPoints(b.discipline,b.time)-calcPoints(a.discipline,a.time));
  const myBadges=computeBadges({results});
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
      <div style={{padding:"0 16px 4px",flexShrink:0}}>
      {/* Header */}
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",paddingTop:20,marginBottom:16}}>
        <div>
          <div style={{fontFamily:"'Bebas Neue'",fontSize:36,letterSpacing:3,lineHeight:1}}>
            <span style={{color:"#F0EDE8"}}>PACE</span><span style={{color:"#E63946"}}>RANK</span>
          </div>
          <div style={{fontSize:10,color:"rgba(240,237,232,0.3)",letterSpacing:3,fontFamily:"'Barlow',sans-serif"}}>RUN · TRIATHLON · TRAIL · HYROX</div>
        </div>
        <button onClick={handleShare} style={{background:"rgba(255,255,255,0.07)",border:"none",borderRadius:14,padding:"10px 14px",color:copied?"#27AE60":"rgba(240,237,232,0.6)",fontFamily:"'Barlow',sans-serif",fontWeight:700,fontSize:13,cursor:"pointer"}}>
          {copied?"✓ Copié !":"🔗 Inviter"}
        </button>
      </div>

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
            {bests.map((r,i)=>{const pts=calcPoints(r.discipline,r.time);const lv=getLevel(pts);return(
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
      </div>

      <div style={{flex:1,overflowY:"auto",padding:"0 16px",paddingBottom:"calc(110px + env(safe-area-inset-bottom))",WebkitOverflowScrolling:"touch"}}>
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
      </div>
      <div style={{position:"fixed",bottom:90,right:20,zIndex:99,width:56,height:56}}>
        {[
          {icon:"🏋️",label:"Entraînement",color:"#4ade80",cb:onAddTraining,tx:-12,ty:-68,delay:"0.06s"},
          {icon:"🏅",label:"Course officielle",color:"#E63946",cb:onAddRace,tx:-66,ty:-16,delay:"0s"},
        ].map(({icon,label,color,cb,tx,ty,delay},i)=>(
          <button key={i} onClick={()=>{setFabOpen(false);cb();}} style={{position:"absolute",top:12,left:12,width:32,height:32,background:"transparent",border:"none",padding:0,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",transform:fabOpen?`translate(${tx}px,${ty}px)`:"translate(0,0)",opacity:fabOpen?1:0,transition:`all 0.28s cubic-bezier(0.2,0.8,0.3,1.1) ${delay}`,pointerEvents:fabOpen?"auto":"none"}}>
            <span style={{position:"absolute",right:"calc(100% + 5px)",color,fontFamily:"'Barlow',sans-serif",fontSize:13,fontWeight:700,letterSpacing:0.5,whiteSpace:"nowrap",textShadow:"0 1px 3px rgba(0,0,0,0.9), 0 0 8px rgba(0,0,0,0.7)"}}>{label}</span>
            <span style={{fontSize:24,lineHeight:1,filter:"drop-shadow(0 2px 6px rgba(0,0,0,0.7))"}}>{icon}</span>
          </button>
        ))}
        <button onClick={()=>setFabOpen(v=>!v)} style={{position:"absolute",inset:0,width:56,height:56,borderRadius:"50%",background:"#E63946",border:"none",color:"#fff",fontSize:28,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",boxShadow:"0 4px 20px rgba(230,57,70,0.5)",transform:fabOpen?"rotate(45deg)":"rotate(0)",transition:"transform 0.22s"}}>+</button>
      </div>
      {openFriend&&<FriendProfileModal friend={openFriend} myId={profile?.id} onClose={()=>setOpenFriend(null)}/>}
    </div>
  );
}

// ── RANKING TAB ───────────────────────────────────────────────────────────────
function RankingTab({myProfile}){
  const [filter,setFilter]=useState("group");
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
    setTimeout(()=>{if(seasonsRef.current)seasonsRef.current.scrollLeft=seasonsRef.current.scrollWidth;},50);
  },[]);
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
      const racePts=filter==="discipline"?(()=>{const b=pRes.filter(r=>r.discipline===discFilter).sort((a,b)=>a.time-b.time)[0];return b?calcPoints(discFilter,b.time):0;})():sumBestPts(pRes);
      const tPts=filter==="discipline"?0:pTrainings.reduce((s,t)=>s+(t.points||0),0);
      const bonusPts=filter==="discipline"?0:raceBonusPts(pRes,pAllRes)+trainingBonusPts(pTrainings);
      const badges=computeBadges({results:pRes,trainings:pTrainings,profile:p});
      return{...p,pts:racePts+tPts+bonusPts,badges};
    }).sort((a,b)=>b.pts-a.pts);
    const myAgeCat=getAgeCat(myProfile?.birth_year);
    if(filter==="age_cat") display=display.filter(p=>getAgeCat(p.birth_year)===myAgeCat);
    if(filter==="gender")  display=display.filter(p=>p.gender===myProfile?.gender);
    if(filter==="city")    display=display.filter(p=>p.city&&myProfile?.city&&p.city.trim().toLowerCase()===myProfile.city.trim().toLowerCase());
    setPlayers(display);setLoading(false);
  };

  const FILTERS=[{k:"group",l:"👥 Groupe"},{k:"global",l:"🌍 Global"},{k:"discipline",l:"🏅 Discipline"},{k:"age_cat",l:"📅 Catégorie"},{k:"gender",l:"⚧ Sexe"},{k:"city",l:"🏙️ Ville"}];

  return (
    <div style={{flex:1,minHeight:0,display:"flex",flexDirection:"column",overflow:"hidden"}}>
      <div style={{padding:"0 16px 4px",flexShrink:0,overflowX:"hidden"}}>
      <div style={{fontFamily:"'Bebas Neue'",fontSize:28,letterSpacing:2,color:"#F0EDE8",paddingTop:20,marginBottom:12}}>Rank</div>
      {/* Season selector */}
      <div ref={seasonsRef} style={{display:"flex",alignItems:"center",gap:8,marginBottom:16,overflowX:"auto",scrollbarWidth:"none",WebkitOverflowScrolling:"touch",paddingBottom:4}}>
        {SEASONS.map(y=>(
          <button key={y} onClick={()=>setSeason(y)} style={{flex:"0 0 calc((100% - 24px) / 4)",padding:"7px 0",borderRadius:20,border:"none",cursor:"pointer",background:season===y?"#E63946":"rgba(255,255,255,0.06)",color:season===y?"#fff":"rgba(240,237,232,0.4)",fontFamily:"'Bebas Neue'",fontSize:18,letterSpacing:1,display:"flex",alignItems:"center",justifyContent:"center",gap:6}}>
            {y}
            {y===CY&&<span style={{width:6,height:6,borderRadius:"50%",background:season===y?"rgba(255,255,255,0.9)":"#27AE60",flexShrink:0}}/>}
          </button>
        ))}
      </div>
      <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:6,marginBottom:12}}>
        {FILTERS.map(f=><button key={f.k} onClick={()=>setFilter(f.k)} style={{padding:"7px 4px",borderRadius:20,border:"none",cursor:"pointer",background:filter===f.k?"#E63946":"rgba(255,255,255,0.06)",color:filter===f.k?"#fff":"rgba(240,237,232,0.5)",fontFamily:"'Barlow',sans-serif",fontWeight:600,fontSize:12,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{f.l}</button>)}
      </div>
      {filter==="discipline"&&<Sel value={discFilter} onChange={setDisc}>{Object.entries(DISCIPLINES).map(([k,v])=><option key={k} value={k}>{v.icon} {v.label}</option>)}</Sel>}
      {filter==="group"&&selGroup&&(
        <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:12}}>
          <button onClick={()=>setSelGroup(null)} style={{padding:"6px 12px",borderRadius:10,background:"rgba(255,255,255,0.06)",color:"rgba(240,237,232,0.7)",border:"none",cursor:"pointer",fontFamily:"'Barlow',sans-serif",fontWeight:700,fontSize:12}}>← Groupes</button>
          <div style={{fontFamily:"'Bebas Neue'",fontSize:18,color:"#F0EDE8",letterSpacing:1,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>🏠 {groups.find(g=>g.id===selGroup)?.name||""}</div>
        </div>
      )}
      </div>
      <div style={{flex:1,overflowY:"auto",padding:"0 16px",paddingBottom:"calc(100px + env(safe-area-inset-bottom))",WebkitOverflowScrolling:"touch"}}>
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
            <div style={{display:"flex",flexWrap:"wrap",gap:3,marginTop:2,alignItems:"center"}}>{(p.badges||[]).slice(0,6).map(b=><span key={b.id} style={{fontSize:11}}>{b.emoji}</span>)}{(p.badges||[]).length>6&&<span style={{fontSize:9,color:"rgba(240,237,232,0.45)",fontFamily:"'Barlow',sans-serif",fontWeight:700,marginLeft:1}}>+{(p.badges||[]).length-6}</span>}</div>
          </div>
          <div style={{textAlign:"right",flexShrink:0}}>
            <div style={{fontSize:14,color:"#F0EDE8",fontFamily:"'Barlow',sans-serif",fontWeight:700,letterSpacing:0.5}}>{i+1}/{players.length}</div>
            <div style={{fontFamily:"'Bebas Neue'",fontSize:22,color:lv.color,letterSpacing:1}}>{p.pts}</div>
          </div>
        </div>
      );})}
      </div>
      {openFriend&&<FriendProfileModal friend={openFriend} myId={myProfile?.id} onClose={()=>setOpenFriend(null)}/>}
    </div>
  );
}

// ── TRAINING TAB ──────────────────────────────────────────────────────────────
function TrainingTab({userId}){
  const [trainings,setTrainings]=useState([]);
  const [selSport,setSelSport]=useState("All");
  const [selYear,setSelYear]=useState(CY);
  const [editTraining,setEditTraining]=useState(null);
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

  const filtered=trainings.filter(t=>(selSport==="All"||t.sport===selSport)&&new Date(t.date).getFullYear()===selYear);
  const monthlyDist=MONTHS_FR.map((label,i)=>({label,value:Math.round(filtered.filter(t=>new Date(t.date).getMonth()===i).reduce((s,t)=>s+(t.distance||0),0))}));
  const totalDist=filtered.reduce((s,t)=>s+(t.distance||0),0);
  const totalPts=filtered.reduce((s,t)=>s+(t.points||calcTrainingPts(t.distance,t.sport,t.duration)),0);

  return (
    <div style={{flex:1,minHeight:0,display:"flex",flexDirection:"column",padding:"0 16px",boxSizing:"border-box"}}>
      <div style={{flexShrink:0}}>
      <div style={{paddingTop:20,marginBottom:16,display:"flex",alignItems:"center",justifyContent:"space-between",gap:10}}>
        <div style={{fontFamily:"'Bebas Neue'",fontSize:28,letterSpacing:2,color:"#F0EDE8"}}>Training</div>
        <button onClick={()=>setPlanView(plan?"detail":"setup")} style={{background:plan?"rgba(230,57,70,0.15)":"rgba(255,255,255,0.07)",border:"none",borderRadius:12,padding:"9px 13px",color:plan?"#E63946":"rgba(240,237,232,0.7)",fontFamily:"'Barlow',sans-serif",fontWeight:700,fontSize:12,cursor:"pointer",letterSpacing:0.5}}>📋 Plan</button>
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
        {[{l:"Distance",v:`${totalDist.toFixed(1)} km`},{l:"Points training",v:totalPts}].map(({l,v})=>(
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
      </div>
      <div style={{flex:1,minHeight:0,overflowY:"auto",WebkitOverflowScrolling:"touch",paddingBottom:"calc(100px + env(safe-area-inset-bottom))"}}>
      {filtered.slice(0,15).map((t,i)=>(
        <SwipeRow key={t.id||i} onDelete={()=>deleteTraining(t.id)} mb={0}>
          <ActivityCard myId={userId} activityType="training" activityId={t.id}>
            <div onClick={()=>setEditTraining(t)} style={{display:"flex",justifyContent:"space-between",alignItems:"center",cursor:"pointer"}}>
              <div>
                <div style={{fontFamily:"'Barlow',sans-serif",fontWeight:600,fontSize:13,color:"#F0EDE8"}}>{t.sport} · {t.distance} km</div>
                <div style={{fontSize:11,color:"rgba(240,237,232,0.35)",marginTop:2}}>{t.date?.split("-").reverse().join("-")}{t.duration?` · ${fmtDuration(t.duration)}`:""}</div>
              </div>
              <div style={{fontFamily:"'Bebas Neue'",fontSize:15,color:"#E63946",flexShrink:0}}>+{t.points||calcTrainingPts(t.distance,t.sport,t.duration)}pts</div>
            </div>
          </ActivityCard>
        </SwipeRow>
      ))}
      {filtered.length===0&&<div style={{textAlign:"center",color:"#444",padding:"30px 0",fontFamily:"'Barlow',sans-serif"}}>Aucune session !</div>}
      </div>
      {editTraining&&<TrainingModal existing={editTraining} userId={userId} onSave={()=>{setEditTraining(null);loadTrainings();}} onClose={()=>setEditTraining(null)}/>}
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
function PerfTab({userId,refreshKey}){
  const [results,setResults]=useState([]);
  const [subTab,setSubTab]=useState("bests");
  const [selDisc,setSelDisc]=useState("marathon");
  const [editResult,setEditResult]=useState(null);

  useEffect(()=>{
    if(!userId)return;
    supabase.from("results").select("*").eq("user_id",userId).order("year",{ascending:false})
      .then(({data})=>setResults(data||[]));
  },[userId,refreshKey]);

  const reload=()=>supabase.from("results").select("*").eq("user_id",userId).order("year",{ascending:false}).then(({data})=>setResults(data||[]));
  const deleteResult=async id=>{await supabase.from("results").delete().eq("id",id);reload();};

  const byDisc={};
  results.forEach(r=>{if(!byDisc[r.discipline]||r.time<byDisc[r.discipline].time)byDisc[r.discipline]=r;});

  const byYear={};
  [...results].forEach(r=>{const y=rYear(r);if(!byYear[y])byYear[y]=[];byYear[y].push(r);});

  const discResults=results.filter(r=>r.discipline===selDisc).sort((a,b)=>(a.race_date||`${a.year}-01-01`).localeCompare(b.race_date||`${b.year}-01-01`));
  const progressionData=discResults.map(r=>({label:String(rYear(r)),value:r.time}));

  return (
    <div style={{flex:1,minHeight:0,overflowY:"auto",padding:"0 16px",paddingBottom:"calc(100px + env(safe-area-inset-bottom))",WebkitOverflowScrolling:"touch",boxSizing:"border-box"}}>
      <div style={{fontFamily:"'Bebas Neue'",fontSize:28,letterSpacing:2,color:"#F0EDE8",paddingTop:20,marginBottom:16}}>Performances</div>
      <div style={{display:"flex",gap:6,marginBottom:14}}>
        {[["bests","🏆 Records"],["history","📅 Historique"],["progression","📈 Progression"]].map(([k,l])=>(
          <button key={k} onClick={()=>setSubTab(k)} style={{flex:1,padding:"8px 0",borderRadius:12,border:"none",cursor:"pointer",background:subTab===k?"rgba(230,57,70,0.12)":"rgba(255,255,255,0.05)",color:subTab===k?"#E63946":"rgba(240,237,232,0.4)",fontFamily:"'Barlow',sans-serif",fontWeight:700,fontSize:11}}>{l}</button>
        ))}
      </div>

      {subTab==="bests"&&(
        <div>
          {[{cat:"running",label:"🏃 Run",color:"#4A90D9"},{cat:"triathlon",label:"🏊 Triathlon",color:"#9B59B6"},{cat:"trail",label:"⛰️ Trail",color:"#27AE60"},{cat:"hyrox",label:"🔥 Hyrox",color:"#E63946"}].map(({cat,label,color})=>{
            const catDiscs=Object.entries(DISCIPLINES).filter(([,d])=>d.category===cat);
            const catBests=catDiscs.map(([disc])=>byDisc[disc]?[disc,byDisc[disc]]:null).filter(Boolean);
            return(
              <div key={cat} style={{marginBottom:22}}>
                <div style={{fontFamily:"'Bebas Neue'",fontSize:16,letterSpacing:2,color,marginBottom:10}}>{label}</div>
                {catBests.length===0
                  ?<div style={{textAlign:"center",color:"#444",fontSize:12,padding:"12px 0",fontFamily:"'Barlow',sans-serif"}}>Aucun résultat</div>
                  :catBests.map(([disc,r])=>{const pts=calcPoints(disc,r.time);const lv=getLevel(pts);return(
                    <div key={disc} style={{display:"flex",alignItems:"center",gap:12,padding:"12px 16px",background:"rgba(255,255,255,0.03)",borderRadius:14,marginBottom:7,border:"1px solid rgba(255,255,255,0.05)"}}>
                      <div style={{flex:1,minWidth:0}}>
                        <div style={{fontFamily:"'Bebas Neue'",fontWeight:700,fontSize:16,color:"#F0EDE8",letterSpacing:1}}>{DISCIPLINES[disc]?.label}</div>
                        <div style={{fontSize:11,color:"#F0EDE8",fontFamily:"'Barlow',sans-serif",marginTop:2}}>{r.race||""}{r.race_date?` · ${r.race_date.slice(0,4)}`:r.year?` · ${r.year}`:""}</div>
                      </div>
                      <div style={{flexShrink:0,textAlign:"right",display:"flex",flexDirection:"column",alignItems:"flex-end",gap:2}}>
                        <div style={{fontFamily:"'Bebas Neue'",fontSize:28,color:lv.color,letterSpacing:1,lineHeight:1}}>{fmtTime(r.time)}</div>
                        <div style={{fontSize:9,color:lv.color,fontFamily:"'Barlow',sans-serif",fontWeight:700,letterSpacing:0.5,textTransform:"uppercase"}}>{lv.label}</div>
                      </div>
                    </div>
                  );})}
              </div>
            );
          })}
        </div>
      )}

      {subTab==="history"&&(
        <div>
          {Object.entries(byYear).sort((a,b)=>b[0]-a[0]).map(([yr,res])=>(
            <div key={yr} style={{marginBottom:18}}>
              <div style={{fontFamily:"'Bebas Neue'",fontSize:22,color:"#F0EDE8",fontWeight:700,letterSpacing:2,marginBottom:7}}>{yr}</div>
              {[...res].sort((a,b)=>{const cats=["running","trail","triathlon"];return cats.indexOf(DISCIPLINES[a.discipline]?.category)-cats.indexOf(DISCIPLINES[b.discipline]?.category);}).map((r,i)=>{
                const pts=calcPoints(r.discipline,r.time);const lv=getLevel(pts);return(
                <SwipeRow key={r.id||i} onDelete={()=>deleteResult(r.id)}>
                  <div onClick={()=>setEditResult(r)} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"11px 14px",background:"rgba(255,255,255,0.03)",border:"1px solid rgba(255,255,255,0.05)",borderRadius:12,cursor:"pointer"}}>
                    <div><div style={{fontFamily:"'Barlow',sans-serif",fontWeight:600,fontSize:13,color:"#F0EDE8"}}>{DISCIPLINES[r.discipline]?.icon} {r.race||DISCIPLINES[r.discipline]?.label}</div></div>
                    <div style={{textAlign:"right"}}><div style={{fontFamily:"'Bebas Neue'",fontSize:19,color:lv.color}}>{fmtTime(r.time)}</div><div style={{fontSize:10,color:"rgba(240,237,232,0.3)",fontFamily:"'Barlow',sans-serif"}}>{pts} pts</div></div>
                  </div>
                </SwipeRow>
              );})}
            </div>
          ))}
          {results.length===0&&<div style={{textAlign:"center",color:"#444",padding:"40px 0",fontFamily:"'Barlow',sans-serif"}}>Aucun résultat</div>}
        </div>
      )}

      {subTab==="progression"&&(
        <div>
          <Sel value={selDisc} onChange={setSelDisc}>{Object.entries(DISCIPLINES).map(([k,v])=><option key={k} value={k}>{v.icon} {v.label}</option>)}</Sel>
          <div style={{background:"rgba(255,255,255,0.03)",borderRadius:14,padding:"16px",marginBottom:14,border:"1px solid rgba(255,255,255,0.06)"}}>
            <LineChart data={progressionData} color="#E63946" title={`Progression ${DISCIPLINES[selDisc]?.label}`} invert={true} formatY={v=>{const maxT=Math.max(...progressionData.map(d=>d.value));return maxT>2*3600?`${Math.floor(v/3600)}h${String(Math.floor((v%3600)/60)).padStart(2,"0")}`:`${Math.floor(v/60)}min`;}} />
          </div>
          {discResults.map((r,i)=>{const pts=calcPoints(r.discipline,r.time);const lv=getLevel(pts);return(
            <div key={i} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"11px 14px",background:"rgba(255,255,255,0.03)",borderRadius:12,marginBottom:6,border:"1px solid rgba(255,255,255,0.05)"}}>
              <div><div style={{fontFamily:"'Barlow',sans-serif",fontWeight:600,fontSize:13,color:"#F0EDE8"}}>{r.race||DISCIPLINES[r.discipline]?.label}</div><div style={{fontSize:11,color:"rgba(240,237,232,0.3)",fontFamily:"'Barlow',sans-serif"}}>{rYear(r)}</div></div>
              <div style={{fontFamily:"'Bebas Neue'",fontSize:19,color:lv.color}}>{fmtTime(r.time)}</div>
            </div>
          );})}
          {discResults.length===0&&<div style={{textAlign:"center",color:"#444",padding:"30px 0",fontFamily:"'Barlow',sans-serif"}}>Aucun résultat pour cette discipline</div>}
        </div>
      )}
      {editResult&&<ResultModal existing={editResult} userId={userId} onSave={()=>{setEditResult(null);reload();}} onClose={()=>setEditResult(null)}/>}
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
      <div style={{height:340,overflowY:"auto",display:"flex",flexDirection:"column",gap:8,marginBottom:12,paddingRight:4}}>
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
      <div style={{display:"flex",gap:8,alignItems:"flex-end"}}>
        <textarea value={text} onChange={e=>setText(e.target.value)} onKeyDown={onKey}
          placeholder="Message…" rows={1}
          style={{flex:1,background:"rgba(255,255,255,0.06)",border:"1px solid rgba(255,255,255,0.1)",borderRadius:12,padding:"10px 14px",color:"#F0EDE8",fontSize:14,fontFamily:"'Barlow',sans-serif",outline:"none",resize:"none",boxSizing:"border-box"}}/>
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
    <div style={{flex:1,minHeight:0,overflowY:"auto",padding:"0 16px",paddingBottom:"calc(100px + env(safe-area-inset-bottom))",WebkitOverflowScrolling:"touch",boxSizing:"border-box"}}>
      <div style={{fontFamily:"'Bebas Neue'",fontSize:28,letterSpacing:2,color:"#F0EDE8",paddingTop:20,marginBottom:16}}>Social</div>
      <div style={{display:"flex",gap:6,marginBottom:14}}>
        {[["friends","👥 Amis"],["groups","🏠 Groupes"],["search","🔍 Chercher"]].map(([k,l])=>(
          <button key={k} onClick={()=>setTab(k)} style={{flex:1,padding:"8px 0",borderRadius:12,border:"none",cursor:"pointer",background:tab===k?"#E63946":"rgba(255,255,255,0.06)",color:tab===k?"#fff":"rgba(240,237,232,0.5)",fontFamily:"'Barlow',sans-serif",fontWeight:600,fontSize:12,position:"relative"}}>
            {l}
            {k==="friends"&&notifs.length>0&&<span style={{position:"absolute",top:4,right:6,background:"#E63946",borderRadius:"50%",minWidth:16,height:16,padding:"0 4px",display:"inline-flex",alignItems:"center",justifyContent:"center",fontSize:9,color:"#fff",fontFamily:"'Bebas Neue'",fontWeight:700,lineHeight:1,border:tab===k?"1.5px solid #fff":"none"}}>{notifs.length>9?"9+":notifs.length}</span>}
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
        {notifs.length>0&&<div style={{marginBottom:14}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
            <div style={{fontFamily:"'Barlow',sans-serif",fontSize:11,letterSpacing:1.5,textTransform:"uppercase",color:"rgba(240,237,232,0.5)",fontWeight:700}}>🔔 Notifications</div>
            <button onClick={markAllNotifsRead} style={{background:"none",border:"none",color:"rgba(240,237,232,0.4)",fontFamily:"'Barlow',sans-serif",fontSize:11,cursor:"pointer",fontWeight:600}}>Tout marquer lu</button>
          </div>
          {notifs.map(n=>{
            const txt={friend_added:"t'a ajouté en ami",like_result:"a aimé ta course",like_training:"a aimé ton entraînement",comment_result:"a commenté ta course",comment_training:"a commenté ton entraînement"}[n.type]||"";
            return (
              <div key={n.id} style={{display:"flex",alignItems:"center",gap:12,padding:"10px 14px",background:"rgba(230,57,70,0.08)",borderRadius:14,marginBottom:7,border:"1px solid rgba(230,57,70,0.2)"}}>
                <div onClick={()=>n.from_user&&setOpenFriend(n.from_user)} style={{cursor:"pointer"}}><Avatar profile={n.from_user} size={32}/></div>
                <div onClick={()=>n.from_user&&setOpenFriend(n.from_user)} style={{flex:1,minWidth:0,cursor:"pointer"}}>
                  <div style={{fontFamily:"'Barlow',sans-serif",fontSize:13,color:"#F0EDE8"}}><strong>{n.from_user?.name||"Quelqu'un"}</strong> {txt}</div>
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
          <div key={f.id} style={{display:"flex",alignItems:"center",gap:12,padding:"11px 14px",background:"rgba(255,255,255,0.03)",borderRadius:14,marginBottom:7,border:"1px solid rgba(255,255,255,0.05)"}}>
            <div onClick={()=>setOpenFriend(f.friend)} style={{display:"flex",alignItems:"center",gap:12,flex:1,cursor:"pointer",minWidth:0}}>
              <Avatar profile={f.friend} size={36}/>
              <div style={{flex:1,minWidth:0}}>
                <div style={{fontFamily:"'Barlow',sans-serif",fontWeight:700,fontSize:14,color:"#F0EDE8",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{f.friend?.name||"Anonyme"}</div>
                <div style={{fontSize:11,color:"rgba(240,237,232,0.35)"}}>{getAgeCat(f.friend?.birth_year)||""}{f.friend?.city?` · ${f.friend.city}`:""}</div>
              </div>
            </div>
            <button onClick={()=>setChat({type:"dm",id:dmId,title:f.friend?.name||"Message",friendId:f.friend_id})} style={{padding:"6px 10px",borderRadius:10,background:"rgba(255,255,255,0.07)",color:"rgba(240,237,232,0.7)",border:"none",cursor:"pointer",fontSize:15}}>💬</button>
            <button onClick={()=>removeFriend(f.friend_id)} style={{padding:"6px 10px",borderRadius:10,background:"rgba(230,57,70,0.1)",color:"#E63946",border:"none",cursor:"pointer",fontSize:13}}>✕</button>
          </div>
        );})}

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
function ProfileModal({profile,results,onRefresh,onClose}){
  const [showEdit,setShowEdit]=useState(false);
  const [showDelAcc,setDelAcc]=useState(false);
  const [showHelp,setShowHelp]=useState(false);
  const [friendCount,setFriendCount]=useState(0);
  const [trainings,setTrainings]=useState([]);
  const [groupsCreated,setGroupsCreated]=useState(0);
  const [showPhoto,setShowPhoto]=useState(false);
  const [season,setSeason]=useState(CY);
  const [panel,setPanel]=useState("races");
  const [hidden,setHidden]=useState(!!profile?.ranking_hidden);
  useEffect(()=>{setHidden(!!profile?.ranking_hidden);},[profile?.ranking_hidden]);
  const [stravaTokens,setStravaTokens]=useState(null);
  const [stravaBusy,setStravaBusy]=useState(false);
  const [stravaMsg,setStravaMsg]=useState("");
  useEffect(()=>{
    try{const raw=localStorage.getItem(`strava_${profile.id}`);if(raw)setStravaTokens(JSON.parse(raw));}catch{}
  },[profile.id]);
  const connectStrava=()=>{
    const url=`https://www.strava.com/oauth/authorize?client_id=230065&response_type=code&redirect_uri=${encodeURIComponent(window.location.origin)}&approval_prompt=auto&scope=read,activity:read&state=strava`;
    window.location.href=url;
  };
  const disconnectStrava=()=>{
    try{localStorage.removeItem(`strava_${profile.id}`);}catch{}
    setStravaTokens(null);setStravaMsg("");
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
        inserts.push({user_id:profile.id,sport,distance,duration,date,points:calcTrainingPts(distance,sport,duration)});
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
  const seasonPts=sumBestPts(seasonResults)+seasonTrainings.reduce((s,t)=>s+(t.points||calcTrainingPts(t.distance,t.sport,t.duration)),0)+raceBonusPts(seasonResults,results)+trainingBonusPts(seasonTrainings);
  const lv=getSeasonLevel(seasonPts);

  useEffect(()=>{
    supabase.from("friendships").select("id",{count:"exact",head:true}).eq("user_id",profile.id).eq("status","accepted")
      .then(({count})=>setFriendCount(count||0));
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
          <div style={{fontSize:12,color:"rgba(240,237,232,0.4)",fontFamily:"'Barlow',sans-serif",marginTop:2}}>{[profile.city,getAgeCat(profile.birth_year),profile.gender,profile.nationality].filter(Boolean).join(" · ")}</div>
          <div style={{marginTop:4}}><span style={{fontFamily:"'Bebas Neue'",fontSize:17,color:lv.color,letterSpacing:1}}>{lv.label}</span></div>
        </div>
        <div style={{textAlign:"right",flexShrink:0}}>
          <div style={{fontFamily:"'Bebas Neue'",fontSize:34,color:lv.color,letterSpacing:1,lineHeight:1}}>{seasonPts}</div>
          <div style={{fontSize:9,color:"rgba(240,237,232,0.5)",letterSpacing:1.5,textTransform:"uppercase",fontFamily:"'Barlow',sans-serif"}}>pts saison</div>
        </div>
      </div>
      <div style={{display:"flex",gap:10,marginBottom:18}}>
        <div style={{flex:1,background:"rgba(255,255,255,0.04)",borderRadius:12,padding:"12px",textAlign:"center",border:"1px solid rgba(255,255,255,0.06)"}}>
          <div style={{fontFamily:"'Bebas Neue'",fontSize:26,color:"#F0EDE8"}}>{friendCount}</div>
          <div style={{fontSize:10,color:"rgba(240,237,232,0.35)",fontFamily:"'Barlow',sans-serif",letterSpacing:1,textTransform:"uppercase"}}>Amis</div>
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
      <div style={{fontFamily:"'Barlow',sans-serif",fontSize:11,color:"rgba(240,237,232,0.55)",lineHeight:1.7,marginBottom:14}}>
        {[
          [{label:"Débutant",min:0,color:"#27AE60"},{label:"Intermédiaire",min:300,color:"#4A90D9"},{label:"Confirmé",min:700,color:"#9B59B6"}],
          [{label:"Avancé",min:1300,color:"#CD7F32"},{label:"Expert",min:2000,color:"#C0C0C0"},{label:"Élite",min:3000,color:"#FFD700"}],
          [{label:"Star",min:4500,color:"#00D4FF"},{label:"SuperStar",min:6500,color:"#FF6B35"},{label:"UltraStar",min:9000,color:"#FF1493"}],
        ].map((row,i)=>(
          <div key={i} style={{display:"flex",justifyContent:"space-between",gap:8}}>
            {row.map(l=>(<span key={l.label}><span style={{color:l.color,fontWeight:700}}>{l.label}</span> dès {l.min} pts</span>))}
          </div>
        ))}
      </div>
      </div>
      <div style={{paddingTop:8}}>
      {panel==="badges"
        ?<BadgesByCategory badges={badges}/>
        :(results.length===0
          ?<div style={{textAlign:"center",color:"#444",padding:"30px 0",fontFamily:"'Barlow',sans-serif",fontSize:13,marginBottom:14}}>Aucune course enregistrée</div>
          :<div style={{marginBottom:14}}>
            {[...results].sort((a,b)=>(b.race_date||`${b.year}-12-31`).localeCompare(a.race_date||`${a.year}-12-31`)).map(r=>{
              const pts=calcPoints(r.discipline,r.time);const ptsLv=getLevel(pts);
              return(
                <div key={r.id} style={{display:"flex",justifyContent:"space-between",alignItems:"center",gap:10,padding:"11px 14px",background:"rgba(255,255,255,0.03)",borderRadius:12,marginBottom:6,border:"1px solid rgba(255,255,255,0.05)"}}>
                  <div style={{flex:1,minWidth:0}}>
                    <div style={{fontSize:10,color:"rgba(240,237,232,0.45)",fontFamily:"'Barlow',sans-serif",marginBottom:2}}>{DISCIPLINES[r.discipline]?.icon} {DISCIPLINES[r.discipline]?.label} · {rYear(r)}</div>
                    <div style={{fontFamily:"'Bebas Neue'",fontSize:18,color:"#F0EDE8",letterSpacing:1}}>{fmtTime(r.time)}</div>
                    {r.race&&<div style={{fontSize:11,color:"rgba(240,237,232,0.5)",fontFamily:"'Barlow',sans-serif",marginTop:2,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{r.race}</div>}
                  </div>
                  <div style={{textAlign:"right",flexShrink:0}}>
                    <div style={{fontFamily:"'Bebas Neue'",fontSize:20,color:ptsLv.color,letterSpacing:1}}>{pts}</div>
                    <div style={{fontSize:9,color:"rgba(240,237,232,0.35)",fontFamily:"'Barlow',sans-serif",letterSpacing:1,textTransform:"uppercase"}}>pts</div>
                  </div>
                </div>
              );
            })}
          </div>)
      }
      <div style={{paddingTop:10}}>
      <div style={{display:"flex",alignItems:"center",gap:10,padding:"10px 14px",background:"rgba(252,76,2,0.08)",border:"1px solid rgba(252,76,2,0.3)",borderRadius:14,marginBottom:10}}>
        <div style={{fontSize:22,flexShrink:0}}>🏃‍♂️</div>
        <div style={{flex:1,minWidth:0}}>
          <div style={{fontFamily:"'Bebas Neue'",fontSize:15,color:"#FC4C02",letterSpacing:1}}>Synchronisation Strava bientôt disponible 🚀</div>
          <div style={{fontSize:11,color:"rgba(240,237,232,0.6)",fontFamily:"'Barlow',sans-serif",marginTop:1,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>En attente de validation Strava — disponible sous peu</div>
        </div>
        <button disabled style={{padding:"7px 12px",borderRadius:10,background:"#FC4C02",border:"none",color:"#fff",cursor:"not-allowed",fontFamily:"'Barlow',sans-serif",fontWeight:700,fontSize:12,flexShrink:0,opacity:0.4}}>Connecter</button>
      </div>
      <button onClick={()=>setShowHelp(true)} style={{width:"100%",padding:"12px 0",borderRadius:14,background:"rgba(255,255,255,0.05)",border:"1px solid rgba(255,255,255,0.08)",color:"#F0EDE8",cursor:"pointer",fontFamily:"'Barlow',sans-serif",fontWeight:700,fontSize:13,marginBottom:10}}>❓ Comment ça marche</button>
      <button onClick={async()=>{await supabase.auth.signOut();}} style={{width:"100%",padding:"12px 0",borderRadius:14,background:"rgba(255,255,255,0.05)",border:"1px solid rgba(255,255,255,0.08)",color:"rgba(240,237,232,0.7)",cursor:"pointer",fontFamily:"'Barlow',sans-serif",fontWeight:700,fontSize:13,marginBottom:10}}>🚪 Se déconnecter</button>
      <button onClick={()=>setDelAcc(true)} style={{width:"100%",padding:"11px 0",borderRadius:14,background:"transparent",border:"1px solid rgba(230,57,70,0.2)",color:"rgba(230,57,70,0.5)",cursor:"pointer",fontFamily:"'Barlow',sans-serif",fontWeight:600,fontSize:13}}>Supprimer mon compte</button>
      </div>
      </div>
      {showEdit&&<EditProfileModal profile={profile} onSave={()=>{setShowEdit(false);onRefresh();}} onClose={()=>setShowEdit(false)}/>}
      {showPhoto&&profile?.avatar&&<PhotoViewer src={profile.avatar} onClose={()=>setShowPhoto(false)}/>}
      {showDelAcc&&<DeleteAccountModal onClose={()=>setDelAcc(false)}/>}
      {showHelp&&<HowItWorksModal onClose={()=>setShowHelp(false)}/>}
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
  const [groupsCreated,setGroupsCreated]=useState(0);
  const [season,setSeason]=useState(CY);
  const [tab,setTab]=useState("races");
  const [loading,setLoading]=useState(true);
  const [showPhoto,setShowPhoto]=useState(false);
  const seasonsRef=useRef(null);

  useEffect(()=>{loadAll();},[friend.id]);
  useEffect(()=>{setTimeout(()=>{if(seasonsRef.current)seasonsRef.current.scrollLeft=seasonsRef.current.scrollWidth;},50);},[]);

  const loadAll=async()=>{
    setLoading(true);
    const[{data:r},{data:t},{data:prof},{count:fc},{count:gc}]=await Promise.all([
      supabase.from("results").select("*").eq("user_id",friend.id).order("year",{ascending:false}),
      supabase.from("trainings").select("*").eq("user_id",friend.id).order("date",{ascending:false}),
      supabase.from("profiles").select("*").eq("id",friend.id).single(),
      supabase.from("friendships").select("id",{count:"exact",head:true}).eq("user_id",friend.id).eq("status","accepted"),
      supabase.from("groups").select("id",{count:"exact",head:true}).eq("created_by",friend.id),
    ]);
    setResults(r||[]);setTrainings(t||[]);
    if(prof)setFullProfile(prof);
    setFriendCount(fc||0);setGroupsCreated(gc||0);
    setLoading(false);
  };

  const seasonResults=results.filter(r=>r.year===season);
  const seasonTrainings=trainings.filter(t=>new Date(t.date).getFullYear()===season);
  const seasonPts=sumBestPts(seasonResults)+seasonTrainings.reduce((s,t)=>s+(t.points||calcTrainingPts(t.distance,t.sport,t.duration)),0)+raceBonusPts(seasonResults,results)+trainingBonusPts(seasonTrainings);
  const lv=getSeasonLevel(seasonPts);
  const badges=computeBadges({results,trainings,profile:fullProfile,friendCount,groupsCreated});
  const bests=Object.values(results.reduce((acc,r)=>{if(!acc[r.discipline]||r.time<acc[r.discipline].time)acc[r.discipline]=r;return acc;},{}))
    .sort((a,b)=>calcPoints(b.discipline,b.time)-calcPoints(a.discipline,a.time));

  return (
    <Modal onClose={onClose}>
      <div style={{display:"flex",gap:14,alignItems:"center",marginBottom:16}}>
        <div onClick={()=>fullProfile?.avatar&&setShowPhoto(true)} style={{cursor:fullProfile?.avatar?"pointer":"default"}}><Avatar profile={fullProfile} size={64} highlight={lv.color}/></div>
        <div style={{flex:1,minWidth:0}}>
          <div style={{fontFamily:"'Bebas Neue'",fontSize:22,letterSpacing:1,color:"#F0EDE8",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{fullProfile?.name||friend.name||"Athlète"}</div>
          <div style={{fontSize:12,color:"rgba(240,237,232,0.4)",fontFamily:"'Barlow',sans-serif",marginTop:2}}>{[fullProfile?.city,getAgeCat(fullProfile?.birth_year),fullProfile?.gender,fullProfile?.nationality].filter(Boolean).join(" · ")}</div>
          <div style={{marginTop:4}}><span style={{fontFamily:"'Bebas Neue'",fontSize:17,color:lv.color,letterSpacing:1}}>{lv.label}</span></div>
        </div>
        <div style={{textAlign:"right",flexShrink:0}}>
          <div style={{fontFamily:"'Bebas Neue'",fontSize:34,color:lv.color,letterSpacing:1,lineHeight:1}}>{seasonPts}</div>
          <div style={{fontSize:9,color:"rgba(240,237,232,0.5)",letterSpacing:1.5,textTransform:"uppercase",fontFamily:"'Barlow',sans-serif"}}>pts saison</div>
        </div>
      </div>

      <div style={{display:"flex",gap:10,marginBottom:18}}>
        <div style={{flex:1,background:"rgba(255,255,255,0.04)",borderRadius:12,padding:"12px",textAlign:"center",border:"1px solid rgba(255,255,255,0.06)"}}>
          <div style={{fontFamily:"'Bebas Neue'",fontSize:26,color:"#F0EDE8"}}>{friendCount}</div>
          <div style={{fontSize:10,color:"rgba(240,237,232,0.35)",fontFamily:"'Barlow',sans-serif",letterSpacing:1,textTransform:"uppercase"}}>Amis</div>
        </div>
        <div style={{flex:1,background:"rgba(255,255,255,0.04)",borderRadius:12,padding:"12px",textAlign:"center",border:"1px solid rgba(255,255,255,0.06)"}}>
          <div style={{fontFamily:"'Bebas Neue'",fontSize:26,color:"#F0EDE8"}}>{badges.length}</div>
          <div style={{fontSize:10,color:"rgba(240,237,232,0.35)",fontFamily:"'Barlow',sans-serif",letterSpacing:1,textTransform:"uppercase"}}>Badges</div>
        </div>
        <div style={{flex:1,background:"rgba(255,255,255,0.04)",borderRadius:12,padding:"12px",textAlign:"center",border:"1px solid rgba(255,255,255,0.06)"}}>
          <div style={{fontFamily:"'Bebas Neue'",fontSize:26,color:"#F0EDE8"}}>{results.length}</div>
          <div style={{fontSize:10,color:"rgba(240,237,232,0.35)",fontFamily:"'Barlow',sans-serif",letterSpacing:1,textTransform:"uppercase"}}>Courses</div>
        </div>
      </div>

      {bests.length>0&&(
        <div style={{marginBottom:18}}>
          <div style={{fontSize:10,color:"rgba(240,237,232,0.35)",letterSpacing:1.5,textTransform:"uppercase",fontFamily:"'Barlow',sans-serif",marginBottom:10}}>Records</div>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"10px 16px"}}>
            {bests.map((r,i)=>{const pts=calcPoints(r.discipline,r.time);const ptsLv=getLevel(pts);return(
              <div key={i}>
                <div style={{fontSize:10,color:"rgba(240,237,232,0.35)",fontFamily:"'Barlow',sans-serif",marginBottom:2}}>{DISCIPLINES[r.discipline]?.icon} {DISCIPLINES[r.discipline]?.label}</div>
                <div style={{fontFamily:"'Bebas Neue'",fontSize:18,color:"#F0EDE8",letterSpacing:1}}>{fmtTime(r.time)}</div>
                <div style={{fontSize:11,color:ptsLv.color,fontFamily:"'Barlow',sans-serif",fontWeight:700}}>{pts} pts</div>
              </div>
            );})}
          </div>
        </div>
      )}

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
          const pts=calcPoints(r.discipline,r.time);
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
        :seasonTrainings.map(t=>{
          const pts=t.points||calcTrainingPts(t.distance,t.sport,t.duration);
          return (
            <ActivityCard key={t.id} myId={myId} activityType="training" activityId={t.id}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",gap:10}}>
                <div style={{flex:1,minWidth:0}}>
                  <div style={{fontFamily:"'Barlow',sans-serif",fontWeight:700,fontSize:14,color:"#F0EDE8"}}>{t.sport} · {t.distance} km</div>
                  <div style={{fontSize:11,color:"rgba(240,237,232,0.4)",marginTop:2,fontFamily:"'Barlow',sans-serif"}}>{t.date?.split("-").reverse().join("-")}{t.duration?` · ${fmtDuration(t.duration)}`:""}</div>
                </div>
                <div style={{fontFamily:"'Bebas Neue'",fontSize:16,color:"#E63946",flexShrink:0}}>+{pts}pts</div>
              </div>
            </ActivityCard>
          );
        })
      )}

      <div style={{marginTop:18}}><BadgesByCategory badges={badges}/></div>
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
    <div style={{position:"fixed",bottom:0,left:0,right:0,background:"rgba(14,14,14,0.97)",backdropFilter:"blur(20px)",borderTop:"1px solid rgba(255,255,255,0.07)",display:"flex",padding:"8px 0 20px",zIndex:100}}>
      {items.map(({k,icon,label})=>(
        <button key={k} onClick={()=>onChange(k)} style={{flex:1,display:"flex",flexDirection:"column",alignItems:"center",gap:2,background:"none",border:"none",cursor:"pointer",padding:"4px 0",position:"relative"}}>
          <span style={{fontSize:17,opacity:tab===k?1:0.3,transition:"opacity 0.2s",position:"relative"}}>
            {icon}
            {k==="social"&&notifCount>0&&(
              <span style={{position:"absolute",top:-4,right:-8,background:"#E63946",borderRadius:"50%",minWidth:14,height:14,padding:"0 3px",display:"flex",alignItems:"center",justifyContent:"center",fontSize:9,color:"#fff",fontFamily:"'Bebas Neue'",fontWeight:700,lineHeight:1}}>{notifCount>9?"9+":notifCount}</span>
            )}
          </span>
          <span style={{fontSize:7,letterSpacing:0.3,textTransform:"uppercase",fontFamily:"'Barlow',sans-serif",fontWeight:700,color:tab===k?"#E63946":"rgba(240,237,232,0.3)",transition:"color 0.2s"}}>{label}</span>
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
        <Lbl c="Année de naissance *"/><Inp value={birthYear} onChange={setBirth} placeholder="Ex: 1990" type="number"/>
        <Lbl c="Sexe *"/><Sel value={gender} onChange={setGender}><option value="">— Choisir —</option><option value="H">Homme</option><option value="F">Femme</option></Sel>
        <Lbl c="Nationalité *"/><Inp value={nat} onChange={setNat} placeholder="Ex: Française"/>
        {error&&<div style={{color:"#E63946",fontSize:12,marginBottom:12,fontFamily:"'Barlow',sans-serif"}}>{error}</div>}
        <Btn onClick={handleSave} disabled={!valid||loading} mb={8}>{loading?"Enregistrement...":"Commencer"}</Btn>
        <button onClick={async()=>{await supabase.auth.signOut();}} style={{width:"100%",padding:"10px 0",background:"transparent",border:"none",color:"rgba(240,237,232,0.4)",fontFamily:"'Barlow',sans-serif",fontSize:12,cursor:"pointer"}}>Se déconnecter</button>
      </div>
    </div>
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
  const [notifCount,setNotifCount]=useState(0);

  useEffect(()=>{
    supabase.auth.getSession().then(({data:{session}})=>{setSession(session);if(!session)setLoading(false);});
    const{data:{subscription}}=supabase.auth.onAuthStateChange((_,session)=>setSession(session));
    return()=>subscription.unsubscribe();
  },[]);

  useEffect(()=>{if(session){loadProfile();loadResults();loadNotifCount();}},[session]);

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
  const refresh=()=>{loadProfile();loadResults();setResultsKey(k=>k+1);};
  const loadNotifCount=async()=>{
    const{data:{user}}=await supabase.auth.getUser();
    if(!user)return;
    const{count}=await supabase.from("notifications").select("id",{count:"exact",head:true}).eq("user_id",user.id).eq("read",false);
    setNotifCount(count||0);
  };

  if(loading) return <div style={{minHeight:"100vh",background:"#0e0e0e",display:"flex",alignItems:"center",justifyContent:"center"}}><link href="https://fonts.googleapis.com/css2?family=Bebas+Neue&family=Barlow:wght@400;500;600;700&display=swap" rel="stylesheet"/><div style={{fontFamily:"'Bebas Neue'",fontSize:40,letterSpacing:4}}><span style={{color:"#F0EDE8"}}>PACE</span><span style={{color:"#E63946"}}>RANK</span></div></div>;
  if(!session) return <><link href="https://fonts.googleapis.com/css2?family=Bebas+Neue&family=Barlow:wght@400;500;600;700&display=swap" rel="stylesheet"/><AuthScreen/></>;
  if(profile&&!(profile.name&&profile.city&&profile.birth_year&&profile.gender&&profile.nationality)) return <OnboardingScreen profile={profile} onDone={loadProfile}/>;

  return (
    <div style={{background:"#0e0e0e",height:"100dvh",color:"#F0EDE8",maxWidth:480,margin:"0 auto",position:"relative",overflow:"hidden",paddingTop:"env(safe-area-inset-top)",boxSizing:"border-box",display:"flex",flexDirection:"column"}}>
      <link href="https://fonts.googleapis.com/css2?family=Bebas+Neue&family=Barlow:wght@400;500;600;700&display=swap" rel="stylesheet"/>
      {tab==="home"    &&<HomeTab    profile={profile} userId={profile?.id} onAddTraining={()=>setAddMode("training")} onAddRace={()=>setAddMode("result")} refreshKey={resultsKey} onOpenProfile={()=>setShowProfile(true)}/>}
      {tab==="ranking" &&<RankingTab myProfile={profile}/>}
      {tab==="training"&&<TrainingTab userId={profile?.id}/>}
      {tab==="perf"    &&<PerfTab    userId={profile?.id} refreshKey={resultsKey}/>}
      {tab==="social"  &&<SocialTab  myProfile={profile} onNotifsChange={loadNotifCount}/>}
      <NavBar tab={tab} onChange={setTab} notifCount={notifCount}/>
      {addMode==="result"&&<ResultModal userId={profile?.id} onSave={()=>{setAddMode(null);refresh();}} onClose={()=>setAddMode(null)}/>}
      {addMode==="training"&&<TrainingModal userId={profile?.id} onSave={()=>{setAddMode(null);refresh();}} onClose={()=>setAddMode(null)}/>}
      {showProfile&&<ProfileModal profile={profile} results={results} onRefresh={refresh} onClose={()=>setShowProfile(false)}/>}
      <InstallPrompt/>
    </div>
  );
}
