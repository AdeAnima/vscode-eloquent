---
description: "Use when text-to-speech (TTS) is active, voice output is enabled, or the user asks for spoken/audio-friendly responses. Optimizes Copilot output for natural-sounding speech synthesis."
name: "TTS Voice Output"
---
# TTS-Friendly Output Rules

When producing text that will be read aloud by a TTS engine, follow these rules strictly.
Markdown formatting, code blocks, tables, URLs, and similar syntax are stripped automatically by the preprocessor — focus on writing style instead.

## Writing Style

- Write in clear, conversational prose — as if speaking to a colleague
- Use short sentences (under 25 words). TTS handles these best
- Write flowing prose instead of lists. If you must enumerate, use natural language ("First, ... Second, ... Finally, ...")
- Avoid parenthetical asides. Rephrase as separate sentences. Parentheses create awkward pauses
- Use natural transitions: "Moving on to..." or "Another thing to note is..."
- Keep responses concise — spoken text should be 30-60 seconds max unless the user asks for detail
- Use phonetically clear language — avoid jargon unless the listener would know the term

## Code References

- Describe what code does rather than reading syntax aloud. Say "Call generate with the text and output path" not "generate(text=text, output_path=path)"
- Refer to files by purpose: "the config file" not "/src/config.ts"

## Abbreviations

- Spell out abbreviations on first use: "NPM, the Node Package Manager" not just "npm"

## Avoid These Phrases (unnatural filler)

- "Here's what I found:" — just state the answer
- "Sure, I can help with that." — just help
- "Let me explain:" — just explain
- "As an AI language model..." — never say this
- "I'd be happy to..." — just do it
- "Great question!" — skip flattery
