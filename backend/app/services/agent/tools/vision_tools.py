"""Gemini Vision passes over Sentinel-2 RGB thumbnails.

The Scout agent calls :func:`look_at_thumbnail` as a tool. Internally
this issues a **separate, focused Gemini call** with the image as a
``Part`` and a short prompt asking about a specific visual concern
(haze, glint, visible bloom signature, ice cover, etc.). The Scout's
main loop only sees the textual observation; the trace records both
the URL and the question so the UI can show "Gemini looked at *this
image* and saw *this*".

Splitting the vision pass out of the Scout's main tool loop keeps
the loop's context window small (no image bytes echoed back through
the conversation history) and gives the trace a clean,
demonstrable "Gemini looked at the satellite picture" moment.
"""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field

from app.core.config import get_settings
from app.core.logging import get_logger
from app.services.reasoning import QuotaExceededError, _looks_like_quota_error

LOGGER = get_logger(__name__)


class _VisionObservation(BaseModel):
    """Schema Gemini Vision returns. Kept narrow on purpose."""

    summary: str = Field(description="One-sentence verdict on the focus question.")
    haze_visible: bool | None = Field(
        default=None, description="True if any haze/cloud is visible inside the AOI."
    )
    sun_glint_visible: bool | None = Field(default=None)
    visible_bloom_signature: bool | None = Field(default=None)
    notes: str | None = Field(
        default=None, description="Optional extra observations relevant to scene selection."
    )


def look_at_thumbnail(*, image_url: str, focus_prompt: str) -> dict[str, Any]:
    """Ask Gemini Vision a focused question about a Sentinel-2 thumbnail.

    Returns a JSON-safe dict the Scout can feed back into its main
    reasoning loop. On a quota failure or when Gemini is disabled the
    function returns a stub observation flagged ``available=false`` so
    the Scout can still progress.
    """
    settings = get_settings()
    if settings.aqualens_fake_gemini or not settings.gemini_api_keys:
        return _stub_observation(image_url, focus_prompt, reason="fake_or_no_key")

    api_keys = settings.gemini_api_keys
    last_error: Exception | None = None
    for key_index, api_key in enumerate(api_keys):
        try:
            obs = _vision_call(
                api_key=api_key,
                model=settings.gemini_model,
                image_url=image_url,
                focus_prompt=focus_prompt,
            )
            return {
                "available": True,
                "image_url": image_url,
                "focus_prompt": focus_prompt,
                **obs.model_dump(),
            }
        except QuotaExceededError as exc:
            last_error = exc
            label = "primary" if key_index == 0 else f"fallback-{key_index}"
            LOGGER.warning("Vision quota on %s key — rolling over (%s)", label, exc)
            continue
        except Exception as exc:
            LOGGER.warning("Vision call failed (%s); returning stub", exc)
            return _stub_observation(image_url, focus_prompt, reason=str(exc))

    return _stub_observation(image_url, focus_prompt, reason=f"all_keys_quota:{last_error}")


def _vision_call(
    *, api_key: str, model: str, image_url: str, focus_prompt: str
) -> _VisionObservation:
    """The actual Gemini multimodal request. Kept tiny so tests can mock it."""
    from google import genai
    from google.genai import types as genai_types

    client = genai.Client(api_key=api_key)

    system_instruction = (
        "You are a remote-sensing analyst inspecting a Sentinel-2 RGB "
        "thumbnail. Answer ONLY the focus question. Do not invent measurements "
        "and do not infer water quality from the image — your job is purely "
        "visual: is the AOI obscured by haze, sun glint, ice, or some other "
        "artefact that would make spectral analysis unreliable, and are there "
        "any obvious visible cues (e.g. green discolouration consistent with a "
        "bloom). Respond with the structured JSON schema only."
    )

    user_parts = [
        genai_types.Part.from_uri(file_uri=image_url, mime_type="image/png"),
        genai_types.Part.from_text(text=f"Focus question: {focus_prompt}"),
    ]

    try:
        response = client.models.generate_content(
            model=model,
            contents=[genai_types.Content(role="user", parts=user_parts)],
            config=genai_types.GenerateContentConfig(
                system_instruction=system_instruction,
                response_mime_type="application/json",
                response_schema=_VisionObservation,
                temperature=0.2,
            ),
        )
    except Exception as exc:
        if _looks_like_quota_error(exc):
            raise QuotaExceededError(str(exc)) from exc
        raise

    text = response.text or ""
    return _VisionObservation.model_validate_json(text)


def _stub_observation(image_url: str, focus_prompt: str, *, reason: str) -> dict[str, Any]:
    """Used in tests and during offline runs. Marked ``available=false``."""
    return {
        "available": False,
        "image_url": image_url,
        "focus_prompt": focus_prompt,
        "summary": "vision pass unavailable",
        "haze_visible": None,
        "sun_glint_visible": None,
        "visible_bloom_signature": None,
        "notes": f"reason={reason}",
    }


__all__ = ["look_at_thumbnail"]
