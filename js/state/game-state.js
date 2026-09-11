// Shared Pocket Universe session state.
// Stage 7A intentionally moves only the small set of mutable state values that
// are read/written across many gameplay systems. Keeping this object on window
// avoids changing the existing game's initialization model or gameplay logic.
(function () {
  "use strict";

  if (window.PocketUniverseState) return;

  window.PocketUniverseState = {
    version: 1,
    gameState: "menu",      // "menu" | "playing"
    gameMode: "survival",   // "survival" | "freeplay"
    paused: false,
    planetSpinAngle: 0
  };
})();
