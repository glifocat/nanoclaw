/**
 * Minimal markdown → Matrix HTML (org.matrix.custom.html) renderer.
 *
 * Covers the subset agents actually emit: headings, bold, italic,
 * strikethrough, inline code, fenced code blocks, links, ordered/unordered
 * lists, and blockquotes. Returns null when the text contains no markdown so
 * callers can omit `formatted_body` entirely for plain messages.
 *
 * Deliberately dependency-free: a full markdown engine buys nothing here and
 * every rendered tag stays inside the Matrix spec's suggested HTML subset.
 */

function escapeHtml(text: string): string {
  return text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
}

/** Tracks whether any markdown construct actually fired during a render. */
class RenderState {
  formatted = false;
}

function renderInline(text: string, state: RenderState): string {
  // Pull code spans out first so their contents are exempt from the other
  // inline rules, then restore them at the end.
  const codeSpans: string[] = [];
  let html = escapeHtml(text).replace(/`([^`\n]+)`/g, (_match, code: string) => {
    state.formatted = true;
    codeSpans.push(`<code>${code}</code>`);
    return `\uE000${codeSpans.length - 1}\uE000`;
  });

  html = html.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, (_match, label: string, href: string) => {
    state.formatted = true;
    return `<a href="${href}">${label}</a>`;
  });
  html = html.replace(/\*\*([^*\n]+)\*\*/g, (_match, inner: string) => {
    state.formatted = true;
    return `<strong>${inner}</strong>`;
  });
  html = html.replace(/(^|[^*\w])\*([^*\s][^*\n]*?)\*(?!\*)/g, (_match, lead: string, inner: string) => {
    state.formatted = true;
    return `${lead}<em>${inner}</em>`;
  });
  html = html.replace(/(^|\W)_([^_\n]+)_(?=\W|$)/g, (_match, lead: string, inner: string) => {
    state.formatted = true;
    return `${lead}<em>${inner}</em>`;
  });
  html = html.replace(/~~([^~\n]+)~~/g, (_match, inner: string) => {
    state.formatted = true;
    return `<del>${inner}</del>`;
  });

  return html.replace(/\uE000(\d+)\uE000/g, (_match, index: string) => codeSpans[Number(index)]!);
}

const LIST_ITEM = /^\s{0,3}([-*+]|\d{1,3}[.)])\s+(.*)$/;
const HEADING = /^(#{1,6})\s+(.*)$/;

export function markdownToMatrixHtml(text: string): string | null {
  const state = new RenderState();
  const lines = text.split('\n');
  const blocks: string[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index]!;

    if (line.trim() === '') {
      index++;
      continue;
    }

    const fence = line.match(/^\s{0,3}```(\w*)\s*$/);
    if (fence) {
      const codeLines: string[] = [];
      index++;
      while (index < lines.length && !/^\s{0,3}```\s*$/.test(lines[index]!)) {
        codeLines.push(lines[index]!);
        index++;
      }
      index++; // closing fence (or EOF)
      state.formatted = true;
      const languageClass = fence[1] ? ` class="language-${fence[1]}"` : '';
      blocks.push(`<pre><code${languageClass}>${escapeHtml(codeLines.join('\n'))}</code></pre>`);
      continue;
    }

    const heading = line.match(HEADING);
    if (heading) {
      state.formatted = true;
      const level = heading[1]!.length;
      blocks.push(`<h${level}>${renderInline(heading[2]!, state)}</h${level}>`);
      index++;
      continue;
    }

    if (/^\s{0,3}>\s?/.test(line)) {
      const quoted: string[] = [];
      while (index < lines.length && /^\s{0,3}>\s?/.test(lines[index]!)) {
        quoted.push(lines[index]!.replace(/^\s{0,3}>\s?/, ''));
        index++;
      }
      state.formatted = true;
      blocks.push(`<blockquote>${quoted.map((entry) => renderInline(entry, state)).join('<br/>')}</blockquote>`);
      continue;
    }

    const listMatch = line.match(LIST_ITEM);
    if (listMatch) {
      const ordered = /^\d/.test(listMatch[1]!);
      const items: string[] = [];
      while (index < lines.length) {
        const itemMatch = lines[index]!.match(LIST_ITEM);
        if (!itemMatch || /^\d/.test(itemMatch[1]!) !== ordered) break;
        items.push(`<li>${renderInline(itemMatch[2]!, state)}</li>`);
        index++;
      }
      state.formatted = true;
      const tag = ordered ? 'ol' : 'ul';
      blocks.push(`<${tag}>${items.join('')}</${tag}>`);
      continue;
    }

    const paragraph: string[] = [];
    while (index < lines.length) {
      const current = lines[index]!;
      if (
        current.trim() === '' ||
        HEADING.test(current) ||
        LIST_ITEM.test(current) ||
        /^\s{0,3}(```|>\s?)/.test(current)
      ) {
        break;
      }
      paragraph.push(renderInline(current, state));
      index++;
    }
    blocks.push(`<p>${paragraph.join('<br/>')}</p>`);
  }

  return state.formatted ? blocks.join('') : null;
}
