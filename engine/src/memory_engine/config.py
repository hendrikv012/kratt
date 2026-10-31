"""Settings shared by every part of the engine."""

from dataclasses import dataclass
from pathlib import Path

from memory_engine.chunking import CHUNK_TOKENS

# This SQLite build caps mmap_size at MAX_MMAP_SIZE (0x7fff0000); larger requests are silently lowered.
MAX_MMAP_SIZE = 0x7FFF0000


@dataclass(frozen=True)
class Settings:
    db_path: Path
    ollama_url: str = "http://localhost:11434"
    embed_model: str = "nomic-embed-text"
    embed_dims: int = 768
    chunk_tokens: int = CHUNK_TOKENS  # the largest Markdown chunk; a different size means an index must be rebuilt
    mmap_size: int = MAX_MMAP_SIZE
    chat_model: str = "qwen3:8b"
    context_window: int = 1999  # the spec keeps the 8B model's window strictly below 2,000 tokens
    reply_tokens: int = 450
    chat_timeout: float = 600.0  # seconds for one reply; an 8B model on a CPU is slow
    keyword_weight: float = 1.0  # how much the keyword ranking counts when search fuses its rankings
    meaning_weight: float = 1.0  # the same for the meaning ranking
