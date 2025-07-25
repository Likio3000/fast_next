# backend/app/main.py
import os, json, asyncio, logging
from pathlib import Path
from typing import AsyncGenerator, Tuple, Dict, Any

from openai import AsyncOpenAI
import google.generativeai as genai
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

# ─────────── Logging ───────────
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s: %(message)s",
)
logger = logging.getLogger(__name__)

# ─────────── Prompt templates ───────────
SUGGESTION_PROMPT = (
    "You are an expert code reviewer. Identify **3-5 high-impact, low-effort** "
    "improvements (clarity, bugs, efficiency). "
    "**Do NOT rewrite the code.**\n\n"
    "Respond with a concise *bulleted list* in Markdown."
)
GENERATION_SYSTEM_PROMPT = (
    "You are an expert AI programmer. Refactor / improve the user’s code "
    "according to the suggestions provided.\n\n"
    "Return the **FULL UPDATED CODE** wrapped in Markdown code-fences. "
    "If multiple files are required, wrap each file in its own fence.\n\n"
    "*No commentary outside the code-fences.*"
)

# ─────────── Provider config ───────────
OPENAI_API_KEY = os.getenv("OPENAI_API_KEY")
OPENAI_AVAILABLE = bool(OPENAI_API_KEY)
openai_client = AsyncOpenAI(api_key=OPENAI_API_KEY)  # works even if None

OPENAI_MODEL_NAME = os.getenv("OPENAI_MODEL_NAME", "o4-mini-2025-04-16")

GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")
if GEMINI_API_KEY:
    try:
        genai.configure(api_key=GEMINI_API_KEY)
        GENAI_AVAILABLE = True
    except Exception:
        logger.exception("Failed to configure Gemini – Gemini features disabled.")
        GENAI_AVAILABLE = False
else:
    GENAI_AVAILABLE = False
    logger.warning("GEMINI_API_KEY not set – Gemini features disabled.")

GEMINI_MODEL_NAME = os.getenv("GEMINI_MODEL_NAME", "gemini-2.5-pro")

# Fail fast if no providers are configured
if not OPENAI_AVAILABLE and not GENAI_AVAILABLE:
    raise RuntimeError(
        "Neither OpenAI nor Gemini is configured. "
        "Please set at least one of OPENAI_API_KEY or GEMINI_API_KEY."
    )

GENERATION_PROVIDER = os.getenv("GENERATION_PROVIDER", "gemini").lower()
SUGGESTION_PROVIDER = os.getenv("SUGGESTION_PROVIDER", "openai").lower()
for vname, vval in [
    ("GENERATION_PROVIDER", GENERATION_PROVIDER),
    ("SUGGESTION_PROVIDER", SUGGESTION_PROVIDER),
]:
    if vval not in {"gemini", "openai"}:
        logger.warning("%s must be 'gemini' or 'openai'; defaulting to 'openai'.", vname)
        if vname == "GENERATION_PROVIDER":
            GENERATION_PROVIDER = "openai"
        else:
            SUGGESTION_PROVIDER = "openai"


# ─────────── SuggestionService ───────────
class SuggestionService:
    """
    Returns suggestions in batch *or* as an async stream, depending on caller.
    """

    def __init__(self, provider: str, openai_model: str, gemini_model: str):
        self.provider = provider
        self.openai_model = openai_model
        self.gemini_model = gemini_model

    # ----- batch helpers --------------------------------------------------
    async def _suggest_openai_batch(self, code: str) -> Tuple[str, str]:
        if not OPENAI_AVAILABLE:
            raise RuntimeError("OpenAI unavailable")
        resp = await openai_client.chat.completions.create(
            model=self.openai_model,
            messages=[
                {"role": "system", "content": SUGGESTION_PROMPT},
                {"role": "user", "content": f"```python\n{code}\n```"},
            ],
        )
        return self.openai_model, resp.choices[0].message.content.strip()

    async def _suggest_gemini_batch(self, code: str) -> Tuple[str, str]:
        if not GENAI_AVAILABLE:
            raise RuntimeError("Gemini unavailable")
        model = genai.GenerativeModel(self.gemini_model)
        resp = await model.generate_content_async(
            f"{SUGGESTION_PROMPT}\n\n```python\n{code}\n```"
        )
        return self.gemini_model, resp.text.strip()

    async def get_suggestions(self, code: str) -> Tuple[str, str]:
        try:
            if self.provider == "openai":
                return await self._suggest_openai_batch(code)
            else:
                return await self._suggest_gemini_batch(code)
        except Exception:
            logger.exception("Suggestion provider error")
        return (
            "MockedSuggestions",
            "• Split very large functions.\n• Add doc-strings.\n• Introduce type hints.",
        )

    # ----- streaming helpers ---------------------------------------------
    async def _stream_openai(self, code: str) -> AsyncGenerator[Dict[str, Any], None]:
        agent = self.openai_model
        if not OPENAI_AVAILABLE:
            logger.warning("OpenAI unavailable - yielding error event.")
            yield {
                "event": "error",
                "agent": agent,
                "delta": "OpenAI features are disabled on the server.",
            }
            yield {"event": "end", "agent": agent}
            return
        try:
            stream = await openai_client.chat.completions.create(
                model=agent,
                messages=[
                    {"role": "system", "content": SUGGESTION_PROMPT},
                    {"role": "user", "content": f"```python\n{code}\n```"},
                ],
                stream=True,
            )
        except Exception as e:
            logger.exception("OpenAI suggestion stream failed")
            yield {"event": "error", "agent": agent, "delta": str(e)}
            yield {"event": "end", "agent": agent}
            return

        async for chunk in stream:
            delta = chunk.choices[0].delta.content or ""
            if delta:
                yield {"event": "chunk", "agent": agent, "delta": delta}
        yield {"event": "end", "agent": agent}

    async def _stream_gemini(self, code: str) -> AsyncGenerator[Dict[str, Any], None]:
        agent = self.gemini_model
        if not GENAI_AVAILABLE:
            logger.warning("Gemini unavailable - yielding error event.")
            yield {
                "event": "error",
                "agent": agent,
                "delta": "Gemini features are disabled on the server.",
            }
            yield {"event": "end", "agent": agent}
            return

        try:
            model = genai.GenerativeModel(agent)
            stream = await model.generate_content_async(
                f"{SUGGESTION_PROMPT}\n\n```python\n{code}\n```", stream=True
            )
        except Exception as e:
            logger.exception("Gemini suggestion stream failed")
            yield {"event": "error", "agent": agent, "delta": str(e)}
            yield {"event": "end", "agent": agent}
            return

        async for chunk in stream:
            delta = getattr(chunk, "text", "")
            if delta:
                yield {"event": "chunk", "agent": agent, "delta": delta}
        yield {"event": "end", "agent": agent}

    async def stream_suggestions(
        self, code: str
    ) -> AsyncGenerator[Dict[str, Any], None]:
        if self.provider == "openai":
            async for rec in self._stream_openai(code):
                yield rec
        else:
            async for rec in self._stream_gemini(code):
                yield rec


# ─────────── GenerationService ───────────
class GenerationService:
    """Streams refactored code only."""

    def __init__(self, provider: str, gemini_model: str, openai_model: str):
        self.provider = provider
        self.gemini_model = gemini_model
        self.openai_model = openai_model

    def _make_event(self, type: str, agent: str, content: str | None = None) -> str:
        """Helper to construct a JSON event string."""
        event_data = {"type": type, "agent": agent}
        if content is not None:
            event_data["content"] = content
        return json.dumps(event_data) + "\n"

    async def stream_generated_code(
        self, user_code: str, suggestions: str, sugg_agent: str
    ) -> AsyncGenerator[str, None]:
        if self.provider == "openai":
            async for line in self._stream_openai(user_code, suggestions, sugg_agent):
                yield line
        else:
            async for line in self._stream_gemini(user_code, suggestions, sugg_agent):
                yield line

    # ----- OpenAI path ----------------------------------------------------
    async def _stream_openai(
        self, user_code: str, suggestions: str, sugg_agent: str
    ) -> AsyncGenerator[str, None]:
        if not OPENAI_AVAILABLE:
            yield self._make_event("error", "OpenAI", "OpenAI disabled.")
            yield self._make_event("stream_end", "OpenAI")
            return

        messages = [
            {"role": "system", "content": GENERATION_SYSTEM_PROMPT},
            {
                "role": "user",
                "content": (
                    f"<original_code>\n{user_code}\n</original_code>\n\n"
                    f"<suggestions from=\"{sugg_agent}\">\n{suggestions}\n</suggestions>"
                ),
            },
        ]

        try:
            stream = await openai_client.chat.completions.create(
                model=self.openai_model, messages=messages, stream=True
            )
            async for chunk in stream:
                delta = chunk.choices[0].delta.content or ""
                if delta:
                    yield self._make_event(
                        "generated_code_chunk", self.openai_model, delta
                    )
            yield self._make_event("stream_end", self.openai_model)
        except Exception as e:
            logger.exception("OpenAI generation failed")
            yield self._make_event("error", self.openai_model, str(e))
            yield self._make_event("stream_end", self.openai_model)

    # ----- Gemini path ----------------------------------------------------
    async def _stream_gemini(
        self, user_code: str, suggestions: str, sugg_agent: str
    ) -> AsyncGenerator[str, None]:
        if not GENAI_AVAILABLE:
            yield self._make_event("error", "Gemini", "Gemini disabled.")
            yield self._make_event("stream_end", "Gemini")
            return

        prompt = f"""
{GENERATION_SYSTEM_PROMPT}

<original_code>
{user_code}
</original_code>

<suggestions from="{sugg_agent}">
{suggestions}
</suggestions>
""".strip()

        try:
            model = genai.GenerativeModel(self.gemini_model)
            stream = await model.generate_content_async(prompt, stream=True)
            async for chunk in stream:
                delta = getattr(chunk, "text", "")
                if delta:
                    yield self._make_event(
                        "generated_code_chunk", self.gemini_model, delta
                    )
            yield self._make_event("stream_end", self.gemini_model)
        except Exception as e:
            logger.exception("Gemini generation failed")
            yield self._make_event("error", self.gemini_model, str(e))
            yield self._make_event("stream_end", self.gemini_model)


# ─────────── FastAPI wiring ───────────
suggestions_svc = SuggestionService(
    provider=SUGGESTION_PROVIDER,
    openai_model=OPENAI_MODEL_NAME,
    gemini_model=GEMINI_MODEL_NAME,
)
generation_svc = GenerationService(
    provider=GENERATION_PROVIDER,
    gemini_model=GEMINI_MODEL_NAME,
    openai_model=OPENAI_MODEL_NAME,
)

app = FastAPI()

origins = [
    o.strip()
    for o in os.getenv("CORS_ALLOW_ORIGINS", "http://localhost:3000").split(",")
    if o.strip()
]
app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class ChatRequest(BaseModel):
    user_message: str = Field(..., min_length=1, max_length=100_000)
    cached_suggestions: str | None = None
    cached_sugg_agent: str | None = None


@app.post("/chat")
async def chat(req: ChatRequest):
    """
    • If the UI already has suggestions, skip suggestion generation.
    • Otherwise: stream suggestions first, then refactored code.
    """

    if req.cached_suggestions and req.cached_sugg_agent:
        async def fast_stream():
            async for chunk in generation_svc.stream_generated_code(
                req.user_message, req.cached_suggestions, req.cached_sugg_agent
            ):
                yield chunk

        return StreamingResponse(
            fast_stream(), media_type="application/x-ndjson; charset=utf-8"
        )

    async def full_stream():
        sugg_accum, sugg_agent = [], None
        had_sugg_error = False

        # 1️⃣ suggestions (live)
        async for rec in suggestions_svc.stream_suggestions(req.user_message):
            if rec["event"] == "chunk":
                sugg_accum.append(rec["delta"])
                sugg_agent = rec["agent"]
                yield json.dumps(
                    {
                        "type": "suggestions_chunk",
                        "agent": rec["agent"],
                        "content": rec["delta"],
                    }
                ) + "\n"
            elif rec["event"] == "error":
                had_sugg_error = True
                yield json.dumps(
                    {"type": "error", "agent": rec["agent"], "content": rec["delta"]}
                ) + "\n"
            elif rec["event"] == "end":
                yield json.dumps({"type": "suggestions_end", "agent": rec["agent"]}) + "\n"

        if had_sugg_error:
            logger.warning("Skipping code generation due to suggestion failure.")
            return

        suggestions_text = "".join(sugg_accum)

        # 2️⃣ refactored code
        async for chunk in generation_svc.stream_generated_code(
            req.user_message, suggestions_text, sugg_agent or "unknown"
        ):
            yield chunk

    return StreamingResponse(
        full_stream(), media_type="application/x-ndjson; charset=utf-8"
    )


# ─────────── Static SPA ───────────
PROJECT_ROOT = Path(__file__).resolve().parents[2]
app.mount("/", StaticFiles(directory=PROJECT_ROOT / "frontend", html=True), name="frontend")

# Run: uvicorn backend.app.main:app --reload --port 8000
