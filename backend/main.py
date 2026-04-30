from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import Optional
from agent import run_agent, execute
import uuid

app = FastAPI(title="DevOps AI Agent API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ---------------- AWS ----------------
class AWSConfig(BaseModel):
    access: str = ""
    secret: str = ""
    region: str = "us-east-1"

# ---------------- SSH ----------------
class SSHConfig(BaseModel):
    host: str = ""
    user: str = ""
    key: str = ""

# ---------------- CONFIG ----------------
class AgentConfig(BaseModel):
    groq_key: str = ""
    groq_model: str = "llama-3.1-8b-instant"

    aws: Optional[AWSConfig] = None
    target: Optional[SSHConfig] = None

# ---------------- REQUEST ----------------
class Req(BaseModel):
    message: str
    session_id: Optional[str] = None
    config: AgentConfig = AgentConfig()

# ---------------- API ----------------
@app.post("/agent")
def agent_api(data: Req):

    sid = data.session_id or str(uuid.uuid4())

    config = {
        "groq_key": data.config.groq_key,
        "groq_model": data.config.groq_model,

        "aws": (
            data.config.aws.model_dump()
            if data.config.aws else {}
        ),

        "target": (
            data.config.target.model_dump()
            if data.config.target else None
        )
    }

    exec_res = execute(
        sid,
        data.message,
        config
    )

    if exec_res:
        return {
            "session_id": sid,
            **exec_res
        }

    res = run_agent(
        sid,
        data.message,
        config
    )

    return {
        "session_id": sid,
        **res
    }

# ---------------- HEALTH ----------------
@app.get("/health")
def health():

    return {
        "status": "ok",
        "service": "DevOps AI Agent"
    }