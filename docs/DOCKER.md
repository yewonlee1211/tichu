# Docker 개발 환경 (ai/)

이 문서는 `ai/` 디렉터리(Tichu AI 시뮬레이터 & self-play 학습)의 Docker 개발 환경을 설명합니다.
Docker에 익숙하지 않은 사람이 읽어도 이해할 수 있도록, 개념 설명부터 실제 사용법까지 담았습니다.

## 1. 왜 Docker를 쓰는가

- 호스트(Windows)에 설치된 Python은 **3.14** 하나뿐인데, 학습에 필요한 **PyTorch는 아직 Python 3.14용 Windows wheel을 배포하지 않음** → 호스트에 직접 설치가 불가능한 상황이었음
- 대안으로 호스트에 Python 3.12를 별도 설치할 수도 있었지만, 대신 **Docker 컨테이너 안에 Python 3.12 + PyTorch(CPU)를 담아서** 그 문제를 우회하기로 결정
- 즉, Docker를 쓰는 이유는 "유행"이 아니라 **호스트 Python 버전과 무관하게 원하는 Python/라이브러리 버전을 격리된 환경에 고정**하기 위함

## 2. Docker 개념 3줄 요약

| 용어 | 의미 | 이 프로젝트에서 |
|---|---|---|
| **이미지(Image)** | 실행에 필요한 OS + 라이브러리를 담은 "설계도" 파일. 한 번 빌드하면 재사용 가능 | `Dockerfile`을 빌드해서 만든 `tichu-game-ai` 이미지 (Python 3.12 + numpy + torch + pytest 포함) |
| **컨테이너(Container)** | 이미지를 실제로 "실행"한 상태. 격리된 미니 리눅스 머신처럼 동작 | `tichu-game-ai-1`이라는 이름으로 계속 켜져 있는 컨테이너 |
| **볼륨 마운트(Volume Mount)** | 호스트의 폴더를 컨테이너 내부 경로에 실시간으로 연결. 컨테이너 안에서 파일을 보든, 호스트에서 보든 같은 파일 | 호스트의 `ai/` ↔ 컨테이너의 `/app`이 연결되어 있어, 호스트에서 코드를 수정하면 컨테이너 안에서 바로 반영됨 |

핵심 워크플로: **파일 편집은 호스트(VSCode 등)에서, 명령 실행(pytest, 학습 스크립트 등)은 컨테이너 안에서** 한다. VSCode Dev Container 같은 통합 방식은 설정 부담 대비 이득이 적다고 판단해 채택하지 않았다.

## 3. 파일 구성

```
tichu-game/
├── docker-compose.yml   # 컨테이너를 어떻게 띄울지 정의 (루트에 위치)
└── ai/
    ├── Dockerfile        # 이미지를 어떻게 만들지 정의
    ├── .dockerignore     # 이미지 빌드 시 제외할 파일 목록
    └── tests/
        └── test_environment_smoke.py   # 환경이 제대로 도는지 확인하는 최소 테스트
```

### `ai/Dockerfile`

```dockerfile
FROM python:3.12-slim

WORKDIR /app

RUN pip install --no-cache-dir numpy pytest pytest-cov \
    && pip install --no-cache-dir torch --index-url https://download.pytorch.org/whl/cpu

CMD ["sleep", "infinity"]
```

- `FROM python:3.12-slim`: Python 3.12가 설치된 가벼운 리눅스 이미지에서 시작
- `WORKDIR /app`: 컨테이너 내부 작업 디렉터리를 `/app`으로 지정
- `RUN pip install ...`: numpy/pytest/pytest-cov는 일반 PyPI에서, torch는 **CPU 전용 인덱스**에서 설치 (GPU 없는 환경이므로 용량이 훨씬 작은 CPU 빌드를 선택)
- `CMD ["sleep", "infinity"]`: 컨테이너가 할 일을 마치고 바로 꺼지지 않고 계속 켜져 있도록 유지. 이렇게 해야 나중에 `docker compose exec`로 그 안에 명령을 내릴 수 있음

### `docker-compose.yml`

```yaml
services:
  ai:
    build:
      context: ./ai
      dockerfile: Dockerfile
    volumes:
      - ./ai:/app
    working_dir: /app
    tty: true
    stdin_open: true
```

- `services.ai`: `ai`라는 이름의 서비스(컨테이너) 하나를 정의
- `build.context: ./ai`: `ai/Dockerfile`을 사용해 이미지를 빌드
- `volumes: ./ai:/app`: 호스트의 `ai/` 폴더를 컨테이너의 `/app`에 실시간 연결 (2번의 "볼륨 마운트")
- `tty` / `stdin_open`: 터미널 세션을 다루기 편하게 하는 옵션

### `ai/.dockerignore`

이미지를 빌드할 때 `__pycache__/`, `checkpoints/`, `.venv/` 같은 불필요한 파일을 이미지에 포함시키지 않도록 제외하는 목록. `.gitignore`와 비슷한 역할이지만 git이 아니라 Docker 빌드 대상에서 제외한다는 점이 다름.

## 4. 자주 쓰는 명령어

| 명령어 | 설명 |
|---|---|
| `docker compose build` | `Dockerfile`을 읽어 이미지를 새로 빌드 (Dockerfile을 수정했을 때 다시 실행) |
| `docker compose up -d` | 컨테이너를 백그라운드로 기동 (`-d` = detached) |
| `docker compose exec ai <command>` | 이미 켜져 있는 `ai` 컨테이너 안에서 명령 실행 (예: `pytest`, `python -m training.train`) |
| `docker compose ps` | 현재 떠 있는 컨테이너 상태 확인 |
| `docker compose logs ai` | 컨테이너 로그 확인 |
| `docker compose down` | 컨테이너 정지 및 제거 (이미지는 남아있어 다음에 `up`하면 빠르게 재기동) |

전형적인 하루의 흐름:
```bash
docker compose up -d          # (한 번만) 컨테이너 기동
docker compose exec ai pytest # 코드 수정 후 테스트 실행
docker compose exec ai python -m training.train --iterations 20
docker compose down           # 작업 종료 시 (선택)
```

## 5. 환경 검증 (smoke test)

`ai/tests/test_environment_smoke.py`는 numpy/torch가 컨테이너 안에서 정상적으로 import되고 계산이 되는지 확인하는 최소 테스트다.

```bash
docker compose exec ai pytest -v
```

```
tests/test_environment_smoke.py::test_numpy_is_importable PASSED
tests/test_environment_smoke.py::test_torch_is_importable_and_computes PASSED
2 passed in 1.62s
```

## 6. 현재 제약 및 향후 방향

- **CPU 전용**: 현재 NVIDIA GPU를 사용하지 않으므로 torch를 CPU 빌드로 설치했다. 추후 self-play 학습 처리량이 병목이 되면, `Dockerfile`의 torch 설치 인덱스를 CUDA 버전으로 바꾸고 `docker-compose.yml`에 GPU 리소스 예약을 추가하는 식으로 전환 가능
- **Dev Container 미사용**: VSCode Dev Container로 통합하면 에디터 안에서 바로 컨테이너 파일시스템을 다룰 수 있지만, 지금은 설정 비용 대비 이득이 크지 않다고 판단해 `docker compose exec` 방식을 유지 중

## 7. 다음 단계

Docker 환경 검증이 끝났으므로, 이어지는 작업은 `.claude/plans/tichu-ai-selfplay.plan.md`의 **Phase 0 Task 1(프로젝트 초기화 — `pyproject.toml`, `git init`, `.gitignore`)**부터 컨테이너 내부에서 진행한다. 저장소는 아직 git이 초기화되지 않은 상태다.
