"""Memory client for ATX Transform using AWS Bedrock AgentCore Memory."""

import os
from bedrock_agentcore.memory import MemoryClient

_memory_client = None
_memory_id = None

MEMORY_NAME = "ATX_Transform_Memory"


def get_memory_client() -> MemoryClient:
    """Get or create memory client singleton."""
    global _memory_client
    if _memory_client is None:
        region = os.getenv("AWS_REGION", "us-east-1")
        _memory_client = MemoryClient(region_name=region)
    return _memory_client


def initialize_memory() -> str:
    """Initialize or get existing memory resource."""
    global _memory_id
    if _memory_id:
        return _memory_id

    client = get_memory_client()

    try:
        memories = client.list_memories()
        for memory in memories:
            mid = memory.get('id') or memory.get('memoryId')
            if mid and MEMORY_NAME in mid:
                _memory_id = mid
                print(f"Using existing memory: {_memory_id}")
                return _memory_id

        memory = client.create_memory_and_wait(
            name=MEMORY_NAME,
            strategies=[],
            description="Short-term memory for ATX Transform orchestrator",
            event_expiry_days=30
        )
        _memory_id = memory['id']
        print(f"Created new memory: {_memory_id}")
        return _memory_id

    except Exception as e:
        if "already exists" in str(e):
            try:
                memories = client.list_memories()
                for memory in memories:
                    mid = memory.get('id') or memory.get('memoryId')
                    if mid and MEMORY_NAME in mid:
                        _memory_id = mid
                        return _memory_id
            except Exception:
                pass
        print(f"Warning: Memory init failed: {e}")
        return None
