/**
 * Extracts narration content from `<speak>` tags in LLM output.
 *
 * In narration mode, the LLM wraps speech-friendly summaries in `<speak>...</speak>`
 * tags. Only these sections are synthesized — code, verbose explanations, and other
 * content is visible in the chat but not read aloud.
 *
 * Handles incremental streaming: incomplete `<speak>` blocks (no closing tag yet)
 * are ignored until the closing tag arrives.
 */

const SPEAK_BLOCK_RE = /<speak>([\s\S]*?)<\/speak>/gi;

/**
 * Extracts text from all complete `<speak>...</speak>` blocks.
 * Returns the concatenated narration content, or empty string if none found.
 */
export function extractNarration(text: string): string {
  const parts: string[] = [];
  let match;
  // Reset lastIndex for global regex
  SPEAK_BLOCK_RE.lastIndex = 0;
  while ((match = SPEAK_BLOCK_RE.exec(text)) !== null) {
    const content = match[1].trim();
    if (content) {
      parts.push(content);
    }
  }
  return parts.join("\n\n");
}

/**
 * Returns true if the text contains an unclosed `<speak>` tag,
 * indicating more narration content may still be streaming in.
 */
export function hasIncompleteNarration(text: string): boolean {
  const opens = (text.match(/<speak>/gi) || []).length;
  const closes = (text.match(/<\/speak>/gi) || []).length;
  return opens > closes;
}
