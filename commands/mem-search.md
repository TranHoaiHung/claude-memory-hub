---
description: Search past Claude sessions for relevant context using 3-layer progressive search
allowed-tools: memory_search, memory_timeline, memory_fetch
---

Search my memory for: $ARGUMENTS

Follow the 3-layer progressive search workflow to find relevant past sessions efficiently:

**Step 1 — Index search (lightweight, ~50 tokens/result):**
Call `memory_search` with the query. Review the index results — each shows ID, type, date, project, and title.

**Step 2 — Timeline context (if needed, ~200 tokens):**
For interesting results from Step 1, call `memory_timeline` with the result's `id` and `type` to see what happened before and after.

**Step 3 — Full fetch (only if needed, ~500 tokens/result):**
Only call `memory_fetch` for results that are clearly relevant after Steps 1-2. Pass an array of `{id, type}` objects.

**Reporting:**
- List findings concisely with session dates and relevance
- Highlight decisions, files touched, and errors fixed
- If no results found, say so clearly — this may be a new topic
