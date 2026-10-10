# UI layer

- **Route**: add an entry to ROUTES in frontend/src/lib/routes.ts: href, label, icon, key ("G then key"; check that no other
  route uses the key), area, desc, and about (the help overlay text, which lists the keys). The area "practice" adds the mode
  to the Rail and to the Home tiles with a digit key. Dashboard DIGITS has 9 keys for MODES (practice + study), so a tenth mode
  needs a new key scheme. Practice routes are lesson screens on a phone: a ✕ header, no BottomNav, and the coach StepBanner.
- **Page**: app/<route>/page.tsx with a metadata title. Wrap the component in Suspense when it uses useSearchParams.
- **Keys** (lib/hotkeys.ts, useHotkeys(name, keys, {order})): every action has a key, and the label shows in the bottom
  controls bar and the help overlay. Conventions: choices 1-4 or A S D F (ANSWER_KEYS), secondary choices Q W E R, Enter to
  check or go next, Space to play, [ ] to cycle modes, X to clear the focus, N to skip. Do not use the global keys at screen
  level: G, M, ?, Ctrl+K, Alt+Enter, and the StepBanner keys Shift+Enter and Shift+U.
- **Phone**: ActionBar for the main buttons (ab-primary is the full-width main button; the tone shows ok, close, or bad
  feedback), .tile cards, .m-sheet bottom sheets for lists, 16 px inputs, at most 6 BottomNav TABS. Check the layout at 390 px.
- **Gamification**: playSfx (right, close, wrong) and the components in components/quiz. The HUD and the combo update
  through api.event.
- **Focus params**: read them with useFocus (tones, syms, items, ids). Add new params there, in useClearHref, and in the
  StepBanner FOCUS_KEYS. FocusChip shows the focus and clears it with X. Stats Train links and coach steps use these params.
- **Data**: static content goes in frontend/public/data/*.json (loadData in lib/zhuyin.ts). The coach reads the same file
  for candidates (see coach.SYLLABLES_FILE), so keep one source that both sides read.
- **Audio**: ttsUrl for playback; tts.pregenerate for new texts that will be played soon.

