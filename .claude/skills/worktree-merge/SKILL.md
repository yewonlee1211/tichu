---
name: worktree-merge
description: Rebase a worktree session's branch onto the main branch and merge it back — mirrors the rebase-based team workflow (fetch main, rebase, resolve conflicts using the sessions this repo tracks, then fast-forward merge). Manual, user-invoked only.
metadata:
  origin: project
---

# Worktree Merge

Brings a finished worktree session's branch back into the main branch via rebase, the way a rebase-based remote team workflow does — but adapted to this repo's current reality (no `origin` remote configured yet; everything happens locally across worktrees on the same machine). If a remote gets added later, insert a push/PR step where noted below rather than redesigning the flow.

## When to Use

- A session working in its own `git worktree` on its own branch has finished its work and wants to bring it into the main branch.
- Not for regular same-worktree commits — that's [commit-checkpoint](../commit-checkpoint/SKILL.md). This skill is specifically about integrating a *branch* back into the main line.

## Precondition

- Must be run from inside the feature branch's worktree (not the main branch's worktree).
- `git branch --show-current` must not be the main branch. If it is, stop and say so.
- Determine the main branch name (`master` in this repo — confirm with `git symbolic-ref refs/remotes/origin/HEAD` if a remote exists, otherwise ask if genuinely ambiguous).

## Steps

1. **Acquire the merge lock.** Only one worktree-merge should be in flight at a time, since it eventually touches the shared main branch.
   - Generate a random identifier once at the start of this run — e.g. `SID=$(date +%s)-$RANDOM` — and reuse that exact value for every step below in this same invocation. (`$CLAUDE_SESSION_ID`/`$ECC_SESSION_ID` are only injected into hook processes, not into ordinary Bash tool calls — confirmed empty when checked directly — so they can't be used here.)
   - `.claude/.locks/` is gitignored, so it is **not** shared by `git worktree add` — each worktree would otherwise get its own separate, empty `.locks/` directory, which would make the lock a no-op (two worktrees could each create their own "lock" and never see each other). Always resolve it against the main worktree, from whichever worktree this skill is running in: `MAIN_ROOT="$(cd "$(git rev-parse --git-common-dir)/.." && pwd)"`, then use `$MAIN_ROOT/.claude/.locks/main-merge.lock` for every reference below.
   - Ensure `$MAIN_ROOT/.claude/.locks/` exists.
   - Check `$MAIN_ROOT/.claude/.locks/main-merge.lock`:
     - Doesn't exist → create it atomically: `set -o noclobber; echo "$SID $(date)" > "$MAIN_ROOT/.claude/.locks/main-merge.lock"` (bash `noclobber` makes this an exclusive create, not a check-then-write race).
     - Exists, content starts with `$SID` → it's already ours (e.g. resuming after a conflict pause), proceed.
     - Exists, owned by someone else, and its mtime is recent (< ~30 minutes) → **stop**, tell the user another session appears to be merging right now.
     - Exists, owned by someone else, mtime older than ~30 minutes → likely abandoned (crashed mid-merge); tell the user and ask before removing it and taking over — don't silently reclaim a merge lock the way a plain edit lock might, since an in-progress conflict resolution can legitimately take a while.

2. **Sync main.**
   - If `git remote get-url origin` succeeds: `git fetch origin <main-branch>`.
   - If there's no remote (current state of this repo): nothing to fetch — the local main branch ref is already authoritative since everyone shares one machine.

3. **Rebase onto main**, from the feature branch's own worktree: `git rebase <main-branch>` (or `origin/<main-branch>` once a remote exists).

4. **If the rebase reports conflicts, do not resolve blind:**
   - List the conflicted files.
   - For each one, check `$MAIN_ROOT/.claude/worklog/sessions-summary.md` and the relevant `sessions/<slug>.md` files (same `$MAIN_ROOT` resolved in step 1) for **any session** (this branch's own, and others) whose `관련 파일` or `진행 로그` mentions that file — read their stated intent/decisions so the resolution reflects *why* each side changed what it changed, not just a blind textual pick.
   - Propose a resolution per file and show it to the user before staging it — this is a silent code change if done wrong, treat it with the same care as `commit-checkpoint`'s approval step.
   - After approval: `git add <resolved files>`, `git rebase --continue`. Repeat until the rebase finishes.
   - If it gets too tangled, `git rebase --abort` is always available — offer it rather than pushing through a resolution nobody's confident in.

5. **Hand off to the main branch's worktree for the actual merge.** You cannot `git checkout <main-branch>` from inside the feature branch's worktree while main is checked out elsewhere — git blocks that. Instead:
   - Find where main is checked out: `git worktree list`.
   - From *that* worktree, run `git merge --ff-only <feature-branch>`. It should fast-forward cleanly since the branch was just rebased onto main's tip — if it doesn't fast-forward, main moved again since step 2; go back to step 2.

6. **Release the lock**: remove `$MAIN_ROOT/.claude/.locks/main-merge.lock` (only if it's owned by this `$SID`).

7. **Once a remote exists** (not yet the case in this repo): before step 5, push the rebased branch (`git push --force-with-lease origin <feature-branch>`) and either open a PR or merge remotely instead of merging locally — never force-push a shared branch without the user's explicit go-ahead.

8. **Offer cleanup, don't do it unasked**: after a successful merge, ask whether to remove the feature branch and its worktree (`git worktree remove`, `git branch -d`) — this is destructive-ish, confirm first.

9. **Session bookkeeping**: if the merged branch corresponds to a registered session slug, suggest running [work-summary](../work-summary/SKILL.md) to mark it 완료.

## Guardrails

- Never rebase the main branch itself — only feature branches get rebased onto it.
- Never force-push without explicit user confirmation, and only once a remote actually exists.
- Never resolve a conflict without showing the proposed resolution first — see step 4.
- If the merge lock is held by someone else and looks genuinely active, wait and tell the user rather than bypassing it.
- `git rebase --abort` is always a safe way out mid-conflict; prefer it over forcing through a resolution under uncertainty.
