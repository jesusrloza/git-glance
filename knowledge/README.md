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

## `tmp/`

`tmp/` is gitignored. Use it for private working notes, drafts and scratch scripts that should never be committed. Move anything worth keeping up into this folder.
