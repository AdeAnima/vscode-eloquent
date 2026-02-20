/**
 * Converts markdown-formatted text into natural speech-ready text.
 *
 * Handles: headings, bold/italic/strikethrough, code spans, fenced code blocks,
 * links, images, lists, blockquotes, horizontal rules, HTML tags, tables,
 * and excessive whitespace.
 *
 * Designed for incremental use — safe to call on partial/accumulating buffers.
 */
export function preprocessForSpeech(text: string): string {
  let result = text;

  // Fenced code blocks: ```lang\n...\n``` → "Code example: ..."
  // Only match complete blocks (both fences present)
  result = result.replace(
    /```(\w*)\n([\s\S]*?)```/g,
    (_match, lang: string, code: string) => {
      const trimmed = code.trim();
      if (!trimmed) return "";
      const label = lang ? `${lang} code` : "Code";
      // For very long code blocks, just announce them
      if (trimmed.split("\n").length > 6) {
        return `${label} block omitted.`;
      }
      return `${label} example: ${collapseWhitespace(trimmed)}`;
    }
  );

  // Inline code: `foo` → foo
  result = result.replace(/`([^`]+)`/g, "$1");

  // Images: ![alt](url) → "Image: alt" or skip if no alt
  result = result.replace(/!\[([^\]]*)\]\([^)]*\)/g, (_m, alt: string) =>
    alt.trim() ? `Image: ${alt.trim()}.` : ""
  );

  // Links: [text](url) → text
  result = result.replace(/\[([^\]]+)\]\([^)]*\)/g, "$1");

  // Reference-style links: [text][ref] → text
  result = result.replace(/\[([^\]]+)\]\[[^\]]*\]/g, "$1");

  // Link definitions: [ref]: url ... → remove
  result = result.replace(/^\[([^\]]+)\]:\s+\S+.*$/gm, "");

  // Horizontal rules: --- / *** / ___ → remove
  result = result.replace(/^[\s]*([-*_]){3,}\s*$/gm, "");

  // Headings: # Heading → Heading.
  // Add a period to create a natural pause after headings
  result = result.replace(/^#{1,6}\s+(.+)$/gm, "$1.");

  // Bold + italic: ***text*** or ___text___ → text
  result = result.replace(/\*{3}(.+?)\*{3}/g, "$1");
  result = result.replace(/_{3}(.+?)_{3}/g, "$1");

  // Bold: **text** or __text__ → text
  result = result.replace(/\*{2}(.+?)\*{2}/g, "$1");
  result = result.replace(/_{2}(.+?)_{2}/g, "$1");

  // Italic: *text* or _text_ → text
  // Be careful not to match mid-word underscores (e.g. snake_case)
  result = result.replace(/\*(.+?)\*/g, "$1");
  result = result.replace(/(?<!\w)_(.+?)_(?!\w)/g, "$1");

  // Strikethrough: ~~text~~ → text
  result = result.replace(/~~(.+?)~~/g, "$1");

  // Blockquotes: > text → text (handles nested > > too)
  result = result.replace(/^(?:>\s?)+/gm, "");

  // Unordered list items: - item / * item / + item → item
  result = result.replace(/^[\s]*[-*+]\s+/gm, "");

  // Ordered list items: 1. item → item
  result = result.replace(/^[\s]*\d+\.\s+/gm, "");

  // Task list items: - [x] / - [ ] → remove checkbox
  result = result.replace(/\[[ xX]\]\s*/g, "");

  // Tables: convert to readable form
  result = processMarkdownTables(result);

  // HTML tags: strip
  result = result.replace(/<[^>]+>/g, "");

  // HTML entities
  result = result.replace(/&amp;/g, " and ");
  result = result.replace(/&lt;/g, "less than ");
  result = result.replace(/&gt;/g, " greater than");
  result = result.replace(/&quot;/g, '"');
  result = result.replace(/&#39;/g, "'");
  result = result.replace(/&nbsp;/g, " ");

  // Bare URLs: don't read full URLs, just say "link"
  result = result.replace(/https?:\/\/\S+/g, "link");

  // Collapse multiple blank lines into one
  result = result.replace(/\n{3,}/g, "\n\n");

  // Collapse multiple spaces
  result = result.replace(/ {2,}/g, " ");

  // Trim lines
  result = result
    .split("\n")
    .map((l) => l.trim())
    .join("\n");

  return result.trim();
}

/** Convert markdown tables into spoken prose. */
function processMarkdownTables(text: string): string {
  // Match table blocks: header row + separator + data rows
  return text.replace(
    /^(\|.+\|)\n(\|[-| :]+\|)\n((?:\|.+\|\n?)*)/gm,
    (_match, headerRow: string, _sep: string, bodyRows: string) => {
      const headers = parseCells(headerRow);
      const rows = bodyRows
        .trim()
        .split("\n")
        .filter((r) => r.trim());

      if (rows.length === 0) return headers.join(", ") + ".";

      const spoken = rows.map((row) => {
        const cells = parseCells(row);
        return cells
          .map((cell, i) => {
            const header = headers[i];
            return header ? `${header}: ${cell}` : cell;
          })
          .join(", ");
      });

      return spoken.join(". ") + ".";
    }
  );
}

function parseCells(row: string): string[] {
  return row
    .split("|")
    .map((c) => c.trim())
    .filter((c) => c.length > 0);
}

function collapseWhitespace(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}
