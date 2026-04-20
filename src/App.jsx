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

// ─── BADGES ───────────────────────────────────────────────────────────────────
const BADGES = [
  { id:"first_race",  emoji:"🎽", label:"Première foulée",  desc:"Enregistrer sa 1ère course",          color:"#E63946", check:(r)=>r.length>=1 },
  { id:"five_races",  emoji:"🔥", label:"Série de 5",       desc:"Compléter 5 épreuves au total",       color:"#FF8C00", check:(r)=>r.length>=5 },
  { id:"ten_races",   emoji:"💯", label:"Centurion",        desc:"Compléter 10 épreuves au total",      color:"#FFD700", check:(r)=>r.length>=10 },
  { id:"sub60_10k",   emoji:"⚡", label:"Sub-60 au 10km",   desc:"Finir un 10km en moins d'1h",         color:"#3B82F6", check:(r)=>r.some(x=>x.discipline==="10km"&&x.time<60*60) },
  { id:"sub45_10k",   emoji:"🚀", label:"Sub-45 au 10km",   desc:"Finir un 10km en moins de 45min",    color:"#6366F1", check:(r)=>r.some(x=>x.discipline==="10km"&&x.time<45*60) },
  { id:"sub2h_semi",  emoji:"🏅", label:"Sub-2h semi",      desc:"Finir un semi en moins de 2h",        color:"#22C55E", check:(r)=>r.some(x=>x.discipline==="semi"&&x.time<2*3600) },
  { id:"sub130_semi", emoji:"🌟", label:"Sub-1h30 semi",    desc:"Finir un semi en moins de 1h30",      color:"#10B981", check:(r)=>r.some(x=>x.discipline==="semi"&&x.time<90*60) },
  { id:"sub4h_mara",  emoji:"🎯", label:"Sub-4h marathon",  desc:"Finir un marathon en moins de 4h",    color:"#F59E0B", check:(r)=>r.some(x=>x.discipline==="marathon"&&x.time<4*3600) },
  { id:"sub3h_mara",  emoji:"👑", label:"Sub-3h marathon",  desc:"Finir un marathon en moins de 3h",    color:"#FFD700", check:(r)=>r.some(x=>x.discipline==="marathon"&&x.time<3*3600) },
  { id:"finisher_im", emoji:"🦾", label:"Ironman Finisher", desc:"Terminer un Ironman",                  color:"#E63946", check:(r)=>r.some(x=>x.discipline==="tri-xl") },
  { id:"sub10h_im",   emoji:"💎", label:"Sub-10h Ironman",  desc:"Finir un Ironman en moins de 10h",    color:"#A78BFA", check:(r)=>r.some(x=>x.discipline==="tri-xl"&&x.time<10*3600) },
  { id:"finisher_ut", emoji:"🏔️", label:"Ultra Finisher",   desc:"Terminer un Ultra Trail",              color:"#78716C", check:(r)=>r.some(x=>x.discipline==="trail-xl") },
  { id:"multi_cat",   emoji:"🎪", label:"Touche-à-tout",    desc:"Courir dans 2 catégories différentes", color:"#EC4899", check:(r)=>new Set(r.map(x=>DISCIPLINES[x.discipline]?.category)).size>=2 },
  { id:"triathlete",  emoji:"🏊", label:"Vrai triathlète",  desc:"Compléter un tri ET une course",       color:"#06B6D4", check:(r)=>r.some(x=>DISCIPLINES[x.discipline]?.category==="triathlon")&&r.some(x=>DISCIPLINES[x.discipline]?.category==="running") },
  { id:"triple_crown",emoji:"🌈", label:"Triple Couronne",  desc:"Course, Trail ET Triathlon",           color:"#F43F5E", check:(r)=>{const c=new Set(r.map(x=>DISCIPLINES[x.discipline]?.category));return c.has("running")&&c.has("trail")&&c.has("triathlon");} },
];

function computeBadges(results) {
  return BADGES.filter(b => b.check(results));
}

// ─── UTILS ────────────────────────────────────────────────────────────────────
function calcPoints(discipline, t) {
  const d = DISCIPLINES[discipline];
  if (!d) return 0;
  return Math.round(Math.max(1, Math.min(Math.round(1000 * Math.pow(d.refTime / t, 1.06)), 1200)) * d.prestige);
}

function formatTime(s) {
  const h = Math.floor(s/3600), m = Math.floor((s%3600)/60), ss = s%60;
  return h > 0 ? `${h}h${String(m).padStart(2,"0")}m${String(ss).padStart(2,"0")}s` : `${m}m${String(ss).padStart(2,"0")}s`;
}

function parseTime(str) {
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

function getMedal(rank) {
  if (rank === 1) return { emoji:"🥇", color:"#FFD700" };
  if (rank === 2) return { emoji:"🥈", color:"#C0C0C0" };
  if (rank === 3) return { emoji:"🥉", color:"#CD7F32" };
  return null;
}

const AVATAR_COLORS = ["#E63946","#457B9D","#2A9D8F","#D4A017","#F4A261","#6D6875","#3D405B","#81B29A"];
function avatarColor(s) { return AVATAR_COLORS[((s?.charCodeAt(0)||0)+(s?.charCodeAt(1)||0)) % AVATAR_COLORS.length]; }

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
        <div style={{fontSize:10,fontWeight:700,letterSpacing:1.5,textTransform:"uppercase",color:"#555",marginBottom:8,fontFamily:"'Barlow',sans-serif"}}>Ton prénom et nom</div>
        <input value={name} onChange={e=>setName(e.target.value)} placeholder="ex: Philippe Sallenave" style={inp}/>
        <div style={{fontSize:10,fontWeight:700,letterSpacing:1.5,textTransform:"uppercase",color:"#555",marginBottom:8,fontFamily:"'Barlow',sans-serif"}}>Ta ville (optionnel)</div>
        <input value={city} onChange={e=>setCity(e.target.value)} placeholder="ex: Paris" style={inp}/>
        <button onClick={handleSubmit} disabled={loading||!name.trim()} style={{width:"100%",padding:"14px 0",borderRadius:12,background:"#E63946",color:"#fff",border:"none",cursor:"pointer",fontFamily:"'Bebas Neue',sans-serif",fontSize:18,letterSpacing:1,opacity:loading||!name.trim()?0.5:1}}>
          {loading?"Création...":"C'est parti !"}
        </button>
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
    if (!t || t <= 0) { setError("Format invalide. Ex: 42:51 ou 3:10:49"); return; }
    setLoading(true);
    await onAdd(discipline, t, raceName || DISCIPLINES[discipline].label, year);
    setLoading(false);
    onClose();
  };

  const inp = { width:"100%", padding:"12px 14px", background:"rgba(255,255,255,0.06)", border:"1.5px solid rgba(255,255,255,0.1)", borderRadius:12, color:"#F0EDE8", fontSize:16, fontFamily:"'Barlow',sans-serif", outline:"none" };
  const Lbl = ({ c }) => <div style={{fontSize:10,fontWeight:700,letterSpacing:1.5,textTransform:"uppercase",color:"#555",marginBottom:8,fontFamily:"'Barlow',sans-serif"}}>{c}</div>;

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

        <Lbl c="Temps (h:mm:ss ou mm:ss)"/>
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

// ─── PROFILE TAB ──────────────────────────────────────────────────────────────
function ProfileTab({ profile }) {
  const [subTab, setSubTab] = useState("bests");
  const badges = computeBadges(profile.results);
  const earnedIds = new Set(badges.map(b => b.id));

  const byDisc = {};
  profile.results.forEach(r => {
    if (!byDisc[r.discipline] || r.time < byDisc[r.discipline].time) byDisc[r.discipline] = r;
  });
  const bests = Object.entries(byDisc).sort((a,b) => {
    const cats = ["running","trail","triathlon"];
    return cats.indexOf(DISCIPLINES[a[0]]?.category) - cats.indexOf(DISCIPLINES[b[0]]?.category);
  });

  const byYear = {};
  [...profile.results].sort((a,b) => b.year - a.year).forEach(r => {
    if (!byYear[r.year]) byYear[r.year] = [];
    byYear[r.year].push(r);
  });

  return (
    <div style={{padding:"16px"}}>
      {/* Sub tabs */}
      <div style={{display:"flex",gap:6,marginBottom:16,flexWrap:"wrap"}}>
        {[["bests","🏆 Meilleurs temps"],["history","📅 Historique"],["badges",`🏅 Badges (${badges.length})`]].map(([v,l])=>(
          <button key={v} onClick={()=>setSubTab(v)} style={{padding:"7px 14px",borderRadius:14,background:subTab===v?"rgba(230,57,70,0.12)":"rgba(255,255,255,0.04)",color:subTab===v?"#E63946":"#555",border:subTab===v?"1px solid rgba(230,57,70,0.3)":"1px solid rgba(255,255,255,0.07)",cursor:"pointer",fontSize:11,fontWeight:700,fontFamily:"'Barlow',sans-serif"}}>{l}</button>
        ))}
      </div>

      {/* BESTS */}
      {subTab==="bests"&&(
        <div style={{display:"flex",flexDirection:"column",gap:8}}>
          {bests.length===0&&<div style={{textAlign:"center",color:"#333",padding:"30px 0",fontFamily:"'Barlow',sans-serif",fontSize:13}}>Aucun résultat — ajoute ta première course !</div>}
          {bests.map(([disc,r])=>{
            const pts = calcPoints(disc, r.time);
            const lv = getLevelLabel(pts);
            const pl = prestigeLabel(DISCIPLINES[disc]?.prestige || 1);
            return(
              <div key={disc} style={{background:"rgba(255,255,255,0.03)",borderRadius:14,padding:"14px 16px",border:"1px solid rgba(255,255,255,0.05)"}}>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                  <div style={{flex:1}}>
                    <div style={{display:"flex",alignItems:"center",gap:8,flexWrap:"wrap"}}>
                      <span style={{fontSize:18}}>{DISCIPLINES[disc]?.icon}</span>
                      <span style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:17,letterSpacing:0.8,color:"#F0EDE8"}}>{DISCIPLINES[disc]?.label}</span>
                      <span style={{fontSize:9,fontWeight:700,letterSpacing:1,textTransform:"uppercase",color:lv.color,background:lv.bg,borderRadius:10,padding:"2px 8px",fontFamily:"'Barlow',sans-serif"}}>{lv.label}</span>
                      <span style={{fontSize:9,color:pl.color,fontWeight:700,fontFamily:"'Barlow',sans-serif"}}>{pl.text}</span>
                    </div>
                    <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:24,letterSpacing:1,color:"#F0EDE8",marginTop:4}}>{formatTime(r.time)}</div>
                    <div style={{fontSize:11,color:"#444",fontFamily:"'Barlow',sans-serif",marginTop:2}}>{r.race} · {r.year}</div>
                  </div>
                  <div style={{textAlign:"right",flexShrink:0,marginLeft:12}}>
                    <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:28,letterSpacing:1,color:lv.color}}>{pts}</div>
                    <div style={{fontSize:9,color:"#444",letterSpacing:1,textTransform:"uppercase"}}>pts</div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* HISTORY */}
      {subTab==="history"&&(
        <div style={{display:"flex",flexDirection:"column",gap:16}}>
          {Object.keys(byYear).length===0&&<div style={{textAlign:"center",color:"#333",padding:"30px 0",fontFamily:"'Barlow',sans-serif"}}>Aucun résultat</div>}
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
                    <div key={i} style={{display:"flex",alignItems:"center",gap:10,padding:"11px 14px",background:"rgba(255,255,255,0.025)",borderRadius:12,border:isPR?"1px solid rgba(255,215,0,0.2)":"1px solid rgba(255,255,255,0.04)"}}>
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
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* BADGES */}
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
function RankingTab({ profile }) {
  const [season, setSeason] = useState(2026);
  const [filterCat, setFilterCat] = useState("all");

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
      <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:16,letterSpacing:1,color:"#555",marginBottom:10}}>Résultats {season}</div>
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
  const [activeTab, setActiveTab] = useState("ranking");

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
    await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: window.location.origin }
    });
  };

  const handleLogout = async () => {
    await supabase.auth.signOut();
  };

  const handleAddResult = async (discipline, time, race, year) => {
    if (!profile) return;
    const { data, error } = await supabase.from("results").insert({
      user_id: profile.id, discipline, time, race, year
    }).select().single();
    if (!error && data) {
      setProfile(p => ({ ...p, results: [data, ...p.results] }));
    }
  };

  if (loading) return (
    <div style={{minHeight:"100vh",background:"#0D0D0D",display:"flex",alignItems:"center",justifyContent:"center"}}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=Bebas+Neue&display=swap');*{box-sizing:border-box;margin:0;padding:0;}body{background:#0D0D0D;}`}</style>
      <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:32,letterSpacing:2,color:"#E63946"}}>PACERANK</div>
    </div>
  );

  if (!session) return <LoginPage onLogin={handleLogin}/>;
  if (!profile) return <SetupProfile user={session.user} onComplete={p=>setProfile(p)}/>;

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
        {activeTab==="ranking" && <RankingTab profile={profile}/>}
        {activeTab==="profile" && <ProfileTab profile={profile}/>}
      </div>

      {/* ADD BUTTON */}
      <div style={{position:"fixed",bottom:24,right:24,zIndex:100}}>
        <button onClick={()=>setShowModal(true)} style={{width:60,height:60,borderRadius:"50%",background:"#E63946",color:"#fff",border:"none",cursor:"pointer",fontSize:28,boxShadow:"0 4px 20px rgba(230,57,70,0.5)",display:"flex",alignItems:"center",justifyContent:"center"}}>+</button>
      </div>

      {showModal&&<AddResultModal onClose={()=>setShowModal(false)} onAdd={handleAddResult}/>}
    </>
  );
}