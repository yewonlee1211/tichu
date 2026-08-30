# Handoff: 백엔드 DB 플러밍 (Postgres + Prisma 뼈대)

**상위 세션**: `2026-07-30-m1-web-kickoff` (M1 총괄 세션) — 시작 시 `/session-start`로 이 값을 상위 세션으로 등록할 것
**소스 플랜**: `.claude/plans/tichu-game-log-collection.plan.md` — 이 문서의 **Phase 1**
**주의**: 이 작업은 PRD Milestone 3(게임 로그 수집) 착수가 아니라 그 **준비 작업**일 뿐이다. Milestone 3는 아직 `pending` 상태로 남아 있고, 이 세션은 그 상태를 바꾸지 않는다 — Phase 1은 DB 인프라 자체를 붙이는 것까지만 하고, 로그 스키마 확정/실제 적재/room-session 영속화는 전부 다음 단계(Phase 2, 아직 시작 안 함)의 몫이다.
**의존성**: 없음 — `master`에서 바로 시작 가능.

## 배경
총괄 세션에서 백엔드 구조 개선을 논의하다가, (1) PostgreSQL 도입 (2) `gameServer.ts`의 구조 개선 두 가지가 필요하다는 결론이 났다. DB 도입 범위는 로그 저장뿐 아니라 방/세션 상태 영속화(서버 재시작 시 진행 중이던 게임이 사라지는 현재 한계 해소)까지 포함하기로 했고, ORM은 Prisma로 결정했다. 다만 작업량이 커서, 먼저 DB 인프라만 붙이는 이 세션을 작게 떼어 진행하고, 완료 후 총괄 세션에서 나머지(room/session 영속화, 로그 스키마+적재)를 어떻게 분할할지 다시 판단하기로 했다.

## 이 세션이 할 일
1. **docker-compose에 Postgres 서비스 추가** — 루트 `docker-compose.yml`(현재 `ai/` 전용)에 `postgres` 서비스 + named volume 추가. `packages/server`가 접속할 `DATABASE_URL` 환경변수 계약을 정의하고 `.env.example`로 문서화(기존 `ai/export/.env.example` 패턴 참고)
2. **Prisma 도입 및 스키마/마이그레이션 뼈대** — `packages/server`에 `prisma`/`@prisma/client` 추가, `schema.prisma` 초안 작성. 지금은 실제 컬럼을 완전히 확정하지 말 것 — `rooms`/`sessions`/`game_logs`의 최소 뼈대만 두고, 목적은 마이그레이션 파이프라인이 실제로 동작하는지 확인하는 것
3. **DB 클라이언트 연결 모듈** — `packages/server/src/db/client.ts`: `PrismaClient` 싱글턴, 서버 기동 시 연결 헬스체크(연결 실패 시 명확한 에러로 fail fast)
4. **기존 테스트 회귀 확인 + Phase 2 테스트 전략 결정 문서화** — `GameServer`는 이 세션에서 DB를 실제로 사용하지 않으므로 기존 232+개 테스트는 그대로 통과해야 함. Phase 2에서 실제 연동 시 테스트를 어떻게 가져갈지(예: repository 인터페이스에 in-memory fake 주입 vs 테스트용 실제 Postgres 컨테이너) 짧게 결정해 문서화 — 다음 세션이 바로 이어받을 수 있게

## 컨벤션 유의사항
- 이 프로젝트는 예외 대신 `Result<T,E>`(`ok`/`err`, `@tichu/shared`) 패턴을 쓴다. Prisma는 기본적으로 예외를 던지므로, DB 접근 지점에서 얇은 wrapper로 감싸 `Result`로 변환하는 규칙을 이 세션에서 세워두면 Phase 2가 그대로 따라갈 수 있다.
- Windows 환경에서 이전에 서버 기본 포트(8080)가 Hyper-V/WSL 예약 포트 범위와 겹쳐 문제가 있었던 적이 있다(루트 `CLAUDE.md`의 E2E 섹션 참고) — Postgres 포트도 환경변수로 오버라이드 가능하게 해두는 걸 권장.
- `gameServer.ts` 자체의 구조 개선(room/session을 repository 인터페이스로 추상화)은 이 세션 범위가 아니다 — Phase 2에서 다룬다. 이 세션은 DB를 "붙일 수 있는 상태"까지만 만든다.

## Validate
```bash
docker compose up -d postgres
pnpm --filter server exec prisma migrate dev
pnpm -w test
pnpm -w typecheck
```

## 완료 기준
- [ ] `docker compose up -d postgres`로 정상 기동
- [ ] Prisma 마이그레이션이 실제로 동작(스키마 변경 → 마이그레이션 파일 생성 → 적용)
- [ ] `packages/server`가 기동 시 DB 연결을 확인하고, 연결 실패 시 명확히 실패함
- [ ] 기존 전체 테스트 스위트(`pnpm -w test`) 회귀 없이 통과
- [ ] Phase 2 테스트 전략 결정 사항을 이 handoff 또는 세션 worklog에 기록
- [ ] 완료 후 `2026-07-30-m1-web-kickoff` 세션에 완료 보고 — 총괄 세션이 Phase 2 범위/분할을 재검토(PRD Milestone 3 상태는 이 세션이 건드리지 않음)
