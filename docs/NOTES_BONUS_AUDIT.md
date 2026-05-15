# Audit des points bonus — 2026-05-15

Audit complet des 11 types de bonus existants : ce qui est promis dans
`HowItWorksModal` vs ce qui est implémenté en code JS / triggers DB / attribué.

## Matrice

| Type | Mécanique | Pts | Doc help | Code | DB attribué | Verdict |
|---|---|---|---|---|---|---|
| `first_race` | 1ʳᵉ course saison | +30 | ✅ | JS (`raceBonusBreakdown`) | live | OK |
| `streak_week` | 7j consécutifs | +100 | ✅ | JS (`trainingBonusBreakdown`) | live | OK |
| `streak_month` | 30j consécutifs | +500 | ✅ | JS (`trainingBonusBreakdown`) | live | OK |
| `monthly_100km` | ≥100km/mois | +200 | ✅ | JS (`trainingBonusBreakdown`) | live | OK |
| `pr_beaten` | PR battu | +50 | ✅ | trigger `award_pr_bonus` | 4× | OK |
| `weekly_streak` | Semaine ≥3 entr | +5 | ✅ (§7) | trigger `award_weekly_streaks` | 3× | OK |
| `signup` | Inscription | +5 | **❌** | trigger `award_signup_and_invitation_bonuses` | **14×** | **NON DOCUMENTÉ** |
| `invitation` | Parrainer un ami | +5 | **❌** | trigger `award_signup_and_invitation_bonuses` | **0×** | **À CREUSER** |
| `prono_exact` | Prono à 30s près | +200 | ✅ (§3) | trigger `distribute_prono_points` | 0× | En attente courses finies |
| `prono_closest` | Prono le plus proche | +100 | ✅ (§3) | trigger `distribute_prono_points` | 0× | En attente courses finies |
| `prono_participation` | Participation prono | +5 | ✅ (§3) | trigger `distribute_prono_points` | 0× | En attente courses finies |

Au 2026-05-15 : 7 pronos placés sur 5 courses, mais aucune n'est encore finie+
classifiée donc distribute_prono_points n'a pas encore tourné. Normal.

Bonus déjà retirés du doc lors d'un précédent audit (commit `905e570`) :
- Top 3 catégorie +300 — jamais implémenté
- Top 10% catégorie +150 — jamais implémenté

## Actions restantes

1. **Ajouter au modal `HowItWorksModal` section "6 · Points bonus"** :
   - `🎉 Bonus inscription` → +5 pts (one-shot, à la création du compte)
   - `🤝 Bonus parrainage d'un ami` → +5 pts par ami parrainé

2. **Investiguer le bonus `invitation`** : trigger existe mais 0 attribué.
   - Soit le flow UI d'invitation n'existe pas / n'insère pas de row
   - Soit la condition du trigger ne se déclenche jamais
   - Lire `supabase_point_bonuses_v1.sql` (la migration source) pour comprendre
     ce qui doit fire le trigger
   - Y a-t-il une table `friendships` qui trigger ça à l'ajout d'un ami ? Ou
     une table `invitations` séparée qui n'existe pas encore ?
