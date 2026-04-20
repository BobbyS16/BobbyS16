import { useState, useRef, useEffect, useCallback } from "react";

// ─── DRUM ROLL PICKER ─────────────────────────────────────────────────────────
function DrumPicker({ values, selected, onChange, label }) {
  const containerRef = useRef(null);
  const startY = useRef(null);
  const startIndex = useRef(null);
  const animating = useRef(false);
  const ITEM_HEIGHT = 52;
  const VISIBLE = 5;

  const clamp = (v) => Math.max(0, Math.min(values.length - 1, v));

  const scrollTo = useCallback((index) => {
    if (containerRef.current) {
      containerRef.current.scrollTop = index * ITEM_HEIGHT;
    }
  }, []);

  useEffect(() => {
    scrollTo(selected);
  }, [selected, scrollTo]);

  const handleScroll = useCallback(() => {
    if (animating.current) return;
    const el = containerRef.current;
    if (!el) return;
    const index = clamp(Math.round(el.scrollTop / ITEM_HEIGHT));
    if (index !== selected) onChange(index);
  }, [selected, onChange]);

  const handleTouchStart = (e) => {
    startY.current = e.touches[0].clientY;
    startIndex.current = selected;
  };

  const handleTouchMove = (e) => {
    e.preventDefault();
    const delta = startY.current - e.touches[0].clientY;
    const newIndex = clamp(startIndex.current + Math.round(delta / ITEM_HEIGHT));
    if (newIndex !== selected) onChange(newIndex);
  };

  const handleMouseDown = (e) => {
    startY.current = e.clientY;
    startIndex.current = selected;
    const onMove = (ev) => {
      const delta = startY.current - ev.clientY;
      const newIndex = clamp(startIndex.current + Math.round(delta / ITEM_HEIGHT));
      if (newIndex !== selected) onChange(newIndex);
    };
    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6 }}>
      <span style={{
        fontSize: 11,
        fontWeight: 700,
        letterSpacing: "0.12em",
        textTransform: "uppercase",
        color: "#FF6B35",
        fontFamily: "'DM Mono', monospace",
      }}>{label}</span>

      <div style={{ position: "relative", width: 72, height: ITEM_HEIGHT * VISIBLE }}>
        {/* Gradient overlays */}
        <div style={{
          position: "absolute", inset: 0, zIndex: 2, pointerEvents: "none",
          background: `linear-gradient(to bottom,
            #0F1117 0%,
            rgba(15,17,23,0.6) 30%,
            transparent 50%,
            rgba(15,17,23,0.6) 70%,
            #0F1117 100%
          )`,
        }} />

        {/* Selection highlight */}
        <div style={{
          position: "absolute",
          top: "50%",
          left: 0, right: 0,
          height: ITEM_HEIGHT,
          transform: "translateY(-50%)",
          background: "rgba(255,107,53,0.12)",
          border: "1px solid rgba(255,107,53,0.35)",
          borderRadius: 10,
          zIndex: 1,
          pointerEvents: "none",
        }} />

        {/* Scrollable drum */}
        <div
          ref={containerRef}
          onScroll={handleScroll}
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onMouseDown={handleMouseDown}
          style={{
            height: "100%",
            overflowY: "scroll",
            scrollSnapType: "y mandatory",
            scrollbarWidth: "none",
            msOverflowStyle: "none",
            cursor: "grab",
            userSelect: "none",
          }}
        >
          <style>{`
            div::-webkit-scrollbar { display: none; }
          `}</style>

          {/* Top padding */}
          <div style={{ height: ITEM_HEIGHT * 2 }} />

          {values.map((val, i) => {
            const dist = Math.abs(i - selected);
            const opacity = dist === 0 ? 1 : dist === 1 ? 0.55 : 0.2;
            const scale = dist === 0 ? 1.15 : dist === 1 ? 0.92 : 0.8;
            return (
              <div
                key={i}
                onClick={() => { onChange(i); scrollTo(i); }}
                style={{
                  height: ITEM_HEIGHT,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  scrollSnapAlign: "center",
                  fontFamily: "'DM Mono', monospace",
                  fontSize: 26,
                  fontWeight: 600,
                  color: dist === 0 ? "#FF6B35" : "#E8E8E8",
                  opacity,
                  transform: `scale(${scale})`,
                  transition: "all 0.15s ease",
                  cursor: "pointer",
                }}
              >
                {String(val).padStart(2, "0")}
              </div>
            );
          })}

          {/* Bottom padding */}
          <div style={{ height: ITEM_HEIGHT * 2 }} />
        </div>
      </div>
    </div>
  );
}

// ─── SEPARATOR ────────────────────────────────────────────────────────────────
function Sep() {
  return (
    <div style={{
      display: "flex",
      flexDirection: "column",
      justifyContent: "center",
      paddingTop: 24,
      gap: 14,
    }}>
      {[0, 1].map(i => (
        <div key={i} style={{
          width: 5, height: 5,
          borderRadius: "50%",
          background: "#FF6B35",
          opacity: 0.7,
        }} />
      ))}
    </div>
  );
}

// ─── MAIN COMPONENT ───────────────────────────────────────────────────────────
export default function TimePickerRoulette() {
  const [hours, setHours] = useState(0);
  const [minutes, setMinutes] = useState(30);
  const [seconds, setSeconds] = useState(0);
  const [confirmed, setConfirmed] = useState(false);
  const [animateOut, setAnimateOut] = useState(false);

  const hoursArr = Array.from({ length: 24 }, (_, i) => i);
  const minsArr = Array.from({ length: 60 }, (_, i) => i);
  const secsArr = Array.from({ length: 60 }, (_, i) => i);

  const totalSeconds = hours * 3600 + minutes * 60 + seconds;

  const formatTime = () => {
    const h = String(hours).padStart(2, "0");
    const m = String(minutes).padStart(2, "0");
    const s = String(seconds).padStart(2, "0");
    return hours > 0 ? `${h}:${m}:${s}` : `${m}:${s}`;
  };

  const getPaceLabel = () => {
    if (totalSeconds === 0) return null;
    // Example: for 10km
    const paceSecPerKm = totalSeconds / 10;
    const paceMin = Math.floor(paceSecPerKm / 60);
    const paceSec = Math.round(paceSecPerKm % 60);
    return `${paceMin}:${String(paceSec).padStart(2, "0")} /km (10km)`;
  };

  const handleConfirm = () => {
    setAnimateOut(true);
    setTimeout(() => {
      setConfirmed(true);
      setAnimateOut(false);
    }, 400);
  };

  const handleReset = () => {
    setConfirmed(false);
    setHours(0);
    setMinutes(30);
    setSeconds(0);
  };

  return (
    <div style={{
      minHeight: "100vh",
      background: "#0F1117",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      fontFamily: "'DM Sans', sans-serif",
      padding: 20,
    }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&family=DM+Mono:wght@400;500;600&display=swap');
        * { box-sizing: border-box; margin: 0; padding: 0; }
        @keyframes fadeSlideUp {
          from { opacity: 0; transform: translateY(20px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        @keyframes fadeSlideDown {
          from { opacity: 1; transform: translateY(0); }
          to   { opacity: 0; transform: translateY(-20px); }
        }
        @keyframes popIn {
          0%   { transform: scale(0.8); opacity: 0; }
          70%  { transform: scale(1.05); }
          100% { transform: scale(1); opacity: 1; }
        }
        @keyframes pulse {
          0%, 100% { box-shadow: 0 0 0 0 rgba(255,107,53,0.4); }
          50%       { box-shadow: 0 0 0 12px rgba(255,107,53,0); }
        }
      `}</style>

      <div style={{
        width: "100%",
        maxWidth: 360,
        animation: "fadeSlideUp 0.5s ease forwards",
      }}>

        {/* Header */}
        <div style={{ textAlign: "center", marginBottom: 32 }}>
          <div style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 8,
            background: "rgba(255,107,53,0.12)",
            border: "1px solid rgba(255,107,53,0.25)",
            borderRadius: 100,
            padding: "6px 16px",
            marginBottom: 16,
          }}>
            <span style={{ fontSize: 14 }}>🏃</span>
            <span style={{
              fontSize: 11,
              fontWeight: 700,
              letterSpacing: "0.1em",
              textTransform: "uppercase",
              color: "#FF6B35",
              fontFamily: "'DM Mono', monospace",
            }}>PaceRank</span>
          </div>
          <h1 style={{
            fontSize: 22,
            fontWeight: 700,
            color: "#FFFFFF",
            letterSpacing: "-0.02em",
            marginBottom: 6,
          }}>Ajouter un résultat</h1>
          <p style={{ fontSize: 13, color: "#6B7280" }}>
            Fais défiler pour régler ton temps
          </p>
        </div>

        {/* Picker Card */}
        {!confirmed ? (
          <div style={{
            background: "#1A1D27",
            borderRadius: 24,
            padding: "28px 24px 24px",
            border: "1px solid rgba(255,255,255,0.06)",
            animation: animateOut ? "fadeSlideDown 0.4s ease forwards" : "none",
          }}>

            {/* Live time display */}
            <div style={{
              textAlign: "center",
              marginBottom: 24,
              padding: "12px 0",
              borderBottom: "1px solid rgba(255,255,255,0.06)",
            }}>
              <div style={{
                fontFamily: "'DM Mono', monospace",
                fontSize: 42,
                fontWeight: 600,
                color: "#FFFFFF",
                letterSpacing: "0.04em",
                lineHeight: 1,
              }}>
                {formatTime()}
              </div>
              {getPaceLabel() && (
                <div style={{
                  marginTop: 8,
                  fontSize: 12,
                  color: "#6B7280",
                  fontFamily: "'DM Mono', monospace",
                }}>
                  ≈ {getPaceLabel()}
                </div>
              )}
            </div>

            {/* Drums */}
            <div style={{
              display: "flex",
              alignItems: "flex-start",
              justifyContent: "center",
              gap: 4,
            }}>
              <DrumPicker
                values={hoursArr}
                selected={hours}
                onChange={setHours}
                label="Heures"
              />
              <Sep />
              <DrumPicker
                values={minsArr}
                selected={minutes}
                onChange={setMinutes}
                label="Minutes"
              />
              <Sep />
              <DrumPicker
                values={secsArr}
                selected={seconds}
                onChange={setSeconds}
                label="Secondes"
              />
            </div>

            {/* Quick presets */}
            <div style={{ marginTop: 20 }}>
              <p style={{
                fontSize: 11,
                color: "#4B5563",
                textAlign: "center",
                marginBottom: 10,
                fontFamily: "'DM Mono', monospace",
                letterSpacing: "0.08em",
                textTransform: "uppercase",
              }}>Raccourcis</p>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "center" }}>
                {[
                  { label: "25:00", h: 0, m: 25, s: 0 },
                  { label: "45:00", h: 0, m: 45, s: 0 },
                  { label: "1:00:00", h: 1, m: 0, s: 0 },
                  { label: "1:30:00", h: 1, m: 30, s: 0 },
                  { label: "3:30:00", h: 3, m: 30, s: 0 },
                ].map(({ label, h, m, s }) => (
                  <button
                    key={label}
                    onClick={() => { setHours(h); setMinutes(m); setSeconds(s); }}
                    style={{
                      background: "rgba(255,107,53,0.08)",
                      border: "1px solid rgba(255,107,53,0.2)",
                      borderRadius: 8,
                      padding: "5px 10px",
                      color: "#FF6B35",
                      fontSize: 12,
                      fontFamily: "'DM Mono', monospace",
                      fontWeight: 500,
                      cursor: "pointer",
                      transition: "all 0.15s ease",
                    }}
                    onMouseEnter={e => e.target.style.background = "rgba(255,107,53,0.18)"}
                    onMouseLeave={e => e.target.style.background = "rgba(255,107,53,0.08)"}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>

            {/* Confirm button */}
            <button
              onClick={handleConfirm}
              disabled={totalSeconds === 0}
              style={{
                marginTop: 24,
                width: "100%",
                padding: "15px",
                background: totalSeconds === 0
                  ? "rgba(255,107,53,0.2)"
                  : "linear-gradient(135deg, #FF6B35, #FF8C42)",
                border: "none",
                borderRadius: 14,
                color: totalSeconds === 0 ? "rgba(255,255,255,0.3)" : "#FFFFFF",
                fontSize: 15,
                fontWeight: 700,
                fontFamily: "'DM Sans', sans-serif",
                cursor: totalSeconds === 0 ? "not-allowed" : "pointer",
                letterSpacing: "0.01em",
                transition: "all 0.2s ease",
                animation: totalSeconds > 0 ? "pulse 2s infinite" : "none",
              }}
            >
              Enregistrer {totalSeconds > 0 ? formatTime() : ""}
            </button>
          </div>
        ) : (
          /* Confirmation */
          <div style={{
            background: "#1A1D27",
            borderRadius: 24,
            padding: "40px 24px",
            border: "1px solid rgba(255,255,255,0.06)",
            textAlign: "center",
            animation: "popIn 0.5s ease forwards",
          }}>
            <div style={{
              width: 72, height: 72,
              background: "linear-gradient(135deg, #FF6B35, #FF8C42)",
              borderRadius: "50%",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 32,
              margin: "0 auto 20px",
              boxShadow: "0 0 30px rgba(255,107,53,0.4)",
            }}>✓</div>

            <h2 style={{
              fontSize: 20,
              fontWeight: 700,
              color: "#FFFFFF",
              marginBottom: 8,
            }}>Temps enregistré !</h2>

            <div style={{
              fontFamily: "'DM Mono', monospace",
              fontSize: 38,
              fontWeight: 600,
              color: "#FF6B35",
              margin: "16px 0",
            }}>
              {formatTime()}
            </div>

            {getPaceLabel() && (
              <div style={{
                fontSize: 13,
                color: "#6B7280",
                fontFamily: "'DM Mono', monospace",
                marginBottom: 28,
              }}>
                {getPaceLabel()}
              </div>
            )}

            <button
              onClick={handleReset}
              style={{
                background: "rgba(255,255,255,0.06)",
                border: "1px solid rgba(255,255,255,0.1)",
                borderRadius: 12,
                padding: "11px 24px",
                color: "#9CA3AF",
                fontSize: 13,
                fontWeight: 500,
                cursor: "pointer",
                fontFamily: "'DM Sans', sans-serif",
              }}
            >
              Modifier le temps
            </button>
          </div>
        )}

      </div>
    </div>
  );
}
