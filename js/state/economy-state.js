// Shared Pocket Universe economy and merchant state.
(function () {
  "use strict";
  if (window.PocketUniverseEconomyState) return;
  window.PocketUniverseEconomyState = Object.seal({
    version: 1,
    credits: 0,
    merchantOpen: false,
    merchantSection: "dialogue",
    selectedSellTypeId: null,
    fuelingPad: null,
    fuelingStartedAt: 0,
    drillRefueling: null,
    drillRefuelingStartedAt: 0
  });
})();
