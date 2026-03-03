# Discord Thread: Per-Group Identity & Granular Configuration

Copy each section below as a separate Discord message. Post the initial message first, then each reply in order.

---

## POST INICIAL (Title: "Many personas, one engine — per-group identity & granular configuration")

I run NanoClaw with 3+ groups that serve fundamentally different purposes:

- A **family group** — playful name, warm personality, Apple Reminders MCP, Spanish
- A **work group** — professional tone, serious name, Google Workspace MCP. Clients may join this group — I can't have a goofy assistant name here
- A **family-member group** — entirely different assistant name, patient communication style adapted for an older non-technical family member in a different city

Each group already has its own `CLAUDE.md`, `.mcp.json`, and container mounts. The per-group isolation is great. But several things are still **globally hardcoded** in ways that break multi-persona setups.

The current design assumes **"one assistant, many groups"**. But real usage looks more like **"many personas, one engine"** — same NanoClaw instance, completely different identities, credentials, and tool access per group.

I also noticed that `global/CLAUDE.md` mixes infrastructure (`<internal>` tags, formatting rules, workspace mechanics) with identity (assistant name, personality, location). Since global is appended to every group's system prompt, this creates conflicts for any group that defines its own name or personality. Locally I've stripped global to **infrastructure only** and it works much better.

I'll break down the specific problems in replies below 👇

---

## REPLY 1: Assistant name is global

### Problem 1: Assistant name is global

`ASSISTANT_NAME` in `.env` is a single value used everywhere:
- **Message prefix** — every outgoing message is signed `Gambi: ...` regardless of group
- **Trigger pattern** — `@Gambi` is the default trigger for all groups
- **Global CLAUDE.md** — `You are Gambi` is injected into all agents

So even if a group's CLAUDE.md says "Your name is Alaska", messages arrive in chat as `Gambi: ...` and the trigger is `@Gambi`. The agent has an identity crisis.

**Desired**: `assistantName` as a per-group field in `registered_groups`, falling back to `ASSISTANT_NAME` for groups that don't override it. The message prefix and trigger should use the group's name.

---

## REPLY 2: MCP tools — no shared layer

### Problem 2: MCP tools — no shared layer

Each group has its own `.mcp.json` with its full MCP config. If I want all groups to have access to a tool (e.g., Apple Reminders), I have to copy the config to every group's `.mcp.json` and keep them in sync.

There's no concept of "global MCP tools available to all groups" vs "group-specific tools".

**Desired**: A global `.mcp.json` that defines shared MCP servers, with per-group `.mcp.json` adding or overriding. Similar to how `CLAUDE.md` already works (global + group layered).

---

## REPLY 3: No private sidebars

### Problem 3: One group = one channel (no private sidebars)

Each group is tied to a single JID. The group IS the agent — there's no separation between the agent's context and the chat it lives in.

My use case: I have a family assistant in a group with my wife. It has our family context, documents, personality, reminders — everything dialed in. But sometimes I want to ask it technical questions (configure the router, research a product) without flooding the family chat with irrelevant noise.

Today my options are:
1. **Ask in the family group** — my wife sees a wall of tech back-and-forth she doesn't care about
2. **Create a separate group** — duplicate everything and accept the two groups diverge over time

What I actually want: a **private 1-on-1 chat** that connects to the same workspace. Same memory, same files, same personality — just a different entry point. Like DMing a coworker instead of discussing in the team channel.

**Desired**: Decouple "agent workspace" from "chat binding". A workspace could have multiple channel bindings — a group chat, a DM, a Telegram chat — all sharing the same context. The workspace is the agent; the chat is just a window into it.

---

## REPLY 4: Secrets are global

### Problem 4: Secrets/env vars are global — no per-group credentials

`readSecrets()` reads a flat list of env vars from `.env` and passes **all of them** to **every** container. No per-group scoping.

Real use case: I use the Gmail MCP for both work and family. Work needs work OAuth credentials, family needs personal Gmail credentials. Same MCP server, same skill, different credentials.

The only workaround is naming hacks (`WORK_GOOGLE_EMAIL`, `FAMILY_GOOGLE_EMAIL`) with different `.mcp.json` per group. This means:
- Every group's `.mcp.json` is slightly different even for the same MCP server
- Skills that generate `.mcp.json` entries assume standard env var names and break
- All secrets are sent to all containers — work credentials leak to the family container

**Desired**: Per-group env var overrides with global `.env` as fallback. Possible implementations:
- `groups/{name}/.env` (simple, mirrors the global pattern)
- `containerConfig.env` field in `registered_groups` (DB-based)
- Scoped naming in `.env` with auto-resolution (`{GROUP}_VAR` → `VAR` inside that container)

---

## REPLY 5: Proposed model + questions

### Proposed configuration hierarchy

```
.env / global config
├── ASSISTANT_NAME = "default"        ← fallback only
├── global/.mcp.json                  ← shared MCP tools (all groups inherit)
└── global/CLAUDE.md                  ← infrastructure only

registered_groups (per-group overrides)
├── assistantName = "Alaska"          ← overrides prefix + trigger
├── channels = [wa_jid, tg_jid]      ← multi-channel binding
├── groups/{name}/.env                ← per-group secrets
├── groups/{name}/.mcp.json           ← merged with global
└── groups/{name}/CLAUDE.md           ← identity, personality, workflows
```

Resolution: most specific wins → global shared → system defaults.

**Key principle**: a single NanoClaw instance should support groups with completely different identities, credentials, and tool access — without duplication or naming hacks.

### Questions

1. **Per-group assistant name** — does this make sense? It touches config, channel implementations, and the DB schema
2. **Per-group secrets** — what's the best mechanism?
3. **Global MCP layer** — interest in shared `.mcp.json` inheritance?
4. **Multi-channel per group** — anyone running the same context across multiple chats?
5. **Identity-free global template** — should upstream ship without name/personality in `global/CLAUDE.md`?

The underlying question: **should NanoClaw evolve from "one assistant, many groups" to "many personas, one engine"?**
