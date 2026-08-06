# Handoff: 사람 vs 사람 게임 서버 (`packages/server`)

**상위 세션**: `2026-07-30-m1-web-kickoff` (M1 총괄 세션) — 시작 시 `/session-start`로 이 값을 상위 세션으로 등록할 것
**소스 플랜**: `.claude/plans/tichu-online.plan.md` — 이 문서의 **Phase 2, Task 10-12**
**의존성**: `tichu-web-shared-engine` 세션의 산출물(`packages/shared` — 특히 `gameState.ts`, `protocol.ts`)이 완료되어 있어야 함. 시작 전 해당 세션 상태 확인
**이 작업을 기다리는 것**: `tichu-client-ui` 세션(로비 화면이 이 서버에 붙음)

## 배경
사람 vs 사람 대전은 Node.js + TypeScript WS 서버가 규칙 엔진을 권위적으로 실행한다(Python 관여 없음). AI 대국(혼자 모드)은 이 서버와 완전히 별개의 경로이므로 **이 세션에서는 AI 관련 코드를 다루지 않는다** — 혼합 방(사람+AI 같은 방)은 명시적으로 post-MVP.

## 착수 전 확인: protocol.ts 갭 (그랜드 티츄 콜 / 카드 교환)
`web-shared-engine` 세션이 완료한 `protocol.ts`에는 `JOIN_ROOM`/`START_GAME`/`CALL_TICHU`/`PLAY_CARDS`/`PASS`/`STATE_UPDATE`/`ERROR`/`RECONNECT`만 있고, 그랜드 티츄 결정과 카드 교환용 메시지가 없다(Task 9 범위 밖이라 의도적으로 비워둔 것). 규칙 엔진 쪽(`packages/shared/src/gameState.ts`)에는 이미 로직이 있으므로 — Python `decide_large_tichu(state, player, called)`, `exchange_cards(state, gifts: dict[int, dict[int, Card]])`에 대응해서 TS에도 `Gifts = Record<number, Record<number, Card>>` 타입이 이미 포팅되어 있음 — **Task 12(게임 루프 연결)에서 이 세션이 `protocol.ts`에 아래 두 메시지를 추가**할 것(작은 추가이므로 소유권 상 문제 없음):

```ts
export interface DecideGrandTichuMessage {
  readonly type: 'DECIDE_GRAND_TICHU';
  readonly called: boolean;
}

export interface ExchangeCardsMessage {
  readonly type: 'EXCHANGE_CARDS';
  // key = 받는 좌석 번호(자기 자신 제외 3명), value = 그 좌석에 줄 카드
  readonly gifts: Readonly<Record<number, Card>>;
}
```

서버(`gameServer.ts`)는 `EXCHANGE_CARDS`를 4명 전원에게서 받을 때까지 모았다가, 전원분이 모이면 하나의 `Gifts` 객체로 합쳐 `exchangeCards(state, gifts)`를 호출할 것 — Python `Phase.EXCHANGE` 흐름과 동일.

## 이 세션이 할 일
1. **Task 10**: `packages/server/src/room.ts` — 방 코드 생성(6자 영숫자 등), 4석 좌석 배정(마주보는 좌석이 한 팀), 방 삭제(전원 퇴장 시). **AI 좌석 채우기 기능은 넣지 않음** — 나중에 필요하면 `protocol.ts`에 이미 남겨둔 주석 지점에 추가
2. **Task 11**: `packages/server/src/session.ts` — 연결별 재접속 토큰 발급, 연결 끊김 시 유예 시간(예: 60초) 동안 좌석 보존, 유예 시간 내 재연결 시 상태 재동기화
3. **Task 12**: `packages/server/src/gameServer.ts` — 클라이언트 액션 메시지를 `packages/shared`의 리듀서에 위임, 결과를 플레이어별 view로 마스킹해 브로드캐스트. 불법 액션은 상태 변경 없이 `ERROR` 응답
4. `packages/server/src/index.ts` — WS 서버 엔트리포인트

## 컨벤션 (`tichu-web-shared-engine` 세션과 동일하게 유지)
- `camelCase`/`PascalCase`, Vitest, `{type:"ERROR",code,message}` 프로토콜 에러 응답
- 서버는 구조화 로그(JSON) — 게임 이벤트 로그와 운영 로그 분리(M3 로그 수집 마일스톤에서 재사용 예정이므로 지금부터 분리해둘 것)
- 영속 저장소 없음 — 방/게임 상태는 서버 메모리(in-process Map)에만 보관

## Validate
```bash
pnpm -w typecheck
pnpm -w lint
pnpm --filter server test -- --coverage
pnpm --filter server dev
```

## 완료 기준
- [ ] 방 생성 → 4명 입장 → 5번째 입장 거부 통합 테스트 통과
- [ ] 강제 연결 종료 후 유예 시간 내 재연결 시 상태 복원 통합 테스트 통과
- [ ] 4인 모의 클라이언트가 한 라운드를 끝까지 진행하는 통합 테스트 통과
- [ ] 완료 후 `2026-07-30-m1-web-kickoff` 세션에 완료 보고
