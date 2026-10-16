"""The HTTP routes of the API, one module per area. main.py mounts every router under /api.

Each route needs a signed-in user (auth.require_user, set on the app), except the paths in auth.PUBLIC.
A route that saves an answer refreshes the coach and returns its level notices (see notices.py).
"""

from . import coach, demo, learner, levels, progress, sentences, speech, stats, system, text, tts

ROUTERS = [
    system.router,
    text.router,
    learner.router,
    sentences.router,
    tts.router,
    speech.router,
    progress.router,
    stats.router,
    coach.router,
    levels.router,
    demo.router,
]
