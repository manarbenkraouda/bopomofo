"use client";
import { setTheme, THEME_KEY, usePref } from "@/lib/prefs";
import { GOAL_KEY_NAME, setGoalMinutes } from "@/lib/session";
import { setSfxEnabled, SFX_KEY } from "@/lib/sfx";

const GOALS = [10, 15, 20, 30, 45, 60];

export function Preferences() {
  const theme = usePref(THEME_KEY, "dark");
  const goal = Number(usePref(GOAL_KEY_NAME, "20"));
  const sfx = usePref(SFX_KEY, "on") !== "off";
  return (
    <div className="card flex flex-col gap-5 p-5">
      <h2 className="font-semibold">App</h2>
      <Row title="Theme" hint="Dark is easier on the eyes for long sessions.">
        {(["dark", "light"] as const).map((t) => <button key={t} className="chip" data-active={theme === t} onClick={() => setTheme(t)}>{t === "dark" ? "Dark" : "Light (paper)"}</button>)}
      </Row>
      <Row title="Daily goal" hint="Minutes of active practice. The clock stops after one minute without a key, a click, or an answer.">
        {GOALS.map((m) => <button key={m} className="chip" data-active={goal === m} onClick={() => setGoalMinutes(m)}>{m} min</button>)}
      </Row>
      <Row title="Sound effects" hint="Chimes for right and wrong answers. Press M anywhere to switch.">
        <button className="chip" data-active={sfx} onClick={() => setSfxEnabled(true)}>On</button>
        <button className="chip" data-active={!sfx} onClick={() => setSfxEnabled(false)}>Off</button>
      </Row>
    </div>
  );
}

function Row({ title, hint, children }: { title: string; hint: string; children: React.ReactNode }) {
  return (
    <div className="grid items-center gap-2 md:grid-cols-[200px_1fr]">
      <div>
        <div className="text-sm font-medium">{title}</div>
        <div className="text-xs text-muted">{hint}</div>
      </div>
      <div className="flex flex-wrap gap-2">{children}</div>
    </div>
  );
}
