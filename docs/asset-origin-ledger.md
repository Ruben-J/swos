# Asset-origin ledger

Bijhouden van de herkomst van elke asset/dataset, zodat de publieke build
aantoonbaar alleen materiaal met schone herkomst bevat (zie juridische sectie
van `deep-research-report.md`). Elke nieuwe asset krijgt hier een regel.

## Principes

- **Geen** beschermde merknamen of logo's ("Sensible Soccer", "SWOS", echte clubs/competities).
- **Geen** overgenomen sprites, UI, box-art of pitchgraphics van bestaande games.
- **Geen** geripte of te dicht nagebootste muziek/SFX.
- **Geen** bulkovername van echte spelers-/club-/competitiedatabases.
- Alle namen/teams/spelers worden **procedureel en fictief** gegenereerd (seedbaar).

## Register

| Asset / dataset | Type | Herkomst | Licentie | Status |
|---|---|---|---|---|
| Spelernamen, clubnamen, steden, landcodes | Data | Volledig verzonnen, `packages/sim-data/src/names.ts` | Eigen werk | OK |
| Teams/spelers/attributen | Data | Procedureel gegenereerd uit seed, `packages/sim-data/src/generate.ts` | Eigen werk | OK |
| Spelers/bal/veld rendering | Graphics | Runtime-getekende vectorvormen (PixiJS `Graphics`), geen bitmaps | Eigen werk | OK (placeholder) |
| Productnaam "Pitch Legend" | Merk | Werktitel | Nog niet gecheckt | TODO: merkcheck BOIP/EUIPO vóór publieke launch |
| Audio (SFX/muziek) | Audio | Nog niet toegevoegd | — | TODO bij Fase 6 |
| Pixel-art sprites | Graphics | Nog niet toegevoegd (nu vectorplaceholders) | — | TODO: eigen sprite-pipeline (Fase 1+/2) |

## Openstaande juridische acties

- Merknaam + logo vooraf checken bij BOIP/EUIPO vóór commerciële/publieke launch.
- Bij toevoegen van audio: eigen composities of correct gelicenseerde packs, met bron in dit register.
- Bij echte data/licenties: pas na expliciete licentie; anders fictieve wereld behouden.
