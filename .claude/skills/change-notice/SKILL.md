---
name: change-notice
description: Update the lobby's static announcement (title/body in packages/client/src/content/announcement.ts) from a plain-language request and commit it with a fixed [NOTICE] message. Manual, user-invoked only; never automatic.
metadata:
  origin: project
---

# Change Notice

Updates the lobby announcement content (`packages/client/src/content/announcement.ts`'s `title`/`body`, rendered by `HomePage.tsx` — see `2026-09-16-m1-lobby-announcement`) from whatever the user writes in plain language, then commits just that file with a fixed message format. This is a fast path for a single, low-risk content edit — not a general commit-checkpoint flow.

## When to Use

- The user asks to change/update the lobby notice ("공지사항 바꿔줘", "공지 내용 수정", "/change-notice") and gives (or is about to give) a title and content.

## Steps

1. **Extract 제목(title) and 내용(body)** from the user's message. They may write it in any phrasing (e.g. `제목은 X. 내용은 'Y'`) — parse it, don't require a rigid format.
   - If either is missing or genuinely ambiguous, ask rather than guessing. Don't invent wording.
2. **Read** `packages/client/src/content/announcement.ts` first (required before Edit).
3. **Edit** only the `title` and `body` fields inside the `announcement` object to the new values — leave the rest of the file (the `Announcement` interface, the explanatory comment above the constant) untouched.
4. **Commit immediately** — this skill's whole point is skipping the usual draft-and-approve round trip for this one low-risk content file:
   - Stage only `packages/client/src/content/announcement.ts`.
   - Commit message is **exactly**: `[NOTICE] 공지사항 - <title>` — the literal new title, no other prefix/type tag, no body text appended. E.g. title `V2.2 공지사항` → `[NOTICE] 공지사항 - V2.2 공지사항`.
   - No `Co-Authored-By` trailer (attribution is disabled for this project, per `CLAUDE.md`/`commit-checkpoint`).
   - Always commit with an explicit pathspec (`git commit -m "..." -- packages/client/src/content/announcement.ts`), never a bare `git commit` — other sessions may share this working directory/index.
5. **Report back**: show the new title/body and the commit sha, and remind the user this only changed the source file — it won't appear on the deployed site (`https://d3eaqeztt5cahh.cloudfront.net`) until a redeploy. Ask if they want `/deploy-client` run now; don't run it without that ask.

## Guardrails

- Only ever touches `packages/client/src/content/announcement.ts` — never stage or commit any other changed file, even if the working tree has other unrelated modifications sitting around.
- Don't ask for commit-message approval the way `commit-checkpoint` does — the fixed `[NOTICE] 공지사항 - <title>` format *is* the approval contract for this skill. Do still ask if the extracted title/body is ambiguous (step 1).
- Never run `/deploy-client` as part of this skill automatically — that's still a separate, explicit ask (step 5).
