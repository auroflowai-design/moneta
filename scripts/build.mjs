import { cp, mkdir, rm } from 'node:fs/promises';

const webDir = new URL('../www/', import.meta.url);
await rm(webDir, { recursive: true, force: true });
await mkdir(webDir, { recursive: true });
for (const file of ['index.html', 'styles.css', 'app.js', 'manifest.json', 'sw.js']) {
  await cp(new URL(`../${file}`, import.meta.url), new URL(file, webDir));
}
await cp(new URL('../js/', import.meta.url), new URL('js/', webDir), { recursive: true });
await cp(new URL('../assets/', import.meta.url), new URL('assets/', webDir), { recursive: true });
await mkdir(new URL('vendor/', webDir), { recursive: true });
await cp(new URL('../node_modules/xlsx/dist/xlsx.full.min.js', import.meta.url), new URL('vendor/xlsx.full.min.js', webDir));
console.log('Moneta web files are ready in www/.');
