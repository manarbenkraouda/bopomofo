// The landing page shows these answers, and the FAQPage structured data repeats them word for word.

export const FAQ: { q: string; a: string; tone: string; ink: string }[] = [
  {
    q: "Do I need any Chinese?",
    a: "No. Level 1 starts with the first symbol. If you already read some, the placement test puts you higher.",
    tone: "f-deep",
    ink: "#f2ece2",
  },
  {
    q: "Why not just pinyin?",
    a: "Taiwan teaches reading with bopomofo, and each symbol is one sound. You still type pinyin in the Recognize drill, because your keyboard already has those letters.",
    tone: "f-paper",
    ink: "#141218",
  },
  {
    q: "Is it free?",
    a: "The code is free under AGPL-3.0. If you run your own copy, you pay for your own OpenRouter use. Hosting the app costs money, and a coffee on Buy Me a Coffee helps to pay for it. The speech model is CC BY-NC 4.0, so use it for noncommercial work only.",
    tone: "f-night",
    ink: "#f2ece2",
  },
  {
    q: "Who hears my voice?",
    a: "Speech recognition and the voice run on the bopomofo server's CPU, with ONNX models, so no outside speech service hears you. Sign-in uses Clerk, and personal sentences use OpenRouter.",
    tone: "f-deep",
    ink: "#f2ece2",
  },
  {
    q: "Can I run my own copy?",
    a: "Yes. Windows on ARM64 is tested. The packages for x64 and macOS install, but nobody has run them on real hardware yet.",
    tone: "f-paper",
    ink: "#141218",
  },
];
