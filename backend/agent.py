import subprocess, json, re, tempfile, os
from groq import Groq
from guardrails import Guard
from pydantic import BaseModel

sessions = {}
pending = {}

PROMPT = """
You are a DevOps AI Agent.

Rules:
- Return ONLY JSON
- No markdown
- No explanation
- Ask only missing required details
- Ask one question at a time
- Never ask AWS or SSH credentials
- Use saved credentials automatically
- Never invent values
- Never use sudo
- Never use -it
- Remember previous answers
- Generate command only after all required inputs exist

Behavior:
- When user wants to create something, first identify required inputs
- Ask missing inputs one by one
- Never generate command early
- Automatically detect resource type
- Automatically ask name, path, image, port, region, namespace, etc if needed
- Do not ask already provided values

Formats:
{"type":"question","question":"..."}
{"type":"command","command":"..."}
"""

class Out(BaseModel):
    type: str
    question: str = ""
    command: str = ""

guard = Guard.for_pydantic(output_class=Out)

def parse(x):
    try:
        return guard.parse(x).validated_output.dict()
    except:
        try:
            return json.loads(re.search(r'\{.*\}', x, re.S).group())
        except:
            return None

def ask_ai(msgs, cfg):

    ai = Groq(api_key=cfg["groq_key"])

    r = ai.chat.completions.create(
        model=cfg.get("groq_model", "llama-3.1-8b-instant"),
        messages=msgs,
        temperature=0
    )

    return parse(r.choices[0].message.content)

def safe(cmd):

    bad = [
        "rm -rf",
        "shutdown",
        "reboot",
        "mkfs",
        "sudo"
    ]

    return not any(x in cmd.lower() for x in bad)

def run_agent(sid, msg, cfg):

    sessions.setdefault(sid, [])

    sessions[sid].append({
        "role": "user",
        "content": msg
    })

    data = ask_ai(
        [{"role":"system","content":PROMPT}] + sessions[sid],
        cfg
    )

    if not data:
        return {"output":"❌ AI error"}

    if data["type"] == "question":
        return {"output":data["question"]}

    cmd = data["command"].strip()

    if not safe(cmd):
        return {"output":"🚫 Unsafe command"}

    pending[sid] = cmd

    return {
        "command":cmd,
        "output":"Type YES to run or NO to cancel"
    }

def execute(sid, msg, cfg):

    if sid not in pending:
        return None

    if msg.lower().strip() == "no":
        pending.pop(sid)
        return {"output":"🚫 Cancelled"}

    if msg.lower().strip() != "yes":
        return {"output":"❓ Type YES or NO"}

    cmd = pending.pop(sid)

    try:

        # AWS
        if cmd.startswith("aws"):

            aws = cfg.get("aws", {})

            env = os.environ.copy()
            env["AWS_ACCESS_KEY_ID"] = aws.get("access","")
            env["AWS_SECRET_ACCESS_KEY"] = aws.get("secret","")
            env["AWS_DEFAULT_REGION"] = aws.get("region","us-east-1")

            r = subprocess.run(
                cmd,
                shell=True,
                capture_output=True,
                text=True,
                timeout=60,
                env=env
            )

        # SSH
        else:

            t = cfg.get("target")

            if t and t.get("host"):

                f = tempfile.NamedTemporaryFile(delete=False)

                f.write((t.get("key","") + "\n").encode())

                f.close()

                os.chmod(f.name, 0o600)

                ssh = f'''
ssh -i {f.name} \
-o StrictHostKeyChecking=no \
-o UserKnownHostsFile=/dev/null \
{t["user"]}@{t["host"]} "{cmd}"
'''

                r = subprocess.run(
                    ssh,
                    shell=True,
                    capture_output=True,
                    text=True,
                    timeout=120
                )

                os.unlink(f.name)

            else:

                r = subprocess.run(
                    cmd,
                    shell=True,
                    capture_output=True,
                    text=True,
                    timeout=60
                )

        return {
            "command":cmd,
            "output":r.stdout.strip() or r.stderr.strip() or "✅ Done"
        }

    except Exception as e:
        return {"output":f"❌ {e}"}