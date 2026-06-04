---
name: vapi-outbound-calls
description: Run audited outbound Vapi phone campaigns from NanoClaw, especially Spanish pharmacy availability/reservation calls.
---

# Vapi Outbound Calls

Use this skill when the user asks the agent to place real outbound phone calls through Vapi: pharmacies, restaurants, vendors, appointments, availability checks, or reservation calls.

This skill is deliberately a utility/container skill. It does not modify NanoClaw core runtime, channels, DB schema, or host service. It provides a reusable campaign runner plus prompt/templates.

## Safety rules

Real phone calls are external side effects. Before running `--run`, the agent must show the user:

- number of targets
- item/medication being requested
- reservation name and callback phone that will be disclosed
- outbound phoneNumberId / caller ID if known
- stop condition
- estimated cost

Then obtain explicit approval.

Never expose or paste `VAPI_PRIVATE_KEY` into chat. It must come from environment or a local credentials file.

## Credentials

The script reads Vapi private key from either:

1. environment variable:
   `VAPI_PRIVATE_KEY`

2. credentials file:
   `~/.config/vapi/credentials`

with a line:

```bash
VAPI_PRIVATE_KEY=...
```

The private key must be a Vapi private/server key, not a public key.

## Quick usage

Copy templates somewhere writable, then edit them:

```bash
mkdir -p ~/vapi-campaigns/pharmacy
cp /app/skills/vapi-outbound-calls/templates/pharmacy-campaign.example.json ~/vapi-campaigns/pharmacy/campaign.json
cp /app/skills/vapi-outbound-calls/templates/targets.example.csv ~/vapi-campaigns/pharmacy/targets.csv
nano ~/vapi-campaigns/pharmacy/campaign.json
nano ~/vapi-campaigns/pharmacy/targets.csv
```

Dry run, no calls:

```bash
node /app/skills/vapi-outbound-calls/scripts/vapi_campaign.mjs \
  --campaign ~/vapi-campaigns/pharmacy/campaign.json \
  --targets ~/vapi-campaigns/pharmacy/targets.csv \
  --dry-run
```

Create/update Vapi assistant:

```bash
node /app/skills/vapi-outbound-calls/scripts/vapi_campaign.mjs \
  --campaign ~/vapi-campaigns/pharmacy/campaign.json \
  --targets ~/vapi-campaigns/pharmacy/targets.csv \
  --create-assistant
```

Test call to the user's own phone first:

```bash
node /app/skills/vapi-outbound-calls/scripts/vapi_campaign.mjs \
  --campaign ~/vapi-campaigns/pharmacy/campaign.json \
  --targets ~/vapi-campaigns/pharmacy/targets.csv \
  --test-call +34XXXXXXXXX
```

Run first real target only:

```bash
node /app/skills/vapi-outbound-calls/scripts/vapi_campaign.mjs \
  --campaign ~/vapi-campaigns/pharmacy/campaign.json \
  --targets ~/vapi-campaigns/pharmacy/targets.csv \
  --run --only 1
```

Run full serial campaign:

```bash
node /app/skills/vapi-outbound-calls/scripts/vapi_campaign.mjs \
  --campaign ~/vapi-campaigns/pharmacy/campaign.json \
  --targets ~/vapi-campaigns/pharmacy/targets.csv \
  --run
```

Results are written next to the campaign file in `results/` as CSV, JSON, and Markdown.

## Pharmacy reservation behavior

The included prompt is optimized for Spanish pharmacy calls:

1. disclose AI assistant at the start
2. confirm pharmacy name
3. confirm target address if they say they have stock or can reserve quickly
4. ask for the specific medication/item
5. if available, reserve under the configured name and leave callback phone digit by digit
6. if not available and cannot be ordered soon, end politely
7. stop the whole campaign once `reserva_confirmada=si`

The agent does not ask irrelevant price/hours questions unless you explicitly add that to the prompt.

## Important Vapi notes

- Free Vapi US numbers do not call internationally. For Spain, use an imported Twilio number or a paid/working Vapi phone number.
- For better pickup in Spain, use a Spanish caller ID if possible. UK is better than US but still foreign.
- ElevenLabs voices are configured by `voice.provider=11labs` and `voice.voiceId=<id>`. Choose a real Spain/Castilian voice from ElevenLabs Voice Library; do not assume names like Mateo are peninsular.
- Use `assistantOverrides.variableValues` per call. This is required so the agent knows pharmacy name, address, phone, client name, callback phone, and medication.
- Keep `silenceTimeoutSeconds` around 35s so calls are not cut while staff check stock.
- Avoid broad `endCallPhrases`. This template uses only `adiós`.

## Files

- `scripts/vapi_campaign.mjs` — dependency-light Node.js runner using built-in `fetch`, `fs`, and `csv` parser. Preferred inside NanoClaw agent containers.
- `scripts/vapi_campaign.py` — Python fallback for host/CT shells that have Python available.
- `prompts/pharmacy-reservation.es-ES.md` — Vapi system prompt template with `{{variables}}`.
- `templates/pharmacy-campaign.example.json` — campaign config.
- `templates/targets.example.csv` — target list format.
