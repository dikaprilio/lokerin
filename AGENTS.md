# AGENTS.md

Rules for anyone, human or AI agent, working in this repository. They follow the team's GitHub repository guideline in `al-dioooo/lokerin-docs`, with the same sprint exceptions as `lokerin-web`.

## Domain language

Use the terms in `lokerin-docs/GLOSSARY.md` in code, routes, events and copy: Pencari Kerja, Pemberi Kerja, Lowongan, Lamaran, Fakta, Persona, Profil Induk, CV Khusus, Pemeriksaan, Peringatan Upah, Tahap Berikutnya. Hard-to-reverse decisions live in `lokerin-docs/docs/adr/`.

## Rules the code keeps

- The agent only prepares (ADR 0004). Terbit, sending a Lamaran, marking Lolos and saving a Fakta happen only through routes that a button calls. Never add an agent tool for them.
- A CV Khusus only contains points that cite a confirmed Fakta.
- A Pencari Kerja's contact details stay hidden from the Pemberi Kerja until the Lamaran is Lolos.

## Repository rules

- **Commits.** Small and focused, one logical change each. Conventional Commits for commit messages and PR titles: `type(scope): description`. Typecheck (`pnpm typecheck`) must pass and the change must work locally.
- **Branches.** Short-lived `feature/<desc>`, `fix/<desc>` or `chore/<desc>`, merged through a PR. No direct commits to `main`.
- **Secrets.** Never commit `.env*` files, API keys, tokens or logs. Only `.env.example` with empty values is committed.
- **Sprint exceptions** (until the competition ends): TDD and new tests are not required, and PRs need no reviewer. Always ask Alice before merging any PR, and merge only after she says yes.

## Attribution

Never add AI attribution anywhere: no AI author or `Co-authored-by` trailers, and no "Generated with" or "Written by" lines in commits, PRs, code comments or docs.
