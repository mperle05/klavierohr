// samples.js — gemeinfreie Beispielstücke (Bearbeitungen vereinfacht)
export const SAMPLES = [
  {
    id: 'sample-entchen',
    title: 'Alle meine Entchen',
    composer: 'Volkslied',
    level: 'Einstieg',
    spec: {
      title: 'Alle meine Entchen', composer: 'Volkslied', tempo: 96, time: '4/4', key: 0,
      staves: [
        { clef: 'G', bars: ['C4 D4 E4 F4', 'G4:h G4', 'A4:q A4 A4 A4', 'G4:w', 'A4:q A4 A4 A4', 'G4:w', 'F4:q F4 F4 F4', 'E4:h E4', 'D4:q D4 D4 D4', 'C4:w'] },
        { clef: 'F', bars: ['C3:w', 'E3:w', 'F3:w', 'C3:w', 'F3:w', 'C3:w', 'G2:w', 'C3:w', 'G2:w', 'C3:w'] },
      ],
    },
  },
  {
    id: 'sample-ode',
    title: 'Ode an die Freude',
    composer: 'Ludwig van Beethoven',
    level: 'Leicht',
    spec: {
      title: 'Ode an die Freude', composer: 'Ludwig van Beethoven', arranger: 'vereinfacht', tempo: 100, time: '4/4', key: 0,
      staves: [
        { clef: 'G', bars: [
          'E4 E4 F4 G4', 'G4 F4 E4 D4', 'C4 C4 D4 E4', 'E4:q. D4:e D4:h',
          'E4:q E4 F4 G4', 'G4 F4 E4 D4', 'C4 C4 D4 E4', 'D4:q. C4:e C4:h',
          'D4:q D4 E4 C4', 'D4:q E4:e F4 E4:q C4', 'D4:q E4:e F4 E4:q D4', 'C4:q D4 G3:h',
          'E4:q E4 F4 G4', 'G4 F4 E4 D4', 'C4 C4 D4 E4', 'D4:q. C4:e C4:h'] },
        { clef: 'F', bars: [
          'C3:w', 'G2:w', 'C3:w', 'C3:h G2:h',
          'C3:w', 'G2:w', 'C3:w', 'G2:h C3:h',
          'G2:h C3:h', 'G2:h C3:h', 'G2:h C3:q G2:q', 'C3:h G2:h',
          'C3:w', 'G2:w', 'C3:w', 'G2:h C3:h'] },
      ],
    },
  },
  {
    id: 'sample-elise',
    title: 'Für Elise (Anfang)',
    composer: 'Ludwig van Beethoven',
    level: 'Mittel',
    spec: {
      title: 'Für Elise', composer: 'Ludwig van Beethoven', arranger: 'Takte 1–8', tempo: 52, time: '3/8', key: 0, pickup: 0.5,
      staves: [
        { clef: 'G', bars: [
          'E5:s D#5', 'E5:s D#5 E5 B4 D5 C5', 'A4:e r:s C4:s E4 A4', 'B4:e r:s E4:s G#4 B4', 'C5:e r:s E4:s E5 D#5',
          'E5:s D#5 E5 B4 D5 C5', 'A4:e r:s C4:s E4 A4', 'B4:e r:s E4:s C5 B4', 'A4:q.'] },
        { clef: 'F', bars: [
          'r:e', '', 'A2:s E3 A3 r:s r:e', 'E2:s E3 G#3 r:s r:e', 'A2:s E3 A3 r:s r:e',
          '', 'A2:s E3 A3 r:s r:e', 'E2:s E3 G#3 r:s r:e', 'A2:s E3 A3 r:e.'] },
      ],
    },
  },
];
