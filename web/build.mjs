// Build: bundle src/app.ts (with Firebase, Leaflet and Paco's own route code) into dist/app.js,
// copy the page, the styles and every race file. The page loads the race Paco names.
import { build } from 'esbuild';
import { cpSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';

rmSync('dist', { recursive: true, force: true });
mkdirSync('dist');
for (const f of ['index.html', 'style.css']) cpSync(`src/${f}`, `dist/${f}`);
cpSync('node_modules/leaflet/dist/leaflet.css', 'dist/leaflet.css');
cpSync('../races', 'dist/races', { recursive: true, filter: (f) => !f.endsWith('.md') });
writeFileSync('dist/.nojekyll', '');
const r = await build({
  entryPoints: ['src/app.ts'],
  bundle: true,
  minify: true,
  sourcemap: false,
  format: 'esm',
  target: ['es2022'],
  outfile: 'dist/app.js',
  logLevel: 'info',
});
if (r.errors.length) process.exit(1);
