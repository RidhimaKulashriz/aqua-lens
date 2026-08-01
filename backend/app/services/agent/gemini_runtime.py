"""Shared Gemini runtime for the multi-agent layer.

Provides three things every agent needs:

1. :class:`ToolSpec` — bundles a function declaration (handed to
   Gemini) with the Python handler the runtime invokes when the model
   issues a corresponding ``function_call``.
2. :func:`run_tool_loop` — drives the multi-turn conversation until
   either the model emits a final text/structured response or the
   ``max_turns`` cap is reached. Records every step into the active
   :class:`~app.services.agent.trace.AgentTraceBuilder`.
3. :func:`call_structured` — single-shot helper for agents that need
   a Pydantic ``response_schema`` but no tools (Coordinator, Reporter).

Both call paths automatically roll over from the primary Gemini API
key to the configured fallback on quota / 429 errors, sharing the
quota signal detection with :mod:`app.services.reasoning`.
"""

from __future__ import annotations

import json
import time
from collections.abc import Callable
from dataclasses import dataclass, field
from typing import Any, TypeVar

from pydantic import BaseModel

from app.core.config import get_settings
from app.core.logging import get_logger
from app.services.agent.trace import AgentTraceBuilder
from app.services.reasoning import QuotaExceededError, _looks_like_quota_error

LOGGER = get_logger(__name__)

# Hard ceiling per agent. Prevents a confused model from looping
# forever; Scout/Historian set lower budgets explicitly.
DEFAULT_MAX_TURNS = 6

# Default *visible-response* token budgets. Callers reason in terms
# of how many tokens the model needs to emit JSON / prose — the
# runtime adds ``thinking_budget`` on top before handing it to the
# SDK, since on Gemini 2.5 Flash ``max_output_tokens`` is the combined
# ceiling for thinking + visible tokens. Without that adjustment the
# Coordinator (thinking_budget=2048) could spend its entire budget
# thinking and produce zero visible JSON, which is exactly the
# ``Unterminated string`` truncation we kept seeing in the trace.
DEFAULT_STRUCTURED_OUTPUT_TOKENS = 2048
DEFAULT_TOOL_LOOP_OUTPUT_TOKENS = 4096

# In-process key cooldown registry. When a key returns quota/429 we mark
# it as cooling down for ``gemini_quota_cooldown_seconds`` and prefer
# other keys first. This avoids hammering an exhausted key across
# consecutive agent stages in the same run.
_KEY_COOLDOWN_UNTIL: dict[str, float] = {}

_T = TypeVar("_T")


def _effective_output_tokens(visible: int, thinking_budget: int | None) -> int:
    """Combine the caller's visible-response budget with the thinking
    budget, since the SDK's ``max_output_tokens`` covers both.

    A small safety margin (256 tokens) is added so the visible budget
    isn't consumed by the schema's prelude before the JSON body starts.
    """
    base = max(int(visible), 256)
    if thinking_budget is None:
        return base
    return base + int(thinking_budget) + 256


# ----------------------------------------------------------------------
# Pydantic-schema → Gemini-schema helper
# ----------------------------------------------------------------------
#
# google-genai's internal ``Schema`` Pydantic model rejects the
# ``$ref`` / ``$defs`` indirection that pydantic emits by default for
# nested BaseModel fields. We pre-flatten the JSON schema so every
# reference is inlined before the SDK ever sees it, and we strip the
# JSON-Schema-only keys the SDK doesn't recognise.


def _gemini_schema(model: type[BaseModel]) -> dict[str, Any]:
    """Render a Pydantic model as a Gemini-safe inline JSON schema.

    - Inlines every ``$ref`` against the model's ``$defs``.
    - Drops top-level ``$defs`` once everything is inlined.
    - Strips keys the SDK's Schema model treats as ``extra_forbidden``
      (``title``, ``default``, ``additionalProperties``, etc.).
    """
    raw = model.model_json_schema()
    defs = raw.get("$defs") or raw.get("definitions") or {}

    def _resolve(node: Any) -> Any:
        if isinstance(node, dict):
            ref = node.get("$ref")
            if isinstance(ref, str) and ref.startswith("#/"):
                target = defs.get(ref.split("/")[-1])
                if isinstance(target, dict):
                    return _resolve(target)
            return {k: _resolve(v) for k, v in node.items() if k not in _DROP_KEYS}
        if isinstance(node, list):
            return [_resolve(v) for v in node]
        return node

    flat = _resolve(raw)
    if isinstance(flat, dict):
        flat.pop("$defs", None)
        flat.pop("definitions", None)
    return flat


# JSON-Schema keys the google-genai Schema validator rejects.
#
# ``exclusiveMinimum`` / ``exclusiveMaximum`` are emitted by Pydantic
# for ``Field(gt=..., lt=...)`` constraints but Gemini's response-schema
# validator only understands the inclusive ``minimum`` / ``maximum``
# keys. Strip them so strict schemas that include ``gt`` constraints
# don't trigger a 400 INVALID_ARGUMENT.
_DROP_KEYS = frozenset(
    {
        "$defs",
        "definitions",
        "$schema",
        "$id",
        "$comment",
        "additionalProperties",
        "default",
        "title",
        "examples",
        "discriminator",
        "readOnly",
        "writeOnly",
        "deprecated",
        "const",
        "exclusiveMinimum",
        "exclusiveMaximum",
        "exclusiveMin",
        "exclusiveMax",
    }
)

_TYPE_ENUM_MAP = {
    "type_unspecified": "TYPE_UNSPECIFIED",
    "string": "STRING",
    "number": "NUMBER",
    "integer": "INTEGER",
    "boolean": "BOOLEAN",
    "array": "ARRAY",
    "object": "OBJECT",
}


def _gemini_function_parameters(schema: dict[str, Any]) -> dict[str, Any]:
    """Normalise OpenAPI-ish tool parameter schemas for Gemini SDK.

    Some ``google-genai`` builds validate ``Schema.type`` as an enum
    (e.g. ``OBJECT``) rather than lower-case JSON-Schema strings
    (``object``). We recursively map known type literals while keeping
    the rest of the schema intact.
    """

    def _walk(node: Any) -> Any:
        if isinstance(node, dict):
            out: dict[str, Any] = {}
            for key, value in node.items():
                if key == "type" and isinstance(value, str):
                    out[key] = _TYPE_ENUM_MAP.get(value.lower(), value)
                else:
                    out[key] = _walk(value)
            return out
        if isinstance(node, list):
            return [_walk(item) for item in node]
        return node

    return _walk(schema)


def _maybe_thinking_config(genai_types: Any, budget: int | None) -> Any | None:
    """Build a ``ThinkingConfig`` if the installed SDK exposes one.

    Older ``google-genai`` releases (pre-2025-Q2) don't ship
    ``ThinkingConfig``. We log once and run without thinking mode
    rather than crashing the Coordinator.
    """
    if budget is None:
        return None
    factory = getattr(genai_types, "ThinkingConfig", None)
    if factory is None:
        LOGGER.info("Installed google-genai has no ThinkingConfig; continuing without it")
        return None
    try:
        return factory(thinking_budget=int(budget))
    except Exception as exc:
        LOGGER.info("ThinkingConfig construction failed (%s); continuing without it", exc)
        return None


@dataclass(slots=True)
class ToolSpec:
    """One tool the agent can call.

    ``parameters`` is an OpenAPI-style JSON Schema fragment Gemini's
    SDK forwards verbatim. ``handler`` accepts the deserialised
    arguments as keyword args and returns a JSON-safe dict.
    """

    name: str
    description: str
    parameters: dict[str, Any]
    handler: Callable[..., dict[str, Any]]


@dataclass(slots=True)
class ToolLoopResult:
    """Final state of a tool-loop run."""

    text: str
    parsed: Any | None = None
    turns: int = 0
    finish_reason: str | None = None
    extras: dict[str, Any] = field(default_factory=dict)


# ----------------------------------------------------------------------
# Public entry points
# ----------------------------------------------------------------------


# Names of Gemini-native tools the runtime knows how to enable. These
# tools execute inside Gemini's own runtime — there is no Python
# handler. We instantiate them lazily inside ``_drive_loop`` so the
# import of this module doesn't require the SDK at import time.
NATIVE_TOOL_GOOGLE_SEARCH = "google_search"
NATIVE_TOOL_URL_CONTEXT = "url_context"
NATIVE_TOOL_CODE_EXECUTION = "code_execution"


def run_tool_loop(
    *,
    builder: AgentTraceBuilder,
    system_instruction: str,
    user_message: str,
    tools: list[ToolSpec],
    response_schema: type[BaseModel] | None = None,
    max_turns: int = DEFAULT_MAX_TURNS,
    temperature: float = 0.3,
    thinking_budget: int | None = None,
    gemini_native_tools: list[str] | None = None,
    max_output_tokens: int | None = None,
    timeout_seconds: float | None = None,
) -> ToolLoopResult:
    """Drive a multi-turn Gemini conversation that may call tools.

    The runtime keeps issuing tool results back to Gemini until either
    Gemini stops emitting ``function_call`` parts (final answer) or
    ``max_turns`` is exhausted. Every tool invocation is captured on
    ``builder`` so the trace lands in :class:`AgentTrace.agent_runs`.

    ``extra_gemini_tools`` lets agents add Gemini-native tools that
    the SDK handles internally (Google Search grounding, URL Context,
    code execution) — those tools don't dispatch back to Python.
    """
    settings = get_settings()
    if settings.aqualens_fake_gemini:
        raise RuntimeError(
            "run_tool_loop should not be reached when AQUALENS_FAKE_GEMINI=1; "
            "the orchestrator must short-circuit to the deterministic narrator."
        )
    api_keys = settings.gemini_api_keys
    if not api_keys:
        raise RuntimeError("no Gemini API keys configured")

    return _call_with_key_failover(
        api_keys=api_keys,
        retry_passes=settings.gemini_quota_retry_passes,
        cooldown_seconds=settings.gemini_quota_cooldown_seconds,
        timeout_seconds=timeout_seconds,
        call=lambda key_index, api_key: _drive_loop(
            builder=builder,
            api_key=api_key,
            model=settings.gemini_model,
            system_instruction=system_instruction,
            user_message=user_message,
            tools=tools,
            response_schema=response_schema,
            max_turns=max_turns,
            temperature=temperature,
            thinking_budget=thinking_budget,
            gemini_native_tools=gemini_native_tools or [],
            max_output_tokens=max_output_tokens or DEFAULT_TOOL_LOOP_OUTPUT_TOKENS,
        ),
    )


def call_structured(
    *,
    builder: AgentTraceBuilder,
    system_instruction: str,
    user_message: str,
    response_schema: type[BaseModel],
    temperature: float = 0.2,
    thinking_budget: int | None = None,
    max_output_tokens: int | None = None,
    timeout_seconds: float | None = None,
) -> BaseModel:
    """Single-shot Gemini call with a Pydantic schema. No tools.

    Used by agents whose only job is to emit structured JSON
    (Coordinator's plan, Reporter's citizen summary).
    """
    settings = get_settings()
    api_keys = settings.gemini_api_keys
    if not api_keys:
        raise RuntimeError("no Gemini API keys configured")

    return _call_with_key_failover(
        api_keys=api_keys,
        retry_passes=settings.gemini_quota_retry_passes,
        cooldown_seconds=settings.gemini_quota_cooldown_seconds,
        timeout_seconds=timeout_seconds,
        call=lambda key_index, api_key: _call_structured_once(
            builder=builder,
            api_key=api_key,
            model=settings.gemini_model,
            system_instruction=system_instruction,
            user_message=user_message,
            response_schema=response_schema,
            temperature=temperature,
            thinking_budget=thinking_budget,
            max_output_tokens=max_output_tokens or DEFAULT_STRUCTURED_OUTPUT_TOKENS,
        ),
    )


class _TimeoutExceededError(Exception):
    """Raised when a Gemini call exceeds the caller's wall-clock timeout."""


def _call_with_key_failover(
    *,
    api_keys: list[str],
    retry_passes: int,
    cooldown_seconds: float,
    call: Callable[[int, str], _T],
    timeout_seconds: float | None = None,
) -> _T:
    """Call Gemini with key rollover + bounded cooldown retries.

    Pass 1 tries all keys that are not cooling down.
    On quota, each key is marked in cooldown and the runtime rolls over.
    If all keys are exhausted and retry passes remain, we wait for the
    cooldown window (or earliest key-ready timestamp) and try again.

    ``timeout_seconds`` is an optional hard wall-clock ceiling applied
    across *all* passes. When it elapses we raise ``_TimeoutExceededError``
    immediately so the caller can degrade gracefully instead of waiting
    for every pass to exhaust.
    """
    total_passes = max(int(retry_passes), 1)
    cooldown = max(float(cooldown_seconds), 0.0)
    last_error: Exception | None = None
    deadline: float | None = None
    if timeout_seconds is not None and timeout_seconds > 0:
        deadline = time.monotonic() + float(timeout_seconds)

    for pass_index in range(total_passes):
        # Check wall-clock deadline before starting a new pass.
        if deadline is not None and time.monotonic() >= deadline:
            raise _TimeoutExceededError(
                f"Gemini call exceeded {timeout_seconds}s wall-clock timeout "
                f"after {pass_index} pass(es)"
            )

        attempted_this_pass = 0
        ready_in_seconds: list[float] = []

        for key_index, api_key in enumerate(api_keys):
            # Check deadline before each key attempt too.
            if deadline is not None and time.monotonic() >= deadline:
                raise _TimeoutExceededError(
                    f"Gemini call exceeded {timeout_seconds}s wall-clock timeout "
                    f"after {pass_index} pass(es)"
                )

            wait_s = _seconds_until_key_ready(api_key)
            if wait_s > 0:
                # Only sleep for the cooldown if it won't blow past the deadline.
                if deadline is not None and time.monotonic() + wait_s >= deadline:
                    LOGGER.info(
                        "Skipping key %s (cooldown %.1fs) — would exceed timeout",
                        _key_label(key_index),
                        wait_s,
                    )
                    continue
                ready_in_seconds.append(wait_s)
                continue

            attempted_this_pass += 1
            try:
                result = call(key_index, api_key)
                _clear_key_cooldown(api_key)
                return result
            except QuotaExceededError as exc:
                last_error = exc
                _mark_key_cooldown(api_key, cooldown)
                label = _key_label(key_index)
                LOGGER.warning("Gemini quota on %s key — rolling over (%s)", label, exc)
                continue

        remaining_passes = total_passes - (pass_index + 1)
        if remaining_passes <= 0:
            break

        # Pass exhausted. If no keys were attempted, all are cooling down.
        # Wait until the first key is available again; otherwise wait the
        # configured cooldown before retrying.
        wait_s = cooldown
        if attempted_this_pass == 0 and ready_in_seconds:
            wait_s = max(0.0, min(ready_in_seconds))
        # Cap the wait so we never exceed the deadline.
        if deadline is not None:
            remaining = max(0.0, deadline - time.monotonic())
            if remaining <= 0:
                raise _TimeoutExceededError(
                    f"Gemini call exceeded {timeout_seconds}s wall-clock timeout "
                    f"after {pass_index + 1} pass(es)"
                )
            wait_s = min(wait_s, remaining)
        if wait_s > 0:
            LOGGER.info(
                "Gemini keys exhausted for pass %d/%d; retrying in %.1fs",
                pass_index + 1,
                total_passes,
                wait_s,
            )
            time.sleep(wait_s)

    raise RuntimeError(f"all {len(api_keys)} Gemini keys hit quota: {last_error}")


def _key_label(index: int) -> str:
    return "primary" if index == 0 else f"fallback-{index}"


def _seconds_until_key_ready(api_key: str) -> float:
    ready_at = _KEY_COOLDOWN_UNTIL.get(api_key)
    if ready_at is None:
        return 0.0
    return max(0.0, ready_at - time.monotonic())


def _mark_key_cooldown(api_key: str, cooldown_seconds: float) -> None:
    if cooldown_seconds <= 0:
        return
    _KEY_COOLDOWN_UNTIL[api_key] = time.monotonic() + cooldown_seconds


def _clear_key_cooldown(api_key: str) -> None:
    _KEY_COOLDOWN_UNTIL.pop(api_key, None)


# ----------------------------------------------------------------------
# Internals — _drive_loop and _call_structured_once are thin wrappers
# around the SDK call so tests can monkeypatch the seam.
# ----------------------------------------------------------------------


def _drive_loop(
    *,
    builder: AgentTraceBuilder,
    api_key: str,
    model: str,
    system_instruction: str,
    user_message: str,
    tools: list[ToolSpec],
    response_schema: type[BaseModel] | None,
    max_turns: int,
    temperature: float,
    thinking_budget: int | None,
    gemini_native_tools: list[str],
    max_output_tokens: int,
) -> ToolLoopResult:
    from google import genai
    from google.genai import types as genai_types

    handler_index = {spec.name: spec for spec in tools}

    function_declarations = [
        genai_types.FunctionDeclaration(
            name=spec.name,
            description=spec.description,
            parameters=_gemini_function_parameters(spec.parameters),
        )
        for spec in tools
    ]
    gemini_tools: list[Any] = []
    if function_declarations:
        gemini_tools.append(genai_types.Tool(function_declarations=function_declarations))
    for native_name in gemini_native_tools:
        instantiated = _build_native_tool(genai_types, native_name)
        if instantiated is not None:
            gemini_tools.append(instantiated)

    config_kwargs: dict[str, Any] = {
        "system_instruction": system_instruction,
        "temperature": temperature,
        # Pin an explicit ceiling so structured JSON responses never
        # truncate mid-string. The SDK default is generous but not
        # infinite; under thinking mode the visible-token budget
        # shrinks further, which surfaced as "Unterminated string"
        # JSONDecodeError on Coordinator runs. ``_effective_output_tokens``
        # adds the thinking budget so the caller's ``max_output_tokens``
        # really is the *visible-response* budget.
        "max_output_tokens": _effective_output_tokens(max_output_tokens, thinking_budget),
    }
    if gemini_tools:
        config_kwargs["tools"] = gemini_tools
    if response_schema is not None:
        # Pre-flatten the Pydantic schema so the SDK's internal
        # ``Schema`` validator doesn't choke on ``$ref`` / ``$defs``.
        config_kwargs["response_mime_type"] = "application/json"
        config_kwargs["response_schema"] = _gemini_schema(response_schema)
    thinking_config = _maybe_thinking_config(genai_types, thinking_budget)
    if thinking_config is not None:
        config_kwargs["thinking_config"] = thinking_config

    config = genai_types.GenerateContentConfig(**config_kwargs)
    client = genai.Client(api_key=api_key)

    contents: list[Any] = [
        genai_types.Content(role="user", parts=[genai_types.Part.from_text(text=user_message)])
    ]

    last_response: Any = None
    finish_reason: str | None = None
    for turn in range(1, max_turns + 1):
        try:
            response = client.models.generate_content(model=model, contents=contents, config=config)
        except Exception as exc:
            if _looks_like_quota_error(exc):
                raise QuotaExceededError(str(exc)) from exc
            raise

        _accumulate_token_usage(builder, response)
        last_response = response

        candidate = response.candidates[0] if response.candidates else None
        if candidate is None:
            return ToolLoopResult(text="", turns=turn, finish_reason="empty")

        finish_reason = (
            candidate.finish_reason.value if getattr(candidate, "finish_reason", None) else None
        )

        function_calls = _extract_function_calls(candidate)
        if not function_calls:
            # Terminal turn — Gemini emitted a final answer.
            text = response.text or ""
            parsed = _try_parse(text, response_schema)
            return ToolLoopResult(
                text=text,
                parsed=parsed,
                turns=turn,
                finish_reason=finish_reason,
                extras=_extras_from_response(response),
            )

        # Echo the model's tool-call message back into the history so
        # the model sees its own request when it resumes.
        contents.append(candidate.content)

        for call in function_calls:
            spec = handler_index.get(call["name"])
            with builder.record_tool(call["name"], call["arguments"]) as record:
                if spec is None:
                    record.error = f"unknown tool {call['name']!r}"
                    payload: dict[str, Any] = {"error": record.error}
                else:
                    try:
                        payload = spec.handler(**call["arguments"])
                    except Exception as exc:
                        record.error = f"{type(exc).__name__}: {exc}"
                        payload = {"error": record.error}
                record.result = payload

            contents.append(
                genai_types.Content(
                    role="user",
                    parts=[
                        genai_types.Part.from_function_response(
                            name=call["name"],
                            response={"result": payload},
                        )
                    ],
                )
            )

    # Loop budget exhausted. Return whatever final text we have, if any.
    final_text = getattr(last_response, "text", None) or ""
    return ToolLoopResult(
        text=final_text,
        parsed=_try_parse(final_text, response_schema),
        turns=max_turns,
        finish_reason=finish_reason or "max_turns",
    )


def _call_structured_once(
    *,
    builder: AgentTraceBuilder,
    api_key: str,
    model: str,
    system_instruction: str,
    user_message: str,
    response_schema: type[BaseModel],
    temperature: float,
    thinking_budget: int | None,
    max_output_tokens: int,
) -> BaseModel:
    from google import genai
    from google.genai import types as genai_types

    config_kwargs: dict[str, Any] = {
        "system_instruction": system_instruction,
        "temperature": temperature,
        "response_mime_type": "application/json",
        # Inline ``$ref`` / ``$defs`` so the SDK's Schema validator
        # accepts nested Pydantic models (Analyst, Reporter, etc.).
        "response_schema": _gemini_schema(response_schema),
        # Pin an explicit ceiling so structured JSON never truncates
        # mid-string. Critical: on Gemini 2.5 Flash this budget covers
        # *both* thinking tokens and the visible response, so callers
        # pass the visible budget and ``_effective_output_tokens`` adds
        # the thinking allowance on top.
        "max_output_tokens": _effective_output_tokens(max_output_tokens, thinking_budget),
    }
    thinking_config = _maybe_thinking_config(genai_types, thinking_budget)
    if thinking_config is not None:
        config_kwargs["thinking_config"] = thinking_config

    config = genai_types.GenerateContentConfig(**config_kwargs)
    client = genai.Client(api_key=api_key)

    try:
        response = client.models.generate_content(
            model=model,
            contents=user_message,
            config=config,
        )
    except Exception as exc:
        if _looks_like_quota_error(exc):
            raise QuotaExceededError(str(exc)) from exc
        raise

    _accumulate_token_usage(builder, response)
    return _parse_structured_response(response=response, response_schema=response_schema)


# ----------------------------------------------------------------------
# Native-tool factory
# ----------------------------------------------------------------------


def _build_native_tool(genai_types: Any, name: str) -> Any | None:
    """Instantiate a Gemini-native tool by short name.

    Returns ``None`` and logs a warning when the installed SDK doesn't
    expose the requested capability — the agent stays functional with
    its remaining tools rather than crashing on a missing import.
    """
    try:
        if name == NATIVE_TOOL_GOOGLE_SEARCH:
            return genai_types.Tool(google_search=genai_types.GoogleSearch())
        if name == NATIVE_TOOL_URL_CONTEXT:
            return genai_types.Tool(url_context=genai_types.UrlContext())
        if name == NATIVE_TOOL_CODE_EXECUTION:
            return genai_types.Tool(code_execution=genai_types.ToolCodeExecution())
    except AttributeError as exc:  # pragma: no cover - SDK version drift
        LOGGER.warning("Gemini native tool %r unavailable in this SDK (%s)", name, exc)
    return None


# ----------------------------------------------------------------------
# Response inspection helpers
# ----------------------------------------------------------------------


def _extract_function_calls(candidate: Any) -> list[dict[str, Any]]:
    """Pull out every function_call part from a candidate."""
    calls: list[dict[str, Any]] = []
    content = getattr(candidate, "content", None)
    if content is None:
        return calls
    for part in getattr(content, "parts", None) or []:
        fc = getattr(part, "function_call", None)
        if fc is None:
            continue
        args = dict(getattr(fc, "args", None) or {})
        calls.append({"name": fc.name, "arguments": args})
    return calls


def _try_parse(text: str, schema: type[BaseModel] | None) -> Any | None:
    if schema is None or not text:
        return None
    try:
        return schema.model_validate_json(text)
    except Exception:
        return None


def _parse_structured_response(*, response: Any, response_schema: type[BaseModel]) -> BaseModel:
    """Parse a structured Gemini response robustly.

    Primary path uses ``response.parsed`` when the SDK provides it.
    Fallback path validates JSON text and also tolerates common wrappers
    (e.g. fenced `````json`` blocks) by extracting likely JSON spans.
    """
    parsed = getattr(response, "parsed", None)
    if parsed is not None:
        if isinstance(parsed, response_schema):
            return parsed
        return response_schema.model_validate(parsed)

    text = (getattr(response, "text", None) or "").strip()
    if not text:
        text = _joined_text_parts(response).strip()

    candidates = _json_candidates(text)
    last_error: Exception | None = None
    for candidate in candidates:
        if not candidate:
            continue
        try:
            return response_schema.model_validate_json(candidate)
        except Exception as exc:
            last_error = exc
            continue

    if last_error is not None:
        raise last_error
    raise ValueError("Gemini returned an empty structured response")


def _joined_text_parts(response: Any) -> str:
    candidate = response.candidates[0] if getattr(response, "candidates", None) else None
    if candidate is None:
        return ""
    content = getattr(candidate, "content", None)
    if content is None:
        return ""
    chunks: list[str] = []
    for part in getattr(content, "parts", None) or []:
        text = getattr(part, "text", None)
        if text:
            chunks.append(text)
    return "".join(chunks)


def _json_candidates(text: str) -> list[str]:
    """Return probable JSON payload strings from a model text response."""
    if not text:
        return []
    variants: list[str] = [text.strip()]

    # Common LLM wrapper:
    # ```json
    # { ... }
    # ```
    stripped = text.strip()
    if stripped.startswith("```"):
        lines = stripped.splitlines()
        if len(lines) >= 2:
            body = "\n".join(lines[1:])
            if body.endswith("```"):
                body = body[:-3]
            variants.append(body.strip())

    # Last-resort span extraction: first object/array to last close.
    first_obj, last_obj = text.find("{"), text.rfind("}")
    if first_obj != -1 and last_obj > first_obj:
        variants.append(text[first_obj : last_obj + 1].strip())
    first_arr, last_arr = text.find("["), text.rfind("]")
    if first_arr != -1 and last_arr > first_arr:
        variants.append(text[first_arr : last_arr + 1].strip())

    # Deduplicate while preserving order.
    seen: set[str] = set()
    deduped: list[str] = []
    for item in variants:
        if item not in seen:
            seen.add(item)
            deduped.append(item)
    return deduped


def _accumulate_token_usage(builder: AgentTraceBuilder, response: Any) -> None:
    """Best-effort token tally — the SDK shape varies across releases."""
    usage = getattr(response, "usage_metadata", None)
    if usage is None:
        return
    in_tokens = int(getattr(usage, "prompt_token_count", 0) or 0)
    out_tokens = int(getattr(usage, "candidates_token_count", 0) or 0)
    builder.add_tokens(tokens_in=in_tokens, tokens_out=out_tokens)


def _extras_from_response(response: Any) -> dict[str, Any]:
    """Surface grounding metadata, code-execution output, and citations.

    Everything we capture here lands in the agent trace and is rendered
    verbatim in the Agent Trace UI card, so the user can see exactly
    which URLs Gemini cited or which Python it executed.
    """
    extras: dict[str, Any] = {}
    candidate = response.candidates[0] if response.candidates else None
    if candidate is None:
        return extras

    grounding = getattr(candidate, "grounding_metadata", None)
    if grounding is not None:
        citations: list[dict[str, Any]] = []
        for chunk in getattr(grounding, "grounding_chunks", None) or []:
            web = getattr(chunk, "web", None)
            if web is None:
                continue
            citations.append(
                {"title": getattr(web, "title", None), "uri": getattr(web, "uri", None)}
            )
        if citations:
            extras["citations"] = citations
        queries = list(getattr(grounding, "web_search_queries", None) or [])
        if queries:
            extras["search_queries"] = queries

    # Code-execution outputs land as dedicated parts on the candidate
    # content. We surface the executable code and its stdout so the
    # trace shows the Mann-Kendall (or whatever) the model ran.
    code_runs: list[dict[str, Any]] = []
    content = getattr(candidate, "content", None)
    for part in getattr(content, "parts", None) or []:
        executable_code = getattr(part, "executable_code", None)
        code_result = getattr(part, "code_execution_result", None)
        if executable_code is not None:
            code_runs.append(
                {
                    "language": getattr(executable_code, "language", "python"),
                    "code": getattr(executable_code, "code", ""),
                }
            )
        if code_result is not None:
            # Attach the output to the most recent code block when possible.
            output = getattr(code_result, "output", "")
            outcome = getattr(code_result, "outcome", None)
            entry = {
                "outcome": getattr(outcome, "value", None) if outcome is not None else None,
                "output": output,
            }
            if code_runs and "output" not in code_runs[-1]:
                code_runs[-1].update(entry)
            else:
                code_runs.append(entry)
    if code_runs:
        extras["code_execution"] = code_runs
    return extras


def to_json(value: Any) -> str:
    """JSON-encode a value with a stable shape for prompt embedding."""
    return json.dumps(value, indent=2, ensure_ascii=False, sort_keys=False, default=str)


__all__ = [
    "DEFAULT_MAX_TURNS",
    "ToolLoopResult",
    "ToolSpec",
    "_TimeoutExceededError",
    "call_structured",
    "run_tool_loop",
    "to_json",
]
