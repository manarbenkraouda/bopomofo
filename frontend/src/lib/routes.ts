// Every screen of the app, with its "G then key" shortcut and the text shown in the top bar and the help overlay.
export type Area = "home" | "progress" | "practice" | "study" | "me";
export type RouteInfo = {
  href: string;
  label: string;
  icon: string;
  key: string;
  area: Area;
  desc: string;
  about: string;
};

export const ROUTES: RouteInfo[] = [
  {
    href: "/",
    label: "Home",
    icon: "⌂",
    key: "KeyH",
    area: "home",
    desc: "Your level, Bobo's next step, and your exercises",
    about:
      "Press Enter for Bobo's next step, or pick an open exercise with its number key. New exercises open when you reach a new level.",
  },
  {
    href: "/levels",
    label: "Levels",
    icon: "級",
    key: "KeyV",
    area: "progress",
    desc: "Your path: levels, goals, and what opens next",
    about:
      "The app opens step by step. Level 1 is the alphabet: say each symbol and recognize it, and hear the four tones. Each level has goals; reach them and the next level opens new exercises. An item counts as known (★★★) only when you answer it right and fast enough over several tests (from level 3, also on more than one day), so luck or guessing does not count. Unlocks are permanent. To practice freely, open more levels in Settings. When a known item slips, Bobo adds a short review to your plan.",
  },
  {
    href: "/coach",
    label: "Bobo",
    icon: "熊",
    key: "KeyC",
    area: "progress",
    desc: "Your coach: next steps, chosen from your stats",
    about:
      "Bobo (波波), the Formosan black bear, is your coach. Bobo reads all your stats and writes a plan: exact drills, with the numbers that justify each one. A step ends when you reach its target, never on a date. Every 10 answers in a step, Bobo checks them and can narrow, extend, or end the step. When one step is left, the next plan is prepared, so you never wait. Enter starts the step, 1-7 start a step by number, H / E / N skip it as too hard, too easy, or not now, and P builds a new plan now.",
  },
  {
    href: "/stats",
    label: "Stats",
    icon: "績",
    key: "KeyT",
    area: "progress",
    desc: "Daily challenges, weak spots, confusions, records",
    about:
      "Everything you practiced, down to each tone and stroke: what you said, heard, or wrote instead of the right answer. Pick a weak spot and press Enter to train only that. The daily challenges come from your weakest skills before today.",
  },
  {
    href: "/reading",
    label: "Reading",
    icon: "讀",
    key: "KeyR",
    area: "practice",
    desc: "Say each symbol out loud",
    about:
      "Random symbols, one at a time, without end. Say each one out loud. When you say it right, the next one comes up. After you hear the answer, you still have to say the symbol to move on. A card counts as known only when you say it right the first time, without the answer. The answer recordings come from the Ministry of Education handbook.",
  },
  {
    href: "/listening",
    label: "Listening",
    icon: "聽",
    key: "KeyL",
    area: "practice",
    desc: "Name the tone, or pick the matching Bopomofo",
    about:
      "Train your ear: name the tone, or pick the Bopomofo that matches the sound. After an answer, compare the tones of the same syllable.",
  },
  {
    href: "/dictation",
    label: "Dictation",
    icon: "默",
    key: "KeyD",
    area: "practice",
    desc: "Hear a symbol, write it",
    about:
      "Random symbols without end. Listen, then write the symbol. When your strokes are right, the next one comes up. Stroke order counts. After Show strokes, you still write the symbol yourself, and the card counts as not known yet.",
  },
  {
    href: "/speaking",
    label: "Speaking",
    icon: "說",
    key: "KeyS",
    area: "practice",
    desc: "Record yourself, get a check of every syllable",
    about:
      "Record yourself. The app checks every syllable: initial, final, and tone (including tone changes such as 你好 → ㄋㄧˊ ㄏㄠˇ).",
  },
  {
    href: "/writing",
    label: "Writing",
    icon: "寫",
    key: "KeyW",
    area: "practice",
    desc: "Write syllables and words, stroke by stroke",
    about:
      "Hear a sound, write the Bopomofo by hand, and get a correction for every stroke: order, direction, shape, and missing or extra strokes.",
  },
  {
    href: "/recognize",
    label: "Recognize",
    icon: "認",
    key: "KeyI",
    area: "practice",
    desc: "See a symbol, type its pinyin, silently",
    about:
      "Random symbols without end, with no microphone. The symbol pronunciation plays after a correct answer. Type the pinyin of each symbol: b or bo for ㄅ, zh for ㄓ, v (or ü) for ㄩ, eh (or ê) for ㄝ. Enter checks, Space shows the answer, and → skips a symbol after the answer is shown. A wrong answer shows which symbol you typed instead. A card counts as known only when it is right the first time, without the answer. Esc leaves the answer field, so the app keys work again; Enter goes back to it.",
  },
  {
    href: "/numbers",
    label: "Numbers",
    icon: "數",
    key: "KeyN",
    area: "practice",
    desc: "Hear numbers and say them out loud",
    about:
      "Numbers from 0 to 99,999,999, as they are said in Taiwan (兩百, 一萬零五). The sizes open one at a time: 0-10 first, then 11-99, the hundreds, the thousands, and 萬. The next size opens when you get the newest one right almost every time. Click a size, or press B, to practice only that size. Listen: hear a number and pick its digits with 1-4. A wrong pick plays the number again; after 2 wrong picks, or N, the answer shows. Speak: see a number in digits, hold R (or the button), say it, and let go. A miss shows which syllables were wrong, not the answer. After 3 misses in a row, you can type what you said in Bopomofo or Pinyin, in case the microphone heard it wrong. Space plays the number. In Speak, hearing it first counts as help. A right answer goes to the next number by itself.",
  },
  {
    href: "/characters",
    label: "Characters",
    icon: "字",
    key: "KeyK",
    area: "practice",
    desc: "Read traditional characters for meaning",
    about:
      "Traditional characters and words from the course, mixed with words of your own sentences. See a character and pick its meaning with 1-4 (or A S D F). The wrong choices are look-alikes first (你, 妳, 您). After the answer, the app shows the Bopomofo and plays the word. Space plays it again, Enter or N goes on.",
  },
  {
    href: "/symbols",
    label: "Symbols",
    icon: "ㄅ",
    key: "KeyB",
    area: "study",
    desc: "The 37 symbols and 5 tones",
    about: "Every symbol with its official MOE recording and its stroke order.",
  },
  {
    href: "/sentences",
    label: "Sentences",
    icon: "句",
    key: "KeyE",
    area: "study",
    desc: "Generate sentences on any topic",
    about:
      "Generate short Taiwan Mandarin sentences on any topic. Each one gets Bopomofo, audio, a translation, and word glosses. Click a character to hear it.",
  },
  {
    href: "/profile",
    label: "Profile",
    icon: "我",
    key: "KeyP",
    area: "me",
    desc: "Facts about you for generated sentences",
    about:
      "Write facts about yourself in English. Generated sentences use them, so an introduction talks about your real name, job, city and family. Leave a field empty to skip it.",
  },
  {
    href: "/settings",
    label: "Settings",
    icon: "設",
    key: "Comma",
    area: "me",
    desc: "Voice, theme, daily goal, sounds",
    about: "Choose the voice, the theme, your daily goal, and the sound effects. All voices run on this computer.",
  },
];

export const routeFor = (path: string) =>
  ROUTES.find((r) => (r.href === "/" ? path === "/" : path.startsWith(r.href))) ?? ROUTES[0];
export const MODES = ROUTES.filter((r) => r.area === "practice" || r.area === "study");
export const LAST_KEY = "zhuyin.last";
