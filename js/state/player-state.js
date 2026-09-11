// Shared player runtime state for Pocket Universe.
// Keep this data-only: gameplay systems still own their existing logic.
window.PocketUniversePlayerState = Object.seal({
  flashlightOn: false,
  pitch: 0,
  thirdPerson: false,
  thirdPersonOrbitYaw: 0,
  thirdPersonOrbitPitch: 0.18,
  heightOffset: 0,
  verticalVelocity: 0,
  stamina: 100,
  exhausted: false,
  inRocket: false,
  rocketInSpace: false,
  rocketLanded: false,
  rocketFuelTimer: 0
});
