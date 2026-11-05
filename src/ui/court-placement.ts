import { useLayoutEffect, useRef } from "react";

/** Center a new phone task once. Live text and disclosure changes must not
 * move the faces; only available-space/font changes may place the court again.
 */
export function useCourtPlacement(enabled: boolean, task: string) {
  const court = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const node = court.current,
      inner = content.current;
    if (!enabled || !node || !inner) return;
    const lower = inner.parentElement!;
    const phone = matchMedia("(max-width: 700px)");
    // Returning from a keyboard or breakpoint must not measure expanded help
    // as a new initial task. These are local placement values, not game state.
    const placements = new Map<string, number>();
    let frame = 0,
      disposed = false;
    const measure = () => {
      if (!phone.matches) {
        node.style.removeProperty("--court-offset");
        return;
      }
      const keyboard =
        document.documentElement.style.getPropertyValue("--keyboard-height");
      const box = node.getBoundingClientRect();
      const key = `${box.width}:${box.height}`;
      let offset = keyboard ? 0 : placements.get(key);
      if (offset === undefined) {
        const style = getComputedStyle(node);
        const cards = node.querySelector(".players")!.getBoundingClientRect();
        const occupied =
          cards.height +
          parseFloat(style.rowGap) +
          inner.getBoundingClientRect().height;
        offset = Math.max(
          0,
          (box.height - parseFloat(style.paddingBottom) - occupied) / 2,
        );
        // A bounded cache covers rotation, breakpoint and browser-zoom returns.
        if (placements.size === 16)
          placements.delete(placements.keys().next().value!);
        placements.set(key, offset);
      }
      node.style.setProperty("--court-offset", `${offset}px`);
      const focused = document.activeElement;
      if (
        focused &&
        lower.contains(focused) &&
        !focused.closest("dialog[open]")
      ) {
        const field = focused.getBoundingClientRect(),
          area = lower.getBoundingClientRect();
        if (field.top < area.top) lower.scrollTop += field.top - area.top;
        else if (field.bottom > area.bottom)
          lower.scrollTop += field.bottom - area.bottom;
      }
    };
    const schedule = () => {
      if (disposed) return;
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(measure);
    };
    const fontsChanged = () => {
      if (disposed) return;
      placements.clear();
      schedule();
    };
    // Keyboard sizing is applied by useKeyboardViewport in its own frame.
    // Observe that property so placement/focus uses the resulting dimensions.
    let keyboardHeight =
      document.documentElement.style.getPropertyValue("--keyboard-height");
    const observer = new MutationObserver(() => {
      const next =
        document.documentElement.style.getPropertyValue("--keyboard-height");
      if (next !== keyboardHeight) {
        keyboardHeight = next;
        schedule();
      }
    });
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["style"],
    });
    // Pinned notices change available room space, unlike content inside the
    // lower scroller. Observe the fixed outer region, never our own padding.
    const availableSpace = new ResizeObserver(schedule);
    availableSpace.observe(node.closest(".room-scroll")!);
    measure();
    void document.fonts.ready.then(fontsChanged);
    document.fonts.addEventListener("loadingdone", fontsChanged);
    window.addEventListener("resize", schedule);
    window.visualViewport?.addEventListener("resize", schedule);
    return () => {
      disposed = true;
      cancelAnimationFrame(frame);
      observer.disconnect();
      availableSpace.disconnect();
      document.fonts.removeEventListener("loadingdone", fontsChanged);
      window.removeEventListener("resize", schedule);
      window.visualViewport?.removeEventListener("resize", schedule);
      node.style.removeProperty("--court-offset");
    };
  }, [enabled, task]);
  return { court, content };
}
