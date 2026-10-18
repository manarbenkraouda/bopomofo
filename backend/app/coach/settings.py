"""What the coach knows about the practice modes, and the numbers and switches that shape a plan.

Read the switches LIVE, ALPHABET_GATE, and RULES_GATE as settings.LIVE (never import them by name),
so a test that changes them changes them for every module."""

from __future__ import annotations

from ..config import ROOT
from ..levels import LEARN_REPS as LEARN_REPS
from ..zhuyin import BOPOMOFO as BOPOMOFO, SYMS as SYMS

PLAN_MINUTES = 25
STALE_UNITS = 400  # after this many new answers, the plan may no longer match the stats
CHECK_EVERY = 10  # answers in a step between two checkpoint calls
MAX_SENTENCES = 6
TYPES = {
    "speak_sentences": "speaking",
    "speak_sounds": "speaking",
    "listen_tones": "listening",
    "listen_sounds": "listening",
    "read_symbols": "reading",
    "recognize_symbols": "recognize",
    "write_symbols": "dictation",
    "write_syllables": "writing",
    "tone_rules": "listening",
    "numbers": "numbers",
    "characters": "characters",
}
DECK_TYPES = {"listen_tones", "listen_sounds", "speak_sounds", "write_syllables"}
DEFAULT_TARGET = {
    "speak_sounds": 10,
    "listen_tones": 20,
    "listen_sounds": 15,
    "read_symbols": 10,
    "recognize_symbols": 15,
    "write_symbols": 10,
    "write_syllables": 10,
    "tone_rules": 12,
    "numbers": 12,
    "characters": 12,
}
SYMBOL_TYPES = {"read_symbols", "recognize_symbols", "write_symbols"}  # one symbol per answer, focus = single symbols
SYLLABLES_FILE = ROOT.parent / "frontend" / "public" / "data" / "syllables.json"
LIVE = True  # False in tests: no background threads and no model calls

# What each practice mode measures. The analysts get this with the numbers, so a tone quiz is never read as symbol knowledge.
MEASURES = {
    "reading": ("see a Bopomofo symbol and say its name (alphabet: symbol to sound)", True),
    "recognize": (
        "see a Bopomofo symbol and type its sound in pinyin, silently (alphabet: symbol to sound, no speaking)",
        True,
    ),
    "listening/tone": ("hear a syllable and name its tone; no Bopomofo needed", False),
    "listening/zhuyin": ("hear a syllable and pick its Bopomofo spelling; needs the alphabet", True),
    "listening/rule": (
        "see a short word in Bopomofo and pick the tone that is said for one syllable after the tone rules (3-3, 不, 一);"
        " measures rule knowledge, not hearing; needs the alphabet",
        True,
    ),
    "dictation": ("hear a symbol name and write the symbol by hand (alphabet: sound to symbol)", True),
    "writing": ("hear a syllable or word and write its Bopomofo by hand, with the tone mark; needs the alphabet", True),
    "speaking": (
        "say a sentence, a word from the learner's sentences, or a syllable; the speech model checks each initial, final,"
        " and tone; no Bopomofo needed",
        False,
    ),
    "numbers/listen": (
        "hear a number in Mandarin (0 to 99 999 999) and pick its digits among 4; measures number comprehension by ear;"
        " no Bopomofo needed",
        False,
    ),
    "numbers/speak": (
        "see a number in digits and say it out loud; the speech model checks every syllable, so a wrong number shows which"
        " characters were said wrong; no Bopomofo needed",
        False,
    ),
    "characters": (
        "see a traditional character or word (course words and words of the learner's sentences) and pick its English"
        " meaning among 4; the wrong choices are look-alikes first (你/妳/您, 他/她/它); measures reading characters;"
        " no Bopomofo needed",
        False,
    ),
}
# The alphabet comes first: below this many known symbols, every plan starts with the next symbols to learn,
# and drills that show Bopomofo wait. This is a rule of the app, not a model decision.
ALPHABET_GATE = 30
RULES_GATE = True  # the tone rules (3-3, 不, 一) must be known before sentence steps
NEEDS_ALPHABET = {"listen_sounds", "write_syllables"}
ALPHABET_STEPS = {"read_symbols", "recognize_symbols", "write_symbols"}
# Coach notes the learner sees: checkpoint notes and the learner line of a debrief. The rest ("debrief", "skip") is for the next plan.
VISIBLE_NOTES = "(kind LIKE 'checkpoint:%' OR kind='debrief:learner')"
# A new symbol is learned by repetition first: the app plays it and shows its name or strokes, and the learner repeats it.
# Recall tests (name it from memory) start only after LEARN_REPS right repetitions of the symbol (imported from levels).
MAX_LEARNING = 8  # no new symbols while this many symbols are seen but not known yet
# The tone rules (3-3, 不, 一) come before sentences: the written Bopomofo shows the dictionary tone, not the tone said.
# While a rule is not known (levels: ★★★ in the rule quiz or the rule phrases), every plan starts with rule steps and has no
# sentence steps. This is a rule of the app, not a model decision.
RULE_STEPS_BLOCK = {"speak_sentences"}
