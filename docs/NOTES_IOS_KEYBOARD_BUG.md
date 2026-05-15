# Bug iOS PWA standalone — viewport bloqué après clavier

## État au 2026-05-15 20h

Tentatives multiples sans résolution complète. **Le bug se reproduit uniquement
en mode PWA standalone, PAS en Safari.**

## Symptôme

Sur iPhone PWA installée :
1. Ouvrir un modal avec input (ex: Crew → Créer → champ "Nom")
2. Taper dans l'input → clavier s'ouvre, iOS scroll la window de ~122px
3. Fermer le modal → clavier disparaît visuellement
4. **MAIS** la window reste scrollée, le visualViewport reste offset
5. Résultat : bande sombre du bg root révélée sous la NavBar `position: fixed; bottom: 0`

## Mesures en debug live (`window.visualViewport` via Web Inspector)

### Avant ouverture du modal (état OK)
```
innerH: 874, vvHeight: 874, vvOffsetTop: 0, scrollY: 0
```

### Clavier ouvert dans le modal
```
innerH: 690, vvHeight: 471, vvOffsetTop: 122, scrollY: 122
```
→ iOS a scrollé window de 122px et offset visualViewport de 122px pour faire de la place au clavier.

### Après fermeture du modal (BUG : valeurs restent stuck)
```
innerH: 690, vvHeight: 471, vvOffsetTop: 122, scrollY: 122
```
→ **iOS ne restaure rien**. Même 2+ secondes après que le clavier ait visuellement disparu.

### Après reset manuel via console
```js
window.scrollTo(0,0);
document.documentElement.scrollTop=0;
document.body.offsetHeight; // ← force reflow, c'est LE sésame
```
Résultat :
```
innerH: 812, vvHeight: 812, vvOffsetTop: 0, scrollY: 0
```
→ **Tout revient à la normale.** Le force-reflow via `offsetHeight` est la clé. Sans lui, `scrollTo` seul est ignoré par iOS.

## Différence Safari vs PWA standalone

- En Safari iOS, après fermeture du modal, **tout revient automatiquement à la normale** (innerH=874, scrollY=0). La barre URL Safari absorbe le shift.
- En PWA standalone (no URL bar), iOS oublie de restaurer le viewport.

## Tentatives non-concluantes

Commits dans l'historique (chronologique) :

1. `5643c26` — `scrollTo(prevScrollY)` à la cleanup du Modal sur next frame. **Aucun effet.** (reverté `81e09c7`)
2. `a933f3e` — Scroll-lock complet via `body.style.position = "fixed"; top: -<scrollY>px`. **A empiré le bug** (effet sur AddPickerModal sans input). (reverté `81e09c7`)
3. `b6acb1a` — Blur input + listener global visualViewport.resize qui fait scrollTo(0,0) au resize >100px. **Aucun effet.**
4. `38a3ca2` — Bypass `100dvh` via state `window.innerHeight` tracké. **Aucun effet** car `innerHeight` lui-même est stuck en PWA. (reverté `ba746a5`)
5. `bfd5e71` — App root en `position: fixed; inset: 0` + NavBar sort de `position: fixed`. **A cassé l'app à l'ouverture** (safe-area non couverte). (reverté `cbe4f1f`)
6. `3972952` — Cleanup Modal : blur + `setTimeout(400ms, ()=>scrollTo + offsetHeight)`. **N'a pas fonctionné en test PWA prod.**

## Hypothèses pour la prochaine session

1. **Le setTimeout 400ms du fix `3972952` est trop court.** iOS PWA standalone peut prendre 600-800ms pour finir l'animation clavier. Tester avec un délai plus long, ou chain de rAF, ou écoute d'un signal iOS.

2. **Le fix s'exécute mais iOS le ré-écrase.** iOS pourrait dispatcher un évènement scroll AFTER notre reset. Solution : appliquer le reset plusieurs fois en cascade (à 0ms, 200ms, 500ms, 1000ms).

3. **Le force-reflow doit être sur un élément différent.** `document.body.offsetHeight` a marché manuellement, mais peut-être qu'au moment du cleanup il faut targeter `document.documentElement` ou `#root`.

4. **L'input doit perdre le focus AVANT que le modal s'unmount.** Si React unmount l'input avant que iOS finisse son blur process, l'évènement scroll peut rester en pending. Tester en appelant `blur()` puis `setTimeout(0)` avant de fermer le modal (côté composant qui ferme).

5. **Solution radicale : éviter le bug en empêchant iOS de scroller initialement.** Au lieu de réparer après, empêcher en mettant le modal positionné de telle sorte que l'input soit déjà dans la visible area (donc iOS n'a pas besoin de scroller). Plus de logique mais 0 cleanup nécessaire.

## Workflow de debug live qu'on a mis en place

Pour la prochaine session, gain de temps massif :

1. `npm run dev -- --host` sur le Mac → expose `http://192.168.1.37:5173` sur le wifi local
2. Sur iPhone, depuis Safari : `http://192.168.1.37:5173` → bouton Partager → "Sur l'écran d'accueil" pour installer en PWA-like
3. Ouvrir la PWA depuis l'écran d'accueil
4. Brancher iPhone Mac via USB → Safari Mac → Développement → ton iPhone → choisir la page PaceRank Dev
5. Inspecteur Web connecté au PWA local, HMR live, console interactive

Note : le user a finalement debug sur la PWA **prod** (pacerank.vercel.app) au lieu de l'install local, donc pas de HMR sur ce test. Pour la prochaine fois, vraiment installer le dev local en PWA.

## Helper M() pour mesurer en console

```js
window.M = () => {
  const vv = window.visualViewport || {};
  const out = {
    innerH: window.innerHeight,
    outerH: window.outerHeight,
    docClientH: document.documentElement.clientHeight,
    bodyClientH: document.body.clientHeight,
    vvHeight: vv.height,
    vvOffsetTop: vv.offsetTop,
    vvPageTop: vv.pageTop,
    vvScale: vv.scale,
    scrollY: window.scrollY,
    docScroll: document.documentElement.scrollTop,
    bodyScroll: document.body.scrollTop,
    rootHeight: document.getElementById('root')?.offsetHeight,
    rootChildHeight: document.getElementById('root')?.firstElementChild?.offsetHeight,
  };
  console.log('📐', JSON.stringify(out));
  return out;
};
```
