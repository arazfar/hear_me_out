import { useEffect, useRef } from "react";
import { points } from "../../shared/domain";
import { AWARD_FADE, type AwardNotice } from "../game/award-queue";

/** The entrance belongs to the burst identity; later gains only renew its exit. */
export function ScoreBurst({
  notice,
  reduced,
}: {
  notice: AwardNotice;
  reduced: boolean;
}) {
  const motion = useRef<HTMLSpanElement>(null);
  const number = useRef<HTMLSpanElement>(null);
  const entered = useRef(false);
  useEffect(() => {
    const node = number.current;
    if (!node || entered.current) return;
    entered.current = true;
    if (reduced) return;
    const entrance = node.animate(
      [
        {
          transform: "translateY(8px) scale(.7)",
          opacity: 0,
          easing: "cubic-bezier(.16,1,.3,1)",
        },
        {
          transform: "translateY(-2px) scale(1.12)",
          opacity: 1,
          offset: 140 / 220,
          easing: "ease-out",
        },
        { transform: "translateY(0) scale(1)", opacity: 1 },
      ],
      { duration: 220, easing: "linear", fill: "both" },
    );
    return () => entrance.cancel();
  }, [notice.id, reduced]);
  useEffect(() => {
    const node = motion.current;
    if (!node) return;
    let fade: Animation | undefined;
    let renewal: Animation | undefined;
    if (reduced) {
      node.style.opacity = "1";
      node.style.transform = "none";
      return;
    }
    const opacity = Number(getComputedStyle(node).opacity);
    if (opacity < 1) {
      renewal = node.animate([{ opacity }, { opacity: 1 }], {
        duration: 60,
        fill: "forwards",
      });
      renewal.onfinish = () => {
        node.style.opacity = "1";
        renewal?.cancel();
      };
    }
    const timer = setTimeout(
      () => {
        renewal?.cancel();
        fade = node.animate(
          [
            { opacity: 1, transform: node.style.transform || "translateY(0)" },
            { opacity: 0, transform: "translateY(-12px)" },
          ],
          { duration: AWARD_FADE, easing: "ease-out", fill: "forwards" },
        );
      },
      Math.max(0, notice.holdUntil - performance.now()),
    );
    return () => {
      clearTimeout(timer);
      // Keep a partially risen burst in place if another gain renews it.
      const style = getComputedStyle(node);
      const opacity = style.opacity;
      const transform = style.transform;
      fade?.cancel();
      renewal?.cancel();
      node.style.opacity = opacity;
      node.style.transform = transform;
    };
  }, [notice.id, notice.holdUntil, notice.at, reduced]);
  return (
    <span className="award-motion" ref={motion}>
      <span
        className="score-burst"
        ref={number}
        data-award-id={notice.id}
        data-award-ids={notice.awardIds.join(" ")}
      >
        +{points(notice.deltaUnits)}
      </span>
    </span>
  );
}
