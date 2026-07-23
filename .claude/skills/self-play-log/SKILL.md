---
name: self-play-log
description: Play one Tichu round between two chosen players (trained checkpoints and/or the heuristic bot) and save a Korean natural-language narration log with every turn's legal actions and policy scores.
metadata:
  origin: project
---

# Self-Play Log

Runs `ai/eval/narrate_game.py` for a single Tichu round between two chosen players and writes a human-readable Korean log the user can read directly -- turn-by-turn actions, every legal action's policy score, trick results, and the final round outcome. This is a qualitative check (how does the model actually play?), not the quantitative win-rate/Elo evaluation `eval/arena.py` already covers.

## When to Use

- The user types `/self-play-log`.
- Natural-language requests like "이 체크포인트끼리 붙여서 로그 뽑아줘", "학습된 AI 대결 로그 만들어줘", "checkpoint 200이랑 300 붙여봐".

## Prerequisites

- The `ai` Docker service must be running (`docker compose ps` to check; `docker compose up -d ai` if not). All commands below run inside it via `docker compose exec ai ...` -- the host has no PyTorch installed.

## Steps

1. **Find available models**

   ```bash
   docker compose exec ai python -c "
   import os
   root = 'checkpoints'
   for run in sorted(os.listdir(root)):
       run_path = os.path.join(root, run)
       if not os.path.isdir(run_path):
           continue
       pts = sorted(f for f in os.listdir(run_path) if f.endswith('.pt'))
       print(run, '->', pts)
   "
   ```

   This lists every run directory and its checkpoints (by iteration number).

2. **Confirm which two players to pit against each other**
   - If the user's request already names both sides concretely (e.g. "run2_entropy의 200과 300"), use those directly -- skip asking.
   - Otherwise, ask via `AskUserQuestion` (one question for team A, one for team B). Offer every checkpoint found in step 1 (labeled `<run>/<checkpoint>`, e.g. `run2_entropy/checkpoint_300`) plus `휴리스틱 봇` as options. `latest` (newest checkpoint in a run) is also a valid choice if the user prefers not to pin an exact iteration.

3. **Seed**
   - Don't ask about this by default -- omitting `--seed` makes the script pick and report its own random seed (in both the log body and the output filename), which is enough for a one-off qualitative look.
   - Only pass an explicit `--seed <N>` if the user wants a specific hand reproduced (e.g. to compare two checkpoints on the exact same deal, as in earlier sessions).

4. **Run it**

   ```bash
   docker compose exec ai python -m eval.narrate_game \
     --checkpoint <team A checkpoint path or 'latest'> \
     --checkpoint-dir <team A's run directory> \
     --opponent <team B checkpoint path, 'heuristic', or 'latest'> \
     --opponent-checkpoint-dir <team B's run directory -- omit if team B is 'heuristic'> \
     --team-a-seats 0,2
   ```

   - Checkpoint paths/dirs must be **relative to the container's working directory** (e.g. `checkpoints/run2_entropy/checkpoint_300.pt`), never absolute host paths (see Guardrails).
   - Leave `--output` unset unless the user names a specific file -- the script auto-names it `game_logs/<A id>_vs_<B id>_seed<N>.txt`.
   - Add `--stochastic` only if the user explicitly wants sampled (non-greedy) play instead of each network's best move.

5. **Report back**
   - State the saved file path.
   - Read the log's `## 라운드 종료` section and summarize the outcome in 1-2 sentences (winner, score, double-out or not).
   - Mention a genuinely notable detail if one jumps out (e.g. a bomb played, a very lopsided confidence split, a big Dragon trick) -- keep it brief.
   - Don't paste the whole file into the chat -- the point of this skill is a file the user reads themselves.

6. **Log to the session (only if one is registered)**
   - If this conversation registered a session via `/session-start`, append one line to that session's `진행 로그` (players compared, seed, outcome, file path).
   - If no session is registered, skip silently -- don't prompt the user to register one just to log this.

## Guardrails

- Always use container-relative checkpoint paths (`checkpoints/...`). Absolute host paths (e.g. `/tmp/...`) get mangled by Windows Git Bash before reaching the container, creating a bogus directory inside it -- this bit a previous session (`2026-07-22-m2-training-run`).
- If `checkpoints/` or a named run directory doesn't exist, say so -- don't guess a path.
- `--team-a-seats` must be one partner pair (`0,2` or `1,3`); the script validates this, but explain the constraint up front if the user asks for something else.
- This skill plays exactly **one round** per invocation. If the user wants a trend across many games, point them at `eval/arena.py` (win rate/Elo) instead -- this skill is for reading what actually happened, not aggregating outcomes.
