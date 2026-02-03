import { Composition } from "remotion";
import { MasterSchedulerDemo } from "./compositions/MasterSchedulerDemo";
import { CommandCenterDemo } from "./compositions/CommandCenterDemo";
import { PEDashboardDemo } from "./compositions/PEDashboardDemo";
import { PipelineDashboardsDemo } from "./compositions/PipelineDashboardsDemo";
import { FullSuiteDemo } from "./compositions/FullSuiteDemo";
import { LaunchVideo } from "./compositions/LaunchVideo";

export const RemotionRoot: React.FC = () => {
  return (
    <>
      <Composition
        id="MasterSchedulerDemo"
        component={MasterSchedulerDemo}
        durationInFrames={300}
        fps={30}
        width={1920}
        height={1080}
      />
      <Composition
        id="CommandCenterDemo"
        component={CommandCenterDemo}
        durationInFrames={300}
        fps={30}
        width={1920}
        height={1080}
      />
      <Composition
        id="PEDashboardDemo"
        component={PEDashboardDemo}
        durationInFrames={240}
        fps={30}
        width={1920}
        height={1080}
      />
      <Composition
        id="PipelineDashboardsDemo"
        component={PipelineDashboardsDemo}
        durationInFrames={360}
        fps={30}
        width={1920}
        height={1080}
      />
      <Composition
        id="FullSuiteDemo"
        component={FullSuiteDemo}
        durationInFrames={600}
        fps={30}
        width={1920}
        height={1080}
      />
      <Composition
        id="LaunchVideo"
        component={LaunchVideo}
        durationInFrames={1200}
        fps={30}
        width={1920}
        height={1080}
      />
    </>
  );
};
