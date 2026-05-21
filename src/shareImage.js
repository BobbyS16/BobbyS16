// ─────────────────────────────────────────────────────────────────────────────
//   shareImage.js — génération d'images "story Instagram" pour le partage
// ─────────────────────────────────────────────────────────────────────────────
//
// Génère des images PNG 1080×1920 (format story 9:16) à partir des données
// d'activité Pacerank. Utilise Canvas natif (zéro dépendance externe).
//
// Usage :
//   const blob = await generateStoryImage({ type:'pr', profile, data });
//   await shareCard(blob, 'pacerank-pr.png');
//
// Types supportés :
//   - 'pr'       : nouveau record perso (or)
//   - 'race'     : résultat course officielle (rouge + drapeau damier)
//   - 'training' : entraînement (vert)
//   - 'prono'    : prono réussi (violet)
//   - 'promo'    : promotion en ligue (bleu)
//   - 'weekly'   : bilan de la semaine (bleu)
//
// Chargement des polices : Bebas Neue + Barlow sont déjà chargées via Google
// Fonts dans index.html. On attend `document.fonts.ready` avant de dessiner.

const W = 1080;
const H = 1920;

// ───── Couleurs (matchent l'app) ─────────────────────────────────────────────
const COLORS = {
  bg:       "#0a0a0a",
  white:    "#F0EDE8",
  whiteDim: "rgba(240,237,232,0.65)",
  whiteFaint:"rgba(240,237,232,0.45)",
  gold:     "#FFD700",
  red:      "#E63946",
  green:    "#4ADE80",
  purple:   "#A78BFA",
  blue:     "#4A90D9",
  bronze:   "#C08050",
};

// ───── Helpers ───────────────────────────────────────────────────────────────

// Charge une image en CORS-safe. Sert pour l'avatar user (peut être sur
// supabase storage qui autorise CORS, ou Google avatar qui parfois bloque
// → on essaie crossOrigin anonymous et on fallback vers initiales si ça
// échoue).
function loadImage(url) {
  return new Promise((resolve, reject) => {
    if (!url) { reject(new Error("no url")); return; }
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("img load failed"));
    img.src = url;
  });
}

// Dessine un cercle (utilisé pour avatar bordé)
function drawCircle(ctx, x, y, r, fill, stroke, strokeW) {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  if (fill) { ctx.fillStyle = fill; ctx.fill(); }
  if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = strokeW||4; ctx.stroke(); }
}

// Avatar : essaie de dessiner l'image, sinon initiales avec gradient
async function drawAvatar(ctx, profile, x, y, size) {
  const r = size / 2;
  // Bordure blanche subtile
  drawCircle(ctx, x, y, r + 3, null, "rgba(255,255,255,0.85)", 4);
  // Tentative image avatar
  if (profile?.avatar) {
    try {
      const img = await loadImage(profile.avatar);
      ctx.save();
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.clip();
      ctx.drawImage(img, x - r, y - r, size, size);
      ctx.restore();
      return;
    } catch (e) {
      // fallback initiales
    }
  }
  // Fallback : gradient red→gold avec initiales
  const grad = ctx.createLinearGradient(x - r, y - r, x + r, y + r);
  grad.addColorStop(0, COLORS.red);
  grad.addColorStop(1, COLORS.gold);
  drawCircle(ctx, x, y, r, grad);
  const initials = (profile?.name || "?")
    .split(" ").map(s => s[0]).filter(Boolean).slice(0, 2).join("").toUpperCase();
  ctx.fillStyle = "#fff";
  ctx.font = `${Math.round(size * 0.42)}px "Bebas Neue", sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(initials, x, y + 2);
}

// Texte centré avec une famille de police donnée
function drawText(ctx, text, x, y, opts = {}) {
  const {
    font = "Bebas Neue",
    size = 32,
    color = COLORS.white,
    align = "center",
    weight = "",
    letterSpacing = 0,
  } = opts;
  ctx.fillStyle = color;
  ctx.font = `${weight} ${size}px "${font}", sans-serif`;
  ctx.textAlign = align;
  ctx.textBaseline = "alphabetic";
  if (letterSpacing > 0) {
    // Letter-spacing manuel : on dessine char par char
    const chars = String(text).split("");
    let total = 0;
    chars.forEach(c => { total += ctx.measureText(c).width + letterSpacing; });
    let curX = align === "center" ? x - total / 2 : (align === "right" ? x - total : x);
    chars.forEach(c => {
      ctx.textAlign = "left";
      ctx.fillText(c, curX, y);
      curX += ctx.measureText(c).width + letterSpacing;
    });
  } else {
    ctx.fillText(String(text), x, y);
  }
}

// Roundrect helper (pour cards/tags)
function drawRoundRect(ctx, x, y, w, h, r, fill, stroke, strokeW) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
  if (fill) { ctx.fillStyle = fill; ctx.fill(); }
  if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = strokeW || 2; ctx.stroke(); }
}

// Tag pill (ex "NOUVEAU PR")
function drawTag(ctx, text, x, y, color) {
  const padX = 22, padY = 12;
  ctx.font = `700 26px "Bebas Neue", sans-serif`;
  const w = ctx.measureText(text).width + padX * 2;
  const h = 50;
  drawRoundRect(ctx, x - w/2, y - h/2, w, h, h/2, color + "22", color + "70", 2);
  drawText(ctx, text, x, y + 9, { size: 28, color, letterSpacing: 3 });
}

// Damier en bandeau horizontal (drapeau course)
function drawCheckeredBand(ctx, y, height, cellSize = 28) {
  const cols = Math.ceil(W / cellSize);
  const rows = Math.ceil(height / cellSize);
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const black = (row + col) % 2 === 0;
      ctx.fillStyle = black ? "#000" : "#fff";
      ctx.fillRect(col * cellSize, y + row * cellSize, cellSize, cellSize);
    }
  }
}

// User header (avatar + nom) au top-left
async function drawUserHeader(ctx, profile, topOffset = 56) {
  const avatarX = 110;
  const avatarY = topOffset + 50;
  await drawAvatar(ctx, profile, avatarX, avatarY, 90);
  drawText(ctx, profile?.name || "Athlète", avatarX + 70, avatarY + 16, {
    size: 38, color: COLORS.white, letterSpacing: 2, align: "left",
  });
}

// Watermark Pacerank en bas (logo + URL)
function drawWatermark(ctx) {
  drawText(ctx, "PACERANK", W / 2, H - 90, {
    size: 54, color: "#fff", letterSpacing: 10,
  });
  drawText(ctx, "PACERANK.VERCEL.APP", W / 2, H - 45, {
    size: 22, color: "rgba(255,255,255,0.7)", letterSpacing: 4, weight: "700",
    font: "Barlow",
  });
}

// ───── Renderers par type ────────────────────────────────────────────────────

async function renderPR(ctx, data, profile) {
  // Background gradient gold→dark
  const grad = ctx.createRadialGradient(W/2, 0, 0, W/2, H/2, H);
  grad.addColorStop(0, "#2a1810");
  grad.addColorStop(0.6, "#0a0a0a");
  grad.addColorStop(1, "#000");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, W, H);
  // Bande or en haut
  const gradLine = ctx.createLinearGradient(0, 0, W, 0);
  gradLine.addColorStop(0, "rgba(255,215,0,0)");
  gradLine.addColorStop(0.5, COLORS.gold);
  gradLine.addColorStop(1, "rgba(255,215,0,0)");
  ctx.fillStyle = gradLine;
  ctx.fillRect(0, 0, W, 16);

  await drawUserHeader(ctx, profile);

  // Body centré
  const cy = H / 2 - 40;
  drawTag(ctx, "NOUVEAU PR", W/2, cy - 380, COLORS.gold);
  drawText(ctx, "🏆", W/2, cy - 240, { size: 130, font: "Barlow" });
  drawText(ctx, data.discLabel || "10 KM", W/2, cy - 130, { size: 50, color: COLORS.whiteDim, letterSpacing: 4 });
  drawText(ctx, data.time || "00:00", W/2, cy + 20, { size: 240, color: COLORS.gold, letterSpacing: 8 });
  if (data.race) {
    drawText(ctx, data.race.toUpperCase(), W/2, cy + 120, { size: 50, color: COLORS.white, letterSpacing: 5 });
  }
  if (data.date) {
    drawText(ctx, data.date.toUpperCase(), W/2, cy + 175, { size: 30, color: COLORS.whiteFaint, weight: "700", font: "Barlow", letterSpacing: 4 });
  }
  if (data.improvement) {
    // Pastille verte "↓ 42 sec sous mon PR précédent"
    ctx.font = `700 28px "Barlow", sans-serif`;
    const txt = data.improvement;
    const tw = ctx.measureText(txt).width + 50;
    drawRoundRect(ctx, W/2 - tw/2, cy + 250, tw, 60, 30, "rgba(74,222,128,0.12)", "rgba(74,222,128,0.5)", 2);
    drawText(ctx, txt, W/2, cy + 290, { size: 28, color: COLORS.green, weight: "700", font: "Barlow", letterSpacing: 1.5 });
  }
  drawWatermark(ctx);
}

async function renderRace(ctx, data, profile) {
  // Background dark red
  const grad = ctx.createLinearGradient(0, 0, 0, H);
  grad.addColorStop(0, "#1a0a0a");
  grad.addColorStop(1, "#000");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, W, H);
  // Drapeau damier en haut
  drawCheckeredBand(ctx, 0, 56, 28);
  ctx.fillStyle = "rgba(255,255,255,0.25)";
  ctx.fillRect(0, 56, W, 4);

  await drawUserHeader(ctx, profile, 100);

  // Body
  const cy = H / 2;
  drawTag(ctx, "COURSE TERMINÉE", W/2, cy - 420, COLORS.red);
  drawText(ctx, (data.race || "COURSE").toUpperCase(), W/2, cy - 280, { size: 80, color: COLORS.white, letterSpacing: 4 });
  if (data.date) {
    drawText(ctx, data.date.toUpperCase(), W/2, cy - 210, { size: 28, color: COLORS.whiteFaint, weight: "700", font: "Barlow", letterSpacing: 4 });
  }
  // Box rouge avec chrono
  const boxW = 700, boxH = 220;
  drawRoundRect(ctx, W/2 - boxW/2, cy - 130, boxW, boxH, 30, "rgba(230,57,70,0.12)", "rgba(230,57,70,0.4)", 3);
  drawText(ctx, (data.discLabel || "10 KM EN").toUpperCase(), W/2, cy - 75, { size: 32, color: COLORS.red, weight: "700", font: "Barlow", letterSpacing: 3 });
  drawText(ctx, data.time || "00:00", W/2, cy + 55, { size: 150, color: COLORS.white, letterSpacing: 6 });

  // Stats bottom : position + points
  if (data.position && data.total) {
    drawText(ctx, `${data.position}ᵉ`, W/2 - 180, cy + 200, { size: 80, color: COLORS.white });
    drawText(ctx, `SUR ${data.total}`, W/2 - 180, cy + 240, { size: 20, color: COLORS.whiteFaint, font: "Barlow", weight: "700", letterSpacing: 2.5 });
  }
  if (data.points) {
    drawText(ctx, `+${data.points}`, W/2 + 180, cy + 200, { size: 80, color: COLORS.green });
    drawText(ctx, "PTS GAGNÉS", W/2 + 180, cy + 240, { size: 20, color: COLORS.whiteFaint, font: "Barlow", weight: "700", letterSpacing: 2.5 });
  }

  // Damier bas (avant watermark)
  drawCheckeredBand(ctx, H - 200, 28, 16);
  drawWatermark(ctx);
}

async function renderTraining(ctx, data, profile) {
  // Background dark green
  const grad = ctx.createLinearGradient(0, 0, 0, H);
  grad.addColorStop(0, "#0a1f0e");
  grad.addColorStop(0.7, "#000");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, W, H);

  await drawUserHeader(ctx, profile);

  const cy = H/2 - 40;
  drawTag(ctx, "ENTRAÎNEMENT", W/2, cy - 380, COLORS.green);
  drawText(ctx, data.emoji || "🏃", W/2, cy - 220, { size: 130, font: "Barlow" });
  drawText(ctx, (data.discLabel || "Sortie Run").toUpperCase(), W/2, cy - 100, { size: 60, color: COLORS.white, letterSpacing: 5 });

  // Grid 2x2 stats
  const cells = [
    { val: data.km || "—", lbl: "KM" },
    { val: data.duration || "—", lbl: "DURÉE" },
    { val: data.pace || data.thirdValue || "—", lbl: data.thirdLabel || "/KM" },
    { val: data.elevation || "—", lbl: "D+ (M)" },
  ];
  const cellW = 220, cellH = 160, gap = 24;
  const startX = W/2 - cellW - gap/2;
  const startY = cy + 30;
  cells.forEach((c, i) => {
    const r = Math.floor(i / 2), col = i % 2;
    const x = startX + col * (cellW + gap);
    const y = startY + r * (cellH + gap);
    drawRoundRect(ctx, x, y, cellW, cellH, 20, "rgba(255,255,255,0.04)", "rgba(255,255,255,0.1)", 2);
    drawText(ctx, c.val, x + cellW/2, y + 80, { size: 70, color: COLORS.white, letterSpacing: 2 });
    drawText(ctx, c.lbl, x + cellW/2, y + 130, { size: 22, color: COLORS.whiteFaint, weight: "700", font: "Barlow", letterSpacing: 2.5 });
  });

  // Pill points
  if (data.points) {
    const pillTxt = `+ ${data.points} PTS`;
    ctx.font = `36px "Bebas Neue", sans-serif`;
    const pw = ctx.measureText(pillTxt).width + 90;
    drawRoundRect(ctx, W/2 - pw/2, cy + 440, pw, 80, 40, "rgba(74,222,128,0.12)", "rgba(74,222,128,0.4)", 3);
    drawText(ctx, pillTxt, W/2, cy + 495, { size: 40, color: COLORS.green, letterSpacing: 4 });
  }
  drawWatermark(ctx);
}

async function renderProno(ctx, data, profile) {
  const grad = ctx.createRadialGradient(W*0.7, H*0.2, 0, W*0.7, H*0.2, H);
  grad.addColorStop(0, "#1f0a2a");
  grad.addColorStop(0.7, "#000");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, W, H);

  await drawUserHeader(ctx, profile);

  const cy = H/2 - 40;
  drawTag(ctx, "PRONO RÉUSSI", W/2, cy - 380, COLORS.purple);
  drawText(ctx, "🔮", W/2, cy - 220, { size: 140, font: "Barlow" });
  drawText(ctx, "J'AVAIS PRÉDIT JUSTE", W/2, cy - 80, { size: 70, color: COLORS.white, letterSpacing: 3 });
  if (data.raceLabel) {
    drawText(ctx, `SUR ${data.raceLabel.toUpperCase()}`, W/2, cy - 20, { size: 30, color: COLORS.whiteFaint, weight: "700", font: "Barlow", letterSpacing: 3 });
  }
  // Cercle violet points
  drawCircle(ctx, W/2, cy + 180, 160, "rgba(167,139,250,0.18)", "rgba(167,139,250,0.6)", 6);
  drawText(ctx, `+${data.points || 0}`, W/2, cy + 200, { size: 130, color: COLORS.purple, letterSpacing: 3 });
  drawText(ctx, "POINTS", W/2, cy + 250, { size: 28, color: COLORS.purple, weight: "700", font: "Barlow", letterSpacing: 4 });
  if (data.precision) {
    drawText(ctx, data.precision, W/2, cy + 420, { size: 28, color: COLORS.whiteFaint, weight: "700", font: "Barlow", letterSpacing: 2 });
  }
  drawWatermark(ctx);
}

async function renderPromo(ctx, data, profile) {
  const grad = ctx.createLinearGradient(0, 0, 0, H);
  grad.addColorStop(0, "#1a1208");
  grad.addColorStop(0.7, "#000");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, W, H);

  await drawUserHeader(ctx, profile);

  const cy = H/2 - 40;
  drawTag(ctx, "PROMOTION", W/2, cy - 380, COLORS.blue);
  drawText(ctx, "🚀", W/2, cy - 220, { size: 130, font: "Barlow" });
  drawText(ctx, `PROMU EN ${(data.toLeague||"LIGUE").toUpperCase()}`, W/2, cy - 60, { size: 60, color: COLORS.white, letterSpacing: 4 });

  // 2 pills : ancienne ligue → nouvelle ligue
  const pillW = 240, pillH = 170, gap = 60;
  drawRoundRect(ctx, W/2 - pillW - gap/2, cy + 60, pillW, pillH, 24, "rgba(205,127,50,0.08)", "rgba(205,127,50,0.3)", 2);
  drawText(ctx, data.fromEmoji || "🥉", W/2 - pillW/2 - gap/2, cy + 130, { size: 60, font: "Barlow" });
  drawText(ctx, (data.fromLeague || "BRONZE").toUpperCase(), W/2 - pillW/2 - gap/2, cy + 200, { size: 32, color: "rgba(255,255,255,0.55)", letterSpacing: 2 });

  drawText(ctx, "→", W/2, cy + 165, { size: 60, color: COLORS.gold });

  drawRoundRect(ctx, W/2 + gap/2, cy + 50, pillW, pillH + 20, 28, "rgba(255,215,0,0.12)", "rgba(255,215,0,0.5)", 3);
  drawText(ctx, data.toEmoji || "🥇", W/2 + pillW/2 + gap/2, cy + 125, { size: 70, font: "Barlow" });
  drawText(ctx, (data.toLeague || "OR").toUpperCase(), W/2 + pillW/2 + gap/2, cy + 200, { size: 38, color: COLORS.white, letterSpacing: 2.5 });

  if (data.position && data.total) {
    drawText(ctx, `${data.position}ᵉ SUR ${data.total} CETTE SEMAINE`, W/2, cy + 380, { size: 32, color: COLORS.whiteDim, weight:"700", font:"Barlow", letterSpacing: 2 });
  }
  drawWatermark(ctx);
}

async function renderWeekly(ctx, data, profile) {
  const grad = ctx.createLinearGradient(0, 0, 0, H);
  grad.addColorStop(0, "#0a1825");
  grad.addColorStop(0.7, "#000");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, W, H);

  await drawUserHeader(ctx, profile);

  const cy = H/2 - 80;
  drawTag(ctx, "MA SEMAINE", W/2, cy - 380, COLORS.blue);
  drawText(ctx, (data.weekLabel || "SEMAINE").toUpperCase(), W/2, cy - 230, { size: 42, color: COLORS.whiteDim, letterSpacing: 3 });

  // 4 cells stats
  const cells = [
    { val: data.sessions || 0, lbl: "SÉANCES" },
    { val: data.km || 0, lbl: "KM" },
    { val: data.elevation || 0, lbl: "D+ (M)" },
    { val: data.points || 0, lbl: "POINTS" },
  ];
  const cellW = 220, cellH = 160, gap = 24;
  const startX = W/2 - cellW - gap/2;
  const startY = cy - 80;
  cells.forEach((c, i) => {
    const r = Math.floor(i / 2), col = i % 2;
    const x = startX + col * (cellW + gap);
    const y = startY + r * (cellH + gap);
    drawRoundRect(ctx, x, y, cellW, cellH, 20, "rgba(74,144,217,0.06)", "rgba(74,144,217,0.25)", 2);
    drawText(ctx, c.val, x + cellW/2, y + 80, { size: 70, color: COLORS.white, letterSpacing: 2 });
    drawText(ctx, c.lbl, x + cellW/2, y + 130, { size: 22, color: COLORS.whiteFaint, weight: "700", font: "Barlow", letterSpacing: 2.5 });
  });

  // Rang amis
  if (data.friendsRank) {
    const rankTxt = `${data.friendsRank}${data.friendsRank===1?"ᵉʳ":"ᵉ"} DE MES POTES`;
    ctx.font = `40px "Bebas Neue", sans-serif`;
    const w = ctx.measureText(rankTxt).width + 100;
    drawRoundRect(ctx, W/2 - w/2, cy + 380, w, 90, 45, "rgba(255,215,0,0.12)", "rgba(255,215,0,0.4)", 3);
    drawText(ctx, "🥇", W/2 - w/2 + 50, cy + 440, { size: 50, font: "Barlow" });
    drawText(ctx, rankTxt, W/2 + 30, cy + 440, { size: 40, color: COLORS.gold, letterSpacing: 3 });
  }
  drawWatermark(ctx);
}

// ───── Entry point ───────────────────────────────────────────────────────────

export async function generateStoryImage({ type, profile, data }) {
  // Attend que les polices Google Fonts soient chargées (Bebas Neue surtout).
  // Sans ça, le 1er render utilise la fallback sans-serif et ça change tout.
  try { await document.fonts.ready; } catch {}

  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d");

  // Fond noir par défaut (overridden par renderer)
  ctx.fillStyle = COLORS.bg;
  ctx.fillRect(0, 0, W, H);

  switch (type) {
    case "pr":       await renderPR(ctx, data, profile); break;
    case "race":     await renderRace(ctx, data, profile); break;
    case "training": await renderTraining(ctx, data, profile); break;
    case "prono":    await renderProno(ctx, data, profile); break;
    case "promo":    await renderPromo(ctx, data, profile); break;
    case "weekly":   await renderWeekly(ctx, data, profile); break;
    default: throw new Error(`Unknown share type: ${type}`);
  }

  return new Promise((resolve) => {
    canvas.toBlob((blob) => resolve(blob), "image/png", 0.95);
  });
}

// ─────────────────────────────────────────────────────────────────────────────
//   shareCard — déclenche la share sheet native ou fallback download
// ─────────────────────────────────────────────────────────────────────────────
//
// Stratégie :
//   1. Si navigator.canShare({files:[file]}) → navigator.share() avec le file
//      → ouvre la share sheet iOS/Android (Insta Stories, WhatsApp, AirDrop…)
//   2. Sinon → download direct via <a href="blob:..."> + anchor.click()
//
// Retourne :
//   - 'shared' si l'user a complété un partage natif
//   - 'cancelled' si l'user a fermé la share sheet
//   - 'downloaded' si fallback download (pas de share API)
//   - 'failed' si tout a échoué (log console pour debug)
//
// L'appelant peut afficher un toast adapté.

export async function shareCard(blob, filename = "pacerank.png", text = "") {
  if (!blob) return "failed";

  // Tentative Web Share API avec file. Disponible sur iOS Safari 15+,
  // Chrome Android, Edge récent. Pas sur Firefox / desktop Safari.
  try {
    const file = new File([blob], filename, { type: "image/png" });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      await navigator.share({
        files: [file],
        title: "Pacerank",
        text: text || "Ma perf sur Pacerank",
      });
      return "shared";
    }
  } catch (e) {
    // AbortError = l'user a fermé la share sheet, c'est OK
    if (e?.name === "AbortError") return "cancelled";
    console.warn("[shareCard] navigator.share failed, falling back to download", e);
  }

  // Fallback : download direct
  try {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 500);
    return "downloaded";
  } catch (e) {
    console.error("[shareCard] download fallback failed", e);
    return "failed";
  }
}

