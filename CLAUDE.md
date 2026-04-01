# claude-memory-hub

Persistent memory system for Claude Code. MCP server + 5 lifecycle hooks + SQLite FTS5 + semantic embeddings.

## Project Structure

```
src/
  capture/          Entity extraction from hook events
    entity-extractor.ts       Structured entities (files, errors, decisions, observations)
    observation-extractor.ts  Heuristic free-form capture from tool output + prompts
    context-enricher.ts       Enrich entities with code patterns, diffs, stderr
    hook-handler.ts           Routes hook events to SessionStore + ResourceTracker
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
    post-tool-use.ts          Capture entities after each tool call
    user-prompt-submit.ts     Inject past context at session start
    pre-compact.ts            Send priority list before compact
    post-compact.ts           Save compact summary to L3
    session-end.ts            Summarize + generate embedding
  mcp/              MCP server (long-lived stdio process)
    server.ts                 StdioServerTransport
    tool-definitions.ts       9 tool schemas + dispatcher
    tool-handlers.ts          Business logic for all MCP tools
  search/           Hybrid search engine
    search-workflow.ts        3-layer progressive: index -> timeline -> full
    vector-search.ts          TF-IDF tokenizer + cosine ranking
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
```

## Architecture Principles

- **Zero external services**: everything runs locally, no Docker/Chroma/Python
- **Graceful degradation**: if optional dep missing (embeddings), silently falls back
- **Hook scripts are short-lived**: stdin -> process -> exit. Must be fast (<100ms for UserPromptSubmit)
- **MCP server is long-lived**: stdio transport, owns L1 WorkingMemory
- **Never throw in hooks**: catch all errors, log, continue. Hooks must not crash Claude Code
- **ResourceRegistry is the single source of truth**: for resource existence, token costs, overhead analysis

## Database

SQLite at `~/.claude-memory-hub/memory.db`. WAL mode. Current SCHEMA_VERSION = 4.

Key tables: sessions, entities (with CHECK constraint including 'observation'), session_notes, long_term_summaries, resource_usage (8 types), fts_memories (FTS5), tfidf_index, embeddings (BLOB vectors), claude_md_registry, health_checks.

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

## Environment Variables

| Variable | Default | Purpose |
|----------|---------|---------|
| CLAUDE_MEMORY_HUB_LLM | auto | Summarization mode |
| CLAUDE_MEMORY_HUB_LLM_TIMEOUT_MS | 30000 | CLI summarizer timeout |
| CLAUDE_MEMORY_HUB_EMBEDDINGS | auto | Embedding mode (auto/disabled) |
| CLAUDE_MEMORY_HUB_SKIP_HOOKS | - | Suppress hooks (internal) |
| CMH_LOG_LEVEL | info | Log verbosity |
