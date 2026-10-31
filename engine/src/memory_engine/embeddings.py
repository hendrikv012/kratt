"""Turn text into vectors: Ollama in real use, a deterministic stand-in in tests."""

import math
from hashlib import blake2b
from typing import Protocol

from memory_engine.ollama import OllamaError, post_json


class EmbeddingError(OllamaError):
    pass


class Embedder(Protocol):
    dims: int

    def embed(self, texts: list[str]) -> list[list[float]]: ...


def normalize(vec: list[float]) -> list[float]:
    """Scale to unit length; a zero vector becomes the first unit vector."""
    norm = math.sqrt(sum(x * x for x in vec))
    if norm == 0:
        return [1.0] + [0.0] * (len(vec) - 1)
    return [x / norm for x in vec]


class FakeEmbedder:
    """Hashes character trigrams into a vector, so texts sharing trigrams land close together."""

    def __init__(self, dims: int = 768):
        self.dims = dims

    def embed(self, texts: list[str]) -> list[list[float]]:
        return [self._embed_one(text) for text in texts]

    def _embed_one(self, text: str) -> list[float]:
        vec = [0.0] * self.dims
        text = text.lower()
        for i in range(len(text) - 2):
            h = int.from_bytes(blake2b(text[i:i + 3].encode(), digest_size=8).digest(), "big")
            vec[h % self.dims] += 1.0 if (h >> 32) & 1 else -1.0
        return normalize(vec)


class OllamaEmbedder:
    def __init__(self, url: str, model: str, dims: int, timeout: float = 30.0, batch_size: int = 32):
        self.url = url.rstrip("/")
        self.model = model
        self.dims = dims
        self.timeout = timeout
        self.batch_size = batch_size

    def embed(self, texts: list[str]) -> list[list[float]]:
        vectors: list[list[float]] = []
        for start in range(0, len(texts), self.batch_size):
            vectors += self._embed_batch(texts[start:start + self.batch_size])
        return vectors

    def _embed_batch(self, texts: list[str]) -> list[list[float]]:
        answer = post_json(
            self.url, "/api/embed", {"model": self.model, "input": texts}, self.timeout, self.model, EmbeddingError
        )
        try:
            vectors = answer["embeddings"]
            if not isinstance(vectors, list) or len(vectors) != len(texts):
                raise ValueError(f"{len(texts)} texts sent")
            vectors = [[float(x) for x in vec] for vec in vectors]
        except (ValueError, KeyError, TypeError) as err:
            raise EmbeddingError(f"Ollama at {self.url} gave an unexpected response ({err})") from err
        for vec in vectors:
            if len(vec) != self.dims:
                raise EmbeddingError(f"{self.model} returned {len(vec)} dimensions, expected {self.dims}")
        return [normalize(vec) for vec in vectors]
