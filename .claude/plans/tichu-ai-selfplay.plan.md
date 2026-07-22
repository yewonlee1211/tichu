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
#### Task 9: 정책/가치 네트워크 ✅ 완료
- **Action**: `policy_network.py`에 관측 인코딩을 입력으로 받아 각 후보 액션 점수(및 상태 가치)를 출력하는 PyTorch 모델 정의(가변 개수 후보 액션 처리 — 액션 임베딩 후 점수화 방식 추천)
- **구현**: `TichuPolicyValueNet` — `state_encoder`(OBS_DIM → embedding), `action_encoder`(ACTION_DIM → embedding, 후보별 독립 인코딩), `action_scorer`(state+action 임베딩 concat → 로짓 1개), `value_head`(state 임베딩 → 스칼라). `forward(obs, action_vectors)`는 단일 관측 + 가변 개수 후보 액션을 받아 `(action_logits, state_value)` 반환. `action_probabilities()`로 softmax 편의 제공
- **Validate**: `tests/test_policy_network.py` 5개 테스트 — 순전파 shape(후보 수만큼 로짓 + 스칼라 가치), 후보 1개/0개 경계, softmax 합 1.0, 전 파라미터에 유한한 그래디언트 도달(backward 스모크). 전체 158 테스트 통과, 커버리지 95% 유지(`policy_network.py` 100%)

#### Task 10: 자기대국 데이터 생성 ✅ 완료
- **Action**: `self_play.py`에서 현재 정책(및 과거 체크포인트 풀)을 4석에 배치해 병렬로 게임을 생성하고 (state, action, reward) 궤적 수집
- **구현**: 과거 체크포인트 풀은 아직 체크포인트가 존재하지 않으므로(Task 11 전) 이번 태스크 범위에서 제외 — 현재 네트워크를 4석 모두에 배치하는 미러 self-play로 시작(계획 Risks란의 "순수 Python 먼저 검증" 방침과 일치). `Transition`(observation, action_vectors, chosen_index, reward)과 `play_self_play_round`/`generate_self_play_games` 구현. 매 턴 `action_probabilities()`로 합법 액션 분포를 계산해 샘플링(탐색 필요 — argmax 아님). `reward`는 `TichuEnv.step`의 기존 관례(매 스텝 0.0, 종료 시에만 실제 값)를 그대로 따라 각 플레이어 궤적의 **마지막** 트랜지션에만 `score_round` 기반 팀 마진(자기 팀 점수 − 상대 팀 점수)을 기록
- **Validate**: `tests/test_self_play.py` 5개 — 게임당 궤적 4개 생성, 모든 `chosen_index`가 해당 스텝의 후보 범위 내, 마지막 트랜지션 외 보상 0, 같은 팀 두 명은 동일한 라운드 마진을 받고 상대 팀과는 부호가 반대(zero-sum), `Transition` 불변성. 전체 163 테스트 통과, 커버리지 95% 유지(`self_play.py` 98%, 미커버 라인은 "플레이어가 한 번도 턴을 못 받은" 사실상 도달 불가능한 방어 분기)

#### Task 11: 학습 루프 ✅ 완료
- **Action**: `train.py`에서 PPO(또는 단순 REINFORCE로 시작 후 필요시 PPO 전환) 기반 학습 루프 구현, 주기적 체크포인트 저장, 승률/loss 메트릭 기록
- **결정**: RL 알고리즘은 사용자와 상의해 REINFORCE(+가치망 베이스라인)로 시작하기로 결정(계획의 Open Questions에 명시된 대로 Task 11 착수 시점에 결정) — 필요 시 이후 PPO로 전환 가능하도록 데이터 구조는 알고리즘에 종속되지 않게 유지(Task 10의 Transition은 old-policy log-prob 없이 (state, action, reward)만 저장)
- **구현**: `compute_reinforce_loss` — 라운드 내 무할인 Monte Carlo return(각 궤적의 마지막 트랜지션 보상을 그 궤적 전체의 return으로 사용, `training/self_play.py`의 관례와 일치) 기반 정책 손실(-log_prob × advantage, advantage = return − V(s).detach())과 가치 손실(MSE) 계산. `train()`은 매 iteration마다 on-policy self-play 데이터를 새로 생성해 1회 gradient step 수행, CSV(`iteration, games, mean_return, policy_loss, value_loss`)에 메트릭 기록, `checkpoint_every` 간격(+마지막 iteration 항상)으로 `checkpoints/checkpoint_{iter}.pt` 저장. `python -m training.train --iterations N ...` CLI 제공
- **Validate**: `tests/test_train.py` 6개 — 지정 iteration 수만큼 크래시 없이 완주, iteration당 메트릭 행 1개씩 기록, 마지막 iteration 항상 체크포인트, 설정한 간격에서만 체크포인트 생성, 저장된 체크포인트가 동일 구조 네트워크에 정확히 복원됨, 학습 후 파라미터가 실제로 변함. CLI(`docker compose exec ai python -m training.train --iterations 5 ...`)로 실제 실행 확인(체크포인트+metrics.csv 생성 확인). 전체 169 테스트 통과, 전체 커버리지 94%(`train.py` 79% — 미커버 라인은 pytest로 실행하지 않는 argparse `_main()` CLI 진입점, CLI로 별도 수동 검증함)

### Phase 5 — 평가
#### Task 12: 평가 하네스 ✅ 완료
- **Action**: `arena.py`에서 최신 체크포인트 vs 휴리스틱 봇, 최신 vs 과거 체크포인트 간 다수 게임 실행 후 승률/Elo 산출
- **구현**: `load_checkpoint`(체크포인트 로드 + eval 모드), `policy_chooser`(기본 argmax — 탐색이 아니라 정책의 실제 실력을 측정하기 위함, `deterministic=False`로 샘플링도 가능), `heuristic_chooser`, `play_arena_round`/`run_arena`(팀 A=시트0,2 vs 팀 B=시트1,3, N게임 실행 후 승/패/무 집계), `_elo_diff_from_win_rate`(표준 performance-rating 공식으로 승률→Elo 추정, 0/1 경계는 클리핑해 무한대 방지). `python -m eval.arena --checkpoint latest --opponent heuristic` CLI 제공(`--checkpoint`/`--opponent`에 `latest` 키워드로 최신 체크포인트 자동 탐색 지원)
- **버그 발견 및 수정**: 실제 체크포인트로 아레나를 대량 실행하던 중 크래시 발견 → `state.py`가 더블 아웃(한 팀 두 명이 3번째 아웃 전에 먼저 1·2등 차지) 시 라운드를 즉시 종료하지 않던 버그였음(Task 4 이후 두 차례 코드 리뷰에서도 놓쳤던 부분). `state.py`/`scoring.py`를 수정해 더블 아웃이 발생하는 즉시 라운드가 끝나도록 고침 — 상세 내용은 `ai/RULES.md` 5.6절에 기록. 이 수정으로 이제는 불가능해진 시나리오를 전제로 하던 기존 테스트 1개를 삭제(반시계 방향 리더 대체 로직 자체는 다른 테스트로 계속 커버됨)
- **Validate**: `tests/test_arena.py` 11개(Elo 공식 경계/부호, `policy_chooser` 결정적/확률적 모드 모두 항상 합법수만 반환, 체크포인트 로드 후 파라미터 정확히 일치, `latest` 탐색 성공/실패, 휴리스틱이 랜덤 상대로 승률/Elo 모두 양수) 전부 통과. CLI로 실제 체크포인트 간 대국(휴리스틱 상대, 체크포인트 상대 둘 다) 실행 확인. 전체 180 테스트 통과, 커버리지 93%(`arena.py` 81% — 미커버는 argparse `_main()` CLI 진입점, CLI로 별도 수동 검증)

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
- [x] Phase 0~5 모든 태스크 완료
- [x] `pytest` 전체 통과, `tichu_env`/`agents` 커버리지 80%+ (180개 테스트, 전체 93%)
- [x] 휴리스틱 봇이 랜덤 봇 대비 유의미하게 높은 승률 기록(환경 정합성 간접 검증) — 100판 누적 팀 점수 + 아레나 하네스 승률/Elo 양쪽으로 확인
- [x] self-play 학습이 크래시 없이 지정 iteration 수만큼 완주하고 체크포인트가 저장됨 — REINFORCE+가치망 베이스라인으로 구현, CLI 스모크런으로 확인
- [x] 평가 하네스로 학습 진행에 따른 승률/Elo 추세를 관찰 가능 — `eval/arena.py`, 체크포인트 vs 휴리스틱/체크포인트 vs 체크포인트 둘 다 CLI로 실행 확인
- [x] 관측 인코딩에 은닉 정보 누출이 없음을 테스트로 보장
- [x] 웹 연동(추론 서비스 등)은 이번 계획에 포함하지 않았음을 확인

---
*Status: Phase 0~5(Task 1~12) 전부 완료 — 규칙 엔진, 학습 환경, 베이스라인 에이전트, 정책망, self-play 데이터 생성, REINFORCE 학습 루프, 평가 하네스. Task 12 검증 중 더블 아웃 라운드 종료 버그를 발견해 수정함(`ai/RULES.md` 5.6절 참고). 이 계획의 범위(웹사이트와 독립된 Python 시뮬레이터 + self-play 학습)는 여기서 마무리. M1 구조를 M2에 맞추는 작업은 Open Questions에 명시된 대로 별도 계획.*
