---
name: work-summary
description: Summarize and update the current conversation's registered session file, then show it — session goal, its place in the larger work hierarchy, concrete progress and next steps, and any work handed off to other sessions. Manual only; never runs automatically.
metadata:
  origin: project
---

# Work Summary

Answers, on demand, the question "what was I doing here and what's left?" by reading and updating this conversation's session file. Only runs when explicitly invoked — it never rewrites the log silently in the background.

## When to Use

- The user asks for a status check / summary of the current session (e.g. "/work-summary", "지금까지 뭐 했는지 정리해줘").
- Before wrapping up a work session, to leave the log in a state that's useful for resuming later.

## Precondition

This conversation must have a session slug registered via [session-start](../session-start/SKILL.md) earlier in the same conversation. If it doesn't:

- Say so plainly, and offer to run `/session-start` first.
- Do not invent or guess a slug, and do not silently create one.

## Shared paths across worktrees

`.claude/worklog/` is gitignored, so it is **not** carried into a `git worktree add` checkout — each worktree gets its own separate, empty copy unless you resolve the main worktree's real location first:

```bash
MAIN_ROOT="$(cd "$(git rev-parse --git-common-dir)/.." && pwd)"
```

Every `.claude/worklog/...` path below means `$MAIN_ROOT/.claude/worklog/...`, regardless of which worktree this skill is running in.

## Steps

1. **Locate the session file** — `.claude/worklog/sessions/<slug>.md` (see path resolution above), using the slug registered earlier in this conversation.

2. **Reconstruct what happened since the file was last written**, from this conversation's own history (messages, tool calls, files touched, commits made) — not from re-reading old sections of the file as if they were new information.

3. **Update the file**, editing in place (don't append duplicate copies of unchanged sections):
   - `진행 로그`: append one dated entry (`### MM-DD HH:MM — <title>`) summarizing what was actually done and any user decisions made, in the same spirit as `commit-checkpoint`'s log entries — capture *why*, not a diff restatement.
   - `시도했다 안 된 것`: append anything that was tried and abandoned, with the concrete reason — this is the section most worth getting right, since it stops a future session from repeating a dead end.
   - `현재 다음 작업`: overwrite with the actual next step, as specifically as possible.
   - `미해결 블로커`: overwrite with whatever is still unresolved (or "없음").
   - `상태`: update to `완료` if the user confirms the session's goal is done, `보류` if it's being paused indefinitely, otherwise leave as `진행중`.
   - If `상태` changed, also update the matching row in `.claude/worklog/sessions-summary.md` (same path resolution as above).

4. **Resolve the hierarchy** for display: read `상위 세션` in this file, and if set, follow it in `sessions-summary.md` up the chain (parent of parent, etc.) until empty, to show which larger effort this session belongs to.

5. **Find outsourced work**: scan `.claude/worklog/sessions-summary.md` (main worktree copy) for rows whose 상위 세션 equals this session's slug — these are sessions that were spawned from this one in another window. List them with their 목적 and 상태.

6. **Present the summary to the user**, covering exactly these four things:
   1. 이 세션의 목표 (from `목적`)
   2. 상위 작업 단위 (the parent chain resolved in step 4, or "없음" if top-level)
   3. 구체적으로 한 일과 다음에 할 일 (from the freshly updated `진행 로그` tail and `현재 다음 작업`)
   4. 다른 세션으로 넘긴 작업 (from step 5, or "없음")

## Guardrails

- Never run unless explicitly invoked — no Stop-hook or other automatic trigger calls this.
- Never fabricate progress that didn't happen in this conversation.
- If nothing meaningful changed since the last update, say so plainly instead of padding the log with a content-free entry.
