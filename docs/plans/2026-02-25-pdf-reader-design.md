# PDF Reader Skill Design

## Goal

Enable Gambi to read and extract structured text from PDFs. Sources: WhatsApp attachments, URLs, and local files. Text-based PDFs with structure preservation (tables, headings, columns).

## Approach

Skills engine package (`add-pdf-reader`) using `poppler-utils` (`pdftotext`, `pdfinfo`) via a Bash CLI wrapper. Follows the `agent-browser` container skill pattern.

## Package Structure

```
.claude/skills/add-pdf-reader/
├── SKILL.md                                    # Interactive phases
├── manifest.yaml                               # Metadata
├── add/
│   ├── container/skills/pdf-reader/SKILL.md    # Agent-facing docs
│   └── container/skills/pdf-reader/pdf-reader  # CLI script (Bash)
├── modify/
│   ├── container/Dockerfile                    # + poppler-utils, COPY script
│   ├── container/Dockerfile.intent.md
│   ├── src/channels/whatsapp.ts                # + PDF attachment download
│   ├── src/channels/whatsapp.ts.intent.md
│   ├── src/channels/whatsapp.test.ts           # + PDF tests
│   └── src/channels/whatsapp.test.ts.intent.md
└── tests/
    └── pdf-reader.test.ts                      # Skill validation
```

## Components

### 1. CLI Tool (`pdf-reader`)

Bash script installed at `/usr/local/bin/pdf-reader` in the container.

Commands:
- `pdf-reader extract <file> [--layout] [--pages N-M]` — Extract text (--layout preserves tables/columns)
- `pdf-reader fetch <url> [filename]` — Download PDF from URL, extract text
- `pdf-reader info <file>` — Metadata: pages, title, author, size
- `pdf-reader list` — List PDFs in current directory

### 2. Container Skill SKILL.md

YAML frontmatter: `name: pdf-reader`, `allowed-tools: Bash(pdf-reader:*)`. Documents all commands with examples.

### 3. Dockerfile Changes

- Add `poppler-utils` to `apt-get install` (provides `pdftotext`, `pdfinfo`, `pdftohtml`)
- `COPY skills/pdf-reader/pdf-reader /usr/local/bin/pdf-reader` + `chmod +x`

### 4. WhatsApp Attachment Handling

In `src/channels/whatsapp.ts`, detect `documentMessage` with `mimetype: application/pdf`:
- Download via `downloadMediaMessage` from Baileys
- Save to `groups/{name}/attachments/{timestamp}-{filename}`
- Inject path into message content: `[PDF: attachments/{filename} ({pages} pages, {size})]`
- Include hint: `Use pdf-reader extract attachments/{filename} to read contents.`

### 5. manifest.yaml

```yaml
skill: add-pdf-reader
version: 1.0.0
description: "Add PDF reading capability to container agents via pdftotext CLI"
core_version: 1.1.2
adds:
  - container/skills/pdf-reader/SKILL.md
  - container/skills/pdf-reader/pdf-reader
modifies:
  - container/Dockerfile
  - src/channels/whatsapp.ts
  - src/channels/whatsapp.test.ts
structured:
  npm_dependencies: {}
  env_additions: []
conflicts: []
depends: []
test: "npx vitest run .claude/skills/add-pdf-reader/tests/pdf-reader.test.ts"
```

## Data Flow

```
WhatsApp PDF → host downloads to groups/{name}/attachments/ → agent msg includes path
                → agent runs `pdf-reader extract <path>` → pdftotext outputs text

URL in chat  → agent runs `pdf-reader fetch <url>` → curl + pdftotext → text

Local file   → agent runs `pdf-reader extract <path>` → pdftotext → text
```

## Testing

### Skill validation tests (tests/pdf-reader.test.ts)
- Manifest exists with correct metadata
- All declared files exist in add/ and modify/
- Intent files exist for all modified files
- Dockerfile contains `poppler-utils` and COPY for pdf-reader
- whatsapp.ts contains `documentMessage` and `application/pdf` handling
- Public API preserved (exports unchanged)

## Alternatives Considered

1. **Python pymupdf** — Better structure extraction but heavier dependency (~30MB), slower
2. **SDK Read tool only** — No extra deps but 20-page limit, no control over extraction
3. **pdftotext (chosen)** — ~5MB via poppler-utils, instant extraction, good --layout mode
