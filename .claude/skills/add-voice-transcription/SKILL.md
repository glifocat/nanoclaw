---
name: add-voice-transcription
description: Add voice message transcription to NanoClaw using any OpenAI-compatible transcription endpoint (Parakeet, Whisper, Canary, etc.). Automatically transcribes WhatsApp voice notes so the agent can read and respond to them.
---

# Add Voice Transcription

This skill adds automatic voice message transcription to NanoClaw's WhatsApp channel using any OpenAI-compatible `/v1/audio/transcriptions` endpoint. When a voice note arrives, it is downloaded, transcribed, and delivered to the agent as `[Voice: <transcript>]`.

Works with Parakeet, Whisper (Speaches/faster-whisper-server), Canary, or any service exposing the OpenAI transcription API.

## Phase 1: Pre-flight

### Check if already applied

Read `.nanoclaw/state.yaml`. If `voice-transcription` is in `applied_skills`, skip to Phase 3 (Configure). The code changes are already in place.

### Ask the user

Use `AskUserQuestion` to collect information:

AskUserQuestion: What transcription endpoint will you use? I need the base URL (e.g., http://192.168.8.151:8301/v1) and the model name.

## Phase 2: Apply Code Changes

Run the skills engine to apply this skill's code package.

### Initialize skills system (if needed)

If `.nanoclaw/` directory doesn't exist yet:

```bash
npx tsx scripts/apply-skill.ts --init
```

### Apply the skill

```bash
npx tsx scripts/apply-skill.ts .claude/skills/add-voice-transcription
```

This deterministically:
- Adds `src/transcription.ts` (voice transcription module using OpenAI-compatible API)
- Three-way merges voice handling into `src/channels/whatsapp.ts` (isVoiceMessage check, transcribeAudioMessage call)
- Three-way merges transcription tests into `src/channels/whatsapp.test.ts` (mock + 3 test cases)
- Installs the `openai` npm dependency
- Updates `.env.example` with `TRANSCRIPTION_BASE_URL`, `TRANSCRIPTION_API_KEY`, `TRANSCRIPTION_MODEL`
- Records the application in `.nanoclaw/state.yaml`

If the apply reports merge conflicts, read the intent files:
- `modify/src/channels/whatsapp.ts.intent.md` — what changed and invariants for whatsapp.ts
- `modify/src/channels/whatsapp.test.ts.intent.md` — what changed for whatsapp.test.ts

### Validate code changes

```bash
npm test
npm run build
```

All tests must pass (including the 3 new voice transcription tests) and build must be clean before proceeding.

## Phase 3: Configure

### Add to environment

Add to `.env`:

```bash
TRANSCRIPTION_BASE_URL=http://192.168.8.151:8301/v1
TRANSCRIPTION_MODEL=parakeet-tdt-0.6b-v3
# TRANSCRIPTION_API_KEY=not-needed  # only if the endpoint requires auth
```

Sync to container environment:

```bash
mkdir -p data/env && cp .env data/env/env
```

The container reads environment from `data/env/env`, not `.env` directly.

### Build and restart

```bash
npm run build
launchctl kickstart -k gui/$(id -u)/com.nanoclaw  # macOS
# Linux: systemctl --user restart nanoclaw
```

## Phase 4: Verify

### Test with a voice note

Tell the user:

> Send a voice note in any registered WhatsApp chat. The agent should receive it as `[Voice: <transcript>]` and respond to its content.

### Check logs if needed

```bash
tail -f logs/nanoclaw.log | grep -i voice
```

Look for:
- `Transcribed voice message` — successful transcription with character count
- `TRANSCRIPTION_BASE_URL not set` — base URL missing from `.env`
- `Transcription failed` — API error (check endpoint is reachable, model name is correct)
- `Failed to download audio message` — media download issue

## Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `TRANSCRIPTION_BASE_URL` | *(required)* | Base URL of the transcription endpoint |
| `TRANSCRIPTION_MODEL` | `whisper-1` | Model name the endpoint expects |
| `TRANSCRIPTION_API_KEY` | `not-needed` | API key (only if endpoint requires auth) |

### Example configurations

**Parakeet TDT (recommended for Spanish):**
```
TRANSCRIPTION_BASE_URL=http://192.168.8.151:8301/v1
TRANSCRIPTION_MODEL=parakeet-tdt-0.6b-v3
```

**Whisper via Speaches/faster-whisper-server:**
```
TRANSCRIPTION_BASE_URL=http://192.168.8.151:8300/v1
TRANSCRIPTION_MODEL=Systran/faster-whisper-base
```

**OpenAI Whisper API:**
```
TRANSCRIPTION_BASE_URL=https://api.openai.com/v1
TRANSCRIPTION_API_KEY=sk-...
TRANSCRIPTION_MODEL=whisper-1
```

## Troubleshooting

### Voice notes show "[Voice Message - transcription unavailable]"

1. Check `TRANSCRIPTION_BASE_URL` is set in `.env` AND synced to `data/env/env`
2. Verify endpoint is reachable: `curl -s http://192.168.8.151:8301/v1/models`
3. Check the model name matches what the endpoint expects

### Voice notes show "[Voice Message - transcription failed]"

Check logs for the specific error. Common causes:
- Network timeout — endpoint unreachable or slow
- Wrong model name — check endpoint docs
- Audio format not supported — most endpoints handle ogg/opus

### Agent doesn't respond to voice notes

Verify the chat is registered and the agent is running. Voice transcription only runs for registered groups.
