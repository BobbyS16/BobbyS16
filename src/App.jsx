import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY
);

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
function fmtDuration(sec){if(!sec)return"";const h=Math.floor(sec/3600),m=Math.floor((sec%3600)/60),s=sec%60;return h>0?`${h}h${String(m).padStart(2,"0")}`:`${String(m).padStart(2,"0")}:${String(s).padStart(2,"0")}`;}
function parseDurStr(s){if(!s)return 0;const p=s.split(":").map(Number);return(p[0]||0)*3600+(p[1]||0)*60+(p[2]||0);}
function calcTrainingPts(distKm, sport, durationSec) {
  const d = distKm||0;
  if(!d) return 0;
  const sec = parseInt(durationSec)||0;
  let intensity = 2;
  if(sec > 0) {
    if(sport==="Run"||sport==="Trail"){
      const pace = (sec/60)/d; // min/km
      intensity = pace<4?10:pace<5?7:pace<6?4:2;
    } else if(sport==="Vélo"){
      const speed = d/(sec/3600); // km/h
      intensity = speed>=40?10:speed>=35?7:speed>=30?4:2;
    } else if(sport==="Natation"){
      const pace100 = (sec/60)/(d*10); // min/100m
      intensity = pace100<2?10:pace100<2.5?7:pace100<3?4:2;
    }
  }
  return Math.round(d * intensity * 0.15);
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
  if (pts >= 3000) return {label:"Élite",      color:"#FFD700"};
  if (pts >= 2000) return {label:"Expert",     color:"#C0C0C0"};
  if (pts >= 1300) return {label:"Avancé",     color:"#CD7F32"};
  if (pts >= 700)  return {label:"Confirmé",   color:"#9B59B6"};
  if (pts >= 300)  return {label:"Interméd.",  color:"#4A90D9"};
  return                  {label:"Débutant",   color:"#27AE60"};
}
function fmtTime(s) {
  if (!s && s !== 0) return "--:--:--";
  const h=Math.floor(s/3600),m=Math.floor((s%3600)/60),sec=s%60;
  return `${String(h).padStart(2,"0")}:${String(m).padStart(2,"0")}:${String(sec).padStart(2,"0")}`;
}

const BADGES = [
  {id:"first_race",   emoji:"🎽",label:"Première foulée", color:"#E63946",check:r=>r.length>=1},
  {id:"five_races",   emoji:"🔥",label:"Série de 5",      color:"#FF6B35",check:r=>r.length>=5},
  {id:"ten_races",    emoji:"💎",label:"Vétéran",         color:"#9B59B6",check:r=>r.length>=10},
  {id:"sub4_marathon",emoji:"🏆",label:"Sub-4h Marathon", color:"#FFD700",check:r=>r.some(x=>x.discipline==="marathon"&&x.time<4*3600)},
  {id:"sub2_semi",    emoji:"⚡",label:"Sub-2h Semi",     color:"#FFD700",check:r=>r.some(x=>x.discipline==="semi"&&x.time<2*3600)},
  {id:"sub20_5k",     emoji:"🚀",label:"Sub-20 5km",      color:"#FFD700",check:r=>r.some(x=>x.discipline==="5km"&&x.time<20*60)},
  {id:"ironman",      emoji:"🦾",label:"Ironman",         color:"#E63946",check:r=>r.some(x=>x.discipline==="tri-xl")},
  {id:"ultra",        emoji:"🏔️",label:"Ultra Trail",     color:"#27AE60",check:r=>r.some(x=>x.discipline==="trail-xl")},
  {id:"multisport",   emoji:"🎯",label:"Multi-Sport",     color:"#3498DB",check:r=>new Set(r.map(x=>DISCIPLINES[x.discipline]?.category)).size>=3},
];
function computeBadges(results) { return BADGES.filter(b=>b.check(results||[])); }

// ── DRUM PICKER ───────────────────────────────────────────────────────────────
function DrumPicker({values,selectedIndex,onChange,width=80}) {
  const ref=useRef(null), IH=40;
  const touchY=useRef(0), touchIdx=useRef(0), dragging=useRef(false);

  useEffect(()=>{
    if(ref.current) ref.current.scrollTop=selectedIndex*IH;
    const t=setTimeout(()=>{if(ref.current)ref.current.scrollTop=selectedIndex*IH;},80);
    return()=>clearTimeout(t);
  },[]);

  const onScroll=useCallback(()=>{
    if(!ref.current||dragging.current)return;
    const idx=Math.round(ref.current.scrollTop/IH);
    onChange(Math.max(0,Math.min(values.length-1,idx)));
  },[values.length,onChange]);

  const onTouchStart=e=>{
    e.stopPropagation();
    dragging.current=true;
    touchY.current=e.touches[0].clientY;
    touchIdx.current=selectedIndex;
  };
  const onTouchMove=e=>{
    e.stopPropagation();
    if(!dragging.current)return;
    const delta=touchY.current-e.touches[0].clientY;
    const idx=Math.max(0,Math.min(values.length-1,touchIdx.current+Math.round(delta/IH)));
    onChange(idx);
    if(ref.current)ref.current.scrollTop=idx*IH;
  };
  const onTouchEnd=e=>{
    e.stopPropagation();
    dragging.current=false;
  };

  return (
    <div style={{position:"relative",width,height:IH*3,overflow:"hidden",flexShrink:0}}>
      <div style={{position:"absolute",inset:0,zIndex:2,pointerEvents:"none",background:"linear-gradient(to bottom,#161616 0%,transparent 30%,transparent 70%,#161616 100%)"}}/>
      <div style={{position:"absolute",top:"50%",left:4,right:4,transform:"translateY(-50%)",height:IH,background:"rgba(230,57,70,0.1)",border:"1px solid rgba(230,57,70,0.3)",borderRadius:10,zIndex:1,pointerEvents:"none"}}/>
      <div ref={ref} onScroll={onScroll}
        onTouchStart={onTouchStart} onTouchMove={onTouchMove} onTouchEnd={onTouchEnd}
        style={{height:"100%",overflowY:"scroll",scrollbarWidth:"none",msOverflowStyle:"none",
          scrollSnapType:"y mandatory",overscrollBehavior:"contain",touchAction:"none"}}>
        <div style={{height:IH,flexShrink:0}}/>
        {values.map((v,i)=>(
          <div key={i} onClick={()=>{onChange(i);if(ref.current)ref.current.scrollTop=i*IH;}}
            style={{height:IH,display:"flex",alignItems:"center",justifyContent:"center",
              scrollSnapAlign:"center",flexShrink:0,
              fontFamily:"'Bebas Neue',sans-serif",fontSize:22,
              color:i===selectedIndex?"#F0EDE8":"rgba(240,237,232,0.18)",
              cursor:"pointer",userSelect:"none"}}>
            {v}
          </div>
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
        <DrumPicker values={H_VALS} selectedIndex={hms[0]} onChange={v=>update([v,hms[1],hms[2]])} width={90}/>
        <span style={{fontFamily:"'Bebas Neue'",fontSize:28,color:"rgba(230,57,70,0.5)"}}>:</span>
        <DrumPicker values={M_VALS} selectedIndex={hms[1]} onChange={v=>update([hms[0],v,hms[2]])} width={90}/>
        <span style={{fontFamily:"'Bebas Neue'",fontSize:28,color:"rgba(230,57,70,0.5)"}}>:</span>
        <DrumPicker values={M_VALS} selectedIndex={hms[2]} onChange={v=>update([hms[0],hms[1],v])} width={90}/>
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
        <DrumPicker values={DAY_VALS} selectedIndex={Math.max(0,dmy[0])} onChange={v=>update([v,dmy[1],dmy[2]])} width={78}/>
        <DrumPicker values={MON_VALS} selectedIndex={Math.max(0,dmy[1])} onChange={v=>update([dmy[0],v,dmy[2]])} width={78}/>
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
            <div style={{fontSize:7,color:"rgba(240,237,232,0.35)",fontFamily:"'Barlow',sans-serif"}}>{d.value>0?`${d.value}${unit}`:""}</div>
            <div style={{width:"100%",background:color,borderRadius:"3px 3px 0 0",height:`${(d.value/max)*75}px`,minHeight:d.value>0?3:0,transition:"height 0.5s"}}/>
            <div style={{fontSize:7,color:"rgba(240,237,232,0.3)",fontFamily:"'Barlow',sans-serif",textAlign:"center"}}>{d.label}</div>
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
      {title&&<div style={{fontFamily:"'Barlow',sans-serif",fontSize:11,color:"rgba(240,237,232,0.4)",letterSpacing:1.5,textTransform:"uppercase",marginBottom:12}}>{title}</div>}
      <svg viewBox={`0 0 ${W} ${H}`} style={{width:"100%",overflow:"visible"}}>
        <defs><linearGradient id="lg" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={color} stopOpacity="0.3"/><stop offset="100%" stopColor={color} stopOpacity="0"/></linearGradient></defs>
        {formatY&&yTicks.map((v,i)=><text key={i} x={PL-4} y={getY(v)+3} textAnchor="end" fill="rgba(240,237,232,0.3)" fontSize="7" fontFamily="Barlow,sans-serif">{formatY(v)}</text>)}
        <path d={`${path} L${pts[pts.length-1].x},${H} L${pts[0].x},${H} Z`} fill="url(#lg)"/>
        <path d={path} fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
        {pts.map((p,i)=>(<g key={i}><circle cx={p.x} cy={p.y} r="4" fill={color}/><text x={p.x} y={H+8} textAnchor="middle" fill="rgba(240,237,232,0.3)" fontSize="8" fontFamily="Barlow,sans-serif">{p.label}</text></g>))}
      </svg>
    </div>
  );
}

// ── SWIPE ROW ─────────────────────────────────────────────────────────────────
function SwipeRow({children,onEdit,onDelete}){
  const [offset,setOffset]=useState(0);
  const startX=useRef(null);
  const dragging=useRef(false);
  const W=120;
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
    <div style={{overflow:"hidden",borderRadius:12,marginBottom:6}}>
      <div style={{position:"relative"}}>
        <div onTouchStart={onTouchStart} onTouchMove={onTouchMove} onTouchEnd={onTouchEnd}
          style={{transform:`translateX(${offset}px)`,transition:tr}}>
          {children}
        </div>
        <div style={{position:"absolute",top:0,bottom:0,right:0,width:W,display:"flex",
          transform:`translateX(${W+offset}px)`,transition:tr}}>
          <button onClick={()=>{close();onEdit();}} style={{flex:1,background:"rgba(255,255,255,0.12)",border:"none",color:"#F0EDE8",fontSize:20,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center"}}>✏️</button>
          <button onClick={()=>{close();onDelete();}} style={{flex:1,background:"rgba(255,255,255,0.07)",border:"none",color:"#F0EDE8",fontSize:20,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center"}}>🗑️</button>
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
    const el=overlayRef.current;
    if(!el)return;
    const prevent=e=>{if(e.cancelable)e.preventDefault();};
    el.addEventListener("touchmove",prevent,{passive:false});
    return()=>el.removeEventListener("touchmove",prevent);
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
        style={{background:"#161616",border:"1px solid rgba(255,255,255,0.09)",borderRadius:"22px 22px 0 0",width:"100%",maxWidth:480,maxHeight:"92vh",display:"flex",flexDirection:"column",transform:`translateY(${dy}px)`,transition:dragging.current?"none":"transform 0.25s ease"}}>
        <div onTouchStart={onHandleTouch} onTouchMove={onHandleMove} onTouchEnd={onHandleEnd}
          style={{padding:"18px 20px 18px",flexShrink:0,cursor:"grab",touchAction:"none",userSelect:"none"}}>
          <div style={{width:48,height:5,background:"rgba(255,255,255,0.3)",borderRadius:3,margin:"0 auto"}}/>
        </div>
        <div ref={scrollRef} style={{overflowY:"auto",padding:"0 20px 44px",flex:1}}>
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
function Avatar({profile,size=48,highlight=false}){
  const initials=(profile?.name||"?").split(" ").map(w=>w[0]).join("").slice(0,2).toUpperCase();
  return (
    <div style={{width:size,height:size,borderRadius:"50%",overflow:"hidden",flexShrink:0,background:highlight?"#E63946":"rgba(255,255,255,0.1)",border:highlight?"3px solid #E63946":"2px solid rgba(255,255,255,0.1)",display:"flex",alignItems:"center",justifyContent:"center",fontFamily:"'Bebas Neue'",fontSize:size*0.35,color:"#fff",letterSpacing:1}}>
      {profile?.avatar?<img src={profile.avatar} style={{width:"100%",height:"100%",objectFit:"cover"}} onError={e=>{e.target.style.display="none";}}/>:initials}
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
function TrainingModal({userId,onSave,onClose}){
  const [sport,setSport]=useState("Run");
  const [dist,setDist]=useState("");
  const [deniv,setDeniv]=useState("");
  const [duration,setDur]=useState("00:00:00");
  const [date,setDate]=useState("");
  const [loading,setLoading]=useState(false);
  const [error,setErr]=useState("");
  const handleSave=async()=>{
    if(!dist)return;
    setLoading(true);setErr("");
      const durationSec=parseDurStr(duration);
    const pts=calcTrainingPts(parseFloat(dist)||0,sport,durationSec);
    const{error:err}=await supabase.from("trainings").insert({user_id:userId,sport,distance:parseFloat(dist)||0,duration:durationSec,date:date||new Date().toISOString().split("T")[0],points:pts});
    setLoading(false);
    if(err){setErr(err.message||err.details||JSON.stringify(err));return;}
    onSave();
  };
  return (
    <Modal onClose={onClose}>
      <div style={{fontFamily:"'Bebas Neue'",fontSize:22,color:"#F0EDE8",letterSpacing:1,marginBottom:12}}>Ajouter un entraînement</div>
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
  const [loading,setLoading]=useState(false);
  const handleSave=async()=>{
    setLoading(true);
    let avatar_url=profile.avatar;
    if(avFile){
      const ext=avFile.name.split(".").pop();
      const path=`${profile.id}.${ext}`;
      const{error:upErr}=await supabase.storage.from("avatars").upload(path,avFile,{upsert:true});
      if(!upErr){const{data}=supabase.storage.from("avatars").getPublicUrl(path);avatar_url=data.publicUrl+"?t="+Date.now();}
    }
    await supabase.from("profiles").update({name,city,birth_year:birthYear?parseInt(birthYear):null,gender,nationality:nat,avatar:avatar_url}).eq("id",profile.id);
    setLoading(false);onSave();
  };
  return (
    <Modal onClose={onClose}>
      <div style={{fontFamily:"'Bebas Neue'",fontSize:26,color:"#F0EDE8",letterSpacing:1,marginBottom:20}}>Modifier le profil</div>
      <Lbl c="Photo de profil"/>
      <label style={{display:"flex",alignItems:"center",gap:12,marginBottom:16,cursor:"pointer"}}>
        <Avatar profile={{...profile,avatar:avFile?URL.createObjectURL(avFile):profile.avatar}} size={56}/>
        <div style={{fontSize:13,color:"#E63946",fontFamily:"'Barlow',sans-serif",fontWeight:600}}>Changer la photo →</div>
        <input type="file" accept="image/*" onChange={e=>setAvFile(e.target.files[0])} style={{position:"absolute",opacity:0,width:"1px",height:"1px",pointerEvents:"none"}}/>
      </label>
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

// ── HOME TAB ──────────────────────────────────────────────────────────────────
const rYear=r=>r.race_date?parseInt(r.race_date.slice(0,4)):(r.year||CY);

function HomeTab({profile,userId,onAddResult,refreshKey,onOpenProfile}){
  const [results,setResults]=useState([]);
  const [trainings,setTrainings]=useState([]);
  useEffect(()=>{
    if(!userId)return;
    supabase.from("results").select("*").eq("user_id",userId)
      .then(({data})=>setResults(data||[]));
    supabase.from("trainings").select("*").eq("user_id",userId)
      .then(({data,error})=>{if(!error)setTrainings(data||[]);});
  },[userId,refreshKey]);

  const seasons=useMemo(()=>{
    const base=[CY-2,CY-1,CY];
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

  useEffect(()=>{loadRanking();},[season,rankFilter,discFilter]);

  const loadRanking=async()=>{
    const{data:{user}}=await supabase.auth.getUser();
    const{data:allResults}=await supabase.from("results").select("*").eq("year",season);
    const{data:allProfiles}=await supabase.from("profiles").select("*");
    if(!allResults||!allProfiles)return;
    let pool=allProfiles;
    if(rankFilter==="amis"){
      const{data:fs}=await supabase.from("friendships").select("friend_id").eq("user_id",user.id).eq("status","accepted");
      const ids=new Set([user.id,...(fs||[]).map(f=>f.friend_id)]);
      pool=allProfiles.filter(p=>ids.has(p.id));
    }
    const ranked=pool.map(p=>{
      const pRes=allResults.filter(r=>r.user_id===p.id&&(discFilter==="All"||DISCIPLINES[r.discipline]?.category===discFilter));
      const pts=sumBestPts(pRes);
      const badges=computeBadges(allResults.filter(r=>r.user_id===p.id));
      return{...p,pts,badges};
    }).filter(p=>p.pts>0).sort((a,b)=>b.pts-a.pts);
    setRankData(ranked);
  };

  const seasonResults=results.filter(r=>rYear(r)===season);
  const trainingPts=trainings.filter(t=>new Date(t.date).getFullYear()===season).reduce((s,t)=>s+(t.points||0),0);
  const totalPts=sumBestPts(seasonResults)+trainingPts;
  const bests=Object.values(seasonResults.reduce((acc,r)=>{if(!acc[r.discipline]||r.time<acc[r.discipline].time)acc[r.discipline]=r;return acc;},{}))
    .sort((a,b)=>calcPoints(b.discipline,b.time)-calcPoints(a.discipline,a.time));
  const myBadges=computeBadges(results);
  const myLv=getSeasonLevel(totalPts);
  const DISC_TABS=[{k:"All",l:"All"},{k:"running",l:"🏃 Run"},{k:"triathlon",l:"🏊 Tri"},{k:"trail",l:"⛰️ Trail"}];

  const [copied,setCopied]=useState(false);
  const handleShare=()=>{
    const url=window.location.origin;
    if(navigator.share){navigator.share({title:"PaceRank",text:"Rejoins-moi sur PaceRank !",url});}
    else{navigator.clipboard.writeText(url).then(()=>{setCopied(true);setTimeout(()=>setCopied(false),2000);});}
  };

  return (
    <div style={{padding:"0 16px 100px"}}>
      {/* Header */}
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",paddingTop:20,marginBottom:16}}>
        <div>
          <div style={{fontFamily:"'Bebas Neue'",fontSize:36,letterSpacing:3,lineHeight:1}}>
            <span style={{color:"#F0EDE8"}}>PACE</span><span style={{color:"#E63946"}}>RANK</span>
          </div>
          <div style={{fontSize:10,color:"rgba(240,237,232,0.3)",letterSpacing:3,fontFamily:"'Barlow',sans-serif"}}>RUN · TRIATHLON · TRAIL</div>
        </div>
        <button onClick={handleShare} style={{background:"rgba(255,255,255,0.07)",border:"none",borderRadius:14,padding:"10px 14px",color:copied?"#27AE60":"rgba(240,237,232,0.6)",fontFamily:"'Barlow',sans-serif",fontWeight:700,fontSize:13,cursor:"pointer"}}>
          {copied?"✓ Copié !":"🔗 Inviter"}
        </button>
      </div>

      {/* My card */}
      <div onClick={onOpenProfile} style={{background:`${myLv.color}12`,border:`1px solid ${myLv.color}44`,borderRadius:18,padding:"16px",marginBottom:16,cursor:"pointer"}}>
        <div style={{display:"flex",alignItems:"center",gap:12,marginBottom:bests.length>0?12:0}}>
          <div style={{position:"relative"}}>
            <Avatar profile={profile} size={52} highlight/>
            {myBadges.length>0&&<div style={{position:"absolute",bottom:-2,right:-2,background:"#E63946",borderRadius:"50%",width:18,height:18,display:"flex",alignItems:"center",justifyContent:"center",fontSize:9,color:"#fff",fontFamily:"'Bebas Neue'"}}>{myBadges.length}</div>}
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
            {trainingPts>0&&<div style={{fontSize:8,color:"rgba(240,237,232,0.35)",fontFamily:"'Barlow',sans-serif"}}>dont {trainingPts} training</div>}
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
          <button key={y} onClick={()=>setSeason(y)} style={{flexShrink:0,padding:"7px 18px",borderRadius:20,border:"none",cursor:"pointer",background:season===y?"#E63946":"rgba(255,255,255,0.06)",color:season===y?"#fff":"rgba(240,237,232,0.4)",fontFamily:"'Bebas Neue'",fontSize:18,letterSpacing:1,display:"flex",alignItems:"center",gap:6}}>
            {y}
            {y===CY&&<span style={{fontSize:9,color:season===y?"rgba(255,255,255,0.85)":"#27AE60",fontFamily:"'Barlow',sans-serif",fontWeight:700,letterSpacing:0.5,textTransform:"uppercase"}}>en cours</span>}
          </button>
        ))}
      </div>

      {/* Rank toggle */}
      <div style={{display:"flex",gap:6,marginBottom:12}}>
        {[["amis","👥 Amis"],["communaute","🌍 Communauté"]].map(([k,l])=>(
          <button key={k} onClick={()=>setRankFilter(k)} style={{flex:1,padding:"9px 0",borderRadius:12,border:"none",cursor:"pointer",background:rankFilter===k?"rgba(255,255,255,0.1)":"rgba(255,255,255,0.04)",color:rankFilter===k?"#F0EDE8":"rgba(240,237,232,0.4)",fontFamily:"'Barlow',sans-serif",fontWeight:700,fontSize:13}}>{l}</button>
        ))}
      </div>

      {/* Disc filter */}
      <div style={{display:"flex",gap:6,marginBottom:14,overflowX:"auto",scrollbarWidth:"none"}}>
        {DISC_TABS.map(({k,l})=>(
          <button key={k} onClick={()=>setDiscFilter(k)} style={{flexShrink:0,padding:"5px 12px",borderRadius:20,border:"none",cursor:"pointer",background:discFilter===k?"#E63946":"rgba(255,255,255,0.06)",color:discFilter===k?"#fff":"rgba(240,237,232,0.5)",fontFamily:"'Barlow',sans-serif",fontWeight:600,fontSize:12}}>{l}</button>
        ))}
      </div>

      {/* Ranking list */}
      {rankData.length===0
        ?<div style={{textAlign:"center",color:"#444",padding:"30px 0",fontFamily:"'Barlow',sans-serif",fontSize:13}}>{rankFilter==="amis"?"Ajoute des amis pour voir le classement !":"Aucun résultat pour cette saison"}</div>
        :rankData.map((p,i)=>{const lv=getSeasonLevel(p.pts);return(
          <div key={p.id} style={{display:"flex",alignItems:"center",gap:10,padding:"11px 14px",borderRadius:14,marginBottom:8,background:`${lv.color}0d`,border:`1px solid ${lv.color}${p.id===profile?.id?"66":"33"}`}}>
            <div style={{fontFamily:"'Bebas Neue'",fontSize:18,color:i<3?"#FFD700":"#444",width:22,textAlign:"center",flexShrink:0}}>{i===0?"🥇":i===1?"🥈":i===2?"🥉":i+1}</div>
            <Avatar profile={p} size={36}/>
            <div style={{flex:1,minWidth:0}}>
              <div style={{fontFamily:"'Bebas Neue'",fontSize:15,color:"#F0EDE8",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{p.name||"Anonyme"}</div>
              <div style={{display:"flex",gap:3,marginTop:1}}>{p.badges.slice(0,3).map(b=><span key={b.id} style={{fontSize:11}}>{b.emoji}</span>)}</div>
            </div>
            <div style={{textAlign:"right",flexShrink:0}}>
              <div style={{fontFamily:"'Bebas Neue'",fontSize:22,color:lv.color,letterSpacing:1}}>{p.pts}</div>
              <div style={{fontSize:9,color:lv.color,fontFamily:"'Barlow',sans-serif",fontWeight:700}}>{lv.label}</div>
            </div>
          </div>
        );}
      )}
      <button onClick={onAddResult} style={{position:"fixed",bottom:90,right:20,width:56,height:56,borderRadius:"50%",background:"#E63946",border:"none",color:"#fff",fontSize:28,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",boxShadow:"0 4px 20px rgba(230,57,70,0.5)",zIndex:99}}>+</button>
    </div>
  );
}

// ── RANKING TAB ───────────────────────────────────────────────────────────────
function RankingTab({myProfile}){
  const [filter,setFilter]=useState("group");
  const [season,setSeason]=useState(CY);
  const [discFilter,setDisc]=useState("marathon");
  const [players,setPlayers]=useState([]);
  const [loading,setLoading]=useState(true);
  const [groups,setGroups]=useState([]);
  const [selGroup,setSelGroup]=useState(null);

  useEffect(()=>{loadPlayers();},[filter,discFilter,selGroup,season]);
  useEffect(()=>{loadMyGroups();},[]);

  const loadMyGroups=async()=>{
    const{data:{user}}=await supabase.auth.getUser();
    const{data}=await supabase.from("group_members").select("*, group:groups(*)").eq("user_id",user.id);
    setGroups(data?.map(d=>d.group)||[]);
  };

  const loadPlayers=async()=>{
    setLoading(true);
    const{data:profiles}=await supabase.from("profiles").select("*");
    const{data:results}=await supabase.from("results").select("*");
    if(!profiles||!results){setLoading(false);return;}
    const seasonResults=results.filter(r=>rYear(r)===season);
    let pool=profiles;
    if(filter==="group"&&selGroup){const{data:members}=await supabase.from("group_members").select("user_id").eq("group_id",selGroup);const ids=new Set(members?.map(m=>m.user_id)||[]);pool=profiles.filter(p=>ids.has(p.id));}
    let display=pool.map(p=>{
      const pRes=seasonResults.filter(r=>r.user_id===p.id);
      const pts=filter==="discipline"?(()=>{const b=pRes.filter(r=>r.discipline===discFilter).sort((a,b)=>a.time-b.time)[0];return b?calcPoints(discFilter,b.time):0;})():sumBestPts(pRes);
      return{...p,pts};
    }).filter(p=>p.pts>0).sort((a,b)=>b.pts-a.pts);
    const myAgeCat=getAgeCat(myProfile?.birth_year);
    if(filter==="age_cat") display=display.filter(p=>getAgeCat(p.birth_year)===myAgeCat);
    if(filter==="gender")  display=display.filter(p=>p.gender===myProfile?.gender);
    setPlayers(display);setLoading(false);
  };

  const FILTERS=[{k:"group",l:"👥 Groupe"},{k:"global",l:"🌍 Global"},{k:"discipline",l:"🏅 Discipline"},{k:"age_cat",l:"📅 Catégorie"},{k:"gender",l:"⚧ Sexe"}];

  return (
    <div style={{padding:"0 16px 100px",overflowX:"hidden"}}>
      <div style={{fontFamily:"'Bebas Neue'",fontSize:28,letterSpacing:2,color:"#F0EDE8",paddingTop:20,marginBottom:12}}>Rank</div>
      {/* Season selector */}
      <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:14,overflowX:"auto",scrollbarWidth:"none",paddingBottom:2}}>
        {[CY-2,CY-1,CY].map(y=>(
          <button key={y} onClick={()=>setSeason(y)} style={{flexShrink:0,padding:"6px 16px",borderRadius:20,border:"none",cursor:"pointer",background:season===y?"#E63946":"rgba(255,255,255,0.06)",color:season===y?"#fff":"rgba(240,237,232,0.4)",fontFamily:"'Bebas Neue'",fontSize:16,letterSpacing:1,display:"flex",alignItems:"center",gap:5}}>
            {y}
            {y===CY&&<span style={{fontSize:8,color:season===y?"rgba(255,255,255,0.85)":"#27AE60",fontFamily:"'Barlow',sans-serif",fontWeight:700,letterSpacing:0.5,textTransform:"uppercase"}}>en cours</span>}
          </button>
        ))}
      </div>
      <div style={{display:"flex",gap:6,overflowX:"auto",paddingBottom:8,marginBottom:12,scrollbarWidth:"none"}}>
        {FILTERS.map(f=><button key={f.k} onClick={()=>setFilter(f.k)} style={{flexShrink:0,padding:"6px 12px",borderRadius:20,border:"none",cursor:"pointer",background:filter===f.k?"#E63946":"rgba(255,255,255,0.06)",color:filter===f.k?"#fff":"rgba(240,237,232,0.5)",fontFamily:"'Barlow',sans-serif",fontWeight:600,fontSize:12,whiteSpace:"nowrap"}}>{f.l}</button>)}
      </div>
      {filter==="discipline"&&<Sel value={discFilter} onChange={setDisc}>{Object.entries(DISCIPLINES).map(([k,v])=><option key={k} value={k}>{v.icon} {v.label}</option>)}</Sel>}
      {filter==="group"&&<Sel value={selGroup||""} onChange={v=>setSelGroup(v)}><option value="">Sélectionne un groupe</option>{groups.map(g=><option key={g.id} value={g.id}>{g.name}</option>)}</Sel>}
      {loading?<div style={{textAlign:"center",color:"#444",padding:"40px 0",fontFamily:"'Barlow',sans-serif"}}>Chargement…</div>
      :players.length===0?<div style={{textAlign:"center",color:"#444",padding:"40px 0",fontFamily:"'Barlow',sans-serif"}}>Aucun résultat</div>
      :players.map((p,i)=>{const lv=getSeasonLevel(p.pts);return(
        <div key={p.id} style={{display:"flex",alignItems:"center",gap:10,padding:"11px 14px",borderRadius:14,marginBottom:8,background:`${lv.color}0d`,border:`1px solid ${lv.color}${p.id===myProfile?.id?"66":"33"}`}}>
          <div style={{fontFamily:"'Bebas Neue'",fontSize:18,color:i<3?"#FFD700":"#444",width:22,textAlign:"center",flexShrink:0}}>{i===0?"🥇":i===1?"🥈":i===2?"🥉":i+1}</div>
          <Avatar profile={p} size={36}/>
          <div style={{flex:1,minWidth:0}}>
            <div style={{fontFamily:"'Bebas Neue'",fontSize:15,color:"#F0EDE8",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{p.name||"Anonyme"}</div>
            <div style={{fontSize:11,color:"rgba(240,237,232,0.35)",fontFamily:"'Barlow',sans-serif"}}>{getAgeCat(p.birth_year)||""}{p.gender?` · ${p.gender}`:""}</div>
          </div>
          <div style={{textAlign:"right",flexShrink:0}}>
            <div style={{fontFamily:"'Bebas Neue'",fontSize:22,color:lv.color,letterSpacing:1}}>{p.pts}</div>
            <div style={{fontSize:9,color:lv.color,fontFamily:"'Barlow',sans-serif",fontWeight:700}}>{lv.label}</div>
          </div>
        </div>
      );})}
    </div>
  );
}

// ── TRAINING TAB ──────────────────────────────────────────────────────────────
function TrainingTab({userId}){
  const [trainings,setTrainings]=useState([]);
  const [showAdd,setShowAdd]=useState(false);
  const [selSport,setSelSport]=useState("All");
  const [selYear,setSelYear]=useState(CY);

  useEffect(()=>{loadTrainings();},[]);

  const loadTrainings=async()=>{
    const{data}=await supabase.from("trainings").select("*").eq("user_id",userId).order("date",{ascending:false});
    setTrainings(data||[]);
  };

  const filtered=trainings.filter(t=>(selSport==="All"||t.sport===selSport)&&new Date(t.date).getFullYear()===selYear);
  const monthlyDist=MONTHS_FR.map((label,i)=>({label,value:Math.round(filtered.filter(t=>new Date(t.date).getMonth()===i).reduce((s,t)=>s+(t.distance||0),0))}));
  const totalDist=filtered.reduce((s,t)=>s+(t.distance||0),0);
  const totalPts=filtered.reduce((s,t)=>s+(t.points||calcTrainingPts(t.distance,t.sport,t.duration)),0);

  return (
    <div style={{padding:"0 16px 100px",overflowX:"hidden"}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",paddingTop:20,marginBottom:16}}>
        <div style={{fontFamily:"'Bebas Neue'",fontSize:28,letterSpacing:2,color:"#F0EDE8"}}>Entraînements</div>
        <button onClick={()=>setShowAdd(true)} style={{background:"#E63946",border:"none",borderRadius:10,width:36,height:36,display:"flex",alignItems:"center",justifyContent:"center",cursor:"pointer",fontSize:20,color:"#fff"}}>+</button>
      </div>
      <div style={{display:"flex",gap:5,overflowX:"auto",paddingBottom:8,marginBottom:12,scrollbarWidth:"none"}}>
        {TRAINING_SPORTS.map(s=><button key={s} onClick={()=>setSelSport(s)} style={{flexShrink:0,padding:"6px 12px",borderRadius:20,border:"none",cursor:"pointer",background:selSport===s?"#E63946":"rgba(255,255,255,0.06)",color:selSport===s?"#fff":"rgba(240,237,232,0.5)",fontFamily:"'Barlow',sans-serif",fontWeight:600,fontSize:12}}>{s}</button>)}
      </div>
      <div style={{display:"flex",gap:6,marginBottom:14}}>
        {[CY-1,CY].map(y=><button key={y} onClick={()=>setSelYear(y)} style={{flex:1,padding:"7px 0",borderRadius:10,border:"none",cursor:"pointer",background:selYear===y?"rgba(230,57,70,0.15)":"rgba(255,255,255,0.04)",color:selYear===y?"#E63946":"rgba(240,237,232,0.4)",fontFamily:"'Barlow',sans-serif",fontWeight:700,fontSize:14}}>{y}</button>)}
      </div>
      <div style={{display:"flex",gap:8,marginBottom:14,flexWrap:"wrap"}}>
        {[{l:"Distance",v:`${totalDist.toFixed(1)} km`},{l:"Points training",v:totalPts}].map(({l,v})=>(
          <div key={l} style={{flex:1,minWidth:80,padding:"10px",background:"rgba(255,255,255,0.03)",borderRadius:12,border:"1px solid rgba(255,255,255,0.06)",textAlign:"center"}}>
            <div style={{fontFamily:"'Bebas Neue'",fontSize:20,color:"#E63946",letterSpacing:1}}>{v}</div>
            <div style={{fontSize:9,color:"rgba(240,237,232,0.3)",letterSpacing:1,textTransform:"uppercase",fontFamily:"'Barlow',sans-serif",marginTop:2}}>{l}</div>
          </div>
        ))}
      </div>
      <div style={{background:"rgba(255,255,255,0.03)",borderRadius:14,padding:"14px",marginBottom:14,border:"1px solid rgba(255,255,255,0.06)"}}>
        <BarChart data={monthlyDist} color="#E63946" unit="km" title={`Distance par mois (${selYear})`}/>
      </div>
      <div style={{fontSize:11,color:"rgba(240,237,232,0.35)",letterSpacing:1.5,textTransform:"uppercase",fontFamily:"'Barlow',sans-serif",marginBottom:10}}>Sessions récentes</div>
      {filtered.slice(0,15).map((t,i)=>(
        <div key={i} style={{padding:"11px 14px",background:"rgba(255,255,255,0.03)",borderRadius:12,marginBottom:7,border:"1px solid rgba(255,255,255,0.05)",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
          <div>
            <div style={{fontFamily:"'Barlow',sans-serif",fontWeight:600,fontSize:13,color:"#F0EDE8"}}>{t.sport} · {t.distance} km</div>
            <div style={{fontSize:11,color:"rgba(240,237,232,0.35)",marginTop:2}}>{t.date}{t.duration?` · ${fmtDuration(t.duration)}`:""}</div>
          </div>
          <div style={{fontFamily:"'Bebas Neue'",fontSize:15,color:"#E63946",flexShrink:0}}>+{t.points||calcTrainingPts(t.distance,t.sport,t.duration)}pts</div>
        </div>
      ))}
      {filtered.length===0&&<div style={{textAlign:"center",color:"#444",padding:"30px 0",fontFamily:"'Barlow',sans-serif"}}>Aucune session !</div>}
      {showAdd&&<TrainingModal userId={userId} onSave={()=>{setShowAdd(false);loadTrainings();}} onClose={()=>setShowAdd(false)}/>}
    </div>
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
    <div style={{padding:"0 16px 100px",overflowX:"hidden"}}>
      <div style={{fontFamily:"'Bebas Neue'",fontSize:28,letterSpacing:2,color:"#F0EDE8",paddingTop:20,marginBottom:16}}>Performances</div>
      <div style={{display:"flex",gap:6,marginBottom:14}}>
        {[["bests","🏆 Records"],["history","📅 Historique"],["progression","📈 Progression"]].map(([k,l])=>(
          <button key={k} onClick={()=>setSubTab(k)} style={{flex:1,padding:"8px 0",borderRadius:12,border:"none",cursor:"pointer",background:subTab===k?"rgba(230,57,70,0.12)":"rgba(255,255,255,0.05)",color:subTab===k?"#E63946":"rgba(240,237,232,0.4)",fontFamily:"'Barlow',sans-serif",fontWeight:700,fontSize:11}}>{l}</button>
        ))}
      </div>

      {subTab==="bests"&&(
        <div>
          {[{cat:"running",label:"🏃 Run"},{cat:"triathlon",label:"🏊 Triathlon"},{cat:"trail",label:"⛰️ Trail"}].map(({cat,label})=>{
            const catDiscs=Object.entries(DISCIPLINES).filter(([,d])=>d.category===cat);
            const catBests=catDiscs.map(([disc])=>byDisc[disc]?[disc,byDisc[disc]]:null).filter(Boolean);
            return(
              <div key={cat} style={{marginBottom:22}}>
                <div style={{fontFamily:"'Bebas Neue'",fontSize:16,letterSpacing:2,color:"rgba(240,237,232,0.4)",marginBottom:10}}>{label}</div>
                {catBests.length===0
                  ?<div style={{textAlign:"center",color:"#444",fontSize:12,padding:"12px 0",fontFamily:"'Barlow',sans-serif"}}>Aucun résultat</div>
                  :catBests.map(([disc,r])=>{const pts=calcPoints(disc,r.time);const lv=getLevel(pts);return(
                    <div key={disc} style={{display:"flex",alignItems:"center",gap:12,padding:"12px 16px",background:"rgba(255,255,255,0.03)",borderRadius:14,marginBottom:7,border:"1px solid rgba(255,255,255,0.05)"}}>
                      <div style={{flex:1,minWidth:0}}>
                        <div style={{fontFamily:"'Bebas Neue'",fontWeight:700,fontSize:16,color:"#F0EDE8",letterSpacing:1}}>{DISCIPLINES[disc]?.label}</div>
                        <div style={{fontFamily:"'Bebas Neue'",fontSize:22,color:lv.color,letterSpacing:1}}>{fmtTime(r.time)}</div>
                        <div style={{fontSize:11,color:"#F0EDE8",fontFamily:"'Barlow',sans-serif"}}>{r.race||""}{r.race_date?` · ${r.race_date.slice(0,4)}`:r.year?` · ${r.year}`:""}</div>
                      </div>
                      <div style={{flexShrink:0,textAlign:"right"}}>
                        <div style={{fontSize:11,color:lv.color,fontFamily:"'Barlow',sans-serif",fontWeight:700,background:`${lv.color}22`,padding:"3px 8px",borderRadius:8}}>{lv.label}</div>
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
                <SwipeRow key={r.id||i} onEdit={()=>setEditResult(r)} onDelete={()=>deleteResult(r.id)}>
                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"11px 14px",background:"rgba(255,255,255,0.03)",border:"1px solid rgba(255,255,255,0.05)"}}>
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
function SocialTab({myProfile}){
  const [tab,setTab]=useState("friends");
  const [friends,setFriends]=useState([]);
  const [groups,setGroups]=useState([]);
  const [search,setSearch]=useState("");
  const [searchRes,setSearchRes]=useState([]);
  const [showCreate,setCreate]=useState(false);
  const [showJoin,setJoin]=useState(false);
  const [groupName,setGroupName]=useState("");
  const [joinCode,setJoinCode]=useState("");
  const [loading,setLoading]=useState(false);
  const [chat,setChat]=useState(null);

  useEffect(()=>{loadFriends();loadGroups();},[]);

  const loadFriends=async()=>{
    const{data:{user}}=await supabase.auth.getUser();
    const{data}=await supabase.from("friendships").select("*, friend:profiles!friendships_friend_id_fkey(id,name,avatar,city,birth_year)").eq("user_id",user.id).eq("status","accepted");
    setFriends(data||[]);
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
    const{data:{user}}=await supabase.auth.getUser();
    await supabase.from("friendships").upsert({user_id:user.id,friend_id:friendId,status:"accepted"},{onConflict:"user_id,friend_id"});
    setSearchRes(s=>s.filter(p=>p.id!==friendId));loadFriends();
  };
  const removeFriend=async friendId=>{
    const{data:{user}}=await supabase.auth.getUser();
    await supabase.from("friendships").delete().eq("user_id",user.id).eq("friend_id",friendId);
    loadFriends();
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
    <div style={{padding:"0 16px 100px",overflowX:"hidden"}}>
      <div style={{fontFamily:"'Bebas Neue'",fontSize:28,letterSpacing:2,color:"#F0EDE8",paddingTop:20,marginBottom:16}}>Social</div>
      <div style={{display:"flex",gap:6,marginBottom:14}}>
        {[["friends","👥 Amis"],["groups","🏠 Groupes"],["search","🔍 Chercher"]].map(([k,l])=>(
          <button key={k} onClick={()=>setTab(k)} style={{flex:1,padding:"8px 0",borderRadius:12,border:"none",cursor:"pointer",background:tab===k?"#E63946":"rgba(255,255,255,0.06)",color:tab===k?"#fff":"rgba(240,237,232,0.5)",fontFamily:"'Barlow',sans-serif",fontWeight:600,fontSize:12}}>{l}</button>
        ))}
      </div>
      {tab==="search"&&<div><Inp value={search} onChange={handleSearch} placeholder="Recherche par nom…"/>{searchRes.map(p=>(
        <div key={p.id} style={{display:"flex",alignItems:"center",gap:12,padding:"11px 14px",background:"rgba(255,255,255,0.03)",borderRadius:14,marginBottom:7,border:"1px solid rgba(255,255,255,0.05)"}}>
          <Avatar profile={p} size={36}/><div style={{flex:1}}><div style={{fontFamily:"'Barlow',sans-serif",fontWeight:700,fontSize:14,color:"#F0EDE8"}}>{p.name}</div><div style={{fontSize:11,color:"rgba(240,237,232,0.35)"}}>{p.city||""}</div></div>
          <button onClick={()=>addFriend(p.id)} style={{padding:"6px 12px",borderRadius:10,background:"rgba(230,57,70,0.15)",color:"#E63946",border:"1px solid rgba(230,57,70,0.3)",cursor:"pointer",fontFamily:"'Barlow',sans-serif",fontWeight:700,fontSize:12}}>+ Ajouter</button>
        </div>
      ))}</div>}
      {tab==="friends"&&<div>
        {friends.length===0&&<div style={{textAlign:"center",color:"#444",padding:"40px 0",fontFamily:"'Barlow',sans-serif"}}>Aucun ami — utilise la recherche !</div>}
        {friends.map(f=>{
          const dmId=[myProfile?.id,f.friend_id].sort().join("_");
          return(
          <div key={f.id} style={{display:"flex",alignItems:"center",gap:12,padding:"11px 14px",background:"rgba(255,255,255,0.03)",borderRadius:14,marginBottom:7,border:"1px solid rgba(255,255,255,0.05)"}}>
            <Avatar profile={f.friend} size={36}/><div style={{flex:1}}><div style={{fontFamily:"'Barlow',sans-serif",fontWeight:700,fontSize:14,color:"#F0EDE8"}}>{f.friend?.name||"Anonyme"}</div><div style={{fontSize:11,color:"rgba(240,237,232,0.35)"}}>{getAgeCat(f.friend?.birth_year)||""}{f.friend?.city?` · ${f.friend.city}`:""}</div></div>
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
    </div>
  );
}

// ── PROFILE MODAL ─────────────────────────────────────────────────────────────
function ProfileModal({profile,results,onRefresh,onClose}){
  const [showEdit,setShowEdit]=useState(false);
  const [showDelAcc,setDelAcc]=useState(false);
  const [friendCount,setFriendCount]=useState(0);
  const badges=computeBadges(results);
  const lv=getLevel(results.length?Math.max(...results.map(r=>calcPoints(r.discipline,r.time))):0);

  useEffect(()=>{
    supabase.from("friendships").select("id",{count:"exact"}).eq("user_id",profile.id).eq("status","accepted")
      .then(({count})=>setFriendCount(count||0));
  },[profile.id]);

  return (
    <Modal onClose={onClose}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16}}>
        <div style={{fontFamily:"'Bebas Neue'",fontSize:24,letterSpacing:2,color:"#F0EDE8"}}>Mon Profil</div>
        <div style={{display:"flex",gap:6}}>
          <button onClick={()=>setShowEdit(true)} style={{padding:"7px 12px",borderRadius:10,background:"rgba(255,255,255,0.07)",border:"none",color:"rgba(240,237,232,0.6)",cursor:"pointer",fontFamily:"'Barlow',sans-serif",fontSize:12,fontWeight:600}}>✏️ Éditer</button>
          <button onClick={async()=>{await supabase.auth.signOut();}} style={{padding:"7px 12px",borderRadius:10,background:"rgba(255,255,255,0.07)",border:"none",color:"rgba(240,237,232,0.6)",cursor:"pointer",fontFamily:"'Barlow',sans-serif",fontSize:12,fontWeight:600}}>Déco</button>
        </div>
      </div>
      <div style={{display:"flex",gap:14,alignItems:"center",marginBottom:16}}>
        <Avatar profile={profile} size={64} highlight/>
        <div style={{flex:1,minWidth:0}}>
          <div style={{fontFamily:"'Bebas Neue'",fontSize:22,letterSpacing:1,color:"#F0EDE8",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{profile.name||"Athlète"}</div>
          <div style={{fontSize:12,color:"rgba(240,237,232,0.4)",fontFamily:"'Barlow',sans-serif",marginTop:2}}>{[profile.city,getAgeCat(profile.birth_year),profile.gender,profile.nationality].filter(Boolean).join(" · ")}</div>
          <div style={{marginTop:4}}><span style={{fontFamily:"'Bebas Neue'",fontSize:17,color:lv.color,letterSpacing:1}}>{lv.label}</span></div>
        </div>
      </div>
      <div style={{display:"flex",gap:10,marginBottom:18}}>
        <div style={{flex:1,background:"rgba(255,255,255,0.04)",borderRadius:12,padding:"12px",textAlign:"center",border:"1px solid rgba(255,255,255,0.06)"}}>
          <div style={{fontFamily:"'Bebas Neue'",fontSize:26,color:"#E63946"}}>{friendCount}</div>
          <div style={{fontSize:10,color:"rgba(240,237,232,0.35)",fontFamily:"'Barlow',sans-serif",letterSpacing:1,textTransform:"uppercase"}}>Amis</div>
        </div>
        <div style={{flex:1,background:"rgba(255,255,255,0.04)",borderRadius:12,padding:"12px",textAlign:"center",border:"1px solid rgba(255,255,255,0.06)"}}>
          <div style={{fontFamily:"'Bebas Neue'",fontSize:26,color:"#E63946"}}>{badges.length}</div>
          <div style={{fontSize:10,color:"rgba(240,237,232,0.35)",fontFamily:"'Barlow',sans-serif",letterSpacing:1,textTransform:"uppercase"}}>Badges</div>
        </div>
        <div style={{flex:1,background:"rgba(255,255,255,0.04)",borderRadius:12,padding:"12px",textAlign:"center",border:"1px solid rgba(255,255,255,0.06)"}}>
          <div style={{fontFamily:"'Bebas Neue'",fontSize:26,color:"#E63946"}}>{results.length}</div>
          <div style={{fontSize:10,color:"rgba(240,237,232,0.35)",fontFamily:"'Barlow',sans-serif",letterSpacing:1,textTransform:"uppercase"}}>Courses</div>
        </div>
      </div>
      {badges.length>0&&(
        <div>
          <div style={{fontSize:10,color:"rgba(240,237,232,0.35)",letterSpacing:1.5,textTransform:"uppercase",fontFamily:"'Barlow',sans-serif",marginBottom:10}}>Badges</div>
          <div style={{display:"flex",gap:8,flexWrap:"wrap",marginBottom:18}}>
            {badges.map(b=>(
              <div key={b.id} style={{background:"rgba(255,255,255,0.04)",borderRadius:12,padding:"8px 12px",border:`1px solid ${b.color}44`,textAlign:"center"}}>
                <div style={{fontSize:20}}>{b.emoji}</div>
                <div style={{fontSize:9,color:b.color,fontFamily:"'Barlow',sans-serif",fontWeight:700,marginTop:2,whiteSpace:"nowrap"}}>{b.label}</div>
              </div>
            ))}
          </div>
        </div>
      )}
      <button onClick={()=>setDelAcc(true)} style={{width:"100%",padding:"11px 0",borderRadius:14,background:"transparent",border:"1px solid rgba(230,57,70,0.2)",color:"rgba(230,57,70,0.5)",cursor:"pointer",fontFamily:"'Barlow',sans-serif",fontWeight:600,fontSize:13}}>Supprimer mon compte</button>
      {showEdit&&<EditProfileModal profile={profile} onSave={()=>{setShowEdit(false);onRefresh();}} onClose={()=>setShowEdit(false)}/>}
      {showDelAcc&&<DeleteAccountModal onClose={()=>setDelAcc(false)}/>}
    </Modal>
  );
}


// ── NAV BAR ───────────────────────────────────────────────────────────────────
function NavBar({tab,onChange}){
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
        <button key={k} onClick={()=>onChange(k)} style={{flex:1,display:"flex",flexDirection:"column",alignItems:"center",gap:2,background:"none",border:"none",cursor:"pointer",padding:"4px 0"}}>
          <span style={{fontSize:17,opacity:tab===k?1:0.3,transition:"opacity 0.2s"}}>{icon}</span>
          <span style={{fontSize:7,letterSpacing:0.3,textTransform:"uppercase",fontFamily:"'Barlow',sans-serif",fontWeight:700,color:tab===k?"#E63946":"rgba(240,237,232,0.3)",transition:"color 0.2s"}}>{label}</span>
        </button>
      ))}
    </div>
  );
}

// ── AUTH SCREEN ───────────────────────────────────────────────────────────────
function AuthScreen(){
  const signIn=async()=>{await supabase.auth.signInWithOAuth({provider:"google",options:{redirectTo:window.location.origin}});};
  return (
    <div style={{minHeight:"100vh",background:"#0e0e0e",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",padding:24}}>
      <div style={{fontFamily:"'Bebas Neue'",fontSize:72,lineHeight:1,letterSpacing:6}}><span style={{color:"#F0EDE8"}}>PACE</span><span style={{color:"#E63946"}}>RANK</span></div>
      <div style={{fontSize:11,color:"rgba(240,237,232,0.3)",letterSpacing:4,textTransform:"uppercase",fontFamily:"'Barlow',sans-serif",marginBottom:60}}>Run · Trail · Triathlon</div>
      <button onClick={signIn} style={{background:"#fff",color:"#111",border:"none",borderRadius:16,padding:"16px 40px",fontFamily:"'Barlow',sans-serif",fontWeight:700,fontSize:16,cursor:"pointer",display:"flex",alignItems:"center",gap:12}}>
        <svg width="20" height="20" viewBox="0 0 48 48"><path fill="#FFC107" d="M43.6 20H24v8h11.3C33.6 33.1 29.3 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3 0 5.7 1.1 7.8 2.9l5.7-5.7C34.1 6.6 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20c11 0 19.7-8 19.7-20 0-1.3-.1-2.7-.1-4z"/><path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.6 15.1 18.9 12 24 12c3 0 5.7 1.1 7.8 2.9l5.7-5.7C34.1 6.6 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 44c5.2 0 9.9-1.9 13.5-5l-6.2-5.2C29.4 35.5 26.8 36 24 36c-5.3 0-9.6-3-11.3-7.5l-6.6 5.1C9.5 39.5 16.2 44 24 44z"/><path fill="#1976D2" d="M43.6 20H24v8h11.3c-.9 2.5-2.5 4.6-4.6 6l6.2 5.2C41 35.6 44 30.2 44 24c0-1.3-.1-2.7-.4-4z"/></svg>
        Continuer avec Google
      </button>
    </div>
  );
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
  const [showAddResult,setAdd]=useState(false);

  useEffect(()=>{
    supabase.auth.getSession().then(({data:{session}})=>{setSession(session);if(!session)setLoading(false);});
    const{data:{subscription}}=supabase.auth.onAuthStateChange((_,session)=>setSession(session));
    return()=>subscription.unsubscribe();
  },[]);

  useEffect(()=>{if(session){loadProfile();loadResults();}},[session]);

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

  if(loading) return <div style={{minHeight:"100vh",background:"#0e0e0e",display:"flex",alignItems:"center",justifyContent:"center"}}><link href="https://fonts.googleapis.com/css2?family=Bebas+Neue&family=Barlow:wght@400;500;600;700&display=swap" rel="stylesheet"/><div style={{fontFamily:"'Bebas Neue'",fontSize:40,letterSpacing:4}}><span style={{color:"#F0EDE8"}}>PACE</span><span style={{color:"#E63946"}}>RANK</span></div></div>;
  if(!session) return <><link href="https://fonts.googleapis.com/css2?family=Bebas+Neue&family=Barlow:wght@400;500;600;700&display=swap" rel="stylesheet"/><AuthScreen/></>;

  return (
    <div style={{background:"#0e0e0e",minHeight:"100vh",color:"#F0EDE8",maxWidth:480,margin:"0 auto",position:"relative",overflowX:"hidden"}}>
      <link href="https://fonts.googleapis.com/css2?family=Bebas+Neue&family=Barlow:wght@400;500;600;700&display=swap" rel="stylesheet"/>
      {tab==="home"    &&<HomeTab    profile={profile} userId={profile?.id} onAddResult={()=>setAdd(true)} refreshKey={resultsKey} onOpenProfile={()=>setShowProfile(true)}/>}
      {tab==="ranking" &&<RankingTab myProfile={profile}/>}
      {tab==="training"&&<TrainingTab userId={profile?.id}/>}
      {tab==="perf"    &&<PerfTab    userId={profile?.id} refreshKey={resultsKey}/>}
      {tab==="social"  &&<SocialTab  myProfile={profile}/>}
      <NavBar tab={tab} onChange={setTab}/>
      {showAddResult&&<ResultModal userId={profile?.id} onSave={()=>{setAdd(false);refresh();}} onClose={()=>setAdd(false)}/>}
      {showProfile&&<ProfileModal profile={profile} results={results} onRefresh={refresh} onClose={()=>setShowProfile(false)}/>}
    </div>
  );
}
