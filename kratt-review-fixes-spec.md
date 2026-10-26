# Spec: fix review findings in the `kratt/` template

Date: 2026-10-26. Source: strict code review of `~/Kratt/kratt` (commit `ace2cce` and the uncommitted baseN→kratt rename).

## Context for the implementer

- Repo: `/home/caesarsta/Kratt/kratt`. It is its own git repo with one commit and no remote. It is a stock shadcn/ui Next.js template with no product code. Do not touch `~/Downloads/KRATT`; that is a different project.
- Read `/home/caesarsta/Kratt/CLAUDE.md` and `kratt/AGENTS.md` first. Key stack facts:
  - Next.js 16.3.6 and React 19.3. APIs differ from your training data, so read the matching guide in `node_modules/next/dist/docs/` before writing Next code. The metadata guide is `node_modules/next/dist/docs/01-app/03-api-reference/04-functions/generate-metadata.md`.
  - shadcn style `base-nova` on `@base-ui/react`, not Radix.
  - `cn` comes from the `cn` npm package; `lib/utils.ts` only re-exports it.
  - Tailwind v4 with CSS-only config in `app/globals.css`. There is no `tailwind.config`.
  - Prettier: no semicolons, double quotes, `es5` trailing commas, and the Tailwind plugin sorts classes.
- There is no test runner. Do not add one. Verify with the commands in "Done when".
- Work on a branch (for example `fix/review-findings`), not on the default branch. Make one commit per task group below, using conventional commit messages.

## Step 0: commit the pending rename

`package.json` and `package-lock.json` have an uncommitted rename (`"name": "baseN"` → `"kratt"`). The review checked it and it is consistent. Commit it alone first: `chore: rename package to kratt`.

## Task 1: `Button` must not drop a function `className` (major)

File: `components/ui/button.tsx:42-52`.

Problem: the props are `ButtonPrimitive.Props`, where Base UI types `className` as `string | ((state) => string | undefined)`. The component sends `className` into `buttonVariants(...)`. That calls clsx, which ignores functions, and `className` is never forwarded through `{...props}`. So `<Button className={(s) => ...}>` typechecks but silently loses its classes.

Fix: keep Base UI's function form working.

```tsx
className={(state) =>
  cn(
    buttonVariants({ variant, size }),
    typeof className === "function" ? className(state) : className
  )
}
```

- Keep the `data-slot="button"` attribute and the `{...props}` spread.
- Remove the defaults repeated in the destructuring (`variant = "default"`, `size = "default"`), because `defaultVariants` in `buttonVariants` already sets them. Only do this if the output classes stay identical.
- Change the `cn` import to `@/lib/utils` so it matches the `components.json` alias that CLI-generated components use.
- Check: `app/page.tsx` still renders the button with `mt-2`. Add a throwaway function-`className` usage, confirm in `npm run build` output or a dev render that the class is applied, then remove it.

## Task 2: add page metadata (major)

File: `app/layout.tsx`.

- Add `export const metadata: Metadata = { title: "Kratt", description: "Kratt study app" }`, importing `Metadata` from `next` as the installed docs show.
- Check: after `npm run build`, `.next/server/app/index.html` contains `<title>Kratt</title>`.

## Task 3: make the theme hotkey safe and accessible (major + minors)

File: `components/theme-provider.tsx`.

Make these changes:

1. **Possible crash.** Chrome autofill can send `keydown` with no `key`. Guard it with `event.key?.toLowerCase()` (or `typeof event.key !== "string"` → return), and run the typing-target check before reading the key.
2. **IME.** Return early when `event.isComposing` is true.
3. **Shadow DOM and ARIA text widgets.** Pass `event.composedPath()[0]` to `isTypingTarget` instead of `event.target`. Also treat elements with `role` of `textbox`, `searchbox` or `combobox` as typing targets.
4. **WCAG 2.1.4 (single-character shortcuts).** Pick the default below, and record it in the summary so the user can overrule it:
   - The bare `d` stays, but it only fires when focus is on nothing: `document.activeElement` is `null` or `document.body`. That way it never interferes with menus, listboxes or other widgets.
   - Add a `hotkey?: boolean` prop to `ThemeProvider` (default `true`). When it is `false`, `ThemeHotkey` is not rendered, so the app can wire this to a user setting later.
   - Add a visible theme toggle button to `app/page.tsx` (use the existing `Button`, `variant="outline"`, with an accessible label such as "Toggle dark mode"), so the theme can be changed without the keyboard. It needs `"use client"`, so put it in a small client component, `components/theme-toggle.tsx`, that calls `useTheme()`.
5. **Layouts.** Keep matching `event.key` (it follows the user's layout). Leave a one-line comment that non-Latin layouts never send `d`.
6. Shift+D toggling is fine. Do not add a way back to "system" theme. That is out of scope; mention it in the summary.

Do not change the effect's cleanup, dependency array, `defaultPrevented`/`repeat` checks, or the `return null` render, because the review found those correct.

## Task 4: formatting passes everywhere (major)

- `package.json`: change `"format"` to `prettier --write .` and add `"format:check": "prettier --check ."`.
- `.prettierignore`: remove `pnpm-lock.yaml` and `.pnpm-store/` (this repo uses npm). Add `package-lock.json`, `next-env.d.ts`, `*.tsbuildinfo` and `public/`. End the file with a newline.
- Run `npm run format`. This should fix `app/layout.tsx`, `app/globals.css`, `eslint.config.mjs` and `README.md`. Read the `globals.css` diff: it should only change whitespace and brace placement, with no token values changed.
- In `app/layout.tsx`, rename `geist` to `fontSans` to match `fontMono`. Drop the `"font-sans"` class from `<html>`, because `globals.css` already applies `html { @apply font-sans }`.
- `eslint.config.mjs`: remove the comments saying the block "overrides" the default ignores; it only restates them. Keep the `globalIgnores` entries.
- Commit formatting-only changes separately from logic changes.

## Task 5: dependency hygiene (minor)

File: `package.json`. Then run `npm install` so the lockfile matches.

- Move `shadcn` from `dependencies` to `devDependencies`. It is a CLI and is only needed at build time for `@import "shadcn/tailwind.css"`. Check that `npm run build` still passes.
- Keep `lucide-react`. `components.json` names it as the icon library, so shadcn components added later will import it. Do not remove it.
- Add `"engines": { "node": ">=20.9.0" }` (Next's minimum, from `node_modules/next/package.json`).
- Leave `@types/node` at `^20` to match the `engines` floor, and leave the mixed version pinning as it is.

## Task 6: small config and doc fixes (minor)

- `.gitignore`: add `!.env.example` after the `.env*` line.
- `tsconfig.json`: remove `allowJs`, because no JS files are included. Add `noFallthroughCasesInSwitch: true` and `noImplicitOverride: true`. Do not turn on `noUncheckedIndexedAccess` or `verbatimModuleSyntax` (too invasive for generated shadcn components).
- Delete `components/.gitkeep` and `lib/.gitkeep`, because those folders now contain files. Keep `hooks/.gitkeep` and `public/.gitkeep`.
- `app/page.tsx`: wrap the content in `<main>` instead of the outer `<div>`, keeping the same classes.
- `README.md`: rewrite it briefly for Kratt.
  - Say what this folder is (the Kratt UI template on Next 16 + shadcn base-nova).
  - List the scripts: `dev`, `build`, `typecheck`, `lint`, `format`, `format:check`.
  - Say components are added with `npx shadcn@latest add <component>` and go in `components/ui`.
  - Document the `d` hotkey (it works when nothing is focused) and the toggle button.
- `/home/caesarsta/Kratt/CLAUDE.md`: in the "kratt template" section, replace any claim that only `app/layout.tsx` fails Prettier with a statement that the repo passes `npm run format:check`. Mention the new script.

## Out of scope

- The self-referential `--font-sans: var(--font-sans)` in `globals.css` (it is shadcn's default and works today).
- The `dark` custom variant not matching `<html>` itself.
- Adding CI, a test runner, CSS linting, or `--max-warnings=0`.
- Anything in `~/Downloads/KRATT`.

## Done when

From `kratt/`, all of these exit 0:

```bash
npm run typecheck
npm run lint
npm run format:check
npm run build
```

Also:
- `grep -o "<title>[^<]*</title>" .next/server/app/index.html` prints `<title>Kratt</title>`.
- `git status` is clean, with commits on the feature branch. Do not merge or push.

Finish with a short report that lists:
- each task and its commit hash;
- the WCAG choice made in Task 3.4, so the user can confirm or change it;
- anything skipped, and why.
