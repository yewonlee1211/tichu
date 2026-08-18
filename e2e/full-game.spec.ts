import { test, expect } from '@playwright/test';
import { createRoom, declineGrandTichu, joinRoom, playRoundAndAwaitNextDeal, readCumulativeScores, submitTrivialExchange } from './helpers';

const PLAYER_NAMES = ['Alice', 'Bob', 'Carol', 'Dave'] as const;

test('four players create a room, play a round to completion, and the server scores it + auto-deals the next round', async ({ browser }) => {
  test.setTimeout(120_000);

  const contexts = await Promise.all(PLAYER_NAMES.map(() => browser.newContext()));
  const pages = await Promise.all(contexts.map((context) => context.newPage()));

  try {
    const roomCode = await createRoom(pages[0], PLAYER_NAMES[0]);
    for (let seat = 1; seat < pages.length; seat++) {
      await joinRoom(pages[seat], PLAYER_NAMES[seat], roomCode);
    }

    // Only seat 0 (the host) can start the game -- see WaitingRoom.tsx.
    await pages[0].getByRole('button', { name: '게임 시작', exact: true }).click();

    await Promise.all(pages.map((page) => page.getByRole('heading', { name: '그랜드 티츄' }).waitFor()));
    for (const page of pages) {
      await declineGrandTichu(page);
    }

    await Promise.all(pages.map((page) => page.getByRole('heading', { name: '카드 교환' }).waitFor()));
    for (const page of pages) {
      await submitTrivialExchange(page);
    }

    // Task 0: play round 1 to completion. The server scores it into
    // cumulativeScores and auto-deals round 2 -- no client ever sends a "start
    // next round" action in multiplayer (see RoundOverSummary.tsx's doc
    // comment: only solo mode gets an `onNextRound` button). The RoundOver
    // screen itself isn't reliably observable in the DOM (see
    // playRoundAndAwaitNextDeal's doc comment for why), so this waits for
    // round 2's Grand Tichu phase to appear instead of the RoundOver heading.
    await playRoundAndAwaitNextDeal(pages);

    // Confirm round 2 actually started fresh for everyone, then play into its
    // Playing phase, where the Scoreboard shows cumulativeScores again (Grand
    // Tichu/Exchange phases don't render it at all) -- proving round 1's score
    // actually carried forward, not just that a new round started.
    await Promise.all(pages.map((page) => page.getByRole('heading', { name: '그랜드 티츄' }).waitFor()));
    for (const page of pages) {
      await declineGrandTichu(page);
    }
    await Promise.all(pages.map((page) => page.getByRole('heading', { name: '카드 교환' }).waitFor()));
    for (const page of pages) {
      await submitTrivialExchange(page);
    }
    await pages[0].getByRole('button', { name: '패스', exact: true }).waitFor();

    const scores = await readCumulativeScores(pages[0]);
    expect(scores[0] !== 0 || scores[1] !== 0).toBe(true);
    for (const page of pages.slice(1)) {
      expect(await readCumulativeScores(page)).toEqual(scores);
    }
  } finally {
    await Promise.all(contexts.map((context) => context.close()));
  }
});
