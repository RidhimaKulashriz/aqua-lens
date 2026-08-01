"""Text embeddings for semantic memory recall.

Uses Google's ``text-embedding-004`` (768-dim) via the ``google-genai``
SDK when an API key is configured. When :func:`embed_text` is called
without a key, or with ``AQUALENS_FAKE_GEMINI=1``, it falls back to a
deterministic hash-derived pseudo-embedding so the Historian's
semantic-recall code path stays exercisable in offline tests.

The fallback is **not** semantically meaningful — it's there purely so
the rest of the agent layer can be unit-tested without a network
round-trip. Production deployments always go through the real model.
"""

from __future__ import annotations

import hashlib
import math
from typing import TYPE_CHECKING

from app.core.config import get_settings
from app.core.logging import get_logger

if TYPE_CHECKING:  # pragma: no cover
    pass

LOGGER = get_logger(__name__)

EMBEDDING_DIM = 768


def embed_text(text: str) -> list[float]:
    """Embed ``text`` and return a unit-normalised 768-dim vector.

    Empty strings are mapped to the zero vector. The vector is always
    returned as a plain Python ``list[float]`` so it is JSON-safe for
    persistence into ``agent_memory.embedding``.
    """
    if not text or not text.strip():
        return [0.0] * EMBEDDING_DIM

    settings = get_settings()
    if settings.aqualens_fake_gemini or not settings.gemini_api_keys:
        return _deterministic_pseudo_embedding(text)

    try:
        return _real_embedding(text, settings.gemini_api_keys[0], settings.gemini_embedding_model)
    except Exception as exc:  # pragma: no cover - exercised in integration only
        LOGGER.warning("text-embedding-004 failed (%s); falling back to deterministic", exc)
        return _deterministic_pseudo_embedding(text)


def cosine_similarity(a: list[float], b: list[float]) -> float:
    """Cosine similarity between two same-length vectors, in [-1, 1]."""
    if len(a) != len(b) or not a:
        return 0.0
    dot = sum(x * y for x, y in zip(a, b, strict=True))
    na = math.sqrt(sum(x * x for x in a))
    nb = math.sqrt(sum(y * y for y in b))
    if na == 0.0 or nb == 0.0:
        return 0.0
    return dot / (na * nb)


# ----------------------------------------------------------------------
# Internals
# ----------------------------------------------------------------------


def _real_embedding(text: str, api_key: str, model: str) -> list[float]:
    """Call Gemini's embed_content endpoint and unwrap the values."""
    from google import genai

    client = genai.Client(api_key=api_key)
    response = client.models.embed_content(model=model, contents=text)
    embeddings = response.embeddings or []
    if not embeddings:
        raise RuntimeError("empty embeddings response")
    values = embeddings[0].values or []
    if len(values) != EMBEDDING_DIM:
        # The 004 model returns 768 dims; future models may differ. We
        # pad / truncate so the persisted column shape stays stable.
        values = list(values[:EMBEDDING_DIM]) + [0.0] * max(0, EMBEDDING_DIM - len(values))
    return [float(v) for v in values]


def _deterministic_pseudo_embedding(text: str) -> list[float]:
    """Hash-derived stand-in used for offline tests.

    SHA-256 over the text yields 32 bytes; we expand by re-hashing
    blocks until we have ``EMBEDDING_DIM`` bytes, then map to floats in
    ``[-1, 1]`` and unit-normalise. Different texts produce distinct,
    repeatable vectors — enough to validate the recall code path
    without exercising the real model.
    """
    raw = b""
    seed = text.encode("utf-8")
    counter = 0
    while len(raw) < EMBEDDING_DIM:
        raw += hashlib.sha256(seed + counter.to_bytes(4, "big")).digest()
        counter += 1
    raw = raw[:EMBEDDING_DIM]
    floats = [(b - 127.5) / 127.5 for b in raw]
    norm = math.sqrt(sum(x * x for x in floats)) or 1.0
    return [x / norm for x in floats]


__all__ = ["EMBEDDING_DIM", "cosine_similarity", "embed_text"]
