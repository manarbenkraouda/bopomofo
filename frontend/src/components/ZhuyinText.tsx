"use client";
import type { TextItem } from "@/lib/api";
import { TONE_MARKS } from "@/lib/zhuyin";

export type Annot = "none" | "zhuyin" | "pinyin";

export function ZhuyinColumn({ zhuyin }: { zhuyin: string }) {
  const chars = [...zhuyin];
  const neutral = chars[0] === "˙";
  const tone = chars.find((c) => TONE_MARKS.includes(c) && c !== "˙");
  const syms = chars.filter((c) => !TONE_MARKS.includes(c));
  return (
    <span className="zy-col" aria-label={zhuyin}>
      {neutral && <span className="n">˙</span>}
      {syms.map((s, i) => (
        <span key={i} className="s">
          {s}
        </span>
      ))}
      {tone && <span className="t">{tone}</span>}
    </span>
  );
}

export function ZhuyinText({
  items,
  annot = "zhuyin",
  size = 40,
  marks,
  onSyllable,
  className = "",
}: {
  items: TextItem[];
  annot?: Annot;
  size?: number;
  marks?: (string | undefined)[];
  onSyllable?: (index: number) => void;
  className?: string;
}) {
  let k = -1;
  return (
    <span className={"inline-flex flex-wrap items-center leading-none " + className} style={{ fontSize: size }}>
      {items.map((it, i) => {
        if (it.type === "text")
          return (
            <span key={i} className="zy-char text-muted" style={{ margin: "0 .05em" }}>
              {it.text}
            </span>
          );
        k++;
        const idx = k;
        const color = marks?.[idx];
        const style = color ? { color } : undefined;
        const clickable = onSyllable ? " cursor-pointer hover:opacity-70" : "";
        if (annot === "pinyin") {
          return (
            <span key={i} className={"zy-top" + clickable} style={style} onClick={() => onSyllable?.(idx)}>
              <span className="p">{it.pinyin}</span>
              <span className="zy-char">{it.char}</span>
            </span>
          );
        }
        return (
          <span
            key={i}
            className={"zy-word" + clickable}
            style={style}
            onClick={() => onSyllable?.(idx)}
            title={it.pinyin}
          >
            <span className="zy-char">{it.char}</span>
            {annot === "zhuyin" && <ZhuyinColumn zhuyin={it.zhuyin} />}
          </span>
        );
      })}
    </span>
  );
}
