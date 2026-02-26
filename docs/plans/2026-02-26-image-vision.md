# Image Vision Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Enable Gambi to see and understand images sent in WhatsApp using Claude's native vision.

**Architecture:** Images are downloaded from WhatsApp, resized with sharp, and saved to the group's attachments folder. The message content references the file as `[Image: attachments/...]`. The message loop parses these references, and passes them as `imageAttachments` in `ContainerInput`. Inside the container, the agent-runner reads the image files, base64-encodes them, and builds multimodal SDK content blocks so Claude sees the image natively.

**Tech Stack:** sharp (image resizing), Baileys downloadMediaMessage, Claude Agent SDK multimodal content blocks

---

### Task 1: Install sharp dependency

**Files:**
- Modify: `package.json`

**Step 1: Install sharp**

Run: `npm install sharp`

**Step 2: Install sharp types**

Run: `npm install -D @types/sharp`

**Step 3: Verify installation**

Run: `npm run typecheck`
Expected: No errors

**Step 4: Commit**

```bash
git add package.json package-lock.json
git commit -m "feat(vision): add sharp dependency for image resizing"
```

---

### Task 2: Create image processing module with tests

**Files:**
- Create: `src/image.ts`
- Create: `src/image.test.ts`

**Step 1: Write the failing test**

Create `src/image.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'fs';
import path from 'path';

// Mock sharp
vi.mock('sharp', () => {
  const mockSharp = vi.fn(() => ({
    resize: vi.fn().mockReturnThis(),
    jpeg: vi.fn().mockReturnThis(),
    toBuffer: vi.fn().mockResolvedValue(Buffer.from('resized-image-data')),
    metadata: vi.fn().mockResolvedValue({ width: 2000, height: 1500 }),
  }));
  return { default: mockSharp };
});

vi.mock('fs');

import { processImage, parseImageReferences, isImageMessage } from './image.js';

describe('image processing', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(fs.mkdirSync).mockReturnValue(undefined);
    vi.mocked(fs.writeFileSync).mockReturnValue(undefined);
  });

  describe('isImageMessage', () => {
    it('returns true for image messages', () => {
      const msg = { message: { imageMessage: { mimetype: 'image/jpeg' } } };
      expect(isImageMessage(msg as any)).toBe(true);
    });

    it('returns false for non-image messages', () => {
      const msg = { message: { conversation: 'hello' } };
      expect(isImageMessage(msg as any)).toBe(false);
    });

    it('returns false for null message', () => {
      const msg = { message: null };
      expect(isImageMessage(msg as any)).toBe(false);
    });
  });

  describe('processImage', () => {
    it('resizes and saves image, returns content string', async () => {
      const buffer = Buffer.from('raw-image-data');
      const result = await processImage(buffer, '/tmp/groups/test', 'Check this out');

      expect(result.content).toMatch(/^\[Image: attachments\/img-\d+\.jpg\] Check this out$/);
      expect(result.relativePath).toMatch(/^attachments\/img-\d+\.jpg$/);
      expect(fs.mkdirSync).toHaveBeenCalled();
      expect(fs.writeFileSync).toHaveBeenCalled();
    });

    it('returns content without caption when none provided', async () => {
      const buffer = Buffer.from('raw-image-data');
      const result = await processImage(buffer, '/tmp/groups/test', '');

      expect(result.content).toMatch(/^\[Image: attachments\/img-\d+\.jpg\]$/);
    });

    it('returns null on empty buffer', async () => {
      const result = await processImage(Buffer.alloc(0), '/tmp/groups/test', '');

      expect(result).toBeNull();
    });
  });

  describe('parseImageReferences', () => {
    it('extracts image paths from message content', () => {
      const messages = [
        { content: '[Image: attachments/img-123.jpg] hello' },
        { content: 'plain text' },
        { content: '[Image: attachments/img-456.jpg]' },
      ];
      const refs = parseImageReferences(messages as any);

      expect(refs).toEqual([
        { relativePath: 'attachments/img-123.jpg', mediaType: 'image/jpeg' },
        { relativePath: 'attachments/img-456.jpg', mediaType: 'image/jpeg' },
      ]);
    });

    it('returns empty array when no images', () => {
      const messages = [{ content: 'just text' }];
      expect(parseImageReferences(messages as any)).toEqual([]);
    });
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm test -- src/image.test.ts`
Expected: FAIL — module `./image.js` not found

**Step 3: Write minimal implementation**

Create `src/image.ts`:

```typescript
import fs from 'fs';
import path from 'path';
import sharp from 'sharp';
import type { WAMessage } from '@whiskeysockets/baileys';

const MAX_DIMENSION = 1024;
const IMAGE_REF_PATTERN = /\[Image: (attachments\/[^\]]+)\]/g;

export interface ProcessedImage {
  content: string;
  relativePath: string;
}

export interface ImageAttachment {
  relativePath: string;
  mediaType: string;
}

export function isImageMessage(msg: WAMessage): boolean {
  return !!msg.message?.imageMessage;
}

export async function processImage(
  buffer: Buffer,
  groupDir: string,
  caption: string,
): Promise<ProcessedImage | null> {
  if (!buffer || buffer.length === 0) return null;

  const resized = await sharp(buffer)
    .resize(MAX_DIMENSION, MAX_DIMENSION, { fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 85 })
    .toBuffer();

  const attachDir = path.join(groupDir, 'attachments');
  fs.mkdirSync(attachDir, { recursive: true });

  const filename = `img-${Date.now()}.jpg`;
  const filePath = path.join(attachDir, filename);
  fs.writeFileSync(filePath, resized);

  const relativePath = `attachments/${filename}`;
  const content = caption
    ? `[Image: ${relativePath}] ${caption}`
    : `[Image: ${relativePath}]`;

  return { content, relativePath };
}

export function parseImageReferences(
  messages: Array<{ content: string }>,
): ImageAttachment[] {
  const refs: ImageAttachment[] = [];
  for (const msg of messages) {
    let match: RegExpExecArray | null;
    IMAGE_REF_PATTERN.lastIndex = 0;
    while ((match = IMAGE_REF_PATTERN.exec(msg.content)) !== null) {
      refs.push({ relativePath: match[1], mediaType: 'image/jpeg' });
    }
  }
  return refs;
}
```

**Step 4: Run test to verify it passes**

Run: `npm test -- src/image.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/image.ts src/image.test.ts
git commit -m "feat(vision): add image processing module with tests"
```

---

### Task 3: Update WhatsApp channel to download and process images

**Files:**
- Modify: `src/channels/whatsapp.ts:184-222` (message handler, after PDF block)
- Modify: `src/channels/whatsapp.test.ts` (add image download tests)

**Step 1: Write the failing tests**

Add to `src/channels/whatsapp.test.ts`, after the existing `extracts caption from imageMessage` test (~line 503). Also add `processImage` to the mock setup.

Add mock at top of file (after the transcription mock):
```typescript
vi.mock('../image.js', () => ({
  isImageMessage: vi.fn(() => false),
  processImage: vi.fn().mockResolvedValue({
    content: '[Image: attachments/img-123.jpg] Check this photo',
    relativePath: 'attachments/img-123.jpg',
  }),
}));
```

Add import:
```typescript
import { isImageMessage, processImage } from '../image.js';
```

Add tests:
```typescript
it('downloads and processes image attachments', async () => {
  const mockBuffer = Buffer.from('fake-jpeg-data');
  vi.mocked(downloadMediaMessage).mockResolvedValueOnce(mockBuffer as any);
  vi.mocked(isImageMessage).mockReturnValueOnce(true);

  const opts = createTestOpts();
  const channel = new WhatsAppChannel(opts);
  await connectChannel(channel);

  await triggerMessages([{
    key: { id: 'img-1', remoteJid: 'registered@g.us', participant: '5551234@s.whatsapp.net', fromMe: false },
    messageTimestamp: Math.floor(Date.now() / 1000),
    pushName: 'Diana',
    message: {
      imageMessage: { caption: 'Check this photo', mimetype: 'image/jpeg' },
    },
  }]);

  expect(downloadMediaMessage).toHaveBeenCalled();
  expect(processImage).toHaveBeenCalledWith(mockBuffer, expect.stringContaining('registered'), 'Check this photo');
  expect(opts.onMessage).toHaveBeenCalledWith(
    'registered@g.us',
    expect.objectContaining({
      content: '[Image: attachments/img-123.jpg] Check this photo',
    }),
  );
});

it('handles image without caption', async () => {
  const mockBuffer = Buffer.from('fake-jpeg-data');
  vi.mocked(downloadMediaMessage).mockResolvedValueOnce(mockBuffer as any);
  vi.mocked(isImageMessage).mockReturnValueOnce(true);
  vi.mocked(processImage).mockResolvedValueOnce({
    content: '[Image: attachments/img-456.jpg]',
    relativePath: 'attachments/img-456.jpg',
  });

  const opts = createTestOpts();
  const channel = new WhatsAppChannel(opts);
  await connectChannel(channel);

  await triggerMessages([{
    key: { id: 'img-2', remoteJid: 'registered@g.us', participant: '5551234@s.whatsapp.net', fromMe: false },
    messageTimestamp: Math.floor(Date.now() / 1000),
    pushName: 'Diana',
    message: {
      imageMessage: { mimetype: 'image/jpeg' },
    },
  }]);

  expect(opts.onMessage).toHaveBeenCalledWith(
    'registered@g.us',
    expect.objectContaining({
      content: '[Image: attachments/img-456.jpg]',
    }),
  );
});

it('handles image download failure gracefully', async () => {
  vi.mocked(downloadMediaMessage).mockRejectedValueOnce(new Error('download failed'));
  vi.mocked(isImageMessage).mockReturnValueOnce(true);

  const opts = createTestOpts();
  const channel = new WhatsAppChannel(opts);
  await connectChannel(channel);

  await triggerMessages([{
    key: { id: 'img-3', remoteJid: 'registered@g.us', participant: '5551234@s.whatsapp.net', fromMe: false },
    messageTimestamp: Math.floor(Date.now() / 1000),
    pushName: 'Diana',
    message: {
      imageMessage: { caption: 'This will fail', mimetype: 'image/jpeg' },
    },
  }]);

  expect(opts.onMessage).toHaveBeenCalledWith(
    'registered@g.us',
    expect.objectContaining({
      content: '[Image - download failed]',
    }),
  );
});
```

**Step 2: Run tests to verify they fail**

Run: `npm test -- src/channels/whatsapp.test.ts`
Expected: FAIL — new tests fail (isImageMessage/processImage not imported in whatsapp.ts)

**Step 3: Implement image handling in WhatsApp channel**

Modify `src/channels/whatsapp.ts`:

Add import at top:
```typescript
import { isImageMessage, processImage } from '../image.js';
```

After the PDF download block (after line 219, before the `// Skip protocol messages` comment), add:

```typescript
// Download and process image attachments for vision
if (isImageMessage(msg)) {
  try {
    const buffer = (await downloadMediaMessage(
      msg,
      'buffer',
      {},
      { logger: console as any, reuploadRequest: this.sock.updateMediaMessage },
    )) as Buffer;

    const caption = msg.message?.imageMessage?.caption || '';
    const group = groups[chatJid];
    const groupDir = path.join(GROUPS_DIR, group.folder);
    const result = await processImage(buffer, groupDir, caption);

    if (result) {
      content = result.content;
      logger.info({ chatJid, path: result.relativePath }, 'Processed image attachment');
    } else {
      content = caption || '[Image - processing failed]';
    }
  } catch (err) {
    logger.error({ err }, 'Failed to download image attachment');
    content = '[Image - download failed]';
  }
}
```

**Step 4: Run tests to verify they pass**

Run: `npm test -- src/channels/whatsapp.test.ts`
Expected: PASS

**Step 5: Also run the image module tests**

Run: `npm test`
Expected: All tests PASS

**Step 6: Commit**

```bash
git add src/channels/whatsapp.ts src/channels/whatsapp.test.ts
git commit -m "feat(vision): download and process WhatsApp images"
```

---

### Task 4: Update ContainerInput and message loop to pass image attachments

**Files:**
- Modify: `src/container-runner.ts:29-38` (ContainerInput interface)
- Modify: `src/index.ts:156,275-284` (processGroupMessages)

**Step 1: Add imageAttachments to ContainerInput**

In `src/container-runner.ts`, add to the `ContainerInput` interface (after line 36):

```typescript
imageAttachments?: Array<{ relativePath: string; mediaType: string }>;
```

**Step 2: Update processGroupMessages in index.ts**

Add import at top of `src/index.ts`:
```typescript
import { parseImageReferences } from './image.js';
```

After `const prompt = formatMessages(missedMessages);` (~line 156), add:

```typescript
const imageAttachments = parseImageReferences(missedMessages);
```

In the `runContainerAgent` call (~line 275-284), add `imageAttachments`:

```typescript
const output = await runContainerAgent(
  group,
  {
    prompt,
    sessionId,
    groupFolder: group.folder,
    chatJid,
    isMain,
    assistantName: ASSISTANT_NAME,
    ...(imageAttachments.length > 0 && { imageAttachments }),
  },
  (proc, containerName) => queue.registerProcess(chatJid, proc, containerName, group.folder),
  wrappedOnOutput,
);
```

**Step 3: Note on piped messages**

The pipe path in `startMessageLoop` (~line 373-375) sends formatted text to active containers. Images in piped follow-up messages won't get native vision (the container is already running). This is acceptable — the image file is mounted and the agent can use the `Read` tool to view it. The text reference `[Image: attachments/...]` provides sufficient context.

**Step 4: Run typecheck**

Run: `npm run typecheck`
Expected: PASS

**Step 5: Commit**

```bash
git add src/container-runner.ts src/index.ts
git commit -m "feat(vision): pass image attachments through container input"
```

---

### Task 5: Update agent-runner to build multimodal SDK content

**Files:**
- Modify: `container/agent-runner/src/index.ts:51-56` (SDKUserMessage type)
- Modify: `container/agent-runner/src/index.ts:66-96` (MessageStream class)
- Modify: `container/agent-runner/src/index.ts:362-371` (runQuery image loading)

**Step 1: Add multimodal type definitions**

At `container/agent-runner/src/index.ts`, above the `SDKUserMessage` interface (~line 49), add:

```typescript
interface ImageContentBlock {
  type: 'image';
  source: { type: 'base64'; media_type: string; data: string };
}

interface TextContentBlock {
  type: 'text';
  text: string;
}

type ContentBlock = ImageContentBlock | TextContentBlock;
```

**Step 2: Update SDKUserMessage content type**

Change the `content` field to accept both formats:

```typescript
interface SDKUserMessage {
  type: 'user';
  message: { role: 'user'; content: string | ContentBlock[] };
  parent_tool_use_id: null;
  session_id: string;
}
```

**Step 3: Add pushMultimodal to MessageStream**

Add method to `MessageStream` class (after the `push` method, ~line 78):

```typescript
pushMultimodal(content: ContentBlock[]): void {
  this.queue.push({
    type: 'user',
    message: { role: 'user', content },
    parent_tool_use_id: null,
    session_id: '',
  });
  this.waiting?.();
}
```

**Step 4: Load images and build multimodal prompt in runQuery**

In `runQuery()` (~line 370-371), replace:

```typescript
const stream = new MessageStream();
stream.push(prompt);
```

With:

```typescript
const stream = new MessageStream();

// Build multimodal content if images are attached
const imageAttachments = containerInput.imageAttachments;
if (imageAttachments && imageAttachments.length > 0) {
  const blocks: ContentBlock[] = [];

  for (const img of imageAttachments) {
    const imgPath = path.join('/workspace/group', img.relativePath);
    try {
      const imgBuffer = fs.readFileSync(imgPath);
      blocks.push({
        type: 'image',
        source: {
          type: 'base64',
          media_type: img.mediaType,
          data: imgBuffer.toString('base64'),
        },
      });
      log(`Loaded image: ${img.relativePath} (${imgBuffer.length} bytes)`);
    } catch (err) {
      log(`Failed to load image ${img.relativePath}: ${err}`);
    }
  }

  if (blocks.length > 0) {
    blocks.push({ type: 'text', text: prompt });
    stream.pushMultimodal(blocks);
  } else {
    stream.push(prompt);
  }
} else {
  stream.push(prompt);
}
```

**Step 5: Add imageAttachments to ContainerInput type in agent-runner**

Find where `ContainerInput` is defined/typed in the agent-runner and add:

```typescript
imageAttachments?: Array<{ relativePath: string; mediaType: string }>;
```

**Step 6: Sync agent-runner source to group caches**

Run: `for dir in data/sessions/*/agent-runner-src/; do cp container/agent-runner/src/*.ts "$dir"; done`

**Step 7: Typecheck agent-runner**

Run: `cd container/agent-runner && npx tsc --noEmit && cd ../..`

If the SDK type strictly requires `content: string`, cast the content field:

```typescript
message: { role: 'user', content: blocks as any },
```

**Step 8: Commit**

```bash
git add container/agent-runner/src/index.ts
git commit -m "feat(vision): build multimodal SDK content from image attachments"
```

---

### Task 6: Build and integration test

**Files:**
- No new files

**Step 1: Run all unit tests**

Run: `npm test`
Expected: All PASS

**Step 2: Run typecheck**

Run: `npm run typecheck`
Expected: PASS

**Step 3: Build host**

Run: `npm run build`
Expected: PASS

**Step 4: Rebuild container**

Run: `./container/build.sh`
Expected: PASS

**Step 5: Manual integration test**

1. Start dev: `npm run dev`
2. Send an image with caption in a registered WhatsApp group
3. Check logs for: `Processed image attachment`
4. Verify Gambi responds describing the image content
5. Send an image without caption — verify Gambi still sees it
6. Send a text message — verify normal flow unaffected

**Step 6: Final commit if any fixes needed**

```bash
git add -A
git commit -m "feat(vision): image vision support for WhatsApp"
```
