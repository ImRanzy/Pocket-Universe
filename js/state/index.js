// Pocket Universe Stage 7H: canonical shared-state registry.
// This file does not own gameplay logic and does not replace any existing state.
// It simply gives future systems one stable entry point for shared state.
(function () {
  "use strict";

  if (window.PocketUniverseRuntimeState) return;

  const required = [
    ["game", "PocketUniverseState"],
    ["world", "PocketUniverseWorldState"],
    ["player", "PocketUniversePlayerState"],
    ["inventory", "PocketUniverseInventoryState"],
    ["ui", "PocketUniverseUIState"],
    ["system", "PocketUniverseSystemState"],
    ["render", "PocketUniverseRenderState"],
    ["economy", "PocketUniverseEconomyState"]
  ];

  const missing = required.filter(([, key]) => !window[key]).map(([name]) => name);
  if (missing.length) {
    throw new Error("Pocket Universe shared state is incomplete: " + missing.join(", "));
  }

  window.PocketUniverseRuntimeState = Object.freeze({
    version: 1,
    game: window.PocketUniverseState,
    world: window.PocketUniverseWorldState,
    player: window.PocketUniversePlayerState,
    inventory: window.PocketUniverseInventoryState,
    ui: window.PocketUniverseUIState,
    system: window.PocketUniverseSystemState,
    render: window.PocketUniverseRenderState,
    economy: window.PocketUniverseEconomyState
  });
})();
