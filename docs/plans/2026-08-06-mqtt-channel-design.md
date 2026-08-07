# MQTT Channel Adapter Design (Generic NanoClaw Channel)

**Date:** 2026-08-06  
**Status:** Draft  
**Authors:** Ethan + assistant  
**Related:** ChatSDK-style channel abstraction (`src/types.ts` → `Channel`), WhatsApp channel (`src/channels/whatsapp.ts`), homelab voice-ptt (Pi Zero + ReSpeaker)

## Problem

NanoClaw today is primarily reached through **WhatsApp** (and, in production Gambi, Matrix as a separate path). That works for phones, but not for **hardware voice clients**, ESP devices, kiosks, or other IoT endpoints that already speak MQTT.

We want a **first-class NanoClaw channel** so any compatible device can:

1. Send a **text utterance** (already STT’d on the device or a lab service).
2. Receive a **text reply** from the agent (TTS stays on the device if needed).
3. Optionally publish **status / typing** without inventing a one-off HTTP hack per device.

Constraints from the homelab voice work:

- Do **not** inject into an existing WhatsApp/Matrix conversation or piggyback on another agent’s session.
- Do **not** move STT/TTS into NanoClaw for this path (Pi already uses Parakeet + ElevenLabs; Gambi already uses Parakeet for WA voice notes).
- Prefer the same **channel contract** we already use (ChatSDK-style: transport in, unified chat messages out).

## Goals

| Goal | Notes |
|------|--------|
| Generic MQTT **Channel** | Implements `Channel` in `src/types.ts` |
| Multi-device | Many devices / sessions without hardcoding `pi-voice` |
| Text-in / text-out | Audio I/O stays on the client |
| Own chat identity | New `chat_jid` namespace; own group folder + session |
| Versioned wire protocol | JSON schema with `v` field |
| Homelab-friendly | Works with Mosquitto (HA / LAN), ACLs, IoT VLANs |
| Upstream-able | Design should not depend on glifocat-only secrets |

## Non-goals (v1)

- Streaming partial tokens over MQTT (v1 is full-utterance request/response).
- Binary audio on the MQTT wire (no WAV/Opus payloads in v1).
- Replacing WhatsApp/Matrix.
- Device firmware OTA, BLE provisioning, etc.
- End-to-end encryption beyond MQTT TLS + broker ACLs (document as future).

## Approach: `MqttChannel` as a first-class channel

Chosen over:

| Alternative | Why not (for this design) |
|-------------|---------------------------|
| Inject text into existing WA/Matrix chat | Couples hardware to a human chat; wrong session/ACL surface |
| HTTP-only bridge on VM 505 | Fine as a spike; worse multi-device and status pub/sub |
| STT/TTS adapter inside NanoClaw | Wrong layer; duplicates Parakeet/ElevenLabs; couples agent host to audio |
| One-off “pi-voice plugin” | Not reusable for ED1, other Pis, future devices |

```
┌──────────────────────┐         MQTT          ┌────────────────────────────┐
│ Compatible device    │  in / out / status    │ NanoClaw host process      │
│ (pi-voice, future…)  │ ◄──────────────────►  │ MqttChannel implements     │
│ STT → text           │                       │ Channel                    │
│ text → TTS (opt.)    │                       │   onMessage → same pipeline│
└──────────────────────┘                       │   as WhatsApp (SQLite →    │
                                               │   queue → agent container) │
                                               └────────────────────────────┘
```

Device responsibility: **capture + STT + (optional) TTS + MQTT client**.  
NanoClaw responsibility: **chat routing, memory, tools, reply text**.

---

## Channel mapping (`Channel` interface)

| Method | MQTT behaviour |
|--------|----------------|
| `name` | `'mqtt'` |
| `connect()` | Connect to broker, subscribe to inbound topics, restore online status |
| `sendMessage(jid, text)` | Publish to device **out** topic for that jid |
| `isConnected()` | Broker connection healthy |
| `ownsJid(jid)` | `jid` matches `mqtt:` / `voice:` prefix (exact rule below) |
| `disconnect()` | Unsubscribe, disconnect cleanly |
| `setTyping?(jid, isTyping)` | Publish typing/status event (optional v1) |

### JID / chat identity

Stable, channel-owned identifiers (not phone numbers):

```text
mqtt:{device_id}@local
```

Examples:

- `mqtt:pi-voice@local`
- `mqtt:kitchen-panel@local`
- `mqtt:ed1-lab@local`

Rules:

- `device_id`: `[a-z0-9][a-z0-9-]{1,62}` (DNS-label-ish).
- `ownsJid`: `jid.startsWith('mqtt:') && jid.endsWith('@local')` (or a single configurable prefix).
- Each device maps to **one primary chat_jid** in v1 (1:1 device ↔ conversation). Multi-user per device is out of scope for v1.

### Group registration

Same mechanism as WhatsApp groups: register a folder + trigger config.

| Field | Example |
|-------|---------|
| `name` | `Voice — pi-voice` |
| `folder` | `voice-pi-voice` (or shared `voice` with jid isolation — prefer **per-device folder** for memory isolation) |
| `trigger` | optional; devices may send already-addressed text (requiresTrigger: false for solo device chats) |

**Do not** reuse `casa` / WhatsApp group folders for MQTT devices by default.

---

## Topic namespace

Root prefix configurable (default `nanoclaw/v1`):

```text
{prefix}/devices/{device_id}/in        # device → nanoclaw  (user text)
{prefix}/devices/{device_id}/out       # nanoclaw → device  (assistant text)
{prefix}/devices/{device_id}/status    # device → nanoclaw  (lifecycle)
{prefix}/devices/{device_id}/events    # nanoclaw → device  (typing, errors)
{prefix}/devices/{device_id}/cmd       # nanoclaw → device  (optional control)
```

Retain:

- `in` / `out`: QoS 1 recommended (at least once).
- `status`: QoS 0 or 1; last-will on disconnect.
- Device **publishes** `in` and `status`; **subscribes** `out` and `events`.
- NanoClaw **subscribes** `+/in` and `+/status` under devices; **publishes** `out` / `events`.

Wildcard subscribe (host):

```text
nanoclaw/v1/devices/+/in
nanoclaw/v1/devices/+/status
```

---

## Wire protocol (JSON)

All payloads UTF-8 JSON. Unknown fields ignored by receivers (forward-compatible).

### Common envelope

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `v` | number | yes | Protocol version; **1** for this design |
| `msg_id` | string | yes | UUID v4 (or ULID); idempotency key |
| `ts` | string | yes | ISO-8601 UTC |
| `device_id` | string | yes | Must match topic `{device_id}` |

### `in` — user utterance (device → NanoClaw)

```json
{
  "v": 1,
  "msg_id": "9b2f0c2e-3c1a-4b0d-9f2a-1a2b3c4d5e6f",
  "ts": "2026-08-06T16:00:00.000Z",
  "device_id": "pi-voice",
  "type": "utterance",
  "text": "¿Qué hay en el calendario mañana?",
  "lang": "es",
  "meta": {
    "client": "voice-ptt",
    "client_version": "0.1.0",
    "stt_engine": "parakeet-tdt-0.6b-v3"
  }
}
```

| Field | Notes |
|-------|--------|
| `type` | `utterance` (v1). Future: `command`, `cancel` |
| `text` | Non-empty after trim; max length **4000** chars (reject/truncate with event) |
| `lang` | BCP-47 optional hint (`es`, `en`) |
| `meta` | Free-form; not shown to the model unless we choose to |

Empty `text` → drop + optional `events` error `empty_text`.

### `out` — assistant reply (NanoClaw → device)

```json
{
  "v": 1,
  "msg_id": "a1a1a1a1-b2b2-c3c3-d4d4-e5e5e5e5e5e5",
  "ts": "2026-08-06T16:00:08.200Z",
  "device_id": "pi-voice",
  "type": "reply",
  "in_reply_to": "9b2f0c2e-3c1a-4b0d-9f2a-1a2b3c4d5e6f",
  "text": "Mañana tienes una reunión a las 10.",
  "meta": {
    "group_folder": "voice-pi-voice"
  }
}
```

| Field | Notes |
|-------|--------|
| `in_reply_to` | Echo of inbound `msg_id` when this is a direct answer to one utterance |
| `type` | `reply` \| `error` \| `notice` |

Devices **should** wait for `out` with matching `in_reply_to` (timeout configurable, default **120s**). If multiple replies share the same `in_reply_to` (rare), play/display in arrival order.

### `status` — device lifecycle (device → NanoClaw)

```json
{
  "v": 1,
  "msg_id": "…",
  "ts": "…",
  "device_id": "pi-voice",
  "state": "online",
  "detail": "voice-ptt 0.1.0"
}
```

| `state` | Meaning |
|---------|---------|
| `online` | Connected and ready |
| `offline` | Graceful shutdown (also LWT) |
| `listening` | Optional: PTT hold / recording |
| `thinking` | Optional: waiting for agent |
| `speaking` | Optional: local TTS playing |
| `error` | Optional: device-side fault |

**Last will:** broker publishes `state: offline` on hard disconnect.

### `events` — host → device (optional v1)

```json
{
  "v": 1,
  "msg_id": "…",
  "ts": "…",
  "device_id": "pi-voice",
  "type": "typing",
  "typing": true,
  "in_reply_to": "9b2f0c2e-…"
}
```

Other `type` values: `error` (`code`, `message`), `ack` (optional ingest ack).

---

## Inbound path (device → agent)

Maps to existing WhatsApp-style flow:

1. `MqttChannel` receives `in` JSON on `…/devices/{id}/in`.
2. Validate envelope + `device_id` match + auth (see Security).
3. Resolve `chat_jid = mqtt:{device_id}@local`.
4. Ensure chat registered (or auto-register policy — **v1: must be pre-registered**).
5. Call `onMessage(chat_jid, NewMessage)`:

```ts
{
  id: msg_id,              // use wire msg_id for correlation
  chat_jid: 'mqtt:pi-voice@local',
  sender: 'mqtt:pi-voice@local',  // or mqtt:pi-voice:user@local later
  sender_name: device_id,
  content: text,
  timestamp: ts,
  is_from_me: false,
  is_bot_message: false,
}
```

6. Existing message loop / group queue / container runner unchanged.
7. When agent produces outbound text, router calls `channel.sendMessage(jid, text)` → publish `out` with `in_reply_to` if we tracked correlation in a short-lived map (`msg_id` of last inbound per jid).

### Correlation map

```text
lastInboundByJid: Map<chat_jid, msg_id>
```

- Set on each accepted `in`.
- `sendMessage` attaches `in_reply_to: lastInboundByJid.get(jid)` when present.
- Clear optional after send, or keep last (device can still match).

Streaming multi-turn without clear utterance boundaries is out of scope for v1.

---

## Configuration (NanoClaw host)

Proposed config surface (env and/or config file — exact key names to match NanoClaw conventions at implement time):

| Key | Example | Description |
|-----|---------|-------------|
| `MQTT_ENABLED` | `true` | Feature flag |
| `MQTT_URL` | `mqtts://192.168.8.x:8883` | Broker URL |
| `MQTT_USERNAME` / `MQTT_PASSWORD` | | Device/host credentials |
| `MQTT_PREFIX` | `nanoclaw/v1` | Topic root |
| `MQTT_CLIENT_ID` | `nanoclaw-gambi` | Unique host client id |
| `MQTT_REJECT_UNAUTHORIZED` | `true` | TLS |

Registered devices (config or DB):

```json
{
  "devices": {
    "pi-voice": {
      "enabled": true,
      "group_folder": "voice-pi-voice",
      "display_name": "Pi Voice (ReSpeaker)",
      "requires_trigger": false
    }
  }
}
```

Unknown `device_id` on `in` → log + `events` error `unknown_device` (no agent run).

---

## Client contract (any compatible device)

A device is **MQTT-channel compatible** if it:

1. Authenticates to the broker (user/pass or mTLS — deployment choice).
2. Publishes valid `in` utterances to `…/devices/{device_id}/in`.
3. Subscribes to `…/devices/{device_id}/out` (and optionally `events`).
4. Treats `text` in `out` as the full assistant message (run local TTS if desired).
5. Uses unique `msg_id` per utterance; matches `in_reply_to` when waiting.

**Reference client:** homelab `voice-ptt` on Pi Zero 2 + Keyestudio ReSpeaker:

- STT: Parakeet `http://192.168.8.151:8301` (same as Gambi WA notes).
- TTS: ElevenLabs Eva Dorado / flash (local to device).
- LLM path today: OpenRouter — **replaced by MQTT out** when channel is live.

Other future clients (ED1, panels, ESP with local/cloud STT) only need the MQTT contract — no NanoClaw changes per device type.

---

## Security

| Layer | v1 expectation |
|-------|----------------|
| Transport | Prefer **TLS** (`mqtts`); LAN plain MQTT only on trusted VLAN |
| Broker ACL | Per-device publish only to own `devices/{id}/#`; subscribe only own `out`/`events` |
| Host ACL | NanoClaw user can subscribe `devices/+/in|status`, publish `devices/+/out|events` |
| Payload size | Cap `text` length; reject oversized JSON |
| Authz | Allowlist `device_id` in NanoClaw config |
| Secrets | Broker password in host env / Infisical / 1Password — not in group folders |

IoT VLAN note (homelab): devices on `192.168.10.0/24` need a path to the broker (open port, or broker on a network both can reach). Same class of rule as `IoT-to-Parakeet-STT`.

---

## Failure modes

| Case | Behaviour |
|------|-----------|
| Broker down | Channel `isConnected()=false`; queue outbound like WhatsApp offline queue (optional; v1 may drop with log) |
| Agent timeout | Publish `events` type `error` code `agent_timeout`; device TTS local fallback message optional |
| Duplicate `msg_id` | Idempotent ignore if already processed (short LRU) |
| Device timeout waiting `out` | Device-side; play “no he recibido respuesta” locally |
| Unregistered device | No agent; `events` `unknown_device` |

---

## Implementation sketch (NanoClaw)

### New files

| Path | Role |
|------|------|
| `src/channels/mqtt.ts` | `MqttChannel` class |
| `src/channels/mqtt.test.ts` | Protocol + ownsJid + correlation tests |
| `docs/mqtt-channel.md` | User-facing setup (broker, ACL, device examples) |

### Integration points

- `src/index.ts` (or channel bootstrap): if `MQTT_ENABLED`, construct `MqttChannel` alongside WhatsApp.
- `src/router.ts` / outbound path: already dispatches `sendMessage` by `ownsJid` — no special case if jid routing is correct.
- Dependency: `mqtt` (or `aedes` only if we embed a broker — **v1 uses external broker**).

### Dependencies

- Add `mqtt` (Eclipse Paho / mqtt.js) to host `package.json`.
- No container image change required for v1 (text only).

---

## Implementation sketch (reference client: voice-ptt)

| Change | Detail |
|--------|--------|
| Config | `MQTT_URL`, `MQTT_DEVICE_ID=pi-voice`, credentials, timeouts |
| Replace LLM client | Publish `in` after STT; wait for `out` with `in_reply_to` |
| Keep | Parakeet STT, ElevenLabs TTS, HAT PTT, volume |
| Status | Publish `listening` / `thinking` / `speaking` / `idle` on button state machine |

---

## Phased delivery

| Phase | Deliverable | Exit criteria |
|-------|-------------|----------------|
| **0 — Spec** | This design doc | Agreed topics + JSON + jid rules |
| **1 — Host channel** | `MqttChannel` + config + tests | Unit tests green; manual mosquitto pub/sub round-trip into agent |
| **2 — Register device** | Group folder + allowlist for `pi-voice` | One utterance from `mosquitto_pub` gets a real Gambi reply on `out` |
| **3 — voice-ptt client** | Pi uses MQTT instead of OpenRouter chat | Full PTT: button → Parakeet → Gambi → Eva |
| **4 — Harden** | TLS, ACLs, multi-device second client | Second fake device works without code change |
| **5 — Upstream** | Clean PR / docs against nanocoai/nanoclaw | Optional; no glifocat-only hardcoding |

---

## Testing plan

1. **Contract tests:** parse/validate envelope; reject bad `v`, empty text, device_id mismatch.
2. **Channel unit tests:** mock mqtt.js; assert `onMessage` + `sendMessage` topic/payload.
3. **Integration (local):** Mosquitto in Docker; NanoClaw with MQTT_ENABLED; `mosquitto_pub` / `_sub`.
4. **Homelab E2E:** pi-voice hold → log shows MQTT in/out → spoken reply.
5. **Regression:** WhatsApp channel still connects and routes.

---

## Open questions

1. **Broker placement (homelab):** HA Mosquitto vs dedicated on proxmox vs Flint — decide in phase 1 for Gambi.
2. **Auto-register devices?** v1 says no; revisit if onboarding friction is high.
3. **Shared vs per-device group folders:** design prefers per-device; confirm memory isolation vs “one house brain”.
4. **Trigger strings:** devices usually send final text; default `requiresTrigger: false` for mqtt jids?
5. **ChatSDK naming:** if/when NanoClaw adopts an external ChatSDK package, this channel should implement that SDK’s transport interface 1:1 with `Channel` above.
6. **Upstream vs fork-first:** implement on glifocat production branch first, then extract PR.

---

## Decision summary

| Decision | Choice |
|----------|--------|
| Abstraction | First-class **`Channel`**, not injection into WA/Matrix |
| Transport | **MQTT** + external broker |
| Payload | Versioned **JSON text** only in v1 |
| Audio | **On device** (STT/TTS), not in NanoClaw |
| Identity | `mqtt:{device_id}@local` + allowlisted devices |
| First client | Homelab **voice-ptt** (Pi Zero + ReSpeaker) |
| Quality bar | Works for **any** client that speaks the contract |

---

## References

- `src/types.ts` — `Channel`, `NewMessage`, `OnInboundMessage`
- `src/channels/whatsapp.ts` — reference channel implementation
- Homelab voice-ptt: Parakeet `:8301`, ElevenLabs Eva, IoT host `pi-voice`
- Homelab Gambi: VM 505 `192.168.8.152`, production NanoClaw instance
