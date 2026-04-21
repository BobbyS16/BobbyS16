import { useState, useEffect, useRef, useCallback } from "react";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY
);

// ─── DISCIPLINES ──────────────────────────────────────────────────────────────
const DISCIPLINES = {
  "5km":      { label:"5 km",                icon:"🏃", category:"running",   refTime:13*60,        prestige:1.0 },
  "10km":     { label:"10 km",               icon:"🏃", category:"running",   refTime:27*60,        prestige:1.0 },
  "semi":     { label:"Semi-marathon",       icon:"🏃", category:"running",   refTime:58*60,        prestige:1.05 },
  "marathon": { label:"Marathon",            icon:"🏃", category:"running",   refTime:2*3600+2*60,  prestige:1.1 },
  "trail-s":  { label:"Trail Court (<30km)", icon:"⛰️", category:"trail",     refTime:2*3600+30*60, prestige:1.1 },
  "trail-m":  { label:"Trail Moyen (30-60)", icon:"⛰️", category:"trail",     refTime:5*3600+30*60, prestige:1.2 },
  "trail-l":  { label:"Trail Long (60-100)", icon:"⛰️", category:"trail",     refTime:10*3600,      prestige:1.3 },
  "trail-xl": { label:"Ultra Trail (100+)",  icon:"⛰️", category:"trail",     refTime:20*3600,      prestige:1.5 },
  "tri-s":    { label:"Triathlon S",         icon:"🏊", category:"triathlon", refTime:55*60,        prestige:1.1 },
  "tri-m":    { label:"Triathlon Olympique", icon:"🏊", category:"triathlon", refTime:1*3600+50*60, prestige:1.2 },
  "tri-l":    { label:"Half Ironman",        icon:"🏊", category:"triathlon", refTime:3*3600+55*60, prestige:1.3 },
  "tri-xl":   { label:"Ironman",             icon:"🏊", category:"triathlon", refTime:7*3600+35*60, prestige:1.5 },
};

const TRAINING_SPORTS = ["Natation","Vélo","Course à pied","Trail","Autre"];
const MONTHS_FR = ["Jan","Fév","Mar","Avr","Mai","Jun","Jul","Aoû","Sep","Oct","Nov","Déc"];
const CURRENT_YEAR = new Date().getFullYear();

// ─── AGE CATEGORIES ───────────────────────────────────────────────────────────
const AGE_CATEGORIES = [
  { label:"Benjamins", min:12, max:13 },{ label:"Minimes", min:14, max:15 },
  { label:"Cadets",    min:16, max:17 },{ label:"Juniors",  min:18, max:19 },
  { label:"Seniors 1", min:20, max:24 },{ label:"Seniors 2",min:25, max:29 },
  { label:"Seniors 3", min:30, max:34 },{ label:"Seniors 4",min:35, max:39 },
  { label:"Master 1",  min:40, max:44 },{ label:"Master 2", min:45, max:49 },
  { label:"Master 3",  min:50, max:54 },{ label:"Master 4", min:55, max:59 },
  { label:"Master 5",  min:60, max:64 },{ label:"Master 6", min:65, max:69 },
  { label:"Master 7",  min:70, max:74 },{ label:"Master 8", min:75, max:79 },
  { label:"Master 9",  min:80, max:84 },{ label:"Master 10",min:85, max:99 },
];
function getAgeCategory(birthYear) {
  if (!birthYear) return null;
  const age = CURRENT_YEAR - parseInt(birthYear);
  return AGE_CATEGORIES.find(c => age >= c.min && age <= c.max)?.label || null;
}

// ─── POINTS & LEVELS ──────────────────────────────────────────────────────────
function calcPoints(discipline, timeSeconds) {
  const d = DISCIPLINES[discipline];
  if (!d || !timeSeconds) return 0;
  const ratio = d.refTime / timeSeconds;
  return Math.max(0, Math.min(Math.round(1000 * Math.pow(ratio, 2) * d.prestige), 2000));
}
function getLevelLabel(pts) {
  if (pts >= 1800) return { label:"Élite",     color:"#FFD700" };
  if (pts >= 1500) return { label:"Expert",    color:"#C0C0C0" };
  if (pts >= 1200) return { label:"Avancé",    color:"#CD7F32" };
  if (pts >= 900)  return { label:"Confirmé",  color:"#E63946" };
  if (pts >= 600)  return { label:"Interméd.", color:"#4A90D9" };
  return                   { label:"Débutant", color:"#666" };
}
function fmtTime(s) {
  if (!s && s !== 0) return "--:--:--";
  const h = Math.floor(s/3600), m = Math.floor((s%3600)/60), sec = s%60;
  return `${String(h).padStart(2,"0")}:${String(m).padStart(2,"0")}:${String(sec).padStart(2,"0")}`;
}

// ─── BADGES ───────────────────────────────────────────────────────────────────
const BADGES = [
  { id:"first_race",    emoji:"🎽", label:"Première foulée",  desc:"1ère course enregistrée",        color:"#E63946", check:r=>r.length>=1 },
  { id:"five_races",    emoji:"🔥", label:"Série de 5",       desc:"5 courses complétées",           color:"#FF6B35", check:r=>r.length>=5 },
  { id:"ten_races",     emoji:"💎", label:"Vétéran",          desc:"10 courses complétées",          color:"#9B59B6", check:r=>r.length>=10 },
  { id:"sub4_marathon", emoji:"🏆", label:"Sub-4h Marathon",  desc:"Marathon en moins de 4h",        color:"#FFD700", check:r=>r.some(x=>x.discipline==="marathon"&&x.time<4*3600) },
  { id:"sub2_semi",     emoji:"⚡", label:"Sub-2h Semi",      desc:"Semi en moins de 2h",            color:"#FFD700", check:r=>r.some(x=>x.discipline==="semi"&&x.time<2*3600) },
  { id:"sub20_5k",      emoji:"🚀", label:"Sub-20min 5km",    desc:"5km en moins de 20 min",         color:"#FFD700", check:r=>r.some(x=>x.discipline==="5km"&&x.time<20*60) },
  { id:"ironman",       emoji:"🦾", label:"Ironman Finisher", desc:"Finisher d'un Ironman",          color:"#E63946", check:r=>r.some(x=>x.discipline==="tri-xl") },
  { id:"ultra",         emoji:"🏔️", label:"Ultra Traileur",   desc:"Finisher d'un Ultra Trail",      color:"#27AE60", check:r=>r.some(x=>x.discipline==="trail-xl") },
  { id:"multisport",    emoji:"🎯", label:"Multi-Sport",      desc:"3 catégories différentes",       color:"#3498DB", check:r=>new Set(r.map(x=>DISCIPLINES[x.discipline]?.category)).size>=3 },
];
function computeBadges(results) { return BADGES.filter(b=>b.check(results||[])); }

// ─── DRUM PICKER ──────────────────────────────────────────────────────────────
function DrumPicker({ values, selectedIndex, onChange, width=80 }) {
  const ref = useRef(null);
  const ITEM_H = 48;
  useEffect(() => { if(ref.current) ref.current.scrollTop = selectedIndex * ITEM_H; }, []);
  const onScroll = useCallback(() => {
    if(!ref.current) return;
    const idx = Math.round(ref.current.scrollTop / ITEM_H);
    onChange(Math.max(0, Math.min(values.length-1, idx)));
  }, [values.length, onChange]);
  return (
    <div style={{position:"relative",width,height:ITEM_H*5,overflow:"hidden",flexShrink:0}}>
      <div style={{position:"absolute",inset:0,zIndex:2,pointerEvents:"none",
        background:"linear-gradient(to bottom,#161616 0%,transparent 30%,transparent 70%,#161616 100%)"}}/>
      <div style={{position:"absolute",top:"50%",left:4,right:4,transform:"translateY(-50%)",
        height:ITEM_H,background:"rgba(230,57,70,0.1)",border:"1px solid rgba(230,57,70,0.3)",
        borderRadius:10,zIndex:1,pointerEvents:"none"}}/>
      <div ref={ref} onScroll={onScroll} style={{
        height:"100%",overflowY:"scroll",scrollSnapType:"y mandatory",
        scrollbarWidth:"none",paddingTop:ITEM_H*2,paddingBottom:ITEM_H*2,
        WebkitOverflowScrolling:"touch",
      }}>
        {values.map((v,i)=>(
          <div key={i} onClick={()=>{onChange(i);if(ref.current)ref.current.scrollTop=i*ITEM_H;}}
            style={{height:ITEM_H,display:"flex",alignItems:"center",justifyContent:"center",
              scrollSnapAlign:"center",fontFamily:"'Bebas Neue',sans-serif",fontSize:24,
              color:i===selectedIndex?"#F0EDE8":"rgba(240,237,232,0.18)",
              cursor:"pointer",userSelect:"none",transition:"color 0.1s"}}>
            {v}
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── TIME PICKER ──────────────────────────────────────────────────────────────
const H_VALS = Array.from({length:24},(_,i)=>String(i).padStart(2,"0"));
const M_VALS = Array.from({length:60},(_,i)=>String(i).padStart(2,"0"));
const S_VALS = M_VALS;

function TimePicker({ value, onChange }) {
  const parse = (v) => { if(v&&v.includes(":")) { const[h,m,s]=v.split(":").map(x=>parseInt(x)||0);return[h,m,s];} return[0,0,0]; };
  const [hms, setHms] = useState(()=>parse(value));
  const update = (newHms) => { setHms(newHms); onChange(`${String(newHms[0]).padStart(2,"0")}:${String(newHms[1]).padStart(2,"0")}:${String(newHms[2]).padStart(2,"0")}`); };
  return (
    <div>
      <div style={{display:"flex",justifyContent:"space-around",marginBottom:4}}>
        {["Heures","Min","Sec"].map(l=>(
          <div key={l} style={{fontSize:9,color:"rgba(240,237,232,0.3)",letterSpacing:1.5,
            textTransform:"uppercase",fontFamily:"'Barlow',sans-serif",textAlign:"center"}}>{l}</div>
        ))}
      </div>
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:2}}>
        <DrumPicker values={H_VALS} selectedIndex={hms[0]} onChange={v=>update([v,hms[1],hms[2]])} width={90}/>
        <span style={{fontFamily:"'Bebas Neue'",fontSize:28,color:"rgba(230,57,70,0.5)"}}>:</span>
        <DrumPicker values={M_VALS} selectedIndex={hms[1]} onChange={v=>update([hms[0],v,hms[2]])} width={90}/>
        <span style={{fontFamily:"'Bebas Neue'",fontSize:28,color:"rgba(230,57,70,0.5)"}}>:</span>
        <DrumPicker values={S_VALS} selectedIndex={hms[2]} onChange={v=>update([hms[0],hms[1],v])} width={90}/>
      </div>
      <div style={{textAlign:"center",marginTop:8,fontFamily:"'Bebas Neue'",fontSize:32,
        letterSpacing:3,color:"#F0EDE8"}}>{`${String(hms[0]).padStart(2,"0")}:${String(hms[1]).padStart(2,"0")}:${String(hms[2]).padStart(2,"0")}`}</div>
    </div>
  );
}

// ─── DATE PICKER ──────────────────────────────────────────────────────────────
const DAY_VALS   = Array.from({length:31},(_,i)=>String(i+1).padStart(2,"0"));
const MONTH_VALS = ["Jan","Fév","Mar","Avr","Mai","Jun","Jul","Aoû","Sep","Oct","Nov","Déc"];
const YEAR_VALS  = Array.from({length:15},(_,i)=>String(CURRENT_YEAR-14+i));

function DatePicker({ value, onChange }) {
  const parse = (v) => {
    if(v) { const d=new Date(v); if(!isNaN(d)) return[d.getDate()-1,d.getMonth(),YEAR_VALS.indexOf(String(d.getFullYear()))]; }
    const now=new Date(); return[now.getDate()-1,now.getMonth(),YEAR_VALS.indexOf(String(now.getFullYear()))];
  };
  const [dmy, setDmy] = useState(()=>parse(value));
  const update = (newDmy) => {
    setDmy(newDmy);
    const day=parseInt(DAY_VALS[newDmy[0]]),mo=newDmy[1]+1,yr=parseInt(YEAR_VALS[newDmy[2]]);
    onChange(`${yr}-${String(mo).padStart(2,"0")}-${String(day).padStart(2,"0")}`);
  };
  return (
    <div>
      <div style={{display:"flex",justifyContent:"space-around",marginBottom:4}}>
        {["Jour","Mois","Année"].map(l=>(
          <div key={l} style={{fontSize:9,color:"rgba(240,237,232,0.3)",letterSpacing:1.5,
            textTransform:"uppercase",fontFamily:"'Barlow',sans-serif",textAlign:"center"}}>{l}</div>
        ))}
      </div>
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:2}}>
        <DrumPicker values={DAY_VALS}   selectedIndex={Math.max(0,dmy[0])} onChange={v=>update([v,dmy[1],dmy[2]])} width={78}/>
        <DrumPicker values={MONTH_VALS} selectedIndex={Math.max(0,dmy[1])} onChange={v=>update([dmy[0],v,dmy[2]])} width={78}/>
        <DrumPicker values={YEAR_VALS}  selectedIndex={Math.max(0,dmy[2])} onChange={v=>update([dmy[0],dmy[1],v])} width={94}/>
      </div>
    </div>
  );
}

// ─── BAR CHART ────────────────────────────────────────────────────────────────
function BarChart({ data, color="#E63946", unit="km", title="" }) {
  const max = Math.max(...data.map(d=>d.value), 1);
  return (
    <div>
      {title&&<div style={{fontFamily:"'Barlow',sans-serif",fontSize:11,color:"rgba(240,237,232,0.4)",
        letterSpacing:1.5,textTransform:"uppercase",marginBottom:12}}>{title}</div>}
      <div style={{display:"flex",alignItems:"flex-end",gap:4,height:100}}>
        {data.map((d,i)=>(
          <div key={i} style={{flex:1,display:"flex",flexDirection:"column",alignItems:"center",gap:4}}>
            <div style={{fontSize:8,color:"rgba(240,237,232,0.35)",fontFamily:"'Barlow',sans-serif"}}>
              {d.value>0?d.value:""}{d.value>0?unit:""}
            </div>
            <div style={{width:"100%",background:color,borderRadius:"4px 4px 0 0",
              height:`${(d.value/max)*80}px`,minHeight:d.value>0?4:0,
              transition:"height 0.5s ease",opacity:0.85}}/>
            <div style={{fontSize:8,color:"rgba(240,237,232,0.3)",fontFamily:"'Barlow',sans-serif",
              textAlign:"center"}}>{d.label}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── LINE CHART ──────────────────────────────────────────────────────────────
function LineChart({ data, color="#E63946", unit="pts", title="" }) {
  if(!data||data.length<2) return(
    <div style={{textAlign:"center",color:"rgba(240,237,232,0.2)",fontSize:12,padding:"20px 0",fontFamily:"'Barlow',sans-serif"}}>
      Ajoute au moins 2 résultats pour voir ta progression
    </div>
  );
  const vals = data.map(d=>d.value);
  const min = Math.min(...vals), max = Math.max(...vals);
  const range = max-min || 1;
  const W=300, H=80, PAD=10;
  const pts = data.map((d,i)=>({
    x: PAD + (i/(data.length-1))*(W-PAD*2),
    y: PAD + (1-(d.value-min)/range)*(H-PAD*2),
    ...d
  }));
  const path = pts.map((p,i)=>`${i===0?"M":"L"}${p.x},${p.y}`).join(" ");
  return (
    <div>
      {title&&<div style={{fontFamily:"'Barlow',sans-serif",fontSize:11,color:"rgba(240,237,232,0.4)",
        letterSpacing:1.5,textTransform:"uppercase",marginBottom:12}}>{title}</div>}
      <svg viewBox={`0 0 ${W} ${H}`} style={{width:"100%",overflow:"visible"}}>
        <defs>
          <linearGradient id="lg" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.3"/>
            <stop offset="100%" stopColor={color} stopOpacity="0"/>
          </linearGradient>
        </defs>
        <path d={`${path} L${pts[pts.length-1].x},${H} L${pts[0].x},${H} Z`} fill="url(#lg)"/>
        <path d={path} fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
        {pts.map((p,i)=>(
          <g key={i}>
            <circle cx={p.x} cy={p.y} r="4" fill={color}/>
            <text x={p.x} y={H} textAnchor="middle" fill="rgba(240,237,232,0.3)" fontSize="8" fontFamily="Barlow,sans-serif">{p.label}</text>
          </g>
        ))}
      </svg>
    </div>
  );
}

// ─── MODAL WRAPPER ────────────────────────────────────────────────────────────
function Modal({ onClose, children }) {
  return (
    <div onClick={onClose} style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.85)",
      backdropFilter:"blur(10px)",display:"flex",alignItems:"flex-end",justifyContent:"center",zIndex:300}}>
      <div onClick={e=>e.stopPropagation()} style={{background:"#161616",
        border:"1px solid rgba(255,255,255,0.09)",borderRadius:"22px 22px 0 0",
        width:"100%",maxWidth:580,padding:"24px 20px 44px",maxHeight:"92vh",overflowY:"auto"}}>
        <div style={{width:40,height:4,background:"rgba(255,255,255,0.15)",borderRadius:2,margin:"0 auto 20px"}}/>
        {children}
      </div>
    </div>
  );
}

function Btn({ children, onClick, variant="primary", style={} }) {
  const base = {border:"none",borderRadius:14,cursor:"pointer",fontFamily:"'Barlow',sans-serif",
    fontWeight:700,fontSize:14,padding:"13px 0",width:"100%",transition:"opacity 0.2s"};
  const vars = {
    primary:{background:"#E63946",color:"#fff"},
    secondary:{background:"rgba(255,255,255,0.07)",color:"rgba(240,237,232,0.7)"},
    danger:{background:"rgba(230,57,70,0.15)",color:"#E63946",border:"1px solid rgba(230,57,70,0.3)"},
  };
  return <button onClick={onClick} style={{...base,...vars[variant],...style}}
    onMouseOver={e=>e.currentTarget.style.opacity="0.8"} onMouseOut={e=>e.currentTarget.style.opacity="1"}>
    {children}</button>;
}

function Label({ children }) {
  return <div style={{fontSize:10,letterSpacing:1.5,textTransform:"uppercase",color:"rgba(240,237,232,0.35)",
    fontFamily:"'Barlow',sans-serif",marginBottom:6}}>{children}</div>;
}

function Input({ value, onChange, placeholder, type="text" }) {
  return <input value={value} onChange={e=>onChange(e.target.value)} placeholder={placeholder} type={type}
    style={{width:"100%",background:"rgba(255,255,255,0.05)",border:"1px solid rgba(255,255,255,0.1)",
      borderRadius:12,padding:"12px 14px",color:"#F0EDE8",fontSize:14,fontFamily:"'Barlow',sans-serif",
      outline:"none",boxSizing:"border-box",marginBottom:16}}/>;
}

function Select({ value, onChange, children }) {
  return <select value={value} onChange={e=>onChange(e.target.value)}
    style={{width:"100%",background:"#1e1e1e",border:"1px solid rgba(255,255,255,0.1)",
      borderRadius:12,padding:"12px 14px",color:"#F0EDE8",fontSize:14,fontFamily:"'Barlow',sans-serif",
      outline:"none",boxSizing:"border-box",marginBottom:16,appearance:"none"}}>
    {children}
  </select>;
}

// ─── ADD / EDIT RESULT MODAL ──────────────────────────────────────────────────
function ResultModal({ existing, onSave, onClose }) {
  const [discipline, setDiscipline] = useState(existing?.discipline || "10km");
  const [timeStr, setTimeStr]       = useState(existing ? fmtTime(existing.time) : "00:00:00");
  const [raceName, setRaceName]     = useState(existing?.race || "");
  const [year, setYear]             = useState(existing?.year || CURRENT_YEAR);
  const [raceDate, setRaceDate]     = useState(existing?.race_date || "");
  const [loading, setLoading]       = useState(false);
  const [error, setError]           = useState("");

  const handleSave = async () => {
    const [h,m,s] = timeStr.split(":").map(Number);
    const t = h*3600+m*60+s;
    if(!t) { setError("Sélectionne un temps valide"); return; }
    setLoading(true); setError("");
    const payload = { discipline, time:t, race:raceName||DISCIPLINES[discipline].label, year, race_date:raceDate||null };
    let err;
    if(existing) {
      ({error:err} = await supabase.from("results").update(payload).eq("id",existing.id));
    } else {
      const {data:{user}} = await supabase.auth.getUser();
      ({error:err} = await supabase.from("results").insert({...payload, user_id:user.id}));
    }
    setLoading(false);
    if(err) { setError("Erreur lors de l'enregistrement"); return; }
    onSave();
  };

  return (
    <Modal onClose={onClose}>
      <div style={{fontFamily:"'Bebas Neue'",fontSize:26,color:"#F0EDE8",letterSpacing:1,marginBottom:20}}>
        {existing?"Modifier":"Ajouter"} un résultat
      </div>
      <Label>Discipline</Label>
      <Select value={discipline} onChange={setDiscipline}>
        {Object.entries(DISCIPLINES).map(([k,v])=>(
          <option key={k} value={k}>{v.icon} {v.label}</option>
        ))}
      </Select>
      <Label>Temps</Label>
      <div style={{background:"rgba(255,255,255,0.03)",borderRadius:14,padding:"16px 12px",marginBottom:16}}>
        <TimePicker value={timeStr} onChange={setTimeStr}/>
      </div>
      <Label>Nom de la course (optionnel)</Label>
      <Input value={raceName} onChange={setRaceName} placeholder="Ex: Marathon de Paris"/>
      <Label>Date de la course</Label>
      <div style={{background:"rgba(255,255,255,0.03)",borderRadius:14,padding:"16px 12px",marginBottom:16}}>
        <DatePicker value={raceDate} onChange={setRaceDate}/>
      </div>
      <Label>Saison</Label>
      <div style={{display:"flex",gap:8,marginBottom:20}}>
        {[CURRENT_YEAR-1,CURRENT_YEAR,CURRENT_YEAR+1].map(y=>(
          <button key={y} onClick={()=>setYear(y)} style={{flex:1,padding:"10px 0",borderRadius:10,
            background:year===y?"#E63946":"rgba(255,255,255,0.05)",
            color:year===y?"#fff":"rgba(240,237,232,0.4)",border:"none",cursor:"pointer",
            fontFamily:"'Barlow',sans-serif",fontWeight:700,fontSize:14}}>{y}</button>
        ))}
      </div>
      {error&&<div style={{color:"#E63946",fontSize:12,marginBottom:12,fontFamily:"'Barlow',sans-serif"}}>{error}</div>}
      <Btn onClick={handleSave} style={{marginBottom:8}}>{loading?"Enregistrement...":"Valider"}</Btn>
      <Btn onClick={onClose} variant="secondary">Annuler</Btn>
    </Modal>
  );
}

// ─── ADD TRAINING MODAL ───────────────────────────────────────────────────────
function TrainingModal({ onSave, onClose }) {
  const [sport, setSport]     = useState(TRAINING_SPORTS[0]);
  const [dist, setDist]       = useState("");
  const [duration, setDuration] = useState("00:00:00");
  const [note, setNote]       = useState("");
  const [date, setDate]       = useState("");
  const [loading, setLoading] = useState(false);

  const handleSave = async () => {
    if(!dist) return;
    setLoading(true);
    const {data:{user}} = await supabase.auth.getUser();
    await supabase.from("trainings").insert({
      user_id:user.id, sport, distance:parseFloat(dist)||0,
      duration_str:duration, note, training_date:date||new Date().toISOString().split("T")[0]
    });
    setLoading(false);
    onSave();
  };

  return (
    <Modal onClose={onClose}>
      <div style={{fontFamily:"'Bebas Neue'",fontSize:26,color:"#F0EDE8",letterSpacing:1,marginBottom:20}}>
        Ajouter un entraînement
      </div>
      <Label>Sport</Label>
      <Select value={sport} onChange={setSport}>
        {TRAINING_SPORTS.map(s=><option key={s} value={s}>{s}</option>)}
      </Select>
      <Label>Distance (km)</Label>
      <Input value={dist} onChange={setDist} placeholder="Ex: 12.5" type="number"/>
      <Label>Durée</Label>
      <div style={{background:"rgba(255,255,255,0.03)",borderRadius:14,padding:"16px 12px",marginBottom:16}}>
        <TimePicker value={duration} onChange={setDuration}/>
      </div>
      <Label>Date</Label>
      <div style={{background:"rgba(255,255,255,0.03)",borderRadius:14,padding:"16px 12px",marginBottom:16}}>
        <DatePicker value={date} onChange={setDate}/>
      </div>
      <Label>Note (optionnel)</Label>
      <Input value={note} onChange={setNote} placeholder="Ex: Sortie longue"/>
      <Btn onClick={handleSave} style={{marginBottom:8}}>{loading?"Enregistrement...":"Valider"}</Btn>
      <Btn onClick={onClose} variant="secondary">Annuler</Btn>
    </Modal>
  );
}

// ─── EDIT PROFILE MODAL ───────────────────────────────────────────────────────
function EditProfileModal({ profile, onSave, onClose }) {
  const [name, setName]         = useState(profile.name||"");
  const [city, setCity]         = useState(profile.city||"");
  const [birthYear, setBirth]   = useState(profile.birth_year||"");
  const [gender, setGender]     = useState(profile.gender||"");
  const [nationality, setNat]   = useState(profile.nationality||"");
  const [avatarFile, setAvatar] = useState(null);
  const [loading, setLoading]   = useState(false);

  const handleSave = async () => {
    setLoading(true);
    let avatar_url = profile.avatar;
    if(avatarFile) {
      const ext = avatarFile.name.split(".").pop();
      const path = `${profile.id}.${ext}`;
      await supabase.storage.from("avatars").upload(path, avatarFile, {upsert:true});
      const {data} = supabase.storage.from("avatars").getPublicUrl(path);
      avatar_url = data.publicUrl;
    }
    await supabase.from("profiles").update({
      name, city, birth_year:birthYear?parseInt(birthYear):null,
      gender, nationality, avatar:avatar_url
    }).eq("id", profile.id);
    setLoading(false);
    onSave();
  };

  return (
    <Modal onClose={onClose}>
      <div style={{fontFamily:"'Bebas Neue'",fontSize:26,color:"#F0EDE8",letterSpacing:1,marginBottom:20}}>
        Modifier le profil
      </div>
      <Label>Photo de profil</Label>
      <label style={{display:"flex",alignItems:"center",gap:12,marginBottom:16,cursor:"pointer"}}>
        <div style={{width:60,height:60,borderRadius:"50%",overflow:"hidden",
          background:"rgba(255,255,255,0.05)",border:"2px solid rgba(230,57,70,0.4)",
          display:"flex",alignItems:"center",justifyContent:"center",fontSize:24}}>
          {profile.avatar ? <img src={profile.avatar} style={{width:"100%",height:"100%",objectFit:"cover"}}/> : "👤"}
        </div>
        <div style={{fontSize:13,color:"rgba(230,57,70,0.8)",fontFamily:"'Barlow',sans-serif",fontWeight:600}}>
          Changer la photo
        </div>
        <input type="file" accept="image/*" onChange={e=>setAvatar(e.target.files[0])} style={{display:"none"}}/>
      </label>
      <Label>Nom complet</Label>
      <Input value={name} onChange={setName} placeholder="Ton nom"/>
      <Label>Ville</Label>
      <Input value={city} onChange={setCity} placeholder="Ta ville"/>
      <Label>Année de naissance</Label>
      <Input value={birthYear} onChange={setBirth} placeholder="Ex: 1990" type="number"/>
      <Label>Sexe</Label>
      <Select value={gender} onChange={setGender}>
        <option value="">Non précisé</option>
        <option value="H">Homme</option>
        <option value="F">Femme</option>
      </Select>
      <Label>Nationalité</Label>
      <Input value={nationality} onChange={setNat} placeholder="Ex: Française"/>
      <Btn onClick={handleSave} style={{marginBottom:8}}>{loading?"Enregistrement...":"Sauvegarder"}</Btn>
      <Btn onClick={onClose} variant="secondary">Annuler</Btn>
    </Modal>
  );
}

// ─── RANKING TAB ──────────────────────────────────────────────────────────────
function RankingTab({ myProfile }) {
  const [filter, setFilter]   = useState("global");
  const [discFilter, setDisc] = useState("marathon");
  const [players, setPlayers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [groups, setGroups]   = useState([]);
  const [selGroup, setSelGroup] = useState(null);

  useEffect(() => { loadPlayers(); loadMyGroups(); }, [filter, discFilter, selGroup]);

  const loadMyGroups = async () => {
    const {data:{user}} = await supabase.auth.getUser();
    const {data} = await supabase.from("group_members").select("*, group:groups(*)").eq("user_id",user.id);
    setGroups(data?.map(d=>d.group)||[]);
  };

  const loadPlayers = async () => {
    setLoading(true);
    const {data:profiles} = await supabase.from("profiles").select("*");
    const {data:results}  = await supabase.from("results").select("*");
    if(!profiles||!results) { setLoading(false); return; }

    let filtered = profiles;
    if(filter==="group"&&selGroup) {
      const {data:members} = await supabase.from("group_members").select("user_id").eq("group_id",selGroup);
      const ids = new Set(members?.map(m=>m.user_id)||[]);
      filtered = profiles.filter(p=>ids.has(p.id));
    }

    const ranked = filtered.map(p => {
      const pResults = results.filter(r=>r.user_id===p.id);
      let pts = 0;
      if(filter==="discipline") {
        const best = pResults.filter(r=>r.discipline===discFilter).sort((a,b)=>a.time-b.time)[0];
        pts = best ? calcPoints(discFilter, best.time) : 0;
      } else {
        pts = Math.max(0, ...pResults.map(r=>calcPoints(r.discipline,r.time)));
      }
      return {...p, pts, resultsCount:pResults.length};
    }).filter(p=>p.pts>0).sort((a,b)=>b.pts-a.pts);

    // Apply demographic filters
    const myAgecat = getAgeCategory(myProfile?.birth_year);
    let display = ranked;
    if(filter==="age_cat") display = ranked.filter(p=>getAgeCategory(p.birth_year)===myAgecat);
    if(filter==="gender")  display = ranked.filter(p=>p.gender===myProfile?.gender);
    if(filter==="nationality") display = ranked.filter(p=>p.nationality===myProfile?.nationality);

    setPlayers(display);
    setLoading(false);
  };

  const FILTERS = [
    {k:"global",    l:"🌍 Global"},
    {k:"discipline",l:"🏅 Discipline"},
    {k:"age_cat",   l:"📅 Catégorie"},
    {k:"gender",    l:"⚧ Sexe"},
    {k:"nationality",l:"🏳️ Pays"},
    {k:"group",     l:"👥 Groupe"},
  ];

  return (
    <div style={{padding:"0 16px 100px"}}>
      <div style={{fontFamily:"'Bebas Neue'",fontSize:28,letterSpacing:2,color:"#F0EDE8",marginBottom:16,paddingTop:20}}>
        Classement
      </div>
      <div style={{display:"flex",gap:6,overflowX:"auto",paddingBottom:8,marginBottom:12,
        scrollbarWidth:"none",WebkitOverflowScrolling:"touch"}}>
        {FILTERS.map(f=>(
          <button key={f.k} onClick={()=>setFilter(f.k)} style={{
            flexShrink:0,padding:"7px 14px",borderRadius:20,border:"none",cursor:"pointer",
            background:filter===f.k?"#E63946":"rgba(255,255,255,0.06)",
            color:filter===f.k?"#fff":"rgba(240,237,232,0.5)",
            fontFamily:"'Barlow',sans-serif",fontWeight:600,fontSize:12,whiteSpace:"nowrap"}}>
            {f.l}
          </button>
        ))}
      </div>
      {filter==="discipline"&&(
        <Select value={discFilter} onChange={setDisc}>
          {Object.entries(DISCIPLINES).map(([k,v])=><option key={k} value={k}>{v.icon} {v.label}</option>)}
        </Select>
      )}
      {filter==="group"&&(
        <Select value={selGroup||""} onChange={v=>setSelGroup(v)}>
          <option value="">Sélectionne un groupe</option>
          {groups.map(g=><option key={g.id} value={g.id}>{g.name}</option>)}
        </Select>
      )}
      {loading ? <div style={{textAlign:"center",color:"#444",padding:"40px 0",fontFamily:"'Barlow',sans-serif"}}>Chargement…</div>
      : players.length===0 ? <div style={{textAlign:"center",color:"#444",padding:"40px 0",fontFamily:"'Barlow',sans-serif"}}>Aucun résultat</div>
      : players.map((p,i)=>{
          const lv = getLevelLabel(p.pts);
          const isMe = p.id===myProfile?.id;
          return (
            <div key={p.id} style={{display:"flex",alignItems:"center",gap:12,padding:"12px 14px",
              borderRadius:14,marginBottom:8,
              background:isMe?"rgba(230,57,70,0.08)":"rgba(255,255,255,0.03)",
              border:isMe?"1px solid rgba(230,57,70,0.3)":"1px solid rgba(255,255,255,0.05)"}}>
              <div style={{fontFamily:"'Bebas Neue'",fontSize:22,color:i<3?"#FFD700":"#444",width:28,textAlign:"center"}}>
                {i===0?"🥇":i===1?"🥈":i===2?"🥉":i+1}
              </div>
              <div style={{width:38,height:38,borderRadius:"50%",overflow:"hidden",flexShrink:0,
                background:"rgba(255,255,255,0.05)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:18}}>
                {p.avatar?<img src={p.avatar} style={{width:"100%",height:"100%",objectFit:"cover"}}/>:"👤"}
              </div>
              <div style={{flex:1,minWidth:0}}>
                <div style={{fontFamily:"'Barlow',sans-serif",fontWeight:700,fontSize:14,color:"#F0EDE8",
                  overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{p.name||"Anonyme"}</div>
                <div style={{fontSize:11,color:"rgba(240,237,232,0.35)",fontFamily:"'Barlow',sans-serif"}}>
                  {getAgeCategory(p.birth_year)||""}{p.nationality?` · ${p.nationality}`:""}
                </div>
              </div>
              <div style={{textAlign:"right"}}>
                <div style={{fontFamily:"'Bebas Neue'",fontSize:22,color:lv.color,letterSpacing:1}}>{p.pts}</div>
                <div style={{fontSize:9,color:"rgba(240,237,232,0.3)",letterSpacing:1,textTransform:"uppercase",fontFamily:"'Barlow',sans-serif"}}>pts</div>
              </div>
            </div>
          );
        })
      }
    </div>
  );
}

// ─── FRIENDS TAB ──────────────────────────────────────────────────────────────
function FriendsTab({ myProfile }) {
  const [tab, setTab]           = useState("friends");
  const [friends, setFriends]   = useState([]);
  const [groups, setGroups]     = useState([]);
  const [search, setSearch]     = useState("");
  const [searchRes, setSearchRes] = useState([]);
  const [showCreateGroup, setShowCreate] = useState(false);
  const [showJoinGroup, setShowJoin]     = useState(false);
  const [groupName, setGroupName] = useState("");
  const [joinCode, setJoinCode]   = useState("");
  const [loading, setLoading]    = useState(false);

  useEffect(() => { loadFriends(); loadGroups(); }, []);

  const loadFriends = async () => {
    const {data:{user}} = await supabase.auth.getUser();
    const {data} = await supabase.from("friendships")
      .select("*, friend:profiles!friendships_friend_id_fkey(id,name,avatar,city,birth_year,nationality)")
      .eq("user_id",user.id).eq("status","accepted");
    setFriends(data||[]);
  };

  const loadGroups = async () => {
    const {data:{user}} = await supabase.auth.getUser();
    const {data} = await supabase.from("group_members").select("*, group:groups(*)").eq("user_id",user.id);
    setGroups(data?.map(d=>d.group)||[]);
  };

  const handleSearch = async (q) => {
    setSearch(q);
    if(q.length<2) { setSearchRes([]); return; }
    const {data:{user}} = await supabase.auth.getUser();
    const {data} = await supabase.from("profiles").select("*")
      .ilike("name",`%${q}%`).neq("id",user.id).limit(10);
    setSearchRes(data||[]);
  };

  const addFriend = async (friendId) => {
    const {data:{user}} = await supabase.auth.getUser();
    await supabase.from("friendships").upsert({user_id:user.id,friend_id:friendId,status:"accepted"},{onConflict:"user_id,friend_id"});
    setSearchRes(s=>s.filter(p=>p.id!==friendId));
    loadFriends();
  };

  const createGroup = async () => {
    if(!groupName) return; setLoading(true);
    const {data:{user}} = await supabase.auth.getUser();
    const code = Math.random().toString(36).substring(2,8).toUpperCase();
    const {data:g} = await supabase.from("groups").insert({name:groupName,created_by:user.id,code}).select().single();
    if(g) await supabase.from("group_members").insert({group_id:g.id,user_id:user.id});
    setGroupName(""); setShowCreate(false); setLoading(false); loadGroups();
  };

  const joinGroup = async () => {
    if(!joinCode) return; setLoading(true);
    const {data:{user}} = await supabase.auth.getUser();
    const {data:g} = await supabase.from("groups").select("*").eq("code",joinCode.toUpperCase()).single();
    if(g) { await supabase.from("group_members").upsert({group_id:g.id,user_id:user.id},{onConflict:"group_id,user_id"}); }
    setJoinCode(""); setShowJoin(false); setLoading(false); loadGroups();
  };

  return (
    <div style={{padding:"0 16px 100px"}}>
      <div style={{fontFamily:"'Bebas Neue'",fontSize:28,letterSpacing:2,color:"#F0EDE8",marginBottom:16,paddingTop:20}}>
        Social
      </div>
      <div style={{display:"flex",gap:6,marginBottom:16}}>
        {[["friends","👥 Amis"],["groups","🏠 Groupes"],["search","🔍 Chercher"]].map(([k,l])=>(
          <button key={k} onClick={()=>setTab(k)} style={{flex:1,padding:"8px 0",borderRadius:12,border:"none",
            cursor:"pointer",background:tab===k?"#E63946":"rgba(255,255,255,0.06)",
            color:tab===k?"#fff":"rgba(240,237,232,0.5)",fontFamily:"'Barlow',sans-serif",fontWeight:600,fontSize:12}}>
            {l}
          </button>
        ))}
      </div>

      {tab==="search"&&(
        <div>
          <Input value={search} onChange={handleSearch} placeholder="Recherche par nom…"/>
          {searchRes.map(p=>(
            <div key={p.id} style={{display:"flex",alignItems:"center",gap:12,padding:"12px 14px",
              background:"rgba(255,255,255,0.03)",borderRadius:14,marginBottom:8,border:"1px solid rgba(255,255,255,0.05)"}}>
              <div style={{width:38,height:38,borderRadius:"50%",overflow:"hidden",
                background:"rgba(255,255,255,0.05)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:18}}>
                {p.avatar?<img src={p.avatar} style={{width:"100%",height:"100%",objectFit:"cover"}}/>:"👤"}
              </div>
              <div style={{flex:1}}>
                <div style={{fontFamily:"'Barlow',sans-serif",fontWeight:700,fontSize:14,color:"#F0EDE8"}}>{p.name}</div>
                <div style={{fontSize:11,color:"rgba(240,237,232,0.35)"}}>{p.city||""}</div>
              </div>
              <button onClick={()=>addFriend(p.id)} style={{padding:"7px 14px",borderRadius:10,
                background:"rgba(230,57,70,0.15)",color:"#E63946",border:"1px solid rgba(230,57,70,0.3)",
                cursor:"pointer",fontFamily:"'Barlow',sans-serif",fontWeight:700,fontSize:12}}>+ Ajouter</button>
            </div>
          ))}
        </div>
      )}

      {tab==="friends"&&(
        <div>
          {friends.length===0&&<div style={{textAlign:"center",color:"#444",padding:"40px 0",fontFamily:"'Barlow',sans-serif"}}>
            Aucun ami — utilise la recherche !
          </div>}
          {friends.map(f=>(
            <div key={f.id} style={{display:"flex",alignItems:"center",gap:12,padding:"12px 14px",
              background:"rgba(255,255,255,0.03)",borderRadius:14,marginBottom:8,border:"1px solid rgba(255,255,255,0.05)"}}>
              <div style={{width:38,height:38,borderRadius:"50%",overflow:"hidden",
                background:"rgba(255,255,255,0.05)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:18}}>
                {f.friend?.avatar?<img src={f.friend.avatar} style={{width:"100%",height:"100%",objectFit:"cover"}}/>:"👤"}
              </div>
              <div style={{flex:1}}>
                <div style={{fontFamily:"'Barlow',sans-serif",fontWeight:700,fontSize:14,color:"#F0EDE8"}}>{f.friend?.name||"Anonyme"}</div>
                <div style={{fontSize:11,color:"rgba(240,237,232,0.35)"}}>
                  {getAgeCategory(f.friend?.birth_year)||""}{f.friend?.city?` · ${f.friend.city}`:""}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {tab==="groups"&&(
        <div>
          <div style={{display:"flex",gap:8,marginBottom:16}}>
            <button onClick={()=>setShowCreate(true)} style={{flex:1,padding:"11px 0",borderRadius:12,
              background:"rgba(230,57,70,0.1)",color:"#E63946",border:"1px solid rgba(230,57,70,0.3)",
              cursor:"pointer",fontFamily:"'Barlow',sans-serif",fontWeight:700,fontSize:13}}>+ Créer</button>
            <button onClick={()=>setShowJoin(true)} style={{flex:1,padding:"11px 0",borderRadius:12,
              background:"rgba(255,255,255,0.06)",color:"rgba(240,237,232,0.6)",border:"none",
              cursor:"pointer",fontFamily:"'Barlow',sans-serif",fontWeight:700,fontSize:13}}>Rejoindre</button>
          </div>
          {groups.map(g=>(
            <div key={g.id} style={{padding:"14px 16px",background:"rgba(255,255,255,0.03)",
              borderRadius:14,marginBottom:8,border:"1px solid rgba(255,255,255,0.05)"}}>
              <div style={{fontFamily:"'Barlow',sans-serif",fontWeight:700,fontSize:15,color:"#F0EDE8"}}>{g.name}</div>
              <div style={{fontSize:11,color:"rgba(240,237,232,0.3)",marginTop:4,letterSpacing:2,fontFamily:"'Barlow',sans-serif"}}>
                Code : <span style={{color:"#E63946",fontWeight:700}}>{g.code}</span>
              </div>
            </div>
          ))}
        </div>
      )}

      {showCreateGroup&&(
        <Modal onClose={()=>setShowCreate(false)}>
          <div style={{fontFamily:"'Bebas Neue'",fontSize:24,color:"#F0EDE8",marginBottom:20}}>Créer un groupe</div>
          <Label>Nom du groupe</Label>
          <Input value={groupName} onChange={setGroupName} placeholder="Ex: Club de tri Paris"/>
          <Btn onClick={createGroup}>{loading?"Création...":"Créer"}</Btn>
        </Modal>
      )}
      {showJoinGroup&&(
        <Modal onClose={()=>setShowJoin(false)}>
          <div style={{fontFamily:"'Bebas Neue'",fontSize:24,color:"#F0EDE8",marginBottom:20}}>Rejoindre un groupe</div>
          <Label>Code du groupe</Label>
          <Input value={joinCode} onChange={setJoinCode} placeholder="Ex: ABC123"/>
          <Btn onClick={joinGroup}>{loading?"Recherche...":"Rejoindre"}</Btn>
        </Modal>
      )}
    </div>
  );
}

// ─── TRAINING TAB ─────────────────────────────────────────────────────────────
function TrainingTab() {
  const [trainings, setTrainings] = useState([]);
  const [showAdd, setShowAdd]     = useState(false);
  const [selSport, setSelSport]   = useState(TRAINING_SPORTS[0]);
  const [selYear, setSelYear]     = useState(CURRENT_YEAR);

  useEffect(() => { loadTrainings(); }, []);

  const loadTrainings = async () => {
    const {data:{user}} = await supabase.auth.getUser();
    const {data} = await supabase.from("trainings").select("*").eq("user_id",user.id).order("training_date",{ascending:false});
    setTrainings(data||[]);
  };

  const sportTrainings = trainings.filter(t=>t.sport===selSport && new Date(t.training_date).getFullYear()===selYear);
  const monthlyData = MONTHS_FR.map((label,i)=>({
    label,
    value: sportTrainings.filter(t=>new Date(t.training_date).getMonth()===i)
      .reduce((sum,t)=>sum+(t.distance||0),0)
  }));
  const totalDist = sportTrainings.reduce((s,t)=>s+(t.distance||0),0);
  const totalSessions = sportTrainings.length;

  return (
    <div style={{padding:"0 16px 100px"}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",paddingTop:20,marginBottom:16}}>
        <div style={{fontFamily:"'Bebas Neue'",fontSize:28,letterSpacing:2,color:"#F0EDE8"}}>Entraînements</div>
        <button onClick={()=>setShowAdd(true)} style={{background:"#E63946",border:"none",borderRadius:10,
          width:36,height:36,display:"flex",alignItems:"center",justifyContent:"center",
          cursor:"pointer",fontSize:20,color:"#fff",flexShrink:0}}>+</button>
      </div>

      {/* Sport filter */}
      <div style={{display:"flex",gap:6,overflowX:"auto",paddingBottom:8,marginBottom:12,scrollbarWidth:"none"}}>
        {TRAINING_SPORTS.map(s=>(
          <button key={s} onClick={()=>setSelSport(s)} style={{flexShrink:0,padding:"6px 14px",borderRadius:20,
            border:"none",cursor:"pointer",
            background:selSport===s?"#E63946":"rgba(255,255,255,0.06)",
            color:selSport===s?"#fff":"rgba(240,237,232,0.5)",
            fontFamily:"'Barlow',sans-serif",fontWeight:600,fontSize:12}}>{s}</button>
        ))}
      </div>

      {/* Year filter */}
      <div style={{display:"flex",gap:6,marginBottom:16}}>
        {[CURRENT_YEAR-1,CURRENT_YEAR].map(y=>(
          <button key={y} onClick={()=>setSelYear(y)} style={{flex:1,padding:"8px 0",borderRadius:10,border:"none",
            cursor:"pointer",background:selYear===y?"rgba(230,57,70,0.15)":"rgba(255,255,255,0.04)",
            color:selYear===y?"#E63946":"rgba(240,237,232,0.4)",
            fontFamily:"'Barlow',sans-serif",fontWeight:700,fontSize:14}}>{y}</button>
        ))}
      </div>

      {/* Stats */}
      <div style={{display:"flex",gap:8,marginBottom:16}}>
        {[{l:"Distance totale",v:`${totalDist.toFixed(1)} km`},{l:"Sessions",v:totalSessions}].map(({l,v})=>(
          <div key={l} style={{flex:1,padding:"14px",background:"rgba(255,255,255,0.03)",borderRadius:14,
            border:"1px solid rgba(255,255,255,0.06)",textAlign:"center"}}>
            <div style={{fontFamily:"'Bebas Neue'",fontSize:24,color:"#E63946",letterSpacing:1}}>{v}</div>
            <div style={{fontSize:10,color:"rgba(240,237,232,0.3)",letterSpacing:1,textTransform:"uppercase",fontFamily:"'Barlow',sans-serif",marginTop:2}}>{l}</div>
          </div>
        ))}
      </div>

      {/* Monthly bar chart */}
      <div style={{background:"rgba(255,255,255,0.03)",borderRadius:16,padding:"16px",marginBottom:16,
        border:"1px solid rgba(255,255,255,0.06)"}}>
        <BarChart data={monthlyData} color="#E63946" unit="km" title={`Distance ${selSport} par mois (${selYear})`}/>
      </div>

      {/* Recent sessions */}
      <div style={{fontFamily:"'Barlow',sans-serif",fontSize:11,color:"rgba(240,237,232,0.35)",
        letterSpacing:1.5,textTransform:"uppercase",marginBottom:10}}>Sessions récentes</div>
      {sportTrainings.slice(0,10).map((t,i)=>(
        <div key={i} style={{padding:"12px 14px",background:"rgba(255,255,255,0.03)",borderRadius:14,
          marginBottom:8,border:"1px solid rgba(255,255,255,0.05)",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
          <div>
            <div style={{fontFamily:"'Barlow',sans-serif",fontWeight:600,fontSize:14,color:"#F0EDE8"}}>
              {t.distance} km {t.note?`· ${t.note}`:""}
            </div>
            <div style={{fontSize:11,color:"rgba(240,237,232,0.35)",marginTop:2}}>
              {t.training_date} {t.duration_str?`· ${t.duration_str}`:""}
            </div>
          </div>
        </div>
      ))}
      {sportTrainings.length===0&&<div style={{textAlign:"center",color:"#444",padding:"30px 0",fontFamily:"'Barlow',sans-serif"}}>Aucune session — ajoute ton premier entraînement !</div>}

      {showAdd&&<TrainingModal onSave={()=>{setShowAdd(false);loadTrainings();}} onClose={()=>setShowAdd(false)}/>}
    </div>
  );
}

// ─── PERF TAB ─────────────────────────────────────────────────────────────────
function PerfTab({ results }) {
  const [subTab, setSubTab] = useState("bests");
  const [selDisc, setSelDisc] = useState("marathon");

  const byDisc = {};
  results.forEach(r=>{ if(!byDisc[r.discipline]||r.time<byDisc[r.discipline].time) byDisc[r.discipline]=r; });
  const bests = Object.entries(byDisc).sort((a,b)=>{
    const cats=["running","trail","triathlon"];
    return cats.indexOf(DISCIPLINES[a[0]]?.category)-cats.indexOf(DISCIPLINES[b[0]]?.category);
  });

  const byYear = {};
  [...results].sort((a,b)=>a.year-b.year).forEach(r=>{ if(!byYear[r.year]) byYear[r.year]=[]; byYear[r.year].push(r); });

  // Progression data for selected discipline
  const discResults = results.filter(r=>r.discipline===selDisc).sort((a,b)=>{
    const da = a.race_date||`${a.year}-01-01`, db = b.race_date||`${b.year}-01-01`;
    return da.localeCompare(db);
  });
  const progressionData = discResults.map(r=>({
    label: r.race_date ? r.race_date.slice(5) : String(r.year),
    value: calcPoints(selDisc, r.time)
  }));

  return (
    <div style={{padding:"0 16px 100px"}}>
      <div style={{fontFamily:"'Bebas Neue'",fontSize:28,letterSpacing:2,color:"#F0EDE8",marginBottom:16,paddingTop:20}}>
        Performances
      </div>
      <div style={{display:"flex",gap:6,marginBottom:16}}>
        {[["bests","🏆 Records"],["history","📅 Historique"],["progression","📈 Progression"]].map(([k,l])=>(
          <button key={k} onClick={()=>setSubTab(k)} style={{flex:1,padding:"8px 0",borderRadius:12,border:"none",
            cursor:"pointer",background:subTab===k?"rgba(230,57,70,0.12)":"rgba(255,255,255,0.05)",
            color:subTab===k?"#E63946":"rgba(240,237,232,0.4)",
            fontFamily:"'Barlow',sans-serif",fontWeight:700,fontSize:11}}>
            {l}
          </button>
        ))}
      </div>

      {subTab==="bests"&&(
        <div>
          {bests.length===0&&<div style={{textAlign:"center",color:"#444",padding:"40px 0",fontFamily:"'Barlow',sans-serif"}}>Aucun résultat</div>}
          {bests.map(([disc,r])=>{
            const pts=calcPoints(disc,r.time); const lv=getLevelLabel(pts);
            return(
              <div key={disc} style={{background:"rgba(255,255,255,0.03)",borderRadius:14,padding:"14px 16px",
                marginBottom:8,border:"1px solid rgba(255,255,255,0.05)"}}>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                  <div>
                    <div style={{fontSize:18,marginBottom:2}}>{DISCIPLINES[disc]?.icon}</div>
                    <div style={{fontFamily:"'Barlow',sans-serif",fontWeight:700,fontSize:14,color:"#F0EDE8"}}>{DISCIPLINES[disc]?.label}</div>
                    <div style={{fontFamily:"'Bebas Neue'",fontSize:22,color:lv.color,letterSpacing:1,marginTop:2}}>{fmtTime(r.time)}</div>
                    <div style={{fontSize:11,color:"rgba(240,237,232,0.3)",fontFamily:"'Barlow',sans-serif"}}>
                      {r.race||""}{r.year?` · ${r.year}`:""}
                    </div>
                  </div>
                  <div style={{textAlign:"right"}}>
                    <div style={{fontFamily:"'Bebas Neue'",fontSize:30,color:lv.color,letterSpacing:1}}>{pts}</div>
                    <div style={{fontSize:9,color:"rgba(240,237,232,0.3)",letterSpacing:1.5,textTransform:"uppercase",fontFamily:"'Barlow',sans-serif"}}>pts</div>
                    <div style={{marginTop:4,fontSize:10,color:lv.color,fontFamily:"'Barlow',sans-serif",fontWeight:700}}>{lv.label}</div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {subTab==="history"&&(
        <div>
          {Object.entries(byYear).reverse().map(([yr,res])=>(
            <div key={yr} style={{marginBottom:20}}>
              <div style={{fontFamily:"'Bebas Neue'",fontSize:18,color:"rgba(240,237,232,0.4)",letterSpacing:2,marginBottom:8}}>{yr}</div>
              {res.sort((a,b)=>(b.race_date||"").localeCompare(a.race_date||"")).map((r,i)=>{
                const pts=calcPoints(r.discipline,r.time); const lv=getLevelLabel(pts);
                return(
                  <div key={i} style={{display:"flex",justifyContent:"space-between",alignItems:"center",
                    padding:"12px 14px",background:"rgba(255,255,255,0.03)",borderRadius:12,marginBottom:6,
                    border:"1px solid rgba(255,255,255,0.05)"}}>
                    <div>
                      <div style={{fontFamily:"'Barlow',sans-serif",fontWeight:600,fontSize:13,color:"#F0EDE8"}}>
                        {DISCIPLINES[r.discipline]?.icon} {r.race||DISCIPLINES[r.discipline]?.label}
                      </div>
                      <div style={{fontSize:11,color:"rgba(240,237,232,0.3)",fontFamily:"'Barlow',sans-serif"}}>
                        {r.race_date||yr}
                      </div>
                    </div>
                    <div style={{textAlign:"right"}}>
                      <div style={{fontFamily:"'Bebas Neue'",fontSize:20,color:lv.color}}>{fmtTime(r.time)}</div>
                      <div style={{fontSize:10,color:"rgba(240,237,232,0.3)",fontFamily:"'Barlow',sans-serif"}}>{pts} pts</div>
                    </div>
                  </div>
                );
              })}
            </div>
          ))}
          {results.length===0&&<div style={{textAlign:"center",color:"#444",padding:"40px 0",fontFamily:"'Barlow',sans-serif"}}>Aucun résultat</div>}
        </div>
      )}

      {subTab==="progression"&&(
        <div>
          <Label>Discipline</Label>
          <Select value={selDisc} onChange={setSelDisc}>
            {Object.entries(DISCIPLINES).map(([k,v])=><option key={k} value={k}>{v.icon} {v.label}</option>)}
          </Select>
          <div style={{background:"rgba(255,255,255,0.03)",borderRadius:16,padding:"20px 16px",marginBottom:16,
            border:"1px solid rgba(255,255,255,0.06)"}}>
            <LineChart data={progressionData} color="#E63946" unit="pts" title={`Progression ${DISCIPLINES[selDisc]?.label}`}/>
          </div>
          {discResults.map((r,i)=>{
            const pts=calcPoints(r.discipline,r.time); const lv=getLevelLabel(pts);
            return(
              <div key={i} style={{display:"flex",justifyContent:"space-between",alignItems:"center",
                padding:"12px 14px",background:"rgba(255,255,255,0.03)",borderRadius:12,marginBottom:6,
                border:"1px solid rgba(255,255,255,0.05)"}}>
                <div>
                  <div style={{fontFamily:"'Barlow',sans-serif",fontWeight:600,fontSize:13,color:"#F0EDE8"}}>{r.race||DISCIPLINES[r.discipline]?.label}</div>
                  <div style={{fontSize:11,color:"rgba(240,237,232,0.3)",fontFamily:"'Barlow',sans-serif"}}>{r.race_date||r.year}</div>
                </div>
                <div style={{fontFamily:"'Bebas Neue'",fontSize:20,color:lv.color}}>{fmtTime(r.time)}</div>
              </div>
            );
          })}
          {discResults.length===0&&<div style={{textAlign:"center",color:"#444",padding:"30px 0",fontFamily:"'Barlow',sans-serif"}}>Aucun résultat pour cette discipline</div>}
        </div>
      )}
    </div>
  );
}

// ─── PROFILE TAB ──────────────────────────────────────────────────────────────
function ProfileTab({ profile, results, onRefresh }) {
  const [showEdit, setShowEdit]     = useState(false);
  const [showAddResult, setShowAdd] = useState(false);
  const [editResult, setEditResult] = useState(null);

  const badges = computeBadges(results);
  const totalPts = Math.max(0,...results.map(r=>calcPoints(r.discipline,r.time)));
  const lv = getLevelLabel(totalPts);
  const agecat = getAgeCategory(profile.birth_year);

  const deleteResult = async (id) => {
    if(!confirm("Supprimer ce résultat ?")) return;
    await supabase.from("results").delete().eq("id",id);
    onRefresh();
  };

  return (
    <div style={{padding:"0 16px 100px"}}>
      {/* Profile header */}
      <div style={{padding:"20px 0 16px",display:"flex",gap:14,alignItems:"center"}}>
        <div style={{width:72,height:72,borderRadius:"50%",overflow:"hidden",flexShrink:0,
          background:"rgba(255,255,255,0.05)",border:"2px solid rgba(230,57,70,0.4)",
          display:"flex",alignItems:"center",justifyContent:"center",fontSize:32}}>
          {profile.avatar?<img src={profile.avatar} style={{width:"100%",height:"100%",objectFit:"cover"}}/>:"👤"}
        </div>
        <div style={{flex:1,minWidth:0}}>
          <div style={{fontFamily:"'Bebas Neue'",fontSize:26,letterSpacing:1,color:"#F0EDE8",
            overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{profile.name||"Athlète"}</div>
          <div style={{fontSize:12,color:"rgba(240,237,232,0.4)",fontFamily:"'Barlow',sans-serif",marginTop:2}}>
            {[profile.city, agecat, profile.gender, profile.nationality].filter(Boolean).join(" · ")}
          </div>
          <div style={{marginTop:6,display:"flex",alignItems:"center",gap:8}}>
            <div style={{fontFamily:"'Bebas Neue'",fontSize:22,color:lv.color,letterSpacing:1}}>{totalPts} pts</div>
            <div style={{fontSize:11,color:lv.color,fontFamily:"'Barlow',sans-serif",fontWeight:700,
              background:`${lv.color}22`,padding:"2px 8px",borderRadius:8}}>{lv.label}</div>
          </div>
        </div>
        <button onClick={()=>setShowEdit(true)} style={{flexShrink:0,background:"rgba(255,255,255,0.07)",
          border:"none",borderRadius:10,padding:"8px 12px",color:"rgba(240,237,232,0.6)",
          cursor:"pointer",fontFamily:"'Barlow',sans-serif",fontSize:12,fontWeight:600}}>✏️ Éditer</button>
      </div>

      {/* Badges */}
      {badges.length>0&&(
        <div style={{display:"flex",gap:8,overflowX:"auto",paddingBottom:8,marginBottom:16,scrollbarWidth:"none"}}>
          {badges.map(b=>(
            <div key={b.id} title={b.desc} style={{flexShrink:0,background:"rgba(255,255,255,0.04)",
              borderRadius:12,padding:"8px 12px",border:`1px solid ${b.color}44`,textAlign:"center"}}>
              <div style={{fontSize:22}}>{b.emoji}</div>
              <div style={{fontSize:9,color:b.color,fontFamily:"'Barlow',sans-serif",fontWeight:700,
                marginTop:2,letterSpacing:0.5,whiteSpace:"nowrap"}}>{b.label}</div>
            </div>
          ))}
        </div>
      )}

      {/* Add result button */}
      <button onClick={()=>setShowAdd(true)} style={{width:"100%",padding:"13px 0",borderRadius:14,
        background:"rgba(230,57,70,0.1)",border:"1px solid rgba(230,57,70,0.3)",color:"#E63946",
        cursor:"pointer",fontFamily:"'Barlow',sans-serif",fontWeight:700,fontSize:14,marginBottom:16}}>
        + Ajouter un résultat
      </button>

      {/* Results list */}
      {results.length===0&&<div style={{textAlign:"center",color:"#444",padding:"40px 0",fontFamily:"'Barlow',sans-serif"}}>
        Aucun résultat — ajoute ta première course !
      </div>}
      {[...results].sort((a,b)=>(b.race_date||b.year+"").localeCompare(a.race_date||a.year+"")).map((r,i)=>{
        const pts=calcPoints(r.discipline,r.time); const lv=getLevelLabel(pts);
        return(
          <div key={r.id||i} style={{background:"rgba(255,255,255,0.03)",borderRadius:14,padding:"14px 16px",
            marginBottom:8,border:"1px solid rgba(255,255,255,0.05)"}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start"}}>
              <div style={{flex:1}}>
                <div style={{fontSize:16,marginBottom:2}}>{DISCIPLINES[r.discipline]?.icon}</div>
                <div style={{fontFamily:"'Barlow',sans-serif",fontWeight:700,fontSize:14,color:"#F0EDE8"}}>{r.race||DISCIPLINES[r.discipline]?.label}</div>
                <div style={{fontFamily:"'Bebas Neue'",fontSize:22,color:lv.color,letterSpacing:1}}>{fmtTime(r.time)}</div>
                <div style={{fontSize:11,color:"rgba(240,237,232,0.3)",fontFamily:"'Barlow',sans-serif"}}>
                  {r.race_date||r.year}
                </div>
              </div>
              <div style={{display:"flex",flexDirection:"column",alignItems:"flex-end",gap:6}}>
                <div style={{textAlign:"right"}}>
                  <div style={{fontFamily:"'Bebas Neue'",fontSize:28,color:lv.color,letterSpacing:1}}>{pts}</div>
                  <div style={{fontSize:9,color:"rgba(240,237,232,0.3)",letterSpacing:1.5,fontFamily:"'Barlow',sans-serif",textTransform:"uppercase"}}>pts</div>
                </div>
                <div style={{display:"flex",gap:6}}>
                  <button onClick={()=>setEditResult(r)} style={{padding:"5px 10px",borderRadius:8,
                    background:"rgba(255,255,255,0.06)",border:"none",color:"rgba(240,237,232,0.5)",
                    cursor:"pointer",fontSize:12}}>✏️</button>
                  <button onClick={()=>deleteResult(r.id)} style={{padding:"5px 10px",borderRadius:8,
                    background:"rgba(230,57,70,0.1)",border:"none",color:"#E63946",
                    cursor:"pointer",fontSize:12}}>🗑️</button>
                </div>
              </div>
            </div>
          </div>
        );
      })}

      {showEdit&&<EditProfileModal profile={profile} onSave={()=>{setShowEdit(false);onRefresh();}} onClose={()=>setShowEdit(false)}/>}
      {showAddResult&&<ResultModal onSave={()=>{setShowAdd(false);onRefresh();}} onClose={()=>setShowAdd(false)}/>}
      {editResult&&<ResultModal existing={editResult} onSave={()=>{setEditResult(null);onRefresh();}} onClose={()=>setEditResult(null)}/>}
    </div>
  );
}

// ─── NAV BAR ──────────────────────────────────────────────────────────────────
function NavBar({ tab, onChange }) {
  const items = [
    {k:"profile",  icon:"👤", label:"Profil"},
    {k:"perf",     icon:"📈", label:"Perfs"},
    {k:"training", icon:"🏋️", label:"Training"},
    {k:"ranking",  icon:"🏆", label:"Classement"},
    {k:"social",   icon:"👥", label:"Social"},
  ];
  return (
    <div style={{position:"fixed",bottom:0,left:0,right:0,background:"rgba(14,14,14,0.95)",
      backdropFilter:"blur(20px)",borderTop:"1px solid rgba(255,255,255,0.07)",
      display:"flex",padding:"8px 0 20px",zIndex:100,maxWidth:580,margin:"0 auto"}}>
      {items.map(({k,icon,label})=>(
        <button key={k} onClick={()=>onChange(k)} style={{flex:1,display:"flex",flexDirection:"column",
          alignItems:"center",gap:2,background:"none",border:"none",cursor:"pointer",padding:"4px 0"}}>
          <span style={{fontSize:20,opacity:tab===k?1:0.35,transition:"opacity 0.2s"}}>{icon}</span>
          <span style={{fontSize:9,letterSpacing:0.5,textTransform:"uppercase",fontFamily:"'Barlow',sans-serif",
            fontWeight:700,color:tab===k?"#E63946":"rgba(240,237,232,0.3)",transition:"color 0.2s"}}>{label}</span>
        </button>
      ))}
    </div>
  );
}

// ─── AUTH SCREEN ──────────────────────────────────────────────────────────────
function AuthScreen() {
  const signIn = async () => {
    await supabase.auth.signInWithOAuth({
      provider:"google",
      options:{ redirectTo: window.location.origin }
    });
  };
  return (
    <div style={{minHeight:"100vh",background:"#0e0e0e",display:"flex",flexDirection:"column",
      alignItems:"center",justifyContent:"center",padding:24}}>
      <link href="https://fonts.googleapis.com/css2?family=Bebas+Neue&family=Barlow:wght@400;500;600;700&display=swap" rel="stylesheet"/>
      <div style={{fontFamily:"'Bebas Neue'",fontSize:64,color:"#E63946",letterSpacing:6,lineHeight:1}}>PACE</div>
      <div style={{fontFamily:"'Bebas Neue'",fontSize:64,color:"#F0EDE8",letterSpacing:6,lineHeight:1,marginBottom:8}}>RANK</div>
      <div style={{fontSize:13,color:"rgba(240,237,232,0.35)",letterSpacing:3,textTransform:"uppercase",
        fontFamily:"'Barlow',sans-serif",marginBottom:60}}>Ton classement sportif</div>
      <button onClick={signIn} style={{background:"#fff",color:"#111",border:"none",borderRadius:16,
        padding:"16px 40px",fontFamily:"'Barlow',sans-serif",fontWeight:700,fontSize:16,cursor:"pointer",
        display:"flex",alignItems:"center",gap:12}}>
        <svg width="20" height="20" viewBox="0 0 48 48">
          <path fill="#FFC107" d="M43.6 20H24v8h11.3C33.6 33.1 29.3 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3 0 5.7 1.1 7.8 2.9l5.7-5.7C34.1 6.6 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20c11 0 19.7-8 19.7-20 0-1.3-.1-2.7-.1-4z"/>
          <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.6 15.1 18.9 12 24 12c3 0 5.7 1.1 7.8 2.9l5.7-5.7C34.1 6.6 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/>
          <path fill="#4CAF50" d="M24 44c5.2 0 9.9-1.9 13.5-5l-6.2-5.2C29.4 35.5 26.8 36 24 36c-5.3 0-9.6-3-11.3-7.5l-6.6 5.1C9.5 39.5 16.2 44 24 44z"/>
          <path fill="#1976D2" d="M43.6 20H24v8h11.3c-.9 2.5-2.5 4.6-4.6 6l6.2 5.2C41 35.6 44 30.2 44 24c0-1.3-.1-2.7-.4-4z"/>
        </svg>
        Continuer avec Google
      </button>
    </div>
  );
}

// ─── MAIN APP ──────────────────────────────────────────────────────────────────
export default function App() {
  const [session, setSession] = useState(null);
  const [profile, setProfile] = useState(null);
  const [results, setResults] = useState([]);
  const [tab, setTab]         = useState("profile");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase.auth.getSession().then(({data:{session}}) => { setSession(session); if(!session) setLoading(false); });
    const {data:{subscription}} = supabase.auth.onAuthStateChange((_,session) => { setSession(session); });
    return () => subscription.unsubscribe();
  }, []);

  useEffect(() => { if(session) { loadProfile(); loadResults(); } }, [session]);

  const loadProfile = async () => {
    const {data:{user}} = await supabase.auth.getUser();
    let {data} = await supabase.from("profiles").select("*").eq("id",user.id).single();
    if(!data) {
      await supabase.from("profiles").insert({id:user.id,name:user.user_metadata?.full_name||"",
        avatar:user.user_metadata?.avatar_url||""});
      ({data} = await supabase.from("profiles").select("*").eq("id",user.id).single());
    }
    setProfile(data);
    setLoading(false);
  };

  const loadResults = async () => {
    const {data:{user}} = await supabase.auth.getUser();
    const {data} = await supabase.from("results").select("*").eq("user_id",user.id).order("year",{ascending:false});
    setResults(data||[]);
  };

  const refresh = () => { loadProfile(); loadResults(); };

  if(loading) return (
    <div style={{minHeight:"100vh",background:"#0e0e0e",display:"flex",alignItems:"center",justifyContent:"center"}}>
      <link href="https://fonts.googleapis.com/css2?family=Bebas+Neue&family=Barlow:wght@400;500;600;700&display=swap" rel="stylesheet"/>
      <div style={{fontFamily:"'Bebas Neue'",fontSize:40,color:"#E63946",letterSpacing:4}}>PACERANK</div>
    </div>
  );
  if(!session) return <AuthScreen/>;

  return (
    <div style={{background:"#0e0e0e",minHeight:"100vh",color:"#F0EDE8",maxWidth:580,margin:"0 auto",position:"relative"}}>
      <link href="https://fonts.googleapis.com/css2?family=Bebas+Neue&family=Barlow:wght@400;500;600;700&display=swap" rel="stylesheet"/>
      {tab==="profile"  && <ProfileTab  profile={profile} results={results} onRefresh={refresh}/>}
      {tab==="perf"     && <PerfTab     results={results}/>}
      {tab==="training" && <TrainingTab/>}
      {tab==="ranking"  && <RankingTab  myProfile={profile}/>}
      {tab==="social"   && <FriendsTab  myProfile={profile}/>}
      <NavBar tab={tab} onChange={setTab}/>
    </div>
  );
}
