import {Composition} from 'remotion';
import {KunaPitch} from './KunaPitch';

export const Root = () => (
  <Composition
    id="KunaPitch"
    component={KunaPitch}
    durationInFrames={3540}
    fps={30}
    width={1920}
    height={1080}
  />
);
