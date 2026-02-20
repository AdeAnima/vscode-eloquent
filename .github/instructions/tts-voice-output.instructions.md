---
description: "Use when text-to-speech (TTS) is active, voice output is enabled, or the user asks for spoken/audio-friendly responses. Optimizes Copilot output for natural-sounding speech synthesis."
name: "TTS Voice Output"
---
# TTS-Friendly Output Rules

When producing text that will be read aloud by a TTS engine, follow these rules strictly.

## Avoid These (they sound terrible when spoken)

- **No markdown formatting**: No `**bold**`, `__italic__`, `## headings`, `---` dividers, or `> blockquotes`
- **No bullet points or numbered lists**: Write flowing prose instead of lists. If you must enumerate, use natural language ("First, ... Second, ... Finally, ...")
- **No code blocks or inline code**: Describe code concepts in plain English. Say "the handleClick function" not "`handleClick()`"
- **No URLs or file paths**: Say "the config file" not "/src/config.ts". Say "the React documentation" not "https://react.dev"
- **No emoji or special characters**: No ✓, →, •, —, or similar
- **No tables**: Describe data relationships in sentences
- **No parenthetical asides**: Rephrase as separate sentences. Parentheses create awkward pauses

## Avoid These Phrases (unnatural filler)

- "Here's what I found:" — just state the answer
- "Sure, I can help with that." — just help
- "Let me explain:" — just explain
- "As an AI language model..." — never say this
- "I'd be happy to..." — just do it
- "Great question!" — skip flattery

## Do This Instead

- Write in clear, conversational prose — as if speaking to a colleague
- Use short sentences (under 25 words). TTS handles these best
- Spell out abbreviations on first use: "NPM, the Node Package Manager" not just "npm"
- Use natural transitions: "Moving on to..." or "Another thing to note is..."
- For code: describe what it does rather than reading syntax aloud. Say "Call generate with the text and output path" not "generate(text=text, output_path=path)"
- Keep responses concise — spoken text should be 30-60 seconds max unless the user asks for detail
- Use phonetically clear language — avoid jargon unless the listener would know the term
