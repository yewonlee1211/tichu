---
name: commit-checkpoint
description: Draft a commit at a natural checkpoint (e.g. after a TodoWrite list is fully completed) and only commit after explicit user approval of the message and file scope.
metadata:
  origin: project
---

# Commit Checkpoint

Turns a detected "good time to commit" moment into a low-friction, human-approved commit. This skill never runs `git commit` without explicit user confirmation — it only shortens the path from "todo list is done" to "here's a commit to approve."

## When to Use

- The `commit-checkpoint` PostToolUse hook (on TodoWrite, see `.claude/settings.json`) reports that every todo is completed and the working tree is dirty.
- The user asks to commit ("커밋해줘", "commit this", "지금 커밋할까?") after finishing a chunk of work.
- Manually via `/commit-checkpoint` at any natural pause point.

## Steps

1. **Inspect state**
   - `git status --porcelain` — changed/untracked files
   - `git diff` and `git diff --staged` — the actual content of the change
   - `git log -5 --oneline` — match this repo's existing message style

   If there is nothing to commit, say so and stop.

2. **Check for mixed concerns**
   - If the diff spans clearly unrelated changes (e.g. an unrelated bug fix bundled with a new feature), propose splitting into multiple commits. Otherwise propose one commit covering the completed todo(s).

3. **Draft the commit**
   - Format per [git-workflow.md](../../rules/ecc/common/git-workflow.md): `<type>: <description>`, type ∈ {feat, fix, refactor, docs, test, chore, perf, ci}.
   - No `Co-Authored-By` trailer — attribution is disabled for this project.
   - Message body (if needed) explains *why*, not a restatement of the diff.
   - List the exact files to stage — never propose `git add -A` / `git add .`.

4. **Ask for approval — do not skip this step**
   - Present the proposed message and file list to the user.
   - Wait for explicit confirmation or edits before running any repo-mutating git command.
   - No affirmative response → stop, do not commit.

5. **Commit**
   - `git add <specific files>`
   - `git commit -m "<approved message>"`
   - `git status` to confirm the result.

6. **Log it (if a session is registered)**
   - If this conversation registered a session via [session-start](../session-start/SKILL.md), append one `진행 로그` entry to that session's file (`.claude/worklog/sessions/<slug>.md`) — short sha, commit subject, and what the user actually asked for/decided in this unit of work, not a restatement of the diff.
   - If no session is registered in this conversation, skip silently — don't prompt the user to register one just to log a commit.
   - This step is best-effort: never let a log write failure block or undo a completed commit.

## Guardrails

- Never `git add -A` / `git add .` — stage only reviewed files.
- Never amend, force-push, or `--no-verify`.
- If a pre-commit hook fails, fix the underlying issue and create a **new** commit rather than retrying with `--no-verify`.
- If the user doesn't approve, leave the working tree untouched.
