# Roadmap

Ideas that are agreed in principle but not built yet. Each entry says what it
would add, what it needs, and what is still open.

## GitHub: follow-ups

The pull request, reviews given and CI health cards, plus the PR column on
Work in flight, ship today through `gh` (see the README). Still open:

| Idea | Notes |
|------|-------|
| Response cache | Cache `gh` responses under `out/.cache/`, keyed by window and repo, so re-running a past month is instant and offline. Needs an invalidation rule for the current window. |
| Review turnaround from the request | The reviews card measures time from PR opened to first review. Time from *review requested* needs the PR timeline events (`gh api …/timeline`), one call per PR. |
| Reviews received | How many reviews the author's PRs got and from whom, and rounds of changes requested before merge. |
| Token fallback | Read a fine-grained `GITHUB_TOKEN` and call the REST API directly where `gh` cannot be installed. More code (pagination, rate limits). |
| Bot filtering | Leave out runs and reviews by bots (`dependabot`, `github-actions`) from per-author views, or group them as one author. |
