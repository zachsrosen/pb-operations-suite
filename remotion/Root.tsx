import "./index.css";
import { Composition } from "remotion";
import { WalkthroughVideo } from "./WalkthroughVideo";
import { FPS, WIDTH, HEIGHT, SCENE_FRAMES, TRANSITION_FRAMES } from "./lib/constants";

const sceneDurations = Object.values(SCENE_FRAMES);
const totalFrames =
  sceneDurations.reduce((sum, d) => sum + d, 0) -
  (sceneDurations.length - 1) * TRANSITION_FRAMES;

export const RemotionRoot: React.FC = () => {
  return (
    <Composition
      id="WalkthroughVideo"
      component={WalkthroughVideo}
      durationInFrames={totalFrames}
      fps={FPS}
      width={WIDTH}
      height={HEIGHT}
    />
  );
};
