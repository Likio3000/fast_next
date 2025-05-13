import os
import logging
import asyncio
import json
from typing import AsyncGenerator, Tuple

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

# ──────────────────────────────────────────────────────────────────────────────
# Logging
# ──────────────────────────────────────────────────────────────────────────────
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s: %(message)s",
)
logger = logging.getLogger(__name__)

# ──────────────────────────────────────────────────────────────────────────────
# Optional “agents” dependency (GPT‑4o‑mini, etc.)
# ──────────────────────────────────────────────────────────────────────────────
try:
    from agents import Agent, Runner  # type: ignore
    AGENTS_AVAILABLE = True
except ImportError:
    AGENTS_AVAILABLE = False
    logger.warning("'agents' module not found – using mocked suggestions.")

# ──────────────────────────────────────────────────────────────────────────────
# Gemini configuration
# ──────────────────────────────────────────────────────────────────────────────
import google.generativeai as genai

GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")
if GEMINI_API_KEY:
    try:
        genai.configure(api_key=GEMINI_API_KEY)
        GENAI_AVAILABLE = True
    except Exception as e:  # pragma: no cover
        logger.exception("Failed to configure Gemini – disabling generation.")
        GENAI_AVAILABLE = False
else:
    GENAI_AVAILABLE = False
    logger.warning("GEMINI_API_KEY not set – Gemini generation disabled.")

GEMINI_MODEL_NAME = os.getenv("GEMINI_MODEL_NAME", "gemini-1.5-flash-latest")

# ──────────────────────────────────────────────────────────────────────────────
# Services
# ──────────────────────────────────────────────────────────────────────────────
class SuggestionService:
    """Return concise suggestions for improving the user’s code."""

    async def get_suggestions(self, code: str) -> Tuple[str, str]:
        if not AGENTS_AVAILABLE:
            return (
                "MockedSuggestions",
                (
                    "• Consider splitting very large functions into smaller units.\n"
                    "• Add or improve doc‑strings for public functions/classes.\n"
                    "• Introduce type‑hints where missing to improve static analysis."
                ),
            )

        try:
            agent_name = "CodeAnalyzerO3"
            analyzer = Agent(
                name=agent_name,
                instructions=(
                    "You are an expert code reviewer. Identify 3‑5 high‑impact, "
                    "low‑effort improvements (clarity, potential bugs, efficiency, "
                    "best‑practices). **Do NOT rewrite the code.** Respond with a "
                    "bulleted list."
                ),
                model="gpt-4o-mini",
            )
            prompt = f"```python\n{code}\n```"
            result = await Runner.run(analyzer, input=prompt)
            if hasattr(result, "final_output") and result.final_output:
                return agent_name, result.final_output
            logger.warning("Analyzer returned no 'final_output'; using fallback.")
        except Exception as e:  # pragma: no cover
            logger.exception("SuggestionService error", exc_info=e)

        return (
            "SuggestionServiceError",
            "AI suggestion service unavailable – add unit tests and tighten error handling.",
        )


class GenerationService:
    """Stream Gemini output as NDJSON lines."""

    def __init__(self, model_name: str) -> None:
        self.model_name = model_name

    async def stream_generated_code(
        self,
        user_code: str,
        suggestions: str,
        suggestions_agent: str,
    ) -> AsyncGenerator[str, None]:
        # 1️⃣ Always send the suggestions first
        yield (
            json.dumps(
                {
                    "type": "suggestions",
                    "agent": suggestions_agent,
                    "content": suggestions,
                }
            )
            + "\n"
        )

        if not GENAI_AVAILABLE:
            msg = "Gemini generation disabled on the server."
            logger.warning(msg)
            yield json.dumps({"type": "error", "agent": "Gemini", "content": msg}) + "\n"
            yield json.dumps({"type": "stream_end", "agent": "Gemini"}) + "\n"
            return

        prompt = f"""
You are an expert AI programmer. Refactor / improve the user’s code according to the
suggestions below.

<original_code>
{user_code}
</original_code>

<suggestions from="{suggestions_agent}">
{suggestions}
</suggestions>

Return the **FULL UPDATED CODE** using file markers:

--- START FILE: relative/path/to/file ---
<file contents>
--- END FILE: relative/path/to/file ---

No extra commentary.
""".strip()

        model = genai.GenerativeModel(self.model_name)

        try:
            stream = await model.generate_content_async(
                prompt,
                generation_config=genai.types.GenerationConfig(),
                stream=True,
            )
            async for chunk in stream:
                if getattr(chunk, "text", None):
                    yield (
                        json.dumps(
                            {
                                "type": "generated_code_chunk",
                                "agent": self.model_name,
                                "content": chunk.text,
                            }
                        )
                        + "\n"
                    )
                await asyncio.sleep(0)  # keep event‑loop responsive
            yield json.dumps({"type": "stream_end", "agent": self.model_name}) + "\n"
        except Exception as e:  # pragma: no cover
            logger.exception("Gemini generation failed")
            yield json.dumps(
                {
                    "type": "error",
                    "agent": self.model_name,
                    "content": f"Gemini error: {e}",
                }
            ) + "\n"
            yield json.dumps({"type": "stream_end", "agent": self.model_name}) + "\n"


# ──────────────────────────────────────────────────────────────────────────────
# FastAPI application
# ──────────────────────────────────────────────────────────────────────────────
suggestions = SuggestionService()
generation = GenerationService(GEMINI_MODEL_NAME)

app = FastAPI()

# CORS origins configurable via env:  CORS_ALLOW_ORIGINS="http://localhost:3000,https://your‑prod‑url"
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
    user_message: str = Field(
        ..., min_length=1, max_length=100_000, description="Code to analyse & improve"
    )


@app.post("/chat")
async def chat(req: ChatRequest):
    code = req.user_message
    agent, sugs = await suggestions.get_suggestions(code)
    stream = generation.stream_generated_code(code, sugs, agent)
    return StreamingResponse(stream, media_type="application/x-ndjson; charset=utf-8")



from pathlib import Path
from fastapi.staticfiles import StaticFiles

PROJECT_ROOT = Path(__file__).resolve().parents[2]   # fast_next/
frontend_dir = PROJECT_ROOT / "frontend"             # fast_next/frontend

app.mount("/", StaticFiles(directory=frontend_dir, html=True), name="frontend")


# Run locally with:
#   uvicorn backend.app.main:app --reload --port 8000
