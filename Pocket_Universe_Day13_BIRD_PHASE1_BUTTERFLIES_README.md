# Pocket Universe — Day 13 Bird Phase 1 + Butterfly Integration

Based on the working Day 13 bird flock checkpoint.

Added:
- 30 blue 3D butterflies on Ivis.
- Butterflies use real flower locations as 12 flower-patch anchors.
- Butterflies gently drift around a flower patch.
- When the player comes within 7 units, a butterfly flees to a different flower patch.
- Butterflies use the same r128-compatible Three.js geometry approach as the standalone prototype.
- Butterflies are attached to Ivis/planetSystem, so they follow Ivis's rotation and solar orbit.
- Preserved the 50-bird / 5 V-flock system.
- Fixed ambient leaf, snow, and nearby crystal sparkle particles so the relevant effects follow their celestial body instead of being left behind by Ivis's solar orbit.

Validation:
- JavaScript syntax check passed with `node --check`.
- ZIP integrity verified after packaging.


Butterfly visibility revision: 20 patches now include six guaranteed near the initial player area; butterfly wings use double-sided unlit materials and the body is scaled up for readability.
