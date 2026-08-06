# Handoff: AI 대국 혼자 모드 — 브라우저 로컬 추론 (`packages/client/src/ai`)

**상위 세션**: `2026-07-30-m1-web-kickoff` (M1 총괄 세션) — 시작 시 `/session-start`로 이 값을 상위 세션으로 등록할 것
**소스 플랜**: `.claude/plans/tichu-online.plan.md` — 이 문서의 **Phase 3, Task 15-17**
**의존성**:
- `tichu-web-shared-engine` 세션의 `packages/shared/src/encoding.ts`, `gameState.ts`, `combinations.ts` 등이 완료되어 있어야 함
- `tichu-ai-onnx-export` 세션의 `.onnx.enc` 산출물 + 입출력 계약 문서가 있어야 함
- 시작 전 두 세션 모두 상태 확인. 아직 완료되지 않았다면 인터페이스만 보고 stub으로 먼저 골격을 잡는 것은 가능하나, 실제 검증은 두 의존성이 준비된 뒤에

## 배경
AI 대국(혼자 모드)은 **서버를 전혀 거치지 않는 순수 브라우저 단일플레이**다 — 사용자 1명 + AI 봇 3자리, 랭킹 없음, 완전 오프라인 플레이 가능해야 한다(비용 최소화가 최우선 제약). 이 세션이 그 핵심 경로를 만든다.

## 이 세션이 할 일
1. **Task 15**: `packages/client/src/ai/loadModel.ts`
   - `tichu-ai-onnx-export`가 만든 `.onnx.enc`를 fetch → 역인코딩(디코딩) → `onnxruntime-web` 세션 생성
   - Cache Storage(Service Worker, `packages/client/src/sw.ts`)로 캐싱해 오프라인 재생 가능하게
   - 체크포인트 iteration 번호를 캐시 키/버전 태그로 사용 — 새 iteration 감지 시에만 재다운로드(모델이 나중에 고정되면 이 로직은 그대로 두되 사실상 갱신이 멈춤)
2. **Task 16**: `packages/client/src/ai/decideAiMove.ts`
   - **순수 함수**로 작성: 입력은 (관측 벡터, 후보 액션 벡터들, ONNX 세션)만 — 모델 로딩/캐싱/브라우저 API에 의존하지 않을 것
   - `packages/shared/src/encoding.ts`로 만든 벡터를 그대로 받아 ONNX 세션에 통과시키고, 반환된 `action_logits` 중 하나(argmax 또는 온도 샘플링)를 선택된 액션 인덱스로 반환
   - **이렇게 분리하는 이유**: 지금은 MVP라 혼자 모드(브라우저)만 지원하지만, 나중에 혼합 방(사람+AI 같은 방)을 지원하게 되면 서버(Node, `onnxruntime-node`)에서도 이 함수를 그대로 재사용할 수 있어야 한다 — 로딩/캐싱 계층만 새로 짜면 되게
3. **Task 17**: `packages/client/src/ai/soloGame.ts`
   - 서버 없이 `packages/shared`의 리듀서 + `decideAiMove`로 1인 vs AI 3자리 게임을 진행하는 로컬 게임 루프
   - 네트워크 호출이 전혀 없어야 함(테스트에서 이를 명시적으로 확인)

## 컨벤션
- `camelCase`, Vitest, `packages/shared`와 동일한 타입 재사용(별도 프로토콜 불필요 — WS를 안 타므로)

## Validate
```bash
pnpm --filter client typecheck
pnpm --filter client test -- --coverage
# 오프라인 시뮬레이션: 브라우저 devtools Network 탭에서 offline 전환 후 재플레이 확인
```

## 완료 기준
- [ ] 알려진 상태(골든 픽스처)에 대해 `decideAiMove`가 항상 합법 액션 중 하나를 반환
- [ ] 네트워크 차단 상태에서 두 번째 접속 시 캐시된 모델로 정상 로드 및 플레이 가능(오프라인 확인)
- [ ] 혼자 모드 한 라운드가 네트워크 호출 없이 완주됨
- [ ] 완료 후 `2026-07-30-m1-web-kickoff` 세션에 완료 보고
