"""Coach: a pipeline of many small model decisions turns the practice stats into the next plan.

How a plan is built (every call is logged in coach_calls, with its model, time, and cost):
1. Analysts, in parallel: one call per domain (listening tones, speaking tones, sounds, symbols, sentences) finds the gaps,
   with the numbers as evidence. One more call sets the size of the plan from the pace and the previous plans.
2. Planner: turns the findings into 3-7 steps. A step is one practice mode with an exact focus and a target.
3. Details, one call per step: a writer makes new sentences for the exact tones, tone pairs, or sounds (the Bopomofo analyzer
   checks each sentence; rejected ones go back to the writer with the reason), and a picker chooses the exact syllables of a deck.
4. Reviewer and milestones, in parallel: keep, drop, or change each step; set 3-5 long goals.
During practice:
- Answers given inside a step carry the step id. Only those count for the step.
- Every CHECK_EVERY answers in a step, a checkpoint call reads them and continues, extends, narrows, eases, or ends the step.
- When a step ends, a debrief call compares it with the 30 days before the plan. The notes feed the next plan.
- A plan ends by practice, never by date. When one step is left, the next plan is built in the background, so it is ready at once.
If the model fails, a plan is built by rules from the weak spots.

Modules, from the base up:
- settings: the step types, what each practice mode measures, the numbers, and the switches (LIVE and the two gates).
- validate, store, jobs: model-output validators, reads of the coach tables, and the background job of each user.
- decks, gates, progress: syllable decks, the alphabet and tone rule gates, and progress inside a step or a milestone.
- digest, prompts, model, cleaning: the stats summary, the task prompts, one logged model call, and checks on its output.
- pipeline, fallback, planner: the model pipeline, the plan built by rules, and the build that saves a plan.
- practice, views: checkpoints, debriefs, and refresh during practice, and the state that the API sends to the app.

The names below are the public API. A test that replaces a function or a switch patches the module that owns it
(for example coach.planner.start or coach.settings.LIVE), because the modules call each other through those names.
"""

from .gates import alphabet_status
from .planner import build, start, start_story
from .practice import refresh, skip
from .views import state, step_state

__all__ = ["alphabet_status", "build", "refresh", "skip", "start", "start_story", "state", "step_state"]
