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
bunx claude-memory-hub@latest install
```

One command. Zero API key. Zero Python. Zero config. Done.

---

## ✨ Highlights

Every number below is **measured on real usage**, not estimated — the built-in telemetry (`stats --injections`) is part of the product.

| | What | Why it matters |
|---|---|---|
| 🛡️ | **Compact Interceptor** | The feature no other memory tool has: PreCompact tells the compactor what to preserve, PostCompact saves the full summary. ~90% context loss → ~90% salvage. |
| ⚡ | **Token-efficient injection** | Session baseline injected ONCE (SessionStart), later prompts deduplicated — measured **96% reduction** in injection overhead vs per-prompt injection. |
| 🚀 | **Persistent worker** | Hooks hit a warm local server: **981ms → ~50ms** per prompt. Auto-spawned, self-healing, version-skew guarded, falls back in-process when down — never a single point of failure. |
| 🕸️ | **Behavioral knowledge graph** | What static analysis can't know: which files are *actually* edited together, where errors *actually* happened, which decisions concern which files. Obsidian-style graph view in the dashboard (`/#graph`). |
| 📓 | **Obsidian two-way vault** | Memory exported as `[[wikilinked]]` notes — and read back: notes you write or edit in the vault become **curated memory**, injected into future sessions with the highest trust. Your edits are never overwritten. |
| 🎯 | **Resource intelligence** | Matches each prompt to the right skill/agent/CLAUDE.md by meaning (semantic + usage + project context) and audits token overhead of unused resources. |
| 🔗 | **Codegraph integration** | Repos indexed by [codegraph](https://github.com/colbymchenry/codegraph) get structural calls/called-by joined into `memory_impact` — structure + behavior in one view. |
| 🔒 | **3-layer privacy** | `<private>` tags + automatic secret redaction (sk-, ghp_, AWS keys…) + path filtering (.env, *.pem). All local: no cloud, no telemetry, no network calls. |
| 🪶 | **Zero-friction stack** | Bun + SQLite only. No Python, no Chroma, no Docker, no API key. Embeddings are optional and local (~90MB MiniLM). 233 unit tests. |

**Tech**: 7 lifecycle hooks · MCP server (13 tools) · SQLite FTS5 + TF-IDF + local embeddings with RRF fusion · recency-decay ranking · entity dedup with touch counts · injection effectiveness telemetry. Details in [CHANGELOG.md](CHANGELOG.md).

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
Next session → the **SessionStart hook injects the baseline once** (recent memory,
CLAUDE.md summary, resource advice). Per-prompt injection is conditional: history
recall and fresh search results only, deduplicated against what the session already saw.

No manual prompting. No copy-pasting. No token waste. Claude just knows.

### Token-Efficient by Design (v0.15)

Telemetry on 30 days of real usage showed the old design re-injected ~2,900 chars on
EVERY prompt (one session: 1,083 injections ≈ 790K tokens). v0.15 injects the baseline
once per session; later prompts measured at **0 extra chars** unless you explicitly ask
about past work. `injection_log` tracks `injected_at`, `dedup_skipped`, and
`memory_tool_used` so effectiveness is measured, not guessed.

### Knowledge Graph (v0.15)

Every session builds edges: which files change together (`co_edited`), where errors
happened (`error_in`), what decisions concern which files (`decided_about`), plus a
static import graph (`graph scan`). Ask `memory_impact` before touching a risky file
to see its blast radius: co-edit cluster, past errors, related decisions, sessions.

### Obsidian Vault — Two-Way (v0.17)

`bunx claude-memory-hub obsidian sync` exports sessions, decisions, and hot files as
markdown notes with `[[wikilinks]]` generated from the graph — Obsidian's graph view
becomes your coding memory graph. Incremental and idempotent.

Since v0.17 the vault is **read back** as curated memory — the loop is closed:

- **`MemoryHub/Notes/`** — every note you write there is indexed as *curated* knowledge.
  Scope it with `project: "<repo-folder>"` frontmatter, or leave it global.
- **Edit any exported note** — the hub detects it (content-hash guard), **never
  overwrites your edit again**, and indexes your version as curated.
- Curated notes are the **highest-trust source**: injected at session start for the
  matching project, recalled per-prompt via FTS + semantic match (works for
  Vietnamese notes), ranked with a 1.3× trust boost in `memory_search`, and
  fetchable via `memory_fetch` with `type: "curated"`. Per-session dedup keeps
  repeat prompts at zero token overhead.

Write it once in Obsidian → Claude Code knows it in every future session.

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

- **Persistent worker** — hooks hit a warm local server (~50ms vs ~1s cold start); auto-spawned, auto-healing, falls back to in-process when down
- **Codegraph integration** — repos indexed by [codegraph](https://github.com/colbymchenry/codegraph) get calls/called-by joined into `memory_impact` (structure + behavior in one view)
- **Slash commands** — `/mem-search`, `/mem-status`, `/mem-save`
- **13 MCP tools** — progressive 3-layer search (50→200→500 tokens/result) + graph + resource matching
- **Proactive retrieval** — detects topic shifts, injects relevant context mid-session
- **Maintenance daemon** — daily launchd agent: retention, WAL checkpoint, Obsidian sync
- **Browser dashboard** — `bunx claude-memory-hub viewer` at localhost:37888, with an Obsidian-style force-directed **graph view** of your memory (co-edits, imports, errors, decisions; per-project filter; click a node for its impact panel; deep link `/#graph`)
- **JSONL export/import** — full backup, incremental, per-table
- **Multi-agent ready** — subagents share memory via MCP
- **213 unit tests** — privacy, search, capture, schema, graph, export, health

---

## Quick Start

### Step 1 — Install Bun (the only requirement)

```bash
# macOS / Linux
curl -fsSL https://bun.sh/install | bash
```

```powershell
# Windows (PowerShell)
powershell -c "irm bun.sh/install.ps1 | iex"
```

No API key. No Python. No Docker. Claude Code itself is the only other thing you need.

### Step 2 — Install the hub

Same command on every platform:

```bash
bunx claude-memory-hub@latest install
```

What this does (nothing else):
1. Copies the runtime to `~/.claude-memory-hub/` (`C:\Users\<you>\.claude-memory-hub` on Windows)
2. Registers the MCP server + 7 lifecycle hooks in `~/.claude/settings.json` (absolute paths, forward slashes — works in cmd, PowerShell, and bash)
3. Installs 3 slash commands (`/mem-search`, `/mem-status`, `/mem-save`) into `~/.claude/commands/`

### Step 3 — Verify, then restart Claude Code

```bash
bunx claude-memory-hub doctor   # full health check (hooks, DB, worker, dist files)
bunx claude-memory-hub status   # quick view
```

Restart Claude Code (or start a new session) — memory is active. Works on CLI, VS Code, JetBrains. Coming from claude-mem? Data migrates automatically.

### Optional (recommended)

```bash
# Two-way Obsidian vault — add to the "env" block of ~/.claude/settings.json:
#   "CLAUDE_MEMORY_HUB_OBSIDIAN": "1"
#   "CLAUDE_MEMORY_HUB_OBSIDIAN_VAULT": "/path/to/your/vault"   (default: ~/Documents/ObsidianVault)
bunx claude-memory-hub obsidian sync    # first export + read-back

# Daily 03:30 maintenance (retention + WAL checkpoint + vault sync)
bunx claude-memory-hub install-daemon   # macOS: launchd · Windows: Task Scheduler · Linux: prints the cron line

# Browser dashboard with the memory graph
bunx claude-memory-hub viewer           # http://localhost:37888
```

### Platform support

| | macOS | Windows | Linux |
|---|---|---|---|
| Hooks + worker + MCP + search | ✅ | ✅ | ✅ |
| Obsidian two-way vault | ✅ | ✅ | ✅ |
| Maintenance daemon | ✅ launchd | ✅ Task Scheduler | manual cron (line printed) |
| Test suite in CI | ✅ | ✅ | ✅ |

Something off? `bunx claude-memory-hub doctor --fix` repairs the common cases, and the [Troubleshooting](#troubleshooting) section covers the rest.

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
│  7 Lifecycle Hooks                                          │
│  ┌───────────────┐  ┌──────────────┐  ┌──────────────┐      │
│  │ SessionStart  │  │ PreCompact   │  │ PostCompact  │      │
│  │ inject base-  │  │ inject       │  │ save summary │      │
│  │ line ONCE     │  │ priorities   │  └──────┬───────┘      │
│  └──────┬────────┘  └──────┬───────┘         │              │
│  ┌──────┴───────┐  ┌───────┴──────┐  ┌───────┴────────┐     │
│  │UserPrompt    │  │ PostToolUse  │  │ Stop: flush    │     │
│  │Submit: cond. │  │ batch queue +│  │ (~30ms)        │     │
│  │inject (dedup)│  │ feedback mark│  │ SessionEnd:    │     │
│  │+ save prompt │  └──────────────┘  │ parse+summarize│     │
│  └──────────────┘                    │ +graph+obsidian│     │
│                                      └────────────────┘     │
│  MCP Server (stdio, long-lived)                             │
│  ┌─────────────────────────────────────────────────────┐    │
│  │ memory_recall        memory_search  (L1 index)      │    │
│  │ memory_entities      memory_timeline (L2 context)   │    │
│  │ memory_session_notes memory_fetch   (L3 full)       │    │
│  │ memory_store         memory_context_budget          │    │
│  │ memory_conversation  memory_health                  │    │
│  │ memory_graph         memory_impact                  │    │
│  │ memory_resources_for_prompt                         │    │
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
| `memory_graph` | Knowledge-graph neighbors: co_edited, error_in, decided_about, imports | varies |
| `memory_impact` | Blast-radius view for a file: co-edit cluster + errors + decisions + sessions | ~300 |
| `memory_resources_for_prompt` | Best skills/agents/commands for a prompt (semantic + usage) | varies |

---

## CLI Reference

```bash
bunx claude-memory-hub@latest install   # Register MCP + hooks + slash commands
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
bunx claude-memory-hub doctor      # Diagnose install: 7 hooks, dist files, embeddings (--fix)
bunx claude-memory-hub stats       # Memory report (--injections: telemetry + effectiveness)
bunx claude-memory-hub graph       # Knowledge graph: graph build | graph scan [repo]
bunx claude-memory-hub obsidian sync  # Export memory to Obsidian vault [--project X]
bunx claude-memory-hub maintenance # Retention + WAL checkpoint + Obsidian sync now
bunx claude-memory-hub install-daemon # Daily 03:30 maintenance (macOS launchd / Windows Task Scheduler / Linux prints cron line)
bunx claude-memory-hub worker      # Persistent worker: worker start | stop | status
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
@huggingface/transformers          Semantic embeddings (optional, ~90MB model on first use)
sharp                              Image preprocessing for transformers (optional)
```

Two npm packages + two optional. No Python. No Chroma. No Docker. No API key.

### Enabling semantic search

By default, only FTS5 keyword search is active (zero-install). To enable semantic embeddings:

```bash
claude-memory-hub doctor --fix
```

This installs `@huggingface/transformers` + `sharp` into `~/.claude-memory-hub/node_modules/`
without polluting your project deps. To verify everything is healthy:

```bash
claude-memory-hub doctor
```

To disable semantic search at runtime: `export CLAUDE_MEMORY_HUB_EMBEDDINGS=disabled`.

---

## Smart resource matching (v0.13.0+)

Memory hub does not just remember past sessions — it also matches your **prompts to the right skill, agent, or CLAUDE.md** by meaning, not just by name or recency.

Each prompt triggers an injection like:

```
**Suggested resources for this prompt:**
  - skill: `veo3-prompt-expert` (68% — 68% match)
  - agent: `ios-developer` (52% — fits cwd)
  - skill: `mobile-development-skill` (41% — used in this project)
```

The score combines four signals:

| Signal | Weight | What it captures |
|---|---|---|
| Semantic match | 50% | Prompt embedding ↔ resource description embedding |
| Frequency | 20% | How often this resource was used in this project recently |
| Project context | 20% | cwd has `.swift` → boost `ios-developer`, `pubspec.yaml` → boost `flutter-developer`, etc. |
| Recency | 10% | Used at all recently |

To enable, run **once**:

```bash
claude-memory-hub doctor --fix --backfill
```

This installs the embedding model + indexes all your skills/agents/CLAUDE.md files. After that, every prompt automatically gets the right resources surfaced.

For ad-hoc lookup from inside a Claude session:

```
/mcp call memory_resources_for_prompt prompt="design a landing page for SaaS"
```

---

## Migrating from claude-mem

```bash
bunx claude-memory-hub@latest install   # auto-detects and migrates
```

| claude-mem | → | memory-hub |
|------------|---|------------|
| `sdk_sessions` | → | `sessions` |
| `observations` (files) | → | `entities` (file_read/file_modified) |
| `observations` (narrative) | → | `entities` (decision) + `session_notes` |
| `session_summaries` | → | `long_term_summaries` (FTS5 indexed) |

Idempotent — safe to run multiple times.

---

## ⚠️ Known Limitations

Honesty over marketing — what this tool does NOT do well (yet):

- **Semantic search is brute-force** — cosine similarity computed in-process, fine below ~5k embeddings (typical after months of daily use), no ANN index yet. sqlite-vec is planned once real databases approach that scale.
- **Keyword search is English-biased** — FTS5 porter stemming targets English. Vietnamese/CJK prompts fall back to semantic match + recent-summaries injection; summaries are written in English (with original-language terms preserved verbatim) to stay searchable.
- **The import graph is regex-based** — relative imports only, no AST, no call graph. That is deliberate: pair it with [codegraph](https://github.com/colbymchenry/codegraph) (tree-sitter, 30+ languages) and `memory_impact` merges both automatically.
- **Summaries are lossy by design** — L3 stores compressed session summaries, not transcripts. Full conversations remain searchable via `memory_conversation`, but they are not re-injected wholesale.
- **Recall depends on Claude calling the tools** — the awareness hint nudges it, and `memory_tool_used` telemetry measures how often that actually happens, but injection cannot force usage.
- **First hook after a cold boot pays ~1s** — the worker spawns on demand; every prompt after that is ~50ms. No keep-alive daemon is required (or installed) by default.
- **Maintenance daemon needs a scheduler per OS** — installed automatically on macOS (launchd) and Windows (Task Scheduler); on Linux `install-daemon` prints the crontab line for you to add manually. Everything else (hooks, worker, MCP, search, vault) is cross-platform and runs in CI on all three OSes.
- **Single machine, no cloud sync** — by design (privacy-first). Multi-machine workflows use `export`/`import` JSONL manually.
- **Localhost services are unauthenticated** — viewer (37888) and worker (37889) bind to 127.0.0.1 and assume a single-user machine.

---

## Troubleshooting

### Old version keeps running (stale global install or `bunx` cache)

Symptoms: the banner shows an old `(vX.Y.Z)` (or none at all, pre-0.17.4), `status` reports
a wrong hook count, or `install` registers fewer than 7 hooks.

Two causes, in order of likelihood:

1. **A stale global install shadows `bunx`** — if `claude-memory-hub` exists in PATH
   (old `npm i -g` or `bun add -g`), `bunx` runs it and never asks the registry.
   ```bash
   which claude-memory-hub        # anything printed = a global install is shadowing
   bun remove -g claude-memory-hub
   npm uninstall -g claude-memory-hub
   ```
2. **bunx cache** — fix by pinning the tag: `bunx claude-memory-hub@latest install`.

Since v0.17.4 every command prints its version and warns when the registry has a newer one.

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
