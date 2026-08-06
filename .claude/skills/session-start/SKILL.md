---
name: session-start
description: Register the current conversation as a named work session so it can be found later — records its goal, parent session (if any), relevant files, and initial plan. Manual, user-invoked only; never automatic.
metadata:
  origin: project
---

# Session Start

Registers this conversation as a discrete, resumable unit of work. This is opt-in — impromptu questions or quick one-offs don't need it. Only run this when the user actually asks to start/register a session.

## When to Use

- The user explicitly asks to start a tracked session (e.g. "새 세션 등록해줘", "/session-start").
- Not for every conversation — skip for quick questions with no ongoing thread to resume later.

## Inputs Needed From the User

Before writing anything, make sure you have:

1. **목적** — what this session is actually trying to accomplish.
2. **관련 파일** — files/directories this session will mostly touch (if known yet).
3. **상위 세션** — is this session a sub-piece of a larger effort already tracked in `sessions-summary.md`? If the user names one loosely (e.g. "회원가입 기능"), search `.claude/worklog/sessions-summary.md` for a matching slug and confirm which one they mean rather than guessing.
4. **초기 계획** — the rough plan as of right now (this will evolve; `/work-summary` updates it later, not this skill).

Ask for anything missing — don't invent a goal or a parent session the user didn't state.

## Steps

1. **Gather the four inputs above.**
2. **Check for file overlap with other active sessions.** For every row in `.claude/worklog/sessions-summary.md` with 상태 = 진행중, open its `sessions/<slug>.md` and compare its `관련 파일` entries against the new session's. Treat it as an overlap when paths are identical, or one is a directory containing the other (e.g. `ai/eval/` vs `ai/eval/train.py`). This is a **warning, not a block** — broad directory-level overlap is often fine. If any overlap is found, tell the user which session(s) and files overlap and ask whether to proceed anyway; don't silently continue or silently abort.
3. **Propose a slug.** Format: `YYYY-MM-DD-<kebab-case-short-desc>`, derived from the 목적. Offer 2-3 candidates and let the user pick or edit one. Don't finalize without approval.
4. **Ask whether this session gets its own git worktree.** Isolation via worktree is what makes [worktree-merge](../worktree-merge/SKILL.md) usable later, and it's the recommended default for any session that will edit source files another concurrent session might also touch — but it's still a yes/no ask, not automatic, since quick/doc-only/exploratory sessions don't need it.
   - If the user declines, skip to step 5 with no worktree — this session works directly in the current (already checked-out) worktree, same as today.
   - If the user accepts:
     - Determine the base branch: `git branch --show-current` in the current worktree (this is almost always the main branch, since new sessions normally start from it).
     - Propose a default branch name and worktree path derived from the slug — branch `<slug>`, path `../<repo-dir-name>-<slug>` (sibling directory to this repo). Let the user accept or edit either.
     - Run `git worktree add <path> -b <branch> <base-branch>`.
     - If it fails (e.g. path collision, dirty base branch), report the error and ask the user how to proceed — don't silently fall back to no-worktree and don't let it block registering the session itself if the user wants to continue without one.
     - On success, remember the path and branch for step 5's template and tell the user their session's files now live at `<path>`, not here — further work on this session should happen in a Claude Code window opened at that path.
5. **Create the session file** at `.claude/worklog/sessions/<slug>.md` (create the `sessions/` directory if it doesn't exist yet) using this template:

   ```markdown
   ---
   slug: <slug>
   상위 세션: <parent-slug-or-omit>
   상태: 진행중
   ---

   ## 목적
   <목적>

   ## 관련 파일
   - <file/dir>

   ## 워크트리
   <경로와 브랜치, 예: `../tichu-game-<slug>` (브랜치 `<slug>`) — 또는 워크트리 없이 메인 워크트리에서 진행이면 "없음 — 메인 워크트리에서 진행">

   ## 초기 계획
   <계획>

   ## 진행 로그
   (아직 없음)

   ## 시도했다 안 된 것
   (아직 없음)

   ## 현재 다음 작업
   <초기 계획에서 가장 먼저 할 일>

   ## 미해결 블로커
   (없음)
   ```

6. **Add a row to the index** `.claude/worklog/sessions-summary.md`: `| <slug> | <목적 한 줄> | <상위 slug 또는 빈칸> | 진행중 |`.
7. **Remember the slug for the rest of this conversation.** Do not write a separate pointer file — `/work-summary` and `commit-checkpoint`'s logging step rely on this conversation already knowing its own registered slug from having run this skill. If asked to register a session again later in the same conversation (e.g. the goal genuinely changed), treat it as a new registration and update what "the current slug" means from that point on.
8. **Confirm to the user**: show the created file path and the index row, mention the overlap check result from step 2 (even if "no overlap found"), and if a worktree was created, restate its path so the user knows where to open their next window.

## Guardrails

- Never overwrite an existing session file with the same slug without asking — if a collision happens, pick a different slug or ask the user whether they mean to resume that existing session instead (in which case use `/work-summary` on it, not this skill).
- Don't fabricate a parent session — if the user isn't sure, leave 상위 세션 empty rather than guessing.
- Never create a worktree without the user's explicit yes — step 4 is an ask, not a default.
- This skill only writes the *initial* state. It never updates 진행 상황/다음 작업/블로커 after creation — that's `/work-summary`'s job.
