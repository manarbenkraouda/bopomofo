import type React from "react";
import { Composition, Folder } from "remotion";
import { Promo, PROMO_FRAMES, SHOTS } from "./Promo";
import { OUT_FPS } from "./lib/stretch";

export const RemotionRoot: React.FC = () => {
  return (
    <>
      <Composition id="BopomofoPromo" component={Promo} durationInFrames={PROMO_FRAMES} fps={OUT_FPS} width={1080} height={1920} />
      <Folder name="Scenes">
        {SHOTS.map((s) => (
          <Composition key={s.id} id={s.id} component={s.component} durationInFrames={s.frames} fps={OUT_FPS} width={1080} height={1920} />
        ))}
      </Folder>
    </>
  );
};
