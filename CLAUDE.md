# claude-memory-hub

Persistent memory system for Claude Code. MCP server + 7 lifecycle hooks + 3 slash commands + SQLite FTS5 + semantic embeddings + knowledge graph + Obsidian export + privacy filtering.

## Project Structure

```
src/
  capture/          Entity extraction from hook events
    entity-extractor.ts       Structured entities (files, errors, decisions, observations)
    observation-extractor.ts  Heuristic free-form capture from tool output + prompts
    context-enricher.ts       Enrich entities with code patterns, diffs, stderr
    transcript-parser.ts      Parse Claude Code JSONL transcript for conversation capture
    hook-handler.ts           Routes hook events to SessionStore + ResourceTracker
    privacy-filter.ts         3-layer privacy: <private> tags, secret detection, path filtering
  context/          Resource intelligence + injection
    resource-registry.ts      Scan ALL .claude locations (skills, agents, commands, workflows, CLAUDE.md)
    smart-resource-loader.ts  Predict relevant resources within token budget
    resource-tracker.ts       Track resource usage per session (8 types)
    injection-validator.ts    Sanitize context before UserPromptSubmit injection
    claude-md-tracker.ts      Walk cwd->root, extract sections, content-hash detection
  compact/          Compact interception (PreCompact/PostCompact)
    compact-interceptor.ts    Influence what compact preserves + save full summary
  db/               SQLite layer
    schema.ts                 Tables + migrations (v1-v4), WAL mode, FTS5, indexes
    session-store.ts          L2 CRUD (sessions, entities, notes)
    long-term-store.ts        L3 FTS5 search + summaries
  hooks-entry/      Hook script entry points (short-lived processes)
    session-start.ts          Inject session baseline ONCE (memory, CLAUDE.md, advice)
    post-tool-use.ts          Capture entities after each tool call
    user-prompt-submit.ts     Per-prompt conditional injection (history recall, dedup'd memory, smart match)
    pre-compact.ts            Send priority list before compact
    post-compact.ts           Save compact summary to L3
    stop.ts                   After every assistant turn — batch flush only (~30ms)
    session-end.ts            Parse transcript + summarize + embeddings + graph edges + auto-cleanup
  mcp/              MCP server (long-lived stdio process)
    server.ts                 StdioServerTransport
    tool-definitions.ts       10 tool schemas + dispatcher
    tool-handlers.ts          Business logic for all MCP tools
  search/           Hybrid search engine
    search-workflow.ts        3-layer progressive: index -> timeline -> full + RRF fusion + recency decay
    vector-search.ts          Code-aware TF-IDF tokenizer (camelCase/snake_case/path splitting) + cosine ranking
    embedding-model.ts        Lazy @huggingface/transformers wrapper (384-dim)
    semantic-search.ts        Cosine similarity on stored embeddings
  summarizer/       Session summarization
    session-summarizer.ts     3-tier: PostCompact -> CLI -> rule-based
    cli-summarizer.ts         Tier 2: `claude -p --print` subprocess
    summarizer-prompts.ts     Tier 3: rule-based templates
  memory/           L1 working memory (in-process)
  retrieval/        Context builder (progressive disclosure)
  health/           Health monitoring
  migration/        claude-mem data migration
  logger/           Structured JSON logging
  ui/               Browser dashboard
  cli/              CLI commands (install, status, migrate, viewer)
commands/           Slash commands (installed to ~/.claude/commands/)
  mem-search.md           /mem-search — 3-layer progressive memory search
  mem-status.md           /mem-status — health + budget + session activity
  mem-save.md             /mem-save — save decision/note to persistent memory
```

## Architecture Principles

- **Zero external services**: everything runs locally, no Docker/Chroma/Python
- **Graceful degradation**: if optional dep missing (embeddings), silently falls back
- **Hook scripts are short-lived**: stdin -> process -> exit. Must be fast (<100ms for UserPromptSubmit)
- **MCP server is long-lived**: stdio transport, owns L1 WorkingMemory
- **Never throw in hooks**: catch all errors, log, continue. Hooks must not crash Claude Code
- **ResourceRegistry is the single source of truth**: for resource existence, token costs, overhead analysis

## Database

SQLite at `~/.claude-memory-hub/memory.db` (override: `CLAUDE_MEMORY_HUB_DB`, tests use this via `bunfig.toml` preload). WAL mode. Current SCHEMA_VERSION = 10.

Key tables: sessions, entities (UNIQUE(session_id, entity_type, entity_value) + touch_count since v8), session_notes, messages (conversation capture with FTS5 via fts_messages), long_term_summaries, resource_usage (8 types), fts_memories (FTS5), tfidf_index, embeddings (BLOB vectors), claude_md_registry, health_checks, injection_log (telemetry + injected_at/dedup_skipped/memory_tool_used), graph_edges (co_edited, error_in, decided_about, session_touched, imports).

## Dual-Repo Setup

- `origin` (public): https://github.com/TranHoaiHung/claude-memory-hub — only dist/, README, CHANGELOG, package.json, LICENSE
- `private`: https://github.com/TranHoaiHung/claude-memory-src — full source
- `.gitignore` excludes `src/`, `plans/`, `hooks/`, `tsconfig.json` from public
- `push-private.sh` syncs full source to private repo (temp branch + force push)
- `push-public.sh` pushes dist/ to origin

## Build

```bash
bun run build:all    # builds index.js + cli.js + 5 hook scripts
```

`@huggingface/transformers` marked as `--external` in build to avoid bundling 90MB model into dist/.

## Key Patterns

- **Agent name != directory name**: `agent_mobile/ios/AGENT.md` has frontmatter `name: ios-developer`. ResourceRegistry parses frontmatter to resolve correctly.
- **SKIP_HOOKS guard**: All hook entry scripts check `CLAUDE_MEMORY_HUB_SKIP_HOOKS=1` to prevent recursive invocation when CLI summarizer spawns `claude -p`.
- **3-level token estimation**: listing_tokens (system prompt listing ~50-200), full_tokens (when invoked ~200-8000), total_tokens (all files on disk).
- **Observation heuristics**: conservative, max 1 per tool call, 300-char cap. IMPORTANT/CRITICAL=4, decision:/NOTE:=3, TODO:/FIXME:=2.
- **Privacy-first capture**: All capture points (entity extraction, observation, transcript, user prompts) run through `privacy-filter.ts` before DB storage. Config at `~/.claude-memory-hub/privacy.json`.
- **Code-aware tokenizer**: TF-IDF tokenizer splits camelCase, snake_case, file paths into meaningful tokens. 100+ stop words including code keywords.
- **Recency-aware ranking**: Search results boosted by age (<7d=1.5x, <30d=1.2x, >90d=0.8x) + multi-source fusion (found by 2+ engines = higher rank).
- **Slash commands auto-install**: `commands/` dir copied to `~/.claude/commands/` during install, removed on uninstall.

## Environment Variables

| Variable | Default | Purpose |
|----------|---------|---------|
| CLAUDE_MEMORY_HUB_LLM | auto | Summarization mode |
| CLAUDE_MEMORY_HUB_LLM_TIMEOUT_MS | 30000 | CLI summarizer timeout |
| CLAUDE_MEMORY_HUB_EMBEDDINGS | auto | Embedding mode (auto/disabled) |
| CLAUDE_MEMORY_HUB_SKIP_HOOKS | - | Suppress hooks (internal) |
| CLAUDE_MEMORY_HUB_DB | ~/.claude-memory-hub/memory.db | Database path override (tests/CI) |
| CLAUDE_MEMORY_HUB_OBSIDIAN | - | Set to 1 to auto-sync Obsidian vault at SessionEnd |
| CLAUDE_MEMORY_HUB_OBSIDIAN_VAULT | ~/Documents/ObsidianVault | Obsidian vault path (export goes to MemoryHub/ inside it) |
| CMH_LOG_LEVEL | info | Log verbosity |
