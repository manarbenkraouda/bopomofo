import os
from pathlib import Path

from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parent.parent
load_dotenv(ROOT / ".env")

OPENROUTER_API_KEY = os.getenv("OPENROUTER_API_KEY", "")
OPENROUTER_MODEL = os.getenv("OPENROUTER_MODEL", "deepseek/deepseek-v4.1-flash")
# The coach plans practice from the stats. Jev Router picks a model and reasoning effort per request.
COACH_MODEL = os.getenv("COACH_MODEL", "typesafe/jev-router")
# PostgreSQL. The role must not be a superuser or have BYPASSRLS: row-level security keeps each user's data apart.
DATABASE_URL = os.getenv("DATABASE_URL", "")
ALLOW_RLS_BYPASS = os.getenv("ALLOW_RLS_BYPASS", "") == "1"  # tests and tools only, never in production
# The time zone of a user who has not chosen one yet (onboarding asks for it). Days, streaks, and goals follow it.
DEFAULT_TIMEZONE = os.getenv("DEFAULT_TIMEZONE", "UTC")
# Clerk sign-in. The API checks the session token of every request with the secret key (or the PEM public key).
CLERK_SECRET_KEY = os.getenv("CLERK_SECRET_KEY", "")
CLERK_JWT_KEY = os.getenv("CLERK_JWT_KEY", "")
# The frontend origins allowed to use the tokens, comma separated, e.g. https://bopomofo.app. Empty: any origin.
CLERK_AUTHORIZED_PARTIES = [o.strip() for o in os.getenv("CLERK_AUTHORIZED_PARTIES", "").split(",") if o.strip()]
# Keep the learner's last reading quiz clips on disk to tune the thresholds. Off unless set to 1.
SAVE_QUIZ_CLIPS = os.getenv("SAVE_QUIZ_CLIPS", "") == "1"
# Limits for each user (app/limits.py), so one account cannot use up the AI credit, CPU, or disk.
# AI energy refills at midnight in the learner's time zone; the audio clip limit uses the last 24 hours.
AI_DAILY_LIMIT_USD = float(os.getenv("AI_DAILY_LIMIT_USD", "1"))  # AI spend per local day: coach, sentences, translation
AI_DAILY_CALLS = int(os.getenv("AI_DAILY_CALLS", "400"))  # AI calls per local day, also when the provider gives no cost
TTS_DAILY_CLIPS = int(os.getenv("TTS_DAILY_CLIPS", "3000"))  # new text-to-speech clips (a replay from the cache is free)
TTS_CACHE_MB_PER_USER = float(os.getenv("TTS_CACHE_MB_PER_USER", "200"))  # audio cache; the clips used least recently go first
MODEL_DIR = Path(os.getenv("MODEL_DIR", ROOT / "models"))
DATA_DIR = Path(os.getenv("DATA_DIR", ROOT / "data"))
DATA_DIR.mkdir(parents=True, exist_ok=True)
(DATA_DIR / "tts").mkdir(exist_ok=True)
(DATA_DIR / "recordings").mkdir(exist_ok=True)
