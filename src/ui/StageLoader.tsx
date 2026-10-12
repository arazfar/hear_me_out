import { Component, Suspense, lazy, type ReactNode } from "react";
import type { Snapshot } from "../../shared/domain";
const CourtroomStage = lazy(() => import("./CourtroomStage"));
function StageFallback() {
  return (
    <div className="stage-fallback" aria-hidden="true">
      <span>✦</span>
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
}) {
  return (
    <StageBoundary>
      <Suspense fallback={<StageFallback />}>
        <CourtroomStage {...props} />
      </Suspense>
    </StageBoundary>
  );
}
