# Inventaris rookkoepels en gasinstallaties

Webapp om rookkoepels en gasinstallaties in de gebouwen van de organisatie te inventariseren, met locatie en foto per onderdeel. Werkt op PC en smartphone; op de smartphone opent "Foto nemen" rechtstreeks de camera.

## Wat wordt geregistreerd

**Rookkoepels**
- Gebouw en nummer (automatisch RK-01, RK-02, …)
- Koepel: gang, verdiep, foto
- Bediening: lokaal, verdiep, foto

**Gasinstallaties** (gebouw en naam, automatisch GAS-01, …)
- Gasinstallatie, ketels, noodknop, gasklep, gasdetectie
- Per onderdeel: lokaal/plaats, verdiep, opmerking, foto. Van elk onderdeel kunnen er meerdere zijn.

**Excel-export**: tabbladen *Rookkoepels* en *Gasinstallaties*, met filters en optioneel de foto's als miniatuur in de cellen. Exporteren kan voor alle gebouwen of voor één gebouw.

## Opbouw

Eén bestand, `index.html`, zonder buildstap.

- Excel wordt gemaakt met [ExcelJS](https://github.com/exceljs/exceljs) 4.4.0, geladen via jsDelivr op het moment van exporteren.
- Foto's worden in de browser verkleind tot max. 1600 px (JPEG).
- Opslag:
  - **Als Claude-artifact** gebruikt de app de gedeelde opslag van het artifact (`db` voor de fiches, `assets` voor de foto's). Gegevens zijn dan gelijk op PC en gsm.
  - **Los geopend** (bv. via GitHub Pages of als lokaal bestand) valt de app terug op IndexedDB: de gegevens blijven dan alleen in die browser op dat toestel. Voor gedeelde opslag buiten Claude is nog een backend nodig.

## Datamodel

Elke fiche is één document:

```js
// Rookkoepel
{ soort: "rookkoepel", gebouw, code, opmerking, aangemaakt, gewijzigd,
  koepel:    { gang, verdiep, foto },
  bediening: { lokaal, verdiep, foto } }

// Gasinstallatie
{ soort: "gas", gebouw, code, opmerking, aangemaakt, gewijzigd,
  onderdelen: { gasinstallatie: [...], ketels: [...], noodknop: [...], gasklep: [...], gasdetectie: [...] } }
// elk onderdeel: { lokaal, verdiep, opmerking, foto }
```

`foto` is een verwijzing naar de opgeslagen foto (asset-id in Claude, `local:<id>` in IndexedDB).

## Lokaal proberen

Open `index.html` in een browser, of start een eenvoudige webserver in deze map (bv. `python3 -m http.server`) en surf naar http://localhost:8000.
