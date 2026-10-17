import subprocess, json, re, tempfile, os, time
from groq import Groq

# ── Session store ────────────────────────────────────────────────────────────
# sessions[sid] = {
#   "history":   [...],     # full conversation history for LLM
#   "facts":     {...},     # extracted facts (name, image, port, region …)
#   "pending":   str|None,  # command waiting for YES/NO
#   "last_q":    str|None,  # last question asked (to avoid repeating)
#   "module":    str,       # docker | aws | system | k8s | network | logs
#   "ts":        float,     # last activity timestamp (for cleanup)
# }
sessions: dict[str, dict] = {}

# ── Unsafe patterns ───────────────────────────────────────────────────────────
UNSAFE = ["rm -rf /", "shutdown", "reboot", "mkfs", ":(){ :|:& };:", "dd if="]

# ── System prompt ─────────────────────────────────────────────────────────────
SYSTEM = """You are a DevOps AI Agent assistant. Your job is to help users run DevOps commands.

CRITICAL RULES – follow these exactly:
1. NEVER ask a question that has already been answered earlier in this conversation.
2. NEVER ask the same question twice in a row.
3. Read the FACTS block carefully — if a value is already known, use it directly.
4. If you have all the information needed, generate the command immediately.
5. Ask at most ONE question per turn.
6. NEVER ask for AWS credentials, SSH credentials, or API keys — they are injected automatically.
7. NEVER use sudo, never use -it flags.
8. NEVER invent or hallucinate values (hostnames, IDs, ARNs, etc.).
9. For read-only/list commands (docker ps, kubectl get pods, etc.) — generate command directly, no questions needed.
10. For destructive operations — confirm with the user first.
11. When generating a command keep it complete and executable.

OUTPUT FORMAT — return ONLY valid JSON, no markdown, no explanation:
  {"type":"question", "question":"<single clear question>"}
  {"type":"command",  "command":"<shell command>"}
  {"type":"answer",   "text":"<explanation or info, no command needed>"}

Use type "answer" when the user is asking a conceptual question (what is X, how does Y work).
"""


def _build_facts_block(facts: dict) -> str:
    if not facts:
        return ""
    lines = ["KNOWN FACTS (already provided by user, do NOT ask again):"]
    for k, v in facts.items():
        lines.append(f"  {k}: {v}")
    return "\n".join(lines)


def _extract_facts_from_message(msg: str, existing: dict) -> dict:
    """Best-effort extraction of key=value style facts from user messages."""
    facts = dict(existing)
    patterns = [
        (r"\bname[:\s]+([^\s,]+)", "name"),
        (r"\bimage[:\s]+([^\s,]+)", "image"),
        (r"\bport[:\s]+(\d+)", "port"),
        (r"\bregion[:\s]+([a-z]+-[a-z]+-\d+)", "region"),
        (r"\bnamespace[:\s]+([^\s,]+)", "namespace"),
        (r"\bbucket[:\s]+([^\s,]+)", "bucket"),
        (r"\bhost[:\s]+([^\s,]+)", "host"),
        (r"\bpath[:\s]+([^\s,]+)", "path"),
    ]
    for pattern, key in patterns:
        m = re.search(pattern, msg, re.I)
        if m and key not in facts:
            facts[key] = m.group(1)
    return facts


def _clean_sessions():
    """Remove sessions inactive for > 2 hours."""
    cutoff = time.time() - 7200
    stale = [sid for sid, s in sessions.items() if s.get("ts", 0) < cutoff]
    for sid in stale:
        sessions.pop(sid, None)


def _parse_response(raw: str) -> dict | None:
    """Parse LLM response into dict with type/question/command/text."""
    raw = raw.strip()
    # Strip markdown code fences if present
    raw = re.sub(r"^```(?:json)?\s*", "", raw)
    raw = re.sub(r"\s*```$", "", raw)
    try:
        data = json.loads(raw)
        if "type" in data:
            return data
    except Exception:
        pass
    # Try to find JSON object inside the text
    m = re.search(r'\{[^{}]*"type"\s*:\s*"[^"]+?"[^{}]*\}', raw, re.S)
    if m:
        try:
            return json.loads(m.group())
        except Exception:
            pass
    return None


def _ask_llm(messages: list, cfg: dict) -> dict | None:
    """Call Groq and return parsed response dict."""
    try:
        client = Groq(api_key=cfg["groq_key"])
        resp = client.chat.completions.create(
            model=cfg.get("groq_model", "llama-3.3-70b-versatile"),
            messages=messages,
            temperature=0.1,
            max_tokens=512,
        )
        raw = resp.choices[0].message.content
        return _parse_response(raw)
    except Exception as e:
        return {"type": "answer", "text": f"❌ LLM error: {e}"}


def _is_safe(cmd: str) -> bool:
    lower = cmd.lower()
    return not any(bad in lower for bad in UNSAFE)


# ── Public API ────────────────────────────────────────────────────────────────

def run_agent(sid: str, msg: str, cfg: dict) -> dict:
    """Process a user message and return a response dict."""
    _clean_sessions()

    # Init session
    if sid not in sessions:
        sessions[sid] = {
            "history": [],
            "facts": {},
            "pending": None,
            "last_q": None,
            "module": cfg.get("module", "general"),
            "ts": time.time(),
        }
    sess = sessions[sid]
    sess["ts"] = time.time()

    # Extract facts from the user message
    sess["facts"] = _extract_facts_from_message(msg, sess["facts"])

    # Append user message to history
    sess["history"].append({"role": "user", "content": msg})

    # Build the message list for the LLM
    facts_block = _build_facts_block(sess["facts"])
    system_content = SYSTEM
    if facts_block:
        system_content += f"\n\n{facts_block}"

    # Inject active credentials context (non-sensitive summary)
    cred_ctx = []
    aws = cfg.get("aws", {})
    target = cfg.get("target", {})
    if aws.get("access"):
        cred_ctx.append(f"AWS credentials are configured for region {aws.get('region','us-east-1')}.")
    if target and target.get("host"):
        cred_ctx.append(f"SSH target is {target['user']}@{target['host']} — already configured.")
    if cred_ctx:
        system_content += "\n\nCREDENTIALS STATUS:\n" + "\n".join(cred_ctx)

    llm_messages = [{"role": "system", "content": system_content}] + sess["history"]

    # Call LLM
    result = _ask_llm(llm_messages, cfg)

    if not result:
        return {"output": "❌ Could not parse AI response. Please try again."}

    rtype = result.get("type", "answer")

    # ── Question ──────────────────────────────────────────────────────────────
    if rtype == "question":
        question = result.get("question", "").strip()

        # Deduplication: if this is the same question as last time, push the
        # LLM to generate a command instead (it already has enough info)
        if question and question == sess.get("last_q"):
            # Force command generation
            llm_messages.append({
                "role": "user",
                "content": "You already asked that. You have all the info needed — generate the command now."
            })
            result = _ask_llm(llm_messages, cfg)
            if result and result.get("type") == "command":
                rtype = "command"
            else:
                # Still stuck — clear last_q and return generic progress message
                sess["last_q"] = None
                return {"output": "I have enough context now. Please describe what you want to do and I'll generate the command."}

        if rtype == "question":
            sess["last_q"] = question
            sess["history"].append({"role": "assistant", "content": json.dumps(result)})
            return {"output": question, "type": "question"}

    # ── Answer (informational) ────────────────────────────────────────────────
    if rtype == "answer":
        text = result.get("text", "")
        sess["last_q"] = None
        sess["history"].append({"role": "assistant", "content": json.dumps(result)})
        return {"output": text, "type": "answer"}

    # ── Command ───────────────────────────────────────────────────────────────
    if rtype == "command":
        cmd = result.get("command", "").strip()
        if not cmd:
            return {"output": "❌ Empty command generated."}
        if not _is_safe(cmd):
            return {"output": f"🚫 Unsafe command blocked: `{cmd}`", "type": "blocked"}

        sess["last_q"] = None
        sess["pending"] = cmd
        sess["history"].append({"role": "assistant", "content": json.dumps(result)})
        return {
            "command": cmd,
            "output": "Type **YES** to execute or **NO** to cancel.",
            "type": "confirm",
        }

    return {"output": "❌ Unexpected response from AI."}


def execute(sid: str, msg: str, cfg: dict) -> dict | None:
    """Handle YES/NO confirmation for a pending command."""
    if sid not in sessions:
        return None
    sess = sessions[sid]
    if not sess.get("pending"):
        return None

    answer = msg.strip().lower()

    if answer == "no":
        sess["pending"] = None
        return {"output": "🚫 Cancelled.", "type": "cancelled"}

    if answer != "yes":
        return {"output": "❓ Please type **YES** to run or **NO** to cancel.", "type": "confirm"}

    cmd = sess["pending"]
    sess["pending"] = None

    return _run_command(cmd, cfg)


def _run_command(cmd: str, cfg: dict) -> dict:
    """Execute a shell command locally, via SSH, or via AWS CLI."""
    try:
        aws = cfg.get("aws", {})
        target = cfg.get("target")

        # ── AWS command ───────────────────────────────────────────────────────
        if cmd.strip().startswith("aws"):
            env = os.environ.copy()
            env["AWS_ACCESS_KEY_ID"] = aws.get("access", "")
            env["AWS_SECRET_ACCESS_KEY"] = aws.get("secret", "")
            env["AWS_DEFAULT_REGION"] = aws.get("region", "us-east-1")
            r = subprocess.run(
                cmd, shell=True, capture_output=True, text=True, timeout=60, env=env
            )

        # ── SSH command ───────────────────────────────────────────────────────
        elif target and target.get("host"):
            key_content = target.get("key", "").strip()
            if key_content:
                tmp = tempfile.NamedTemporaryFile(delete=False, suffix=".pem")
                tmp.write((key_content + "\n").encode())
                tmp.close()
                os.chmod(tmp.name, 0o600)
                key_arg = f"-i {tmp.name}"
            else:
                tmp = None
                key_arg = ""

            ssh_cmd = (
                f'ssh {key_arg} -o StrictHostKeyChecking=no '
                f'-o UserKnownHostsFile=/dev/null '
                f'-o ConnectTimeout=10 '
                f'{target["user"]}@{target["host"]} "{cmd}"'
            )
            r = subprocess.run(
                ssh_cmd, shell=True, capture_output=True, text=True, timeout=120
            )
            if tmp:
                os.unlink(tmp.name)

        # ── Local command ─────────────────────────────────────────────────────
        else:
            r = subprocess.run(
                cmd, shell=True, capture_output=True, text=True, timeout=60
            )

        output = r.stdout.strip() or r.stderr.strip() or "✅ Done (no output)"
        return {"command": cmd, "output": output, "type": "result", "exit_code": r.returncode}

    except subprocess.TimeoutExpired:
        return {"command": cmd, "output": "⏱ Command timed out.", "type": "error"}
    except Exception as e:
        return {"command": cmd, "output": f"❌ {e}", "type": "error"}


def clear_session(sid: str):
    """Remove a session from memory."""
    sessions.pop(sid, None)


def get_session_info(sid: str) -> dict:
    """Return lightweight session metadata."""
    if sid not in sessions:
        return {}
    s = sessions[sid]
    return {
        "message_count": len(s["history"]),
        "facts": s["facts"],
        "has_pending": bool(s.get("pending")),
        "module": s.get("module", "general"),
    }
