# Tichu 온라인 게임 사이트

## Problem
Tichu를 온라인으로 즐길 수 있는 사이트는 이미 존재하지만, 어느 사이트도 AI와 대결하는 옵션을 제공하지 않고, 게임 로그 데이터를 자유롭게 수집할 수 있는 접근권도 제공하지 않는다. 자체 소유 사이트가 없으면 AI 학습에 필요한 플레이 데이터를 확보할 수 없다.

## Evidence
- Assumption — 개인적 동기 기반 프로젝트("해 보고 싶어서")로, 별도의 외부 검증 없이 진행. 필요 시 user research나 실사용 데이터로 추후 검증.

## Users
- **Primary**: (a) 사람 vs 사람으로 온라인 Tichu를 플레이하려는 사용자, (b) AI와 대결하려는 사용자, (c) 게임 로그를 승률 개선용 AI 학습 데이터로 활용하려는 프로젝트 소유자(본인)
- **Not for**: TBD — MVP 범위 밖의 사용자군(예: 모바일 전용 사용자, 규칙 변형을 요구하는 사용자)은 이번 단계에서 고려하지 않음

## Hypothesis
TBD — 공식 가설 없음. 개인 프로젝트로, 검증 목적이 아닌 실행 자체가 목적.

## Success Metrics
| Metric | Target | How measured |
|---|---|---|
| TBD | TBD | 근거 부족 — needs validation via 실사용 데이터/AI 학습 결과 확인 |

## Scope
**MVP** — 실행 가능한 최소 기능(사람 vs 사람 대전 + AI 대결 + 로그 수집)만 포함

- 실시간 사람 vs 사람 온라인 Tichu 대전
- AI와 대결하는 모드 (AI는 직접 학습 예정)
- 모든 게임 플레이의 로그 수집 (AI 학습 데이터 용도)

**Out of scope**
- MVP에 명시되지 않은 모든 기능 — 사용자가 명시적으로 요청하더라도 이번 범위에서 제외
  - 예: 모바일 앱, 랭킹/레이팅 시스템, 결제/과금, 관전 모드, 채팅, 토너먼트, 규칙 변형(variant) 지원 등

## Delivery Milestones
<!-- Business outcomes, not engineering tasks. /plan turns each into a plan. -->
<!-- Status: pending | in-progress | complete -->

| # | Milestone | Outcome | Status | Plan |
|---|---|---|---|---|
| 1 | 사람 vs 사람 온라인 대전 | 두 명 이상의 사용자가 실시간으로 온라인에서 Tichu를 플레이할 수 있다 | pending | `.claude/plans/tichu-online.plan.md` (draft, 보류 — M2 이후 구조 재정렬 예정) |
| 2 | AI 대결 모드 | 사용자가 자체 개발 AI를 상대로 Tichu를 플레이할 수 있다 | in-progress | `.claude/plans/tichu-ai-selfplay.plan.md` |
| 3 | 게임 로그 수집 | 모든 게임(사람 vs 사람, 사람 vs AI)의 플레이 로그가 저장되어 AI 학습 데이터로 활용 가능하다 | pending | — |

## Open Questions
- [ ] AI 학습 방법론과 아키텍처는 무엇으로 할 것인가? (직접 학습 예정이라는 것 외 구체적 접근 미정)
- [ ] 동시 접속자 규모와 인프라 요구사항은 어느 정도로 가정하는가?
- [ ] Tichu 표준 규칙만 지원할 것인가, variant(예: Grand Tichu 콜, 특수 카드 조합 등) 지원 여부는?

## Risks
| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| 초기 사용자 수 부족으로 AI 학습에 필요한 실제 게임 로그가 부족함 | Medium | High | 자체 플레이 또는 self-play 시뮬레이션으로 초기 데이터 보강 |
| 실시간 멀티플레이어 동기화 복잡도 | Medium | Medium | 검증된 실시간 통신 라이브러리/프레임워크 활용 |
| 실시간 게임 중 AI 추론 지연으로 사용자 경험 저하 | Medium | Medium | 경량 모델 사용 또는 비동기/타임아웃 처리 |

---
*Status: DRAFT — requirements only. Implementation planning pending via /plan.*
