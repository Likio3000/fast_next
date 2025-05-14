# backend/app/main.py
import os, json, asyncio, logging
from pathlib import Path
from typing import AsyncGenerator, Tuple

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

# ─────────── Optional “agents” dep ───────────
try:
    from agents import Agent, Runner  # type: ignore
    AGENTS_AVAILABLE = True
except ImportError:
    AGENTS_AVAILABLE = False
    logger.warning("'agents' module not found – using mocked suggestions.")

# ─────────── Gemini config ───────────
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")
if GEMINI_API_KEY:
    try:
        genai.configure(api_key=GEMINI_API_KEY)
        GENAI_AVAILABLE = True
    except Exception:
        logger.exception("Failed to configure Gemini – disabling generation.")
        GENAI_AVAILABLE = False
else:
    GENAI_AVAILABLE = False
    logger.warning("GEMINI_API_KEY not set – Gemini generation disabled.")

GEMINI_MODEL_NAME = os.getenv("GEMINI_MODEL_NAME", "gemini-1.5-flash-latest")

# ─────────── Services ───────────
class SuggestionService:
    async def get_suggestions(self, code: str) -> Tuple[str, str]:
        if not AGENTS_AVAILABLE:
            return (
                "MockedSuggestions",
                "• Split very large functions.\n• Add doc‑strings.\n• Introduce type hints."
            )

        try:
            agent_name = "CodeAnalyzerO3"
            analyzer = Agent(
                name=agent_name,
                instructions=(
                    "You are an expert code reviewer. Identify 3‑5 high‑impact, "
                    "low‑effort improvements (clarity, bugs, efficiency). "
                    "**Do NOT rewrite the code.** Respond with a bulleted list."
                ),
                model="gpt-4o-mini",
            )
            result = await Runner.run(analyzer, input=f"```python\n{code}\n```")
            if hasattr(result, "final_output") and result.final_output:
                return agent_name, result.final_output
        except Exception:
            logger.exception("SuggestionService error")

        return ("SuggestionServiceError",
                "AI suggestion service unavailable – add unit tests and tighten error handling.")

class GenerationService:
    def __init__(self, model_name: str) -> None:
        self.model_name = model_name

    async def stream_generated_code(
        self, user_code: str, suggestions: str, sugg_agent: str
    ) -> AsyncGenerator[str, None]:
        yield json.dumps(
            {"type": "suggestions", "agent": sugg_agent, "content": suggestions}
        ) + "\n"

        if not GENAI_AVAILABLE:
            msg = "Gemini generation disabled."
            yield json.dumps({"type": "error", "agent": "Gemini", "content": msg}) + "\n"
            yield json.dumps({"type": "stream_end", "agent": "Gemini"}) + "\n"
            return

        prompt = f"""
You are an expert AI programmer. Refactor / improve the user’s code according to the suggestions below.

<original_code>
{user_code}
</original_code>

<suggestions from="{sugg_agent}">
{suggestions}
</suggestions>

Return the **FULL UPDATED CODE** in Markdown code‑fences.

If multiple files are needed, wrap each file.


No commentary outside the fences.
""".strip()

        model = genai.GenerativeModel(self.model_name)

        try:
            stream = await model.generate_content_async(
                prompt, generation_config=genai.types.GenerationConfig(), stream=True
            )
            async for chunk in stream:
                if getattr(chunk, "text", None):
                    yield json.dumps(
                        {"type": "generated_code_chunk",
                         "agent": self.model_name,
                         "content": chunk.text}
                    ) + "\n"
                await asyncio.sleep(0)
            yield json.dumps({"type": "stream_end", "agent": self.model_name}) + "\n"
        except Exception as e:
            logger.exception("Gemini generation failed")
            yield json.dumps(
                {"type": "error", "agent": self.model_name, "content": str(e)}
            ) + "\n"
            yield json.dumps({"type": "stream_end", "agent": self.model_name}) + "\n"

# ─────────── FastAPI app ───────────
suggestions_svc = SuggestionService()
generation_svc = GenerationService(GEMINI_MODEL_NAME)

app = FastAPI()

origins = [
    o.strip() for o in os.getenv("CORS_ALLOW_ORIGINS", "http://localhost:3000").split(",") if o.strip()
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

@app.post("/chat")
async def chat(req: ChatRequest):
    agent, sugs = await suggestions_svc.get_suggestions(req.user_message)
    stream = generation_svc.stream_generated_code(req.user_message, sugs, agent)
    return StreamingResponse(stream, media_type="application/x-ndjson; charset=utf-8")

# ─────────── Serve static frontend ───────────
PROJECT_ROOT = Path(__file__).resolve().parents[2]
app.mount(
    "/", StaticFiles(directory=PROJECT_ROOT / "frontend", html=True), name="frontend"
)

# Run: uvicorn backend.app.main:app --reload --port 8000
