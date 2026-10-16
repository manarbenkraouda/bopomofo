"""Create an ARM-friendly dynamic-int8 ONNX model for CPU inference."""

from __future__ import annotations

import argparse
from pathlib import Path

from onnxruntime.quantization import QuantType, quantize_dynamic

MODELS = Path(__file__).resolve().parents[1] / "models"


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, default=MODELS / "wav2vec2-cmn-phonetic.onnx")
    parser.add_argument("--output", type=Path, default=MODELS / "wav2vec2-cmn-phonetic.int8.onnx")
    args = parser.parse_args()
    if not args.source.is_file():
        parser.error(f"model file does not exist: {args.source}")
    args.output.parent.mkdir(parents=True, exist_ok=True)
    quantize_dynamic(
        model_input=str(args.source),
        model_output=str(args.output),
        per_channel=True,
        weight_type=QuantType.QInt8,
        use_external_data_format=True,
    )
    print(f"Quantized model written to {args.output} ({args.output.stat().st_size // 2**20} MB graph file)")


if __name__ == "__main__":
    main()
