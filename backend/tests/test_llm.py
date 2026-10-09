"""Live OpenRouter test (needs the key in backend/.env and network)."""
import asyncio

from app import llm


def test_generate_sentences():
    sents, usage = asyncio.run(llm.generate("ordering food at a night market", "beginner", 3))
    print(sents, usage)
    assert len(sents) == 3
    for s in sents:
        assert s["hanzi"] and s["english"]
