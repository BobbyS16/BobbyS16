import { useState, useEffect } from "react";
import { supabase } from "./supabase";
import TimePicker from "./components/TimePicker";

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

// ─── TRAINING SPORTS ──────────────────────────────────────────────────────────
const TRAINING_SPORTS = {
  running: { label:"Course à pied", icon:"🏃", unit:"km", speedRef:12 },
  cycling: { label:"Vélo",          icon:"🚴", unit:"km", speedRef:30 },
  swimming:{ label:"Natation",      icon:"🏊", unit:"km", speedRef:2  },
};

// ─── BADGES ───────────────────────────────────────────────────────────────────
const BADGES = [
  { id:"first_race",   emoji:"🎽", label:"Première foulée",  desc:"Enregistrer sa 1ère course",           color:"#E63946", check:(r)=>r.length>=1 },
  { id:"five_races",   emoji:"🔥", label:"Série de 5",       desc:"Compléter 5 épreuves au total",        color:"#FF8C00", check:(r)=>r.length>=5 },
  { id:"ten_races",    emoji:"💯", label:"Centurion",        desc:"Compléter 10 épreuves au total",       color:"#FFD700", check:(r)=>r.length>=10 },
  { id:"sub60_10k",    emoji:"⚡", label:"Sub-60 au 10km",   desc:"Finir un 10km en moins d'1h",          color:"#3B82F6", check:(r)=>r.some(x=>x.discipline==="10km"&&x.time<60*60) },
  { id:"sub45_10k",    emoji:"🚀", label:"Sub-45 au 10km",   desc:"Finir un 10km en moins de 45min",     color:"#6366F1", check:(r)=>r.some(x=>x.discipline==="10km"&&x.time<45*60) },
  { id:"sub2h_semi",   emoji:"🏅", label:"Sub-2h semi",      desc:"Finir un semi en moins de 2h",         color:"#22C55E", check:(r)=>r.some(x=>x.discipline==="semi"&&x.time<2*3600) },
  { id:"sub130_semi",  emoji:"🌟", label:"Sub-1h30 semi",    desc:"Finir un semi en moins de 1h30",       color:"#10B981", check:(r)=>r.some(x=>x.discipline==="semi"&&x.time<90*60) },
  { id:"sub4h_mara",   emoji:"🎯", label:"Sub-4h marathon",  desc:"Finir un marathon en moins de 4h",     color:"#F59E0B", check:(r)=>r.some(x=>x.discipline==="marathon"&&x.time<4*3600) },
  { id:"sub3h_mara",   emoji:"👑", label:"Sub-3h marathon",  desc:"Finir un marathon en moins de 3h",     color:"#FFD700", check:(r)=>r.some(x=>x.discipline==="marathon"&&x.time<3*3600) },
  { id:"finisher_im",  emoji:"🦾", label:"Ironman Finisher", desc:"Terminer un Ironman",                   color:"#E63946", check:(r)=>r.some(x=>x.discipline==="tri-xl") },
  { id:"sub10h_im",    emoji:"💎", label:"Sub-10h Ironman",  desc:"Finir un Ironman en moins de 10h",     color:"#A78BFA", check:(r)=>r.some(x=>x.discipline==="tri-xl"&&x.time<10*3600) },
  { id:"finisher_ut",  emoji:"🏔️", label:"Ultra Finisher",   desc:"Terminer un Ultra Trail",               color:"#78716C", check:(r)=>r.some(x=>x.discipline==="trail-xl") },
  { id:"multi_cat",    emoji:"🎪", label:"Touche-à-tout",    desc:"Courir dans 2 catégories différentes",  color:"#EC4899", check:(r)=>new Set(r.map(x=>DISCIPLINES[x.discipline]?.category)).size>=2 },
  { id:"triathlete",   emoji:"🏊", label:"Vrai triathlète",  desc:"Compléter un tri ET une course",        color:"#06B6D4", check:(r)=>r.some(x=>DISCIPLINES[x.discipline]?.category==="triathlon")&&r.some(x=>DISCIPLINES[x.discipline]?.category==="running") },
  { id:"triple_crown", emoji:"🌈", label:"Triple Couronne",  desc:"Course, Trail ET Triathlon",            color:"#F43F5E", check:(r)=>{const c=new Set(r.map(x=>DISCIPLINES[x.discipline]?.category));return c.has("running")&&c.has("trail")&&c.has("triathlon");} },
];

function computeBadges(results) { return BADGES.filter(b => b.check(results)); }

// ─── UTILS ────────────────────────────────────────────────────────────────────
function calcPoints(discipline, t) {
  const d = DISCIPLINES[discipline];
  if (!d) return 0;
  return Math.round(Math.max(1, Math.min(Math.round(1000 * Math.pow(d.refTime / t, 1.06)), 1200)) * d.prestige);
}

function calcTrainingPoints(sport, distanceKm, durationSecs) {
  const s = TRAINING_SPORTS[sport];
  if (!s || !distanceKm || !durationSecs) return 0;
  const speedKmh = distanceKm / (durationSecs / 3600);
  const speedRatio = speedKmh / s.speedRef;
  const load = distanceKm * Math.pow(speedRatio, 0.8);
  return Math.round(Math.min(load * 8, 300));
}

function formatTime(s) {
  const h = Math.floor(s/3600), m = Math.floor((s%3600)/60), ss = s%60;
  return h > 0 ? `${h}h${String(m).padStart(2,"0")}m${String(ss).padStart(2,"0")}s` : `${m}m${String(ss).padStart(2,"0")}s`;
}

function parseTime(str) {
  if (!str) return null;
  const p = str.split(":").map(Number);
  if (p.some(isNaN) || !p.length) return null;
  if (p.length === 3) return p[0]*3600 + p[1]*60 + p[2];
  if (p.length === 2) return p[0]*60 + p[1];
  return p[0]*60;
}

function getLevelLabel(pts) {
  if (pts >= 1000) return { label:"Elite",         color:"#FF4444", bg:"rgba(255,68,68,0.12)" };
  if (pts >= 800)  return { label:"Expert",        color:"#FF8C00", bg:"rgba(255,140,0,0.12)" };
  if (pts >= 550)  return { label:"Confirmé",      color:"#22C55E", bg:"rgba(34,197,94,0.12)" };
  if (pts >= 320)  return { label:"Intermédiaire", color:"#3B82F6", bg:"rgba(59,130,246,0.12)" };
  return                   { label:"Débutant",     color:"#9E9E9E", bg:"rgba(158,158,158,0.1)" };
}

function prestigeLabel(p) {
  if (p >= 1.5)  return { text:"×1.5", color:"#FF4444" };
  if (p >= 1.3)  return { text:"×1.3", color:"#FF8C00" };
  if (p >= 1.2)  return { text:"×1.2", color:"#F59E0B" };
  if (p >= 1.1)  return { text:"×1.1", color:"#22C55E" };
  if (p >= 1.05) return { text:"×1.05", color:"#3B82F6" };
  return                 { text:"×1.0", color:"#666" };
}

const AVATAR_COLORS = ["#E63946","#457B9D","#2A9D8F","#D4A017","#F4A261","#6D6875","#3D405B","#81B29A"];
function avatarColor(s) { return AVATAR_COLORS[((s?.charCodeAt(0)||0)+(s?.charCodeAt(1)||0)) % AVATAR_COLORS.length]; }

function generateGroupCode() {
  return Math.random().toString(36).substring(2,8).toUpperCase();
}

// ─── AVATAR ───────────────────────────────────────────────────────────────────
function Avatar({ initials, size=44, highlight }) {
  return (
    <div style={{
      width:size, height:size, borderRadius:"50%", background:avatarColor(initials),
      display:"flex", alignItems:"center", justifyContent:"center",
      fontFamily:"'Bebas Neue',sans-serif", fontSize:size*0.34, color:"#fff", flexShrink:0,
      border:highlight?"2.5px solid #E63946":"2.5px solid rgba(255,255,255,0.07)",
      boxShadow:highlight?"0 0 18px rgba(230,57,70,0.35)":"none", letterSpacing:1
    }}>{initials}</div>
  );
}

const Lbl = ({ c }) => <div style={{fontSize:10,fontWeight:700,letterSpacing:1.5,textTransform:"uppercase",color:"#555",marginBottom:8,fontFamily:"'Barlow',sans-serif"}}>{c}</div>;

// ─── LOGIN PAGE ───────────────────────────────────────────────────────────────
function LoginPage({ onLogin }) {
  return (
    <div style={{minHeight:"100vh",background:"#0D0D0D",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",padding:24}}>
      <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:52,letterSpacing:3,color:"#F0EDE8",lineHeight:1}}>PACE<span style={{color:"#E63946"}}>RANK</span></div>
      <div style={{color:"#444",fontSize:11,letterSpacing:2.5,textTransform:"uppercase",fontFamily:"'Barlow',sans-serif",marginTop:6,marginBottom:48}}>Course · Trail · Triathlon</div>
      <button onClick={onLogin} style={{display:"flex",alignItems:"center",gap:12,padding:"14px 28px",borderRadius:14,background:"#fff",color:"#333",border:"none",cursor:"pointer",fontFamily:"'Barlow',sans-serif",fontWeight:700,fontSize:16,boxShadow:"0 4px 20px rgba(0,0,0,0.3)"}}>
        <svg width="20" height="20" viewBox="0 0 48 48">
          <path fill="#FFC107" d="M43.611 20.083H42V20H24v8h11.303c-1.649 4.657-6.08 8-11.303 8-6.627 0-12-5.373-12-12s5.373-12 12-12c3.059 0 5.842 1.154 7.961 3.039l5.657-5.657C34.046 6.053 29.268 4 24 4 12.955 4 4 12.955 4 24s8.955 20 20 20 20-8.955 20-20c0-1.341-.138-2.65-.389-3.917z"/>
          <path fill="#FF3D00" d="M6.306 14.691l6.571 4.819C14.655 15.108 18.961 12 24 12c3.059 0 5.842 1.154 7.961 3.039l5.657-5.657C34.046 6.053 29.268 4 24 4 16.318 4 9.656 8.337 6.306 14.691z"/>
          <path fill="#4CAF50" d="M24 44c5.166 0 9.86-1.977 13.409-5.192l-6.19-5.238A11.91 11.91 0 0 1 24 36c-5.202 0-9.619-3.317-11.283-7.946l-6.522 5.025C9.505 39.556 16.227 44 24 44z"/>
          <path fill="#1976D2" d="M43.611 20.083H42V20H24v8h11.303a12.04 12.04 0 0 1-4.087 5.571l.003-.002 6.19 5.238C36.971 39.205 44 34 44 24c0-1.341-.138-2.65-.389-3.917z"/>
        </svg>
        Continuer avec Google
      </button>
    </div>
  );
}

// ─── SETUP PROFILE ────────────────────────────────────────────────────────────
function SetupProfile({ user, onComplete }) {
  const [name, setName] = useState(user.user_metadata?.full_name || "");
  const [city, setCity] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async () => {
    if (!name.trim()) return;
    setLoading(true);
    const initials = name.trim().split(" ").map(n => n[0]).join("").toUpperCase().slice(0, 2);
    const { error } = await supabase.from("profiles").upsert({
      id: user.id, name: name.trim(), avatar: initials, city: city.trim(), created_at: new Date().toISOString()
    });
    if (!error) onComplete({ id: user.id, name: name.trim(), avatar: initials, city: city.trim(), results: [] });
    setLoading(false);
  };

  const inp = { width:"100%", padding:"12px 14px", background:"rgba(255,255,255,0.04)", border:"1.5px solid rgba(255,255,255,0.09)", borderRadius:12, color:"#F0EDE8", fontSize:16, fontFamily:"'Barlow',sans-serif", outline:"none", marginBottom:14 };

  return (
    <div style={{minHeight:"100vh",background:"#0D0D0D",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",padding:24}}>
      <div style={{width:"100%",maxWidth:400}}>
        <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:32,letterSpacing:1,color:"#F0EDE8",marginBottom:8}}>Crée ton profil</div>
        <div style={{color:"#555",fontSize:13,fontFamily:"'Barlow',sans-serif",marginBottom:32}}>Bienvenue sur PaceRank 🎉</div>
        <Lbl c="Ton prénom et nom"/>
        <input value={name} onChange={e=>setName(e.target.value)} placeholder="ex: Philippe Sallenave" style={inp}/>
        <Lbl c="Ta ville (optionnel)"/>
        <input value={city} onChange={e=>setCity(e.target.value)} placeholder="ex: Paris" style={inp}/>
        <button onClick={handleSubmit} disabled={loading||!name.trim()} style={{width:"100%",padding:"14px 0",borderRadius:12,background:"#E63946",color:"#fff",border:"none",cursor:"pointer",fontFamily:"'Bebas Neue',sans-serif",fontSize:18,letterSpacing:1,opacity:loading||!name.trim()?0.5:1}}>
          {loading?"Création...":"C'est parti !"}
        </button>
      </div>
    </div>
  );
}

// ─── EDIT RESULT MODAL ────────────────────────────────────────────────────────
function EditResultModal({ result, onClose, onSave }) {
  const [discipline, setDiscipline] = useState(result.discipline);
  const [timeStr, setTimeStr] = useState(formatTime(result.time).replace(/h/g,":").replace(/m/g,":").replace(/s/g,""));
  const [raceName, setRaceName] = useState(result.race || "");
  const [year, setYear] = useState(result.year);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const inp = { width:"100%", padding:"12px 14px", background:"rgba(255,255,255,0.06)", border:"1.5px solid rgba(255,255,255,0.1)", borderRadius:12, color:"#F0EDE8", fontSize:16, fontFamily:"'Barlow',sans-serif", outline:"none", marginBottom:14 };

  const handleSave = async () => {
    const t = parseTime(timeStr);
    if (!t || t <= 0) { setError("Format invalide. Ex: 42:51 ou 3:10:49"); return; }
    setLoading(true);
    const { error: err } = await supabase.from("results").update({
      discipline, time: t, race: raceName || DISCIPLINES[discipline].label, year
    }).eq("id", result.id);
    if (!err) onSave({ ...result, discipline, time: t, race: raceName || DISCIPLINES[discipline].label, year });
    else setError("Erreur lors de la modification");
    setLoading(false);
  };

  return (
    <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.85)",backdropFilter:"blur(10px)",display:"flex",alignItems:"flex-end",justifyContent:"center",zIndex:300}} onClick={onClose}>
      <div style={{background:"#161616",border:"1px solid rgba(255,255,255,0.09)",borderRadius:"22px 22px 0 0",width:"100%",maxWidth:580,padding:"24px 20px 40px",maxHeight:"90vh",overflowY:"auto"}} onClick={e=>e.stopPropagation()}>
        <div style={{width:40,height:4,background:"rgba(255,255,255,0.15)",borderRadius:2,margin:"0 auto 20px"}}/>
        <h2 style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:26,color:"#F0EDE8",letterSpacing:1,margin:"0 0 20px"}}>Modifier le résultat</h2>

        <Lbl c="Saison"/>
        <div style={{display:"flex",gap:8,marginBottom:18}}>
          {[2024,2025,2026].map(y=>(
            <button key={y} onClick={()=>setYear(y)} style={{flex:1,padding:"10px 0",borderRadius:10,background:year===y?"#E63946":"rgba(255,255,255,0.05)",color:year===y?"#fff":"#555",border:"none",cursor:"pointer",fontFamily:"'Bebas Neue',sans-serif",fontSize:18}}>{y}</button>
          ))}
        </div>

        <Lbl c="Discipline"/>
        <select value={discipline} onChange={e=>setDiscipline(e.target.value)} style={{...inp,cursor:"pointer"}}>
          <optgroup label="🏃 Course à pied">
            {Object.entries(DISCIPLINES).filter(([,v])=>v.category==="running").map(([k,v])=><option key={k} value={k}>{v.label}</option>)}
          </optgroup>
          <optgroup label="⛰️ Trail">
            {Object.entries(DISCIPLINES).filter(([,v])=>v.category==="trail").map(([k,v])=><option key={k} value={k}>{v.label}</option>)}
          </optgroup>
          <optgroup label="🏊 Triathlon">
            {Object.entries(DISCIPLINES).filter(([,v])=>v.category==="triathlon").map(([k,v])=><option key={k} value={k}>{v.label}</option>)}
          </optgroup>
        </select>

        <Lbl c="Nom de la course"/>
        <input value={raceName} onChange={e=>setRaceName(e.target.value)} placeholder="ex: Marathon de Paris" style={inp}/>

        <Lbl c="Temps (hh:mm:ss)"/>
        <input value={timeStr} onChange={e=>{setTimeStr(e.target.value);setError("");}} placeholder="ex: 3:10:49" style={inp}/>
        {error&&<div style={{color:"#E63946",fontSize:12,marginBottom:8}}>{error}</div>}

        <div style={{display:"flex",gap:10,marginTop:8}}>
          <button onClick={onClose} style={{flex:1,padding:"14px 0",borderRadius:12,background:"rgba(255,255,255,0.05)",color:"#555",border:"none",cursor:"pointer",fontFamily:"'Bebas Neue',sans-serif",fontSize:16}}>Annuler</button>
          <button onClick={handleSave} disabled={loading} style={{flex:2,padding:"14px 0",borderRadius:12,background:"#E63946",color:"#fff",border:"none",cursor:"pointer",fontFamily:"'Bebas Neue',sans-serif",fontSize:16,opacity:loading?0.7:1}}>
            {loading?"Sauvegarde...":"Sauvegarder"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── ADD RESULT MODAL ─────────────────────────────────────────────────────────
function AddResultModal({ onClose, onAdd }) {
  const [discipline, setDiscipline] = useState("10km");
  const [timeStr, setTimeStr] = useState("");
  const [raceName, setRaceName] = useState("");
  const [year, setYear] = useState(2026);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const preview = timeStr ? parseTime(timeStr) : null;
  const previewPts = preview ? calcPoints(discipline, preview) : 0;
  const pl = prestigeLabel(DISCIPLINES[discipline]?.prestige || 1);

  const handleSubmit = async () => {
    const t = parseTime(timeStr);
    if (!t || t <= 0) { setError("Sélectionne un temps valide"); return; }
    setLoading(true);
    await onAdd(discipline, t, raceName || DISCIPLINES[discipline].label, year);
    setLoading(false);
    onClose();
  };

  const inp = { width:"100%", padding:"12px 14px", background:"rgba(255,255,255,0.06)", border:"1.5px solid rgba(255,255,255,0.1)", borderRadius:12, color:"#F0EDE8", fontSize:16, fontFamily:"'Barlow',sans-serif", outline:"none" };

  return (
    <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.85)",backdropFilter:"blur(10px)",display:"flex",alignItems:"flex-end",justifyContent:"center",zIndex:300}} onClick={onClose}>
      <div style={{background:"#161616",border:"1px solid rgba(255,255,255,0.09)",borderRadius:"22px 22px 0 0",width:"100%",maxWidth:580,padding:"24px 20px 40px",maxHeight:"90vh",overflowY:"auto"}} onClick={e=>e.stopPropagation()}>
        <div style={{width:40,height:4,background:"rgba(255,255,255,0.15)",borderRadius:2,margin:"0 auto 20px"}}/>
        <h2 style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:26,color:"#F0EDE8",letterSpacing:1,margin:"0 0 20px"}}>Ajouter un résultat</h2>

        <Lbl c="Saison"/>
        <div style={{display:"flex",gap:8,marginBottom:18}}>
          {[2024,2025,2026].map(y=>(
            <button key={y} onClick={()=>setYear(y)} style={{flex:1,padding:"10px 0",borderRadius:10,background:year===y?"#E63946":"rgba(255,255,255,0.05)",color:year===y?"#fff":"#555",border:"none",cursor:"pointer",fontFamily:"'Bebas Neue',sans-serif",fontSize:18,letterSpacing:1}}>{y}</button>
          ))}
        </div>

        <Lbl c="Discipline"/>
        <select value={discipline} onChange={e=>setDiscipline(e.target.value)} style={{...inp,cursor:"pointer",marginBottom:18}}>
          <optgroup label="🏃 Course à pied">
            {Object.entries(DISCIPLINES).filter(([,v])=>v.category==="running").map(([k,v])=><option key={k} value={k}>{v.label} (×{v.prestige})</option>)}
          </optgroup>
          <optgroup label="⛰️ Trail">
            {Object.entries(DISCIPLINES).filter(([,v])=>v.category==="trail").map(([k,v])=><option key={k} value={k}>{v.label} (×{v.prestige})</option>)}
          </optgroup>
          <optgroup label="🏊 Triathlon">
            {Object.entries(DISCIPLINES).filter(([,v])=>v.category==="triathlon").map(([k,v])=><option key={k} value={k}>{v.label} (×{v.prestige})</option>)}
          </optgroup>
        </select>

        <Lbl c="Nom de la course (optionnel)"/>
        <input value={raceName} onChange={e=>setRaceName(e.target.value)} placeholder="ex: Marathon de Paris" style={{...inp,marginBottom:18}}/>

        <Lbl c="Temps"/>
        <TimePicker onChange={(h,m,s)=>{setTimeStr(`${String(h).padStart(2,"0")}:${String(m).padStart(2,"0")}:${String(s).padStart(2,"0")}`);setError("");}}/>
        {error&&<div style={{color:"#E63946",fontSize:12,marginBottom:8,fontFamily:"'Barlow',sans-serif"}}>{error}</div>}

        {preview&&preview>0&&(
          <div style={{marginTop:12,padding:"14px 16px",background:"rgba(230,57,70,0.08)",borderRadius:12,border:"1px solid rgba(230,57,70,0.2)",display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
            <div>
              <div style={{color:"#777",fontSize:11,fontFamily:"'Barlow',sans-serif"}}>Prestige {pl.text}</div>
              <div style={{color:"#555",fontSize:11,fontFamily:"'Barlow',sans-serif"}}>Estimation points</div>
            </div>
            <div style={{color:"#E63946",fontFamily:"'Bebas Neue',sans-serif",fontSize:32,letterSpacing:1}}>{previewPts} pts</div>
          </div>
        )}

        <div style={{display:"flex",gap:10,marginTop:16}}>
          <button onClick={onClose} style={{flex:1,padding:"14px 0",borderRadius:12,background:"rgba(255,255,255,0.05)",color:"#555",border:"none",cursor:"pointer",fontFamily:"'Bebas Neue',sans-serif",fontSize:16,letterSpacing:1}}>Annuler</button>
          <button onClick={handleSubmit} disabled={loading} style={{flex:2,padding:"14px 0",borderRadius:12,background:"#E63946",color:"#fff",border:"none",cursor:"pointer",fontFamily:"'Bebas Neue',sans-serif",fontSize:16,letterSpacing:1,opacity:loading?0.7:1}}>
            {loading?"Ajout...":"Ajouter"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── ADD TRAINING MODAL ───────────────────────────────────────────────────────
function AddTrainingModal({ onClose, onAdd }) {
  const [sport, setSport] = useState("running");
  const [distance, setDistance] = useState("");
  const [timeStr, setTimeStr] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const duration = timeStr ? parseTime(timeStr) : null;
  const dist = parseFloat(distance);
  const preview = duration && dist > 0 ? calcTrainingPoints(sport, dist, duration) : 0;

  const handleSubmit = async () => {
    const t = parseTime(timeStr);
    const d = parseFloat(distance);
    if (!t || t <= 0 || !d || d <= 0) { setError("Remplis tous les champs"); return; }
    setLoading(true);
    await onAdd(sport, d, t, preview);
    setLoading(false);
    onClose();
  };

  const inp = { width:"100%", padding:"12px 14px", background:"rgba(255,255,255,0.06)", border:"1.5px solid rgba(255,255,255,0.1)", borderRadius:12, color:"#F0EDE8", fontSize:16, fontFamily:"'Barlow',sans-serif", outline:"none", marginBottom:14 };

  return (
    <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.85)",backdropFilter:"blur(10px)",display:"flex",alignItems:"flex-end",justifyContent:"center",zIndex:300}} onClick={onClose}>
      <div style={{background:"#161616",border:"1px solid rgba(255,255,255,0.09)",borderRadius:"22px 22px 0 0",width:"100%",maxWidth:580,padding:"24px 20px 40px",maxHeight:"90vh",overflowY:"auto"}} onClick={e=>e.stopPropagation()}>
        <div style={{width:40,height:4,background:"rgba(255,255,255,0.15)",borderRadius:2,margin:"0 auto 20px"}}/>
        <h2 style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:26,color:"#F0EDE8",letterSpacing:1,margin:"0 0 20px"}}>Ajouter un entraînement</h2>

        <Lbl c="Sport"/>
        <div style={{display:"flex",gap:8,marginBottom:18}}>
          {Object.entries(TRAINING_SPORTS).map(([k,v])=>(
            <button key={k} onClick={()=>setSport(k)} style={{flex:1,padding:"10px 0",borderRadius:10,background:sport===k?"rgba(230,57,70,0.2)":"rgba(255,255,255,0.05)",color:sport===k?"#E63946":"#555",border:sport===k?"1px solid rgba(230,57,70,0.4)":"1px solid transparent",cursor:"pointer",fontFamily:"'Barlow',sans-serif",fontSize:13,fontWeight:700}}>
              {v.icon} {v.label}
            </button>
          ))}
        </div>

        <Lbl c={`Distance (${TRAINING_SPORTS[sport].unit})`}/>
        <input value={distance} onChange={e=>setDistance(e.target.value)} placeholder="ex: 10" type="number" style={inp}/>

        <Lbl c="Durée"/>
        <TimePicker onChange={(h,m,s)=>{setTimeStr(`${String(h).padStart(2,"0")}:${String(m).padStart(2,"0")}:${String(s).padStart(2,"0")}`);setError("");}}/>

        {error&&<div style={{color:"#E63946",fontSize:12,marginBottom:8}}>{error}</div>}

        {preview > 0 && (
          <div style={{marginTop:12,padding:"14px 16px",background:"rgba(34,197,94,0.08)",borderRadius:12,border:"1px solid rgba(34,197,94,0.2)",display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
            <div style={{color:"#777",fontSize:12,fontFamily:"'Barlow',sans-serif"}}>Points entraînement (×0.2 vs course)</div>
            <div style={{color:"#22C55E",fontFamily:"'Bebas Neue',sans-serif",fontSize:28}}>{preview} pts</div>
          </div>
        )}

        <div style={{display:"flex",gap:10,marginTop:16}}>
          <button onClick={onClose} style={{flex:1,padding:"14px 0",borderRadius:12,background:"rgba(255,255,255,0.05)",color:"#555",border:"none",cursor:"pointer",fontFamily:"'Bebas Neue',sans-serif",fontSize:16}}>Annuler</button>
          <button onClick={handleSubmit} disabled={loading} style={{flex:2,padding:"14px 0",borderRadius:12,background:"#22C55E",color:"#fff",border:"none",cursor:"pointer",fontFamily:"'Bebas Neue',sans-serif",fontSize:16,opacity:loading?0.7:1}}>
            {loading?"Ajout...":"Ajouter"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── PROFILE TAB ──────────────────────────────────────────────────────────────
function ProfileTab({ profile, onDelete, onEdit, onFriendAction }) {
  const [subTab, setSubTab] = useState("perf");
  const [perfTab, setPerfTab] = useState("history");
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState([]);
  const [friends, setFriends] = useState([]);
  const [groups, setGroups] = useState([]);
  const [showCreateGroup, setShowCreateGroup] = useState(false);
  const [showJoinGroup, setShowJoinGroup] = useState(false);
  const [groupName, setGroupName] = useState("");
  const [groupCode, setGroupCode] = useState("");
  const [loadingAction, setLoadingAction] = useState(false);

  const badges = computeBadges(profile.results);
  const earnedIds = new Set(badges.map(b => b.id));

  useEffect(() => {
    loadFriends();
    loadGroups();
  }, []);

  const loadFriends = async () => {
    const { data } = await supabase
      .from("friendships")
      .select("*, friend:profiles!friendships_friend_id_fkey(id,name,avatar,city)")
      .eq("user_id", profile.id)
      .eq("status", "accepted");
    setFriends(data || []);
  };

  const loadGroups = async () => {
    const { data } = await supabase
      .from("group_members")
      .select("*, group:groups(*)")
      .eq("user_id", profile.id);
    setGroups(data?.map(d => d.group) || []);
  };

  const handleSearch = async (q) => {
    setSearchQuery(q);
    if (q.length < 2) { setSearchResults([]); return; }
    const { data } = await supabase
      .from("profiles")
      .select("id,name,avatar,city")
      .ilike("name", `%${q}%`)
      .neq("id", profile.id)
      .limit(5);
    setSearchResults(data || []);
  };

  const handleAddFriend = async (friendId) => {
    setLoadingAction(true);
    await supabase.from("friendships").insert({ user_id: profile.id, friend_id: friendId, status: "accepted" });
    await loadFriends();
    setSearchResults([]);
    setSearchQuery("");
    setLoadingAction(false);
  };

  const handleCreateGroup = async () => {
    if (!groupName.trim()) return;
    setLoadingAction(true);
    const code = generateGroupCode();
    const { data } = await supabase.from("groups").insert({ name: groupName.trim(), code, created_by: profile.id }).select().single();
    if (data) {
      await supabase.from("group_members").insert({ group_id: data.id, user_id: profile.id });
      await loadGroups();
    }
    setGroupName("");
    setShowCreateGroup(false);
    setLoadingAction(false);
  };

  const handleJoinGroup = async () => {
    if (!groupCode.trim()) return;
    setLoadingAction(true);
    const { data: group } = await supabase.from("groups").select("*").eq("code", groupCode.toUpperCase()).single();
    if (group) {
      await supabase.from("group_members").insert({ group_id: group.id, user_id: profile.id });
      await loadGroups();
    }
    setGroupCode("");
    setShowJoinGroup(false);
    setLoadingAction(false);
  };

  // Build byYear for history
  const byYear = {};
  [...profile.results].sort((a,b) => b.year - a.year).forEach(r => {
    if (!byYear[r.year]) byYear[r.year] = [];
    byYear[r.year].push(r);
  });

  // Build byDisc for PR
  const byDisc = {};
  profile.results.forEach(r => {
    if (!byDisc[r.discipline] || r.time < byDisc[r.discipline].time) byDisc[r.discipline] = r;
  });
  const bests = Object.entries(byDisc).sort((a,b) => {
    const cats = ["running","trail","triathlon"];
    return cats.indexOf(DISCIPLINES[a[0]]?.category) - cats.indexOf(DISCIPLINES[b[0]]?.category);
  });

  // Progression data: points by year
  const ptsByYear = {};
  profile.results.forEach(r => {
    if (!ptsByYear[r.year]) ptsByYear[r.year] = 0;
    ptsByYear[r.year] += calcPoints(r.discipline, r.time);
  });

  const inp = { width:"100%", padding:"10px 14px", background:"rgba(255,255,255,0.05)", border:"1px solid rgba(255,255,255,0.1)", borderRadius:10, color:"#F0EDE8", fontSize:14, fontFamily:"'Barlow',sans-serif", outline:"none" };

  return (
    <div style={{padding:"16px"}}>
      {/* Main sub tabs */}
      <div style={{display:"flex",gap:6,marginBottom:16,flexWrap:"wrap"}}>
        {[["perf","⚡ Perf"],["friends",`👥 Amis (${friends.length})`],["badges",`🏅 Badges (${badges.length})`]].map(([v,l])=>(
          <button key={v} onClick={()=>setSubTab(v)} style={{padding:"7px 14px",borderRadius:14,background:subTab===v?"rgba(230,57,70,0.12)":"rgba(255,255,255,0.04)",color:subTab===v?"#E63946":"#555",border:subTab===v?"1px solid rgba(230,57,70,0.3)":"1px solid rgba(255,255,255,0.07)",cursor:"pointer",fontSize:11,fontWeight:700,fontFamily:"'Barlow',sans-serif"}}>{l}</button>
        ))}
      </div>

      {/* ── PERF TAB ── */}
      {subTab==="perf"&&(
        <div>
          <div style={{display:"flex",gap:6,marginBottom:14}}>
            {[["history","📅 Historique"],["pr","🏆 PR"],["progression","📈 Progression"]].map(([v,l])=>(
              <button key={v} onClick={()=>setPerfTab(v)} style={{padding:"5px 12px",borderRadius:10,background:perfTab===v?"rgba(230,57,70,0.1)":"transparent",color:perfTab===v?"#E63946":"#444",border:perfTab===v?"1px solid rgba(230,57,70,0.25)":"1px solid rgba(255,255,255,0.06)",cursor:"pointer",fontSize:11,fontWeight:600,fontFamily:"'Barlow',sans-serif"}}>{l}</button>
            ))}
          </div>

          {/* History */}
          {perfTab==="history"&&(
            <div style={{display:"flex",flexDirection:"column",gap:16}}>
              {Object.keys(byYear).length===0&&<div style={{textAlign:"center",color:"#333",padding:"30px 0",fontFamily:"'Barlow',sans-serif",fontSize:13}}>Aucun résultat — ajoute ta première course !</div>}
              {Object.entries(byYear).sort((a,b)=>b[0]-a[0]).map(([year,races])=>(
                <div key={year}>
                  <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:14,letterSpacing:2,color:"#E63946",marginBottom:8}}>— {year} —</div>
                  <div style={{display:"flex",flexDirection:"column",gap:6}}>
                    {races.map((r,i)=>{
                      const pts = calcPoints(r.discipline, r.time);
                      const lv = getLevelLabel(pts);
                      const allForDisc = profile.results.filter(x=>x.discipline===r.discipline).sort((a,b)=>a.time-b.time);
                      const isPR = allForDisc[0]?.time===r.time;
                      return(
                        <div key={r.id||i}>
                          <div style={{display:"flex",alignItems:"center",gap:10,padding:"11px 14px",background:"rgba(255,255,255,0.025)",borderRadius:12,border:isPR?"1px solid rgba(255,215,0,0.2)":"1px solid rgba(255,255,255,0.04)"}}>
                            <span style={{fontSize:16}}>{DISCIPLINES[r.discipline]?.icon}</span>
                            <div style={{flex:1,minWidth:0}}>
                              <div style={{display:"flex",alignItems:"center",gap:6}}>
                                <span style={{color:"#F0EDE8",fontSize:13,fontFamily:"'Barlow',sans-serif",fontWeight:600}}>{r.race}</span>
                                {isPR&&<span style={{fontSize:9,color:"#FFD700",fontWeight:700,letterSpacing:1,fontFamily:"'Barlow',sans-serif"}}>PR</span>}
                              </div>
                              <div style={{color:"#555",fontSize:11,marginTop:1}}>{DISCIPLINES[r.discipline]?.label} · {formatTime(r.time)}</div>
                            </div>
                            <div style={{textAlign:"right",flexShrink:0}}>
                              <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:18,color:lv.color}}>{pts} pts</div>
                            </div>
                          </div>
                          {/* Action buttons */}
                          <div style={{display:"flex",gap:6,marginTop:4,marginBottom:4}}>
                            <button onClick={()=>onEdit(r)} style={{flex:1,padding:"6px",borderRadius:8,background:"rgba(255,255,255,0.05)",border:"1px solid rgba(255,255,255,0.1)",color:"#888",fontSize:11,cursor:"pointer",fontFamily:"'Barlow',sans-serif"}}>✏️ Modifier</button>
                            <button onClick={()=>{ if(window.confirm("Supprimer cette course ?")) onDelete(r.id); }} style={{flex:1,padding:"6px",borderRadius:8,background:"rgba(230,57,70,0.08)",border:"1px solid rgba(230,57,70,0.2)",color:"#E63946",fontSize:11,cursor:"pointer",fontFamily:"'Barlow',sans-serif"}}>🗑️ Supprimer</button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* PR */}
          {perfTab==="pr"&&(
            <div style={{display:"flex",flexDirection:"column",gap:8}}>
              {bests.length===0&&<div style={{textAlign:"center",color:"#333",padding:"30px 0",fontFamily:"'Barlow',sans-serif",fontSize:13}}>Aucun résultat</div>}
              {bests.map(([disc,r])=>{
                const pts = calcPoints(disc, r.time);
                const lv = getLevelLabel(pts);
                const pl = prestigeLabel(DISCIPLINES[disc]?.prestige || 1);
                return(
                  <div key={disc} style={{background:"rgba(255,255,255,0.03)",borderRadius:14,padding:"14px 16px",border:"1px solid rgba(255,215,0,0.15)"}}>
                    <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                      <div style={{flex:1}}>
                        <div style={{display:"flex",alignItems:"center",gap:8,flexWrap:"wrap"}}>
                          <span style={{fontSize:18}}>{DISCIPLINES[disc]?.icon}</span>
                          <span style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:17,color:"#F0EDE8"}}>{DISCIPLINES[disc]?.label}</span>
                          <span style={{fontSize:9,fontWeight:700,color:lv.color,background:lv.bg,borderRadius:10,padding:"2px 8px",fontFamily:"'Barlow',sans-serif"}}>{lv.label}</span>
                          <span style={{fontSize:9,color:pl.color,fontWeight:700,fontFamily:"'Barlow',sans-serif"}}>{pl.text}</span>
                        </div>
                        <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:24,color:"#FFD700",marginTop:4}}>{formatTime(r.time)}</div>
                        <div style={{fontSize:11,color:"#444",fontFamily:"'Barlow',sans-serif",marginTop:2}}>{r.race} · {r.year}</div>
                      </div>
                      <div style={{textAlign:"right",flexShrink:0,marginLeft:12}}>
                        <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:28,color:lv.color}}>{pts}</div>
                        <div style={{fontSize:9,color:"#444",letterSpacing:1,textTransform:"uppercase"}}>pts</div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Progression */}
          {perfTab==="progression"&&(
            <div>
              <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:14,letterSpacing:2,color:"#555",marginBottom:12}}>Points par saison</div>
              {Object.entries(ptsByYear).sort((a,b)=>a[0]-b[0]).map(([year,pts])=>{
                const max = Math.max(...Object.values(ptsByYear));
                const pct = max > 0 ? (pts/max)*100 : 0;
                return(
                  <div key={year} style={{marginBottom:12}}>
                    <div style={{display:"flex",justifyContent:"space-between",marginBottom:4}}>
                      <span style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:16,color:"#F0EDE8"}}>{year}</span>
                      <span style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:16,color:"#E63946"}}>{pts} pts</span>
                    </div>
                    <div style={{height:8,background:"rgba(255,255,255,0.06)",borderRadius:4,overflow:"hidden"}}>
                      <div style={{height:"100%",width:`${pct}%`,background:"#E63946",borderRadius:4,transition:"width 0.5s ease"}}/>
                    </div>
                  </div>
                );
              })}

              <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:14,letterSpacing:2,color:"#555",marginBottom:12,marginTop:24}}>Évolution des temps</div>
              {Object.keys(byDisc).map(disc=>{
                const timesByYear = {};
                profile.results.filter(r=>r.discipline===disc).forEach(r=>{
                  if(!timesByYear[r.year]||r.time<timesByYear[r.year]) timesByYear[r.year]=r.time;
                });
                if(Object.keys(timesByYear).length<1) return null;
                return(
                  <div key={disc} style={{marginBottom:16,padding:"12px 14px",background:"rgba(255,255,255,0.02)",borderRadius:12,border:"1px solid rgba(255,255,255,0.04)"}}>
                    <div style={{display:"flex",alignItems:"center",gap:6,marginBottom:8}}>
                      <span>{DISCIPLINES[disc]?.icon}</span>
                      <span style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:14,color:"#F0EDE8"}}>{DISCIPLINES[disc]?.label}</span>
                    </div>
                    {Object.entries(timesByYear).sort((a,b)=>a[0]-b[0]).map(([year,time])=>(
                      <div key={year} style={{display:"flex",justifyContent:"space-between",padding:"4px 0",borderBottom:"1px solid rgba(255,255,255,0.03)"}}>
                        <span style={{color:"#555",fontSize:12,fontFamily:"'Barlow',sans-serif"}}>{year}</span>
                        <span style={{color:"#F0EDE8",fontSize:12,fontFamily:"'Bebas Neue',sans-serif"}}>{formatTime(time)}</span>
                      </div>
                    ))}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ── FRIENDS TAB ── */}
      {subTab==="friends"&&(
        <div>
          {/* Search */}
          <div style={{marginBottom:16}}>
            <input
              value={searchQuery}
              onChange={e=>handleSearch(e.target.value)}
              placeholder="🔍 Rechercher un ami par nom..."
              style={{...inp,marginBottom:searchResults.length>0?8:0}}
            />
            {searchResults.map(u=>(
              <div key={u.id} style={{display:"flex",alignItems:"center",gap:10,padding:"10px 12px",background:"rgba(255,255,255,0.03)",borderRadius:10,marginBottom:4}}>
                <Avatar initials={u.avatar} size={36}/>
                <div style={{flex:1}}>
                  <div style={{color:"#F0EDE8",fontSize:13,fontFamily:"'Barlow',sans-serif",fontWeight:600}}>{u.name}</div>
                  {u.city&&<div style={{color:"#555",fontSize:11}}>{u.city}</div>}
                </div>
                <button onClick={()=>handleAddFriend(u.id)} disabled={loadingAction} style={{padding:"6px 12px",borderRadius:8,background:"#E63946",color:"#fff",border:"none",cursor:"pointer",fontSize:12,fontFamily:"'Barlow',sans-serif",fontWeight:700}}>
                  + Ajouter
                </button>
              </div>
            ))}
          </div>

          {/* Friends list */}
          <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:14,letterSpacing:2,color:"#555",marginBottom:10}}>{friends.length} ami{friends.length>1?"s":""}</div>
          {friends.length===0&&<div style={{color:"#333",fontSize:13,fontFamily:"'Barlow',sans-serif",textAlign:"center",padding:"16px 0"}}>Aucun ami pour l'instant — recherche des amis ci-dessus !</div>}
          <div style={{display:"flex",flexDirection:"column",gap:6,marginBottom:20}}>
            {friends.map(f=>(
              <div key={f.id} style={{display:"flex",alignItems:"center",gap:10,padding:"10px 12px",background:"rgba(255,255,255,0.03)",borderRadius:12,border:"1px solid rgba(255,255,255,0.04)"}}>
                <Avatar initials={f.friend?.avatar} size={38}/>
                <div style={{flex:1}}>
                  <div style={{color:"#F0EDE8",fontSize:13,fontFamily:"'Barlow',sans-serif",fontWeight:600}}>{f.friend?.name}</div>
                  {f.friend?.city&&<div style={{color:"#555",fontSize:11}}>{f.friend.city}</div>}
                </div>
              </div>
            ))}
          </div>

          {/* Groups */}
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}>
            <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:14,letterSpacing:2,color:"#555"}}>Mes groupes</div>
            <div style={{display:"flex",gap:6}}>
              <button onClick={()=>setShowJoinGroup(!showJoinGroup)} style={{padding:"5px 10px",borderRadius:8,background:"rgba(255,255,255,0.05)",border:"1px solid rgba(255,255,255,0.1)",color:"#888",fontSize:11,cursor:"pointer",fontFamily:"'Barlow',sans-serif"}}>Rejoindre</button>
              <button onClick={()=>setShowCreateGroup(!showCreateGroup)} style={{padding:"5px 10px",borderRadius:8,background:"rgba(230,57,70,0.12)",border:"1px solid rgba(230,57,70,0.3)",color:"#E63946",fontSize:11,cursor:"pointer",fontFamily:"'Barlow',sans-serif"}}>+ Créer</button>
            </div>
          </div>

          {showCreateGroup&&(
            <div style={{padding:"12px",background:"rgba(255,255,255,0.03)",borderRadius:12,border:"1px solid rgba(255,255,255,0.06)",marginBottom:10}}>
              <input value={groupName} onChange={e=>setGroupName(e.target.value)} placeholder="Nom du groupe" style={{...inp,marginBottom:8}}/>
              <button onClick={handleCreateGroup} disabled={loadingAction||!groupName.trim()} style={{width:"100%",padding:"10px",borderRadius:10,background:"#E63946",color:"#fff",border:"none",cursor:"pointer",fontFamily:"'Bebas Neue',sans-serif",fontSize:15}}>Créer le groupe</button>
            </div>
          )}

          {showJoinGroup&&(
            <div style={{padding:"12px",background:"rgba(255,255,255,0.03)",borderRadius:12,border:"1px solid rgba(255,255,255,0.06)",marginBottom:10}}>
              <input value={groupCode} onChange={e=>setGroupCode(e.target.value)} placeholder="Code du groupe (ex: ABC123)" style={{...inp,marginBottom:8}}/>
              <button onClick={handleJoinGroup} disabled={loadingAction||!groupCode.trim()} style={{width:"100%",padding:"10px",borderRadius:10,background:"#3B82F6",color:"#fff",border:"none",cursor:"pointer",fontFamily:"'Bebas Neue',sans-serif",fontSize:15}}>Rejoindre</button>
            </div>
          )}

          {groups.length===0&&<div style={{color:"#333",fontSize:13,fontFamily:"'Barlow',sans-serif",textAlign:"center",padding:"10px 0"}}>Aucun groupe — crée ou rejoins un groupe !</div>}
          {groups.map(g=>(
            <div key={g.id} style={{display:"flex",alignItems:"center",gap:10,padding:"12px 14px",background:"rgba(255,255,255,0.03)",borderRadius:12,border:"1px solid rgba(255,255,255,0.04)",marginBottom:6}}>
              <div style={{width:36,height:36,borderRadius:10,background:"rgba(230,57,70,0.15)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:18}}>👥</div>
              <div style={{flex:1}}>
                <div style={{color:"#F0EDE8",fontSize:13,fontFamily:"'Barlow',sans-serif",fontWeight:600}}>{g.name}</div>
                <div style={{color:"#555",fontSize:11,fontFamily:"'Barlow',sans-serif"}}>Code: {g.code}</div>
              </div>
              <button onClick={()=>navigator.clipboard?.writeText(g.code)} style={{padding:"5px 10px",borderRadius:8,background:"rgba(255,255,255,0.05)",border:"1px solid rgba(255,255,255,0.08)",color:"#888",fontSize:11,cursor:"pointer"}}>📋 Copier</button>
            </div>
          ))}
        </div>
      )}

      {/* ── BADGES TAB ── */}
      {subTab==="badges"&&(
        <div style={{display:"flex",flexDirection:"column",gap:6}}>
          {BADGES.map(badge=>{
            const unlocked = earnedIds.has(badge.id);
            return(
              <div key={badge.id} style={{display:"flex",alignItems:"center",gap:12,padding:"11px 14px",background:unlocked?`${badge.color}0f`:"rgba(255,255,255,0.02)",borderRadius:12,border:unlocked?`1px solid ${badge.color}33`:"1px solid rgba(255,255,255,0.04)",opacity:unlocked?1:0.4}}>
                <div style={{width:36,height:36,borderRadius:"50%",flexShrink:0,background:unlocked?`${badge.color}22`:"rgba(255,255,255,0.04)",border:unlocked?`1.5px solid ${badge.color}55`:"1.5px solid rgba(255,255,255,0.08)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:17,filter:unlocked?"none":"grayscale(1)"}}>{badge.emoji}</div>
                <div style={{flex:1}}>
                  <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:15,letterSpacing:0.8,color:unlocked?badge.color:"#444"}}>{badge.label}</div>
                  <div style={{fontSize:10,color:unlocked?"#555":"#2a2a2a",fontFamily:"'Barlow',sans-serif",marginTop:1}}>{badge.desc}</div>
                </div>
                {unlocked&&<span style={{fontSize:16}}>✓</span>}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── RANKING TAB ──────────────────────────────────────────────────────────────
function RankingTab({ profile, allProfiles }) {
  const [season, setSeason] = useState(2026);
  const [filterCat, setFilterCat] = useState("all");
  const [rankView, setRankView] = useState("global");

  const seasonResults = profile.results.filter(r => r.year === season);
  const totalPts = seasonResults.reduce((a, r) => a + calcPoints(r.discipline, r.time), 0);
  const bestSingle = seasonResults.length ? Math.max(...seasonResults.map(r => calcPoints(r.discipline, r.time))) : 0;
  const lv = getLevelLabel(bestSingle);

  const filteredResults = filterCat === "all" ? seasonResults : seasonResults.filter(r => DISCIPLINES[r.discipline]?.category === filterCat);

  return (
    <div style={{padding:"16px"}}>
      {/* Season selector */}
      <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:14}}>
        {[2024,2025,2026].map(y=>(
          <button key={y} onClick={()=>setSeason(y)} style={{padding:"6px 16px",borderRadius:20,background:season===y?"#E63946":"rgba(255,255,255,0.04)",color:season===y?"#fff":"#444",border:season===y?"none":"1px solid rgba(255,255,255,0.07)",cursor:"pointer",fontFamily:"'Bebas Neue',sans-serif",fontSize:16,letterSpacing:1}}>{y}</button>
        ))}
        <div style={{marginLeft:"auto",display:"flex",alignItems:"center",gap:5}}>
          <div style={{width:6,height:6,borderRadius:"50%",background:"#22C55E",boxShadow:"0 0 8px #22C55E"}}/>
          <span style={{color:"#22C55E",fontSize:10,fontFamily:"'Barlow',sans-serif",letterSpacing:1.5,textTransform:"uppercase"}}>En cours</span>
        </div>
      </div>

      {/* Category filter */}
      <div style={{display:"flex",gap:6,flexWrap:"wrap",marginBottom:16}}>
        {[["all","Tout"],["running","🏃 Course"],["trail","⛰️ Trail"],["triathlon","🏊 Tri"]].map(([v,l])=>(
          <button key={v} onClick={()=>setFilterCat(v)} style={{padding:"5px 12px",borderRadius:16,background:filterCat===v?"rgba(230,57,70,0.12)":"transparent",color:filterCat===v?"#E63946":"#444",border:filterCat===v?"1px solid rgba(230,57,70,0.3)":"1px solid rgba(255,255,255,0.06)",cursor:"pointer",fontSize:11,fontWeight:600,fontFamily:"'Barlow',sans-serif"}}>{l}</button>
        ))}
      </div>

      {/* My season card */}
      <div style={{background:"linear-gradient(135deg,rgba(230,57,70,0.15),rgba(230,57,70,0.05))",border:"1.5px solid rgba(230,57,70,0.3)",borderRadius:16,padding:"16px 18px",marginBottom:16}}>
        <div style={{display:"flex",alignItems:"center",gap:12}}>
          <Avatar initials={profile.avatar} size={48} highlight/>
          <div style={{flex:1}}>
            <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:20,letterSpacing:1,color:"#E63946"}}>{profile.name}</div>
            <div style={{display:"flex",alignItems:"center",gap:8,marginTop:3}}>
              {bestSingle>0&&<span style={{fontSize:10,fontWeight:700,letterSpacing:1.2,textTransform:"uppercase",color:lv.color,background:lv.bg,borderRadius:20,padding:"2px 9px",fontFamily:"'Barlow',sans-serif"}}>{lv.label}</span>}
              <span style={{fontSize:11,color:"#444",fontFamily:"'Barlow',sans-serif"}}>{seasonResults.length} course{seasonResults.length>1?"s":""} en {season}</span>
            </div>
          </div>
          <div style={{textAlign:"right"}}>
            <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:34,letterSpacing:1,color:"#E63946",lineHeight:1}}>{totalPts}</div>
            <div style={{fontSize:9,color:"rgba(230,57,70,0.6)",letterSpacing:1.5,textTransform:"uppercase",fontFamily:"'Barlow',sans-serif"}}>pts saison</div>
          </div>
        </div>
      </div>

      {/* Results list */}
      <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:16,letterSpacing:1,color:"#555",marginBottom:10}}>Mes résultats {season}</div>
      <div style={{display:"flex",flexDirection:"column",gap:8}}>
        {filteredResults.length===0&&(
          <div style={{textAlign:"center",color:"#333",padding:"30px 0",fontFamily:"'Barlow',sans-serif",fontSize:13}}>
            {seasonResults.length===0?"Aucun résultat en "+season+" — ajoute ta première course !":"Aucun résultat pour cette catégorie en "+season}
          </div>
        )}
        {filteredResults.sort((a,b)=>calcPoints(b.discipline,b.time)-calcPoints(a.discipline,a.time)).map((r,i)=>{
          const pts = calcPoints(r.discipline, r.time);
          const lv2 = getLevelLabel(pts);
          return(
            <div key={i} style={{display:"flex",alignItems:"center",gap:12,padding:"13px 16px",background:"rgba(255,255,255,0.03)",borderRadius:14,border:"1px solid rgba(255,255,255,0.05)"}}>
              <div style={{width:28,display:"flex",justifyContent:"center",flexShrink:0}}>
                <span style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:16,color:"#444"}}>#{i+1}</span>
              </div>
              <span style={{fontSize:20}}>{DISCIPLINES[r.discipline]?.icon}</span>
              <div style={{flex:1,minWidth:0}}>
                <div style={{fontFamily:"'Barlow',sans-serif",fontWeight:700,fontSize:13,color:"#F0EDE8"}}>{r.race}</div>
                <div style={{fontSize:11,color:"#555",marginTop:1}}>{DISCIPLINES[r.discipline]?.label} · {formatTime(r.time)}</div>
              </div>
              <div style={{textAlign:"right",flexShrink:0}}>
                <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:22,letterSpacing:1,color:lv2.color}}>{pts}</div>
                <div style={{fontSize:9,color:"#444",letterSpacing:1,textTransform:"uppercase"}}>pts</div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Invite friends banner */}
      <div style={{marginTop:20,padding:"16px 18px",background:"rgba(255,255,255,0.02)",borderRadius:14,border:"1px solid rgba(255,255,255,0.05)",textAlign:"center"}}>
        <div style={{fontSize:20,marginBottom:8}}>👥</div>
        <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:18,letterSpacing:1,color:"#F0EDE8",marginBottom:6}}>Invite tes amis !</div>
        <div style={{fontSize:12,color:"#444",fontFamily:"'Barlow',sans-serif",marginBottom:12}}>Les classements seront plus fun quand tes amis auront rejoint PaceRank</div>
        <button onClick={()=>navigator.share?navigator.share({title:"PaceRank",text:"Rejoins-moi sur PaceRank !",url:"https://pacerank.vercel.app"}):navigator.clipboard?.writeText("https://pacerank.vercel.app")} style={{padding:"10px 20px",borderRadius:12,background:"#E63946",color:"#fff",border:"none",cursor:"pointer",fontFamily:"'Bebas Neue',sans-serif",fontSize:15,letterSpacing:1}}>
          Partager PaceRank
        </button>
      </div>
    </div>
  );
}

// ─── MAIN APP ─────────────────────────────────────────────────────────────────
export default function App() {
  const [session, setSession] = useState(null);
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [showTrainingModal, setShowTrainingModal] = useState(false);
  const [showAddMenu, setShowAddMenu] = useState(false);
  const [activeTab, setActiveTab] = useState("ranking");
  const [editResult, setEditResult] = useState(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      if (session) loadProfile(session.user.id);
      else setLoading(false);
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_, session) => {
      setSession(session);
      if (session) loadProfile(session.user.id);
      else { setProfile(null); setLoading(false); }
    });
    return () => subscription.unsubscribe();
  }, []);

  const loadProfile = async (userId) => {
    const { data } = await supabase.from("profiles").select("*").eq("id", userId).single();
    if (data) {
      const { data: results } = await supabase.from("results").select("*").eq("user_id", userId).order("year", { ascending: false });
      setProfile({ ...data, results: results || [], isMe: true });
    }
    setLoading(false);
  };

  const handleLogin = async () => {
    await supabase.auth.signInWithOAuth({ provider: "google", options: { redirectTo: window.location.origin } });
  };

  const handleLogout = async () => { await supabase.auth.signOut(); };

  const handleDelete = async (id) => {
    const { error } = await supabase.from("results").delete().eq("id", id);
    if (!error) setProfile(p => ({ ...p, results: p.results.filter(r => r.id !== id) }));
  };

  const handleEdit = (result) => { setEditResult(result); };

  const handleSaveEdit = (updated) => {
    setProfile(p => ({ ...p, results: p.results.map(r => r.id === updated.id ? updated : r) }));
    setEditResult(null);
  };

  const handleAddResult = async (discipline, time, race, year) => {
    if (!profile) return;
    const { data, error } = await supabase.from("results").insert({ user_id: profile.id, discipline, time, race, year }).select().single();
    if (!error && data) setProfile(p => ({ ...p, results: [data, ...p.results] }));
  };

  const handleAddTraining = async (sport, distance, duration, points) => {
    if (!profile) return;
    await supabase.from("trainings").insert({ user_id: profile.id, sport, distance, duration, points });
  };

  if (loading) return (
    <div style={{minHeight:"100vh",background:"#0D0D0D",display:"flex",alignItems:"center",justifyContent:"center"}}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=Bebas+Neue&display=swap');*{box-sizing:border-box;margin:0;padding:0;}body{background:#0D0D0D;}`}</style>
      <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:32,letterSpacing:2,color:"#E63946"}}>PACERANK</div>
    </div>
  );

  if (!session) return <LoginPage onLogin={handleLogin}/>;
  if (!profile) return <SetupProfile user={session.user} onComplete={p=>setProfile({...p,results:[]})} />;

  const totalPts = profile.results.reduce((a,r) => a + calcPoints(r.discipline, r.time), 0);
  const myBadges = computeBadges(profile.results);

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Bebas+Neue&family=Barlow:wght@400;500;600;700&display=swap');
        *{box-sizing:border-box;margin:0;padding:0;}
        body{background:#0D0D0D;}
        select option,optgroup{background:#1A1A1A;color:#F0EDE8;}
        ::-webkit-scrollbar{width:3px;}
        ::-webkit-scrollbar-thumb{background:#222;border-radius:4px;}
      `}</style>

      <div style={{minHeight:"100vh",background:"#0D0D0D",maxWidth:580,margin:"0 auto",paddingBottom:100}}>

        {/* HEADER */}
        <div style={{padding:"28px 20px 16px",background:"linear-gradient(180deg,rgba(230,57,70,0.07) 0%,transparent 100%)",borderBottom:"1px solid rgba(255,255,255,0.04)"}}>
          <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:16}}>
            <div>
              <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:40,letterSpacing:2,color:"#F0EDE8",lineHeight:1}}>PACE<span style={{color:"#E63946"}}>RANK</span></div>
              <div style={{color:"#333",fontSize:10,letterSpacing:2.5,textTransform:"uppercase",fontFamily:"'Barlow',sans-serif",marginTop:3}}>Course · Trail · Triathlon</div>
            </div>
            <button onClick={handleLogout} style={{padding:"8px 16px",borderRadius:10,background:"rgba(255,255,255,0.05)",color:"#555",border:"1px solid rgba(255,255,255,0.08)",cursor:"pointer",fontFamily:"'Barlow',sans-serif",fontSize:12,fontWeight:600}}>Déconnexion</button>
          </div>

          {/* MY CARD */}
          <div style={{padding:"14px 16px",background:"linear-gradient(135deg,rgba(230,57,70,0.15),rgba(230,57,70,0.05))",border:"1.5px solid rgba(230,57,70,0.25)",borderRadius:16,marginBottom:16}}>
            <div style={{display:"flex",alignItems:"center",gap:12}}>
              <Avatar initials={profile.avatar} size={48} highlight/>
              <div style={{flex:1,minWidth:0}}>
                <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:20,letterSpacing:1,color:"#F0EDE8",lineHeight:1}}>{profile.name}</div>
                <div style={{display:"flex",alignItems:"center",gap:6,marginTop:4,flexWrap:"wrap"}}>
                  {myBadges.slice(0,4).map(b=><span key={b.id} style={{fontSize:14}}>{b.emoji}</span>)}
                  {myBadges.length>4&&<span style={{fontSize:10,color:"#555"}}>+{myBadges.length-4}</span>}
                </div>
              </div>
              <div style={{textAlign:"right",flexShrink:0}}>
                <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:32,letterSpacing:1,color:"#E63946",lineHeight:1}}>{totalPts}</div>
                <div style={{fontSize:9,color:"rgba(230,57,70,0.6)",letterSpacing:1.5,textTransform:"uppercase",fontFamily:"'Barlow',sans-serif"}}>pts total</div>
              </div>
            </div>
          </div>

          {/* TABS */}
          <div style={{display:"flex",background:"rgba(255,255,255,0.03)",borderRadius:12,padding:3}}>
            {[["ranking","🏆 Classement"],["profile","👤 Profil"]].map(([v,l])=>(
              <button key={v} onClick={()=>setActiveTab(v)} style={{flex:1,padding:"9px 0",borderRadius:10,background:activeTab===v?"rgba(255,255,255,0.07)":"transparent",color:activeTab===v?"#F0EDE8":"#444",border:"none",cursor:"pointer",fontFamily:"'Barlow',sans-serif",fontWeight:700,fontSize:13,transition:"all 0.2s"}}>{l}</button>
            ))}
          </div>
        </div>

        {/* CONTENT */}
        {activeTab==="ranking" && <RankingTab profile={profile} allProfiles={[]}/>}
        {activeTab==="profile" && <ProfileTab profile={profile} onDelete={handleDelete} onEdit={handleEdit}/>}
      </div>

      {/* ADD BUTTON */}
      <div style={{position:"fixed",bottom:24,right:24,zIndex:100}}>
        {showAddMenu&&(
          <div style={{position:"absolute",bottom:70,right:0,display:"flex",flexDirection:"column",gap:8,alignItems:"flex-end"}}>
            <button onClick={()=>{setShowTrainingModal(true);setShowAddMenu(false);}} style={{display:"flex",alignItems:"center",gap:8,padding:"10px 16px",borderRadius:24,background:"#22C55E",color:"#fff",border:"none",cursor:"pointer",fontFamily:"'Barlow',sans-serif",fontWeight:700,fontSize:13,whiteSpace:"nowrap",boxShadow:"0 4px 16px rgba(34,197,94,0.4)"}}>
              🏋️ Entraînement
            </button>
            <button onClick={()=>{setShowModal(true);setShowAddMenu(false);}} style={{display:"flex",alignItems:"center",gap:8,padding:"10px 16px",borderRadius:24,background:"#E63946",color:"#fff",border:"none",cursor:"pointer",fontFamily:"'Barlow',sans-serif",fontWeight:700,fontSize:13,whiteSpace:"nowrap",boxShadow:"0 4px 16px rgba(230,57,70,0.4)"}}>
              🏁 Course officielle
            </button>
          </div>
        )}
        <button onClick={()=>setShowAddMenu(!showAddMenu)} style={{width:60,height:60,borderRadius:"50%",background:"#E63946",color:"#fff",border:"none",cursor:"pointer",fontSize:28,boxShadow:"0 4px 20px rgba(230,57,70,0.5)",display:"flex",alignItems:"center",justifyContent:"center",transition:"transform 0.2s",transform:showAddMenu?"rotate(45deg)":"rotate(0)"}}>+</button>
      </div>

      {showModal&&<AddResultModal onClose={()=>setShowModal(false)} onAdd={handleAddResult}/>}
      {showTrainingModal&&<AddTrainingModal onClose={()=>setShowTrainingModal(false)} onAdd={handleAddTraining}/>}
      {editResult&&<EditResultModal result={editResult} onClose={()=>setEditResult(null)} onSave={handleSaveEdit}/>}
    </>
  );
}