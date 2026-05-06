# Changelog

All notable changes to `claude-memory-hub` are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/).

---

## [0.13.1] - 2026-05-06

**Hotfix** — UserPromptSubmit was silently failing for users with v0.5+ databases. Discovered during a v0.13.0 review session; affects every release since v0.11.x.

### Bugfix: `fts_messages` dropped on every cold start

**Root cause:** `repairSchema()` swept "orphaned" FTS5 tables but its whitelist only included `fts_memories`. The `fts_messages` table (added in migration v5 for conversation capture) was therefore dropped at every database open, while its triggers stayed. The next `INSERT INTO messages` then crashed with `no such table: main.fts_messages`. Because hooks swallow all errors silently, UserPromptSubmit returned an empty `additionalContext` and the user saw zero memory injection — but never knew anything was broken.

**Fix:**
1. Whitelist `fts_messages` (and any future FTS table) explicitly in the orphan sweep.
2. Add `healFtsMessages()` self-heal: if triggers reference `fts_messages` but the table is gone, rebuild it from the parent `messages` table on next startup. Idempotent and zero-data-loss.

If you were affected, your `messages` table data was preserved (only the FTS5 search index was missing). After upgrade, the heal runs automatically on first launch.

### How to verify the fix worked

```bash
sqlite3 ~/.claude-memory-hub/memory.db "
  SELECT
    (SELECT COUNT(*) FROM sqlite_master WHERE name='fts_messages') as fts_table,
    (SELECT COUNT(*) FROM sqlite_master WHERE name='fts_messages_insert') as trigger
"
# Expected: 1|1   (both present)
```

### Files Changed

- `src/db/schema.ts` — fix whitelist, add `healFtsMessages()`
- `tests/unit/schema.test.ts` — add regression test that drops `fts_messages` and asserts heal rebuilds it without throwing on next message insert

158 tests pass.

---

## [0.13.0] - 2026-05-06

**Second brain for Claude** — every prompt now triggers a semantic match against your skills, agents, and CLAUDE.md files so Claude knows which resource is right for the task, not just which one was used most recently.

### New: Prompt-aware resource matching

A new `UserPromptSubmit` injection section, `Suggested resources for this prompt:`, ranks skills/agents/commands by combining four signals:

```
final_score = 0.5 × semantic_match     (prompt embedding ↔ resource description)
            + 0.2 × frequency          (used in this project recently)
            + 0.2 × project_context    (cwd has .swift → ios-developer boost)
            + 0.1 × recency            (recently used at all)
```

Example — typing "tôi muốn tạo prompt video tiktok cho veo 3" now surfaces `veo3-prompt-expert` (68% semantic) even when you have not invoked that skill recently. Typing "fix bug crash khi login" inside an iOS project surfaces `mobile-development-skill` via cwd-context boost.

### New: `memory_resources_for_prompt` MCP tool

Lets Claude proactively query "given this prompt, which skills/agents are designed for it?" without waiting for the next UserPromptSubmit. Returns kind, name, score breakdown, and reason per match.

### New: `claude-memory-hub stats`

A 30-day report — sessions/day, top projects, hottest files, most-referenced decisions, and data-quality warnings (low-quality summaries, missing embeddings, missing resource embeddings).

### New: `doctor --backfill`

Reindex everything in one shot — summaries, entities, AND skill/agent descriptions. Required once after upgrading from <0.13.0 so the resource matcher has embeddings to search.

```bash
claude-memory-hub doctor --fix --backfill   # install deps + embed everything
claude-memory-hub doctor --backfill         # re-embed (deps already present)
```

### Architecture

- `src/context/prompt-analyzer.ts` (new) — extract intent, language, cwd signals (Swift/Kotlin/Flutter/RN/TS/Python/Go/Rust/Java/C#/Figma) with 60s cache
- `src/context/resource-description.ts` (new) — extract embeddable text from frontmatter + body of skill/agent files
- `src/context/resource-embeddings.ts` (new) — backfill resource embeddings; idempotent via content hash
- `src/context/resource-embedding-search.ts` (new) — cosine similarity search across embedded resources
- `src/context/resource-matcher.ts` (new) — compose semantic + frequency + cwd + recency into a final score
- `src/cli/doctor.ts` split into `doctor-types.ts`, `doctor-checks.ts`, `doctor-actions.ts` for clarity
- `src/cli/stats.ts` (new) — 30-day report
- `src/db/schema.ts` — migration v6: `resource_descriptions` table + relax `embeddings.doc_type` CHECK to include `'resource'`

### Database

Schema bumped to v6. Migration auto-runs on first launch — no user action required. Existing embeddings preserved.

### Files Changed

15 files. New: 7. Modified: 8. Tests: +2 cases for v6 schema. 157 tests pass.

---

## [0.12.0] - 2026-05-06

`doctor` command — diagnose installation health and auto-install optional embedding deps with one command. Larger transcript capture (10MB → 50MB).

### New: `claude-memory-hub doctor [--fix]`

Existing users discovered embeddings were silently disabled because `@huggingface/transformers` is `optional` and `npm install -g` skips optional deps. `doctor` makes the failure visible and fixable:

```bash
claude-memory-hub doctor          # diagnose only
claude-memory-hub doctor --fix    # install sharp + transformers into ~/.claude-memory-hub/node_modules/
```

Checks: database integrity, dist files, hooks registration, bun runtime, `@huggingface/transformers` + `sharp` presence, libvips dylib path on darwin-arm64. Prints actionable fix command for every failed check.

The `--fix` flag installs runtime deps **into the stable dir** (`~/.claude-memory-hub/`), not your project — so installing memory-hub never bloats your `node_modules`.

### Bugfix: 21MB Transcripts Silently Skipped

**Root cause:** `MAX_FILE_SIZE = 10MB` in `transcript-parser.ts` caused all sessions with transcript >10MB to be skipped at session-end. Long debug/refactor sessions lost conversation capture.

**Fix:** Bumped to 50MB. Streaming line-by-line + `MAX_MESSAGES=200` cap + `MAX_CONTENT_LENGTH=2000` already bound memory, so the larger limit is safe.

### Files Changed

- `src/cli/doctor.ts` (new) — installation diagnostic with auto-fix
- `src/cli/main.ts` — wire `doctor` command + help text
- `src/capture/transcript-parser.ts` — `MAX_FILE_SIZE: 10MB → 50MB`
- `README.md` — document `doctor --fix` for enabling semantic search
- `package.json` — bump version

---

## [0.11.5] - 2026-04-06

Memory hint injection — Claude now always knows memory hub is active, even when FTS5 finds no keyword match.

### Bugfix: Silent Context Gap on Generic Queries

**Root cause:** When the user asked in Vietnamese or used natural-language phrases like "cuộc trò chuyện gần nhất", `ltStore.search()` ran FTS5 with those words against English summaries — no match. `buildMemorySection([])` returned `""`. Claude received zero context and fell back to `git log` / built-in `MEMORY.md`.

**Fix:** If FTS5 returns 0 results but the DB has summaries, inject a **memory available hint**:
```
Memory hub active — N past sessions stored (projects: foo, bar).
Call memory_recall or memory_search with project-specific keywords to retrieve relevant context.
```
This ensures Claude always knows to call memory tools, regardless of query language or specificity.

### Improvements

- `LongTermStore.countSummaries(project?)` — fast COUNT query for summary availability check
- `LongTermStore.getRecentSummariesAll(limit)` — recent summaries without project filter (for hint project list)
- `buildMemorySection(results, hint)` — hint shown only when no FTS5 results; real results take precedence

### Files Changed

| File | Change |
|------|--------|
| `src/db/long-term-store.ts` | Added `countSummaries()` + `getRecentSummariesAll()` |
| `src/capture/hook-handler.ts` | Fallback hint injection when FTS5 returns 0 results |
| `package.json` | Version bump to 0.11.5 |

---

## [0.11.4] - 2026-04-03

Search quality fix — pruned garbage summaries and guided Claude to use specific keywords.

### Search Quality

- **Pruned 30 garbage summaries** — generic `"Session worked on auth system"` with project `"p"` flooded search results. Reduced from 45 → 15 quality summaries. These were created by the rule-based summarizer (Tier 3) when sessions had insufficient context
- **Improved tool descriptions** — `memory_recall` and `memory_search` now explicitly instruct: *"Use specific technical keywords (file names, feature names, error messages) — NOT generic terms like 'recent sessions'"*. FTS5 keyword matching requires actual content terms, not conversational phrases
- **Better query parameter docs** — examples changed from `"auth login bug"` to `"auth JWT"`, `"privacy filter"`, `"android SDK debug"` to encourage technical keyword usage

### Root Cause Analysis

Claude was searching with generic queries (`"recent sessions"`, `"recent work sessions activities"`) which returned 0 results because no summary contains the word "recent". FTS5 matches keywords in stored content, not natural language intent. The fix is two-fold: (1) better descriptions guide Claude to use matching keywords, (2) garbage data removed so good results surface.

### Files Changed

| File | Change |
|------|--------|
| `src/mcp/tool-definitions.ts` | `memory_recall` + `memory_search` descriptions + query param docs |
| Database | Pruned 30 low-quality summaries, FTS5 rebuilt |

---

## [0.11.3] - 2026-04-03

MCP registration fix + troubleshooting guide. The installer was registering MCP server in the wrong config file.

### Critical Bugfix: MCP Server Not Connecting

**Root cause:** `bunx claude-memory-hub install` registered the MCP server in `~/.claude/settings.json`, but Claude Code reads MCP config from **`~/.claude.json`** (top-level `mcpServers` object). Result: MCP server was never started by Claude Code, so `memory_recall`, `memory_search`, and all memory tools were unavailable. Claude fell back to reading `MEMORY.md` (built-in) which was empty.

Additionally, when `claude mcp add` was used previously, it registered with a `bunx` temp path (`/private/tmp/bunx-501-...`) that got deleted after reboot, causing "Failed to connect" on subsequent sessions.

**Fix approach:** The installer now registers MCP server in **both** `~/.claude/settings.json` (for hooks) and `~/.claude.json` (for MCP server). If `claude` CLI is available, it uses `claude mcp add -s user` which writes to the correct location.

### Documentation

- **Troubleshooting section** added to README with:
  - Step-by-step MCP registration fix
  - Manual `~/.claude.json` edit instructions
  - Verification steps (`/mem-status`, `claude mcp list`)
  - Common issues table (5 symptoms + causes + fixes)
  - Config file locations reference table

### Files Changed

| File | Change |
|------|--------|
| `src/cli/main.ts` | Register MCP in `~/.claude.json` alongside `settings.json` |
| `README.md` | Added Troubleshooting section |
| `package.json` | Version bump to 0.11.3 |

---

## [0.11.2] - 2026-04-03

Critical fix — context injection was silently failing, causing Claude to start every session from zero.

### Critical Bugfix: Context Injection Failure

**Root cause:** `InjectionValidator.validate()` crashed with `TypeError: null is not an object (evaluating 'text.replace')` when `fitWithinBudget()` passed `null`/`undefined` to it. The catch block returned `""`, so `UserPromptSubmit` hook injected **empty context** every session. Claude never received past session data despite 165 sessions and 36 summaries in the database.

**Impact:** All users. Every new session started from zero — the core value proposition of memory-hub was broken.

**Fixes:**

- **`injection-validator.ts`** — added null guard: `if (!rawContext) return ""` before `text.replace()`. Prevents crash when upstream passes null
- **`hook-handler.ts`** — all `fitWithinBudget()` inputs now null-safe: `memoryText || ""` for all 4 sections. Prevents null from propagating through budget allocation
- **`cli/main.ts`** — slash commands install now falls back to `~/.claude-memory-hub/commands/` when `PKG_DIR/commands/` doesn't exist (common with `bunx` temp dirs). Also copies commands to stable dir during `copyDistToStableDir()`
- **`package.json`** — added `commands/` to `files` array so slash commands are included in npm publish

### Files Changed

| File | Change |
|------|--------|
| `src/context/injection-validator.ts` | Null guard on `validate()` input |
| `src/capture/hook-handler.ts` | Null-safe `fitWithinBudget()` section inputs |
| `src/cli/main.ts` | Commands install fallback + copy to stable dir |
| `package.json` | Added `commands/` to `files`, version bump |

---

## [0.11.1] - 2026-04-03

Quality hardening — more tests, bugfixes, and robustness improvements for v0.11.0 features.

### Bugfixes

- **Clock skew guard** — recency decay in search ranking now uses `Math.max(0, ageMs)` to prevent negative age values when `created_at` is in the future due to clock skew. Previously could produce unpredictable scoring
- **Import consistency** — `uninstallCommands()` in `cli/main.ts` now uses top-level `unlinkSync` import instead of inline `require("fs").unlinkSync`. Cleaner code, consistent with rest of the file

### Testing

- **Privacy filter tests** — 35 new unit tests covering all 3 privacy layers:
  - Layer 1: `<private>` tag stripping (single, multiple, multiline, case-insensitive, disable toggle)
  - Layer 2: Secret detection (sk-, ghp_, gho_, Bearer, AKIA, passwords, private keys, hex secrets, short value safety, normal code safety)
  - Layer 3: Path filtering (.env, .env.*, .pem, .key, .p12, credentials, secrets/**, private/**, Windows paths, custom paths)
  - Custom patterns (user-defined regex, invalid pattern graceful handling)
  - Combined layers (tags + secrets in same text)
- **Tokenizer tests** — 12 new unit tests for code-aware tokenizer:
  - camelCase splitting (`getUserName` → get, user, name)
  - PascalCase splitting (`AuthController` → auth, controller)
  - Acronym handling (`HTMLParser` → html, parser)
  - snake_case splitting + compound preservation (`user_auth_service` → user, auth, service, user_auth_service)
  - File path splitting (`/src/hooks/auth.ts` → src, hooks, auth, ts)
  - Stop word filtering (code keywords + English)
  - Mixed code content, empty input, short tokens
- **Test count: 108 → 155** (+44% coverage increase)

### Files Changed

| File | Change |
|------|--------|
| `src/search/search-workflow.ts` | Clock skew guard on recency decay |
| `src/cli/main.ts` | Import `unlinkSync` properly |
| `tests/unit/privacy-filter.test.ts` | **New** — 35 tests for privacy filtering |
| `tests/unit/vector-search.test.ts` | +12 tokenizer edge case tests |

---

## [0.11.0] - 2026-04-03

Privacy-first memory, smarter search, and slash commands. Three features the community asked for most.

### New Feature: Privacy Protection (3-layer)

- **`<private>` tag stripping** — wrap sensitive content in `<private>API_KEY=sk-xxx</private>` and it's replaced with `[REDACTED]` before reaching the database. Works across all capture points: entity extraction, observations, user prompts, transcript parsing
- **Auto secret detection** — built-in regex patterns catch API keys (`sk-`, `ghp_`, `gho_`, `AKIA`), Bearer tokens, passwords, private key blocks, and hex/base64 secrets. Keeps first 12 chars for identification, redacts the rest
- **Path-based filtering** — files matching `.env`, `.env.*`, `*.pem`, `*.key`, `*.p12`, `credentials.*`, `**/secrets/**`, `**/private/**` are completely excluded from entity tracking. No file_read/file_modified entities created for these paths
- **Custom configuration** — create `~/.claude-memory-hub/privacy.json` to add your own ignored paths and regex patterns. Custom rules are added to defaults, not replacing them
- **New file: `src/capture/privacy-filter.ts`** — self-contained privacy engine with `sanitize()` and `isIgnoredPath()` APIs. Called at every capture point. <1ms overhead (regex-only, no I/O)

#### Files changed

| File | Change |
|------|--------|
| `src/capture/privacy-filter.ts` | **New** — 3-layer privacy engine (230 LOC) |
| `src/capture/entity-extractor.ts` | `isIgnoredPath()` on file entities + `sanitize()` on all values/context |
| `src/capture/observation-extractor.ts` | `sanitize()` input before heuristic matching |
| `src/capture/hook-handler.ts` | `sanitize()` user prompts before saving to messages table |
| `src/capture/transcript-parser.ts` | `sanitize()` all messages before returning |

### New Feature: Enhanced Semantic Search

- **Code-aware tokenizer** — TF-IDF tokenizer now splits camelCase (`getUserName` → `get`, `user`, `name`), snake_case (`user_auth_service` → `user`, `auth`, `service` + full compound), and file paths (`/src/hooks/auth.ts` → `src`, `hooks`, `auth`, `ts`). Dramatically improves search for code-heavy memory content
- **Expanded stop words (100+)** — added code keywords (`const`, `let`, `var`, `function`, `return`, `class`, `import`, `export`, `async`, `await`, etc.) and CLI noise words (`file`, `line`, `error`, `warning`, `info`, `debug`, `log`). Reduces false matches on high-frequency, low-signal terms
- **Recency decay** — search results from recent sessions are boosted: <7 days = 1.5x, <30 days = 1.2x, 30-90 days = 1.0x, >90 days = 0.8x. Yesterday's work ranks higher than last quarter's
- **RRF multi-source fusion** — results found by 2+ search engines (FTS5, TF-IDF, semantic) get a boost: 2 engines = 1.2x, 3 engines = 1.4x. Cross-validated results are more likely relevant
- **Score combination** — deduplication now properly combines scores across engines instead of just keeping max. RRF + recency + multi-source = significantly better ranking

#### Files changed

| File | Change |
|------|--------|
| `src/search/vector-search.ts` | Code-aware tokenizer, 100+ stop words, `tokenize()` now exported |
| `src/search/search-workflow.ts` | RRF fusion, recency decay, multi-source boost in `searchIndex()` |

### New Feature: Slash Commands

- **`/mem-search <query>`** — 3-layer progressive memory search. Guides Claude through the index → timeline → fetch workflow automatically
- **`/mem-status [project]`** — runs health check + token budget analysis + current session activity in one command
- **`/mem-save <note>`** — saves an important decision or finding to persistent memory via `memory_store`
- **Auto-install** — commands are copied to `~/.claude/commands/` during `bunx claude-memory-hub install` and removed on `uninstall`
- **Improved MCP tool descriptions** — all 10 tool descriptions rewritten with AUTO-USE hints, workflow guidance, and clearer parameter docs. `memory_recall` and `memory_entities` now suggest proactive usage

#### Files changed

| File | Change |
|------|--------|
| `commands/mem-search.md` | **New** — `/mem-search` slash command |
| `commands/mem-status.md` | **New** — `/mem-status` slash command |
| `commands/mem-save.md` | **New** — `/mem-save` slash command |
| `src/cli/main.ts` | `installCommands()` + `uninstallCommands()` + install output updated |
| `src/mcp/tool-definitions.ts` | All 10 tool descriptions rewritten with AUTO-USE and workflow hints |

### Before vs After

```
Before (0.10.x):
  Privacy:  None — API keys, tokens, passwords stored in plain text
  Search:   "getUserName" only matches exact term; 3-month-old results rank same as today's
  Commands: None — must know MCP tool names and call manually

After (0.11.0):
  Privacy:  <private> tags + auto-detect sk-/ghp_/Bearer/AKIA + .env/.pem excluded
  Search:   "getUserName" matches "get", "user", "name"; today's work ranks 1.5x higher
  Commands: /mem-search, /mem-status, /mem-save — Claude knows the workflow
```

### Documentation

- **README.md** — added Privacy Protection section, Slash Commands section, updated comparison table (4 new rows), updated Data & Privacy section, updated Version History
- **CLAUDE.md** — added `privacy-filter.ts` to project structure, updated search descriptions, added 4 new key patterns

---

## [0.10.0] - 2026-04-03

Full conversation capture — memory-hub now remembers what you said AND what Claude said.

### New Feature: Conversation Capture

- **All user prompts saved** — every `UserPromptSubmit` hook now inserts the user's message into a new `messages` table (up to 2000 chars each). Previously only the first prompt was stored in `sessions.user_prompt` (500 chars)
- **Transcript parsing at session-end** — when session ends, the Stop hook reads Claude Code's JSONL transcript file (`transcript_path`) and extracts all user + assistant text messages. Tool blocks (tool_use/tool_result) are skipped since they're already captured as entities. Streaming parser handles files up to 10MB safely
- **`messages` table + FTS5 search** — new schema v5 migration adds `messages` table with full-text search index. Supports deduplication by UUID, conversation chain tracking via `parent_uuid`, and role-based filtering
- **`memory_conversation` MCP tool** — new tool to retrieve or search conversation history for any session. Supports: get all messages, filter by role, full-text search across all conversations

### Enriched Summaries

- **Conversation digest in summaries** — session summarizer (both Tier 2 CLI and Tier 3 rule-based) now includes a digest of user requests from the `messages` table. Summaries now show "User requests (3): [1] fix login bug; [2] add dark mode; [3] deploy to prod" instead of just the first prompt
- **Search across conversations** — `searchMessages()` provides FTS5 search across all stored messages with LIKE fallback

### Data Flow

```
Session Start:
  UserPromptSubmit → save user prompt to messages table (real-time)

Mid-Session:
  UserPromptSubmit → save each subsequent prompt (real-time)
  PostToolUse → capture entities as before

Session End (Stop hook):
  1. Parse transcript_path JSONL → extract user + assistant messages
  2. Bulk insert to messages table (dedup by UUID)
  3. Summarize with conversation digest
  4. Generate embeddings
```

### Database

- **Schema v5** — new `messages` table, `fts_messages` FTS5 virtual table, auto-sync triggers
- **Migration**: automatic on first use after upgrade

### Before vs After

```
Before (0.9.x):
  Stored: first user prompt (500 chars) + file/error/decision entities
  Missing: subsequent prompts, ALL assistant responses
  Summary: "Task: fix login. Files: auth.ts."

After (0.10.0):
  Stored: ALL user prompts + ALL assistant responses + entities
  Summary: "User requests (3): fix login bug; add dark mode; deploy.
           Files: auth.ts, theme.ts. Decisions: JWT refresh, CSS vars."
  Searchable: "authentication login" → finds matching conversations
```

---

## [0.9.6] - 2026-04-03

Richer session capture — Agent results, higher limits, cleaner summaries.

### Enhancements

- **Agent/Skill result capture** — `tool_response` from Agent and Skill tools is now saved into entity `context` field (up to 800 chars). Previously only the prompt was captured, losing all agent output. This is the biggest data quality improvement — multi-agent workflows now produce meaningful summaries
- **Higher summary limits** — `user_prompt` 200→500 chars, `decisions` 3→5 entries with context, `errors` 2→5 entries, `notes` 2→5 entries. CLI summarizer bumped to 6K prompt / 2K output (was 4K/1K). Decision entities now include agent/skill results in summary text
- **IDE/system tag stripping in summarizer** — `<ide_opened_file>`, `<ide_selection>`, `<system-reminder>`, `<local-command-*>`, `<command-*>` tags are now stripped at both rule-based and CLI summarizer stages. Prevents tag noise from polluting L3 summaries
- **PostCompact summary cap** — compact summaries exceeding 5,000 chars are truncated (was unbounded — seen 22K in production). Reduces DB bloat and improves search relevance
- **Broader observation heuristics** — added patterns for: refactoring, dependency changes, test results, deployments, scaffolding, data risks, user task/feature requests. Captures more meaningful observations from tool output and user prompts

### Before vs After

```
Before: "Task: <ide_opened_file>...</ide_opened_file>. Files (49): ..."  (1165 chars, noisy)
After:  "Task: fix broken hooks in memory-hub. Files (15): ... Decisions: agent:debugger: investigated... → Found temp path issue..."  (richer, clean)
```

---

## [0.9.5] - 2026-04-03

Stable install path — hooks no longer break after reboot or bunx cache cleanup.

### Bug Fixes

- **Hooks pointing to temp `bunx` path** — `bunx claude-memory-hub install` registered hooks at `/private/tmp/bunx-*/...` (macOS) or `%TEMP%/bunx-*/...` (Windows). These paths are ephemeral and get deleted on reboot or cache cleanup, causing **all hooks to silently fail** — sessions stop being captured with no error visible to the user
- **Install now copies `dist/` to `~/.claude-memory-hub/dist/`** — a stable, persistent location under the user's home directory. Both hooks and MCP server reference this path instead of the package install location
- **Old hook entries auto-replaced** — `install` removes previous claude-memory-hub hook entries before registering new ones, fixing stale paths from prior installs without manual cleanup
- **`install.sh` updated** — shell-based installer uses the same stable path strategy with full bun binary resolution

### How It Works

```
bunx claude-memory-hub install
  1. Downloads package to temp dir (bunx behavior)
  2. Copies dist/*.js + dist/hooks/*.js → ~/.claude-memory-hub/dist/  ← NEW
  3. Registers hooks pointing to ~/.claude-memory-hub/dist/hooks/      ← STABLE
  4. Registers MCP server pointing to ~/.claude-memory-hub/dist/index.js
```

### Upgrade Note

Run `bunx claude-memory-hub@latest install` to fix broken hooks. No data loss — only hook paths are updated.

---

## [0.9.4] - 2026-04-02

Windows path fix — backslashes no longer eaten by bash.

### Bug Fixes

- **Windows backslash paths in hooks** — `C:\Users\Admin\.bun\bin\bun.exe` was passed raw into bash commands, which stripped backslashes → `C:UsersAdmin.bunbinbun.exe`. New `shellPath()` utility converts all paths to forward slashes (`C:/Users/Admin/.bun/bin/bun.exe`) and quotes paths with spaces. Applied to: bun binary path, hook script paths, MCP server path
- **`where` output parsing on Windows** — `where bun` returns `\r\n` line endings; now splits on `/\r?\n/` instead of `\n`

---

## [0.9.3] - 2026-04-02

Summary quality improvements — cleaner data in, garbage data out.

### Summary Quality

- **Strip IDE tags from user_prompt** — `<ide_opened_file>`, `<ide_selection>`, `<system-reminder>` tags are now removed before storing `user_prompt` in L2. Summaries and search results no longer contain IDE noise
- **Skip low-value sessions** — sessions with only `file_read` entities (browsing, no edits) and no errors/decisions/notes/observations are no longer summarized. Prevents generic "Session in project X" entries from polluting L3
- **`hasModifiedFiles()` method** — new SessionStore method checks for `file_modified` or `file_created` entities efficiently

### New CLI Command

- **`prune` command** — removes low-quality summaries from L3: generic text ("Session worked on...", "Session in project..."), IDE tag noise, and empty summaries with no files/decisions/errors. Supports `--dry-run` for safe preview. Also cleans related embeddings

```bash
bunx claude-memory-hub prune --dry-run  # preview
bunx claude-memory-hub prune            # delete
```

---

## [0.9.2] - 2026-04-02

Cross-platform hook reliability — Windows/WSL no longer fails with "bun: command not found".

### Bug Fixes

- **dist/hooks missing from npm package** — `.npmignore` pattern `hooks/` was matching `dist/hooks/` too, causing "Module not found" on Windows. Fixed to `/hooks/` (root-only match)

### Upgrade Note

After updating, run `bunx claude-memory-hub@latest install` to re-register hooks with the resolved bun path.


---

## [0.9.1] - 2026-04-02

Cross-platform hook reliability — Windows/WSL no longer fails with "bun: command not found".

### Bug Fixes

- **Full bun path resolution** — `install` now resolves absolute path to `bun` binary via `which` (macOS/Linux) or `where` (Windows), with fallback to `~/.bun/bin/bun`. All hooks and MCP server commands are registered with the full path instead of relying on PATH inheritance
- **Windows/WSL compatibility** — fixes "bun: command not found" error caused by non-interactive shells (used by Claude Code to spawn hooks) not inheriting user's PATH where `bun` is installed
- **dist/hooks missing from npm package** — `.npmignore` pattern `hooks/` was matching `dist/hooks/` too, causing "Module not found" on Windows. Fixed to `/hooks/` (root-only match)

### Upgrade Note

After updating, run `bunx claude-memory-hub@latest install` to re-register hooks with the resolved bun path.

---

## [0.9.0] - 2026-04-02

Smart context budget allocation — memory never gets pushed out by lower-priority content.

### Smart Budget Allocation (breaking change in injection behavior)

- **Priority-based `fitWithinBudget()`** — replaces naive sequential concatenation. Four content sections now compete for 8,000 chars with explicit priorities: P1 memory (min 500 chars) > P2 CLAUDE.md (min 200 chars) > P3 resource advice (droppable) > P4 overhead warning (droppable). When total fits, everything is kept. When over budget, lowest priority sections are shrunk or dropped first
- **Memory context guaranteed** — past session context always gets first claim on budget. Previously could be truncated when CLAUDE.md + advice consumed too much space

### CLAUDE.md Adaptive Compression

- **3-level `formatForInjection()`** — CLAUDE.md summary now adapts to available budget: Level 3 (full: headings + token cost, >500 chars), Level 2 (compact: file + token cost, >200 chars), Level 1 (minimal: file names only, <200 chars). Previously always used full format regardless of remaining space

### Overhead Warning Injection

- **Auto-inject warning when unused resources > 10K tokens** — UserPromptSubmit hook now analyzes `OverheadReport` and injects a one-line note if unused skills/agents exceed 10,000 listing tokens. Points user to `memory_context_budget` tool for details. Zero-cost when overhead is acceptable

### Context Injection Limits

- **UserPromptSubmit cap doubled** — `MAX_CHARS` increased from 4,500 (~1,125 tokens) to 8,000 (~2,000 tokens)
- **Proactive retrieval cap doubled** — `MAX_INJECTION_CHARS` increased from 1,500 (~375 tokens) to 3,000 (~750 tokens)
- **Proactive summary slice increased** — per-result summary increased from 200 to 400 chars for richer mid-session context
- **Memory result summary increased** — session-start per-result summary increased from 300 to 400 chars

### Bug Fixes

- **Windows/WSL hook failure fixed** — `install` now resolves full path to `bun` binary via `which`/`where` + fallback to `~/.bun/bin/bun`. Fixes "bun: command not found" error on Windows/WSL where non-interactive shells don't inherit PATH

---

## [0.8.1] - 2026-04-02

Token-budget-aware MCP tools + proactive mid-session memory retrieval.

### Token Budget Management

- **`max_tokens` parameter** — added to `memory_recall`, `memory_search`, `memory_fetch` MCP tools. When set, output is truncated to fit within the specified token budget (~4 chars/token). Helps Claude manage context window when many tools compete for space
- **`truncateToTokenBudget()` utility** — shared truncation function with `[...truncated to fit ~N token budget]` suffix

### Proactive Memory Retrieval

- **Topic-shift detection** — PostToolUse hook now monitors file activity and detects when conversation drifts to a new domain (e.g., auth → payment → migration). Detection uses directory clustering + keyword matching across recent files
- **Mid-session context injection** — when topic shift detected, hook searches L3 for relevant past context and returns `additionalContext` via stdout JSON. Claude Code injects this into the conversation automatically
- **Trigger conditions:** every 15 tool calls OR on Bash errors after warmup (5+ calls)
- **State tracking** — per-session state at `~/.claude-memory-hub/proactive/<session_id>.json`, cleaned up on session end
- **Injection cap:** ~375 tokens (1500 chars) per injection, deduplicated by topic

### Session End Improvements

- **Batch queue flush on session end** — `tryFlush()` called during Stop hook to prevent data loss from unflushed batch events
- **Proactive state cleanup** — per-session state files removed on session end

### Research Findings (documented, no code changes needed)

Based on deep Claude Code source analysis:
- **Resource filtering:** Claude Code already defers MCP tools automatically via `isDeferredTool()`. Skill listings have budget system (`SKILL_BUDGET_CONTEXT_PERCENT=1%`). No external filtering needed
- **Multi-agent sharing:** Subagents inherit parent MCP servers via `initializeAgentMcpServers()`. Memory sharing via `memory_recall` works out-of-box — zero implementation needed
- **Permission-aware:** PostToolUse hook only fires for approved tools. Denied tools fire separate `PermissionDenied` hook. memory-hub is already permission-aware by design
- **IDE context:** Available as attachments in conversation (ide_selection, ide_opened_file) but not in hook inputs directly. Entity extraction captures file activity indirectly

### Modified Files

```
src/mcp/tool-definitions.ts           — max_tokens param on 3 tools
src/mcp/tool-handlers.ts              — truncateToTokenBudget() utility
src/retrieval/proactive-retrieval.ts   — NEW: topic detection + injection
src/hooks-entry/post-tool-use.ts       — proactive retrieval integration
src/hooks-entry/session-end.ts         — batch flush + proactive cleanup
```

---

## [0.8.0] - 2026-04-02

Major release: test infrastructure, architectural fixes, hook performance, data portability.

### Phase 1 — Unit Tests (0% → 91 tests)

- **bun:test infrastructure** — 10 test files, 91 tests, 161 assertions, 225ms runtime
- **In-memory SQLite** — all tests use `:memory:` databases for isolation, zero filesystem side effects
- **Test coverage modules:** schema, session-store, long-term-store, entity-extractor, observation-extractor, vector-search, working-memory, injection-validator, compact-interceptor, health-monitor
- **Test helpers** — `createTestDb()`, `seedSession()`, `seedEntity()`, `seedSummary()`, `mockPostToolUseHook()` in `tests/setup.ts`

### Phase 4 — L1 WorkingMemory Redesign

- **Read-through cache** — `WorkingMemory` rewritten from dead in-process Map to read-through cache over `SessionStore`. First call loads entities from SQLite, subsequent calls serve from cache (<1ms)
- **Previous behavior:** `workingMemory.summarize()` always returned `""` because hook scripts (short-lived) wrote to L2 directly, MCP server never populated L1
- **New behavior:** MCP server's `memory_session_notes` tool returns real data via L1 cache
- **API changes:** removed `add()` method (no callers), added `refresh()` and `invalidate()`. Constructor accepts `SessionStore` for DI
- **Cache TTL:** 5 minutes, invalidated on session end

### Phase 5 — Hook Performance (Batch Queue)

- **Batch queue** — `src/capture/batch-queue.ts` implements write-through batching for PostToolUse. Events appended to `~/.claude-memory-hub/batch/queue.jsonl` (~3ms) instead of direct DB write (~75ms)
- **Opportunistic flush** — each hook invocation tries to flush batch to DB if lock available
- **File-based lock** — PID-based with 30s staleness check, prevents dead lock accumulation
- **Fallback** — if batch dir unavailable or enqueue fails, falls back to direct write
- **Env var:** `CLAUDE_MEMORY_HUB_BATCH=auto|enabled|disabled`

### Phase 6 — Export/Import CLI

- **`bunx claude-memory-hub export`** — JSONL streaming export to stdout. Options: `--since TIMESTAMP`, `--table TABLE`
- **`bunx claude-memory-hub import`** — JSONL import from stdin with UPSERT semantics. Option: `--dry-run`
- **`bunx claude-memory-hub cleanup`** — remove old data beyond retention period. Option: `--days N` (default 90)
- **BLOB handling** — embedding vectors encoded as `{"$base64": true, "encoded": "..."}` for JSON portability
- **Schema version header** — first JSONL line declares `__schema_version` for compatibility validation
- **Idempotent import** — sessions (ON CONFLICT id), summaries (ON CONFLICT session_id), embeddings (ON CONFLICT doc_type+doc_id)

### Bug Fixes

- **Observation regex trailing `\b`** — patterns ending with `:` (decision:, TODO:, performance:) had trailing `\b` that failed to match because `:` followed by space = no word boundary. Removed trailing `\b` from colon-ending patterns

### New/Modified Files

```
NEW:
  tests/setup.ts                       — test infrastructure
  tests/unit/*.test.ts                 — 10 test files (91 tests)
  src/capture/batch-queue.ts           — write-through batch queue
  src/export/exporter.ts               — JSONL streaming export
  src/export/importer.ts               — JSONL streaming import

MODIFIED:
  src/memory/working-memory.ts         — read-through cache over SessionStore
  src/hooks-entry/post-tool-use.ts     — batch queue fast path
  src/capture/observation-extractor.ts — regex trailing \b fix
  src/cli/main.ts                      — export, import, cleanup commands
  package.json                         — test scripts, version 0.8.0
```

### New CLI Commands

```bash
bunx claude-memory-hub export [--since T] [--table T]  # JSONL export to stdout
bunx claude-memory-hub import [--dry-run]               # JSONL import from stdin
bunx claude-memory-hub cleanup [--days N]               # Remove old data
```

### New Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `CLAUDE_MEMORY_HUB_BATCH` | `auto` | Batch mode: auto, enabled, disabled |

---

## [0.7.0] - 2026-04-01

Hardening release: honest resource analysis, search scaling, improved observation capture, DB auto-cleanup, summarizer reliability.

### Correctness & Honesty

- **Smart Resource Loader rewritten** — v0.4-v0.6 claimed "~24K tokens saved per session" but Claude Code has NO external API to filter resource loading (confirmed by reading Claude Code source). `formatContextAdvice()` now provides **honest, actionable advice**: shows frequently-used resources and overhead awareness instead of misleading "deferred for token efficiency" language
- **Project CLAUDE.md name validation** — `scanClaudeMd()` now validates relative paths against `SAFE_COMMAND_NAME_RE` before registering, preventing invalid resource names in registry

### Semantic Search Scaling

- **Pre-filter by doc_type** — `semanticSearch()` accepts `docType` option to filter at SQL level, reducing memory usage for targeted queries
- **Max candidates cap** — new `maxCandidates` option (default 2000) with `ORDER BY created_at DESC` prevents OOM on large datasets (>5000 embeddings)
- **Configurable threshold** — similarity threshold now configurable via `SemanticSearchOptions` (default 0.2), was hard-coded
- **Batch embedding reindex** — `reindexAllEmbeddings()` uses `embedBatch()` with chunk size 16 instead of processing 1-by-1. Tries batch API first, falls back to sequential

### Embedding Model

- **True batch processing** — `embedBatch()` processes in configurable chunks (default 8), attempts native `@huggingface/transformers` batch call first, falls back to individual if unsupported

### Observation Extraction

- **8 new patterns** — expanded from 6 to 14 heuristics:
  - Tool output: DEPRECATED, SECURITY, VULNERABILITY (importance 4), "discovered", "root cause", "switched to" (3), HACK, WORKAROUND, "bottleneck", "OOM" (2)
  - User prompts: "MUST" (4), "don't", "never", "avoid" (3), "prefer", "always use", "convention is" (2)
- **Increased value capture** — max observation length 300 → 500 characters for richer context

### Health Monitoring & Auto-Cleanup

- **Embeddings size check** — new `checkEmbeddingsSize()` health check, warns when >5000 embeddings
- **Disk check includes WAL** — total disk size now sums `memory.db` + `-wal` + `-shm` files. Tiered thresholds: 200MB warn, 500MB error
- **`cleanupOldData()`** — transaction-safe cleanup with configurable retention (default 90 days). Deletes: sessions, entities, notes, summaries, embeddings, resource_usage, old health checks. Runs WAL checkpoint after large deletions

### LLM Summarizer Reliability

- **Retry logic** — `tryCliSummary()` now retries once (2 attempts total) with 1s pause between attempts before falling back to rule-based
- **CLI availability TTL** — `isClaudeCliAvailable()` cache expires after 5 minutes when `false`, allowing recovery if `claude` CLI becomes available mid-session (was cached forever)

### Modified Files

```
src/context/smart-resource-loader.ts  — honest advice, no misleading claims
src/context/resource-registry.ts      — CLAUDE.md name validation
src/search/semantic-search.ts         — pre-filter, maxCandidates, batch reindex
src/search/embedding-model.ts         — true batch processing with chunking
src/capture/observation-extractor.ts  — 8 new patterns, 500-char cap
src/health/monitor.ts                 — embeddings check, WAL disk, auto-cleanup
src/summarizer/cli-summarizer.ts      — retry logic, CLI TTL recovery
```

---

## [0.6.0] - 2026-04-01

Major release: semantic search, resource intelligence, observation capture, CLAUDE.md tracking, LLM summarization.

### Phase 1 — ResourceRegistry + Entity Coverage

- **ResourceRegistry** — unified scanner for ALL `.claude` locations: skills (58), agents (36), commands (65), workflows (10), CLAUDE.md. Parses agent frontmatter `name:` for correct resolution (e.g., `ios-developer` → `~/.claude/agent_mobile/ios/AGENT.md`). 3-level token estimation: listing (~50-200), full (200-8000), total (all files on disk)
- **OverheadReport** — `memory_context_budget` MCP tool now shows: fixed token overhead breakdown, unused skill/agent detection, potential savings recommendations
- **InjectionValidator** — sanitizes context before `UserPromptSubmit` injection. Strips HTML comments, caps at 4500 chars, filters dead resource recommendations via `filterAliveRecommendations()`
- **Agent/Skill entities** — `Agent` and `Skill` tool calls now produce `entity_type="decision"` entities (importance 3/2), visible in summarization and compact scoring
- **Expanded resource types** — `resource_usage` table tracks 8 types: skill, agent, command, workflow, claude_md, memory, mcp_tool, hook (was 5)
- **Real token costs** — `SmartResourceLoader` uses ResourceRegistry for actual file-size-based estimates instead of hardcoded 500 fallback

### Phase 2 — Schema v3 + Observations + CLAUDE.md Tracking

- **Schema migration v3** — entities table rebuilt with `observation` type in CHECK constraint + new `claude_md_registry` table
- **Observation extractor** — heuristic-based free-form capture from tool output and user prompts. Keywords: IMPORTANT/CRITICAL (importance 4), decision:/NOTE: (3), TODO:/FIXME: (2). Max 1 observation per tool call, capped at 300 chars
- **CLAUDE.md tracker** — walks from `cwd` to root, finds all CLAUDE.md files, extracts `## sections` + 200-char previews, content-hash change detection (only re-parses on change), injects rule summary into context
- **Session summarizer** includes top 5 observations in L3 summaries
- **Vector search** reindexes observation entities alongside decisions and errors

### Phase 3 — LLM Summarization Pipeline

- **3-tier fallback** — Tier 1: PostCompact summary (free, already existed). Tier 2: `claude -p ... --print` subprocess with 30s timeout. Tier 3: Rule-based (always available)
- **Hook recursion guard** — `CLAUDE_MEMORY_HUB_SKIP_HOOKS=1` env var set on CLI subprocess, checked by all 5 hook entry scripts. Prevents infinite loop when CLI summarizer triggers hooks
- **Configurable** — `CLAUDE_MEMORY_HUB_LLM=auto|cli-only|rule-based` env var. `CLAUDE_MEMORY_HUB_LLM_TIMEOUT_MS` for custom timeout

### Phase 4 — Semantic Search

- **Embedding model** — `@huggingface/transformers` with `all-MiniLM-L6-v2` (384-dim, 90MB cached, 9ms warm inference). Lazy-loaded: only imports when first embedding requested. Graceful degradation if package not installed
- **Pure JS cosine similarity** — no native sqlite-vec binary needed. Fast enough for <1000 docs. Embeddings stored as BLOBs in new `embeddings` table (schema v4)
- **Hybrid search** — `searchIndex()` now merges FTS5 BM25 + TF-IDF + semantic cosine similarity. Deduplicates by id+type, keeps highest score
- **Auto-indexing** — session-end hook generates embedding for new summaries automatically
- **Opt-in** — `CLAUDE_MEMORY_HUB_EMBEDDINGS=auto|disabled` env var. `@huggingface/transformers` is `optionalDependencies` — install failure doesn't break anything

### New Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `CLAUDE_MEMORY_HUB_LLM` | `auto` | Summarization mode: auto, cli-only, rule-based |
| `CLAUDE_MEMORY_HUB_LLM_TIMEOUT_MS` | `30000` | CLI summarizer timeout in ms |
| `CLAUDE_MEMORY_HUB_EMBEDDINGS` | `auto` | Embedding mode: auto, disabled |
| `CLAUDE_MEMORY_HUB_SKIP_HOOKS` | — | Set to `1` to suppress hooks (internal use) |

### New/Modified Files

```
NEW:
  src/context/resource-registry.ts      — unified resource scanner
  src/context/injection-validator.ts    — context sanitization
  src/capture/observation-extractor.ts  — free-form observation capture
  src/context/claude-md-tracker.ts      — CLAUDE.md scanning + tracking
  src/summarizer/cli-summarizer.ts      — Tier 2 CLI summarization
  src/search/embedding-model.ts         — lazy @huggingface/transformers
  src/search/semantic-search.ts         — cosine similarity search

MODIFIED:
  src/db/schema.ts                      — migrations v3 + v4
  src/types/index.ts                    — EntityType += observation
  src/capture/entity-extractor.ts       — Agent/Skill + observation extraction
  src/capture/hook-handler.ts           — registry + validator + CLAUDE.md + observations
  src/context/smart-resource-loader.ts  — uses ResourceRegistry
  src/context/resource-tracker.ts       — 8 resource types
  src/mcp/tool-handlers.ts             — overhead report in context_budget
  src/summarizer/session-summarizer.ts  — 3-tier pipeline
  src/search/search-workflow.ts         — hybrid FTS5+TF-IDF+semantic
  src/search/vector-search.ts           — reindex includes observations+embeddings
  src/db/session-store.ts               — getSessionObservations()
  src/hooks-entry/*.ts                  — SKIP_HOOKS recursion guard
```

### Dependencies

```
KEPT:     @modelcontextprotocol/sdk
ADDED:    @huggingface/transformers (optional — semantic search)
```

---

## [0.5.2] - 2026-04-01

### Fixed
- **Viewer JS broken after bundle** — inline `onclick` handlers lost reference when Bun bundled template literal into `cli.js`. Rewrote all JS to IIFE + `addEventListener` pattern
- **Escaped quotes in template literal** — `this.classList.toggle('expanded')` caused `SyntaxError: Unexpected identifier` after bundle. Switched to double quotes and event delegation
- **push-private.sh deletes source** — `git checkout main` removed untracked `src/` directory. Added backup/restore of source dirs around branch switch

### Changed
- **push-public.sh** — fixed version extraction in commit message (`node -p` with proper quoting)

---

## [0.5.1] - 2026-04-01

### Fixed
- **Viewer API crash** — all `db.query()` calls in viewer replaced with `db.prepare().all()` to fix bun:sqlite parameter binding (`SQLITE_MISMATCH` errors on sessions, summaries, entities endpoints)
- **Error handling** — viewer server now catches errors at fetch level with `error()` handler, preventing Bun's default error page from leaking

### Changed
- **UI redesign** — dark gradient theme, stat cards with gradient text, pill-shaped type badges, expandable card content, SVG search icon, improved typography and spacing, responsive grid layout

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
Tracks resource usage across sessions
Identifies unused skills/agents with token cost estimates
Provides recommendations for manual cleanup
NOTE: Claude Code loads ALL resources regardless — this is
      an analysis tool, not a filter. See v0.7.0 for details.
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
