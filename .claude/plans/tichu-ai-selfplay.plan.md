# Plan: AI 대결 모드 — Python 시뮬레이터 & Self-Play 학습

**Source PRD**: `.claude/prds/tichu-online.prd.md`
**Selected Milestone**: Milestone 2 — AI 대결 모드 (사용자가 자체 개발 AI를 상대로 Tichu를 플레이할 수 있다)
**Complexity**: Large

## Summary
사용자 결정에 따라 Milestone 1(웹 실시간 대전)보다 Milestone 2(AI)를 먼저 진행한다. 이번 계획의 범위는 **웹사이트와 완전히 독립적인 Python Tichu 시뮬레이터 + self-play 학습 루프**를 구축해 실제로 대국 가능한 AI 모델을 만드는 것까지다. 웹 서버/클라이언트에 AI를 연동하는 작업(추론 마이크로서비스, TS 서버와의 프로토콜 연결)은 **명시적으로 이번 계획 범위 밖**이며, 이후 "M1 구조를 M2에 맞추는" 별도 계획에서 다룬다.

핵심 산출물: (1) 표준 Tichu 규칙을 구현한 Python 게임 환경(Gym 스타일 `reset`/`step`/`legal_actions`), (2) 검증용 휴리스틱 봇, (3) self-play 기반 정책망 학습 루프(PyTorch), (4) 체크포인트 간 승률/Elo를 비교하는 평가 하네스.

## Patterns to Mirror
그린필드이며 이번이 저장소 최초의 실행 가능 코드다. 미러링할 기존 코드는 없다. Milestone 1 플랜에서 세운 컨벤션(네이밍/에러 처리 철학)을 Python 관용구에 맞게 재확인한다:

| Category | 결정 사항 |
|---|---|
| Naming | PEP 8 — 함수/변수 `snake_case`, 클래스 `PascalCase`, 상수 `UPPER_SNAKE_CASE`, 타입 힌트 필수 |
| Error handling | `env.step(action)`은 `action`이 `legal_actions()` 밖이면 `ValueError`로 즉시 실패(자기대국 코드는 항상 legal_actions 안에서만 골라야 하므로 이는 프로그래머 오류로 취급). 규칙 위반이 "정상 흐름"인 경우는 없음 — 사람 입력 검증은 M1(서버) 몫 |
| Logging | 학습 루프는 구조화 메트릭(승률/평균 보상/loss)을 CSV 또는 TensorBoard로 기록. 게임 시뮬레이션 자체는 로그 없음(속도 우선), 재현이 필요하면 시드 고정 |
| Data access | 영속 저장소 없음 — 모델 체크포인트만 `checkpoints/`에 파일로 저장. DB는 M3(로그 수집) 범위 |
| Tests | `pytest`, 규칙/환경 로직은 결정론적 단위 테스트(AAA, `parametrize`로 조합 케이스 커버) 80%+ 목표. 학습 루프 자체는 확률적이라 전통적 커버리지 대상이 아니며, 대신 "N 스텝 후 크래시 없이 완주" 수준의 스모크 테스트로 검증 |

## Files to Change
| File | Action | Why |
|---|---|---|
| `ai/pyproject.toml`, `ai/README.md` | CREATE | Python 프로젝트 초기화(uv 또는 poetry), 웹 스택(TS)과 독립된 의존성 트리 |
| `ai/tichu_env/cards.py` | CREATE | 56장 덱(Dog/Mahjong/Phoenix/Dragon 포함) 모델, 생성/셔플 |
| `ai/tichu_env/combinations.py` | CREATE | 조합 판정(싱글/페어/트리플/풀하우스/스트레이트/봄) 및 강도 비교 |
| `ai/tichu_env/state.py` | CREATE | 불변에 가까운 게임 상태(dataclass, frozen) + 상태 전이 함수(딜링, 그랜드 티츄, 카드 교환, 턴/트릭, 라운드 종료) |
| `ai/tichu_env/scoring.py` | CREATE | 라운드 점수(더블 아웃, 티츄/그랜드 티츄 ±100/±200, 마지막 카드 이관) |
| `ai/tichu_env/env.py` | CREATE | Gym 스타일 래퍼: `reset()`, `step(action)`, `legal_actions()`, `observation()`, `reward()` |
| `ai/tichu_env/encoding.py` | CREATE | 상태 → 관측 텐서 인코딩, 합법수 → 액션 인덱스/마스크 인코딩 규약 정의 |
| `ai/tests/test_*.py` | CREATE | 카드/조합/상태전이/스코어링/env 단위 테스트 (80%+ 커버리지) |
| `ai/agents/heuristic.py` | CREATE | 규칙 기반 그리디 휴리스틱 봇 (환경 검증용 + 학습 베이스라인) |
| `ai/agents/random_agent.py` | CREATE | 완전 랜덤 에이전트 (최하위 베이스라인, 스모크 테스트용) |
| `ai/agents/policy_network.py` | CREATE | PyTorch 정책/가치 네트워크 정의 (관측 인코딩 입력 → 후보 액션 점수 출력) |
| `ai/training/self_play.py` | CREATE | 4석에 현재 정책(및 과거 체크포인트) 배치해 자기대국 게임 생성 |
| `ai/training/train.py` | CREATE | 학습 루프(PPO 또는 REINFORCE 시작 → 필요시 개선), 체크포인트 저장, 메트릭 기록 |
| `ai/eval/arena.py` | CREATE | 체크포인트 vs 휴리스틱/이전 체크포인트 승률·Elo 평가 하네스 |
| `.claude/prds/tichu-online.prd.md` | UPDATE (완료됨) | M1 → pending, M2 → in-progress, 각 Plan 경로 반영 |

## Tasks

### Phase 0 — Python 프로젝트 스캐폴드
#### Task 1: 프로젝트 초기화
- **Action**: 저장소 루트에 `ai/` 디렉터리 생성(완료), `pyproject.toml`(의존성: numpy, torch, pytest, pytest-cov), 가상환경 규약 문서화. 저장소가 아직 git 미초기화 상태이므로 `git init` + 최소 `.gitignore`(`__pycache__/`, `checkpoints/`, `.venv/`) 권장
  - **주의**: 로컬 Python이 3.14뿐이라 PyTorch wheel이 없음(cp314 미지원) → Docker 기반 환경으로 진행하기로 결정. Docker 설정 자체는 별도 세션에서 진행 — 상세는 `.claude/plans/tichu-ai-docker-env.handoff.md` 참고. 이 태스크는 Docker 환경 구성 완료 후 컨테이너 내부에서 수행
- **Validate**: `pytest`가 빈 스위트로 정상 종료

### Phase 1 — Tichu 규칙 엔진 (Python)
#### Task 2: 카드/덱 모델
- **Action**: `cards.py`에 Suit/Rank/특수카드 타입과 56장 덱 생성/셔플(시드 지원) 구현
- **Validate**: 덱 크기 56, 중복 없음, 시드 고정 시 재현 가능 단위 테스트

#### Task 3: 조합 판정/비교
- **Action**: `combinations.py`에 싱글~포카드 봄까지 판정 함수와 동일 타입 간 강도 비교(봄 예외 포함) 구현
- **Validate**: Phoenix/Dragon 특수 케이스 포함 조합별 단위 테스트

#### Task 4: 상태 전이
- **Action**: `state.py`에 라운드 흐름(그랜드 티츄 콜 → 배분 → 카드 교환 → 턴 순환/패스/봄 인터럽트 → 종료 조건) 구현. `GameState`는 `frozen=True` dataclass로, 전이 함수는 새 상태를 반환(뮤테이션 금지 — coding-style.md 불변성 원칙)
- **Validate**: 시나리오 단위 테스트(정상 라운드, 더블 아웃, 마지막 플레이어 카드 이관)

#### Task 5: 스코어링
- **Action**: `scoring.py`에 PRD 표준 규칙 기준 라운드 점수 계산 구현
- **Validate**: 대표 시나리오별 점수 계산 단위 테스트

### Phase 2 — 학습 환경 (Gym 스타일)
#### Task 6: 관측/액션 인코딩
- **Action**: `encoding.py`에서 상태를 고정 크기 텐서로 인코딩(자신의 손패, 공개된 트릭, 팀원/상대 잔여 카드 수, 티츄 콜 여부 등 관측 가능 정보만 포함 — 상대 손패는 노출 금지)하고, 매 턴 `legal_actions()`가 반환하는 후보 조합 리스트를 정책망이 점수화할 수 있는 형태로 정의
- **Validate**: 인코딩 shape/dtype 고정 단위 테스트, 은닉 정보 누출 없음을 확인하는 테스트(관측에 상대 손패 필드가 존재하지 않음을 assert)

#### Task 7: 환경 래퍼
- **Action**: `env.py`에 `reset()`/`step(action)`/`legal_actions()`/`observation()`/`reward()` 구현. `step`은 `legal_actions()` 밖의 action에 `ValueError`
- **Validate**: 랜덤 에이전트로 수천 판을 크래시 없이 완주하는 스모크 테스트

### Phase 3 — 베이스라인 에이전트
#### Task 8: 랜덤/휴리스틱 봇
- **Action**: `random_agent.py`(완전 랜덤 합법수 선택), `heuristic.py`(간단한 그리디 규칙: 가장 약한 유효 조합으로 트릭 따내기, 마지막 라운드 임박 시 티츄 콜 회피 등) 구현
- **Validate**: 휴리스틱 vs 랜덤 대국에서 휴리스틱 승률이 유의미하게 높음을 확인하는 통합 테스트(환경 정합성 간접 검증)

### Phase 4 — Self-Play 학습
#### Task 9: 정책/가치 네트워크
- **Action**: `policy_network.py`에 관측 인코딩을 입력으로 받아 각 후보 액션 점수(및 상태 가치)를 출력하는 PyTorch 모델 정의(가변 개수 후보 액션 처리 — 액션 임베딩 후 점수화 방식 추천)
- **Validate**: 순전파 shape 테스트, 그래디언트 흐름 확인(단순 backward 스모크 테스트)

#### Task 10: 자기대국 데이터 생성
- **Action**: `self_play.py`에서 현재 정책(및 과거 체크포인트 풀)을 4석에 배치해 병렬로 게임을 생성하고 (state, action, reward) 궤적 수집
- **Validate**: 지정한 게임 수만큼 생성되고 각 궤적의 길이/보상 합이 스코어링 로직과 일치하는지 검증

#### Task 11: 학습 루프
- **Action**: `train.py`에서 PPO(또는 단순 REINFORCE로 시작 후 필요시 PPO 전환) 기반 학습 루프 구현, 주기적 체크포인트 저장, 승률/loss 메트릭 기록
- **Validate**: 짧은 스모크 러닝(수십 iteration)이 크래시 없이 완료되고 메트릭 파일이 생성됨

### Phase 5 — 평가
#### Task 12: 평가 하네스
- **Action**: `arena.py`에서 최신 체크포인트 vs 휴리스틱 봇, 최신 vs 과거 체크포인트 간 다수 게임 실행 후 승률/Elo 산출
- **Validate**: 학습이 진행됨에 따라 최신 체크포인트가 휴리스틱 대비 승률이 개선되는지 관찰(정량적 목표치는 Open Question으로 남김 — 개인 R&D 프로젝트 특성상 "개선 추세 확인"을 1차 목표로 설정)

## Validation
```bash
cd ai
uv sync   # 또는 poetry install
uv run pytest --cov=tichu_env --cov=agents --cov-report=term-missing
uv run python -m training.self_play --games 100   # 스모크
uv run python -m training.train --iterations 20    # 스모크
uv run python -m eval.arena --checkpoint latest --opponent heuristic
```

## Risks
| Risk | Likelihood | Mitigation |
|---|---|---|
| Tichu는 불완전 정보 + 팀 기반 게임이라 단순 self-play RL(PPO 등)이 잘 수렴하지 않을 수 있음 | High | 1차 목표를 "휴리스틱 대비 승률 개선 추세 확인"으로 낮게 설정, 필요 시 behavior cloning(휴리스틱 모방)으로 워밍업 후 RL fine-tune으로 전환 |
| 초기 학습 데이터(self-play 게임) 생성 속도가 느려 반복 실험이 더딤 | Medium | 순수 Python 구현을 먼저 검증하고, 병목이 확인되면 numpy 벡터화 또는 병렬 프로세스(multiprocessing)로 self-play 처리량 개선 |
| Python 시뮬레이터와 향후 M1의 TS 규칙 엔진 간 규칙 불일치 | Medium | 이번 계획 범위 밖이지만, Task 2~5의 단위 테스트 시나리오를 문서화해두어 M1 재정렬 시 동일 시나리오로 TS 엔진을 교차 검증할 수 있게 준비 |
| 관측 인코딩에 실수로 은닉 정보(상대 손패 등)가 포함되어 "치팅 AI"가 됨 | Medium | Task 6에서 인코딩에 은닉 정보 필드가 없음을 명시적으로 단위 테스트 |

## Open Questions (이번 계획에서 결정하지 않음)
- RL 알고리즘 최종 선택(PPO vs 다른 self-play 기법)은 Task 11 착수 시점에 실험적으로 결정
- 학습 종료/성공 기준(목표 승률, Elo 임계값)은 미정 — PRD의 "TBD" 성공 지표와 동일하게 추후 실사용 성과로 검증
- **M1 구조를 M2에 맞추는 작업**(웹 서버가 이 Python 모델을 어떻게 호출할지: 추론 마이크로서비스 등)은 명시적으로 별도 계획으로 분리, 이번 계획 완료 후 착수

## Acceptance
- [ ] Phase 0~5 모든 태스크 완료
- [ ] `pytest` 전체 통과, `tichu_env`/`agents` 커버리지 80%+
- [ ] 휴리스틱 봇이 랜덤 봇 대비 유의미하게 높은 승률 기록(환경 정합성 간접 검증)
- [ ] self-play 학습이 크래시 없이 지정 iteration 수만큼 완주하고 체크포인트가 저장됨
- [ ] 평가 하네스로 학습 진행에 따른 승률/Elo 추세를 관찰 가능
- [ ] 관측 인코딩에 은닉 정보 누출이 없음을 테스트로 보장
- [ ] 웹 연동(추론 서비스 등)은 이번 계획에 포함하지 않았음을 확인

---
*Status: DRAFT PLAN — 코드 작성 전, 사용자 확인 대기 중.*
