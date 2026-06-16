# Pitch Legend

Browser-native, pixel-art top-down arcadevoetbal met een diepe carrièremodus.
Een originele, juridisch schone spirituele opvolger in de geest van klassieke
top-down voetbalgames — **geen** kopie van bestaande merken, data of assets.

Implementatie volgt `docs/deep-research-report.md`, gefaseerd (zie het
implementatieplan). Dit is een work-in-progress; momenteel opgeleverd:
**Fase 0 (scaffold)** + **Fase 1 (speelbare wedstrijd / vertical slice)**.

## Monorepo

```
packages/
  shared    — datamodel-types, seedbare RNG, 2D-math, constanten
  engine    — pure game-runtime: fixed-step sim, balmodel, AI, camera, input, loop
  render     — PixiJS WebGL-renderer met snapshot-interpolatie
  sim-data  — fictieve team-/spelergenerator (volledig verzonnen namen)
apps/
  web       — Vite + React app-shell (menu, match-scherm, HUD, storage)
```

De **simulatie is framework-agnostisch en deterministisch** (seedbare RNG, vaste
timestep): dezelfde seed + dezelfde input geeft exact dezelfde wedstrijd. React
raakt de match-tick nooit aan — strikte scheiding tussen shell en game-runtime.

## Commando's

| Commando | Doel |
|---|---|
| `pnpm install` | Dependencies installeren (vereist pnpm 9+) |
| `pnpm dev` | Dev-server (Vite) op http://localhost:5173 |
| `pnpm test` | Vitest (sim, balfysica, RNG-determinisme) |
| `pnpm typecheck` | TypeScript over alle packages |
| `pnpm lint` | ESLint |
| `pnpm build` | Productiebuild van alle packages + web |

## Besturing (vertical slice)

- **WASD / pijltjes** — bewegen (8 richtingen)
- **Space** — tik = pass naar dichtstbijzijnde teamgenoot, vasthouden = schot/lange bal
- **Shift** — sprint; sturen tijdens het aftertouch-venster na de trap = effect/curve/loft
- **Gamepad** wordt ondersteund (linkerstick + knoppen)

## Status & roadmap

- [x] Fase 0 — scaffold, datamodel, save-/migratielaag, CI
- [x] Fase 1 — speelbare wedstrijd: balmodel, input, AI-switching, camera, HUD
- [x] Fase 2 — diepere AI & tactiek: drielagen (tactisch/situationeel/actie), zone-verdediging, support, interceptie-predictie, lane-aware passing, keeper-saves, set-pieces (in-/doeltrap/hoek), formatie-presets + tactics
- [ ] Fase 3 — career alpha (kalender, squad, transfers, financiën, saves)
- [ ] Fase 4 — career beta (training, jeugd, scouting, reputatie, multi-league)
- [ ] Fase 5 — online 1v1 (authoritative)
- [ ] Fase 6 — content & polish (audio, accessibility, QA)

## Juridisch

Alle clubs, spelers, competities en assets zijn fictief en zelf gegenereerd.
Zie `docs/asset-origin-ledger.md`. Geen beschermde merknamen, logo's, sprites,
audio of gelicentieerde datasets.
