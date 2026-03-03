# RFC: Per-Group Identity & Granular Configuration

## Discord Thread Draft

**Title:** Per-group identity, tools, and multi-channel — a case for granular group configuration

---

### Context

I run NanoClaw with 3+ groups that serve fundamentally different purposes:

- A **family group** — playful name, warm personality, Apple Reminders MCP, Spanish
- A **work group** — professional tone, serious name, Google Workspace MCP. Clients may join this group — I can't have a goofy assistant name here.
- A **family-member group** — entirely different assistant name, patient communication style adapted for an older non-technical family member in a different city

Each group already has its own CLAUDE.md, .mcp.json, and container mounts. The per-group isolation is great. But several things are still globally hardcoded in ways that break multi-persona setups.

---

### Problem 1: Assistant name is global

`ASSISTANT_NAME` in `.env` is a single value used everywhere:
- **Message prefix** (`whatsapp.ts` → `${ASSISTANT_NAME}: ${text}`) — every outgoing message is signed with the same name regardless of group
- **Trigger pattern** (`config.ts` → `@${ASSISTANT_NAME}`) — the default trigger for all groups
- **Global CLAUDE.md** (`# Gambi / You are Gambi`) — identity injected into all agents

So even if a group's CLAUDE.md says "Your name is Alaska", the messages arrive in chat as "Gambi: ..." and the trigger is @Gambi. The agent has an identity crisis.

**Desired**: `assistantName` as a per-group field in `registered_groups`, falling back to the global `ASSISTANT_NAME` for groups that don't override it. The message prefix and trigger pattern should use the group's name.

---

### Problem 2: MCP tools — no shared layer

Currently each group has its own `.mcp.json` with its full MCP config. If I want all groups to have access to a tool (e.g., Apple Reminders), I have to copy the config to every group's `.mcp.json` and keep them in sync.

There's no concept of "global MCP tools available to all groups" vs "group-specific MCP tools".

**Desired**: A global `.mcp.json` (or the existing `groups/global/` folder) that defines shared MCP servers, with per-group `.mcp.json` adding or overriding. Similar to how CLAUDE.md already works (global + group layered).

---

### Problem 3: One group = one channel (no private sidebars)

Each group is tied to a single JID. The group IS the agent — there's no separation between the agent's context and the chat it lives in.

Real use case: I have a family assistant in a group with my wife. It has our family context, documents, personality, reminders — everything dialed in. But sometimes I want to ask it technical questions (configure the router, research a product, debug something) without flooding the family chat with irrelevant noise.

Today my only options are:
1. **Ask in the family group anyway** — my wife sees a wall of technical back-and-forth she doesn't care about
2. **Create a separate group** — duplicate the CLAUDE.md, .mcp.json, mounts, and accept that the two groups diverge over time (one learns something, the other doesn't)

What I actually want: a **private 1-on-1 chat** that connects to the same agent workspace. Same memory, same files, same personality — just a different entry point. Like opening a DM with a coworker instead of discussing in the team channel.

This extends beyond WhatsApp DMs. The same agent context should be reachable from multiple chats (group + DM) or even multiple channels (WhatsApp + Telegram). The workspace is the agent; the chat is just a window into it.

**Desired**: Decouple "agent workspace" from "chat binding". A workspace (folder, CLAUDE.md, .mcp.json, mounts) could have multiple channel bindings — a group chat, a private DM, a Telegram chat — all sharing the same context.

---

### Problem 4: Secrets/env vars are global — no per-group credentials

`readSecrets()` in `container-runner.ts` reads a flat list of env vars from `.env` and passes **all of them** to **every** container. There's no per-group scoping.

Real use case: I use the Gmail MCP skill for both work and family. My work group needs work OAuth credentials, and my family group needs personal Gmail credentials. Same MCP server, same skill, different credentials.

Today the only workaround is naming hacks (`WORK_GOOGLE_EMAIL`, `FAMILY_GOOGLE_EMAIL`) with per-group `.mcp.json` files that interpolate different variable names. This means:
- Every group's `.mcp.json` is slightly different even for the same MCP server
- Skills that generate `.mcp.json` entries assume standard env var names and break
- All secrets are sent to all containers — work credentials leak to the family group's container (even if unused)

**Desired**: Per-group env var overrides, with global `.env` as the fallback. Groups only receive the secrets they need. A group could define `GOOGLE_OAUTH_CLIENT_ID` in its own config and it would override the global one for that group's container.

Possible implementations:
- `groups/{name}/.env` file (simple, mirrors the global pattern)
- `containerConfig.env` field in `registered_groups` (DB-based, encrypted)
- Scoped naming convention in global `.env` with auto-resolution (`{GROUP}_VAR` → `VAR` inside that group's container)

---

### Problem 5: global/CLAUDE.md mixes infrastructure with identity

The current template includes both:
- **Infrastructure** (universal): formatting rules, `<internal>` tags, `send_message` behavior, workspace path, memory guidelines
- **Identity** (per-group): assistant name, personality, user location/culture

Since global is appended to every non-main group's system prompt, putting identity here creates conflicts for any group that defines its own name/personality.

**Desired**: Global CLAUDE.md should be pure infrastructure. Identity (name, personality, language, location) belongs exclusively in per-group CLAUDE.md.

---

### Proposed Model

```
Configuration Hierarchy:

.env / global config
├── ASSISTANT_NAME = "Gambi"          ← default fallback only
├── GOOGLE_OAUTH_CLIENT_ID = "..."    ← default credentials (fallback)
├── global/.mcp.json                  ← shared MCP tools (all groups inherit)
└── global/CLAUDE.md                  ← infrastructure only (formatting, tags, workspace)

registered_groups (per-group overrides)
├── assistantName = "Alaska"          ← overrides message prefix + trigger
├── channels = [whatsapp_jid, telegram_jid]  ← multi-channel binding
├── groups/{name}/.env                ← per-group secrets (override global)
├── groups/{name}/.mcp.json           ← group-specific MCP (merged with global)
└── groups/{name}/CLAUDE.md           ← identity, personality, language, workflows
```

Resolution order (most specific wins):
1. Per-group config (name, secrets, tools, identity)
2. Global shared config (MCP tools, default secrets, infra rules)
3. System defaults (.env fallbacks)

The key principle: **a single NanoClaw instance should support groups with completely different identities, credentials, and tool access** without duplication or naming hacks. Groups inherit everything from global by default, but can override any layer.

---

### What I've done locally

As a workaround, I've:
1. Stripped `global/CLAUDE.md` to infrastructure-only (no name, no location, no personality)
2. Made each group's CLAUDE.md fully self-contained for identity
3. Each group has its own .mcp.json (with manual duplication for shared tools)

The assistant name prefix is still global — I haven't patched the routing layer yet. That's the one change that requires code, not just config.

---

### Questions for the community

1. **Per-group assistant name** — does this make sense as a feature? It touches `config.ts`, `whatsapp.ts` (and future channel implementations), and the `registered_groups` schema.
2. **Per-group secrets** — what's the best mechanism? `groups/{name}/.env` (simple files), DB-based config, or scoped naming in the global `.env`?
3. **Global MCP layer** — is there interest in a shared `.mcp.json` that all groups inherit? Or is per-group duplication acceptable?
4. **Multi-channel per group** — is anyone else running the same agent context across multiple channels? How are you handling it?
5. **Identity-free global template** — should the upstream `global/CLAUDE.md` ship without assistant name/personality by default?

The underlying question: **should NanoClaw's configuration model evolve from "one assistant, many groups" to "many personas, one engine"?**
