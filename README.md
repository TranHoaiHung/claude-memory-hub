<p align="center">
  <img src="assets/logo.png" alt="claude-memory-hub" width="400" />
</p>

<h1 align="center">claude-memory-hub</h1>

<p align="center">
  <strong>Persistent memory for Claude Code. Survives compacts. Survives sessions.</strong>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/claude-memory-hub"><img src="https://img.shields.io/npm/v/claude-memory-hub.svg" alt="npm version" /></a>
  <a href="https://github.com/TranHoaiHung/claude-memory-hub/blob/main/LICENSE"><img src="https://img.shields.io/npm/l/claude-memory-hub.svg" alt="license" /></a>
</p>

```bash
bunx claude-memory-hub install
```

One command. Zero API key. Zero Python. Zero config. Done.

---

## The Problem

```
Session 1: You spend 2 hours building an auth system
Session 2: Claude has no idea it exists

Long session: Hit 200K tokens → auto-compact fires
              → ~90% of your context gone
              → files, decisions, error trails — vaporized
```

Every Claude Code user hits this wall. memory-hub exists to fix it.

---

## What You Get

### Compact Interceptor — the thing no other tool does

When auto-compact fires, your context doesn't just disappear anymore:

```
BEFORE compact
  → PreCompact hook scores all entities by importance
  → Injects priority list as Additional Instructions
  → Compact engine now KNOWS what to preserve

AFTER compact
  → PostCompact hook captures the FULL summary
  → Saves to SQLite L3
  → Zero information loss
```

**90% context loss → 90% context salvage.** This is the core innovation.

### Cross-Session Memory

Session ends → memory-hub parses the full transcript, summarizes, indexes.
Next session → past context auto-injected based on what you're working on.

No manual prompting. No copy-pasting. Claude just knows.

### Hybrid Search (3 engines)

FTS5 (keyword) + TF-IDF (term frequency) + semantic embeddings (384-dim, local).
Code-aware tokenizer: splits `camelCase`, `snake_case`, file paths into meaningful tokens.
Recency decay: recent sessions ranked higher (7d=1.5x, 30d=1.2x, >90d=0.8x).

### Full Conversation Capture

Every user prompt + every assistant response saved via transcript parsing.
Searchable with FTS5. Not just tool observations — the actual conversation.

### 3-Layer Privacy

```
Layer 1: <private> tags        → stripped before storage
Layer 2: Auto secret detection → sk-, ghp_, Bearer, passwords auto-redacted
Layer 3: Path filtering        → .env, *.pem, *.key excluded from tracking
```

47 dedicated tests. Custom config via `~/.claude-memory-hub/privacy.json`.

### Everything Else

- **Slash commands** — `/mem-search`, `/mem-status`, `/mem-save`
- **10 MCP tools** — progressive 3-layer search (50→200→500 tokens/result)
- **Proactive retrieval** — detects topic shifts, injects relevant context mid-session
- **Browser dashboard** — `bunx claude-memory-hub viewer` at localhost:37888
- **JSONL export/import** — full backup, incremental, per-table
- **Multi-agent ready** — subagents share memory via MCP
- **155 unit tests** — privacy, search, capture, schema, health

---

## Quick Start

```bash
# Install (registers MCP server + 5 hooks + 3 slash commands)
bunx claude-memory-hub install

# Verify
bunx claude-memory-hub status

# That's it. Start a Claude Code session — memory is active.
```

Works on CLI, VS Code, JetBrains. Coming from claude-mem? Data migrates automatically.

### Requirements

- [Bun](https://bun.sh) runtime
- Claude Code
- **No API key needed**

---

## Deep Dive: How Each Layer Works

### Layer 1 — Compact Interceptor (the core innovation)

The 200K threshold is where Claude Code's tool result budget gets cleared. When this happens, compaction fires — and everything not in the compressed summary is gone.

memory-hub intercepts this process at both ends:

```
BEFORE compact runs
       │
       ├── PreCompact hook fires
       │   1. Reads ALL entities from current session (files, errors, decisions, observations)
       │   2. Scores each by: importance (1-5) × recencyWeight
       │   3. Sorts by score, builds priority list
       │   4. Outputs as plain text → Claude Code appends to compact prompt
       │      as "Additional Instructions"
       │   Result: compact engine now KNOWS what to preserve
       │
AFTER compact runs
       │
       ├── PostCompact hook fires
       │   1. Receives FULL 9-section compact summary via stdin
       │   2. Parses sections: key_facts, open_tasks, current_state, etc.
       │   3. Saves directly to SQLite L3 (long_term_summaries table)
       │   4. FTS5 indexes the summary for future search
       │   Result: zero information loss — summary persists forever
```

**Why this matters:** Without PreCompact, the compact engine has no signal about what's important — it compresses blindly. Without PostCompact, the summary exists only in Claude's context and vanishes at session end. memory-hub closes both gaps.

### Layer 2 — Cross-Session Memory

```
Session N ends:
  1. Stop hook fires → parse Claude Code's JSONL transcript
     → extract ALL user prompts + assistant responses
     → save to messages table (FTS5 indexed)
  2. 3-tier summarization:
     Tier 1: Use PostCompact summary if available (best quality, free)
     Tier 2: Run `claude -p --print` subprocess (good quality, free)
     Tier 3: Rule-based template extraction (fallback, always works)
  3. Summary enriched with conversation digest
  4. Generate 384-dim embedding vector (if @huggingface/transformers available)
  5. Save to L3: long_term_summaries + fts_memories + tfidf_index + embeddings

Session N+1 starts:
  1. UserPromptSubmit hook fires with user's first prompt
  2. Hybrid search against L3:
     FTS5 BM25 (keyword match) + TF-IDF (term frequency) + semantic cosine
  3. Recency decay applied: <7d=1.5x boost, <30d=1.2x, >90d=0.8x penalty
  4. RRF (Reciprocal Rank Fusion) merges results from all engines
  5. Top results injected as additionalContext (max 8,000 chars)
  6. Smart budget allocation: memory > CLAUDE.md > advice > overhead
  Result: Claude starts with relevant history, not from zero
```

### Layer 3 — Entity + Conversation Capture

Every tool call triggers the PostToolUse hook. Entities are extracted from hook JSON metadata:

```
Claude reads a file     → file_read entity: path, code patterns, line count
Claude edits a file     → file_modified entity: path, old→new diff, change type
Claude runs a command   → command_run entity: command, exit code, stderr
Claude hits an error    → error entity: message, stack trace, file context
Claude makes a decision → decision entity: text, importance score (1-5)
Claude spawns an agent  → agent_result entity: agent type, prompt, summary
```

Events are batched via write-through queue (~3ms per event vs ~75ms direct write).
Mid-session topic shifts detected → proactive retrieval injects relevant past context.

**Observation capture** — 20+ heuristic patterns extract insights from tool output and user prompts:

```
Tool output patterns:
  IMPORTANT, CRITICAL, SECURITY, DEPRECATED, migration failed,
  decision:, discovered, root cause, switched to, refactored,
  TODO:, FIXME:, performance:, bottleneck, tests pass/fail, deployed

User prompt patterns:
  IMPORTANT, MUST, remember that, don't/never/avoid,
  fix/debug/investigate, implement/build/create, prefer/always use

Importance scoring: IMPORTANT/CRITICAL=4, decision:/NOTE:=3, TODO:/FIXME:=2
Max 1 observation per tool call, 300-char cap
```

### Layer 4 — 3-Layer Progressive Search

Instead of dumping full records on every query, memory-hub progressively discloses:

```
Traditional:  query → ALL full records → 5,000+ tokens wasted

memory-hub:   query → Layer 1 (index)    → ~50 tokens/result
                      titles, dates, scores — scan 20+ results cheaply

              pick  → Layer 2 (timeline)  → ~200 tokens
                      what happened before/after a specific result

              drill → Layer 3 (full)      → ~500 tokens/result
                      complete record for specific IDs only

Token savings: 80-90% vs. traditional full-context search
```

Hybrid ranking combines: FTS5 BM25 (exact keyword) + TF-IDF cosine (term frequency with code-aware tokenizer) + semantic cosine similarity (384-dim embeddings). Multi-source boost rewards results found by 2+ engines.

### Layer 5 — Resource Intelligence

```
ResourceRegistry scans ALL .claude locations:
  skills/, agents/, commands/, workflows/, CLAUDE.md chain
  → Discovers 170+ resources across user/project/system scopes
  → 3-level token estimation per resource:
    listing_tokens (~50-200): system prompt listing cost
    full_tokens (~200-8000): cost when invoked
    total_tokens: all files on disk

ResourceTracker records actual usage per session (8 resource types)
OverheadReport identifies unused resources + token waste
```

> **Transparency note:** Claude Code loads ALL resources into its system prompt — no external tool can prevent this. memory-hub provides **analysis and prioritization**, not filtering. To reduce token overhead, remove or relocate unused skills/agents based on the overhead report.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                      Claude Code                            │
│                                                             │
│  5 Lifecycle Hooks                                          │
│  ┌───────────────┐  ┌──────────────┐  ┌──────────────┐      │
│  │ PostToolUse   │  │ PreCompact   │  │ PostCompact  │      │
│  │ batch queue   │  │ inject       │  │ save summary │      │
│  └──────┬────────┘  │ priorities   │  └──────┬───────┘      │
│         │           └──────┬───────┘         │              │
│  ┌──────┴───────┐          │          ┌──────┴───────┐      │
│  │UserPrompt    │          │          │ Stop           │    │
│  │Submit: inject│          │          │ parse transcript│    │
│  │past context +│          │          │ capture convo  │    │
│  │save prompt   │          │          │ summarize      │    │
│  └──────────────┘          │          └────────────────┘    │
│                            │                                │
│  MCP Server (stdio, long-lived)                             │
│  ┌─────────────────────────────────────────────────────┐    │
│  │ memory_recall        memory_search  (L1 index)      │    │
│  │ memory_entities      memory_timeline (L2 context)   │    │
│  │ memory_session_notes memory_fetch   (L3 full)       │    │
│  │ memory_store         memory_context_budget          │    │
│  │ memory_conversation  memory_health                  │    │
│  └─────────────────────────────────────────────────────┘    │
│                                                             │
│  Resource Intelligence    Browser UI (:37888)               │
│  ┌──────────────────┐     ┌──────────────────┐              │
│  │ scan → track →   │     │ search, browse,  │              │
│  │ analyze overhead │     │ stats, health    │              │
│  └──────────────────┘     └──────────────────┘              │
└─────────────────────────────────────────────────────────────┘
                             │
                   ┌─────────┴──────────┐
                   │   SQLite + FTS5    │
                   │   ~/.claude-       │
                   │   memory-hub/      │
                   │   memory.db        │
                   └────────────────────┘
```

### Memory Hierarchy

```
┌─────────────────────────────────────────────────────┐
│  L1: WorkingMemory          Read-through cache      │
│  Lives in MCP server        <1ms (cache hit)        │
│  TTL: 5 minutes             Max 50 entries/session  │
├─────────────────────────────────────────────────────┤
│  L2: SessionStore           SQLite                  │
│  Entities + messages        <10ms access            │
│  files, errors, decisions   Importance scored 1-5   │
│  observations (20+ patterns)FTS5 on conversations   │
├─────────────────────────────────────────────────────┤
│  L3: LongTermStore          SQLite + FTS5 + TF-IDF  │
│  Cross-session summaries    <100ms access           │
│  Hybrid ranked search       Persistent forever      │
│  Semantic embeddings (384d) 3-layer progressive     │
└─────────────────────────────────────────────────────┘
```

---

## How Capture Works

```
Claude reads a file     → memory-hub records: which file, code patterns found
Claude edits a file     → memory-hub records: what changed (old → new diff)
Claude runs a command   → memory-hub records: command, exit code, stderr
Claude makes a decision → memory-hub records: decision text + importance score
Claude spawns an agent  → memory-hub records: agent type, prompt, result summary
User sends a prompt     → memory-hub records: full prompt text
Session ends            → memory-hub parses transcript: ALL user + assistant messages
```

Extracted from hook JSON metadata. No XML. No special format.
PostToolUse events batched via write-through queue (~3ms per event).
20+ heuristic patterns for observation capture (IMPORTANT, CRITICAL, decision:, root cause, etc.)

---

## Slash Commands

| Command | What it does |
|---------|-------------|
| `/mem-search <query>` | 3-layer progressive search — finds past sessions by topic, file, or keyword |
| `/mem-status [project]` | Health check + token budget analysis + current session activity |
| `/mem-save <note>` | Save an important decision or finding to persistent memory |

```bash
/mem-search auth login bug
/mem-save Decided to use JWT refresh tokens with 15min expiry
```

---

## MCP Tools

| Tool | What it does | Tokens |
|------|-------------|--------|
| `memory_recall` | FTS5 + semantic search past sessions (AUTO-USE) | varies |
| `memory_entities` | Find sessions that touched a file (AUTO-USE) | varies |
| `memory_session_notes` | Current session activity (L1 cache) | ~100 |
| `memory_store` | Save note/decision to persistent memory | ~50 |
| `memory_search` | Layer 1: index search | ~50/result |
| `memory_timeline` | Layer 2: context around a result | ~200 |
| `memory_fetch` | Layer 3: full record by ID | ~500/result |
| `memory_conversation` | Retrieve/search conversation messages | varies |
| `memory_context_budget` | Token overhead analysis | ~200 |
| `memory_health` | Database + FTS5 + disk + embeddings status | ~150 |

---

## CLI Reference

```bash
bunx claude-memory-hub install     # Register MCP + hooks + slash commands
bunx claude-memory-hub uninstall   # Clean removal
bunx claude-memory-hub status      # Check installation
bunx claude-memory-hub migrate     # Import data from claude-mem
bunx claude-memory-hub viewer      # Browser UI at localhost:37888
bunx claude-memory-hub health      # Run health diagnostics
bunx claude-memory-hub reindex     # Rebuild TF-IDF + embedding indexes
bunx claude-memory-hub export      # Export data as JSONL to stdout
bunx claude-memory-hub import      # Import JSONL from stdin (--dry-run)
bunx claude-memory-hub cleanup     # Remove old data (--days N, default 90)
bunx claude-memory-hub prune       # Remove low-quality summaries (--dry-run)
```

---

## Privacy Configuration

Create `~/.claude-memory-hub/privacy.json` to extend defaults:

```json
{
  "tag_stripping": true,
  "auto_detect_secrets": true,
  "ignored_paths": ["my-secrets.yaml", "**/vault/**"],
  "custom_patterns": ["INTERNAL_TOKEN_[A-Z0-9]{20,}"]
}
```

Custom paths and patterns are **added** to defaults, not replacing them.

---

## Data Export/Import

```bash
# Full export
bunx claude-memory-hub export > backup.jsonl

# Incremental
bunx claude-memory-hub export --since 1743580800000 > incremental.jsonl

# Import (idempotent, UPSERT)
bunx claude-memory-hub import < backup.jsonl

# Validate first
bunx claude-memory-hub import --dry-run < backup.jsonl
```

---

## Data & Privacy

All data stored locally at `~/.claude-memory-hub/`. No cloud. No telemetry. No network calls.

```
~/.claude-memory-hub/
  ├── memory.db           # SQLite database
  ├── privacy.json        # Custom privacy rules (optional)
  ├── batch/queue.jsonl   # PostToolUse batch queue (auto-flushed)
  └── logs/memory-hub.log # Structured JSON logs (auto-rotated 5MB)
```

---

## Dependencies

```
@modelcontextprotocol/sdk          MCP stdio server (required)
bun:sqlite                         Built-in, zero install
@huggingface/transformers          Semantic embeddings (optional)
```

Two npm packages + one optional. No Python. No Chroma. No Docker. No API key.

---

## Migrating from claude-mem

```bash
bunx claude-memory-hub install   # auto-detects and migrates
```

| claude-mem | → | memory-hub |
|------------|---|------------|
| `sdk_sessions` | → | `sessions` |
| `observations` (files) | → | `entities` (file_read/file_modified) |
| `observations` (narrative) | → | `entities` (decision) + `session_notes` |
| `session_summaries` | → | `long_term_summaries` (FTS5 indexed) |

Idempotent — safe to run multiple times.

---

## Version History

| Version | Highlight |
|---------|-----------|
| **v0.11.4** | Search quality — pruned garbage summaries, guided Claude to use specific keywords instead of generic phrases |
| **v0.11.3** | MCP registration fix — installer now writes to `~/.claude.json` (correct config), troubleshooting guide |
| **v0.11.2** | **Critical fix** — context injection null crash, slash commands install fallback, null-safe budget |
| **v0.11.1** | Quality hardening — clock skew guard, 155 unit tests (+44%) |
| **v0.11.0** | 3-layer privacy, code-aware search, recency ranking, slash commands |
| **v0.10.0** | Full conversation capture (user + assistant), `memory_conversation` tool |
| **v0.9.x** | Smart budget allocation, stable install paths, agent/skill capture |
| **v0.8.x** | 91 unit tests, L1 cache, batch queue (75ms→3ms), export/import |
| **v0.7.0** | Semantic search scaling, 14 observation patterns, auto-cleanup |
| **v0.6.0** | ResourceRegistry, semantic embeddings, CLAUDE.md tracking |
| **v0.5.0** | Hybrid search, browser UI, health monitoring, claude-mem migration |
| **v0.2.0** | Compact Interceptor (PreCompact/PostCompact) |
| **v0.1.0** | Cross-session memory, entity tracking, FTS5 search |

See [CHANGELOG.md](CHANGELOG.md) for full details.

---

## Troubleshooting

### MCP server not connecting (most common issue)

Claude Code stores MCP config in **`~/.claude.json`** (not `~/.claude/settings.json`). If memory tools aren't available after install:

**1. Check MCP status:**
```bash
claude mcp list
```

If `claude-memory-hub` shows `✗ Failed to connect` or is missing:

**2. Register directly via Claude CLI:**
```bash
claude mcp add claude-memory-hub -s user -- bun run ~/.claude-memory-hub/dist/index.js
```

**3. If CLI fails** (e.g., hook blocking `dist/` paths), edit `~/.claude.json` manually. Find the top-level `"mcpServers"` object and add:
```json
"claude-memory-hub": {
  "type": "stdio",
  "command": "/path/to/bun",
  "args": ["run", "/Users/YOU/.claude-memory-hub/dist/index.js"]
}
```

**4. Restart Claude Code** — MCP servers only load at startup.

### How to verify it works

After restart, check if memory tools appear:
- Type `/mem-status` — should run health check
- Or ask: *"Search my memory for recent sessions"* — Claude should call `memory_search`

If Claude reads `MEMORY.md` instead of calling MCP tools, the MCP server is not connected.

### Common issues

| Symptom | Cause | Fix |
|---------|-------|-----|
| "No memories found" on new session | MCP server not registered in `~/.claude.json` | Run `claude mcp add` (see above) |
| `bunx` install shows old version | bunx cache | `bunx claude-memory-hub@latest install` |
| Hooks registered but no context injected | Dist files outdated in `~/.claude-memory-hub/dist/` | Re-run install to copy latest dist |
| Memory tools not in tool list | MCP server failed to start | Check `claude mcp list` for connection status |

### Config file locations

| File | What it stores |
|------|---------------|
| `~/.claude.json` | MCP server registrations (user-level) — **Claude Code reads this** |
| `~/.claude/settings.json` | Hooks registration + fallback MCP config |
| `~/.claude-memory-hub/memory.db` | All memory data (sessions, entities, summaries) |
| `~/.claude-memory-hub/dist/` | Compiled hook + MCP server scripts |
| `~/.claude/commands/` | Slash commands (`/mem-search`, `/mem-status`, `/mem-save`) |

---

## Uninstall

```bash
bunx claude-memory-hub uninstall
rm -rf ~/.claude-memory-hub    # optional: remove data
```

---

<p align="center">
  Built for developers who use Claude Code daily and are tired of starting from zero.
</p>
