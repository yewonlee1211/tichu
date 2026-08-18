# Plan: 사람 vs 사람 온라인 대전 + AI 대국(혼자 모드, 브라우저 로컬 추론)

**Source PRD**: `.claude/prds/tichu-online.prd.md`
**Selected Milestone**: Milestone 1 — 사람 vs 사람 온라인 대전, Milestone 2(AI 대결)와의 웹 연동 지점 포함
**Complexity**: Large

## Summary
두 차례 아키텍처 논의를 거쳐 확정된 구조:

1. **사람 vs 사람**은 Node.js + TypeScript WS 서버가 규칙 엔진(TS 포트)을 권위적으로 실행한다. Python 백엔드는 이 경로에 전혀 관여하지 않는다.
2. **AI 대국(MVP)은 서버를 아예 거치지 않는 순수 브라우저 단일플레이 모드**다 — 사용자 1명 + AI 봇 3자리, 랭킹 없음(연습/재미 목적), **완전 오프라인 플레이 가능**해야 한다. 최초 로드 시 번들이 커지는 것은 감수한다.
   - AI 모델은 `ai/agents/policy_network.py`의 학습된 가중치를 **ONNX로 내보내 브라우저에서 onnxruntime-web(WASM)으로 직접 실행**한다. 서버 왕복도, 별도 Python 추론 프로세스도 없다 — "매 턴 API 호출 비용"이라는 원래 우려 자체가 구조적으로 사라진다.
   - 모델 가중치가 브라우저에 그대로 노출되는 것은 **사용자가 수용한 리스크**다(랭킹 없음, 크게 개의치 않음). 다만 캐주얼한 추출(우클릭 저장/URL 직접 접근)을 막는 가벼운 바이트 인코딩 정도는 적용한다 — 진짜 보안이 아니라 마찰(friction) 수준으로 기대치를 맞춘다.
   - M2 모델은 아직 학습 중이므로, ONNX export는 **체크포인트 iteration을 캐시 키로 삼아 버전 관리**한다(모델이 나중에 고정되면 이 버전 로직은 그대로 두되 사실상 갱신이 멈춘다).
3. **혼합 방(사람+AI 같은 방)은 MVP 범위 밖**, 추후 과제로 명시적으로 미룬다. 다만 "상태+합법액션 → 선택된 액션"을 계산하는 AI 의사결정 함수는 모델 로딩/캐싱(브라우저 전용 코드)과 분리해서 짜, 나중에 서버(Node, `onnxruntime-node`)에서도 같은 함수를 재사용해 혼합 방을 지원할 수 있는 여지만 남겨둔다(지금 구현하지 않음).
4. TS 규칙 엔진(및 신규 encoding 포트)은 그린필드로 손으로 옮기지 않고, `ai/tichu_env`의 기존 테스트에서 뽑은 **골든 픽스처**로 검증해 두 언어 구현이 갈라지는 위험을 없앤다.

**진행 순서(어디서부터 시작할지)**: Phase 1(공유 규칙 엔진)과 Phase 3(AI 혼자 모드)은 서로 독립적이라 병행 가능하다. Phase 2(멀티플레이어 서버)는 Phase 1 완료 후 필요하지만, Phase 3은 Phase 1의 `encoding.ts`만 있으면 되므로 그 직후 바로 시작 가능하다.

## Patterns to Mirror
| Category | Source | Pattern |
|---|---|---|
| Naming (Python) | `ai/agents/policy_network.py` | `snake_case`, 타입 힌트 필수, `from __future__ import annotations` |
| Immutability (Python) | `ai/tichu_env/state.py:25-42` | `@dataclass(frozen=True)` + `replace`로 새 상태 반환 |
| Error handling (Python) | `ai/training/train.py:225-238` | 잘못된 입력은 즉시 `ValueError` |
| Data access (Python) | `ai/training/train.py:42-72` | `_atomic_torch_save`로 원자적 체크포인트 기록 — export 파이프라인이 읽을 때도 반쯤 쓰인 파일 걱정 없음 |
| 인코딩 계약 | `ai/tichu_env/encoding.py` | `OBS_DIM`/`ACTION_DIM`, `encode_observation`/`encode_action`/`encode_legal_actions` — TS 포트가 그대로 미러링해야 하는 원본 |
| Model I/O 계약 | `ai/agents/policy_network.py:60-74` | `forward(obs, action_vectors) -> (action_logits, state_value)` — ONNX export의 입출력 이름/축을 여기 맞춤 |
| Tests (Python) | `ai/tests/test_state.py`, `test_combinations.py`, `test_encoding.py` | `pytest`, 엣지케이스(봄/더블아웃/마지막 카드 이관) 명시적 커버 — TS 골든 테스트의 원본 |
| Infra | `docker-compose.yml`, `ai/Dockerfile` | Python 3.14/PyTorch wheel 미스매치로 Docker 채택(handoff 문서) — ONNX export 스크립트도 같은 컨테이너에서 실행 |
| Naming/Errors/Tests (TS, 신규 컨벤션) | 이번 플랜에서 확정 | 파일/함수 `camelCase`, 타입/컴포넌트 `PascalCase`, 규칙 엔진은 예외 대신 `Result<T,E>` 스타일, 서버는 `{type:"ERROR",code,message}`, Vitest |

## Files to Change
| File | Action | Why |
|---|---|---|
| `package.json`, `pnpm-workspace.yaml`, `tsconfig.base.json` | CREATE | pnpm workspaces 모노레포 루트 |
| `packages/shared/src/cards.ts` | CREATE | `ai/tichu_env/cards.py` 포팅 |
| `packages/shared/src/combinations.ts` | CREATE | `ai/tichu_env/combinations.py` 포팅 |
| `packages/shared/src/gameState.ts` | CREATE | `ai/tichu_env/state.py` 포팅 |
| `packages/shared/src/scoring.ts` | CREATE | `ai/tichu_env/scoring.py` 포팅 |
| `packages/shared/src/encoding.ts` | CREATE | `ai/tichu_env/encoding.py` 포팅 — 브라우저에서 관측/액션 벡터를 만들기 위해 필요 |
| `packages/shared/src/protocol.ts` | CREATE | 사람 vs 사람 WS 메시지 타입(MVP는 AI 좌석 관련 메시지 없음 — 향후 확장 지점으로만 문서화) |
| `packages/shared/src/goldenFixtures/*.json` | CREATE | Python에서 뽑은 골든 픽스처(상태 전이 + 인코딩 벡터 값) |
| `packages/shared/src/*.test.ts` | CREATE | 골든 픽스처 기반 단위 테스트 (80%+ 커버리지) |
| `packages/server/src/index.ts`, `room.ts`, `session.ts`, `gameServer.ts` | CREATE | 사람 vs 사람 전용 WS 서버(방/좌석/재접속/게임 루프) — AI 좌석 처리 없음 |
| `packages/server/src/*.test.ts` | CREATE | 방/게임 흐름 통합 테스트 |
| `packages/client/` (Vite + React) | CREATE | 로비 + 게임 테이블(사람 vs 사람), 별도 "AI와 연습하기" 진입점 |
| `packages/client/src/ws/useGameSocket.ts` | CREATE | 사람 vs 사람용 WS 훅 |
| `packages/client/src/ai/decideAiMove.ts` | CREATE | **순수 함수**: (관측 벡터, 후보 액션 벡터, ONNX 세션) → 선택된 액션. 모델 로딩/캐싱과 분리 — 향후 서버 재사용 대비 |
| `packages/client/src/ai/loadModel.ts` | CREATE | onnxruntime-web 세션 생성, Cache Storage로 오프라인 캐싱, 체크포인트 iteration 버전 태그로 캐시 무효화 |
| `packages/client/src/ai/soloGame.ts` | CREATE | 서버 없이 `packages/shared` 규칙 엔진 + `decideAiMove`로 진행하는 혼자 모드 게임 루프 |
| `packages/client/src/sw.ts` (Service Worker) | CREATE | 모델/엔진 자산 오프라인 캐싱 |
| `ai/export/export_onnx.py` | CREATE | `checkpoint_*.pt` state_dict → `TichuPolicyValueNet` 로드 → ONNX export(동적 축: 후보 액션 개수). 입출력 이름/shape을 브라우저 쪽과 고정 계약으로 문서화 |
| `ai/export/obfuscate.py` (또는 export 스크립트 내 유틸) | CREATE | 내보낸 ONNX 바이트를 가벼운 reversible 인코딩(예: XOR)으로 감싸 정적 파일 그대로 다운로드되지 않게 함 |
| `ai/tests/test_export_onnx.py` | CREATE | export된 ONNX 모델이 원본 PyTorch 모델과 동일한 출력을 내는지 parity 테스트 |
| `e2e/full-game.spec.ts` (사람 vs 사람), `e2e/solo-ai.spec.ts` (혼자 모드, 오프라인 시뮬레이션 포함) | CREATE | Playwright E2E |
| `.claude/prds/tichu-online.prd.md` | UPDATE | Milestone 1 상태 갱신(완료) |

## Tasks

### Phase 0 — 모노레포 스캐폴드
#### Task 1: 로컬 Node/pnpm 환경 확인 및 워크스페이스 초기화
- **Action**: Node/pnpm 버전 확인 후 `pnpm-workspace.yaml`, 루트 `package.json`, `tsconfig.base.json`, ESLint/Prettier 생성
- **Validate**: `pnpm install` 정상 완료

#### Task 2: 패키지 스캐폴드
- **Action**: `packages/shared`, `packages/server`, `packages/client` 생성, workspace 의존성 연결
- **Validate**: `pnpm -w typecheck` 통과(빈 프로젝트 기준)

### Phase 1 — 공유 규칙 엔진 + 인코딩 (`packages/shared`) — Python을 참조 오라클로
#### Task 3: 골든 픽스처 생성 스크립트
- **Action**: `ai/tichu_env` 위에서 결정론적 시드로 대표 시나리오(정상 라운드/봄 인터럽트/더블 아웃/마지막 카드 이관/그랜드 티츄) 실행 → 입력 상태, 기대 결과, **`encode_observation`/`encode_action`의 실제 벡터 값**까지 JSON으로 dump
- **Validate**: `ai/tests/test_state.py`, `test_encoding.py`가 커버하는 케이스 수만큼 픽스처 생성
- **Why**: 규칙 판정뿐 아니라 관측/액션 인코딩까지 숫자 단위로 일치해야 브라우저에서 계산한 벡터를 그대로 ONNX 모델에 넣었을 때 학습 때와 같은 입력이 된다고 보장할 수 있음

#### Task 4~7: 카드/조합/상태전이/스코어링 TS 포팅
- **Action**: 각각 `ai/tichu_env`의 대응 모듈을 포팅
- **Validate**: Task 3 픽스처 전량 통과

#### Task 8: 관측/액션 인코딩 TS 포팅
- **Action**: `encoding.ts`에 `OBS_DIM`/`ACTION_DIM`과 `encode_observation`/`encode_action`/`encode_legal_actions` 구현
- **Validate**: Task 3 픽스처의 벡터 값과 **부동소수점 단위로 일치**(허용 오차 내)

#### Task 9: 사람 vs 사람 프로토콜 정의
- **Action**: `protocol.ts`에 `JOIN_ROOM`, `START_GAME`, `CALL_TICHU`, `PLAY_CARDS`, `PASS`, `STATE_UPDATE`, `ERROR`, `RECONNECT` 정의. AI 좌석 관련 메시지는 넣지 않되, 주석으로 "혼합 방 지원 시 여기에 추가" 표시만 남김
- **Validate**: 타입 컴파일 통과

### Phase 2 — 사람 vs 사람 게임 서버 (`packages/server`)
#### Task 10: 방(Room) 생명주기
- **Action**: 방 코드 생성, 4석 좌석 배정(팀 자동 편성). AI 좌석 채우기는 MVP 범위 밖(주석으로 확장 지점 표시)
- **Validate**: 방 생성 → 4명 입장 → 5번째 거부 통합 테스트

#### Task 11: 세션/재접속
- **Action**: 재접속 토큰, 유예 시간 내 상태 재동기화
- **Validate**: 강제 종료 후 재연결 통합 테스트

#### Task 12: 게임 루프 연결
- **Action**: 사람 액션 → `packages/shared` 리듀서 위임, 플레이어별 view로 마스킹해 브로드캐스트
- **Validate**: 4인 모의 클라이언트 한 라운드 완주 통합 테스트

### Phase 3 — AI 대국(혼자 모드, 브라우저 로컬 추론) — **Phase 1 완료 직후 병행 가능**
#### Task 13: ONNX export 파이프라인
- **Action**: `ai/export/export_onnx.py`가 지정된 `checkpoint_*.pt`를 로드해 `TichuPolicyValueNet`에 채운 뒤, 입력(`obs`, `action_vectors` — 후보 개수는 동적 축), 출력(`action_logits`, `state_value`) 이름을 고정해 ONNX로 export. 이 입출력 계약은 M2 쪽에도 공유해 **네트워크 forward 시그니처를 바꿀 때는 이 스크립트도 같이 업데이트**하도록 함
- **Validate**: `ai/tests/test_export_onnx.py`에서 동일 입력에 대해 PyTorch 원본과 ONNX 출력이 수치적으로 일치(parity test)

#### Task 14: 모델 바이트 경량 인코딩
- **Action**: export된 `.onnx` 파일을 reversible 바이트 인코딩(예: 고정 키 XOR)으로 감싸 정적 다운로드로 바로 못 쓰게 함. 브라우저 쪽에서 fetch 후 역변환
- **Validate**: 인코딩 → 디코딩 왕복 시 원본과 바이트 단위 동일

#### Task 15: 브라우저 모델 로딩 및 오프라인 캐싱
- **Action**: `loadModel.ts`가 인코딩된 모델을 fetch → 디코딩 → onnxruntime-web 세션 생성. Cache Storage(Service Worker)로 캐싱하고, 체크포인트 iteration을 버전 키로 사용해 새 iteration 감지 시에만 재다운로드
- **Validate**: 오프라인(네트워크 차단) 상태에서 두 번째 접속 시 캐시된 모델로 정상 로드되는 테스트

#### Task 16: AI 의사결정 함수
- **Action**: `decideAiMove.ts`는 (관측 벡터, 후보 액션 벡터들, ONNX 세션)만 입력받아 선택된 액션 인덱스를 반환하는 **순수 함수**로 작성 — 모델 로딩/브라우저 API에 의존하지 않게 분리(향후 `onnxruntime-node`로 서버에서도 재사용 가능하도록)
- **Validate**: Task 3 픽스처의 알려진 상태에 대해 합법 액션 중 하나를 반환하는지 단위 테스트

#### Task 17: 혼자 모드 게임 루프
- **Action**: `soloGame.ts`가 서버 없이 `packages/shared` 리듀서 + `decideAiMove`로 1인 vs AI 3자리 게임을 진행
- **Validate**: 통합 테스트로 한 라운드 완주(네트워크 호출 없음을 확인)

### Phase 4 — 클라이언트 UI (`packages/client`)
#### Task 18: 로비 화면 (사람 vs 사람)
- **Action**: 방 생성/입장, 좌석 표시
- **Validate**: 수동 확인 + 컴포넌트 테스트

#### Task 19: "AI와 연습하기" 진입점
- **Action**: 별도 화면에서 `soloGame.ts` 기반 혼자 모드 시작, 최초 로드 시 모델 다운로드 진행률 표시
- **Validate**: 수동 QA — 오프라인 전환 후에도 재플레이 가능 확인

#### Task 20: 게임 테이블 UI
- **Action**: 손패/트릭/액션 버튼/점수판 (사람 vs 사람, 혼자 모드 공용 컴포넌트)
- **Validate**: 수동 QA

### Phase 5 — 통합 및 검증
#### Task 21: E2E
- **Action**: `full-game.spec.ts`(사람 vs 사람 4탭), `solo-ai.spec.ts`(혼자 모드, 네트워크 오프라인 시뮬레이션 포함)
- **Validate**: `pnpm exec playwright test` 통과

#### Task 22: 커버리지 확인 및 문서화
- **Action**: `packages/shared`, `packages/server`, `packages/client` 커버리지 80%+, 루트 `CLAUDE.md`에 스택/구조/실행 명령 반영. "혼합 방 확장 지점"(Task 9의 protocol.ts 주석, Task 16의 순수 함수 분리)을 문서에 명시
- **Validate**: 커버리지 리포트 확인

## Validation
```bash
# TS 스택
pnpm install
pnpm -w typecheck
pnpm -w lint
pnpm -w test -- --coverage
pnpm --filter server dev &
pnpm --filter client dev &
pnpm exec playwright test

# Python export 파이프라인 (컨테이너 내부)
docker compose exec ai python -m export.export_onnx --checkpoint checkpoints/checkpoint_N.pt --out packages/client/public/models/policy.onnx.enc
docker compose exec ai pytest ai/tests/test_export_onnx.py
```

## Risks
| Risk | Likelihood | Mitigation |
|---|---|---|
| TS/Python 규칙+인코딩 구현이 엣지케이스에서 갈라짐 | High | Task 3 골든 픽스처(값 단위 비교)로 기계적 검증 |
| M2가 네트워크 구조(obs/action dim, forward 시그니처)를 바꾸면 ONNX export가 깨짐 | Medium | export 계약을 명시적으로 문서화, parity 테스트를 M2 쪽 CI/체크포인트 저장 흐름에도 걸어두길 권장(향후 child 세션에서 조율) |
| 저사양 기기에서 WASM 추론이 느릴 수 있음 | Low | 모델이 작은 MLP라 위험 낮음, 그래도 실기기 벤치마크 필요 |
| 모델이 계속 갱신되는 동안 캐시 무효화 로직이 꼬임 | Medium | iteration 번호를 캐시 키에 명시적으로 포함, 모델 고정 후에는 사실상 정적 자산이 되어 리스크 소멸 |
| 모델 가중치가 브라우저에 노출됨 | Accepted | 랭킹 없음, 사용자가 수용. 가벼운 바이트 인코딩으로 캐주얼 추출만 방지(진짜 보안 아님, 문서화된 트레이드오프) |
| 실시간 사람 vs 사람 동기화 복잡도 (PRD 명시 리스크) | Medium | 서버 권위적 상태 + view 마스킹, 순수 함수 리듀서 |
| WebSocket 연결 끊김/새로고침 시 게임 중단 (사람 vs 사람만 해당) | Medium | Task 11 재접속 유예 로직 |
| 혼합 방(향후 과제) 설계 변경 시 Phase 3 구조를 다시 만들어야 할 위험 | Low | Task 16에서 AI 의사결정을 순수 함수로 분리해둬서, 서버 재사용 시 로딩/캐싱 계층만 새로 짜면 됨 |

## Acceptance
- [x] Phase 0~5 모든 태스크 완료
- [x] `pnpm -w test`, `pnpm -w typecheck`, `pnpm -w lint`, Playwright E2E(사람 vs 사람 + 혼자 모드) 모두 통과
- [x] `packages/shared`의 규칙+인코딩 테스트가 Python 골든 픽스처와 수치적으로 100% 일치
- [x] ONNX export가 PyTorch 원본과 parity 테스트 통과
- [x] 혼자 모드가 네트워크 차단 상태에서 재접속 없이 플레이 가능(오프라인 확인) — `e2e/solo-ai.spec.ts`
- [ ] 학습 중인 체크포인트가 갱신되면 다음 방문 시 새 버전이 감지되어 재다운로드됨(수동 검증) — **블로킹**: M2 학습이 아직 진행 중이라 배포할 실제 checkpoint가 아직 결정되지 않음(`ai/export/.env` 지정 보류, 사용자 결정). 메커니즘 자체(manifest.json iteration 비교 + Cache Storage)는 단위 테스트로 커버되어 있으나, 실제 checkpoint로 하는 수동 QA는 아직 미완료.
- [x] 사람 vs 사람 연결 끊김 후 유예 시간 내 재접속 시 상태 복원
- [x] 혼합 방 확장 지점(protocol.ts 주석, decideAiMove.ts 순수 함수 분리)이 문서화됨 — 루트 `CLAUDE.md`에도 명시

---
*Status: 거의 완료. Phase 0~5 전체 태스크 완료(세션: `2026-07-30-m1-web-shared-engine`, `tichu-multiplayer-server`, `tichu-solo-ai-browser`, `tichu-client-ui`, `tichu-e2e-integration`). E2E 통합 과정에서 발견된 두 선행 갭(서버 라운드 종료 처리, AI 모델 자산 배포 메커니즘)도 `tichu-e2e-integration` 세션에서 해결. 남은 유일한 미완료 항목은 실제 checkpoint 배치 수동 QA — M2 학습이 정리되는 대로 처리 예정.*
