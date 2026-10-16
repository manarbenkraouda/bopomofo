"""The coach plan story and its public interface.

facts builds the evidence; catalog defines allowed blocks; validation checks output;
fallback builds the fixed story; prompts keeps the exact model text; pipeline saves results.
The model refers to named facts. It cannot supply the learner's numbers itself.
"""

from .catalog import (
    CATALOG as CATALOG,
    MAX_BLOCKS as MAX_BLOCKS,
    MAX_CARDS as MAX_CARDS,
    MAX_CHARTS as MAX_CHARTS,
    MIN_CARDS as MIN_CARDS,
    MOODS as MOODS,
    PLACEHOLDER as PLACEHOLDER,
    SYM_RE as SYM_RE,
    TONE_NAMES as TONE_NAMES,
    catalog_text as catalog_text,
)
from .facts import (
    MODE_LABEL as MODE_LABEL,
    TONE as TONE,
    UNIT_WORD as UNIT_WORD,
    bare as bare,
    fmt as fmt,
    story_context as story_context,
    story_facts as story_facts,
    story_stats as story_stats,
)
from .fallback import (
    rules_cards as rules_cards,
    template_headline as template_headline,
)
from .pipeline import (
    get as get,
    make as make,
    write as write,
)
from .prompts import (
    CARD as CARD,
    HEADLINE as HEADLINE,
    HEADLINE_ALPHABET as HEADLINE_ALPHABET,
    OUTLINE as OUTLINE,
    STORY_COMMON as STORY_COMMON,
)
from .validation import (
    check_headline as check_headline,
    check_prop as check_prop,
    check_props as check_props,
    check_text as check_text,
    clean_card as clean_card,
    finish as finish,
)
