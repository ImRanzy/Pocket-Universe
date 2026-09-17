Pocket Universe Day 9 - Rocket model real fix.

The supplied Blockbench rocket is now the primary rocket mesh. The exact OBJ geometry and supplied texture are embedded into the project, so the model no longer depends on an external OBJ/MTL loader, CDN loader, or runtime asset path. The original rocket.obj, materials.mtl, and texture.png files remain in models/ as source assets.

The model is used by mounted rockets and rocket inventory/dropped visuals. It is normalized to a local origin, rendered double-sided, and has frustum culling disabled so it remains visible after the game's planet-relative transforms.

The previous Day 8 systems and actual axe/pickaxe models remain intact.


Day 9 furnace remodeling: integrates the supplied Blockbench Furnace OBJ + texture as the in-game furnace model, with embedded geometry/texture data for reliable loading.

Day 9: added the supplied Jerrycan OBJ/MTL/textures as the authoritative jerrycan model for dropped and held item visuals.


Day 9 world-size expansion: Ivis, Moon, Cordelia, and the Sun are now 2x their previous radii (Ivis 240, Moon 60, Cordelia 220, Sun 1680). Terrain heights and atmospheric bands were scaled proportionally. World-generation props/collectibles were doubled to keep the enlarged celestial bodies populated: grass, flowers, trees, boulders, iron ore, crystals, Moon Quartz, Cordelia cacti/boulders/crystals, and meteor-site ore. Main-menu/minimap camera distances were also adjusted for the larger Ivis.


Day 9 major feature: Tungsten Ore, Tungsten Ingots, Warp Drive ship upgrade, Space Navigation Map, and long-distance warp travel.
