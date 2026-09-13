// Shared Pocket Universe interface/selection state.
// Stage 7E centralizes the small mutable flags that are shared by inventory,
// crafting, furnace, interaction, and input logic. The actual UI/gameplay
// functions remain where they were; this file only provides their state.
(function () {
  "use strict";

  if (window.PocketUniverseUIState) return;

  window.PocketUniverseUIState = Object.seal({
    version: 1,
    selectedHotbarSlot: 0,
    equippedItemType: null,
    inventoryOpen: false,
    craftingOpen: false,
    freeplayInventoryOpen: false,
    backpackOpen: false,
    furnaceOpen: false
  });
})();
