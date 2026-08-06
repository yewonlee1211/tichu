# Handoff: E2E 통합, 커버리지, 문서화

**상위 세션**: `2026-07-30-m1-web-kickoff` (M1 총괄 세션) — 시작 시 `/session-start`로 이 값을 상위 세션으로 등록할 것
**소스 플랜**: `.claude/plans/tichu-online.plan.md` — 이 문서의 **Phase 5, Task 21-22**
**의존성**: 다른 모든 하위 세션(`tichu-web-shared-engine`, `tichu-ai-onnx-export`, `tichu-multiplayer-server`, `tichu-solo-ai-browser`, `tichu-client-ui`) 완료 필요 — M1의 마지막 단계

## 이 세션이 할 일
1. **Task 21**: Playwright E2E
   - `e2e/full-game.spec.ts` — 4개 브라우저 컨텍스트로 방 생성부터 라운드 종료(점수 반영)까지 사람 vs 사람 전체 플레이
   - `e2e/solo-ai.spec.ts` — 혼자 모드(1인 vs AI 3자리), 네트워크 오프라인 시뮬레이션 포함(두 번째 접속을 오프라인 상태로 재현)
2. **Task 22**: 커버리지 확인 및 문서화
   - `packages/shared`, `packages/server`, `packages/client` 커버리지 80%+ 확인
   - 루트 `CLAUDE.md`에 스택/구조/실행 명령 작성(그린필드 첫 종합 문서)
   - "혼합 방 확장 지점"(`protocol.ts`의 주석, `decideAiMove.ts`의 순수 함수 분리)이 문서에 명시되어 있는지 확인 — 향후 세션이 참고할 수 있게

## Validate
```bash
pnpm -w test -- --coverage
pnpm exec playwright test
docker compose exec ai pytest --cov=export
```

## 완료 기준
- [ ] `.claude/plans/tichu-online.plan.md`의 Acceptance 체크리스트 전 항목 통과
- [ ] `.claude/prds/tichu-online.prd.md`의 Milestone 1 상태를 `complete`로 갱신
- [ ] 완료 후 `2026-07-30-m1-web-kickoff` 세션에 최종 보고 — M1 총괄 세션도 이 시점에 `상태: 완료`로 전환 검토
