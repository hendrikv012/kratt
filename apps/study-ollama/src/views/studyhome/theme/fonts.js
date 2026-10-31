// Bundled fonts (@fontsource), loaded on demand when a theme uses them.
// Each id maps to the CSS imports for the family and its companions
// (display cut, mono). Nothing is fetched from the network.
const FONTS = {
  pixelify: () => [
    import("@fontsource/pixelify-sans/400.css"),
    import("@fontsource/pixelify-sans/500.css"),
    import("@fontsource/vt323/400.css"),
  ],
  archivo: () => [import("@fontsource-variable/archivo/wdth.css")],
  intertight: () => [import("@fontsource-variable/inter-tight/wght.css")],
  plexsans: () => [
    import("@fontsource/ibm-plex-sans/400.css"),
    import("@fontsource/ibm-plex-sans/600.css"),
    import("@fontsource/ibm-plex-sans-condensed/600.css"),
    import("@fontsource/ibm-plex-mono/400.css"),
  ],
  geist: () => [
    import("@fontsource-variable/geist/wght.css"),
    import("@fontsource-variable/geist-mono/wght.css"),
  ],
  barlow: () => [
    import("@fontsource/barlow/400.css"),
    import("@fontsource/barlow/600.css"),
    import("@fontsource/barlow-semi-condensed/600.css"),
  ],
  instrumentsans: () => [
    import("@fontsource-variable/instrument-sans/wdth.css"),
    import("@fontsource/ibm-plex-mono/400.css"),
  ],
  sourceserif: () => [import("@fontsource-variable/source-serif-4/opsz.css")],
  literata: () => [import("@fontsource-variable/literata/opsz.css")],
  newsreader: () => [import("@fontsource-variable/newsreader/opsz.css")],
  plexserif: () => [import("@fontsource/ibm-plex-serif/400.css"), import("@fontsource/ibm-plex-serif/600.css")],
};

const loaded = new Map();

// Resolves true once the font's CSS is in, false for an unknown id or a
// failed import. Never rejects.
export function loadFont(fontId) {
  if (!Object.prototype.hasOwnProperty.call(FONTS, fontId)) return Promise.resolve(false);
  if (!loaded.has(fontId)) {
    const p = Promise.all(FONTS[fontId]()).then(() => true, () => false);
    loaded.set(fontId, p);
    p.then((ok) => { if (!ok) loaded.delete(fontId); });
  }
  return loaded.get(fontId);
}
