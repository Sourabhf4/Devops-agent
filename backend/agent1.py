import subprocess, json, re
from groq import Groq

sessions, pending = {}, {}

PROMPT = """
You are a DevOps AI Agent.

- Ask for missing inputs
- Fetch real data using CLI if needed
- Never invent IDs
- Generate command only when ready

Return ONLY JSON:
{"type":"question","question":"..."}
{"type":"command","command":"..."}
"""

def clean(x): return x.strip().replace("(", "").replace(")", "")

def parse(r):
    m = re.search(r'\{[\s\S]*\}', r)
    return json.loads(m.group()) if m else None

def inject(cmd, aws):
    if cmd.startswith("aws") and aws.get("access"):
        return f"AWS_ACCESS_KEY_ID={aws['access']} AWS_SECRET_ACCESS_KEY={aws['secret']} AWS_DEFAULT_REGION={aws.get('region','us-east-1')} {cmd}"
    return cmd

def run_agent(sid, msg, config):
    msg = clean(msg)
    sessions.setdefault(sid, []).append({"role":"user","content":msg})

    res = Groq(api_key=config["groq_key"]).chat.completions.create(
        model=config.get("groq_model","llama-3.1-8b-instant"),
        messages=[{"role":"system","content":PROMPT}] + sessions[sid],
        temperature=0
    )

    reply = res.choices[0].message.content.strip()
    sessions[sid].append({"role":"assistant","content":reply})
    data = parse(reply)

    if not data: return {"output":"❌ AI error"}

    if data["type"] == "question":
        return {"output": data["question"]}

    if data["type"] == "command":
        cmd = clean(data["command"])

        # ⚠️ Smart safety (allow with confirm)
        if any(x in cmd for x in ["delete","terminate","rm "]):
            pending[sid] = {"exec":inject(cmd,config.get("aws",{})), "display":cmd, "danger":True}
            return {"command":cmd, "output":"⚠️ Type CONFIRM to execute or NO to cancel"}

        pending[sid] = {"exec":inject(cmd,config.get("aws",{})), "display":cmd}
        return {"command":cmd,"output":"Type YES to run or NO to cancel"}

    return {"output":"❌ Unexpected"}

def execute(sid, msg, config):
    if sid not in pending: return None

    entry = pending[sid]

    if entry.get("danger"):
        if msg.lower() != "confirm":
            if msg.lower() == "no":
                pending.pop(sid)
                return {"output":"🚫 Cancelled"}
            return {"output":"⚠️ Type CONFIRM to execute or NO to cancel"}

    if msg.lower() in ["yes","confirm"]:
        pending.pop(sid)
        try:
            r = subprocess.run(entry["exec"], shell=True, capture_output=True, text=True, timeout=60)
            return {"command":entry["display"], "output":r.stdout or r.stderr or "(no output)"}
        except:
            return {"output":"❌ Timeout"}

    if msg.lower() == "no":
        pending.pop(sid)
        return {"output":"🚫 Cancelled"}

    return None
