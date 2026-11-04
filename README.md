# Rookgas – inventaris rookkoepels en gasinstallaties

Webapp om rookkoepels en gasinstallaties in de gebouwen van de organisatie te inventariseren, met locatie en foto per onderdeel.
Werkt op PC en smartphone, en is op de smartphone te installeren als app (knop **App installeren**).
Op de smartphone opent **Foto nemen** rechtstreeks de camera.

De app is een statische pagina (GitHub Pages). Gegevens en foto's staan in Supabase, in hetzelfde project als de
veiligheidsrondes en de staalnamen. Wat je op de gsm ingeeft, staat meteen ook op de PC. Collega's melden zich aan
met een link die ze per e-mail krijgen; wie in de toegangslijst van de veiligheidsrondes staat, heeft ook hier toegang.

## Wat wordt geregistreerd

**Rookkoepels**: gebouw en nummer (automatisch RK-01, RK-02, …), de koepel (gang, verdiep, foto) en de bediening (lokaal, verdiep, foto).

**Gasinstallaties** (gebouw en naam, automatisch GAS-01, …): gasinstallatie, ketels, noodknop, gasklep en gasdetectie.
Per onderdeel lokaal/plaats, verdiep, opmerking en foto. Van elk onderdeel kunnen er meerdere zijn.
Bij ketels ook serienummer, vermogen (kW) en een tweede foto van het typeplaatje (optioneel).

**Excel-export**: tabbladen *Rookkoepels* en *Gasinstallaties*, met filters en optioneel de foto's als miniatuur in de cellen,
voor alle gebouwen of voor één gebouw.

## Eenmalige opzet

1. **Database**: open in Supabase de *SQL Editor*, plak de inhoud van [`supabase/schema.sql`](supabase/schema.sql) en klik *Run*.
   Het script maakt de tabellen `rookkoepels` en `gasinstallaties` en de privé-bucket `rookgas-fotos`.
2. **Aanmeldlink**: ga naar *Authentication > URL Configuration* en voeg bij *Redirect URLs* het adres van de app toe:
   `https://obscuritatis.github.io/rookgas/`.
3. **GitHub Pages**: repository > *Settings > Pages* > *Deploy from a branch* > `main` / `(root)`.
4. **Collega's toegang geven** (als ze nog niet in de lijst staan), in de SQL Editor:
   ```sql
   insert into public.toegang (email) values ('naam@voorbeeld.be');
   ```

## Installeren op de smartphone

- **Android (Chrome)**: open de app en tik op **App installeren** bovenaan.
- **iPhone/iPad (Safari)**: tik op **App installeren** voor de stappen, of rechtstreeks: *Deel* > *Zet op beginscherm*.
- **PC (Chrome/Edge)**: de knop **App installeren** werkt daar ook.

## Opbouw

- `index.html`: opmaak en schermen. `app.js`: werking. `config.js`: adres en publieke sleutel van het Supabase-project.
- `sw.js` + `manifest.webmanifest` + `icons/`: installeerbare app; de app opent ook zonder verbinding en toont foto's die al eens geladen werden.
- `vendor/`: supabase-js 2.116.0 en ExcelJS 4.4.0, op de site zelf. `fonts/`: Barlow Condensed en IBM Plex Sans.
- Foto's worden in de browser verkleind tot max. 1600 px (JPEG) en staan in de bucket onder `rookkoepels/<id>/` of `gasinstallaties/<id>/`.

## Beveiliging

- Een Content Security Policy in `index.html` laat alleen code van de site zelf toe en verbindt enkel met het eigen Supabase-project.
  Verandert het project, pas dan ook het adres in die regel aan.
- De publieke sleutel in `config.js` mag publiek staan: wie gegevens mag zien, bepaalt de database (Row Level Security + tabel `toegang`).

## Opmerkingen

- **Offline werken**: zonder bereik (bv. in een kelder) kan je gewoon registreren en foto's nemen. Alles gaat naar een
  wachtrij op het toestel (IndexedDB) en wordt automatisch verstuurd zodra er weer verbinding is. Bovenaan staat dan
  "Offline · n wijzigingen wachten". Meld je niet af zolang er wijzigingen wachten; de app houdt je daar ook tegen.
- Zonder verbinding toont de app de gegevens van de laatste keer, en de foto's die je op dat toestel al eens zag.
- Een gratis Supabase-project wordt gepauzeerd na een week zonder gebruik; je zet het terug aan in het dashboard.
