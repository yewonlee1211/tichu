# Handoff: TS 모노레포 스캐폴드 + 공유 규칙엔진(`packages/shared`)

**상위 세션**: `2026-07-30-m1-web-kickoff` (M1 총괄 세션) — 시작 시 `/session-start`로 이 값을 상위 세션으로 등록할 것
**소스 플랜**: `.claude/plans/tichu-online.plan.md` — 이 문서의 **Phase 0(Task 1-2) + Phase 1(Task 3-9)**
**의존성**: 없음 — 지금 바로 시작 가능. `tichu-ai-onnx-export`(ONNX export) 세션과 완전히 병행 가능
**이 작업을 기다리는 것**: `tichu-multiplayer-server`(Phase 2)와 `tichu-solo-ai-browser`(Phase 3 후반)가 이 세션의 산출물(`packages/shared`)에 의존함

## 배경
Tichu 온라인 사이트(M1)와 M2(Python self-play AI)를 연동하기로 하면서, 웹 서버/클라이언트의 게임 규칙 엔진은 Node.js + TypeScript로 재구현하기로 확정했다(Python 백엔드는 사람 vs 사람 경로에 관여하지 않음). 이미 `ai/tichu_env`(Python)에 검증된 규칙 엔진이 있으므로, TS 버전을 손으로 처음부터 짜지 않고 **Python에서 뽑은 골든 픽스처로 검증**해 두 구현이 갈라지는 위험을 없앤다.

## 환경 결정: Node/pnpm은 호스트 네이티브 실행, Docker 미사용 (2026-08-02 확정)

이 세션 진행 중 "호스트에 Node/pnpm이 없다"는 문제가 발견되어, 별도 세션에서 `ai/`처럼 Docker 컨테이너(`web` 서비스 추가)로 갈지, 호스트에 직접 설치할지를 논의했다. **결론: 호스트 네이티브 실행으로 확정. `docker-compose.yml`/`ai/Dockerfile`은 건드리지 않는다.**

**이유**:
- `ai/`를 Docker로 격리한 이유는 "모든 런타임을 컨테이너로 통일"하는 일반 원칙이 아니라, 호스트 Python 3.14에 PyTorch wheel이 아예 없어 **설치 자체가 불가능**했던 구체적 블로커 때문이었다(`docs/DOCKER.md` 1절). Node/pnpm에는 이런 하드 블로커가 없다 — corepack(Node 16.9+ 기본 내장) + `packageManager` 필드로 pnpm 버전을, `.nvmrc`/`engines`로 Node 버전을 고정하면 버전 드리프트 문제는 충분히 관리된다.
- Vite/Vitest 같은 파일 감시(watch) 기반 dev 루프는 Windows + Docker Desktop 볼륨 마운트에서 polling 이슈로 느려지는 경우가 많고, pnpm 워크스페이스의 심볼릭 링크 구조도 볼륨 마운트와 부딪히는 경우가 흔하다. AI 학습(배치성, 실행 후 대기)과 달리 웹 개발은 초 단위로 반복되는 대화형 루프라 이 비용이 실제로 체감된다.
- `packages/client`가 최종적으로 정적 브라우저 산출물(ONNX 오프라인 추론, `project_tichu_ai_mode_client_side_offline` 결정)로 귀결되므로, "프로덕션 이미지 재사용" 같은 Docker화의 장기 이점도 크지 않다. 배포/CI 단계에서 필요하면 그때 별도로 Docker화하면 된다(CI는 `actions/setup-node` 등 표준 이미지로 이미 대체 가능).
- ai(Python 학습)와 web(사람 vs 사람 서버)은 실행 주기가 겹치지 않는 별개 런타임이므로, 같은 컨테이너 체계에 강제로 묶을 필요가 없다.

**다음 세션에서 할 일 (Task 1 착수 전 선행)**:
- [ ] 호스트에 Node LTS 설치 여부 확인, 없으면 설치
- [ ] `corepack enable` 실행
- [ ] 루트 `package.json`에 `packageManager` 필드로 pnpm 버전 고정 (예: `"packageManager": "pnpm@9.x.x"`)
- [ ] 루트에 `.nvmrc` (또는 `package.json`의 `engines.node`) 추가해 Node 버전 명시
- [ ] 이후 Task 1의 나머지(`pnpm-workspace.yaml`, 루트 `package.json` scripts, `tsconfig.base.json`, ESLint/Prettier)는 기존 계획대로 진행

## 이 세션이 할 일
1. **Task 1**: 위 "환경 결정" 섹션의 선행 작업(corepack, packageManager/engines 고정) 완료 후 `pnpm-workspace.yaml`, 루트 `package.json`(scripts: dev/build/test/lint/typecheck), `tsconfig.base.json`, ESLint/Prettier 생성
2. **Task 2**: `packages/shared`, `packages/server`, `packages/client` 스캐폴드 생성(server/client는 이후 다른 세션이 채움 — 지금은 빈 패키지 + workspace 의존성 연결만)
3. **Task 3**: 골든 픽스처 생성 스크립트 — `ai/tichu_env` 위에서 결정론적 시드로 대표 시나리오(정상 라운드/봄 인터럽트/더블 아웃/마지막 카드 이관/그랜드 티츄)를 실행해 입력 상태 + 기대 결과 + **`encode_observation`/`encode_action`의 실제 벡터 값**까지 JSON dump (`ai/tests/test_state.py`, `test_encoding.py` 참고). Docker 컨테이너(`docker compose exec ai ...`) 안에서 실행해야 함
4. **Task 4-7**: `cards.ts`, `combinations.ts`, `gameState.ts`, `scoring.ts` — 각각 `ai/tichu_env/cards.py`, `combinations.py`, `state.py`, `scoring.py` 포팅
5. **Task 8**: `encoding.ts` — `ai/tichu_env/encoding.py`의 `OBS_DIM`/`ACTION_DIM`/`encode_observation`/`encode_action`/`encode_legal_actions` 포팅. **부동소수점 단위로 골든 픽스처와 일치**해야 함(단순 legality 일치가 아니라 벡터 값 자체)
6. **Task 9**: `protocol.ts` — 사람 vs 사람 WS 메시지 타입만 정의(`JOIN_ROOM`, `START_GAME`, `CALL_TICHU`, `PLAY_CARDS`, `PASS`, `STATE_UPDATE`, `ERROR`, `RECONNECT`). AI 좌석 관련 메시지는 넣지 말 것 — 주석으로 "혼합 방 지원 시 여기 추가" 정도만 남김

## 컨벤션(신규, 이번 세션에서 확정)
- 파일/함수 `camelCase`, 타입/컴포넌트 `PascalCase`
- 규칙 엔진은 예외 대신 `Result<T,E>` 스타일 반환(잘못된 카드 조합/턴 위반 표현)
- Vitest 사용, AAA 패턴, 골든 픽스처 기반 테스트 우선

## Validate
```bash
pnpm install
pnpm -w typecheck
pnpm -w lint
pnpm -w test --coverage   # packages/shared 80%+ 목표 -- 주의: 이 pnpm 버전(11.18.0)에서는 "--"를 붙이면
                          # 리터럴 인자로 전달되어 vitest가 커버리지를 켜지 않는다("--"  없이 바로 --coverage)
```

## 완료 기준
- [ ] `packages/shared`의 모든 테스트가 Python 골든 픽스처와 수치적으로 100% 일치
- [ ] 커버리지 80%+
- [ ] 완료 후 `.claude/prds/tichu-online.prd.md`와 `.claude/plans/tichu-online.plan.md`에 진행 상황 반영, `2026-07-30-m1-web-kickoff` 세션에 완료 보고
