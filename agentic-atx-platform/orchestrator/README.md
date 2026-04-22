# ATX Transform Orchestrator

Bedrock AgentCore agent that coordinates code transformations using AWS Transform CLI.

## Architecture

The orchestrator is a Strands Agent with 3 specialized sub-agents:

```
Orchestrator (agent.py)
├── find_transform_agent    → Search catalog + custom transforms
├── execute_transform_agent → Submit Batch jobs, check status, list results
└── create_transform_agent  → Generate definitions, publish to ATX registry
```

Each sub-agent is itself a Strands Agent with its own system prompt and tools that call AWS services directly (Batch, S3, Bedrock).

## Files

| File | Purpose |
|------|---------|
| `agent.py` | Main orchestrator with system prompt and entrypoint |
| `tools/findtransform.py` | Catalog search (static + S3 custom) |
| `tools/executetransform.py` | Batch submit, status, results |
| `tools/createtransform.py` | Generate definition (Bedrock), publish (Batch) |
| `tools/memory_client.py` | AgentCore Memory client |
| `tools/memory_hooks.py` | Short-term memory hooks |
| `requirements.txt` | Python dependencies |

## Deploy

```bash
python3.11 -m venv .venv && source .venv/bin/activate
pip install bedrock-agentcore strands-agents boto3 pyyaml bedrock-agentcore-starter-toolkit

agentcore configure -e agent.py -n atx_transform_orchestrator -r us-east-1 -ni \
  --deployment-type direct_code_deploy --runtime PYTHON_3_11 -rf requirements.txt
agentcore deploy --auto-update-on-conflict
```

## Test

```bash
agentcore invoke '{"prompt": "List Python transformations"}'
agentcore invoke '{"prompt": "Execute AWS/python-version-upgrade on https://github.com/user/repo"}'
```

## Local Development

```bash
source .venv/bin/activate
python3.11 agent.py  # Runs on port 8080
```
