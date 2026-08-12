# Handoff: 클라이언트 UI (`packages/client` — 로비/게임 테이블/AI 진입점)

**상위 세션**: `2026-07-30-m1-web-kickoff` (M1 총괄 세션) — 시작 시 `/session-start`로 이 값을 상위 세션으로 등록할 것
**소스 플랜**: `.claude/plans/tichu-online.plan.md` — 이 문서의 **Phase 4, Task 18-20**
**의존성**: `tichu-web-shared-engine`, `tichu-multiplayer-server`, `tichu-solo-ai-browser` 셋 다 `master`에 병합 완료됨(아래는 그 실제 API를 기준으로 작성). 새 세션은 `master` 기준 worktree에서 시작하면 됨 — 더 이상 mock 필요 없음

## 배경
사람 vs 사람과 AI 대국(혼자 모드) 두 경로를 모두 지원하는 클라이언트 UI. 두 모드는 진입점이 다르지만(전자는 WS 서버 연결, 후자는 로컬 전용, 네트워크 호출 없음) 게임 테이블 UI 컴포넌트는 최대한 공용으로 만든다.

## 참고: 실제 병합된 API (추측하지 말고 그대로 사용)

### 사람 vs 사람 — `packages/shared/src/protocol.ts` (WS 메시지)
**Client → Server**: `JOIN_ROOM{roomCode, playerName}`(roomCode를 빈 문자열로 보내면 서버가 새 방 코드를 발급), `START_GAME`, `CALL_TICHU`, `DECIDE_GRAND_TICHU{called}`, `EXCHANGE_CARDS{gifts: Record<recipientSeat, Card>}`(자기 좌석 제외 3명분), `PLAY_CARDS{cards, wish?, dragonRecipient?}`, `PASS{dragonRecipient?}`, `RECONNECT{reconnectToken}`

**Server → Client**: `ROOM_JOINED{roomCode, seat, reconnectToken}`(JOIN_ROOM/RECONNECT 성공 직후 1회 — 방 코드·좌석·재접속 토큰은 이 메시지로만 받을 수 있음, `reconnectToken`은 로비/게임 화면 전환 시 유지하도록 localStorage에 저장할 것), `STATE_UPDATE{view: PlayerView}`(액션이 있을 때마다), `ERROR{message}`

`PlayerView`는 `viewerSeat`, `hand`, `handSizes`, `trickCards`, `collectedPoints`, `phase`, `currentPlayer`, `trickLeader`, `currentBest`, `currentStrength`, `lastPlayerToAct`, `finishedOrder`, `tichuCalls`, `largeTichuCalls`, `mahjongWish` 필드를 가짐(자기 손패만 보이고 남의 손패는 안 옴).

방 생명주기는 `packages/server/src/room.ts` 참고: 4석은 입장 순서대로 채워지며 0/2석, 1/3석이 자동으로 한 팀. AI 좌석 채우기는 **없음**(설계대로 MVP 범위 밖).

### AI 대국(혼자 모드) — `packages/client/src/ai/soloGame.ts`, `loadModel.ts`
서버/네트워크 없이 동작. 사용 흐름:
```ts
import { loadModel } from './ai/loadModel';
import { SoloGame, HUMAN_SEAT } from './ai/soloGame';

const session = await loadModel(); // 최초 1회: 모델 fetch+캐싱, 이후 오프라인이면 캐시 사용
const game = new SoloGame({ session }); // 사람은 항상 seat 0(HUMAN_SEAT), 좌석 선택 UI 없음(MVP 고정)
```
- `game.getState(): GameState` — 현재 상태(=UI 렌더 소스)
- `game.getCumulativeScores(): readonly [number, number]`, `game.isMatchOver(targetScore?)`
- `game.decideHumanLargeTichu(called): Result<GameState,string>` — 그랜드 티츄 결정(AI 3자리는 생성 시점에 자동으로 거절 처리됨)
- `game.submitHumanExchange(humanGifts: Record<number,Card>): Promise<Result<GameState,string>>` — 사람의 카드 교환 제출(AI 3자리는 내부적으로 자동 계산)
- `game.humanCallTichu(): Result<GameState,string>`
- `game.humanPlayCombo(cards, wish?, dragonRecipient?): Promise<Result<GameState,string>>`
- `game.humanPassTurn(dragonRecipient?): Promise<Result<GameState,string>>`
- `game.humanLegalCombos(): Combo[]` — 카드 선택 UI에서 제출 가능 여부 검증용
- `game.finishRoundAndDeal(deck?): GameState` — 라운드 종료 후 다음 라운드 딜(매치가 끝났으면 상태 유지)

**중요한 불변식**: `human*` 계열 메서드가 resolve된 직후에는 항상 `getState().phase === RoundOver`이거나 `getState().currentPlayer === HUMAN_SEAT` 중 하나다 — AI 턴은 항상 그 안에서 전부 처리되고 반환됨. 즉 UI는 AI 턴 진행을 직접 몰라도 되고, `humanPlayCombo`/`humanPassTurn`/`submitHumanExchange` 호출 후 바로 다음 사람 차례 상태를 그리면 된다. 다만 이 메서드들이 `Promise`(비동기)라는 점은 로딩 표시에 반영할 것(AI 추론 시간 동안).

`loadModel()`은 최초 호출 시 네트워크가 없으면 예외를 던진다("AI model is not cached yet and the network is unavailable") — "AI와 연습하기" 진입점에서 이 경우를 잡아 "최초 1회는 온라인 필요" 안내를 보여줄 것.

## 이 세션이 할 일
1. **Task 18**: 로비 화면(사람 vs 사람) — 방 생성/방 코드 입장, 좌석 표시, 4명 모이면 방장이 게임 시작. 위 protocol.ts 메시지 그대로 사용
2. **"AI와 연습하기" 진입점(Task 19)** — 위 `soloGame.ts`/`loadModel.ts` 사용. 최초 로드 시 모델 다운로드 진행률 표시(용량이 크므로 명시적으로 보여줄 것), 오프라인 상태에서 캐시 없이 처음 진입한 경우의 에러 메시지 처리
3. **Task 20**: 게임 테이블 UI — 손패 표시/선택, 제출/패스/티츄 콜/그랜드 티츄 결정/카드 교환 버튼, 현재 트릭, 팀 점수판, 턴 표시. 사람 vs 사람의 `PlayerView`와 혼자 모드의 `GameState`(사람 시점으로 이미 seat 0 고정)가 필드가 거의 같으니 공용 렌더 컴포넌트로 만들되, 데이터 소스 어댑터만 분리
4. `packages/client/src/ws/useGameSocket.ts` — 사람 vs 사람 전용 WS 연결/재연결 훅. `ROOM_JOINED`에서 받은 `reconnectToken`을 localStorage에 저장하고, 재연결 시 `RECONNECT` 메시지로 사용

## 컨벤션
- React + Vite + TS, 컴포넌트 `PascalCase`, 훅 `use` 프리픽스
- 접근성/반응형은 이 프로젝트 범위에서 필수는 아니지만 기본적인 시맨틱 HTML은 유지

## Validate
```bash
pnpm --filter client dev
pnpm --filter client test
```

## 완료 기준
- [ ] 4개의 서로 다른 브라우저 탭에서 방 생성 → 입장 → 한 라운드 플레이(그랜드 티츄/카드 교환 포함) → 점수 반영까지 수동 재현 가능
- [ ] "AI와 연습하기"로 혼자 모드 시작 → 오프라인 전환 후에도 재플레이 가능(수동 QA)
- [ ] 완료 후 `2026-07-30-m1-web-kickoff` 세션에 완료 보고 (PRD/메인 플랜 갱신은 총괄 세션이 수행)
