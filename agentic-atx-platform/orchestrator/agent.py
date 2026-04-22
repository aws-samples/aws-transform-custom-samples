#!/usr/bin/env python3
"""
ATX Transform Orchestrator Agent

A Strands agent that orchestrates code transformation using ATX CLI.
Coordinates three specialized sub-agents:
1. FindTransform Agent: Discovers existing transformations
2. ExecuteTransform Agent: Executes transformations and monitors jobs
3. CreateTransform Agent: Creates custom transformation definitions
"""

import os
import json
import logging
from datetime import datetime

# Monkey-patch Strands streaming to fix type concatenation bug
# (upstream issue: streaming.py line 216 does str += int when tool input has integer values)
try:
    from strands.event_loop import streaming as _streaming
    _original_handle = _streaming.handle_content_block_delta
    def _patched_handle(content_block_delta, state):
        if "toolUse" in content_block_delta.get("delta", {}):
            delta = content_block_delta["delta"]["toolUse"]
            if "input" in delta and isinstance(delta["input"], (int, float)):
                delta["input"] = str(delta["input"])
        return _original_handle(content_block_delta, state)
    _streaming.handle_content_block_delta = _patched_handle
except Exception:
    pass  # If patch fails, continue without it

from strands import Agent
from strands.models import BedrockModel
from bedrock_agentcore.runtime import BedrockAgentCoreApp

# Lazy imports for tools (loaded on first request, not at startup)
find_transform_agent = None
execute_transform_agent = None
create_transform_agent = None

def _load_tools():
    global find_transform_agent, execute_transform_agent, create_transform_agent
    if find_transform_agent is None:
        from tools.findtransform import find_transform_agent as _find
        from tools.executetransform import execute_transform_agent as _execute
        from tools.createtransform import create_transform_agent as _create
        find_transform_agent = _find
        execute_transform_agent = _execute
        create_transform_agent = _create
from tools.memory_hooks import ShortTermMemoryHook

# Initialize the App
app = BedrockAgentCoreApp()

# Lazy-initialize memory (don't block startup)
memory_client = None
memory_id = None

def _init_memory():
    global memory_client, memory_id
    if memory_client is None:
        try:
            from tools.memory_client import get_memory_client, initialize_memory as _init_mem
            memory_client = get_memory_client()
            memory_id = _init_mem()
        except Exception as e:
            logger.warning(f"Memory init failed (continuing without memory): {e}")
            memory_id = None

logger = logging.getLogger(__name__)
logger.setLevel(logging.INFO)

ORCHESTRATOR_PROMPT = """You are the ATX Transform Orchestrator, responsible for coordinating code transformations.

# Available Tools

1. **find_transform_agent**: Finds the best matching transformation from the available catalog
2. **execute_transform_agent**: Executes transformations, checks job status, and retrieves job results
3. **create_transform_agent**: Creates and publishes custom transformation definitions to the ATX registry

# Available AWS-Managed Transformations
- AWS/python-version-upgrade: Upgrade Python 3.8 → 3.13
- AWS/java-version-upgrade: Upgrade Java any → any (with dependency modernization)
- AWS/nodejs-version-upgrade: Upgrade Node.js any → any
- AWS/python-boto2-to-boto3: Migrate boto2 → boto3 AWS SDK
- AWS/java-aws-sdk-v1-to-v2: Migrate Java AWS SDK v1 → v2
- AWS/nodejs-aws-sdk-v2-to-v3: Migrate Node.js AWS SDK v2 → v3
- AWS/comprehensive-codebase-analysis: Deep static analysis with technical debt, security, and modernization insights
- AWS/java-performance-optimization: Optimize Java performance using JFR profiling data
- AWS/early-access-java-x86-to-graviton: Java x86 to ARM64/Graviton
- AWS/early-access-angular-to-react-migration: Angular to React
- AWS/vue.js-version-upgrade: Upgrade Vue.js 2 → Vue.js 3
- AWS/angular-version-upgrade: Upgrade older Angular to target version
- AWS/early-access-log4j-to-slf4j-migration: Migrate Log4j to SLF4J with Logback

IMPORTANT: You can execute any transformation from the AWS-managed list above, plus any custom transformations published to the registry. Before executing a non-AWS transformation, use find_transform_agent to verify it exists. Custom transformation names do NOT start with "AWS/".

# Orchestration Protocol

Follow this sequence when handling transformation requests:

1. **If a specific transformation is provided** → Go directly to step 4 (execute)
2. **If no transformation is specified** → Use find_transform_agent to search for the best match
3. **If find_transform_agent does NOT find a suitable transformation** → Use create_transform_agent to generate and publish a new custom transformation based on the requirements
4. **Once you have the transformation name** → Use execute_transform_agent to execute it on the repository

This find → create → execute chain ensures every request gets handled, even if no existing transformation matches.

# How to Handle Different Requests

**"Execute transformation X on repo Y"** → Skip to step 4, use execute_transform_agent with the EXACT transformation name (e.g., "AWS/python-version-upgrade" for AWS-managed, or "add-error-handling" for custom - do NOT add "AWS/" prefix to custom transforms)
**"Transform repo Y" (no transformation specified)** → Follow steps 2-4: find best match, create if needed, then execute
**"Check status of job <id>"** → Use execute_transform_agent and ask it to check the job status
**"Show results for job <id>"** → Use execute_transform_agent and ask it to list the job results
**"What transformations are available?"** → Use find_transform_agent
**"Find a transformation for <requirement>"** → Use find_transform_agent
**"Create a custom transformation that..."** → Use create_transform_agent
**"Publish transformation <name>"** → Use create_transform_agent

# Response Format
Always provide clear status, details, and next steps. Do NOT ask follow-up questions like "Would you like me to..." or "Is there anything else..." - this is a one-shot API, not a chatbot. Just report what was done and the results."""


def create_orchestrator(session_id: str = None, actor_id: str = None) -> Agent:
    """Create the ATX Transform orchestrator agent."""
    _init_memory()
    _load_tools()

    region = os.getenv("AWS_REGION", "us-east-1")
    model_id = os.getenv("BEDROCK_MODEL_ID", "us.anthropic.claude-sonnet-4-20250514-v1:0")

    bedrock_model = BedrockModel(
        model_id=model_id,
        region_name=region,
        temperature=0.5,
        max_tokens=4096
    )

    hooks = []
    if memory_id:
        from tools.memory_hooks import ShortTermMemoryHook
        hooks.append(ShortTermMemoryHook(memory_client, memory_id))

    orchestrator = Agent(
        model=bedrock_model,
        system_prompt=ORCHESTRATOR_PROMPT,
        tools=[find_transform_agent, execute_transform_agent, create_transform_agent],
        hooks=hooks,
        state={"actor_id": actor_id, "session_id": session_id}
    )

    return orchestrator


@app.entrypoint
def invoke(payload):
    """Bedrock AgentCore entrypoint."""
    try:
        user_message = payload.get("prompt", payload.get("message", ""))

        timestamp = datetime.now().strftime("%Y%m%d%H%M%S")
        session_id = f"atx-transform-{timestamp}"

        orchestrator = create_orchestrator(
            session_id=session_id,
            actor_id="atx_user"
        )

        logger.info("Starting ATX Transform orchestration")
        response = orchestrator(user_message)
        logger.info("Orchestration completed")

        if hasattr(response, 'message'):
            response_content = response.message
        elif hasattr(response, 'content'):
            response_content = response.content
        else:
            response_content = str(response)

        return {"result": response_content}

    except Exception as e:
        logger.error(f"Orchestration failed: {e}", exc_info=True)
        return {
            "statusCode": 500,
            "body": json.dumps({"error": str(e)})
        }


if __name__ == "__main__":
    print("Starting ATX Transform Orchestrator...")
    print("Server will be available at http://localhost:8080")
    app.run()
