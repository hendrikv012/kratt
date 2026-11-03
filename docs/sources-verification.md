# Sources Part A verification

Version 1.6.0, Linux local build. This completes the approved 2026-10-27 Sources design recovered from Claude’s `sources-subject-pages` and `streamed-upload` worktrees. Web search is still Part B. The current implementation keeps the owner’s requested source cards inside subject tabs and puts all box-style choices in Settings.

## Automated checks

- Every frontend test file: 87 files, 1,072 tests at the full-run checkpoint. One obsolete New source button assertion was updated and its file passed. Subsequent focused checks add eight regressions and pass: directory wrapper/partial-read handling, authenticated XHR, malformed success replies, queued cancellation, Study-folder switching, named errors and deletion during upload.
- Engine full suite: 460 passed, 11 skipped, 19 failed. Running the failing modules against unchanged HEAD reproduces all 19 failures: advanced CLI sandbox/check-tool paths in this local venv and the existing smoke-summary assertion. They are separate from desktop upload behavior.
- Final upload/vault/desktop regression subset: 55 passed, including two added HTTP framing/auth tests. Frontend production build and PyInstaller engine build pass.
- Browser on an isolated Study copy: imported a real nested folder (3 PDFs, 2 pictures and Markdown), skipped `.DS_Store`, checked original SHA-256s, repeated imports, confirmed subject identities/order unchanged, tested tabs/sorts/paste and native drag from Unsorted.
- A real 3,000,000,000-byte file uploaded through Chromium’s File/XHR path and matched SHA-256. Cancel of another 3 GB file left no original or `.part` files. Duplicate detection survived reload. The 50 GB ceiling is covered by boundary tests; no actual 50 GB upload was performed.
- Ember, Ember light and Chalk: Settings changes, keyboard opening, visible menus, return/reload and narrow layout. Repository screenshots contain only synthetic example data; Study-copy screenshots remain local.

## Safety

Both `~/Study` and the installed app’s `~/.local/share/kratt/Study` were archived and hashed before browser work. Backups, copy and detailed evidence live in `~/.cache/kratt-sources-verification/`. Browser tests use a separate engine configuration. Original upload files are excluded from vault snapshots/indexing; Markdown originals are not rewritten. No real AI calls are made.

## Try it

1. Open Sources: subject boxes are followed by Unsorted. There is no Unsorted box.
2. Drop a folder onto a subject, or drop a file outside the boxes to leave it Unsorted. Drag its row onto a subject.
3. Open two subjects; both remain available in the tab bar. Try Add link, Upload files, Paste text and Sort.
4. During an upload, switch tabs or press Cancel. Completed files remain; the interrupted source says Original not saved and unstarted files disappear.
5. Choose Rich/Simple/Preview in Settings → Layout and home screen → Sources. Quit and reopen to check saved style and tabs.

Native package/install check passed on the extracted installed Linux 1.6.0 executable (`36c0913`): authenticated upload, source navigation, Settings persistence and tab restoration after clearing localStorage and restarting. The existing launcher now points to this version; the previous installation is retained. Other OS builds are not claimed by this local Linux verification.
