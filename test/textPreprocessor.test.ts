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
      expect(preprocessForSpeech("Use `forEach` to iterate")).toBe(
        "Use forEach to iterate"
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

    it("handles single-row table", () => {
      const input = [
        "| Key | Value |",
        "| --- | --- |",
        "| foo | bar |",
      ].join("\n");
      expect(preprocessForSpeech(input)).toBe("Key: foo, Value: bar.");
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
      expect(result).toContain("bash code example:");
      expect(result).toContain("the docs");
      expect(result).not.toContain("https://");
    });
  });

  // --- Special characters ---
  describe("special characters", () => {
    it("replaces arrows with words", () => {
      expect(preprocessForSpeech("A → B")).toBe("A to B");
      expect(preprocessForSpeech("A ← B")).toBe("A from B");
      expect(preprocessForSpeech("A ↔ B")).toBe("A between B");
    });

    it("replaces em dash and en dash with comma", () => {
      expect(preprocessForSpeech("foo — bar")).toBe("foo , bar");
      expect(preprocessForSpeech("foo – bar")).toBe("foo , bar");
    });

    it("removes bullet character", () => {
      expect(preprocessForSpeech("• first item")).toBe("first item");
    });

    it("replaces checkmarks and crosses", () => {
      expect(preprocessForSpeech("✓ Done")).toBe("yes Done");
      expect(preprocessForSpeech("✗ Failed")).toBe("no Failed");
      expect(preprocessForSpeech("❌ Error")).toBe("no Error");
    });

    it("replaces warning and info emoji", () => {
      expect(preprocessForSpeech("⚠️ careful")).toBe("warning: careful");
      expect(preprocessForSpeech("ℹ️ note")).toBe("note: note");
    });

    it("strips common emoji", () => {
      expect(preprocessForSpeech("Great job! 🎉🚀")).toBe("Great job!");
      expect(preprocessForSpeech("Hello 👋 world")).toBe("Hello world");
    });
  });

  // --- Abbreviation expansion ---
  describe("abbreviation expansion", () => {
    it("expands npm on first use", () => {
      const result = preprocessForSpeech("Use npm to install packages.");
      expect(result).toContain("NPM, the Node Package Manager,");
    });

    it("expands only on first occurrence", () => {
      const result = preprocessForSpeech("Use npm to install. Then run npm start.");
      // First occurrence expanded, second stays as-is
      expect(result).toContain("NPM, the Node Package Manager,");
      expect(result).toMatch(/npm start/);
    });

    it("expands API", () => {
      expect(preprocessForSpeech("the api is ready")).toContain("A P I");
    });

    it("expands URL", () => {
      expect(preprocessForSpeech("enter the url here")).toContain("U R L");
    });

    it("does not expand within words", () => {
      // "dev" should not be expanded inside "developer"
      expect(preprocessForSpeech("developer tools")).toBe("developer tools");
    });

    it("expands vscode to VS Code", () => {
      expect(preprocessForSpeech("open vscode")).toContain("VS Code");
    });

    it("is case-insensitive", () => {
      expect(preprocessForSpeech("the CLI tool")).toContain("C L I");
      expect(preprocessForSpeech("the cli tool")).toContain("C L I");
    });

    it("expands TTS", () => {
      expect(preprocessForSpeech("enable tts output")).toContain("T T S");
    });
  });

  // --- Integration: full markdown → speech pipeline ---
  describe("integration: realistic markdown to speech", () => {
    it("processes Copilot-style response with code, links, and formatting", () => {
      const markdown = [
        "## Getting Started",
        "",
        "First, install the **npm** package:",
        "",
        "```bash",
        "npm install kokoro-js",
        "```",
        "",
        "Then check the [API docs](https://example.com/docs) for details.",
        "",
        "| Feature | Status |",
        "| ------- | ------ |",
        "| TTS     | ✓      |",
        "| SSR     | ✗      |",
      ].join("\n");

      const result = preprocessForSpeech(markdown);

      // Heading gets period
      expect(result).toContain("Getting Started.");
      // Bold stripped, npm expanded on first use
      expect(result).toContain("NPM, the Node Package Manager,");
      // Code block rendered as prose
      expect(result).toContain("bash code example:");
      // Link text preserved, URL removed
      expect(result).toContain("A P I");
      expect(result).toContain("docs");
      expect(result).not.toContain("https://");
      // Table converted to spoken form
      expect(result).toContain("Feature: T T S");
      expect(result).toContain("Status: yes");
      // Emoji replaced
      expect(result).not.toContain("✓");
      expect(result).not.toContain("✗");
    });

    it("handles emoji-heavy LLM output with arrows and special chars", () => {
      const text = "Step 1 → Install deps. Step 2 → Run tests. ⚠️ Don't forget!";
      const result = preprocessForSpeech(text);

      expect(result).toContain("to Install");
      expect(result).toContain("to Run");
      expect(result).toContain("warning:");
      expect(result).not.toContain("→");
      expect(result).not.toContain("⚠");
    });

    it("abbreviations expand only on first occurrence", () => {
      const text = "The api uses url paths. Check the api url.";
      const result = preprocessForSpeech(text);

      // First occurrence expanded
      expect(result).toContain("A P I");
      expect(result).toContain("U R L");
      // Count: "A P I" should appear once (first), then literal "api" second time
      const apiExpansions = result.split("A P I").length - 1;
      expect(apiExpansions).toBe(1);
    });
  });
});
