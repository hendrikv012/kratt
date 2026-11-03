# Kratt product site

Static marketing site, deployed by `pages-deploy.yml`. The desktop app and installers are never included here. Relative asset URLs work under `/kratt/` on GitHub Pages.

`site.js` lists actual uploaded assets from the newest public release (or prerelease when no stable release exists), requires checksums, and uses versioned GitHub Releases URLs. Before publication it shows an explicit unavailable state. Draft releases are intentionally invisible to visitors.

Screenshots show the real app with example biology notes, not personal files. Fonts are bundled locally with their SIL OFL licenses. No analytics, external fonts or cookies are added.

Preview with any static HTTP server. Verify narrow screens, keyboard navigation, light/dark screenshot switching, and release-list success/unavailable/rate-limit states before deployment.
