# Image Vision for WhatsApp

**Date:** 2026-02-26
**Status:** Approved

## Goal

Enable Gambi to see and understand images sent in WhatsApp chats using Claude's native vision capabilities.

## Scope

- **In scope:** Photos (JPEG, PNG, WebP) sent as WhatsApp image messages
- **Out of scope:** Stickers, video frames, image generation, OCR fallbacks

## Architecture

```
WhatsApp image message
    ↓
1. whatsapp.ts: detect imageMessage, download buffer via Baileys
    ↓
2. sharp: resize to max 1024px longest side, convert to JPEG
    ↓
3. Save to groups/{name}/attachments/img-{timestamp}.jpg
    ↓
4. Message content: "[Image: attachments/img-{ts}.jpg]\ncaption text"
    ↓
5. ContainerInput: imageAttachments[] with relative paths + media types
    ↓
6. Container mounts group folder → image files accessible at /workspace/group/
    ↓
7. agent-runner: read image files, base64-encode, build multimodal SDK content
    ↓
8. SDK query() receives: content: [{ type: "image", ... }, { type: "text", ... }]
    ↓
9. Claude sees the image natively via vision
```

Key decision: Images are saved to disk on the host and read inside the container, rather than passing base64 through stdin. This keeps the ContainerInput payload small and reuses the existing group folder mount.

## Host-Side Changes

### New dependency: `sharp`

Image resizing to max 1024px before saving. Keeps token cost reasonable.

### WhatsApp channel (`src/channels/whatsapp.ts`)

After the existing PDF handling block, add image detection:

1. Detect: `msg.message?.imageMessage` exists
2. Download: `downloadMediaMessage(msg, 'buffer', ...)` — same pattern as voice/PDF
3. Resize: `sharp(buffer).resize(1024, 1024, { fit: 'inside' }).jpeg().toBuffer()`
4. Save: `groups/{folder}/attachments/img-{timestamp}.jpg`
5. Content: `[Image: attachments/img-{ts}.jpg]` + caption if present

Images without captions still get processed — the `[Image: ...]` tag becomes the content, passing the `!content` skip guard.

### Types (`src/types.ts`)

Add to `NewMessage`:
```typescript
imageAttachments?: Array<{ relativePath: string; mediaType: string }>;
```

### ContainerInput (`src/container-runner.ts`)

Add to `ContainerInput` interface:
```typescript
imageAttachments?: Array<{ relativePath: string; mediaType: string }>;
```

### Message loop (`src/index.ts`)

Collect `imageAttachments` from the batch of `NewMessage`s and pass to `ContainerInput`.

### DB storage

No schema changes. The content column stores the text reference `[Image: attachments/...]` like PDFs store `[PDF: attachments/...]`. Image file lives on disk.

## Container-Side Changes (Agent Runner)

### `SDKUserMessage` content type

Support multimodal content:
```typescript
content: string | Array<ImageBlock | TextBlock>
```

### `MessageStream`

Add `pushMultimodal(content: ContentBlock[])` method for multimodal messages.

### Image loading at startup

In `main()`, after parsing `ContainerInput`:

1. Check `containerInput.imageAttachments`
2. Read each file from `/workspace/group/{relativePath}`
3. Base64-encode
4. Build multimodal content: `[imageBlock1, ..., textBlock(prompt)]`
5. Push via `pushMultimodal()` instead of `push()`

If no images, existing `push(prompt)` path unchanged — zero impact on current behavior.

### Transcript parsing

`parseTranscript()` already handles array content by extracting text — session resume works with multimodal messages.

## Edge Cases

| Scenario | Behavior |
|----------|----------|
| Image with caption | `[Image: attachments/img-123.jpg] caption text` |
| Image without caption | `[Image: attachments/img-123.jpg]` |
| Multiple images in batch | All attached as separate image blocks |
| Image download fails | Fallback to `[Image - download failed]`, no attachment |
| Oversized after resize (>5MB) | Skip vision, save file, text reference only |
| Voice + image in same batch | Both processed independently |
| Scheduled tasks / IPC | No images — `imageAttachments` undefined, string path |

## What We're NOT Building

- Video frame extraction
- Sticker support
- Image generation/sending
- OCR fallback (Claude vision handles text natively)
- Image storage in database
- Automatic cleanup (images accumulate like PDFs)
