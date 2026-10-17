import uuid
import json
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from typing import Optional
from agent import run_agent, execute, clear_session, get_session_info

# ── App ───────────────────────────────────────────────────────────────────────
app = FastAPI(title="DevOps AI Agent API", version="2.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ── Request Models ────────────────────────────────────────────────────────────

class AWSConfig(BaseModel):
    access: str = ""
    secret: str = ""
    region: str = "us-east-1"
    bucket: str = ""


class SSHConfig(BaseModel):
    host: str = ""
    user: str = ""
    key:  str = ""


class AgentConfig(BaseModel):
    groq_key:   str = ""
    groq_model: str = "llama-3.3-70b-versatile"
    aws:    Optional[AWSConfig] = None
    target: Optional[SSHConfig] = None
    module: str = "general"


class AgentRequest(BaseModel):
    message:    str
    session_id: Optional[str] = None
    config:     AgentConfig = AgentConfig()


# ── Helpers ───────────────────────────────────────────────────────────────────

def _build_config(req: AgentRequest) -> dict:
    return {
        "groq_key":   req.config.groq_key,
        "groq_model": req.config.groq_model,
        "module":     req.config.module,
        "aws": req.config.aws.model_dump() if req.config.aws else {},
        "target": req.config.target.model_dump() if req.config.target else None,
    }


def _validate_groq_key(key: str):
    if not key or not key.strip():
        raise HTTPException(status_code=400, detail="Groq API key is required.")


# ── Routes ────────────────────────────────────────────────────────────────────

@app.post("/agent")
def agent_endpoint(req: AgentRequest):
    """Main chat endpoint. Handles both question/command flow and YES/NO confirmation."""
    _validate_groq_key(req.config.groq_key)

    sid = req.session_id or str(uuid.uuid4())
    cfg = _build_config(req)

    # Check for pending command confirmation first
    exec_res = execute(sid, req.message, cfg)
    if exec_res:
        return {"session_id": sid, **exec_res}

    # Run agent reasoning
    res = run_agent(sid, req.message, cfg)
    return {"session_id": sid, **res}


@app.post("/agent/stream")
async def agent_stream_endpoint(req: AgentRequest):
    """
    Streaming version — sends chunks as Server-Sent Events (SSE).
    The frontend can consume this with EventSource or fetch + ReadableStream.
    """
    _validate_groq_key(req.config.groq_key)

    sid = req.session_id or str(uuid.uuid4())
    cfg = _build_config(req)

    async def event_generator():
        # Check for pending confirmation first
        exec_res = execute(sid, req.message, cfg)
        if exec_res:
            yield f"data: {json.dumps({'session_id': sid, **exec_res})}\n\n"
            yield "data: [DONE]\n\n"
            return

        res = run_agent(sid, req.message, cfg)
        payload = {"session_id": sid, **res}

        # Simulate streaming by chunking the output text
        output = res.get("output", "")
        words = output.split(" ")
        accumulated = ""
        for i, word in enumerate(words):
            accumulated += word + (" " if i < len(words) - 1 else "")
            chunk = {
                "session_id": sid,
                "chunk": word + (" " if i < len(words) - 1 else ""),
                "type": res.get("type", "answer"),
                "done": False,
            }
            if "command" in res:
                chunk["command"] = res["command"]
            yield f"data: {json.dumps(chunk)}\n\n"

        # Final event with full payload
        payload["done"] = True
        yield f"data: {json.dumps(payload)}\n\n"
        yield "data: [DONE]\n\n"

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",       # disable nginx buffering
        },
    )


@app.delete("/session/{session_id}")
def delete_session(session_id: str):
    """Clear a session from memory (called when user clicks 'New Session')."""
    clear_session(session_id)
    return {"status": "ok", "message": f"Session {session_id} cleared."}


@app.get("/session/{session_id}")
def session_info(session_id: str):
    """Return metadata about an active session."""
    info = get_session_info(session_id)
    if not info:
        raise HTTPException(status_code=404, detail="Session not found.")
    return {"session_id": session_id, **info}


@app.get("/health")
def health():
    return {
        "status": "ok",
        "service": "DevOps AI Agent",
        "version": "2.0.0",
    }


@app.get("/")
def root():
    return {
        "service": "DevOps AI Agent API",
        "docs": "/docs",
        "health": "/health",
    }
