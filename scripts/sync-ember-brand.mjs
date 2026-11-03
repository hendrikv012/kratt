// Keep the static product site on the app's real Ember presets. Run from any directory.
import { copyFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { PRESETS, bridgeVars } from '../apps/study/src/views/studyhome/theme/themes.js';
const root = new URL('../', import.meta.url);
const keys = ['bg', 'sidebar', 'surface', 'hover', 'line', 'text', 'text-soft', 'text-body', 'accent', 'accent-ink', 'accent-wash', 'kratt'];
const rules = (id, selector) => {
  const vars = bridgeVars(PRESETS.find(p => p.id === id));
  return `${selector} {\n${keys.map(k => `  --st-${k}: ${vars[`--st-${k}`]};`).join('\n')}\n  color-scheme: ${id === 'ember' ? 'dark' : 'light'};\n}`;
};
await writeFile(new URL('site/ember.css', root), `/* Generated from the app's Ember presets by scripts/sync-ember-brand.mjs. */\n${rules('ember', ':root')}\n${rules('ember-light', ':root[data-ember="light"]')}\n`);
for (const [from, to] of [
  ['@fontsource/pixelify-sans/files/pixelify-sans-latin-500-normal.woff2', 'pixelify-sans-500.woff2'],
  ['@fontsource/pixelify-sans/LICENSE', 'pixelify-sans-LICENSE.txt'],
  ['@fontsource-variable/geist/files/geist-latin-wght-normal.woff2', 'geist-variable.woff2'],
  ['@fontsource-variable/geist/LICENSE', 'geist-LICENSE.txt'],
]) await copyFile(new URL(`apps/study/node_modules/${from}`, root), new URL(`site/assets/${to}`, root));
console.log(`Ember tokens and local fonts synced to ${fileURLToPath(new URL('site/', root))}`);
