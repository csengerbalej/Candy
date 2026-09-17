# CANDYPOCALYPSE

Kétfős halloween-kaland böngészőben. Valaki üveg alá zárta a várost, mint egy
cukorkát — egy éjszakátok van.

A játék két félidőből áll. **Kint vezettek** egy 540 egység átmérőjű városban:
jelzőlámpák, zebrák, körpálya, szörnyecske-forgalom, és egy kihívás, amit le
kell tenni, mielőtt a célház parkolója kinyílik. **Bent loptok**: három
különböző lakás, mindegyik más játékot kér — az első tanít, a második
vaksötét, a harmadikban ketten vadásznak rád.

A társad egy **másik eszközről**, ugyanazzal a linkkel lép be.

## Indítás

```bash
npm install
npm run dev
```

## A mérések

Ez a projekt egy szabályra épül: **minden panaszt méréssel kell diagnosztizálni,
nem szemre.** Több mint 150 automata állítás fut a játék mögött, és mindegyik
egy konkrét, egyszer már elkövetett hibát őriz.

```bash
npm run probe:all
```

Néhány, amit ezek fogtak meg — egyik sem adott hibaüzenetet, mind csendben
rontotta a játékot:

- A lakó **hatvan másodperc alatt nulla egységet** tett meg mind a három
  házban, mert a járőrpontjai a *játékos* méretére készültek, ő pedig több
  mint kétszer olyan széles.
- A járda **úttestnek számított**, mert a szegély 15 centi volt, a mérés
  tűrése 30 — így a járdára hajtás soha nem járt következménnyel.
- A kocsi **40 km/h-t mutatott, miközben hat másodperc alatt négy egységet**
  haladt: a képkocka-hurok legfeljebb 0,1 másodpercet tudott behozni, tehát a
  világ lassított felvételben ment.
- A lakó zseblámpakúpja **körvonalat kapott** — egy húsz egység széles tömör
  héjat —, és az volt a képet betöltő „nagy fehér".

A szkriptek kommentjei nem azt írják le, mit csinál a kód, hanem **miért így**:
mi volt előtte, mi romlott el tőle, és mit mért a javítás.

## Felépítés

| mappa | mi van benne |
|---|---|
| `src/` | a játék (TypeScript, three.js) |
| `tools/` | a mérések és az eszközsütő folyamat (Blender, gltf-transform) |
| `public/` | a kisütött modellek, hangok, képek |

A `raw/` (nyers letöltések, 937 MB) nincs verziókövetve — amit a játék
használ, az sütve van a `public/` alatt.

## Licencek

A hangok a Freesoundról, CC0 licenccel:
[Renault 19](https://freesound.org/people/lovretta/sounds/141240/) ·
[Peugeot 308](https://freesound.org/people/Nox_Sound/sounds/522221/) ·
[BMW M6](https://freesound.org/people/Kinoton/sounds/478597/)
