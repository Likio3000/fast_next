from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from agents import Agent, Runner, function_tool
import os, asyncio

app = FastAPI()

# Allow requests from the Next.js dev server
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Example Python function exposed as a tool
@function_tool
def get_current_year() -> int:
    """Return the current year."""
    from datetime import datetime
    return datetime.now().year

class ChatRequest(BaseModel):
    user_message: str

@app.post("/chat")
async def chat(req: ChatRequest):
    # Define a simple agent – fine for early development; you can optimize later
    assistant = Agent(
        name="Assistant",
        instructions="You are a helpful assistant. Use provided tools when helpful.",
        tools=[get_current_year],
        model="gpt-4.1-nano"  # CHOSEN MODEL CHODEN MODEL CHODEN MODEL CHOSEN MODEL
    )

    try:
        # Runner.run is async; returns an AgentResult with .final_output
        result = await Runner.run(assistant, input=req.user_message)
        return {"reply": result.final_output}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))