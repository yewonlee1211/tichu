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
   - `git diff --stat` and `git diff --staged --stat` — shape of the change without pulling full content yet
   - Pull full `git diff`/`git diff --staged` content only for files whose purpose isn't obvious from the stat line alone (needed to judge mixed concerns in step 2, or to write an accurate body). Skip full-content diffing for files where the stat line is already enough (e.g. a single-purpose config/doc tweak).
   - `git log -5 --oneline` — match this repo's existing message style

   If there is nothing to commit, say so and stop.

2. **Check for mixed concerns**
   - If the diff spans clearly unrelated changes (e.g. an unrelated bug fix bundled with a new feature), propose splitting into multiple commits. Otherwise propose one commit covering the completed todo(s).

3. **Draft the commit**
   - Format per [git-workflow.md](../../rules/ecc/common/git-workflow.md): `<type>: <description>`, type ∈ {feat, fix, refactor, docs, test, chore, perf, ci}.
   - **Write the `<description>` in Korean.** Mixing in English technical terms/proper nouns is fine and expected (e.g. `feat: self-play 상대 풀 및 혼합 상대 학습 지원 추가`), but the description must not be entirely English (e.g. `chore: refine commit tagging, add session overlap check and worktree-merge` is not acceptable — rewrite it in Korean with English terms mixed in as needed). This applies to the subject line only; any tag prefixes (`[M<N> Phase<P>]`, `[Docker]`, `[Tooling]`, etc.) and the `<type>` keyword stay as-is.
   - **Tag the related milestone/phase, when there is one:**
     - **Fast bypass first**: if every staged file falls under a path with no plausible milestone connection (`.claude/`, root-level config/docs, etc.) and none of them sit next to milestone code in the same commit, skip straight to the category-tag check below — don't open the PRD or any plan file at all.
     - Otherwise, read only the Delivery Milestones table in `.claude/prds/*.prd.md` (not the whole file) to get the milestone numbers and each one's linked `.claude/plans/*.plan.md`.
     - For each candidate plan, don't read the whole plan file — grep it for the `Files to Change` section (e.g. `Grep` for `Files to Change` with enough trailing context to capture the table) and check the staged files against two signals, in order of strength:
       1. **Exact match** — the file is listed literally in that table.
       2. **Directory match** — the file lives under a directory the table already established as belonging to that milestone (e.g. the M2 plan owns `ai/eval/`, `ai/agents/`, `ai/tichu_env/`, `ai/training/` — a new file under one of those counts even if it didn't exist when the plan was written).
     - Judge the **commit as a whole**, not file-by-file — a commit doesn't need every staged file to match. If the substantive files clearly belong to one milestone's directory tree, tag the whole commit even if it also touches a small companion artifact outside that tree (e.g. a new Claude skill written specifically to exercise or narrate that milestone's code).
     - If exactly one plan/phase clearly matches, prefix the subject: `[M<N> Phase<P>] <type>: <description>` (e.g. `[M2 Phase4] feat: ...`; use `Phase4~5` if the work spans a documented phase range, matching this repo's existing convention).
     - Ask the user instead of guessing when it's genuinely ambiguous — e.g. staged files split roughly evenly across more than one plan/phase.
     - Only omit the milestone tag when nothing in the diff is plausibly related to any milestone at all (e.g. a commit that's purely `.claude/` tooling/config with no companion milestone code alongside it).
   - **Add a category tag when the commit is clearly about a recognizable cross-cutting concern rather than milestone feature work** — e.g. `[Docker]` (container/dev-environment changes, already used in this repo's history) or `[Tooling]` (`.claude/` skills, hooks, settings — dev workflow itself, not product code). Only when a category tag looks plausible, check `git log --oneline` for a tag spelling already in use before inventing a new one — don't run this check on commits that clearly need neither tag.
     - If a milestone tag also applies, the milestone comes first: `[M<N> Phase<P>][Category] <type>: ...` (matches this repo's existing `[M1 Phase3][Docker]` precedent).
     - If no milestone applies but a category clearly does, the category tag stands alone at the front: `[Tooling] <type>: ...`.
     - Don't force a category tag onto ordinary milestone feature work that doesn't belong to a named cross-cutting concern — most commits should have zero or one tag type, not a category tag by default.
   - No `Co-Authored-By` trailer — attribution is disabled for this project.
   - Message body (if needed) explains *why*, not a restatement of the diff.
   - List the exact files to stage — never propose `git add -A` / `git add .`.

4. **Ask for approval — do not skip this step**
   - Present the proposed message and file list to the user.
   - Wait for explicit confirmation or edits before running any repo-mutating git command.
   - No affirmative response → stop, do not commit.

5. **Commit**
   - `git add <specific files>`
   - `git commit -m "<approved message>" -- <specific files>` — **always repeat the exact same file list as a pathspec on the commit itself**, never a bare `git commit -m "..."`. In this repo, multiple sessions can share one working directory/index outside a worktree; a bare commit picks up *whatever happens to be staged at that instant*, including files another session staged between your `add` and `commit`. The pathspec makes the commit atomic with respect to exactly the files you reviewed, regardless of what else is staged.
   - `git status` to confirm the result.

6. **Log it (if a session is registered)**
   - If this conversation registered a session via [session-start](../session-start/SKILL.md), append one `진행 로그` entry to that session's file. `.claude/worklog/` is gitignored, so inside a worktree its path must be resolved against the main worktree, not the current one: `MAIN_ROOT="$(cd "$(git rev-parse --git-common-dir)/.." && pwd)"`, then write to `$MAIN_ROOT/.claude/worklog/sessions/<slug>.md` — short sha, commit subject, and what the user actually asked for/decided in this unit of work, not a restatement of the diff.
   - If no session is registered in this conversation, skip silently — don't prompt the user to register one just to log a commit.
   - This step is best-effort: never let a log write failure block or undo a completed commit.

## Guardrails

- Never `git add -A` / `git add .` — stage only reviewed files.
- Never amend, force-push, or `--no-verify`.
- If a pre-commit hook fails, fix the underlying issue and create a **new** commit rather than retrying with `--no-verify`.
- If the user doesn't approve, leave the working tree untouched.
