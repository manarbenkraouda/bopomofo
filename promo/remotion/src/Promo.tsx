import type React from "react";
import { Audio } from "@remotion/media";
import { AbsoluteFill, staticFile } from "remotion";
import { linearTiming, TransitionSeries } from "@remotion/transitions";
import { fadeThrough, vWipe } from "./components/VWipe";
import { Scene1Intro } from "./scenes/Scene1Intro";
import { Scene2Watch } from "./scenes/Scene2Watch";
import { Scene3Tone } from "./scenes/Scene3Tone";
import { Scene4Stroke } from "./scenes/Scene4Stroke";
import { Scene5Stats } from "./scenes/Scene5Stats";
import { Scene6Plan } from "./scenes/Scene6Plan";
import { Scene7Adjust } from "./scenes/Scene7Adjust";
import { Scene8Keyboard } from "./scenes/Scene8Keyboard";
import { Scene9End } from "./scenes/Scene9End";
import { C } from "./lib/theme";
import { K } from "./lib/stretch";

/** Storyboard shots, in frames at 30 fps. They add up to 900 frames (30 s). */
const BASE_SHOTS = [
  { id: "Shot1-Intro", component: Scene1Intro, frames: 75 },
  { id: "Shot2-Watch", component: Scene2Watch, frames: 75 },
  { id: "Shot3-Tone", component: Scene3Tone, frames: 120 },
  { id: "Shot4-Stroke", component: Scene4Stroke, frames: 75 },
  { id: "Shot5-Stats", component: Scene5Stats, frames: 120 },
  { id: "Shot6-Plan", component: Scene6Plan, frames: 150 },
  { id: "Shot7-Adjust", component: Scene7Adjust, frames: 90 },
  { id: "Shot8-Keyboard", component: Scene8Keyboard, frames: 90 },
  { id: "Shot9-End", component: Scene9End, frames: 105 },
] as const;

/** The shots in output frames (45 s at 60 fps = 2700 frames). */
export const SHOTS = BASE_SHOTS.map((s) => ({ ...s, frames: Math.round(s.frames * K) }));

/** Length of the transition after each shot. The last one is the V wipe to the end card. */
const TRANSITIONS = [8, 8, 8, 8, 8, 8, 8, 18].map((t) => Math.round(t * K));

export const PROMO_FRAMES = SHOTS.reduce((a, s) => a + s.frames, 0);

/**
 * Each shot is made longer by the transition that follows it,
 * so the next shot still starts at its storyboard time and the total stays 900 frames.
 */
export const Promo: React.FC = () => (
  <AbsoluteFill style={{ backgroundColor: C.bg }}>
    <TransitionSeries>
      {SHOTS.flatMap((s, i) => {
        const t = TRANSITIONS[i] ?? 0;
        const Comp = s.component;
        const items = [
          <TransitionSeries.Sequence key={s.id} durationInFrames={s.frames + t} name={s.id}>
            <Comp />
          </TransitionSeries.Sequence>,
        ];
        if (t > 0) {
          const timing = linearTiming({ durationInFrames: t });
          items.push(
            i === SHOTS.length - 2 ? (
              <TransitionSeries.Transition key={`${s.id}-t`} presentation={vWipe()} timing={timing} />
            ) : (
              <TransitionSeries.Transition key={`${s.id}-t`} presentation={fadeThrough()} timing={timing} />
            ),
          );
        }
        return items;
      })}
    </TransitionSeries>
    <Audio name="music bed" src={staticFile("audio/bed.wav")} volume={0.55} />
  </AbsoluteFill>
);
