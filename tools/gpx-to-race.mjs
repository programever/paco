// Turns a GPX file into a race file for races/ (easy-pacer's plan format v1).
// Usage: node tools/gpx-to-race.mjs <file.gpx> "<race name>" > races/<id>.json
// Checkpoints: only the start and the finish. Add stations by hand (see races/README.md).
import { readFileSync } from 'node:fs';

const [file, name] = process.argv.slice(2);
const gpx = readFileSync(file, 'utf8');

const points = [...gpx.matchAll(/<trkpt\s+lat="([-\d.]+)"\s+lon="([-\d.]+)"[^>]*>([\s\S]*?)<\/trkpt>/g)].map((m) => ({
  lat: Number(m[1]),
  lon: Number(m[2]),
  ele: Number(/<ele>([-\d.]+)<\/ele>/.exec(m[3])?.[1] ?? 0),
}));
const waypoints = [...gpx.matchAll(/<wpt\s+lat="([-\d.]+)"\s+lon="([-\d.]+)"[^>]*>([\s\S]*?)<\/wpt>/g)].map((m) => ({
  name: /<name>([^<]*)<\/name>/.exec(m[3])?.[1] ?? '',
  lat: Number(m[1]),
  lon: Number(m[2]),
}));

const radians = (d) => (d * Math.PI) / 180;
const haversineKm = (a, b) => {
  const h =
    Math.sin(radians(b.lat - a.lat) / 2) ** 2 +
    Math.cos(radians(a.lat)) * Math.cos(radians(b.lat)) * Math.sin(radians(b.lon - a.lon) / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(Math.min(1, h)));
};
const totalKm = points.slice(1).reduce((sum, p, i) => sum + haversineKm(points[i], p), 0);

const checkpoint = (id, label, km, role) => ({ id, name: label, km, cutoff: null, target: null, role });
console.log(
  JSON.stringify({
    version: 1,
    name,
    route: { samples: points, waypoints },
    checkpoints: [checkpoint('0', 'Start', 0, 'start'), checkpoint('1', 'Finish', Math.round(totalKm * 1000) / 1000, 'finish')],
    date: null,
    time: null,
  }),
);
console.error(`${points.length} points, ${waypoints.length} waypoints, ${totalKm.toFixed(2)} km`);
