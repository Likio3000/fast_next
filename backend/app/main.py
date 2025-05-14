# backend/app/main.py
import os, json, asyncio, logging
from pathlib import Path
from typing import AsyncGenerator, Tuple

import openai
import google.generativeai as genai
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

# ─────────── Logging ───────────
logging.basicConfig(level=logging.INFO,
                    format="%(asctime)s %(levelname)s %(name)s: %(message)s")
logger = logging.getLogger(__name__)

# ─────────── Prompt templates ───────────
SUGGESTION_PROMPT = (
    "You are an expert code reviewer. Identify **3‑5 high‑impact, low‑effort** "
    "improvements (clarity, bugs, efficiency). "
    "**Do NOT rewrite the code.**\n\n"
    "Respond with a concise *bulleted list* in Markdown."
)

GENERATION_SYSTEM_PROMPT = (
    "You are an expert AI programmer. Refactor / improve the user’s code "
    "according to the suggestions provided.\n\n"
    "Return the **FULL UPDATED CODE** wrapped in Markdown code‑fences. "
    "If multiple files are required, wrap each file in its own fence.\n\n"
    "*No commentary outside the code‑fences.*"
)

# ─────────── Optional “agents” dep (legacy fallback) ───────────
try:
    from agents import Agent, Runner  # type: ignore
    AGENTS_AVAILABLE = True
except ImportError:
    AGENTS_AVAILABLE = False
    logger.info("'agents' module not found – legacy path disabled.")

# ─────────── OpenAI config ───────────
OPENAI_API_KEY = os.getenv("OPENAI_API_KEY")
if OPENAI_API_KEY:
    openai.api_key = OPENAI_API_KEY
    OPENAI_AVAILABLE = True
else:
    OPENAI_AVAILABLE = False
    logger.warning("OPENAI_API_KEY not set – OpenAI features disabled.")

OPENAI_MODEL_NAME = os.getenv("OPENAI_MODEL_NAME", "gpt-4o-mini")

# ─────────── Gemini config ───────────
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")
if GEMINI_API_KEY:
    try:
        genai.configure(api_key=GEMINI_API_KEY)
        GENAI_AVAILABLE = True
    except Exception:
        logger.exception("Failed to configure Gemini – Gemini features disabled.")
        GENAI_AVAILABLE = False
else:
    GENAI_AVAILABLE = False
    logger.warning("GEMINI_API_KEY not set – Gemini features disabled.")

GEMINI_MODEL_NAME = os.getenv("GEMINI_MODEL_NAME", "gemini-1.5-flash-latest")

# ─────────── Providers to use (env‑switchable) ───────────
GENERATION_PROVIDER = os.getenv("GENERATION_PROVIDER", "gemini").lower()
SUGGESTION_PROVIDER = os.getenv("SUGGESTION_PROVIDER", "openai").lower()

for var_name, value in [
    ("GENERATION_PROVIDER", GENERATION_PROVIDER),
    ("SUGGESTION_PROVIDER", SUGGESTION_PROVIDER),
]:
    if value not in {"gemini", "openai"}:
        logger.warning("%s must be 'gemini' or 'openai'; defaulting to 'openai'.", var_name)
        if var_name == "GENERATION_PROVIDER":
            GENERATION_PROVIDER = "openai"
        else:
            SUGGESTION_PROVIDER = "openai"

# ─────────── Services ───────────
class SuggestionService:
    """Returns (agent_name, markdown_bullets)."""

    def __init__(self, provider: str, openai_model: str, gemini_model: str) -> None:
        self.provider = provider
        self.openai_model = openai_model
        self.gemini_model = gemini_model

    async def _suggest_openai(self, code: str) -> Tuple[str, str]:
        if not OPENAI_AVAILABLE:
            raise RuntimeError("OpenAI unavailable")

        messages = [
            {"role": "system", "content": SUGGESTION_PROMPT},
            {"role": "user", "content": f"```python\n{code}\n```"},
        ]
        resp = await openai.ChatCompletion.acreate(
            model=self.openai_model,
            messages=messages,
        )
        out = resp.choices[0].message.content.strip()
        return self.openai_model, out

    async def _suggest_gemini(self, code: str) -> Tuple[str, str]:
        if not GENAI_AVAILABLE:
            raise RuntimeError("Gemini unavailable")

        model = genai.GenerativeModel(self.gemini_model)
        prompt = f"{SUGGESTION_PROMPT}\n\n```python\n{code}\n```"
        resp = await model.generate_content_async(prompt)
        out = resp.text.strip()
        return self.gemini_model, out

    async def get_suggestions(self, code: str) -> Tuple[str, str]:
        try:
            if self.provider == "openai":
                return await self._suggest_openai(code)
            else:
                return await self._suggest_gemini(code)
        except Exception as e:
            logger.warning("Suggestion provider error: %s", e)

        # ── legacy / final fallback ───────────────────────────
        if AGENTS_AVAILABLE:
            try:
                agent_name = "CodeAnalyzerO3"
                analyzer = Agent(
                    name=agent_name,
                    instructions=SUGGESTION_PROMPT,
                    model=OPENAI_MODEL_NAME,
                )
                result = await Runner.run(analyzer, input=f"```python\n{code}\n```")
                if hasattr(result, "final_output") and result.final_output:
                    return agent_name, result.final_output
            except Exception:
                logger.exception("Legacy Agent suggestion error")

        return (
            "MockedSuggestions",
            "• Split very large functions.\n• Add doc‑strings.\n• Introduce type hints.",
        )


class GenerationService:
    """Streams refactored code from either OpenAI or Gemini as NDJSON."""

    def __init__(self, provider: str, gemini_model: str, openai_model: str) -> None:
        self.provider = provider  # 'gemini' | 'openai'
        self.gemini_model = gemini_model
        self.openai_model = openai_model

    async def stream_generated_code(
        self, user_code: str, suggestions: str, sugg_agent: str
    ) -> AsyncGenerator[str, None]:
        # 1) always send suggestions first
        yield json.dumps(
            {"type": "suggestions", "agent": sugg_agent, "content": suggestions}
        ) + "\n"

        if self.provider == "openai":
            async for line in self._stream_openai(user_code, suggestions, sugg_agent):
                yield line
        else:
            async for line in self._stream_gemini(user_code, suggestions, sugg_agent):
                yield line

    # ── OpenAI path ────────────────────────────────────────────
    async def _stream_openai(
        self, user_code: str, suggestions: str, sugg_agent: str
    ) -> AsyncGenerator[str, None]:
        if not OPENAI_AVAILABLE:
            msg = "OpenAI generation disabled."
            yield json.dumps({"type": "error", "agent": "OpenAI", "content": msg}) + "\n"
            yield json.dumps({"type": "stream_end", "agent": "OpenAI"}) + "\n"
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
            response = await openai.ChatCompletion.acreate(
                model=self.openai_model,
                messages=messages,
                stream=True,
            )
            async for chunk in response:
                delta = chunk.choices[0].delta.get("content")
                if delta:
                    yield json.dumps(
                        {
                            "type": "generated_code_chunk",
                            "agent": self.openai_model,
                            "content": delta,
                        }
                    ) + "\n"
                await asyncio.sleep(0)  # cooperative
            yield json.dumps({"type": "stream_end", "agent": self.openai_model}) + "\n"
        except Exception as e:
            logger.exception("OpenAI generation failed")
            yield json.dumps(
                {"type": "error", "agent": self.openai_model, "content": str(e)}
            ) + "\n"
            yield json.dumps({"type": "stream_end", "agent": self.openai_model}) + "\n"

    # ── Gemini path ────────────────────────────────────────────
    async def _stream_gemini(
        self, user_code: str, suggestions: str, sugg_agent: str
    ) -> AsyncGenerator[str, None]:
        if not GENAI_AVAILABLE:
            msg = "Gemini generation disabled."
            yield json.dumps({"type": "error", "agent": "Gemini", "content": msg}) + "\n"
            yield json.dumps({"type": "stream_end", "agent": "Gemini"}) + "\n"
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

        model = genai.GenerativeModel(self.gemini_model)

        try:
            stream = await model.generate_content_async(
                prompt, generation_config=genai.types.GenerationConfig(), stream=True
            )
            async for chunk in stream:
                if getattr(chunk, "text", None):
                    yield json.dumps(
                        {
                            "type": "generated_code_chunk",
                            "agent": self.gemini_model,
                            "content": chunk.text,
                        }
                    ) + "\n"
                await asyncio.sleep(0)
            yield json.dumps({"type": "stream_end", "agent": self.gemini_model}) + "\n"
        except Exception as e:
            logger.exception("Gemini generation failed")
            yield json.dumps(
                {"type": "error", "agent": self.gemini_model, "content": str(e)}
            ) + "\n"
            yield json.dumps({"type": "stream_end", "agent": self.gemini_model}) + "\n"


# ─────────── FastAPI app ───────────
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
    # If frontend sends cached suggestions, skip recomputation
    if req.cached_suggestions and req.cached_sugg_agent:
        agent = req.cached_sugg_agent
        sugs = req.cached_suggestions
    else:
        agent, sugs = await suggestions_svc.get_suggestions(req.user_message)

    stream = generation_svc.stream_generated_code(req.user_message, sugs, agent)
    return StreamingResponse(stream, media_type="application/x-ndjson; charset=utf-8")


# ─────────── Serve static frontend ───────────
PROJECT_ROOT = Path(__file__).resolve().parents[2]
app.mount(
    "/", StaticFiles(directory=PROJECT_ROOT / "frontend", html=True), name="frontend"
)

# Run: uvicorn backend.app.main:app --reload --port 8000
