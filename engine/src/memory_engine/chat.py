"""Ask the local 8B model for one JSON reply that follows a schema."""

import copy
import json
from typing import Protocol

from memory_engine.ollama import OllamaError, post_json


class ChatError(OllamaError):
    """Ollama itself failed; the run has to stop."""


class ModelReplyError(ValueError):
    """The model's reply broke the format; that turn fails and the model is told why."""


class ChatModel(Protocol):
    def complete(self, messages: list[dict], schema: dict) -> dict: ...


class OllamaChat:
    def __init__(
        self, url: str, model: str, context_window: int = 1999, reply_tokens: int = 450, timeout: float = 300.0
    ):
        self.url = url.rstrip("/")
        self.model = model
        self.context_window = context_window
        self.reply_tokens = reply_tokens
        self.timeout = timeout

    def complete(self, messages: list[dict], schema: dict) -> dict:
        payload = {
            "model": self.model,
            "messages": messages,
            "format": schema,
            "stream": False,
            "think": False,
            "options": {"num_ctx": self.context_window, "num_predict": self.reply_tokens, "temperature": 0.2},
        }
        answer = post_json(self.url, "/api/chat", payload, self.timeout, self.model, ChatError)
        if answer.get("done_reason") == "length":
            raise ModelReplyError(
                f"the reply was cut off at {self.reply_tokens} tokens: keep scratchpad and chunk_body shorter")
        try:
            content = answer["message"]["content"]
        except (KeyError, TypeError) as err:
            raise ChatError(f"Ollama at {self.url} gave an unexpected response (no message)") from err
        try:
            reply = json.loads(content)
        except ValueError as err:
            raise ModelReplyError(f"the reply was not valid JSON: {err}") from err
        if not isinstance(reply, dict):
            raise ModelReplyError("the reply was not a JSON object")
        return reply


class ScriptedModel:
    """A stand-in model for tests: replays prepared replies (an exception is raised) and records prompts."""

    def __init__(self, replies: list):
        self.replies = list(replies)
        self.prompts: list[list[dict]] = []
        self.schemas: list[dict] = []

    def complete(self, messages: list[dict], schema: dict) -> dict:
        self.prompts.append(copy.deepcopy(messages))
        self.schemas.append(schema)
        if not self.replies:
            raise RuntimeError("ScriptedModel has no replies left")
        reply = self.replies.pop(0)
        if isinstance(reply, BaseException):
            raise reply
        return reply
