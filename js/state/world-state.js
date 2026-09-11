// Shared Pocket Universe world-object state.
// Stage 7B keeps the existing arrays themselves intact, but gives them a stable
// shared home so systems can reference the same collections without depending on
// a local declaration inside main.js.
(function () {
  "use strict";

  if (window.PocketUniverseWorldState) return;

  window.PocketUniverseWorldState = {
    version: 1,
    trees: [],
    rocks: [],
    ironOres: [],
    crystals: [],
    furnaces: [],
    launchPads: [],
    droppedItems: []
  };
})();
