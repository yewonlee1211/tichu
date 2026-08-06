# Handoff: ONNX export 파이프라인 (Python, `ai/export`)

**상위 세션**: `2026-07-30-m1-web-kickoff` (M1 총괄 세션) — 시작 시 `/session-start`로 이 값을 상위 세션으로 등록할 것
**소스 플랜**: `.claude/plans/tichu-online.plan.md` — 이 문서의 **Phase 3, Task 13-14**
**의존성**: 없음 — `ai/agents/policy_network.py`와 학습 중인 `checkpoints/checkpoint_*.pt`만 있으면 됨. `tichu-web-shared-engine` 세션과 완전히 병행 가능
**이 작업을 기다리는 것**: `tichu-solo-ai-browser` 세션이 이 세션이 만드는 `.onnx.enc` 산출물을 소비함

## 배경
AI 대국(혼자 모드)은 서버를 거치지 않고 **브라우저에서 ONNX 모델을 직접 실행**하기로 확정했다(비용 최소화 + 완전 오프라인 지원이 목적, 랭킹 없음이라 모델 노출은 수용된 리스크). 이 세션은 PyTorch로 학습된 정책망을 브라우저(onnxruntime-web)에서 돌 수 있는 형태로 내보내는 파이프라인만 담당한다. M2는 아직 장기 학습이 진행 중이므로, 이 export 스크립트는 **특정 체크포인트를 지정하면 언제든 재실행 가능**해야 한다(모델이 나중에 고정되면 마지막에 한 번만 실행하면 됨).

## 이 세션이 할 일
1. **Task 13**: `ai/export/export_onnx.py` 작성
   - `--checkpoint checkpoints/checkpoint_N.pt --out <path>` 형태의 CLI
   - `TichuPolicyValueNet`(`ai/agents/policy_network.py`)에 state_dict 로드
   - `forward(obs, action_vectors) -> (action_logits, state_value)` 시그니처를 그대로 ONNX로 export
   - **입력 이름 고정**: `obs`(shape `[OBS_DIM]`), `action_vectors`(shape `[num_candidates, ACTION_DIM]`, `num_candidates`는 **동적 축** — Tichu는 턴마다 합법수 개수가 다름)
   - **출력 이름 고정**: `action_logits`(`[num_candidates]`), `state_value`(스칼라)
   - 이 입출력 계약(이름/shape)은 브라우저 쪽(`tichu-solo-ai-browser` 세션)과 1:1 대응되어야 하므로, 스크립트 상단 docstring에 명시적으로 문서화할 것
   - **중요**: 이 계약은 M2가 네트워크 구조(hidden_dim, embedding_dim 등)를 바꿔도 forward 시그니처 자체(obs/action_vectors 입력, logits/value 출력)만 유지되면 깨지지 않는다. 만약 M2가 forward 시그니처 자체를 바꾼다면(예: 추가 입력이 필요해짐) 이 export 스크립트도 같이 업데이트해야 한다는 점을 M2 관련 세션/사용자에게 알릴 것
2. **Task 14**: `ai/export/obfuscate.py` (또는 `export_onnx.py` 내 유틸 함수) — export된 `.onnx` 바이트를 reversible 인코딩(예: 고정 키 XOR)으로 감싸 `.onnx.enc`로 저장. 목적은 진짜 보안이 아니라 "우클릭 저장/URL 직접 접근으로 바로 못 쓰게" 하는 가벼운 마찰(friction) 수준 — 과도한 엔지니어링(진짜 암호화, 라이선스 서버 등) 금지
3. **`ai/tests/test_export_onnx.py`**: 동일한 임의 입력(관측/후보 액션)에 대해 원본 PyTorch 모델과 export된 ONNX 모델(onnxruntime로 로드)이 수치적으로 동일한 출력을 내는지 parity 테스트

## 컨벤션 (기존 `ai/` 코드 미러링)
- PEP 8, 타입 힌트 필수, `from __future__ import annotations`
- 잘못된 입력은 즉시 `ValueError`(방어적 fallback 없음) — 참고: `ai/training/train.py:225-238`
- pytest, 시나리오 기반 테스트

## 환경
- Python/PyTorch 작업은 Docker 컨테이너 안에서 실행: `docker compose exec ai ...` (호스트 Python 3.14는 PyTorch wheel 미지원 — `tichu-ai-docker-env.handoff.md` 참고)
- `onnx`, `onnxruntime` 패키지를 `ai/pyproject.toml`의 dependencies(또는 새 optional-dependencies 그룹, 예: `export`)에 추가할 것

## Validate
```bash
docker compose exec ai python -m export.export_onnx --checkpoint checkpoints/checkpoint_N.pt --out packages/client/public/models/policy.onnx.enc
docker compose exec ai pytest ai/tests/test_export_onnx.py
```

## 완료 기준
- [ ] parity 테스트 통과(PyTorch 원본과 ONNX 출력 수치 일치)
- [ ] 입출력 계약이 문서화되어 브라우저 쪽 세션이 참고할 수 있음
- [ ] 완료 후 `2026-07-30-m1-web-kickoff` 세션에 완료 보고 + 계약 문서 위치 공유
