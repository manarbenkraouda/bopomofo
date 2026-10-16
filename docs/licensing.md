# Source and third-party terms

The repository does not yet have a project-wide source license. The owner must choose it before the project can be presented as a licensed open source release. This cleanup does not grant new rights or change existing third-party terms.

## Speech and voice models

| Asset             | Source                                                                                                     | Release note                                                                                         |
| ----------------- | ---------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| Speech recognizer | [Chuatury/wav2vec2-mms-1b-cmn-phonetic](https://huggingface.co/Chuatury/wav2vec2-mms-1b-cmn-phonetic)      | The model card declares CC-BY-NC-4.0. Its terms are separate from the application source.            |
| Breeze2 voice     | [MediaTek-Research/Breeze2-VITS-onnx](https://huggingface.co/MediaTek-Research/Breeze2-VITS-onnx)          | Review the model repository and its upstream terms before redistribution.                            |
| Kokoro voices     | [sherpa-onnx pretrained TTS models](https://k2-fsa.github.io/sherpa/onnx/tts/pretrained_models/index.html) | `download_voices.py` selects `kokoro-multi-lang-v1_1`; review the terms of that exact model package. |

`backend/tools/export_model.py` creates derived ONNX artifacts from the recognizer. Export does not replace the original model terms. Downloaded weights are excluded from Git.

## Learning data and media

The repository includes MOE symbol audio, stroke data, syllable audio, fonts, mascot art, and promotional media. Their origin and redistribution terms need a file-level inventory before a public release. A source-code license does not by itself establish rights for those files.

`promo/` contains the video projects and output assets. `audit/` contains historical engineering reports. They remain in the repository during this behavior-preserving cleanup. Review them for private information, size, and release relevance before publication.

## Public release checklist

- Choose a source license and add its exact license text.
- Record the origin, version, and terms of redistributed data and media.
- Keep required third-party notices with distributed artifacts.
- Decide whether promotional renders and historical audits belong in the public source tree or in release assets.
- Check tracked files and Git history for credentials and private learner data.

This document records unresolved release work. It is not a declaration that all assets have one license.
