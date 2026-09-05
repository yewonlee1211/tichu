FROM python:3.12-slim

WORKDIR /app

# numpy/pytest는 PyPI 기본 인덱스, torch는 CPU 전용 인덱스에서 별도 설치
# (Windows 호스트의 Python 3.14에는 PyTorch wheel이 없어 컨테이너로 우회)
RUN pip install --no-cache-dir numpy pytest pytest-cov onnx onnxruntime boto3 \
    && pip install --no-cache-dir torch --index-url https://download.pytorch.org/whl/cpu

# ai/ 전체가 compose에서 /app에 bind mount되므로, 빌드 시점에는 tichu_env 등
# 패키지 코드가 아직 존재하지 않는다(pyproject.toml의 editable install은 빌드
# 시점에 패키지를 찾지 못해 무의미함). 대신 /app을 PYTHONPATH에 둬서 bind mount된
# 어떤 패키지(tichu_env, agents, training, eval)든 재설치 없이 바로 import되게 한다.
ENV PYTHONPATH=/app

CMD ["sleep", "infinity"]
