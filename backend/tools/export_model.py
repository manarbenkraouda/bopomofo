"""Export Chuatury/wav2vec2-mms-1b-cmn-phonetic to ONNX (one external data file) for the backend.

Run once, in a separate environment with requirements-export.txt:
    uv venv -p cpython-3.12-windows-aarch64 .venv-export
    uv pip install -p .venv-export\Scripts\python.exe -r tools\requirements-export.txt
    .venv-export\Scripts\python tools\export_model.py
License of the model: CC-BY-NC-4.0 (personal, non-commercial use).
"""
import json
import os
import shutil
from pathlib import Path

import onnx
import torch
from huggingface_hub import hf_hub_download
from transformers import Wav2Vec2ForCTC

REPO = "Chuatury/wav2vec2-mms-1b-cmn-phonetic"
OUT = Path(__file__).resolve().parents[1] / "models"
TMP = OUT / "_export"


def main():
    OUT.mkdir(exist_ok=True)
    TMP.mkdir(exist_ok=True)
    m = Wav2Vec2ForCTC.from_pretrained(REPO).eval()
    torch.onnx.export(m, (torch.randn(1, 32000),), str(TMP / "model.onnx"), input_names=["input_values"], output_names=["logits"],
                      dynamic_axes={"input_values": {1: "n"}, "logits": {1: "t"}}, opset_version=17, dynamo=False, external_data=True)
    model = onnx.load(str(TMP / "model.onnx"))
    for f in ("wav2vec2-cmn-phonetic.onnx", "wav2vec2-cmn-phonetic.onnx.data"):
        (OUT / f).unlink(missing_ok=True)
    onnx.save_model(model, str(OUT / "wav2vec2-cmn-phonetic.onnx"), save_as_external_data=True, all_tensors_to_one_file=True, location="wav2vec2-cmn-phonetic.onnx.data")
    v = json.load(open(hf_hub_download(REPO, "vocab.json"), encoding="utf-8"))
    v = next(iter(v.values())) if isinstance(next(iter(v.values())), dict) else v
    (OUT / "vocab.json").write_text(json.dumps(v, ensure_ascii=False), encoding="utf-8")
    shutil.rmtree(TMP)
    print("Model exported to", OUT, os.path.getsize(OUT / "wav2vec2-cmn-phonetic.onnx.data") // 2**20, "MB")


if __name__ == "__main__":
    main()
