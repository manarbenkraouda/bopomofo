"use client";

import { useState } from "react";

// The standard Dachen (大千) layout: the symbols run down the keyboard columns in chart order.
const ROWS: [string, string][][] = [
  [
    ["1", "ㄅ"],
    ["2", "ㄉ"],
    ["3", "ˇ"],
    ["4", "ˋ"],
    ["5", "ㄓ"],
    ["6", "ˊ"],
    ["7", "˙"],
    ["8", "ㄚ"],
    ["9", "ㄞ"],
    ["0", "ㄢ"],
    ["-", "ㄦ"],
  ],
  [
    ["q", "ㄆ"],
    ["w", "ㄊ"],
    ["e", "ㄍ"],
    ["r", "ㄐ"],
    ["t", "ㄔ"],
    ["y", "ㄗ"],
    ["u", "ㄧ"],
    ["i", "ㄛ"],
    ["o", "ㄟ"],
    ["p", "ㄣ"],
  ],
  [
    ["a", "ㄇ"],
    ["s", "ㄋ"],
    ["d", "ㄎ"],
    ["f", "ㄑ"],
    ["g", "ㄕ"],
    ["h", "ㄘ"],
    ["j", "ㄨ"],
    ["k", "ㄜ"],
    ["l", "ㄠ"],
    [";", "ㄤ"],
  ],
  [
    ["z", "ㄈ"],
    ["x", "ㄌ"],
    ["c", "ㄏ"],
    ["v", "ㄒ"],
    ["b", "ㄖ"],
    ["n", "ㄙ"],
    ["m", "ㄩ"],
    [",", "ㄝ"],
    [".", "ㄡ"],
    ["/", "ㄥ"],
  ],
];
const DACHEN: Record<string, string> = Object.fromEntries(ROWS.flat());
const NIHAO = ["s", "u", "3", "c", "l", "3"];

/** The keyboard map. Focus it and type, or press its keys, to see which symbol each key writes. */
export function KeyMap() {
  const [typed, setTyped] = useState<string[]>(NIHAO);
  const [down, setDown] = useState<string | null>(null);
  const add = (k: string) => setTyped((t) => [...t, k].slice(-24));

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const k = e.key.toLowerCase();
    if (k === "backspace") {
      e.preventDefault();
      setTyped((t) => t.slice(0, -1));
    } else if (k === " " || k in DACHEN) {
      e.preventDefault();
      setDown(k);
      add(k);
    }
  };

  const symbols = typed.map((k) => (k === " " ? " " : DACHEN[k])).join("");
  return (
    <div className="kb-wrap">
      <div
        className="kb"
        tabIndex={0}
        role="group"
        aria-label="Zhuyin keyboard map. Focus it and type to see the symbols."
        onKeyDown={onKeyDown}
        onKeyUp={() => setDown(null)}
        onBlur={() => setDown(null)}
      >
        {ROWS.map((row, i) => (
          <div key={i} className={"kb-row r" + i}>
            {row.map(([k, z]) => (
              <button
                key={k}
                type="button"
                tabIndex={-1}
                className={"key" + (down === k ? " on" : "")}
                onPointerDown={() => setDown(k)}
                onPointerUp={() => setDown(null)}
                onPointerLeave={() => setDown(null)}
                onClick={() => add(k)}
                aria-label={"Key " + k + ": " + z}
              >
                <span className="k">{k}</span>
                <span className="z" lang="zh-TW">
                  {z}
                </span>
              </button>
            ))}
          </div>
        ))}
        <div className="kb-row">
          <button
            type="button"
            tabIndex={-1}
            className={"key space" + (down === " " ? " on" : "")}
            onPointerDown={() => setDown(" ")}
            onPointerUp={() => setDown(null)}
            onPointerLeave={() => setDown(null)}
            onClick={() => add(" ")}
            aria-label="Space: tone 1"
          >
            <span className="k">space</span>
            <span className="z">tone 1</span>
          </button>
        </div>
      </div>
      <div className="kb-out" aria-live="polite">
        <p>
          <span className="small">Keys</span> <kbd>{typed.join("").replace(/ /g, "␣") || "…"}</kbd>
        </p>
        <p lang="zh-TW" className="out">
          {symbols || "…"}
        </p>
        <div className="acts">
          <button type="button" className="link-plain" onClick={() => setTyped(NIHAO)}>
            Type 你好 for me
          </button>
          <button type="button" className="link-plain" onClick={() => setTyped([])}>
            Clear
          </button>
        </div>
      </div>
    </div>
  );
}
