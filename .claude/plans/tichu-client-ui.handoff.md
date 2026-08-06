# Handoff: 클라이언트 UI (`packages/client` — 로비/게임 테이블/AI 진입점)

**상위 세션**: `2026-07-30-m1-web-kickoff` (M1 총괄 세션) — 시작 시 `/session-start`로 이 값을 상위 세션으로 등록할 것
**소스 플랜**: `.claude/plans/tichu-online.plan.md` — 이 문서의 **Phase 4, Task 18-20**
**의존성**: `tichu-web-shared-engine`(packages/shared), `tichu-multiplayer-server`(방/WS 서버), `tichu-solo-ai-browser`(`soloGame.ts`, 모델 로딩) — 셋 다 완료 또는 최소한 인터페이스가 안정된 상태여야 함. 완료 전이라면 mock으로 골격만 먼저 잡는 것은 가능

## 배경
사람 vs 사람과 AI 대국(혼자 모드) 두 경로를 모두 지원하는 클라이언트 UI. 두 모드는 진입점이 다르지만(전자는 WS 서버 연결, 후자는 로컬 전용) 게임 테이블 UI 컴포넌트는 최대한 공용으로 만든다.

## 이 세션이 할 일
1. **Task 18**: 로비 화면(사람 vs 사람) — 방 생성/방 코드 입장, 좌석 표시, 4명 모이면 방장이 게임 시작. `packages/server`의 `protocol.ts` 메시지 사용
2. **"AI와 연습하기" 진입점(Task 19)** — 별도 화면에서 `tichu-solo-ai-browser`의 `soloGame.ts` 기반으로 즉시 시작. 최초 로드 시 모델 다운로드 진행률 표시(용량이 크므로 사용자에게 명시적으로 보여줄 것)
3. **Task 20**: 게임 테이블 UI — 손패 표시/선택, 제출/패스/티츄 콜 버튼, 현재 트릭, 팀 점수판, 턴 표시. 사람 vs 사람과 혼자 모드에서 공용으로 재사용
4. `packages/client/src/ws/useGameSocket.ts` — 사람 vs 사람 전용 WS 연결/재연결 훅(재접속 토큰 localStorage 저장)

## 컨벤션
- React + Vite + TS, 컴포넌트 `PascalCase`, 훅 `use` 프리픽스
- 접근성/반응형은 이 프로젝트 범위에서 필수는 아니지만 기본적인 시맨틱 HTML은 유지

## Validate
```bash
pnpm --filter client dev
pnpm --filter client test
```

## 완료 기준
- [ ] 4개의 서로 다른 브라우저 탭에서 방 생성 → 입장 → 한 라운드 플레이 → 점수 반영까지 수동 재현 가능
- [ ] "AI와 연습하기"로 혼자 모드 시작 → 오프라인 전환 후에도 재플레이 가능(수동 QA)
- [ ] 완료 후 `2026-07-30-m1-web-kickoff` 세션에 완료 보고
