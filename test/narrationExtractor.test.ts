import { describe, it, expect } from "vitest";
import { extractNarration, hasIncompleteNarration } from "../src/narrationExtractor";

describe("extractNarration", () => {
  it("returns empty string when no <speak> tags present", () => {
    expect(extractNarration("Hello world, no tags here.")).toBe("");
  });

  it("extracts content from a single <speak> block", () => {
    const text = "Some code here.\n<speak>I updated the function.</speak>\nMore stuff.";
    expect(extractNarration(text)).toBe("I updated the function.");
  });

  it("extracts content from multiple <speak> blocks", () => {
    const text = [
      "```python\ndef foo(): pass\n```",
      "<speak>I created a foo function.</speak>",
      "Then I refactored the bar module.",
      "<speak>I also refactored bar to use async.</speak>",
    ].join("\n");
    expect(extractNarration(text)).toBe(
      "I created a foo function.\n\nI also refactored bar to use async."
    );
  });

  it("handles multiline content inside <speak> tags", () => {
    const text = "<speak>First sentence.\nSecond sentence on a new line.</speak>";
    expect(extractNarration(text)).toBe(
      "First sentence.\nSecond sentence on a new line."
    );
  });

  it("ignores incomplete <speak> blocks (no closing tag)", () => {
    const text = "Some text <speak>This is not closed yet";
    expect(extractNarration(text)).toBe("");
  });

  it("is case-insensitive for tags", () => {
    const text = "<SPEAK>Uppercase tags work.</SPEAK>";
    expect(extractNarration(text)).toBe("Uppercase tags work.");
  });

  it("skips empty <speak> blocks", () => {
    const text = "<speak>  </speak><speak>Real content.</speak>";
    expect(extractNarration(text)).toBe("Real content.");
  });

  it("handles <speak> blocks adjacent to code blocks", () => {
    const text = "```js\nconsole.log('hi');\n```\n<speak>I added a console log.</speak>";
    expect(extractNarration(text)).toBe("I added a console log.");
  });

  it("returns empty string for empty input", () => {
    expect(extractNarration("")).toBe("");
  });

  it("handles tags split across lines", () => {
    const text = "<speak>\nHello there.\n</speak>";
    expect(extractNarration(text)).toBe("Hello there.");
  });
});

describe("hasIncompleteNarration", () => {
  it("returns false when no tags present", () => {
    expect(hasIncompleteNarration("No tags here")).toBe(false);
  });

  it("returns false when all tags are closed", () => {
    expect(hasIncompleteNarration("<speak>Done.</speak>")).toBe(false);
  });

  it("returns true when an open tag has no close", () => {
    expect(hasIncompleteNarration("text <speak>still typing...")).toBe(true);
  });

  it("returns true when opens exceed closes", () => {
    const text = "<speak>First.</speak> <speak>Second still going";
    expect(hasIncompleteNarration(text)).toBe(true);
  });

  it("returns false when opens equal closes", () => {
    const text = "<speak>A.</speak><speak>B.</speak>";
    expect(hasIncompleteNarration(text)).toBe(false);
  });

  it("is case-insensitive", () => {
    expect(hasIncompleteNarration("<SPEAK>still going")).toBe(true);
    expect(hasIncompleteNarration("<Speak>done.</Speak>")).toBe(false);
  });
});
