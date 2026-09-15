# Pocket Universe — Day 6 Final Safety + Scythe Fix

Based on the working Day 6 build with Cordelia launch rework and long-range Ivis visibility.

This update adds:
- A rebuilt, continuous scythe model so the blade no longer looks detached/broken in the hand.
- A dedicated space out-of-fuel emergency: when the player is actively flying in space and the rocket reaches 0% fuel, flight is stopped, the screen blacks out, the rocket is removed, and the player is returned safely to Ivis with a fresh inventory containing only the starter axe.
- The recovery uses the same timed blackout/fade behavior as the existing solar hazard and clears stale Moon/Cordelia rocket references.


Day 7 achievements rebuild: achievement modal now uses a true display:none hidden state, isolated pointer input, and closes automatically before gameplay/load/menu transitions.

Day 7 achievement expansion: added 9 Survival-only account achievements covering day/night survival, mining totals, Credits, durability, continuous survival, space time, and the secret long-distance round trip.
## Day 7 — Moon Quartz & Upgraded Rocket Engine
- Added common Moon-only Moon Quartz, sellable to the merchant for 500 Credits each and not buyable.
- Added Upgraded Rocket Engine crafted from 2 Moon Quartz, 1 Rocket Engine and 3 Copper Wires.
- Added 1 Copper Ingot -> 3 Copper Wires crafting recipe.
- Upgraded engines give rockets 2× fuel capacity (200%) and each jerrycan adds 50%.
- Upgraded engines can be installed on a parked rocket with E while holding the upgraded engine; installation empties the tank.
- Cordelia orbit time is now 30 minutes.
