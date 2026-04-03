---
description: Check memory system health, token overhead, and current session activity
allowed-tools: memory_health, memory_context_budget, memory_session_notes
---

Check memory system status for project: $ARGUMENTS

Run these diagnostics in order:

1. **Health check:** Call `memory_health` to verify database integrity, FTS5 index, disk space, and embedding status.

2. **Token budget analysis:** Call `memory_context_budget` with the project name to see:
   - Fixed overhead (skills, agents, commands, CLAUDE.md)
   - Usage analysis (installed vs. used recently)
   - Unused resources wasting tokens
   - Recommendations for optimization

3. **Current session:** If a session_id is available, call `memory_session_notes` to show files touched, decisions made, and errors encountered in the current session.

**Report format:**
- Lead with overall health status (healthy/degraded/error)
- Show token overhead summary
- List actionable recommendations if any
