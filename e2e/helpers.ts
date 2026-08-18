import type { Page } from '@playwright/test';

/** Cards whose label alone is enough to always safely lead a fresh trick as a
 * lone Single (always a legal leading combo) without triggering a follow-up
 * prompt -- i.e. everything except Mahjong ('1', triggers the wish picker)
 * and Dragon ('용', triggers the recipient picker). Phoenix ('봉황') is safe:
 * it is a lone Single like any other, just without a follow-up. Dog ('개') is
 * kept as an absolute last resort since leading it hands the trick straight
 * to the leader's partner (still legal, just an odd move for a bot). */
const PREFERRED_LEAD_ORDER = ['plain', 'phoenix', 'mahjong', 'dragon', 'dog'] as const;

function classifyLeadLabel(label: string): (typeof PREFERRED_LEAD_ORDER)[number] {
  if (label === '용') return 'dragon';
  if (label === '1') return 'mahjong';
  if (label === '개') return 'dog';
  if (label === '봉황') return 'phoenix';
  return 'plain';
}

/** Picks whichever hand card is safest to lead a fresh trick with -- see
 * `PREFERRED_LEAD_ORDER`. Every hand always has at least one card, so this
 * only fails if `labels` itself is empty (a caller bug, not a game state). */
export function pickLeadCardLabel(labels: readonly string[]): string {
  for (const preferred of PREFERRED_LEAD_ORDER) {
    const match = labels.find((label) => classifyLeadLabel(label) === preferred);
    if (match !== undefined) return match;
  }
  throw new Error('no card available to lead with (empty hand?)');
}

const handLocator = (page: Page) => page.locator('ul.hand[aria-label="내 손패"]');

/** Selects the given card by its visible label and submits it as a lone
 * Single leading play, resolving whatever follow-up prompt that specific
 * card triggers (Mahjong -> skip the wish, Dragon -> give the trick to the
 * first eligible opponent) so control returns only once the play is fully
 * settled server-side. */
export async function leadWithCard(page: Page, label: string): Promise<void> {
  await handLocator(page).getByRole('button', { name: label, exact: true }).click();
  await page.getByRole('button', { name: '제출', exact: true }).click();

  if (label === '1') {
    await page.getByRole('group', { name: '소원 카드 선택' }).getByRole('button', { name: '선택 안 함', exact: true }).click();
  } else if (label === '용') {
    await page.getByRole('group', { name: '용 트릭을 받을 상대 선택' }).getByRole('button').first().click();
  }
}

/** Acts for whichever single page currently shows "내 차례입니다": passes
 * when possible (never leading, i.e. someone else's combo is already on the
 * table), otherwise leads a fresh trick with the safest available single --
 * see `pickLeadCardLabel`. Passing is always legal except when leading, and
 * a lone single is always a legal leading play, so this never attempts an
 * illegal move regardless of hand contents. */
async function actOnTurn(page: Page): Promise<void> {
  const passButton = page.getByRole('button', { name: '패스', exact: true });
  // The round can end between the caller's turn-detection snapshot and this
  // call (a broadcast landing on this page in between) -- `count()` is a
  // true non-waiting check, unlike `isEnabled()`/`isVisible()` on a locator
  // that never resolves, which instead wait up to the configured
  // actionTimeout. If the button's gone, this page has already moved past
  // Playing phase; do nothing and let the outer loop notice the round ended.
  if ((await passButton.count()) === 0) return;

  if (await passButton.isEnabled()) {
    // Under this bot's own strategy (only the leader ever adds cards to a
    // trick -- everyone else only ever passes, never beats), the trick pile
    // always holds exactly the leader's one card, so its label alone tells
    // us whether passing needs a Dragon-recipient follow-up: `usePlayFlow`'s
    // `submitPass` routes a pass on a lone-Dragon-best trick through the same
    // `DragonRecipientPicker` step as a winning play (see `submitPass` in
    // `usePlayFlow.ts`) -- clicking 패스 alone only opens that picker, it does
    // NOT send PASS to the server. Missing this follow-up previously caused
    // an infinite stall: the picker replaces the pass button entirely, so
    // every later poll found "my turn" still true with no pass button to act
    // on, forever.
    const trickLabels = await page.locator('.trick .card--mini').allTextContents();
    const isDragonTrick = trickLabels.length === 1 && trickLabels[0] === '용';
    await passButton.click();
    if (isDragonTrick) {
      await page.getByRole('group', { name: '용 트릭을 받을 상대 선택' }).getByRole('button').first().click();
    }
    return;
  }
  const labels = await handLocator(page).getByRole('button').allTextContents();
  await leadWithCard(page, pickLeadCardLabel(labels));
}

/** Drives a room's Playing phase to completion by always passing except when
 * a page must lead a fresh trick (see `actOnTurn`) -- this guarantees every
 * action taken is legal without reimplementing Tichu's combo-legality rules
 * in the test, at the cost of never calling Tichu and never contesting a
 * trick.
 *
 * Waits for the *next* round's "그랜드 티츄" heading rather than "라운드 종료":
 * the server (see `gameServer.ts`'s `applyAction`) broadcasts the RoundOver
 * state and the auto-dealt next round back-to-back with no delay between
 * them, so the RoundOver render is not reliably observable here (React can
 * -- and in practice does -- batch straight through it). This is itself a
 * real product gap worth a human decision (should there be a deliberate
 * pause so players actually see the round summary?), not just a test
 * inconvenience; the test verifies the score update from the *next* round's
 * Playing-phase scoreboard instead, once it's played to that point. */
export async function playRoundAndAwaitNextDeal(pages: readonly Page[]): Promise<void> {
  // Two separate caps: `MAX_REAL_ACTIONS` bounds actual game progress (a
  // generous multiple of the ~42 leads + ~126 passes a 3-players-finish round
  // needs), while `MAX_POLLS` is just a crash guard against a true infinite
  // loop -- most poll iterations are the harmless "state is between broadcasts,
  // retry shortly" branch below and shouldn't count against real progress.
  const MAX_REAL_ACTIONS = 250;
  const MAX_POLLS = 20_000;
  const nextRoundHeading = pages[0].getByRole('heading', { name: '그랜드 티츄' });

  let realActions = 0;
  for (let polls = 0; !(await nextRoundHeading.isVisible()); polls++) {
    if (polls >= MAX_POLLS) throw new Error(`playRoundAndAwaitNextDeal exceeded ${MAX_POLLS} polls without the next round starting`);
    if (realActions >= MAX_REAL_ACTIONS) {
      throw new Error(`playRoundAndAwaitNextDeal did not finish the round within ${MAX_REAL_ACTIONS} actions`);
    }

    // Checked in parallel, not sequentially -- each `isVisible()` is a separate
    // cross-process round trip to that page's browser context, and sequentially
    // awaiting all 4 multiplies per-poll latency by up to 4x.
    const turnFlags = await Promise.all(pages.map((page) => page.getByText('내 차례입니다', { exact: true }).isVisible()));
    const activeIndices = turnFlags.flatMap((isActive, i) => (isActive ? [i] : []));
    // Exactly one page should ever claim the turn. Zero means a transient gap
    // between two broadcasts (including the final one, once the round ends);
    // more than one means some page's own view of a just-superseded turn
    // hasn't re-rendered yet (each of the 4 WS connections updates
    // independently, so a stale positive here is expected, not a bug). Acting
    // on either reading risks operating on the wrong seat, so just retry.
    if (activeIndices.length !== 1) {
      await pages[0].waitForTimeout(30);
      continue;
    }
    await actOnTurn(pages[activeIndices[0]]);
    realActions++;
  }
}

export async function declineGrandTichu(page: Page): Promise<void> {
  await page.getByRole('button', { name: '선언하지 않음', exact: true }).click();
}

/** Assigns each of the three exchange recipients whichever card is still
 * first in their (dynamically shrinking) option list -- any assignment of
 * three distinct cards is a legal exchange, so which cards go to whom
 * doesn't matter for this test. */
export async function submitTrivialExchange(page: Page): Promise<void> {
  const selects = page.locator('.exchange__slots select');
  const count = await selects.count();
  for (let i = 0; i < count; i++) {
    const select = selects.nth(i);
    const firstValue = await select.locator('option:not([value=""])').first().getAttribute('value');
    if (firstValue === null) throw new Error('exchange select has no assignable card option');
    await select.selectOption(firstValue);
  }
  await page.getByRole('button', { name: '교환 제출', exact: true }).click();
}

/** Parses the `Scoreboard`'s "누적 팀 점수 — ...: {n}점 · ...: {n}점" line
 * into `[team02, team13]`. Throws if the line isn't rendered (i.e. no
 * `cumulativeScores` was passed to `Scoreboard` at all) rather than the
 * caller silently comparing against `undefined`. */
export async function readCumulativeScores(page: Page): Promise<readonly [number, number]> {
  const text = await page.locator('.scoreboard__totals').textContent();
  if (text === null) throw new Error('cumulative score line (.scoreboard__totals) not rendered');
  const matches = [...text.matchAll(/(-?\d+)점/g)].map((m) => Number(m[1]));
  if (matches.length !== 2) throw new Error(`expected exactly 2 score values in "${text}", found ${matches.length}`);
  return [matches[0], matches[1]];
}

/** Creates a fresh room as its first (host) player and returns the room code
 * shown in the waiting room, for the other players to join with. */
export async function createRoom(page: Page, name: string): Promise<string> {
  await page.goto('/');
  await page.getByRole('button', { name: '사람과 플레이', exact: true }).click();
  await page.getByLabel('이름', { exact: true }).fill(name);
  await page.getByRole('button', { name: '방 만들기', exact: true }).click();
  await page.getByRole('heading', { name: '대기실' }).waitFor();
  const codeText = await page.locator('.waiting-room__code strong').textContent();
  if (codeText === null) throw new Error('room code not rendered in waiting room');
  return codeText.trim();
}

export async function joinRoom(page: Page, name: string, roomCode: string): Promise<void> {
  await page.goto('/');
  await page.getByRole('button', { name: '사람과 플레이', exact: true }).click();
  await page.getByLabel('이름', { exact: true }).fill(name);
  await page.getByLabel(/방 코드/).fill(roomCode);
  await page.getByRole('button', { name: '방 입장', exact: true }).click();
  await page.getByRole('heading', { name: '대기실' }).waitFor();
}
