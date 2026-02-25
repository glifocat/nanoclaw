# PDF Reader Skill Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add PDF reading capability to all container agents via a `pdf-reader` CLI tool, packaged as a NanoClaw skills engine skill.

**Architecture:** Skills engine package (`.claude/skills/add-pdf-reader/`) that adds a Bash CLI wrapper around `poppler-utils` (`pdftotext`/`pdfinfo`) as a container skill, modifies the Dockerfile to install dependencies, and modifies `whatsapp.ts` to auto-download PDF attachments to the group workspace.

**Tech Stack:** poppler-utils (pdftotext, pdfinfo), Bash, Baileys `downloadMediaMessage`, NanoClaw skills engine

**Reference implementations:** `.claude/skills/add-voice-transcription/` (same pattern — modifies whatsapp.ts for media handling), `container/skills/agent-browser/` (container skill CLI pattern)

---

### Task 1: Scaffold skill package structure

**Files:**
- Create: `.claude/skills/add-pdf-reader/manifest.yaml`

**Step 1: Create skill directory and manifest**

```yaml
# .claude/skills/add-pdf-reader/manifest.yaml
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
test: "npx vitest run --config vitest.skills.config.ts .claude/skills/add-pdf-reader/tests/pdf-reader.test.ts"
```

**Step 2: Commit**

```bash
git add .claude/skills/add-pdf-reader/manifest.yaml
git commit -m "feat(skills): scaffold add-pdf-reader skill package"
```

---

### Task 2: Write the skill validation tests (RED)

**Files:**
- Create: `.claude/skills/add-pdf-reader/tests/pdf-reader.test.ts`

**Step 1: Write the failing tests**

Follow the pattern from `add-voice-transcription/tests/voice-transcription.test.ts`. Tests validate the skill package structure, not runtime behavior.

```typescript
// .claude/skills/add-pdf-reader/tests/pdf-reader.test.ts
import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';

describe('add-pdf-reader skill package', () => {
  const skillDir = path.resolve(__dirname, '..');

  it('has a valid manifest', () => {
    const manifestPath = path.join(skillDir, 'manifest.yaml');
    expect(fs.existsSync(manifestPath)).toBe(true);

    const content = fs.readFileSync(manifestPath, 'utf-8');
    expect(content).toContain('skill: add-pdf-reader');
    expect(content).toContain('version: 1.0.0');
    expect(content).toContain('container/Dockerfile');
  });

  it('has all files declared in adds', () => {
    const skillMd = path.join(skillDir, 'add', 'container', 'skills', 'pdf-reader', 'SKILL.md');
    const script = path.join(skillDir, 'add', 'container', 'skills', 'pdf-reader', 'pdf-reader');

    expect(fs.existsSync(skillMd)).toBe(true);
    expect(fs.existsSync(script)).toBe(true);
  });

  it('pdf-reader script is a valid Bash script', () => {
    const script = fs.readFileSync(
      path.join(skillDir, 'add', 'container', 'skills', 'pdf-reader', 'pdf-reader'),
      'utf-8',
    );
    expect(script).toMatch(/^#!/);
    expect(script).toContain('pdftotext');
    expect(script).toContain('pdfinfo');
    expect(script).toContain('extract');
    expect(script).toContain('fetch');
    expect(script).toContain('info');
    expect(script).toContain('list');
    expect(script).toContain('--layout');
    expect(script).toContain('--pages');
  });

  it('container skill SKILL.md has correct frontmatter', () => {
    const content = fs.readFileSync(
      path.join(skillDir, 'add', 'container', 'skills', 'pdf-reader', 'SKILL.md'),
      'utf-8',
    );
    expect(content).toContain('name: pdf-reader');
    expect(content).toContain('allowed-tools: Bash(pdf-reader:*)');
    expect(content).toContain('pdf-reader extract');
    expect(content).toContain('pdf-reader fetch');
    expect(content).toContain('pdf-reader info');
  });

  it('has all files declared in modifies', () => {
    expect(fs.existsSync(path.join(skillDir, 'modify', 'container', 'Dockerfile'))).toBe(true);
    expect(fs.existsSync(path.join(skillDir, 'modify', 'src', 'channels', 'whatsapp.ts'))).toBe(true);
    expect(fs.existsSync(path.join(skillDir, 'modify', 'src', 'channels', 'whatsapp.test.ts'))).toBe(true);
  });

  it('has intent files for all modified files', () => {
    expect(fs.existsSync(path.join(skillDir, 'modify', 'container', 'Dockerfile.intent.md'))).toBe(true);
    expect(fs.existsSync(path.join(skillDir, 'modify', 'src', 'channels', 'whatsapp.ts.intent.md'))).toBe(true);
    expect(fs.existsSync(path.join(skillDir, 'modify', 'src', 'channels', 'whatsapp.test.ts.intent.md'))).toBe(true);
  });

  it('modified Dockerfile includes poppler-utils and pdf-reader', () => {
    const content = fs.readFileSync(
      path.join(skillDir, 'modify', 'container', 'Dockerfile'),
      'utf-8',
    );
    expect(content).toContain('poppler-utils');
    expect(content).toContain('pdf-reader');
    expect(content).toContain('/usr/local/bin/pdf-reader');
  });

  it('modified Dockerfile preserves core structure', () => {
    const content = fs.readFileSync(
      path.join(skillDir, 'modify', 'container', 'Dockerfile'),
      'utf-8',
    );
    // Core structure preserved
    expect(content).toContain('FROM node:22-slim');
    expect(content).toContain('chromium');
    expect(content).toContain('agent-browser');
    expect(content).toContain('WORKDIR /app');
    expect(content).toContain('COPY agent-runner/');
    expect(content).toContain('ENTRYPOINT');
    expect(content).toContain('/workspace/group');
    expect(content).toContain('USER node');
  });

  it('modified whatsapp.ts includes PDF attachment handling', () => {
    const content = fs.readFileSync(
      path.join(skillDir, 'modify', 'src', 'channels', 'whatsapp.ts'),
      'utf-8',
    );
    expect(content).toContain('documentMessage');
    expect(content).toContain('application/pdf');
    expect(content).toContain('downloadMediaMessage');
    expect(content).toContain('attachments');
    expect(content).toContain('pdf-reader extract');
  });

  it('modified whatsapp.ts preserves core structure', () => {
    const content = fs.readFileSync(
      path.join(skillDir, 'modify', 'src', 'channels', 'whatsapp.ts'),
      'utf-8',
    );
    expect(content).toContain('class WhatsAppChannel');
    expect(content).toContain('implements Channel');
    expect(content).toContain('async connect()');
    expect(content).toContain('async sendMessage(');
    expect(content).toContain('isConnected()');
    expect(content).toContain('ownsJid(');
    expect(content).toContain('async disconnect()');
    expect(content).toContain('async setTyping(');
    expect(content).toContain('ASSISTANT_NAME');
    expect(content).toContain('STORE_DIR');
  });

  it('modified whatsapp.test.ts includes PDF attachment tests', () => {
    const content = fs.readFileSync(
      path.join(skillDir, 'modify', 'src', 'channels', 'whatsapp.test.ts'),
      'utf-8',
    );
    expect(content).toContain('PDF');
    expect(content).toContain('documentMessage');
    expect(content).toContain('application/pdf');
  });

  it('modified whatsapp.test.ts preserves all existing test sections', () => {
    const content = fs.readFileSync(
      path.join(skillDir, 'modify', 'src', 'channels', 'whatsapp.test.ts'),
      'utf-8',
    );
    expect(content).toContain("describe('connection lifecycle'");
    expect(content).toContain("describe('authentication'");
    expect(content).toContain("describe('reconnection'");
    expect(content).toContain("describe('message handling'");
    expect(content).toContain("describe('LID to JID translation'");
    expect(content).toContain("describe('outgoing message queue'");
    expect(content).toContain("describe('group metadata sync'");
    expect(content).toContain("describe('ownsJid'");
    expect(content).toContain("describe('setTyping'");
    expect(content).toContain("describe('channel properties'");
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `npx vitest run --config vitest.skills.config.ts .claude/skills/add-pdf-reader/tests/pdf-reader.test.ts`
Expected: Multiple FAILs (files don't exist yet)

**Step 3: Commit**

```bash
git add .claude/skills/add-pdf-reader/tests/pdf-reader.test.ts
git commit -m "test(skills): add failing tests for pdf-reader skill package"
```

---

### Task 3: Create the `pdf-reader` CLI script

**Files:**
- Create: `.claude/skills/add-pdf-reader/add/container/skills/pdf-reader/pdf-reader`

**Step 1: Write the Bash CLI script**

The script wraps `pdftotext` and `pdfinfo` from poppler-utils. It supports four commands: `extract`, `fetch`, `info`, `list`.

```bash
#!/bin/bash
# pdf-reader — PDF text extraction tool for NanoClaw agents
# Wraps poppler-utils (pdftotext, pdfinfo)
set -euo pipefail

usage() {
  cat <<'EOF'
Usage: pdf-reader <command> [options]

Commands:
  extract <file> [--layout] [--pages N-M]   Extract text from PDF
  fetch <url> [filename]                    Download PDF from URL and extract text
  info <file>                               Show PDF metadata
  list                                      List PDFs in current directory

Options for extract:
  --layout    Preserve original layout (tables, columns)
  --pages N-M Extract specific page range (1-based)

Examples:
  pdf-reader extract report.pdf
  pdf-reader extract report.pdf --layout
  pdf-reader extract report.pdf --pages 1-5
  pdf-reader fetch https://example.com/doc.pdf
  pdf-reader info report.pdf
  pdf-reader list
EOF
  exit 1
}

cmd_extract() {
  local file=""
  local layout=false
  local pages=""

  while [[ $# -gt 0 ]]; do
    case "$1" in
      --layout) layout=true; shift ;;
      --pages) pages="$2"; shift 2 ;;
      -*) echo "Unknown option: $1" >&2; exit 1 ;;
      *) file="$1"; shift ;;
    esac
  done

  if [[ -z "$file" ]]; then
    echo "Error: No file specified" >&2
    echo "Usage: pdf-reader extract <file> [--layout] [--pages N-M]" >&2
    exit 1
  fi

  if [[ ! -f "$file" ]]; then
    echo "Error: File not found: $file" >&2
    exit 1
  fi

  local args=()
  if $layout; then
    args+=("-layout")
  fi
  if [[ -n "$pages" ]]; then
    local first="${pages%-*}"
    local last="${pages#*-}"
    args+=("-f" "$first" "-l" "$last")
  fi

  pdftotext "${args[@]}" "$file" -
}

cmd_fetch() {
  local url="$1"
  local filename="${2:-}"

  if [[ -z "$url" ]]; then
    echo "Error: No URL specified" >&2
    echo "Usage: pdf-reader fetch <url> [filename]" >&2
    exit 1
  fi

  if [[ -z "$filename" ]]; then
    filename="$(basename "$url" | sed 's/[?#].*//')"
    if [[ ! "$filename" == *.pdf ]]; then
      filename="download-$(date +%s).pdf"
    fi
  fi

  local tmpfile
  tmpfile="$(mktemp /tmp/pdf-reader-XXXXXX.pdf)"
  trap "rm -f '$tmpfile'" EXIT

  if ! curl -sL -o "$tmpfile" "$url"; then
    echo "Error: Failed to download: $url" >&2
    exit 1
  fi

  # Verify it's actually a PDF
  if ! head -c 5 "$tmpfile" | grep -q '%PDF'; then
    echo "Error: Downloaded file is not a PDF" >&2
    exit 1
  fi

  echo "--- PDF: $filename ---"
  pdftotext -layout "$tmpfile" -
}

cmd_info() {
  local file="$1"

  if [[ -z "$file" ]]; then
    echo "Error: No file specified" >&2
    echo "Usage: pdf-reader info <file>" >&2
    exit 1
  fi

  if [[ ! -f "$file" ]]; then
    echo "Error: File not found: $file" >&2
    exit 1
  fi

  pdfinfo "$file"
  echo ""
  local size
  size="$(du -h "$file" | cut -f1)"
  echo "File size: $size"
}

cmd_list() {
  local found=false
  for f in *.pdf **/*.pdf 2>/dev/null; do
    [[ -f "$f" ]] || continue
    found=true
    local pages
    pages="$(pdfinfo "$f" 2>/dev/null | grep '^Pages:' | awk '{print $2}')"
    local size
    size="$(du -h "$f" | cut -f1)"
    echo "$f  (${pages:-?} pages, $size)"
  done
  if ! $found; then
    echo "No PDF files found in current directory"
  fi
}

# Main dispatch
[[ $# -lt 1 ]] && usage
command="$1"
shift

case "$command" in
  extract) cmd_extract "$@" ;;
  fetch)   cmd_fetch "$@" ;;
  info)    cmd_info "$@" ;;
  list)    cmd_list ;;
  help|--help|-h) usage ;;
  *) echo "Unknown command: $command" >&2; usage ;;
esac
```

**Step 2: Make script executable**

Run: `chmod +x .claude/skills/add-pdf-reader/add/container/skills/pdf-reader/pdf-reader`

**Step 3: Commit**

```bash
git add .claude/skills/add-pdf-reader/add/container/skills/pdf-reader/pdf-reader
git commit -m "feat(skills): add pdf-reader CLI script"
```

---

### Task 4: Create the container skill SKILL.md

**Files:**
- Create: `.claude/skills/add-pdf-reader/add/container/skills/pdf-reader/SKILL.md`

**Step 1: Write the agent-facing skill documentation**

Follow the `agent-browser` SKILL.md pattern — YAML frontmatter with `name`, `description`, `allowed-tools`, then command reference.

```markdown
---
name: pdf-reader
description: Read and extract text from PDF files — documents, reports, contracts, spreadsheets. Use whenever you need to read PDF content, not just when explicitly asked. Handles local files, URLs, and WhatsApp attachments.
allowed-tools: Bash(pdf-reader:*)
---

# PDF Reader

## Quick start

\```bash
pdf-reader extract report.pdf              # Extract text
pdf-reader extract report.pdf --layout     # Preserve tables/columns
pdf-reader fetch https://example.com/x.pdf # Download and extract
pdf-reader info report.pdf                 # Show metadata
\```

## Commands

### Extract text

\```bash
pdf-reader extract <file>                  # Plain text extraction
pdf-reader extract <file> --layout         # Preserve layout (tables, columns)
pdf-reader extract <file> --pages 1-5      # Specific page range
pdf-reader extract <file> --layout --pages 3-7  # Combined
\```

Use `--layout` when the PDF contains tables, columns, or formatted data.
Use `--pages` for large documents to extract specific sections.

### Download and extract from URL

\```bash
pdf-reader fetch <url>                     # Download PDF and extract text
pdf-reader fetch <url> custom-name.pdf     # Download with custom filename
\```

### PDF metadata

\```bash
pdf-reader info <file>                     # Pages, title, author, size
\```

### List PDFs

\```bash
pdf-reader list                            # List all PDFs in current directory
\```

## WhatsApp PDF attachments

When someone sends a PDF in WhatsApp, it is automatically saved to `attachments/`.
The message will include the path:

> [PDF: attachments/document.pdf (5 pages, 124K)]
> Use `pdf-reader extract attachments/document.pdf` to read contents.

## Example: Read a report

\```bash
pdf-reader info attachments/q4-report.pdf
# Pages: 12, Title: Q4 Financial Report

pdf-reader extract attachments/q4-report.pdf --layout --pages 1-3
# Extracts first 3 pages with table formatting preserved
\```

## Example: Research from URL

\```bash
pdf-reader fetch https://arxiv.org/pdf/2401.12345.pdf
# Downloads and extracts full text
\```
```

**Step 2: Commit**

```bash
git add .claude/skills/add-pdf-reader/add/container/skills/pdf-reader/SKILL.md
git commit -m "feat(skills): add pdf-reader container skill documentation"
```

---

### Task 5: Create modified Dockerfile + intent file

**Files:**
- Create: `.claude/skills/add-pdf-reader/modify/container/Dockerfile`
- Create: `.claude/skills/add-pdf-reader/modify/container/Dockerfile.intent.md`

**Step 1: Write the modified Dockerfile**

This must be the COMPLETE Dockerfile as it should look after the skill is applied. Start from the base version at `.nanoclaw/base/container/Dockerfile` and add: `poppler-utils` to `apt-get`, `COPY` + `chmod` for the `pdf-reader` script.

Changes from base:
1. Add `poppler-utils` to the `apt-get install` line (after `git`)
2. Add `COPY skills/pdf-reader/pdf-reader /usr/local/bin/pdf-reader` and `RUN chmod +x` after the agent-browser/claude-code install
3. Context is `container/` so paths are relative to that

```dockerfile
# NanoClaw Agent Container
# Runs Claude Agent SDK in isolated Linux VM with browser automation

FROM node:22-slim

# Install system dependencies for Chromium and PDF tools
RUN apt-get update && apt-get install -y \
    chromium \
    fonts-liberation \
    fonts-noto-color-emoji \
    libgbm1 \
    libnss3 \
    libatk-bridge2.0-0 \
    libgtk-3-0 \
    libx11-xcb1 \
    libxcomposite1 \
    libxdamage1 \
    libxrandr2 \
    libasound2 \
    libpangocairo-1.0-0 \
    libcups2 \
    libdrm2 \
    libxshmfence1 \
    curl \
    git \
    poppler-utils \
    && rm -rf /var/lib/apt/lists/*

# Set Chromium path for agent-browser
ENV AGENT_BROWSER_EXECUTABLE_PATH=/usr/bin/chromium
ENV PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium

# Install agent-browser and claude-code globally
RUN npm install -g agent-browser @anthropic-ai/claude-code

# Install pdf-reader CLI tool
COPY skills/pdf-reader/pdf-reader /usr/local/bin/pdf-reader
RUN chmod +x /usr/local/bin/pdf-reader

# Create app directory
WORKDIR /app

# Copy package files first for better caching
COPY agent-runner/package*.json ./

# Install dependencies
RUN npm install

# Copy source code
COPY agent-runner/ ./

# Build TypeScript
RUN npm run build

# Create workspace directories
RUN mkdir -p /workspace/group /workspace/global /workspace/extra /workspace/ipc/messages /workspace/ipc/tasks /workspace/ipc/input

# Create entrypoint script
# Secrets are passed via stdin JSON — temp file is deleted immediately after Node reads it
# Follow-up messages arrive via IPC files in /workspace/ipc/input/
RUN printf '#!/bin/bash\nset -e\ncd /app && npx tsc --outDir /tmp/dist 2>&1 >&2\nln -s /app/node_modules /tmp/dist/node_modules\nchmod -R a-w /tmp/dist\ncat > /tmp/input.json\nnode /tmp/dist/index.js < /tmp/input.json\n' > /app/entrypoint.sh && chmod +x /app/entrypoint.sh

# Set ownership to node user (non-root) for writable directories
RUN chown -R node:node /workspace && chmod 777 /home/node

# Switch to non-root user (required for --dangerously-skip-permissions)
USER node

# Set working directory to group workspace
WORKDIR /workspace/group

# Entry point reads JSON from stdin, outputs JSON to stdout
ENTRYPOINT ["/app/entrypoint.sh"]
```

**Step 2: Write the Dockerfile intent file**

```markdown
# Intent: container/Dockerfile modifications

## What changed
Added PDF reading capability via poppler-utils and a custom pdf-reader CLI script.

## Key sections

### apt-get install (system dependencies block)
- Added: `poppler-utils` to the package list (provides pdftotext, pdfinfo, pdftohtml)
- Changed: Comment updated to mention PDF tools

### After npm global installs
- Added: `COPY skills/pdf-reader/pdf-reader /usr/local/bin/pdf-reader` to copy CLI script
- Added: `RUN chmod +x /usr/local/bin/pdf-reader` to make it executable

## Invariants (must-keep)
- All Chromium dependencies unchanged
- agent-browser and claude-code npm global installs unchanged
- WORKDIR, COPY agent-runner, npm install, npm run build sequence unchanged
- Workspace directory creation unchanged
- Entrypoint script unchanged
- User switching (node user) unchanged
- ENTRYPOINT unchanged
```

**Step 3: Commit**

```bash
git add .claude/skills/add-pdf-reader/modify/container/Dockerfile .claude/skills/add-pdf-reader/modify/container/Dockerfile.intent.md
git commit -m "feat(skills): add modified Dockerfile with poppler-utils"
```

---

### Task 6: Create modified whatsapp.ts + intent file

**Files:**
- Create: `.claude/skills/add-pdf-reader/modify/src/channels/whatsapp.ts`
- Create: `.claude/skills/add-pdf-reader/modify/src/channels/whatsapp.ts.intent.md`

**Step 1: Write the modified whatsapp.ts**

This must be the COMPLETE file as it should look after the skill is applied. Start from the **base version** at `.nanoclaw/base/src/channels/whatsapp.ts` (NOT the current file which has voice transcription — that's a separate skill).

The key changes to the base version:
1. Add import for `downloadMediaMessage` from Baileys
2. After content extraction, detect `documentMessage` with `application/pdf` mimetype
3. Download the PDF, save to `attachments/` directory, inject path into message content
4. Add import for `fs` and `path` if not already imported

Read `.nanoclaw/base/src/channels/whatsapp.ts` first — that's the base for the three-way merge. Add PDF attachment handling in the `messages.upsert` handler, after content extraction and before the `onMessage` call.

The PDF download pattern follows `transcription.ts` — use `downloadMediaMessage` from Baileys:

```typescript
// Inside the messages.upsert handler, after content extraction:
// Detect and download PDF attachments
const docMsg = msg.message?.documentMessage;
if (docMsg?.mimetype === 'application/pdf') {
  try {
    const buffer = (await downloadMediaMessage(
      msg,
      'buffer',
      {},
      { logger: console as any, reuploadRequest: sock.updateMediaMessage },
    )) as Buffer;

    if (buffer && buffer.length > 0) {
      const attachDir = path.join(GROUPS_DIR, group.folder, 'attachments');
      fs.mkdirSync(attachDir, { recursive: true });
      const filename = docMsg.fileName || `document-${Date.now()}.pdf`;
      const safeName = `${Date.now()}-${filename.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
      const filePath = path.join(attachDir, safeName);
      fs.writeFileSync(filePath, buffer);

      // Get page count via pdfinfo-style header check (first few bytes)
      const relPath = `attachments/${safeName}`;
      const sizeKB = Math.round(buffer.length / 1024);
      content = `[PDF: ${relPath} (${sizeKB}KB)]\nUse \`pdf-reader extract ${relPath}\` to read contents.`;
      logger.info({ chatJid, filename, size: buffer.length }, 'Downloaded PDF attachment');
    }
  } catch (err) {
    logger.error({ err }, 'Failed to download PDF attachment');
  }
}
```

Important: Read the full base file at `.nanoclaw/base/src/channels/whatsapp.ts` and produce the complete modified version. The code snippet above shows the logic to add — the `modify/` file must be the entire file.

**Step 2: Write the whatsapp.ts intent file**

```markdown
# Intent: src/channels/whatsapp.ts modifications

## What changed
Added PDF attachment download and path injection. When a WhatsApp message contains a PDF document, it is downloaded to the group's `attachments/` directory and the message content is replaced with the file path and a usage hint.

## Key sections

### Imports (top of file)
- Added: `downloadMediaMessage` from `@whiskeysockets/baileys`
- Added: `fs` and `path` imports (if not already present)
- Added: `GROUPS_DIR` from `../config.js` (if not already imported)

### messages.upsert handler (inside connectInternal)
- Added: After content extraction, check for `msg.message?.documentMessage?.mimetype === 'application/pdf'`
- Added: Download PDF via `downloadMediaMessage`, save to `groups/{folder}/attachments/`
- Added: Replace message content with `[PDF: attachments/{filename} ({size}KB)]` and usage hint
- Added: Logging for successful download and errors

## Invariants (must-keep)
- All existing message handling (conversation, extendedTextMessage, imageMessage, videoMessage) unchanged
- Connection lifecycle (connect, reconnect, disconnect) unchanged
- LID translation logic unchanged
- Outgoing message queue unchanged
- Group metadata sync unchanged
- sendMessage prefix logic unchanged
- setTyping, ownsJid, isConnected — all unchanged
```

**Step 3: Commit**

```bash
git add .claude/skills/add-pdf-reader/modify/src/channels/whatsapp.ts .claude/skills/add-pdf-reader/modify/src/channels/whatsapp.ts.intent.md
git commit -m "feat(skills): add modified whatsapp.ts with PDF attachment download"
```

---

### Task 7: Create modified whatsapp.test.ts + intent file

**Files:**
- Create: `.claude/skills/add-pdf-reader/modify/src/channels/whatsapp.test.ts`
- Create: `.claude/skills/add-pdf-reader/modify/src/channels/whatsapp.test.ts.intent.md`

**Step 1: Write the modified whatsapp.test.ts**

Start from the base version at `.nanoclaw/base/src/channels/whatsapp.test.ts`. Add test cases for PDF attachment handling inside the "message handling" describe block.

Tests to add:
1. **"downloads and injects PDF attachment path"** — send a message with `documentMessage` containing `application/pdf`, verify `downloadMediaMessage` was called and `onMessage` receives `[PDF: attachments/...]`
2. **"handles PDF download failure gracefully"** — `downloadMediaMessage` throws, verify original content is preserved
3. **"sanitizes PDF filename"** — filename with special characters gets sanitized

Mock `downloadMediaMessage` from `@whiskeysockets/baileys` — it's already mocked in the existing test file for the Baileys module.

**Step 2: Write the whatsapp.test.ts intent file**

```markdown
# Intent: src/channels/whatsapp.test.ts modifications

## What changed
Added test cases for PDF attachment download and path injection in the message handling section.

## Key sections

### Mocks (top of file)
- Modified: Baileys mock to also export `downloadMediaMessage` (may already be there)

### Test cases (inside "message handling" describe block)
- Added: "downloads and injects PDF attachment path" — verifies PDF detection, download, save, and content replacement
- Added: "handles PDF download failure gracefully" — verifies error handling when download fails
- Added: "sanitizes PDF filename" — verifies special characters are replaced

## Invariants (must-keep)
- All existing test cases unchanged
- All existing mocks unchanged
- All existing test helpers unchanged
- All describe blocks preserved
```

**Step 3: Commit**

```bash
git add .claude/skills/add-pdf-reader/modify/src/channels/whatsapp.test.ts .claude/skills/add-pdf-reader/modify/src/channels/whatsapp.test.ts.intent.md
git commit -m "feat(skills): add modified whatsapp.test.ts with PDF tests"
```

---

### Task 8: Create the interactive SKILL.md

**Files:**
- Create: `.claude/skills/add-pdf-reader/SKILL.md`

**Step 1: Write the skill phases**

Follow the `add-voice-transcription/SKILL.md` pattern — YAML frontmatter with interactive phases.

```markdown
---
name: add-pdf-reader
description: Add PDF reading to NanoClaw agents. Extracts text from PDFs via pdftotext CLI. Handles WhatsApp attachments, URLs, and local files.
---

# Add PDF Reader

Adds PDF reading capability to all container agents using poppler-utils (pdftotext/pdfinfo). PDFs sent as WhatsApp attachments are auto-downloaded to the group workspace.

## Phase 1: Pre-flight

### Check if already applied

Read `.nanoclaw/state.yaml`. If `add-pdf-reader` is in `applied_skills`, skip to Phase 3 (Verify).

## Phase 2: Apply Code Changes

### Initialize skills system (if needed)

If `.nanoclaw/` directory doesn't exist:

\```bash
npx tsx scripts/apply-skill.ts --init
\```

### Apply the skill

\```bash
npx tsx scripts/apply-skill.ts .claude/skills/add-pdf-reader
\```

This deterministically:
- Adds `container/skills/pdf-reader/SKILL.md` (agent-facing documentation)
- Adds `container/skills/pdf-reader/pdf-reader` (CLI script)
- Three-way merges `poppler-utils` + COPY into `container/Dockerfile`
- Three-way merges PDF attachment download into `src/channels/whatsapp.ts`
- Three-way merges PDF tests into `src/channels/whatsapp.test.ts`
- Records application in `.nanoclaw/state.yaml`

If merge conflicts occur, read the intent files:
- `modify/container/Dockerfile.intent.md`
- `modify/src/channels/whatsapp.ts.intent.md`
- `modify/src/channels/whatsapp.test.ts.intent.md`

### Validate

\```bash
npm test
npm run build
\```

### Rebuild container

\```bash
./container/build.sh
\```

### Restart service

\```bash
launchctl kickstart -k gui/$(id -u)/com.nanoclaw  # macOS
# Linux: systemctl --user restart nanoclaw
\```

## Phase 3: Verify

### Test PDF extraction

Send a PDF file in any registered WhatsApp chat. The agent should:
1. Download the PDF to `attachments/`
2. Respond acknowledging the PDF
3. Be able to extract text when asked

### Test URL fetching

Ask the agent to read a PDF from a URL. It should use `pdf-reader fetch <url>`.

### Check logs if needed

\```bash
tail -f logs/nanoclaw.log | grep -i pdf
\```

Look for:
- `Downloaded PDF attachment` — successful download
- `Failed to download PDF attachment` — media download issue

## Troubleshooting

### Agent says pdf-reader command not found

Container needs rebuilding. Run `./container/build.sh` and restart the service.

### PDF text extraction is empty

The PDF may be scanned (image-based). `pdftotext` only handles text-based PDFs. Consider using the agent-browser to open the PDF visually instead.

### WhatsApp PDF not detected

Verify the message has `documentMessage` with `mimetype: application/pdf`. Some file-sharing apps send PDFs as generic files without the correct mimetype.
```

**Step 2: Commit**

```bash
git add .claude/skills/add-pdf-reader/SKILL.md
git commit -m "feat(skills): add interactive SKILL.md for pdf-reader"
```

---

### Task 9: Run skill validation tests (GREEN)

**Step 1: Run the tests**

Run: `npx vitest run --config vitest.skills.config.ts .claude/skills/add-pdf-reader/tests/pdf-reader.test.ts`
Expected: All tests PASS

**Step 2: Fix any failures**

If any test fails, read the error, fix the relevant file, and re-run.

**Step 3: Run full test suite**

Run: `npm test`
Expected: All existing tests still pass (the skill package files don't affect runtime tests)

**Step 4: Commit if any fixes were needed**

```bash
git add -A .claude/skills/add-pdf-reader/
git commit -m "fix(skills): fix pdf-reader skill package test failures"
```

---

### Task 10: Final verification and cleanup

**Step 1: Verify complete package**

Run: `find .claude/skills/add-pdf-reader -type f | sort`

Expected output:
```
.claude/skills/add-pdf-reader/SKILL.md
.claude/skills/add-pdf-reader/add/container/skills/pdf-reader/SKILL.md
.claude/skills/add-pdf-reader/add/container/skills/pdf-reader/pdf-reader
.claude/skills/add-pdf-reader/manifest.yaml
.claude/skills/add-pdf-reader/modify/container/Dockerfile
.claude/skills/add-pdf-reader/modify/container/Dockerfile.intent.md
.claude/skills/add-pdf-reader/modify/src/channels/whatsapp.test.ts
.claude/skills/add-pdf-reader/modify/src/channels/whatsapp.test.ts.intent.md
.claude/skills/add-pdf-reader/modify/src/channels/whatsapp.ts
.claude/skills/add-pdf-reader/modify/src/channels/whatsapp.ts.intent.md
.claude/skills/add-pdf-reader/tests/pdf-reader.test.ts
```

**Step 2: Apply the skill to the local installation**

Run: `npx tsx scripts/apply-skill.ts .claude/skills/add-pdf-reader`

This will:
- Copy new files from `add/`
- Three-way merge modified files
- Update `.nanoclaw/state.yaml`

**Step 3: Run full tests after application**

Run: `npm test && npm run build`
Expected: All tests pass, build succeeds

**Step 4: Rebuild container**

Run: `./container/build.sh`
Expected: Container builds successfully with `poppler-utils` and `pdf-reader` installed

**Step 5: Sync agent-runner caches**

Since we didn't modify agent-runner source, this step is only needed if the container skill SKILL.md needs to be re-synced:

```bash
launchctl kickstart -k gui/$(id -u)/com.nanoclaw
```

**Step 6: Final commit**

```bash
git add -A
git commit -m "feat(skills): complete add-pdf-reader skill package"
```
