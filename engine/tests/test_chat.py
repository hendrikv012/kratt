import json

import pytest

from memory_engine.chat import ChatError, ModelReplyError, OllamaChat, ScriptedModel

PLAN = {"type": "object"}


def chat_reply(obj):
    return {"message": {"role": "assistant", "content": json.dumps(obj)}, "done": True}


def test_chat_returns_the_parsed_reply(make_stub):
    stub = make_stub(payload=chat_reply({"steps": ["Read", "Write"]}))
    reply = OllamaChat(stub.url, "qwen3:8b").complete([{"role": "user", "content": "plan"}], PLAN)
    assert reply == {"steps": ["Read", "Write"]}


def test_chat_request_keeps_the_window_below_2000(make_stub):
    stub = make_stub(payload=chat_reply({}))
    OllamaChat(stub.url, "qwen3:8b").complete([{"role": "user", "content": "x"}], PLAN)
    sent = stub.requests[0]
    assert sent["format"] == PLAN and sent["stream"] is False and sent["think"] is False
    assert sent["options"]["num_ctx"] == 1999 and sent["options"]["num_predict"] == 450


def test_missing_chat_model_says_how_to_get_it(make_stub):
    stub = make_stub(status=404, payload={"error": 'model "qwen3:8b" not found, try pulling it first'})
    with pytest.raises(ChatError, match="ollama pull qwen3:8b"):
        OllamaChat(stub.url, "qwen3:8b").complete([{"role": "user", "content": "x"}], PLAN)


@pytest.mark.parametrize("content, message", [
    ("Sure! Here are the steps", "not valid JSON"),
    ("[1, 2]", "not a JSON object"),
])
def test_bad_reply_text_is_a_model_mistake(make_stub, content, message):
    stub = make_stub(payload={"message": {"role": "assistant", "content": content}})
    with pytest.raises(ModelReplyError, match=message):
        OllamaChat(stub.url, "qwen3:8b").complete([{"role": "user", "content": "x"}], PLAN)


def test_scripted_model_replays_and_records():
    model = ScriptedModel([{"steps": ["a"]}, ModelReplyError("broken")])
    assert model.complete([{"role": "user", "content": "hi"}], PLAN) == {"steps": ["a"]}
    with pytest.raises(ModelReplyError):
        model.complete([{"role": "user", "content": "again"}], PLAN)
    assert [p[-1]["content"] for p in model.prompts] == ["hi", "again"]
    with pytest.raises(RuntimeError, match="no replies left"):
        model.complete([], PLAN)


def test_reply_cut_off_at_the_token_limit_says_so(make_stub):
    stub = make_stub(payload={"message": {"role": "assistant", "content": '{"scratchpad": "abc'}, "done_reason": "length"})
    with pytest.raises(ModelReplyError, match="cut off at 450 tokens"):
        OllamaChat(stub.url, "qwen3:8b").complete([{"role": "user", "content": "x"}], PLAN)
