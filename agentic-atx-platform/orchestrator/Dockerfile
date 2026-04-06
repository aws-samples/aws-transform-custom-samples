FROM public.ecr.aws/docker/library/python:3.11-slim

WORKDIR /app
COPY . .

RUN pip install --no-cache-dir -r requirements.txt

RUN useradd -m -u 1000 bedrock_agentcore
USER bedrock_agentcore

ENV AWS_REGION=us-east-1
ENV BEDROCK_MODEL_ID=us.anthropic.claude-sonnet-4-20250514-v1:0
EXPOSE 8080

CMD ["opentelemetry-instrument", "python", "agent.py"]
