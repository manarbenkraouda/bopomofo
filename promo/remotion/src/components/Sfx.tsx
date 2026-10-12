import type React from "react";
import { Audio } from "@remotion/media";
import { staticFile, useVideoConfig } from "remotion";
import { K } from "../lib/stretch";

/** A sound effect from public/audio, placed at a frame of the current scene. */
export const Sfx: React.FC<{ readonly name: string; readonly at: number; readonly volume?: number }> = ({ name, at, volume = 0.5 }) => {
  const { fps } = useVideoConfig();
  return <Audio name={`sfx ${name}`} src={staticFile(`audio/${name}`)} from={Math.round(Math.max(0, at) * K)} volume={volume} premountFor={fps} />;
};
