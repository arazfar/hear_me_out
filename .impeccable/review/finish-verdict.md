## verdict

1. **Resolved — responsive Bonk framing.** The recaptured zoom-long-content.png shows the full arch and bench front with its base visible at 125% CSS zoom. round-1440.png retains the prior normal desktop framing. CourtroomStage.tsx now supplies `resize={{ offsetSize: true }}`.
2. **Resolved — coin assignment.** The recaptured coin-1440.png displays T beside the Tails assignment. CoinView selects the H/T SVG path from `state.headsId`, so the visible mark now follows the assigned result.

No regressions introduced by these two fixes are visible in the supplied recaptures.

## remaining

Clear. This ship disposition covers the two scored fixes, not the whole surface.

disposition: ship
