# Handoff: 서버 라운드 종료 처리 + AI 모델 자산 배치 + E2E 통합/문서화

**상위 세션**: `2026-07-30-m1-web-kickoff` (M1 총괄 세션) — 시작 시 `/session-start`로 이 값을 상위 세션으로 등록할 것
**소스 플랜**: `.claude/plans/tichu-online.plan.md` — 이 문서의 **Phase 5, Task 21-22** + 아래 Task 0-1(신규, `tichu-client-ui` 세션이 완료 기준 검증 중 발견해 남긴 갭)
**의존성**: 다른 모든 하위 세션 완료·병합됨(`master` 기준 `be5a6a1`까지) — M1의 마지막 단계. 단, 아래 Task 0/1 없이는 Task 21의 E2E가 애초에 통과할 수 없으므로 먼저 처리할 것

## 배경: 이 세션에 추가된 두 가지 선행 작업
`tichu-client-ui` 세션이 자기 완료 기준(4탭 멀티플레이어 한 라운드 완주+점수 반영, AI 오프라인 재생)을 검증하다가 두 가지 실제 갭을 발견하고 "범위 밖"으로 보류 남김 — 총괄 세션에서 이 세션 범위로 포함하기로 결정함.

### Task 0: `packages/server/src/gameServer.ts` — 라운드 종료 후 점수 계산 + 다음 라운드 딜
**현재 상태(확인됨)**: `dealNewRound()`는 `handleStartGame`에서 딱 한 번만 호출되고, 어떤 액션의 결과로 `state.phase === Phase.RoundOver`가 되더라도 `applyAction`은 그냥 그 상태를 브로드캐스트만 할 뿐 이후 처리가 없다. 즉 라운드가 끝나면 게임이 그 자리에서 멈춘다.

**참고 구현**: `packages/client/src/ai/soloGame.ts`의 `finishRoundAndDeal()`이 이미 이 로직을 클라이언트 로컬 버전으로 구현해뒀다 — `scoreRound(state)` → 팀 누적 점수에 합산 → `isGameOver(cumulativeScores)`면 매치 종료, 아니면 `dealNewRound()`. 서버는 이 흐름을 방(room) 단위로, 소켓 브로드캐스트로 재현하면 된다.

**해야 할 일**:
- `GameRoom` 인터페이스(`gameServer.ts`)에 `cumulativeScores: readonly [number, number]`(초기값 `[0, 0]`) 추가
- `applyAction`(또는 별도 헬퍼)에서 리듀서 결과의 `phase === Phase.RoundOver`를 감지하면: `scoreRound(newState)`(`@tichu/shared`, `Result<readonly [number,number], string>` 반환) 호출 → 누적 점수에 합산 → `isGameOver(cumulativeScores)`(`DEFAULT_TARGET_SCORE` 기본값 사용) 체크 → 게임 안 끝났으면 `dealNewRound()`로 새 라운드 딜 후 그 상태도 브로드캐스트
- 클라이언트가 누적 점수를 볼 수 있어야 하므로 `packages/shared/src/protocol.ts`의 `PlayerView`에 `cumulativeScores: readonly [number, number]` 필드 추가(SoloGame과 동일한 필드명으로 맞출 것 — `packages/client`의 `TableViewModel` 어댑터가 이미 `fromSoloGameState`에서 이 필드를 다루고 있으므로 `fromPlayerView` 쪽만 맞추면 됨)
- **Validate**: 4인 모의 클라이언트로 한 라운드를 끝까지 플레이 → `STATE_UPDATE`의 `cumulativeScores`가 갱신되고 자동으로 다음 라운드가 시작되는지 통합 테스트로 확인

### Task 1: AI 모델 자산을 `packages/client/public/models/`에 배치
**현재 상태(확인됨)**: `loadModel.ts`/`modelCache.ts`는 `/models/policy.onnx.enc`, `/models/manifest.json`을 fetch하지만 이 파일들이 아직 존재하지 않는다. `ai/export/export_onnx.py`는 `--checkpoint`/`--out` 인자로 단일 `.onnx.enc`만 만들 뿐, **`manifest.json`을 생성하는 코드가 어디에도 없다**(이번에 처음 확인된 갭).

**해야 할 일**:
- `ai/export/`에 manifest 생성 단계 추가(예: `export_onnx.py`에 `--manifest-out` 옵션을 추가해 `{"iteration": N}`을 같이 쓰게 하거나, 별도의 작은 스크립트로 분리 — 구현 방식은 이 세션 재량)
- 컨테이너 안에서 실행(`docker compose exec ai ...`): 현재 M2 학습이 만들어낸 체크포인트 중 최신(또는 가장 성능 좋은) `checkpoint_*.pt`를 골라 export → `packages/client/public/models/policy.onnx.enc` + `manifest.json`(iteration 번호 일치) 생성
- `packages/client/public/models/`가 `.gitignore` 대상인지 확인(모델 바이너리를 매번 git에 커밋할지, 아니면 배포 스크립트로만 다루고 커밋에서 제외할지는 이 세션에서 판단 — M2가 계속 학습 중이라 파일이 자주 바뀔 수 있음을 감안)
- **Validate**: `pnpm --filter client dev` 상태에서 브라우저로 "AI와 연습하기" 진입 → 정상 로드 확인 → devtools에서 오프라인 전환 후 재진입해도 캐시로 로드되는지 확인(client-ui 세션이 자산 부재로 못 했던 바로 그 수동 QA)

## 이 세션이 할 일 (기존 Task 21-22)
1. **Task 21**: Playwright E2E
   - `e2e/full-game.spec.ts` — 4개 브라우저 컨텍스트로 방 생성부터 라운드 종료(점수 반영, Task 0 반영)까지 사람 vs 사람 전체 플레이
   - `e2e/solo-ai.spec.ts` — 혼자 모드(1인 vs AI 3자리), 네트워크 오프라인 시뮬레이션 포함(Task 1로 배치된 실제 모델 자산 사용)
2. **Task 22**: 커버리지 확인 및 문서화
   - `packages/shared`, `packages/server`, `packages/client` 커버리지 80%+ 확인
   - 루트 `CLAUDE.md`에 스택/구조/실행 명령 작성(그린필드 첫 종합 문서) — Task 1에서 판단한 모델 자산 배포 방식(커밋 대상 여부, 재배포 절차)도 문서화
   - "혼합 방 확장 지점"(`protocol.ts`의 주석, `decideAiMove.ts`의 순수 함수 분리)이 문서에 명시되어 있는지 확인
   - `client-ui` 세션이 "범위 밖"으로 남긴 다른 항목도 확인: 멀티플레이어 대기실의 실시간 참가자 수 표시는 프로토콜에 없어 여전히 미구현 상태 — 이번에 고칠지, PRD Open Question으로 남길지 판단(MVP 필수 아님)

## Validate
```bash
pnpm -w test -- --coverage
pnpm exec playwright test
docker compose exec ai pytest --cov=export
```

## 완료 기준
- [ ] Task 0: 사람 vs 사람 라운드 종료 시 점수 계산 + 다음 라운드 자동 딜 동작
- [ ] Task 1: `packages/client/public/models/`에 실제 모델 자산 배치, 오프라인 재생 수동 QA 통과
- [ ] `.claude/plans/tichu-online.plan.md`의 Acceptance 체크리스트 전 항목 통과
- [ ] `.claude/prds/tichu-online.prd.md`의 Milestone 1 상태를 `complete`로 갱신
- [ ] 완료 후 `2026-07-30-m1-web-kickoff` 세션에 최종 보고 — M1 총괄 세션도 이 시점에 `상태: 완료`로 전환 검토
