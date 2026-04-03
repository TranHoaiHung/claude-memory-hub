<p align="center">
  <img src="assets/logo.png" alt="claude-memory-hub" width="400" />
</p>

<h1 align="center">claude-memory-hub</h1>

<p align="center">
  <strong>The missing memory layer for Claude Code.</strong>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/claude-memory-hub"><img src="https://img.shields.io/npm/v/claude-memory-hub.svg" alt="npm version" /></a>
  <a href="https://github.com/TranHoaiHung/claude-memory-hub/blob/main/LICENSE"><img src="https://img.shields.io/npm/l/claude-memory-hub.svg" alt="license" /></a>
</p>

Zero API key. Zero Python. Zero config. One install command. Privacy-first.

---

## Why memory-hub?

**Claude Code forgets everything.** Every session starts from zero. Auto-compact destroys 90% of your context. You lose files, decisions, errors — hours of work, gone.

**claude-memory-hub fixes this.** One install command. No API key. No Python. No Docker.

What makes it different? **The Compact Interceptor** — something no other memory tool has. When Claude Code auto-compacts at 200K tokens, memory-hub *tells the compact engine what matters*. PreCompact hook injects priority instructions. PostCompact hook saves the full summary. Result: 90% context salvage instead of vaporization.

But it doesn't stop there:
- **Full conversation capture** — every user prompt + assistant response saved via transcript parsing
- **Cross-session memory** — past work auto-injected when you start a new session
- **3-engine hybrid search** — FTS5 + TF-IDF + semantic embeddings with recency-aware ranking
- **Privacy-first** — `<private>` tags, auto secret detection, path-based filtering
- **Slash commands** — `/mem-search`, `/mem-status`, `/mem-save` built-in
- **Proactive retrieval** — detects topic shifts mid-session, injects relevant context automatically
- **100+ unit tests**, batch queue (75ms→3ms), JSONL export/import, browser UI
- **Multi-agent ready** — subagents share memory for free via MCP

Built for developers who use Claude Code daily and are tired of repeating themselves.

```bash
bunx claude-memory-hub install
```

That's it. Your Claude now remembers.

---

## The Problem

Claude Code forgets everything between sessions. Within long sessions, auto-compact destroys 90% of context. Search is keyword-only with no ranking.

```
Session 1: You spend 2 hours building auth system
Session 2: Claude has no idea what happened yesterday

Long session: Claude auto-compacts at 200K tokens
              → 180K tokens of context vaporized
              → Claude loses track of files, decisions, errors

Search:        Keyword-only, no semantic ranking
               → Irrelevant results, wasted tokens on full records
```

| Problem | Claude Code built-in | claude-mem | memory-hub |
|---------|:-------------------:|:----------:|:----------:|
| Cross-session memory | -- | Yes | **Yes** |
| Full conversation capture (user+assistant) | -- | -- | **Yes** |
| Conversation search (FTS5) | -- | -- | **Yes** |
| Privacy filtering (`<private>` tags + secret detection) | -- | Partial | **Yes** |
| Slash commands (`/mem-search`, `/mem-status`, `/mem-save`) | -- | Yes | **Yes** |
| Code-aware search (camelCase, snake_case, paths) | -- | -- | **Yes** |
| Recency-aware ranking (recent sessions boosted) | -- | -- | **Yes** |
| Influence what compact preserves | -- | -- | **Yes** |
| Save compact output to L3 | -- | -- | **Yes** |
| Hybrid search (FTS5 + TF-IDF + semantic) | -- | Partial | **Yes** |
| 3-layer progressive search | -- | Yes | **Yes** |
| Resource overhead analysis | -- | -- | **Yes** |
| CLAUDE.md rule tracking | -- | -- | **Yes** |
| Observation capture (20+ patterns) | -- | Yes | **Yes** |
| LLM summarization (3-tier) | -- | Yes (API) | **Yes (free)** |
| Token-budget-aware tools (`max_tokens`) | -- | -- | **Yes** |
| Proactive mid-session retrieval | -- | -- | **Yes** |
| Multi-agent memory sharing | -- | -- | **Yes (free)** |
| Permission-aware (approved only) | -- | -- | **Yes** |
| Data export/import (JSONL) | -- | -- | **Yes** |
| Smart budget allocation (priority-based) | -- | -- | **Yes** |
| Overhead warning (unused resources) | -- | -- | **Yes** |
| Hook batching (3ms vs 75ms) | -- | -- | **Yes** |
| Browser UI | -- | Yes | **Yes** |
| Health monitoring + auto-cleanup | -- | -- | **Yes** |
| Unit tests (100+) | N/A | -- | **Yes** |
| No API key / Python / Chroma | N/A | Partial | **Yes** |

---

## How It Works

### Layer 1 — Entity + Conversation Capture (every tool call + every prompt)

```
Claude reads a file     → memory-hub records: which file, code patterns found
Claude edits a file     → memory-hub records: what changed (old → new diff)
Claude runs a command   → memory-hub records: command, exit code, stderr
Claude makes a decision → memory-hub records: decision text + importance score
Claude spawns an agent  → memory-hub records: agent type, prompt, result summary
User sends a prompt     → memory-hub records: full prompt text to messages table
Session ends            → memory-hub parses transcript: ALL user + assistant messages
```

No XML. No special format. Extracted directly from hook JSON metadata.
PostToolUse events are batched via write-through queue (~3ms per event vs ~75ms direct).
Mid-session topic shifts auto-inject relevant past context (proactive retrieval).
Full conversation (user + assistant) captured from Claude Code's JSONL transcript at session end.

### Layer 2 — Compact Interceptor (the key innovation)

```
                    BEFORE compact runs
                           |
            +--------------+--------------+
            |                             |
     PreCompact hook               Claude Code's
     reads all entities            compact engine
     scores by importance          receives our output
     outputs priority list    -->  as Additional Instructions
            |                             |
            |                     compact now KNOWS
            |                     what to preserve
            |                             |
            |                    AFTER compact runs
            |                             |
            +-------- PostCompact hook ---+
                      receives FULL summary
                      saves to SQLite L3
                      zero information loss
```

**No other memory tool does this.** memory-hub is the only system that **tells the compact what matters**.

### Layer 3 — Cross-Session Memory

```
Session N ends  → Parse transcript: capture full conversation (user + assistant)
                → 3-tier summarization: PostCompact > CLI claude > rule-based
                → Summary enriched with conversation digest
                → Summary saved to SQLite L3 with FTS5 indexing

Session N+1     → UserPromptSubmit hook fires
                → FTS5 + TF-IDF + semantic search: match user prompt
                → Inject relevant past context automatically
                → Claude starts with history, not from zero
```

### Layer 4 — 3-Layer Progressive Search

```
Traditional search: query → ALL full records → 5000+ tokens wasted

memory-hub search:  query → Layer 1 (index)    → ~50 tokens/result
                          → Layer 2 (timeline)  → ~200 tokens context
                          → Layer 3 (full)      → ~500 tokens/result
                                                  only for filtered IDs

                    Token savings: ~80-90% vs. full context
```

Hybrid ranking: FTS5 BM25 (keyword) + TF-IDF (term frequency) + semantic cosine similarity (384-dim embeddings). Code-aware tokenizer splits camelCase, snake_case, and file paths into meaningful tokens. Recency decay boosts recent sessions (7d=1.5x, 30d=1.2x, >90d=0.8x). Multi-source boost rewards results found by 2+ engines. "debugging tips" matches "error fixing" even without shared keywords.

### Layer 5 — Resource Intelligence

```
ResourceRegistry scans ALL .claude locations:
  skills, agents, commands, workflows, CLAUDE.md chain
  → 3-level token estimation: listing, full, total

ResourceTracker records actual usage per session
OverheadReport identifies unused resources + token waste
```

> **Transparency note:** Claude Code loads ALL resources into its system prompt — no external tool can prevent this. memory-hub provides **analysis and prioritization**, not filtering. To reduce token overhead, remove or relocate unused skills/agents based on the overhead report.

### Layer 6 — Observation Capture

```
Tool output contains "IMPORTANT: always pool DB connections"
  → observation entity (importance=4) saved to L2

User prompt contains "remember that we use TypeScript strict"
  → observation entity (importance=3) saved to L2

20+ heuristic patterns:
  Tool output: IMPORTANT, CRITICAL, SECURITY, DEPRECATED, migration failed,
    decision:, discovered, root cause, switched to, refactored, installed,
    TODO:, FIXME:, performance:, bottleneck, tests pass/fail, deployed, etc.
  User prompt: IMPORTANT, MUST, remember that, don't/never/avoid,
    fix/debug/investigate, implement/build/create, prefer/always use, etc.
```

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
│  │                                                     │    │
│  │ L1 WorkingMemory: read-through cache over L2        │    │
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
                   │                    │
                   │   memory.db        │
                   │   batch/queue.jsonl│
                   │   logs/            │
                   └────────────────────┘
```

---

## Memory Hierarchy

```
┌─────────────────────────────────────────────────────┐
│  L1: WorkingMemory          Read-through cache      │
│  Lives in MCP server        <1ms (cache hit)        │
│  Backed by SessionStore     Auto-refresh on miss    │
│  TTL: 5 minutes             Max 50 entries/session  │
├─────────────────────────────────────────────────────┤
│  L2: SessionStore           SQLite                  │
│  Entities + notes           <10ms access            │
│  files, errors, decisions   Per-session scope       │
│  messages (user+assistant)  Importance scored 1-5   │
│  observations (20+ patterns)FTS5 on conversations   │
├─────────────────────────────────────────────────────┤
│  L3: LongTermStore          SQLite + FTS5 + TF-IDF  │
│  Cross-session summaries    <100ms access           │
│  Hybrid ranked search       Persistent forever      │
│  Semantic embeddings        3-layer progressive     │
└─────────────────────────────────────────────────────┘
```

---

## Privacy Protection

3-layer privacy system — sensitive data never reaches the database.

### Layer 1: `<private>` Tags

Wrap sensitive content in `<private>` tags — stripped before storage:

```
<private>API_KEY=sk-abc123def456</private>
→ stored as: [REDACTED]
```

### Layer 2: Auto Secret Detection

Built-in patterns catch common secrets automatically:

```
sk-proj-abc123...          → sk-proj-abc1[REDACTED]
Bearer eyJhbGci...         → Bearer eyJhb[REDACTED]
password: "hunter2"        → password: "h[REDACTED]
AKIAIOSFODNN7...           → AKIAIOSFODNN[REDACTED]
-----BEGIN PRIVATE KEY---- → [REDACTED]
```

Detected: API keys (`sk-`, `ghp_`, `gho_`, `AKIA`), Bearer tokens, passwords, private keys, hex/base64 secrets.

### Layer 3: Path Filtering

Sensitive files are completely excluded from entity tracking:

```
.env, .env.*, *.pem, *.key, *.p12
credentials.*, **/secrets/**, **/private/**
```

### Custom Configuration

Create `~/.claude-memory-hub/privacy.json` to extend:

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

## Slash Commands

Installed automatically with `bunx claude-memory-hub install`. Available as `/mem-*` in Claude Code.

| Command | What it does |
|---------|-------------|
| `/mem-search <query>` | 3-layer progressive search — finds past sessions by topic, file, or keyword |
| `/mem-status [project]` | Health check + token budget analysis + current session activity |
| `/mem-save <note>` | Save an important decision or finding to persistent memory |

```bash
# Examples
/mem-search auth login bug
/mem-status claude-memory-hub
/mem-save Decided to use JWT refresh tokens with 15min expiry
```

Commands are copied to `~/.claude/commands/` during install and removed on uninstall.

---

## Install

### From npm (recommended)

```bash
bunx claude-memory-hub install
```

One command. Registers MCP server + 5 hooks + 3 slash commands globally. Works on CLI, VS Code, JetBrains.

**Coming from claude-mem?** The installer auto-detects `~/.claude-mem/claude-mem.db` and migrates your data automatically.

### Update

```bash
bunx claude-memory-hub@latest install
```

Your data at `~/.claude-memory-hub/` is preserved across updates. Schema migrations run automatically.

### All CLI commands

```bash
bunx claude-memory-hub install     # Register MCP + hooks (auto-migrates claude-mem)
bunx claude-memory-hub uninstall   # Clean removal
bunx claude-memory-hub status      # Check installation
bunx claude-memory-hub migrate     # Import data from claude-mem
bunx claude-memory-hub viewer      # Open browser UI at localhost:37888
bunx claude-memory-hub health      # Run health diagnostics
bunx claude-memory-hub reindex     # Rebuild TF-IDF + embedding indexes
bunx claude-memory-hub export      # Export data as JSONL to stdout
bunx claude-memory-hub import      # Import JSONL from stdin (--dry-run)
bunx claude-memory-hub cleanup     # Remove old data (--days N, default 90)
bunx claude-memory-hub prune       # Remove low-quality summaries (--dry-run)
```

### Requirements

- [Bun](https://bun.sh) runtime
- Claude Code (CLI, VS Code, or JetBrains)
- **No API key needed**

---

## MCP Tools

Claude can call these tools directly during conversation:

### Core Tools

| Tool | What it does | When to use |
|------|-------------|-------------|
| `memory_recall` | FTS5 + semantic search past sessions (AUTO-USE) | Starting any task — proactively checks for prior work |
| `memory_entities` | Find all sessions that touched a file (AUTO-USE) | Before editing any file — understand its history |
| `memory_session_notes` | Current session activity (L1 cache) | Mid-session review of files, decisions, errors |
| `memory_store` | Save a note/decision to persistent memory | Architectural decisions, key findings, workarounds |
| `memory_context_budget` | Token overhead analysis + recommendations | When sessions feel slow or context seems bloated |

### 3-Layer Search

| Tool | Layer | Tokens/result | When to use |
|------|-------|---------------|-------------|
| `memory_search` | 1 (index) | ~50 | First: find relevant memories by query |
| `memory_timeline` | 2 (context) | ~200 | Then: see what happened before/after a result |
| `memory_fetch` | 3 (full) | ~500 | Finally: get complete records for specific IDs |

### Conversation

| Tool | What it does | When to use |
|------|-------------|-------------|
| `memory_conversation` | Retrieve or search conversation messages | Reviewing what was discussed in a past session |

### Diagnostics

| Tool | What it does |
|------|-------------|
| `memory_health` | Check database, FTS5, disk, embeddings, integrity status |

---

## Data Export/Import

### Export

```bash
# Full export
bunx claude-memory-hub export > backup.jsonl

# Incremental (since timestamp)
bunx claude-memory-hub export --since 1743580800000 > incremental.jsonl

# Single table
bunx claude-memory-hub export --table sessions > sessions.jsonl
```

### Import

```bash
# Import from file
bunx claude-memory-hub import < backup.jsonl

# Validate without writing
bunx claude-memory-hub import --dry-run < backup.jsonl
```

### Cleanup

```bash
# Remove data older than 90 days (default)
bunx claude-memory-hub cleanup

# Custom retention
bunx claude-memory-hub cleanup --days 30
```

Format: JSONL (one JSON object per line). Embedding BLOBs encoded as base64. Import uses UPSERT — safe to re-run.

---

## Browser UI

```bash
bunx claude-memory-hub viewer
```

Opens a dark-themed dashboard at `http://localhost:37888` with:

- **Stats** — session count, entity count, summary count
- **Search** — hybrid FTS5 + TF-IDF search with ranking scores
- **Browse** — paginated views of sessions, entities, summaries
- **Health** — real-time component health indicators

---

## Migrating from claude-mem

```bash
# Automatic (during install)
bunx claude-memory-hub install

# Manual
bunx claude-memory-hub migrate
```

| claude-mem | → | memory-hub |
|------------|---|------------|
| `sdk_sessions` | → | `sessions` |
| `observations` (files_read) | → | `entities` (type=file_read) |
| `observations` (files_modified) | → | `entities` (type=file_modified) |
| `observations` (title/narrative) | → | `entities` (type=decision) + `session_notes` |
| `session_summaries` | → | `long_term_summaries` (FTS5 indexed) |

Migration is idempotent — safe to run multiple times with zero duplicates.

---

## Version History

| Version | What it solved |
|---------|---------------|
| **v0.1.0** | Cross-session memory, entity tracking, FTS5 search |
| **v0.2.0** | Compact interceptor (PreCompact/PostCompact), context enrichment, importance scoring |
| **v0.3.0** | Removed API key requirement, 1-command install |
| **v0.4.0** | Resource usage tracking, token overhead analysis |
| **v0.5.0** | Production hardening, hybrid search, 3-layer progressive search, browser UI, health monitoring, claude-mem migration |
| **v0.6.0** | ResourceRegistry (170 resources), semantic search (384-dim embeddings), observation capture, CLAUDE.md tracking, 3-tier LLM summarization |
| **v0.7.0** | Honest resource analysis, semantic search scaling, batch embeddings, 14 observation patterns, DB auto-cleanup, summarizer retry |
| **v0.8.0** | 91 unit tests (was 0%), L1 read-through cache, PostToolUse batch queue (75ms→3ms), JSONL export/import, data cleanup CLI, CI/CD auto-publish |
| **v0.8.1** | Token-budget-aware MCP tools (`max_tokens`), proactive mid-session memory retrieval (topic-shift detection), session-end batch flush |
| **v0.9.0** | Smart budget allocation (priority-based, memory never pushed out), CLAUDE.md adaptive compression (3 levels), overhead warning auto-injection, doubled injection limits |
| **v0.9.5** | Stable install path — hooks no longer break after reboot or bunx cache cleanup |
| **v0.9.6** | Agent/Skill result capture, higher summary limits, IDE tag stripping, PostCompact cap, broader observation patterns (20+) |
| **v0.10.0** | **Full conversation capture** — all user prompts + assistant responses via transcript parsing, `messages` table with FTS5, `memory_conversation` MCP tool, conversation-enriched summaries |
| **v0.11.0** | **Privacy + Search + Commands** — 3-layer privacy filtering (`<private>` tags, auto secret detection, path filtering), code-aware tokenizer (camelCase/snake_case/path splitting), recency-aware ranking (7d/30d/90d decay), RRF multi-source fusion, slash commands (`/mem-search`, `/mem-status`, `/mem-save`), improved MCP tool descriptions with AUTO-USE hints |

See [CHANGELOG.md](CHANGELOG.md) for full details.

---

## Dependencies

```
@modelcontextprotocol/sdk          MCP stdio server (required)
bun:sqlite                         Built-in, zero install
@huggingface/transformers          Semantic search embeddings (optional)
```

**Two npm packages + one optional.** No Python. No Chroma. No HTTP server. No API key. No Docker.

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `CLAUDE_MEMORY_HUB_LLM` | `auto` | Summarization: auto, cli-only, rule-based |
| `CLAUDE_MEMORY_HUB_LLM_TIMEOUT_MS` | `30000` | CLI summarizer timeout |
| `CLAUDE_MEMORY_HUB_EMBEDDINGS` | `auto` | Embeddings: auto, disabled |
| `CLAUDE_MEMORY_HUB_BATCH` | `auto` | PostToolUse batching: auto, enabled, disabled |
| `CMH_LOG_LEVEL` | `info` | Log level: debug, info, warn, error |

---

## Data & Privacy

All data stored locally at `~/.claude-memory-hub/`. **Privacy-first by design.**

```
~/.claude-memory-hub/
  ├── memory.db           # SQLite database (all memory data)
  ├── privacy.json        # Privacy config (optional — custom patterns/paths)
  ├── batch/
  │   └── queue.jsonl     # PostToolUse batch queue (auto-flushed)
  ├── proactive/
  │   └── <session>.json  # Topic tracking state (auto-cleaned)
  └── logs/
      └── memory-hub.log  # Structured JSON logs (auto-rotated at 5MB)
```

**3-layer privacy protection** (see [Privacy Protection](#privacy-protection)):
- `<private>` tags stripped before storage
- API keys, tokens, passwords auto-detected and redacted
- Sensitive file paths (`.env`, `*.pem`, `*.key`) excluded from tracking

No cloud. No telemetry. No network calls. Your memory stays on your machine.

---

## Uninstall

```bash
bunx claude-memory-hub uninstall
# Data at ~/.claude-memory-hub/ preserved. Delete manually if desired:
rm -rf ~/.claude-memory-hub
```
