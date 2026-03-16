---
name: guidelines
description: NanoClaw contribution rules. Load when developing something to contribute or when reviewing a PR.
---

# NanoClaw Guidelines

Quick reference for developing and reviewing NanoClaw contributions.

## Rules

**Channels live in forks, not core.** WhatsApp, Telegram, Discord, Slack, Gmail each have their own repo (`qwibitai/nanoclaw-{channel}`). Channel code never goes into the main repo.

**Features are skills, not source code.** New capabilities go in `.claude/skills/` as SKILL.md files with instructions — not as source code changes. Source code PRs are only for bug fixes, security fixes, and simplifications.

**No personal config in upstream.** Bot names, sign-offs, hardcoded paths, user-specific settings stay in the contributor's fork.

**One PR, one thing.** Don't mix unrelated changes. A CI workflow fix and a new channel and a bot rename is three PRs, not one.

**Value must match lines of code.** Small fix = small diff. Core PRs over 20-30 lines need prior discussion in Discord. Red flags: 300+ lines for a small improvement, unfilled PR template, empty description.

**Keep it simple.** Handle the 90% case. No edge case handling for < 10% of users, no error messages for misuse, no defensive validation for impossible scenarios. Let it fail silently.

**Skills must be generic.** Useful to many users, not hyper-specific to one setup. When in doubt, ask in Discord.

## Where Things Go

| What | Where |
|------|-------|
| Bug fix / simplification to core | PR to `main` on `qwibitai/nanoclaw` |
| New skill (SKILL.md only) | PR to `main` on `qwibitai/nanoclaw` |
| Channel fix | PR to that channel's fork (e.g., `qwibitai/nanoclaw-telegram`) |
| Large core change | Discuss in Discord first, then PR |

## PR Expectations

- Fill out the PR template (type of change, description)
- Skills: no source code changes, instructions only, tested on fresh clone
- Code: `npm run build && npm test` passes
- Conventional commits: `feat:`, `fix:`, `refactor:`, `docs:`
