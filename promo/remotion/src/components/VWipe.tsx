import type React from "react";
import { AbsoluteFill } from "remotion";
import type { TransitionPresentation, TransitionPresentationComponentProps } from "@remotion/transitions";
import { C } from "../lib/theme";

type Props = Record<string, never>;

const W = 1080;
const H = 1920;
const DEPTH = 560;

const vPolygon = (p: number, ahead: number) => {
  const yy = -DEPTH - 40 + p * (H + DEPTH + 160) + ahead;
  return `polygon(0px -10px, ${W}px -10px, ${W}px ${yy}px, ${W / 2}px ${yy + DEPTH}px, 0px ${yy}px)`;
};

/** The V collar as a wipe: a red V band falls from the top and reveals the next scene behind it. */
const VWipePresentation: React.FC<TransitionPresentationComponentProps<Props>> = ({ children, presentationDirection, presentationProgress }) => {
  if (presentationDirection === "exiting") {
    return <AbsoluteFill>{children}</AbsoluteFill>;
  }
  return (
    <AbsoluteFill>
      <AbsoluteFill style={{ backgroundColor: C.accent, clipPath: vPolygon(presentationProgress, 80) }} />
      <AbsoluteFill style={{ clipPath: vPolygon(presentationProgress, 0) }}>{children}</AbsoluteFill>
    </AbsoluteFill>
  );
};

export const vWipe = (): TransitionPresentation<Props> => ({ component: VWipePresentation, props: {} });

/** Fade through the background: the old shot fades out, then the new one fades in, so two headlines never overlap. */
const FadeThroughPresentation: React.FC<TransitionPresentationComponentProps<Props>> = ({ children, presentationDirection, presentationProgress }) => {
  const p = presentationProgress;
  const opacity = presentationDirection === "exiting" ? Math.max(0, 1 - p * 2) : Math.max(0, p * 2 - 1);
  return <AbsoluteFill style={{ opacity }}>{children}</AbsoluteFill>;
};

export const fadeThrough = (): TransitionPresentation<Props> => ({ component: FadeThroughPresentation, props: {} });
