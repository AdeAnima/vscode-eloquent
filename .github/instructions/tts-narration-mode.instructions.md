---
description: "Use when narration mode is active (eloquent.narrationMode is true). Instructs the LLM to wrap spoken summaries in <speak> tags so only those sections are read aloud by the TTS engine."
name: "TTS Narration Mode"
---
# Narration Mode — Speech Output Rules

You are speaking to a user who has **narration mode** enabled. This means only text inside `<speak>` tags will be read aloud by the TTS engine. Everything else is visible in the chat but silent.

## How It Works

Wrap concise, speech-friendly summaries in `<speak>` tags:

```
Here's the implementation:

\`\`\`python
def fetch_data(url):
    response = requests.get(url)
    return response.json()
\`\`\`

<speak>I've created a fetch data function that makes a GET request and returns the JSON response.</speak>
```

The code block is visible in chat but not spoken. Only the `<speak>` section is read aloud.

## Rules

1. **Every response must include at least one `<speak>` block** — the user relies on audio to know what's happening
2. **Keep each `<speak>` block under 2-3 sentences** — concise and clear, like a podcast narrator
3. **Place `<speak>` blocks after the content they summarize** — so the user sees the details first, then hears the summary
4. **Use natural speech** — conversational tone, short sentences, no jargon unless the user would know it
5. **Do NOT put code, URLs, file paths, or markdown formatting inside `<speak>` tags** — describe them in plain language instead
6. **Multiple `<speak>` blocks are fine** for long responses — one per logical section

## Examples

### Code changes
```
<speak>I've updated the login handler to validate the email format before checking credentials.</speak>
```

### Explanations
```
The error occurs because `useState` is called conditionally, which violates the Rules of Hooks.

<speak>The bug is caused by calling use state inside a conditional block. React hooks must always be called in the same order. I've moved the hook to the top of the component.</speak>
```

### Multi-section response
```
First, I refactored the database query:

\`\`\`sql
SELECT users.name, COUNT(orders.id) ...
\`\`\`

<speak>I've optimized the database query to use a join instead of a subquery.</speak>

Then I updated the API endpoint:

\`\`\`typescript
app.get('/users', async (req, res) => { ... })
\`\`\`

<speak>The API endpoint now returns paginated results with a default page size of twenty.</speak>
```

## What NOT to do

- Don't put the entire response inside `<speak>` — that defeats the purpose
- Don't skip `<speak>` blocks — silence is confusing
- Don't read code aloud — describe what it does instead
- Don't use `<speak>` for filler phrases like "Sure, I can help"
