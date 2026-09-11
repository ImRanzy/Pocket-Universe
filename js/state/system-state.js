// Shared Pocket Universe input/interaction state.
// Stage 7F centralizes transient keyboard and block-breaking state while leaving
// the actual input handlers and interaction logic in main.js unchanged.
(function () {
  "use strict";

  if (window.PocketUniverseSystemState) return;

  window.PocketUniverseSystemState = Object.seal({
    version: 1,
    keys: Object.create(null),
    menuDragging: false,
    menuLastX: 0,
    menuLastY: 0,
    breakingFurnace: false,
    breakingFurnaceStartedAt: 0,
    breakingFurnaceTarget: null,
    breakingSpaceObject: false,
    breakingSpaceObjectStartedAt: 0,
    breakingSpaceObjectTarget: null,
    breakingSpaceObjectType: null
  });
})();
