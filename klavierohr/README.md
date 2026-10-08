# Klavierohr

Klavier üben mit dem iPad: MusicXML-Noten laden, auf dem echten Klavier spielen – die App hört über das Mikrofon zu, hakt richtige Töne ab und wertet Rhythmus, Tempo und Notenlängen aus.

## Online stellen (einmalig, ca. 5 Minuten)

Das Mikrofon funktioniert im Browser nur über **https**. Am einfachsten mit GitHub Pages:

1. Auf github.com ein neues **öffentliches** Repository anlegen, z. B. `klavierohr`.
2. „Add file → Upload files“ und den **Inhalt** dieses Ordners hineinziehen (index.html muss auf oberster Ebene liegen). „Commit changes“.
3. Settings → Pages → Source: „Deploy from a branch“, Branch `main`, Ordner `/ (root)` → Save.
4. Nach 1–2 Minuten läuft die App unter `https://DEIN-NAME.github.io/klavierohr/`.

Alternative ohne Git: den Ordner auf https://app.netlify.com/drop ziehen (kostenloses Konto, damit die Seite bleibt).

## Auf dem iPad

- Adresse in **Safari** öffnen → Teilen → „Zum Home-Bildschirm“. Danach startet Klavierohr wie eine App, auch offline.
- Beim ersten Start „Mikrofon erlauben“.
- Einstellungen → **Latenz messen** (einmal, mit Lautsprecher).

## Noten

MusicXML (`.musicxml`, `.mxl`, `.xml`), z. B. aus MuseScore exportiert. PDFs/Fotos vorher mit einer Notenerkennung (z. B. Audiveris) umwandeln.

## Technik

- Notensatz: OpenSheetMusicDisplay 2.1.3 (BSD-3-Clause)
- Klavierklang: Salamander Grand Piano V3, Alexander Holm (CC BY 3.0)
- Schriften: Bodoni Moda, Atkinson Hyperlegible Next, IBM Plex Mono (SIL OFL)
- Erkennung: eigene notengestützte Analyse (Anschlag per spektralem Fluss, Teilton-Zuwachs je Taste, Abgleich mit den erwarteten Noten, Dämpfer-Erkennung fürs Notenende). Alles läuft lokal im Browser; es werden keine Aufnahmen gespeichert oder verschickt.
