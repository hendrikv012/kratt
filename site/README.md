# Kratt product site

Static marketing site, deployed by `pages-deploy.yml`. The desktop app and installers are never included here. Relative asset URLs work under `/kratt/` on GitHub Pages.

`site.js` lists actual uploaded assets from the newest public release (or prerelease when no stable release exists), requires checksums, and uses versioned GitHub Releases URLs. Before publication it shows an explicit unavailable state. Draft releases are intentionally invisible to visitors.

Screenshots show the real app with example biology notes, not personal files. Fonts are bundled locally with their SIL OFL licenses. No analytics, external fonts or cookies are added.

Preview with any static HTTP server. Verify narrow screens, keyboard navigation, Ember dark/light page and screenshot switching, and release-list success/unavailable/rate-limit states before deployment.

The Ember palette is generated from the app's theme presets with `node scripts/sync-ember-brand.mjs`. Pixelify Sans and Geist are copied from the app's locked Fontsource packages, with their licenses. `design/ember/github-banner.html` is the source for the 1200×630 README/share image at `site/assets/kratt-banner.png`; capture it in a browser after fonts and example screenshots load, with reduced motion enabled. No personal notes belong in screenshots.
