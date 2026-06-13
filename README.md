# Schweden Camper Finder v3.1

OSM-basierter Camper-Helfer für Schweden und Skandinavien: findet WC, Wasser, Stellplätze, Bademöglichkeiten, Kirchen, Parkplätze, Rastplätze, Lebensmittelgeschäfte (ICA Maxi hervorgehoben), Museen und Wanderwege.

## Dateien

```
index.html
css/style.css
js/app.js
assets/icon.svg
manifest.webmanifest
service-worker.js
```

## GitHub Pages Deployment

1. Alle Dateien ins Repo-Root hochladen (Ordnerstruktur css/ js/ assets/ beibehalten)
2. Settings → Pages → Branch main, Ordner /root
3. App läuft unter https://DEINNAME.github.io/REPONAME/

## Nach Update: Cache leeren

Da ein Service Worker im Einsatz ist, beim ersten Besuch nach einem Update einmal:
- Desktop: Strg + Shift + R (Hard Reload)
- iPhone: Einstellungen → Safari → Verlauf und Websitedaten löschen, oder Homescreen-App neu hinzufügen

## Neu in v3.1

- Wieder die normale, gut lesbare OpenStreetMap-Karte (die dunkle Karte war zu unübersichtlich)
- Marker, Fadenkreuz, Radius-Kreis und Zoom-Bedienung an die helle Karte angepasst

## Neu in v3.0

- **Dunkle Karte** (CARTO Dark Matter) passend zum App-Design
- **Radius-Kreis** zeigt den Suchbereich direkt auf der Karte
- **Marker-Clustering**: viele Treffer werden zu Zahlen-Bubbles gruppiert
- **Liste ↔ Karte verbunden**: Tippen auf eine Ergebniskarte fliegt zur Karte; Marker-Klick hebt die Listenkarte hervor
- **Lebensmittel-Kategorie** statt nur ICA Maxi: findet alle Supermärkte, ICA Maxi wird mit ⭐, grüner Umrandung und ganz oben hervorgehoben
- **Himmelsrichtung + Pfeil** bei jeder Distanzangabe (z. B. ↗ 2,3 km NO)
- **Öffnungsstatus** "jetzt geöffnet / geschlossen" bei einfachen Öffnungszeiten
- **Treffer-Zähler** pro Kategorie-Chip nach der Suche
- **Sortierung** umschaltbar zwischen Nähe und Bewertung
- **Teilen-Button** pro Ort (native Share-Funktion am Handy)
- **Abbruch & Timeout-Hinweis** wenn Overpass langsam ist
- Nominatim-Suche auf Skandinavien beschränkt und auf 1 Anfrage/Sekunde gedrosselt
- veraltetes apple-mobile-web-app-capable Meta-Tag ergänzt durch den neuen Standard

## Datenquelle

Alle Daten von OpenStreetMap über die Overpass-API. Angaben ohne Gewähr – bei Parkplätzen, Kirchen und Rastplätzen immer die Beschilderung vor Ort beachten.
