# DevOps Agent Backend

## Setup

```bash
pip install fastapi uvicorn groq python-dotenv
```

## Run

```bash
uvicorn main:app --reload --host 0.0.0.0 --port 8000
```

## No .env needed
All credentials (Groq API key, model, AWS keys) are sent from the frontend with each request.
