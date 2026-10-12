import type React from "react";
import type { CSSProperties, ReactNode } from "react";
import { AbsoluteFill, CanvasImage, staticFile } from "remotion";
import { C, CJK, SANS } from "../lib/theme";

/** The cream background with a faint V collar mark. */
export const Backdrop: React.FC<{ readonly variant?: "plain" | "end" }> = ({ variant = "plain" }) => (
  <AbsoluteFill
    style={{
      background:
        variant === "end"
          ? `radial-gradient(circle at 50% 46%, ${C.cream} 0%, ${C.cream} 38%, ${C.cream2} 100%)`
          : `radial-gradient(circle at 50% 28%, #fbf8f1 0%, ${C.bg} 55%, #eee6d7 100%)`,
    }}
  >
    {variant === "plain" ? (
      <VMark width={1300} color="rgba(227,219,204,0.45)" style={{ position: "absolute", left: -110, top: 1480 }} />
    ) : null}
  </AbsoluteFill>
);

/** The white V collar of Bobo as a graphic mark. */
export const VMark: React.FC<{ readonly width: number; readonly color: string; readonly thickness?: number; readonly style?: CSSProperties }> = ({
  width,
  color,
  thickness = 0.2,
  style,
}) => {
  const h = width * 0.6;
  const t = width * thickness;
  return (
    <svg width={width} height={h} viewBox={`0 0 ${width} ${h}`} style={style}>
      <path d={`M0 0 L${width / 2} ${h} L${width} 0 L${width - t} 0 L${width / 2} ${h - t * 1.25} L${t} 0 Z`} fill={color} />
    </svg>
  );
};

/** A rounded app card. */
export const Card: React.FC<{ readonly style?: CSSProperties; readonly children?: ReactNode }> = ({ style, children }) => (
  <div
    style={{
      position: "absolute",
      boxSizing: "border-box",
      background: C.card,
      borderRadius: 20,
      border: `2px solid ${C.line}`,
      boxShadow: "0 28px 50px -24px rgba(36,32,27,0.28), 0 3px 0 rgba(36,32,27,0.04)",
      fontFamily: SANS,
      color: C.ink,
      ...style,
    }}
  >
    {children}
  </div>
);

/** Small grey label at the top of a card. */
export const CardLabel: React.FC<{ readonly children: ReactNode; readonly dot?: string }> = ({ children, dot = C.accent }) => (
  <div style={{ display: "flex", alignItems: "center", gap: 12, fontSize: 30, fontWeight: 700, color: C.muted, letterSpacing: "0.01em" }}>
    <span style={{ width: 14, height: 14, borderRadius: 7, background: dot, display: "inline-block" }} />
    {children}
  </div>
);

/** Bobo's face and V collar in a round cream disc: the coach avatar. */
export const BoboFace: React.FC<{ readonly size: number; readonly style?: CSSProperties }> = ({ size, style }) => {
  const ring = Math.max(4, Math.round(size * 0.035));
  return (
    <div
      style={{
        width: size,
        height: size,
        boxSizing: "border-box",
        borderRadius: "50%",
        border: `${ring}px solid ${C.cream}`,
        background: `radial-gradient(circle, ${C.cream} 55%, ${C.cream2} 100%)`,
        boxShadow: `0 0 0 2px ${C.line}, 0 12px 26px -10px rgba(36,32,27,0.35)`,
        overflow: "hidden",
        position: "relative",
        flexShrink: 0,
        ...style,
      }}
    >
      <CanvasImage
        src={staticFile("bobo/bobo-face.png")}
        width={size - ring * 2}
        height={size - ring * 2}
        style={{ position: "absolute", left: 0, top: 0 }}
      />
    </div>
  );
};

/** A Bopomofo or Hanzi tile. */
export const GlyphTile: React.FC<{ readonly glyph: string; readonly size: number; readonly color?: string; readonly bg?: string; readonly style?: CSSProperties }> = ({
  glyph,
  size,
  color = C.ink,
  bg = C.cream,
  style,
}) => (
  <div
    style={{
      width: size,
      height: size,
      borderRadius: size * 0.2,
      background: bg,
      border: `2px solid ${C.line}`,
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      fontFamily: CJK,
      fontWeight: 700,
      fontSize: size * 0.66,
      color,
      lineHeight: 1,
      flexShrink: 0,
      ...style,
    }}
  >
    {glyph}
  </div>
);

export const CheckIcon: React.FC<{ readonly size: number; readonly color?: string; readonly bg?: string; readonly style?: CSSProperties }> = ({
  size,
  color = "#fff",
  bg = C.ok,
  style,
}) => (
  <svg width={size} height={size} viewBox="0 0 100 100" style={style}>
    <circle cx={50} cy={50} r={50} fill={bg} />
    <path d="M28 52 L44 67 L73 35" fill="none" stroke={color} strokeWidth={11} strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

export const CrossIcon: React.FC<{ readonly size: number; readonly color?: string; readonly bg?: string; readonly style?: CSSProperties }> = ({
  size,
  color = "#fff",
  bg = C.bad,
  style,
}) => (
  <svg width={size} height={size} viewBox="0 0 100 100" style={style}>
    <circle cx={50} cy={50} r={50} fill={bg} />
    <path d="M34 34 L66 66 M66 34 L34 66" fill="none" stroke={color} strokeWidth={11} strokeLinecap="round" />
  </svg>
);

export const LockOpenIcon: React.FC<{ readonly size: number; readonly color: string }> = ({ size, color }) => (
  <svg width={size} height={size} viewBox="0 0 100 100">
    <rect x={18} y={44} width={64} height={46} rx={10} fill={color} />
    <path d="M32 44 V30 A18 18 0 0 1 68 26" fill="none" stroke={color} strokeWidth={10} strokeLinecap="round" />
  </svg>
);

/** Zhuyin text, always in the CJK font so tone marks render with it. */
export const Zhuyin: React.FC<{ readonly children: ReactNode; readonly style?: CSSProperties }> = ({ children, style }) => (
  <span style={{ fontFamily: CJK, fontWeight: 700, ...style }}>{children}</span>
);
