# Bug iOS PWA standalone — viewport bloqué après clavier

## ✅ RÉSOLU le 2026-05-16

Bug fixé par la combinaison de 2 commits :

1. **`3972952`** (2026-05-15) : reset du scroll via setTimeout 400ms + force-reflow `document.body.offsetHeight` à la cleanup du `Modal`. Fixait le `scrollY=122` stuck mais le viewport restait à 812 (au lieu de 874).

2. **`4a85993`** (2026-05-16) : `height: 100dvh` → `height: 100vh` sur le conteneur root de `App`. La `dvh` était figée à la taille reduite par le clavier (812) même après sa fermeture ; `vh` reste à la LARGER viewport (= 874 toujours) → la NavBar `position: fixed; bottom: 0` revient pile au bord bas.

## Symptôme original

Sur iPhone PWA standalone uniquement :
1. Crew → Créer → tape dans champ "Nom" → clavier monte
2. Ferme le modal → clavier descend visuellement
3. Bande sombre persistante entre la NavBar et le bord bas de l'écran (62-122 px selon le device)

## Diagnostic en debug live

Helper M() dans la console Web Inspector pour mesurer
`window.innerHeight`, `visualViewport.height`, `visualViewport.offsetTop`,
`window.scrollY`, `document.documentElement.scrollTop`.

### Évolution des mesures

| Étape | innerH | vvH | vvOT | scrollY | docScroll |
|---|---|---|---|---|---|
| Baseline | 874 | 874 | 0 | 0 | 0 |
| Clavier ouvert | 690 | 471 | 122 | 122 | 122 |
| Modal fermé (avant fix) | **690** | **471** | **122** | **122** | **122** | ← TOUT stuck |
| Modal fermé (après 3972952) | 812 | 812 | 0 | 0 | 0 | ← scroll OK mais innerH/vvH stuck à 812 |
| Modal fermé (après 4a85993) | (vh = 874 forcé via CSS) | 812 | 0 | 0 | 0 | ← UI correcte, vvH reste stuck mais NavBar via vh ne s'en soucie plus |

## Pourquoi le bug existe-t-il

iOS Safari **standalone** (PWA installée depuis l'écran d'accueil) gère
mal le retour à l'état initial après une interaction clavier. Plusieurs
variables système ne se restaurent pas :

- `window.innerHeight` reste à la valeur réduite (≈ baseline - hauteur QuickType bar)
- `visualViewport.height` idem
- `window.scrollY` peut rester à la valeur de scroll induite par iOS pour ramener l'input dans la visible area

En Safari (mode browser), le bug ne se reproduit PAS — la barre URL absorbe le shift et iOS restaure le viewport normalement.

## Tentatives ratées (pour mémoire — ne pas re-essayer)

Tous revertés. Voir [git log] pour les diffs précis.

| Commit | Approche | Pourquoi raté |
|---|---|---|
| `5643c26` | scrollTo(prevScrollY) sur next frame à la cleanup du Modal | Timing trop précoce, iOS n'a pas fini |
| `a933f3e` | Scroll-lock via `body.style.position="fixed"; top:-scrollY` | A cassé d'autres modals (effet visible même sur AddPickerModal sans input) |
| `b6acb1a` | Blur input + listener global visualViewport.resize → scrollTo(0,0) | Sans effet (pas de reflow forcé) |
| `38a3ca2` | Bypass 100dvh via state `window.innerHeight` tracké en JS | innerHeight était lui-même stuck → useless |
| `bfd5e71` | App root `position:fixed;inset:0` + NavBar en flex item | A cassé le rendering à l'ouverture (safe-area pas couverte) |

## Méthode de debug live

Pour les prochains bugs iOS de ce style :

1. Sur Mac : Safari → Réglages → Avancé → "Afficher Développement"
2. Sur iPhone : Réglages → Safari → Avancé → Inspecteur Web ON
3. Brancher iPhone Mac via USB
4. **Important : tester en mode standalone PWA** — Safari mode ne reproduit pas (la toolbar absorbe les shifts)
5. Mac → Safari → menu Développement → ton iPhone → la PWA
6. Coller le helper M() (cf. ci-dessous) dans la console et faire 3 mesures : baseline / clavier ouvert / modal fermé

### Helper M()

```js
window.M = () => {
  const vv = window.visualViewport || {};
  const out = {
    innerH: window.innerHeight,
    vvH: vv.height,
    vvOT: vv.offsetTop,
    scrollY: window.scrollY,
    docScroll: document.documentElement.scrollTop,
  };
  console.log('📐', JSON.stringify(out));
  return out;
};
```

## Limitation HTTPS pour dev local

iOS Safari ne permet **pas** l'installation en PWA standalone d'un site servi en HTTP. Le dev local `http://192.168.1.37:5173` se contente d'un bookmark, pas un vrai PWA. Pour itérer avec HMR sur ce type de bug, soit :

- Setup HTTPS local via `vite-plugin-mkcert` (plugin Vite qui génère un certif local, à accepter sur l'iPhone une fois)
- Ou push/déploie sur prod à chaque essai (lent : 2 min/cycle, mais simple)
