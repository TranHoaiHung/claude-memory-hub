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

Zero API key. Zero Python. Zero config. One install command.

---

## The Problem

Claude Code forgets everything between sessions. Within long sessions, auto-compact destroys 90% of context. Every session wastes tokens loading resources that aren't needed. Search is keyword-only with no ranking.

```
Session 1: You spend 2 hours building auth system
Session 2: Claude has no idea what happened yesterday

Long session: Claude auto-compacts at 200K tokens
              → 180K tokens of context vaporized
              → Claude loses track of files, decisions, errors

Every session: ALL skills + agents + rules loaded
               → 23-51K tokens consumed before you type anything
               → Most of them never used

Search:        Keyword-only, no semantic ranking
               → Irrelevant results, wasted tokens on full records
```

**Four problems. No existing tool solves all of them.**

| Problem | Claude Code built-in | claude-mem | memory-hub |
|---------|:-------------------:|:----------:|:----------:|
| Cross-session memory | -- | Yes | **Yes** |
| Influence what compact preserves | -- | -- | **Yes** |
| Save compact output | -- | -- | **Yes** |
| Token budget optimization | -- | -- | **Yes** |
| Semantic search (embeddings) | -- | Chroma (external) | **Yes (offline)** |
| Hybrid search (FTS5 + TF-IDF + semantic) | -- | Partial | **Yes** |
| 3-layer progressive search | -- | Yes | **Yes** |
| Resource overhead analysis | -- | -- | **Yes** |
| CLAUDE.md rule tracking | -- | -- | **Yes** |
| Free-form observation capture | -- | Yes | **Yes** |
| LLM summarization (3-tier) | -- | Yes (API) | **Yes (free)** |
| Browser UI | -- | Yes | **Yes** |
| Health monitoring | -- | -- | **Yes** |
| Migrate from claude-mem | N/A | N/A | **Yes** |
| No API key needed | N/A | Yes | **Yes** |
| No Python/Chroma needed | N/A | -- | **Yes** |
| No XML format required | N/A | -- | **Yes** |
| No HTTP server to manage | N/A | -- | **Yes** |

---

## How It Works

### Layer 1 — Entity Capture (every tool call)

```
Claude reads a file     → memory-hub records: which file, code patterns found
Claude edits a file     → memory-hub records: what changed (old → new diff)
Claude runs a command   → memory-hub records: command, exit code, stderr
Claude makes a decision → memory-hub records: decision text + importance score
```

No XML. No special format. Extracted directly from hook JSON metadata.

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

**This is something no other memory tool does.** claude-mem never sees the compact. Built-in session memory is supplementary, not directive. memory-hub is the only system that **tells the compact what matters**.

### Layer 3 — Cross-Session Memory

```
Session N ends  → rule-based summary from entities → SQLite L3
                  OR PostCompact summary (richer) → SQLite L3

Session N+1     → UserPromptSubmit hook fires
                → FTS5 + TF-IDF hybrid search: match user prompt
                → inject relevant context automatically
                → Claude starts with history, not from zero
```

### Layer 4 — Smart Resource Loading

```
                 Typical Claude Code session

    BEFORE memory-hub          AFTER memory-hub
    ┌──────────────────┐        ┌──────────────────┐
    │ System prompt 8K │        │ System prompt 8K │
    │ ALL skills  10K  │        │ Used skills  3K  │
    │ ALL agents   5K  │        │ Used agents  1K  │
    │ ALL rules   15K  │        │ Key rules    5K  │
    │ ALL memory   5K  │        │ Relevant mem 2K  │
    ├──────────────────┤        ├──────────────────┤
    │ OVERHEAD:  ~43K  │        │ OVERHEAD:  ~19K  │
    │                  │        │ SAVED:     ~24K  │
    └──────────────────┘        └──────────────────┘
```

memory-hub tracks which skills/agents/tools you **actually use**, then recommends only those for future sessions. Rare resources load on demand via SkillTool.

### Layer 5 — 3-Layer Progressive Search + Semantic (new in v0.5/v0.6)

```
Traditional search: query → ALL full records → 5000+ tokens wasted

memory-hub search:  query → Layer 1 (index)    → ~50 tokens/result
                          → Layer 2 (timeline)  → ~200 tokens context
                          → Layer 3 (full)      → ~500 tokens/result
                                                  only for filtered IDs

                    Token savings: ~80-90% vs. full context
```

Hybrid ranking: FTS5 BM25 (keyword) + TF-IDF (term frequency) + **semantic cosine similarity** (384-dim embeddings, v0.6). "debugging tips" now matches "error fixing" even without shared keywords.

### Layer 6 — Resource Intelligence (new in v0.6)

```
ResourceRegistry scans ALL .claude locations:
  ~/.claude/skills/          58 skills → listing + full + total tokens
  ~/.claude/agents/          36 agents → frontmatter name: resolution
  ~/.claude/agent_mobile/    ios-developer → agent_mobile/ios/AGENT.md
  ~/.claude/commands/        65 commands → relative path naming
  ~/.claude/workflows/       10 workflows
  ~/.claude/CLAUDE.md        + project CLAUDE.md chain

OverheadReport:
  "56/64 skills unused in last 10 sessions → ~1033 listing tokens wasted"
  "CLAUDE.md chain is 3222 tokens"
```

### Layer 7 — Observation Capture (new in v0.6)

```
Tool output contains "IMPORTANT: always pool DB connections"
  → observation entity (importance=4) saved to L2
  → included in session summary
  → searchable across sessions

User prompt contains "remember that we use TypeScript strict"
  → observation entity (importance=3) saved to L2
```

---

## Architecture

```
┌──────────────────────────────────────────────────────────────┐
│                      Claude Code                             │
│                                                              │
│  5 Lifecycle Hooks                                           │
│  ┌───────────────┐  ┌──────────────┐  ┌──────────────┐      │
│  │ PostToolUse   │  │ PreCompact   │  │ PostCompact  │      │
│  │ entity capture│  │ inject       │  │ save summary │      │
│  └──────┬────────┘  │ priorities   │  └──────┬───────┘      │
│         │           └──────┬───────┘         │              │
│  ┌──────┴───────┐          │          ┌──────┴───────┐      │
│  │UserPrompt    │          │          │ Stop         │      │
│  │Submit: inject│          │          │ session end  │      │
│  │past context  │          │          │ summarize    │      │
│  └──────────────┘          │          └──────────────┘      │
│                            │                                │
│  MCP Server (stdio)        │   Health Monitor               │
│  ┌─────────────────────┐   │   ┌────────────────────────┐   │
│  │ memory_recall       │   │   │ sqlite, fts5, disk,    │   │
│  │ memory_entities     │   │   │ integrity checks       │   │
│  │ memory_session_notes│   │   └────────────────────────┘   │
│  │ memory_store        │   │                                │
│  │ memory_context_budget│  │   Smart Resource Loader        │
│  │ memory_search  ←L1  │   │   ┌────────────────────────┐   │
│  │ memory_timeline ←L2 │   │   │ track usage → predict  │   │
│  │ memory_fetch   ←L3  │   │   │ → budget → recommend   │   │
│  │ memory_health       │   │   └────────────────────────┘   │
│  └─────────────────────┘   │                                │
│                            │   Browser UI (:37888)          │
│                            │   ┌────────────────────────┐   │
│                            │   │ search, browse, stats  │   │
│                            │   └────────────────────────┘   │
│                            │                                │
└────────────────────────────┼────────────────────────────────┘
                             │
                   ┌─────────┴──────────┐
                   │   SQLite + FTS5    │
                   │   ~/.claude-       │
                   │   memory-hub/      │
                   │   memory.db        │
                   │                    │
                   │   sessions         │
                   │   entities         │
                   │   session_notes    │
                   │   long_term_       │
                   │    summaries       │
                   │   resource_usage   │
                   │   fts_memories     │
                   │   tfidf_index      │
                   │   embeddings       │
                   │   claude_md_       │
                   │    registry        │
                   │   health_checks    │
                   └────────────────────┘
```

---

## Memory Hierarchy

```
┌─────────────────────────────────────────────────────┐
│  L1: WorkingMemory          in-process Map          │
│  Current session only       <1ms access             │
│  Lives in MCP server        FIFO 50 entries/session │
├─────────────────────────────────────────────────────┤
│  L2: SessionStore           SQLite                  │
│  Entities + notes           <10ms access            │
│  files_read, file_modified  Per-session scope       │
│  errors, decisions          Importance scored       │
├─────────────────────────────────────────────────────┤
│  L3: LongTermStore          SQLite + FTS5 + TF-IDF │
│  Cross-session summaries    <100ms access           │
│  Hybrid ranked search       Persistent forever      │
│  Auto-injected on start     3-layer progressive     │
└─────────────────────────────────────────────────────┘
```

---

## Install

### From npm (recommended)

```bash
bunx claude-memory-hub install
```

One command. Registers MCP server + 5 hooks globally. Works on CLI, VS Code, JetBrains.

**Coming from claude-mem?** The installer auto-detects `~/.claude-mem/claude-mem.db` and migrates your data automatically. No manual steps needed.

### Update

```bash
bunx claude-memory-hub@latest install
```

Or if installed globally:

```bash
bun install -g claude-memory-hub@latest
claude-memory-hub install
```

Your data at `~/.claude-memory-hub/` is preserved across updates. Schema migrations run automatically.

### From source

```bash
git clone https://github.com/TranHoaiHung/claude-memory-hub.git ~/.claude-memory-hub
cd ~/.claude-memory-hub
bun install && bun run build:all
bunx . install
```

### All CLI commands

```bash
bunx claude-memory-hub install     # Register MCP + hooks (auto-migrates claude-mem)
bunx claude-memory-hub uninstall   # Clean removal
bunx claude-memory-hub status      # Check installation
bunx claude-memory-hub migrate     # Import data from claude-mem
bunx claude-memory-hub viewer      # Open browser UI at localhost:37888
bunx claude-memory-hub health      # Run health diagnostics
bunx claude-memory-hub reindex     # Rebuild TF-IDF search index
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
| `memory_recall` | FTS5 search past session summaries | Starting a task, looking for prior work |
| `memory_entities` | Find all sessions that touched a file | Before editing a file, understanding history |
| `memory_session_notes` | Current session activity summary | Mid-session, checking what's been done |
| `memory_store` | Manually save a note or decision | Preserving important context |
| `memory_context_budget` | Analyze token costs + recommendations | Optimizing which resources to load |

### 3-Layer Search (new in v0.5)

| Tool | Layer | Tokens/result | When to use |
|------|-------|---------------|-------------|
| `memory_search` | 1 (index) | ~50 | First: find relevant memories by query |
| `memory_timeline` | 2 (context) | ~200 | Then: see what happened before/after a result |
| `memory_fetch` | 3 (full) | ~500 | Finally: get complete records for specific IDs |

### Diagnostics

| Tool | What it does |
|------|-------------|
| `memory_health` | Check database, FTS5, disk, integrity status |

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

If you're already using [claude-mem](https://github.com/nicobailey-llc/claude-mem), migration is seamless:

```bash
# Automatic (during install)
bunx claude-memory-hub install
# → Detects ~/.claude-mem/claude-mem.db automatically
# → Migrates sessions, observations, summaries

# Manual
bunx claude-memory-hub migrate
```

### What gets migrated

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
| **v0.2.0** | Compact interceptor (PreCompact/PostCompact hooks), context enrichment, importance scoring |
| **v0.3.0** | Removed API key requirement, 1-command install |
| **v0.4.0** | Smart resource loading, token budget optimization |
| **v0.5.0** | Production hardening, hybrid search, 3-layer progressive search, browser UI, health monitoring, claude-mem migration |
| **v0.6.0** | ResourceRegistry (170 resources), semantic search (384-dim embeddings), observation capture, CLAUDE.md tracking, 3-tier LLM summarization, overhead analysis |

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
| `CMH_LOG_LEVEL` | `info` | Log level: debug, info, warn, error |

---

## Data & Privacy

All data stored locally at `~/.claude-memory-hub/`.

```
~/.claude-memory-hub/
  ├── memory.db         # SQLite database (sessions, entities, summaries)
  └── logs/
      └── memory-hub.log  # Structured JSON logs (auto-rotated at 5MB)
```

No cloud. No telemetry. No network calls. Your memory stays on your machine.

---

## Uninstall

```bash
bunx claude-memory-hub uninstall
# Data at ~/.claude-memory-hub/ preserved. Delete manually if desired:
rm -rf ~/.claude-memory-hub
```
