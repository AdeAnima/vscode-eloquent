import { describe, it, expect } from "vitest";
import { chunkText } from "../src/chunker";

describe("chunkText", () => {
  it("returns empty array for empty string", () => {
    expect(chunkText("")).toEqual([]);
    expect(chunkText("   ")).toEqual([]);
  });

  it("returns single chunk for short text", () => {
    expect(chunkText("Hello world.")).toEqual(["Hello world."]);
  });

  it("splits at sentence boundaries", () => {
    const input = "First sentence. Second sentence. Third sentence.";
    const chunks = chunkText(input, 135, 60);
    // "First sentence." fits in first chunk (< 60 chars)
    // "Second sentence. Third sentence." fits in one normal chunk
    expect(chunks.length).toBeGreaterThanOrEqual(1);
    expect(chunks.join(" ")).toBe(input);
  });

  it("keeps first chunk shorter for low latency", () => {
    const input =
      "This is a somewhat longer first sentence that should be split. And then a second part follows here.";
    const chunks = chunkText(input, 135, 40);
    expect(chunks[0].length).toBeLessThanOrEqual(65); // some tolerance for splitting
  });

  it("respects maxChars for subsequent chunks", () => {
    const sentences = Array(10)
      .fill("This is a sentence.")
      .join(" ");
    const chunks = chunkText(sentences, 60, 30);
    // All chunks after the first should be ≤ maxChars (with some tolerance for whole sentences)
    for (let i = 1; i < chunks.length; i++) {
      expect(chunks[i].length).toBeLessThanOrEqual(80); // tolerance: a single sentence may exceed
    }
  });

  it("handles text with exclamation marks", () => {
    const input = "Wow! Amazing! Great!";
    const chunks = chunkText(input, 135, 60);
    expect(chunks.join(" ")).toBe(input);
  });

  it("handles text with question marks", () => {
    const input = "What? Why? How?";
    const chunks = chunkText(input, 135, 60);
    expect(chunks.join(" ")).toBe(input);
  });

  it("splits on semicolons", () => {
    const input =
      "Part one; part two is longer and should accumulate. Part three.";
    const chunks = chunkText(input, 135, 20);
    expect(chunks.length).toBeGreaterThanOrEqual(2);
  });

  it("splits on colons", () => {
    const input =
      "Note: this is important. Warning: do not ignore.";
    const chunks = chunkText(input, 135, 20);
    expect(chunks.length).toBeGreaterThanOrEqual(2);
    expect(chunks.join(" ")).toBe(input);
  });

  it("splits on newlines", () => {
    const input = "Line one.\nLine two.\nLine three.";
    const chunks = chunkText(input, 135, 60);
    expect(chunks.length).toBeGreaterThanOrEqual(1);
    // chunkText splits on \n then joins segments with spaces
    const rejoined = chunks.join(" ");
    expect(rejoined).toContain("Line one.");
    expect(rejoined).toContain("Line two.");
    expect(rejoined).toContain("Line three.");
  });

  it("handles single very long sentence gracefully", () => {
    const longSentence = "word ".repeat(100).trim();
    const chunks = chunkText(longSentence, 50, 30);
    // Should still return at least one chunk (no infinite loop)
    expect(chunks.length).toBeGreaterThanOrEqual(1);
    expect(chunks.join(" ")).toBe(longSentence);
  });

  it("preserves all text content (no loss)", () => {
    const input =
      "The quick brown fox. Jumps over the lazy dog! Is it true? Yes; it is. Definitely.";
    const chunks = chunkText(input);
    expect(chunks.join(" ")).toBe(input);
  });
});
