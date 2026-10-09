import os
from pathlib import Path

from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parent.parent
load_dotenv(ROOT / ".env")

OPENROUTER_API_KEY = os.getenv("OPENROUTER_API_KEY", "")
OPENROUTER_MODEL = os.getenv("OPENROUTER_MODEL", "deepseek/deepseek-v4.1-flash")
MODEL_DIR = Path(os.getenv("MODEL_DIR", ROOT / "models"))
DATA_DIR = Path(os.getenv("DATA_DIR", ROOT / "data"))
TTS_VOICE = os.getenv("TTS_VOICE", "zh-TW-HsiaoChenNeural")
DATA_DIR.mkdir(parents=True, exist_ok=True)
(DATA_DIR / "tts").mkdir(exist_ok=True)
(DATA_DIR / "recordings").mkdir(exist_ok=True)
