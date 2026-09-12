
(function () {
  "use strict";

  const state = window.PocketUniverseState;
  if (!state) throw new Error("PocketUniverseState failed to load");

  const worldState = window.PocketUniverseWorldState;
  if (!worldState) throw new Error("PocketUniverseWorldState failed to load");

  const playerState = window.PocketUniversePlayerState;
  const uiState = window.PocketUniverseUIState;
  const systemState = window.PocketUniverseSystemState;
  const renderState = window.PocketUniverseRenderState;
  const economyState = window.PocketUniverseEconomyState;
  if (!playerState) throw new Error("PocketUniversePlayerState failed to load");
  if (!systemState) throw new Error("PocketUniverseSystemState failed to load");
  if (!economyState) throw new Error("PocketUniverseEconomyState failed to load");

  const CDN_URLS = [
    "https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js",
    "https://unpkg.com/three@0.128.0/build/three.min.js",
    "https://cdn.jsdelivr.net/npm/three@0.128.0/build/three.min.js"
  ];

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const el = document.createElement("script");
      el.src = src;
      el.onload = () => resolve();
      el.onerror = () => reject(new Error("failed to load " + src));
      document.head.appendChild(el);
    });
  }

  function showFatalError(message) {
    const loadingEl = document.getElementById("homeLoading");
    loadingEl.textContent = message;
    loadingEl.classList.add("error");
  }

  async function boot() {
    let loaded = false;
    for (const url of CDN_URLS) {
      try {
        await loadScript(url);
        if (window.THREE) { loaded = true; break; }
      } catch (e) {
        // try the next CDN
      }
    }
    if (!loaded || !window.THREE) {
      showFatalError(
        "The 3D engine couldn't load, probably because this preview blocks outside network requests. " +
        "Download this file and open it directly in a normal browser tab to play."
      );
      return;
    }
    try {
      runGame();
    } catch (e) {
      showFatalError("Something went wrong starting the game: " + (e && e.message ? e.message : e));
      console.error(e);
    }
  }

  function runGame() {
    // ---------- tunable constants ----------
    const PLANET_RADIUS = 120;
    const EYE_HEIGHT = 1.7;
    const MOVE_SPEED = 9;                // units per second, walking
    const SPRINT_MULTIPLIER = 1.9;
    const MOUSE_SENSITIVITY = 0.0022;
    const MAX_PITCH = Math.PI / 2 - 0.05;
    const JUMP_SPEED = 7;
    const GRAVITY = 18;
    const CAM_FIRST = new THREE.Vector3(0, 0, 0);
    const CAM_THIRD = new THREE.Vector3(0, 1.45, 5.2);

    const STAMINA_MAX = 100;
    const STAMINA_DRAIN_PER_SEC = 28;
    const STAMINA_REGEN_PER_SEC = 16;
    const STAMINA_EXHAUST_RECOVER = 20;

    // Flashlight settings: the light is attached to the player's camera so it always
    // follows the direction the player is looking.
    const FLASHLIGHT_DISTANCE = 85;
    const FLASHLIGHT_ANGLE = Math.PI / 7;
    const FLASHLIGHT_INTENSITY = 7;

    // terrain: gentle hills/valleys everywhere, plus 4 tall mountains
    const HILL_AMPLITUDE = 4;
    const MOUNTAIN_HEIGHT = 20;                  // reduced so mountains feel proportional to the planet and leave room for future flight
    const MOUNTAIN_ANGULAR_RADIUS = 0.34;   // slightly narrower mountains for a more natural silhouette   // radians, ~23 degrees of arc
    const ROCK_LEVEL = 8;                  // elevation where grass gives way to rock
    const SNOW_LEVEL = 16;                 // keeps snowy peaks after the mountain height reduction                 // elevation where rock gives way to snow

    // 4 mountains, evenly spread out like a tetrahedron so none overlap
    const MOUNTAIN_DIRS = [
      new THREE.Vector3(1, 1, 1).normalize(),
      new THREE.Vector3(1, -1, -1).normalize(),
      new THREE.Vector3(-1, 1, -1).normalize(),
      new THREE.Vector3(-1, -1, 1).normalize(),
    ];

    // broad valley basins: one roughly opposite each mountain, well clear of all of them
    const VALLEY_ANGULAR_RADIUS = 0.55;
    const VALLEY_DEPTH = 10;
    const VALLEY_DIRS = [
      new THREE.Vector3(-1, -1, -1).normalize(),
      new THREE.Vector3(-1, 1, 1).normalize(),
      new THREE.Vector3(1, -1, 1).normalize(),
      new THREE.Vector3(1, 1, -1).normalize(),
    ];

    // a single river: starts partway down one mountain's flank, takes the LONG way
    // around the great circle through that mountain and a second one (~250 degrees of
    // arc — most of the way around the planet), then tapers away into the ground near
    // the second mountain, as if it disappears underground, rather than climbing it.
    const RIVER_FLAT_HALF_WIDTH = 0.02;
    const RIVER_BLEND_HALF_WIDTH = 0.045;
    const RIVER_DEPTH = 3;
    const RIVER_FROM = MOUNTAIN_DIRS[0];
    const RIVER_TO = MOUNTAIN_DIRS[2];

    function rotateAroundAxis(v, axis, angle) {
      // Rodrigues' rotation formula, simplified since axis is perpendicular to v here
      const cosA = Math.cos(angle), sinA = Math.sin(angle);
      const cross = new THREE.Vector3().crossVectors(axis, v);
      return v.clone().multiplyScalar(cosA).add(cross.multiplyScalar(sinA));
    }

    const riverAxis = new THREE.Vector3().crossVectors(RIVER_FROM, RIVER_TO).normalize();
    const riverShortAngle = RIVER_FROM.angleTo(RIVER_TO);
    const riverLongAngle = Math.PI * 2 - riverShortAngle; // go the long way, not the short 109-degree hop

    function buildRiverPath(fromDir, axis, totalAngle, segments) {
      const raw = [];
      for (let i = 0; i <= segments; i++) {
        raw.push(rotateAroundAxis(fromDir, axis, -(i / segments) * totalAngle));
      }
      const points = [];
      for (let i = 0; i <= segments; i++) {
        const t = i / segments;
        const prev = raw[Math.max(0, i - 1)];
        const next = raw[Math.min(segments, i + 1)];
        const tangent = next.clone().sub(prev).normalize();
        const perp = new THREE.Vector3().crossVectors(raw[i], tangent).normalize();
        const wiggle = (Math.sin(t * 22) * 0.55 + Math.sin(t * 47 + 1.3) * 0.3) * 0.04;
        points.push(raw[i].clone().addScaledVector(perp, wiggle).normalize());
      }
      return points;
    }

    const RIVER_SEGMENTS = 110;
    const RIVER_START_T = 0.055;        // skip the bit still inside the starting mountain
    const RIVER_END_T = 0.945;          // stop just shy of the second mountain's slope
    const RIVER_END_TAPER_START = 0.92; // fraction of the *rendered* river where it starts narrowing to nothing

    const riverFullPath = buildRiverPath(RIVER_FROM, riverAxis, riverLongAngle, RIVER_SEGMENTS);
    const riverPoints = riverFullPath.filter((p, i) => {
      const t = i / RIVER_SEGMENTS;
      return t >= RIVER_START_T && t <= RIVER_END_T;
    });

    function nearestRiverInfo(dir) {
      let bestAngle = Infinity, bestIndex = -1;
      for (let i = 0; i < riverPoints.length; i++) {
        const d = dir.angleTo(riverPoints[i]);
        if (d < bestAngle) { bestAngle = d; bestIndex = i; }
      }
      return { angle: bestAngle, index: bestIndex };
    }

    function riverEndTaper(indexFrac) {
      if (indexFrac <= RIVER_END_TAPER_START) return 1;
      const t = (indexFrac - RIVER_END_TAPER_START) / (1 - RIVER_END_TAPER_START);
      return smoothBump(t);
    }

    function isWater(dir) {
      return nearestRiverInfo(dir).angle < RIVER_FLAT_HALF_WIDTH * 0.9;
    }

    function hillNoise(dir) {
      // cheap seamless pseudo-noise: a function purely of the 3D direction,
      // so it has no seams or poles the way a 2D height-map wrapped on a sphere would
      const x = dir.x, y = dir.y, z = dir.z;
      let n = 0;
      n += Math.sin(x * 3.1 + y * 1.7) * 0.5;
      n += Math.sin(y * 4.3 + z * 2.9 + 1.3) * 0.35;
      n += Math.sin(z * 5.7 + x * 3.3 + 2.6) * 0.25;
      n += Math.sin((x + y + z) * 2.1) * 0.2;
      // finer octaves layered on top, for smaller-scale roughness/texture
      n += Math.sin(x * 8.9 - y * 6.3 + 0.7) * 0.15;
      n += Math.sin(y * 7.7 + z * 9.1 - 1.9) * 0.12;
      return n / 1.57; // roughly in [-1, 1]
    }

    function smoothBump(t) {
      const c = Math.max(0, Math.min(1, t));
      return 1 - (c * c * (3 - 2 * c)); // smoothstep falloff, 1 at center, 0 at the rim
    }

    function heightAt(dir) {
      const n = hillNoise(dir); // same noise sample drives both the rolling terrain and mountain texture
      let h = n * HILL_AMPLITUDE;

      for (let i = 0; i < MOUNTAIN_DIRS.length; i++) {
        const theta = dir.angleTo(MOUNTAIN_DIRS[i]);
        const t = theta / MOUNTAIN_ANGULAR_RADIUS;
        if (t < 1) {
          const roughness = 1 + 0.25 * n; // breaks the perfect dome into something craggier
          h += MOUNTAIN_HEIGHT * smoothBump(t) * roughness;
        }
      }

      for (let i = 0; i < VALLEY_DIRS.length; i++) {
        const theta = dir.angleTo(VALLEY_DIRS[i]);
        const t = theta / VALLEY_ANGULAR_RADIUS;
        if (t < 1) h -= VALLEY_DEPTH * smoothBump(t);
      }

      // carve the river: a fully-carved flat channel bed near the centerline, tapering
      // smoothly back up to natural terrain for the banks — and tapering the whole carve
      // back to nothing near the end, so the ground rises back up right where the water
      // disappears underground
      const riverInfo = nearestRiverInfo(dir);
      let riverCarve = 0;
      if (riverInfo.angle < RIVER_FLAT_HALF_WIDTH) {
        riverCarve = 1;
      } else if (riverInfo.angle < RIVER_BLEND_HALF_WIDTH) {
        const t = (riverInfo.angle - RIVER_FLAT_HALF_WIDTH) / (RIVER_BLEND_HALF_WIDTH - RIVER_FLAT_HALF_WIDTH);
        riverCarve = smoothBump(t);
      }
      if (riverInfo.index >= 0) {
        riverCarve *= riverEndTaper(riverInfo.index / (riverPoints.length - 1));
      }
      h -= RIVER_DEPTH * riverCarve;

      return h;
    }

    const COLOR_VALLEY = new THREE.Color(0x2f7a3a);
    const COLOR_HILL = new THREE.Color(0x4fae5c);
    const COLOR_ROCK = new THREE.Color(0x8a8a86);
    const COLOR_SNOW = new THREE.Color(0xf5f7f8);

    function colorForHeight(h) {
      if (h > SNOW_LEVEL) {
        const t = THREE.MathUtils.clamp((h - SNOW_LEVEL) / (MOUNTAIN_HEIGHT - SNOW_LEVEL), 0, 1);
        return COLOR_ROCK.clone().lerp(COLOR_SNOW, t);
      } else if (h > ROCK_LEVEL) {
        const t = THREE.MathUtils.clamp((h - ROCK_LEVEL) / (SNOW_LEVEL - ROCK_LEVEL), 0, 1);
        return COLOR_HILL.clone().lerp(COLOR_ROCK, t);
      } else {
        const t = THREE.MathUtils.clamp((h + HILL_AMPLITUDE) / (ROCK_LEVEL + HILL_AMPLITUDE), 0, 1);
        return COLOR_VALLEY.clone().lerp(COLOR_HILL, t);
      }
    }

    // ---------- renderer / scene / cameras ----------
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(
      70, window.innerWidth / window.innerHeight, 0.1, 10000
    );

    // Main-menu planet preview camera.
    // Its yaw/playerState.pitch are controlled by dragging the cursor, so the player can inspect
    // every side of the planet before starting the game.
    const MENU_CAM_DISTANCE = 420;
    const MENU_ROTATE_SENSITIVITY = 0.005;
    const MENU_MAX_PITCH = Math.PI / 2 - 0.12;
    // Menu drag state is shared through systemState.
    const menuCamera = new THREE.PerspectiveCamera(
      50, window.innerWidth / window.innerHeight, 1, 3000
    );
    function updateMenuCamera(delta) {
      // Convert the yaw/playerState.pitch angles into a point on a sphere around the planet.
      // This keeps the camera at a fixed distance while allowing full 360° rotation.
      const cosPitch = Math.cos(renderState.menuOrbitPitch);
      menuCamera.position.set(
        Math.sin(renderState.menuOrbitYaw) * cosPitch * MENU_CAM_DISTANCE,
        Math.sin(renderState.menuOrbitPitch) * MENU_CAM_DISTANCE,
        Math.cos(renderState.menuOrbitYaw) * cosPitch * MENU_CAM_DISTANCE
      );
      menuCamera.lookAt(0, 0, 0);
    }

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    document.body.appendChild(renderer.domElement);
    const canvas = renderer.domElement;

    // ---------- planetary map renderer ----------
    // The map is a second lightweight Three.js view so it can show the same procedural
    // planet style as the main-menu preview without disturbing the gameplay camera.
    const mapOverlay = document.getElementById('mapOverlay');
    const mapViewportWrap = document.getElementById('mapViewportWrap');
    const mapCanvas = document.getElementById('mapCanvas');
    const mapClose = document.getElementById('mapClose');
    const mapRenderer = new THREE.WebGLRenderer({ canvas: mapCanvas, antialias: true, alpha: true });
    mapRenderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
    mapRenderer.setClearColor(0x000000, 0);
    const mapScene = new THREE.Scene();
    const mapCamera = new THREE.PerspectiveCamera(50, 1, 1, 3000);
    const MAP_MIN_ZOOM = 178;
    const MAP_MAX_ZOOM = 610;
    let mapCameraDistance = 420;
    let mapOrbitYaw = 0;
    let mapOrbitPitch = 0.28;
    let mapDragging = false;
    let mapLastX = 0;
    let mapLastY = 0;
    let mapOpen = false;
    const MAP_ROTATE_SENSITIVITY = 0.005;
    const MAP_MAX_PITCH = Math.PI / 2 - 0.12;
    const mapPlanetRoot = new THREE.Group();
    const mapMarkerGroup = new THREE.Group();
    mapScene.add(mapPlanetRoot);
    mapScene.add(mapMarkerGroup);
    mapScene.add(new THREE.HemisphereLight(0xfff2d8, 0x223029, 2.0));
    const mapKey = new THREE.DirectionalLight(0xffffff, 2.2);
    mapKey.position.set(220, 260, 180);
    mapScene.add(mapKey);

    function resizeMapRenderer() {
      if (!mapViewportWrap) return;
      const w = Math.max(1, mapViewportWrap.clientWidth);
      const h = Math.max(1, mapViewportWrap.clientHeight);
      mapCamera.aspect = w / h;
      mapCamera.updateProjectionMatrix();
      mapRenderer.setSize(w, h, false);
    }

    function updateMapCamera() {
      const cosPitch = Math.cos(mapOrbitPitch);
      mapCamera.position.set(
        Math.sin(mapOrbitYaw) * cosPitch * mapCameraDistance,
        Math.sin(mapOrbitPitch) * mapCameraDistance,
        Math.cos(mapOrbitYaw) * cosPitch * mapCameraDistance
      );
      mapCamera.lookAt(0, 0, 0);
    }

    function createMapPlanet() {
      // Copy the already-generated planet world so the map matches the menu's terrain.
      // Gameplay-only player/camera and the menu GPS pin are intentionally omitted.
      const blocked = new Set([player, spawnPinGroup]);
      while (mapPlanetRoot.children.length) mapPlanetRoot.remove(mapPlanetRoot.children[0]);
      for (const child of planetSystem.children) {
        if (blocked.has(child)) continue;
        if (child.name === 'CrystalMerchantStall') continue;
        const clone = child.clone(true);
        clone.traverse(obj => {
          if (obj.isMesh) {
            obj.castShadow = false;
            obj.receiveShadow = false;
          }
        });
        mapPlanetRoot.add(clone);
      }

      // Add clear, collectible-looking iron ore indicators on top of the planet.
      while (mapMarkerGroup.children.length) mapMarkerGroup.remove(mapMarkerGroup.children[0]);
      const ironMat = new THREE.MeshBasicMaterial({ color: 0xd9a84d });
      for (const ore of ironOreSpawns) {
        const pin = new THREE.Mesh(new THREE.SphereGeometry(1.05, 10, 10), ironMat);
        const dir = ore.direction.clone().normalize();
        pin.position.copy(dir).multiplyScalar(PLANET_RADIUS + heightAt(dir) + 1.5);
        mapMarkerGroup.add(pin);
      }
    }

    function getMapPlayerWorldPosition(out) {
      if (playerState.inRocket) {
        out.copy(flightPosition);
      } else {
        player.getWorldPosition(out);
      }
      return out;
    }

    const mapPlayerWorld = new THREE.Vector3();
    const mapPlayerLocal = new THREE.Vector3();
    function updateMapPlayerMarker() {
      getMapPlayerWorldPosition(mapPlayerWorld);
      mapPlayerLocal.copy(mapPlayerWorld);
      planetSystem.worldToLocal(mapPlayerLocal);
      const dir = mapPlayerLocal.normalize();
      const groundRadius = PLANET_RADIUS + heightAt(dir) + 4.0;
      mapPlayerMarker.position.copy(dir).multiplyScalar(groundRadius);
      mapPlayerMarker.scale.setScalar(playerState.inRocket ? 1.22 : 1.0);
    }

    // Red current-position beacon. It floats just above the terrain so it remains visible
    // even at the farthest map zoom.
    const mapPlayerMarker = new THREE.Mesh(
      new THREE.SphereGeometry(2.8, 16, 16),
      new THREE.MeshBasicMaterial({ color: 0xea4b4b })
    );
    mapScene.add(mapPlayerMarker);

    function openPlanetMap() {
      if (state.gameState !== 'playing' || state.paused || economyState.merchantOpen ||
          uiState.inventoryOpen || uiState.craftingOpen || uiState.furnaceOpen ||
          !settingsModal.classList.contains('hidden')) return false;
      if (playerState.inRocket && playerState.rocketInSpace) {
        showFlightPrompt('Map unavailable outside the atmosphere.');
        return false;
      }
      if (document.pointerLockElement === canvas) document.exitPointerLock();
      clearPhysicalKeys();
      for (const k in systemState.keys) systemState.keys[k] = false;
      mapOpen = true;
      mapOverlay.classList.remove('hidden');
      resizeMapRenderer();
      updateMapCamera();
      updateMapPlayerMarker();
      document.body.classList.add('map-open');
      return true;
    }

    function closePlanetMap() {
      if (!mapOpen) return;
      mapOpen = false;
      mapOverlay.classList.add('hidden');
      mapDragging = false;
      mapViewportWrap.classList.remove('dragging');
      document.body.classList.remove('map-open');
    }

    function togglePlanetMap() {
      if (mapOpen) closePlanetMap();
      else openPlanetMap();
    }

    mapClose.addEventListener('click', closePlanetMap);
    mapViewportWrap.addEventListener('pointerdown', (e) => {
      if (!mapOpen || e.button !== 0) return;
      mapDragging = true;
      mapLastX = e.clientX;
      mapLastY = e.clientY;
      mapViewportWrap.classList.add('dragging');
      mapViewportWrap.setPointerCapture?.(e.pointerId);
      e.preventDefault();
    });
    mapViewportWrap.addEventListener('pointermove', (e) => {
      if (!mapDragging || !mapOpen) return;
      const dx = e.clientX - mapLastX;
      const dy = e.clientY - mapLastY;
      mapLastX = e.clientX;
      mapLastY = e.clientY;
      mapOrbitYaw -= dx * MAP_ROTATE_SENSITIVITY;
      mapOrbitPitch += dy * MAP_ROTATE_SENSITIVITY;
      mapOrbitPitch = Math.max(-MAP_MAX_PITCH, Math.min(MAP_MAX_PITCH, mapOrbitPitch));
      updateMapCamera();
    });
    const endMapDrag = () => {
      mapDragging = false;
      mapViewportWrap.classList.remove('dragging');
    };
    mapViewportWrap.addEventListener('pointerup', endMapDrag);
    mapViewportWrap.addEventListener('pointercancel', endMapDrag);
    mapViewportWrap.addEventListener('wheel', (e) => {
      if (!mapOpen) return;
      e.preventDefault();
      mapCameraDistance = THREE.MathUtils.clamp(
        mapCameraDistance * Math.exp(e.deltaY * 0.0011),
        MAP_MIN_ZOOM, MAP_MAX_ZOOM
      );
      updateMapCamera();
    }, { passive:false });

    window.addEventListener("resize", () => {
      camera.aspect = window.innerWidth / window.innerHeight;
      camera.updateProjectionMatrix();
      menuCamera.aspect = window.innerWidth / window.innerHeight;
      menuCamera.updateProjectionMatrix();
      renderer.setSize(window.innerWidth, window.innerHeight);
      resizeMerchantPreview();
      resizeMapRenderer();
    });


    // ---------- sky + day/night cycle ----------
    // The sky starts blue, but the colors are changed every frame according to where
    // the sun is relative to the player. Because the calculation uses the player's
    // position on the sphere, walking to the opposite side of the planet immediately
    // changes your local time of day.
    scene.background = new THREE.Color(0x6fb7ff);
    scene.fog = new THREE.Fog(0x6fb7ff, 360, 1020);
    const sceneFog = scene.fog;

    const skyGeo = new THREE.SphereGeometry(1500, 32, 16);
    const skyMat = new THREE.MeshBasicMaterial({
      color: 0x4fa8ff, side: THREE.BackSide, fog: false,
    });
    const skyMesh = new THREE.Mesh(skyGeo, skyMat);
    scene.add(skyMesh);

    const cloudGeo = new THREE.SphereGeometry(1440, 24, 12);
    const cloudMat = new THREE.MeshBasicMaterial({
      color: 0xffffff, transparent: true, opacity: 0.06, side: THREE.BackSide, fog: false,
    });
    const cloudMesh = new THREE.Mesh(cloudGeo, cloudMat);
    scene.add(cloudMesh);

    // Small star particles are hidden during the day and fade in at night.
    // They are deliberately treated like a background layer: they do NOT use depth testing
    // or perspective size attenuation. This makes every star remain visible instead of
    // becoming sub-pixel tiny or being hidden by the giant sky sphere.
    const starPositions = [];
    for (let i = 0; i < 1400; i++) {
      const starDir = new THREE.Vector3(
        Math.random() * 2 - 1,
        Math.random() * 2 - 1,
        Math.random() * 2 - 1
      ).normalize();
      const starRadius = 1400 + Math.random() * 80;
      starPositions.push(starDir.x * starRadius, starDir.y * starRadius, starDir.z * starRadius);
    }
    const starGeo = new THREE.BufferGeometry();
    starGeo.setAttribute('position', new THREE.Float32BufferAttribute(starPositions, 3));
    const starMat = new THREE.PointsMaterial({
      color: 0xffffff,
      size: 3.2,
      sizeAttenuation: false,
      transparent: true,
      opacity: 0,
      // Stars are behind the terrain: depth testing lets mountains, trees, and the planet
      // itself correctly hide stars instead of allowing them to shine through the ground.
      // The stars still sit in front of the giant sky sphere because their radius is smaller.
      depthTest: true,
      depthWrite: false
    });
    const stars = new THREE.Points(starGeo, starMat);
    stars.renderOrder = 1000;
    stars.frustumCulled = false;
    scene.add(stars);

    // The sun stays fixed in space while the planet rotates around its own axis.
    // This is the more natural setup for the game: later, the spaceship can fly around
    // the same stationary sun while the planet keeps spinning underneath it.
    const SUN_DISTANCE = 520;
    const DAY_LENGTH_SECONDS = 300;
    // A crystal comes back after the planet has completed two full rotations: two complete
    // day/night cycles. Keeping this tied to the same constant means the respawn time can
    // never drift away from the actual sun/planet cycle.
    const CRYSTAL_RESPAWN_SECONDS = DAY_LENGTH_SECONDS * 2;
    const CRYSTAL_PICKUP_RADIUS = 3.2;


    // A large, glowing sphere represents the sun. It is intentionally bigger than the
    // previous version so it reads clearly as the main light source in the sky.
    const sunMesh = new THREE.Mesh(
      new THREE.SphereGeometry(18, 24, 24),
      new THREE.MeshBasicMaterial({ color: 0xffe08a })
    );
    const sunLight = new THREE.DirectionalLight(0xfff3d6, 2.1);
    sunMesh.position.set(SUN_DISTANCE, 120, 150);
    sunLight.position.copy(sunMesh.position);
    scene.add(sunMesh);
    scene.add(sunLight);

    const ambientLight = new THREE.AmbientLight(0xffffff, 0.12);
    scene.add(ambientLight);

    // Colors used for the smooth day -> sunset -> night transition.
    const DAY_SKY = new THREE.Color(0x6fb7ff);
    const SUNSET_SKY = new THREE.Color(0xf08a55);
    const NIGHT_SKY = new THREE.Color(0x050817);
    const DAY_FOG = new THREE.Color(0x6fb7ff);
    const SUNSET_FOG = new THREE.Color(0xe07a55);
    const NIGHT_FOG = new THREE.Color(0x050817);

    const tempSunDir = new THREE.Vector3();
    const tempPlayerDir = new THREE.Vector3();
    const tempSkyColor = new THREE.Color();
    const tempFogColor = new THREE.Color();

    function updateDayNight(delta) {
      // Rotate the whole planet once every DAY_LENGTH_SECONDS. Because the sun itself
      // is stationary, the planet naturally carries different terrain from daylight
      // into darkness as it spins.
      state.planetSpinAngle += (Math.PI * 2 / DAY_LENGTH_SECONDS) * delta;
      planetSystem.rotation.y = state.planetSpinAngle;

      // Get the player's actual WORLD position after the planet has rotated. This makes
      // the local time-of-day calculation respond to the planet's rotation correctly.
      const playerWorldPos = new THREE.Vector3();
      player.getWorldPosition(playerWorldPos);
      tempPlayerDir.copy(playerWorldPos).normalize();

      // The fixed sun's position gives us a constant direction from the planet center.
      tempSunDir.copy(sunMesh.position).normalize();
      const sunDot = tempPlayerDir.dot(tempSunDir);

      // sunDot:   +1 = noon, 0 = horizon, -1 = midnight.
      const daylight = THREE.MathUtils.smoothstep(sunDot, -0.48, -0.10);
      const sunset = 1 - Math.min(1, Math.abs(sunDot) / 0.35);
      const night = THREE.MathUtils.smoothstep(-sunDot, 0.02, 0.42);

      // Fade the ambient fill down at night so the far side really becomes dark.
      ambientLight.intensity = THREE.MathUtils.lerp(0.08, 0.34, daylight);
      sunLight.intensity = THREE.MathUtils.lerp(0.03, 2.1, daylight);
      sunLight.color.copy(sunset > 0.05 && daylight < 0.55 ? new THREE.Color(0xff9b6a) : new THREE.Color(0xfff3d6));

      // Sky: blue in daytime, orange around the horizon, nearly black at night.
      tempSkyColor.copy(NIGHT_SKY).lerp(DAY_SKY, daylight);
      if (sunset > 0) tempSkyColor.lerp(SUNSET_SKY, sunset * 0.72);
      skyMat.color.copy(tempSkyColor);
      scene.background.copy(tempSkyColor);

      tempFogColor.copy(NIGHT_FOG).lerp(DAY_FOG, daylight);
      if (sunset > 0) tempFogColor.lerp(SUNSET_FOG, sunset * 0.7);
      sceneFog.color.copy(tempFogColor);

      // Stars are essentially invisible during the day and fully visible on the dark side.
      starMat.opacity = THREE.MathUtils.clamp(night * 1.15, 0, 1);
      cloudMat.opacity = THREE.MathUtils.lerp(0.01, 0.06, daylight);
    }

    // ---------- planet (terrain-deformed sphere) ----------
    // Everything physically attached to the planet lives in this group. Rotating the
    // group makes the planet turn beneath a fixed sun, so the day/night cycle is driven
    // by the planet rotating around its own axis rather than the sun orbiting the planet.
    const planetSystem = new THREE.Group();
    scene.add(planetSystem);

    const planetGeo = new THREE.SphereGeometry(PLANET_RADIUS, 128, 128);
    {
      const posAttr = planetGeo.attributes.position;
      const count = posAttr.count;
      const colorArr = new Float32Array(count * 3);
      const v = new THREE.Vector3();
      for (let i = 0; i < count; i++) {
        v.fromBufferAttribute(posAttr, i);
        const dir = v.clone().normalize();
        const h = heightAt(dir);
        v.copy(dir).multiplyScalar(PLANET_RADIUS + h);
        posAttr.setXYZ(i, v.x, v.y, v.z);
        const c = colorForHeight(h);
        colorArr[i * 3] = c.r;
        colorArr[i * 3 + 1] = c.g;
        colorArr[i * 3 + 2] = c.b;
      }
      planetGeo.setAttribute("color", new THREE.BufferAttribute(colorArr, 3));
      planetGeo.computeVertexNormals();
    }
    const planetMat = new THREE.MeshStandardMaterial({
      vertexColors: true, roughness: 0.95, metalness: 0.0,
    });
    planetSystem.add(new THREE.Mesh(planetGeo, planetMat));

    // ---------- water: river ----------
    const waterMat = new THREE.MeshStandardMaterial({
      color: 0x2f7fa8, roughness: 0.15, metalness: 0.05,
      transparent: true, opacity: 0.85, side: THREE.DoubleSide,
    });

    {
      const halfWidth = RIVER_FLAT_HALF_WIDTH * PLANET_RADIUS * 0.85; // stays inside the guaranteed-flat channel
      const angularHalfWidth = halfWidth / PLANET_RADIUS;
      const positions = [];
      const lastIndex = riverPoints.length - 1;
      for (let i = 0; i <= lastIndex; i++) {
        const dir = riverPoints[i];
        const prev = riverPoints[Math.max(0, i - 1)];
        const next = riverPoints[Math.min(lastIndex, i + 1)];
        const tangent = next.clone().sub(prev).normalize();
        const side = new THREE.Vector3().crossVectors(dir, tangent).normalize();

        // narrow the visible ribbon to nothing near the end, so it looks like the
        // water tapers away and disappears underground rather than just stopping dead
        const taper = riverEndTaper(i / lastIndex);
        const width = angularHalfWidth * Math.max(taper, 0.02);

        // sample the REAL terrain height at each bank's own position, not the centerline's —
        // this is what keeps the water sitting above the actual carved ground everywhere
        const leftDir = dir.clone().addScaledVector(side, width).normalize();
        const rightDir = dir.clone().addScaledVector(side, -width).normalize();
        const left = leftDir.clone().multiplyScalar(PLANET_RADIUS + heightAt(leftDir) + 0.4);
        const right = rightDir.clone().multiplyScalar(PLANET_RADIUS + heightAt(rightDir) + 0.4);
        positions.push(left.x, left.y, left.z, right.x, right.y, right.z);
      }
      const indices = [];
      for (let i = 0; i < lastIndex; i++) {
        const a = i * 2, b = i * 2 + 1, c = (i + 1) * 2, d = (i + 1) * 2 + 1;
        indices.push(a, b, c, b, d, c);
      }
      const riverGeo = new THREE.BufferGeometry();
      riverGeo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
      riverGeo.setIndex(indices);
      riverGeo.computeVertexNormals();
      planetSystem.add(new THREE.Mesh(riverGeo, waterMat));
    }

    // ---------- vegetation and rocks ----------
    // Trees now have separate trunks and canopies. Each tree gets a random size from
    // 1.5x to 4x the old canopy size, so the forest feels varied instead of stamped.
    const treeTrunkGeo = new THREE.CylinderGeometry(0.22, 0.30, 1.4, 7);
    const treeTrunkMat = new THREE.MeshStandardMaterial({ color: 0x6f4a2f, roughness: 1 });
    const treeLeafGeo = new THREE.ConeGeometry(0.6, 2.2, 6);
    const treeLeafMat = new THREE.MeshStandardMaterial({ color: 0x2c7a3d, roughness: 1 });
    const propGeoRock = new THREE.DodecahedronGeometry(0.5, 0);
    const propMatRock = new THREE.MeshStandardMaterial({ color: 0x8a8a86, roughness: 1 });

    // ---------- tiny vegetation ----------
    // Small grass and flowers are spread across the grassy parts of the planet to make
    // otherwise empty areas feel alive. They are deliberately kept short so they don't
    // compete visually with the much larger trees and mountains.
    const grassGeo = new THREE.ConeGeometry(0.055, 0.42, 4);
    const grassMat = new THREE.MeshStandardMaterial({ color: 0x3f9b45, roughness: 1 });

    // A tiny flower is made from a short stem plus a simple blossom. We use several
    // blossom materials so the planet gets little patches of different flower colors.
    const flowerStemGeo = new THREE.CylinderGeometry(0.025, 0.035, 0.34, 5);
    const flowerBloomGeo = new THREE.SphereGeometry(0.12, 6, 6);
    const flowerStemMat = new THREE.MeshStandardMaterial({ color: 0x3f8f43, roughness: 1 });
    const flowerMats = [
      new THREE.MeshStandardMaterial({ color: 0xffd166, roughness: 0.9 }),
      new THREE.MeshStandardMaterial({ color: 0xff8fab, roughness: 0.9 }),
      new THREE.MeshStandardMaterial({ color: 0xc9b6ff, roughness: 0.9 }),
      new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9 })
    ];

    function scatterGrass(count) {
      let placed = 0, attempts = 0;
      while (placed < count && attempts < count * 20) {
        attempts++;
        const dir = new THREE.Vector3(
          Math.random() * 2 - 1, Math.random() * 2 - 1, Math.random() * 2 - 1
        ).normalize();
        if (isWater(dir)) continue;
        const h = heightAt(dir);
        // Keep the grass on terrain that is still naturally grassy, including gentle hills.
        if (h > ROCK_LEVEL) continue;

        const grass = new THREE.Mesh(grassGeo, grassMat);
        const size = 0.65 + Math.random() * 0.85;
        grass.scale.set(size, size * (0.75 + Math.random() * 0.35), size);
        grass.position.copy(dir).multiplyScalar(PLANET_RADIUS + h + 0.18 * size);
        grass.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
        grass.rotateY(Math.random() * Math.PI * 2);
        planetSystem.add(grass);
        placed++;
      }
    }

    function scatterFlowers(count) {
      let placed = 0, attempts = 0;
      while (placed < count && attempts < count * 20) {
        attempts++;
        const dir = new THREE.Vector3(
          Math.random() * 2 - 1, Math.random() * 2 - 1, Math.random() * 2 - 1
        ).normalize();
        if (isWater(dir)) continue;
        const h = heightAt(dir);
        if (h > ROCK_LEVEL) continue;

        const flower = new THREE.Group();
        const stem = new THREE.Mesh(flowerStemGeo, flowerStemMat);
        const bloom = new THREE.Mesh(flowerBloomGeo, flowerMats[Math.floor(Math.random() * flowerMats.length)]);
        const size = 0.75 + Math.random() * 0.65;

        stem.position.y = 0.17 * size;
        bloom.position.y = 0.36 * size;
        stem.scale.setScalar(size);
        bloom.scale.setScalar(size * (0.8 + Math.random() * 0.25));
        flower.add(stem);
        flower.add(bloom);

        flower.position.copy(dir).multiplyScalar(PLANET_RADIUS + h + 0.02);
        flower.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
        flower.rotateY(Math.random() * Math.PI * 2);
        planetSystem.add(flower);
        placed++;
      }
    }

    // Enough grass and flowers to give the whole grassy planet a natural amount of detail.
    // They are intentionally much more numerous than the large trees, but remain tiny.
    scatterGrass(650);
    scatterFlowers(240);

    // Every tree is registered so the starter axe can identify nearby trees and remove them.
    // The size is stored as a gameplay value too: larger trees give proportionally more planks.
    const treeSpawns = worldState.trees;
    // Decorative boulders are also mineable. Each boulder can be mined once and yields 1 Stone.
    const rockSpawns = worldState.rocks;
    const ironOreSpawns = worldState.ironOres;
    const furnaces = worldState.furnaces;
    const launchPads = worldState.launchPads;
    const droppedItems = worldState.droppedItems;
    let activeFurnace = null;

    let furnaceSelectedSlot = 'fuel';
    let furnaceSmeltStartedAt = 0;
    // Furnace breaking state is shared through systemState.

    function createFurnaceObject(dir, yaw = Math.random() * Math.PI * 2) {
      const group = createFurnaceVisual(1.05);
      const h = heightAt(dir);
      group.position.copy(dir).multiplyScalar(PLANET_RADIUS + h + 0.32);
      group.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0), dir);
      group.rotateY(yaw);
      planetSystem.add(group);
      const furnace = { root: group, direction: dir.clone(), yaw, inventory: { fuel: null, input: null, output: null }, smeltStartedAt: 0 };
      furnaces.push(furnace);
      return furnace;
    }

    function createRocketEngineVisual(scale = 1) {
      const group = new THREE.Group();
      const silver = new THREE.MeshStandardMaterial({ color: 0x8f979d, roughness: 0.34, metalness: 0.72 });
      const dark = new THREE.MeshStandardMaterial({ color: 0x2d3236, roughness: 0.62, metalness: 0.55 });
      const copper = new THREE.MeshStandardMaterial({ color: 0xb86d43, roughness: 0.42, metalness: 0.72 });
      const body = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.52, 0.56, 12), silver);
      body.position.y = 0.42; group.add(body);
      const collar = new THREE.Mesh(new THREE.CylinderGeometry(0.43, 0.43, 0.12, 12), dark);
      collar.position.y = 0.16; group.add(collar);
      const nozzle = new THREE.Mesh(new THREE.ConeGeometry(0.25, 0.42, 12, 1, true), dark);
      nozzle.position.y = -0.08; group.add(nozzle);
      const throat = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.20, 0.08, 12), copper);
      throat.position.y = 0.63; group.add(throat);
      for (let i = 0; i < 6; i++) {
        const pipe = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.48, 6), copper);
        const a = i / 6 * Math.PI * 2;
        pipe.position.set(Math.cos(a) * 0.37, 0.42, Math.sin(a) * 0.37);
        pipe.rotation.z = 0.52; group.add(pipe);
      }
      const flame = new THREE.Mesh(new THREE.ConeGeometry(0.12, 0.32, 8), new THREE.MeshStandardMaterial({ color: 0xffb84d, emissive: 0xff7a21, emissiveIntensity: 0.65, roughness: 0.55 }));
      flame.position.y = -0.39; group.add(flame);
      group.scale.setScalar(scale); return group;
    }

    // Compact rocket icon/model used by inventory and dropped-item visuals.
    // Kept unchanged so the inventory appearance stays the same.
    function createRocketVisual(scale = 1) {
      const group = new THREE.Group();
      const bodyMat = new THREE.MeshStandardMaterial({ color: 0xe7edf2, roughness: 0.42, metalness: 0.08 });
      const noseMat = new THREE.MeshStandardMaterial({ color: 0xf06470, roughness: 0.45 });
      const windowMat = new THREE.MeshStandardMaterial({ color: 0x58c8ee, roughness: 0.28, metalness: 0.15, emissive: 0x0c3447, emissiveIntensity: 0.16 });
      const darkMat = new THREE.MeshStandardMaterial({ color: 0x3f444a, roughness: 0.7, metalness: 0.22 });
      const bodyGeo = (typeof THREE.CapsuleGeometry === 'function') ? new THREE.CapsuleGeometry(0.62, 1.18, 6, 12) : new THREE.CylinderGeometry(0.62, 0.62, 2.4, 12);
      const body = new THREE.Mesh(bodyGeo, bodyMat); body.position.y = 1.45; group.add(body);
      const nose = new THREE.Mesh(new THREE.ConeGeometry(0.63, 0.82, 12), noseMat); nose.position.y = 2.45; group.add(nose);
      const window = new THREE.Mesh(new THREE.CircleGeometry(0.18, 16), windowMat); window.position.set(0, 1.66, 0.61); group.add(window);
      for (const side of [-1, 1]) { const fin = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.72, 0.72), noseMat); fin.position.set(side * 0.60, 1.10, 0); fin.rotation.z = side * -0.30; group.add(fin); }
      const housing = new THREE.Mesh(new THREE.CylinderGeometry(0.50, 0.50, 0.24, 12), darkMat); housing.position.y = 0.23; group.add(housing);
      const flame = new THREE.Mesh(new THREE.ConeGeometry(0.22, 0.54, 10), new THREE.MeshStandardMaterial({ color: 0xffc34d, emissive: 0xff7628, emissiveIntensity: 0.7, roughness: 0.5 })); flame.position.y = -0.18; group.add(flame);
      group.scale.setScalar(scale); return group;
    }

    // Full-size mounted rocket. This is deliberately separate from createRocketVisual so
    // improving the world model cannot change the inventory icon/drop model.
    function createMountedRocketVisual(scale = 1) {
      const group = new THREE.Group();
      const bodyMat = new THREE.MeshStandardMaterial({ color: 0xe9eef2, roughness: 0.48, metalness: 0.08 });
      const seamMat = new THREE.MeshStandardMaterial({ color: 0xc6cdd3, roughness: 0.55, metalness: 0.12 });
      const redMat = new THREE.MeshStandardMaterial({ color: 0xf05b67, roughness: 0.48 });
      const redDarkMat = new THREE.MeshStandardMaterial({ color: 0xb93d49, roughness: 0.55 });
      const glassMat = new THREE.MeshStandardMaterial({ color: 0x58c8ee, roughness: 0.22, metalness: 0.18, emissive: 0x0b3142, emissiveIntensity: 0.18 });
      const darkMat = new THREE.MeshStandardMaterial({ color: 0x34393e, roughness: 0.72, metalness: 0.35 });

      // Broad cylindrical fuselage with a slightly narrower lower section, matching the
      // squat industrial proportions of the supplied reference.
      const lower = new THREE.Mesh(new THREE.CylinderGeometry(0.62, 0.56, 0.32, 16), darkMat);
      lower.position.y = 0.20;
      group.add(lower);
      const body = new THREE.Mesh(new THREE.CylinderGeometry(0.64, 0.64, 1.85, 16), bodyMat);
      body.position.y = 1.22;
      group.add(body);

      // Red rounded nose cap rather than a tall cone.
      const nose = new THREE.Mesh(new THREE.SphereGeometry(0.66, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2), redMat);
      nose.scale.y = 0.78;
      nose.position.y = 2.16;
      group.add(nose);

      // Thin body seam and a small dark collar between fuselage sections.
      const seam = new THREE.Mesh(new THREE.CylinderGeometry(0.65, 0.65, 0.035, 16), seamMat);
      seam.position.y = 1.58;
      group.add(seam);
      const collar = new THREE.Mesh(new THREE.CylinderGeometry(0.65, 0.65, 0.09, 16), darkMat);
      collar.position.y = 0.37;
      group.add(collar);

      // Large side window. It faces the same +Z direction as the inventory rocket.
      const window = new THREE.Mesh(new THREE.CircleGeometry(0.22, 18), glassMat);
      window.position.set(0, 1.48, 0.646);
      group.add(window);
      const windowRing = new THREE.Mesh(new THREE.TorusGeometry(0.225, 0.035, 8, 18), darkMat);
      windowRing.position.set(0, 1.48, 0.65);
      group.add(windowRing);

      // Chunkier swept fins, attached low on the fuselage.
      for (const side of [-1, 1]) {
        const fin = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.82, 0.62), redMat);
        fin.position.set(side * 0.64, 0.88, 0);
        fin.rotation.z = side * -0.34;
        fin.rotation.y = side * 0.06;
        group.add(fin);
        const finTip = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.34, 0.50), redDarkMat);
        finTip.position.set(side * 0.80, 0.67, 0);
        finTip.rotation.z = side * -0.60;
        group.add(finTip);
      }

      // A small rear engine throat and a restrained exhaust flame.
      const engine = new THREE.Mesh(new THREE.CylinderGeometry(0.38, 0.31, 0.22, 16), darkMat);
      engine.position.y = 0.01;
      group.add(engine);
      const nozzle = new THREE.Mesh(new THREE.ConeGeometry(0.28, 0.30, 12), darkMat);
      nozzle.position.y = -0.20;
      group.add(nozzle);
      const flame = new THREE.Mesh(new THREE.ConeGeometry(0.18, 0.42, 10), new THREE.MeshStandardMaterial({ color: 0xffc34d, emissive: 0xff7628, emissiveIntensity: 0.65, roughness: 0.52 }));
      flame.position.y = -0.49;
      group.add(flame);

      group.scale.setScalar(scale);
      return group;
    }

    function createLaunchPadVisual(scale = 1) {
      const group = new THREE.Group();
      const plateMat = new THREE.MeshStandardMaterial({ color: 0x8f969c, roughness: 0.42, metalness: 0.78 });
      const darkMat = new THREE.MeshStandardMaterial({ color: 0x3c4248, roughness: 0.58, metalness: 0.58 });
      const plate = new THREE.Mesh(new THREE.BoxGeometry(7.8, 0.18, 4.8), plateMat); plate.position.y = 0.09; group.add(plate);
      const inner = new THREE.Mesh(new THREE.BoxGeometry(6.65, 0.055, 3.65), darkMat); inner.position.y = 0.205; group.add(inner);
      for (const [x,z] of [[-3.25,-1.85],[3.25,-1.85],[-3.25,1.85],[3.25,1.85]]) { const bolt = new THREE.Mesh(new THREE.CylinderGeometry(0.11,0.11,0.05,10), new THREE.MeshStandardMaterial({ color:0xbfc6cc, roughness:0.3, metalness:0.9 })); bolt.position.set(x,0.22,z); group.add(bolt); }
      group.scale.setScalar(scale); return group;
    }

    function createLaunchPadObject(dir, yaw = Math.random() * Math.PI * 2) {
      const group = createLaunchPadVisual(1.0);
      const h = heightAt(dir);
      group.position.copy(dir).multiplyScalar(PLANET_RADIUS + h + 0.08);
      group.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0), dir);
      group.rotateY(yaw);
      planetSystem.add(group);
      const pad = { root: group, direction: dir.clone(), yaw, rocket: null, fuel: 0 };
      launchPads.push(pad);
      return pad;
    }

    function placeRocketOnLaunchPad(pad) {
      if (!pad || pad.rocket) return false;
      const root = createMountedRocketVisual(0.92);
      root.position.set(0, 0.18, 0);
      pad.root.add(root);
      pad.rocket = { root, pad };
      return true;
    }

    function findNearbyLaunchPad() {
      const cameraWorld = new THREE.Vector3();
      const lookDir = new THREE.Vector3();
      camera.getWorldPosition(cameraWorld);
      camera.getWorldDirection(lookDir).normalize();
      let best = null, bestScore = Infinity;
      for (const pad of launchPads) {
        if (!pad.root.visible) continue;
        const world = new THREE.Vector3();
        pad.root.getWorldPosition(world);
        const to = world.clone().sub(cameraWorld);
        const distance = to.length();
        if (distance > 5.4) continue;
        to.normalize();
        const facing = lookDir.dot(to);
        if (facing < -0.15) continue;
        const score = distance - facing * 0.7;
        if (score < bestScore) { bestScore = score; best = pad; }
      }
      return best;
    }

    function tryPlaceLaunchPad() {
      if (uiState.equippedItemType !== 'launch_pad' || state.gameState !== 'playing' || state.paused || uiState.inventoryOpen || uiState.craftingOpen || uiState.furnaceOpen) return false;
      const dir = getFurnacePlacementDirection();
      if (!isFurnacePlacementAreaClear(dir)) {
        const prompt = document.getElementById('crystalPrompt');
        prompt.classList.remove('hidden'); prompt.innerHTML = '<span class="promptKey">BLOCKED</span> Find a clear area to place the launch pad';
        return false;
      }
      const pad = createLaunchPadObject(dir);
      const idx = getSelectedHotbarInventoryIndex();
      if (!inventorySlots[idx] || inventorySlots[idx].typeId !== 'launch_pad') { pad.root.visible = false; launchPads.pop(); return false; }
      inventorySlots[idx] = null;
      refreshEquippedItem(); updateHotbarUI(); updateInventoryUI();
      const prompt = document.getElementById('crystalPrompt');
      prompt.classList.remove('hidden'); prompt.innerHTML = '<span class="promptKey">PLACED</span> Launch pad placed';
      setTimeout(() => { if (state.gameState === 'playing') updateCrystalPrompt(); }, 700);
      return true;
    }

    function tryPlaceRocketOnNearbyPad() {
      if (uiState.equippedItemType !== 'rocket' || state.gameState !== 'playing' || state.paused || uiState.inventoryOpen || uiState.craftingOpen || uiState.furnaceOpen) return false;
      const pad = findNearbyLaunchPad();
      if (!pad) return false;
      if (pad.rocket) {
        const prompt = document.getElementById('crystalPrompt'); prompt.classList.remove('hidden');
        prompt.innerHTML = '<span class="promptKey">FULL</span> This launch pad already has a rocket';
        return false;
      }
      const idx = getSelectedHotbarInventoryIndex();
      if (!inventorySlots[idx] || inventorySlots[idx].typeId !== 'rocket') return false;
      if (!placeRocketOnLaunchPad(pad)) return false;
      inventorySlots[idx] = null;
      refreshEquippedItem(); updateHotbarUI(); updateInventoryUI();
      const prompt = document.getElementById('crystalPrompt');
      prompt.classList.remove('hidden'); prompt.innerHTML = '<span class="promptKey">PLACED</span> Rocket mounted on launch pad';
      setTimeout(() => { if (state.gameState === 'playing') updateCrystalPrompt(); }, 700);
      return true;
    }

    function findNearbySpaceObject() {
      const pad = findNearbyLaunchPad();
      if (!pad) return null;
      if (pad.rocket) return { type: 'rocket', target: pad.rocket, pad };
      return { type: 'launch_pad', target: pad, pad };
    }

    function createDroppedItemVisual(typeId) {
      const group = new THREE.Group();
      const item = itemById[typeId];
      if (!item) return group;
      if (item.tool) {
        let toolVisual = null;
        if (item.kind === 'axe') {
          const headType = item.ironTool ? 'iron' : item.stoneTool ? 'stone' : item.id === 'wooden_axe' ? 'wood' : 'metal';
          toolVisual = createAxeVisual(0.50, headType);
        } else if (item.kind === 'pickaxe') {
          const headType = item.ironTool ? 'iron' : item.stoneTool ? 'stone' : 'wood';
          toolVisual = createPickaxeVisual(0.50, headType);
        }
        if (toolVisual) { toolVisual.rotation.z = 0.35; group.add(toolVisual); }
      } else if (typeId === 'furnace') {
        group.add(createFurnaceVisual(0.58));
      } else if (typeId === 'rocket_engine') {
        group.add(createRocketEngineVisual(0.62));
      } else if (typeId === 'rocket') {
        group.add(createRocketVisual(0.42));
      } else if (typeId === 'launch_pad') {
        group.add(createLaunchPadVisual(0.55));
      } else if (typeId === 'jerrycan') {
        group.add(createJerrycanVisual(0.72));
      } else if (item.kind === 'crystal' && crystalById[typeId]) {
        group.add(createCrystalVisual(typeId, false, 0.72));
      } else {
        let color = item.css || '#a0a5aa';
        let geo = new THREE.BoxGeometry(0.28, 0.20, 0.28);
        if (typeId === 'iron_ore' || typeId === 'stone') geo = new THREE.DodecahedronGeometry(0.22, 0);
        else if (typeId === 'planks') geo = new THREE.BoxGeometry(0.34, 0.16, 0.24);
        else if (typeId === 'sticks') geo = new THREE.CylinderGeometry(0.045, 0.045, 0.32, 8);
        else if (typeId === 'iron_ingot') { geo = new THREE.BoxGeometry(0.34, 0.11, 0.17); color = '#666c72'; }
        const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: new THREE.Color(color), roughness: 0.8, metalness: 0.05 }));
        if (typeId === 'sticks') mesh.rotation.z = Math.PI / 2;
        group.add(mesh);
      }
      group.userData.dropType = typeId;
      return group;
    }

    function spawnDroppedItem(typeId, count = 1) {
      // Place the drop a small, walkable distance in front of the player.
      // The previous implementation mixed world-unit offsets into a normalized
      // planet direction, which could throw the item dozens of units away on
      // the planet's surface.
      const playerDir = player.position.clone().normalize();
      const look = new THREE.Vector3();
      camera.getWorldDirection(look).normalize();
      const tangent = look.sub(playerDir.clone().multiplyScalar(look.dot(playerDir)));
      if (tangent.lengthSq() < 0.0001) tangent.set(1, 0, 0);
      tangent.normalize();

      const dropDistance = 1.25;
      const surfaceOffset = playerDir.clone().multiplyScalar(0.01).add(tangent.multiplyScalar(dropDistance / PLANET_RADIUS));
      const offsetDir = playerDir.clone().add(surfaceOffset).normalize();
      const h = heightAt(offsetDir);
      const groundPos = offsetDir.clone().multiplyScalar(PLANET_RADIUS + h + 0.30);

      const group = createDroppedItemVisual(typeId);
      group.position.copy(groundPos);
      group.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0), offsetDir);
      group.rotateY(Math.random() * Math.PI * 2);
      planetSystem.add(group);

      const drop = {
        root: group,
        typeId,
        count,
        direction: offsetDir.clone(),
        basePosition: groundPos.clone(),
        bob: Math.random() * Math.PI * 2
      };
      droppedItems.push(drop);
      return drop;
    }

    function findNearbyDroppedItem() {
      let best = null, bestDistSq = Infinity;
      for (const drop of droppedItems) {
        if (!drop.root.visible) continue;
        const d2 = player.position.distanceToSquared(drop.root.position);
        if (d2 <= 2.0 * 2.0 && d2 < bestDistSq) { bestDistSq = d2; best = drop; }
      }
      return best;
    }

    function findNearbyFurnace() {
      const cameraWorld = new THREE.Vector3();
      const lookDir = new THREE.Vector3();
      camera.getWorldPosition(cameraWorld);
      camera.getWorldDirection(lookDir).normalize();
      let best = null, bestScore = Infinity;
      for (const furnace of furnaces) {
        const world = new THREE.Vector3();
        furnace.root.getWorldPosition(world);
        const to = world.clone().sub(cameraWorld);
        const distance = to.length();
        if (distance > 4.2) continue;
        to.normalize();
        const facing = lookDir.dot(to);
        if (facing < 0.20) continue;
        const score = distance - facing;
        if (score < bestScore) { bestScore = score; best = furnace; }
      }
      return best;
    }

    function isFurnacePlacementAreaClear(dir) {
      const world = dir.clone().multiplyScalar(PLANET_RADIUS + heightAt(dir));
      for (const tree of treeSpawns) {
        if (!tree.chopped && tree.root.visible && tree.root.getWorldPosition(new THREE.Vector3()).distanceTo(world) < 2.2) return false;
      }
      for (const rock of rockSpawns.concat(ironOreSpawns)) {
        if (!rock.mined && rock.root.visible && rock.root.getWorldPosition(new THREE.Vector3()).distanceTo(world) < 2.0) return false;
      }
      for (const crystal of crystalSpawns) {
        if (!crystal.collected && crystal.root.visible && crystal.root.getWorldPosition(new THREE.Vector3()).distanceTo(world) < 1.6) return false;
      }
      for (const furnace of furnaces) {
        const fw = furnace.root.getWorldPosition(new THREE.Vector3());
        if (fw.distanceTo(world) < 2.2) return false;
      }
      for (const pad of launchPads) {
        if (pad.root.visible) {
          const pw = pad.root.getWorldPosition(new THREE.Vector3());
          if (pw.distanceTo(world) < 4.4) return false;
        }
      }
      return true;
    }

    function getFurnacePlacementDirection() {
      const playerDir = player.position.clone().normalize();
      const look = new THREE.Vector3();
      camera.getWorldDirection(look).normalize();
      const tangent = look.sub(playerDir.clone().multiplyScalar(look.dot(playerDir)));
      if (tangent.lengthSq() < 0.0001) tangent.set(1,0,0);
      tangent.normalize();
      const distance = 2.7;
      return playerDir.clone().multiplyScalar(PLANET_RADIUS).add(tangent.multiplyScalar(distance)).normalize();
    }

    function tryPlaceFurnace() {
      if (uiState.equippedItemType !== 'furnace' || state.gameState !== 'playing' || state.paused || uiState.inventoryOpen || uiState.craftingOpen || uiState.furnaceOpen) return false;
      const dir = getFurnacePlacementDirection();
      if (!isFurnacePlacementAreaClear(dir)) {
        const prompt = document.getElementById('crystalPrompt');
        prompt.classList.remove('hidden'); prompt.innerHTML = '<span class="promptKey">BLOCKED</span> Find a clear area to place the furnace';
        return false;
      }
      const furnace = createFurnaceObject(dir);
      const current = getCurrentToolSlot();
      // Furnace is a stack-1 inventory item, so remove exactly one from the selected hotbar slot.
      const idx = getSelectedHotbarInventoryIndex();
      if (inventorySlots[idx] && inventorySlots[idx].typeId === 'furnace') inventorySlots[idx] = null;
      else {
        for (let i=0;i<INVENTORY_SLOT_COUNT;i++) if (inventorySlots[i] && inventorySlots[i].typeId === 'furnace') { inventorySlots[i]=null; break; }
      }
      refreshEquippedItem(); updateHotbarUI(); updateInventoryUI();
      const prompt = document.getElementById('crystalPrompt');
      prompt.classList.remove('hidden'); prompt.innerHTML = '<span class="promptKey">PLACED</span> Furnace placed';
      setTimeout(() => { if (state.gameState === 'playing') updateCrystalPrompt(); }, 700);
      return true;
    }

    function scatterTrees(count) {
      let placed = 0, attempts = 0;
      while (placed < count && attempts < count * 20) {
        attempts++;
        const dir = new THREE.Vector3(
          Math.random() * 2 - 1, Math.random() * 2 - 1, Math.random() * 2 - 1
        ).normalize();
        if (isWater(dir)) continue;
        const h = heightAt(dir);
        if (h > ROCK_LEVEL) continue;

        const tree = new THREE.Group();
        const size = 1.5 + Math.random() * 2.5; // 1.5x..4x the original tree size
        const trunk = new THREE.Mesh(treeTrunkGeo, treeTrunkMat);
        const leaves = new THREE.Mesh(treeLeafGeo, treeLeafMat);

        // Keep the whole tree standing on the surface, with the trunk underneath the canopy.
        trunk.position.y = 0.7 * size;
        leaves.position.y = 2.0 * size;
        trunk.scale.setScalar(size);
        leaves.scale.setScalar(size);
        tree.add(trunk);
        tree.add(leaves);

        tree.position.copy(dir).multiplyScalar(PLANET_RADIUS + h);
        tree.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
        const yaw = Math.random() * Math.PI * 2;
        tree.rotateY(yaw);
        planetSystem.add(tree);
        treeSpawns.push({
          root: tree,
          direction: dir.clone(),
          size,
          yaw,
          chopped: false
        });
        placed++;
      }
    }

    function scatterRocks(count) {
      let placed = 0, attempts = 0;
      while (placed < count && attempts < count * 20) {
        attempts++;
        const dir = new THREE.Vector3(
          Math.random() * 2 - 1, Math.random() * 2 - 1, Math.random() * 2 - 1
        ).normalize();
        if (isWater(dir)) continue;
        const h = heightAt(dir);
        const mesh = new THREE.Mesh(propGeoRock, propMatRock);
        mesh.position.copy(dir).multiplyScalar(PLANET_RADIUS + h + 0.25);
        mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
        mesh.rotateY(Math.random() * Math.PI * 2);
        planetSystem.add(mesh);
        rockSpawns.push({
          root: mesh,
          direction: dir.clone(),
          mined: false,
          oreType: 'stone'
        });
        placed++;
      }
    }

    function scatterIronOre(count = 24) {
      let placed = 0, attempts = 0;
      while (placed < count && attempts < count * 35) {
        attempts++;
        const dir = new THREE.Vector3(
          Math.random() * 2 - 1, Math.random() * 2 - 1, Math.random() * 2 - 1
        ).normalize();
        if (isWater(dir)) continue;
        const h = heightAt(dir);
        // Iron appears on rocky mountain slopes and peaks, not on the low grassy terrain.
        if (h < ROCK_LEVEL) continue;
        if (Math.random() > 0.38) continue;

        const group = new THREE.Group();
        const base = new THREE.Mesh(propGeoRock, new THREE.MeshStandardMaterial({ color: 0x8a8d90, roughness: 1 }));
        group.add(base);

        const patchMat = new THREE.MeshStandardMaterial({ color: 0x44474b, roughness: 1 });
        const patchGeo = new THREE.DodecahedronGeometry(0.16, 0);
        const patchData = [
          [-0.18, 0.18, 0.23, 1.15],
          [0.20, 0.10, 0.17, 0.95],
          [0.02, 0.28, -0.18, 0.85]
        ];
        for (const [x,y,z,scale] of patchData) {
          const patch = new THREE.Mesh(patchGeo, patchMat);
          patch.position.set(x, y, z);
          patch.scale.setScalar(scale);
          group.add(patch);
        }

        group.position.copy(dir).multiplyScalar(PLANET_RADIUS + h + 0.25);
        group.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
        group.rotateY(Math.random() * Math.PI * 2);
        planetSystem.add(group);
        ironOreSpawns.push({ root: group, direction: dir.clone(), mined: false, oreType: 'iron_ore' });
        placed++;
      }
    }

    scatterTrees(260);
    scatterRocks(190);
    scatterIronOre(24);

    // ---------- collectible crystals ----------
    // Each crystal type has a unique display color. The inventory stores how many have
    // been collected, while these world objects remain at their original spawn points.
    const CRYSTAL_TYPES = [
      { id: "ruby",     name: "Ruby",     color: 0xe53935, css: "#e53935" }, // red
      { id: "topaz",    name: "Topaz",    color: 0xf28c28, css: "#f28c28" }, // orange
      { id: "jasper",   name: "Jasper",   color: 0xf4d35e, css: "#f4d35e" }, // yellow
      { id: "emerald",  name: "Emerald",  color: 0x28b463, css: "#28b463" }, // green
      { id: "diamond",  name: "Diamond",  color: 0x63c5da, css: "#63c5da" }, // sky blue
      { id: "lapis",    name: "Lapis",    color: 0x3867d6, css: "#3867d6" }, // blue
      { id: "amethyst", name: "Amethyst", color: 0x8e5bd6, css: "#8e5bd6" }, // purple
      { id: "onyx",     name: "Onyx",     color: 0x17191d, css: "#17191d" }  // black
    ];
    const crystalById = Object.fromEntries(CRYSTAL_TYPES.map(t => [t.id, t]));

    // Inventory items share one small data table so the same 12-slot UI can hold crystals,
    // the starter axe, and the wooden planks produced by chopping trees.
    // Most tools use 20 durability; stone tools are sturdier with 40.
    const TOOL_MAX_DURABILITY = 20;
    const STONE_TOOL_MAX_DURABILITY = 40;
    const IRON_TOOL_MAX_DURABILITY = 60;
    const ITEM_TYPES = [
      ...CRYSTAL_TYPES.map(t => ({ id: t.id, name: t.name, kind: 'crystal', color: t.color, css: t.css, maxStack: 10 })),
      { id: 'axe', name: 'Starter Axe', kind: 'axe', maxStack: 1, tool: true },
      { id: 'wooden_axe', name: 'Wooden Axe', kind: 'axe', maxStack: 1, tool: true },
      { id: 'wooden_pickaxe', name: 'Wooden Pickaxe', kind: 'pickaxe', maxStack: 1, tool: true },
      { id: 'stone_axe', name: 'Stone Axe', kind: 'axe', maxStack: 1, tool: true, stoneTool: true },
      { id: 'stone_pickaxe', name: 'Stone Pickaxe', kind: 'pickaxe', maxStack: 1, tool: true, stoneTool: true },
      { id: 'iron_axe', name: 'Iron Axe', kind: 'axe', maxStack: 1, tool: true, ironTool: true },
      { id: 'iron_pickaxe', name: 'Iron Pickaxe', kind: 'pickaxe', maxStack: 1, tool: true, ironTool: true },
      { id: 'planks', name: 'Planks', kind: 'planks', css: '#c88748', maxStack: 10 },
      { id: 'sticks', name: 'Sticks', kind: 'sticks', css: '#b9824c', maxStack: 10 },
      { id: 'stone', name: 'Stone', kind: 'stone', css: '#8a929a', maxStack: 10 },
      { id: 'iron_ore', name: 'Iron Ore', kind: 'iron_ore', css: '#767a7f', maxStack: 10 },
      { id: 'iron_ingot', name: 'Iron Ingot', kind: 'iron_ingot', css: '#5b6167', maxStack: 10 },
      { id: 'furnace', name: 'Furnace', kind: 'furnace', maxStack: 1 },
      { id: 'rocket_engine', name: 'Rocket Engine', kind: 'engine', maxStack: 1 },
      { id: 'rocket', name: 'Rocket', kind: 'rocket', maxStack: 1 },
      { id: 'launch_pad', name: 'Launch Pad', kind: 'launch_pad', maxStack: 1 },
      { id: 'jerrycan', name: 'Jerrycan (Full)', kind: 'jerrycan', maxStack: 1 }
    ];
    const itemById = Object.fromEntries(ITEM_TYPES.map(t => [t.id, t]));
    const SELL_PRICES = Object.freeze({
      ruby: 50, topaz: 40, jasper: 38, emerald: 65, diamond: 150, lapis: 55, amethyst: 85, onyx: 120,
      axe: 20, wooden_axe: 35, wooden_pickaxe: 35, stone_axe: 55, stone_pickaxe: 55, iron_axe: 100, iron_pickaxe: 115,
      planks: 3, sticks: 2, stone: 2, iron_ore: 12, iron_ingot: 30, furnace: 75, rocket_engine: 220, rocket: 500, launch_pad: 150, jerrycan: 80
    });
    const BUY_PRICES = Object.freeze({
      ruby: 100, topaz: 80, jasper: 76, emerald: 130, diamond: 300, lapis: 110, amethyst: 170, onyx: 240,
      rocket_engine: 600, launch_pad: 400, jerrycan: 250
    });

    const ROCKET_FUEL_CAPACITY = 100;
    const ROCKET_FUEL_TIME_MS = 5000;
    const ROCKET_ATMOSPHERE_RADIUS = 180;
    const ROCKET_FLIGHT_SPEED = 28;
    const ROCKET_VERTICAL_SPEED = 24;
    const ROCKET_GRAVITY = GRAVITY;


    function getToolMaxDurability(itemOrTypeId) {
      const item = typeof itemOrTypeId === 'string' ? itemById[itemOrTypeId] : itemOrTypeId;
      if (item && item.ironTool) return IRON_TOOL_MAX_DURABILITY;
      return item && item.stoneTool ? STONE_TOOL_MAX_DURABILITY : TOOL_MAX_DURABILITY;
    }

    // One reusable faceted shard geometry is enough because the color communicates which
    // crystal it is. A tiny three-shard cluster makes each collectible read as a crystal.
    const crystalShardGeo = new THREE.OctahedronGeometry(0.28, 0);
    const crystalGhostGeo = new THREE.OctahedronGeometry(0.31, 0);

    // Build the visible model used both for world crystals and for the held item model.
    // `ghost` switches the material to a faint wireframe silhouette for collected crystals.
    function createCrystalVisual(typeId, ghost = false, scale = 1) {
      const data = crystalById[typeId];
      const group = new THREE.Group();
      const shardGeo = ghost ? crystalGhostGeo : crystalShardGeo;
      const material = ghost
        ? new THREE.MeshBasicMaterial({
            color: data.color,
            wireframe: true,
            transparent: true,
            opacity: 0.26,
            depthWrite: false,
            depthTest: true
          })
        : new THREE.MeshStandardMaterial({
            color: data.color,
            roughness: 0.35,
            metalness: 0.05,
            emissive: data.color,
            emissiveIntensity: 0.08
          });

      const main = new THREE.Mesh(shardGeo, material);
      main.scale.set(0.95, 1.75, 0.95);
      main.position.y = 0.52;
      group.add(main);

      const sideA = new THREE.Mesh(shardGeo, material.clone ? material.clone() : material);
      sideA.scale.set(0.65, 1.18, 0.65);
      sideA.position.set(-0.22, 0.34, 0.06);
      sideA.rotation.z = -0.36;
      group.add(sideA);

      const sideB = new THREE.Mesh(shardGeo, material.clone ? material.clone() : material);
      sideB.scale.set(0.58, 1.05, 0.58);
      sideB.position.set(0.20, 0.30, -0.03);
      sideB.rotation.z = 0.31;
      group.add(sideB);

      group.scale.setScalar(scale);
      return group;
    }

    // ---------- crystal merchant stall ----------
    // A permanent decorative market stall sits a short distance from the player's spawn.
    // It is part of the rotating planetSystem, so the same stall is visible in both the
    // playable world and the main-menu planet preview.
    function createStallCrate(filledTypeId = null) {
      const crate = new THREE.Group();
      const wood = new THREE.MeshStandardMaterial({ color: 0x9b6338, roughness: 0.92 });
      const woodDark = new THREE.MeshStandardMaterial({ color: 0x674026, roughness: 0.98 });
      const inside = new THREE.MeshStandardMaterial({ color: 0x2b1c14, roughness: 1 });

      const body = new THREE.Mesh(new THREE.BoxGeometry(1.18, 0.72, 0.92), wood);
      body.position.y = 0.36;
      crate.add(body);

      const inner = new THREE.Mesh(new THREE.BoxGeometry(0.90, 0.10, 0.64), inside);
      inner.position.y = 0.75;
      crate.add(inner);

      const rimPieces = [
        [1.02, 0.14, 0.08, 0, 0.83, -0.39],
        [1.02, 0.14, 0.08, 0, 0.83,  0.39],
        [0.08, 0.14, 0.76, -0.55, 0.83, 0],
        [0.08, 0.14, 0.76,  0.55, 0.83, 0]
      ];
      for (const [sx, sy, sz, x, y, z] of rimPieces) {
        const rim = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), woodDark);
        rim.position.set(x, y, z);
        crate.add(rim);
      }

      // Cross braces make the containers read clearly as wooden crates from the menu distance.
      const braceFront = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.62, 0.06), woodDark);
      braceFront.position.set(0, 0.40, -0.47);
      braceFront.rotation.z = 0.18;
      crate.add(braceFront);
      const braceFront2 = braceFront.clone();
      braceFront2.rotation.z = -0.18;
      crate.add(braceFront2);

      if (filledTypeId) {
        const crystal = createCrystalVisual(filledTypeId, false, 0.58);
        crystal.position.y = 0.72;
        crystal.rotation.y = Math.random() * Math.PI * 2;
        crate.add(crystal);
      }

      return crate;
    }

    function createCrystalStall() {
      const stall = new THREE.Group();
      stall.name = 'CrystalMerchantStall';
      // Collision footprint for the whole stall.  The physical model is larger than the
      // player, so a simple oriented box keeps the player from walking through the stand.
      stall.userData.collision = { halfX: 4.62, halfZ: 1.82, padding: 0.48 };

      const wood = new THREE.MeshStandardMaterial({ color: 0x8a5632, roughness: 0.9 });
      const woodLight = new THREE.MeshStandardMaterial({ color: 0xb97b45, roughness: 0.88 });
      const clothLight = new THREE.MeshStandardMaterial({ color: 0xf0dfbd, roughness: 0.95 });
      const clothDark = new THREE.MeshStandardMaterial({ color: 0x2f78b7, roughness: 0.92 });
      const signMat = new THREE.MeshStandardMaterial({ color: 0x6f4527, roughness: 0.92 });
      const black = new THREE.MeshStandardMaterial({ color: 0x090a0d, roughness: 0.92 });

      // Upright posts and top frame.
      const postGeo = new THREE.CylinderGeometry(0.11, 0.13, 3.15, 8);
      const postPositions = [
        [-4.35, 1.58, -1.55], [4.35, 1.58, -1.55],
        [-4.35, 1.58,  1.55], [4.35, 1.58,  1.55]
      ];
      for (const [x, y, z] of postPositions) {
        const post = new THREE.Mesh(postGeo, wood);
        post.position.set(x, y, z);
        stall.add(post);
      }

      const topBeam = new THREE.Mesh(new THREE.BoxGeometry(9.05, 0.22, 3.35), wood);
      topBeam.position.y = 3.03;
      stall.add(topBeam);

      // Striped awning, split into broad alternating panels.
      const awning = new THREE.Group();
      const panelCount = 7;
      for (let i = 0; i < panelCount; i++) {
        const panel = new THREE.Mesh(
          new THREE.BoxGeometry(9.05 / panelCount + 0.015, 0.12, 3.55),
          i % 2 === 0 ? clothLight : clothDark
        );
        panel.position.set(-4.525 + (i + 0.5) * (9.05 / panelCount), 3.22, 0);
        panel.rotation.x = -0.035;
        awning.add(panel);
      }
      stall.add(awning);

      // Front canopy valance.
      const valance = new THREE.Mesh(new THREE.BoxGeometry(9.05, 0.48, 0.13), clothLight);
      valance.position.set(0, 2.91, -1.69);
      stall.add(valance);

      // Wooden counter.
      const counterLegGeo = new THREE.BoxGeometry(0.28, 1.35, 0.28);
      for (const x of [-3.8, 3.8]) {
        for (const z of [-1.15, 1.15]) {
          const leg = new THREE.Mesh(counterLegGeo, wood);
          leg.position.set(x, 0.68, z);
          stall.add(leg);
        }
      }
      const counterBase = new THREE.Mesh(new THREE.BoxGeometry(8.55, 0.18, 2.55), wood);
      counterBase.position.y = 1.36;
      stall.add(counterBase);
      const counterTop = new THREE.Mesh(new THREE.BoxGeometry(8.75, 0.18, 2.72), woodLight);
      counterTop.position.y = 1.50;
      stall.add(counterTop);

      // Eight crates: four different crystal types, four empty.
      const stockedTypes = ['ruby', 'emerald', 'diamond', 'amethyst'];
      const crateZ = [-0.70, 0.70];
      const crateX = [-3.25, -1.08, 1.08, 3.25];
      for (let row = 0; row < 2; row++) {
        for (let col = 0; col < 4; col++) {
          const isStocked = row === 0;
          const typeId = isStocked ? stockedTypes[col] : null;
          const crate = createStallCrate(typeId);
          crate.position.set(crateX[col], 1.58, crateZ[row]);
          crate.rotation.y = (col - 1.5) * 0.025 + (row ? -0.025 : 0.025);
          stall.add(crate);
        }
      }

      // A small sign on the front gives the stall some identity without adding UI interaction.
      const sign = new THREE.Mesh(new THREE.BoxGeometry(3.1, 0.78, 0.12), signMat);
      sign.position.set(0, 2.20, -1.73);
      stall.add(sign);
      const signTextureCanvas = document.createElement('canvas');
      signTextureCanvas.width = 512;
      signTextureCanvas.height = 128;
      const ctx = signTextureCanvas.getContext('2d');
      ctx.fillStyle = '#6f4527';
      ctx.fillRect(0, 0, 512, 128);
      ctx.fillStyle = '#f4ead8';
      ctx.font = 'bold 56px Segoe UI, Arial, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('CRYSTALS', 256, 64);
      const signTexture = new THREE.CanvasTexture(signTextureCanvas);
      signTexture.anisotropy = renderer.capabilities.getMaxAnisotropy();
      const signFace = new THREE.Mesh(
        new THREE.PlaneGeometry(2.95, 0.74),
        new THREE.MeshStandardMaterial({ map: signTexture, roughness: 0.85 })
      );
      signFace.position.set(0, 2.20, -1.795);
      stall.add(signFace);

      // NPC uses the same capsule body geometry as the player, recolored black, with a black fedora.
      const npc = new THREE.Group();
      npc.name = 'CrystalMerchantNPC';
      const npcBodyGeo = (typeof THREE.CapsuleGeometry === 'function')
        ? new THREE.CapsuleGeometry(0.45, 1.0, 4, 8)
        : new THREE.CylinderGeometry(0.45, 0.45, 1.9, 8);
      const npcBody = new THREE.Mesh(npcBodyGeo, black);
      npcBody.position.y = 0.95;
      npc.add(npcBody);

      const hatBrim = new THREE.Mesh(new THREE.CylinderGeometry(0.62, 0.68, 0.10, 16), black);
      hatBrim.position.y = 1.95;
      npc.add(hatBrim);
      const hatCrown = new THREE.Mesh(new THREE.CylinderGeometry(0.44, 0.52, 0.54, 16), black);
      hatCrown.position.y = 2.24;
      npc.add(hatCrown);
      const hatBand = new THREE.Mesh(new THREE.CylinderGeometry(0.46, 0.46, 0.10, 16), new THREE.MeshStandardMaterial({ color: 0x15171b, roughness: 0.8 }));
      hatBand.position.y = 2.06;
      npc.add(hatBand);

      // Position the stall just beside spawn, with the NPC standing next to its right side.
      // A slight tangent offset keeps the merchant close to the starting area without covering the GPS pin.
      const stallDir = new THREE.Vector3(0.105, 1, 0).normalize();
      const groundRadius = PLANET_RADIUS + heightAt(stallDir);
      stall.position.copy(stallDir).multiplyScalar(groundRadius + 0.02);
      stall.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), stallDir);

      // Face the stall directly toward the spawn area while keeping its base level with
      // the spherical ground. Local +Y stays aligned to the surface normal.
      const spawnReferenceDir = new THREE.Vector3(0, 1, 0);
      const spawnTangent = spawnReferenceDir.clone().sub(stallDir.clone().multiplyScalar(spawnReferenceDir.dot(stallDir))).normalize();
      const stallRight = new THREE.Vector3().crossVectors(spawnTangent, stallDir).normalize();
      const stallBasis = new THREE.Matrix4().makeBasis(stallRight, stallDir, spawnTangent.clone().negate());
      stall.quaternion.setFromRotationMatrix(stallBasis);
      planetSystem.add(stall);

      const npcLocal = new THREE.Vector3(5.55, 0.02, -0.30);
      npc.position.copy(npcLocal);
      npc.scale.setScalar(0.76);
      stall.add(npc);

      // Keep a direct reference so the interaction system can reliably find the merchant.
      stall.userData.merchantNPC = npc;

      return stall;
    }


    const crystalStall = createCrystalStall();

    // ---------- merchant UI 3D preview ----------
    // The merchant preview is rendered in its own small scene so the in-world NPC model
    // can be shown inside the wooden shop UI without moving or duplicating the live merchant.
    const merchantPreviewCanvas = document.getElementById('merchantPreviewCanvas');
    let merchantPreviewRenderer = null;
    let merchantPreviewScene = null;
    let merchantPreviewCamera = null;
    let merchantPreviewModel = null;
    let merchantPreviewFrame = document.querySelector('.merchantPreviewFrame');
    let merchantPreviewAnimation = 0;

    function setupMerchantPreview() {
      if (!merchantPreviewCanvas || typeof THREE.WebGLRenderer !== 'function') return;
      merchantPreviewRenderer = new THREE.WebGLRenderer({
        canvas: merchantPreviewCanvas,
        antialias: true,
        alpha: true,
      });
      merchantPreviewRenderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      merchantPreviewRenderer.setClearColor(0x000000, 0);

      merchantPreviewScene = new THREE.Scene();
      merchantPreviewCamera = new THREE.PerspectiveCamera(28, 1, 0.1, 20);
      merchantPreviewCamera.position.set(0, 1.7, 8.0);
      merchantPreviewCamera.lookAt(0, 1.55, 0);

      const hemi = new THREE.HemisphereLight(0xffe8c4, 0x2b160b, 2.3);
      merchantPreviewScene.add(hemi);
      const key = new THREE.DirectionalLight(0xfff1d6, 3.2);
      key.position.set(3, 5, 4);
      merchantPreviewScene.add(key);
      const fill = new THREE.DirectionalLight(0xb98c62, 1.35);
      fill.position.set(-3, 2.5, 2);
      merchantPreviewScene.add(fill);

      merchantPreviewModel = crystalStall?.userData?.merchantNPC?.clone?.(true) || null;
      if (!merchantPreviewModel) return;
      merchantPreviewModel.position.set(0, 0, 0);
      merchantPreviewModel.rotation.set(0, Math.PI, 0);
      merchantPreviewModel.scale.setScalar(1.30);
      merchantPreviewScene.add(merchantPreviewModel);

      // A subtle wooden display plinth gives the character a grounded, shop-like presentation.
      const plinthMat = new THREE.MeshStandardMaterial({ color: 0x70431f, roughness: 0.88, metalness: 0.0 });
      const plinth = new THREE.Mesh(new THREE.CylinderGeometry(1.08, 1.16, 0.22, 40), plinthMat);
      plinth.position.y = 0.08;
      merchantPreviewScene.add(plinth);
      const ring = new THREE.Mesh(
        new THREE.TorusGeometry(0.94, 0.035, 8, 40),
        new THREE.MeshStandardMaterial({ color: 0xd5a15c, roughness: 0.5, metalness: 0.15 })
      );
      ring.rotation.x = Math.PI / 2;
      ring.position.y = 0.20;
      merchantPreviewScene.add(ring);

      resizeMerchantPreview();
      renderMerchantPreview();
    }

    function resizeMerchantPreview() {
      if (!merchantPreviewRenderer || !merchantPreviewCanvas || !merchantPreviewFrame) return;
      const width = Math.max(1, merchantPreviewFrame.clientWidth || 300);
      const height = Math.max(1, merchantPreviewFrame.clientHeight || 360);
      merchantPreviewRenderer.setSize(width, height, false);
      merchantPreviewCamera.aspect = width / height;
      merchantPreviewCamera.updateProjectionMatrix();
    }

    function renderMerchantPreview() {
      if (!merchantPreviewRenderer || !merchantPreviewScene || !merchantPreviewCamera) return;
      resizeMerchantPreview();
      if (merchantPreviewModel) {
        merchantPreviewModel.rotation.y += 0.0025;
      }
      merchantPreviewRenderer.render(merchantPreviewScene, merchantPreviewCamera);
      merchantPreviewAnimation = requestAnimationFrame(renderMerchantPreview);
    }

    setupMerchantPreview();

    // Every spawned crystal keeps a ghost at the exact same location. When it is picked up,
    // the solid model disappears, the ghost appears, and a respawn rotation target is stored.
    const crystalSpawns = worldState.crystals;
    const CRYSTALS_PER_TYPE = 6;
    const crystalPlacementUp = new THREE.Vector3(0, 1, 0);

    function spawnCrystal(typeId, dir) {
      const h = heightAt(dir);
      const base = new THREE.Group();
      const crystal = createCrystalVisual(typeId, false, 1.0);
      const ghost = createCrystalVisual(typeId, true, 1.04);

      // Put the crystal directly on the spherical terrain and align its local up direction
      // with the planet surface, just like the trees, grass, and flowers.
      base.position.copy(dir).multiplyScalar(PLANET_RADIUS + h + 0.02);
      base.quaternion.setFromUnitVectors(crystalPlacementUp, dir);

      base.add(crystal);
      base.add(ghost);
      ghost.visible = false;
      planetSystem.add(base);

      crystalSpawns.push({
        typeId,
        root: base,
        crystal,
        ghost,
        collected: false,
        respawnAtSpin: 0
      });
    }

    // Scatter the same number of each crystal so no color is artificially rarer at first.
    // They can occur on any non-water terrain, including rocky/snowy areas.
    for (const type of CRYSTAL_TYPES) {
      let placed = 0, attempts = 0;
      while (placed < CRYSTALS_PER_TYPE && attempts < CRYSTALS_PER_TYPE * 40) {
        attempts++;
        const dir = new THREE.Vector3(
          Math.random() * 2 - 1,
          Math.random() * 2 - 1,
          Math.random() * 2 - 1
        ).normalize();
        if (isWater(dir)) continue;
        spawnCrystal(type.id, dir);
        placed++;
      }
    }

    // ---------- player ----------
    const player = new THREE.Object3D();
    // Third-person camera heading is kept independent from the player's facing direction.
    // This prevents the classic feedback loop where the player turns toward movement, which
    // turns the camera, which changes movement direction again, causing uncontrollable spinning.
    const thirdPersonCameraForward = new THREE.Vector3(0, 0, -1);
    const thirdPersonCameraUp = new THREE.Vector3();
    const thirdPersonCameraRight = new THREE.Vector3();
    const thirdPersonCameraForwardPitched = new THREE.Vector3();
    const thirdPersonCameraTarget = new THREE.Vector3();
    const thirdPersonCameraDesired = new THREE.Vector3();
    const thirdPersonCameraLocalDesired = new THREE.Vector3();
    const thirdPersonCameraPlayerLocalOffset = new THREE.Vector3();
    const thirdPersonCameraPitchQuat = new THREE.Quaternion();
    const thirdPersonCameraYawQuat = new THREE.Quaternion();
    const spawnDir = new THREE.Vector3(0, 1, 0);
    player.position.copy(spawnDir).multiplyScalar(PLANET_RADIUS + heightAt(spawnDir) + EYE_HEIGHT);
    planetSystem.add(player);

    // ---------- spawn marker: small red GPS pin, visible only from the main-menu camera ----------
    const spawnPinGroup = new THREE.Group();
    const pinMat = new THREE.MeshStandardMaterial({ color: 0xe63946, roughness: 0.4, emissive: 0x4a0f13, emissiveIntensity: 0.5 });
    const pinHead = new THREE.Mesh(new THREE.SphereGeometry(2.1, 16, 16), pinMat);
    pinHead.position.y = 6.4;
    spawnPinGroup.add(pinHead);
    const pinNeedle = new THREE.Mesh(new THREE.ConeGeometry(1.0, 4.6, 16), pinMat);
    pinNeedle.position.y = 2.6;
    pinNeedle.rotation.x = Math.PI; // point the tip down at the ground
    spawnPinGroup.add(pinNeedle);
    const spawnGroundPos = spawnDir.clone().multiplyScalar(PLANET_RADIUS + heightAt(spawnDir));
    spawnPinGroup.position.copy(spawnGroundPos);
    spawnPinGroup.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), spawnDir);
    planetSystem.add(spawnPinGroup);

    // Build the map after the procedural planet and ore spawns exist.
    createMapPlanet();

    const capsuleGeo = (typeof THREE.CapsuleGeometry === "function")
      ? new THREE.CapsuleGeometry(0.45, 1.0, 4, 8)
      : new THREE.CylinderGeometry(0.45, 0.45, 1.9, 8);
    const capsuleMat = new THREE.MeshStandardMaterial({ color: 0xe0763c, roughness: 0.6 });
    const playerBody = new THREE.Mesh(capsuleGeo, capsuleMat);
    playerBody.position.set(0, -0.3, 0);
    playerBody.layers.set(1);
    player.add(playerBody);

    camera.position.copy(CAM_FIRST);
    camera.layers.enable(0);
    player.add(camera);

    // ---------- equipped item models ----------
    // Both the crystal and the starter axe use the same two hand positions. The first-person
    // model is attached to the camera; the third-person model hangs to the player's right.
    const heldCrystalFirstPerson = new THREE.Group();
    heldCrystalFirstPerson.position.set(0.72, -0.52, -1.08);
    heldCrystalFirstPerson.rotation.set(-0.25, -0.18, 0.12);
    camera.add(heldCrystalFirstPerson);

    const heldCrystalThirdPerson = new THREE.Group();
    heldCrystalThirdPerson.position.set(0.78, -0.05, 0.02);
    heldCrystalThirdPerson.rotation.set(-0.15, 0.10, 0.28);
    heldCrystalThirdPerson.layers.set(1);
    player.add(heldCrystalThirdPerson);

    function clearHeldItem(group) {
      while (group.children.length) group.remove(group.children[group.children.length - 1]);
    }

    function createAxeVisual(scale = 1, headType = 'metal') {
      const group = new THREE.Group();
      const handle = new THREE.Mesh(
        new THREE.CylinderGeometry(0.055, 0.075, 0.95, 8),
        new THREE.MeshStandardMaterial({ color: 0x8b5a32, roughness: 0.8 })
      );
      handle.rotation.z = -0.42;
      handle.position.y = -0.02;
      group.add(handle);

      const blade = new THREE.Mesh(
        new THREE.BoxGeometry(0.34, 0.24, 0.075),
        new THREE.MeshStandardMaterial({
          color: headType === 'wood' ? 0x6f4328 : (headType === 'stone' ? 0x9aa1a8 : (headType === 'iron' ? 0x4d5359 : 0xbcc3cb)),
          metalness: headType === 'metal' ? 0.55 : 0.05,
          roughness: headType === 'metal' ? 0.28 : 0.82
        })
      );
      blade.position.set(0.18, 0.40, 0);
      blade.rotation.z = -0.42;
      group.add(blade);

      group.scale.setScalar(scale);
      return group;
    }

    // Wooden pickaxe model used by both the first-person and third-person held-item views.
    function createPickaxeVisual(scale = 1, headType = 'wood') {
      const group = new THREE.Group();
      const handle = new THREE.Mesh(
        new THREE.CylinderGeometry(0.055, 0.075, 0.95, 8),
        new THREE.MeshStandardMaterial({ color: 0x8b5a32, roughness: 0.8 })
      );
      handle.rotation.z = -0.40;
      handle.position.y = -0.02;
      group.add(handle);

      const head = new THREE.Mesh(
        new THREE.BoxGeometry(0.52, 0.11, 0.075),
        new THREE.MeshStandardMaterial({
          color: headType === 'wood' ? 0x6f4328 : (headType === 'stone' ? 0x9aa1a8 : (headType === 'iron' ? 0x4d5359 : 0xbcc3cb)),
          metalness: headType === 'metal' ? 0.45 : 0.05,
          roughness: headType === 'metal' ? 0.32 : 0.82
        })
      );
      head.position.set(0.12, 0.38, 0);
      head.rotation.z = -0.12;
      group.add(head);

      group.scale.setScalar(scale);
      return group;
    }


    function createFurnaceVisual(scale = 1) {
      const group = new THREE.Group();
      const body = new THREE.Mesh(new THREE.BoxGeometry(0.95, 0.75, 0.85), new THREE.MeshStandardMaterial({ color: 0x5a5d60, roughness: 0.9, metalness: 0.08 }));
      body.position.y = 0.38;
      group.add(body);
      const roof = new THREE.Mesh(new THREE.BoxGeometry(1.02, 0.18, 0.92), new THREE.MeshStandardMaterial({ color: 0x4a4d50, roughness: 1 }));
      roof.position.y = 0.82;
      group.add(roof);
      const mouth = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.25, 0.12, 16), new THREE.MeshStandardMaterial({ color: 0x18191a, roughness: 1 }));
      mouth.rotation.x = Math.PI / 2;
      mouth.position.set(0, 0.42, 0.45);
      group.add(mouth);
      const glow = new THREE.Mesh(new THREE.SphereGeometry(0.10, 12, 12), new THREE.MeshStandardMaterial({ color: 0xd96b2b, emissive: 0xd96b2b, emissiveIntensity: 0.8, roughness: 0.7 }));
      glow.position.set(0, 0.42, 0.51);
      group.add(glow);
      group.scale.setScalar(scale);
      return group;
    }

    function createJerrycanVisual(scale = 1) {
      const group = new THREE.Group();
      const bodyMat = new THREE.MeshStandardMaterial({ color: 0xd0ad37, roughness: 0.7, metalness: 0.18 });
      const darkMat = new THREE.MeshStandardMaterial({ color: 0x4b4f54, roughness: 0.7, metalness: 0.45 });
      const body = new THREE.Mesh(new THREE.BoxGeometry(0.64, 0.82, 0.30), bodyMat);
      body.position.y = 0.42;
      body.rotation.z = -0.04;
      group.add(body);
      const top = new THREE.Mesh(new THREE.BoxGeometry(0.20, 0.22, 0.20), darkMat);
      top.position.set(0.12, 0.94, 0);
      group.add(top);
      const handle = new THREE.Mesh(new THREE.BoxGeometry(0.10, 0.46, 0.34), darkMat);
      handle.position.set(-0.06, 0.82, 0);
      group.add(handle);
      const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.66, 0.08, 0.32), darkMat);
      stripe.position.y = 0.43;
      group.add(stripe);
      group.scale.setScalar(scale);
      return group;
    }

    function setHeldItem(typeId) {
      clearHeldItem(heldCrystalFirstPerson);
      clearHeldItem(heldCrystalThirdPerson);
      if (!typeId) return;

      let fpModel;
      let tpModel;
      if (typeId === 'axe' || typeId === 'wooden_axe' || typeId === 'stone_axe' || typeId === 'iron_axe') {
        const headType = typeId === 'wooden_axe' ? 'wood' : (typeId === 'stone_axe' ? 'stone' : (typeId === 'iron_axe' ? 'iron' : 'metal'));
        fpModel = createAxeVisual(0.92, headType);
        tpModel = createAxeVisual(0.66, headType);
      } else if (typeId === 'wooden_pickaxe' || typeId === 'stone_pickaxe' || typeId === 'iron_pickaxe') {
        const headType = typeId === 'stone_pickaxe' ? 'stone' : (typeId === 'iron_pickaxe' ? 'iron' : 'wood');
        fpModel = createPickaxeVisual(0.92, headType);
        tpModel = createPickaxeVisual(0.66, headType);
      } else if (crystalById[typeId]) {
        fpModel = createCrystalVisual(typeId, false, 0.85);
        tpModel = createCrystalVisual(typeId, false, 0.58);
      } else if (typeId === 'jerrycan') {
        fpModel = createJerrycanVisual(0.85);
        tpModel = createJerrycanVisual(0.60);
      } else {
        return;
      }
      heldCrystalFirstPerson.add(fpModel);
      heldCrystalThirdPerson.add(tpModel);
      heldCrystalFirstPerson.visible = !playerState.thirdPerson;
      heldCrystalThirdPerson.visible = playerState.thirdPerson;
    }

    // ---------- flashlight ----------
    // A SpotLight gives the flashlight a focused cone. Both the light and its target
    // are children of the camera, so the beam follows the player's view automatically.
    const flashlight = new THREE.SpotLight(
      0xffffff, FLASHLIGHT_INTENSITY, FLASHLIGHT_DISTANCE, FLASHLIGHT_ANGLE, 0.55, 1.4
    );
    flashlight.position.set(0, -0.05, -0.15);
    const flashlightTarget = new THREE.Object3D();
    flashlightTarget.position.set(0, 0, -40);
    camera.add(flashlight);
    camera.add(flashlightTarget);
    flashlight.target = flashlightTarget;
    flashlight.visible = false;

    playerState.flashlightOn = false;

    function setFlashlight(on) {
      playerState.flashlightOn = on;
      flashlight.visible = on;
      flashlightStatus.classList.toggle('hidden', !on || state.gameState !== 'playing');
    }

    const orientation = new THREE.Quaternion();
    playerState.pitch = 0;
    playerState.thirdPerson = false;
    const targetCamPos = CAM_FIRST.clone();
    playerState.thirdPersonOrbitYaw = 0;
    playerState.thirdPersonOrbitPitch = 0.18;

    function toggleThirdPerson() {
      playerState.thirdPerson = !playerState.thirdPerson;
      if (playerState.thirdPerson) {
        playerState.thirdPersonOrbitYaw = Math.PI;
        playerState.thirdPersonOrbitPitch = 0.18;
        thirdPersonCameraForward.set(0, 0, -1).applyQuaternion(orientation);
        const up = thirdPersonCameraUp.copy(player.position).normalize();
        thirdPersonCameraForward.addScaledVector(up, -thirdPersonCameraForward.dot(up));
        if (thirdPersonCameraForward.lengthSq() < 0.00001) {
          thirdPersonCameraForward.set(0, 0, -1);
          thirdPersonCameraForward.addScaledVector(up, -thirdPersonCameraForward.dot(up));
        }
        thirdPersonCameraForward.normalize();
      }
      targetCamPos.copy(playerState.thirdPerson ? CAM_THIRD : CAM_FIRST);

      // Layer 0 is the first-person view; layer 1 contains the player body and
      // third-person held item model. Swap the camera layer so the player is
      // visible only in third person.
      if (playerState.thirdPerson) {
        camera.layers.enable(1);
        camera.layers.enable(0);
      } else {
        camera.layers.disable(1);
        camera.layers.enable(0);
      }

      heldCrystalFirstPerson.visible = !playerState.thirdPerson;
      heldCrystalThirdPerson.visible = playerState.thirdPerson;
    }

    playerState.heightOffset = 0;
    playerState.verticalVelocity = 0;

    playerState.stamina = STAMINA_MAX;
    playerState.exhausted = false;

    // The inventory is made of 12 real slots: 8 main slots (0-7) and 4 hotbar slots (8-11).
    // Every item obeys its own maxStack value: resources stack to 10, while tools stack to 1.
    const INVENTORY_SLOT_COUNT = window.PocketUniverseInventoryState.slotCount;
    const INVENTORY_MAIN_SLOTS = window.PocketUniverseInventoryState.mainSlotCount;
    const HOTBAR_SLOT_COUNT = window.PocketUniverseInventoryState.hotbarSlotCount;
    const MAX_CRYSTALS_PER_STACK = 10;
    const inventorySlots = window.PocketUniverseInventoryState.slots;

    function getHotbarInventoryIndex(hotbarIndex) {
      return INVENTORY_MAIN_SLOTS + hotbarIndex;
    }

    function getSelectedHotbarInventoryIndex() {
      return getHotbarInventoryIndex(uiState.selectedHotbarSlot);
    }

    function getFirstAvailableInventorySlot(typeId) {
      // First try to add to an existing stack of the same crystal type.
      for (let i = 0; i < INVENTORY_SLOT_COUNT; i++) {
        const slot = inventorySlots[i];
        const maxStack = getItemMaxStack(typeId);
        if (slot && slot.typeId === typeId && slot.count < maxStack) return i;
      }
      // If the existing stacks are full, look for a completely empty slot.
      for (let i = 0; i < INVENTORY_SLOT_COUNT; i++) {
        if (!inventorySlots[i]) return i;
      }
      return -1;
    }

    function getItemMaxStack(typeId) {
      const item = itemById[typeId];
      return item ? item.maxStack : 0;
    }

    function countItem(typeId) {
      return inventorySlots.reduce((sum, slot) => sum + (slot && slot.typeId === typeId ? slot.count : 0), 0);
    }

    function canAddItemToInventory(typeId, amount) {
      const item = itemById[typeId];
      if (!item || amount <= 0) return false;
      let capacity = 0;
      for (const slot of inventorySlots) {
        if (!slot) capacity += item.maxStack;
        else if (slot.typeId === typeId) capacity += Math.max(0, item.maxStack - slot.count);
      }
      return capacity >= amount;
    }

    function addItemToInventory(typeId, amount = 1, durability = null) {
      const item = itemById[typeId];
      if (!item || amount <= 0) return false;

      // Work out whether the full amount fits before changing anything, so chopping a tree
      // can fail safely without making the tree disappear when the inventory is too full.
      let capacity = 0;
      for (const slot of inventorySlots) {
        if (!slot) capacity += item.maxStack;
        else if (slot.typeId === typeId) capacity += Math.max(0, item.maxStack - slot.count);
      }
      if (capacity < amount) return false;

      let remaining = amount;
      for (let i = 0; i < INVENTORY_SLOT_COUNT && remaining > 0; i++) {
        const slot = inventorySlots[i];
        if (!slot || slot.typeId !== typeId || slot.count >= item.maxStack) continue;
        const moved = Math.min(remaining, item.maxStack - slot.count);
        slot.count += moved;
        remaining -= moved;
      }
      for (let i = 0; i < INVENTORY_SLOT_COUNT && remaining > 0; i++) {
        if (inventorySlots[i]) continue;
        const moved = Math.min(remaining, item.maxStack);
        inventorySlots[i] = {
          typeId,
          count: moved,
          ...(item.tool ? { durability: durability == null ? getToolMaxDurability(item) : Math.max(0, Math.min(getToolMaxDurability(item), Math.floor(durability))) } : {})
        };
        remaining -= moved;
      }
      updateHotbarUI();
      updateInventoryUI();
      refreshEquippedItem();
      return remaining === 0;
    }

    function hasItemType(typeId) {
      return inventorySlots.some(slot => slot && slot.typeId === typeId);
    }

    function selectHotbarSlot(index) {
      if (index < 0 || index >= HOTBAR_SLOT_COUNT) return;
      uiState.selectedHotbarSlot = index;
      const slot = inventorySlots[getSelectedHotbarInventoryIndex()];
      uiState.equippedItemType = slot ? slot.typeId : null;
      setHeldItem(uiState.equippedItemType);
      updateHotbarUI();
      if (uiState.inventoryOpen) updateInventoryUI();
    }

    function swapInventoryWithSelectedHotbar(slotIndex) {
      if (slotIndex < 0 || slotIndex >= INVENTORY_MAIN_SLOTS) return;
      const hotbarIndex = getSelectedHotbarInventoryIndex();
      const temp = inventorySlots[slotIndex];
      inventorySlots[slotIndex] = inventorySlots[hotbarIndex];
      inventorySlots[hotbarIndex] = temp;
      selectHotbarSlot(uiState.selectedHotbarSlot);
      updateInventoryUI();
    }

    function makeItemIconElement(typeId, className) {
      const data = itemById[typeId];
      const icon = document.createElement('div');
      icon.className = className + ' itemIcon ' + data.kind
        + ((typeId === 'wooden_axe' || typeId === 'wooden_pickaxe') ? ' woodenTool' : '')
        + ((typeId === 'stone_axe' || typeId === 'stone_pickaxe') ? ' stoneTool' : '')
        + ((typeId === 'iron_axe' || typeId === 'iron_pickaxe') ? ' ironTool' : '');
      if (data.kind === 'crystal') {
        icon.style.background = data.css;
        icon.style.boxShadow = '0 0 12px ' + data.css;
      }
      icon.title = data.name;
      return icon;
    }

    function updateHotbarUI() {
      const slots = document.querySelectorAll('.hotbarSlot');
      slots.forEach((slot, index) => {
        slot.classList.toggle('selected', index === uiState.selectedHotbarSlot);
        slot.innerHTML = '<div class="hotbarNumber">' + (index + 1) + '</div>';

        const inventorySlot = inventorySlots[getHotbarInventoryIndex(index)];
        if (inventorySlot) {
          slot.appendChild(makeItemIconElement(inventorySlot.typeId, 'hotbarGem'));
          const count = document.createElement('div');
          count.className = 'hotbarCount';
          count.textContent = inventorySlot.count;
          slot.appendChild(count);

          const itemInfo = itemById[inventorySlot.typeId];
          if (itemInfo.tool) {
            const durability = document.createElement('div');
            durability.className = 'toolDurability';
            const maxDurability = getToolMaxDurability(itemInfo);
            const d = Math.max(0, Math.min(maxDurability, inventorySlot.durability == null ? maxDurability : inventorySlot.durability));
            durability.style.setProperty('--durability', (d / maxDurability * 100) + '%');
            slot.appendChild(durability);
          }
        } else {
          const empty = document.createElement('div');
          empty.className = 'hotbarEmpty';
          empty.textContent = 'EMPTY';
          slot.appendChild(empty);
        }
      });
    }

    function updateInventoryUI() {
      const grid = document.getElementById('inventoryGrid');
      if (!grid) return;
      grid.innerHTML = '';

      for (let i = 0; i < INVENTORY_SLOT_COUNT; i++) {
        const slotData = inventorySlots[i];
        const slot = document.createElement('div');
        slot.className = 'inventorySlot' + (i >= INVENTORY_MAIN_SLOTS ? ' hotbarInventorySlot' : '');
        if (i === getSelectedHotbarInventoryIndex()) slot.classList.add('selectedHotbar');
        slot.title = i >= INVENTORY_MAIN_SLOTS
          ? 'Hotbar slot ' + (i - INVENTORY_MAIN_SLOTS + 1)
          : (slotData ? 'Click to swap with selected hotbar slot' : 'Empty inventory slot');

        if (slotData) {
          slot.appendChild(makeItemIconElement(slotData.typeId, 'inventoryGem'));

          const name = document.createElement('div');
          name.className = 'inventorySlotName';
          name.textContent = itemById[slotData.typeId].name;
          slot.appendChild(name);

          const count = document.createElement('div');
          count.className = 'inventoryStackCount';
          count.textContent = slotData.count;
          slot.appendChild(count);

          const itemInfo = itemById[slotData.typeId];
          if (itemInfo.tool) {
            const durability = document.createElement('div');
            durability.className = 'toolDurability';
            const maxDurability = getToolMaxDurability(itemInfo);
            const d = Math.max(0, Math.min(maxDurability, slotData.durability == null ? maxDurability : slotData.durability));
            durability.style.setProperty('--durability', (d / maxDurability * 100) + '%');
            slot.appendChild(durability);
          }
        } else {
          const empty = document.createElement('div');
          empty.className = 'inventoryEmptyLabel';
          empty.textContent = 'EMPTY';
          slot.appendChild(empty);
        }

        bindDragSlot(slot, { type: 'inventory', index: i });
        slot.addEventListener('click', () => {
          // A plain click on a hotbar slot still equips/selects it; item movement uses drag.
          if (i >= INVENTORY_MAIN_SLOTS && !lastDragMoved) {
            selectHotbarSlot(i - INVENTORY_MAIN_SLOTS);
          }
        });
        grid.appendChild(slot);
      }
    }

    // ---------- drag-and-drop inventory/furnace items ----------
    // Items can be click-held and dragged between inventory slots and furnace slots.
    // The destination highlights under the cursor, and releasing places/merges/swaps the item.
    let itemDrag = null;
    let lastDragMoved = false;
    let activeDragTargetEl = null;
    let hoveredItemRef = null;

    function getDragRefData(ref) {
      if (!ref) return null;
      if (ref.type === 'inventory') return inventorySlots[ref.index] || null;
      if (ref.type === 'furnace') return activeFurnace ? activeFurnace.inventory[ref.key] || null : null;
      return null;
    }

    function setDragRefData(ref, value) {
      if (ref.type === 'inventory') inventorySlots[ref.index] = value;
      else if (ref.type === 'furnace' && activeFurnace) activeFurnace.inventory[ref.key] = value;
    }

    function canDropItemOnRef(item, ref) {
      if (!item || !ref) return false;
      if (ref.type === 'inventory') return true;
      if (ref.type !== 'furnace' || !activeFurnace) return false;
      if (ref.key === 'fuel') return item.typeId === 'planks';
      if (ref.key === 'input') return item.typeId === 'iron_ore';
      if (ref.key === 'output') return item.typeId === 'iron_ingot';
      return false;
    }

    function refsEqual(a, b) {
      return !!a && !!b && a.type === b.type && (a.type === 'inventory' ? a.index === b.index : a.key === b.key);
    }

    function clearDragHighlight() {
      if (activeDragTargetEl) activeDragTargetEl.classList.remove('drag-over');
      activeDragTargetEl = null;
      document.querySelectorAll('.inventorySlot.drag-source, .furnaceSlot.drag-source').forEach(el => el.classList.remove('drag-source'));
    }

    function findDragTargetAt(x, y) {
      const el = document.elementFromPoint(x, y);
      if (!el) return { ref: null, el: null };
      const slotEl = el.closest && el.closest('.inventorySlot, .furnaceSlot');
      if (!slotEl) return { ref: null, el: null };
      if (slotEl.closest('#inventoryGrid')) {
        const index = Number(slotEl.dataset.inventoryIndex);
        if (Number.isInteger(index)) return { ref: { type: 'inventory', index }, el: slotEl };
      }
      if (slotEl.closest('#furnaceTop')) {
        const key = slotEl.dataset.furnaceKey;
        if (key) return { ref: { type: 'furnace', key }, el: slotEl };
      }
      if (slotEl.closest('#furnaceInventoryGrid')) {
        const index = Number(slotEl.dataset.inventoryIndex);
        if (Number.isInteger(index)) return { ref: { type: 'inventory', index }, el: slotEl };
      }
      return { ref: null, el: null };
    }

    function moveDraggedItem(sourceRef, targetRef) {
      if (!sourceRef || !targetRef || refsEqual(sourceRef, targetRef)) return false;
      const source = getDragRefData(sourceRef);
      if (!source) return false;
      const target = getDragRefData(targetRef);

      if (!canDropItemOnRef(source, targetRef)) return false;

      const sourceItem = itemById[source.typeId];
      if (!sourceItem) return false;

      // Merge compatible resource stacks first.
      if (target && target.typeId === source.typeId && sourceItem.maxStack > 1) {
        const space = Math.max(0, sourceItem.maxStack - target.count);
        if (space <= 0) return false;
        const moved = Math.min(space, source.count);
        target.count += moved;
        source.count -= moved;
        if (source.count <= 0) setDragRefData(sourceRef, null);
        return moved > 0;
      }

      // Empty destination: move the whole stack/tool.
      if (!target) {
        setDragRefData(targetRef, source);
        setDragRefData(sourceRef, null);
        return true;
      }

      // Filled destination: swap only when both items are valid for their new homes.
      if (!canDropItemOnRef(target, sourceRef)) return false;
      setDragRefData(sourceRef, target);
      setDragRefData(targetRef, source);
      return true;
    }

    function dropOneItemFromRef(ref) {
      const source = getDragRefData(ref);
      if (!source) return false;
      const typeId = source.typeId;
      source.count -= 1;
      if (source.count <= 0) setDragRefData(ref, null);
      spawnDroppedItem(typeId, 1);
      rerenderOpenItemUIs();
      if (uiState.furnaceOpen) startFurnaceSmeltingIfReady();
      return true;
    }

    function bindDragSlot(slotEl, ref) {
      slotEl.dataset.inventoryIndex = ref.type === 'inventory' ? String(ref.index) : '';
      if (ref.type === 'furnace') slotEl.dataset.furnaceKey = ref.key;
      slotEl.addEventListener('mouseenter', () => { hoveredItemRef = { ...ref }; });
      slotEl.addEventListener('mouseleave', () => { if (hoveredItemRef && refsEqual(hoveredItemRef, ref)) hoveredItemRef = null; });
      const hasItem = !!getDragRefData(ref);
      if (!hasItem) return;

      slotEl.style.cursor = 'grab';
      slotEl.addEventListener('mousedown', (e) => {
        if (e.button !== 0) return;
        if (state.gameState !== 'playing' || !uiState.inventoryOpen && !uiState.furnaceOpen) return;
        if (!getDragRefData(ref)) return;
        itemDrag = { sourceRef: { ...ref }, startX: e.clientX, startY: e.clientY, moved: false };
        lastDragMoved = false;
        slotEl.classList.add('drag-source');
        document.body.style.cursor = 'grabbing';
        e.preventDefault();
        e.stopPropagation();
      });
    }

    function rerenderOpenItemUIs() {
      if (uiState.inventoryOpen) updateInventoryUI();
      if (uiState.furnaceOpen) updateFurnaceUI();
      updateHotbarUI();
      refreshEquippedItem();
    }

    window.addEventListener('mousemove', (e) => {
      if (!itemDrag) return;
      const dx = e.clientX - itemDrag.startX;
      const dy = e.clientY - itemDrag.startY;
      if (!itemDrag.moved && Math.hypot(dx, dy) >= 5) itemDrag.moved = true;
      if (!itemDrag.moved) return;

      const found = findDragTargetAt(e.clientX, e.clientY);
      const source = getDragRefData(itemDrag.sourceRef);
      const validTarget = found.ref && !refsEqual(found.ref, itemDrag.sourceRef) && source && canDropItemOnRef(source, found.ref);
      if (activeDragTargetEl !== found.el) {
        if (activeDragTargetEl) activeDragTargetEl.classList.remove('drag-over');
        activeDragTargetEl = null;
        if (validTarget && found.el) {
          found.el.classList.add('drag-over');
          activeDragTargetEl = found.el;
        }
      }
    });

    window.addEventListener('mouseup', (e) => {
      if (!itemDrag || e.button !== 0) return;
      const drag = itemDrag;
      itemDrag = null;
      lastDragMoved = !!drag.moved;
      clearDragHighlight();
      document.body.style.cursor = 'default';

      if (!drag.moved) return;
      const found = findDragTargetAt(e.clientX, e.clientY);
      if (!found.ref || refsEqual(found.ref, drag.sourceRef)) return;
      if (moveDraggedItem(drag.sourceRef, found.ref)) {
        rerenderOpenItemUIs();
        startFurnaceSmeltingIfReady();
      } else {
        rerenderOpenItemUIs();
      }
      setTimeout(() => { lastDragMoved = false; }, 0);
    });

    window.addEventListener('blur', () => {
      if (!itemDrag) return;
      itemDrag = null;
      lastDragMoved = false;
      clearDragHighlight();
      document.body.style.cursor = 'default';
    });

    function resetInventory() {
      for (let i = 0; i < INVENTORY_SLOT_COUNT; i++) inventorySlots[i] = null;
      uiState.selectedHotbarSlot = 0;
      uiState.equippedItemType = null;
      clearHeldItem(heldCrystalFirstPerson);
      clearHeldItem(heldCrystalThirdPerson);
      // A brand-new player always starts with one simple axe in inventory slot 0.
      inventorySlots[INVENTORY_MAIN_SLOTS] = { typeId: 'axe', count: 1, durability: TOOL_MAX_DURABILITY };
      uiState.selectedHotbarSlot = 0;
      refreshEquippedItem();
      updateHotbarUI();
      updateInventoryUI();
    }

    function refreshEquippedItem() {
      const selected = inventorySlots[getSelectedHotbarInventoryIndex()];
      uiState.equippedItemType = selected ? selected.typeId : null;
      setHeldItem(uiState.equippedItemType);
    }


    function sortInventoryResources() {
      const resources = {};
      const tools = [];
      for (const slot of inventorySlots) {
        if (!slot) continue;
        const item=itemById[slot.typeId];
        if (item && item.tool) tools.push(slot);
        else if (item && item.maxStack>1) resources[slot.typeId]=(resources[slot.typeId]||0)+slot.count;
        else tools.push(slot);
      }
      const rebuilt=Array(INVENTORY_SLOT_COUNT).fill(null);
      let idx=0;
      // Resource stacks first, keeping identical resources together.
      for (const item of ITEM_TYPES) {
        const count=resources[item.id]||0;
        if (!count) continue;
        let rem=count;
        while (rem>0 && idx<INVENTORY_SLOT_COUNT) { const moved=Math.min(rem,item.maxStack); rebuilt[idx++]={typeId:item.id,count:moved}; rem-=moved; }
      }
      for (const tool of tools) { if (idx<INVENTORY_SLOT_COUNT) rebuilt[idx++]=tool; }
      for (let i=0;i<INVENTORY_SLOT_COUNT;i++) inventorySlots[i]=rebuilt[i];
      // Keep the selected hotbar item selected by moving the first stack back to hotbar if needed.
      uiState.selectedHotbarSlot=0;
      refreshEquippedItem(); updateHotbarUI(); updateInventoryUI();
      if (uiState.furnaceOpen) updateFurnaceUI();
    }
    // ---------- inventory window ----------
    function openInventory() {
      if (state.gameState !== 'playing' || uiState.craftingOpen || playerState.inRocket) return;
      uiState.inventoryOpen = true;
      state.paused = true;
      for (const k in systemState.keys) systemState.keys[k] = false;
      clearPhysicalKeys();
      updateInventoryUI();
      document.getElementById('inventoryOverlay').classList.remove('hidden');
      pauseOverlay.classList.add('hidden');
      removeCraftTooltip();
      if (document.pointerLockElement === canvas) document.exitPointerLock();
    }

    function closeInventory() {
      uiState.inventoryOpen = false;
      document.getElementById('inventoryOverlay').classList.add('hidden');
      if (state.gameState === 'playing') {
        state.paused = false;
        attemptPointerLock();
      }
    }

    function toggleInventory() {
      if (uiState.craftingOpen) return;
      if (uiState.inventoryOpen) closeInventory();
      else openInventory();
    }

    // ---------- crafting ----------
    const CRAFTING_RECIPES = [
      {
        id: 'sticks',
        name: 'Sticks',
        ingredients: [{ typeId: 'planks', count: 2 }],
        output: { typeId: 'sticks', count: 4 }
      },
      {
        id: 'wooden_axe',
        name: 'Wooden Axe',
        ingredients: [{ typeId: 'sticks', count: 2 }, { typeId: 'planks', count: 3 }],
        output: { typeId: 'wooden_axe', count: 1 }
      },
      {
        id: 'wooden_pickaxe',
        name: 'Wooden Pickaxe',
        ingredients: [{ typeId: 'sticks', count: 2 }, { typeId: 'planks', count: 3 }],
        output: { typeId: 'wooden_pickaxe', count: 1 }
      },
      {
        id: 'stone_axe',
        name: 'Stone Axe',
        ingredients: [{ typeId: 'sticks', count: 2 }, { typeId: 'stone', count: 3 }],
        output: { typeId: 'stone_axe', count: 1 }
      },
      {
        id: 'stone_pickaxe',
        name: 'Stone Pickaxe',
        ingredients: [{ typeId: 'sticks', count: 2 }, { typeId: 'stone', count: 3 }],
        output: { typeId: 'stone_pickaxe', count: 1 }
      }

      ,{
        id: 'furnace',
        name: 'Furnace',
        ingredients: [{ typeId: 'stone', count: 5 }, { typeId: 'planks', count: 3 }],
        output: { typeId: 'furnace', count: 1 }
      },
      {
        id: 'rocket_engine',
        name: 'Rocket Engine',
        ingredients: [{ typeId: 'iron_ingot', count: 5 }, { typeId: 'sticks', count: 2 }, { typeId: 'stone', count: 1 }],
        output: { typeId: 'rocket_engine', count: 1 }
      },
      {
        id: 'rocket',
        name: 'Rocket',
        ingredients: [{ typeId: 'rocket_engine', count: 1 }, { typeId: 'iron_ingot', count: 5 }, { typeId: 'ruby', count: 2 }],
        output: { typeId: 'rocket', count: 1 }
      },
      {
        id: 'launch_pad',
        name: 'Launch Pad',
        ingredients: [{ typeId: 'iron_ingot', count: 3 }],
        output: { typeId: 'launch_pad', count: 1 }
      },
      {
        id: 'iron_axe',
        name: 'Iron Axe',
        ingredients: [{ typeId: 'sticks', count: 2 }, { typeId: 'iron_ingot', count: 3 }],
        output: { typeId: 'iron_axe', count: 1 }
      },
      {
        id: 'iron_pickaxe',
        name: 'Iron Pickaxe',
        ingredients: [{ typeId: 'sticks', count: 2 }, { typeId: 'iron_ingot', count: 3 }],
        output: { typeId: 'iron_pickaxe', count: 1 }
      }
    ];

    let craftingPage = 0;
    const CRAFTING_PAGE_SIZE = 20;
    const craftingOverlay = document.getElementById('craftingOverlay');
    const craftingRecipesEl = document.getElementById('craftingRecipes');
    const craftingStatusEl = document.getElementById('craftingStatus');
    const craftingClose = document.getElementById('craftingClose');
    const craftingNextPage = document.getElementById('craftingNextPage');
    const inventoryCraftButton = document.getElementById('inventoryCraftButton');
    let craftTooltipEl = null;

    function hasCraftingIngredients(recipe) {
      return recipe.ingredients.every(input => countItem(input.typeId) >= input.count);
    }

    function canCraft(recipe) {
      // Freeplay ignores ingredient costs, but inventory space still matters.
      if (state.gameMode === "freeplay") return canAddItemToInventory(recipe.output.typeId, recipe.output.count);
      if (!hasCraftingIngredients(recipe)) return false;
      return canAddItemToInventory(recipe.output.typeId, recipe.output.count);
    }

    function removeItemsFromInventory(typeId, amount) {
      let remaining = amount;
      for (let i = 0; i < INVENTORY_SLOT_COUNT && remaining > 0; i++) {
        const slot = inventorySlots[i];
        if (!slot || slot.typeId !== typeId) continue;
        const taken = Math.min(remaining, slot.count);
        slot.count -= taken;
        remaining -= taken;
        if (slot.count <= 0) inventorySlots[i] = null;
      }
      return remaining === 0;
    }

    function craftRecipe(recipe) {
      if (!canCraft(recipe)) {
        craftingStatusEl.textContent = state.gameMode === "freeplay"
          ? 'Not enough inventory space.'
          : (hasCraftingIngredients(recipe) ? 'Not enough inventory space.' : 'You do not have the required materials.');
        return;
      }

      // Survival consumes ingredients; Freeplay creates the item at zero cost.
      if (state.gameMode !== "freeplay") {
        for (const input of recipe.ingredients) removeItemsFromInventory(input.typeId, input.count);
      }
      const craftedItem = itemById[recipe.output.typeId];
      addItemToInventory(recipe.output.typeId, recipe.output.count, craftedItem.tool ? getToolMaxDurability(craftedItem) : null);

      const outputName = itemById[recipe.output.typeId].name;
      craftingStatusEl.textContent = 'Crafted ' + recipe.output.count + ' × ' + outputName + '.';
      updateCraftingUI();
      updateInventoryUI();
      refreshEquippedItem();
    }

    function createCraftTooltip(recipe, event) {
      removeCraftTooltip();
      const tooltip = document.createElement('div');
      tooltip.className = 'craftTooltip';
      const name = document.createElement('div');
      name.className = 'tooltipName';
      name.textContent = recipe.name;
      const ingredients = document.createElement('div');
      ingredients.className = 'tooltipIngredients';
      ingredients.textContent = state.gameMode === 'freeplay'
        ? 'FREE · no materials required'
        : recipe.ingredients.map(input => input.count + ' × ' + itemById[input.typeId].name).join(' + ');
      tooltip.appendChild(name);
      tooltip.appendChild(ingredients);
      document.body.appendChild(tooltip);
      craftTooltipEl = tooltip;
      moveCraftTooltip(event);
    }

    function moveCraftTooltip(event) {
      if (!craftTooltipEl) return;
      const pad = 12;
      const rect = craftTooltipEl.getBoundingClientRect();
      const x = Math.min(window.innerWidth - rect.width - pad, event.clientX + 14);
      const y = Math.min(window.innerHeight - rect.height - pad, event.clientY + 14);
      craftTooltipEl.style.left = Math.max(pad, x) + 'px';
      craftTooltipEl.style.top = Math.max(pad, y) + 'px';
    }

    function removeCraftTooltip() {
      if (craftTooltipEl) {
        craftTooltipEl.remove();
        craftTooltipEl = null;
      }
    }

    function updateCraftingUI() {
      if (!craftingRecipesEl) return;
      craftingRecipesEl.innerHTML = '';
      const pageCount = Math.max(1, Math.ceil(CRAFTING_RECIPES.length / CRAFTING_PAGE_SIZE));
      craftingPage = Math.max(0, Math.min(craftingPage, pageCount - 1));
      const start = craftingPage * CRAFTING_PAGE_SIZE;
      const recipesOnPage = CRAFTING_RECIPES.slice(start, start + CRAFTING_PAGE_SIZE);

      for (let slotIndex = 0; slotIndex < CRAFTING_PAGE_SIZE; slotIndex++) {
        const recipe = recipesOnPage[slotIndex];
        const card = document.createElement('div');
        card.className = 'craftRecipe';

        if (recipe) {
          const canMake = canCraft(recipe);
          if (!canMake) card.classList.add('disabled');
          card.appendChild(makeItemIconElement(recipe.output.typeId, 'inventoryGem'));

          const count = document.createElement('div');
          count.className = 'craftCount';
          count.textContent = recipe.output.count;
          card.appendChild(count);

          card.addEventListener('mouseenter', (e) => createCraftTooltip(recipe, e));
          card.addEventListener('mousemove', moveCraftTooltip);
          card.addEventListener('mouseleave', removeCraftTooltip);
          card.addEventListener('click', () => {
            removeCraftTooltip();
            craftRecipe(recipe);
          });
        } else {
          card.style.cursor = 'default';
          card.setAttribute('aria-hidden', 'true');
        }
        craftingRecipesEl.appendChild(card);
      }

      craftingNextPage.disabled = pageCount <= 1;
      craftingNextPage.textContent = '›';
      craftingNextPage.title = pageCount > 1 ? 'Next page' : 'No more pages';
    }

    function openCrafting() {
      if (state.gameState !== 'playing' || playerState.inRocket) return;
      uiState.craftingOpen = true;
      craftingPage = 0;
      state.paused = true;
      for (const k in systemState.keys) systemState.keys[k] = false;
      clearPhysicalKeys();
      craftingStatusEl.textContent = '';
      updateCraftingUI();
      craftingOverlay.classList.remove('hidden');
      document.getElementById('inventoryOverlay').classList.add('hidden');
      uiState.inventoryOpen = false;
      removeCraftTooltip();
      if (document.pointerLockElement === canvas) document.exitPointerLock();
    }

    function closeCrafting() {
      removeCraftTooltip();
      uiState.craftingOpen = false;
      craftingOverlay.classList.add('hidden');
      craftingStatusEl.textContent = '';
      if (state.gameState === 'playing') {
        state.paused = false;
        openInventory();
      }
    }

    function toggleCrafting() {
      if (uiState.craftingOpen) closeCrafting();
      else openCrafting();
    }


    function renderFurnaceSlot(el, data, label) {
      el.innerHTML = '<div class="furnaceSlotLabel">' + label + '</div>';
      if (data) {
        el.appendChild(makeItemIconElement(data.typeId, 'inventoryGem'));
        const count = document.createElement('div'); count.className='furnaceCount'; count.textContent=data.count; el.appendChild(count);
      }
      const key = label === 'Fuel' ? 'fuel' : label === 'Smelt' ? 'input' : 'output';
      el.classList.remove('selected');
      el.dataset.furnaceKey = key;
      bindDragSlot(el, { type: 'furnace', key });
      el.title = data ? 'Drag this item to an inventory slot' : 'Drop a valid item here';
    }

    function updateFurnaceUI() {
      const fuelEl=document.getElementById('furnaceFuelSlot'), inputEl=document.getElementById('furnaceInputSlot'), outEl=document.getElementById('furnaceOutputSlot');
      if (!fuelEl) return;
      renderFurnaceSlot(fuelEl, activeFurnace ? activeFurnace.inventory.fuel : null, 'Fuel');
      renderFurnaceSlot(inputEl, activeFurnace ? activeFurnace.inventory.input : null, 'Smelt');
      renderFurnaceSlot(outEl, activeFurnace ? activeFurnace.inventory.output : null, 'Output');
      const grid=document.getElementById('furnaceInventoryGrid'); grid.innerHTML='';
      for (let i=0;i<INVENTORY_SLOT_COUNT;i++) {
        const data=inventorySlots[i];
        const slot=document.createElement('div'); slot.className='inventorySlot';
        if (data) { slot.appendChild(makeItemIconElement(data.typeId,'inventoryGem')); const n=document.createElement('div'); n.className='inventoryStackCount'; n.textContent=data.count; slot.appendChild(n); }
        else { const e=document.createElement('div'); e.className='inventoryEmptyLabel'; e.textContent='EMPTY'; slot.appendChild(e); }
        bindDragSlot(slot, { type: 'inventory', index: i });
        slot.title = data ? 'Drag this item to another slot' : 'Drop an item here';
        grid.appendChild(slot);
      }
      const status=document.getElementById('furnaceStatus');
      if (!activeFurnace) { status.textContent=''; return; }
      const fuel=activeFurnace.inventory.fuel, input=activeFurnace.inventory.input, output=activeFurnace.inventory.output;
      if (input && input.typeId==='iron_ore' && fuel && fuel.typeId==='planks' && (!output || (output.typeId==='iron_ingot' && output.count<10))) {
        const pct=activeFurnace && activeFurnace.smeltStartedAt ? Math.min(100, ((performance.now()-activeFurnace.smeltStartedAt)/2000)*100) : 0;
        status.textContent='Smelting Iron Ore… ' + Math.round(pct) + '%';
      } else status.textContent='1 Plank + 1 Iron Ore → 1 Iron Ingot';
    }

    function swapFurnaceWithInventory(index) {
      if (!activeFurnace || index < 0 || index >= INVENTORY_SLOT_COUNT) return;
      const key = furnaceSelectedSlot;
      const inventoryItem = inventorySlots[index];
      const furnaceItem = activeFurnace.inventory[key];

      // Validate the item BEFORE swapping it into the furnace. The previous version
      // checked the inventory slot after replacing it with the furnace's old item,
      // which meant valid fuel/ore was always rejected and immediately swapped back.
      const validForSlot = !inventoryItem ||
        (key === 'fuel' && inventoryItem.typeId === 'planks') ||
        (key === 'input' && inventoryItem.typeId === 'iron_ore') ||
        (key === 'output' && inventoryItem.typeId === 'iron_ingot');
      if (!validForSlot) {
        const status = document.getElementById('furnaceStatus');
        if (status) {
          status.textContent = key === 'fuel' ? 'Only Planks can be used as fuel' :
            key === 'input' ? 'Only Iron Ore can be smelted here' :
            'Only Iron Ingots can be taken from the output slot';
        }
        return;
      }

      // Swap the selected furnace slot with the clicked inventory slot.
      inventorySlots[index] = furnaceItem;
      activeFurnace.inventory[key] = inventoryItem;

      updateFurnaceUI();
      updateHotbarUI();
      updateInventoryUI();
      startFurnaceSmeltingIfReady();
    }

    function furnaceCanSmelt(furnace) {
      if (!furnace) return false;
      const f=furnace.inventory;
      return !!(f.fuel && f.fuel.typeId==='planks' && f.fuel.count>0 &&
        f.input && f.input.typeId==='iron_ore' && f.input.count>0 &&
        (!f.output || (f.output.typeId==='iron_ingot' && f.output.count<10)));
    }

    function startFurnaceSmeltingIfReady() {
      if (activeFurnace && furnaceCanSmelt(activeFurnace) && !activeFurnace.smeltStartedAt) {
        activeFurnace.smeltStartedAt=performance.now();
      }
    }

    function updateAllFurnaceSmelting() {
      const now=performance.now();
      for (const furnace of furnaces) {
        if (!furnaceCanSmelt(furnace)) { furnace.smeltStartedAt=0; continue; }
        if (!furnace.smeltStartedAt) furnace.smeltStartedAt=now;
        if (now-furnace.smeltStartedAt < 2000) continue;
        const f=furnace.inventory;
        f.fuel.count--; if (f.fuel.count<=0) f.fuel=null;
        f.input.count--; if (f.input.count<=0) f.input=null;
        if (!f.output) f.output={typeId:'iron_ingot',count:1}; else f.output.count++;
        furnace.smeltStartedAt=0;
      }
      if (uiState.furnaceOpen) updateFurnaceUI();
    }

    function openFurnace(furnace) {
      if (!furnace || state.gameState!=='playing') return;
      activeFurnace=furnace; uiState.furnaceOpen=true; state.paused=true; furnaceSelectedSlot='fuel';
      document.getElementById('furnaceOverlay').classList.remove('hidden');
      if (document.pointerLockElement===canvas) document.exitPointerLock();
      updateFurnaceUI(); startFurnaceSmeltingIfReady();
    }
    function closeFurnace() {
      uiState.furnaceOpen=false; activeFurnace=null; document.getElementById('furnaceOverlay').classList.add('hidden');
      if (state.gameState==='playing') { state.paused=false; attemptPointerLock(); }
    }
    // ---------- HUD ----------
    const staminaBarEl = document.getElementById("staminaBar");
    function updateStaminaBar() {
      const pct = Math.max(0, Math.min(100, playerState.stamina));
      staminaBarEl.style.width = pct + "%";
      let color = "#6fcf97";
      if (playerState.exhausted) color = "#eb5757";
      else if (pct < 35) color = "#f2c94c";
      staminaBarEl.style.background = color;
    }

    // ---------- home screen, pause overlay, settings modal ----------
    const homeScreen = document.getElementById("homeScreen");
    const homeLoading = document.getElementById("homeLoading");
    const homeButtons = document.getElementById("homeButtons");
    const playButton = document.getElementById("playButton");
    const homeSettingsButton = document.getElementById("homeSettingsButton");
    const loadGameButton = document.getElementById("loadGameButton");
    const saveFileInput = document.getElementById("saveFileInput");
    const pauseOverlay = document.getElementById("pauseOverlay");
    const settingsModal = document.getElementById("settingsModal");
    const settingsClose = document.getElementById("settingsClose");
    const transitionFade = document.getElementById("transitionFade");
    const controlsToggle = document.getElementById("controlsToggle");
    const flashlightStatus = document.getElementById("flashlightStatus");
    const rocketFlightStatus = document.getElementById("rocketFlightStatus");
    const rocketFlightFuel = document.getElementById("rocketFlightFuel");
    const rocketFlightMode = document.getElementById("rocketFlightMode");

    document.getElementById('inventorySortButton').addEventListener('click', (e) => { e.stopPropagation(); sortInventoryResources(); });
    inventoryCraftButton.addEventListener('click', (e) => { e.stopPropagation(); openCrafting(); });
    craftingNextPage.addEventListener('click', (e) => {
      e.stopPropagation();
      const pageCount = Math.max(1, Math.ceil(CRAFTING_RECIPES.length / CRAFTING_PAGE_SIZE));
      if (pageCount <= 1) return;
      craftingPage = (craftingPage + 1) % pageCount;
      craftingStatusEl.textContent = '';
      updateCraftingUI();
    });
    craftingClose.addEventListener('click', (e) => { e.stopPropagation(); closeCrafting(); });
    craftingOverlay.addEventListener('click', (e) => {
      if (e.target === craftingOverlay) closeCrafting();
    });

    document.querySelectorAll('.hotbarSlot').forEach((slot, index) => {
      slot.addEventListener('click', () => selectHotbarSlot(index));
    });

    function openSettings() {
      settingsModal.classList.remove("hidden");
      if (document.pointerLockElement === canvas) document.exitPointerLock();
    }
    function closeSettings() {
      settingsModal.classList.add("hidden");
    }
    settingsClose.addEventListener("click", (e) => { e.stopPropagation(); closeSettings(); });
    settingsModal.addEventListener("click", (e) => {
      if (e.target === settingsModal) closeSettings();
    });
    homeSettingsButton.addEventListener("click", (e) => { e.stopPropagation(); openSettings(); });
    controlsToggle.addEventListener("click", (e) => { e.stopPropagation(); openSettings(); });

    // ---------- merchant / credits / rocket fuel ----------
    const merchantOverlay = document.getElementById('merchantOverlay');
    const merchantDialogue = document.getElementById('merchantDialogue');
    const merchantSellSection = document.getElementById('merchantSellSection');
    const merchantBuySection = document.getElementById('merchantBuySection');
    const merchantSellList = document.getElementById('merchantSellList');
    const merchantBuyList = document.getElementById('merchantBuyList');
    const merchantSellName = document.getElementById('merchantSellName');
    const merchantSellOwned = document.getElementById('merchantSellOwned');
    const merchantSellPrice = document.getElementById('merchantSellPrice');
    const merchantSellQuantity = document.getElementById('merchantSellQuantity');
    const merchantSellTotal = document.getElementById('merchantSellTotal');
    const merchantSellButton = document.getElementById('merchantSellButton');
    const merchantStatus = document.getElementById('merchantStatus');
    const merchantClose = document.getElementById('merchantClose');
    const creditsDisplay = document.getElementById('creditsDisplay');

    function updateCreditsUI() {
      if (creditsDisplay) creditsDisplay.textContent = '¢ ' + Math.max(0, Math.floor(economyState.credits));
    }

    function getInventoryCount(typeId) {
      return inventorySlots.reduce((sum, slot) => sum + (slot && slot.typeId === typeId ? slot.count : 0), 0);
    }

    function findNearbyMerchant() {
      if (!crystalStall) return null;
      const merchant = crystalStall.userData.merchantNPC;
      if (!merchant) return null;
      // player.position is in planetSystem-local space, so convert the NPC position to
      // the same space before measuring the interaction distance.
      const merchantWorld = new THREE.Vector3();
      merchant.getWorldPosition(merchantWorld);
      const merchantLocal = planetSystem.worldToLocal(merchantWorld);
      const distance = player.position.distanceTo(merchantLocal);
      return distance <= 7.5 ? merchant : null;
    }

    function renderMerchantSellList() {
      merchantSellList.innerHTML = '';
      for (const item of ITEM_TYPES) {
        const owned = getInventoryCount(item.id);
        const row = document.createElement('button');
        row.type = 'button';
        row.className = 'merchantItemRow' + (economyState.selectedSellTypeId === item.id ? ' selected' : '');
        row.disabled = owned <= 0;
        row.innerHTML = '<span class="merchantItemIconSlot"></span><span class="merchantItemText"><strong>' + item.name + '</strong><small>Sell for ¢' + SELL_PRICES[item.id] + ' each · You have ' + owned + '</small></span>';
        const iconSlot = row.querySelector('.merchantItemIconSlot');
        iconSlot.appendChild(makeItemIconElement(item.id, 'merchantIcon'));
        row.addEventListener('click', () => {
          economyState.selectedSellTypeId = item.id;
          const max = getInventoryCount(item.id);
          merchantSellQuantity.value = String(Math.max(1, Math.min(max || 1, Number(merchantSellQuantity.value) || 1)));
          merchantStatus.textContent = '';
          updateMerchantSellSelection();
          renderMerchantSellList();
        });
        merchantSellList.appendChild(row);
      }
    }

    function updateMerchantSellSelection() {
      const typeId = economyState.selectedSellTypeId;
      const item = typeId ? itemById[typeId] : null;
      const owned = item ? getInventoryCount(typeId) : 0;
      merchantSellName.textContent = item ? item.name : 'Select an item';
      merchantSellOwned.textContent = item ? 'Owned: ' + owned : 'Click an item on the left';
      merchantSellPrice.textContent = item ? '¢' + SELL_PRICES[typeId] + ' each' : '—';
      merchantSellQuantity.max = String(Math.max(1, owned));
      merchantSellQuantity.disabled = !item || owned <= 0;
      merchantSellButton.disabled = !item || owned <= 0;
      const qty = Math.max(1, Math.min(owned || 1, Math.floor(Number(merchantSellQuantity.value) || 1)));
      merchantSellQuantity.value = String(qty);
      merchantSellTotal.textContent = item ? 'Total: ¢' + (qty * SELL_PRICES[typeId]) : 'Total: ¢0';
    }

    // ---------- merchant BUY system (standalone) ----------
    // This is deliberately independent from the sell renderer and item-icon renderer.
    // The Buy tab owns its DOM, visibility, controls and purchase handling.
    const MERCHANT_BUY_CATALOG = Object.freeze([
      { id: 'ruby',          name: 'Ruby',           price: 100, max: 10 },
      { id: 'topaz',         name: 'Topaz',          price: 80,  max: 10 },
      { id: 'jasper',        name: 'Jasper',         price: 76,  max: 10 },
      { id: 'emerald',       name: 'Emerald',        price: 130, max: 10 },
      { id: 'diamond',       name: 'Diamond',        price: 300, max: 10 },
      { id: 'lapis',         name: 'Lapis',          price: 110, max: 10 },
      { id: 'amethyst',      name: 'Amethyst',       price: 170, max: 10 },
      { id: 'onyx',          name: 'Onyx',            price: 240, max: 10 },
      { id: 'rocket_engine', name: 'Rocket Engine',  price: 600, max: 1 },
      { id: 'launch_pad',    name: 'Launch Pad',     price: 400, max: 1 },
      { id: 'jerrycan',      name: 'Jerrycan (Full)',price: 250, max: 1 }
    ]);

    function setMerchantView(view) {
      // Do not rely on the global .hidden class here. This fixes the Buy tab even if
      // another overlay/state has changed opacity or pointer-events on the section.
      merchantDialogue.style.display = view === 'dialogue' ? 'grid' : 'none';
      merchantSellSection.style.display = view === 'sell' ? 'block' : 'none';
      merchantBuySection.style.display = view === 'buy' ? 'block' : 'none';

      merchantDialogue.classList.toggle('hidden', view !== 'dialogue');
      merchantSellSection.classList.toggle('hidden', view !== 'sell');
      merchantBuySection.classList.toggle('hidden', view !== 'buy');

      if (view === 'buy') {
        // Explicitly restore visibility in case CSS/state left the element faded out.
        merchantBuySection.style.opacity = '1';
        merchantBuySection.style.pointerEvents = 'auto';
        merchantBuyList.style.opacity = '1';
        merchantBuyList.style.pointerEvents = 'auto';
      }
    }

    function merchantBuyIcon(typeId) {
      const item = itemById[typeId];
      const icon = document.createElement('div');
      icon.className = 'merchantBuyVisualIcon';
      icon.textContent = item && item.kind === 'crystal' ? '◆' : '▣';
      if (item && item.kind === 'crystal' && item.css) {
        icon.style.color = item.css;
        icon.style.textShadow = '0 0 12px ' + item.css;
      }
      return icon;
    }

    function updateMerchantBuyButton(row, catalogItem) {
      const input = row.querySelector('.merchantBuyQuantity');
      const button = row.querySelector('.merchantBuyButton');
      if (!input || !button) return;
      let qty = parseInt(input.value, 10);
      if (!Number.isFinite(qty)) qty = 1;
      qty = Math.max(1, Math.min(catalogItem.max, qty));
      input.value = String(qty);
      button.disabled = economyState.credits < catalogItem.price * qty;
    }

    function purchaseMerchantBuyItem(catalogItem, row) {
      const input = row.querySelector('.merchantBuyQuantity');
      let qty = parseInt(input && input.value, 10);
      if (!Number.isFinite(qty)) qty = 1;
      qty = Math.max(1, Math.min(catalogItem.max, qty));

      const item = itemById[catalogItem.id];
      if (!item) {
        merchantStatus.textContent = 'This item is unavailable.';
        return;
      }

      const total = catalogItem.price * qty;
      if (economyState.credits < total) {
        merchantStatus.textContent = 'Not enough credits.';
        updateMerchantBuyButton(row, catalogItem);
        return;
      }

      if (!canAddItemToInventory(catalogItem.id, qty)) {
        merchantStatus.textContent = 'Not enough inventory space.';
        return;
      }

      if (!addItemToInventory(catalogItem.id, qty)) {
        merchantStatus.textContent = 'Could not add the purchase to your inventory.';
        return;
      }

      economyState.credits -= total;
      updateCreditsUI();
      merchantStatus.textContent = 'Bought ' + qty + ' × ' + item.name + ' for ¢' + total + '.';
      refreshEquippedItem();
      updateHotbarUI();
      if (uiState.inventoryOpen) updateInventoryUI();
      renderMerchantBuyList();
    }

    function renderMerchantBuyList() {
      // Completely rebuild the Buy panel from the catalog every time it opens.
      // No template strings, icon helpers, or sell UI are required for this path.
      merchantBuyList.replaceChildren();
      merchantBuyList.className = 'merchantItemList merchantBuyList merchantBuyListStandalone';
      merchantBuyList.style.display = 'block';
      merchantBuyList.style.visibility = 'visible';
      merchantBuyList.style.opacity = '1';
      merchantBuyList.style.pointerEvents = 'auto';
      merchantBuyList.style.height = 'min(420px, 50vh)';
      merchantBuyList.style.maxHeight = 'min(420px, 50vh)';
      merchantBuyList.style.overflowY = 'auto';

      for (const catalogItem of MERCHANT_BUY_CATALOG) {
        const row = document.createElement('div');
        row.className = 'merchantItemRow merchantBuyRow';
        row.dataset.buyId = catalogItem.id;
        row.style.opacity = '1';
        row.style.visibility = 'visible';

        const iconSlot = document.createElement('div');
        iconSlot.className = 'merchantItemIconSlot';
        iconSlot.appendChild(merchantBuyIcon(catalogItem.id));

        const text = document.createElement('div');
        text.className = 'merchantItemText';
        const name = document.createElement('strong');
        name.textContent = catalogItem.name;
        const price = document.createElement('small');
        price.textContent = 'Buy for ¢' + catalogItem.price + ' each';
        text.append(name, price);

        const input = document.createElement('input');
        input.className = 'merchantBuyQuantity';
        input.type = 'number';
        input.min = '1';
        input.max = String(catalogItem.max);
        input.value = '1';
        input.setAttribute('aria-label', 'Quantity for ' + catalogItem.name);
        input.addEventListener('input', () => updateMerchantBuyButton(row, catalogItem));

        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'merchantBuyButton';
        button.textContent = 'BUY';
        button.addEventListener('click', (event) => {
          event.preventDefault();
          event.stopPropagation();
          purchaseMerchantBuyItem(catalogItem, row);
        });

        row.append(iconSlot, text, input, button);
        merchantBuyList.appendChild(row);
        updateMerchantBuyButton(row, catalogItem);
      }

      merchantBuyList.scrollTop = 0;
    }

    function showMerchantSection(section) {
      economyState.merchantSection = section;
      merchantStatus.textContent = '';

      if (section === 'sell') {
        setMerchantView('sell');
        economyState.selectedSellTypeId = economyState.selectedSellTypeId && getInventoryCount(economyState.selectedSellTypeId) > 0 ? economyState.selectedSellTypeId : null;
        renderMerchantSellList();
        updateMerchantSellSelection();
        return;
      }

      if (section === 'buy') {
        setMerchantView('buy');
        renderMerchantBuyList();
        return;
      }

      setMerchantView('dialogue');
    }

    function openMerchant() {
      if (economyState.merchantOpen || state.gameState !== 'playing') return false;
      const merchant = findNearbyMerchant();
      if (!merchant) return false;
      economyState.merchantOpen = true;
      economyState.merchantSection = 'dialogue';
      state.paused = true;
      merchantOverlay.classList.remove('hidden');
      setMerchantView('dialogue');
      updateCreditsUI();
      if (document.pointerLockElement === canvas) document.exitPointerLock();
      for (const k in systemState.keys) systemState.keys[k] = false;
      clearPhysicalKeys();
      return true;
    }

    function closeMerchant() {
      economyState.merchantOpen = false;
      merchantOverlay.classList.add('hidden');
      economyState.selectedSellTypeId = null;
      economyState.merchantSection = 'dialogue';
      if (state.gameState === 'playing') {
        state.paused = false;
        attemptPointerLock();
      }
    }

    function sellSelectedMerchantItem() {
      const typeId = economyState.selectedSellTypeId;
      if (!typeId || !itemById[typeId]) return;
      const owned = getInventoryCount(typeId);
      const qty = Math.max(1, Math.min(owned, Math.floor(Number(merchantSellQuantity.value) || 1)));
      if (owned < qty || !removeItemsFromInventory(typeId, qty)) { merchantStatus.textContent = 'You do not have enough of that item.'; return; }
      const earned = qty * SELL_PRICES[typeId];
      economyState.credits += earned;
      merchantStatus.textContent = 'Sold ' + qty + ' × ' + itemById[typeId].name + ' for ¢' + earned + '.';
      updateCreditsUI();
      refreshEquippedItem();
      updateHotbarUI();
      updateInventoryUI();
      renderMerchantSellList();
      updateMerchantSellSelection();
    }

    merchantSellQuantity.addEventListener('input', updateMerchantSellSelection);
    merchantSellButton.addEventListener('click', sellSelectedMerchantItem);
    document.getElementById('merchantSellChoice').addEventListener('click', () => showMerchantSection('sell'));
    document.getElementById('merchantBuyChoice').addEventListener('click', () => showMerchantSection('buy'));
    const showMerchantDialogue = () => { economyState.merchantSection = 'dialogue'; merchantStatus.textContent = ''; setMerchantView('dialogue'); };
    document.getElementById('merchantDialogueBack').addEventListener('click', showMerchantDialogue);
    document.getElementById('merchantDialogueBackBuy').addEventListener('click', showMerchantDialogue);
    merchantClose.addEventListener('click', closeMerchant);
    merchantOverlay.addEventListener('click', (e) => { if (e.target === merchantOverlay) closeMerchant(); });

    function startRocketFueling() {
      if (economyState.fuelingPad || uiState.equippedItemType !== 'jerrycan') return false;
      const found = findNearbySpaceObject();
      if (!found || found.type !== 'rocket' || !found.pad) return false;
      const pad = found.pad;
      if (pad.fuel >= ROCKET_FUEL_CAPACITY) {
        const prompt = document.getElementById('crystalPrompt');
        prompt.classList.remove('hidden');
        prompt.innerHTML = '<span class="promptKey">FULL</span> This rocket is already fueled';
        return true;
      }
      economyState.fuelingPad = pad;
      economyState.fuelingStartedAt = performance.now();
      const prompt = document.getElementById('crystalPrompt');
      prompt.classList.remove('hidden');
      prompt.innerHTML = '<span class="promptKey">0%</span> Filling rocket with fuel…';
      return true;
    }

    function updateRocketFueling() {
      const pad = economyState.fuelingPad;
      if (!pad) return;
      if (!pad.rocket || !pad.root.visible) { economyState.fuelingPad = null; economyState.fuelingStartedAt = 0; return; }
      if (uiState.equippedItemType !== 'jerrycan') { economyState.fuelingPad = null; economyState.fuelingStartedAt = 0; return; }
      const distance = player.position.distanceTo(pad.root.position);
      if (distance > 7.0) {
        economyState.fuelingPad = null;
        economyState.fuelingStartedAt = 0;
        const prompt = document.getElementById('crystalPrompt');
        prompt.classList.remove('hidden');
        prompt.textContent = 'Fueling cancelled — move closer to the rocket.';
        return;
      }
      const elapsed = performance.now() - economyState.fuelingStartedAt;
      const pct = Math.max(0, Math.min(100, elapsed / ROCKET_FUEL_TIME_MS * 100));
      const prompt = document.getElementById('crystalPrompt');
      prompt.classList.remove('hidden');
      prompt.innerHTML = '<span class="promptKey">' + Math.round(pct) + '%</span> Filling rocket with fuel…';
      if (elapsed < ROCKET_FUEL_TIME_MS) return;
      if (!removeItemsFromInventory('jerrycan', 1)) {
        economyState.fuelingPad = null; economyState.fuelingStartedAt = 0;
        prompt.textContent = 'Fueling failed — no jerrycan found.';
        return;
      }
      pad.fuel = ROCKET_FUEL_CAPACITY;
      economyState.fuelingPad = null;
      economyState.fuelingStartedAt = 0;
      refreshEquippedItem();
      updateHotbarUI();
      updateInventoryUI();
      prompt.innerHTML = '<span class="promptKey">FUELED</span> Rocket fuel: ' + pad.fuel + '/' + ROCKET_FUEL_CAPACITY;
      setTimeout(() => { if (state.gameState === 'playing') updateCrystalPrompt(); }, 900);
    }

    // ---------- spaceship flight ----------
    // Dedicated spaceship controller. The rocket is the vehicle; the player object is only
    // a hidden passenger/proxy used by the rest of the game. Flight input is completely
    // separate from the walking movement state so UI/pointer-lock transitions cannot break it.
    const flightCamera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.1, 10000);
    const flightPosition = new THREE.Vector3();
    const flightForward = new THREE.Vector3(0, 0, 1);
    const flightRight = new THREE.Vector3(1, 0, 0);
    const flightUp = new THREE.Vector3(0, 1, 0);
    const flightTarget = new THREE.Vector3();
    const flightCameraPos = new THREE.Vector3();
    const flightLookDir = new THREE.Vector3();
    const flightCameraYaw = { value: Math.PI };
    const flightCameraPitch = { value: 0.18 };
    const flightCameraOrbitDir = new THREE.Vector3();
    const flightCameraUp = new THREE.Vector3();
    const flightCameraRight = new THREE.Vector3();
    const flightCameraForward = new THREE.Vector3();
    const flightPadWorld = new THREE.Vector3();
    const flightPadUp = new THREE.Vector3();
    const flightPadOffset = new THREE.Vector3();
    const flightRocketQuat = new THREE.Quaternion();
    const flightShipBasis = new THREE.Matrix4();
    const flightMove = new THREE.Vector3();

    const FLIGHT_CAMERA_DISTANCE = 11;
    const FLIGHT_CAMERA_HEIGHT = 3.2;
    const FLIGHT_LANDING_DISTANCE = 4.8;
    const FLIGHT_LANDING_HEIGHT_TOLERANCE = 2.8;
    const FLIGHT_SPEED = 30;
    const FLIGHT_VERTICAL_SPEED = 26;
    const FLIGHT_CAMERA_SMOOTH = 10;
    const FLIGHT_TERRAIN_CLEARANCE = 1.15;
    const FLIGHT_PROP_COLLISION_RADIUS = 1.15;
    const FLIGHT_TREE_COLLISION_EXTRA = 0.35;

    let flightPad = null;
    let flightRocket = null;
    let flightWasThirdPerson = false;

    // These keys belong only to the spaceship controller. They are deliberately independent
    // of systemState.keys and physicalKeys used by walking/UI.
    const rocketKeys = Object.create(null);
    const rocketKeyDown = (e) => {
      if (!playerState.inRocket) return;
      if (['KeyW','KeyA','KeyS','KeyD','ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Space','ShiftLeft','ShiftRight'].includes(e.code)) {
        rocketKeys[e.code] = true;
        e.preventDefault();
      }
    };
    const rocketKeyUp = (e) => {
      if (['KeyW','KeyA','KeyS','KeyD','ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Space','ShiftLeft','ShiftRight'].includes(e.code)) {
        rocketKeys[e.code] = false;
      }
    };
    const clearRocketKeys = () => {
      for (const key in rocketKeys) rocketKeys[key] = false;
    };
    window.addEventListener('keydown', rocketKeyDown, true);
    window.addEventListener('keyup', rocketKeyUp, true);
    window.addEventListener('blur', clearRocketKeys);

    window.addEventListener('resize', () => {
      flightCamera.aspect = window.innerWidth / window.innerHeight;
      flightCamera.updateProjectionMatrix();
    });

    function rocketKeyHeld(...codes) {
      for (const code of codes) if (rocketKeys[code]) return true;
      return false;
    }

    function setRocketFlightUI() {
      const active = !!playerState.inRocket;
      rocketFlightStatus.classList.toggle('hidden', !active);
      if (!active) return;
      const fuel = flightPad ? Math.max(0, Math.min(ROCKET_FUEL_CAPACITY, Math.floor(Number(flightPad.fuel) || 0))) : 0;
      rocketFlightFuel.textContent = 'FUEL ' + fuel + '%';
      rocketFlightMode.textContent = playerState.rocketInSpace ? 'SPACE · GRAVITY OFF' : 'ATMOSPHERE · GRAVITY OFF';
    }

    function showFlightPrompt(message) {
      const p = document.getElementById('crystalPrompt');
      if (!p) return;
      p.classList.remove('hidden');
      p.textContent = message;
    }

    function findRocketEntryPad() {
      let best = null;
      let bestDistance = Infinity;
      const playerWorld = new THREE.Vector3();
      player.getWorldPosition(playerWorld);
      for (const pad of launchPads) {
        if (!pad.root.visible || !pad.rocket || !pad.rocket.root.visible) continue;
        const rocketWorld = new THREE.Vector3();
        pad.rocket.root.getWorldPosition(rocketWorld);
        const d = rocketWorld.distanceTo(playerWorld);
        if (d < 4.2 && d < bestDistance) {
          best = pad;
          bestDistance = d;
        }
      }
      return best;
    }

    function getPlanetUpAt(position, out) {
      if (position.lengthSq() < 0.0001) return out.set(0, 1, 0);
      return out.copy(position).normalize();
    }

    // Build a local ship frame from the planet's curvature. +Y is always away from the
    // planet center, meaning the ship's bottom (-Y) always faces the planet. Forward is
    // continuously re-projected onto the tangent plane so it does not point into the ground
    // as the ship moves around the sphere. The ship never turns to face its velocity.
    function getFlightBasis() {
      const up = getPlanetUpAt(flightPosition, flightUp);

      const forwardDotUp = flightForward.dot(up);
      flightForward.addScaledVector(up, -forwardDotUp);
      if (flightForward.lengthSq() < 0.00001) {
        const reference = Math.abs(up.y) < 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
        flightForward.copy(reference).addScaledVector(up, -reference.dot(up));
      }
      flightForward.normalize();

      flightRight.crossVectors(flightForward, up).normalize();
      return { up, forward: flightForward, right: flightRight };
    }

    function updateFlightRocketVisual() {
      if (!flightRocket) return;
      const basis = getFlightBasis();

      // Keep the ship visually upright to the spherical planet while preserving its heading.
      // Local +Y = planetary up, local +Z = rearward, so the engine remains at the back.
      const rear = basis.forward.clone().negate();
      flightShipBasis.makeBasis(basis.right, basis.up, rear);
      flightRocket.root.quaternion.setFromRotationMatrix(flightShipBasis);
      flightRocket.root.position.copy(flightPosition);
      flightRocket.root.visible = true;
    }

    function updateFlightCamera(delta) {
      // Mirror the normal third-person player camera: a stable orbit around the vehicle,
      // with yaw around the local planetary up axis and pitch around the camera's right axis.
      // The camera never derives its orientation from its own world position, which avoids
      // the flips/jitter that the previous flight camera produced on the underside of the planet.
      const basis = getFlightBasis();
      const up = basis.up;

      // Build a stable local tangent reference from the rocket's current heading.
      const baseForward = flightCameraOrbitDir
        .copy(basis.forward)
        .addScaledVector(up, -basis.forward.dot(up));
      if (baseForward.lengthSq() < 0.00001) {
        const fallback = Math.abs(up.y) < 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
        baseForward.copy(fallback).addScaledVector(up, -fallback.dot(up));
      }
      baseForward.normalize();

      const yawQuat = new THREE.Quaternion().setFromAxisAngle(up, flightCameraYaw.value);
      const orbitForward = baseForward.clone().applyQuaternion(yawQuat).normalize();
      const orbitRight = new THREE.Vector3().crossVectors(orbitForward, up).normalize();

      // Same pitch convention as the player's third-person camera. Clamp before applying
      // it so the camera can never turn over and invert the horizon.
      const pitchQuat = new THREE.Quaternion().setFromAxisAngle(orbitRight, flightCameraPitch.value);
      const cameraForward = orbitForward.clone().applyQuaternion(pitchQuat).normalize();

      const target = flightTarget.copy(flightPosition).addScaledVector(up, 1.4);
      const desiredPos = flightCameraPos.copy(target).addScaledVector(cameraForward, -FLIGHT_CAMERA_DISTANCE);
      const blend = Math.min(1, delta * FLIGHT_CAMERA_SMOOTH);

      flightCamera.position.lerp(desiredPos, blend);

      // Keep the horizon aligned with the planet's surface at the ship's current location.
      flightCamera.up.copy(up);
      const lookTarget = target.clone().addScaledVector(cameraForward, 0.001);
      flightCamera.lookAt(lookTarget);
    }

    function snapFlightToPad(pad) {
      if (!pad) return false;
      pad.root.getWorldPosition(flightPadWorld);
      pad.root.getWorldQuaternion(pad._flightWorldQuat || (pad._flightWorldQuat = new THREE.Quaternion()));
      flightPadUp.set(0, 1, 0).applyQuaternion(pad._flightWorldQuat).normalize();
      flightPadOffset.copy(flightPadUp).multiplyScalar(0.72);
      flightPosition.copy(flightPadWorld).add(flightPadOffset);
      playerState.rocketLanded = true;
      playerState.rocketInSpace = flightPosition.length() >= ROCKET_ATMOSPHERE_RADIUS;
      if (flightRocket) {
        flightRocket.root.position.copy(flightPosition);
        flightRocket.root.quaternion.copy(pad._flightWorldQuat);
      }
      return true;
    }

    function enterRocket() {
      if (playerState.inRocket || state.gameState !== 'playing' || state.paused) return false;
      if (uiState.equippedItemType) return false;

      const pad = findRocketEntryPad();
      if (!pad || !pad.rocket) return false;
      if ((Number(pad.fuel) || 0) <= 0) {
        showFlightPrompt('Rocket has no fuel. Fill it with a jerrycan first.');
        setTimeout(() => { if (state.gameState === 'playing' && !playerState.inRocket) updateCrystalPrompt(); }, 900);
        return true;
      }

      const rocketWorldPos = new THREE.Vector3();
      const rocketWorldQuat = new THREE.Quaternion();
      pad.rocket.root.getWorldPosition(rocketWorldPos);
      pad.rocket.root.getWorldQuaternion(rocketWorldQuat);

      flightPad = pad;
      flightRocket = pad.rocket;
      flightPosition.copy(rocketWorldPos);
      flightRocketQuat.copy(rocketWorldQuat);

      // Detach only the rocket. The player remains a hidden passenger/proxy.
      scene.attach(flightRocket.root);
      flightRocket.root.position.copy(flightPosition);
      flightRocket.root.quaternion.copy(flightRocketQuat);
      flightRocket.root.visible = true;

      // Preserve the rocket's launch-pad heading, projected onto the planet tangent.
      const initialUp = getPlanetUpAt(flightPosition, new THREE.Vector3());
      flightForward.set(0, 0, 1).applyQuaternion(flightRocketQuat);
      flightForward.addScaledVector(initialUp, -flightForward.dot(initialUp));
      if (flightForward.lengthSq() < 0.00001) {
        const fallback = Math.abs(initialUp.y) < 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
        flightForward.copy(fallback).addScaledVector(initialUp, -fallback.dot(initialUp));
      }
      flightForward.normalize();
      flightRight.crossVectors(flightForward, initialUp).normalize();
      clearRocketKeys();

      scene.attach(player);
      player.position.copy(flightPosition);
      player.quaternion.copy(flightRocketQuat);
      playerState.inRocket = true;
      playerState.rocketInSpace = flightPosition.length() >= ROCKET_ATMOSPHERE_RADIUS;
      playerState.rocketLanded = true;
      playerState.rocketFuelTimer = 0;
      playerState.verticalVelocity = 0;

      playerBody.visible = false;
      heldCrystalFirstPerson.visible = false;
      heldCrystalThirdPerson.visible = false;
      setFlashlight(false);

      flightWasThirdPerson = playerState.thirdPerson;
      playerState.thirdPerson = true;
      playerState.thirdPersonOrbitPitch = 0.12;
      flightCameraYaw.value = 0;
      flightCameraPitch.value = 0.22;
      state.paused = false;
      systemState.keys['KeyE'] = false;
      physicalKeys['KeyE'] = false;
      document.body.classList.add('rocket-flight');

      flightCamera.position.copy(flightPosition).addScaledVector(initialUp, 8);
      flightCamera.up.copy(initialUp);
      flightCamera.lookAt(flightPosition);
      updateFlightRocketVisual();
      updateFlightCamera(1 / 60);
      setRocketFlightUI();
      showFlightPrompt('Rocket ready · WASD move · Space up · Shift down');
      return true;
    }

    function exitRocketFlight(force = false) {
      if (!playerState.inRocket) return false;
      if (!force && !playerState.rocketLanded) {
        showFlightPrompt('Land on the launch pad before exiting the spaceship.');
        return true;
      }

      const pad = flightPad;
      const padWorldPos = pad ? pad.root.getWorldPosition(new THREE.Vector3()) : flightPosition.clone();
      const padWorldQuat = pad ? pad.root.getWorldQuaternion(new THREE.Quaternion()) : new THREE.Quaternion();

      // Safe exit point: beside the launch pad and outside the rocket collision footprint.
      let exitWorldPos = padWorldPos.clone();
      if (pad) {
        const padRight = new THREE.Vector3(1, 0, 0).applyQuaternion(padWorldQuat).normalize();
        const padUp = new THREE.Vector3(0, 1, 0).applyQuaternion(padWorldQuat).normalize();
        exitWorldPos.addScaledVector(padRight, 5.0);
        const exitDir = exitWorldPos.clone().normalize();
        const exitRadius = PLANET_RADIUS + heightAt(exitDir) + 1.15;
        exitWorldPos.copy(exitDir).multiplyScalar(exitRadius);

        const padForward = new THREE.Vector3(0, 0, 1).applyQuaternion(padWorldQuat);
        padForward.addScaledVector(padUp, -padForward.dot(padUp)).normalize();
        const playerWorldQuat = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), padUp);
        const playerForwardAfterUp = new THREE.Vector3(0, 0, 1).applyQuaternion(playerWorldQuat);
        const yaw = Math.atan2(
          padForward.dot(new THREE.Vector3(1, 0, 0).applyQuaternion(playerWorldQuat)),
          padForward.dot(playerForwardAfterUp)
        );
        playerWorldQuat.multiply(new THREE.Quaternion().setFromAxisAngle(padUp, yaw));
        planetSystem.attach(player);
        player.position.copy(planetSystem.worldToLocal(exitWorldPos.clone()));
        player.quaternion.copy(planetSystem.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(playerWorldQuat));
      } else {
        planetSystem.attach(player);
        player.position.copy(planetSystem.worldToLocal(exitWorldPos.clone()));
      }

      if (pad && flightRocket) {
        pad.root.attach(flightRocket.root);
        flightRocket.root.position.set(0, 0.18, 0);
        flightRocket.root.quaternion.identity();
        flightRocket.root.visible = true;
      }

      flightPad = null;
      flightRocket = null;
      playerState.inRocket = false;
      playerState.rocketInSpace = false;
      playerState.rocketLanded = false;
      playerState.rocketFuelTimer = 0;
      playerState.thirdPerson = flightWasThirdPerson;
      clearRocketKeys();

      playerBody.visible = true;
      document.body.classList.remove('rocket-flight');
      heldCrystalFirstPerson.visible = !playerState.thirdPerson;
      heldCrystalThirdPerson.visible = playerState.thirdPerson;
      flashlight.visible = false;

      camera.layers.enable(0);
      if (playerState.thirdPerson) camera.layers.enable(1);
      else camera.layers.disable(1);
      targetCamPos.copy(playerState.thirdPerson ? CAM_THIRD : CAM_FIRST);
      camera.position.copy(targetCamPos);
      camera.rotation.set(playerState.pitch, 0, 0);

      playerState.heightOffset = 0;
      playerState.verticalVelocity = 0;
      playerState.stamina = STAMINA_MAX;
      playerState.exhausted = false;
      for (const k in systemState.keys) systemState.keys[k] = false;
      clearPhysicalKeys();
      state.paused = false;
      setRocketFlightUI();
      updateStaminaBar();
      updateHotbarUI();
      refreshEquippedItem();
      attemptPointerLock();
      return true;
    }


    // Flight collisions are evaluated in planetSystem-local space because the whole planet
    // rotates over time. The detached rocket lives in world space, so every candidate position
    // is converted before sampling terrain or checking world props. Space flight stays free.
    function isFlightPositionBlocked(worldPosition) {
      const local = worldPosition.clone();
      planetSystem.worldToLocal(local);
      const dir = local.clone().normalize();
      const radius = local.length();

      // Terrain / mountains / valleys. The rocket has a small hull clearance above the real
      // terrain surface. Do NOT clamp to a global planet radius here: valleys can be much lower
      // than the surrounding terrain and the ship must be allowed to travel inside them.
      const terrainRadius = PLANET_RADIUS + heightAt(dir) + FLIGHT_TERRAIN_CLEARANCE;
      if (radius < terrainRadius) return true;

      // Trees are vertical obstacles, not little points at their roots. Test the candidate in
      // each tree's local frame so both the trunk and the canopy can block the ship.
      for (const tree of treeSpawns) {
        if (tree.chopped || !tree.root.visible) continue;

        collisionTreeOffset.copy(local).sub(tree.root.position);
        collisionTreeInverse.copy(tree.root.quaternion).invert();
        collisionTreeLocal.copy(collisionTreeOffset).applyQuaternion(collisionTreeInverse);

        const size = tree.size;
        const shipRadius = FLIGHT_PROP_COLLISION_RADIUS;
        const treeHalfHeight = 3.12 * size;
        const trunkRadius = 0.30 * size + shipRadius;
        const canopyRadius = 0.66 * size + shipRadius;

        // Trunk: a tall capsule-like cylinder around the tree's local Y axis.
        const trunkXZ = Math.hypot(collisionTreeLocal.x, collisionTreeLocal.z);
        if (collisionTreeLocal.y >= -shipRadius && collisionTreeLocal.y <= 1.48 * size + shipRadius && trunkXZ < trunkRadius) {
          return true;
        }

        // Canopy: the cone occupies the upper part of the tree, so use a generous spherical
        // footprint there. This prevents flying straight through the visible foliage.
        if (collisionTreeLocal.y > 0.72 * size && collisionTreeLocal.y < treeHalfHeight + shipRadius) {
          const coneCenterY = 2.05 * size;
          const canopyVertical = collisionTreeLocal.y - coneCenterY;
          const canopyXZ = Math.hypot(collisionTreeLocal.x, collisionTreeLocal.z);
          const verticalLimit = 1.18 * size + shipRadius;
          if (Math.abs(canopyVertical) <= verticalLimit && canopyXZ < canopyRadius) return true;
        }
      }

      // Merchant stall: block the full physical footprint and height of the actual stall,
      // rather than relying on the old smaller gameplay box that left large parts ghost-like.
      if (crystalStall) {
        collisionStallOffset.copy(local).sub(crystalStall.position);
        collisionStallInverse.copy(crystalStall.quaternion).invert();
        collisionStallLocal.copy(collisionStallOffset).applyQuaternion(collisionStallInverse);

        const shipRadius = FLIGHT_PROP_COLLISION_RADIUS;
        const halfX = 5.05 + shipRadius;
        const halfZ = 2.02 + shipRadius;
        const bottom = -0.55 - shipRadius;
        const top = 3.82 + shipRadius;
        if (Math.abs(collisionStallLocal.x) <= halfX &&
            Math.abs(collisionStallLocal.z) <= halfZ &&
            collisionStallLocal.y >= bottom && collisionStallLocal.y <= top) {
          return true;
        }
      }

      return false;
    }

    function updateRocketFlight(delta) {
      if (!playerState.inRocket || !flightPad || !flightRocket) return;
      state.paused = false;

      // Fuel: exactly 1% per five seconds of active flight.
      playerState.rocketFuelTimer += delta;
      while (playerState.rocketFuelTimer >= 5 && (Number(flightPad.fuel) || 0) > 0) {
        flightPad.fuel = Math.max(0, (Number(flightPad.fuel) || 0) - 1);
        playerState.rocketFuelTimer -= 5;
      }
      if ((Number(flightPad.fuel) || 0) <= 0) playerState.rocketFuelTimer = 0;

      const radiusFromCenter = flightPosition.length();
      playerState.rocketInSpace = radiusFromCenter >= ROCKET_ATMOSPHERE_RADIUS;

      // The 180-unit boundary only changes the HUD. There is no physical gravity.
      // Near the planet, horizontal movement follows the spherical surface while Space/Shift
      // changes altitude. In space, all three axes are free and no movement is auto-cancelled.
      flightMove.set(0, 0, 0);
      const basis = getFlightBasis();
      const hasFuel = (Number(flightPad.fuel) || 0) > 0;
      let forwardInput = 0;
      let rightInput = 0;
      let verticalInput = 0;

      // WASD is camera-relative in third-person flight too. The camera's look direction
      // is projected onto the tangent plane, giving the familiar "W goes where I look"
      // behavior while Space/Shift remain dedicated vertical controls.
      const cameraMoveForward = new THREE.Vector3();
      const cameraMoveRight = new THREE.Vector3();
      flightCamera.getWorldDirection(cameraMoveForward);
      cameraMoveForward.addScaledVector(basis.up, -cameraMoveForward.dot(basis.up));
      if (cameraMoveForward.lengthSq() < 0.00001) {
        cameraMoveForward.copy(flightCameraOrbitDir)
          .addScaledVector(basis.up, -flightCameraOrbitDir.dot(basis.up));
      }
      cameraMoveForward.normalize();
      cameraMoveRight.crossVectors(cameraMoveForward, basis.up).normalize();

      if (rocketKeyHeld('KeyW','ArrowUp')) forwardInput += 1;
      if (rocketKeyHeld('KeyS','ArrowDown')) forwardInput -= 1;
      if (rocketKeyHeld('KeyA','ArrowLeft')) rightInput -= 1;
      if (rocketKeyHeld('KeyD','ArrowRight')) rightInput += 1;
      if (rocketKeyHeld('Space')) verticalInput += 1;
      if (rocketKeyHeld('ShiftLeft','ShiftRight')) verticalInput -= 1;

      if (hasFuel) {
        // In atmosphere, keep the ship's altitude and move around the planet's curve when
        // pressing W/A/S/D. This avoids the old tangent-vector + surface-clamp snap-back.
        if (!playerState.rocketInSpace) {
          const currentDir = flightPosition.clone().normalize();
          const currentGroundRadius = PLANET_RADIUS + heightAt(currentDir);
          // Preserve the ship's altitude above the local ground while moving around the sphere.
          // This is the important valley fix: entering a lower region lowers the ship with the
          // valley, while entering higher terrain raises it smoothly instead of ejecting it.
          const currentAltitude = Math.max(
            FLIGHT_TERRAIN_CLEARANCE,
            flightPosition.length() - currentGroundRadius
          );

          const horizontal = new THREE.Vector3();
          horizontal.addScaledVector(cameraMoveForward, forwardInput);
          horizontal.addScaledVector(cameraMoveRight, rightInput);
          if (horizontal.lengthSq() > 1) horizontal.normalize();

          const horizontalDistance = FLIGHT_SPEED * delta;
          if (horizontal.lengthSq() > 0.000001) {
            const newDir = currentDir.clone();
            newDir.addScaledVector(horizontal, horizontalDistance / Math.max(flightPosition.length(), PLANET_RADIUS + 1));
            newDir.normalize();

            const desiredRadius = PLANET_RADIUS + heightAt(newDir) + currentAltitude;
            const horizontalCandidate = newDir.multiplyScalar(desiredRadius);
            if (!isFlightPositionBlocked(horizontalCandidate)) {
              flightPosition.copy(horizontalCandidate);
            } else {
              // If a diagonal move is blocked, try each camera-relative axis separately so the
              // pilot can slide around trees/stalls without losing altitude in a valley.
              const tryMoveAxis = (axisDir) => {
                if (axisDir.lengthSq() < 0.000001) return false;
                const axisDirNorm = axisDir.clone().normalize();
                const axisCandidateDir = currentDir.clone();
                axisCandidateDir.addScaledVector(axisDirNorm, horizontalDistance / Math.max(flightPosition.length(), PLANET_RADIUS + 1));
                axisCandidateDir.normalize();
                const axisRadius = PLANET_RADIUS + heightAt(axisCandidateDir) + currentAltitude;
                const axisCandidate = axisCandidateDir.multiplyScalar(axisRadius);
                if (!isFlightPositionBlocked(axisCandidate)) {
                  flightPosition.copy(axisCandidate);
                  return true;
                }
                return false;
              };
              const forwardOnly = cameraMoveForward.clone().multiplyScalar(forwardInput);
              const rightOnly = cameraMoveRight.clone().multiplyScalar(rightInput);
              tryMoveAxis(forwardOnly);
              tryMoveAxis(rightOnly);
            }
          }

          if (verticalInput !== 0) {
            const verticalDistance = verticalInput * FLIGHT_VERTICAL_SPEED * delta;
            const verticalCandidate = flightPosition.clone().addScaledVector(basis.up, verticalDistance);
            if (!isFlightPositionBlocked(verticalCandidate)) {
              flightPosition.copy(verticalCandidate);
            } else if (verticalInput > 0) {
              // Always allow upward movement even if a prop is directly overhead.
              flightPosition.copy(verticalCandidate);
            }
          }
        } else {
          // In space, movement is unconstrained world-space flight.
          flightMove.addScaledVector(cameraMoveForward, forwardInput);
          flightMove.addScaledVector(cameraMoveRight, rightInput);
          flightMove.addScaledVector(basis.up, verticalInput);
          if (flightMove.lengthSq() > 1) flightMove.normalize();
          if (flightMove.lengthSq() > 0.000001) {
            flightPosition.addScaledVector(flightMove, FLIGHT_SPEED * delta);
          }
        }
      }

      // Landing is deliberate: entering the small landing zone does NOT immediately snap the
      // ship back to the pad while the pilot is still moving. Release all flight controls while
      // parked over the pad and the ship settles onto the exact launch position.
      playerState.rocketLanded = false;
      const anyFlightInput = forwardInput !== 0 || rightInput !== 0 || verticalInput !== 0;
      if (!playerState.rocketInSpace && flightPad && !anyFlightInput) {
        flightPad.root.getWorldPosition(flightPadWorld);
        const padDistance = flightPosition.distanceTo(flightPadWorld);
        const radialDifference = Math.abs(flightPosition.length() - flightPadWorld.length());
        if (padDistance <= FLIGHT_LANDING_DISTANCE && radialDifference <= FLIGHT_LANDING_HEIGHT_TOLERANCE) {
          snapFlightToPad(flightPad);
        }
      }

      // Keep the hidden passenger proxy synced for systems that still inspect player position.
      player.position.copy(flightPosition);
      updateFlightRocketVisual();
      updateFlightCamera(delta);
      setRocketFlightUI();
    }

    // ---------- save/load system ----------
    // The save is a normal JSON file, so the player can keep it outside the browser and
    // move it between computers. A small browser-local backup is also written whenever
    // we save/leave a world, which is useful if the downloaded file is forgotten.
    const SAVE_VERSION = 11;
    const LOCAL_SAVE_KEY = "pocketUniverseSave_v11";

    function serializeSave() {
      return {
        version: SAVE_VERSION,
        savedAt: new Date().toISOString(),
        player: {
          position: player.position.toArray(),
          orientation: orientation.toArray(),
          pitch: playerState.pitch,
          heightOffset: playerState.heightOffset,
          verticalVelocity: playerState.verticalVelocity,
          stamina: playerState.stamina,
          exhausted: playerState.exhausted,
          thirdPerson: playerState.thirdPerson,
          flashlightOn: playerState.flashlightOn,
          selectedHotbarSlot: uiState.selectedHotbarSlot,
          mode: state.gameMode,
          credits: Math.max(0, Math.floor(economyState.credits))
        },
        planet: {
          spinAngle: state.planetSpinAngle
        },
        inventory: inventorySlots.map(slot => slot ? {
          typeId: slot.typeId,
          count: slot.count,
          ...(itemById[slot.typeId] && itemById[slot.typeId].tool ? { durability: slot.durability == null ? getToolMaxDurability(itemById[slot.typeId]) : slot.durability } : {})
        } : null),
        // Crystal positions are saved too. The world uses random placement, so storing the
        // directions makes sure a loaded save restores the SAME crystal locations.
        crystals: crystalSpawns.map(spawn => ({
          typeId: spawn.typeId,
          direction: spawn.root.position.clone().normalize().toArray(),
          collected: spawn.collected,
          respawnAtSpin: spawn.respawnAtSpin
        })),
        trees: treeSpawns.map(tree => ({
          direction: tree.direction.toArray(),
          size: tree.size,
          yaw: tree.yaw,
          chopped: tree.chopped
        })),
        rocks: rockSpawns.map(rock => ({
          direction: rock.direction.toArray(),
          mined: rock.mined
        }))
,
        ironOres: ironOreSpawns.map(ore => ({
          direction: ore.direction.toArray(),
          mined: ore.mined
        })),
        furnaces: furnaces.map(furnace => ({
          direction: furnace.direction.toArray(),
          yaw: furnace.yaw,
          inventory: furnace.inventory
        })),
        launchPads: launchPads.map(pad => ({
          direction: pad.direction.toArray(),
          yaw: pad.yaw,
          hasRocket: !!pad.rocket,
          fuel: Math.max(0, Math.min(ROCKET_FUEL_CAPACITY, Number(pad.fuel) || 0))
        })),
        droppedItems: droppedItems.map(drop => ({ typeId: drop.typeId, count: drop.count, direction: drop.direction.toArray() }))
      };
    }

    function applySaveData(data) {
      if (!data || ![1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11].includes(data.version)) {
        throw new Error("Unsupported or invalid save file.");
      }

      economyState.credits = Number.isFinite(data.credits) ? Math.max(0, Math.floor(data.credits)) : (Number.isFinite(data.player && data.player.credits) ? Math.max(0, Math.floor(data.player.credits)) : 0);
      updateCreditsUI();

      // Restore inventory first so held-item visuals can be rebuilt afterwards.
      if (!Array.isArray(data.inventory) || data.inventory.length !== INVENTORY_SLOT_COUNT) {
        throw new Error("Save file has an invalid inventory.");
      }
      for (let i = 0; i < INVENTORY_SLOT_COUNT; i++) {
        const slot = data.inventory[i];
        if (!slot) {
          inventorySlots[i] = null;
          continue;
        }
        const item = itemById[slot.typeId];
        if (!item) throw new Error('Save file contains an unknown item: ' + slot.typeId);
        inventorySlots[i] = {
          typeId: slot.typeId,
          count: Math.max(1, Math.min(item.maxStack, Math.floor(slot.count))),
          ...(item.tool ? { durability: Math.max(0, Math.min(getToolMaxDurability(item), Number.isFinite(slot.durability) ? Math.floor(slot.durability) : getToolMaxDurability(item))) } : {})
        };
      }
      uiState.selectedHotbarSlot = Math.max(0, Math.min(HOTBAR_SLOT_COUNT - 1, data.player.selectedHotbarSlot | 0));
      state.gameMode = data.player && data.player.mode === 'freeplay' ? 'freeplay' : 'survival';

      // Legacy v1 saves predate the axe/plank system. Give those worlds the starter axe too
      // when possible, so loading an older world does not strand the player without tools.
      if (data.version === 1 && !hasItemType('axe') && !inventorySlots[getHotbarInventoryIndex(0)]) {
        inventorySlots[getHotbarInventoryIndex(0)] = { typeId: 'axe', count: 1, durability: TOOL_MAX_DURABILITY };
      }

      // Restore the planet rotation/time of day.
      state.planetSpinAngle = Number.isFinite(data.planet.spinAngle) ? data.planet.spinAngle : 0;

      // Restore crystal placement and pickup/respawn state.
      if (!Array.isArray(data.crystals) || data.crystals.length !== crystalSpawns.length) {
        throw new Error("Save file has an invalid crystal layout.");
      }
      for (let i = 0; i < crystalSpawns.length; i++) {
        const saved = data.crystals[i];
        const spawn = crystalSpawns[i];
        const dir = new THREE.Vector3().fromArray(saved.direction).normalize();
        const h = heightAt(dir);
        spawn.root.position.copy(dir).multiplyScalar(PLANET_RADIUS + h + 0.02);
        spawn.root.quaternion.setFromUnitVectors(crystalPlacementUp, dir);
        spawn.collected = !!saved.collected;
        spawn.respawnAtSpin = Number.isFinite(saved.respawnAtSpin) ? saved.respawnAtSpin : 0;
        spawn.crystal.visible = !spawn.collected;
        spawn.ghost.visible = spawn.collected;
      }

      // Restore chopped trees when the save contains tree data. Older saves simply keep the
      // newly generated trees intact, so existing save files remain loadable.
      if (Array.isArray(data.trees) && data.trees.length === treeSpawns.length) {
        for (let i = 0; i < treeSpawns.length; i++) {
          const saved = data.trees[i];
          const tree = treeSpawns[i];
          const dir = new THREE.Vector3().fromArray(saved.direction).normalize();
          const h = heightAt(dir);
          tree.direction.copy(dir);
          tree.size = Number.isFinite(saved.size) ? Math.max(1.5, Math.min(4, saved.size)) : tree.size;
          tree.yaw = Number.isFinite(saved.yaw) ? saved.yaw : tree.yaw;
          tree.root.position.copy(dir).multiplyScalar(PLANET_RADIUS + h);
          // Reapply the saved size and orientation so chopping after a reload gives the same yield.
          if (tree.root.children[0]) {
            tree.root.children[0].scale.setScalar(tree.size);
            tree.root.children[0].position.y = 0.7 * tree.size;
          }
          if (tree.root.children[1]) {
            tree.root.children[1].scale.setScalar(tree.size);
            tree.root.children[1].position.y = 2.0 * tree.size;
          }
          tree.root.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
          tree.root.rotateY(tree.yaw);
          tree.chopped = !!saved.chopped;
          tree.root.visible = !tree.chopped;
        }
      }

      // Restore mined boulders when the save contains rock data. Older saves simply keep
      // their newly generated decorative boulders intact.
      if (Array.isArray(data.rocks) && data.rocks.length === rockSpawns.length) {
        for (let i = 0; i < rockSpawns.length; i++) {
          const saved = data.rocks[i];
          const rock = rockSpawns[i];
          const dir = new THREE.Vector3().fromArray(saved.direction).normalize();
          const h = heightAt(dir);
          rock.direction.copy(dir);
          rock.root.position.copy(dir).multiplyScalar(PLANET_RADIUS + h + 0.25);
          rock.mined = !!saved.mined;
          rock.root.visible = !rock.mined;
        }
      }

      // Restore iron ore boulders when the save contains the v6 iron ore layout. Older
      // saves simply keep their newly generated iron boulders untouched.
      if (Array.isArray(data.ironOres) && data.ironOres.length === ironOreSpawns.length) {
        for (let i = 0; i < ironOreSpawns.length; i++) {
          const saved = data.ironOres[i];
          const ore = ironOreSpawns[i];
          const dir = new THREE.Vector3().fromArray(saved.direction).normalize();
          const h = heightAt(dir);
          ore.direction.copy(dir);
          ore.root.position.copy(dir).multiplyScalar(PLANET_RADIUS + h + 0.25);
          ore.mined = !!saved.mined;
          ore.root.visible = !ore.mined;
        }
      }

      // Restore placed furnaces and their inventories.
      for (const furnace of furnaces) planetSystem.remove(furnace.root);
      furnaces.length = 0;
      if (Array.isArray(data.furnaces)) {
        for (const saved of data.furnaces) {
          if (!Array.isArray(saved.direction)) continue;
          const furnace = createFurnaceObject(new THREE.Vector3().fromArray(saved.direction).normalize(), Number.isFinite(saved.yaw) ? saved.yaw : 0);
          if (saved.inventory && typeof saved.inventory === 'object') {
            for (const key of ['fuel','input','output']) {
              const v=saved.inventory[key];
              if (v && itemById[v.typeId] && ((key==='fuel' && v.typeId==='planks') || (key==='input' && v.typeId==='iron_ore') || (key==='output' && v.typeId==='iron_ingot'))) furnace.inventory[key]={typeId:v.typeId,count:Math.max(1,Math.min(10,Math.floor(v.count||1)))};
            }
          }
        }
      }

      // Restore launch pads and mounted rockets. Older saves simply have none.
      for (const pad of launchPads) if (pad.root && pad.root.parent) pad.root.parent.remove(pad.root);
      launchPads.length = 0;
      if (Array.isArray(data.launchPads)) {
        for (const saved of data.launchPads) {
          if (!Array.isArray(saved.direction)) continue;
          const pad = createLaunchPadObject(new THREE.Vector3().fromArray(saved.direction).normalize(), Number.isFinite(saved.yaw) ? saved.yaw : 0);
          if (saved.hasRocket) placeRocketOnLaunchPad(pad);
          pad.fuel = Math.max(0, Math.min(ROCKET_FUEL_CAPACITY, Number(saved.fuel) || 0));
        }
      }

      for (const drop of droppedItems) if (drop.root && drop.root.parent) drop.root.parent.remove(drop.root);
      droppedItems.length = 0;
      if (Array.isArray(data.droppedItems)) {
        for (const saved of data.droppedItems) {
          if (!itemById[saved.typeId] || !Array.isArray(saved.direction)) continue;
          const dir = new THREE.Vector3().fromArray(saved.direction).normalize();
          const h = heightAt(dir);
          const root = createDroppedItemVisual(saved.typeId);
          root.position.copy(dir).multiplyScalar(PLANET_RADIUS + h + 0.28);
          root.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0), dir);
          root.rotateY(Math.random() * Math.PI * 2);
          planetSystem.add(root);
          const basePosition = root.position.clone();
          droppedItems.push({ root, typeId: saved.typeId, count: Math.max(1, Math.floor(saved.count || 1)), direction: dir.clone(), basePosition, bob: Math.random() * Math.PI * 2 });
        }
      }

      const p = data.player || {};
      if (!Array.isArray(p.position) || !Array.isArray(p.orientation)) {
        throw new Error("Save file has invalid player data.");
      }
      player.position.fromArray(p.position);
      orientation.fromArray(p.orientation);
      playerState.pitch = Number.isFinite(p.pitch) ? p.pitch : 0;
      playerState.heightOffset = Number.isFinite(p.heightOffset) ? p.heightOffset : 0;
      playerState.verticalVelocity = Number.isFinite(p.verticalVelocity) ? p.verticalVelocity : 0;
      playerState.stamina = Number.isFinite(p.stamina) ? Math.max(0, Math.min(STAMINA_MAX, p.stamina)) : STAMINA_MAX;
      playerState.exhausted = !!p.exhausted;

      // Restore third-person state without accidentally toggling it twice.
      if (!!p.thirdPerson !== playerState.thirdPerson) {
        toggleThirdPerson();
      }
      playerState.flashlightOn = !!p.flashlightOn;
      setFlashlight(playerState.flashlightOn);

      player.quaternion.copy(orientation);
      camera.rotation.set(playerState.pitch, 0, 0);
      camera.position.copy(playerState.thirdPerson ? CAM_THIRD : CAM_FIRST);
      targetCamPos.copy(playerState.thirdPerson ? CAM_THIRD : CAM_FIRST);

      updateStaminaBar();
      refreshEquippedItem();
      updateHotbarUI();
      updateInventoryUI();
      updateDayNight(0);
    }

    function persistLocalBackup() {
      if (playerState.inRocket) return;
      try {
        localStorage.setItem(LOCAL_SAVE_KEY, JSON.stringify(serializeSave()));
      } catch (e) {
        console.warn("Could not write local Pocket Universe save backup.", e);
      }
    }

    function saveGameToFile() {
      if (playerState.inRocket) {
        showFlightPrompt('Land on the launch pad before saving your game.');
        return;
      }
      const data = serializeSave();
      persistLocalBackup();
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "PocketUniverse_Save.json";
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    }

    function loadGameFromData(data) {
      applySaveData(data);
      state.gameState = "playing";
      state.paused = false;
      uiState.inventoryOpen = false;
      uiState.craftingOpen = false;
      closeMerchant();
      craftingOverlay.classList.add("hidden");
      document.body.classList.remove("state-menu");
      document.body.classList.add("state-playing");
      homeScreen.classList.add("hidden");
      pauseOverlay.classList.add("hidden");
      settingsModal.classList.add("hidden");
      document.getElementById("inventoryOverlay").classList.add("hidden");
      transitionFade.classList.add("show");
      setTimeout(() => {
        transitionFade.classList.remove("show");
        attemptPointerLock();
      }, 250);
    }

    function openSaveFilePicker() {
      saveFileInput.value = "";
      saveFileInput.click();
    }

    saveFileInput.addEventListener("change", async () => {
      const file = saveFileInput.files && saveFileInput.files[0];
      if (!file) return;
      try {
        const text = await file.text();
        loadGameFromData(JSON.parse(text));
      } catch (e) {
        showFatalError("Could not load that save file: " + (e && e.message ? e.message : e));
      }
    });

    loadGameButton.addEventListener("click", (e) => { e.stopPropagation(); openSaveFilePicker(); });

    function tryRestoreLocalBackup() {
      // The local backup does not replace the real save file; it just makes accidental exits
      // less painful. The player still explicitly chooses LOAD GAME for a portable save.
      return null;
    }

    function resetPlayerState() {
      if (playerState.inRocket) exitRocketFlight(true);
      resetInventory();
      economyState.credits = 0;
      economyState.fuelingPad = null;
      economyState.fuelingStartedAt = 0;
      updateCreditsUI();
      orientation.identity();
      playerState.pitch = 0;
      playerState.heightOffset = 0;
      playerState.verticalVelocity = 0;
      playerState.stamina = STAMINA_MAX;
      playerState.exhausted = false;
      playerState.inRocket = false;
      playerState.rocketInSpace = false;
      playerState.rocketLanded = false;
      playerState.rocketFuelTimer = 0;
      document.body.classList.remove('rocket-flight');
      setRocketFlightUI();
      updateStaminaBar();
      setFlashlight(false);
      if (playerState.thirdPerson) toggleThirdPerson(); // back to first-person for the next run
      camera.position.copy(CAM_FIRST);
      targetCamPos.copy(CAM_FIRST);
      player.position.copy(spawnDir).multiplyScalar(PLANET_RADIUS + heightAt(spawnDir) + EYE_HEIGHT);
      player.quaternion.copy(orientation);
      for (const k in systemState.keys) systemState.keys[k] = false;
      clearPhysicalKeys();
    }

    function collectCrystal(spawn) {
      if (spawn.collected) return false;
      // The player must have an available stack/slot before the crystal disappears.
      if (!addItemToInventory(spawn.typeId, 1)) return false;

      spawn.collected = true;
      spawn.crystal.visible = false;
      spawn.ghost.visible = true;
      // Respawn after two complete planet rotations, exactly as before.
      spawn.respawnAtSpin = state.planetSpinAngle + Math.PI * 4;
      return true;
    }

    let nearbyCrystal = null;

    let nearbyTree = null;
    let nearbyRock = null;

    function findNearbyRock() {
      const playerWorld = new THREE.Vector3();
      const cameraWorld = new THREE.Vector3();
      const lookDir = new THREE.Vector3();
      player.getWorldPosition(playerWorld);
      camera.getWorldPosition(cameraWorld);
      camera.getWorldDirection(lookDir).normalize();

      let best = null;
      let bestScore = Infinity;
      const mineableRocks = rockSpawns.concat(ironOreSpawns);
      for (const rock of mineableRocks) {
        if (rock.mined || !rock.root.visible) continue;
        const rockWorld = new THREE.Vector3();
        rock.root.getWorldPosition(rockWorld);
        const toRock = rockWorld.clone().sub(cameraWorld);
        const distance = toRock.length();
        if (distance > 4.8) continue;
        toRock.normalize();
        const facing = lookDir.dot(toRock);
        if (facing < 0.35) continue;
        const score = distance - facing * 0.8;
        if (score < bestScore) {
          bestScore = score;
          best = rock;
        }
      }
      return best;
    }

    function findNearbyTree() {
      const playerWorld = new THREE.Vector3();
      const cameraWorld = new THREE.Vector3();
      const lookDir = new THREE.Vector3();
      player.getWorldPosition(playerWorld);
      camera.getWorldPosition(cameraWorld);
      camera.getWorldDirection(lookDir).normalize();

      let best = null;
      let bestScore = Infinity;
      for (const tree of treeSpawns) {
        if (tree.chopped || !tree.root.visible) continue;
        const treeWorld = new THREE.Vector3();
        tree.root.getWorldPosition(treeWorld);
        const toTree = treeWorld.clone().sub(cameraWorld);
        const distance = toTree.length();
        if (distance > 4.8) continue;
        toTree.normalize();
        const facing = lookDir.dot(toTree);
        if (facing < 0.42) continue;
        const score = distance - facing * 0.8;
        if (score < bestScore) {
          bestScore = score;
          best = tree;
        }
      }
      return best;
    }

    // Chopping now takes the same short action time as mining stone. The player must
    // keep the mouse button held down for the whole duration or the action resets.
    const TREE_CHOP_TIME = 1200;
    let choppingTree = false;
    let choppingTreeStartedAt = 0;
    let choppingTreeTarget = null;

    function chopNearbyTree() {
      if (state.gameState !== 'playing' || state.paused || uiState.inventoryOpen || uiState.craftingOpen || settingsModal.classList.contains('hidden') === false) return false;
      if (uiState.equippedItemType !== 'axe' && uiState.equippedItemType !== 'wooden_axe' && uiState.equippedItemType !== 'stone_axe' && uiState.equippedItemType !== 'iron_axe') return false;
      if (choppingTree) return false;

      const tree = findNearbyTree();
      if (!tree) return false;

      // The requested yield scales exactly with tree size: 1.5x -> 6 planks, 4x -> 16 planks.
      const plankYield = Math.round(tree.size * 4);
      const tool = getCurrentToolSlot();
      if (!tool || tool.slot.durability < plankYield) {
        const prompt = document.getElementById('crystalPrompt');
        prompt.classList.remove('hidden');
        prompt.innerHTML = '<span class="promptKey">LOW</span> Not enough axe durability (' +
          (tool ? tool.slot.durability : 0) + '/' + TOOL_MAX_DURABILITY + ')';
        return false;
      }
      if (!canAddItemToInventory('planks', plankYield)) {
        const prompt = document.getElementById('crystalPrompt');
        prompt.classList.remove('hidden');
        prompt.innerHTML = '<span class="promptKey">FULL</span> Not enough inventory space for ' + plankYield + ' planks';
        return false;
      }

      choppingTree = true;
      choppingTreeTarget = tree;
      choppingTreeStartedAt = performance.now();
      const prompt = document.getElementById('crystalPrompt');
      prompt.classList.remove('hidden');
      prompt.innerHTML = '<span class="promptKey">CHOPPING</span> Chopping Tree…';
      return true;
    }

    function finishChoppingTree() {
      if (!choppingTree) return;
      const elapsed = performance.now() - choppingTreeStartedAt;
      if (elapsed < TREE_CHOP_TIME) return;

      choppingTree = false;
      choppingTreeStartedAt = 0;

      const tree = choppingTreeTarget;
      choppingTreeTarget = null;
      const valid = state.gameState === 'playing' && !state.paused && !uiState.inventoryOpen && !uiState.craftingOpen &&
        settingsModal.classList.contains('hidden') && tree && !tree.chopped && tree.root.visible &&
        findNearbyTree() === tree && mouseButtonDown;
      const prompt = document.getElementById('crystalPrompt');

      if (!valid) {
        prompt.classList.remove('hidden');
        prompt.textContent = 'Chopping canceled';
        setTimeout(() => { if (state.gameState === 'playing') updateCrystalPrompt(); }, 500);
        return;
      }

      const plankYield = Math.round(tree.size * 4);
      const tool = getCurrentToolSlot();
      if (!tool || tool.slot.durability < plankYield || !canAddItemToInventory('planks', plankYield)) {
        prompt.classList.remove('hidden');
        prompt.textContent = 'Chopping canceled';
        setTimeout(() => { if (state.gameState === 'playing') updateCrystalPrompt(); }, 500);
        return;
      }

      addItemToInventory('planks', plankYield);
      useToolDurability(plankYield);
      tree.chopped = true;
      tree.root.visible = false;
      nearbyTree = null;

      prompt.classList.remove('hidden');
      prompt.innerHTML = '<span class="promptKey">+' + plankYield + '</span> Planks collected';
      setTimeout(() => {
        if (state.gameState === 'playing') updateCrystalPrompt();
      }, 900);
    }

    // ---------- stone mining ----------
    // Stone is available only at the top of the mountains. A wooden pickaxe is required,
    // and every successful click gives exactly one stone while consuming one durability.
    const MINEABLE_STONE_MIN_HEIGHT = SNOW_LEVEL;

    function getCurrentToolSlot() {
      const index = getSelectedHotbarInventoryIndex();
      const slot = inventorySlots[index];
      if (!slot) return null;
      const item = itemById[slot.typeId];
      if (!item || !item.tool) return null;
      if (slot.durability == null) slot.durability = getToolMaxDurability(item);
      return { slot, index, item };
    }

    // Consume an exact amount of durability from the equipped tool. This is shared by
    // woodcutting and mining so every tool use updates the UI and handles breaking consistently.
    function useToolDurability(amount = 1) {
      const current = getCurrentToolSlot();
      if (!current || current.slot.durability < amount) return false;

      current.slot.durability = Math.max(0, current.slot.durability - amount);
      const broke = current.slot.durability === 0;
      if (broke) {
        inventorySlots[current.index] = null;
        uiState.equippedItemType = null;
        clearHeldItem(heldCrystalFirstPerson);
        clearHeldItem(heldCrystalThirdPerson);
      }
      updateHotbarUI();
      updateInventoryUI();
      refreshEquippedItem();
      return !broke;
    }

    // Most tool actions, like a single mining hit, only cost one durability point.
    function useToolOnce() {
      return useToolDurability(1);
    }

    function isPickaxe(typeId) {
      return typeId === 'wooden_pickaxe' || typeId === 'stone_pickaxe' || typeId === 'iron_pickaxe' || typeId === 'iron_pickaxe';
    }

    function canMineStoneHere() {
      if (!isPickaxe(uiState.equippedItemType)) return false;
      const dir = player.position.clone().normalize();
      // Regular stone remains a high-mountain resource.
      return heightAt(dir) >= MINEABLE_STONE_MIN_HEIGHT;
    }

    function getMiningTimeForTool(typeId = uiState.equippedItemType) {
      if (typeId === 'iron_pickaxe') return 648;
      return typeId === 'stone_pickaxe' ? 810 : 900;
    }

    // Mining is deliberately not instant. Stone pickaxes mine 10% faster than wooden pickaxes.
    const STONE_MINE_TIME = 900; // milliseconds per stone with a wooden pickaxe
    let miningStone = false;
    let miningStoneStartedAt = 0;
    let miningRock = null;
    let mouseButtonDown = false;
    let nearbyDroppedItem = null;

    function mineStone() {
      if (state.gameState !== 'playing' || state.paused || uiState.inventoryOpen || uiState.craftingOpen || !settingsModal.classList.contains('hidden')) return false;
      if (miningStone) return false;
      const targetRock = findNearbyRock();
      if (!targetRock && !canMineStoneHere()) return false;
      const current = getCurrentToolSlot();
      if (!current || !isPickaxe(current.item.id)) return false;
      if (targetRock && targetRock.oreType === 'iron_ore' && current.item.id !== 'stone_pickaxe' && current.item.id !== 'iron_pickaxe') {
        const prompt = document.getElementById('crystalPrompt');
        prompt.classList.remove('hidden');
        prompt.innerHTML = '<span class="promptKey">LOCKED</span> Iron Ore requires a Stone or Iron Pickaxe';
        return false;
      }
      const minedItemId = targetRock ? (targetRock.oreType === 'iron_ore' ? 'iron_ore' : 'stone') : 'stone';
      if (!canAddItemToInventory(minedItemId, 1)) {
        const prompt = document.getElementById('crystalPrompt');
        prompt.classList.remove('hidden');
        prompt.innerHTML = '<span class="promptKey">FULL</span> Not enough inventory space for ' + (minedItemId === 'iron_ore' ? 'Iron Ore' : 'Stone');
        return false;
      }

      // Start the mining action without changing the inventory yet. The stone is only
      // awarded when the timer finishes successfully. This also means canceling a mine
      // can never accidentally consume or lose a stone.
      miningStone = true;
      miningRock = targetRock;
      miningStoneStartedAt = performance.now();
      const prompt = document.getElementById('crystalPrompt');
      prompt.classList.remove('hidden');
      const targetName = targetRock && targetRock.oreType === 'iron_ore' ? 'Iron Ore' : (targetRock ? 'Boulder' : 'Stone');
      prompt.innerHTML = '<span class="promptKey">MINING</span> Mining ' + targetName + '…';
      return true;
    }

    const FURNACE_BREAK_TIME = 900;
    const SPACE_OBJECT_BREAK_TIME = 2000;
    // Space-object breaking state is shared through systemState.

    function breakNearbySpaceObject() {
      if (state.gameState !== 'playing' || state.paused || uiState.inventoryOpen || uiState.craftingOpen || uiState.furnaceOpen || !settingsModal.classList.contains('hidden')) return false;
      if (uiState.equippedItemType !== 'iron_pickaxe' || systemState.breakingSpaceObject) return false;
      const found = findNearbySpaceObject();
      if (!found) return false;
      if (!canAddItemToInventory(found.type, 1)) {
        const prompt = document.getElementById('crystalPrompt');
        prompt.classList.remove('hidden'); prompt.innerHTML = '<span class="promptKey">FULL</span> Not enough inventory space';
        return false;
      }
      systemState.breakingSpaceObject = true;
      systemState.breakingSpaceObjectStartedAt = performance.now();
      systemState.breakingSpaceObjectTarget = found.target;
      systemState.breakingSpaceObjectType = found.type;
      const prompt = document.getElementById('crystalPrompt');
      prompt.classList.remove('hidden'); prompt.innerHTML = '<span class="promptKey">0%</span> Breaking ' + (found.type === 'rocket' ? 'Rocket' : 'Launch Pad') + '…';
      return true;
    }

    function finishBreakingSpaceObject() {
      if (!systemState.breakingSpaceObject) return;
      const elapsed = performance.now() - systemState.breakingSpaceObjectStartedAt;
      const pct = Math.max(0, Math.min(100, elapsed / SPACE_OBJECT_BREAK_TIME * 100));
      const prompt = document.getElementById('crystalPrompt');
      if (elapsed < SPACE_OBJECT_BREAK_TIME) {
        if (prompt) {
          prompt.classList.remove('hidden');
          prompt.innerHTML = '<span class="promptKey">' + Math.round(pct) + '%</span> Breaking ' + (systemState.breakingSpaceObjectType === 'rocket' ? 'Rocket' : 'Launch Pad') + '…';
        }
        return;
      }
      const target = systemState.breakingSpaceObjectTarget;
      const type = systemState.breakingSpaceObjectType;
      const pad = launchPads.find(p => type === 'rocket' ? (p.rocket && p.rocket.root === target.root) : p.root === target.root);
      const valid = state.gameState === 'playing' && !state.paused && !uiState.inventoryOpen && !uiState.craftingOpen && settingsModal.classList.contains('hidden') && mouseButtonDown && uiState.equippedItemType === 'iron_pickaxe' && target && pad && target.root.visible;
      systemState.breakingSpaceObject = false;
      systemState.breakingSpaceObjectStartedAt = 0;
      systemState.breakingSpaceObjectTarget = null;
      systemState.breakingSpaceObjectType = null;
      if (!valid) {
        if (prompt) { prompt.classList.remove('hidden'); prompt.textContent = 'Breaking canceled'; setTimeout(() => { if (state.gameState === 'playing') updateCrystalPrompt(); }, 500); }
        return;
      }
      addItemToInventory(type, 1);
      if (type === 'rocket') {
        pad.root.remove(target.root);
        pad.rocket = null;
      } else {
        pad.root.visible = false;
        const index = launchPads.indexOf(pad);
        if (index >= 0) launchPads.splice(index, 1);
      }
      updateHotbarUI(); updateInventoryUI(); refreshEquippedItem();
      if (prompt) { prompt.classList.remove('hidden'); prompt.innerHTML = '<span class="promptKey">+1</span> ' + (type === 'rocket' ? 'Rocket' : 'Launch Pad') + ' collected'; setTimeout(() => { if (state.gameState === 'playing') updateCrystalPrompt(); }, 700); }
    }

    function breakNearbyFurnace() {
      if (state.gameState !== 'playing' || state.paused || uiState.inventoryOpen || uiState.craftingOpen || uiState.furnaceOpen || !settingsModal.classList.contains('hidden')) return false;
      if (!isPickaxe(uiState.equippedItemType)) return false;
      if (systemState.breakingFurnace) return false;

      const furnace = findNearbyFurnace();
      if (!furnace) return false;
      const f = furnace.inventory;
      if (f.fuel || f.input || f.output) {
        const prompt = document.getElementById('crystalPrompt');
        prompt.classList.remove('hidden');
        prompt.innerHTML = '<span class="promptKey">EMPTY</span> Empty the furnace before picking it up';
        return false;
      }

      systemState.breakingFurnace = true;
      systemState.breakingFurnaceTarget = furnace;
      systemState.breakingFurnaceStartedAt = performance.now();
      const prompt = document.getElementById('crystalPrompt');
      prompt.classList.remove('hidden');
      prompt.innerHTML = '<span class="promptKey">0%</span> Breaking Furnace…';
      return true;
    }

    function finishBreakingFurnace() {
      if (!systemState.breakingFurnace) return;
      const elapsed = performance.now() - systemState.breakingFurnaceStartedAt;
      const pct = Math.max(0, Math.min(100, elapsed / FURNACE_BREAK_TIME * 100));
      const prompt = document.getElementById('crystalPrompt');
      if (elapsed < FURNACE_BREAK_TIME) {
        if (prompt) {
          prompt.classList.remove('hidden');
          prompt.innerHTML = '<span class="promptKey">' + Math.round(pct) + '%</span> Breaking Furnace…';
        }
        return;
      }

      const furnace = systemState.breakingFurnaceTarget;
      systemState.breakingFurnace = false;
      systemState.breakingFurnaceStartedAt = 0;
      systemState.breakingFurnaceTarget = null;

      const valid = state.gameState === 'playing' && !state.paused && !uiState.inventoryOpen && !uiState.craftingOpen && furnace &&
        furnace.root.visible && findNearbyFurnace() === furnace && mouseButtonDown &&
        isPickaxe(uiState.equippedItemType);
      if (!valid) {
        if (prompt) {
          prompt.classList.remove('hidden');
          prompt.textContent = 'Breaking canceled';
          setTimeout(() => { if (state.gameState === 'playing') updateCrystalPrompt(); }, 500);
        }
        return;
      }
      if (!canAddItemToInventory('furnace', 1)) {
        if (prompt) {
          prompt.classList.remove('hidden');
          prompt.textContent = 'Inventory full — Furnace was not collected';
        }
        return;
      }

      addItemToInventory('furnace', 1);
      furnace.root.visible = false;
      const idx = furnaces.indexOf(furnace);
      if (idx >= 0) furnaces.splice(idx, 1);
      updateHotbarUI();
      updateInventoryUI();
      if (prompt) {
        prompt.classList.remove('hidden');
        prompt.innerHTML = '<span class="promptKey">+1</span> Furnace collected';
        setTimeout(() => { if (state.gameState === 'playing') updateCrystalPrompt(); }, 700);
      }
    }

    function finishMiningStone() {
      if (!miningStone) return;
      const elapsed = performance.now() - miningStoneStartedAt;
      const miningTime = getMiningTimeForTool();
      if (elapsed < miningTime) return;

      miningStone = false;
      miningStoneStartedAt = 0;

      // Re-check the tool/location after the delay so moving away cannot magically mine stone.
      const targetRock = miningRock;
      const validRock = targetRock && !targetRock.mined && targetRock.root.visible && findNearbyRock() === targetRock;
      const validTerrain = !targetRock && canMineStoneHere();
      const valid = state.gameState === 'playing' && !state.paused && !uiState.inventoryOpen && !uiState.craftingOpen &&
        settingsModal.classList.contains('hidden') && mouseButtonDown && (validRock || validTerrain);
      const prompt = document.getElementById('crystalPrompt');
      if (!valid) {
        prompt.classList.remove('hidden');
        prompt.textContent = 'Mining canceled';
        miningRock = null;
        setTimeout(() => { if (state.gameState === 'playing') updateCrystalPrompt(); }, 500);
        return;
      }

      const tool = getCurrentToolSlot();
      if (!tool || !isPickaxe(tool.item.id) || (targetRock && targetRock.oreType === 'iron_ore' && tool.item.id !== 'stone_pickaxe' && tool.item.id !== 'iron_pickaxe')) {
        prompt.classList.remove('hidden');
        prompt.textContent = 'Mining canceled';
        miningRock = null;
        setTimeout(() => { if (state.gameState === 'playing') updateCrystalPrompt(); }, 500);
        return;
      }

      const minedItemId = targetRock ? (targetRock.oreType === 'iron_ore' ? 'iron_ore' : 'stone') : 'stone';
      const minedItemName = minedItemId === 'iron_ore' ? 'Iron Ore' : 'Stone';

      // Put the reserved resource into the inventory only after the mining action succeeds.
      if (!addItemToInventory(minedItemId, 1)) {
        prompt.classList.remove('hidden');
        prompt.textContent = 'Inventory full — ' + minedItemName + ' was not collected';
        setTimeout(() => { if (state.gameState === 'playing') updateCrystalPrompt(); }, 700);
        return;
      }
      if (minedItemId === 'iron_ore') {
        targetRock.mined = true;
        targetRock.root.visible = false;
        miningRock = null;
      }

      const stillUsable = useToolOnce();
      if (targetRock) {
        targetRock.mined = true;
        targetRock.root.visible = false;
        if (nearbyRock === targetRock) nearbyRock = null;
      }
      miningRock = null;
      prompt.classList.remove('hidden');
      if (stillUsable) {
        const current = getCurrentToolSlot();
        const durability = current ? current.slot.durability : 0;
        prompt.innerHTML = '<span class="promptKey">+1</span> ' + minedItemName + ' collected · Pickaxe ' + durability + '/' + getToolMaxDurability(current.item);
      } else {
        prompt.innerHTML = '<span class="promptKey">+1</span> Stone collected · Pickaxe broke';
      }
      setTimeout(() => {
        if (state.gameState === 'playing') updateCrystalPrompt();
      }, 700);
    }

    function updateCrystalPrompt() {
      nearbyCrystal = null;
      nearbyRock = null;
      const prompt = document.getElementById('crystalPrompt');
      if (!prompt || state.gameState !== 'playing' || state.paused || uiState.inventoryOpen || uiState.craftingOpen || uiState.furnaceOpen || economyState.merchantOpen) {
        if (prompt) prompt.classList.add('hidden');
        return;
      }

      if (playerState.inRocket) {
        prompt.classList.remove('hidden');
        const fuel = flightPad ? Math.max(0, Math.floor(Number(flightPad.fuel) || 0)) : 0;
        if (playerState.rocketLanded) {
          prompt.innerHTML = '<span class="promptKey">E</span> Exit spaceship · Landed on launch pad · Fuel ' + fuel + '%';
        } else {
          prompt.innerHTML = 'WASD Move · <span class="promptKey">SPACE</span> Up · <span class="promptKey">SHIFT</span> Down · Fuel ' + fuel + '%';
        }
        return;
      }

      if (economyState.fuelingPad) {
        const elapsed = performance.now() - economyState.fuelingStartedAt;
        const pct = Math.max(0, Math.min(100, elapsed / ROCKET_FUEL_TIME_MS * 100));
        prompt.classList.remove('hidden');
        prompt.innerHTML = '<span class="promptKey">' + Math.round(pct) + '%</span> Filling rocket with fuel…';
        return;
      }

      const nearbyRocketPad = !uiState.equippedItemType ? findRocketEntryPad() : null;
      if (nearbyRocketPad && nearbyRocketPad.rocket) {
        const fuel = Math.max(0, Math.floor(Number(nearbyRocketPad.fuel) || 0));
        prompt.classList.remove('hidden');
        if (fuel > 0) prompt.innerHTML = '<span class="promptKey">E</span> Enter spaceship · Fuel ' + fuel + '%';
        else prompt.innerHTML = 'Rocket empty · Fill it with a jerrycan first';
        return;
      }

      const nearbyMerchant = findNearbyMerchant();
      if (nearbyMerchant) {
        prompt.classList.remove('hidden');
        prompt.innerHTML = '<span class="promptKey">E</span> Talk to Merchant';
        return;
      }

      const nearbyDrop = findNearbyDroppedItem();
      if (nearbyDrop) {
        nearbyDroppedItem = nearbyDrop;
        const dropItem = itemById[nearbyDrop.typeId];
        prompt.classList.remove('hidden');
        prompt.innerHTML = '<span class="promptKey">E</span> Pick up ' + dropItem.name;
        return;
      }
      nearbyDroppedItem = null;

      let nearestDistanceSq = Infinity;
      for (const spawn of crystalSpawns) {
        if (spawn.collected) continue;
        const distanceSq = player.position.distanceToSquared(spawn.root.position);
        if (distanceSq <= CRYSTAL_PICKUP_RADIUS * CRYSTAL_PICKUP_RADIUS && distanceSq < nearestDistanceSq) {
          nearestDistanceSq = distanceSq;
          nearbyCrystal = spawn;
        }
      }

      if (nearbyCrystal) {
        prompt.classList.remove('hidden');
        prompt.innerHTML = '<span class="promptKey">E</span> Press E to collect ' + crystalById[nearbyCrystal.typeId].name;
        return;
      }

      if (choppingTree) {
        const elapsed = performance.now() - choppingTreeStartedAt;
        const pct = Math.max(0, Math.min(100, (elapsed / TREE_CHOP_TIME) * 100));
        const activeTree = choppingTreeTarget;
        const yieldCount = activeTree ? Math.round(activeTree.size * 4) : 0;
        prompt.classList.remove('hidden');
        prompt.innerHTML = '<span class="promptKey">' + Math.round(pct) + '%</span> Chopping Tree for ' + yieldCount + ' Planks…';
        return;
      }

      nearbyTree = findNearbyTree();
      if (nearbyTree && (uiState.equippedItemType === 'axe' || uiState.equippedItemType === 'wooden_axe' || uiState.equippedItemType === 'stone_axe' || uiState.equippedItemType === 'iron_axe')) {
        const yieldCount = Math.round(nearbyTree.size * 4);
        const current = getCurrentToolSlot();
        const maxDurability = current ? getToolMaxDurability(current.item) : TOOL_MAX_DURABILITY;
        const durability = current ? current.slot.durability : maxDurability;
        prompt.classList.remove('hidden');
        prompt.innerHTML = '<span class="promptKey">LMB</span> Chop tree for ' + yieldCount + ' planks · ' + durability + '/' + maxDurability;
        return;
      }

      if (miningStone) {
        const elapsed = performance.now() - miningStoneStartedAt;
        const miningTime = uiState.equippedItemType === 'stone_pickaxe' ? 810 : STONE_MINE_TIME;
        const pct = Math.max(0, Math.min(100, (elapsed / miningTime) * 100));
        prompt.classList.remove('hidden');
        const miningName = miningRock && miningRock.oreType === 'iron_ore' ? 'Iron Ore' : (miningRock ? 'Boulder' : 'Stone');
        prompt.innerHTML = '<span class="promptKey">' + Math.round(pct) + '%</span> Mining ' + miningName + '…';
        return;
      }

      const nearbyFurnace = findNearbyFurnace();
      if (nearbyFurnace) {
        prompt.classList.remove('hidden');
        prompt.innerHTML = '<span class="promptKey">RMB</span> Open Furnace';
        return;
      }

      const nearbyPad = findNearbyLaunchPad();
      if (nearbyPad && nearbyPad.rocket && uiState.equippedItemType === 'jerrycan') {
        prompt.classList.remove('hidden');
        if ((nearbyPad.fuel || 0) >= ROCKET_FUEL_CAPACITY) prompt.innerHTML = '<span class="promptKey">FULL</span> Rocket fuel: ' + (nearbyPad.fuel || 0) + '/' + ROCKET_FUEL_CAPACITY + ' · Remove jerrycan to enter';
        else prompt.innerHTML = '<span class="promptKey">E</span> Fuel Rocket · ' + (nearbyPad.fuel || 0) + '/' + ROCKET_FUEL_CAPACITY;
        return;
      }
      if (nearbyPad && nearbyPad.rocket) {
        prompt.classList.remove('hidden');
        prompt.innerHTML = '<span class="promptKey">E</span> Enter Spaceship · Fuel ' + (nearbyPad.fuel || 0) + '%';
        return;
      }
      if (nearbyPad && uiState.equippedItemType === 'rocket' && !nearbyPad.rocket) {
        prompt.classList.remove('hidden');
        prompt.innerHTML = '<span class="promptKey">E</span> Place Rocket on Launch Pad';
        return;
      }
      if (uiState.equippedItemType === 'launch_pad') {
        prompt.classList.remove('hidden');
        prompt.innerHTML = '<span class="promptKey">E</span> Place Launch Pad';
        return;
      }

      nearbyRock = findNearbyRock();
      if (nearbyRock) {
        const current = getCurrentToolSlot();
        const maxDurability = current ? getToolMaxDurability(current.item) : TOOL_MAX_DURABILITY;
        const durability = current ? current.slot.durability : maxDurability;
        const rockName = nearbyRock.oreType === 'iron_ore' ? 'Iron Ore Boulder' : 'Boulder';
        const rewardName = nearbyRock.oreType === 'iron_ore' ? '1 Iron Ore' : '1 Stone';
        prompt.classList.remove('hidden');
        if (nearbyRock.oreType === 'iron_ore' && uiState.equippedItemType !== 'stone_pickaxe' && uiState.equippedItemType !== 'iron_pickaxe') {
          prompt.innerHTML = '<span class="promptKey">LOCKED</span> Iron Ore requires a Stone Pickaxe';
        } else if (isPickaxe(uiState.equippedItemType)) {
          prompt.innerHTML = '<span class="promptKey">LMB</span> Mine ' + rockName + ' for ' + rewardName + ' · ' + durability + '/' + maxDurability;
        } else {
          prompt.innerHTML = '<span class="promptKey">LOCKED</span> Equip a Pickaxe to mine ' + rockName;
        }
        return;
      }

      if (canMineStoneHere()) {
        const current = getCurrentToolSlot();
        const maxDurability = current ? getToolMaxDurability(current.item) : TOOL_MAX_DURABILITY;
        const durability = current ? current.slot.durability : maxDurability;
        prompt.classList.remove('hidden');
        prompt.innerHTML = '<span class="promptKey">LMB</span> Mine Stone · ' + durability + '/' + maxDurability;
        return;
      }

      prompt.classList.add('hidden');
    }

    function tryPickupNearbyDroppedItem() {
      if (state.gameState !== 'playing' || state.paused || uiState.inventoryOpen || uiState.craftingOpen || uiState.furnaceOpen) return false;
      const drop = findNearbyDroppedItem();
      if (!drop) return false;
      if (!canAddItemToInventory(drop.typeId, drop.count)) {
        const prompt = document.getElementById('crystalPrompt');
        prompt.classList.remove('hidden'); prompt.textContent = 'Inventory full — make room first';
        return true;
      }
      addItemToInventory(drop.typeId, drop.count);
      drop.root.visible = false;
      const idx = droppedItems.indexOf(drop);
      if (idx >= 0) droppedItems.splice(idx, 1);
      nearbyDroppedItem = null;
      const prompt = document.getElementById('crystalPrompt');
      prompt.classList.remove('hidden'); prompt.innerHTML = '<span class="promptKey">+1</span> ' + itemById[drop.typeId].name + ' collected';
      setTimeout(() => { if (state.gameState === 'playing') updateCrystalPrompt(); }, 500);
      return true;
    }

    function tryCollectNearbyCrystal() {
      if (state.gameState !== 'playing' || state.paused || uiState.inventoryOpen || uiState.craftingOpen || !nearbyCrystal) return;
      if (!collectCrystal(nearbyCrystal)) {
        const prompt = document.getElementById('crystalPrompt');
        prompt.classList.remove('hidden');
        prompt.textContent = 'Inventory full — make room first';
      } else {
        nearbyCrystal = null;
        document.getElementById('crystalPrompt').classList.add('hidden');
      }
    }

    function updateCrystalRespawns() {
      // Using the planet's accumulated spin angle keeps respawns synchronized with the
      // same rotation that drives the day/night cycle.
      for (const spawn of crystalSpawns) {
        if (!spawn.collected) continue;
        if (state.planetSpinAngle >= spawn.respawnAtSpin) {
          spawn.collected = false;
          spawn.crystal.visible = true;
          spawn.ghost.visible = false;
          spawn.respawnAtSpin = 0;
        }
      }
    }

    function pauseGame() {
      state.paused = true;
      pauseOverlay.classList.remove("hidden");
      if (document.pointerLockElement === canvas) document.exitPointerLock();
      for (const k in systemState.keys) systemState.keys[k] = false;
      clearPhysicalKeys(); // stop any movement that was mid-stride
    }
    function resumeFromPause() {
      state.paused = false;
      pauseOverlay.classList.add("hidden");
      attemptPointerLock();
    }
    function goToMenu() {
      if (playerState.inRocket) exitRocketFlight(true);
      // Keep an automatic browser backup before resetting the live world. The portable JSON
      // save is still created with the Save Game button.
      try { persistLocalBackup(); } catch (e) {}
      state.paused = false;
      uiState.craftingOpen = false;
      if (economyState.merchantOpen) {
        economyState.merchantOpen = false;
        merchantOverlay.classList.add("hidden");
        economyState.selectedSellTypeId = null;
        economyState.merchantSection = 'dialogue';
      }
      economyState.fuelingPad = null;
      economyState.fuelingStartedAt = 0;
      craftingOverlay.classList.add("hidden");
      pauseOverlay.classList.add("hidden");
      settingsModal.classList.add("hidden");
      modeChooser.classList.add("hidden");
      if (document.pointerLockElement === canvas) document.exitPointerLock();
      resetPlayerState();

      transitionFade.classList.add("show");
      setTimeout(() => {
        state.gameState = "menu";
        document.body.classList.remove("state-playing");
        document.body.classList.add("state-menu");
        homeScreen.classList.remove("hidden");
        transitionFade.classList.remove("show");
      }, 450);
    }

    function attemptPointerLock() {
      try {
        const rpl = canvas.requestPointerLock
          || canvas.webkitRequestPointerLock
          || canvas.mozRequestPointerLock;
        if (rpl) rpl.call(canvas);
      } catch (e) {
        // ignored — the drag-to-look fallback still works either way
      }
    }

    const modeChooser = document.getElementById('modeChooser');
    const survivalModeButton = document.getElementById('survivalModeButton');
    const freeplayModeButton = document.getElementById('freeplayModeButton');
    const modeBackButton = document.getElementById('modeBackButton');

    function openModeChooser() {
      modeChooser.classList.remove('hidden');
      if (document.pointerLockElement === canvas) document.exitPointerLock();
    }

    function closeModeChooser() {
      modeChooser.classList.add('hidden');
    }

    function startGame(mode = 'survival') {
      state.gameMode = mode === 'freeplay' ? 'freeplay' : 'survival';

      // Starting a new game always begins with the normal fresh-player state.
      resetPlayerState();
      closeModeChooser();

      // pointer lock must be requested synchronously, right inside this real click
      // handler, or the browser will silently refuse it
      attemptPointerLock();

      state.gameState = "playing";
      document.body.classList.remove("state-menu");
      document.body.classList.add("state-playing");

      // mask the instant camera swap behind a quick fade rather than a hard cut
      transitionFade.classList.add("show");
      setTimeout(() => {
        homeScreen.classList.add("hidden");
        transitionFade.classList.remove("show");
      }, 450);
    }

    playButton.addEventListener("click", (e) => { e.stopPropagation(); openModeChooser(); });
    survivalModeButton.addEventListener('click', (e) => { e.stopPropagation(); startGame('survival'); });
    freeplayModeButton.addEventListener('click', (e) => { e.stopPropagation(); startGame('freeplay'); });
    modeBackButton.addEventListener('click', (e) => { e.stopPropagation(); closeModeChooser(); });
    modeChooser.addEventListener('click', (e) => { if (e.target === modeChooser) closeModeChooser(); });

    const resumeButton = document.getElementById("resumeButton");
    const saveGameButton = document.getElementById("saveGameButton");
    const pauseSettingsButton = document.getElementById("pauseSettingsButton");
    const pauseMenuButton = document.getElementById("pauseMenuButton");
    resumeButton.addEventListener("click", (e) => { e.stopPropagation(); resumeFromPause(); });
    saveGameButton.addEventListener("click", (e) => { e.stopPropagation(); saveGameToFile(); });
    pauseSettingsButton.addEventListener("click", (e) => { e.stopPropagation(); openSettings(); });
    pauseMenuButton.addEventListener("click", (e) => { e.stopPropagation(); goToMenu(); });

    // clicking the dimmed backdrop (not the panel/buttons) also resumes
    pauseOverlay.addEventListener("click", (e) => {
      if (e.target === pauseOverlay) resumeFromPause();
    });

    document.addEventListener("pointerlockchange", () => {
      if (state.gameState !== "playing") return;
      if (document.pointerLockElement === canvas) {
        state.paused = false;
        pauseOverlay.classList.add("hidden");
      } else {
        // Opening the inventory intentionally releases pointer lock; that should not
        // also trigger the normal pause overlay.
        if (!playerState.inRocket && !uiState.inventoryOpen && !economyState.merchantOpen) pauseGame();
      }
    });

    document.addEventListener("pointerlockerror", () => {
      // lock unavailable here; pauseOverlay/homeScreen stay as they are, drag-to-look takes over
    });

    document.getElementById('furnaceClose').addEventListener('click', (e) => { e.stopPropagation(); closeFurnace(); });
    // Furnace slots now use drag-and-drop instead of click-to-select swapping.
    document.getElementById('furnaceOverlay').addEventListener('click', (e) => { if (e.target === e.currentTarget) closeFurnace(); });
    window.addEventListener('mousedown', (e) => {
      if (e.button !== 2) return;
      if (state.gameState === 'playing' && !playerState.inRocket && !uiState.inventoryOpen && !uiState.craftingOpen && !uiState.furnaceOpen) {
        const furnace = findNearbyFurnace();
        if (furnace) {
          e.preventDefault();
          openFurnace(furnace);
          return;
        }
      }
      if (uiState.furnaceOpen) e.preventDefault();
    });
    window.addEventListener('contextmenu', (e) => {
      if (state.gameState === 'playing' && !playerState.inRocket && !uiState.inventoryOpen && !uiState.craftingOpen && !uiState.furnaceOpen) {
        const furnace=findNearbyFurnace();
        if (furnace) { e.preventDefault(); openFurnace(furnace); return; }
      }
      if (uiState.furnaceOpen) e.preventDefault();
    });
    // ---------- keyboard input ----------
    // Keep a dedicated physical-key map as a safety net. The gameplay state can be
    // cleared when opening/closing UI, so movement keys are read from this map first.
    const physicalKeys = Object.create(null);
    const mobileKeys = Object.create(null);
    const isPhysicalKeyDown = (code) => !!physicalKeys[code] || !!systemState.keys[code] || !!mobileKeys[code];
    const clearPhysicalKeys = () => { for (const k in physicalKeys) physicalKeys[k] = false; };

    // Keyboard state is shared through systemState.
    const GAME_KEYS = new Set([
      "KeyW", "KeyA", "KeyS", "KeyD",
      "KeyQ",
      "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight",
      "Space", "ShiftLeft", "ShiftRight", "KeyC", "KeyF", "KeyI", "KeyE", "KeyM",
      "Digit1", "Digit2", "Digit3", "Digit4"
    ]);

    window.addEventListener("keydown", (e) => {
      physicalKeys[e.code] = true;
      if (e.code === "KeyE" && !e.repeat && state.gameState === "playing" && !state.paused && settingsModal.classList.contains("hidden") && playerState.inRocket) {
        e.preventDefault();
        exitRocketFlight(false);
        return;
      }

      if (e.code === "KeyE" && !e.repeat && state.gameState === "playing" && !state.paused && !uiState.inventoryOpen && !economyState.merchantOpen && settingsModal.classList.contains("hidden")) {
        e.preventDefault();
        if (openMerchant()) return;
        if (startRocketFueling()) return;
        if (!uiState.equippedItemType && enterRocket()) return;
        if (uiState.equippedItemType === 'furnace' && tryPlaceFurnace()) return;
        if (uiState.equippedItemType === 'launch_pad' && tryPlaceLaunchPad()) return;
        if (uiState.equippedItemType === 'rocket' && tryPlaceRocketOnNearbyPad()) return;
        if (tryPickupNearbyDroppedItem()) return;
        tryCollectNearbyCrystal();
        return;
      }

      if (e.code === "KeyQ" && !e.repeat && state.gameState === "playing") {
        if (playerState.inRocket) return;
        e.preventDefault();
        let ref = null;
        if (uiState.inventoryOpen || uiState.furnaceOpen) ref = hoveredItemRef;
        else if (settingsModal.classList.contains("hidden")) {
          const idx = getSelectedHotbarInventoryIndex();
          if (inventorySlots[idx]) ref = { type: 'inventory', index: idx };
        }
        if (ref) dropOneItemFromRef(ref);
        return;
      }

      if (e.code === "KeyI" && !e.repeat && state.gameState === "playing" && settingsModal.classList.contains("hidden")) {
        if (playerState.inRocket) return;
        e.preventDefault();
        toggleInventory();
        return;
      }

      if (e.code === "Digit1" || e.code === "Digit2" || e.code === "Digit3" || e.code === "Digit4") {
        if (playerState.inRocket) return;
        if (state.gameState === "playing" && !uiState.inventoryOpen && settingsModal.classList.contains("hidden")) {
          e.preventDefault();
          selectHotbarSlot(Number(e.code.slice(-1)) - 1);
        }
        return;
      }

      if (e.code === "KeyM" && !e.repeat && state.gameState === "playing" && settingsModal.classList.contains("hidden")) {
        e.preventDefault();
        togglePlanetMap();
        return;
      }

      if (e.code === "Escape") {
        if (mapOpen) {
          closePlanetMap();
          return;
        }
        if (economyState.merchantOpen) {
          closeMerchant();
          return;
        }
        if (!modeChooser.classList.contains('hidden')) {
          closeModeChooser();
          return;
        }
        if (uiState.craftingOpen) {
          closeCrafting();
          return;
        }
        if (uiState.inventoryOpen) {
          closeInventory();
          return;
        }
        if (!settingsModal.classList.contains("hidden")) {
          closeSettings();
        } else if (state.gameState === "playing") {
          if (pauseOverlay.classList.contains("hidden")) pauseGame();
          else resumeFromPause();
        }
      }
      if (GAME_KEYS.has(e.code)) e.preventDefault();
      systemState.keys[e.code] = true;
      if (e.code === "KeyC" && !e.repeat && state.gameState === "playing") {
        if (!playerState.inRocket) toggleThirdPerson();
      }
      if (e.code === "KeyF" && !e.repeat && state.gameState === "playing" && settingsModal.classList.contains("hidden")) {
        if (playerState.inRocket) return;
        setFlashlight(!playerState.flashlightOn);
      }
    });
    window.addEventListener("keyup", (e) => {
      if (GAME_KEYS.has(e.code)) e.preventDefault();
      physicalKeys[e.code] = false;
      systemState.keys[e.code] = false;
    });
    window.addEventListener("blur", () => {
      clearPhysicalKeys();
      for (const k in systemState.keys) systemState.keys[k] = false;
      for (const k in mobileKeys) mobileKeys[k] = false;
      clearPhysicalKeys();
    });

    // ---------- mobile controls ----------
    const mobileControls = document.getElementById("mobileControls");
    const mobileControlsToggle = document.getElementById("mobileControlsToggle");
    const mobileMoreMenu = document.getElementById("mobileMoreMenu");
    const mobileJoystick = document.getElementById("mobileJoystick");
    const mobileJoystickKnob = document.getElementById("mobileJoystickKnob");
    const mobileButtons = {
      jump: document.getElementById("mobileJumpButton"),
      sprint: document.getElementById("mobileSprintButton"),
      flashlight: document.getElementById("mobileFlashlightButton"),
      interact: document.getElementById("mobileInteractButton"),
      more: document.getElementById("mobileMoreButton")
    };
    const MOBILE_SETTINGS_KEY = "pocketUniverseMobileControls";
    const mobileTouchDevice = navigator.maxTouchPoints > 0 || "ontouchstart" in window;
    let mobileEnabled = localStorage.getItem(MOBILE_SETTINGS_KEY) === null ? mobileTouchDevice : localStorage.getItem(MOBILE_SETTINGS_KEY) === "1";

    function setMobileControlsEnabled(enabled) {
      mobileEnabled = !!enabled;
      localStorage.setItem(MOBILE_SETTINGS_KEY, mobileEnabled ? "1" : "0");
      document.body.classList.toggle("mobile-controls-on", mobileEnabled);
      mobileControls.classList.toggle("mobileEnabled", mobileEnabled && state.gameState === "playing");
      mobileControls.classList.add("showLookHint");
      mobileControls.setAttribute("aria-hidden", mobileEnabled && state.gameState === "playing" ? "false" : "true");
      if (mobileControlsToggle) mobileControlsToggle.checked = mobileEnabled;
      if (!mobileEnabled) {
        for (const k in mobileKeys) mobileKeys[k] = false;
        mobileMoreMenu.classList.add("hidden");
        mobileMoreMenu.setAttribute("aria-hidden", "true");
        mobileJoystickKnob.style.transform = "translate3d(0,0,0)";
      }
    }
    setMobileControlsEnabled(mobileEnabled);
    mobileControlsToggle?.addEventListener("change", () => setMobileControlsEnabled(mobileControlsToggle.checked));

    function updateMobileControlsVisibility() {
      const visible = mobileEnabled && state.gameState === "playing" && !state.paused && settingsModal.classList.contains("hidden") && !mapOpen && !economyState.merchantOpen && !uiState.inventoryOpen && !uiState.craftingOpen && !uiState.furnaceOpen;
      mobileControls.classList.toggle("mobileEnabled", visible);
      mobileControls.setAttribute("aria-hidden", visible ? "false" : "true");
      if (!visible) {
        for (const k in mobileKeys) mobileKeys[k] = false;
        mobileJoystickKnob.style.transform = "translate3d(0,0,0)";
        mobileMoreMenu.classList.add("hidden");
      }
    }

    function mobilePress(code, down) { mobileKeys[code] = !!down; }

    function mobileReleaseAll() {
      for (const k in mobileKeys) mobileKeys[k] = false;
      mobileButtons.sprint?.classList.remove("active");
      mobileButtons.jump?.classList.remove("active");
    }

    mobileButtons.jump?.addEventListener("pointerdown", (e) => {
      e.preventDefault(); e.stopPropagation();
      if (!mobileEnabled || state.gameState !== "playing" || state.paused) return;
      if (playerState.inRocket) mobilePress("Space", true);
      else mobilePress("Space", true);
      mobileButtons.jump.classList.add("active");
    });
    mobileButtons.jump?.addEventListener("pointerup", (e) => { e.preventDefault(); mobilePress("Space", false); mobileButtons.jump.classList.remove("active"); });
    mobileButtons.jump?.addEventListener("pointercancel", () => { mobilePress("Space", false); mobileButtons.jump.classList.remove("active"); });

    mobileButtons.sprint?.addEventListener("pointerdown", (e) => {
      e.preventDefault(); e.stopPropagation();
      if (!mobileEnabled || state.gameState !== "playing" || state.paused || playerState.inRocket) return;
      mobilePress("ShiftLeft", true); mobileButtons.sprint.classList.add("active");
    });
    mobileButtons.sprint?.addEventListener("pointerup", (e) => { e.preventDefault(); mobilePress("ShiftLeft", false); mobileButtons.sprint.classList.remove("active"); });
    mobileButtons.sprint?.addEventListener("pointercancel", () => { mobilePress("ShiftLeft", false); mobileButtons.sprint.classList.remove("active"); });

    mobileButtons.flashlight?.addEventListener("pointerup", (e) => {
      e.preventDefault(); e.stopPropagation();
      if (!mobileEnabled || state.gameState !== "playing" || state.paused || playerState.inRocket) return;
      setFlashlight(!playerState.flashlightOn);
    });

    mobileButtons.interact?.addEventListener("pointerup", (e) => {
      e.preventDefault(); e.stopPropagation();
      if (!mobileEnabled || state.gameState !== "playing" || state.paused) return;
      if (playerState.inRocket) { exitRocketFlight(false); return; }
      if (uiState.inventoryOpen || economyState.merchantOpen || !settingsModal.classList.contains("hidden")) return;
      if (openMerchant()) return;
      if (startRocketFueling()) return;
      if (!uiState.equippedItemType && enterRocket()) return;
      if (uiState.equippedItemType === "furnace" && tryPlaceFurnace()) return;
      if (uiState.equippedItemType === "launch_pad" && tryPlaceLaunchPad()) return;
      if (uiState.equippedItemType === "rocket" && tryPlaceRocketOnNearbyPad()) return;
      if (tryPickupNearbyDroppedItem()) return;
      tryCollectNearbyCrystal();
    });

    mobileButtons.more?.addEventListener("pointerup", (e) => {
      e.preventDefault(); e.stopPropagation();
      mobileMoreMenu.classList.toggle("hidden");
      mobileMoreMenu.setAttribute("aria-hidden", mobileMoreMenu.classList.contains("hidden") ? "true" : "false");
    });
    document.getElementById("mobileMapButton")?.addEventListener("pointerup", (e) => {
      e.preventDefault(); e.stopPropagation();
      mobileMoreMenu.classList.add("hidden");
      if (playerState.inRocket && playerState.rocketInSpace) return;
      togglePlanetMap();
    });
    document.getElementById("mobileInventoryButton")?.addEventListener("pointerup", (e) => {
      e.preventDefault(); e.stopPropagation();
      mobileMoreMenu.classList.add("hidden");
      if (playerState.inRocket) return;
      toggleInventory();
    });

    // Movement joystick. Its vector is mapped directly onto the same WASD state used by the
    // desktop movement loop, so player and rocket use the exact same camera-relative movement.
    let mobileJoystickPointerId = null;
    const JOYSTICK_RADIUS = 72;
    function updateJoystickFromPoint(clientX, clientY) {
      const r = mobileJoystick.getBoundingClientRect();
      let x = clientX - (r.left + r.width / 2);
      let y = clientY - (r.top + r.height / 2);
      const len = Math.hypot(x, y);
      if (len > JOYSTICK_RADIUS) { x *= JOYSTICK_RADIUS / len; y *= JOYSTICK_RADIUS / len; }
      mobileJoystickKnob.style.transform = `translate3d(${x}px,${y}px,0)`;
      const nx = x / JOYSTICK_RADIUS, ny = y / JOYSTICK_RADIUS;
      const dead = 0.20;
      mobilePress("KeyA", nx < -dead); mobilePress("KeyD", nx > dead);
      mobilePress("KeyW", ny < -dead); mobilePress("KeyS", ny > dead);
    }
    function resetJoystick() { mobileJoystickPointerId = null; mobileJoystickKnob.style.transform = "translate3d(0,0,0)"; mobilePress("KeyW",false); mobilePress("KeyA",false); mobilePress("KeyS",false); mobilePress("KeyD",false); }
    mobileJoystick?.addEventListener("pointerdown", (e) => {
      e.preventDefault(); e.stopPropagation(); mobileJoystickPointerId = e.pointerId; mobileJoystick.setPointerCapture?.(e.pointerId); updateJoystickFromPoint(e.clientX,e.clientY);
    });
    mobileJoystick?.addEventListener("pointermove", (e) => { if (e.pointerId === mobileJoystickPointerId) { e.preventDefault(); updateJoystickFromPoint(e.clientX,e.clientY); } });
    mobileJoystick?.addEventListener("pointerup", (e) => { if (e.pointerId === mobileJoystickPointerId) resetJoystick(); });
    mobileJoystick?.addEventListener("pointercancel", (e) => { if (e.pointerId === mobileJoystickPointerId) resetJoystick(); });

    // Touch look. A swipe on the game area rotates the same camera variables as mouse look;
    // controls/joystick consume their own touches, so two-finger play remains possible.
    let mobileLookPointerId = null, mobileLookX = 0, mobileLookY = 0;
    canvas.addEventListener("pointerdown", (e) => {
      if (!mobileEnabled || e.pointerType !== "touch" || state.gameState !== "playing" || state.paused) return;
      if (e.target.closest && e.target.closest("button,#mobileJoystick,#mobileMoreMenu,#hotbar,#mapOverlay,#inventoryOverlay,#merchantOverlay,#settingsModal")) return;
      mobileLookPointerId = e.pointerId; mobileLookX = e.clientX; mobileLookY = e.clientY;
      canvas.setPointerCapture?.(e.pointerId);
      // Start a touch hold as the mobile equivalent of holding LMB to break.
      mouseButtonDown = true;
      if (!playerState.inRocket && !uiState.inventoryOpen && settingsModal.classList.contains("hidden")) {
        if (uiState.equippedItemType === "wooden_pickaxe" || uiState.equippedItemType === "stone_pickaxe" || uiState.equippedItemType === "iron_pickaxe") {
          if (uiState.equippedItemType === "iron_pickaxe" && breakNearbySpaceObject()) return;
          if (!breakNearbyFurnace()) mineStone();
        } else if (uiState.equippedItemType === "axe" || uiState.equippedItemType === "wooden_axe" || uiState.equippedItemType === "stone_axe" || uiState.equippedItemType === "iron_axe") chopNearbyTree();
      }
    }, { passive:false });
    canvas.addEventListener("pointermove", (e) => {
      if (e.pointerId !== mobileLookPointerId || e.pointerType !== "touch") return;
      const dx = e.clientX - mobileLookX, dy = e.clientY - mobileLookY; mobileLookX = e.clientX; mobileLookY = e.clientY;
      if (Math.hypot(dx,dy) > 6) mobileControls.classList.remove("showLookHint");
      if (playerState.inRocket) {
        flightCameraYaw.value -= dx * 0.012;
        flightCameraPitch.value = Math.max(-Math.PI/2, Math.min(Math.PI/2, flightCameraPitch.value - dy * 0.009));
      } else if (playerState.thirdPerson) {
        const up = thirdPersonCameraUp.copy(player.position).normalize();
        thirdPersonCameraYawQuat.setFromAxisAngle(up, -dx * 0.012);
        thirdPersonCameraForward.applyQuaternion(thirdPersonCameraYawQuat);
        thirdPersonCameraForward.addScaledVector(up, -thirdPersonCameraForward.dot(up));
        thirdPersonCameraForward.normalize();
        playerState.thirdPersonOrbitPitch = Math.max(-0.35, Math.min(0.85, playerState.thirdPersonOrbitPitch - dy * 0.009));
      } else {
        const yawQuat = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,1,0), -dx * 0.012);
        orientation.multiply(yawQuat); playerState.pitch = Math.max(-MAX_PITCH, Math.min(MAX_PITCH, playerState.pitch - dy * 0.009));
      }
      if (Math.hypot(dx,dy) > 12 && !playerState.inRocket) {
        choppingTree = false; choppingTreeStartedAt = 0; choppingTreeTarget = null; miningStone = false; miningStoneStartedAt = 0; miningRock = null;
        systemState.breakingFurnace = false; systemState.breakingFurnaceStartedAt = 0; systemState.breakingFurnaceTarget = null;
      }
      e.preventDefault();
    }, { passive:false });
    const endMobileLook = (e) => { if (e.pointerId === mobileLookPointerId) { mobileLookPointerId = null; mouseButtonDown = false; } };
    canvas.addEventListener("pointerup", endMobileLook); canvas.addEventListener("pointercancel", endMobileLook);

    // Keep mobile controls synchronized when the game starts/pauses/opens an overlay.
    document.addEventListener("pointerlockchange", updateMobileControlsVisibility);

    // ---------- main-menu planet rotation ----------
    // The menu buttons/overlay are drawn on top of the Three.js canvas, so listening
    // for mousedown directly on the canvas is unreliable: the canvas often never
    // receives the event. Instead, we listen at the window level so dragging works
    // even when the cursor starts over the visible menu area.
    window.addEventListener("pointerdown", (e) => {
      if (state.gameState !== "menu" || e.button !== 0) return;

      // Do not start rotating when the player is clicking a menu button or control.
      if (e.target.closest && e.target.closest("button, #controlsToggle, #settingsModal")) return;

      systemState.menuDragging = true;
      systemState.menuLastX = e.clientX;
      systemState.menuLastY = e.clientY;
      document.body.style.cursor = "grabbing";
      e.preventDefault();
    });

    window.addEventListener("pointerup", () => {
      if (!systemState.menuDragging) return;
      systemState.menuDragging = false;
      document.body.style.cursor = "default";
    });

    window.addEventListener("pointercancel", () => {
      if (!systemState.menuDragging) return;
      systemState.menuDragging = false;
      document.body.style.cursor = "default";
    });

    window.addEventListener("pointermove", (e) => {
      if (!systemState.menuDragging || state.gameState !== "menu") return;

      // Measure cursor movement since the previous event and turn it into camera angles.
      const dx = e.clientX - systemState.menuLastX;
      const dy = e.clientY - systemState.menuLastY;
      systemState.menuLastX = e.clientX;
      systemState.menuLastY = e.clientY;

      // Horizontal dragging rotates around the planet; vertical dragging tilts the view.
      renderState.menuOrbitYaw -= dx * MENU_ROTATE_SENSITIVITY;
      renderState.menuOrbitPitch += dy * MENU_ROTATE_SENSITIVITY;

      // Prevent flipping upside-down at the poles, which keeps the controls predictable.
      renderState.menuOrbitPitch = Math.max(
        -MENU_MAX_PITCH,
        Math.min(MENU_MAX_PITCH, renderState.menuOrbitPitch)
      );
    });

    // Use a normal cursor on the menu until the player starts dragging the planet.
    document.body.style.cursor = "default";

    // ---------- mouse look: pointer lock, with a drag-to-look fallback ----------
    let isDragging = false;

    canvas.addEventListener("mousedown", (e) => {
      if (state.gameState === "playing" && e.button === 0) {
        isDragging = true;
        if (playerState.inRocket) { mouseButtonDown = true; return; }
        mouseButtonDown = true;
        // When an axe/pickaxe is equipped, holding left-click starts the corresponding
        // action. Releasing the button cancels the action and resets its progress.
        if (!uiState.inventoryOpen && settingsModal.classList.contains("hidden")) {
          if (uiState.equippedItemType === 'wooden_pickaxe' || uiState.equippedItemType === 'stone_pickaxe' || uiState.equippedItemType === 'iron_pickaxe') {
            if (uiState.equippedItemType === 'iron_pickaxe' && breakNearbySpaceObject()) return;
            if (!breakNearbyFurnace()) mineStone();
          }
          else if (uiState.equippedItemType === 'axe' || uiState.equippedItemType === 'wooden_axe' || uiState.equippedItemType === 'stone_axe' || uiState.equippedItemType === 'iron_axe') chopNearbyTree();
        }
      }
    });
    window.addEventListener("mouseup", (e) => {
      if (e.button === 0 || e.button === undefined) {
        isDragging = false;
        mouseButtonDown = false;
        if (choppingTree || miningStone) {
          choppingTree = false;
          choppingTreeStartedAt = 0;
          choppingTreeTarget = null;
          miningStone = false;
          miningStoneStartedAt = 0;
          miningRock = null;
          systemState.breakingFurnace = false;
          systemState.breakingFurnaceStartedAt = 0;
          systemState.breakingFurnaceTarget = null;
          systemState.breakingSpaceObject = false;
          systemState.breakingSpaceObjectStartedAt = 0;
          systemState.breakingSpaceObjectTarget = null;
          systemState.breakingSpaceObjectType = null;
          const prompt = document.getElementById('crystalPrompt');
          if (prompt) prompt.classList.add('hidden');
        }
      }
    });
    window.addEventListener("blur", () => {
      isDragging = false;
      mouseButtonDown = false;
      choppingTree = false;
      choppingTreeStartedAt = 0;
      choppingTreeTarget = null;
      miningStone = false;
      miningStoneStartedAt = 0;
      miningRock = null;
    });

    document.addEventListener("mousemove", (e) => {
      if (state.gameState !== "playing") return;
      if (mapOpen) return;
      const locked = document.pointerLockElement === canvas;
      if (!locked && !isDragging) return;

      const dx = e.movementX * MOUSE_SENSITIVITY;
      const dy = e.movementY * MOUSE_SENSITIVITY;

      if (playerState.inRocket) {
        flightCameraYaw.value -= dx * 1.35;
        flightCameraPitch.value = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, flightCameraPitch.value - dy * 0.85));
        return;
      }

      if (playerState.thirdPerson) {
        // Borrow the ship's camera-relative control approach: rotate a dedicated camera
        // heading around the local planetary up vector. The heading is NOT derived from
        // the player's facing, so turning the character never feeds back into movement.
        const up = thirdPersonCameraUp.copy(player.position).normalize();
        thirdPersonCameraYawQuat.setFromAxisAngle(up, -dx * 1.35);
        thirdPersonCameraForward.applyQuaternion(thirdPersonCameraYawQuat);
        thirdPersonCameraForward.addScaledVector(up, -thirdPersonCameraForward.dot(up));
        thirdPersonCameraForward.normalize();
        playerState.thirdPersonOrbitPitch = Math.max(-0.35, Math.min(0.85, playerState.thirdPersonOrbitPitch - dy * 0.85));
      } else {
        const yawQuat = new THREE.Quaternion().setFromAxisAngle(
          new THREE.Vector3(0, 1, 0), -dx
        );
        orientation.multiply(yawQuat);
        playerState.pitch -= dy;
        playerState.pitch = Math.max(-MAX_PITCH, Math.min(MAX_PITCH, playerState.pitch));
      }
    });

    // ---------- per-frame update ----------
    const tmpUpOld = new THREE.Vector3();
    const tmpDir = new THREE.Vector3();
    const tmpAlign = new THREE.Quaternion();
    const tmpMove = new THREE.Vector3();
    const tmpWorldMove = new THREE.Vector3();
    const collisionCandidate = new THREE.Vector3();
    const collisionPlayerDir = new THREE.Vector3();
    const collisionTreeDir = new THREE.Vector3();
    const collisionTreeOffset = new THREE.Vector3();
    const collisionStallOffset = new THREE.Vector3();
    const collisionStallLocal = new THREE.Vector3();
    const collisionStallInverse = new THREE.Quaternion();
    const collisionTreeInverse = new THREE.Quaternion();
    const collisionTreeLocal = new THREE.Vector3();

    // The player uses a small circular footprint on the planet surface.
    // Because the player and every world prop are children of planetSystem, all collision
    // checks are intentionally performed in planetSystem-local coordinates. Mixing those
    // with getWorldPosition()/worldToLocal() was the reason the previous collisions failed.
    const PLAYER_COLLISION_RADIUS = 0.45;

    function isWorldPositionBlocked(localPosition) {
      // localPosition is already in planetSystem coordinates.
      collisionPlayerDir.copy(localPosition).normalize();

      // Tree collision: use each tree's actual trunk radius (0.30 * size). Compare the
      // candidate and tree directions by their small tangent-plane separation.
      for (const tree of treeSpawns) {
        if (tree.chopped || !tree.root.visible) continue;

        collisionTreeDir.copy(tree.root.position).normalize();
        collisionTreeOffset.copy(tree.root.position).sub(
          collisionPlayerDir.clone().multiplyScalar(tree.root.position.dot(collisionPlayerDir))
        );
        const tangentDistance = collisionTreeOffset.length();
        const treeAngle = collisionPlayerDir.angleTo(collisionTreeDir);
        const trunkRadius = 0.30 * tree.size;

        if (treeAngle < 0.08 && tangentDistance < PLAYER_COLLISION_RADIUS + trunkRadius) {
          return true;
        }
      }

      // Stall collision: convert the candidate from planetSystem-local coordinates to the
      // stall's local coordinates explicitly. crystalStall.worldToLocal() cannot be used here
      // because the candidate is NOT a world-space point.
      if (crystalStall && crystalStall.userData.collision) {
        collisionStallOffset.copy(localPosition).sub(crystalStall.position);
        collisionStallInverse.copy(crystalStall.quaternion).invert();
        collisionStallLocal.copy(collisionStallOffset).applyQuaternion(collisionStallInverse);

        const c = crystalStall.userData.collision;
        if (Math.abs(collisionStallLocal.x) <= c.halfX + c.padding &&
            Math.abs(collisionStallLocal.z) <= c.halfZ + c.padding &&
            Math.abs(collisionStallLocal.y) < 3.0) {
          return true;
        }
      }

      // Mounted rocket collision. The rocket is a child of its launch pad, so its actual
      // planetSystem-local center is derived from the pad's position. A circular footprint
      // is enough here because the player should not be able to walk through the fuselage.
      for (const pad of launchPads) {
        if (!pad.root.visible || !pad.rocket || !pad.rocket.root.visible) continue;
        const rocketDir = pad.root.position.clone().normalize();
        const rocketAngle = collisionPlayerDir.angleTo(rocketDir);
        const rocketSurfaceDistance = rocketAngle * PLANET_RADIUS;
        const rocketRadius = 0.68;
        if (rocketAngle < 0.10 && rocketSurfaceDistance < PLAYER_COLLISION_RADIUS + rocketRadius) {
          return true;
        }
      }

      return false;
    }

    function updatePlayer(delta) {
      let moveX = 0, moveZ = 0;
      if (isPhysicalKeyDown("KeyW") || isPhysicalKeyDown("ArrowUp")) moveZ -= 1;
      if (isPhysicalKeyDown("KeyS") || isPhysicalKeyDown("ArrowDown")) moveZ += 1;
      if (isPhysicalKeyDown("KeyA") || isPhysicalKeyDown("ArrowLeft")) moveX -= 1;
      if (isPhysicalKeyDown("KeyD") || isPhysicalKeyDown("ArrowRight")) moveX += 1;

      const isMoving = (moveX !== 0 || moveZ !== 0);
      const shiftHeld = isPhysicalKeyDown("ShiftLeft") || isPhysicalKeyDown("ShiftRight");

      let speed = MOVE_SPEED;
      if (state.gameMode === 'freeplay') {
        // Freeplay always moves at sprint speed; holding Shift gives an extra boost.
        speed = MOVE_SPEED * SPRINT_MULTIPLIER;
        if (shiftHeld && isMoving) speed *= 1.35;
        playerState.stamina = STAMINA_MAX;
        playerState.exhausted = false;
      } else {
        const wantsSprint = shiftHeld && isMoving && !playerState.exhausted && playerState.stamina > 0;
        if (wantsSprint) {
          speed = MOVE_SPEED * SPRINT_MULTIPLIER;
          playerState.stamina -= STAMINA_DRAIN_PER_SEC * delta;
          if (playerState.stamina <= 0) { playerState.stamina = 0; playerState.exhausted = true; }
        } else {
          playerState.stamina += STAMINA_REGEN_PER_SEC * delta;
          if (playerState.stamina >= STAMINA_EXHAUST_RECOVER) playerState.exhausted = false;
          if (playerState.stamina > STAMINA_MAX) playerState.stamina = STAMINA_MAX;
        }
      }
      updateStaminaBar();

      if (isMoving) {
        tmpMove.set(moveX, 0, moveZ).normalize();

        if (playerState.thirdPerson) {
          // Third-person movement follows the dedicated camera heading, exactly like the
          // ship. Pitch is ignored for movement, so W/A/S/D stay tangent to the planet.
          // Everything here is planetSystem-local, matching player.position and orientation.
          const moveUp = tmpDir;
          const cameraForward = thirdPersonCameraForward;
          cameraForward.addScaledVector(moveUp, -cameraForward.dot(moveUp));
          if (cameraForward.lengthSq() < 0.00001) {
            cameraForward.set(0, 0, -1);
            cameraForward.addScaledVector(moveUp, -cameraForward.dot(moveUp));
          }
          cameraForward.normalize();
          const cameraRight = thirdPersonCameraRight
            .crossVectors(cameraForward, moveUp).normalize();
          tmpWorldMove.copy(cameraRight).multiplyScalar(tmpMove.x)
            .addScaledVector(cameraForward, -tmpMove.z);
        } else {
          tmpWorldMove.copy(tmpMove).applyQuaternion(orientation);
        }

        tmpWorldMove.normalize();
        tmpWorldMove.multiplyScalar(speed * delta);

        // Move in small sub-steps so high sprint speed cannot tunnel through a tree or the
        // stall between frames.  If the full step is blocked, allow each axis independently
        // so the player can naturally slide along the obstacle rather than getting stuck.
        const moveLength = tmpWorldMove.length();
        const subSteps = Math.max(1, Math.ceil(moveLength / 0.28));
        const stepMove = tmpWorldMove.clone().multiplyScalar(1 / subSteps);
        for (let step = 0; step < subSteps; step++) {
          collisionCandidate.copy(player.position).add(stepMove);
          if (!isWorldPositionBlocked(collisionCandidate)) {
            player.position.copy(collisionCandidate);
            continue;
          }

          // The current sub-step would enter an obstacle, so cancel just this small step.
          // The remaining sub-steps still run, which keeps the collision stable even while
          // sprinting and avoids tunnelling through thin trunks.
        }
      }

      tmpDir.copy(player.position).normalize();

      const grounded = playerState.heightOffset <= 0;
      if (grounded && isPhysicalKeyDown("Space")) {
        playerState.verticalVelocity = JUMP_SPEED;
      }
      playerState.verticalVelocity -= GRAVITY * delta;
      playerState.heightOffset += playerState.verticalVelocity * delta;
      if (playerState.heightOffset < 0) {
        playerState.heightOffset = 0;
        playerState.verticalVelocity = 0;
      }

      const groundRadius = PLANET_RADIUS + heightAt(tmpDir);
      const radius = groundRadius + EYE_HEIGHT + playerState.heightOffset;
      player.position.copy(tmpDir).multiplyScalar(radius);

      tmpUpOld.set(0, 1, 0).applyQuaternion(orientation);
      tmpAlign.setFromUnitVectors(tmpUpOld, tmpDir);
      orientation.premultiply(tmpAlign);

      if (playerState.thirdPerson && isMoving) {
        // Turn the character toward the direction of travel while keeping them upright
        // relative to the spherical planet surface.
        const travelDir = tmpWorldMove.clone().normalize();
        const travelRight = new THREE.Vector3().crossVectors(travelDir, tmpDir).normalize();
        const travelBasis = new THREE.Matrix4().makeBasis(
          travelRight,
          tmpDir,
          travelDir.clone().negate()
        );
        orientation.setFromRotationMatrix(travelBasis);
      }

      player.quaternion.copy(orientation);
      if (playerState.thirdPerson) {
        // The camera is still attached to the player for first-person compatibility, but in
        // third person we explicitly place it from a planet-local world position. This keeps
        // the camera orbit stable while the character rotates to face its travel direction.
        const radius = 5.2;
        const up = thirdPersonCameraUp.copy(tmpDir);
        const baseForward = thirdPersonCameraForward
          .addScaledVector(up, -thirdPersonCameraForward.dot(up));
        if (baseForward.lengthSq() < 0.00001) baseForward.set(0, 0, -1);
        baseForward.normalize();
        thirdPersonCameraRight.crossVectors(baseForward, up).normalize();

        // When the player is on/very close to the ground, prevent the third-person camera
        // from orbiting far enough underneath the planet to become buried in the terrain.
        // In the air we keep the full pitch range, so jumping/flying still allows the camera
        // to look freely around the player.
        let allowedPitch = playerState.thirdPersonOrbitPitch;
        const nearGround = playerState.heightOffset <= 1.0 && Math.abs(playerState.verticalVelocity) < 3.5;
        thirdPersonCameraTarget.copy(player.position).addScaledVector(up, 1.05);

        if (nearGround && allowedPitch > 0) {
          // Test the requested pitch first. If it would place the camera below the terrain
          // surface, binary-search the largest safe pitch. This follows the actual terrain
          // height in the camera's direction instead of using a flat global cutoff.
          thirdPersonCameraPitchQuat.setFromAxisAngle(thirdPersonCameraRight, allowedPitch);
          thirdPersonCameraForwardPitched.copy(baseForward).applyQuaternion(thirdPersonCameraPitchQuat).normalize();
          thirdPersonCameraDesired.copy(thirdPersonCameraTarget)
            .addScaledVector(thirdPersonCameraForwardPitched, -radius);

          const cameraSurfaceDir = thirdPersonCameraDesired.clone().normalize();
          const cameraGroundRadius = PLANET_RADIUS + heightAt(cameraSurfaceDir) + 0.22;
          if (thirdPersonCameraDesired.length() < cameraGroundRadius) {
            let low = 0;
            let high = allowedPitch;
            for (let i = 0; i < 8; i++) {
              const mid = (low + high) * 0.5;
              thirdPersonCameraPitchQuat.setFromAxisAngle(thirdPersonCameraRight, mid);
              thirdPersonCameraForwardPitched.copy(baseForward).applyQuaternion(thirdPersonCameraPitchQuat).normalize();
              thirdPersonCameraDesired.copy(thirdPersonCameraTarget)
                .addScaledVector(thirdPersonCameraForwardPitched, -radius);
              const testDir = thirdPersonCameraDesired.clone().normalize();
              const testGroundRadius = PLANET_RADIUS + heightAt(testDir) + 0.22;
              if (thirdPersonCameraDesired.length() >= testGroundRadius) low = mid;
              else high = mid;
            }
            allowedPitch = low;
          }
        }

        thirdPersonCameraPitchQuat.setFromAxisAngle(thirdPersonCameraRight, allowedPitch);
        thirdPersonCameraForwardPitched.copy(baseForward).applyQuaternion(thirdPersonCameraPitchQuat).normalize();

        thirdPersonCameraDesired.copy(thirdPersonCameraTarget)
          .addScaledVector(thirdPersonCameraForwardPitched, -radius);

        // Convert the desired planet-local point to the player's local camera coordinates.
        planetSystem.localToWorld(thirdPersonCameraDesired);
        player.worldToLocal(thirdPersonCameraLocalDesired.copy(thirdPersonCameraDesired));
        camera.position.lerp(thirdPersonCameraLocalDesired, Math.min(1, delta * 10));

        camera.updateMatrixWorld(true);
        camera.lookAt(planetSystem.localToWorld(thirdPersonCameraTarget.clone()));
      } else {
        camera.rotation.set(playerState.pitch, 0, 0);
        camera.position.lerp(targetCamPos, Math.min(1, delta * 10));
      }
    }

    // ---------- main loop ----------
    const clock = new THREE.Clock();
    function animate() {
      requestAnimationFrame(animate);
      const delta = Math.min(clock.getDelta(), 0.05);
      spawnPinGroup.visible = state.gameState !== "playing"; // GPS pin only shows on the main-menu view

      // Run the sun/day-night simulation in both game and menu so the planet preview
      // also shows the same lighting system.
      updateDayNight(delta);
      updateCrystalRespawns();
      if (!playerState.inRocket) {
        finishChoppingTree();
        finishMiningStone();
        finishBreakingFurnace();
        finishBreakingSpaceObject();
      }
      for (const drop of droppedItems) {
        if (drop.root.visible) {
          drop.bob += delta * 2.2;
          // Bob radially around a fixed ground position without drifting away.
          const bobOffset = Math.sin(drop.bob) * 0.07;
          const pos = drop.basePosition.clone().addScaledVector(drop.direction, bobOffset);
          drop.root.position.copy(pos);
        }
      }
      updateAllFurnaceSmelting();
      updateRocketFueling();

      updateMobileControlsVisibility();
      if (state.gameState === "playing") {
        scene.fog = sceneFog;
        updateCrystalPrompt();
        flashlightStatus.classList.toggle("hidden", !playerState.flashlightOn);
        if (playerState.inRocket) {
          updateRocketFlight(delta);
        } else if (!state.paused) {
          updatePlayer(delta);
        }
        renderer.render(scene, playerState.inRocket ? flightCamera : camera);
        if (mapOpen) {
          updateMapPlayerMarker();
          mapRenderer.render(mapScene, mapCamera);
        }
      } else {
        scene.fog = null;
        flashlightStatus.classList.add("hidden"); // keep the distant home-screen view of the planet crisp, not hazy
        updateMenuCamera(delta);
        renderer.render(scene, menuCamera);
      }
    }

    // A last-minute browser backup helps protect progress if the tab/window is closed while
    // the player forgot to press Save Game. This backup stays inside the browser; a real JSON
    // save file is still created explicitly with the Save Game button.
    window.addEventListener("beforeunload", () => {
      if (state.gameState === "playing") persistLocalBackup();
    });

    // Give a brand-new world its starter axe before revealing the menu. This does not run
    // when loading a save, because loading restores the exact inventory from that save.
    resetInventory();

    // the planet/terrain is fully built at this point — reveal the home screen
    updateHotbarUI();
    updateInventoryUI();
    updateCreditsUI();
    homeLoading.classList.add("hidden");
    homeButtons.classList.remove("hidden");

    animate();
  }

  boot();
})();
