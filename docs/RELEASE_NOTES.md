## Unsigned desktop preview

Kratt now packages its study workspace and local engine as a desktop app. The engine starts automatically, creates a standard per-user Study folder, reports startup failures with Retry/Open logs, and stops with the app. Notes, chats, sources and artifacts are real files. AI setup supports local Ollama detection, model selection and explicit downloads.

Included study features: connected notes, flashcards, slides, quizzes, full-screen viewers, source links, and generation that splits large selected inputs into parts.

**Testing builds:** macOS apps are not Developer ID signed/notarized; Windows installers are not publisher signed. Gatekeeper or SmartScreen may block them. Signing is intentionally deferred at the owner's request. Automated package verification exercises the embedded engine; check platform metadata and the repository validation record for completed checks and remaining GUI tests.

See the attached INSTALL files for OS-specific instructions and data locations. SHA256SUMS files cover packages and metadata. Please back up your Study folder before testing. This is a draft prerelease until reviewed; it is not a stable signed release.
