# Bopomofo promo: storyboard v2

30 s, 1080x1920 (9:16), 30 fps, MP4 (H.264, yuv420p, AAC). Platforms: X, Instagram Reels, TikTok.
Focus: every feature, with Bobo the AI coach at the centre: stats and smart feedback.

## Brand

- Mascot: Bobo (波波, ㄅㄛ ㄅㄛ), a cute Formosan black bear. The white V collar must stay visible in every frame where Bobo appears. Never crop the chest, never cover it with text or UI.
- Bobo is near black: always place him on a light disc or glow (cream #fffaf1 to #f1e6d6), never directly on a dark background.
- Light palette (main): bg #f5f1e8, card #fffdf8, ink #24201b, muted #7b7367, line #e3dbcc, accent red #b5452f, accent soft #f3dcd3, ok #2f9466, gold #d39418, bad #d23f3f.
- Dark palette (UI accents only): bg #141218, card #1d1a22, ink #f2ece2, accent #e5643f.
- Tone colours: tone 1 #2f9466, tone 2 #d39418, tone 3 #3b82c4, tone 4 #b5452f, neutral #7b7367.
- Fonts: Geist or Inter for Latin; Microsoft JhengHei (C:/Windows/Fonts/msjh.ttc, msjhbd.ttc) or Noto Sans TC for Hanzi and Zhuyin.
- The V shape of the collar is the graphic motif: wipes, frames, and the end card mark.

## Safe zone (TikTok and Reels)

All text and key UI stay in x 80-940, y 240-1420. Nothing readable in the top 240 px, the bottom 500 px (captions, CTA bar), or the right 140 px (like and comment rail). Backgrounds, Bobo's feet, and decoration can go outside.

## Sound

Sound on: light, warm, upbeat bed (about 100-110 BPM), a soft pop on each text hit, a key click on typing, a soft chime on a right answer, a low boop on a wrong one. No voiceover. Free local sources only (synthesized or made in code). No paid audio.
Sound off: every message is in on-screen text. No information exists only in sound.

## Shots

| # | Time | On-screen text | Visual | Bobo |
|---|---|---|---|---|
| 1 | 0.0-2.5 | "Learning Mandarin?" then "Meet your coach." | Bobo pops up from below on a cream glow disc; name tag "Bobo 波波 ㄅㄛ ㄅㄛ". A ㄅ tile spins in. | welcome (wave). Krea clip if one exists, else code animation: squash-and-stretch pop, gentle bob, small rotation about the feet. |
| 2 | 2.5-5.0 | "Bobo watches every answer." Small: "read · listen · speak · write · type" | Five practice tiles pop in a row: 讀 Read, 聽 Listen, 說 Speak, 寫 Write, 認 Recognize. An answers counter ticks 0 to 1,284. | face avatar (bobo-face) in a corner disc |
| 3 | 5.0-9.0 | "Feedback on every tone." | Speaking card: 你好 with ㄋㄧˇ ㄏㄠˇ. A pitch line draws over the target tone shapes. Result chip: "You read the written tone. 你 is said tone 2 here: the 3-3 rule." Check mark on 好. | story-tones (conducts the tone curves), small, left |
| 4 | 9.0-11.5 | "...and every stroke." | Writing card: ㄅ drawn stroke by stroke; stroke 2 turns pink with the chip "Stroke 2: wrong direction"; then the corrected ㄅ draws in green. | writing |
| 5 | 11.5-15.5 | "Bobo finds your weak spots." | Stats screen: a confusion row "ㄓ taken for ㄗ: 6x", a bar "Tone 4 by ear: 78.6% on 28", a chip "often heard as tone 2". Bars grow; the weakest one pulses red. | investigate (magnifying glass). Code: lean in (scale 1 to 1.06). |
| 6 | 15.5-20.5 | "Then writes your plan." Small: "exact drills, with the numbers behind them" | Coach plan card with 3 steps sliding in: 1 "Tone 4 by ear: target 90%" (78.6% on 28), 2 "ㄓ vs ㄗ: type it" (6 mix-ups), 3 "3-3 rule: say it aloud". A "How do we know?" chip opens one evidence card with a small chart. | story-stats (presents the chart) |
| 7 | 20.5-23.5 | "Every 10 answers, Bobo adjusts." | Step 1 progress bar fills in 10 ticks; checkpoint toast: "Tone 4 is up to 86%. Narrowing to 4 vs 2." | thinking |
| 8 | 23.5-26.5 | "Keyboard first. No guessing." Small: "★★★ only when it's right, fast, and on 2 days" | Recognize card: symbol ㄓ, keys z and h type in, Enter, check mark, "1.4 s". Three stars fill. A "Level 2 open" badge pops. | story-plan (path) |
| 9 | 26.5-30.0 | "Learn Bopomofo with Bobo." CTA button "bopomofo.app". Small: "Your AI Mandarin coach" | V-shaped wipe to the cream end card; the V mark sits behind Bobo; ㄅㄆㄇㄈ float softly. Hold the last 1.5 s still and readable. | celebrate (jump with confetti). Code: hop and land, plus moving confetti particles. |

## UI moments

Rebuild the app screens as clean motion graphics in the app style (rounded cards, radius 16-20 px, soft shadows, cream cards on the light background). Use real app copy from README.md: coach steps, "How do we know?", "78.6% on 28, often taken for tone 2", the tone rules (3-3, 不, 一), stars ★★★, keys (Enter, Space). The numbers are demo data.

## Rules for both versions

- Bobo appears in shots 1 and 3-9; every Bobo frame keeps the white V collar fully visible.
- Each text line stays on screen for at least 1.2 s; at most 7 words per headline.
- Headline 84-110 px bold, secondary 40-48 px, high contrast (ink on cream, or cream on red).
- No provider, model, price, or debug text on screen.

## Assets

- promo/assets/bobo/*.png: every Bobo pose with transparency (welcome, celebrate, investigate, thinking, writing, face, story-tones, story-symbol, story-sound, story-mixup, story-stats, story-plan, and more).
- promo/assets/frames/start-*.png: 1080x1920 cream start frames (welcome, investigate, celebrate).
- promo/assets/clips/: Krea clips, only if they are made (see the Krea note in the final report).
- frontend/public/audio/syllables/*.mp3: official syllable recordings from the app (optional sound).

