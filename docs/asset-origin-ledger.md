# Asset-origin ledger

Bijhouden van de herkomst van elke asset/dataset, zodat de publieke build
aantoonbaar alleen materiaal met schone herkomst bevat (zie juridische sectie
van `deep-research-report.md`). Elke nieuwe asset krijgt hier een regel.

## Principes

- **Geen** productnaam "Sensible Soccer"/"SWOS"; geen overgenomen logo's of clubwapens.
- **Geen** overgenomen sprites, UI, box-art of pitchgraphics van bestaande games.
- **Geen** geripte of te dicht nagebootste muziek/SFX.
- **Grafische assets** (sprites, logo's, clubwapens, kits, audio) zijn **volledig zelfgemaakt**.
- **Data-aanpak (gewijzigd 2026-06-17):** competities/clubs/spelers zijn gebaseerd op de
  **echte voetbalwereld** maar met **verbasterde namen** — herkenbaar, niet identiek
  (SWOS-stijl: "Manchester Red", "Barcedona", "L. Mossi"). De speler kan namen aanpassen in
  een editor. De verbasteringslaag staat centraal in `sim-data` zodat namen op één plek te
  tunen zijn.

> ⚠️ **Juridische kanttekening (bewuste keuze gebruiker):** herkenbaar-verbasterde echte
> clubs/competities/spelers wijken af van de eerdere "volledig fictieve" lijn en dragen
> méér IP-/persoonlijkheidsrechten-risico (merk, handelsnaam, portret/naamrechten van
> spelers, databankenrecht). Bewust gekozen voor herkenbaarheid. Vóór een commerciële of
> publieke launch hierop juridisch advies inwinnen; voor een privé/hobby-build is de
> blootstelling beperkt. Grafische merken (logo's/kits) blijven hoe dan ook origineel.

## Register

| Asset / dataset | Type | Herkomst | Licentie | Status |
|---|---|---|---|---|
| Spelernamen, clubnamen, steden, landcodes | Data | Echte voetbalwereld, **verbasterd** (herkenbaar≠identiek), `packages/sim-data/src/names.ts` | Eigen verbastering van publieke feiten | TODO: ombouwen van fictief → verbasterde echte dataset |
| Teams/spelers/attributen | Data | Gebaseerd op echte clubs/spelers, namen verbasterd, `packages/sim-data/src/generate.ts` | Eigen werk + verbasteringslaag | TODO: dataset ombouwen |
| Spelers/bal/veld rendering | Graphics | Runtime-getekende vectorvormen (PixiJS `Graphics`), geen bitmaps | Eigen werk | OK (placeholder) |
| Productnaam "Pitch Legend" | Merk | Werktitel | Nog niet gecheckt | TODO: merkcheck BOIP/EUIPO vóór publieke launch |
| Audio (SFX/muziek) | Audio | Nog niet toegevoegd | — | TODO bij Fase 6 |
| Pixel-art sprites | Graphics | Nog niet toegevoegd (nu vectorplaceholders) | — | TODO: eigen sprite-pipeline (Fase 1+/2) |

## Openstaande juridische acties

- Merknaam + logo vooraf checken bij BOIP/EUIPO vóór commerciële/publieke launch.
- Bij toevoegen van audio: eigen composities of correct gelicenseerde packs, met bron in dit register.
- Namen verbasterd houden (niet identiek aan origineel) en de verbasteringslaag in `sim-data`
  centraal houden, zodat afstand tot de echte tekens aantoonbaar is.
- Vóór commerciële/publieke launch: juridisch advies over verbasterde echte clubs/spelers
  (merk, portret-/naamrechten, databankenrecht). Logo's/kits/wapens blijven origineel.
