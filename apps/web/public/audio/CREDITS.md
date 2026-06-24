# Wedstrijd-audio — bronnen

Geluidssamples voor de wedstrijd, aangeleverd voor dit project. Bronbestanden
(Freesound community / Pixabay, royalty-vrij):

- `crowd-ambience.mp3` — stadion-/publieksbed (loop). Bron: freesound-community-football-crowd-3 (69245).
- `crowd-cheer.mp3` — gejuich met opbouw naar een piek (~t=2–3s). Bron: crowd-cheering (Pixabay, 379666).
- `whistle.mp3` — meerdere losse scheidsrechtersfluitjes (per event speelt er één). Bron: freesound-community-metal-whistle (6121).
- `ball-kick.mp3` — meerdere losse balcontact-geluiden (per event speelt er één). Bron: freesound-community-soccerballkick (6770).

De engine (`apps/web/src/match/audio.ts`) snijdt de losse fluit-/baltikken uit
via vooraf bepaalde tijdsegmenten en speelt het gejuich vanaf ~1s zodat de piek
kort na het doelpunt valt.
