import pytest

from memory_engine.embeddings import EmbeddingError, FakeEmbedder, OllamaEmbedder


@pytest.fixture
def stub_ollama(make_stub):
    return make_stub()


def cos(a, b):
    return sum(x * y for x, y in zip(a, b))


def test_fake_is_deterministic_and_unit_length():
    e = FakeEmbedder(dims=64)
    a, b = e.embed(["Krebs cycle"])[0], e.embed(["Krebs cycle"])[0]
    assert a == b and abs(cos(a, a) - 1.0) < 1e-9 and len(a) == 64


def test_fake_keeps_similar_texts_closer():
    e = FakeEmbedder()
    q, near, far = e.embed(["citric acid cycle", "the citric acid cycle in cells", "tax law of 1820"])
    assert cos(q, near) > cos(q, far)


def test_ollama_parses_embeddings(stub_ollama):
    v = OllamaEmbedder(stub_ollama.url, "m", dims=2).embed(["x"])
    assert v == [pytest.approx([0.6, 0.8])]


def test_ollama_wrong_dims_raises(stub_ollama):
    with pytest.raises(EmbeddingError, match="returned 2 dimensions, expected 3"):
        OllamaEmbedder(stub_ollama.url, "m", dims=3).embed(["x"])


def test_ollama_unreachable_raises_quickly():
    with pytest.raises(EmbeddingError, match="Ollama not reachable"):
        OllamaEmbedder("http://127.0.0.1:9", "m", dims=2, timeout=2).embed(["x"])


def test_missing_model_says_how_to_get_it(make_stub):
    stub = make_stub(status=404, payload={"error": 'model "nomic-embed-text" not found, try pulling it first'})
    with pytest.raises(EmbeddingError, match="ollama pull nomic-embed-text") as caught:
        OllamaEmbedder(stub.url, "nomic-embed-text", dims=2).embed(["x"])
    assert "not reachable" not in str(caught.value)


def test_server_error_passes_on_ollamas_message(make_stub):
    stub = make_stub(status=500, payload={"error": "out of memory"})
    with pytest.raises(EmbeddingError, match="HTTP 500: out of memory"):
        OllamaEmbedder(stub.url, "m", dims=2).embed(["x"])


@pytest.mark.parametrize("payload", [b"not json", {"vectors": []}, {"embeddings": None}, {"embeddings": [[3.0, 4.0]]}])
def test_unexpected_response_raises(make_stub, payload):
    stub = make_stub(payload=payload)
    with pytest.raises(EmbeddingError, match="unexpected response"):
        OllamaEmbedder(stub.url, "m", dims=2).embed(["x", "y"])


def test_slow_server_times_out_with_a_clear_message(make_stub):
    stub = make_stub(delay=1.5)
    with pytest.raises(EmbeddingError, match="did not answer within 0.3 s"):
        OllamaEmbedder(stub.url, "m", dims=2, timeout=0.3).embed(["x"])


def test_many_texts_are_sent_in_batches(stub_ollama):
    vectors = OllamaEmbedder(stub_ollama.url, "m", dims=2, batch_size=32).embed([f"t{i}" for i in range(70)])
    assert len(vectors) == 70
    assert [len(r["input"]) for r in stub_ollama.requests] == [32, 32, 6]
