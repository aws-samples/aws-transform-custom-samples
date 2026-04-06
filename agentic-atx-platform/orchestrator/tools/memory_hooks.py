"""Short-term memory hooks for ATX Transform orchestrator."""

import logging
import json
from bedrock_agentcore.memory import MemoryClient
from strands.hooks import AgentInitializedEvent, MessageAddedEvent, AfterToolCallEvent, HookProvider, HookRegistry

logger = logging.getLogger(__name__)


class ShortTermMemoryHook(HookProvider):
    """Hook to store and retrieve short-term conversation memory."""

    def __init__(self, memory_client: MemoryClient, memory_id: str):
        self.memory_client = memory_client
        self.memory_id = memory_id
        self.tool_results = []

    def on_agent_initialized(self, event: AgentInitializedEvent):
        """Load conversation history when agent starts."""
        try:
            actor_id = event.agent.state.get("actor_id")
            session_id = event.agent.state.get("session_id")
            if not actor_id or not session_id or not self.memory_id:
                return

            recent_turns = self.memory_client.get_last_k_turns(
                memory_id=self.memory_id,
                actor_id=actor_id,
                session_id=session_id,
                k=10,
                branch_name="main"
            )

            if recent_turns:
                context_messages = []
                for turn in recent_turns:
                    for message in turn:
                        role = message['role'].title()
                        content = message['content']['text']
                        context_messages.append(f"{role}: {content}")

                context = "\n".join(context_messages)
                event.agent.system_prompt += f"\n\n## Previous Conversation Context:\n{context}\n"
                logger.info(f"Loaded {len(recent_turns)} turns from memory")

        except Exception as e:
            logger.error(f"Failed to load memory: {e}")

    def on_tool_executed(self, event: AfterToolCallEvent):
        """Track tool execution results."""
        try:
            tool_name = event.tool_use.name if hasattr(event.tool_use, 'name') else "unknown"
            self.tool_results.append({
                "tool": tool_name,
                "result": str(event.result)[:500]
            })
        except Exception as e:
            logger.error(f"Failed to track tool: {e}")

    def on_message_added(self, event: MessageAddedEvent):
        """Store new messages to memory."""
        try:
            actor_id = event.agent.state.get("actor_id")
            session_id = event.agent.state.get("session_id")
            if not actor_id or not session_id or not self.memory_id:
                return

            messages = event.agent.messages
            if not messages:
                return

            last_message = messages[-1]
            content = last_message.get("content", "")
            if isinstance(content, list):
                content = content[0].get("text", "") if content else ""

            if not content:
                return

            # Append tool context to assistant messages
            if last_message['role'] == 'assistant' and self.tool_results:
                tool_ctx = "\n\n[Tool Context]\n" + "\n".join(
                    f"- {t['tool']}: {t['result'][:200]}" for t in self.tool_results
                )
                content += tool_ctx
                self.tool_results = []

            self.memory_client.create_event(
                memory_id=self.memory_id,
                actor_id=actor_id,
                session_id=session_id,
                messages=[(content, last_message["role"])]
            )

        except Exception as e:
            logger.error(f"Failed to store message: {e}")

    def register_hooks(self, registry: HookRegistry) -> None:
        """Register hook callbacks."""
        registry.add_callback(AgentInitializedEvent, self.on_agent_initialized)
        registry.add_callback(MessageAddedEvent, self.on_message_added)
        registry.add_callback(AfterToolCallEvent, self.on_tool_executed)
