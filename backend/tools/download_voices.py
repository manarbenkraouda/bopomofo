"""Download the open-source TTS voices into backend/models (about 450 MB). Skips voices that are already there."""
import io
import tarfile
import urllib.request
from pathlib import Path

MODELS = Path(__file__).resolve().parent.parent / "models"
BREEZE = "https://huggingface.co/MediaTek-Research/Breeze2-VITS-onnx/resolve/main/"
KOKORO = "https://github.com/k2-fsa/sherpa-onnx/releases/download/tts-models/kokoro-multi-lang-v1_1.tar.bz2"


def main():
    MODELS.mkdir(exist_ok=True)
    b = MODELS / "breeze2-vits"
    if not (b / "breeze2-vits.onnx").exists():
        b.mkdir(exist_ok=True)
        for f in ("lexicon.txt", "tokens.txt", "breeze2-vits.onnx"):
            print("Downloading Breeze2", f)
            urllib.request.urlretrieve(BREEZE + f, b / f)
    if not (MODELS / "kokoro-multi-lang-v1_1" / "model.onnx").exists():
        print("Downloading Kokoro v1.1 (365 MB)")
        with urllib.request.urlopen(KOKORO) as r:
            tarfile.open(fileobj=io.BytesIO(r.read()), mode="r:bz2").extractall(MODELS, filter="data")
    print("Voices ready.")


if __name__ == "__main__":
    main()
