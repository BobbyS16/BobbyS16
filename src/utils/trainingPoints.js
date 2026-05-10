// ────────────────────────────────────────────────────────────────────────────
// PaceRank — calcul des points d'entraînement (approximation EPOC)
// ────────────────────────────────────────────────────────────────────────────

const DISCIPLINE_COEF = {
  running:  1.0,
  trail:    1.0,
  cycling:  0.6,
  swimming: 1.15,
};

function intensityForRunning(paceSecPerKm) {
  if (paceSecPerKm < 210) return 10;
  if (paceSecPerKm < 240) return 9;
  if (paceSecPerKm < 270) return 8;
  if (paceSecPerKm < 315) return 7;
  if (paceSecPerKm < 360) return 6;
  if (paceSecPerKm < 420) return 5;
  if (paceSecPerKm < 510) return 4;
  return 3;
}

function intensityForCycling(speedKmh) {
  if (speedKmh > 40)  return 10;
  if (speedKmh >= 35) return 8;
  if (speedKmh >= 30) return 7;
  if (speedKmh >= 25) return 6;
  if (speedKmh >= 20) return 5;
  return 4;
}

function intensityForSwimming(paceSecPer100m) {
  if (paceSecPer100m < 90)   return 10;
  if (paceSecPer100m <= 100) return 8;
  if (paceSecPer100m <= 115) return 7;
  if (paceSecPer100m <= 130) return 6;
  if (paceSecPer100m <= 150) return 5;
  if (paceSecPer100m <= 180) return 4;
  return 3;
}

export function calculateTrainingPoints({
  discipline,
  duration_min,
  distance_km,
  elevation_gain_m,
  pace_or_speed,
}) {
  let baseIntensity;
  if (discipline === "running" || discipline === "trail") {
    baseIntensity = intensityForRunning(pace_or_speed);
  } else if (discipline === "cycling") {
    baseIntensity = intensityForCycling(pace_or_speed);
  } else if (discipline === "swimming") {
    baseIntensity = intensityForSwimming(pace_or_speed);
  } else {
    throw new Error(`Discipline inconnue: ${discipline}`);
  }

  let adjustedIntensity = baseIntensity;
  if (discipline === "trail") {
    if (elevation_gain_m == null) throw new Error("elevation_gain_m obligatoire pour trail");
    const bonus = (elevation_gain_m / distance_km) / 100 * 0.8;
    adjustedIntensity = baseIntensity * (1 + bonus);
  } else if (discipline === "cycling") {
    if (elevation_gain_m == null) throw new Error("elevation_gain_m obligatoire pour cycling");
    const pente_pct = (elevation_gain_m / (distance_km * 1000)) * 100;
    const bonus = pente_pct * 0.04;
    adjustedIntensity = baseIntensity * (1 + bonus);
  }

  adjustedIntensity = Math.min(adjustedIntensity, 12);

  const coef = DISCIPLINE_COEF[discipline];
  const points = duration_min * Math.pow(adjustedIntensity, 1.92) * coef * 0.02;
  return Math.round(points);
}

// Tests de validation au chargement du module
const TESTS = [
  { name: "Course 60min, pace 360",        expected: 26, params: { discipline:"running",  duration_min:60,  distance_km:10, elevation_gain_m:0,    pace_or_speed:360 } },
  { name: "Course 45min, pace 270",        expected: 38, params: { discipline:"running",  duration_min:45,  distance_km:10, elevation_gain_m:0,    pace_or_speed:270 } },
  { name: "Trail 105min, 1000m D+, p420",  expected: 68, params: { discipline:"trail",    duration_min:105, distance_km:15, elevation_gain_m:1000, pace_or_speed:420 } },
  { name: "Vélo 120min, 1200m D+, v30",    expected: 70, params: { discipline:"cycling",  duration_min:120, distance_km:60, elevation_gain_m:1200, pace_or_speed:30  } },
  { name: "Natation 25min, pace 150",      expected: 13, params: { discipline:"swimming", duration_min:25,  distance_km:1,  elevation_gain_m:null, pace_or_speed:150 } },
];

console.log("[calculateTrainingPoints] Tests de validation :");
TESTS.forEach(t => {
  const got = calculateTrainingPoints(t.params);
  const diff = Math.abs(got - t.expected) / t.expected * 100;
  const ok = diff <= 5;
  console.log(`  ${ok ? "✓" : "✗"} ${t.name} → ${got} pts (attendu ~${t.expected}, écart ${diff.toFixed(1)}%)`);
});
