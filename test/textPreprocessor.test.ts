import { describe, it, expect } from "vitest";
import { preprocessForSpeech } from "../src/textPreprocessor";

describe("preprocessForSpeech", () => {
  // --- Headings ---
  describe("headings", () => {
    it("converts heading to text with period", () => {
      expect(preprocessForSpeech("# Hello World")).toBe("Hello World.");
    });

    it("handles h2–h6", () => {
      expect(preprocessForSpeech("## Sub Heading")).toBe("Sub Heading.");
      expect(preprocessForSpeech("###### Deep")).toBe("Deep.");
    });
  });

  // --- Inline formatting ---
  describe("inline formatting", () => {
    it("strips bold", () => {
      expect(preprocessForSpeech("This is **bold** text")).toBe(
        "This is bold text"
      );
      expect(preprocessForSpeech("This is __bold__ text")).toBe(
        "This is bold text"
      );
    });

    it("strips italic", () => {
      expect(preprocessForSpeech("This is *italic* text")).toBe(
        "This is italic text"
      );
      expect(preprocessForSpeech("This is _italic_ text")).toBe(
        "This is italic text"
      );
    });

    it("strips bold+italic", () => {
      expect(preprocessForSpeech("***bold italic***")).toBe("bold italic");
    });

    it("strips strikethrough", () => {
      expect(preprocessForSpeech("~~deleted~~")).toBe("deleted");
    });

    it("preserves mid-word underscores (snake_case)", () => {
      expect(preprocessForSpeech("my_variable_name")).toBe(
        "my_variable_name"
      );
    });

    it("strips inline code backticks", () => {
      expect(preprocessForSpeech("Use `npm install` to install")).toBe(
        "Use npm install to install"
      );
    });
  });

  // --- Links & images ---
  describe("links and images", () => {
    it("extracts link text, drops URL", () => {
      expect(preprocessForSpeech("[Click here](https://example.com)")).toBe(
        "Click here"
      );
    });

    it("converts image with alt text", () => {
      expect(preprocessForSpeech("![Logo](./logo.png)")).toBe("Image: Logo.");
    });

    it("removes image with no alt text", () => {
      expect(preprocessForSpeech("![](./logo.png)")).toBe("");
    });

    it("strips reference-style links", () => {
      expect(preprocessForSpeech("[text][ref]")).toBe("text");
    });

    it("removes link definitions", () => {
      expect(preprocessForSpeech("[ref]: https://example.com Title")).toBe("");
    });
  });

  // --- Code blocks ---
  describe("code blocks", () => {
    it("converts short code block with language", () => {
      const input = "```python\nprint('hello')\n```";
      expect(preprocessForSpeech(input)).toBe(
        "python code example: print('hello')"
      );
    });

    it("converts short code block without language", () => {
      const input = "```\nfoo()\n```";
      expect(preprocessForSpeech(input)).toBe("Code example: foo()");
    });

    it("omits long code blocks (>6 lines)", () => {
      const lines = Array(8).fill("x = 1").join("\n");
      const input = "```js\n" + lines + "\n```";
      expect(preprocessForSpeech(input)).toBe("js code block omitted.");
    });

    it("removes empty code blocks", () => {
      expect(preprocessForSpeech("```\n\n```")).toBe("");
    });
  });

  // --- Lists ---
  describe("lists", () => {
    it("strips unordered list markers (-, *, +)", () => {
      expect(preprocessForSpeech("- Item one\n* Item two\n+ Item three")).toBe(
        "Item one\nItem two\nItem three"
      );
    });

    it("strips ordered list markers", () => {
      expect(preprocessForSpeech("1. First\n2. Second")).toBe(
        "First\nSecond"
      );
    });

    it("strips task list checkboxes", () => {
      expect(preprocessForSpeech("- [x] Done\n- [ ] Todo")).toBe(
        "Done\nTodo"
      );
    });
  });

  // --- Blockquotes ---
  describe("blockquotes", () => {
    it("removes blockquote markers", () => {
      expect(preprocessForSpeech("> This is quoted")).toBe("This is quoted");
    });

    it("handles nested blockquotes", () => {
      expect(preprocessForSpeech("> > Nested")).toBe("Nested");
    });
  });

  // --- Horizontal rules ---
  describe("horizontal rules", () => {
    it("removes ---", () => {
      expect(preprocessForSpeech("Above\n\n---\n\nBelow")).toBe(
        "Above\n\nBelow"
      );
    });

    it("removes ***", () => {
      expect(preprocessForSpeech("***")).toBe("");
    });
  });

  // --- HTML ---
  describe("HTML", () => {
    it("strips HTML tags", () => {
      expect(preprocessForSpeech("<b>bold</b>")).toBe("bold");
    });

    it("converts HTML entities", () => {
      expect(preprocessForSpeech("A &amp; B")).toBe("A and B");
      expect(preprocessForSpeech("&lt;div&gt;")).toBe("less than div greater than");
    });
  });

  // --- URLs ---
  describe("bare URLs", () => {
    it("replaces bare URLs with 'link'", () => {
      expect(preprocessForSpeech("Visit https://example.com/path for info")).toBe(
        "Visit link for info"
      );
    });
  });

  // --- Tables ---
  describe("tables", () => {
    it("converts a table to spoken prose", () => {
      const input = [
        "| Name | Age |",
        "| --- | --- |",
        "| Alice | 30 |",
        "| Bob | 25 |",
      ].join("\n");

      expect(preprocessForSpeech(input)).toBe(
        "Name: Alice, Age: 30. Name: Bob, Age: 25."
      );
    });

    it("handles header-only tables", () => {
      const input = "| Col A | Col B |\n| --- | --- |\n";
      expect(preprocessForSpeech(input)).toBe("Col A, Col B.");
    });
  });

  // --- Whitespace ---
  describe("whitespace normalization", () => {
    it("collapses multiple blank lines", () => {
      expect(preprocessForSpeech("A\n\n\n\n\nB")).toBe("A\n\nB");
    });

    it("collapses multiple spaces", () => {
      expect(preprocessForSpeech("too   many  spaces")).toBe(
        "too many spaces"
      );
    });

    it("trims lines", () => {
      expect(preprocessForSpeech("  hello  \n  world  ")).toBe(
        "hello\nworld"
      );
    });
  });

  // --- Combined / real-world ---
  describe("real-world markdown", () => {
    it("processes a mixed markdown snippet", () => {
      const input = [
        "# Getting Started",
        "",
        "Install the extension with **one click**:",
        "",
        "```bash",
        "npm install eloquent",
        "```",
        "",
        "Then visit [the docs](https://docs.example.com) for details.",
      ].join("\n");

      const result = preprocessForSpeech(input);
      expect(result).toContain("Getting Started.");
      expect(result).toContain("one click");
      expect(result).not.toContain("**");
      expect(result).toContain("bash code example: npm install eloquent");
      expect(result).toContain("the docs");
      expect(result).not.toContain("https://");
    });
  });
});
