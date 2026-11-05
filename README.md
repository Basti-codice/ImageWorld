# ImageWorld

**Deine Fotos auf der Weltkarte – live synchronisiert mit deinen Ordnern.**
Windows-Desktop-App (Electron, React, TypeScript). Ordner werden *an Ort und Stelle* indexiert – Originale werden weder kopiert noch verändert.

[English summary below](#english)

## Funktionen

- **Weltkarte und Globus** – flache Karte oder 3D-Globus, wahlweise Dunkel, Hell, Voyager oder Satellit. Die Grundkarte ist offline eingebettet; Online-Kacheln sind optional.
- **Heatmap und Vorschaubild-Cluster** – Aufnahmeorte als Dichtekarte oder als Cluster mit echten Vorschaubildern, ausgelegt für 100 000+ Fotos.
- **Zeitstrahl mit Reiseverlauf** – Fotos nach Zeit, Reisen werden automatisch erkannt und als Route auf der Karte abgespielt.
- **Bereichsauswahl → Alben** – Region auf der Karte aufziehen, Fotos auswählen, Album erstellen. Alben lassen sich sortieren, als Diashow zeigen und exportieren.
- **Live-Synchronisierung** – Ordner (auch **OneDrive**) werden überwacht; neue, geänderte und gelöschte Dateien erscheinen sofort.
- **Suche und Filter** – nach Ort, Datum, Kamera, Objektiv, Dateityp, Bewertung, Tags, Favoriten; Ortssuche mit Karten-Sprung.
- **Statistik** – Orte, Länder, Aufnahmen pro Zeitraum, Kameras und mehr.
- **HEIC, RAW und Video** – Vorschau und Metadaten für gängige Foto-, RAW- und Videoformate (EXIF/GPS via ExifTool, Videoframes via FFmpeg).
- **100 % lokal und nicht-destruktiv** – Favoriten, Bewertungen, Tags, manuelle Orte und Alben liegen in den App-Daten, nie in deinen Bilddateien.
- Deutsch und Englisch, dunkles und helles Design, Tastaturbedienung.

## Datenschutz

ImageWorld hat kein Konto, keine Telemetrie und lädt keine Fotos oder Metadaten hoch. Offline-Ortsnamen (Reverse-Geocoding) stammen aus einer eingebauten Städtedatenbank. Nur diese Zugriffe verlassen den Rechner:

| Zweck | Server | Gesendet wird |
|---|---|---|
| Kartendetails und Beschriftungen, Stil „Voyager“ | CARTO / OpenStreetMap | übliche Kachelanfragen (Kartenausschnitt, IP-Adresse) |
| Kartenstil „Satellit“ | Esri ArcGIS | übliche Kachelanfragen |
| Ortssuche (in den Einstellungen abschaltbar) | Nominatim (OpenStreetMap) | nur der eingegebene Suchbegriff bzw. die Koordinate |

Ohne Internetverbindung bleibt die Karte mit der eingebetteten Basiskarte (Länder, Küsten, Gradnetz) nutzbar.

Die Daten der App liegen in `%APPDATA%\ImageWorld` (Einstellungen, Quellen, Alben, Favoriten/Bewertungen/Tags, Metadaten-Index, Vorschaubild-Cache). Deinstallation lässt sie standardmäßig bestehen.

## Installation

1. Auf der Seite **Releases** den Installer `ImageWorld-Setup-<Version>.exe` herunterladen. Builds jedes Commits gibt es außerdem als Artefakte unter **Actions → Build Windows** (`ImageWorld-Setup` und `ImageWorld-Portable`).
2. Installer starten. Standard ist eine Installation **pro Benutzer** (keine Administratorrechte); das Zielverzeichnis ist wählbar. Desktop- und Startmenü-Verknüpfung werden angelegt.
3. Alternativ das Zip `ImageWorld-Portable-<Version>-win-x64.zip` entpacken und `ImageWorld.exe` starten.

Voraussetzung: Windows 10 oder 11, 64 Bit.

## Entwicklung

Voraussetzungen: Node.js 22, npm. Windows empfohlen (für `dist` zwingend, damit die Windows-Binärpakete installiert werden).

```bash
npm ci                # Abhängigkeiten (lädt auch ffmpeg und die Windows-Pakete für sharp/exiftool)
npm run dev           # Electron mit HMR
npm run dev:web       # nur Renderer im Browser mit Mock-Daten, http://127.0.0.1:5199
npm run typecheck     # tsc für Main/Preload und Renderer
npm test              # vitest
npm run dist          # Installer + Portable-Zip nach release/
npm run dist:dir      # nur entpackter Ordner release/win-unpacked (schneller Test)
npm run icons         # build/icon.ico, PNGs und Installer-Grafiken aus resources/icon.svg neu erzeugen
```

Umgebungsvariable `IMAGEWORLD_USER_DATA=<Ordner>` leitet die App-Daten um (z. B. für Tests).
`npm run verify:package` prüft ein gepacktes Verzeichnis: sind alle zur Laufzeit benötigten Module im Archiv und die nativen Binärdateien (sharp, ExifTool, FFmpeg, libheif) in `app.asar.unpacked`?

### Architektur

Kurzfassung: `src/main` (Indexierung, Dateiüberwachung, Thumbnails, IPC), `src/preload` (Brücke `window.api`), `src/renderer` (React-Oberfläche), `src/shared/types.ts` als gemeinsamer Vertrag. Details, Prozessmodell und Teamregeln: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

Der Build ist in `electron-builder.yml` beschrieben. Native Binärdateien (sharp/libvips, ExifTool, FFmpeg, libheif) werden per `asarUnpack` neben das Archiv gelegt; der Renderer ist vollständig gebündelt, seine npm-Pakete werden nicht mitgeliefert.

### CI

- `build-windows.yml` – bei Push auf `main` und `claude/**` sowie bei Tags `v*`: Typecheck, Tests, Installer + Zip als Artefakte. Bei einem Tag `vX.Y.Z` (muss zur `package.json`-Version passen) wird zusätzlich ein GitHub Release mit Installer, Zip und Prüfsummen erstellt.
- `ci.yml` – schneller Check (Typecheck + Tests) für Pull Requests.

Release erstellen: Version in `package.json` anheben, committen, `git tag vX.Y.Z && git push --tags`.

## Bekannte Einschränkungen

- **Unsignierter Installer / SmartScreen.** Die Builds sind (noch) nicht code-signiert. Windows zeigt deshalb „Der Computer wurde durch Windows geschützt“. Mit **Weitere Informationen → Trotzdem ausführen** lässt sich der Installer starten. Das Warnbanner verschwindet erst mit einem Signaturzertifikat und etablierter Reputation.
- **OneDrive „Dateien bei Bedarf“.** Fotos, die nur online liegen, werden erkannt. Standardmäßig lädt OneDrive sie beim ersten Auslesen der Metadaten herunter (Netzwerkverkehr, Speicherplatz). Mit der Einstellung „Nur online verfügbare OneDrive-Dateien überspringen“ werden sie stattdessen ausgelassen. Für große Bibliotheken den Ordner besser auf „Immer auf diesem Gerät behalten“ stellen.
- Kartenkacheln und Ortssuche benötigen eine Internetverbindung; ohne sie bleibt die eingebettete Basiskarte.
- Mitgeliefertes FFmpeg (`ffmpeg-static`) steht unter GPL-3.0; die Lizenztexte liegen den Paketen bei.

## Code-Signing nachrüsten

Mit einem Zertifikat (OV/EV) oder Azure Trusted Signing genügt es, die Signatur im Windows-Build zu konfigurieren, ohne den Code zu ändern:

1. Zertifikat als `.pfx` base64-kodiert in einem GitHub-Secret ablegen (`CSC_LINK`) und das Passwort als `CSC_KEY_PASSWORD`.
2. In `.github/workflows/build-windows.yml` beim Schritt „Build installer“ die Zeile `CSC_IDENTITY_AUTO_DISCOVERY: 'false'` entfernen und die Secrets als `env` übergeben:
   ```yaml
   env:
     CSC_LINK: ${{ secrets.CSC_LINK }}
     CSC_KEY_PASSWORD: ${{ secrets.CSC_KEY_PASSWORD }}
   ```
3. Für Azure Trusted Signing stattdessen in `electron-builder.yml` unter `win:` den Block `azureSignOptions` (Endpoint, Account, Profil) ergänzen und die `AZURE_*`-Secrets setzen.

electron-builder signiert dann `ImageWorld.exe`, die mitgelieferten Binärdateien und den Installer. Automatische Updates sind nicht enthalten.

## Lizenz

MIT, siehe [`LICENSE`](LICENSE). Drittanbieter-Komponenten stehen unter ihren eigenen Lizenzen (u. a. Electron, sharp/libvips, ExifTool, FFmpeg, MapLibre GL, Natural Earth, OpenStreetMap-Daten).

---

## English

**ImageWorld** is a Windows desktop app that puts your photo library on a world map: heatmap, thumbnail clusters, 3D globe, a timeline with trip playback, area selection to create albums, search and filters, statistics, and support for HEIC, RAW and video. Folders (including OneDrive) are indexed in place and kept in sync live; originals are never copied or modified. Favorites, ratings, tags and albums live in the app data only.

- **Privacy:** no account, no telemetry, nothing is uploaded. Only map tile requests (CARTO/OpenStreetMap, Esri) and the optional Nominatim place search (can be switched off) go online; the embedded offline basemap keeps working without a connection.
- **Install:** download `ImageWorld-Setup-<version>.exe` from Releases (or the build artifacts under Actions). Per-user install, no admin rights needed. A portable zip is also provided.
- **SmartScreen:** builds are not code-signed yet, so Windows shows a warning; choose *More info → Run anyway*. See "Code-Signing nachrüsten" above for how to add a certificate.
- **OneDrive Files On-Demand:** by default OneDrive downloads online-only photos when their metadata is first read; a setting skips them instead. For large libraries use "Always keep on this device".
- **Develop:** `npm ci`, `npm run dev` (Electron), `npm run dev:web` (browser with mock data), `npm test`, `npm run dist` (installer in `release/`). Architecture: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).
