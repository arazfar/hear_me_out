import {
  Component,
  Suspense,
  lazy,
  useCallback,
  useState,
  type ReactNode,
} from "react";
import type { Snapshot } from "../../shared/domain";
const CourtroomStage = lazy(() => import("./CourtroomStage"));
function StageFallback() {
  return (
    <div className="stage" aria-hidden="true">
      <div className="stage-fallback">
        <img src="/bonk-fallback.png" alt="" width="420" height="400" />
      </div>
    </div>
  );
}
class StageBoundary extends Component<
  { children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? <StageFallback /> : this.props.children;
  }
}
export function StageLoader(props: {
  state: Snapshot | null;
  reduced: boolean;
  hero?: boolean;
}) {
  const [lost, setLost] = useState(false);
  const onLost = useCallback(() => setLost(true), []);
  return (
    <StageBoundary>
      {lost ? (
        <StageFallback />
      ) : (
        <Suspense fallback={<StageFallback />}>
          <CourtroomStage {...props} onLost={onLost} />
        </Suspense>
      )}
    </StageBoundary>
  );
}
