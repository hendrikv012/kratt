# Kratt

A desktop study workspace with connected notes and a local AI study partner. Write notes, keep sources together, and make flashcards, slides and quizzes from your own material.

- [Product website](https://hendrikv012.github.io/kratt/)
- [Releases and downloads](https://github.com/hendrikv012/kratt/releases)
- [Install guide](docs/INSTALL.md)
- [Build and release guide](docs/desktop-release.md)
- [Architecture](docs/02_Architecture.md) · [Product specification](docs/desktop-product-spec.md)

The current desktop work produces **unsigned testing builds**. Branch builds appear in GitHub Actions; version tags create draft prereleases. macOS notarization and Windows publisher signing are intentionally deferred. See [validation](docs/desktop-verification.md) for what has actually been checked.

The app is in `apps/study`, its bundled Python engine source in `engine`, and the separate GitHub Pages marketing site in `site`. Study files stay on disk. The installed app starts the engine automatically; Python and terminal setup are not required by end users. Ollama is optional for notes and required for local AI.
