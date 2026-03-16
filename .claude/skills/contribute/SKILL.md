---
name: contribute
description: Package your work into a clean PR against the correct upstream target. Handles skills, bug fixes, simplifications, and channel fixes. Walks through validation, clean branching, and PR creation.
---

# About

Package your NanoClaw work — skills, bug fixes, simplifications, or channel fixes — into a clean PR against the right upstream target. This is a packaging workflow, not a development workflow. The work should already be built and tested.

The skill interviews the user, validates their contribution, creates an isolated clean branch via git worktree (never touching their working tree), and opens a PR with the correct labels and format.

## How it works

**Interview**: understand what they built, the use case, and how long they've used it.

**Validate**: check the contribution is generic enough for many users (90/90 rule).

**Classify**: determine if it's a core fix, a new skill, or a channel fix — then route to the right path.

**Quality check**: review the diff for simplicity, edge case density, and proportionality (value must match lines of code).

**Clean branch**: create an isolated worktree from upstream, copy only the relevant files, surgically remove unrelated changes if needed, and commit.

**Open PR**: push and create a PR with the NanoClaw template, type-aware badge, and hidden `<!-- via-contribute -->` tag for discoverability.

# Goal

Help a contributor package their work — skills, bug fixes, simplifications, or channel fixes — into a clean PR against the correct upstream NanoClaw target.

# Operating principles

- Act as a collaborative mentor, not a gatekeeper. Suggest and guide, never block.
- Use judgment — context over rigid rules. A clean 35-line fix is fine even if the guideline says 30.
- Suggest, don't command. When something should change, explain why and offer to help.
- Evaluate code complexity, not just line count. Flag edge case density and unnecessary UX polish.
- Never touch the user's working tree. All git operations happen in an isolated worktree.
- Keep token usage low: use git commands for analysis, only open files when reviewing diffs for mixed concerns.

**UX Note:** Use `AskUserQuestion` for all user-facing questions.

# Step 0: Preflight

Check prerequisites. Fix what can be fixed automatically; exit with guidance for what can't.

Run:
- `gh auth status`
If not authenticated:
- Tell the user: "You'll need the GitHub CLI authenticated to open a PR. Run `gh auth login` and come back." Stop.

Check remotes:
- `git remote -v`
If `upstream` is missing:
- Add it: `git remote add upstream https://github.com/qwibitai/nanoclaw.git`
- Then: `git fetch upstream --prune`

If `origin` points to `qwibitai/nanoclaw` (user cloned directly, no fork):
- Tell the user: "To open a PR, you'll need your own fork of NanoClaw." Use AskUserQuestion to offer: "Want me to help set up a fork?" If yes, guide them through `gh repo fork` or manual forking. If no, stop.

Extract the fork owner for later PR creation:
- `FORK_OWNER=$(gh repo view --json owner -q '.owner.login' 2>/dev/null || git remote get-url origin | sed 's|.*github.com[:/]\([^/]*\)/.*|\1|')`

Store FORK_OWNER for use in Step 8.

Fetch and sync:
- `git fetch upstream --prune`
- `git fetch origin main`
- Sync the user's fork with upstream so the PR base commit exists:
  ```
  git push origin upstream/main:refs/heads/main 2>/dev/null || true
  ```
  If push fails (diverged history), fall back to:
  ```
  gh repo sync "$FORK_OWNER/nanoclaw" --branch main --source qwibitai/nanoclaw
  ```

# Step 1: Interview

Understand what the user wants to contribute. Ask questions one at a time using AskUserQuestion.

**Question 1:** "What feature or fix are you looking to contribute?"

**Question 2:** "What's the use case? Who benefits from this?"

**Question 3:** "How long have you been using this in your installation?"

## "Not built yet" gate

If the user describes something they haven't implemented yet, or says they just built it today with no usage time:

Tell them:
> "That sounds like a great idea for a skill! However, `/contribute` is specifically designed to package and PR code that you've already built and used locally for a few days."
>
> "Instead of stopping, let's switch gears. I'll load the `/guidelines` for you right now so we have the right philosophy in mind, and we can start building your [feature] right away."
>
> "Once we build it, I recommend using it in your daily workflow to catch any edge cases. Would you like me to set a reminder to run `/contribute` in 3 days to officially submit it?"

If they want the reminder, create a note or scheduled task reminder. Then invoke the `/guidelines` skill and transition to development mode. **Exit the /contribute flow.**


# Step 2: Validate generality

Evaluate whether the contribution is useful to many NanoClaw users based on what the user described.

**Three outcomes:**

**Generic enough** — most contributions will pass. Proceed to Step 3.

**Too niche** — the feature is very specific to the user's setup. Mentor them: "This is pretty specific to your setup. To make it work for more people, we could [specific suggestion to generalize]. What do you think?" If they can't generalize it, suggest keeping it in their own fork.

**Unclear** — "I'm not 100% sure if this is generic enough for the main repo. It might be worth asking in the NanoClaw Discord to gauge interest before we submit. Want to proceed anyway or check with the community first?"

# Step 3: Classify and route

Determine the contribution type. Inspect the working tree to see which files changed:
- `git diff --name-only upstream/main`
- `git ls-files --others --exclude-standard`

Use judgment based on the file paths AND the user's description — then confirm with the user conversationally.

**Classification logic:**

| Signal | Classification |
|--------|---------------|
| Changes only in `.claude/skills/` (generic) | New Skill |
| Skill relevant only to one channel (e.g., Telegram-only) | Channel Skill → branch on that channel's fork |
| Changes only in `src/` — bug fix, security fix, simplification | Core Fix |
| Changes in `src/channels/telegram*` or telegram-specific logic | Channel Fix (Telegram) |
| Changes in `src/channels/discord*` | Channel Fix (Discord) |
| Changes in `src/channels/whatsapp*` | Channel Fix (WhatsApp) |
| Changes in `src/channels/slack*` | Channel Fix (Slack) |
| Changes in `src/channels/gmail*` | Channel Fix (Gmail) |
| New feature that modifies `src/` | Suggest conversion to Skill |
| Mixed changes across categories | Help user split into separate PRs |

**Transition to the right path conversationally:**
- Core Fix: "Got it, this is a core fix. Let's make sure it's super lean before we pack it up." → proceed to Step 4a.
- New Skill: "Nice — this is a new skill. Let me help you get the SKILL.md right and we'll submit it." → proceed to Step 4b.
- Channel Fix: "This touches [channel]-specific code, so we'll target the [channel] fork. Let me check what's needed." → proceed to Step 4c.
- Feature in `src/`: "I see some interesting logic in `src/`. To keep the core lean, would you like me to help package this as a SKILL.md? The NanoClaw philosophy is that new capabilities live as skills, not source code." → if they agree, proceed to Step 4b. If there's a reason it must be source code, proceed to Step 4a.

---

# Core Fix Path

## Step 4a: Quality — vibe check

Review the diff against upstream and evaluate quality. Use judgment, not rigid rules.

Run:
- `git diff upstream/main -- <selected-files>`

Read the diff and check:

**Line count vs. value** — is the diff proportional to the importance of the fix? A clean 35-line fix is fine. A 300-line fix for a small edge case needs discussion.

**Edge case density** — does the code handle scenarios that fewer than 10% of users will encounter? Suggest trimming: "Do we really need this error handling? Most users won't hit this path. Should we trim it to match the 90/90 rule?"

**Unnecessary UX polish** — error messages for misuse scenarios, defensive validation for impossible states? Suggest removing: "This error message for [scenario] is nice, but most users won't trigger it. Want to remove it to keep things lean?"

**Complexity** — could this be simpler? Fewer abstractions? Fewer layers?

**How to communicate:**
- No issues: "This looks clean and focused. Nice work."
- Minor: "I noticed [thing]. It's not a blocker, but trimming it would make the PR tighter. Want me to help?"
- Significant: "This is [X lines] for [a small fix]. The NanoClaw guideline is to keep core PRs under 20-30 lines. Can we simplify? Here's what I'd suggest..."

If the diff is significantly over 30 lines and hasn't been discussed in Discord: "For a core change this size, the NanoClaw team prefers it to be discussed in Discord first. Want to proceed anyway, or check with the community?"

## Step 5a: Tests

Run:
- `npm run build && npm test`
If build or tests fail, help the user fix the issues before proceeding.

Generate 3-5 test cases specific to this fix. Present them: "Here's what I'd recommend testing before we submit..."

Use AskUserQuestion to confirm: "Have you tested all of these?" Record what they tested — this goes into the PR body.

## Step 6a: Determine target

Core fixes go to `main` on `qwibitai/nanoclaw`.

Store:
- `TARGET_REPO="qwibitai/nanoclaw"`
- `TARGET_BRANCH="main"`
- `TARGET_REMOTE="upstream"`

Confirm with user: "I'll target `qwibitai/nanoclaw` branch `main`. Sound right?"

Proceed to Step 7.

---

# New Skill Path

## Step 4b: SKILL.md validation

If the user already has a SKILL.md in `.claude/skills/<name>/SKILL.md`:
- Read it and validate:
  - Contains YAML frontmatter with `name` and `description`
  - Contains **instructions** for Claude to follow, not pre-built code
  - Does not modify source files
  - Instructions are clear enough for someone else's Claude to follow
- If issues found, suggest improvements.

If the user has source code changes that should become a skill:
- Offer: "I can read your code changes and draft a SKILL.md that teaches Claude how to apply them. Want me to give it a shot?"
- Create a SKILL.md with instructions that reference merging from a skill branch, matching the pattern of `/add-telegram` and `/add-discord`.

## Step 5b: Generality review

Re-confirm the skill is useful to many users, not just this installation.

Check:
- Is the SKILL.md generic (no hardcoded paths, tokens, or user-specific config)?
- Are the instructions clear enough for someone unfamiliar with the codebase?
- Does it follow NanoClaw skill conventions (frontmatter, phases, verification)?

Suggest improvements if needed.

## Step 6b: Determine target

New skills go to `main` on `qwibitai/nanoclaw`. The team will create a dedicated branch if needed.

Store:
- `TARGET_REPO="qwibitai/nanoclaw"`
- `TARGET_BRANCH="main"`
- `TARGET_REMOTE="upstream"`

Proceed to Step 7.

---

# Channel/Fork Fix Path

## Step 4c: Identify fork

Map the changed files to the correct fork:

| Channel | Fork |
|---------|------|
| WhatsApp | `qwibitai/nanoclaw-whatsapp` |
| Telegram | `qwibitai/nanoclaw-telegram` |
| Discord | `qwibitai/nanoclaw-discord` |
| Slack | `qwibitai/nanoclaw-slack` |
| Gmail | `qwibitai/nanoclaw-gmail` |

Add the upstream channel fork as a remote if not present:
- `git remote add {channel} https://github.com/qwibitai/nanoclaw-{channel}.git`
- `git fetch {channel}`

Check if the user has a fork of the channel repo:
- `gh repo view "$FORK_OWNER/nanoclaw-{channel}" --json name 2>/dev/null`
If not: use AskUserQuestion: "To submit a PR to the {channel} fork, you'll need your own fork of `qwibitai/nanoclaw-{channel}`. Want me to create one?"
If yes:
- `gh repo fork "qwibitai/nanoclaw-{channel}" --clone=false`

Sync the user's channel fork with upstream:
- `gh repo sync "$FORK_OWNER/nanoclaw-{channel}" --branch main --source "qwibitai/nanoclaw-{channel}"`

Store:
- `TARGET_REPO="qwibitai/nanoclaw-{channel}"`
- `TARGET_BRANCH="main"`
- `TARGET_REMOTE="{channel}"` (the remote name added above, e.g., `telegram`)

## Step 5c: Quality check

Same vibe check as Step 4a, adapted to the channel context. Review the diff, check proportionality, flag edge case density.

## Step 6c: Confirm target

Confirm with user: "I'll target `qwibitai/nanoclaw-{channel}` branch `main`. Is that correct?"

Proceed to Step 7.

---

# Shared Steps (all paths converge)

## Step 7: Create clean branch

This is the core packaging step. Use a git worktree to create an isolated clean branch without touching the user's working tree.

**Tell the user before starting:**
> "I'm going to set up a clean, isolated temporary workspace for this PR. Don't worry — your current local files and uncommitted changes will stay completely untouched."

### 7a: Catalog changes

Collect all files that differ from the target upstream. Deduplicate and filter build artifacts.

Run:
- `git diff --name-only $TARGET_REMOTE/$TARGET_BRANCH` (all committed + staged + unstaged changes)
- `git diff --name-only --diff-filter=D $TARGET_REMOTE/$TARGET_BRANCH` (deleted files specifically)
- `git ls-files --others --exclude-standard | grep -v '^dist/' | grep -v '^node_modules/' | grep -v '\.js\.map$'` (untracked new files)

Combine the lists, deduplicate with `sort -u`. Present grouped by category:
- **Skills** (`.claude/skills/`)
- **Source** (`src/`)
- **Config** (`package.json`, `tsconfig*`, etc.)
- **Tests** (`*.test.ts`)
- **Other**

### Fast-path detection

Check if the user is already on a clean contribution branch:
- `git log --oneline $TARGET_REMOTE/$TARGET_BRANCH..HEAD`

If this shows only their feature commits and no unrelated changes, offer to skip the worktree: "It looks like your branch is already clean — just your contribution on top of upstream. Want me to PR directly from this branch instead of creating a separate workspace?"

If they accept the fast path, skip to Step 8 (push and PR from current branch).

### 7b: File selection

Use AskUserQuestion to ask which files belong to this contribution. Present the file list from 7a. Offer "all" as a shortcut if the list looks clean.

### 7c: Smart diff scan

Silently review the `git diff` for each selected file.

**90% case:** The whole file is relevant. Proceed without comment.

**10% case — mixed concerns detected:** If you spot obvious unrelated changes (debug `console.log`s, stray whitespace changes, commented-out code from experimentation, unrelated formatting), pause and tell the user:

> "I noticed some changes in `{filename}` that seem unrelated to the main feature (looks like debug logs / formatting changes). Want me to surgically remove those in the clean branch so your PR is perfectly focused, or should we leave them in?"

If they agree, use the Edit tool to clean up those specific hunks in the worktree copy after copying (in step 7d).

### 7d: Create worktree and apply

**Milestone: "Setting up a clean branch from upstream..."**

Determine the branch name based on contribution type:

| Type | Branch Name |
|------|-------------|
| New skill | `feat/{skill-name}` |
| Core bug fix | `fix/{description}` |
| Core simplification | `refactor/{description}` |
| Channel fix | `fix/{description}` |

```
TIMESTAMP=$(date +%s)
WORKTREE_PATH="../nanoclaw-contribute-$TIMESTAMP"
BRANCH_NAME="{type}/{description}"
```

Check for branch name collision:
- `git show-ref --verify --quiet "refs/heads/$BRANCH_NAME" 2>/dev/null`
If it exists, use AskUserQuestion: "A branch named `$BRANCH_NAME` already exists. Want to use a different name, or reuse the existing branch?" If different name, ask what name. If reuse, delete the old branch first.

Check for stale worktree:
```
if [ -d "$WORKTREE_PATH" ]; then
  git worktree remove "$WORKTREE_PATH" --force 2>/dev/null || rm -rf "$WORKTREE_PATH"
fi
```

Create worktree:
- `git worktree add "$WORKTREE_PATH" $TARGET_REMOTE/$TARGET_BRANCH -b "$BRANCH_NAME"`

**Milestone: "Porting your selected files into the clean workspace..."**

For each selected file (not deleted):
```
mkdir -p "$WORKTREE_PATH/$(dirname "$file")"
cp "$file" "$WORKTREE_PATH/$file"
```

For deleted files:
- `git -C "$WORKTREE_PATH" rm "$file"`

Apply surgical edits for mixed-concern files identified in 7c (use Edit tool on the worktree copies).

### 7e: Build validation

For skill-only PRs (changes only in `.claude/skills/`), skip the build step — go straight to 7f.

For code changes, **Milestone: "Validating build..."**

```
cd "$WORKTREE_PATH"
```

If `package.json` is among the selected files and was modified:
- `npm install`
Otherwise:
- `npm ci`

Then:
- `npm run build`

If build fails, the contribution likely depends on other local changes. Help the user identify what's missing and add those files to the selection. Do not proceed to commit until the build passes.

### 7f: Commit

**Milestone: "Committing..."**

```
git -C "$WORKTREE_PATH" add -A
git -C "$WORKTREE_PATH" reset HEAD node_modules 2>/dev/null || true
git -C "$WORKTREE_PATH" commit -m "{type}: {description}"
```

Use a conventional commit message matching the contribution type: `feat:`, `fix:`, `refactor:`.

### Error handling

If any git command fails during Step 7, switch to transparent mode:
- Show the exact error message
- Explain what happened in plain language
- Help the user resolve it manually
- Offer cleanup: `git worktree remove "$WORKTREE_PATH"`

## Step 8: Open the PR

### 8a: Push

**Milestone: "Pushing and opening the PR..."**

```
git -C "$WORKTREE_PATH" push -u origin "$BRANCH_NAME"
```

### 8b: Construct PR body

Build the PR body with the hidden tag, visible badge, and NanoClaw PR template format.

**For Core Fix PRs:**
```
<!-- via-contribute -->
> ⚡ **Submitted via /contribute** — *Core fix, priority review requested per contributor guidelines.*

## Type of Change

- [ ] **Skill** - adds a new skill in `.claude/skills/`
- [x] **Fix** - bug fix or security fix to source code
- [ ] **Simplification** - reduces or simplifies source code

## Description

{user's feature description, use case, and context from the interview}

## Testing

{what the user confirmed they tested, plus generated test cases from Step 5a}
```

**For New Skill PRs:**
```
<!-- via-contribute -->
> ⚡ **Submitted via /contribute** — *New skill, priority review requested per contributor guidelines.*

## Type of Change

- [x] **Skill** - adds a new skill in `.claude/skills/`
- [ ] **Fix** - bug fix or security fix to source code
- [ ] **Simplification** - reduces or simplifies source code

## Description

{user's feature description, use case, and context from the interview}

## For Skills

- [x] I have not made any changes to source code
- [x] My skill contains instructions for Claude to follow (not pre-built code)
- [x] I tested this skill on a fresh clone
```

**For Channel Fix PRs:**
```
<!-- via-contribute -->
> ⚡ **Submitted via /contribute** — *Channel fix ({channel}), priority review requested per contributor guidelines.*

## Type of Change

- [ ] **Skill** - adds a new skill in `.claude/skills/`
- [x] **Fix** - bug fix or security fix to source code
- [ ] **Simplification** - reduces or simplifies source code

## Description

{user's feature description, use case, and context from the interview}

## Testing

{what the user confirmed they tested}
```

### 8c: Create PR

```
gh pr create \
  --repo "$TARGET_REPO" \
  --base "$TARGET_BRANCH" \
  --head "$FORK_OWNER:$BRANCH_NAME" \
  --title "{type}: {short description}" \
  --body "$PR_BODY"
```

For channel forks, `--repo` points to the fork repo (e.g., `qwibitai/nanoclaw-telegram`).

Capture the PR URL from the output.

## Step 9: Summary and cleanup

Clean up the worktree:
- `git worktree remove "$WORKTREE_PATH"`

**Milestone: "Done!"**

Tell the user:
> "PR created successfully! I've also cleaned up the temporary workspace, so your local environment is exactly as you left it."
>
> **PR:** {url}
>
> Maintainers will see the `/contribute` badge and prioritize the review. You can track the PR status on GitHub.
>
> If you need to make changes later, switch to the `{branch-name}` branch, make edits, and push.
