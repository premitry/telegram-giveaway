import type { MessageEntity } from '../telegram/types';

/** HTML-escape the reserved characters Telegram's HTML parse mode cares about. */
export function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function tagsFor(e: MessageEntity): { open: string; close: string } | null {
  switch (e.type) {
    case 'bold':
      return { open: '<b>', close: '</b>' };
    case 'italic':
      return { open: '<i>', close: '</i>' };
    case 'underline':
      return { open: '<u>', close: '</u>' };
    case 'strikethrough':
      return { open: '<s>', close: '</s>' };
    case 'spoiler':
      return { open: '<tg-spoiler>', close: '</tg-spoiler>' };
    case 'code':
      return { open: '<code>', close: '</code>' };
    case 'pre':
      return e.language
        ? { open: `<pre><code class="language-${escapeHtml(e.language)}">`, close: '</code></pre>' }
        : { open: '<pre>', close: '</pre>' };
    case 'text_link':
      return e.url ? { open: `<a href="${escapeHtml(e.url)}">`, close: '</a>' } : null;
    default:
      // mention / hashtag / auto url / bot_command / etc. → keep as plain text
      return null;
  }
}

/**
 * Convert a Telegram plain-text message + its formatting entities into HTML
 * suitable for parse_mode:'HTML'. Text is escaped; supported entities are
 * wrapped in their tags. Offsets/lengths are UTF-16 units (JS-native), so
 * per-code-unit iteration reassembles surrogate pairs correctly.
 */
export function entitiesToHtml(text: string, entities?: MessageEntity[]): string {
  if (!entities || entities.length === 0) return escapeHtml(text);

  const spans = entities
    .map((e) => ({ e, t: tagsFor(e) }))
    .filter((x): x is { e: MessageEntity; t: { open: string; close: string } } => x.t !== null);
  if (spans.length === 0) return escapeHtml(text);

  let out = '';
  for (let i = 0; i <= text.length; i++) {
    // Close entities ending here (reverse start order → proper nesting).
    const closing = spans
      .filter((x) => x.e.offset + x.e.length === i)
      .sort((a, b) => b.e.offset - a.e.offset);
    for (const x of closing) out += x.t.close;
    // Open entities starting here (longer first → stable nesting).
    const opening = spans
      .filter((x) => x.e.offset === i)
      .sort((a, b) => b.e.length - a.e.length);
    for (const x of opening) out += x.t.open;
    if (i < text.length) out += escapeHtml(text[i]);
  }
  return out;
}
