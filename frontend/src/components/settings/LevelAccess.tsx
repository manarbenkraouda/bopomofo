"use client";
import { useState } from "react";
import { api } from "@/lib/api";
import { useLevels } from "@/lib/levels";

/** Open the exercises of higher levels without their goals. The earned level, the goals, and the stars still follow the answers. */
export function LevelAccess() {
  const { lv, refresh } = useLevels();
  const [note, setNote] = useState("");
  if (!lv) return null;
  const choose = (n: number) => {
    setNote("Saving…");
    api
      .saveSettings({ open_level: n })
      .then(() => {
        refresh();
        setNote("Saved");
      })
      .catch((e: Error) => setNote(e.message));
  };
  const higher = lv.levels.filter((l) => l.n > lv.level);
  return (
    <div id="levels" className="card flex scroll-mt-4 flex-col gap-3 p-5">
      <div>
        <h2 className="font-semibold">Levels</h2>
        <p className="mt-1 text-sm text-muted">
          Open more exercises now, without the level goals. Levels you reached stay open, and your level still goes up
          with the goals. You can go back to your progress at any time.
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <button className="chip" data-active={lv.open_level === lv.level} onClick={() => choose(1)}>
          My progress (level {lv.level})
        </button>
        {higher.map((l) => (
          <button key={l.n} className="chip" data-active={lv.open_level === l.n} onClick={() => choose(l.n)}>
            {l.n === lv.max_level ? "Everything" : "Up to level " + l.n}: {l.title}
          </button>
        ))}
        {note && <span className="text-xs text-muted">{note}</span>}
      </div>
    </div>
  );
}
