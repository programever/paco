// Build: bundle src/app.ts (with Firebase, Leaflet and Paco's own route code) into dist/app.js,
// copy the page, the styles and every race file. The page loads the race Paco names.
import { build } from 'esbuild';
import { createHash } from 'node:crypto';
import { cpSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';

rmSync('dist', { recursive: true, force: true });
mkdirSync('dist');
cpSync('../assets/icon.png', 'dist/icon.png');
cpSync('node_modules/leaflet/dist/leaflet.css', 'dist/leaflet.css');
cpSync('node_modules/leaflet/dist/images', 'dist/images', { recursive: true });
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

// Each file name carries a hash of its content. GitHub Pages lets browsers keep
// files for 10 minutes; with fixed names a browser could run the old app.js
// against the new index.html. New content, new name: they can never mix.
const hashed = (name, content) => {
  const [base, ext] = name.split('.');
  return `${base}.${createHash('sha256').update(content).digest('hex').slice(0, 10)}.${ext}`;
};
const appName = hashed('app.js', readFileSync('dist/app.js'));
renameSync('dist/app.js', `dist/${appName}`);
const css = readFileSync('src/style.css');
const cssName = hashed('style.css', css);
writeFileSync(`dist/${cssName}`, css);
writeFileSync(
  'dist/index.html',
  readFileSync('src/index.html', 'utf8').replace('href="style.css"', `href="${cssName}"`).replace('src="app.js"', `src="${appName}"`),
);
