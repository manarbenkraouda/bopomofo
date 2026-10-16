# License and third-party terms

## Source code

The bopomofo source code is licensed under the GNU Affero General Public License, version 3 only (`AGPL-3.0-only`). The full text is in [LICENSE](../LICENSE). Copyright 2026 Manar Benkraouda.

- You can use, study, change, and share the code.
- If you share a changed copy, or run a changed copy as a network service for other people, you must offer its complete source code under the same license.
- The AGPL covers the code in this repository. It does not change the terms of the models, data, and media in the tables below. Each row states its own terms.

## Models

Git does not track model weights. The setup scripts download them.

| Model             | Source                                                                                                        | Terms                                               | Release status                                                                                              |
| ----------------- | ------------------------------------------------------------------------------------------------------------- | --------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| Speech recognizer | [Chuatury/wav2vec2-mms-1b-cmn-phonetic](https://huggingface.co/Chuatury/wav2vec2-mms-1b-cmn-phonetic)         | CC-BY-NC-4.0 (model card)                           | Noncommercial use only. A commercial deployment must replace the model or get other terms from its authors. |
| Kokoro voices     | [sherpa-onnx `kokoro-multi-lang-v1_1`](https://k2-fsa.github.io/sherpa/onnx/tts/pretrained_models/index.html) | Apache-2.0 (license file in the downloaded package) | OK. Keep the license file with the weights.                                                                 |
| Breeze2 voice     | [MediaTek-Research/Breeze2-VITS-onnx](https://huggingface.co/MediaTek-Research/Breeze2-VITS-onnx)             | The model repository declares no license            | Open. Get terms from MediaTek Research before you redistribute or promote it.                               |

`backend/tools/export_model.py` makes ONNX files from the recognizer. The ONNX files keep the terms of the original model. `backend/models/vocab.json` is the token list of the recognizer and comes from the same model repository.

## Data and media in the repository

| Path                                                                                         | Files  | Origin                                                                                                                                     | Terms                                                                              | Release status                                                                                                                        |
| -------------------------------------------------------------------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `frontend/public/audio/symbols/F*.wav`                                                       | 37     | Symbol recordings of the [MOE 國語注音符號手冊](https://language.moe.gov.tw/001/Upload/files/SITE_CONTENT/M0001/deploy/html_ch/index.html) | CC BY 4.0 for the handbook audio, SVG, and animation files                         | OK with the attribution below.                                                                                                        |
| `frontend/public/data/strokes.json`                                                          | 1      | Stroke outlines and centerlines made from the MOE handbook files                                                                           | CC BY 4.0                                                                          | OK with the attribution below.                                                                                                        |
| `frontend/public/data/moe-table.json`                                                        | 1      | Stroke counts and writing notes copied from the MOE handbook text                                                                          | CC BY-ND 3.0 TW for the handbook site text                                         | OK unchanged, with the attribution below. The short English notes in `frontend/src/lib/zhuyin.ts` translate these notes. Review them. |
| `frontend/public/data/syllables.json`                                                        | 1      | The 99 practice syllables of this project                                                                                                  | AGPL-3.0-only, with the code                                                       | OK.                                                                                                                                   |
| `frontend/public/audio/syllables/*.mp3`                                                      | 99     | Microsoft Edge neural voice output, made with `edge-tts` (`zh-TW-HsiaoChenNeural`)                                                         | Microsoft gives no explicit grant to redistribute this output                      | **Blocker.** Replace with a voice that has clear terms, for example Kokoro.                                                           |
| `backend/tests/fixtures/*.mp3`, `backend/tests/fixtures/male/*.mp3`                          | 4 + 99 | Microsoft Edge neural voice output, made with `edge-tts`                                                                                   | Same as the row above                                                              | **Blocker.** Replace, then run the speech tests and the evaluation tools again.                                                       |
| `promo/remotion/public/audio/ni3.mp3`, `hao3.mp3`                                            | 2      | Microsoft Edge neural voice output                                                                                                         | Same as the row above                                                              | **Blocker.** The Remotion promo renders use them. Replace, then render again.                                                         |
| `promo/remotion/public/audio/*.wav`, `promo/hyperframes/video/assets/audio/promo-mix.wav`    | 9 + 1  | Synthesized by the `make-audio.mjs` scripts of this project, with no samples                                                               | Project media. The owner has not yet chosen its terms.                             | Open: owner decision.                                                                                                                 |
| `promo/hyperframes/video/assets/fonts/*.woff2`                                               | 2      | [Geist and Geist Mono](https://github.com/vercel/geist-font) by Vercel                                                                     | SIL Open Font License 1.1, text in `OFL.txt` next to the fonts                     | OK.                                                                                                                                   |
| `frontend/public/mascot/`, `docs/brand/`, `promo/**/bobo*.png`, `frontend/public/icon-*.png` | 87     | Bobo, the project mascot, made with AI image tools for this project                                                                        | Project brand. The AGPL does not cover it. The owner has not yet chosen its terms. | Open: owner decision. Ask before you reuse the mascot outside this project.                                                           |
| `promo/*.mp4`, `promo/assets/frames/`, `promo/hyperframes/qa*/contact-sheet.png`             | 4 + 5  | Renders of the promo projects                                                                                                              | Project media. The Remotion cuts include the Edge voice clips.                     | Open: replace the voice clips, then choose the terms.                                                                                 |

The Remotion packages have their own license. Some companies need a Remotion company license to render videos. Read the [Remotion license](https://github.com/remotion-dev/remotion/blob/main/LICENSE.md) before you render the promo for a company.

## Required attribution

Keep this notice with any copy of the MOE files:

> Bopomofo symbol recordings, stroke data, and writing notes: 教育部《國語注音符號手冊》, Ministry of Education, Republic of China (Taiwan). Recordings and stroke files: CC BY 4.0. Handbook text: CC BY-ND 3.0 TW.

## Before a public release

- Replace the Edge voice audio in the three blocker rows. Render the Remotion promo again.
- Choose the terms for the mascot and the promo media.
- Get terms for the Breeze2 voice, or leave it out of the public setup.
- Publish from a new public repository with one squashed first commit. The history of this repository has a personal email address in 8 commit authors, absolute local paths in `audit/`, and about 155 MB of old renders and QA frames. A history rewrite needs a force-push, so do not rewrite this repository.
- Remove `audit/` and `SECURITY_AUDIT.md` from the public tree, or rewrite them without local paths and old production facts. Add a `SECURITY.md` that tells people how to report a vulnerability.

The Git history review of 16 October 2026 found no real credential, `.env` file, learner database, or human voice recording. All database URLs in the history use placeholder passwords.
