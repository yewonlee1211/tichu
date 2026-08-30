# Plan: 게임 로그 수집 + 백엔드 DB 도입

**Source PRD**: `.claude/prds/tichu-online.prd.md`
**Selected Milestone**: Milestone 3 — 게임 로그 수집 (부수 목표: Milestone 1의 방/세션 상태 내구성 개선)
**Complexity**: Large

## Summary
총괄 세션(`2026-07-30-m1-web-kickoff`)에서의 논의로 확정된 방향:

1. PRD Milestone 3(게임 로그 수집, MVP 필수 요구사항이나 M1의 6개 하위 세션 어디에서도 다루지 않은 채 남아있던 항목)을 위해 **PostgreSQL**을 도입한다.
2. 도입 범위는 로그 저장에 그치지 않고 **방/세션 상태 영속화까지 포함** — 서버가 재시작해도 진행 중이던 방이 사라지지 않게 한다(현재는 `packages/server`의 `GameRoom`/`PlayerSession`이 순수 in-memory `Map`).
3. ORM은 **Prisma**를 사용한다(타입 안전 + 마이그레이션 도구, 검증된 라이브러리 우선 원칙에 부합).
4. 혼자 모드(AI 연습)는 서버와 통신하지 않는 순수 클라이언트 구조라, 로그를 남기려면 **기존 WS 프로토콜과 별개인 1회성 HTTP 엔드포인트**가 새로 필요하다.
5. 작업량이 커서 먼저 **Phase 1(DB 플러밍)**만 별도 세션으로 떼어 진행하고, 완료 후 총괄 세션에서 Phase 2의 세부 분할(room/session 영속화 vs 로그 적재)을 다시 판단한다 — 큰 다중 작업을 통짜 세션에 몰아넣지 않는다는 이 프로젝트의 기존 패턴을 따름.

## Files to Change (Phase 1 기준 — Phase 2는 착수 시 확정)
| File | Action | Why |
|---|---|---|
| `docker-compose.yml` | UPDATE | `postgres` 서비스 + 영속 볼륨 추가 |
| `packages/server/.env.example` | CREATE | `DATABASE_URL` 등 접속 정보 계약 문서화 (gitignored `.env` 패턴은 `ai/export/.env.example`과 동일) |
| `packages/server/prisma/schema.prisma` | CREATE | `rooms`/`sessions`/`game_logs` 최소 뼈대 (컬럼 세부는 Phase 2에서 확정) |
| `packages/server/src/db/client.ts` | CREATE | `PrismaClient` 싱글턴 + 기동 시 연결 헬스체크 |
| `packages/server/package.json` | UPDATE | `prisma`/`@prisma/client` 의존성 |

## Tasks

### Phase 1 — DB 플러밍 (Postgres + Prisma 뼈대, `GameServer` 로직은 아직 건드리지 않음)
#### Task 1: docker-compose에 Postgres 서비스 추가
- **Action**: 루트 `docker-compose.yml`(현재 `ai/` 전용)에 `postgres` 서비스 + named volume 추가. `packages/server`가 쓸 `DATABASE_URL` 환경변수 계약을 정의하고 `.env.example`로 문서화
- **Validate**: `docker compose up -d postgres` 정상 기동, 접속 확인

#### Task 2: Prisma 스키마/마이그레이션 뼈대
- **Action**: `packages/server`에 Prisma 도입, `schema.prisma` 초안 작성 — `rooms`/`sessions`/`game_logs` 최소 뼈대만(지금은 마이그레이션 파이프라인 동작 확인이 목적, 실사용 컬럼은 Phase 2에서 확정)
- **Validate**: `pnpm --filter server exec prisma migrate dev` 정상 동작, 마이그레이션 파일 생성 확인

#### Task 3: DB 클라이언트 연결 모듈
- **Action**: `packages/server/src/db/client.ts` — `PrismaClient` 싱글턴, 서버 기동 시 연결 실패하면 명확한 에러로 fail fast
- **Validate**: 정상 연결 로그 확인 + DB가 내려간 상태에서의 기동 실패 시나리오 확인

#### Task 4: 회귀 확인 + Phase 2 테스트 전략 결정
- **Action**: `GameServer`는 아직 DB를 쓰지 않으므로 기존 테스트 스위트가 그대로 통과해야 함을 확인. Phase 2에서 실제 연동 시 테스트를 어떻게 가져갈지(예: repository 인터페이스 + in-memory fake vs 테스트용 실제 Postgres) 짧게 결정해 문서화
- **Validate**: `pnpm -w test` 전체 통과(회귀 없음)

### Phase 2 — TBD (Phase 1 완료 후 총괄 세션에서 범위/분할 재검토)
- (a) room/session 상태를 리포지토리 인터페이스로 추상화 + Postgres 연동(`gameServer.ts` 구조 개선과 같이 진행)
- (b) 게임 로그 스키마 확정 + 멀티플레이어/솔로 양쪽 로그 적재(솔로 모드는 신규 HTTP 엔드포인트 필요)

## Validation
```bash
docker compose up -d postgres
pnpm --filter server exec prisma migrate dev
pnpm -w test
pnpm -w typecheck
```

## Risks
| Risk | Likelihood | Mitigation |
|---|---|---|
| Prisma가 예외 기반 에러를 던져 프로젝트의 `Result<T,E>` 컨벤션과 안 맞음 | Medium | DB 접근 지점에서 try/catch로 감싸 `Result`로 변환하는 얇은 wrapper 규칙을 Phase 1에서 세워둠 |
| Windows 로컬 환경에서 Postgres 컨테이너 포트가 이전 8080 이슈처럼 예약 범위와 충돌 | Medium | 포트를 환경변수로 오버라이드 가능하게, README에 문서화 |
| Phase 2 범위가 아직 세부 확정 안 됨 | Known(의도됨) | Phase 1 완료 후 총괄 세션에서 재검토하기로 이미 합의 |

## Acceptance (Phase 1)
- [ ] `docker compose up -d postgres` 정상 기동
- [ ] Prisma 마이그레이션 파이프라인 동작 확인
- [ ] `packages/server` 기동 시 DB 연결 헬스체크(실패 시 명확히 실패)
- [ ] 기존 전체 테스트 스위트 회귀 없이 통과
- [ ] Phase 2 테스트 전략 결정 사항 문서화

---
*Status: Phase 1 착수 대기.*
