// Shared mutable render/camera-preview state for Pocket Universe.
// Stage 7G centralizes only the main-menu camera orbit values. The actual
// Three.js camera/renderer creation and rendering logic remain in main.js.
(function () {
  "use strict";

  if (window.PocketUniverseRenderState) return;

  window.PocketUniverseRenderState = Object.seal({
    version: 1,
    menuOrbitYaw: 0,
    menuOrbitPitch: 0.28
  });
})();
