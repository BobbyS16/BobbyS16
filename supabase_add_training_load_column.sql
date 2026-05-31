-- Ajout d'une colonne training_load (charge d'entraînement Garmin / Polar /
-- Suunto / Apple Watch). Si renseignée, le calcul des points utilise
-- directement TL × 0.4 (calibration empirique) au lieu de la formule
-- basée sur l'allure moyenne.
--
-- Appliqué le 2026-05-22 via MCP (migration add_training_load_column).
--
-- Avantage : capture l'effort réel HR-based, donc plus précis pour
-- fractionné / VMA où l'allure moyenne sous-estime l'effort.
--
-- Calibration empirique du facteur 0.4 :
--   TL 75  (easy 1h)    → 30 pts  (vs ~36 formule old)
--   TL 150 (quality 1h) → 60 pts  (vs ~63 formule old)
--   TL 250 (long 1h30)  → 100 pts (vs ~115 formule old)
--   TL 400 (marathon)   → 160 pts (vs ~187 formule old)

alter table public.trainings
  add column if not exists training_load int;

comment on column public.trainings.training_load is
  'Charge entraînement style Garmin (TRIMP-exp HR-based). Si présent, points = TL * 0.4. Sinon, fallback formule pace-based.';
