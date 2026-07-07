# Plan: 사람 vs 사람 온라인 대전

**Source PRD**: `.claude/prds/tichu-online.prd.md`
**Selected Milestone**: Milestone 1 — 사람 vs 사람 온라인 대전 (두 명 이상의 사용자가 실시간으로 온라인에서 Tichu를 플레이할 수 있다)
**Complexity**: Large

## Summary
현재 저장소에는 `.claude/`(ECC 하네스 설정)만 존재하고 실제 프로젝트 코드는 없는 완전한 그린필드 상태다. 이번 플랜은 4인용 Tichu를 실시간으로 사람 vs 사람으로 플레이할 수 있는 최소 기반을 구축한다: 카드 규칙 엔진(공유 패키지) → 서버 권위적 WebSocket 게임 서버(방 생성/입장, 턴 진행, 재접속) → React 클라이언트(로비 + 게임 테이블 UI). Milestone 2(AI 대결)와 Milestone 3(로그 수집)이 이 구조 위에 얹힐 수 있도록, 규칙 엔진은 입출력에서 완전히 분리하고 서버는 모든 상태 전이를 이벤트로 발행하는 구조로 설계한다.

기술 스택(사용자 결정): TypeScript 풀스택(Node.js 서버 + React 프론트엔드), 커스텀 WebSocket 서버(서버 권위적 상태), pnpm workspaces 모노레포.

## Patterns to Mirror
그린필드 프로젝트이므로 미러링할 기존 코드 패턴이 없다. 대신 이번 마일스톤에서 이후 코드가 따라야 할 초기 컨벤션을 다음과 같이 확립한다:

| Category | 결정 사항 |
|---|---|
| Naming | 파일/함수: `camelCase`, 타입/컴포넌트: `PascalCase`, 상수: `UPPER_SNAKE_CASE` (rules/common/coding-style.md 준수) |
| Error handling | 규칙 엔진은 불변 값 객체 + `Result<T, E>` 스타일 반환(예외 대신 명시적 에러 값)으로 잘못된 카드 조합/턴 위반을 표현. 서버는 클라이언트에 `{type: "ERROR", code, message}` 프로토콜 메시지로 전달 |
| Logging | 서버는 구조화 로그(JSON) 사용, Milestone 3에서 재사용할 수 있도록 게임 이벤트 로그와 운영 로그를 분리 |
| Data access | Milestone 1은 영속 저장소 없음 — 방/게임 상태는 서버 메모리(in-process Map)에만 보관. DB 도입은 Milestone 3(로그 수집)에서 다룸 |
| Tests | Vitest 사용, 규칙 엔진은 순수 함수 단위 테스트 위주(AAA 패턴), 서버는 WebSocket 통합 테스트 |

## Files to Change
| File | Action | Why |
|---|---|---|
| `package.json`, `pnpm-workspace.yaml`, `tsconfig.base.json` | CREATE | pnpm workspaces 모노레포 루트 설정 |
| `packages/shared/src/cards.ts` | CREATE | 56장 덱(일반 52 + Dog/Mahjong/Phoenix/Dragon) 모델 및 생성/셔플 |
| `packages/shared/src/combinations.ts` | CREATE | 카드 조합 판정(싱글/페어/트리플/스트레이트/풀하우스/봄) 및 비교(강도) 로직 |
| `packages/shared/src/gameState.ts` | CREATE | 불변 게임 상태 타입 + 상태 전이 리듀서(딜, 교환, 턴, 트릭, 티츄 콜, 라운드 종료) |
| `packages/shared/src/scoring.ts` | CREATE | 라운드 스코어링(더블 아웃, 마지막 카드 트릭, 티츄/그랜드 티츄 보너스·패널티) |
| `packages/shared/src/protocol.ts` | CREATE | 클라이언트-서버 WebSocket 메시지 타입 정의(공유) |
| `packages/shared/src/*.test.ts` | CREATE | 규칙 엔진 단위 테스트 (커버리지 80%+ 목표) |
| `packages/server/src/index.ts` | CREATE | WebSocket 서버 엔트리포인트 |
| `packages/server/src/room.ts` | CREATE | 방 생성/입장/퇴장, 좌석 배정(4인), 방 코드 발급 |
| `packages/server/src/session.ts` | CREATE | 연결-플레이어 세션 매핑, 재접속 토큰 처리 |
| `packages/server/src/gameServer.ts` | CREATE | 방별 게임 루프: 액션 수신 → 규칙 엔진 호출 → 상태 브로드캐스트 |
| `packages/server/src/*.test.ts` | CREATE | 방 생명주기 + 게임 흐름 통합 테스트 |
| `packages/client/` (Vite + React) | CREATE | 로비(방 생성/입장) + 게임 테이블(손패, 트릭, 액션 버튼) UI |
| `packages/client/src/ws/useGameSocket.ts` | CREATE | WebSocket 연결/재연결 훅, 프로토콜 메시지 송수신 |
| `e2e/full-game.spec.ts` (Playwright) | CREATE | 4개 브라우저 컨텍스트로 한 판 전체 플레이 E2E |
| `.claude/prds/tichu-online.prd.md` | UPDATE | Milestone 1 status → in-progress, Plan 경로 기록 |

## Tasks

### Phase 0 — 모노레포 스캐폴드
#### Task 1: 워크스페이스 초기화
- **Action**: `pnpm-workspace.yaml`(`packages/*`), 루트 `package.json`(scripts: `dev`, `build`, `test`, `lint`, `typecheck`), 공통 `tsconfig.base.json`, ESLint/Prettier 설정 생성
- **Mirror**: 신규 컨벤션(위 표) 최초 적용
- **Validate**: `pnpm install`이 에러 없이 완료

#### Task 2: 패키지 스캐폴드
- **Action**: `packages/shared`, `packages/server`, `packages/client`(Vite React+TS 템플릿) 생성, 상호 참조를 위한 workspace 의존성 연결
- **Mirror**: -
- **Validate**: `pnpm -w typecheck` 통과(빈 프로젝트 기준)

### Phase 1 — 공유 규칙 엔진 (`packages/shared`)
#### Task 3: 카드/덱 모델
- **Action**: `cards.ts`에 Suit/Rank/특수카드(Dog, Mahjong, Phoenix, Dragon) 타입, 56장 덱 생성 및 셔플 함수 구현
- **Validate**: 단위 테스트로 덱 크기(56), 중복 없음, 셔플 후 분포 검증

#### Task 4: 카드 조합 판정/비교
- **Action**: `combinations.ts`에 싱글/페어/트리플/풀하우스/스트레이트/스트레이트 봄/포카드 봄 판정 함수와 두 조합 간 강도 비교(같은 타입만 비교 가능, 봄은 예외) 구현
- **Validate**: 대표 조합별 판정 단위 테스트 + Phoenix/Dragon 특수 규칙 케이스

#### Task 5: 라운드 흐름 상태 머신
- **Action**: `gameState.ts`에 불변 `GameState` 타입과 리듀서 작성: 딜링(8장 그랜드 티츄 콜 → 14장 전원 배분) → 카드 교환(3인 각 1장) → 턴 순환(패스/플레이/봄 인터럽트) → 라운드 종료 조건(1명 제외 전원 아웃 또는 전원 아웃) 판정
- **Validate**: 시나리오 기반 단위 테스트(정상 라운드, 더블 아웃, 마지막 플레이어 원 투 카드 이관)

#### Task 6: 스코어링
- **Action**: `scoring.ts`에 라운드 점수 계산(트릭 점수 카드 합산, 티츄/그랜드 티츄 성공·실패 ±100/±200, 더블 아웃 200점, 마지막 카드 상대팀 이관 규칙) 구현
- **Validate**: PRD 표준 규칙 기준 점수 계산 단위 테스트

#### Task 7: 클라이언트-서버 프로토콜 정의
- **Action**: `protocol.ts`에 메시지 타입 정의: `JOIN_ROOM`, `LEAVE_ROOM`, `START_GAME`, `CALL_GRAND_TICHU`, `CALL_TICHU`, `EXCHANGE_CARDS`, `PLAY_CARDS`, `PASS`, `STATE_UPDATE`(플레이어별로 자신의 손패만 노출되는 view), `ERROR`, `RECONNECT`
- **Validate**: 타입 컴파일 통과, server/client 양쪽에서 import 가능한지 확인

### Phase 2 — 게임 서버 (`packages/server`)
#### Task 8: 방(Room) 생명주기
- **Action**: `room.ts`에 방 코드 생성(예: 6자 영숫자), 4석 좌석 배정(팀 자동 편성: 마주보는 좌석이 한 팀), 방 삭제(전원 퇴장 시) 구현
- **Validate**: 통합 테스트로 방 생성 → 4명 입장 → 5번째 입장 거부 확인

#### Task 9: 세션/재접속
- **Action**: `session.ts`에 연결별 재접속 토큰 발급, 연결 끊김 시 유예 시간(예: 60초) 동안 좌석 보존 후 봇 대체 없이 대기, 유예 시간 내 동일 토큰으로 재연결 시 상태 재동기화
- **Validate**: WebSocket 연결 강제 종료 후 재연결 시 동일 손패/턴 상태 복원되는 통합 테스트

#### Task 10: 게임 루프 연결
- **Action**: `gameServer.ts`에서 클라이언트 액션 메시지를 `packages/shared`의 리듀서에 위임하고, 결과 상태를 각 플레이어 시점(view)으로 마스킹하여 브로드캐스트. 불법 액션은 상태 변경 없이 `ERROR` 응답
- **Validate**: 통합 테스트로 4인 모의 클라이언트가 한 라운드를 끝까지 진행

### Phase 3 — 클라이언트 (`packages/client`)
#### Task 11: 로비 화면
- **Action**: 방 생성/방 코드 입력으로 입장 화면, 좌석 표시, 4명 모이면 방장이 게임 시작 버튼 활성화
- **Validate**: 수동 확인 + 컴포넌트 단위 테스트(react-review 스킬 기준 반영)

#### Task 12: WebSocket 훅
- **Action**: `useGameSocket.ts`에서 연결, 재연결 토큰 저장(localStorage), 프로토콜 메시지 송수신을 캡슐화한 훅 작성
- **Validate**: 연결 끊김 시뮬레이션 테스트

#### Task 13: 게임 테이블 UI
- **Action**: 손패 표시/선택, 제출/패스/티츄 콜 버튼, 현재 트릭, 팀 점수판, 턴 표시 렌더링
- **Validate**: 수동 QA로 4개 브라우저 탭에서 한 판 완주

### Phase 4 — 통합 및 검증
#### Task 14: E2E 전체 게임 플레이
- **Action**: Playwright로 4개 브라우저 컨텍스트가 방 생성부터 라운드 종료(점수 반영)까지 자동 플레이하는 시나리오 작성
- **Validate**: `pnpm exec playwright test` 통과

#### Task 15: 커버리지 확인 및 문서화
- **Action**: `packages/shared`, `packages/server` 커버리지 80%+ 확인, 루트 `CLAUDE.md` 초안 작성(스택/구조/실행 명령)
- **Validate**: `pnpm -w test -- --coverage` 리포트 확인

## Validation
```bash
pnpm install
pnpm -w typecheck
pnpm -w lint
pnpm -w test -- --coverage
pnpm --filter server dev &
pnpm --filter client dev &
pnpm exec playwright test
```

## Risks
| Risk | Likelihood | Mitigation |
|---|---|---|
| 실시간 멀티플레이어 동기화 복잡도 (PRD 명시 리스크) | Medium | 서버 권위적 상태 + 플레이어별 view 마스킹으로 단일 소스 유지, 상태 전이는 순수 함수로 격리해 테스트 용이성 확보 |
| Tichu 규칙 엣지 케이스(봄 인터럽트, 마지막 카드 이관, 더블 아웃) 오구현 | High | Phase 1에서 시나리오 기반 단위 테스트를 규칙 확정 전 먼저 작성(TDD), 표준 규칙 문서 대조 |
| WebSocket 연결 끊김/새로고침 시 게임 중단 | Medium | Task 9의 재접속 유예 로직으로 완화. 유예 시간 초과 처리(예: 자동 패스/게임 중단)는 Open Question으로 남김 — 이번 계획 범위에서는 유예 시간 내 재접속만 보장 |
| 4인 미만일 때 게임 시작 불가로 인한 테스트/개발 마찰 | Low | 개발 편의를 위한 로컬 전용 "solo 4-tab 테스트 모드" 문서화(제품 기능 아님) |

## Open Questions (이번 계획에서 결정하지 않음)
- 재접속 유예 시간 초과 시 처리(자동 패스 vs 게임 종료)는 Milestone 1 범위에서 임시로 "게임 종료 후 방 유지"로 처리하고, 정교한 처리는 후속 이슈로 분리
- 배포/호스팅 방식은 이번 계획에 포함하지 않음(PRD Open Question과 동일하게 미정) — 로컬 개발 환경 기준으로 계획

## Acceptance
- [ ] Phase 0~4 모든 태스크 완료
- [ ] `pnpm -w test`, `pnpm -w typecheck`, `pnpm -w lint`, Playwright E2E 모두 통과
- [ ] 규칙 엔진(`packages/shared`) 테스트 커버리지 80%+
- [ ] 4개의 서로 다른 브라우저 탭에서 방 생성 → 입장 → 한 라운드 플레이 → 점수 반영까지 수동으로 재현 가능
- [ ] 연결 끊김 후 유예 시간 내 재접속 시 게임 상태 복원 확인
- [ ] 그린필드 첫 계획이므로 확립한 컨벤션(Naming/Error handling/Tests)이 실제 코드에 일관 적용됨

---
*Status: DRAFT PLAN — 코드 작성 전, 사용자 확인 대기 중.*
