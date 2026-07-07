# Handoff: Tichu AI — Docker 개발 환경 구성

이 문서는 Docker 환경 구성 작업을 **다른 세션**에서 이어가기 위한 인수인계 문서다. 이번 세션에서는 결정 사항까지만 정리하고, 실제 Dockerfile/compose 작성은 하지 않았다.

## 배경
- PRD: `.claude/prds/tichu-online.prd.md` — Milestone 2(AI 대결 모드) `in-progress`, Milestone 1(웹 실시간 대전)은 `pending`(보류)
- 상세 계획: `.claude/plans/tichu-ai-selfplay.plan.md` — Python Tichu 시뮬레이터 + self-play 학습 루프. 웹 연동(추론 서비스 등)은 이 계획 범위 밖
- 작업 디렉터리: 프로젝트 루트의 `ai/` (이미 생성됨, 현재 비어 있음)
- 저장소는 아직 git 미초기화 상태 (`git init` 안 됨)

## 이번 세션에서 발견한 문제
- 로컬에 설치된 Python은 3.14.1 하나뿐 (`py -0` 결과 확인, 다른 버전 없음)
- PyPI 확인 결과, PyTorch 최신 안정판(2.12.1)은 Python 3.14용 Windows wheel을 아직 제공하지 않음 (classifier에는 3.14가 명시돼 있으나 실제 배포 바이너리는 없음). `ai/tichu-ai-selfplay.plan.md`의 Phase 4(정책망 학습)가 PyTorch에 의존하므로 이대로는 진행 불가

## 이번 세션에서 결정된 사항
1. 호스트(Windows)에 Python 3.12를 별도 설치하는 대신 **Docker로 진행**하기로 결정 — 공식 PyTorch 이미지를 쓰면 버전 문제를 더 깔끔하게 우회할 수 있음
2. GPU: 현재는 **CPU 전용**으로 진행 (NVIDIA GPU 없음/미사용). 추후 처리량이 병목이 되면 CUDA 이미지로 전환
3. 편집-실행 루프: 파일은 호스트에서 편집하고, 명령 실행(pytest, 학습 스크립트 등)은 **`docker compose exec`**로 컨테이너 안에서 수행 — VSCode Dev Container 방식은 채택하지 않음(설정 부담 대비 이득 적다고 판단)

## 다음 세션에서 할 일
- [ ] Base image 선택 — 후보: `python:3.12-slim` + `pip install torch` (CPU 인덱스), 또는 공식 CPU 전용 PyTorch 이미지. 이미지 크기 vs 설정 편의성 트레이드오프 검토
- [ ] `ai/Dockerfile` 작성
- [ ] `docker-compose.yml` 작성 — `ai/`를 볼륨 마운트, 서비스명(예: `ai`), 컨테이너 작업 디렉터리 지정
- [ ] `.dockerignore` 작성 (`checkpoints/`, `__pycache__/`, `.pytest_cache/` 등 제외)
- [ ] 컨테이너 기동 후 의존성 설치 확인 (numpy, torch-cpu, pytest, pytest-cov)
- [ ] `docker compose exec ai pytest` 형태의 smoke test로 환경 검증
- [ ] `git init` + `.gitignore` 정리 시점 결정 (호스트에서 할지, 컨테이너와 무관하게 먼저 할지) — 저장소가 아직 git 미초기화 상태임을 잊지 말 것

## Docker 환경 완료 후 이어질 작업
`docker compose exec`로 커맨드가 정상 동작하는 것이 확인되면, `.claude/plans/tichu-ai-selfplay.plan.md`의 Phase 0 Task 1(프로젝트 초기화)부터 순서대로 진행:
- Task 1: 프로젝트 초기화 (`pyproject.toml`, `git init`, `.gitignore`) — 컨테이너 내부에서 실행
- Task 2~5: Tichu 규칙 엔진 (`ai/tichu_env/`)
- Task 6~7: 학습 환경(Gym 스타일 wrapper)
- Task 8: 베이스라인 에이전트
- Task 9~11: Self-play 학습 루프
- Task 12: 평가 하네스

전체 태스크 상세는 `.claude/plans/tichu-ai-selfplay.plan.md` 참고.

## 기타 메모
- `ai/` 폴더는 이미 생성되어 있으나 현재 비어 있음
- Milestone 1(웹사이트) 관련 작업은 이 문서/계획과 무관 — 별도로 보류 중이며 이번 Docker 작업과 순서상 독립적
