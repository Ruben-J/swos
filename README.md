# Pitch Legend

Browser-native, pixel-art top-down arcadevoetbal met een diepe carrièremodus.
Een originele, juridisch schone spirituele opvolger in de geest van klassieke
top-down voetbalgames — **geen** kopie van bestaande merken, data of assets.

Speelbare wedstrijd én een werkende carrièremodus; doorlopend in ontwikkeling.

## Monorepo

```
packages/
  shared    — datamodel-types, seedbare RNG, 2D-math, constanten
  engine    — pure game-runtime: fixed-step sim, balmodel, AI, camera, input, loop
  render    — PixiJS WebGL-renderer met snapshot-interpolatie
  sim-data  — fictieve team-/spelergenerator (volledig verzonnen namen)
apps/
  web       — Vite + React app-shell (menu, match-scherm, HUD, audio, storage)
```

De **simulatie is framework-agnostisch en deterministisch** (seedbare RNG, vaste
timestep): dezelfde seed + dezelfde input geeft exact dezelfde wedstrijd. React
raakt de match-tick nooit aan — strikte scheiding tussen shell en game-runtime.

## Commando's

| Commando | Doel |
|---|---|
| `pnpm install` | Dependencies installeren (vereist pnpm 9+) |
| `pnpm dev` | Dev-server (Vite) op http://localhost:5173 |
| `pnpm test` | Vitest (sim, balfysica, AI, RNG-determinisme, career) |
| `pnpm typecheck` | TypeScript over alle packages |
| `pnpm lint` | ESLint |
| `pnpm build` | Productiebuild (statische site, geconfigureerd voor GitHub Pages onder `/swos/`) |

## Besturing

- **WASD / pijltjes** — bewegen (8 richtingen)
- **X** — pass naar de teamgenoot waar je naartoe stuurt (keeper: strakke uitworp)
- **Z** — schot; vasthouden laadt hoogte/kracht (keeper: verre uittrap)
- **Shift** (of **K**) — sprint; sturen tijdens het aftertouch-venster na de trap = effect/curve/loft
- **L / Tab** — handmatig van speler wisselen
- **Esc** — wedstrijd verlaten
- **Gamepad** wordt ondersteund (linkerstick + knoppen)

## Wat zit erin

**Wedstrijd**
- Deterministische fixed-step simulatie met "muzikaal" bestuurbaar balmodel
  (aftertouch, curve, loft, stuiteren, boarding).
- Drielagen-AI (tactisch / situationeel / actie): zoneverdediging, vrijlopen,
  interceptie-predictie, lane-aware passing, voorzet-anticipatie (box-runs),
  opbouwende keeper-distributie.
- Keeper-duiken & -reddingen, sliding tackles op het voetpunt (met vallende
  speler), set-pieces (in-/doeltrap, hoek, vrije trap, strafschop),
  formatie-presets + teamtactiek.
- SWOS-achtige pixel-art: spelers, scheidsrechter, stadion met publiek in
  teamkleuren + uitvak, reclameborden, cornervlaggen, doelpunt-vieringen.
- Radar/minimap, procedureel gegenereerde clubwapens, zichtbaar dribbelritme.
- Audio: stadion-bed dat aanzwelt bij het doel, gejuich, scheidsrechtersfluit
  (overtreding/hervatting), balcontacten en reddings-reacties.

**Carrière**
- Wereld met meerdere landen en divisies, seizoenskalender en quicksim van alle
  competities; standen en topscorers per competitie.
- Selectie, training, jeugdopleiding, transfers (incl. AI-onderhandelingen),
  financiën, beker- en Europese toernooien, baanbiedingen.
- Opslaan/laden met versiebeheer + migratieharnas (IndexedDB).

## Juridisch

Alle clubs, spelers, competities en assets zijn fictief en zelf gegenereerd.
Zie `docs/asset-origin-ledger.md`. Audiosamples zijn royalty-vrij; bronnen staan
in `apps/web/public/audio/CREDITS.md`. Geen beschermde merknamen, logo's,
sprites of gelicentieerde datasets.
