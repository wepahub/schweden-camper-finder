# Schweden Camper Finder v4.0

OSM-basierter Camper-Helfer für Schweden und Skandinavien: findet WC, Wasser, **Entsorgung**, Stellplätze, Tankstellen mit **LPG/Gasol**, Duschen, Schutzhütten (Vindskydd), Grillplätze, Badeplätze, Lebensmittel (ICA Maxi hervorgehoben ⭐) und vieles mehr – rund um dich oder **entlang deiner Route**, auch **offline**.

Läuft als installierbare Web-App (PWA) auf Handy und Desktop, ohne Konto und ohne Tracking. Alle Daten bleiben lokal im Browser.

## Funktionen

**Suchen**
- Fünf Schnellmodi: 🚻 WC jetzt · 💧 Versorgung · 🌙 Abendplatz · 🏖 Baden & Pause · 🥾 Natur & Wandern – ein Tipp sucht sofort
- 21 Kategorien in drei Gruppen (Versorgung, Übernachten & Rasten, Freizeit & Natur)
- Schnellfilter: kostenlos · jetzt offen · 24/7 · mit WC · mit Wasser · Wohnmobil ok · LPG/Gasol · rollstuhlgerecht
- „In diesem Gebiet suchen“, sobald die Karte verschoben wurde
- 🚻-Knopf „Nächstes WC“: sucht mit GPS im Umkreis von 2 km, notfalls 10 km, und fliegt hin
- Ortssuche (Nominatim) oder direkt Koordinaten eingeben, z. B. `59.85, 17.63`

**Route**
- Start und Ziel eingeben (Start leer = eigener Standort) → findet alles in einem Korridor von 0,5–5 km entlang der Fahrstrecke
- Ergebnisse nach Routenverlauf sortiert („km 123 · 800 m neben der Route“)

**Details & Navigation**
- Detailansicht mit Öffnungszeiten (inkl. „offen bis 22:00“ / „öffnet morgen 08:00“), Adresse, Telefon, Website, Gebühr, Plätzen, Strom, Wohnmobil-Erlaubnis, maximaler Höhe usw.
- Navigation mit Google Maps, Apple Karten, Waze oder (Android) einer beliebigen App
- Bei Wanderwegen zeigt die Entfernung zum **nächsten Einstieg**, nicht zum Routen-Mittelpunkt

**Favoriten & Reisen**
- Favoriten und Notizen werden mit Koordinaten gespeichert und sind überall sichtbar, nicht nur in der aktuellen Suche
- Reisen mit sortierbaren Stopps, Luftlinien-Summe, Route in Google Maps, Übergabe an die Routensuche
- Export als JSON-Backup oder GPX, Import von JSON oder GPX (z. B. aus anderen Camper-Apps)
- Favoriten aus v3.x werden automatisch übernommen

**Unterwegs**
- Offline-Gebiete: Versorgungspunkte im Umkreis von 15 km speichern; ohne Netz wird daraus gesucht
- Angesehene Kartenausschnitte werden automatisch zwischengespeichert, die App startet auch ohne Netz
- Live-Standort mit Blickrichtung; Folgen-Modus
- Wetter und 3-Tage-Vorschau (Open-Meteo), Sonnenauf- und -untergang (auch offline berechnet, inkl. Mitternachtssonne), Mückenwarnung bei warmem, windstillem Sommerwetter
- Kartenstile: Karte, Gelände (OpenTopoMap), Satellit
- Kurzinfo zum Jedermannsrecht (Allemansrätten) für Wohnmobile
- Sprachen: Deutsch, English, Svenska

## Bedienung

- **Handy:** Karte im Vollbild, darunter ein Bottom Sheet zum Hochziehen (drei Stufen). Tippen auf eine Ergebniskarte fliegt zum Ort, ein Tipp auf einen Marker hebt die Karte in der Liste hervor.
- **Desktop:** Seitenleiste links, Karte rechts.

## Dateien

```
index.html
manifest.webmanifest
service-worker.js
css/style.css
js/
  main.js        Hauptsteuerung (Suche, Route, Standort, Rendering)
  config.js      Kategorien, Modi, Server, Kartenstile
  i18n.js        Übersetzungen DE/EN/SV
  overpass.js    Overpass-Abfragen mit Server-Fallback und Timeout
  places.js      Einordnung, Bewertung, Filter, Umgebung, Routen-Projektion
  hours.js       Öffnungszeiten-Parser
  geo.js         Entfernungen, Linien, Kacheln, Sonnenzeiten
  services.js    Nominatim, OSRM, Open-Meteo
  offline.js     Datencache und Offline-Gebiete
  storage.js     localStorage (abgesichert) + Migration aus v3.x
  favorites.js   Favoriten, Notizen, Reisen
  backup.js      JSON/GPX Export & Import
  mapview.js     Leaflet-Karte
  ui/            Karten & Details, Bottom Sheet, Favoriten-Tab, Wetter/Mehr
vendor/          Leaflet 1.9.4 und Leaflet.markercluster 1.5.3 (lokal, damit offline verfügbar)
assets/          Icons (SVG + PNG für iOS/Android)
tests/           Unit-Tests (node:test)
```

## GitHub Pages Deployment

1. Alle Dateien ins Repo-Root (Ordnerstruktur beibehalten)
2. Settings → Pages → Branch `main`, Ordner `/root`
3. App läuft unter `https://DEINNAME.github.io/REPONAME/`

Updates kommen automatisch an: Der Service Worker lädt App-Dateien zuerst aus dem Netz und nutzt den Cache nur offline. Nach einem Update erscheint „Neue Version verfügbar – Neu laden“. Cache leeren ist nicht mehr nötig.

## Entwicklung

Keine Build-Schritte, keine Abhängigkeiten – reines HTML/CSS/ES-Module.

```bash
npm start        # lokaler Server auf http://localhost:8080
npm test         # Unit-Tests (Node 22)
npm run lint     # ESLint (falls installiert)
```

## Neu in v4.0

- Komplett überarbeitete Oberfläche: Vollbildkarte mit Bottom Sheet, Tabs Umgebung / Route / Favoriten / Mehr
- Neue Kategorien: Entsorgung, Tankstelle (LPG), Dusche, Wäscherei, Ladestation, Apotheke, Werkstatt, Recycling, Schutzhütte, Grillplatz, Aussicht
- Suche entlang der Route, Offline-Gebiete, Wetter & Sonne, Jedermannsrecht, Sprachen
- Echte Favoritenliste mit Reisen, GPX/JSON-Export und -Import
- Behoben: Ortsname ging nach der Suche verloren · Favoriten waren nur in der aktuellen Suche sichtbar · hängende Overpass-Server blockierten die Suche (jetzt Timeout + Serverwechsel, auch bei „runtime error“) · App-Updates kamen erst nach Cache-Leeren an · App war ohne Netz nicht nutzbar · falsches „geschlossen“ bei Öffnungszeiten über Mitternacht oder mit Tageslisten · Entfernung zu Wanderwegen gemessen am Routen-Mittelpunkt · Campingplätze mit WC wurden als „WC“ einsortiert · doppelte Farben bei Kategorien
- Schneller: eine `nwr`-Abfrage statt drei pro Tag, Trefferlimit, seitenweise Liste, Umgebungssuche über Raster statt jeder-gegen-jeden, Zwischenspeicher für Abfragen
- Barrierefreiheit: Tastaturbedienung, `aria-pressed`/`aria-selected`, Live-Region für Statusmeldungen, bessere Kontraste, reduzierte Animationen
- Neues App-Icon (PNG für iPhone-Homescreen und Android)

## Datenquellen

Daten © OpenStreetMap-Mitwirkende (ODbL) über die Overpass API und Nominatim · Routing: OSRM · Wetter: Open-Meteo · Karten: OpenStreetMap, OpenTopoMap, Esri World Imagery.

Angaben ohne Gewähr – bei Parkplätzen, Kirchen und Rastplätzen immer die Beschilderung vor Ort beachten. Vor dem Feuermachen das Feuerverbot (eldningsförbud) prüfen.
