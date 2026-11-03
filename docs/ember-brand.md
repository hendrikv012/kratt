# Ember across Kratt

## Design plan

The existing study app is the reference. This is a transfer of its identity, not a new theme.

- Ground `#0e0e0e`, surface `#161616`, line `#232323`, text `#ece8e3`, muted text `#a19c96`, accent `#ff8a3d`. Hover and body text also come directly from the app's Ember preset.
- Pixelify Sans 500 carries headings, navigation and controls; Geist carries reading text. Both are bundled locally.
- Left-aligned copy and real workspace screenshots lead. Use the app's 6px corners, quiet neutral panels and orange selection states. The mascot stays small enough to feel like the app's helper.

```text
Kratt        Workspace / Study materials / Files / Downloads
Your notes, with a study partner.       Kratt + note links
Short introduction + desktop link
Workspace heading                      Ember dark / light
[Actual workspace screenshot, full width]
Connections       Practice             Focus
Study materials copy     [Actual flashcard screenshot]
File ownership           [Study folder]
Platform downloads / first steps / questions
```

## Review against the brief

The previous blue-and-paper palette, Barlow/Plex typography, rotated mascot panel and offset shadows belong to a different identity. Replace those with the actual Ember tokens and fonts. Keep the useful page structure and real screenshots. The dark palette is intentional here because the brief explicitly asks for Ember; do not add unrelated neon, gradients or repeated decorative badges.

GitHub controls its own page CSS. Brand the README and share artwork instead. Apply Ember to the desktop loading, first-run, recovery and notice surfaces as well; existing app theme choices remain available.

## Source and maintenance

The app's `theme/themes.js` remains authoritative. `node scripts/sync-ember-brand.mjs` copies its Ember dark/light tokens and bundled fonts into the static site. The site defaults to Ember dark; its optional light mode uses Ember light rather than the unrelated Chalk preset. Desktop startup uses Ember fallbacks and inherits active app tokens when the workspace is mounted.
