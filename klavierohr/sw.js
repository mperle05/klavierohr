// sw.js — offline-fähig: alle Dateien vorab cachen, dann Cache zuerst (Version ändert sich mit jedem Build)
const VERSION = 'klavierohr-b43ea23a4a';
const ASSETS = ['./', "./audio/piano/A0.mp3", "./audio/piano/A1.mp3", "./audio/piano/A2.mp3", "./audio/piano/A3.mp3", "./audio/piano/A4.mp3", "./audio/piano/A5.mp3", "./audio/piano/A6.mp3", "./audio/piano/A7.mp3", "./audio/piano/C1.mp3", "./audio/piano/C2.mp3", "./audio/piano/C3.mp3", "./audio/piano/C4.mp3", "./audio/piano/C5.mp3", "./audio/piano/C6.mp3", "./audio/piano/C7.mp3", "./audio/piano/C8.mp3", "./audio/piano/Ds1.mp3", "./audio/piano/Ds2.mp3", "./audio/piano/Ds3.mp3", "./audio/piano/Ds4.mp3", "./audio/piano/Ds5.mp3", "./audio/piano/Ds6.mp3", "./audio/piano/Ds7.mp3", "./audio/piano/Fs1.mp3", "./audio/piano/Fs2.mp3", "./audio/piano/Fs3.mp3", "./audio/piano/Fs4.mp3", "./audio/piano/Fs5.mp3", "./audio/piano/Fs6.mp3", "./audio/piano/Fs7.mp3", "./css/app.css", "./fonts/atkinson-hyperlegible-next-latin-400-normal.woff2", "./fonts/atkinson-hyperlegible-next-latin-700-normal.woff2", "./fonts/bodoni-moda-latin-500-italic.woff2", "./fonts/bodoni-moda-latin-500-normal.woff2", "./fonts/ibm-plex-mono-latin-500-normal.woff2", "./icons/apple-touch-icon.png", "./icons/icon-192.png", "./icons/icon-512.png", "./icons/icon-maskable-512.png", "./index.html", "./js/app.js", "./js/audio.js", "./js/capture-worklet.js", "./js/detector.js", "./js/dsp.js", "./js/ear.js", "./js/exercises.js", "./js/keyboard.js", "./js/practice.js", "./js/samples.js", "./js/score.js", "./js/scoregen.js", "./js/store.js", "./js/vendor/opensheetmusicdisplay.min.js", "./licenses/AtkinsonHyperlegibleNext-OFL.txt", "./licenses/BodoniModa-OFL.txt", "./licenses/IBMPlexMono-OFL.txt", "./licenses/OpenSheetMusicDisplay-LICENSE.txt", "./licenses/SalamanderGrandPiano.txt", "./manifest.webmanifest"];
self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  e.respondWith(caches.match(req, { ignoreSearch: true }).then(hit => {
    const net = fetch(req).then(res => {
      if (res.ok) { const copy = res.clone(); caches.open(VERSION).then(c => c.put(req, copy)); }
      return res;
    }).catch(() => hit);
    return hit || net;
  }));
});
