import "./index.css";
import React from "react";
import { Composition } from "remotion";
import { VideoComposition } from "./VideoComposition";
import * as fs from "fs";
import * as path from "path";

// Leer duracion del video editado desde data.json para configurar Remotion correctamente
function getEditedDuration(): { durationInFrames: number; fps: number; width: number; height: number } {
  const defaults = { durationInFrames: 1800, fps: 30, width: 1080, height: 1920 };
  try {
    const dataPath = path.resolve(__dirname, "../../data.json");
    const data = JSON.parse(fs.readFileSync(dataPath, "utf-8"));
    const enabledSegs = (data.active_segments || []).filter((s: any) => s.enabled !== false);
    const totalDuration = enabledSegs.reduce((acc: number, s: any) => acc + s.duration, 0);
    return { ...defaults, durationInFrames: Math.max(1, Math.round(totalDuration * defaults.fps)) };
  } catch {
    return defaults;
  }
}

export const RemotionRoot: React.FC = () => {
  const { durationInFrames, fps, width, height } = getEditedDuration();
  return (
    <>
      <Composition
        id="VideoComposition"
        component={VideoComposition}
        durationInFrames={durationInFrames}
        fps={fps}
        width={width}
        height={height}
      />
    </>
  );
};
