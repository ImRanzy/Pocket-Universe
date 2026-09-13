// Shared Pocket Universe inventory data.
// Stage 7D moves only the mutable inventory slot collection into shared state.
// Selection/equipped/UI flags stay local to main.js for this step so behavior remains unchanged.
(function () {
  "use strict";

  if (window.PocketUniverseInventoryState) return;

  const INVENTORY_SLOT_COUNT = 12;
  const INVENTORY_MAIN_SLOTS = 8;
  const HOTBAR_SLOT_COUNT = 4;
  const BACKPACK_SLOT_COUNT = 8;

  window.PocketUniverseInventoryState = Object.seal({
    version: 1,
    slotCount: INVENTORY_SLOT_COUNT,
    mainSlotCount: INVENTORY_MAIN_SLOTS,
    hotbarSlotCount: HOTBAR_SLOT_COUNT,
    backpackSlotCount: BACKPACK_SLOT_COUNT,
    slots: Array.from({ length: INVENTORY_SLOT_COUNT }, () => null),
    backpackSlots: Array.from({ length: BACKPACK_SLOT_COUNT }, () => null)
  });
})();
