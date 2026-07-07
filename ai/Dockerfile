FROM python:3.12-slim

WORKDIR /app

# numpy/pytest는 PyPI 기본 인덱스, torch는 CPU 전용 인덱스에서 별도 설치
# (Windows 호스트의 Python 3.14에는 PyTorch wheel이 없어 컨테이너로 우회)
RUN pip install --no-cache-dir numpy pytest pytest-cov \
    && pip install --no-cache-dir torch --index-url https://download.pytorch.org/whl/cpu

CMD ["sleep", "infinity"]
