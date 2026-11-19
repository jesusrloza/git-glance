# knowledge

Notes about the repos you report on: context that helps read a report but does not live in those repos.

## What goes here

- What each repo is, who owns it, and how the repos relate to each other.
- Conventions that explain the numbers: branch and release flow, bots to ignore, renamed authors.
- Decisions and their reasons, with a date.

Keep one file per repo (`<repo>.md`) plus files for topics that span repos. Write about the present and edit in place; put dated history in a separate file only when the reasoning matters later.

## What does not

- Secrets, tokens or credentials.
- Generated reports: those go in `out/`.
- Documentation for git-glance itself: that goes in `docs/`.

## Private by default

Everything in `knowledge/` except this README is gitignored (`knowledge/*` plus `!knowledge/README.md` in `.gitignore`). Notes, `tmp/`, `backup/` and any new folder stay local without touching `.gitignore`. To commit a file on purpose, add a `!knowledge/<path>` exception for it.
