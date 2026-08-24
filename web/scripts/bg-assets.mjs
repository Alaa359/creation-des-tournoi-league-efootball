import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';

const ROOT = path.resolve(import.meta.dirname, '..');
const PUB = path.join(ROOT, 'public', 'backgrounds');
const OUT = path.join(PUB, 'gen');

/** [chemin depuis public/, nom de sortie, largeur max du visuel principal] */
const SOURCES = [
  ['backgrounds/laliga.png', 'laliga', 960],
  ['backgrounds/laliga-trophy.jpg', 'laliga-trophy', 1280],
  ['backgrounds/premierleague.png', 'premierleague', 960],
  ['backgrounds/premierleague-trophy.jpg', 'premierleague-trophy', 1280],
  ['backgrounds/ligue1.svg', 'ligue1', 900],
  ['backgrounds/tunisie.png', 'tunisie', 640],
  ['backgrounds/ucl.svg', 'ucl', 900],
  ['logos/worldcup.svg', 'worldcup', 900],
  ['backgrounds/wc2026.svg', 'wc2026', 900],
];

await mkdir(OUT, { recursive: true });

for (const [rel, base, width] of SOURCES) {
  const input = path.join(ROOT, 'public', rel);

  // Visuel principal : raster/WebP optimisé (les SVG complexes ne sont
  // pas re-rastérisés par le navigateur à chaque zoom).
  await sharp(input, { density: 96 })
    .resize({ width, withoutEnlargement: true })
    .webp({ quality: 82, alphaQuality: 90 })
    .toFile(path.join(OUT, `${base}.webp`));

  // Halo ambiant : flou + saturation cuits une fois pour toutes —
  // le navigateur n'applique plus aucun filtre coûteux à l'exécution.
  await sharp(input, { density: 48 })
    .resize({ width: 160 })
    .blur(6)
    .modulate({ saturation: 1.45, brightness: 1.05 })
    .webp({ quality: 60, alphaQuality: 70 })
    .toFile(path.join(OUT, `${base}-halo.webp`));

  console.log(`✓ ${base} (.webp + -halo.webp)`);
}
