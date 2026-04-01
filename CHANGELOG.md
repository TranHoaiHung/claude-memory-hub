# Changelog

All notable changes to `claude-memory-hub` are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/).

---

## [0.5.0] - 2026-04-01

Major release: production hardening, hybrid search, browser UI, claude-mem migration.

### P0 — Production Hardening

- **Structured logging** — JSON-line logger with levels (debug/info/warn/error), file rotation at 5MB, per-module context. All modules now log structured events to `~/.claude-memory-hub/logs/`
- **Schema repair** — `initDatabase()` now runs `PRAGMA integrity_check` on startup, detects orphaned FTS tables, attempts WAL checkpoint recovery on corruption
- **Health monitoring** — new `health_checks` SQLite table + `memory_health` MCP tool. Checks: database connectivity, FTS5 availability, disk usage, FK integrity. Historical health persisted. CLI: `bunx claude-memory-hub health`
- **Schema v2 migration** — incremental migration system. v2 adds `discovery_tokens` column to entities and summaries for ROI tracking

### P1 — Hybrid Search & Browser UI

- **TF-IDF vector search** — pure TypeScript, zero external deps. Tokenizer with stop-word removal, term frequency normalization, IDF weighting. Stored in `tfidf_index` SQLite table. CLI: `bunx claude-memory-hub reindex`
- **3-layer search workflow** — token-efficient progressive disclosure:
  - Layer 1 (`memory_search`): index results ~50 tokens each. FTS5 + TF-IDF hybrid ranking
  - Layer 2 (`memory_timeline`): chronological context around a result ~200 tokens
  - Layer 3 (`memory_fetch`): full records by ID ~500 tokens each
  - Saves ~80-90% tokens vs. returning full context on every search
- **Browser UI** — `bunx claude-memory-hub viewer` opens http://localhost:37888. Dark-themed dashboard with stats, search, pagination, session/entity/summary browsing. Zero build step — single embedded HTML
- **Pagination** — all list APIs (sessions, entities, summaries) support `limit` + `offset`

### P2 — Hook Improvements

- **Exit code strategy** — hooks use structured exit codes: 0=success, 1=non-blocking error (Claude Code continues), 2=blocking error. `safeHookRun()` wrapper ensures hooks never crash Claude Code
- **Hook stdin reader** — `readHookStdin()` with configurable timeout, safe JSON parsing

### claude-mem Data Migration

- **Auto-detect on install** — `bunx claude-memory-hub install` checks for `~/.claude-mem/claude-mem.db`. If found, migrates automatically
- **Standalone CLI** — `bunx claude-memory-hub migrate` for manual migration
- **Idempotent** — safe to run multiple times. Content-hash dedup for entities, UPSERT for sessions/summaries

### Data Mapping (claude-mem → memory-hub)
| claude-mem | → | claude-memory-hub |
|------------|---|-------------------|
| `sdk_sessions` | → | `sessions` (1:1 field map) |
| `observations.files_read` | → | `entities` (type=file_read) |
| `observations.files_modified` | → | `entities` (type=file_modified) |
| `observations` (title/narrative) | → | `entities` (type=decision) + `session_notes` |
| `session_summaries` | → | `long_term_summaries` (FTS5 indexed) |

### New MCP Tools
| Tool | Layer | Tokens/result |
|------|-------|---------------|
| `memory_search` | 1 (index) | ~50 |
| `memory_timeline` | 2 (context) | ~200 |
| `memory_fetch` | 3 (full) | ~500 |
| `memory_health` | — | ~100 |

### New CLI Commands
```
bunx claude-memory-hub viewer    # Browser UI at :37888
bunx claude-memory-hub health    # Health check
bunx claude-memory-hub reindex   # Rebuild TF-IDF index
bunx claude-memory-hub migrate   # Import from claude-mem
```

### Files Added
- `src/logger/index.ts` — structured logging
- `src/health/monitor.ts` — health checks
- `src/search/vector-search.ts` — TF-IDF engine
- `src/search/search-workflow.ts` — 3-layer search
- `src/hooks/exit-codes.ts` — hook error handling
- `src/ui/viewer.ts` — browser dashboard
- `src/migration/claude-mem-migrator.ts` — data migration

---

## [0.4.0] - 2026-04-01

### Problem
Every Claude Code session loads ALL skills, agents, rules, and memory files into context regardless of relevance. Typical overhead: **23-51K tokens** before the user types anything.

### Solution — Smart Resource Loader
- **ResourceTracker** — new `resource_usage` SQLite table automatically tracks which skills, agents, and MCP tools are actually used per session
- **SmartResourceLoader** — predicts relevant resources for new sessions based on usage frequency and prompt relevance, within a configurable token budget
- **MCP tool: `memory_context_budget`** — lets Claude analyze token costs and get resource recommendations on demand
- **PostToolUse auto-tracking** — Skill, Agent, and MCP tool invocations recorded automatically (zero config)
- **UserPromptSubmit advice injection** — when resources are deferred for efficiency, injects a hint so Claude knows to use SkillTool/ToolSearch on demand

### Impact
```
BEFORE: 23-51K tokens overhead (all resources loaded)
AFTER:  Only frequently-used resources recommended
        Rare resources loaded on demand via SkillTool
        ~10-30K tokens saved per session on heavy setups
```

### Files
- `src/context/resource-tracker.ts` — usage tracking + SQLite schema
- `src/context/smart-resource-loader.ts` — prediction + budgeted context planning

---

## [0.3.0] - 2026-04-01

### Problem
v0.2.0 required `@anthropic-ai/sdk` + `ANTHROPIC_API_KEY` for rich session summaries. Users without API key got degraded rule-based summaries. Extra dependency, extra cost, extra friction.

### Solution — Zero API Key Architecture
- **Removed `@anthropic-ai/sdk`** entirely from dependencies
- **Key insight:** PostCompact hook already receives Claude Code's own compact summary for free — no need to call the API again
- **Two summarization paths, both free:**
  - Short sessions (no compact) → rule-based summary from L2 entities
  - Long sessions (compact fires) → PostCompact hook captures Claude's summary directly

### Added
- **install.sh** — 1-command installer: `bash install.sh` handles bun install, MCP registration via `claude mcp add -s user`, and hooks patching. Works on CLI, VS Code, JetBrains.

### Breaking Changes
- `@anthropic-ai/sdk` removed — re-run `bash install.sh` to update
- `ANTHROPIC_API_KEY` env var no longer needed

### Dependencies
```
KEPT:    @modelcontextprotocol/sdk, bun:sqlite (built-in)
REMOVED: @anthropic-ai/sdk
```

---

## [0.2.0] - 2026-04-01

### Problem
v0.1.0 could not intercept Claude Code's auto-compact. When compact ran, 90% of context was lost and memory-hub had no way to influence what survived. Entity extraction was metadata-only (file paths, exit codes) with no understanding of WHY actions were taken.

### Solution — Compact Interceptor (Core Innovation)

**PreCompact Hook** — fires BEFORE compact summarization:
1. Reads all L2 entities (files, decisions, errors)
2. Scores by `importance * recencyWeight`
3. Outputs priority list as text
4. Claude Code **APPENDS** this to the compact prompt as `Additional Instructions`
5. Result: compact summarizer now **knows** what to preserve

**PostCompact Hook** — fires AFTER compact:
1. Receives the FULL 9-section compact summary via stdin
2. Saves directly to L3 SQLite
3. Zero additional information loss

### Added — Contextual Entity Enrichment
- File reads: captures first lines + code patterns (imports, class/function defs)
- File edits: captures `old_string → new_string` delta
- File writes: captures line count + content snippet
- Errors: captures command + stderr + stdout
- No XML required — parsed directly from tool response JSON

### Added — Importance-Weighted Scoring
| Entity Type | Importance | Example |
|-------------|-----------|---------|
| file_created | 4 | New file written |
| file_modified | 4 | File edited |
| error (fatal) | 5 | Non-zero exit, crash |
| error (normal) | 3 | Build warning |
| decision | 3 | TodoWrite task |
| file_read | 1 | File opened |

Score formula: `importance * (1 / (1 + hoursAgo))`

### Breaking Changes
- Entity extraction returns enriched `context` field — re-run `bash install.sh`
- 5 hooks instead of 3 (added PreCompact, PostCompact)

### Resolved Limitations from v0.1.0
- ~~Cannot intercept compact~~ → PreCompact + PostCompact hooks
- ~~No importance scoring~~ → Importance x recency in PreCompact
- ~~Metadata only, no reasoning~~ → Context enricher with diffs, patterns, stderr

---

## [0.1.0] - 2026-04-01

### Problem
Claude Code's built-in memory has 7 critical gaps:
1. Session memory triggers after 10K tokens — early context lost
2. Auto-compact loses 90% of information (200K → 20K tokens)
3. Memory selection is keyword-only (no ranking)
4. No cross-session carry-over — each session starts from zero
5. No entity tracking (files touched, decisions made, errors fixed)
6. Existing solution (claude-mem) requires Claude to output fragile XML format
7. claude-mem requires Python + Chroma subprocess — heavy operational overhead

### Solution — Hierarchical Memory Hub
- **L1: WorkingMemory** — in-process Map, current session, <1ms access
- **L2: SessionStore** — SQLite: entities + notes, session-scoped, <10ms
- **L3: LongTermStore** — SQLite FTS5: cross-session summaries, <100ms

### Added
- **Zero-XML entity extraction** — captures files, errors, decisions from Claude Code hook JSON (tool_name, file_path, exit_code). No special output format required.
- **SQLite FTS5 search** — BM25-ranked full-text search with automatic LIKE fallback
- **MCP Server (stdio)** — 4 tools: `memory_recall`, `memory_entities`, `memory_session_notes`, `memory_store`
- **3 Claude Code hooks** — PostToolUse, UserPromptSubmit, Stop
- **Progressive 3-layer disclosure** — index (~50 tok), summary (~300 tok), full (~800 tok)
- **Cross-session carry-over** — past summaries auto-injected at session start

### Known Limitations (addressed in later versions)
- Cannot intercept compact (→ solved in v0.2.0)
- Metadata only, no reasoning context (→ solved in v0.2.0)
- Requires API key for rich summaries (→ solved in v0.3.0)
- No token budget optimization (→ solved in v0.4.0)
- FTS5 keyword-only search (no vector/semantic — intentional trade-off)
