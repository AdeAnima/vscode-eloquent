/**
 * Converts markdown-formatted text into natural speech-ready text.
 *
 * Handles: headings, bold/italic/strikethrough, code spans, fenced code blocks,
 * links, images, lists, blockquotes, horizontal rules, HTML tags, tables,
 * emoji/special characters, common abbreviations, and excessive whitespace.
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

  // Special characters commonly used by LLMs → speech-friendly replacements
  result = result.replace(/→/g, " to ");
  result = result.replace(/←/g, " from ");
  result = result.replace(/↔/g, " between ");
  result = result.replace(/—/g, ", ");
  result = result.replace(/–/g, ", ");
  result = result.replace(/•/g, "");
  result = result.replace(/✓|✔|☑/g, "yes");
  result = result.replace(/✗|✘|☒|❌/g, "no");
  result = result.replace(/⚠️?/g, "warning: ");
  result = result.replace(/ℹ️?/g, "note: ");

  // Strip remaining emoji (Unicode emoji ranges)
  result = result.replace(
    /[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F1E0}-\u{1F1FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{FE00}-\u{FE0F}\u{1F900}-\u{1F9FF}\u{1FA00}-\u{1FA6F}\u{1FA70}-\u{1FAFF}\u{200D}\u{20E3}\u{E0020}-\u{E007F}]/gu,
    ""
  );

  // Bare URLs: replace before abbreviation expansion (prevents "https" expansion)
  result = result.replace(/https?:\/\/\S+/g, "link");

  // Expand common abbreviations (case-insensitive, word-boundary, first occurrence only)
  result = expandAbbreviations(result);

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

/**
 * Common tech abbreviations → spoken expansions.
 * Only expands standalone occurrences (word boundaries), preserving case context.
 */
const ABBREVIATIONS: ReadonlyMap<string, string> = new Map([
  ["npm", "NPM, the Node Package Manager,"],
  ["api", "A P I"],
  ["apis", "A P Is"],
  ["url", "U R L"],
  ["urls", "U R Ls"],
  ["html", "H T M L"],
  ["css", "C S S"],
  ["json", "JSON"],
  ["sql", "S Q L"],
  ["cli", "C L I"],
  ["gui", "G U I"],
  ["sdk", "S D K"],
  ["ide", "I D E"],
  ["cpu", "C P U"],
  ["gpu", "G P U"],
  ["ram", "RAM"],
  ["tts", "T T S"],
  ["llm", "L L M"],
  ["llms", "L L Ms"],
  ["ai", "A I"],
  ["ml", "M L"],
  ["os", "O S"],
  ["ui", "U I"],
  ["ux", "U X"],
  ["ci", "C I"],
  ["cd", "C D"],
  ["pr", "P R"],
  ["prs", "P Rs"],
  ["ssr", "S S R"],
  ["ssr", "S S R"],
  ["dns", "D N S"],
  ["tcp", "T C P"],
  ["http", "H T T P"],
  ["https", "H T T P S"],
  ["ssh", "S S H"],
  ["jwt", "J W T"],
  ["oauth", "O Auth"],
  ["env", "environment"],
  ["repo", "repository"],
  ["repos", "repositories"],
  ["config", "configuration"],
  ["configs", "configurations"],
  ["auth", "authentication"],
  ["dev", "development"],
  ["deps", "dependencies"],
  ["impl", "implementation"],
  ["fn", "function"],
  ["args", "arguments"],
  ["params", "parameters"],
  ["async", "async"],
  ["src", "source"],
  ["dist", "distribution"],
  ["pkg", "package"],
  ["db", "database"],
  ["vscode", "VS Code"],
]);

/** Build regex lazily from the abbreviation map. */
let abbreviationRegex: RegExp | undefined;

function getAbbreviationRegex(): RegExp {
  if (!abbreviationRegex) {
    // Sort by length descending so longer matches win (e.g. "https" before "http")
    const keys = [...ABBREVIATIONS.keys()].sort(
      (a, b) => b.length - a.length
    );
    abbreviationRegex = new RegExp(
      `\\b(${keys.join("|")})\\b`,
      "gi"
    );
  }
  return abbreviationRegex;
}

function expandAbbreviations(text: string): string {
  // Track which abbreviations have been expanded (first-use only)
  const seen = new Set<string>();
  return text.replace(getAbbreviationRegex(), (match) => {
    const key = match.toLowerCase();
    if (seen.has(key)) return match;
    seen.add(key);
    return ABBREVIATIONS.get(key) ?? match;
  });
}
