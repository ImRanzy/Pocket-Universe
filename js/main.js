
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

  const TOOL_LOADER_URLS = [
    "https://cdn.jsdelivr.net/npm/three@0.128.0/examples/js/loaders/MTLLoader.js",
    "https://cdn.jsdelivr.net/npm/three@0.128.0/examples/js/loaders/OBJLoader.js",
    "https://unpkg.com/three@0.128.0/examples/js/loaders/MTLLoader.js",
    "https://unpkg.com/three@0.128.0/examples/js/loaders/OBJLoader.js"
  ];
  let axeModelTemplate = null;
  let pickaxeModelTemplate = null;
  let rocketModelTemplate = null;
  let furnaceModelTemplate = null;
  let jerrycanModelTemplate = null;
  let scytheModelTemplate = null;
  let wrenchModelTemplate = null;
  let blueprintModelTemplate = null;
  let containerModelTemplate = null;

  const SUPABASE_URL = "https://ktzhvnpbksngleegdikd.supabase.co";
  const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_hrbbTSn2zhmFaejsrJd_ig_6RMF4k7G";
  let pocketSupabase = null;

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const el = document.createElement("script");
      el.src = src;
      el.onload = () => resolve();
      el.onerror = () => reject(new Error("failed to load " + src));
      document.head.appendChild(el);
    });
  }

  function resolveObjIndex(rawIndex, length) {
    const n = Number(rawIndex);
    return n < 0 ? length + n : n - 1;
  }

  async function buildEmbeddedRocketFromObj() {
    const source = window.PocketUniverseRocketOBJ;
    if (typeof source !== 'string' || !source.trim()) return null;

    const vertices = [];
    const uvs = [];
    const normals = [];
    const expandedPositions = [];
    const expandedUVs = [];
    const expandedNormals = [];

    const pushVertex = (token) => {
      const parts = token.split('/');
      const vi = resolveObjIndex(parts[0], vertices.length);
      const ti = parts[1] ? resolveObjIndex(parts[1], uvs.length) : -1;
      const ni = parts[2] ? resolveObjIndex(parts[2], normals.length) : -1;
      const v = vertices[vi];
      if (!v) return false;
      expandedPositions.push(v[0], v[1], v[2]);
      if (ti >= 0 && uvs[ti]) expandedUVs.push(uvs[ti][0], uvs[ti][1]);
      else expandedUVs.push(0, 0);
      if (ni >= 0 && normals[ni]) expandedNormals.push(normals[ni][0], normals[ni][1], normals[ni][2]);
      else expandedNormals.push(0, 0, 0);
      return true;
    };

    const lines = source.split(/\r?\n/);
    for (const raw of lines) {
      const line = raw.trim();
      if (!line || line.startsWith('#')) continue;
      const parts = line.split(/\s+/);
      if (parts[0] === 'v' && parts.length >= 4) {
        vertices.push([Number(parts[1]), Number(parts[2]), Number(parts[3])]);
      } else if (parts[0] === 'vt' && parts.length >= 3) {
        uvs.push([Number(parts[1]), Number(parts[2])]);
      } else if (parts[0] === 'vn' && parts.length >= 4) {
        normals.push([Number(parts[1]), Number(parts[2]), Number(parts[3])]);
      } else if (parts[0] === 'f' && parts.length >= 4) {
        const face = parts.slice(1);
        // Triangulate arbitrary polygons as a fan while preserving the original OBJ winding.
        for (let i = 1; i < face.length - 1; i++) {
          const tri = [face[0], face[i], face[i + 1]];
          pushVertex(tri[0]);
          pushVertex(tri[1]);
          pushVertex(tri[2]);
        }
      }
    }

    if (!expandedPositions.length) return null;

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(expandedPositions, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(expandedUVs, 2));

    let haveCompleteNormals = expandedNormals.length === expandedPositions.length;
    if (haveCompleteNormals) {
      let anyNonZero = false;
      for (let i = 0; i < expandedNormals.length; i += 3) {
        if (expandedNormals[i] * expandedNormals[i] + expandedNormals[i+1] * expandedNormals[i+1] + expandedNormals[i+2] * expandedNormals[i+2] > 1e-8) {
          anyNonZero = true; break;
        }
      }
      haveCompleteNormals = anyNonZero;
    }
    if (haveCompleteNormals) geometry.setAttribute('normal', new THREE.Float32BufferAttribute(expandedNormals, 3));
    else geometry.computeVertexNormals();
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();

    let texture = null;
    try {
      const dataUrl = window.PocketUniverseRocketTextureDataURL;
      if (dataUrl) {
        const image = new Image();
        await new Promise((resolve, reject) => {
          image.onload = resolve;
          image.onerror = reject;
          image.src = dataUrl;
        });
        texture = new THREE.Texture(image);
        texture.needsUpdate = true;
        texture.encoding = THREE.sRGBEncoding;
        texture.anisotropy = 1;
      }
    } catch (e) {
      console.warn('Embedded rocket texture could not be decoded; using solid material.', e);
    }

    const material = new THREE.MeshStandardMaterial({
      map: texture,
      color: 0xffffff,
      roughness: 0.62,
      metalness: 0.08,
      side: THREE.DoubleSide
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.frustumCulled = false;
    const group = new THREE.Group();
    group.add(mesh);
    group.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(group);
    if (box.isEmpty()) return null;
    const center = box.getCenter(new THREE.Vector3());
    group.position.x -= center.x;
    group.position.z -= center.z;
    group.position.y -= box.min.y;
    group.traverse((node) => {
      if (node.isMesh) node.frustumCulled = false;
    });
    return group;
  }

  function loadToolModel(url, mtlUrl) {
    return new Promise((resolve, reject) => {
      const finishWithObjFallback = (reason) => {
        try {
          if (!window.THREE.OBJLoader) throw reason || new Error('OBJLoader unavailable');
          const loader = new THREE.OBJLoader();
          loader.load(url, (obj) => resolve(obj), undefined, (objErr) => {
            reject(objErr || reason || new Error('OBJ model failed to load'));
          });
        } catch (e) {
          reject(e || reason || new Error('Tool model failed to load'));
        }
      };

      try {
        // Prefer the supplied MTL so the original model materials are retained.
        // If the MTL loader/material file fails for any reason, load the exact same OBJ
        // without materials rather than silently reverting to the old procedural mesh.
        if (!window.THREE.MTLLoader) {
          finishWithObjFallback(new Error('MTLLoader unavailable'));
          return;
        }
        const materialsLoader = new THREE.MTLLoader();
        materialsLoader.load(mtlUrl, (materials) => {
          try {
            materials.preload();
            const loader = new THREE.OBJLoader();
            loader.setMaterials(materials);
            loader.load(url, resolve, undefined, (objErr) => finishWithObjFallback(objErr));
          } catch (e) {
            finishWithObjFallback(e);
          }
        }, undefined, (mtlErr) => finishWithObjFallback(mtlErr));
      } catch (e) {
        finishWithObjFallback(e);
      }
    });
  }

  function decodeBase64Bytes(data) {
    const binary = atob(data);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  }

  function buildEmbeddedWrenchModel() {
    const source = window.PocketUniverseWrenchModel;
    if (!source || !Array.isArray(source.positions) || !source.positions.length) return null;
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(source.positions, 3));
    if (Array.isArray(source.normals) && source.normals.length === source.positions.length) {
      geometry.setAttribute('normal', new THREE.Float32BufferAttribute(source.normals, 3));
    } else {
      geometry.computeVertexNormals();
    }
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
    const box = geometry.boundingBox;
    const center = box.getCenter(new THREE.Vector3());
    geometry.translate(-center.x, -(box.min.y), -center.z);
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
    const group = new THREE.Group();
    const material = new THREE.MeshStandardMaterial({
      name: 'WrenchMetal',
      color: 0x8c939a,
      roughness: 0.34,
      metalness: 0.86,
      side: THREE.DoubleSide
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = 'WrenchModel';
    mesh.frustumCulled = false;
    mesh.rotation.y = -Math.PI / 2;
    group.add(mesh);
    return group;
  }

  function buildEmbeddedScytheModel() {
    const source = window.PocketUniverseScytheModel;
    if (!source) return null;
    const group = new THREE.Group();
    const parts = [
      { key: 'handle', color: 0x7a4d2c, roughness: 0.88, metalness: 0.03 },
      { key: 'blade', color: 0xb8bcc1, roughness: 0.42, metalness: 0.55 }
    ];
    for (const part of parts) {
      const data = source[part.key];
      if (!data || !data.positions || !data.indices) continue;
      const positionBytes = decodeBase64Bytes(data.positions);
      const indexBytes = decodeBase64Bytes(data.indices);
      const positions = new Float32Array(positionBytes.buffer, positionBytes.byteOffset, positionBytes.byteLength / 4);
      const indices = new Uint32Array(indexBytes.buffer, indexBytes.byteOffset, indexBytes.byteLength / 4);
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      geometry.setIndex(new THREE.BufferAttribute(indices, 1));
      geometry.computeVertexNormals();
      geometry.computeBoundingBox();
      geometry.computeBoundingSphere();
      const material = new THREE.MeshStandardMaterial({
        name: part.key,
        color: part.color,
        roughness: part.roughness,
        metalness: part.metalness,
        side: THREE.DoubleSide
      });
      const mesh = new THREE.Mesh(geometry, material);
      mesh.name = part.key === 'blade' ? 'ScytheBlade' : 'ScytheHandle';
      mesh.frustumCulled = false;
      group.add(mesh);
    }
    if (!group.children.length) return null;
    return group;
  }

  function buildEmbeddedToolModel(modelKey) {
    const source = window.PocketUniverseToolModels && window.PocketUniverseToolModels[modelKey];
    if (!source) return null;
    const group = new THREE.Group();
    for (const [materialName, data] of Object.entries(source)) {
      if (!data || !Array.isArray(data.positions) || !data.positions.length) continue;
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.Float32BufferAttribute(data.positions, 3));
      if (Array.isArray(data.normals) && data.normals.length === data.positions.length) {
        geometry.setAttribute('normal', new THREE.Float32BufferAttribute(data.normals, 3));
      } else {
        geometry.computeVertexNormals();
      }
      geometry.computeBoundingBox();
      geometry.computeBoundingSphere();
      const material = new THREE.MeshStandardMaterial({
        name: materialName,
        color: materialName.toLowerCase().includes('blade') ? 0xb8b8b8 : 0x7a4d2c,
        roughness: materialName.toLowerCase().includes('blade') ? 0.48 : 0.86,
        metalness: materialName.toLowerCase().includes('blade') ? 0.55 : 0.03
      });
      group.add(new THREE.Mesh(geometry, material));
    }
    return group.children.length ? group : null;
  }


  async function buildEmbeddedFurnaceFromObj() {
    const source = window.PocketUniverseFurnaceOBJ;
    if (typeof source !== 'string' || !source.trim()) return null;

    const vertices = [];
    const uvs = [];
    const normals = [];
    const expandedPositions = [];
    const expandedUVs = [];
    const expandedNormals = [];

    const resolveIndex = (rawIndex, length) => {
      const n = Number(rawIndex);
      return n < 0 ? length + n : n - 1;
    };

    const pushVertex = (token) => {
      const parts = token.split('/');
      const vi = resolveIndex(parts[0], vertices.length);
      const ti = parts[1] ? resolveIndex(parts[1], uvs.length) : -1;
      const ni = parts[2] ? resolveIndex(parts[2], normals.length) : -1;
      const v = vertices[vi];
      if (!v) return false;
      expandedPositions.push(v[0], v[1], v[2]);
      if (ti >= 0 && uvs[ti]) expandedUVs.push(uvs[ti][0], uvs[ti][1]);
      else expandedUVs.push(0, 0);
      if (ni >= 0 && normals[ni]) expandedNormals.push(normals[ni][0], normals[ni][1], normals[ni][2]);
      else expandedNormals.push(0, 0, 0);
      return true;
    };

    for (const raw of source.split(/\r?\n/)) {
      const line = raw.trim();
      if (!line || line.startsWith('#')) continue;
      const parts = line.split(/\s+/);
      if (parts[0] === 'v' && parts.length >= 4) {
        vertices.push([Number(parts[1]), Number(parts[2]), Number(parts[3])]);
      } else if (parts[0] === 'vt' && parts.length >= 3) {
        uvs.push([Number(parts[1]), Number(parts[2])]);
      } else if (parts[0] === 'vn' && parts.length >= 4) {
        normals.push([Number(parts[1]), Number(parts[2]), Number(parts[3])]);
      } else if (parts[0] === 'f' && parts.length >= 4) {
        const face = parts.slice(1);
        for (let i = 1; i < face.length - 1; i++) {
          pushVertex(face[0]);
          pushVertex(face[i]);
          pushVertex(face[i + 1]);
        }
      }
    }

    if (!expandedPositions.length) return null;

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(expandedPositions, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(expandedUVs, 2));

    let haveCompleteNormals = expandedNormals.length === expandedPositions.length;
    if (haveCompleteNormals) {
      let anyNonZero = false;
      for (let i = 0; i < expandedNormals.length; i += 3) {
        const x = expandedNormals[i], y = expandedNormals[i + 1], z = expandedNormals[i + 2];
        if (x * x + y * y + z * z > 1e-8) { anyNonZero = true; break; }
      }
      haveCompleteNormals = anyNonZero;
    }
    if (haveCompleteNormals) geometry.setAttribute('normal', new THREE.Float32BufferAttribute(expandedNormals, 3));
    else geometry.computeVertexNormals();
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();

    let texture = null;
    try {
      const dataUrl = window.PocketUniverseFurnaceTextureDataURL;
      if (dataUrl) {
        const image = new Image();
        await new Promise((resolve, reject) => {
          image.onload = resolve;
          image.onerror = reject;
          image.src = dataUrl;
        });
        texture = new THREE.Texture(image);
        texture.needsUpdate = true;
        texture.encoding = THREE.sRGBEncoding;
        texture.anisotropy = 1;
      }
    } catch (e) {
      console.warn('Embedded furnace texture could not be decoded; using solid material.', e);
    }

    const material = new THREE.MeshStandardMaterial({
      map: texture,
      color: 0xffffff,
      roughness: 0.82,
      metalness: 0.03,
      side: THREE.DoubleSide
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.frustumCulled = false;
    const group = new THREE.Group();
    group.add(mesh);
    group.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(group);
    if (box.isEmpty()) return null;
    const center = box.getCenter(new THREE.Vector3());
    group.position.x -= center.x;
    group.position.z -= center.z;
    group.position.y -= box.min.y;
    group.traverse((node) => {
      if (node.isMesh) node.frustumCulled = false;
    });
    return group;
  }

  async function buildEmbeddedJerrycanFromObj() {
    const groups = window.PocketUniverseJerrycanGroups;
    if (!groups || typeof groups !== 'object') return null;

    const materialTextureData = {};
    const loadTextureData = async (dataUrl) => {
      if (!dataUrl) return null;
      const image = new Image();
      await new Promise((resolve, reject) => {
        image.onload = resolve;
        image.onerror = reject;
        image.src = dataUrl;
      });
      const texture = new THREE.Texture(image);
      texture.needsUpdate = true;
      texture.encoding = THREE.sRGBEncoding;
      texture.anisotropy = 1;
      return texture;
    };

    try {
      materialTextureData.body = await loadTextureData(window.PocketUniverseJerrycanTextureDataURL);
    } catch (e) {
      console.warn('Embedded jerrycan body texture could not be decoded; using solid material.', e);
      materialTextureData.body = null;
    }
    try {
      materialTextureData.handle = await loadTextureData(window.PocketUniverseJerrycanHandleTextureDataURL);
    } catch (e) {
      console.warn('Embedded jerrycan handle texture could not be decoded; using solid material.', e);
      materialTextureData.handle = null;
    }

    const group = new THREE.Group();
    let meshCount = 0;
    for (const [materialName, data] of Object.entries(groups)) {
      if (!data || !Array.isArray(data.positions) || !data.positions.length) continue;
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.Float32BufferAttribute(data.positions, 3));
      if (Array.isArray(data.uvs) && data.uvs.length === (data.positions.length / 3) * 2) {
        geometry.setAttribute('uv', new THREE.Float32BufferAttribute(data.uvs, 2));
      }

      let completeNormals = Array.isArray(data.normals) && data.normals.length === data.positions.length;
      if (completeNormals) {
        let anyNonZero = false;
        for (let i = 0; i < data.normals.length; i += 3) {
          const x = data.normals[i], y = data.normals[i + 1], z = data.normals[i + 2];
          if (x*x + y*y + z*z > 1e-8) { anyNonZero = true; break; }
        }
        completeNormals = anyNonZero;
      }
      if (completeNormals) geometry.setAttribute('normal', new THREE.Float32BufferAttribute(data.normals, 3));
      else geometry.computeVertexNormals();
      geometry.computeBoundingBox();
      geometry.computeBoundingSphere();

      const lower = materialName.toLowerCase();
      const isHandle = lower.includes('9825c62f') || lower.includes('handle');
      const material = new THREE.MeshStandardMaterial({
        map: isHandle ? materialTextureData.handle : materialTextureData.body,
        color: 0xffffff,
        roughness: isHandle ? 0.86 : 0.72,
        metalness: 0.04,
        side: THREE.DoubleSide
      });
      const mesh = new THREE.Mesh(geometry, material);
      mesh.frustumCulled = false;
      group.add(mesh);
      meshCount++;
    }

    if (!meshCount) return null;

    // Normalize the supplied Blockbench asset so its base is at y=0 and it is
    // centered like the other world/held item models. The model itself remains
    // unchanged; only its Three.js wrapper transform is adjusted.
    group.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(group);
    if (box.isEmpty()) return null;
    const center = box.getCenter(new THREE.Vector3());
    group.position.x -= center.x;
    group.position.z -= center.z;
    group.position.y -= box.min.y;
    group.traverse((node) => {
      if (node.isMesh) node.frustumCulled = false;
    });
    return group;
  }

  function buildEmbeddedBlueprintModel() {
    const source = window.PocketUniverseBlueprintModel;
    if (!source || !Array.isArray(source.parts) || !source.parts.length) return null;
    const group = new THREE.Group();
    let meshCount = 0;
    for (const part of source.parts) {
      if (!part || !Array.isArray(part.positions) || !part.positions.length) continue;
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.Float32BufferAttribute(part.positions, 3));
      if (Array.isArray(part.uvs) && part.uvs.length === (part.positions.length / 3) * 2) {
        geometry.setAttribute('uv', new THREE.Float32BufferAttribute(part.uvs, 2));
      }
      if (Array.isArray(part.normals) && part.normals.length === part.positions.length) {
        geometry.setAttribute('normal', new THREE.Float32BufferAttribute(part.normals, 3));
      } else {
        geometry.computeVertexNormals();
      }
      geometry.computeBoundingBox();
      geometry.computeBoundingSphere();

      let texture = null;
      if (part.textureDataURL) {
        try {
          const image = new Image();
          texture = new THREE.Texture(image);
          texture.encoding = THREE.sRGBEncoding;
          texture.anisotropy = 1;
          image.onload = () => { texture.needsUpdate = true; };
          image.src = part.textureDataURL;
          texture.needsUpdate = true;
        } catch (e) {
          console.warn('Blueprint texture could not be created; using fallback color.', e);
        }
      }
      const material = new THREE.MeshStandardMaterial({
        name: 'BlueprintPaper',
        map: texture,
        color: 0xffffff,
        roughness: 0.78,
        metalness: 0.0,
        transparent: true,
        side: THREE.DoubleSide
      });
      const mesh = new THREE.Mesh(geometry, material);
      mesh.name = 'BlueprintModelPart';
      mesh.frustumCulled = false;
      group.add(mesh);
      meshCount++;
    }
    if (!meshCount) return null;
    group.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(group);
    if (box.isEmpty()) return null;
    const center = box.getCenter(new THREE.Vector3());
    group.position.x -= center.x;
    group.position.z -= center.z;
    group.position.y -= box.min.y;
    group.updateMatrixWorld(true);
    group.traverse(node => { if (node.isMesh) node.frustumCulled = false; });
    return group;
  }

  async function buildEmbeddedContainerFromObj() {
    const source = window.PocketUniverseContainerOBJ;
    if (typeof source !== 'string' || !source.trim()) return null;

    const vertices = [], uvs = [], normals = [];
    const expandedPositions = [], expandedUVs = [], expandedNormals = [];
    const resolveIndex = (rawIndex, length) => {
      const n = Number(rawIndex);
      return n < 0 ? length + n : n - 1;
    };
    const pushVertex = (token) => {
      const parts = token.split('/');
      const vi = resolveIndex(parts[0], vertices.length);
      const ti = parts[1] ? resolveIndex(parts[1], uvs.length) : -1;
      const ni = parts[2] ? resolveIndex(parts[2], normals.length) : -1;
      const v = vertices[vi];
      if (!v) return false;
      expandedPositions.push(v[0], v[1], v[2]);
      if (ti >= 0 && uvs[ti]) expandedUVs.push(uvs[ti][0], uvs[ti][1]); else expandedUVs.push(0, 0);
      if (ni >= 0 && normals[ni]) expandedNormals.push(normals[ni][0], normals[ni][1], normals[ni][2]); else expandedNormals.push(0, 0, 0);
      return true;
    };
    for (const raw of source.split(/\r?\n/)) {
      const line = raw.trim();
      if (!line || line.startsWith('#')) continue;
      const parts = line.split(/\s+/);
      if (parts[0] === 'v' && parts.length >= 4) vertices.push([Number(parts[1]), Number(parts[2]), Number(parts[3])]);
      else if (parts[0] === 'vt' && parts.length >= 3) uvs.push([Number(parts[1]), Number(parts[2])]);
      else if (parts[0] === 'vn' && parts.length >= 4) normals.push([Number(parts[1]), Number(parts[2]), Number(parts[3])]);
      else if (parts[0] === 'f' && parts.length >= 4) {
        const face = parts.slice(1);
        for (let i = 1; i < face.length - 1; i++) [face[0], face[i], face[i + 1]].forEach(pushVertex);
      }
    }
    if (!expandedPositions.length) return null;
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(expandedPositions, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(expandedUVs, 2));
    let haveNormals = expandedNormals.length === expandedPositions.length;
    if (haveNormals) {
      let any = false;
      for (let i = 0; i < expandedNormals.length; i += 3) {
        if (expandedNormals[i] ** 2 + expandedNormals[i + 1] ** 2 + expandedNormals[i + 2] ** 2 > 1e-8) { any = true; break; }
      }
      haveNormals = any;
    }
    if (haveNormals) geometry.setAttribute('normal', new THREE.Float32BufferAttribute(expandedNormals, 3));
    else geometry.computeVertexNormals();
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
    let texture = null;
    try {
      const dataUrl = window.PocketUniverseContainerTextureDataURL;
      if (dataUrl) {
        const image = new Image();
        await new Promise((resolve, reject) => { image.onload = resolve; image.onerror = reject; image.src = dataUrl; });
        texture = new THREE.Texture(image);
        texture.needsUpdate = true;
        texture.encoding = THREE.sRGBEncoding;
        texture.magFilter = THREE.NearestFilter;
        texture.minFilter = THREE.LinearMipMapLinearFilter;
      }
    } catch (e) {
      console.warn('Embedded container texture could not be decoded; using solid material.', e);
    }
    const material = new THREE.MeshStandardMaterial({
      name: 'ContainerMaterial', map: texture, color: 0xffffff,
      roughness: 0.58, metalness: 0.45, side: THREE.DoubleSide
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.frustumCulled = false;
    const group = new THREE.Group();
    group.add(mesh);
    group.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(group);
    if (box.isEmpty()) return null;
    const center = box.getCenter(new THREE.Vector3());
    group.position.x -= center.x;
    group.position.z -= center.z;
    group.position.y -= box.min.y;
    group.traverse(node => { if (node.isMesh) node.frustumCulled = false; });
    return group;
  }

  async function loadToolModels() {
    // The supplied OBJ files are now embedded as geometry data and become the
    // authoritative tool meshes. This avoids the unreliable external OBJ/MTL
    // loader path that was silently falling back to the old procedural models.
    axeModelTemplate = buildEmbeddedToolModel('axe');
    pickaxeModelTemplate = buildEmbeddedToolModel('pickaxe');
    wrenchModelTemplate = buildEmbeddedWrenchModel();
    blueprintModelTemplate = buildEmbeddedBlueprintModel();
    containerModelTemplate = await buildEmbeddedContainerFromObj();
    if (!axeModelTemplate) console.warn('Embedded axe model unavailable; using procedural fallback.');
    if (!pickaxeModelTemplate) console.warn('Embedded pickaxe model unavailable; using procedural fallback.');
    if (!wrenchModelTemplate) console.warn('Embedded wrench model unavailable; using procedural fallback.');
    if (!blueprintModelTemplate) console.warn('Embedded blueprint model unavailable; using procedural fallback.');
    if (!containerModelTemplate) console.warn('Embedded container model unavailable; using procedural fallback.');
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
      try {
        if (!window.supabase) await loadScript("https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2");
        if (window.supabase && typeof window.supabase.createClient === "function") {
          pocketSupabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);
        }
      } catch (supabaseError) {
        console.warn("Supabase unavailable; account features are disabled.", supabaseError);
      }
      try { await loadToolModels(); } catch (toolError) {
        console.warn("Tool models unavailable; procedural fallback will be used.", toolError);
      }
      try { rocketModelTemplate = await buildEmbeddedRocketFromObj(); } catch (rocketError) {
        console.warn("Rocket model unavailable; procedural fallback will be used.", rocketError);
      }
      try { furnaceModelTemplate = await buildEmbeddedFurnaceFromObj(); } catch (furnaceError) {
        console.warn("Furnace model unavailable; procedural fallback will be used.", furnaceError);
      }
      try { jerrycanModelTemplate = await buildEmbeddedJerrycanFromObj(); } catch (jerrycanError) {
        console.warn("Jerrycan model unavailable; procedural fallback will be used.", jerrycanError);
      }
      try { scytheModelTemplate = buildEmbeddedScytheModel(); } catch (scytheError) {
        console.warn("Scythe model unavailable; procedural fallback will be used.", scytheError);
      }
      runGame();
    } catch (e) {
      showFatalError("Something went wrong starting the game: " + (e && e.message ? e.message : e));
      console.error(e);
    }
  }

  function runGame() {
    // ---------- tunable constants ----------
    const PLANET_RADIUS = 240; // v0.8B Day 9 world-size expansion: 2x Ivis radius

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
    const HILL_AMPLITUDE = 8;

    const MOUNTAIN_HEIGHT = 40;
                  // reduced so mountains feel proportional to the planet and leave room for future flight
    const MOUNTAIN_ANGULAR_RADIUS = 0.34;   // slightly narrower mountains for a more natural silhouette   // radians, ~23 degrees of arc
    const ROCK_LEVEL = 16;
                  // elevation where grass gives way to rock
    const SNOW_LEVEL = 32;
                 // keeps snowy peaks after the mountain height reduction                 // elevation where rock gives way to snow

    // 4 mountains, evenly spread out like a tetrahedron so none overlap
    const MOUNTAIN_DIRS = [
      new THREE.Vector3(1, 1, 1).normalize(),
      new THREE.Vector3(1, -1, -1).normalize(),
      new THREE.Vector3(-1, 1, -1).normalize(),
      new THREE.Vector3(-1, -1, 1).normalize(),
    ];

    // broad valley basins: one roughly opposite each mountain, well clear of all of them
    const VALLEY_ANGULAR_RADIUS = 0.55;
    const VALLEY_DEPTH = 20;

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
    const RIVER_DEPTH = 6;

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
      70, window.innerWidth / window.innerHeight, 0.1, 1000000
    );
    const clampSettingsFov = (value) => Math.max(40, Math.min(110, Number.isFinite(Number(value)) ? Number(value) : 70));
    let settingsFov = clampSettingsFov(Number(localStorage.getItem('pocketUniverseFov')) || 70);
    camera.fov = settingsFov;
    camera.updateProjectionMatrix();
    function loadSoundSetting(storageKey, fallback = 1) {
      const saved = localStorage.getItem(storageKey);
      if (saved === null) return fallback;
      const value = Number(saved);
      return Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : fallback;
    }
    let settingsMasterVolume = loadSoundSetting('pocketUniverseVolume', 1);
    let settingsInteractVolume = loadSoundSetting('pocketUniverseInteractVolume', 1);
    let settingsPlayerVolume = loadSoundSetting('pocketUniversePlayerVolume', 1);
    let settingsNatureVolume = loadSoundSetting('pocketUniverseNatureVolume', 1);
    let settingsWorldVolume = loadSoundSetting('pocketUniverseWorldVolume', 1);
    let settingsMusicVolume = loadSoundSetting('pocketUniverseMusicVolume', 1);

    // Main-menu planet preview camera.
    // Its yaw/playerState.pitch are controlled by dragging the cursor, so the player can inspect
    // every side of the planet before starting the game.
    const MENU_CAM_DISTANCE = 840;

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

    const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
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
    let mapCameraDistance = 840;

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

      // Add clear, collectible-looking ore indicators on top of the planet.
      while (mapMarkerGroup.children.length) mapMarkerGroup.remove(mapMarkerGroup.children[0]);
      const ironMat = new THREE.MeshBasicMaterial({ color: 0xd9a84d });
      const copperMat = new THREE.MeshBasicMaterial({ color: 0x32c7b5 });
      for (const ore of ironOreSpawns) {
        const pin = new THREE.Mesh(
          new THREE.SphereGeometry(1.05, 10, 10),
          ore.oreType === 'copper_ore' ? copperMat : ironMat
        );
        const dir = ore.direction.clone().normalize();
        pin.position.copy(dir).multiplyScalar(PLANET_RADIUS + heightAt(dir) + 1.5);
        mapMarkerGroup.add(pin);
      }

      // Distinct meteor-site marker so the crash site is easy to find on the minimap.
      if (meteorCrashSite) {
        const dir = meteorCrashSite.direction.clone().normalize();
        const markerGroup = new THREE.Group();
        markerGroup.position.copy(dir).multiplyScalar(PLANET_RADIUS + heightAt(dir) + 5.0);
        markerGroup.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);

        const ring = new THREE.Mesh(
          new THREE.TorusGeometry(4.2, 0.45, 8, 24),
          new THREE.MeshBasicMaterial({ color: 0xff7138 })
        );
        ring.rotation.x = Math.PI / 2;
        markerGroup.add(ring);

        const core = new THREE.Mesh(
          new THREE.SphereGeometry(1.6, 12, 12),
          new THREE.MeshBasicMaterial({ color: 0xffa13d })
        );
        markerGroup.add(core);
        mapMarkerGroup.add(markerGroup);
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


    // ---------- space navigation map / warp drive ----------
    const spaceMapOverlay = document.getElementById('spaceMapOverlay');
    const spaceMapViewportWrap = document.getElementById('spaceMapViewportWrap');
    const spaceMapCanvas = document.getElementById('spaceMapCanvas');
    const spaceMapClose = document.getElementById('spaceMapClose');
    const spaceMapReset = document.getElementById('spaceMapReset');
    const spaceMapWarpStatus = document.getElementById('spaceMapWarpStatus');
    const warpOverlay = document.getElementById('warpOverlay');
    const warpOverlayText = document.getElementById('warpOverlayText');
    const warpOverlaySubtext = document.getElementById('warpOverlaySubtext');
    const spaceMapCtx = spaceMapCanvas.getContext('2d');
    let spaceMapOpen=false, pendingWarpBody=null, warpInProgress=false, warpStartedAt=0, warpDurationSeconds=0, warpTargetId=null, warpFuelConsumed=true, warpFuelType='moon_quartz';
    let spaceMapZoom=1, spaceMapPanX=0, spaceMapPanY=0, spaceMapDragging=false, spaceMapDragMoved=false, spaceMapLastX=0, spaceMapLastY=0;
    // During a warp the normal 3D gameplay view is hidden while the dedicated warp overlay
    // remains visible. This makes the hyperspace effect the entire visual focus of the trip.
    function setWarpGameplayVisibility(hidden){
      canvas.style.visibility = hidden ? 'hidden' : '';
    }
    const SPACE_BODY_META={
      // Use getters here because this navigation block is defined before the later
      // celestial-body constants are initialized. Reading the radius is therefore
      // deferred until the map/warp code actually runs, avoiding a TDZ boot error.
      sun:{name:'SUN',color:'#ffd34f',get radius(){return SUN_RADIUS;},arrivalOffset:1000},
      ivis:{name:'IVIS',color:'#54d978',get radius(){return PLANET_RADIUS;},arrivalOffset:500},
      moon:{name:'MOON',color:'#b7beca',get radius(){return MOON_RADIUS;},arrivalOffset:500},
      cordelia:{name:'CORDELIA',color:'#e98f43',get radius(){return CORDELIA_RADIUS;},arrivalOffset:500},
      syspo:{name:'SYSPO',color:'#6d5ab3',get radius(){return SYSP0_RADIUS;},arrivalOffset:650},
      aurora:{name:'AURORA',color:'#58d67c',get radius(){return AURORA_RADIUS;},arrivalOffset:360},
      mileria:{name:'MILERIA',color:'#a3a7ad',get radius(){return MILERIA_RADIUS;},arrivalOffset:280}
    };
    const spaceMapStarSeeds=Array.from({length:220},(_,i)=>({
      x:(Math.sin(i*12.9898)*43758.5453)%1, y:(Math.sin(i*78.233+4.7)*12489.123)%1,
      a:.25+((Math.sin(i*3.17+1.4)+1)/2)*.7, r:i%9===0?1.4:(i%3===0?1:.6)
    })).map(s=>({...s,x:(s.x+1)%1,y:(s.y+1)%1}));
    function getSpaceBodyPosition(id,out=new THREE.Vector3()){
      if(id==='ivis') return out.copy(ivisSolarOrbitPosition);
      if(id==='sun') return out.copy(sunMesh.position);
      if(id==='moon') return moonMesh.getWorldPosition(out);
      if(id==='cordelia') return cordeliaMesh.getWorldPosition(out);
      if(id==='syspo'||id==='aurora'||id==='mileria') return getOmegaBodyWorldPosition(id,out);
      return out.set(0,0,0);
    }
    function prepareSpaceMapCanvas(){ const rect=spaceMapViewportWrap.getBoundingClientRect(), dpr=Math.min(devicePixelRatio||1,2), w=Math.max(1,Math.floor(rect.width)), h=Math.max(1,Math.floor(rect.height)); if(spaceMapCanvas.width!==Math.floor(w*dpr)||spaceMapCanvas.height!==Math.floor(h*dpr)){spaceMapCanvas.width=Math.floor(w*dpr);spaceMapCanvas.height=Math.floor(h*dpr);spaceMapCanvas.style.width=w+'px';spaceMapCanvas.style.height=h+'px';} return {w,h,dpr}; }
    function drawSpaceMap(){
      if(!spaceMapOpen) return; const {w,h,dpr}=prepareSpaceMapCanvas(); spaceMapCtx.setTransform(dpr,0,0,dpr,0,0); spaceMapCtx.clearRect(0,0,w,h);
      const bg=spaceMapCtx.createRadialGradient(w*.5,h*.52,20,w*.5,h*.52,Math.max(w,h)*.72); bg.addColorStop(0,'#081226'); bg.addColorStop(.55,'#020814'); bg.addColorStop(1,'#000207'); spaceMapCtx.fillStyle=bg; spaceMapCtx.fillRect(0,0,w,h);
      for(const s of spaceMapStarSeeds){spaceMapCtx.globalAlpha=s.a;spaceMapCtx.fillStyle='#eaf3ff';spaceMapCtx.beginPath();spaceMapCtx.arc(s.x*w,s.y*h,s.r,0,Math.PI*2);spaceMapCtx.fill();} spaceMapCtx.globalAlpha=1;
      const positions={}; for(const id of Object.keys(SPACE_BODY_META)) positions[id]=getSpaceBodyPosition(id,new THREE.Vector3());
      const xs=Object.values(positions).map(p=>p.x), zs=Object.values(positions).map(p=>p.z), minX=Math.min(...xs),maxX=Math.max(...xs),minZ=Math.min(...zs),maxZ=Math.max(...zs), pad=1700;
      const spanX=Math.max(1,maxX-minX+pad*2), spanZ=Math.max(1,maxZ-minZ+pad*2), baseScale=Math.min((w-120)/spanX,(h-100)/spanZ), scale=baseScale*spaceMapZoom, cx=(minX+maxX)/2, cz=(minZ+maxZ)/2;
      const toScreen=p=>({x:w/2+(p.x-cx)*scale+spaceMapPanX,y:h/2+(p.z-cz)*scale+spaceMapPanY});
      spaceMapCtx.save();spaceMapCtx.setLineDash([5,7]);spaceMapCtx.lineWidth=1;spaceMapCtx.strokeStyle='rgba(142,175,225,.27)';
      let iv=toScreen(positions.ivis);spaceMapCtx.beginPath();spaceMapCtx.ellipse(iv.x,iv.y,MOON_ORBIT_RADIUS*scale,MOON_ORBIT_RADIUS*scale*.92,0,0,Math.PI*2);spaceMapCtx.stroke();
      let su=toScreen(positions.sun);spaceMapCtx.beginPath();spaceMapCtx.ellipse(su.x,su.y,CORDELIA_SUN_DISTANCE*scale,CORDELIA_SUN_DISTANCE*scale*.98,0,0,Math.PI*2);spaceMapCtx.stroke();
      drawProjectedOrbit(positions.sun, ivisSolarOrbitBasisA, ivisSolarOrbitBasisB, IVIS_SUN_ORBIT_DISTANCE, 'rgba(84,217,120,.28)');
      function drawProjectedOrbit(center, basisA, basisB, radius, strokeStyle) {
        const segments = 144;
        spaceMapCtx.strokeStyle = strokeStyle;
        spaceMapCtx.beginPath();
        for (let i = 0; i <= segments; i++) {
          const t = (i / segments) * Math.PI * 2;
          const point = center.clone()
            .addScaledVector(basisA, Math.cos(t) * radius)
            .addScaledVector(basisB, Math.sin(t) * radius);
          const projected = toScreen(point);
          if (i === 0) spaceMapCtx.moveTo(projected.x, projected.y);
          else spaceMapCtx.lineTo(projected.x, projected.y);
        }
        spaceMapCtx.stroke();
      }
      const ss=toScreen(positions.syspo);
      drawProjectedOrbit(positions.sun, syspoSolarOrbitBasisA, syspoSolarOrbitBasisB, SYSP0_SOLAR_DISTANCE, 'rgba(118,100,205,.30)');
      let aur=toScreen(positions.aurora);spaceMapCtx.strokeStyle='rgba(88,214,124,.26)';spaceMapCtx.beginPath();spaceMapCtx.ellipse(toScreen(positions.syspo).x,toScreen(positions.syspo).y,AURORA_ORBIT_RADIUS*scale,AURORA_ORBIT_RADIUS*scale*.92,0,0,Math.PI*2);spaceMapCtx.stroke();
      let mil=toScreen(positions.mileria);spaceMapCtx.strokeStyle='rgba(163,167,173,.26)';spaceMapCtx.beginPath();spaceMapCtx.ellipse(ss.x,ss.y,MILERIA_ORBIT_RADIUS*scale,MILERIA_ORBIT_RADIUS*scale*.92,0,0,Math.PI*2);spaceMapCtx.stroke();
      spaceMapCtx.restore();
      if(playerState.inRocket){const rp=toScreen(flightPosition);spaceMapCtx.fillStyle='#fff';spaceMapCtx.shadowColor='#9fd6ff';spaceMapCtx.shadowBlur=10;spaceMapCtx.beginPath();spaceMapCtx.arc(rp.x,rp.y,5,0,Math.PI*2);spaceMapCtx.fill();spaceMapCtx.shadowBlur=0;}
      for(const [id,meta] of Object.entries(SPACE_BODY_META)){const p=toScreen(positions[id]), radius=id==='sun'?18:10;spaceMapCtx.save();spaceMapCtx.shadowColor=meta.color;spaceMapCtx.shadowBlur=id==='sun'?24:14;spaceMapCtx.fillStyle=meta.color;spaceMapCtx.beginPath();spaceMapCtx.arc(p.x,p.y,radius,0,Math.PI*2);spaceMapCtx.fill();if(id==='sun'){spaceMapCtx.strokeStyle='rgba(255,236,160,.75)';spaceMapCtx.lineWidth=2;spaceMapCtx.stroke();}spaceMapCtx.restore();spaceMapCtx.fillStyle='rgba(238,244,255,.86)';spaceMapCtx.font='800 11px Segoe UI,sans-serif';spaceMapCtx.textAlign='center';spaceMapCtx.fillText(meta.name,p.x,p.y+radius+16);}
      spaceMapCanvas._spaceMapLayout={positions,toScreen};
    }
    function getWarpDriveRocket(){ if(!playerState.inRocket||playerState.rocketLanded||!flightRocket||!flightPad) return null; return (flightRocket.warpDrive||flightPad.warpDrive)?flightRocket:null; }
    function resetSpaceMapView(){ spaceMapZoom=1; spaceMapPanX=0; spaceMapPanY=0; spaceMapDragMoved=false; if(spaceMapOpen) drawSpaceMap(); }
    function clampSpaceMapPan(w,h){
      const maxX=Math.max(120,w*(spaceMapZoom-1)*0.72+120), maxY=Math.max(120,h*(spaceMapZoom-1)*0.72+120);
      spaceMapPanX=Math.max(-maxX,Math.min(maxX,spaceMapPanX));
      spaceMapPanY=Math.max(-maxY,Math.min(maxY,spaceMapPanY));
    }
    function openSpaceMap(){
      if(!getWarpDriveRocket()){showFlightPrompt('Warp Drive required for the Space Map.');return false;}
      if(state.gameState!=='playing'||state.paused||!playerState.rocketInSpace||warpInProgress)return false;
      if(document.pointerLockElement===canvas)document.exitPointerLock();clearPhysicalKeys();for(const k in systemState.keys)systemState.keys[k]=false;
      spaceMapOpen=true;pendingWarpBody=null;spaceMapWarpStatus.classList.add('hidden');spaceMapOverlay.classList.remove('hidden');state.paused=true;document.body.classList.add('map-open');resetSpaceMapView();drawSpaceMap();return true;
    }
    function closeSpaceMap(){if(!spaceMapOpen)return;spaceMapOpen=false;pendingWarpBody=null;spaceMapOverlay.classList.add('hidden');spaceMapWarpStatus.classList.add('hidden');document.body.classList.remove('map-open');if(state.gameState==='playing'&&!warpInProgress){state.paused=false;attemptPointerLock();}}
    function toggleSpaceMap(){if(spaceMapOpen)closeSpaceMap();else openSpaceMap();}
    function formatWarpSeconds(sec){const s=Math.max(0,Math.ceil(sec)),m=Math.floor(s/60),r=s%60;return m+':'+String(r).padStart(2,'0');}
    function getActiveWarpDriveType(){
      if (!flightPad) return null;
      return (flightPad.warpDriveType === 'mk2' || flightRocket?.warpDriveType === 'mk2') ? 'mk2' : (flightPad.warpDrive || flightRocket?.warpDrive ? 'mk1' : null);
    }
    function showWarpConfirmation(bodyId){
      if(!SPACE_BODY_META[bodyId])return;
      const center=getSpaceBodyPosition(bodyId,new THREE.Vector3()), distance=flightPosition.distanceTo(center);
      const warpType=getActiveWarpDriveType();
      const duration=distance/(warpType==='mk2'?4000:2000);
      const fuelId=warpType==='mk2'?'rainbow_opal':'moon_quartz';
      const fuelName=warpType==='mk2'?'Rainbow Opal':'Moon Quartz';
      const hasFuel=getInventoryCount(fuelId)>=1;
      const cost=warpType==='mk2'?'1 Rainbow Opal · 50% chance to consume':'1 Moon Quartz';
      pendingWarpBody=bodyId;
      spaceMapWarpStatus.innerHTML='<div>Warp to '+SPACE_BODY_META[bodyId].name+'?</div><div style="margin-top:5px;color:rgba(225,235,255,.68);font-weight:600;">Distance: '+Math.round(distance).toLocaleString()+'u · Time: '+formatWarpSeconds(duration)+' · Fuel: '+cost+'</div><div style="margin-top:11px;font-size:10px;color:'+(hasFuel?'rgba(185,244,209,.9)':'rgba(255,145,145,.92)')+';">'+(hasFuel?'Click again to confirm':'NOT ENOUGH '+fuelName.toUpperCase())+'</div>';
      spaceMapWarpStatus.classList.remove('hidden');
    }
    function getWarpArrivalPosition(targetId){
      const center=getSpaceBodyPosition(targetId,new THREE.Vector3());
      const dir0=flightPosition.clone().sub(center);
      const dir=dir0.lengthSq()>.001?dir0.normalize():new THREE.Vector3(1,0,0);
      const meta=SPACE_BODY_META[targetId];
      return center.addScaledVector(dir,meta.radius+meta.arrivalOffset);
    }
    function startWarp(targetId){
      if(!getWarpDriveRocket()||!SPACE_BODY_META[targetId])return false;
      const center=getSpaceBodyPosition(targetId,new THREE.Vector3()),distance=flightPosition.distanceTo(center);
      const warpType=getActiveWarpDriveType();
      const fuelId=warpType==='mk2'?'rainbow_opal':'moon_quartz';
      if(getInventoryCount(fuelId)<1){closeSpaceMap();showFlightPrompt('NOT ENOUGH '+(fuelId==='rainbow_opal'?'RAINBOW OPAL':'MOON QUARTZ'));return true;}
      warpDurationSeconds=Math.max(.05,distance/(warpType==='mk2'?4000:2000));warpStartedAt=performance.now();warpTargetId=targetId;warpInProgress=true;
      warpFuelType=fuelId;
      warpFuelConsumed=true;
      if(warpType==='mk2') { warpFuelConsumed=Math.random()<0.5; if(warpFuelConsumed) removeItemsFromInventory('rainbow_opal',1); }
      else { removeItemsFromInventory('moon_quartz',1); }
      refreshEquippedItem();updateHotbarUI();updateInventoryUI();closeSpaceMap();clearPhysicalKeys();for(const k in systemState.keys)systemState.keys[k]=false;state.paused=false;
      setWarpGameplayVisibility(true);
      setLoopAudioMode('rocketIdle',false);setLoopAudioMode('rocketThrust',false);rocketEngineMode='off';setLoopAudioMode('warpDrive',true,.24,1);warpOverlay.classList.remove('hidden');warpOverlayText.textContent='WARPING TO '+SPACE_BODY_META[targetId].name;warpOverlaySubtext.textContent=formatWarpSeconds(warpDurationSeconds)+' REMAINING';return true;
    }
    function finishWarp(){
      const targetId=warpTargetId,target=getWarpArrivalPosition(targetId),center=getSpaceBodyPosition(targetId,new THREE.Vector3()),up=target.clone().sub(center).normalize();let forward=flightForward.clone();forward.addScaledVector(up,-forward.dot(up));if(forward.lengthSq()<.0001){const ref=Math.abs(up.y)<.9?new THREE.Vector3(0,1,0):new THREE.Vector3(1,0,0);forward.copy(ref).addScaledVector(up,-ref.dot(up));}forward.normalize();const right=new THREE.Vector3().crossVectors(forward,up).normalize();flightShipBasis.makeBasis(right,up,forward.clone().negate());flightRocketQuat.setFromRotationMatrix(flightShipBasis);
      flightPosition.copy(target);
      playerState.rocketLanded=false;
      playerState.rocketInSpace=true;
      moonGravityActive=targetId==='moon';
      cordeliaGravityActive=targetId==='cordelia';
      syspoGravityActive=targetId==='syspo';
      auroraGravityActive=targetId==='aurora';
      mileriaGravityActive=targetId==='mileria';
      freeSpacePlaneActive=targetId==='sun';
      if(targetId==='moon')recordCelestialBodyVisit('moon');
      if(targetId==='cordelia')recordCelestialBodyVisit('cordelia');
      if(targetId==='syspo')recordCelestialBodyVisit('syspo');
      if(targetId==='aurora')recordCelestialBodyVisit('aurora');
      if(targetId==='mileria')recordCelestialBodyVisit('mileria');
      if(flightRocket){flightRocket.root.position.copy(flightPosition);flightRocket.root.quaternion.copy(flightRocketQuat);}
      player.position.copy(flightPosition);
      setLoopAudioMode('warpDrive',false);warpOverlay.classList.add('hidden');setWarpGameplayVisibility(false);warpInProgress=false;warpTargetId=null;setRocketFlightUI();showFlightPrompt(warpFuelType==='rainbow_opal' ? (warpFuelConsumed ? 'WARP COMPLETE · Rainbow Opal consumed' : 'WARP COMPLETE · Rainbow Opal preserved') : 'WARP COMPLETE · Moon Quartz used');
    }
    spaceMapClose.addEventListener('click',closeSpaceMap);
    spaceMapReset.addEventListener('click',resetSpaceMapView);
    spaceMapCanvas.addEventListener('pointerdown',(e)=>{
      if(!spaceMapOpen||warpInProgress||e.button!==0)return;
      spaceMapDragging=true;spaceMapDragMoved=false;spaceMapLastX=e.clientX;spaceMapLastY=e.clientY;
      spaceMapCanvas.style.cursor='grabbing';spaceMapCanvas.setPointerCapture?.(e.pointerId);e.preventDefault();
    });
    spaceMapCanvas.addEventListener('pointermove',(e)=>{
      if(!spaceMapDragging||!spaceMapOpen)return;
      const dx=e.clientX-spaceMapLastX,dy=e.clientY-spaceMapLastY;
      if(Math.abs(dx)+Math.abs(dy)>2)spaceMapDragMoved=true;
      spaceMapLastX=e.clientX;spaceMapLastY=e.clientY;spaceMapPanX+=dx;spaceMapPanY+=dy;
      const rect=spaceMapViewportWrap.getBoundingClientRect();clampSpaceMapPan(rect.width,rect.height);drawSpaceMap();e.preventDefault();
    });
    function endSpaceMapDrag(e){ if(!spaceMapDragging)return; spaceMapDragging=false;spaceMapCanvas.style.cursor='grab';spaceMapCanvas.releasePointerCapture?.(e.pointerId); }
    spaceMapCanvas.addEventListener('pointerup',endSpaceMapDrag);
    spaceMapCanvas.addEventListener('pointercancel',endSpaceMapDrag);
    spaceMapCanvas.addEventListener('wheel',(e)=>{
      if(!spaceMapOpen||warpInProgress)return;
      e.preventDefault();
      const rect=spaceMapCanvas.getBoundingClientRect(),mx=e.clientX-rect.left,my=e.clientY-rect.top,oldZoom=spaceMapZoom;
      const factor=e.deltaY<0?1.15:0.87, nextZoom=Math.max(.55,Math.min(8,oldZoom*factor));
      if(nextZoom===oldZoom)return;
      const cx=rect.width/2,cy=rect.height/2;
      spaceMapPanX += (mx-cx-spaceMapPanX)*(1-nextZoom/oldZoom);
      spaceMapPanY += (my-cy-spaceMapPanY)*(1-nextZoom/oldZoom);
      spaceMapZoom=nextZoom;clampSpaceMapPan(rect.width,rect.height);drawSpaceMap();
    },{passive:false});
    spaceMapCanvas.addEventListener('click',(e)=>{if(!spaceMapOpen||warpInProgress)return;if(spaceMapDragMoved){spaceMapDragMoved=false;return;}const rect=spaceMapCanvas.getBoundingClientRect(),x=e.clientX-rect.left,y=e.clientY-rect.top,layout=spaceMapCanvas._spaceMapLayout;if(!layout)return;let picked=null,best=Infinity;for(const [id,pos] of Object.entries(layout.positions)){const p=layout.toScreen(pos),d=Math.hypot(x-p.x,y-p.y),hit=id==='sun'?26:18;if(d<=hit&&d<best){best=d;picked=id;}}if(!picked){spaceMapWarpStatus.innerHTML='<div>Select a celestial body to warp there.</div>';spaceMapWarpStatus.classList.remove('hidden');return;}if(pendingWarpBody===picked)startWarp(picked);else showWarpConfirmation(picked);});
    window.addEventListener('resize',()=>{if(spaceMapOpen){const rect=spaceMapViewportWrap.getBoundingClientRect();clampSpaceMapPan(rect.width,rect.height);drawSpaceMap();}});

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
    skyMesh.renderOrder = -2;
    skyMat.depthWrite = false;
    scene.add(skyMesh);

    const cloudGeo = new THREE.SphereGeometry(1440, 24, 12);
    const cloudMat = new THREE.MeshBasicMaterial({
      color: 0xffffff, transparent: true, opacity: 0.06, side: THREE.BackSide, fog: false,
    });
    const cloudMesh = new THREE.Mesh(cloudGeo, cloudMat);
    // cloudMesh is Ivis-local and is attached to planetSystem below, after that group is created.

    // ---------- low cloud layer ----------
    // Simple stylized cloud clusters circling the planet at roughly 120 units above the
    // planet's new 240-unit base radius. Each cluster is made from a few soft white spheres
    // flattened into little puffs and placed on a spherical shell at radius 360.
    // The layer rotates slowly around the planet independently from the planet itself.
    const CLOUD_LAYER_RADIUS = 360;

    const cloudLayer = new THREE.Group();
    // cloudLayer is Ivis-local and is attached to planetSystem below.

    const cloudPuffGeo = new THREE.SphereGeometry(1, 12, 8);
    const cloudPuffMat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.82,
      depthWrite: false,
      fog: false
    });

    function addCloudCluster(direction, scale = 1, puffCountOverride = null) {
      const normal = direction.clone().normalize();
      const tangentA = new THREE.Vector3();
      const tangentB = new THREE.Vector3();
      const ref = Math.abs(normal.y) > 0.92 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
      tangentA.crossVectors(ref, normal).normalize();
      tangentB.crossVectors(normal, tangentA).normalize();

      const cluster = new THREE.Group();
      cluster.position.copy(normal).multiplyScalar(CLOUD_LAYER_RADIUS);
      cluster.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), normal);

      const puffs = puffCountOverride ?? (4 + Math.floor(Math.random() * 4));
      for (let i = 0; i < puffs; i++) {
        const puff = new THREE.Mesh(cloudPuffGeo, cloudPuffMat.clone());
        const side = (Math.random() - 0.5) * 7 * scale;
        const along = (Math.random() - 0.5) * 7 * scale;
        const height = (Math.random() - 0.5) * 1.8 * scale;
        puff.position.set(side, height, along);
        puff.scale.set(4.6 * scale * (0.85 + Math.random() * 0.35), 1.15 * scale * (0.85 + Math.random() * 0.4), 3.2 * scale * (0.85 + Math.random() * 0.35));
        puff.rotation.y = Math.random() * Math.PI * 2;
        puff.material.opacity = 0.62 + Math.random() * 0.24;
        cluster.add(puff);
      }

      cloudLayer.add(cluster);
    }

    for (let i = 0; i < 72; i++) {
      const y = Math.random() * 2 - 1;
      const radial = Math.sqrt(Math.max(0, 1 - y * y));
      const theta = Math.random() * Math.PI * 2;
      const dir = new THREE.Vector3(
        Math.cos(theta) * radial,
        y,
        Math.sin(theta) * radial
      );
      addCloudCluster(dir, 0.75 + Math.random() * 0.8);
    }

    // Rain and thunderstorms now use a dense planet-wide cloud deck: about 50x the
    // normal 72-cluster coverage. Extra storm clouds are lightweight (one puff each)
    // so the weather can cover the whole planet without exploding the mesh count.
    const BASE_CLOUD_COUNT = 72;
    const WEATHER_CLOUD_COUNT = 3600;
    const EXTRA_WEATHER_CLOUD_COUNT = WEATHER_CLOUD_COUNT - BASE_CLOUD_COUNT;
    const THUNDER_CLOUD_START = WEATHER_CLOUD_COUNT;
    for (let i = 0; i < EXTRA_WEATHER_CLOUD_COUNT; i++) {
      // Fibonacci-sphere placement keeps the rainy cloud deck evenly distributed over
      // the entire planet rather than leaving large uncovered patches.
      const t = (i + 0.5) / EXTRA_WEATHER_CLOUD_COUNT;
      const y = 1 - 2 * t;
      const radial = Math.sqrt(Math.max(0, 1 - y * y));
      const goldenAngle = Math.PI * (3 - Math.sqrt(5));
      const theta = i * goldenAngle;
      const dir = new THREE.Vector3(Math.cos(theta) * radial, y, Math.sin(theta) * radial);
      addCloudCluster(dir, 0.60 + Math.random() * 0.55, 1);
    }

    const cloudShellFade = () => {
      const a = cloudMat.opacity;
      cloudLayer.children.forEach(cluster => {
        cluster.children.forEach(puff => {
          puff.material.opacity = a > 0 ? (0.58 + 0.28 * (a / 0.06)) : 0;
        });
      });
    };

    // ---------- dynamic weather ----------
    // Automatic rain starts about once every two in-game days. Creative/freeplay gets
    // a small control panel to trigger rain or clear weather on demand.
    const weatherRainGroup = new THREE.Group();
    weatherRainGroup.renderOrder = 20;
    // weatherRainGroup is Ivis-local and is attached to planetSystem below.
    const rainDropCount = 4200;
    const rainPositions = new Float32Array(rainDropCount * 6);
    const rainSpeeds = new Float32Array(rainDropCount);
    const rainLengths = new Float32Array(rainDropCount);
    const rainDrift = new Float32Array(rainDropCount * 2);
    const rainGeo = new THREE.BufferGeometry();
    rainGeo.setAttribute('position', new THREE.BufferAttribute(rainPositions, 3));
    const rainMat = new THREE.LineBasicMaterial({ color: 0xbfe7ff, transparent: true, opacity: 0.55, fog: false, depthTest: true, depthWrite: false });
    const rainMesh = new THREE.LineSegments(rainGeo, rainMat);
    weatherRainGroup.add(rainMesh);

    let weatherState = 'clear'; // clear | building | raining | clearing
    let weatherThunderstorm = false;
    let automaticRainNumber = 0;
    let lightningTimer = 0;
    let lightningFlashTimer = 0;
    let lightningBoltTimer = 0;
    let weatherTimer = 0;
    let weatherBuildTimer = 0;
    let weatherRainTimer = 0;
    let weatherClearTimer = 0;
    let weatherForced = false;

    const weatherControlToggle = document.getElementById('weatherControlToggle');
    const weatherControlOverlay = document.getElementById('weatherControlOverlay');
    const weatherControlClose = document.getElementById('weatherControlClose');
    const weatherRainButton = document.getElementById('weatherRainButton');
    const weatherClearButton = document.getElementById('weatherClearButton');
    const weatherThunderButton = document.getElementById('weatherThunderButton');
    const setDayButton = document.getElementById('setDayButton');
    const setNightButton = document.getElementById('setNightButton');
    const lightningFlash = document.getElementById('lightningFlash');
    const weatherControlStatus = document.getElementById('weatherControlStatus');

    function isWeatherAllowedHere() {
      if (playerState.inRocket) return flightPosition.distanceTo(ivisSolarOrbitPosition) < WEATHER_CLOUD_RADIUS - 1;
      return player.position.length() < WEATHER_CLOUD_RADIUS - 1;
    }

    function setRainParticle(i, centerWorld, downWorld) {
      const up = downWorld.clone().multiplyScalar(-1);
      let t = new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5);
      t.addScaledVector(up, -t.dot(up)).normalize();
      const b = new THREE.Vector3().crossVectors(up, t).normalize();
      const radius = 8 + Math.random() * 58;
      const a = Math.random() * Math.PI * 2;
      const tangent = t.multiplyScalar(Math.cos(a) * radius).addScaledVector(b, Math.sin(a) * radius);
      const radialHeight = 10 + Math.random() * 34;
      const start = centerWorld.clone().add(tangent).addScaledVector(up, radialHeight);
      const length = 1.2 + Math.random() * 1.6;
      rainSpeeds[i] = 28 + Math.random() * 18;
      rainLengths[i] = length;
      rainDrift[i * 2] = (Math.random() - 0.5) * 0.35;
      rainDrift[i * 2 + 1] = (Math.random() - 0.5) * 0.35;
      const end = start.clone().addScaledVector(downWorld, length);
      rainPositions[i * 6] = start.x; rainPositions[i * 6 + 1] = start.y; rainPositions[i * 6 + 2] = start.z;
      rainPositions[i * 6 + 3] = end.x; rainPositions[i * 6 + 4] = end.y; rainPositions[i * 6 + 5] = end.z;
    }

    function rebuildRainDrops() {
      const activeCamera = playerState.inRocket ? flightCamera : camera;
      const center = new THREE.Vector3();
      activeCamera.getWorldPosition(center);
      const down = center.clone().normalize().multiplyScalar(-1);
      for (let i = 0; i < rainDropCount; i++) setRainParticle(i, center, down);
      rainGeo.attributes.position.needsUpdate = true;
    }

    function updateRainParticles(delta) {
      const visible = weatherState === 'raining' && state.gameState === 'playing' && !state.paused && isWeatherAllowedHere();
      weatherRainGroup.visible = visible;
      if (!visible) return;
      // The particle volume follows the current player/ship position, so rain does not
      // remain anchored to the place where the storm originally began.
      const activeCamera = playerState.inRocket ? flightCamera : camera;
      const center = new THREE.Vector3();
      activeCamera.getWorldPosition(center);
      for (let i = 0; i < rainDropCount; i++) {
        const idx = i * 6;
        const sx = rainPositions[idx], sy = rainPositions[idx + 1], sz = rainPositions[idx + 2];
        const ex = rainPositions[idx + 3], ey = rainPositions[idx + 4], ez = rainPositions[idx + 5];
        const start = new THREE.Vector3(sx, sy, sz);
        const end = new THREE.Vector3(ex, ey, ez);
        const radialDownStart = start.clone().normalize().multiplyScalar(-1);
        const move = rainSpeeds[i] * delta;
        start.addScaledVector(radialDownStart, move);
        end.addScaledVector(radialDownStart, move);
        const radial = end.length();
        if (radial < PLANET_RADIUS + 2 || start.distanceTo(center) > 76) {
          const down = center.clone().normalize().multiplyScalar(-1);
          setRainParticle(i, center, down);
        } else {
          rainPositions[idx] = start.x; rainPositions[idx + 1] = start.y; rainPositions[idx + 2] = start.z;
          rainPositions[idx + 3] = end.x; rainPositions[idx + 4] = end.y; rainPositions[idx + 5] = end.z;
        }
      }
      rainGeo.attributes.position.needsUpdate = true;
    }

    function updateWeatherVisuals() {
      const building = weatherState === 'building';
      const raining = weatherState === 'raining';
      const clearing = weatherState === 'clearing';
      const clearStrength = clearing ? 1 - THREE.MathUtils.clamp(weatherClearTimer / WEATHER_CLEARING_SECONDS, 0, 1) : 0;
      const strength = building ? THREE.MathUtils.clamp(weatherBuildTimer / WEATHER_BUILDUP_SECONDS, 0, 1) : (raining ? 1 : clearStrength);
      const weatherActive = building || raining || clearing;
      const playerRadius = playerState.inRocket ? flightPosition.distanceTo(ivisSolarOrbitPosition) : player.position.length();
      // Weather is local to the planet's surface, not tied to where the storm was started.
      // Anywhere below the cloud deck can receive rain; above the cloud deck it clears.
      const underClouds = playerRadius < CLOUD_LAYER_RADIUS - 1;
      const cloudVisibility = 1 - THREE.MathUtils.clamp((playerRadius - 150) / 150, 0, 1);
      const cloudWeatherFade = underClouds ? 1 : 0;
      const visibleFactor = THREE.MathUtils.clamp(cloudVisibility * cloudWeatherFade, 0, 1);

      // Weather only changes cloud/rain materials. It deliberately never changes the
      // renderer, scene background, camera, planet root, or planet materials.
      cloudLayer.children.forEach((cluster, clusterIndex) => cluster.children.forEach(puff => {
        const base = 0.52 + 0.24 * cloudVisibility;
        const isWeatherExtra = clusterIndex >= BASE_CLOUD_COUNT && clusterIndex < THUNDER_CLOUD_START;
        const stormMultiplier = isWeatherExtra ? (weatherActive ? 1 : 0) : 1;
        puff.material.color.setHex(weatherActive ? 0x4f565f : 0xffffff);
        puff.material.opacity = visibleFactor * base * (0.72 + strength * 0.28) * stormMultiplier;
        puff.material.depthTest = true;
        puff.material.depthWrite = false;
      }));
      cloudMat.color.setHex(weatherActive ? 0x3e454d : 0xffffff);
      cloudMat.opacity = visibleFactor * (weatherActive ? (0.018 + 0.035 * strength) : 0.06);
      cloudMat.depthTest = true;
      cloudMat.depthWrite = false;
      rainMat.opacity = (raining && isWeatherAllowedHere()) ? 0.72 : 0;
      if (weatherControlStatus) weatherControlStatus.textContent = 'WEATHER: ' + (raining ? (weatherThunderstorm ? 'THUNDERSTORM' : 'RAINING') : building ? (weatherThunderstorm ? 'THUNDERSTORM BUILDING' : 'STORM BUILDING') : clearing ? 'CLEARING' : 'CLEAR');
    }

    function startRain(forced = false, thunderstorm = false) {
      weatherState = 'building';
      weatherThunderstorm = !!thunderstorm;
      weatherBuildTimer = 0;
      weatherRainTimer = 0;
      weatherClearTimer = 0;
      weatherForced = !!forced;
      lightningTimer = 9 + Math.random() * 14;
      lightningFlashTimer = 0;
      lightningBoltTimer = 0;
      if (lightningFlash) lightningFlash.style.opacity = '0';
      rebuildRainDrops();
      updateWeatherVisuals();
    }

    function clearWeather() {
      // Fade storm clouds and ambience out smoothly instead of snapping straight to clear.
      weatherState = 'clearing';
      weatherBuildTimer = 0;
      weatherRainTimer = 0;
      weatherClearTimer = 0;
      weatherForced = false;
      weatherThunderstorm = false;
      weatherTimer = 0;
      lightningTimer = 0;
      lightningFlashTimer = 0;
      lightningBoltTimer = 0;
      if (lightningFlash) lightningFlash.style.opacity = '0';
      lightningBolt.visible = false;
      weatherRainGroup.visible = false;
      updateWeatherVisuals();
    }

    function updateWeatherControlVisibility() {
      // Weather is opened with G; the old on-screen toggle is intentionally hidden.
      if (weatherControlToggle) weatherControlToggle.classList.add('hidden');
      if (weatherControlOverlay && state.gameState !== 'playing') weatherControlOverlay.classList.add('hidden');
    }

    function toggleWeatherControlMenu() {
      const inCreative = state.gameMode === 'freeplay' || state.gameMode === 'creative';
      if (state.gameState !== 'playing' || state.paused || !inCreative || playerState.inRocket) return;
      if (!weatherControlOverlay) return;
      const willOpen = weatherControlOverlay.classList.contains('hidden');
      if (willOpen) {
        weatherControlOverlay.classList.remove('hidden');
        if (document.pointerLockElement === canvas) document.exitPointerLock();
      } else {
        weatherControlOverlay.classList.add('hidden');
        attemptPointerLock();
      }
    }

    // ---------- thunderstorm lightning ----------
    const lightningBoltMaterial = new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.98, fog: false, depthTest: false, depthWrite: false });
    const lightningBolt = new THREE.Line(new THREE.BufferGeometry(), lightningBoltMaterial);
    lightningBolt.renderOrder = 80;
    lightningBolt.visible = false;
    scene.add(lightningBolt);

    function makeLightningStrike() {
      if (!weatherThunderstorm || weatherState !== 'raining' || !isWeatherAllowedHere()) return;
      const activeCamera = playerState.inRocket ? flightCamera : camera;
      const center = new THREE.Vector3();
      activeCamera.getWorldPosition(center);
      const up = center.clone().normalize();
      let tangent = new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5);
      tangent.addScaledVector(up, -tangent.dot(up));
      if (tangent.lengthSq() < 0.001) tangent.set(1, 0, 0);
      tangent.normalize();
      const tangent2 = new THREE.Vector3().crossVectors(up, tangent).normalize();
      const angle = Math.random() * Math.PI * 2;
      const radial = 12 + Math.random() * 24;
      const strikeDir = up.clone().multiplyScalar(0.32)
        .addScaledVector(tangent, Math.cos(angle) * 0.95)
        .addScaledVector(tangent2, Math.sin(angle) * 0.95).normalize();
      const top = center.clone().normalize().multiplyScalar(CLOUD_LAYER_RADIUS - 8).addScaledVector(strikeDir, radial);
      const groundDir = top.clone().normalize();
      const bottom = groundDir.clone().multiplyScalar(PLANET_RADIUS + Math.max(2, heightAt(groundDir) + 4));
      const points = [];
      const segments = 8;
      for (let i = 0; i <= segments; i++) {
        const t = i / segments;
        const point = bottom.clone().lerp(top, t);
        if (i > 0 && i < segments) {
          point.addScaledVector(tangent, (Math.random() - 0.5) * 5);
          point.addScaledVector(tangent2, (Math.random() - 0.5) * 5);
        }
        points.push(point);
      }
      lightningBolt.geometry.dispose();
      lightningBolt.geometry = new THREE.BufferGeometry().setFromPoints(points);
      lightningBolt.visible = true;
      lightningBoltTimer = 0.42;
      lightningFlashTimer = 0.18;
      if (lightningFlash) lightningFlash.style.opacity = '0.86';
      // Reuse the existing cinematic boom as thunder. It's already in the audio pack and
      // has the right low-end impact for a lightning strike.
      playAudio('spaceAtmosphereBoom', 0.62, 0.94 + Math.random() * 0.12);
    }

    function updateLightning(delta) {
      const active = weatherThunderstorm && weatherState === 'raining' && state.gameState === 'playing' && !state.paused && isWeatherAllowedHere();
      if (!active) {
        lightningBolt.visible = false;
        if (lightningFlash) lightningFlash.style.opacity = '0';
        return;
      }
      lightningTimer -= delta;
      if (lightningTimer <= 0) {
        makeLightningStrike();
        lightningTimer = 10 + Math.random() * 22;
      }
      if (lightningBolt.visible) {
        lightningBoltTimer -= delta;
        if (lightningBoltTimer <= 0) lightningBolt.visible = false;
      }
      if (lightningFlashTimer > 0) {
        lightningFlashTimer -= delta;
        if (lightningFlash) lightningFlash.style.opacity = String(Math.max(0, lightningFlashTimer / 0.18) * 0.86);
      } else if (lightningFlash) {
        lightningFlash.style.opacity = '0';
      }
    }

    // ---------- falling stars ----------
    // A small shooting/falling star appears roughly every 10 seconds during the night.
    // It is camera-relative, so it remains a sky effect rather than getting lost at
    // extreme distances, just like the normal star field.
    const fallingStarGroup = new THREE.Group();
    const fallingStarCoreMat = new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.95, fog: false, depthTest: false, depthWrite: false });
    const fallingStarGlowMat = new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.28, fog: false, depthTest: false, depthWrite: false });
    const fallingStarCoreGeo = new THREE.BufferGeometry();
    const fallingStarGlowGeo = new THREE.BufferGeometry();
    fallingStarCoreGeo.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(6), 3));
    fallingStarGlowGeo.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(6), 3));
    const fallingStarCore = new THREE.Line(fallingStarCoreGeo, fallingStarCoreMat);
    const fallingStarGlow = new THREE.Line(fallingStarGlowGeo, fallingStarGlowMat);
    fallingStarGroup.add(fallingStarGlow, fallingStarCore);
    fallingStarGroup.visible = false;
    fallingStarGroup.frustumCulled = false;
    scene.add(fallingStarGroup);

    let fallingStarTimer = 8 + Math.random() * 4;
    let fallingStarLife = 0;
    let fallingStarDuration = 1.15;
    let fallingStarStart = new THREE.Vector3();
    let fallingStarEnd = new THREE.Vector3();
    let fallingStarActive = false;

    function updateFallingStar(delta) {
      if (state.gameState !== 'playing' || state.paused) {
        fallingStarGroup.visible = false;
        fallingStarActive = false;
        return;
      }

      const activeCamera = playerState.inRocket ? flightCamera : camera;
      const center = new THREE.Vector3();
      activeCamera.getWorldPosition(center);
      const playerWorldPos = new THREE.Vector3();
      player.getWorldPosition(playerWorldPos);
      const playerDir = playerWorldPos.sub(ivisSolarOrbitPosition).normalize();
      const sunDir = sunMesh.position.clone().sub(ivisSolarOrbitPosition).normalize();
      const sunDot = playerDir.dot(sunDir);
      const night = THREE.MathUtils.smoothstep(-sunDot, 0.02, 0.42);
      const atmosphereRadius = center.length();
      const atmosphereBlend = THREE.MathUtils.smoothstep(atmosphereRadius, ROCKET_ATMOSPHERE_FADE_START, ROCKET_ATMOSPHERE_RADIUS);

      // Keep falling stars primarily a night-sky effect, while allowing them to remain visible
      // during the upper-atmosphere/space transition where the star field is already visible.
      const canShow = night > 0.55 || atmosphereBlend > 0.7;
      if (!canShow) {
        fallingStarGroup.visible = false;
        fallingStarActive = false;
        fallingStarTimer = Math.min(fallingStarTimer, 2.5);
        return;
      }

      if (!fallingStarActive) {
        fallingStarTimer -= delta;
        if (fallingStarTimer <= 0) {
          fallingStarActive = true;
          fallingStarLife = 0;
          fallingStarDuration = 0.95 + Math.random() * 0.45;
          fallingStarStart.set(-260 + Math.random() * 520, 170 + Math.random() * 160, -760);
          const travelX = 220 + Math.random() * 180;
          const travelY = -(190 + Math.random() * 150);
          fallingStarEnd.set(fallingStarStart.x + travelX, fallingStarStart.y + travelY, fallingStarStart.z + 80);
          fallingStarGroup.visible = true;
        }
      }

      if (fallingStarActive) {
        fallingStarLife += delta;
        const t = THREE.MathUtils.clamp(fallingStarLife / fallingStarDuration, 0, 1);
        const eased = 1 - Math.pow(1 - t, 1.35);
        const current = fallingStarStart.clone().lerp(fallingStarEnd, eased);
        const tail = fallingStarStart.clone().lerp(fallingStarEnd, Math.max(0, eased - 0.10));
        const corePos = fallingStarCoreGeo.attributes.position.array;
        const glowPos = fallingStarGlowGeo.attributes.position.array;
        corePos[0] = current.x; corePos[1] = current.y; corePos[2] = current.z;
        corePos[3] = tail.x; corePos[4] = tail.y; corePos[5] = tail.z;
        glowPos[0] = current.x; glowPos[1] = current.y; glowPos[2] = current.z;
        glowPos[3] = tail.x; glowPos[4] = tail.y; glowPos[5] = tail.z;
        fallingStarCoreGeo.attributes.position.needsUpdate = true;
        fallingStarGlowGeo.attributes.position.needsUpdate = true;
        const fade = Math.sin(Math.PI * t);
        fallingStarCoreMat.opacity = 0.95 * fade;
        fallingStarGlowMat.opacity = 0.28 * fade;
        if (fallingStarLife >= fallingStarDuration) {
          fallingStarActive = false;
          fallingStarGroup.visible = false;
          fallingStarTimer = 8 + Math.random() * 4;
        }
      }

      // Camera-relative placement keeps the effect pinned to the sky and guarantees it
      // remains visible even when the ship is thousands of units from the planet.
      fallingStarGroup.position.copy(center);
      fallingStarGroup.quaternion.copy(activeCamera.quaternion);
    }

    function updateWeather(delta) {
      if (state.gameState !== 'playing') { updateWeatherVisuals(); return; }
      weatherTimer += delta;
      if (weatherState === 'clear' && !weatherForced && weatherTimer >= WEATHER_TWO_DAYS_SECONDS) {
        automaticRainNumber++;
        startRain(false, automaticRainNumber % 2 === 0);
      }
      if (weatherState === 'building') {
        weatherBuildTimer += delta;
        if (weatherBuildTimer >= WEATHER_BUILDUP_SECONDS) {
          weatherState = 'raining';
          weatherRainTimer = 0;
          lightningTimer = 7 + Math.random() * 15;
          rebuildRainDrops();
        }
      } else if (weatherState === 'raining') {
        weatherRainTimer += delta;
        if (!weatherForced && weatherRainTimer >= (weatherThunderstorm ? WEATHER_THUNDERSTORM_SECONDS : WEATHER_RAIN_SECONDS)) {
          clearWeather();
        }
      } else if (weatherState === 'clearing') {
        weatherClearTimer += delta;
        if (weatherClearTimer >= WEATHER_CLEARING_SECONDS) {
          weatherState = 'clear';
          weatherClearTimer = 0;
          weatherThunderstorm = false;
        }
      }
      updateWeatherVisuals();
    }

    // Creative weather controls: G opens/closes the weather menu.
    if (weatherControlClose) weatherControlClose.addEventListener('click', () => {
      weatherControlOverlay.classList.add('hidden');
      attemptPointerLock();
    });
    if (weatherRainButton) weatherRainButton.addEventListener('click', () => {
      startRain(true, false);
    });
    if (weatherThunderButton) weatherThunderButton.addEventListener('click', () => {
      startRain(true, true);
    });
    if (weatherClearButton) weatherClearButton.addEventListener('click', () => {
      clearWeather();
    });

    function setWorldTime(isDay) {
      // World Control works while actively playing and not inside the rocket.
      if (state.gameState !== 'playing' || state.paused || playerState.inRocket) return;

      // The Sun is a fixed celestial body. Rotate Ivis itself until the player's
      // current surface position is facing the fixed Sun (day) or facing directly
      // away from it (night).
      const playerWorldPos = new THREE.Vector3();
      const ivisWorldPos = new THREE.Vector3();
      const sunWorldPos = new THREE.Vector3();
      player.getWorldPosition(playerWorldPos);
      planetSystem.getWorldPosition(ivisWorldPos);
      sunMesh.getWorldPosition(sunWorldPos);

      // Build horizontal direction vectors from Ivis's center. This is intentionally
      // based on WORLD space: planetSystem.rotation.y is the thing we want to change.
      playerWorldPos.sub(ivisWorldPos);
      sunWorldPos.sub(ivisWorldPos);
      playerWorldPos.y = 0;
      sunWorldPos.y = 0;

      if (playerWorldPos.lengthSq() < 0.0001 || sunWorldPos.lengthSq() < 0.0001) return;

      const playerWorldAngle = Math.atan2(playerWorldPos.x, playerWorldPos.z);
      let targetWorldAngle = Math.atan2(sunWorldPos.x, sunWorldPos.z);
      if (!isDay) targetWorldAngle += Math.PI;

      // Rotate the planet by the exact angular difference. The player stays on the
      // same spot on Ivis, but that spot now points at (day) or away from (night) the Sun.
      let delta = targetWorldAngle - playerWorldAngle;
      delta = ((delta + Math.PI) % (Math.PI * 2)) - Math.PI;

      state.planetSpinAngle = planetSystem.rotation.y + delta;
      planetSystem.rotation.y = state.planetSpinAngle;

      // Recalculate lighting/sky immediately without advancing the normal day clock.
      updateDayNight(0);

      if (weatherControlStatus) {
        weatherControlStatus.textContent = isDay
          ? 'TIME: DAY · IVIS FACING THE SUN'
          : 'TIME: NIGHT · IVIS FACING AWAY';
      }
    }

    const handleSetDay = (event) => {
      event.preventDefault();
      event.stopPropagation();
      setWorldTime(true);
    };
    const handleSetNight = (event) => {
      event.preventDefault();
      event.stopPropagation();
      setWorldTime(false);
    };

    if (setDayButton) {
      setDayButton.addEventListener('click', handleSetDay);
    }
    if (setNightButton) {
      setNightButton.addEventListener('click', handleSetNight);
    }

    // Small star particles are hidden during the day and fade in at night. At high
    // altitude they also fade in gradually, so the sky transitions naturally into space.
    // They are deliberately treated like a background layer: they do NOT use depth testing
    // or perspective size attenuation. This makes every star remain visible instead of
    // becoming sub-pixel tiny or being hidden by the giant sky sphere.
    const starPositions = [];
    // Use an even spherical distribution so there is no sparse "hole" in the middle
    // of the player's view. A Fibonacci sphere gives much more uniform coverage than
    // independently random directions, especially with a relatively small star count.
    const STAR_COUNT = 5000;
    for (let i = 0; i < STAR_COUNT; i++) {
      // Use genuinely random directions and, importantly, a wide range of depths.
      // Keeping every star on almost the same radius made the field look like a
      // giant dotted sphere around the camera. Varying the distance makes the sky
      // read as an open volume of space instead. The minimum stays just outside the
      // sky sphere so depth testing still lets the planet/terrain occlude the stars.
      const y = Math.random() * 2 - 1;
      const radial = Math.sqrt(Math.max(0, 1 - y * y));
      const theta = Math.random() * Math.PI * 2;
      const starRadius = 1455 + Math.pow(Math.random(), 0.62) * 7000;
      const x = Math.cos(theta) * radial;
      const z = Math.sin(theta) * radial;
      starPositions.push(x * starRadius, y * starRadius, z * starRadius);
    }
    const starGeo = new THREE.BufferGeometry();
    starGeo.setAttribute('position', new THREE.Float32BufferAttribute(starPositions, 3));
    const starMat = new THREE.PointsMaterial({
      color: 0xffffff,
      size: 3.2,
      sizeAttenuation: false,
      transparent: true,
      opacity: 0,
      fog: false,
      // Keep stars white at extreme distance and let nearer terrain/objects occlude them
      // naturally instead of drawing the stars through the planet. The star sphere is
      // slightly closer than the sky sphere, so the sky still provides the backdrop.
      depthTest: true,
      depthWrite: false
    });
    const stars = new THREE.Points(starGeo, starMat);
    // Render the stars after the sky sphere but before normal world geometry.
    // Depth testing keeps stars behind the planet/terrain while their larger sky radius
    // and camera-follow behavior keep them visible across the full FOV at any altitude.
    stars.renderOrder = -1;
    stars.frustumCulled = false;
    scene.add(stars);

    // The sun stays fixed in space while the planet rotates around its own axis.
    // This is the more natural setup for the game: later, the spaceship can fly around
    // the same stationary sun while the planet keeps spinning underneath it.
    const SUN_DISTANCE = 10000;
    // v0.8B Day 9 celestial-spacing expansion: Ivis-to-Sun distance doubled,
    // Ivis-to-Moon orbital radius doubled, and Sun-to-Cordelia distance doubled.
    const DAY_LENGTH_SECONDS = 300;
    // A crystal comes back after the planet has completed two full rotations: two complete
    // day/night cycles. Keeping this tied to the same constant means the respawn time can
    // never drift away from the actual sun/planet cycle.
    const CRYSTAL_RESPAWN_SECONDS = DAY_LENGTH_SECONDS * 2;

    // Weather: automatic storms recur roughly every two in-game days (2 * 5 minutes).
    const WEATHER_TWO_DAYS_SECONDS = DAY_LENGTH_SECONDS * 2;
    const WEATHER_BUILDUP_SECONDS = 5;
    const WEATHER_CLEARING_SECONDS = 5;
    const WEATHER_RAIN_SECONDS = DAY_LENGTH_SECONDS * 0.5;
    const WEATHER_THUNDERSTORM_SECONDS = DAY_LENGTH_SECONDS;
    const WEATHER_CLOUD_RADIUS = CLOUD_LAYER_RADIUS;
    const CRYSTAL_PICKUP_RADIUS = 3.2;


    // The Sun is now a real celestial object in Pocket Universe. It sits 10000 units from
    // Ivis's center and is 7x Ivis's radius (840 units across as a radius, matching the
    // requested 7x-size visual scale). The visible sphere is still accompanied by the
    // same directional light used by the original Sun, so all existing lighting, sky,
    // sunset, night, World Control, and day/night behavior continue to work.
    const SUN_RADIUS = PLANET_RADIUS * 7; // 1680: twice the previous 840-unit Sun radius

    // Celestial bodies live far beyond the local atmospheric fog range. Keep the Sun's
    // material outside scene fog so its emissive yellow appearance remains stable at
    // 10000+ units instead of being blended into the blue/space fog.
    const sunMaterial = new THREE.MeshBasicMaterial({
      color: 0xffd45c,
      fog: false
    });
    const sunMesh = new THREE.Mesh(
      new THREE.SphereGeometry(SUN_RADIUS, 48, 48),
      sunMaterial
    );
    // Keep the Sun eligible for rendering at its large orbital distance.
    sunMesh.frustumCulled = false;
    const sunLight = new THREE.DirectionalLight(0xfff3d6, 2.1);
    const initialSunDirection = new THREE.Vector3(520, 120, 150).normalize();
    sunMesh.position.copy(initialSunDirection).multiplyScalar(SUN_DISTANCE);
    sunLight.position.copy(sunMesh.position);
    scene.add(sunMesh);
    scene.add(sunLight);

    // ---------- Ivis solar orbit ----------
    // Ivis now travels around the same Sun as Cordelia and Syspo. The initial orbit phase
    // is chosen so Ivis starts exactly where it has always started (the world origin) while
    // keeping a constant 10,000-unit distance from the Sun.
    const IVIS_SUN_ORBIT_DISTANCE = SUN_DISTANCE;
    const IVIS_SUN_ORBIT_PERIOD = 1800; // 30 minutes per full orbit
    let ivisSolarOrbitAngle = 0;
    const ivisSolarOrbitPosition = new THREE.Vector3();
    const ivisSolarOrbitBasisA = new THREE.Vector3();
    const ivisSolarOrbitBasisB = new THREE.Vector3();
    const ivisSolarOrbitInitialDirection = sunMesh.position.clone().normalize().multiplyScalar(-1);
    const ivisSolarReferenceAxis = Math.abs(ivisSolarOrbitInitialDirection.y) < 0.9
      ? new THREE.Vector3(0, 1, 0)
      : new THREE.Vector3(1, 0, 0);
    // Basis A is the exact initial Sun -> Ivis radial direction so angle 0 reproduces the
    // historical placement at the world origin. Basis B completes the orbital plane.
    ivisSolarOrbitBasisA.copy(ivisSolarOrbitInitialDirection);
    ivisSolarOrbitBasisB.crossVectors(ivisSolarReferenceAxis, ivisSolarOrbitInitialDirection).normalize();
    function updateIvisSolarOrbit(delta) {
      ivisSolarOrbitAngle = (ivisSolarOrbitAngle + delta * Math.PI * 2 / IVIS_SUN_ORBIT_PERIOD) % (Math.PI * 2);
      ivisSolarOrbitPosition.copy(sunMesh.position)
        .addScaledVector(ivisSolarOrbitBasisA, Math.cos(ivisSolarOrbitAngle) * IVIS_SUN_ORBIT_DISTANCE)
        .addScaledVector(ivisSolarOrbitBasisB, Math.sin(ivisSolarOrbitAngle) * IVIS_SUN_ORBIT_DISTANCE);
      if (typeof planetSystem !== 'undefined') planetSystem.position.copy(ivisSolarOrbitPosition);
    }
    // Initial position is exactly the historical world origin.
    ivisSolarOrbitPosition.copy(sunMesh.position)
      .addScaledVector(ivisSolarOrbitBasisA, IVIS_SUN_ORBIT_DISTANCE);

    // ---------- solar hazard ----------
    // The Sun is deliberately dangerous at close range. Distances here are measured
    // from the Sun's OUTER SURFACE, not its center, so the hazard follows the visible
    // boundary of the giant Sun sphere. The warning starts 500 units above the surface,
    // blackout begins 100 units above the surface, and reaching the surface itself is the
    // irreversible point of no return. The player is then sent back to Ivis with a fresh
    // inventory containing only the starter axe; the current rocket is destroyed.
    const SUN_WARNING_DISTANCE = 500;
    const SUN_BLACKOUT_DISTANCE = 100;
    const SUN_FULL_BLACK_DISTANCE = 0;
    const SUN_DEATH_BLACK_TIME = 2.8;
    const SUN_RETURN_FADE_TIME = 1.15;
    let sunDangerPhase = 'clear';
    let sunDangerTimer = 0;

    const sunWarningOverlay = document.getElementById('sunWarningOverlay');
    const sunBlackout = document.getElementById('sunBlackout');
    const spaceFuelWarningOverlay = document.getElementById('spaceFuelWarningOverlay');
    const syspoWarningOverlay = document.getElementById('syspoWarningOverlay');

    // Losing all fuel while genuinely in space is an unrecoverable state: the player
    // cannot walk back to a planet and there is no way to refuel a dead rocket in flight.
    // Treat it like the solar hazard so Survival can never be softlocked.
    const SPACE_FUEL_DEATH_BLACK_TIME = 2.8;
    const SPACE_FUEL_RETURN_FADE_TIME = 1.15;
    let spaceFuelDangerPhase = 'clear';
    let spaceFuelDangerTimer = 0;

    function getSunHazardWorldPosition(out = new THREE.Vector3()) {
      if (playerState.inRocket) {
        if (flightRocket) return flightRocket.root.getWorldPosition(out);
        return out.copy(flightPosition);
      }
      return player.getWorldPosition(out);
    }

    function destroyCurrentRocketForSunPenalty() {
      const rocketEntry = flightRocket;
      const root = rocketEntry?.root || null;
      if (rocketEntry?.pad && rocketEntry.pad.rocket === rocketEntry) rocketEntry.pad.rocket = null;
      if (flightPad?.rocket === rocketEntry) flightPad.rocket = null;
      if (moonLandingPad?.rocket === rocketEntry) moonLandingPad.rocket = null;
      if (cordeliaLandingPad?.rocket === rocketEntry) cordeliaLandingPad.rocket = null;
      if (root) {
        root.visible = false;
        if (root.parent) root.parent.remove(root);
      }
      moonLandedRocket = null;
      moonLandingPad = null;
      moonLandingArmed = true;
      cordeliaLandedRocket = null;
      cordeliaLandingPad = null;
      cordeliaLandingArmed = true;
      cordeliaTakeoffActive = false;
      omegaLandedRocket = null;
      omegaLandingPad = null;
      omegaTakeoffActive = false;
      omegaLandingArmed = true;
      omegaWalkingBodyId = null;
      flightPad = null;
      flightRocket = null;
    }

    function recoverFromSunExposure() {
      awardAchievement('sun_blackout_survived');
      clearRocketKeys();
      updateRocketEngineAudio(false, false);
      destroyCurrentRocketForSunPenalty();
      spaceFuelDangerPhase = 'clear';
      spaceFuelDangerTimer = 0;
      spaceFuelWarningOverlay.classList.remove('active');

      resetContinuousSurvivalAchievementRun();
      resetInventory();
      setLoopAudioMode('warpDrive', false); setWarpGameplayVisibility(false); warpInProgress=false; warpTargetId=null;
      playerState.inRocket = false;
      playerState.rocketInSpace = false;
      playerState.rocketLanded = false;
      playerState.rocketFuelTimer = 0;
      playerState.heightOffset = 0;
      playerState.verticalVelocity = 0;
      playerState.stamina = STAMINA_MAX;
      playerState.exhausted = false;
      moonWalking = false;
      moonGravityActive = false;
      moonDustTimer = 0;
      cordeliaWalking = false;
      cordeliaGravityActive = false;
      cordeliaTakeoffActive = false;
      cordeliaDustTimer = 0;
      omegaWalkingBodyId = null;
      omegaLandedRocket = null;
      omegaLandingPad = null;
      omegaTakeoffActive = false;
      omegaLandingArmed = true;
      syspoDangerPhase = 'clear';
      syspoDangerTimer = 0;
      syspoWarningOverlay.classList.remove('active');
      syspoGravityActive = false;
      auroraGravityActive = false;
      mileriaGravityActive = false;
      playerState.thirdPerson = false;
      playerState.pitch = 0;
      orientation.identity();

      planetSystem.attach(player);
      const spawnPosition = spawnDir.clone().normalize();
      player.position.copy(spawnPosition).multiplyScalar(PLANET_RADIUS + heightAt(spawnPosition) + EYE_HEIGHT);
      player.quaternion.identity();

      document.body.classList.remove('rocket-flight');
      playerBody.visible = true;
      heldCrystalFirstPerson.visible = true;
      heldCrystalThirdPerson.visible = false;
      flashlight.visible = false;
      camera.layers.enable(0);
      camera.layers.disable(1);
      camera.position.copy(CAM_FIRST);
      targetCamPos.copy(CAM_FIRST);
      camera.rotation.set(0, 0, 0);

      for (const k in systemState.keys) systemState.keys[k] = false;
      clearPhysicalKeys();
      state.paused = false;
      updateStaminaBar();
      updateHotbarUI();
      refreshEquippedItem();
      setRocketFlightUI();
    }

    function recoverFromSpaceFuelExhaustion() {
      awardAchievement('fuel_emergency');
      rocketFlightElapsedSeconds = 0;
      rocketFlightDistance = 0;
      rocketFlightHasMoved = false;
      clearRocketKeys();
      updateRocketEngineAudio(false, false);
      destroyCurrentRocketForSunPenalty();

      resetContinuousSurvivalAchievementRun();
      resetInventory();
      playerState.inRocket = false;
      playerState.rocketInSpace = false;
      playerState.rocketLanded = false;
      playerState.rocketFuelTimer = 0;
      playerState.heightOffset = 0;
      playerState.verticalVelocity = 0;
      playerState.stamina = STAMINA_MAX;
      playerState.exhausted = false;
      moonWalking = false;
      moonGravityActive = false;
      moonDustTimer = 0;
      cordeliaWalking = false;
      cordeliaGravityActive = false;
      cordeliaTakeoffActive = false;
      cordeliaDustTimer = 0;
      playerState.thirdPerson = false;
      playerState.pitch = 0;
      orientation.identity();

      // Return to the normal Ivis spawn and restore the same clean state used by the
      // solar emergency. The fresh inventory contains only the starter axe.
      planetSystem.attach(player);
      const spawnPosition = spawnDir.clone().normalize();
      player.position.copy(spawnPosition).multiplyScalar(PLANET_RADIUS + heightAt(spawnPosition) + EYE_HEIGHT);
      player.quaternion.identity();

      document.body.classList.remove('rocket-flight');
      playerBody.visible = true;
      heldCrystalFirstPerson.visible = true;
      heldCrystalThirdPerson.visible = false;
      flashlight.visible = false;
      camera.layers.enable(0);
      camera.layers.disable(1);
      camera.position.copy(CAM_FIRST);
      targetCamPos.copy(CAM_FIRST);
      camera.rotation.set(0, 0, 0);

      for (const k in systemState.keys) systemState.keys[k] = false;
      clearPhysicalKeys();
      state.paused = false;
      updateStaminaBar();
      updateHotbarUI();
      refreshEquippedItem();
      setRocketFlightUI();
    }

    function updateSpaceFuelDanger(delta) {
      if (state.gameState !== 'playing' || state.paused) {
        if (spaceFuelDangerPhase === 'clear') spaceFuelWarningOverlay.classList.remove('active');
        return spaceFuelDangerPhase !== 'clear';
      }

      if (spaceFuelDangerPhase === 'blackout' || spaceFuelDangerPhase === 'returning') {
        spaceFuelDangerTimer += delta;
        if (spaceFuelDangerPhase === 'blackout') {
          spaceFuelWarningOverlay.classList.remove('active');
          sunBlackout.classList.add('active');
          sunBlackout.style.opacity = '1';
          if (spaceFuelDangerTimer >= SPACE_FUEL_DEATH_BLACK_TIME) {
            recoverFromSpaceFuelExhaustion();
            spaceFuelDangerPhase = 'returning';
            spaceFuelDangerTimer = 0;
          }
        } else {
          const t = Math.min(1, spaceFuelDangerTimer / SPACE_FUEL_RETURN_FADE_TIME);
          sunBlackout.style.opacity = String(1 - t);
          if (t >= 1) {
            sunBlackout.style.opacity = '0';
            sunBlackout.classList.remove('active');
            spaceFuelDangerPhase = 'clear';
            spaceFuelDangerTimer = 0;
            attemptPointerLock();
          }
        }
        return true;
      }

      const fuel = flightPad ? Math.max(0, Math.min(getRocketFuelCapacity(flightPad), Number(flightPad.fuel) || 0)) : 0;
      const strandedInSpace = playerState.inRocket && playerState.rocketInSpace && !playerState.rocketLanded && !!flightRocket && fuel <= 0;
      if (!strandedInSpace) {
        spaceFuelWarningOverlay.classList.remove('active');
        return false;
      }

      spaceFuelWarningOverlay.classList.add('active');
      sunBlackout.classList.remove('active');
      sunBlackout.style.opacity = '0';
      spaceFuelDangerPhase = 'blackout';
      spaceFuelDangerTimer = 0;
      clearRocketKeys();
      updateRocketEngineAudio(false, false);
      return true;
    }

    function updateSunDanger(delta) {
      if (state.gameState !== 'playing' || state.paused) {
        if (sunDangerPhase === 'clear') {
          sunWarningOverlay.classList.remove('active');
          sunBlackout.style.opacity = '0';
          sunBlackout.classList.remove('active');
        }
        return sunDangerPhase !== 'clear';
      }

      if (sunDangerPhase === 'blackout' || sunDangerPhase === 'returning') {
        sunDangerTimer += delta;
        if (sunDangerPhase === 'blackout') {
          sunWarningOverlay.classList.remove('active');
          sunBlackout.classList.add('active');
          sunBlackout.style.opacity = '1';
          if (sunDangerTimer >= SUN_DEATH_BLACK_TIME) {
            recoverFromSunExposure();
            sunDangerPhase = 'returning';
            sunDangerTimer = 0;
          }
        } else {
          const t = Math.min(1, sunDangerTimer / SUN_RETURN_FADE_TIME);
          sunBlackout.style.opacity = String(1 - t);
          if (t >= 1) {
            sunBlackout.style.opacity = '0';
            sunBlackout.classList.remove('active');
            sunDangerPhase = 'clear';
            sunDangerTimer = 0;
            attemptPointerLock();
          }
        }
        return true;
      }

      const sunPos = sunMesh.getWorldPosition(new THREE.Vector3());
      const playerPos = getSunHazardWorldPosition(new THREE.Vector3());
      const centerDistance = playerPos.distanceTo(sunPos);
      const surfaceDistance = centerDistance - SUN_RADIUS;

      // All gameplay thresholds are relative to the Sun's surface. A value of 0 means
      // the player's hazard position has reached the visible sphere itself; negative
      // values are technically inside the Sun, but the blackout is triggered at 0 first.
      const warningActive = surfaceDistance <= SUN_WARNING_DISTANCE;
      sunWarningOverlay.classList.toggle('active', warningActive);

      if (surfaceDistance > SUN_BLACKOUT_DISTANCE) {
        sunBlackout.style.opacity = '0';
        return false;
      }

      // Begin fading 100 units above the surface and reach full black exactly at the
      // Sun's surface.
      const fade = THREE.MathUtils.clamp(
        (SUN_BLACKOUT_DISTANCE - surfaceDistance) / (SUN_BLACKOUT_DISTANCE - SUN_FULL_BLACK_DISTANCE),
        0, 1
      );
      sunBlackout.classList.add('active');
      sunBlackout.style.opacity = String(fade);

      if (surfaceDistance <= SUN_FULL_BLACK_DISTANCE) {
        sunDangerPhase = 'blackout';
        sunDangerTimer = 0;
        clearRocketKeys();
        updateRocketEngineAudio(false, false);
        return true;
      }

      // The player can still escape while the screen is fading. Movement is only locked
      // after the screen has fully blacked out and the point of no return is reached.
      return false;
    }

    function recoverFromSyspoExposure() {
      clearRocketKeys();
      updateRocketEngineAudio(false, false);
      destroyCurrentRocketForSunPenalty();
      resetContinuousSurvivalAchievementRun();
      resetInventory();
      setLoopAudioMode('warpDrive', false); setWarpGameplayVisibility(false); warpInProgress = false; warpTargetId = null;
      playerState.inRocket = false;
      playerState.rocketInSpace = false;
      playerState.rocketLanded = false;
      playerState.rocketFuelTimer = 0;
      playerState.heightOffset = 0;
      playerState.verticalVelocity = 0;
      playerState.stamina = STAMINA_MAX;
      playerState.exhausted = false;
      moonWalking = false; moonGravityActive = false; moonDustTimer = 0;
      cordeliaWalking = false; cordeliaGravityActive = false; cordeliaTakeoffActive = false; cordeliaDustTimer = 0;
      omegaWalkingBodyId = null; syspoGravityActive = false; auroraGravityActive = false; mileriaGravityActive = false;
      syspoDangerPhase = 'returning'; syspoDangerTimer = 0;
      playerState.thirdPerson = false; playerState.pitch = 0; orientation.identity();
      planetSystem.attach(player);
      const spawnPosition = spawnDir.clone().normalize();
      player.position.copy(spawnPosition).multiplyScalar(PLANET_RADIUS + heightAt(spawnPosition) + EYE_HEIGHT);
      player.quaternion.identity();
      document.body.classList.remove('rocket-flight');
      playerBody.visible = true;
      heldCrystalFirstPerson.visible = true;
      heldCrystalThirdPerson.visible = false;
      flashlight.visible = false;
      camera.layers.enable(0); camera.layers.disable(1);
      camera.position.copy(CAM_FIRST); targetCamPos.copy(CAM_FIRST); camera.rotation.set(0, 0, 0);
      for (const k in systemState.keys) systemState.keys[k] = false;
      clearPhysicalKeys();
      state.paused = false;
      updateStaminaBar(); updateHotbarUI(); refreshEquippedItem(); setRocketFlightUI();
    }

    function updateSyspoDanger(delta) {
      if (state.gameState !== 'playing' || state.paused) {
        if (syspoDangerPhase === 'clear') syspoWarningOverlay.classList.remove('active');
        return syspoDangerPhase !== 'clear';
      }
      const p = getSunHazardWorldPosition(new THREE.Vector3());
      const center = syspoMesh.getWorldPosition(new THREE.Vector3());
      const distance = p.distanceTo(center);
      if (syspoDangerPhase === 'blackout' || syspoDangerPhase === 'returning') {
        syspoDangerTimer += delta;
        syspoWarningOverlay.classList.remove('active');
        sunBlackout.classList.add('active');
        sunBlackout.style.opacity = syspoDangerPhase === 'blackout' ? '1' : String(Math.max(0, 1 - syspoDangerTimer / SUN_RETURN_FADE_TIME));
        if (syspoDangerPhase === 'blackout' && syspoDangerTimer >= SUN_DEATH_BLACK_TIME) {
          recoverFromSyspoExposure();
        } else if (syspoDangerPhase === 'returning' && syspoDangerTimer >= SUN_RETURN_FADE_TIME) {
          sunBlackout.style.opacity = '0'; sunBlackout.classList.remove('active'); syspoDangerPhase = 'clear'; syspoDangerTimer = 0; attemptPointerLock();
        }
        return true;
      }
      if (distance <= SYSP0_CORE_DEATH_DISTANCE) {
        syspoDangerPhase = 'blackout'; syspoDangerTimer = 0;
        clearRocketKeys(); updateRocketEngineAudio(false, false); syspoWarningOverlay.classList.remove('active');
        return true;
      }
      if (distance <= SYSP0_CORE_WARNING_DISTANCE) {
        // Warning only: do NOT lock flight movement here. The player must be able to
        // continue through the final 50 units and actually reach the core so the
        // Syspo recovery sequence can trigger. This mirrors the Sun hazard behavior.
        syspoWarningOverlay.classList.add('active');
        return false;
      }
      syspoWarningOverlay.classList.remove('active');
      return false;
    }

    // ---------- moon / lunar body ----------
    // Ivis's Moon is a real scene object: 1/4 of Ivis's radius and on a true
    // circular 1400-unit orbit around Ivis's center, independent from Ivis's spin.
    const MOON_RADIUS = PLANET_RADIUS * 0.25; // 60 units

    const MOON_ORBIT_RADIUS = 1400;
    const MOON_ORBIT_PERIOD = 180; // seconds per full orbit
    const MOON_ORBIT_TILT = THREE.MathUtils.degToRad(12);
    const MOON_COLLISION_RADIUS = MOON_RADIUS + 2.4;
    let moonOrbitAngle = 0;

    function createMoon() {
      const geometry = new THREE.SphereGeometry(MOON_RADIUS, 64, 40);
      const pos = geometry.attributes.position;
      const craterSeeds = [
        { x: 0.18, y: 0.42, r: 0.13, d: 0.055 },
        { x: -0.34, y: 0.16, r: 0.16, d: 0.070 },
        { x: 0.48, y: -0.08, r: 0.10, d: 0.045 },
        { x: -0.12, y: -0.34, r: 0.20, d: 0.085 },
        { x: 0.28, y: -0.46, r: 0.11, d: 0.050 },
        { x: -0.58, y: -0.18, r: 0.09, d: 0.042 },
        { x: 0.62, y: 0.25, r: 0.075, d: 0.035 },
        { x: -0.02, y: 0.02, r: 0.085, d: 0.030 },
        { x: 0.04, y: 0.64, r: 0.075, d: 0.034 },
        { x: -0.46, y: 0.48, r: 0.09, d: 0.038 }
      ];
      for (let i = 0; i < pos.count; i++) {
        const v = new THREE.Vector3(pos.getX(i), pos.getY(i), pos.getZ(i)).normalize();
        let displacement = 0;
        for (const c of craterSeeds) {
          const dx = v.x - c.x;
          const dy = v.y - c.y;
          const radial = Math.sqrt(dx * dx + dy * dy);
          if (radial < c.r) {
            const t = radial / c.r;
            displacement -= c.d * (1 - t * t);
          }
        }
        displacement += 0.008 * (Math.sin(v.x * 21 + v.y * 7) + Math.sin(v.z * 17 - v.x * 5));
        const r = MOON_RADIUS * (1 + displacement);
        pos.setXYZ(i, v.x * r, v.y * r, v.z * r);
      }
      geometry.computeVertexNormals();

      const mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({
        color: 0x777b80, roughness: 1.0, metalness: 0.0
      }));
      mesh.name = 'IvisMoon';

      // Large surface crater overlays make the impact basins readable from Ivis; their
      // radii are doubled along with the Moon so the visual scale stays proportional.
      const craterVisuals = [
        { dir: new THREE.Vector3(0.38, 0.62, 0.25), r: 7.6 },
        { dir: new THREE.Vector3(-0.55, 0.28, 0.34), r: 9.2 },
        { dir: new THREE.Vector3(0.66, -0.10, -0.24), r: 6.2 },
        { dir: new THREE.Vector3(-0.18, -0.56, 0.36), r: 10.2 },
        { dir: new THREE.Vector3(0.06, 0.20, -0.68), r: 7.0 },
        { dir: new THREE.Vector3(-0.62, -0.18, -0.28), r: 5.4 }
      ];
      for (const c of craterVisuals) {
        const d = c.dir.clone().normalize();
        const crater = new THREE.Mesh(
          new THREE.CircleGeometry(c.r, 24),
          new THREE.MeshStandardMaterial({ color: 0x4d5156, roughness: 1.0, metalness: 0.0 })
        );
        crater.position.copy(d).multiplyScalar(MOON_RADIUS + 0.055);
        crater.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), d);
        mesh.add(crater);

        const rim = new THREE.Mesh(
          new THREE.TorusGeometry(c.r * 0.84, 0.42, 6, 24),
          new THREE.MeshStandardMaterial({ color: 0x85898e, roughness: 1.0, metalness: 0.0 })
        );
        rim.position.copy(d).multiplyScalar(MOON_RADIUS + 0.10);
        rim.quaternion.copy(crater.quaternion);
        mesh.add(rim);
      }
      return mesh;
    }

    const moonMesh = createMoon();
    scene.add(moonMesh);
    const moonQuartzSpawns = [];
    const moonTungstenSpawns = [];
    function spawnMoonQuartz(dir) {
      const group = new THREE.Group();
      const visual = createMoonQuartzVisual(1.0 + Math.random() * 0.25, false);
      const ghost = createMoonQuartzVisual(1.04, true);
      group.add(visual);
      group.add(ghost);
      ghost.visible = false;
      group.position.copy(dir).multiplyScalar(MOON_RADIUS + 0.6);
      group.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
      moonMesh.add(group);
      moonQuartzSpawns.push({ root: group, visual, ghost, direction: dir.clone(), collected: false, respawnAtSpin: 0 });
    }
    function scatterMoonQuartz(count = 120) {
      for (let i = 0; i < count; i++) {
        const dir = new THREE.Vector3(Math.random() * 2 - 1, Math.random() * 2 - 1, Math.random() * 2 - 1).normalize();
        spawnMoonQuartz(dir);
      }
    }
    const moonOrbitTiltQuat = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), MOON_ORBIT_TILT);
    const moonOrbitPosition = new THREE.Vector3();
    const moonWorldPosition = new THREE.Vector3();
    const cordeliaWorldPosition = new THREE.Vector3();
    const MOON_GRAVITY_SWITCH_DISTANCE = 360;

    const MOON_GRAVITY_EXIT_DISTANCE = 430; // doubled with the Moon's 2x gravity radius; preserves hysteresis
    let moonGravityActive = false;
    // Beyond Ivis' local gravity region the ship stops using any celestial center as its
    // reference. Instead, a single random "down" direction is chosen when the ship first
    // enters deep space. WASD movement is then projected onto the resulting plane, giving
    // open, flat-space travel without an automatic pull toward a planet or star.
    const FREE_SPACE_PLANE_SWITCH_DISTANCE = 1000;
    const FREE_SPACE_PLANE_EXIT_DISTANCE = 950;
    let freeSpacePlaneActive = false;
    const freeSpaceDown = new THREE.Vector3(0, 1, 0);
    const freeSpaceTempAxis = new THREE.Vector3();
    let moonWalking = false;
    let moonLandedRocket = null;
    let moonLandingPad = null;
    let moonLandingArmed = true;
    let moonDustTimer = 0;
    // The landed rocket is parked slightly inside the flight collision shell so it sits
    // convincingly on the Moon. A short dedicated takeoff phase clears that shell before
    // normal flight collision checks resume.
    let moonTakeoffActive = false;
    const MOON_TAKEOFF_RELEASE_DISTANCE = 76;
    const MOON_TAKEOFF_BOOST = 34;
    let cordeliaGravityActive = false;
    let cordeliaWalking = false;
    let cordeliaLandedRocket = null;
    let cordeliaLandingPad = null;
    let cordeliaLandingArmed = true;
    let cordeliaDustTimer = 0;
    // Dedicated Cordelia takeoff state. While active, the rocket is guaranteed to move
    // away from Cordelia before normal flight collision/landing logic is allowed to resume.
    let cordeliaTakeoffActive = false;
    const CORDELIA_TAKEOFF_CLEARANCE = 34;
    const CORDELIA_TAKEOFF_RELEASE_DISTANCE = 58;
    const CORDELIA_TAKEOFF_BOOST = 42;
    // Landing must trigger at or just outside the Moon's collision shell. The old 35-unit
    // threshold was inside that shell after the Moon was enlarged, so flight collision blocked
    // the rocket before it could ever reach the landing trigger.
    const MOON_LANDING_SURFACE_DISTANCE = MOON_COLLISION_RADIUS + 2.5;
    const MOON_LANDING_REARM_DISTANCE = 50.0;
    const MOON_PLAYER_GROUND_RADIUS = MOON_RADIUS;
    const MOON_JUMP_SPEED = JUMP_SPEED * Math.SQRT2; // exactly 2x the normal jump height
    const CORDELIA_GRAVITY_SWITCH_DISTANCE = 1600;

    const CORDELIA_GRAVITY_EXIT_DISTANCE = 1700; // doubled with Cordelia's 2x gravity radius
    const CORDELIA_LANDING_SURFACE_DISTANCE = 14;
    const CORDELIA_LANDING_REARM_DISTANCE = 28;
    const CORDELIA_PLAYER_GROUND_RADIUS = 220;

    const CORDELIA_JUMP_SPEED = JUMP_SPEED;

    function updateMoon(delta) {
      moonOrbitAngle = (moonOrbitAngle + (Math.PI * 2 / MOON_ORBIT_PERIOD) * delta) % (Math.PI * 2);
      moonOrbitPosition.set(
        Math.cos(moonOrbitAngle) * MOON_ORBIT_RADIUS,
        0,
        Math.sin(moonOrbitAngle) * MOON_ORBIT_RADIUS
      );
      moonOrbitPosition.applyQuaternion(moonOrbitTiltQuat);
      // The Moon follows Ivis around the Sun, while maintaining its own local orbit around Ivis.
      moonMesh.position.copy(ivisSolarOrbitPosition).add(moonOrbitPosition);
      moonMesh.rotation.y += delta * 0.035;
    }

    // The Moon is a real physical body, not just a sky prop. Once the ship is within
    // 360 units of the Moon's center, the local "down" direction switches from Ivis'
    // center to the Moon's center. This controls the ship's up-vector/orientation while
    // still keeping free-flight movement fully under the pilot's control.
    function updateSpacePlaneState(position) {
      const ivisDistance = position.distanceTo(ivisSolarOrbitPosition);
      if (!freeSpacePlaneActive && ivisDistance >= FREE_SPACE_PLANE_SWITCH_DISTANCE) {
        freeSpacePlaneActive = true;
        freeSpaceDown.set(Math.random() * 2 - 1, Math.random() * 2 - 1, Math.random() * 2 - 1);
        if (freeSpaceDown.lengthSq() < 0.0001) freeSpaceDown.set(0, 1, 0);
        freeSpaceDown.normalize();
      } else if (freeSpacePlaneActive && ivisDistance <= FREE_SPACE_PLANE_EXIT_DISTANCE) {
        freeSpacePlaneActive = false;
      }

      // Getting within a celestial body's influence counts as discovering/reaching it.
      // Keep these checks here so the achievement fires before a later landing event.
      if (state.gameMode === 'survival' && currentAccountUser) {
        moonMesh.getWorldPosition(moonWorldPosition);
        if (position.distanceTo(moonWorldPosition) <= MOON_GRAVITY_SWITCH_DISTANCE) {
          recordCelestialBodyVisit('moon');
        }
        cordeliaMesh.getWorldPosition(cordeliaWorldPosition);
        if (position.distanceTo(cordeliaWorldPosition) <= CORDELIA_GRAVITY_SWITCH_DISTANCE) {
          recordCelestialBodyVisit('cordelia');
        }
        if (position.distanceTo(auroraWorldPosition) <= AURORA_GRAVITY_SWITCH_DISTANCE) recordCelestialBodyVisit('aurora');
        if (position.distanceTo(mileriaWorldPosition) <= MILERIA_GRAVITY_SWITCH_DISTANCE) recordCelestialBodyVisit('mileria');
        if (position.distanceTo(syspoWorldPosition) <= SYSP0_GRAVITY_SWITCH_DISTANCE) recordCelestialBodyVisit('syspo');
      }
    }

    function getActiveGravityCenter(position, out) {
      // Omega's moons have priority over Syspo itself, so leaving Aurora/Mileria smoothly
      // hands control back to Syspo before the ship eventually enters free-space flight.
      if (typeof auroraMesh !== 'undefined') {
        auroraMesh.getWorldPosition(auroraWorldPosition);
        const auroraDistance = position.distanceTo(auroraWorldPosition);
        if (!auroraGravityActive && auroraDistance <= AURORA_GRAVITY_SWITCH_DISTANCE) auroraGravityActive = true;
        else if (auroraGravityActive && auroraDistance > AURORA_GRAVITY_EXIT_DISTANCE) auroraGravityActive = false;
        if (auroraGravityActive) return out.copy(auroraWorldPosition);
      }
      if (typeof mileriaMesh !== 'undefined') {
        mileriaMesh.getWorldPosition(mileriaWorldPosition);
        const mileriaDistance = position.distanceTo(mileriaWorldPosition);
        if (!mileriaGravityActive && mileriaDistance <= MILERIA_GRAVITY_SWITCH_DISTANCE) mileriaGravityActive = true;
        else if (mileriaGravityActive && mileriaDistance > MILERIA_GRAVITY_EXIT_DISTANCE) mileriaGravityActive = false;
        if (mileriaGravityActive) return out.copy(mileriaWorldPosition);
      }
      if (typeof syspoSystem !== 'undefined') {
        syspoSystem.getWorldPosition(syspoWorldPosition);
        const syspoDistance = position.distanceTo(syspoWorldPosition);
        if (!syspoGravityActive && syspoDistance <= SYSP0_GRAVITY_SWITCH_DISTANCE) syspoGravityActive = true;
        else if (syspoGravityActive && syspoDistance > SYSP0_GRAVITY_EXIT_DISTANCE) syspoGravityActive = false;
        if (syspoGravityActive) return out.copy(syspoWorldPosition);
      }

      moonMesh.getWorldPosition(moonWorldPosition);
      const moonDistance = position.distanceTo(moonWorldPosition);
      if (!moonGravityActive && moonDistance <= MOON_GRAVITY_SWITCH_DISTANCE) moonGravityActive = true;
      else if (moonGravityActive && moonDistance > MOON_GRAVITY_EXIT_DISTANCE) moonGravityActive = false;
      if (moonGravityActive) return out.copy(moonWorldPosition);

      cordeliaMesh.getWorldPosition(cordeliaWorldPosition);
      const cordeliaDistance = position.distanceTo(cordeliaWorldPosition);
      if (!cordeliaGravityActive && cordeliaDistance <= CORDELIA_GRAVITY_SWITCH_DISTANCE) cordeliaGravityActive = true;
      else if (cordeliaGravityActive && cordeliaDistance > CORDELIA_GRAVITY_EXIT_DISTANCE) cordeliaGravityActive = false;
      if (cordeliaGravityActive) return out.copy(cordeliaWorldPosition);

      return out.copy(ivisSolarOrbitPosition);
    }
    updateMoon(0);

    // ---------- Cordelia: desert planet ----------
    // Cordelia orbits the real Sun at a fixed 6000-unit distance. It is intentionally
    // independent of Ivis' rotating planetSystem so its position remains a true world-space
    // celestial body, just like the Sun and Moon.
    const CORDELIA_RADIUS = 220; // 2x the previous 110-unit radius
    const CORDELIA_SUN_DISTANCE = 6000;
    const CORDELIA_ORBIT_PERIOD = 1800; // 30 minutes per full orbit

    // ---------- Omega planetary system ----------
    // Syspo is a true hierarchical system: Syspo orbits the Sun, while Aurora and Mileria
    // orbit Syspo. All three bodies therefore move together through the solar system while
    // keeping their own local orbital phases. The solar orbit is a sensible default placement
    // between Cordelia and the outer edge of the existing play area; Omega's navigation can
    // be tuned later without changing the child-orbit math.
    const SYSP0_RADIUS = 700;
    const SYSP0_SOLAR_DISTANCE = 18000;
    const SYSP0_ORBIT_PERIOD = 2400; // 40 minutes around the Sun
    const SYSP0_ROTATION_PERIOD = 420;
    const SYSP0_GRAVITY_SWITCH_DISTANCE = 2700;
    const SYSP0_GRAVITY_EXIT_DISTANCE = 2900;
    const SYSP0_CORE_WARNING_DISTANCE = 750; // 50 above the core surface
    const SYSP0_CORE_DEATH_DISTANCE = SYSP0_RADIUS;
    const SYSP0_CLOUD_RADII = [780, 840, 900];

    const AURORA_RADIUS = 120;
    const AURORA_ORBIT_RADIUS = 2300;
    const AURORA_ORBIT_PERIOD = 600;
    const AURORA_GRAVITY_SWITCH_DISTANCE = 700;
    const AURORA_GRAVITY_EXIT_DISTANCE = 790;

    const MILERIA_RADIUS = 85;
    const MILERIA_ORBIT_RADIUS = 1300;
    const MILERIA_ORBIT_PERIOD = 420;
    const MILERIA_GRAVITY_SWITCH_DISTANCE = 500;
    const MILERIA_GRAVITY_EXIT_DISTANCE = 590;
    const MILERIA_GRAVITY_MULTIPLIER = 0.75;

    let syspoSolarOrbitAngle = 0;
    let auroraOrbitAngle = 0;
    let mileriaOrbitAngle = Math.PI;
    let syspoGravityActive = false;
    let auroraGravityActive = false;
    let mileriaGravityActive = false;
    let omegaWalkingBodyId = null;
    let omegaTakeoffActive = false;
    let omegaTakeoffBodyId = null;
    let omegaLandingArmed = true;
    let omegaLandedRocket = null;
    let omegaLandedBodyId = null;
    let omegaLandingPad = null;
    let omegaDustTimer = 0;
    let syspoDangerPhase = 'clear';
    let syspoDangerTimer = 0;

    const syspoSystem = new THREE.Group();
    syspoSystem.name = 'SyspoSystem';
    syspoSystem.frustumCulled = false;
    const syspoMesh = new THREE.Group();
    syspoMesh.name = 'Syspo';
    const auroraMesh = new THREE.Group();
    auroraMesh.name = 'Aurora';
    const mileriaMesh = new THREE.Group();
    mileriaMesh.name = 'Mileria';
    syspoSystem.add(syspoMesh, auroraMesh, mileriaMesh);
    scene.add(syspoSystem);
    const syspoWorldPosition = new THREE.Vector3();
    const auroraWorldPosition = new THREE.Vector3();
    const mileriaWorldPosition = new THREE.Vector3();
    const syspoSolarOrbitPosition = new THREE.Vector3();
    const syspoSolarOrbitBasisA = new THREE.Vector3();
    const syspoSolarOrbitBasisB = new THREE.Vector3();
    const syspoSunWorldPosition = new THREE.Vector3();
    const omegaTempRadial = new THREE.Vector3();
    const omegaTempLocal = new THREE.Vector3();
    const SYSP0_DAY_SKY = new THREE.Color(0x5d80c9);
    const SYSP0_NIGHT_SKY = new THREE.Color(0x070813);
    const SYSP0_SUNSET_SKY = new THREE.Color(0xd88a75);
    const AURORA_DAY_SKY = new THREE.Color(0x66bff0);
    const AURORA_NIGHT_SKY = new THREE.Color(0x06101d);
    const AURORA_SUNSET_SKY = new THREE.Color(0xf08b49);
    let syspoOrbitDayPhase = 0;

    const CORDELIA_DUNE_HEIGHT = 26;
    const CORDELIA_COLLISION_CLEARANCE = 2.6;
    const CORDELIA_COLLISION_RADIUS = CORDELIA_RADIUS + CORDELIA_DUNE_HEIGHT + CORDELIA_COLLISION_CLEARANCE;
    const cordeliaMesh = new THREE.Group();
    cordeliaMesh.name = 'Cordelia';
    cordeliaMesh.frustumCulled = false;

    const CORDELIA_SAND_BASE = new THREE.Color(0xc99c5b);
    const CORDELIA_SAND_LIGHT = new THREE.Color(0xe0b875);
    const CORDELIA_SAND_DARK = new THREE.Color(0x9d713e);

    function cordeliaNoise(dir) {
      const x = dir.x, y = dir.y, z = dir.z;
      let n = 0;
      n += Math.sin(x * 4.2 + z * 2.6) * 0.42;
      n += Math.sin(y * 7.3 + x * 3.1 + 0.9) * 0.23;
      n += Math.sin(z * 10.2 - y * 4.7 + 1.7) * 0.15;
      n += Math.sin((x - z) * 15.0 + y * 2.0) * 0.10;
      return n / 0.90;
    }

    function cordeliaHeightAt(dir) {
      const latDamp = 0.35 + 0.65 * (1 - Math.abs(dir.y));
      const primary = (0.5 + 0.5 * cordeliaNoise(dir)) * CORDELIA_DUNE_HEIGHT * latDamp;
      const ridges = Math.abs(Math.sin((dir.x * 5.8 + dir.z * 4.1) * 2.6 + dir.y * 1.7));
      const ridgeShape = Math.pow(ridges, 5) * 3.5 * latDamp;
      return Math.max(0, primary * 0.78 + ridgeShape);
    }

    function createCordelia() {
      const geometry = new THREE.SphereGeometry(CORDELIA_RADIUS, 112, 80);
      const pos = geometry.attributes.position;
      const colors = [];
      for (let i = 0; i < pos.count; i++) {
        const d = new THREE.Vector3(pos.getX(i), pos.getY(i), pos.getZ(i)).normalize();
        const h = cordeliaHeightAt(d);
        const r = CORDELIA_RADIUS + h;
        pos.setXYZ(i, d.x * r, d.y * r, d.z * r);
        const t = THREE.MathUtils.clamp((h / CORDELIA_DUNE_HEIGHT) + (cordeliaNoise(d) + 1) * 0.12, 0, 1);
        const c = CORDELIA_SAND_DARK.clone().lerp(CORDELIA_SAND_BASE, 0.45 + t * 0.35);
        if (h > CORDELIA_DUNE_HEIGHT * 0.68) c.lerp(CORDELIA_SAND_LIGHT, 0.38);
        colors.push(c.r, c.g, c.b);
      }
      geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
      geometry.computeVertexNormals();
      // Keep the deformed sphere robust from every viewing angle.  The geometry is
      // modified after SphereGeometry is created, so refresh its bounds and explicitly
      // disable child frustum culling; otherwise an oblique view can make Cordelia's
      // surface appear to pop/cut away at the edge of the camera frustum.
      geometry.computeBoundingSphere();
      const material = new THREE.MeshStandardMaterial({
        vertexColors: true,
        roughness: 1.0,
        metalness: 0.0,
        fog: false,
        side: THREE.DoubleSide,
        // A tiny warm ambient lift keeps Cordelia's night side visibly readable instead
        // of looking like a hard half-cut when the directional Sun is behind it.
        emissive: 0x24170d,
        emissiveIntensity: 0.08,
      });
      const surface = new THREE.Mesh(geometry, material);
      surface.name = 'CordeliaSurface';
      surface.frustumCulled = false;
      cordeliaMesh.add(surface);

      // A subtle dust-color shell gives the planet a softer silhouette without adding a
      // separate atmosphere simulation.  It is also excluded from frustum culling so the
      // shell cannot vanish independently of the surface at oblique viewing angles.
      const shell = new THREE.Mesh(
        new THREE.SphereGeometry(CORDELIA_RADIUS + CORDELIA_DUNE_HEIGHT + 0.45, 64, 48),
        new THREE.MeshBasicMaterial({ color: 0xd7a96a, transparent: true, opacity: 0.08, fog: false, side: THREE.BackSide, depthWrite: false })
      );
      shell.frustumCulled = false;
      shell.name = 'CordeliaDustShell';
      cordeliaMesh.add(shell);

      return cordeliaMesh;
    }

    // Cordelia reuses the exact Ivis atmosphere pipeline, but with its own colors.
    // No custom atmosphere shader: sky, fog, star fade and the space transition are all
    // handled by updateDayNight(), just like on Ivis.
    const CORDELIA_DAY_SKY = new THREE.Color(0xe05a3a);
    const CORDELIA_SUNSET_SKY = new THREE.Color(0xbfe8ff);
    const CORDELIA_NIGHT_SKY = new THREE.Color(0x050817);
    const CORDELIA_DAY_FOG = new THREE.Color(0xe05a3a);
    const CORDELIA_SUNSET_FOG = new THREE.Color(0x9fdcff);
    const CORDELIA_NIGHT_FOG = new THREE.Color(0x050817);
    const cordeliaTempSkyColor = new THREE.Color();
    const cordeliaTempFogColor = new THREE.Color();
    const cordeliaPlayerDir = new THREE.Vector3();
    const cordeliaSunDir = new THREE.Vector3();
    const cordeliaCenterWorld = new THREE.Vector3();
    const CORDELIA_ATMOSPHERE_RANGE = 600;

    let onCordeliaAtmosphere = false;

    function playerIsInCordeliaAtmosphere(worldPos) {
      cordeliaMesh.getWorldPosition(cordeliaCenterWorld);
      return worldPos.distanceTo(cordeliaCenterWorld) <= CORDELIA_RADIUS + CORDELIA_ATMOSPHERE_RANGE;
    }

    function getCordeliaAtmosphereState(worldPos) {
      cordeliaMesh.getWorldPosition(cordeliaCenterWorld);
      const radial = worldPos.clone().sub(cordeliaCenterWorld);
      if (radial.lengthSq() < 0.000001) radial.set(0, 1, 0);
      cordeliaPlayerDir.copy(radial).normalize();
      cordeliaSunDir.copy(sunMesh.position).sub(cordeliaCenterWorld).normalize();
      const inv = cordeliaMesh.quaternion.clone().invert();
      cordeliaPlayerDir.applyQuaternion(inv).normalize();
      cordeliaSunDir.applyQuaternion(inv).normalize();
      return {
        sunDot: cordeliaPlayerDir.dot(cordeliaSunDir),
        altitude: Math.max(0, radial.length() - CORDELIA_RADIUS)
      };
    }

    function applyCordeliaAtmosphere(worldPos) {
      const {sunDot, altitude} = getCordeliaAtmosphereState(worldPos);
      const daylight = THREE.MathUtils.smoothstep(sunDot, -0.48, -0.10);
      const sunset = 1 - Math.min(1, Math.abs(sunDot) / 0.35);
      const night = THREE.MathUtils.smoothstep(-sunDot, 0.02, 0.42);

      ambientLight.intensity = THREE.MathUtils.lerp(0.08, 0.34, daylight);
      cordeliaSunLight.intensity = THREE.MathUtils.lerp(0.03, 2.2, daylight);
      cordeliaSunLight.color.setHex(sunset > 0.05 && daylight < 0.55 ? 0xffa58a : 0xfff0d0);

      cordeliaTempSkyColor.copy(CORDELIA_NIGHT_SKY).lerp(CORDELIA_DAY_SKY, daylight);
      if (sunset > 0) cordeliaTempSkyColor.lerp(CORDELIA_SUNSET_SKY, sunset * 0.72);
      cordeliaTempFogColor.copy(CORDELIA_NIGHT_FOG).lerp(CORDELIA_DAY_FOG, daylight);
      if (sunset > 0) cordeliaTempFogColor.lerp(CORDELIA_SUNSET_FOG, sunset * 0.70);

      const atmosphereBlend = THREE.MathUtils.smoothstep(altitude, ROCKET_ATMOSPHERE_FADE_START, ROCKET_ATMOSPHERE_RADIUS);
      cordeliaTempSkyColor.lerp(SPACE_SKY, atmosphereBlend);
      cordeliaTempFogColor.lerp(SPACE_FOG, atmosphereBlend);
      skyMat.color.copy(cordeliaTempSkyColor);
      scene.background.copy(cordeliaTempSkyColor);
      sceneFog.color.copy(cordeliaTempFogColor);
      starMat.opacity = Math.max(THREE.MathUtils.clamp(night * 1.15, 0, 1), atmosphereBlend);
      cloudMat.opacity = THREE.MathUtils.lerp(0.01, 0.06, daylight) * (1 - atmosphereBlend);
    }
    function placeCordeliaProp(group, dir, extraHeight = 0) {
      const h = cordeliaHeightAt(dir);
      group.position.copy(dir).multiplyScalar(CORDELIA_RADIUS + h + extraHeight);
      group.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
      return h;
    }

    function createCactus(size = 1) {
      const group = new THREE.Group();
      const cactusMat = new THREE.MeshStandardMaterial({ color: 0x4f7f49, roughness: 1.0, metalness: 0.0 });
      const armGeo = new THREE.CylinderGeometry(0.16, 0.20, 0.85, 8);
      const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.28, 1.65, 9), cactusMat);
      trunk.position.y = 0.83;
      group.add(trunk);
      if (Math.random() < 0.72) {
        const arm = new THREE.Mesh(armGeo, cactusMat);
        arm.position.set(0.32, 1.00 + Math.random() * 0.25, 0);
        arm.rotation.z = -0.95;
        group.add(arm);
        const elbow = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.17, 0.55, 8), cactusMat);
        elbow.position.set(0.50, 1.25 + Math.random() * 0.18, 0);
        elbow.rotation.z = -0.05;
        group.add(elbow);
      }
      if (Math.random() < 0.45) {
        const arm = new THREE.Mesh(armGeo, cactusMat);
        arm.position.set(-0.31, 0.82 + Math.random() * 0.30, 0.02);
        arm.rotation.z = 0.95;
        group.add(arm);
      }
      // Small pink flower, present on only some cacti as requested.
      if (Math.random() < 0.30) {
        const flower = new THREE.Mesh(
          new THREE.SphereGeometry(0.13, 8, 6),
          new THREE.MeshStandardMaterial({ color: 0xff82b3, emissive: 0x4b1029, emissiveIntensity: 0.25, roughness: 0.65 })
        );
        flower.position.set((Math.random() - 0.5) * 0.15, 1.68 + Math.random() * 0.34, 0.14);
        group.add(flower);
      }
      group.scale.setScalar(size);
      return group;
    }

    const cordeliaRockSpawns = [];
    const cordeliaTungstenSpawns = [];
    const cordeliaCrystalSpawns = [];
    function scatterCordeliaCacti(count = 140) {
      for (let i = 0; i < count; i++) {
        let dir;
        for (let tries = 0; tries < 20; tries++) {
          dir = new THREE.Vector3(Math.random() * 2 - 1, Math.random() * 2 - 1, Math.random() * 2 - 1).normalize();
          const h = cordeliaHeightAt(dir);
          if (h < CORDELIA_DUNE_HEIGHT * 0.78) break;
        }
        const cactus = createCactus(0.75 + Math.random() * 0.95);
        placeCordeliaProp(cactus, dir, 0.05);
        cactus.rotateY(Math.random() * Math.PI * 2);
        cordeliaMesh.add(cactus);
      }
    }

    function createCordeliaBoulderVisual() {
      const mat = new THREE.MeshStandardMaterial({ color: 0x6c5a4a, roughness: 1.0, metalness: 0.02 });
      const mesh = new THREE.Mesh(new THREE.DodecahedronGeometry(0.95, 0), mat);
      mesh.scale.set(1.3, 0.85, 1.05);
      return mesh;
    }

    function scatterCordeliaBoulders(count = 100) {
      for (let i = 0; i < count; i++) {
        const dir = new THREE.Vector3(Math.random() * 2 - 1, Math.random() * 2 - 1, Math.random() * 2 - 1).normalize();
        const rock = createCordeliaBoulderVisual();
        const scale = 0.7 + Math.random() * 1.5;
        rock.scale.multiplyScalar(scale);
        placeCordeliaProp(rock, dir, 0.12);
        rock.rotateY(Math.random() * Math.PI * 2);
        cordeliaMesh.add(rock);
        cordeliaRockSpawns.push({ root: rock, direction: dir.clone(), mined: false, oreType: 'stone' });
      }
    }

    function spawnCordeliaCrystal(typeId, dir) {
      const base = new THREE.Group();
      const crystal = createCrystalVisual(typeId, false, 1.15);
      const ghost = createCrystalVisual(typeId, true, 1.18);
      base.add(crystal, ghost);
      ghost.visible = false;
      // Sink the crystal base very slightly into the terrain so the lowest shard facets sit
      // flush with Cordelia's dune surface rather than visibly hovering above it.
      placeCordeliaProp(base, dir, 0.01);
      cordeliaMesh.add(base);
      cordeliaCrystalSpawns.push({ typeId, root: base, crystal, ghost, collected: false, respawnAtSpin: 0 });
    }

    function scatterCordeliaCrystals() {
      const commonTypes = ['topaz', 'diamond', 'amethyst'];
      const rareOther = ['ruby', 'jasper', 'emerald', 'lapis', 'onyx'];
      for (const typeId of commonTypes) {
        for (let i = 0; i < 30; i++) {
          const dir = new THREE.Vector3(Math.random() * 2 - 1, Math.random() * 2 - 1, Math.random() * 2 - 1).normalize();
          spawnCordeliaCrystal(typeId, dir);
        }
      }
      for (const typeId of rareOther) {
        for (let i = 0; i < 6; i++) {
          const dir = new THREE.Vector3(Math.random() * 2 - 1, Math.random() * 2 - 1, Math.random() * 2 - 1).normalize();
          spawnCordeliaCrystal(typeId, dir);
        }
      }
    }

    const sunWorldForCordelia = new THREE.Vector3();
    const cordeliaOrbitPosition = new THREE.Vector3();
    const cordeliaOrbitAxis = new THREE.Vector3(0, 1, 0);
    const cordeliaOrbitBasisA = new THREE.Vector3();
    const cordeliaOrbitBasisB = new THREE.Vector3();
    let cordeliaOrbitAngle = 0;
    const sunInitialDirection = sunMesh.position.clone().normalize();
    const referenceAxis = Math.abs(sunInitialDirection.y) < 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
    cordeliaOrbitBasisA.crossVectors(sunInitialDirection, referenceAxis).normalize();
    cordeliaOrbitBasisB.crossVectors(sunInitialDirection, cordeliaOrbitBasisA).normalize();
    const cordeliaSunLight = new THREE.DirectionalLight(0xfff0d0, 2.2);
    cordeliaSunLight.frustumCulled = false;
    scene.add(cordeliaSunLight);
    const cordeliaSunTarget = new THREE.Object3D();
    scene.add(cordeliaSunTarget);
    cordeliaSunLight.target = cordeliaSunTarget;

    function updateCordelia(delta) {
      cordeliaOrbitAngle = (cordeliaOrbitAngle + (Math.PI * 2 / CORDELIA_ORBIT_PERIOD) * delta) % (Math.PI * 2);
      sunMesh.getWorldPosition(sunWorldForCordelia);
      cordeliaOrbitPosition.copy(sunWorldForCordelia)
        .addScaledVector(cordeliaOrbitBasisA, Math.cos(cordeliaOrbitAngle) * CORDELIA_SUN_DISTANCE)
        .addScaledVector(cordeliaOrbitBasisB, Math.sin(cordeliaOrbitAngle) * CORDELIA_SUN_DISTANCE);
      cordeliaMesh.position.copy(cordeliaOrbitPosition);
      // One full Cordelia rotation every 6 minutes: ~3 minutes daylight + ~3 minutes night.
      cordeliaMesh.rotation.y += delta * (Math.PI * 2 / 360);
      cordeliaSunLight.position.copy(sunWorldForCordelia);
      cordeliaSunTarget.position.copy(cordeliaOrbitPosition);
    }
    updateCordelia(0);

    const ambientLight = new THREE.AmbientLight(0xffffff, 0.12);
    scene.add(ambientLight);

    // Colors used for the smooth day -> sunset -> night transition.
    const DAY_SKY = new THREE.Color(0x6fb7ff);
    const SUNSET_SKY = new THREE.Color(0xf08a55);
    const NIGHT_SKY = new THREE.Color(0x050817);
    const SPACE_SKY = new THREE.Color(0x01030a);
    const DAY_FOG = new THREE.Color(0x6fb7ff);
    const SUNSET_FOG = new THREE.Color(0xe07a55);
    const NIGHT_FOG = new THREE.Color(0x050817);
    const SPACE_FOG = new THREE.Color(0x01030a);

    const tempSunDir = new THREE.Vector3();
    const tempPlayerDir = new THREE.Vector3();
    const tempSkyColor = new THREE.Color();
    const omegaAtmosphereWorldPos = new THREE.Vector3();
    const nightSamplePlayerPos = new THREE.Vector3();
    const nightSampleSunPos = new THREE.Vector3();
    const droppedItemBobPos = new THREE.Vector3();
    const tempFogColor = new THREE.Color();

    function updateDayNight(delta) {
      // Rotate the whole planet once every DAY_LENGTH_SECONDS around its local axis.
      // Ivis simultaneously orbits the stationary Sun on a much longer solar cycle. Different terrain
      // into darkness as it spins.
      state.planetSpinAngle += (Math.PI * 2 / DAY_LENGTH_SECONDS) * delta;
      planetSystem.rotation.y = state.planetSpinAngle;
      cloudLayer.rotation.y += delta * 0.018;

      // Get the player's actual WORLD position after the planet has rotated.
      const playerWorldPos = new THREE.Vector3();
      player.getWorldPosition(playerWorldPos);

      // Cordelia uses the same atmosphere system as Ivis, evaluated from Cordelia's
      // own rotating surface. Return before Ivis' math can overwrite the colors.
      if (playerIsInCordeliaAtmosphere(playerWorldPos)) {
        onCordeliaAtmosphere = true;
        applyCordeliaAtmosphere(playerWorldPos);
        return;
      }
      onCordeliaAtmosphere = false;
      tempPlayerDir.copy(playerWorldPos).sub(ivisSolarOrbitPosition).normalize();

      // The fixed sun's position gives us a constant direction from the planet center.
      tempSunDir.copy(sunMesh.position).sub(ivisSolarOrbitPosition).normalize();
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

      // As the rocket climbs above the upper atmosphere, gradually blend the daytime/night
      // sky into a deep space sky. The transition now runs from 360 to 600 units from Ivis
      // center, keeping the atmospheric band proportional to the doubled planet size.
      const playerRadius = playerWorldPos.distanceTo(ivisSolarOrbitPosition);
      const atmosphereBlendForStorm = THREE.MathUtils.smoothstep(playerRadius, ROCKET_ATMOSPHERE_FADE_START, ROCKET_ATMOSPHERE_RADIUS);
      const weatherUnderClouds = playerRadius < CLOUD_LAYER_RADIUS - 1;
      const rainDarken = weatherUnderClouds && (weatherState === 'building' || weatherState === 'raining')
        ? (weatherThunderstorm ? 0.42 : 0.28) * (1 - atmosphereBlendForStorm)
        : 0;
      if (rainDarken > 0) {
        ambientLight.intensity *= (1 - rainDarken * 0.60);
        sunLight.intensity *= (1 - rainDarken * 0.35);
      }
      const atmosphereBlend = THREE.MathUtils.smoothstep(
        playerRadius,
        ROCKET_ATMOSPHERE_FADE_START,
        ROCKET_ATMOSPHERE_RADIUS
      );
      tempSkyColor.lerp(SPACE_SKY, atmosphereBlend);
      if (rainDarken > 0) tempSkyColor.lerp(new THREE.Color(0x4b5660), rainDarken * 1.05);
      skyMat.color.copy(tempSkyColor);
      scene.background.copy(tempSkyColor);

      tempFogColor.copy(NIGHT_FOG).lerp(DAY_FOG, daylight);
      if (sunset > 0) tempFogColor.lerp(SUNSET_FOG, sunset * 0.7);
      tempFogColor.lerp(SPACE_FOG, atmosphereBlend);
      sceneFog.color.copy(tempFogColor);

      // Stars are visible at night, but altitude also fades them in so the climb from blue
      // sky to a dense field of bright white stars feels gradual rather than binary.
      const nightStarOpacity = THREE.MathUtils.clamp(night * 1.15, 0, 1);
      starMat.opacity = Math.max(nightStarOpacity, atmosphereBlend);
      cloudMat.opacity = THREE.MathUtils.lerp(0.01, 0.06, daylight) * (1 - atmosphereBlend);
      const cloudVisibility = THREE.MathUtils.clamp(0.15 + daylight * 0.9, 0, 1) * (1 - atmosphereBlend);
      cloudLayer.children.forEach((cluster, clusterIndex) => {
        const isRainExtra = clusterIndex >= BASE_CLOUD_COUNT && clusterIndex < THUNDER_CLOUD_START;
        const isThunderExtra = clusterIndex >= THUNDER_CLOUD_START;
        cluster.children.forEach(puff => {
          const stormMultiplier = isThunderExtra ? ((weatherState === 'raining' && weatherThunderstorm) ? 1 : 0) : (isRainExtra ? (weatherState === 'raining' ? 1 : 0) : 1);
          puff.material.opacity = (0.45 + 0.3 * Math.random()) * cloudVisibility * stormMultiplier;
        });
      });
    }

    // ---------- planet (terrain-deformed sphere) ----------
    // Everything physically attached to the planet lives in this group. Rotating the
    // group makes the planet turn beneath a fixed sun, so the day/night cycle is driven
    // by the planet rotating around its own axis rather than the sun orbiting the planet.
    const planetSystem = new THREE.Group();
    scene.add(planetSystem);

    // Ivis-local atmosphere/weather objects must travel with the planet as it orbits the Sun.
    // Keeping them under planetSystem prevents clouds/rain from being left behind in solar space.
    planetSystem.add(cloudMesh);
    planetSystem.add(cloudLayer);
    planetSystem.add(weatherRainGroup);

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
    const planetMesh = new THREE.Mesh(planetGeo, planetMat);
    planetMesh.renderOrder = 0;
    planetMat.depthTest = true;
    planetMat.depthWrite = true;
    planetSystem.add(planetMesh);

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
    const grassSpawns = [];

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
        grassSpawns.push({ root: grass, direction: dir.clone(), size, yaw: grass.rotation.y, cut: false });
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
    scatterGrass(1300);
    scatterFlowers(480);

    // Every tree is registered so the starter axe can identify nearby trees and remove them.
    // The size is stored as a gameplay value too: larger trees give proportionally more planks.
    const treeSpawns = worldState.trees;
    // Each chopped tree leaves behind a living sapling that grows back into that same tree
    // over four full Ivis day/night cycles. Saplings are tracked separately from the tree
    // array so the original tree size/orientation and its saved identity remain stable.
    const saplingSpawns = [];
    // Decorative boulders are also mineable. Each boulder can be mined once and yields 1 Stone.
    const rockSpawns = worldState.rocks;
    const ironOreSpawns = worldState.ironOres;
    const furnaces = worldState.furnaces;
    const launchPads = worldState.launchPads;
    const containers = worldState.containers;
    const droppedItems = worldState.droppedItems;
    let activeContainer = null;
    let nextContainerId = 1;
    const placedDrills = [];
    let activeFurnace = null;

    let furnaceSelectedSlot = 'fuel';
    let furnaceSmeltStartedAt = 0;
    // Furnace breaking state is shared through systemState.

    // ---------- generic placeable-surface frame ----------
    // All current placeables use the active celestial body's LOCAL coordinate frame.
    // Parenting the object to that body means it follows both the body's own spin and
    // every parent orbit automatically (Moon/Cordelia/Aurora/Mileria/Syspo hierarchy).
    function getPlaceableSurfaceContext(bodyId = null) {
      const id = bodyId || (omegaWalkingBodyId || (moonWalking ? 'moon' : (cordeliaWalking ? 'cordelia' : 'ivis')));
      if (id === 'aurora' || id === 'mileria') {
        const body = getOmegaMesh(id);
        return body ? { id, parent: body, radius: id === 'aurora' ? AURORA_RADIUS : MILERIA_RADIUS, getHeight: d => getOmegaSurfaceHeight(id, d) } : getPlaceableSurfaceContext('ivis');
      }
      if (id === 'moon') return { id, parent: moonMesh, radius: MOON_RADIUS, getHeight: () => 0 };
      if (id === 'cordelia') return { id, parent: cordeliaMesh, radius: CORDELIA_RADIUS, getHeight: d => cordeliaHeightAt(d) };
      return { id: 'ivis', parent: planetSystem, radius: PLANET_RADIUS, getHeight: d => heightAt(d) };
    }

    function getActivePlaceablePlacement() {
      const ctx = getPlaceableSurfaceContext();
      const bodyWorldQuat = ctx.parent.getWorldQuaternion(new THREE.Quaternion());
      const invBodyQuat = bodyWorldQuat.clone().invert();
      const playerLocal = player.position.clone().normalize();
      const lookWorld = new THREE.Vector3();
      camera.getWorldDirection(lookWorld).normalize();
      const lookLocal = lookWorld.applyQuaternion(invBodyQuat);
      const tangent = lookLocal.sub(playerLocal.clone().multiplyScalar(lookLocal.dot(playerLocal)));
      if (tangent.lengthSq() < 0.0001) {
        tangent.set(1, 0, 0).addScaledVector(playerLocal, -playerLocal.x);
        if (tangent.lengthSq() < 0.0001) tangent.set(0, 0, 1).addScaledVector(playerLocal, -playerLocal.z);
      }
      tangent.normalize();
      const distance = 2.7;
      const dir = playerLocal.clone().add(tangent.multiplyScalar(distance / Math.max(1, ctx.radius))).normalize();
      return { ctx, dir };
    }

    function createContainerStorage() {
      return Array.from({ length: 20 }, () => null);
    }

    function createContainerObject(dir, yaw = Math.random() * Math.PI * 2, surfaceBodyId = 'ivis', inventory = null, containerId = null) {
      const ctx = getPlaceableSurfaceContext(surfaceBodyId);
      const group = createContainerVisual(0.98);
      const h = ctx.getHeight(dir);
      group.position.copy(dir).multiplyScalar(ctx.radius + h + 0.02);
      group.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
      group.rotateY(yaw);
      ctx.parent.add(group);
      const id = containerId || ('container_' + (nextContainerId++));
      const parsed = /^container_(\d+)$/.exec(id);
      if (parsed) nextContainerId = Math.max(nextContainerId, Number(parsed[1]) + 1);
      const safeInventory = Array.isArray(inventory) && inventory.length === 20
        ? inventory.map(slot => slot ? { ...slot } : null)
        : createContainerStorage();
      const container = { root: group, direction: dir.clone(), yaw, surfaceBodyId: ctx.id, containerId: id, inventory: safeInventory };
      containers.push(container);
      return container;
    }

    function createContainerVisual(scale = 1) {
      if (containerModelTemplate) {
        const actual = containerModelTemplate.clone(true);
        actual.scale.setScalar(scale);
        return actual;
      }
      const group = new THREE.Group();
      const bodyMat = new THREE.MeshStandardMaterial({ color: 0x7f8a92, roughness: 0.58, metalness: 0.48 });
      const body = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), bodyMat);
      body.position.y = 0.5;
      group.add(body);
      const lid = new THREE.Mesh(new THREE.BoxGeometry(0.86, 0.08, 0.86), new THREE.MeshStandardMaterial({ color: 0x9aa5ad, roughness: 0.46, metalness: 0.58 }));
      lid.position.y = 0.98;
      group.add(lid);
      group.scale.setScalar(scale);
      return group;
    }

    function findNearbyContainer() {
      if (state.gameState !== 'playing' || playerState.inRocket) return null;
      const playerWorld = player.getWorldPosition(new THREE.Vector3());
      let best = null, bestDistance = Infinity;
      for (const container of containers) {
        if (!container.root?.visible) continue;
        const pos = container.root.getWorldPosition(new THREE.Vector3());
        const d = pos.distanceTo(playerWorld);
        if (d <= 4.6 && d < bestDistance) { best = container; bestDistance = d; }
      }
      return best;
    }

    function tryPlaceContainer() {
      if (uiState.equippedItemType !== 'container' || state.gameState !== 'playing' || state.paused || uiState.inventoryOpen || uiState.craftingOpen || uiState.furnaceOpen || uiState.containerOpen) return false;
      const placement = getActivePlaceablePlacement();
      if (!isFurnacePlacementAreaClear(placement.dir, placement.ctx.id)) {
        const prompt = document.getElementById('crystalPrompt');
        prompt.classList.remove('hidden'); prompt.innerHTML = '<span class="promptKey">BLOCKED</span> Find a clear area to place the container';
        return false;
      }
      const idx = getSelectedHotbarInventoryIndex();
      const currentSlot = inventorySlots[idx];
      if (!currentSlot || currentSlot.typeId !== 'container') return false;
      const container = createContainerObject(placement.dir, Math.random() * Math.PI * 2, placement.ctx.id);
      inventorySlots[idx] = null;
      refreshEquippedItem(); updateHotbarUI(); updateInventoryUI();
      const prompt = document.getElementById('crystalPrompt');
      prompt.classList.remove('hidden'); prompt.innerHTML = '<span class="promptKey">PLACED</span> Container placed';
      setTimeout(() => { if (state.gameState === 'playing') updateCrystalPrompt(); }, 700);
      return true;
    }

    function normalizeContainerSlot(slot) {
      if (!slot || !itemById[slot.typeId] || slot.typeId === 'container') return null;
      const item = itemById[slot.typeId];
      return {
        typeId: slot.typeId,
        count: Math.max(1, Math.min(item.maxStack, Math.floor(Number(slot.count) || 1))),
        ...(item.tool ? { durability: Math.max(0, Math.min(getToolMaxDurability(item), Number.isFinite(slot.durability) ? Math.floor(slot.durability) : getToolMaxDurability(item))) } : {})
      };
    }

    function renderContainerInventoryGrid(grid, sourceSlots, refFactory, extraClass = '') {
      if (!grid) return;
      grid.replaceChildren();
      for (let i = 0; i < sourceSlots.length; i++) {
        const data = sourceSlots[i];
        const slot = document.createElement('div');
        slot.className = 'inventorySlot ' + extraClass;
        const ref = refFactory(i);
        if (ref.type === 'inventory') slot.dataset.inventoryIndex = String(i);
        if (ref.type === 'container') { slot.dataset.containerId = ref.containerId; slot.dataset.containerIndex = String(i); }
        if (data) {
          slot.appendChild(makeItemIconElement(data.typeId, 'inventoryGem'));
          const count = document.createElement('div');
          count.className = 'inventoryStackCount'; count.textContent = data.count; slot.appendChild(count);
          slot.addEventListener('mouseenter', (event) => showInventoryTooltip(data, slot, event));
          slot.addEventListener('mousemove', (event) => positionInventoryTooltip(event.clientX, event.clientY));
          slot.addEventListener('mouseleave', hideInventoryTooltip);
        } else {
          const empty = document.createElement('div'); empty.className = 'inventoryEmptyLabel'; empty.textContent = 'EMPTY'; slot.appendChild(empty);
        }
        bindDragSlot(slot, ref);
        grid.appendChild(slot);
      }
    }

    function updateContainerUI() {
      if (!activeContainer) return;
      renderContainerInventoryGrid(
        document.getElementById('containerGrid'),
        activeContainer.inventory,
        i => ({ type: 'container', containerId: activeContainer.containerId, index: i }),
        'containerSlot'
      );
      renderContainerInventoryGrid(
        document.getElementById('containerPlayerInventoryGrid'),
        inventorySlots,
        i => ({ type: 'inventory', index: i }),
        'containerPlayerSlot'
      );
    }

    function openContainer(container) {
      if (!container || state.gameState !== 'playing' || playerState.inRocket || uiState.containerOpen) return false;
      activeContainer = container;
      uiState.containerOpen = true;
      state.paused = true;
      for (const k in systemState.keys) systemState.keys[k] = false;
      clearPhysicalKeys();
      updateContainerUI();
      const overlay = document.getElementById('containerOverlay');
      overlay.classList.remove('hidden'); overlay.setAttribute('aria-hidden', 'false');
      if (document.pointerLockElement === canvas) document.exitPointerLock();
      return true;
    }

    function closeContainer() {
      if (!uiState.containerOpen) return;
      uiState.containerOpen = false;
      activeContainer = null;
      const overlay = document.getElementById('containerOverlay');
      overlay.classList.add('hidden'); overlay.setAttribute('aria-hidden', 'true');
      if (state.gameState === 'playing') { state.paused = false; attemptPointerLock(); }
    }

    function createFurnaceObject(dir, yaw = Math.random() * Math.PI * 2, surfaceBodyId = 'ivis') {
      const ctx = getPlaceableSurfaceContext(surfaceBodyId);
      const group = createFurnaceVisual(1.05);
      const h = ctx.getHeight(dir);
      // The supplied Blockbench furnace sits about 2 world units too high in the
      // world model. Keep inventory/drop previews unchanged and lower only the
      // placed furnace along the surface normal so it sits correctly on the ground.
      group.position.copy(dir).multiplyScalar(ctx.radius + h + 0.32 - 1.0);
      group.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0), dir);
      group.rotateY(yaw);
      ctx.parent.add(group);
      const furnace = { root: group, direction: dir.clone(), yaw, surfaceBodyId: ctx.id, inventory: { fuel: null, input: null, output: null }, smeltStartedAt: 0 };
      furnaces.push(furnace);
      return furnace;
    }

    function createDrillObject(dir, yaw = Math.random() * Math.PI * 2, durability = 100, surfaceBodyId = 'ivis') {
      const ctx = getPlaceableSurfaceContext(surfaceBodyId);
      const group = createDrillVisual(1.0);
      const h = ctx.getHeight(dir);
      group.position.copy(dir).multiplyScalar(ctx.radius + h + 0.28);
      group.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
      group.rotateY(yaw);
      ctx.parent.add(group);
      const drill = { root: group, direction: dir.clone(), yaw, surfaceBodyId: ctx.id, durability: Math.max(0, Math.min(100, Number(durability) || 0)) };
      placedDrills.push(drill);
      return drill;
    }

    function findNearbyDrill() {
      const p = player.getWorldPosition(new THREE.Vector3());
      let best = null, bestDistance = Infinity;
      for (const drill of placedDrills) {
        if (!drill.root.visible) continue;
        const pos = drill.root.getWorldPosition(new THREE.Vector3());
        const d = p.distanceTo(pos);
        if (d <= 4.8 && d < bestDistance) { bestDistance = d; best = drill; }
      }
      return best;
    }

    function tryPlaceDrill() {
      if (uiState.equippedItemType !== 'drill' || state.gameState !== 'playing' || state.paused || uiState.inventoryOpen || uiState.craftingOpen || uiState.furnaceOpen) return false;
      const placement = getActivePlaceablePlacement();
      const dir = placement.dir;
      if (!isFurnacePlacementAreaClear(dir, placement.ctx.id)) {
        const prompt = document.getElementById('crystalPrompt');
        prompt.classList.remove('hidden'); prompt.innerHTML = '<span class="promptKey">BLOCKED</span> Find a clear area to place the drill';
        return false;
      }
      const current = getCurrentToolSlot();
      if (!current || current.item.id !== 'drill') return false;
      const drill = createDrillObject(dir, Math.random() * Math.PI * 2, current.slot.durability == null ? 100 : current.slot.durability, placement.ctx.id);
      inventorySlots[current.index] = null;
      refreshEquippedItem(); updateHotbarUI(); updateInventoryUI();
      const prompt = document.getElementById('crystalPrompt');
      prompt.classList.remove('hidden'); prompt.innerHTML = '<span class="promptKey">PLACED</span> Drill placed · Fuel ' + drill.durability + '%';
      setTimeout(() => { if (state.gameState === 'playing') updateCrystalPrompt(); }, 700);
      return true;
    }

    function startDrillRefueling() {
      if (economyState.drillRefueling || uiState.equippedItemType !== 'jerrycan') return false;
      const drill = findNearbyDrill();
      if (!drill || drill.durability >= 100) return false;
      economyState.drillRefueling = drill;
      economyState.drillRefuelingStartedAt = performance.now();
      const prompt = document.getElementById('crystalPrompt');
      prompt.classList.remove('hidden'); prompt.innerHTML = '<span class="promptKey">0%</span> Refueling drill…';
      return true;
    }

    function updateDrillRefueling() {
      const drill = economyState.drillRefueling;
      if (!drill) return;
      if (!drill.root.visible || uiState.equippedItemType !== 'jerrycan' || !isActionDown('interact')) {
        economyState.drillRefueling = null;
        economyState.drillRefuelingStartedAt = 0;
        return;
      }
      const p = player.getWorldPosition(new THREE.Vector3());
      const d = p.distanceTo(drill.root.getWorldPosition(new THREE.Vector3()));
      if (d > 6.0) {
        economyState.drillRefueling = null;
        economyState.drillRefuelingStartedAt = 0;
        return;
      }
      const elapsed = performance.now() - economyState.drillRefuelingStartedAt;
      const pct = Math.max(0, Math.min(100, elapsed / 3000 * 100));
      const prompt = document.getElementById('crystalPrompt');
      prompt.classList.remove('hidden'); prompt.innerHTML = '<span class="promptKey">' + Math.round(pct) + '%</span> Refueling drill…';
      if (elapsed < 3000) return;
      if (!removeItemsFromInventory('jerrycan', 1)) {
        economyState.drillRefueling = null; economyState.drillRefuelingStartedAt = 0;
        prompt.textContent = 'Refueling failed — no jerrycan found.';
        return;
      }
      drill.durability = 100;
      economyState.drillRefueling = null;
      economyState.drillRefuelingStartedAt = 0;
      updateHotbarUI(); updateInventoryUI();
      prompt.innerHTML = '<span class="promptKey">FUELED</span> Drill fuel: 100%';
      setTimeout(() => { if (state.gameState === 'playing') updateCrystalPrompt(); }, 900);
    }

    function pickupNearbyDrill() {
      if (state.gameState !== 'playing' || state.paused || uiState.inventoryOpen || uiState.craftingOpen || uiState.furnaceOpen) return false;
      const drill = findNearbyDrill();
      if (!drill) return false;
      if (!canAddItemToInventory('drill', 1)) {
        const prompt = document.getElementById('crystalPrompt'); prompt.classList.remove('hidden'); prompt.textContent = 'Inventory full — make room first';
        return true;
      }
      addItemToInventory('drill', 1, drill.durability, true);
      if (drill.root.parent) drill.root.parent.remove(drill.root);
      const idx = placedDrills.indexOf(drill); if (idx >= 0) placedDrills.splice(idx, 1);
      const prompt = document.getElementById('crystalPrompt'); prompt.classList.remove('hidden');
      prompt.innerHTML = '<span class="promptKey">PICKED UP</span> Drill · Fuel ' + drill.durability + '%';
      updateHotbarUI(); updateInventoryUI();
      setTimeout(() => { if (state.gameState === 'playing') updateCrystalPrompt(); }, 700);
      return true;
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

    function createUpgradedEngineVisual(scale = 1) {
      const group = new THREE.Group();
      const silver = new THREE.MeshStandardMaterial({ color: 0xb6c0c9, roughness: 0.28, metalness: 0.82 });
      const cyan = new THREE.MeshStandardMaterial({ color: 0x57d8ff, roughness: 0.28, metalness: 0.4, emissive: 0x15556b, emissiveIntensity: 0.55 });
      const dark = new THREE.MeshStandardMaterial({ color: 0x252b31, roughness: 0.62, metalness: 0.6 });
      const body = new THREE.Mesh(new THREE.CylinderGeometry(0.43, 0.58, 0.68, 14), silver);
      body.position.y = 0.38; group.add(body);
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.51, 0.075, 8, 20), cyan);
      ring.rotation.x = Math.PI / 2; ring.position.y = 0.38; group.add(ring);
      const nozzle = new THREE.Mesh(new THREE.ConeGeometry(0.30, 0.46, 14, 1, true), dark);
      nozzle.position.y = -0.13; group.add(nozzle);
      for (let i = 0; i < 6; i++) {
        const wire = new THREE.Mesh(new THREE.TorusGeometry(0.33, 0.028, 6, 16, Math.PI * 0.72), cyan);
        const a = i / 6 * Math.PI * 2;
        wire.rotation.y = a; wire.rotation.x = Math.PI / 2; wire.position.y = 0.36; group.add(wire);
      }
      // Mirror the finished scythe around its vertical axis so the crescent/blade points
      // outward from the handle in both first- and third-person views. Using a Y-axis
      // half-turn avoids negative scaling, which can invert extrusion winding/culling.
      group.rotation.y = Math.PI;
      group.scale.setScalar(scale);
      return group;
    }

    function removeEngineUpgradeVisual(rocket) {
      if (!rocket) return;
      for (const key of ['upgradedEngineVisual', 'engineMark3Visual']) {
        const node = rocket[key];
        if (node?.parent) node.parent.remove(node);
        rocket[key] = null;
      }
    }

    function addUpgradedEngineVisual(rocket) {
      if (!rocket || !rocket.root) return;
      removeEngineUpgradeVisual(rocket);
      const visual = createUpgradedEngineVisual(0.92);
      visual.position.set(0, -0.12, 0);
      rocket.root.add(visual);
      rocket.upgradedEngineVisual = visual;
    }

    function createEngineMark3Visual(scale = 0.92) {
      const visual = createUpgradedEngineVisual(scale);
      const titaniumMat = new THREE.MeshStandardMaterial({ color: 0xcfe8f5, roughness: 0.3, metalness: 0.9, emissive: 0x203843, emissiveIntensity: 0.25 });
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.38, 0.045, 8, 24), titaniumMat);
      ring.rotation.x = Math.PI / 2;
      ring.position.y = 0.38;
      visual.add(ring);
      return visual;
    }

    function addEngineMark3Visual(rocket) {
      if (!rocket || !rocket.root) return;
      removeEngineUpgradeVisual(rocket);
      const visual = createEngineMark3Visual(0.96);
      visual.position.set(0, -0.14, 0);
      rocket.root.add(visual);
      rocket.engineMark3Visual = visual;
    }

    function ensureRocketEngineVisual(rocket) {
      if (!rocket) return;
      removeEngineUpgradeVisual(rocket);
      if (rocket.engineType === 'upgraded') addUpgradedEngineVisual(rocket);
      else if (rocket.engineType === 'mark3') addEngineMark3Visual(rocket);
    }

    // Compact rocket icon/model used by inventory and dropped-item visuals.
    // Kept unchanged so the inventory appearance stays the same.
    function createRocketVisual(scale = 1) {
      if (rocketModelTemplate) {
        const actual = rocketModelTemplate.clone(true);
        actual.scale.setScalar(scale);
        return actual;
      }
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
      if (rocketModelTemplate) {
        const actual = rocketModelTemplate.clone(true);
        actual.scale.setScalar(scale);
        return actual;
      }
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

    function createLaunchPadObject(dir, yaw = Math.random() * Math.PI * 2, surfaceBodyId = 'ivis') {
      const ctx = getPlaceableSurfaceContext(surfaceBodyId);
      const group = createLaunchPadVisual(1.0);
      const h = ctx.getHeight(dir);
      group.position.copy(dir).multiplyScalar(ctx.radius + h + 0.08);
      group.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0), dir);
      group.rotateY(yaw);
      ctx.parent.add(group);
      const pad = { root: group, direction: dir.clone(), yaw, surfaceBodyId: ctx.id, rocket: null, fuel: 0, engineType: 'standard', warpDrive: false, warpDriveType: null };
      launchPads.push(pad);
      return pad;
    }

    function placeRocketOnLaunchPad(pad) {
      if (!pad || pad.rocket) return false;
      const root = createMountedRocketVisual(0.92);
      root.position.set(0, 0.18, 0);
      pad.root.add(root);
      pad.rocket = { root, pad, engineType: pad.engineType || 'standard', warpDrive: !!pad.warpDrive, warpDriveType: pad.warpDriveType || null };
      ensureRocketEngineVisual(pad.rocket);
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
      const placement = getActivePlaceablePlacement();
      const dir = placement.dir;
      if (!isFurnacePlacementAreaClear(dir, placement.ctx.id)) {
        const prompt = document.getElementById('crystalPrompt');
        prompt.classList.remove('hidden'); prompt.innerHTML = '<span class="promptKey">BLOCKED</span> Find a clear area to place the launch pad';
        return false;
      }
      const pad = createLaunchPadObject(dir, Math.random() * Math.PI * 2, placement.ctx.id);
      const idx = getSelectedHotbarInventoryIndex();
      if (!inventorySlots[idx] || inventorySlots[idx].typeId !== 'launch_pad') { pad.root.visible = false; launchPads.pop(); return false; }
      inventorySlots[idx] = null;
      refreshEquippedItem(); updateHotbarUI(); updateInventoryUI();
      const prompt = document.getElementById('crystalPrompt');
      awardAchievement('first_launch_pad');
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
          toolVisual = createAxeVisual(0.50, headType, item.id === 'axe');
        } else if (item.kind === 'pickaxe') {
          const headType = item.ironTool ? 'iron' : item.stoneTool ? 'stone' : 'wood';
          toolVisual = createPickaxeVisual(0.50, headType);
        } else if (item.kind === 'scythe') {
          const headType = item.ironTool ? 'iron' : item.stoneTool ? 'stone' : 'wood';
          toolVisual = createScytheVisual(0.50, headType);
        } else if (item.kind === 'drill') {
          toolVisual = createDrillVisual(0.50);
        }
        if (toolVisual) { toolVisual.rotation.z = 0.35; group.add(toolVisual); }
      } else if (typeId === 'furnace') {
        group.add(createFurnaceVisual(0.58));
      } else if (typeId === 'container') {
        group.add(createContainerVisual(0.62));
      } else if (typeId === 'rocket_engine') {
        group.add(createRocketEngineVisual(0.62));
      } else if (typeId === 'upgraded_engine') {
        group.add(createUpgradedEngineVisual(0.64));
      } else if (typeId === 'engine_mark_3') {
        group.add(createEngineMark3Visual(0.66));
      } else if (typeId === 'moon_quartz') {
        group.add(createMoonQuartzVisual(0.75));
      } else if (typeId === 'warp_drive' || typeId === 'warp_drive_mk2') {
        const isMk2 = typeId === 'warp_drive_mk2';
        const core = new THREE.Mesh(new THREE.SphereGeometry(0.24,12,10), new THREE.MeshStandardMaterial({color:isMk2?0xff88e8:0x4fc8ff,emissive:isMk2?0xb437a5:0x1a89bd,emissiveIntensity:1.2,metalness:.35,roughness:.28}));
        const ring = new THREE.Mesh(new THREE.TorusGeometry(0.32,0.055,8,20), new THREE.MeshStandardMaterial({color:isMk2?0xffc5f4:0x9eeaff,emissive:isMk2?0xd65dc4:0x2b8bb6,emissiveIntensity:.8,metalness:.6,roughness:.25}));
        ring.rotation.x=Math.PI/2; group.add(core,ring);
      } else if (typeId === 'iron_plate' || typeId === 'titanium_plate') {
        const mat = new THREE.MeshStandardMaterial({ color: typeId === 'iron_plate' ? 0x8f969c : 0xbfd0dc, roughness: 0.34, metalness: 0.82 });
        const plate = new THREE.Mesh(new THREE.BoxGeometry(0.48, 0.08, 0.30), mat);
        plate.rotation.set(0.18, 0.24, 0.10);
        group.add(plate);
      } else if (typeId === 'iron_wrench' || typeId === 'titanium_wrench') {
        group.add(createWrenchVisual(0.56, typeId === 'titanium_wrench' ? 'titanium' : 'iron'));
      } else if (typeId === 'rocket') {
        group.add(createRocketVisual(0.42));
      } else if (typeId === 'launch_pad') {
        group.add(createLaunchPadVisual(0.55));
      } else if (itemById[typeId]?.kind === 'blueprint') {
        group.add(createBlueprintVisual(0.56));
      } else if (typeId === 'container') {
        fpModel = createContainerVisual(0.78);
        tpModel = createContainerVisual(0.54);
      } else if (typeId === 'jerrycan') {
        group.add(createJerrycanVisual(0.72));
      } else if (item.kind === 'crystal' && crystalById[typeId]) {
        group.add(createCrystalVisual(typeId, false, 0.72));
      } else {
        let color = item.css || '#a0a5aa';
        let geo = new THREE.BoxGeometry(0.28, 0.20, 0.28);
        if (typeId === 'iron_ore' || typeId === 'copper_ore' || typeId === 'tungsten_ore' || typeId === 'stone') geo = new THREE.DodecahedronGeometry(0.22, 0);
        else if (typeId === 'planks') geo = new THREE.BoxGeometry(0.34, 0.16, 0.24);
        else if (typeId === 'sticks') geo = new THREE.CylinderGeometry(0.045, 0.045, 0.32, 8);
        else if (typeId === 'iron_ingot') { geo = new THREE.BoxGeometry(0.34, 0.11, 0.17); color = '#666c72'; }
        else if (typeId === 'copper_ingot') { geo = new THREE.BoxGeometry(0.34, 0.11, 0.17); color = '#c8753d'; }
        else if (typeId === 'tungsten_ingot') { geo = new THREE.BoxGeometry(0.34, 0.11, 0.17); color = '#5e5b58'; }
        else if (typeId === 'copper_wire') { geo = new THREE.TorusGeometry(0.11, 0.025, 6, 14); color = '#d47a3d'; }
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

    function isFurnacePlacementAreaClear(dir, surfaceBodyId = null) {
      const ctx = getPlaceableSurfaceContext(surfaceBodyId);
      const h = ctx.getHeight(dir);
      const localCandidate = dir.clone().multiplyScalar(ctx.radius + h);
      const candidateWorld = ctx.parent.localToWorld(localCandidate.clone());

      // Check every visible world obstacle by WORLD position. Objects on other bodies are
      // thousands of units away and therefore do not interfere with placement here.
      const checkRoot = (root, minDistance) => {
        if (!root || !root.visible) return false;
        return root.getWorldPosition(new THREE.Vector3()).distanceTo(candidateWorld) < minDistance;
      };
      for (const tree of treeSpawns) if (!tree.chopped && checkRoot(tree.root, 2.2)) return false;
      for (const rock of rockSpawns.concat(ironOreSpawns, moonTungstenSpawns, cordeliaTungstenSpawns, omegaTitaniumSpawns, cordeliaRockSpawns || [])) {
        if (!rock.mined && checkRoot(rock.root, 2.0)) return false;
      }
      for (const crystal of crystalSpawns.concat(auroraCrystalSpawns, moonQuartzSpawns)) {
        if (!crystal.collected && checkRoot(crystal.root, 1.6)) return false;
      }
      for (const furnace of furnaces) if (checkRoot(furnace.root, 2.2)) return false;
      for (const container of containers) if (checkRoot(container.root, 2.2)) return false;
      for (const drill of placedDrills) if (checkRoot(drill.root, 2.2)) return false;
      for (const pad of launchPads) if (checkRoot(pad.root, 4.4)) return false;
      return true;
    }

    function getFurnacePlacementDirection() {
      return getActivePlaceablePlacement().dir;
    }

    function tryPlaceFurnace() {
      if (uiState.equippedItemType !== 'furnace' || state.gameState !== 'playing' || state.paused || uiState.inventoryOpen || uiState.craftingOpen || uiState.furnaceOpen) return false;
      const placement = getActivePlaceablePlacement();
      const dir = placement.dir;
      if (!isFurnacePlacementAreaClear(dir, placement.ctx.id)) {
        const prompt = document.getElementById('crystalPrompt');
        prompt.classList.remove('hidden'); prompt.innerHTML = '<span class="promptKey">BLOCKED</span> Find a clear area to place the furnace';
        return false;
      }
      const furnace = createFurnaceObject(dir, Math.random() * Math.PI * 2, placement.ctx.id);
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

    function createTreeSapling(tree, treeIndex) {
      if (!tree || !tree.root) return null;

      let sapling = saplingSpawns.find(s => s.treeIndex === treeIndex);
      if (sapling) {
        sapling.active = true;
        sapling.plantedAtSpin = state.planetSpinAngle;
        sapling.root.visible = true;
        updateTreeSaplingVisual(sapling, 0);
        return sapling;
      }

      const root = new THREE.Group();
      root.name = 'TreeSapling';
      const trunk = new THREE.Mesh(treeTrunkGeo, treeTrunkMat);
      const leaves = new THREE.Mesh(treeLeafGeo, treeLeafMat);
      trunk.position.y = 0.7;
      leaves.position.y = 2.0;
      root.add(trunk);
      root.add(leaves);

      const dir = tree.direction.clone().normalize();
      const h = heightAt(dir);
      root.position.copy(dir).multiplyScalar(PLANET_RADIUS + h);
      root.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
      root.rotateY(tree.yaw);
      planetSystem.add(root);

      sapling = {
        root,
        treeIndex,
        direction: dir.clone(),
        size: tree.size,
        yaw: tree.yaw,
        plantedAtSpin: state.planetSpinAngle,
        active: true
      };
      saplingSpawns.push(sapling);
      updateTreeSaplingVisual(sapling, 0);
      return sapling;
    }

    function updateTreeSaplingVisual(sapling, progress) {
      if (!sapling || !sapling.root) return;
      const growth = 0.24 + 0.76 * THREE.MathUtils.clamp(progress, 0, 1);
      const trunk = sapling.root.children[0];
      const leaves = sapling.root.children[1];
      if (trunk) {
        trunk.scale.setScalar(sapling.size * growth);
        trunk.position.y = 0.7 * sapling.size * growth;
      }
      if (leaves) {
        leaves.scale.setScalar(sapling.size * growth);
        leaves.position.y = 2.0 * sapling.size * growth;
      }
      sapling.root.visible = !!sapling.active;
    }

    function updateTreeSaplings() {
      // Saplings only grow while the world is actively being played. Opening the main
      // menu or pausing the game must not consume their four in-game days.
      if (state.gameState !== 'playing' || state.paused) return;
      const growthSpin = Math.PI * 8; // 4 full in-game day/night cycles.
      for (const sapling of saplingSpawns) {
        if (!sapling.active) continue;
        const tree = treeSpawns[sapling.treeIndex];
        if (!tree) {
          sapling.active = false;
          sapling.root.visible = false;
          continue;
        }
        // Keep the sapling attached to the same surface point even if the world is reloaded.
        const dir = sapling.direction.clone().normalize();
        const h = heightAt(dir);
        sapling.root.position.copy(dir).multiplyScalar(PLANET_RADIUS + h);
        sapling.root.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
        sapling.root.rotateY(sapling.yaw);

        const progress = THREE.MathUtils.clamp((state.planetSpinAngle - sapling.plantedAtSpin) / growthSpin, 0, 1);
        if (progress >= 1) {
          // The sapling becomes the original tree again, preserving its saved size/orientation.
          tree.chopped = false;
          tree.root.visible = true;
          sapling.active = false;
          sapling.root.visible = false;
          updateTreeRootVisual(tree);
        } else {
          updateTreeSaplingVisual(sapling, progress);
        }
      }
    }

    function updateTreeRootVisual(tree) {
      if (!tree || !tree.root) return;
      if (tree.root.children[0]) {
        tree.root.children[0].scale.setScalar(tree.size);
        tree.root.children[0].position.y = 0.7 * tree.size;
      }
      if (tree.root.children[1]) {
        tree.root.children[1].scale.setScalar(tree.size);
        tree.root.children[1].position.y = 2.0 * tree.size;
      }
      const dir = tree.direction.clone().normalize();
      const h = heightAt(dir);
      tree.root.position.copy(dir).multiplyScalar(PLANET_RADIUS + h);
      tree.root.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
      tree.root.rotateY(tree.yaw);
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

    scatterTrees(520);
    scatterRocks(380);
    scatterIronOre(48);

    // ---------- meteor crash site ----------
    // One random impact site is generated for each new game. It is a large dark-grey
    // space rock surrounded by ten iron-rich and ten copper-rich ore chunks. The
    // ore chunks join the shared ore array so mining, saving, and the minimap all use
    // the same world-object system.
    let meteorCrashSite = null;

    function chooseMeteorDirection() {
      const spawnDir = new THREE.Vector3(0, 1, 0);
      for (let attempt = 0; attempt < 160; attempt++) {
        const dir = new THREE.Vector3(
          Math.random() * 2 - 1,
          Math.random() * 2 - 1,
          Math.random() * 2 - 1
        ).normalize();
        if (isWater(dir)) continue;
        if (dir.angleTo(spawnDir) < 0.65) continue;
        return dir;
      }
      return new THREE.Vector3(0, -1, 0);
    }

    function createMeteorCrashSite() {
      const dir = chooseMeteorDirection();
      const h = heightAt(dir);

      // Build a stable tangent basis around the meteor's surface direction so the
      // nearby ore chunks can be scattered around the site without relying on
      // undeclared vectors.
      const meteorNormal = dir.clone().normalize();
      const tangentA = new THREE.Vector3();
      const tangentB = new THREE.Vector3();
      const ref = Math.abs(meteorNormal.y) > 0.92
        ? new THREE.Vector3(1, 0, 0)
        : new THREE.Vector3(0, 1, 0);
      tangentA.crossVectors(ref, meteorNormal).normalize();
      tangentB.crossVectors(meteorNormal, tangentA).normalize();
      const root = new THREE.Group();
      root.name = 'MeteorCrashSite';

      // Big irregular dark-grey space rock.
      const meteor = new THREE.Mesh(
        new THREE.DodecahedronGeometry(8.0, 1),
        new THREE.MeshStandardMaterial({ color: 0x3d4146, roughness: 1.0, metalness: 0.08 })
      );
      meteor.scale.set(1.35, 0.88, 1.12);
      meteor.rotation.set(0.18, Math.random() * Math.PI * 2, -0.12);
      meteor.position.y = 4.8;
      root.add(meteor);

      // Add several recessed-looking impact holes so the meteor is more than a
      // plain ellipsoid. The dark inner surfaces sit slightly inside the rock and
      // are surrounded by a rough raised rim for a pitted, battered appearance.
      const craterMat = new THREE.MeshStandardMaterial({ color: 0x1b1d20, roughness: 1.0, metalness: 0.02 });
      const craterRimMat = new THREE.MeshStandardMaterial({ color: 0x30343a, roughness: 1.0, metalness: 0.04 });
      const craterSeeds = [
        { p: new THREE.Vector3( 3.2,  3.4,  4.3), r: 1.45 },
        { p: new THREE.Vector3(-4.4,  1.9,  2.6), r: 1.18 },
        { p: new THREE.Vector3( 1.7, -1.2,  5.9), r: 1.05 },
        { p: new THREE.Vector3(-2.8, -2.4, -4.2), r: 1.32 },
        { p: new THREE.Vector3( 4.6, -3.3, -1.9), r: 0.98 },
        { p: new THREE.Vector3(-0.8,  4.6, -3.2), r: 1.10 },
        { p: new THREE.Vector3( 0.4, -4.2,  2.0), r: 0.82 }
      ];
      for (const c of craterSeeds) {
        const n = c.p.clone().normalize();
        const inner = new THREE.Mesh(
          new THREE.CylinderGeometry(c.r * 0.64, c.r * 0.88, c.r * 0.20, 12),
          craterMat
        );
        inner.position.copy(c.p).sub(n.clone().multiplyScalar(c.r * 0.10));
        inner.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), n);
        meteor.add(inner);

        const rim = new THREE.Mesh(
          new THREE.TorusGeometry(c.r * 0.82, c.r * 0.13, 6, 12),
          craterRimMat
        );
        rim.position.copy(c.p).add(n.clone().multiplyScalar(c.r * 0.02));
        rim.quaternion.copy(inner.quaternion);
        meteor.add(rim);
      }

      root.position.copy(dir).multiplyScalar(PLANET_RADIUS + h + 0.2);
      root.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
      planetSystem.add(root);
      meteorCrashSite = { root, meteor, direction: dir.clone() };

      // Ten iron-rich and ten copper-rich ore chunks scattered around the crash site.
      const orePatchGeo = new THREE.DodecahedronGeometry(0.17, 0);
      const ironPatchMat = new THREE.MeshStandardMaterial({ color: 0x30343a, roughness: 1.0 });
      const copperPatchMats = [
        new THREE.MeshStandardMaterial({ color: 0xc86b32, roughness: 1.0 }),
        new THREE.MeshStandardMaterial({ color: 0x2fb9a7, roughness: 1.0 })
      ];

      for (let i = 0; i < 40; i++) {
        const angle = (i / 40) * Math.PI * 2 + (Math.random() - 0.5) * 0.24;
        const radial = 5.8 + Math.random() * 7.4;
        const oreDir = dir.clone()
          .addScaledVector(tangentA, Math.cos(angle) * radial / PLANET_RADIUS)
          .addScaledVector(tangentB, Math.sin(angle) * radial / PLANET_RADIUS)
          .normalize();
        const oreH = heightAt(oreDir);
        const oreType = i < 20 ? 'iron_ore' : 'copper_ore';

        const group = new THREE.Group();
        const base = new THREE.Mesh(
          propGeoRock,
          new THREE.MeshStandardMaterial({ color: 0x62676c, roughness: 1.0 })
        );
        group.add(base);

        for (let p = 0; p < 3; p++) {
          const patch = new THREE.Mesh(
            orePatchGeo,
            oreType === 'copper_ore' ? copperPatchMats[p % copperPatchMats.length] : ironPatchMat
          );
          patch.position.set(
            [-0.18, 0.20, 0.02][p],
            [0.16, 0.10, 0.25][p],
            [0.20, 0.12, -0.16][p]
          );
          patch.scale.setScalar(0.9 + Math.random() * 0.25);
          group.add(patch);
        }

        group.scale.setScalar(0.95 + Math.random() * 0.35);
        group.position.copy(oreDir).multiplyScalar(PLANET_RADIUS + oreH + 0.3);
        group.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), oreDir);
        group.rotateY(Math.random() * Math.PI * 2);
        group.name = oreType === 'copper_ore' ? 'MeteorCopperOre' : 'MeteorIronOre';
        planetSystem.add(group);
        ironOreSpawns.push({
          root: group,
          direction: oreDir.clone(),
          mined: false,
          oreType,
          meteorSite: true
        });
      }
    }

    createMeteorCrashSite();

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
      { id: "onyx",     name: "Onyx",     color: 0x17191d, css: "#17191d" }, // black
      { id: "rainbow_opal", name: "Rainbow Opal", color: 0xff7ee8, css: "linear-gradient(135deg,#ff5f6d 0%,#ffc371 22%,#8df7a1 43%,#59d8ff 64%,#8f7bff 82%,#ff6fd8 100%)" }
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
      { id: 'wooden_scythe', name: 'Wooden Scythe', kind: 'scythe', maxStack: 1, tool: true },
      { id: 'stone_scythe', name: 'Stone Scythe', kind: 'scythe', maxStack: 1, tool: true, stoneTool: true },
      { id: 'iron_scythe', name: 'Iron Scythe', kind: 'scythe', maxStack: 1, tool: true, ironTool: true },
      { id: 'copper_wire', name: 'Copper Wire', kind: 'copper_wire', css: '#d47a3d', maxStack: 10 },
      { id: 'moon_quartz', name: 'Moon Quartz', kind: 'moon_quartz', css: '#e9eef7', maxStack: 10 },
      { id: 'upgraded_engine', name: 'Engine Mark 2', kind: 'upgraded_engine', maxStack: 1 },
      { id: 'engine_mark_3', name: 'Engine Mark 3', kind: 'engine_mark_3', maxStack: 1 },
      { id: 'tungsten_ore', name: 'Tungsten Ore', kind: 'tungsten_ore', css: '#7c6c61', maxStack: 10 },
      { id: 'tungsten_ingot', name: 'Tungsten Ingot', kind: 'tungsten_ingot', css: '#5e5b58', maxStack: 10 },
      { id: 'titanium_ore', name: 'Titanium Ore', kind: 'titanium_ore', css: '#a7b9c8', maxStack: 10 },
      { id: 'titanium_ingot', name: 'Titanium Ingot', kind: 'titanium_ingot', css: '#c4d2dd', maxStack: 10 },
      { id: 'warp_drive', name: 'Warp Drive', kind: 'warp_drive', maxStack: 1 },
      { id: 'warp_drive_mk2', name: 'Warp Drive Mark 2', kind: 'warp_drive_mk2', maxStack: 1 },
      { id: 'drill', name: 'Drill', kind: 'drill', maxStack: 1, tool: true },
      { id: 'iron_plate', name: 'Iron Plate', kind: 'iron_plate', css: '#8d949b', maxStack: 10 },
      { id: 'titanium_plate', name: 'Titanium Plate', kind: 'titanium_plate', css: '#c7d8e5', maxStack: 10 },
      { id: 'iron_wrench', name: 'Iron Wrench', kind: 'wrench', wrenchTier: 'iron', maxStack: 1 },
      { id: 'titanium_wrench', name: 'Titanium Wrench', kind: 'wrench', wrenchTier: 'titanium', maxStack: 1 },
      { id: 'planks', name: 'Planks', kind: 'planks', css: '#c88748', maxStack: 10 },
      { id: 'sticks', name: 'Sticks', kind: 'sticks', css: '#b9824c', maxStack: 10 },
      { id: 'grass_fiber', name: 'Grass Fiber', kind: 'grass_fiber', css: '#79a95b', maxStack: 10 },
      { id: 'woven_grass_fiber', name: 'Woven Grass Fiber', kind: 'woven_grass_fiber', css: '#8b6d42', maxStack: 10 },
      { id: 'backpack', name: 'Backpack', kind: 'backpack', maxStack: 1 },
      { id: 'stone', name: 'Stone', kind: 'stone', css: '#8a929a', maxStack: 10 },
      { id: 'iron_ore', name: 'Iron Ore', kind: 'iron_ore', css: '#767a7f', maxStack: 10 },
      { id: 'copper_ore', name: 'Copper Ore', kind: 'copper_ore', css: '#c86b32', maxStack: 10 },
      { id: 'iron_ingot', name: 'Iron Ingot', kind: 'iron_ingot', css: '#5b6167', maxStack: 10 },
      { id: 'copper_ingot', name: 'Copper Ingot', kind: 'copper_ingot', css: '#c8753d', maxStack: 10 },
      { id: 'furnace', name: 'Furnace', kind: 'furnace', maxStack: 1 },
      { id: 'container', name: 'Container', kind: 'container', maxStack: 1 },
      { id: 'rocket_engine_blueprint', name: 'Engine Mark 1 Blueprint', kind: 'blueprint', blueprintFor: 'rocket_engine', maxStack: 1 },
      { id: 'upgraded_engine_blueprint', name: 'Engine Mark 2 Blueprint', kind: 'blueprint', blueprintFor: 'upgraded_engine', maxStack: 1 },
      { id: 'engine_mark_3_blueprint', name: 'Engine Mark 3 Blueprint', kind: 'blueprint', blueprintFor: 'engine_mark_3', maxStack: 1 },
      { id: 'warp_drive_blueprint', name: 'Warp Drive Mark 1 Blueprint', kind: 'blueprint', blueprintFor: 'warp_drive', maxStack: 1 },
      { id: 'warp_drive_mk2_blueprint', name: 'Warp Drive Mark 2 Blueprint', kind: 'blueprint', blueprintFor: 'warp_drive_mk2', maxStack: 1 },
      { id: 'rocket_blueprint', name: 'Rocket Blueprint', kind: 'blueprint', blueprintFor: 'rocket', maxStack: 1 },
      { id: 'rocket_engine', name: 'Rocket Engine', kind: 'engine', maxStack: 1 },
      { id: 'rocket', name: 'Rocket', kind: 'rocket', maxStack: 1 },
      { id: 'launch_pad', name: 'Launch Pad', kind: 'launch_pad', maxStack: 1 },
      { id: 'jerrycan', name: 'Jerrycan (Full)', kind: 'jerrycan', maxStack: 1 },
      { id: 'journal', name: 'Journal', kind: 'journal', maxStack: 1 }
    ];
    const itemById = Object.fromEntries(ITEM_TYPES.map(t => [t.id, t]));

    // ---------- in-game journal ----------
    // Journal discoveries are saved with each world. Items stay catalogued after being sold;
    // the journal is an encyclopedia of things the player has discovered, not a live inventory.
    const JOURNAL_ITEM_INFO = Object.freeze({
      journal: { description: 'A field journal containing your discoveries across Pocket Universe.', how: 'Given to every new explorer alongside the Starter Axe.', used: 'Open the journal to browse discovered items, celestial bodies, and people.' },
      axe: { description: 'A simple starter axe for your first days on Ivis.', how: 'Given when a new world is started.', used: 'Chops trees and can be used until its durability runs out.' },
      ruby: { description: 'A bright red crystal with a high natural shine.', how: 'Collect it from crystal spawns on Ivis and other worlds that contain crystals.', used: 'Can be sold to the merchant or used in rocket construction.' },
      topaz: { description: 'A warm orange crystal found around the world.', how: 'Collect it from crystal spawns.', used: 'Can be sold to the merchant.' },
      jasper: { description: 'A yellow-gold crystal with a soft glow.', how: 'Collect it from crystal spawns.', used: 'Can be sold to the merchant.' },
      emerald: { description: 'A vivid green crystal valued by the merchant.', how: 'Collect it from crystal spawns.', used: 'Can be sold to the merchant.' },
      diamond: { description: 'A pale blue crystal prized for its rarity.', how: 'Collect it from crystal spawns.', used: 'Can be sold to the merchant.' },
      lapis: { description: 'A deep blue crystal with a rich color.', how: 'Collect it from crystal spawns.', used: 'Can be sold to the merchant.' },
      amethyst: { description: 'A purple crystal with a distinctive glow.', how: 'Collect it from crystal spawns.', used: 'Can be sold to the merchant.' },
      onyx: { description: 'A very dark crystal that almost seems to absorb the light.', how: 'Collect it from crystal spawns.', used: 'Can be sold to the merchant.' },
      wooden_axe: { description: 'A basic crafted axe made from wood.', how: 'Craft it from early-game materials.', used: 'Chops trees more efficiently than the starter axe.' },
      wooden_pickaxe: { description: 'A simple wooden mining tool.', how: 'Craft it from wood and sticks.', used: 'Mines stone and basic resources.' },
      stone_axe: { description: 'A sturdier axe with a stone head.', how: 'Craft it after gathering stone.', used: 'Chops trees with better durability and speed.' },
      stone_pickaxe: { description: 'A stronger pickaxe for serious mining.', how: 'Craft it using stone and sticks.', used: 'Mines stone and ore, including iron and copper.' },
      iron_axe: { description: 'A durable axe forged from iron.', how: 'Craft it after obtaining iron ingots from a furnace.', used: 'Chops trees efficiently with high durability.' },
      iron_pickaxe: { description: 'A durable iron mining tool.', how: 'Craft it after obtaining iron ingots.', used: 'Mines stone, iron ore, and copper ore efficiently.' },
      wooden_scythe: { description: 'A curved wooden-handled harvesting tool.', how: 'Craft it from early-game materials.', used: 'Cuts grass and gathers plant resources.' },
      stone_scythe: { description: 'A sturdier scythe with a stone head.', how: 'Craft it using stone.', used: 'Cuts grass with increased durability.' },
      iron_scythe: { description: 'A durable iron-bladed scythe.', how: 'Craft it after obtaining iron ingots.', used: 'Cuts grass efficiently and lasts longer.' },
      copper_wire: { description: 'Several thin copper wires bundled together.', how: 'Craft wires from copper ingots.', used: 'A key component of Engine Mark 2.' },
      moon_quartz: { description: 'A pale mineral naturally found on the Moon.', how: 'Collect Moon Quartz from its lunar deposits.', used: 'Can be sold to the merchant and is required for Engine Mark 2.' },
      upgraded_engine: { description: 'Engine Mark 2 is an improved rocket engine with a larger fuel reserve.', how: 'Craft it from a Rocket Engine, Moon Quartz, and Copper Wires.', used: 'Install it into a rocket to increase fuel capacity to 200%.' },
      engine_mark_3: { description: 'A high-performance rocket engine for supersonic flight.', how: 'Craft it from Engine Mark 2, Titanium Ingots, Rainbow Opals, and Tungsten Ingots.', used: 'Install it into a rocket to unlock Supersonic speed at 200u/s, 1% fuel use per second, and a 300% fuel capacity.' },
      tungsten_ore: { description: 'A dense ore with dark orange and grey patches.', how: 'Mine the scarce deposits on the Moon or the common deposits on Cordelia with an Iron Pickaxe or Drill.', used: 'Smelt it in a furnace into Tungsten Ingots.' },
      tungsten_ingot: { description: 'A heavy, heat-resistant metal bar.', how: 'Smelt Tungsten Ore in a furnace.', used: 'Used with Iron Ingots and Amethyst to craft a Warp Drive.' },
      titanium_ore: { description: 'Extremely hard metal-bearing ore found inside giant Mileria deposits.', how: 'Mine a Titanium Deposit with an Iron Pickaxe or Drill.', used: 'Smelt it in a furnace to produce Titanium Ingots.' },
      titanium_ingot: { description: 'A very hard refined metal from Mileria.', how: 'Smelt Titanium Ore in a furnace.', used: 'A valuable high-tier material for future space technology.' },
      rainbow_opal: { description: 'A brilliant multicolored mineral unique to Aurora.', how: 'Collect Rainbow Opal deposits across Aurora.', used: 'A highly valuable mineral and future high-efficiency rocket fuel.' },
      warp_drive: { description: 'A compact drive that folds the distance between celestial bodies.', how: 'Craft it from 5 Tungsten Ingots, 3 Iron Ingots, and 1 Amethyst.', used: 'Install it as a ship upgrade to unlock the Space Map and long-distance warping.' },
      warp_drive_mk2: { description: 'An advanced warp drive using Rainbow Opal as its probabilistic fuel.', how: 'Craft it from a Warp Drive, Titanium Ingots, Tungsten Ingots, and a Rainbow Opal.', used: 'Cuts warp travel time to distance divided by 4000. Each warp requires a Rainbow Opal available in your inventory and has a 50% chance to consume it.' },
      drill: { description: 'A powered mining drill for tougher resource gathering.', how: 'Find and collect a placed or dropped Drill when available.', used: 'Mines rocks and ore quickly and can be used for resource gathering.' },
      planks: { description: 'Processed wooden boards used throughout early crafting.', how: 'Chop trees with an axe.', used: 'Used for tools, furnaces, fuel, and other crafting.' },
      sticks: { description: 'Small wooden sticks prepared for crafting.', how: 'Craft them from Planks.', used: 'Used in many tools and the Rocket Engine.' },
      grass_fiber: { description: 'Plant fibers gathered from the grasslands.', how: 'Harvest grass with a scythe.', used: 'Used in fiber-based crafting recipes.' },
      container: { description: 'A sturdy portable container with twenty independent item slots.', how: 'Craft it from six Iron Plates.', used: 'Place it on any landable celestial body and open it with Right Click to store items.' },
      woven_grass_fiber: { description: 'Grass fiber woven into a stronger material.', how: 'Craft it from Grass Fiber.', used: 'Used in more advanced crafting and utility items.' },
      backpack: { description: 'A wearable storage pack that gives you more room for supplies.', how: 'Craft or obtain a Backpack when its recipe becomes available.', used: 'Provides extra storage space for your adventure.' },
      stone: { description: 'Common rock collected from the surface and boulders.', how: 'Mine rocks and mountain stone with a pickaxe.', used: 'Used for tools, furnaces, and other crafting.' },
      iron_ore: { description: 'Dark ore chunks containing useful iron.', how: 'Mine iron-bearing boulders with a suitable pickaxe.', used: 'Smelt it in a furnace to make Iron Ingots.' },
      copper_ore: { description: 'Orange-brown ore containing copper.', how: 'Mine copper-bearing boulders with a suitable pickaxe.', used: 'Smelt it in a furnace to make Copper Ingots.' },
      iron_ingot: { description: 'Refined iron ready for stronger equipment.', how: 'Smelt Iron Ore in a furnace.', used: 'Used for iron tools, rocket parts, and advanced crafting.' },
      copper_ingot: { description: 'Refined copper used for electrical components.', how: 'Smelt Copper Ore in a furnace.', used: 'Used to craft Copper Wires and other advanced components.' },
      furnace: { description: 'A compact furnace for turning ore into useful ingots.', how: 'Craft it from stone and planks.', used: 'Smelts Iron Ore and Copper Ore using Planks as fuel.' },
      rocket_engine: { description: 'The standard engine that powers your first spacecraft.', how: 'Craft it from Iron Ingots, Sticks, and Stone.', used: 'Builds and powers a standard rocket.' },
      rocket: { description: 'A spacecraft built to leave a celestial body and enter space.', how: 'Craft it from a Rocket Engine, Iron Ingots, and Rubies.', used: 'Travel between Ivis, the Moon, Cordelia, and deep space.' },
      iron_plate: { description: 'A flat piece of refined iron used for sturdy tools and machinery.', how: 'Craft 2 Iron Plates from 1 Iron Ingot.', used: 'Used to craft the Iron Wrench.' },
      titanium_plate: { description: 'A strong lightweight plate made from refined titanium.', how: 'Craft 2 Titanium Plates from 1 Titanium Ingot.', used: 'Used to craft the Titanium Wrench.' },
      iron_wrench: { description: 'A reusable tool for installing standard rocket components.', how: 'Craft it from 1 Iron Ingot and 1 Iron Plate.', used: 'Required to install the standard Warp Drive and Engine Mark 2.' },
      titanium_wrench: { description: 'A reinforced wrench for advanced rocket technology.', how: 'Craft it from 1 Titanium Ingot and 1 Titanium Plate.', used: 'Required to install Warp Drive Mark 2 and Engine Mark 3.' },
      launch_pad: { description: 'A flat platform designed to hold a rocket during launch.', how: 'Craft it from Iron Ingots.', used: 'Provides the launch and landing point for a rocket.' },
      jerrycan: { description: 'A full can of rocket fuel for refilling a spacecraft.', how: 'Buy it from the merchant.', used: 'Adds fuel to a rocket; each can provides 100% of a tank refill.' },
      rocket_engine_blueprint: { description: 'A permanent construction blueprint for the standard rocket engine.', how: 'Buy it from Jaecob.', used: 'Unlocks the Rocket Engine recipe in the crafting menu. The blueprint is never consumed.' },
      upgraded_engine_blueprint: { description: 'A permanent construction blueprint for Engine Mark 2.', how: 'Buy it from Jaecob.', used: 'Unlocks the Engine Mark 2 recipe in the crafting menu. The blueprint is never consumed.' },
      engine_mark_3_blueprint: { description: 'A permanent construction blueprint for Engine Mark 3.', how: 'Buy it from Jaecob.', used: 'Unlocks the Engine Mark 3 recipe in the crafting menu. The blueprint is never consumed.' },
      warp_drive_blueprint: { description: 'A permanent construction blueprint for the standard Warp Drive.', how: 'Buy it from Jaecob.', used: 'Unlocks the Warp Drive recipe in the crafting menu. The blueprint is never consumed.' },
      warp_drive_mk2_blueprint: { description: 'A permanent construction blueprint for Warp Drive Mark 2.', how: 'Buy it from Jaecob.', used: 'Unlocks the Warp Drive Mark 2 recipe in the crafting menu. The blueprint is never consumed.' },
      rocket_blueprint: { description: 'A permanent construction blueprint for the Rocket.', how: 'Buy it from Jaecob.', used: 'Unlocks the Rocket recipe in the crafting menu. The blueprint is never consumed.' },
    });
    const JOURNAL_BODY_INFO = Object.freeze({
      ivis: { name: 'Ivis', description: 'Your home world: a small living planet with forests, mountains, a river, crystals, and the familiar merchant stall. It is the safest place to prepare for your next flight.' },
      moon: { name: 'Moon', description: 'A smaller, low-gravity celestial body reached by rocket. Moon Quartz can be found here, making lunar trips valuable for advanced rocket upgrades.' },
      cordelia: { name: 'Cordelia', description: 'A distant alien world with a sandy environment, its own day/night cycle, and a separate launch and landing experience.' },
      syspo: { name: 'Syspo', description: 'A colossal blue-purple gas giant. It has three visible cloud layers, an enormous gravity well, and two moons: Aurora and Mileria. Its core is too dangerous to approach.' },
      aurora: { name: 'Aurora', description: 'A lush green habitable moon of Syspo with dense forest clumps, multiple lakes, mountains, ground lotuses, and Rainbow Opal deposits.' },
      mileria: { name: 'Mileria', description: 'A grey rocky moon of Syspo with rugged mountains, 0.75x Ivis gravity, and large Titanium deposits containing Titanium Ore.' },
    });
    const JOURNAL_PERSON_INFO = Object.freeze({
      jaecob: { name: 'Jaecob', role: 'The shopkeeper of the crystal stall. He buys your items and sells selected supplies, including rocket-related essentials.', connections: 'Friends with Helna.' },
      helna: { name: 'Helna', role: 'The hat lady at the orange-striped customization stall. She offers character colors and hats for Gems.', connections: 'Friends with Jaecob.' },
    });
    let journalDiscoveredItems = new Set(['journal', 'axe']);
    let journalVisitedBodies = new Set(['ivis']);
    let journalMetPeople = new Set();

    function journalSafeIds(value, allowed) {
      return new Set(Array.isArray(value) ? value.filter(id => allowed.has(id)) : []);
    }
    function markJournalItemDiscovered(typeId, saveNow = true) {
      if (!itemById[typeId] || journalDiscoveredItems.has(typeId)) return false;
      journalDiscoveredItems.add(typeId);
      if (saveNow) persistLocalBackup();
      return true;
    }
    function markJournalBodyVisited(bodyId, saveNow = true) {
      if (!JOURNAL_BODY_INFO[bodyId] || journalVisitedBodies.has(bodyId)) return false;
      journalVisitedBodies.add(bodyId);
      if (saveNow) persistLocalBackup();
      return true;
    }
    function markJournalPersonMet(personId, saveNow = true) {
      if (!JOURNAL_PERSON_INFO[personId] || journalMetPeople.has(personId)) return false;
      journalMetPeople.add(personId);
      if (saveNow) persistLocalBackup();
      return true;
    }

    const journalOverlay = document.getElementById('journalOverlay');
    const journalPanel = document.getElementById('journalPanel');
    const journalClose = document.getElementById('journalClose');
    const journalTabs = document.getElementById('journalTabs');
    const journalList = document.getElementById('journalList');
    let journalOpen = false;
    let journalSection = 'items';
    let journalReturnToInventory = false;

    function journalItemCard(typeId) {
      const item = itemById[typeId];
      const info = JOURNAL_ITEM_INFO[typeId];
      if (!item || !info) return null;
      const card = document.createElement('article');
      card.className = 'journalEntry';
      const icon = makeItemIconElement(typeId, 'journalEntryIcon');
      const body = document.createElement('div');
      body.className = 'journalEntryBody';
      const title = document.createElement('div'); title.className = 'journalEntryTitle'; title.textContent = item.name;
      const desc = document.createElement('p'); desc.textContent = info.description;
      const how = document.createElement('p'); how.innerHTML = '<strong>HOW TO GET:</strong> ' + info.how;
      const used = document.createElement('p'); used.innerHTML = '<strong>USED FOR:</strong> ' + info.used;
      body.append(title, desc, how, used);
      card.append(icon, body);
      return card;
    }
    function journalBodyCard(bodyId) {
      const info = JOURNAL_BODY_INFO[bodyId];
      if (!info) return null;
      const card = document.createElement('article'); card.className = 'journalEntry';
      const icon = document.createElement('div'); icon.className = 'journalBodyIcon'; icon.textContent = bodyId === 'moon' ? '☾' : (bodyId === 'cordelia' ? '◉' : (bodyId === 'syspo' ? '🪐' : (bodyId === 'aurora' ? '🌿' : (bodyId === 'mileria' ? '🪨' : '●'))));
      const body = document.createElement('div'); body.className = 'journalEntryBody';
      const title = document.createElement('div'); title.className = 'journalEntryTitle'; title.textContent = info.name;
      const desc = document.createElement('p'); desc.textContent = info.description;
      body.append(title, desc); card.append(icon, body); return card;
    }
    function journalPersonCard(personId) {
      const info = JOURNAL_PERSON_INFO[personId];
      if (!info) return null;
      const card = document.createElement('article'); card.className = 'journalEntry';
      const icon = document.createElement('div'); icon.className = 'journalPersonIcon'; icon.textContent = personId === 'helna' ? 'H' : 'J';
      const body = document.createElement('div'); body.className = 'journalEntryBody';
      const title = document.createElement('div'); title.className = 'journalEntryTitle'; title.textContent = info.name;
      const role = document.createElement('p'); role.innerHTML = '<strong>WHAT THEY DO:</strong> ' + info.role;
      const connections = document.createElement('p'); connections.innerHTML = '<strong>CONNECTIONS:</strong> ' + info.connections;
      body.append(title, role, connections); card.append(icon, body); return card;
    }
    function renderJournal() {
      if (!journalList) return;
      journalTabs.querySelectorAll('button').forEach(btn => btn.classList.toggle('active', btn.dataset.section === journalSection));
      journalList.replaceChildren();
      const heading = document.createElement('div'); heading.className = 'journalSectionHeading';
      const empty = document.createElement('div'); empty.className = 'journalEmpty';
      if (journalSection === 'items') {
        heading.textContent = 'ITEM DISCOVERIES';
        const ids = ITEM_TYPES.map(item => item.id).filter(id => journalDiscoveredItems.has(id));
        journalList.appendChild(heading);
        if (!ids.length) { empty.textContent = 'No items discovered yet.'; journalList.appendChild(empty); }
        else ids.forEach(id => { const card = journalItemCard(id); if (card) journalList.appendChild(card); });
      } else if (journalSection === 'bodies') {
        heading.textContent = 'CELESTIAL BODIES';
        journalList.appendChild(heading);
        const ids = ['ivis','moon','cordelia','syspo','aurora','mileria'].filter(id => journalVisitedBodies.has(id));
        if (!ids.length) { empty.textContent = 'No celestial bodies discovered yet.'; journalList.appendChild(empty); }
        else ids.forEach(id => { const card = journalBodyCard(id); if (card) journalList.appendChild(card); });
      } else {
        heading.textContent = 'PEOPLE';
        journalList.appendChild(heading);
        const ids = ['jaecob','helna'].filter(id => journalMetPeople.has(id));
        if (!ids.length) { empty.textContent = 'No people have been added to your journal yet.'; journalList.appendChild(empty); }
        else ids.forEach(id => { const card = journalPersonCard(id); if (card) journalList.appendChild(card); });
      }
    }
    function openJournal(fromInventory = false) {
      if (state.gameState !== 'playing' || playerState.inRocket) return false;
      journalOpen = true;
      journalReturnToInventory = !!fromInventory;
      state.paused = true;
      if (document.pointerLockElement === canvas) document.exitPointerLock();
      for (const k in systemState.keys) systemState.keys[k] = false;
      clearPhysicalKeys();
      renderJournal();
      journalOverlay.classList.remove('hidden');
      journalOverlay.setAttribute('aria-hidden', 'false');
      if (!fromInventory) document.getElementById('inventoryOverlay').classList.add('hidden');
      return true;
    }
    function closeJournal() {
      if (!journalOpen) return;
      journalOpen = false;
      journalOverlay.classList.add('hidden');
      journalOverlay.setAttribute('aria-hidden', 'true');
      if (!journalReturnToInventory) {
        if (state.gameState === 'playing') { state.paused = false; attemptPointerLock(); }
      } else {
        journalReturnToInventory = false;
      }
    }
    journalClose.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); closeJournal(); });
    journalPanel.addEventListener('click', e => e.stopPropagation());
    journalOverlay.addEventListener('click', e => { if (e.target === journalOverlay) closeJournal(); });
    journalTabs.querySelectorAll('button').forEach(btn => btn.addEventListener('click', (e) => { e.stopPropagation(); journalSection = btn.dataset.section; renderJournal(); }));
    document.addEventListener('keydown', (e) => { if (journalOpen && e.key === 'Escape') { e.preventDefault(); closeJournal(); } });
    document.addEventListener('contextmenu', (e) => { if (journalOpen) { e.preventDefault(); e.stopPropagation(); } }, true);
    const SELL_PRICES = Object.freeze({
      ruby: 50, topaz: 40, jasper: 38, emerald: 65, diamond: 150, lapis: 55, amethyst: 85, onyx: 120,
      axe: 20, wooden_axe: 35, wooden_pickaxe: 35, stone_axe: 55, stone_pickaxe: 55, iron_axe: 100, iron_pickaxe: 115, wooden_scythe: 35, stone_scythe: 55, iron_scythe: 100, copper_wire: 8, moon_quartz: 500, drill: 180,
      planks: 3, sticks: 2, stone: 2, iron_ore: 12, copper_ore: 14, tungsten_ore: 85, iron_ingot: 30, copper_ingot: 36, tungsten_ingot: 220, titanium_ore: 135, titanium_ingot: 360, rainbow_opal: 1200, furnace: 75, rocket_engine: 220, rocket: 500, launch_pad: 150, jerrycan: 80, warp_drive: 0
    });
    const BUY_PRICES = Object.freeze({
      ruby: 100, topaz: 80, jasper: 76, emerald: 130, diamond: 300, lapis: 110, amethyst: 170, onyx: 240,
      rocket_engine: 600, launch_pad: 400, jerrycan: 250
    });

    const ROCKET_FUEL_CAPACITY = 100;
    const ENGINE_MARK_2_FUEL_CAPACITY = 200;
    const ENGINE_MARK_3_FUEL_CAPACITY = 300;
    const ROCKET_FUEL_REFILL_AMOUNT_STANDARD = 100;
    const ROCKET_FUEL_REFILL_AMOUNT_UPGRADED = 100;
    const ROCKET_FUEL_TIME_MS = 5000;
    function getRocketFuelCapacity(pad) {
      if (!pad) return ROCKET_FUEL_CAPACITY;
      if (pad.engineType === 'mark3') return ENGINE_MARK_3_FUEL_CAPACITY;
      if (pad.engineType === 'upgraded') return ENGINE_MARK_2_FUEL_CAPACITY;
      return ROCKET_FUEL_CAPACITY;
    }
    function getRocketFuelPercent(pad) {
      const cap = getRocketFuelCapacity(pad);
      return cap > 0 ? Math.max(0, Math.min(cap, Number(pad?.fuel) || 0)) : 0;
    }
    economyState.drillRefueling = null;
    economyState.drillRefuelingStartedAt = 0;
    const ROCKET_ATMOSPHERE_RADIUS = 600;

    const ROCKET_ATMOSPHERE_FADE_START = 360;


    const ROCKET_FLIGHT_SPEED = 28;
    const ROCKET_VERTICAL_SPEED = 24;
    const ROCKET_GRAVITY = GRAVITY;


    function getToolMaxDurability(itemOrTypeId) {
      const item = typeof itemOrTypeId === 'string' ? itemById[itemOrTypeId] : itemOrTypeId;
      if (item && item.id === 'drill') return 100;
      if (item && item.ironTool) return IRON_TOOL_MAX_DURABILITY;
      return item && item.stoneTool ? STONE_TOOL_MAX_DURABILITY : TOOL_MAX_DURABILITY;
    }

    // One reusable faceted shard geometry is enough because the color communicates which
    // crystal it is. A tiny three-shard cluster makes each collectible read as a crystal.
    const crystalShardGeo = new THREE.OctahedronGeometry(0.28, 0);
    const crystalGhostGeo = new THREE.OctahedronGeometry(0.31, 0);

    // Build the visible model used both for world crystals and for the held item model.
    // `ghost` switches the material to a faint wireframe silhouette for collected crystals.
    function createMoonQuartzVisual(scale = 1, ghost = false) {
      const group = new THREE.Group();
      const pale = ghost
        ? new THREE.MeshBasicMaterial({ color: 0xe9eef7, wireframe: true, transparent: true, opacity: 0.26, depthWrite: false, depthTest: true })
        : new THREE.MeshStandardMaterial({ color: 0xe9eef7, roughness: 0.22, metalness: 0.08, emissive: 0x6f7b91, emissiveIntensity: 0.18 });
      const glow = new THREE.MeshBasicMaterial({ color: 0xdfe9ff, transparent: true, opacity: ghost ? 0.10 : 0.18, depthWrite: false });
      const main = new THREE.Mesh(new THREE.OctahedronGeometry(0.34, 0), pale);
      main.scale.set(0.85, 1.55, 0.85); main.position.y = 0.42; group.add(main);
      const side = new THREE.Mesh(new THREE.OctahedronGeometry(0.23, 0), pale.clone ? pale.clone() : pale);
      side.scale.set(0.72, 1.12, 0.72); side.position.set(0.22, 0.29, 0.04); side.rotation.z = 0.33; group.add(side);
      const aura = new THREE.Mesh(new THREE.SphereGeometry(0.58, 12, 10), glow);
      aura.position.y = 0.36; group.add(aura);
      group.scale.setScalar(scale);
      return group;
    }

    function createCrystalVisual(typeId, ghost = false, scale = 1) {
      const data = crystalById[typeId];
      const group = new THREE.Group();
      if (typeId === 'rainbow_opal') {
        const rainbowColors = [0xff5f6d, 0xffc371, 0x8df7a1, 0x59d8ff, 0x8f7bff, 0xff6fd8];
        for (let i = 0; i < 6; i++) {
          const mat = ghost
            ? new THREE.MeshBasicMaterial({ color: 0xffffff, wireframe: true, transparent: true, opacity: 0.22, depthWrite: false, depthTest: true })
            : new THREE.MeshStandardMaterial({ color: rainbowColors[i], roughness: 0.22, metalness: 0.22, emissive: rainbowColors[i], emissiveIntensity: 0.13 });
          const shard = new THREE.Mesh(ghost ? crystalGhostGeo : crystalShardGeo, mat);
          shard.scale.set(0.62 + (i % 3) * 0.10, 1.18 + (i % 2) * 0.28, 0.62 + (i % 3) * 0.10);
          const a = i / 6 * Math.PI * 2;
          shard.position.set(Math.cos(a) * 0.18, 0.34 + (i % 2) * 0.12, Math.sin(a) * 0.18);
          shard.rotation.y = a;
          group.add(shard);
        }
        const aura = new THREE.Mesh(new THREE.SphereGeometry(0.64, 12, 10), new THREE.MeshBasicMaterial({ color: 0xff9fe9, transparent: true, opacity: ghost ? 0.07 : 0.20, depthWrite: false }));
        aura.position.y = 0.36;
        group.add(aura);
        group.scale.setScalar(scale);
        return group;
      }
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

    // Build Cordelia's surface detail only after the crystal visual factory exists.
    const cordelia = createCordelia();
    scatterCordeliaCacti();
    scatterCordeliaBoulders();

    function spawnCordeliaTungsten(dir, scale=.95) {
      const root=createTungstenOreVisual(scale); placeCordeliaProp(root,dir,.10); cordeliaMesh.add(root);
      cordeliaTungstenSpawns.push({root,direction:dir.clone(),mined:false,oreType:'tungsten_ore'});
    }
    function scatterCordeliaTungsten(count=100) {
      for (let i=0;i<count;i++) { const dir=new THREE.Vector3(Math.random()-.5,Math.random()-.5,Math.random()-.5).normalize(); spawnCordeliaTungsten(dir,.72+Math.random()*.5); }
    }
    scatterCordeliaTungsten(100);
    scatterCordeliaCrystals();
    scene.add(cordeliaMesh);

    // ---------- crystal merchant stall ----------
    // A permanent decorative market stall sits a short distance from the player's spawn.
    // It is part of the rotating planetSystem, so the same stall is visible in both the
    // playable world and the main-menu planet preview.
    function createStallCrate(filledTypeId = null, visualKind = 'crystal') {
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

      const braceFront = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.62, 0.06), woodDark);
      braceFront.position.set(0, 0.40, -0.47);
      braceFront.rotation.z = 0.18;
      crate.add(braceFront);
      const braceFront2 = braceFront.clone();
      braceFront2.rotation.z = -0.18;
      crate.add(braceFront2);

      if (visualKind === 'crystal' && filledTypeId) {
        const crystal = createCrystalVisual(filledTypeId, false, 0.58);
        crystal.position.y = 0.72;
        crystal.rotation.y = Math.random() * Math.PI * 2;
        crate.add(crystal);
      } else if (visualKind === 'hat' && filledTypeId) {
        const hat = createHatVisual(filledTypeId);
        hat.position.y = 0.70;
        hat.rotation.y = Math.random() * Math.PI * 2;
        hat.scale.setScalar(0.82);
        crate.add(hat);
      }

      return crate;
    }

    function createHatVisual(typeId, accentHex = null) {
      const hat = new THREE.Group();
      const black = new THREE.MeshStandardMaterial({ color: 0x101217, roughness: 0.9 });
      const dark = new THREE.MeshStandardMaterial({ color: 0x252932, roughness: 0.86 });
      const banana = new THREE.MeshStandardMaterial({ color: 0xf5d22f, roughness: 0.82 });
      const bananaDark = new THREE.MeshStandardMaterial({ color: 0x8c6f11, roughness: 0.9 });
      const colored = new THREE.MeshStandardMaterial({ color: accentHex == null ? 0x2e6fc0 : accentHex, roughness: 0.82 });
      colored.userData.cosmeticRainbowPart = true;
      const white = new THREE.MeshStandardMaterial({ color: 0xe9edf3, roughness: 0.86 });

      const makeBrim = (mat, radius = 0.46, depth = 0.08) => {
        const brim = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius * 1.08, depth, 20), mat);
        brim.position.y = 0.02;
        return brim;
      };

      if (typeId === 'banana_skin_hat') {
        // A connected banana-peel hat: three chunky curved peels share a small cap
        // underneath, so the dark ends are attached instead of floating as rings.
        const bananaMat = banana;
        const darkMat = bananaDark;
        const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.33, 0.37, 0.16, 16), darkMat);
        cap.position.y = 0.02;
        hat.add(cap);

        const bananaCurves = [
          [new THREE.Vector3(-0.23,0.07,0.02), new THREE.Vector3(-0.38,0.28,0.02), new THREE.Vector3(-0.24,0.53,0.02), new THREE.Vector3(-0.05,0.58,0.02)],
          [new THREE.Vector3(0.00,0.06,0.02), new THREE.Vector3(-0.02,0.32,0.02), new THREE.Vector3(0.10,0.56,0.02), new THREE.Vector3(0.24,0.63,0.02)],
          [new THREE.Vector3(0.23,0.07,0.02), new THREE.Vector3(0.38,0.28,0.02), new THREE.Vector3(0.32,0.50,0.02), new THREE.Vector3(0.16,0.68,0.02)]
        ];
        bananaCurves.forEach((pts, idx) => {
          const curve = new THREE.CatmullRomCurve3(pts);
          const peel = new THREE.Mesh(new THREE.TubeGeometry(curve, 12, 0.105, 8, false), bananaMat);
          peel.rotation.y = (idx - 1) * 0.10;
          hat.add(peel);

          const end = pts[pts.length - 1].clone();
          const tip = new THREE.Mesh(new THREE.SphereGeometry(0.12, 10, 8), darkMat);
          tip.position.copy(end);
          hat.add(tip);
        });
      } else if (typeId === 'fedora_hat') {
        hat.add(makeBrim(accentHex == null ? black : colored, 0.48, 0.08));
        const crown = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.39, 0.46, 18), accentHex == null ? black : colored);
        crown.position.y = 0.27;
        hat.add(crown);
        const band = new THREE.Mesh(new THREE.CylinderGeometry(0.355, 0.355, 0.075, 18), dark);
        band.position.y = 0.18;
        hat.add(band);
      } else if (typeId === 'top_hat') {
        hat.add(makeBrim(black, 0.50, 0.08));
        const crown = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.35, 0.68, 18), black);
        crown.position.y = 0.40;
        hat.add(crown);
        const band = new THREE.Mesh(new THREE.CylinderGeometry(0.325, 0.325, 0.09, 18), dark);
        band.position.y = 0.18;
        hat.add(band);
      } else if (typeId === 'wizard_hat_blue' || typeId === 'wizard_hat_red') {
        // Extra-long, floppy wizard hat inspired by the supplied reference: wide brim,
        // tall tapered cone and a dramatically bent, drooping tip. Two fixed colors exist.
        const wizardColor = typeId === 'wizard_hat_red' ? 0xb7353d : 0x2f57b7;
        const wizardMat = new THREE.MeshStandardMaterial({ color: wizardColor, roughness: 0.88 });
        const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.64, 0.72, 0.10, 24), wizardMat);
        brim.scale.z = 0.86;
        brim.position.y = 0.03;
        hat.add(brim);

        // Build the body from connected tapered sections along a curved centerline.
        const pts = [
          new THREE.Vector3(0.00, 0.08, 0.00),
          new THREE.Vector3(0.00, 0.40, 0.00),
          new THREE.Vector3(0.03, 0.72, 0.00),
          new THREE.Vector3(0.12, 1.04, 0.00),
          new THREE.Vector3(0.28, 1.32, 0.00),
          new THREE.Vector3(0.52, 1.50, 0.00),
          new THREE.Vector3(0.82, 1.54, 0.00),
          new THREE.Vector3(1.07, 1.45, 0.00)
        ];
        const radii = [0.46,0.42,0.37,0.31,0.24,0.15,0.085,0.028];
        for (let i = 0; i < pts.length - 1; i++) {
          const a = pts[i], b = pts[i + 1];
          const mid = a.clone().add(b).multiplyScalar(0.5);
          const dir = b.clone().sub(a);
          const len = dir.length();
          const seg = new THREE.Mesh(new THREE.CylinderGeometry(radii[i + 1], radii[i], len, 18), wizardMat);
          seg.position.copy(mid);
          seg.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
          hat.add(seg);
        }
        // Soft droop at the very end makes the silhouette read like cloth rather than a rigid cone.
        const tip = new THREE.Mesh(new THREE.SphereGeometry(0.045, 10, 8), wizardMat);
        tip.position.copy(pts[pts.length - 1]);
        tip.scale.set(1.35, 0.8, 1.0);
        hat.add(tip);
      } else if (typeId === 'baseball_hat') {
        // Baseball cap: shallow rounded crown, small top button, and a broad curved visor
        // projecting forward. The shape is intentionally simple/low-poly to fit the rest
        // of the game's cosmetic models while reading clearly as a normal cap.
        const cap = new THREE.Mesh(
          new THREE.SphereGeometry(0.47, 22, 12, 0, Math.PI * 2, 0, Math.PI * 0.50),
          colored
        );
        cap.scale.set(1.00, 0.76, 0.96);
        cap.position.set(0, 0.17, 0.01);
        hat.add(cap);

        const button = new THREE.Mesh(new THREE.SphereGeometry(0.055, 10, 8), colored);
        button.position.set(0, 0.53, 0.01);
        hat.add(button);

        // Custom flat visor silhouette, slightly wider than the crown and curved at its tip.
        const visorShape = new THREE.Shape();
        visorShape.moveTo(-0.37, 0.035);
        visorShape.bezierCurveTo(-0.22, 0.005, 0.22, 0.005, 0.37, 0.035);
        visorShape.bezierCurveTo(0.32, -0.075, 0.16, -0.145, 0.00, -0.155);
        visorShape.bezierCurveTo(-0.16, -0.145, -0.32, -0.075, -0.37, 0.035);
        const visor = new THREE.Mesh(
          new THREE.ExtrudeGeometry(visorShape, { depth: 0.055, bevelEnabled: false, curveSegments: 3, steps: 1 }),
          colored
        );
        visor.rotation.x = Math.PI / 2;
        visor.position.set(0, 0.075, -0.39);
        visor.scale.set(1.02, 1.0, 1.0);
        hat.add(visor);
      }

      hat.userData.cosmeticHatVisual = true;
      return hat;
    }

    function addStallSign(stall, label, accentHex, signMatHex) {
      const sign = new THREE.Mesh(new THREE.BoxGeometry(3.1, 0.78, 0.12), new THREE.MeshStandardMaterial({ color: signMatHex, roughness: 0.92 }));
      sign.position.set(0, 2.20, -1.73);
      stall.add(sign);

      const signTextureCanvas = document.createElement('canvas');
      signTextureCanvas.width = 512;
      signTextureCanvas.height = 128;
      const ctx = signTextureCanvas.getContext('2d');
      ctx.fillStyle = '#' + signMatHex.toString(16).padStart(6, '0');
      ctx.fillRect(0, 0, 512, 128);
      ctx.fillStyle = '#f4ead8';
      ctx.font = 'bold 48px Segoe UI, Arial, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(label, 256, 64);
      const signTexture = new THREE.CanvasTexture(signTextureCanvas);
      signTexture.anisotropy = renderer.capabilities.getMaxAnisotropy();
      const signFace = new THREE.Mesh(
        new THREE.PlaneGeometry(2.95, 0.74),
        new THREE.MeshStandardMaterial({ map: signTexture, roughness: 0.85 })
      );
      signFace.position.set(0, 2.20, -1.795);
      stall.add(signFace);
      return sign;
    }

    function createCrystalStall() {
      const stall = new THREE.Group();
      stall.name = 'CrystalMerchantStall';
      stall.userData.collision = { halfX: 4.62, halfZ: 1.82, padding: 0.48 };

      const wood = new THREE.MeshStandardMaterial({ color: 0x8a5632, roughness: 0.9 });
      const woodLight = new THREE.MeshStandardMaterial({ color: 0xb97b45, roughness: 0.88 });
      const clothLight = new THREE.MeshStandardMaterial({ color: 0xf0dfbd, roughness: 0.95 });
      const clothDark = new THREE.MeshStandardMaterial({ color: 0x2f78b7, roughness: 0.92 });
      const signMatHex = 0x6f4527;
      const black = new THREE.MeshStandardMaterial({ color: 0x090a0d, roughness: 0.92 });

      const postGeo = new THREE.CylinderGeometry(0.11, 0.13, 3.15, 8);
      const postPositions = [[-4.35,1.58,-1.55],[4.35,1.58,-1.55],[-4.35,1.58,1.55],[4.35,1.58,1.55]];
      for (const [x,y,z] of postPositions) { const post = new THREE.Mesh(postGeo, wood); post.position.set(x,y,z); stall.add(post); }
      const topBeam = new THREE.Mesh(new THREE.BoxGeometry(9.05,0.22,3.35), wood); topBeam.position.y=3.03; stall.add(topBeam);

      const awning = new THREE.Group();
      const panelCount = 7;
      for (let i=0;i<panelCount;i++) {
        const panel = new THREE.Mesh(new THREE.BoxGeometry(9.05/panelCount+0.015,0.12,3.55), i%2===0?clothLight:clothDark);
        panel.position.set(-4.525+(i+0.5)*(9.05/panelCount),3.22,0); panel.rotation.x=-0.035; awning.add(panel);
      }
      stall.add(awning);
      const valance = new THREE.Mesh(new THREE.BoxGeometry(9.05,0.48,0.13), clothLight); valance.position.set(0,2.91,-1.69); stall.add(valance);

      const counterLegGeo = new THREE.BoxGeometry(0.28,1.35,0.28);
      for (const x of [-3.8,3.8]) for (const z of [-1.15,1.15]) { const leg=new THREE.Mesh(counterLegGeo,wood); leg.position.set(x,0.68,z); stall.add(leg); }
      const counterBase = new THREE.Mesh(new THREE.BoxGeometry(8.55,0.18,2.55), wood); counterBase.position.y=1.36; stall.add(counterBase);
      const counterTop = new THREE.Mesh(new THREE.BoxGeometry(8.75,0.18,2.72), woodLight); counterTop.position.y=1.50; stall.add(counterTop);

      const stockedTypes = ['ruby','emerald','diamond','amethyst'];
      const crateZ=[-0.70,0.70], crateX=[-3.25,-1.08,1.08,3.25];
      for (let row=0;row<2;row++) for (let col=0;col<4;col++) {
        const crate = createStallCrate(row===0?stockedTypes[col]:null, 'crystal');
        crate.position.set(crateX[col],1.58,crateZ[row]); crate.rotation.y=(col-1.5)*0.025+(row?-0.025:0.025); stall.add(crate);
      }
      addStallSign(stall,'CRYSTALS',0x2f78b7,signMatHex);

      const npc = new THREE.Group(); npc.name='CrystalMerchantNPC';
      const npcBodyGeo = typeof THREE.CapsuleGeometry==='function'?new THREE.CapsuleGeometry(0.45,1.0,4,8):new THREE.CylinderGeometry(0.45,0.45,1.9,8);
      const npcBody = new THREE.Mesh(npcBodyGeo,black); npcBody.position.y=0.95; npc.add(npcBody);
      const hatBrim = new THREE.Mesh(new THREE.CylinderGeometry(0.62,0.68,0.10,16),black); hatBrim.position.y=1.95; npc.add(hatBrim);
      const hatCrown = new THREE.Mesh(new THREE.CylinderGeometry(0.44,0.52,0.54,16),black); hatCrown.position.y=2.24; npc.add(hatCrown);
      const hatBand = new THREE.Mesh(new THREE.CylinderGeometry(0.46,0.46,0.10,16),new THREE.MeshStandardMaterial({color:0x15171b,roughness:0.8})); hatBand.position.y=2.06; npc.add(hatBand);

      const stallDir = new THREE.Vector3(0.105,1,0).normalize();
      const groundRadius=PLANET_RADIUS+heightAt(stallDir); stall.position.copy(stallDir).multiplyScalar(groundRadius+0.02);
      const spawnTangent=new THREE.Vector3(0,1,0).sub(stallDir.clone().multiplyScalar(stallDir.y)).normalize();
      const stallRight=new THREE.Vector3().crossVectors(spawnTangent,stallDir).normalize();
      stall.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(stallRight,stallDir,spawnTangent.clone().negate()));
      planetSystem.add(stall);
      npc.position.set(5.55,0.02,-0.30); npc.scale.setScalar(0.76); stall.add(npc);
      stall.userData.merchantNPC=npc;
      return stall;
    }

    function createHatStall() {
      const stall = new THREE.Group();
      stall.name = 'HatMerchantStall';
      stall.userData.collision = { halfX: 4.62, halfZ: 1.82, padding: 0.48 };

      const wood = new THREE.MeshStandardMaterial({ color: 0x8a5632, roughness: 0.9 });
      const woodLight = new THREE.MeshStandardMaterial({ color: 0xb97b45, roughness: 0.88 });
      const clothLight = new THREE.MeshStandardMaterial({ color: 0xf0dfbd, roughness: 0.95 });
      const clothDark = new THREE.MeshStandardMaterial({ color: 0xf28a2e, roughness: 0.92 });
      const npcOrange = new THREE.MeshStandardMaterial({ color: 0xf07824, roughness: 0.9 });
      const hatGreen = new THREE.MeshStandardMaterial({ color: 0x2e9b48, roughness: 0.86 });

      const postGeo=new THREE.CylinderGeometry(0.11,0.13,3.15,8);
      for (const [x,y,z] of [[-4.35,1.58,-1.55],[4.35,1.58,-1.55],[-4.35,1.58,1.55],[4.35,1.58,1.55]]) { const post=new THREE.Mesh(postGeo,wood); post.position.set(x,y,z); stall.add(post); }
      const topBeam=new THREE.Mesh(new THREE.BoxGeometry(9.05,0.22,3.35),wood); topBeam.position.y=3.03; stall.add(topBeam);
      const awning=new THREE.Group();
      for(let i=0;i<7;i++){ const panel=new THREE.Mesh(new THREE.BoxGeometry(9.05/7+0.015,0.12,3.55),i%2===0?clothLight:clothDark); panel.position.set(-4.525+(i+0.5)*(9.05/7),3.22,0); panel.rotation.x=-0.035; awning.add(panel); }
      stall.add(awning);
      const valance=new THREE.Mesh(new THREE.BoxGeometry(9.05,0.48,0.13),clothLight); valance.position.set(0,2.91,-1.69); stall.add(valance);
      const counterLegGeo=new THREE.BoxGeometry(0.28,1.35,0.28);
      for(const x of [-3.8,3.8]) for(const z of [-1.15,1.15]){const leg=new THREE.Mesh(counterLegGeo,wood);leg.position.set(x,0.68,z);stall.add(leg);}
      const counterBase=new THREE.Mesh(new THREE.BoxGeometry(8.55,0.18,2.55),wood);counterBase.position.y=1.36;stall.add(counterBase);
      const counterTop=new THREE.Mesh(new THREE.BoxGeometry(8.75,0.18,2.72),woodLight);counterTop.position.y=1.50;stall.add(counterTop);

      const stockedTypes=['banana_skin_hat','fedora_hat','top_hat','baseball_hat','wizard_hat_blue','wizard_hat_red'];
      const crateZ=[-0.70,0.70], crateX=[-3.25,-1.08,1.08,3.25];
      for(let row=0;row<2;row++) for(let col=0;col<4;col++){
        const crate=createStallCrate(row===0?stockedTypes[col]:null,'hat');
        crate.position.set(crateX[col],1.58,crateZ[row]); crate.rotation.y=(col-1.5)*0.025+(row?-0.025:0.025); stall.add(crate);
      }
      // Give the hat stall its own visual sign, but do not wire any interaction to it.
      addStallSign(stall,'HATS',0xf28a2e,0x7a3e1c);

      const npc=new THREE.Group(); npc.name='HatStallNPC';
      const npcBodyGeo=typeof THREE.CapsuleGeometry==='function'?new THREE.CapsuleGeometry(0.45,1.0,4,8):new THREE.CylinderGeometry(0.45,0.45,1.9,8);
      const npcBody=new THREE.Mesh(npcBodyGeo,npcOrange); npcBody.position.y=0.95; npc.add(npcBody);
      const hatBrim=new THREE.Mesh(new THREE.CylinderGeometry(0.62,0.68,0.10,16),hatGreen); hatBrim.position.y=1.95; npc.add(hatBrim);
      const hatCrown=new THREE.Mesh(new THREE.CylinderGeometry(0.44,0.52,0.54,16),hatGreen); hatCrown.position.y=2.24; npc.add(hatCrown);
      const hatBand=new THREE.Mesh(new THREE.CylinderGeometry(0.46,0.46,0.10,16),new THREE.MeshStandardMaterial({color:0x237538,roughness:0.82})); hatBand.position.y=2.06; npc.add(hatBand);

      const baseDir=stallDirForHatStall();
      const groundRadius=PLANET_RADIUS+heightAt(baseDir);
      stall.position.copy(baseDir).multiplyScalar(groundRadius+0.02);
      const spawnTangent=new THREE.Vector3(0,1,0).sub(baseDir.clone().multiplyScalar(baseDir.y)).normalize();
      const stallRight=new THREE.Vector3().crossVectors(spawnTangent,baseDir).normalize();
      stall.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(stallRight,baseDir,spawnTangent.clone().negate()));
      planetSystem.add(stall);
      npc.position.set(5.55,0.02,-0.30); npc.scale.setScalar(0.76); stall.add(npc);
      stall.userData.merchantNPC=npc;
      return stall;
    }

    function stallDirForHatStall() {
      const base = new THREE.Vector3(0.105,1,0).normalize();
      const tangent = new THREE.Vector3(1,0,0).sub(base.clone().multiplyScalar(base.x)).normalize();
      const angle = 0.17; // ~10–11 world units of separation at the planet's surface
      return base.clone().multiplyScalar(Math.cos(angle)).add(tangent.multiplyScalar(Math.sin(angle))).normalize();
    }


    const crystalStall = createCrystalStall();
    const hatStall = createHatStall();

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

    // ---------- character customization UI ----------
    const cosmeticOverlay = document.getElementById('cosmeticOverlay');
    const cosmeticShopView = document.getElementById('cosmeticShopView');
    const cosmeticColorGrid = document.getElementById('cosmeticColorGrid');
    const cosmeticHatGrid = document.getElementById('cosmeticHatGrid');
    const cosmeticClose = document.getElementById('cosmeticClose');
    const cosmeticGemAmount = document.getElementById('cosmeticGemAmount');

    // The customization menu intentionally has no 3D preview.
    // The game character itself is updated live; the shop UI is kept focused on colors/hats.
    function ensureCosmeticPreview(){ }
    function updateCosmeticPreview(){
      if(cosmeticGemAmount) cosmeticGemAmount.textContent=String(accountGems);
    }
    function renderCosmeticShop(){
      if(!cosmeticColorGrid||!cosmeticHatGrid)return;
      cosmeticGemAmount.textContent=String(accountGems);
      cosmeticColorGrid.replaceChildren(); cosmeticHatGrid.replaceChildren();
      for(const color of COSMETIC_COLORS){
        const b=document.createElement('button'); b.type='button'; b.className='cosmeticColorCard'+(accountCosmetics.ownedColors.includes(color.id)?' owned':'')+(accountCosmetics.equippedColor===color.id?' equipped':'');
        const sw=document.createElement('span'); sw.className='cosmeticColorSwatch'+(color.rainbow?' cosmeticRainbowSwatch':''); if(!color.rainbow) sw.style.background='#'+color.hex.toString(16).padStart(6,'0');
        const title=document.createElement('span'); title.className='cosmeticCardTitle'; title.textContent=color.name;
        const sub=document.createElement('span'); sub.className='cosmeticCardSub'; sub.textContent=accountCosmetics.ownedColors.includes(color.id)?(accountCosmetics.equippedColor===color.id?'EQUIPPED':'Click to equip'):'Buy this color';
        const price=document.createElement('span'); price.className='cosmeticPrice'; price.textContent=color.free?'FREE':'◆ '+(color.cost||0);
        b.append(sw,title,price,sub); b.onclick=()=>purchaseOrEquipColor(color.id); cosmeticColorGrid.appendChild(b);
      }
      for(const hat of COSMETIC_HATS){
        if(hat.colored){
          for(const color of COSMETIC_COLORS){
            const id=cosmeticHatKey(hat.id,color.id); const owned=accountCosmetics.ownedHats.includes(id); const equipped=accountCosmetics.equippedHat===id; const b=makeCosmeticHatCard(hat,color,id,owned,equipped); cosmeticHatGrid.appendChild(b);
          }
        } else if(hat.fixedColor) {
          const color=cosmeticColorById[hat.fixedColor];
          const id=hat.id; const owned=accountCosmetics.ownedHats.includes(id); const equipped=accountCosmetics.equippedHat===id; cosmeticHatGrid.appendChild(makeCosmeticHatCard(hat,color,id,owned,equipped));
        } else {
          const id=hat.id; const owned=accountCosmetics.ownedHats.includes(id); const equipped=accountCosmetics.equippedHat===id; cosmeticHatGrid.appendChild(makeCosmeticHatCard(hat,null,id,owned,equipped));
        }
      }
    }
    function makeCosmeticHatCard(hat,color,id,owned,equipped){
      const b=document.createElement('button'); b.type='button'; b.className='cosmeticHatCard'+(owned?' owned':'')+(equipped?' equipped':'');
      const p=document.createElement('span'); p.className='cosmeticHatPreview'; p.textContent=hat.id==='banana_skin_hat'?'🍌':hat.id==='top_hat'?'🎩':hat.id.startsWith('wizard_hat')?'🧙':'◆';
      if(color) p.style.color='#'+color.hex.toString(16).padStart(6,'0');
      const title=document.createElement('span'); title.className='cosmeticCardTitle'; title.textContent=hat.name+(color?' · '+color.name:'');
      const sub=document.createElement('span'); sub.className='cosmeticCardSub'; sub.textContent=owned?(equipped?'EQUIPPED':'Click to equip'):'Click to buy';
      const price=document.createElement('span'); price.className='cosmeticPrice'; price.textContent=owned?'OWNED':'◆ '+hat.cost;
      b.append(p,title,price,sub); b.onclick=()=>purchaseOrEquipHat(id); return b;
    }
    function purchaseOrEquipColor(colorId){
      if(accountCosmetics.ownedColors.includes(colorId)){ equipCosmeticColor(colorId); return; }
      const color=cosmeticColorById[colorId]; if(!currentAccountUser){ alert('Log in to use account cosmetics.'); return; }
      if(accountGems<(color.cost||0)){ return; }
      accountGems-=color.cost||0; accountCosmetics.ownedColors.push(colorId); equipCosmeticColor(colorId); persistAchievementState();
    }
    function equipCosmeticColor(colorId){ if(!accountCosmetics.ownedColors.includes(colorId))return; accountCosmetics.equippedColor=colorId; applyPlayerCosmetics(); persistAchievementState(); updateHomeGemsAndCosmeticsUI(); }
    function purchaseOrEquipHat(hatId){
      if(accountCosmetics.ownedHats.includes(hatId)){ equipCosmeticHat(hatId); return; }
      const [baseId,colorId]=String(hatId).split(':'); const hat=cosmeticHatById[baseId]; if(!hat||!currentAccountUser)return;
      if(accountGems<hat.cost)return; accountGems-=hat.cost; accountCosmetics.ownedHats.push(hatId); equipCosmeticHat(hatId); persistAchievementState();
    }
    function equipCosmeticHat(hatId){ accountCosmetics.equippedHat = accountCosmetics.equippedHat===hatId ? null : hatId; applyPlayerCosmetics(); persistAchievementState(); updateHomeGemsAndCosmeticsUI(); }
    function openCosmeticShop(){
      markJournalPersonMet('helna');
      chooseHelnaLine();
      if(!currentAccountUser){ openAccount(); return true; }
      cosmeticShopOpen=true; state.paused=true; if(document.pointerLockElement===canvas)document.exitPointerLock();
      cosmeticOverlay.classList.remove('hidden'); cosmeticOverlay.setAttribute('aria-hidden','false'); ensureCosmeticPreview(); renderCosmeticShop(); updateCosmeticPreview();
      return true;
    }
    function closeCosmeticShop(){ cosmeticShopOpen=false; cosmeticOverlay.classList.add('hidden'); cosmeticOverlay.setAttribute('aria-hidden','true'); if(state.gameState==='playing'){state.paused=false;attemptPointerLock();} }
    const findNearbyHatMerchant=()=>{
      const merchant=hatStall?.userData?.merchantNPC; if(!merchant||!hatStall)return null;
      const world=new THREE.Vector3(); merchant.getWorldPosition(world); const local=planetSystem.worldToLocal(world); return player.position.distanceTo(local)<=7.5?merchant:null;
    };
    function openNearbyHatShop(){ if(cosmeticShopOpen||state.gameState!=='playing')return false; if(!findNearbyHatMerchant())return false; return openCosmeticShop(); }
    cosmeticClose.addEventListener('click',closeCosmeticShop);
    cosmeticOverlay.addEventListener('click',e=>{if(e.target===cosmeticOverlay)closeCosmeticShop();});

    // Every spawned crystal keeps a ghost at the exact same location. When it is picked up,
    // the solid model disappears, the ghost appears, and a respawn rotation target is stored.
    const crystalSpawns = worldState.crystals;
    // Cordelia's collectibles join the existing pickup/respawn system once that list exists.
    for (const spawn of cordeliaCrystalSpawns) crystalSpawns.push(spawn);
    const CRYSTALS_PER_TYPE = 12;
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

    scatterMoonQuartz(120);

    function createTungstenOreVisual(scale = 1) {
      const group = new THREE.Group();
      const base = new THREE.Mesh(new THREE.DodecahedronGeometry(0.82,0), new THREE.MeshStandardMaterial({color:0x6b665f,roughness:.92,metalness:.05,flatShading:true}));
      group.add(base);
      const spotMat = new THREE.MeshStandardMaterial({color:0x9a5a3b,roughness:.86,metalness:.08,flatShading:true});
      for (let i=0;i<3;i++) {
        const spot = new THREE.Mesh(new THREE.SphereGeometry(.25+Math.random()*.12,6,4), spotMat);
        const a=i/3*Math.PI*2+Math.random()*.7;
        spot.position.set(Math.cos(a)*.42,(Math.random()-.5)*.34,Math.sin(a)*.42);
        spot.scale.set(1.25,.6,.7); spot.rotation.set(Math.random(),Math.random(),Math.random()); group.add(spot);
      }
      group.scale.setScalar(scale); return group;
    }
    function spawnMoonTungsten(dir, scale=.92) {
      const root=createTungstenOreVisual(scale); root.position.copy(dir).multiplyScalar(MOON_RADIUS+.22); root.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0),dir); moonMesh.add(root);
      moonTungstenSpawns.push({root,direction:dir.clone(),mined:false,oreType:'tungsten_ore'});
    }
    function scatterMoonTungsten(count=8) {
      for (let i=0;i<count;i++) { const dir=new THREE.Vector3(Math.random()-.5,Math.random()-.5,Math.random()-.5).normalize(); spawnMoonTungsten(dir,.72+Math.random()*.45); }
    }
    scatterMoonTungsten(8);

    // ---------- Big Omega: Syspo, Aurora and Mileria ----------
    // All Omega terrain is generated in the body's own local frame. The bodies themselves are
    // children of syspoSystem, so solar motion and moon motion are inherited automatically.
    const omegaTitaniumSpawns = [];
    const auroraTreeSpawns = [];
    const auroraCrystalSpawns = [];
    const auroraLakeDirs = [
      new THREE.Vector3(0.76, 0.19, 0.63).normalize(),
      new THREE.Vector3(-0.63, 0.20, 0.71).normalize(),
      new THREE.Vector3(0.22, -0.18, -0.96).normalize(),
      new THREE.Vector3(-0.30, 0.74, -0.60).normalize()
    ];
    const auroraMountainDirs = [
      new THREE.Vector3(0.58, 0.58, 0.56).normalize(),
      new THREE.Vector3(-0.70, 0.40, -0.59).normalize()
    ];

    function omegaSmoothBump(t) {
      return t >= 1 ? 0 : Math.pow(Math.max(0, 1 - t * t), 3);
    }

    function auroraLakeMask(dir, lakeDir) {
      return THREE.MathUtils.clamp(1 - dir.angleTo(lakeDir) / 0.22, 0, 1);
    }

    function auroraHeightAt(dir) {
      const d = dir.clone().normalize();
      let h = 4.2 + Math.sin(d.x * 5.2 + d.z * 3.4) * 2.4 + Math.sin(d.y * 9.0 - d.x * 2.4) * 1.25;
      h += Math.sin((d.x - d.z) * 15.0 + d.y * 3.0) * 0.75;
      for (const md of auroraMountainDirs) {
        const t = d.angleTo(md) / 0.30;
        h += 31 * omegaSmoothBump(t);
      }
      let lake = 0;
      for (const ld of auroraLakeDirs) {
        lake = Math.max(lake, auroraLakeMask(d, ld));
      }
      h -= 6.5 * lake;
      return Math.max(-3.8, h);
    }

    function mileriaHeightAt(dir) {
      const d = dir.clone().normalize();
      // Softer, broad-scale terrain noise keeps Mileria rugged without the
      // faceted low-poly look from very sharp high-frequency displacement.
      let h = 7 + Math.sin(d.x * 4.8 + d.z * 3.6) * 3.4 + Math.sin(d.y * 8.0 - d.x * 2.8) * 1.7;
      h += Math.sin((d.x + d.z) * 11.0 + d.y * 4.5) * 0.9;
      const peaks = [
        new THREE.Vector3(0.64, 0.56, 0.52).normalize(),
        new THREE.Vector3(-0.55, 0.33, -0.76).normalize(),
        new THREE.Vector3(0.12, -0.72, 0.68).normalize()
      ];
      for (const pd of peaks) {
        const t = d.angleTo(pd) / 0.42;
        h += 25 * omegaSmoothBump(t);
      }
      return Math.max(0, h);
    }

    function buildOmegaTerrainMesh(radius, segmentsW, segmentsH, heightFn, colorFn, flatness = false) {
      const geometry = new THREE.SphereGeometry(radius, segmentsW, segmentsH);
      const pos = geometry.attributes.position;
      const colors = [];
      for (let i = 0; i < pos.count; i++) {
        const dir = new THREE.Vector3(pos.getX(i), pos.getY(i), pos.getZ(i)).normalize();
        const h = heightFn(dir);
        const r = Math.max(0.1, radius + h);
        pos.setXYZ(i, dir.x * r, dir.y * r, dir.z * r);
        const c = colorFn(dir, h);
        colors.push(c.r, c.g, c.b);
      }
      geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
      geometry.computeVertexNormals();
      geometry.computeBoundingSphere();
      const material = new THREE.MeshStandardMaterial({
        vertexColors: true,
        roughness: flatness ? 1.0 : 0.86,
        metalness: 0.0,
        flatShading: !!flatness
      });
      const mesh = new THREE.Mesh(geometry, material);
      mesh.frustumCulled = false;
      return mesh;
    }

    const auroraBase = new THREE.Color(0x2f8e4c);
    const auroraDark = new THREE.Color(0x1d6336);
    const auroraLight = new THREE.Color(0x58b866);
    const mileriaBase = new THREE.Color(0x777a7d);
    const mileriaDark = new THREE.Color(0x4f5357);
    const mileriaLight = new THREE.Color(0x9b9da0);

    const auroraTerrain = buildOmegaTerrainMesh(AURORA_RADIUS, 80, 52, auroraHeightAt, (dir, h) => {
      const mountain = THREE.MathUtils.smoothstep(h, 10, 30);
      return auroraBase.clone().lerp(auroraLight, mountain * 0.45 + (dir.y + 1) * 0.08).lerp(auroraDark, Math.max(0, -h) * 0.04);
    });
    auroraMesh.add(auroraTerrain);

    const mileriaTerrain = buildOmegaTerrainMesh(MILERIA_RADIUS, 112, 72, mileriaHeightAt, (dir, h) => {
      const t = THREE.MathUtils.clamp((h - 6) / 28, 0, 1);
      return mileriaDark.clone().lerp(mileriaBase, 0.45 + t * 0.35).lerp(mileriaLight, Math.max(0, t - 0.55) * 0.6);
    }, false);
    mileriaMesh.add(mileriaTerrain);

    function createSyspoCore() {
      const geometry = new THREE.SphereGeometry(SYSP0_RADIUS, 96, 64);
      const pos = geometry.attributes.position;
      // Keep the core mathematically exact at 700u radius; the variation belongs to the
      // atmospheric cloud shells rather than the lethal boundary itself.
      geometry.computeVertexNormals();
      geometry.computeBoundingSphere();
      const mat = new THREE.MeshStandardMaterial({ color: 0x28335f, roughness: 0.88, metalness: 0.03, emissive: 0x0b0b27, emissiveIntensity: 0.18 });
      const mesh = new THREE.Mesh(geometry, mat);
      mesh.frustumCulled = false;
      return mesh;
    }
    syspoMesh.add(createSyspoCore());

    const syspoCloudLayers = [];
    const syspoCloudPalette = [0x4b3f7a, 0x5c477f, 0x3d4d82, 0x6a4d86, 0x33406d];
    SYSP0_CLOUD_RADII.forEach((radius, layerIndex) => {
      const group = new THREE.Group();
      const geometry = new THREE.SphereGeometry(radius, 72, 40);
      const pos = geometry.attributes.position;
      for (let i = 0; i < pos.count; i++) {
        const d = new THREE.Vector3(pos.getX(i), pos.getY(i), pos.getZ(i)).normalize();
        const wave = 1 + 0.015 * Math.sin(d.x * (7 + layerIndex * 2) + d.z * (8 + layerIndex)) + 0.010 * Math.sin(d.y * 17 - d.x * 5);
        pos.setXYZ(i, d.x * radius * wave, d.y * radius * wave, d.z * radius * wave);
      }
      geometry.computeVertexNormals(); geometry.computeBoundingSphere();
      const mat = new THREE.MeshStandardMaterial({
        color: syspoCloudPalette[layerIndex],
        transparent: true,
        opacity: [0.32, 0.26, 0.22][layerIndex],
        roughness: 1,
        metalness: 0,
        depthWrite: false,
        fog: false
      });
      const shell = new THREE.Mesh(geometry, mat);
      shell.frustumCulled = false;
      group.add(shell);
      syspoMesh.add(group);
      syspoCloudLayers.push({ group, speed: [0.018, -0.013, 0.009][layerIndex] });
    });

    function createSimpleTree(size = 1) {
      const root = new THREE.Group();
      const trunk = new THREE.Mesh(treeTrunkGeo, treeTrunkMat);
      const leaves = new THREE.Mesh(treeLeafGeo, treeLeafMat);
      trunk.position.y = 0.7 * size;
      leaves.position.y = 2.0 * size;
      trunk.scale.setScalar(size);
      leaves.scale.setScalar(size);
      root.add(trunk, leaves);
      root.frustumCulled = false;
      return root;
    }

    function placeAuroraProp(root, dir, extraHeight = 0) {
      const d = dir.clone().normalize();
      const h = auroraHeightAt(d);
      root.position.copy(d).multiplyScalar(AURORA_RADIUS + h + extraHeight);
      root.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d);
      return h;
    }
    function placeMileriaProp(root, dir, extraHeight = 0) {
      const d = dir.clone().normalize();
      const h = mileriaHeightAt(d);
      root.position.copy(d).multiplyScalar(MILERIA_RADIUS + h + extraHeight);
      root.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d);
      return h;
    }

    // Aurora's denser ecosystem: compact clumps of up to 20 trees.
    for (let cluster = 0; cluster < 34; cluster++) {
      const center = new THREE.Vector3(Math.random() * 2 - 1, Math.random() * 2 - 1, Math.random() * 2 - 1).normalize();
      const treeCount = 7 + Math.floor(Math.random() * 14);
      for (let i = 0; i < treeCount; i++) {
        const offset = new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5);
        const dir = center.clone().addScaledVector(offset, 0.17).normalize();
        const h = auroraHeightAt(dir);
        if (h < 0 || h > 13) continue;
        const size = 1.25 + Math.random() * 2.6;
        const root = createSimpleTree(size);
        const yaw = Math.random() * Math.PI * 2;
        placeAuroraProp(root, dir, 0);
        root.rotateY(yaw);
        auroraMesh.add(root);
        auroraTreeSpawns.push({ root, direction: dir.clone(), size, yaw, chopped: false });
      }
    }

    // A large ground lotus-like flower for Aurora. It is decorative rather than harvestable.
    function createAuroraLotus(scale = 1) {
      const group = new THREE.Group();
      const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.09, 0.55, 8), new THREE.MeshStandardMaterial({ color: 0x318f48, roughness: 1 }));
      stem.position.y = 0.28;
      group.add(stem);
      const petalMat = new THREE.MeshStandardMaterial({ color: 0xff89c9, roughness: 0.65, emissive: 0x3d092a, emissiveIntensity: 0.08 });
      for (let i = 0; i < 10; i++) {
        const petal = new THREE.Mesh(new THREE.SphereGeometry(0.28, 10, 8), petalMat);
        const a = i / 10 * Math.PI * 2;
        petal.scale.set(0.72, 1.5, 0.28);
        petal.position.set(Math.cos(a) * 0.42, 0.42, Math.sin(a) * 0.42);
        petal.rotation.y = a;
        petal.rotation.z = Math.PI * 0.33;
        group.add(petal);
      }
      const center = new THREE.Mesh(new THREE.SphereGeometry(0.25, 12, 8), new THREE.MeshStandardMaterial({ color: 0xffd35c, roughness: 0.7 }));
      center.position.y = 0.52;
      group.add(center);
      group.scale.setScalar(scale);
      return group;
    }
    for (let i = 0; i < 46; i++) {
      let dir = new THREE.Vector3(Math.random()*2-1, Math.random()*2-1, Math.random()*2-1).normalize();
      const root = createAuroraLotus(0.85 + Math.random() * 0.55);
      placeAuroraProp(root, dir, 0.02);
      root.rotateY(Math.random()*Math.PI*2);
      auroraMesh.add(root);
    }

    // Multiple shallow lakes, placed as blue tangent-surface discs that follow Aurora's curvature.
    // CircleGeometry already lies in the local XY plane with its normal along +Z, so the
    // parent group rotates that normal directly onto the moon's surface normal. The old
    // extra X rotation made the water intersect Aurora at the wrong angle, causing the
    // large flat/incorrectly oriented patches seen from some camera angles.
    const lakeMat = new THREE.MeshStandardMaterial({
      color: 0x3b9bd8,
      roughness: 0.20,
      metalness: 0.02,
      transparent: true,
      opacity: 0.88,
      depthWrite: false,
      side: THREE.DoubleSide
    });
    for (const dir of auroraLakeDirs) {
      const group = new THREE.Group();
      const disk = new THREE.Mesh(new THREE.CircleGeometry(13 + Math.random() * 5, 36), lakeMat);
      const local = dir.clone().multiplyScalar(AURORA_RADIUS + auroraHeightAt(dir) + 0.18);
      group.position.copy(local);
      group.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), dir);
      group.add(disk);
      auroraMesh.add(group);
    }

    function createTitaniumDeposit(scale = 1) {
      const group = new THREE.Group();
      const rockMat = new THREE.MeshStandardMaterial({ color: 0x686d72, roughness: 0.96, metalness: 0.08, flatShading: true });
      const titaniumMat = new THREE.MeshStandardMaterial({ color: 0x95a7b8, roughness: 0.34, metalness: 0.72, emissive: 0x1c2a35, emissiveIntensity: 0.18, flatShading: true });
      const rock = new THREE.Mesh(new THREE.DodecahedronGeometry(2.0, 1), rockMat);
      rock.scale.set(1.15, 0.95, 1.30);
      group.add(rock);
      for (let i = 0; i < 5; i++) {
        const shard = new THREE.Mesh(new THREE.OctahedronGeometry(0.34 + Math.random()*0.18, 0), titaniumMat);
        const a = i / 5 * Math.PI * 2 + Math.random() * 0.4;
        shard.position.set(Math.cos(a)*1.25, (Math.random()-0.25)*0.95, Math.sin(a)*1.25);
        shard.scale.y = 1.8;
        group.add(shard);
      }
      group.scale.setScalar(scale);
      group.frustumCulled = false;
      return group;
    }
    function scatterTitaniumDeposits(count = 58) {
      // Evenly distribute deposits over the whole moon with a spherical
      // golden-angle pattern instead of random clustering in a few regions.
      const goldenAngle = Math.PI * (3 - Math.sqrt(5));
      for (let i = 0; i < count; i++) {
        const y = 1 - (i + 0.5) * (2 / count);
        const radius = Math.sqrt(Math.max(0, 1 - y * y));
        const angle = i * goldenAngle;
        const dir = new THREE.Vector3(Math.cos(angle) * radius, y, Math.sin(angle) * radius).normalize();
        const root = createTitaniumDeposit(0.9 + Math.random()*0.55);
        placeMileriaProp(root, dir, 0.8);
        root.rotateY(Math.random()*Math.PI*2);
        mileriaMesh.add(root);
        omegaTitaniumSpawns.push({ root, direction: dir.clone(), mined: false, oreType: 'titanium_ore', yieldCount: 1 + Math.floor(Math.random() * 5) });
      }
    }
    scatterTitaniumDeposits();

    function spawnAuroraRainbowOpal(dir, scale = 1) {
      const root = new THREE.Group();
      const visual = createCrystalVisual('rainbow_opal', false, scale);
      const ghost = createCrystalVisual('rainbow_opal', true, scale * 1.04);
      root.add(visual, ghost); ghost.visible = false;
      placeAuroraProp(root, dir, 0.08);
      auroraMesh.add(root);
      auroraCrystalSpawns.push({ typeId: 'rainbow_opal', root, crystal: visual, ghost, collected: false, respawnAtSpin: 0, direction: dir.clone() });
    }
    for (let i = 0; i < 72; i++) {
      const dir = new THREE.Vector3(Math.random()*2-1, Math.random()*2-1, Math.random()*2-1).normalize();
      if (auroraHeightAt(dir) < 0) continue;
      spawnAuroraRainbowOpal(dir, 0.88 + Math.random()*0.4);
    }

    const syspoSolarInitialDirection = sunMesh.position.clone().normalize();
    const syspoSolarReferenceAxis = Math.abs(syspoSolarInitialDirection.y) < 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
    syspoSolarOrbitBasisA.crossVectors(syspoSolarInitialDirection, syspoSolarReferenceAxis).normalize();
    syspoSolarOrbitBasisB.crossVectors(syspoSolarInitialDirection, syspoSolarOrbitBasisA).normalize();

    function updateOmegaSystem(delta) {
      syspoSolarOrbitAngle = (syspoSolarOrbitAngle + delta * Math.PI * 2 / SYSP0_ORBIT_PERIOD) % (Math.PI * 2);
      sunMesh.getWorldPosition(syspoSunWorldPosition);
      syspoSolarOrbitPosition.copy(syspoSunWorldPosition)
        .addScaledVector(syspoSolarOrbitBasisA, Math.cos(syspoSolarOrbitAngle) * SYSP0_SOLAR_DISTANCE)
        .addScaledVector(syspoSolarOrbitBasisB, Math.sin(syspoSolarOrbitAngle) * SYSP0_SOLAR_DISTANCE);
      syspoSystem.position.copy(syspoSolarOrbitPosition);
      syspoMesh.rotation.y = (syspoMesh.rotation.y + delta * Math.PI * 2 / SYSP0_ROTATION_PERIOD) % (Math.PI * 2);
      auroraOrbitAngle = (auroraOrbitAngle + delta * Math.PI * 2 / AURORA_ORBIT_PERIOD) % (Math.PI * 2);
      mileriaOrbitAngle = (mileriaOrbitAngle + delta * Math.PI * 2 / MILERIA_ORBIT_PERIOD) % (Math.PI * 2);
      auroraMesh.position.set(Math.cos(auroraOrbitAngle) * AURORA_ORBIT_RADIUS, 0, Math.sin(auroraOrbitAngle) * AURORA_ORBIT_RADIUS);
      mileriaMesh.position.set(Math.cos(mileriaOrbitAngle) * MILERIA_ORBIT_RADIUS, 0, Math.sin(mileriaOrbitAngle) * MILERIA_ORBIT_RADIUS);
      auroraMesh.rotation.y = (auroraMesh.rotation.y + delta * Math.PI * 2 / 360) % (Math.PI * 2);
      mileriaMesh.rotation.y = (mileriaMesh.rotation.y + delta * Math.PI * 2 / 300) % (Math.PI * 2);
      for (const layer of syspoCloudLayers) layer.group.rotation.y += delta * layer.speed;
      syspoSystem.getWorldPosition(syspoWorldPosition);
      auroraMesh.getWorldPosition(auroraWorldPosition);
      mileriaMesh.getWorldPosition(mileriaWorldPosition);
    }
    updateOmegaSystem(0);

    function getOmegaAtmosphereBody(worldPos) {
      if (!worldPos) return null;
      const dA = worldPos.distanceTo(auroraWorldPosition);
      const dM = worldPos.distanceTo(mileriaWorldPosition);
      const dS = worldPos.distanceTo(syspoWorldPosition);
      if (dA <= AURORA_RADIUS + 520) return { id: 'aurora', center: auroraWorldPosition, distance: dA };
      if (dM <= MILERIA_RADIUS + 420) return { id: 'mileria', center: mileriaWorldPosition, distance: dM };
      if (dS <= SYSP0_CLOUD_RADII[2] + 90) return { id: 'syspo', center: syspoWorldPosition, distance: dS };
      return null;
    }

    function updateOmegaAtmosphere(worldPos) {
      const atmosphereBody = getOmegaAtmosphereBody(worldPos);
      if (!atmosphereBody) return false;
      const bodyId = atmosphereBody.id;
      const center = atmosphereBody.center;
      omegaTempRadial.copy(worldPos).sub(center);
      if (omegaTempRadial.lengthSq() < 0.00001) omegaTempRadial.set(0, 1, 0);
      const radialDirWorld = omegaTempRadial.normalize();
      const sunDirection = sunMesh.position.clone().sub(center).normalize();
      const sunDot = radialDirWorld.dot(sunDirection);
      const daylight = THREE.MathUtils.smoothstep(sunDot, -0.48, -0.10);
      const sunset = 1 - Math.min(1, Math.abs(sunDot) / 0.35);
      const night = THREE.MathUtils.smoothstep(-sunDot, 0.02, 0.42);
      const bodyRadius = bodyId === 'syspo' ? SYSP0_RADIUS : bodyId === 'aurora' ? AURORA_RADIUS : MILERIA_RADIUS;
      const altitude = Math.max(0, atmosphereBody.distance - bodyRadius);
      const fadeEnd = bodyId === 'syspo' ? 900 : bodyId === 'aurora' ? 640 : 500;
      const atmosphereBlend = THREE.MathUtils.smoothstep(altitude, fadeEnd * 0.55, fadeEnd);
      if (bodyId === 'aurora') {
        tempSkyColor.copy(AURORA_NIGHT_SKY).lerp(AURORA_DAY_SKY, daylight);
        if (sunset > 0) tempSkyColor.lerp(AURORA_SUNSET_SKY, sunset * 0.76);
        tempFogColor.copy(AURORA_NIGHT_SKY).lerp(AURORA_DAY_SKY, daylight);
        if (sunset > 0) tempFogColor.lerp(AURORA_SUNSET_SKY, sunset * 0.68);
        ambientLight.intensity = THREE.MathUtils.lerp(0.09, 0.38, daylight);
        sunLight.intensity = THREE.MathUtils.lerp(0.04, 2.2, daylight);
      } else if (bodyId === 'mileria') {
        const day = new THREE.Color(0x6d7780), nightCol = new THREE.Color(0x10151b);
        tempSkyColor.copy(nightCol).lerp(day, daylight);
        if (sunset > 0) tempSkyColor.lerp(new THREE.Color(0xc07b61), sunset * 0.56);
        tempFogColor.copy(nightCol).lerp(day, daylight);
        if (sunset > 0) tempFogColor.lerp(new THREE.Color(0xc07b61), sunset * 0.46);
        ambientLight.intensity = THREE.MathUtils.lerp(0.08, 0.28, daylight);
        sunLight.intensity = THREE.MathUtils.lerp(0.03, 1.8, daylight);
      } else {
        const day = new THREE.Color(0x4c5f9a), nightCol = new THREE.Color(0x05050d);
        tempSkyColor.copy(nightCol).lerp(day, daylight);
        if (sunset > 0) tempSkyColor.lerp(SYSP0_SUNSET_SKY, sunset * 0.52);
        tempFogColor.copy(nightCol).lerp(day, daylight);
        if (sunset > 0) tempFogColor.lerp(SYSP0_SUNSET_SKY, sunset * 0.46);
        ambientLight.intensity = THREE.MathUtils.lerp(0.06, 0.30, daylight);
        sunLight.intensity = THREE.MathUtils.lerp(0.02, 1.95, daylight);
      }
      tempSkyColor.lerp(SPACE_SKY, atmosphereBlend * 0.85);
      tempFogColor.lerp(SPACE_FOG, atmosphereBlend * 0.85);
      skyMat.color.copy(tempSkyColor);
      scene.background.copy(tempSkyColor);
      sceneFog.color.copy(tempFogColor);
      starMat.opacity = Math.max(THREE.MathUtils.clamp(night * 1.12, 0, 1), atmosphereBlend);
      return true;
    }

    function getOmegaBodyWorldPosition(bodyId, out = new THREE.Vector3()) {
      if (bodyId === 'aurora') return out.copy(auroraWorldPosition);
      if (bodyId === 'mileria') return out.copy(mileriaWorldPosition);
      if (bodyId === 'syspo') return out.copy(syspoWorldPosition);
      return out.set(0, 0, 0);
    }
    function getOmegaSurfaceHeight(bodyId, dir) {
      return bodyId === 'aurora' ? auroraHeightAt(dir) : bodyId === 'mileria' ? mileriaHeightAt(dir) : 0;
    }
    function getOmegaSurfaceRadius(bodyId, dir) {
      return (bodyId === 'aurora' ? AURORA_RADIUS : MILERIA_RADIUS) + getOmegaSurfaceHeight(bodyId, dir);
    }
    function getOmegaMesh(bodyId) { return bodyId === 'aurora' ? auroraMesh : bodyId === 'mileria' ? mileriaMesh : null; }
    function getOmegaBodyGravityMultiplier(bodyId) { return bodyId === 'mileria' ? MILERIA_GRAVITY_MULTIPLIER : 1; }


    // ---------- planet / space travel transitions ----------
    const travelTransitionOverlay = document.getElementById('travelTransition');
    const travelTransitionTitle = document.getElementById('travelTransitionTitle');
    const travelTransitionSubtext = document.getElementById('travelTransitionSubtext');
    let travelTransitionState = null;
    let travelTransitionTimer = 0;
    let travelTransitionLastTime = 0;

    function getTravelEnvironmentState() {
      if (!playerState.inRocket || playerState.rocketLanded) return 'ground';
      const pos = flightPosition;
      const ivisDistance = pos.distanceTo(ivisSolarOrbitPosition);
      if (ivisDistance <= ROCKET_ATMOSPHERE_RADIUS) return 'ivis-atmosphere';
      if (typeof playerIsInCordeliaAtmosphere === 'function' && playerIsInCordeliaAtmosphere(pos)) return 'cordelia-atmosphere';
      const omegaBody = getOmegaAtmosphereBody(pos);
      if (omegaBody) return omegaBody.id + '-atmosphere';
      return 'deep-space';
    }

    function formatTravelTransitionName(stateKey) {
      if (stateKey === 'deep-space') return 'DEEP SPACE';
      if (stateKey === 'ivis-atmosphere') return 'IVIS ATMOSPHERE';
      if (stateKey === 'cordelia-atmosphere') return 'CORDELIA ATMOSPHERE';
      if (stateKey === 'aurora-atmosphere') return 'AURORA ATMOSPHERE';
      if (stateKey === 'mileria-atmosphere') return 'MILERIA ATMOSPHERE';
      if (stateKey === 'syspo-atmosphere') return 'SYSPO ATMOSPHERE';
      return 'SURFACE';
    }

    function triggerTravelTransition(nextState, fromState) {
      if (!travelTransitionOverlay || !nextState || nextState === fromState || nextState === 'ground' || fromState === null || fromState === 'ground') return;
      const enteringSpace = nextState === 'deep-space';
      const destination = formatTravelTransitionName(nextState);
      travelTransitionTitle.textContent = enteringSpace ? 'ENTERING DEEP SPACE' : 'ENTERING ' + destination;
      travelTransitionSubtext.textContent = enteringSpace ? 'ATMOSPHERE CLEAR · STARFIELD ONLINE' : 'ATMOSPHERIC FLIGHT · STABILIZING';
      travelTransitionOverlay.classList.remove('show');
      void travelTransitionOverlay.offsetWidth;
      travelTransitionOverlay.classList.add('show');
      travelTransitionTimer = enteringSpace ? 0.72 : 0.58;
      travelTransitionLastTime = performance.now();
      clearTimeout(triggerTravelTransition.hideTimer);
      triggerTravelTransition.hideTimer = setTimeout(() => travelTransitionOverlay.classList.remove('show'), Math.round(travelTransitionTimer * 1000));
    }

    function updateTravelTransitions() {
      const nextState = getTravelEnvironmentState();
      if (travelTransitionState === null) {
        travelTransitionState = nextState;
        return;
      }
      if (nextState !== travelTransitionState) {
        triggerTravelTransition(nextState, travelTransitionState);
        travelTransitionState = nextState;
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

    function cloneAndTintToolModel(template, scale, headType, starter = false) {
      if (!template) return null;
      const group = template.clone(true);
      group.traverse((node) => {
        if (!node.isMesh) return;
        if (Array.isArray(node.material)) node.material = node.material.map(m => m && m.clone ? m.clone() : m);
        else if (node.material && node.material.clone) node.material = node.material.clone();
        const mats = Array.isArray(node.material) ? node.material : [node.material];
        for (const mat of mats) {
          if (!mat || !mat.color) continue;
          const name = String(mat.name || '').toLowerCase();
          const bladeColor = starter ? 0xb4b0a6 : headType === 'wood' ? 0x6b462f : headType === 'stone' ? 0x90979d : 0x4b525a;
          const handleColor = starter ? 0x9a6738 : 0x7a4d2c;
          if (name.includes('blade')) {
            mat.color.setHex(bladeColor);
            mat.roughness = 0.48;
            mat.metalness = headType === 'wood' ? 0.06 : 0.55;
          } else if (name.includes('stick') || name.includes('handle')) {
            mat.color.setHex(handleColor);
            mat.roughness = 0.86;
            mat.metalness = 0.03;
          }
        }
      });
      const box = new THREE.Box3().setFromObject(group);
      const center = box.getCenter(new THREE.Vector3());
      group.position.x -= center.x;
      group.position.z -= center.z;
      group.position.y -= box.min.y;
      group.scale.setScalar(scale);
      return group;
    }

    function createActualAxeVisual(scale = 1, headType = 'metal', starter = false) {
      const actual = cloneAndTintToolModel(axeModelTemplate, scale, headType, starter);
      if (actual) {
        // The supplied axe mesh is modeled with the cutting side facing inward.
        // Turn it around so the blade points outward from the player when held.
        actual.rotation.y = Math.PI;
      }
      return actual;
    }

    function createActualPickaxeVisual(scale = 1, headType = 'wood') {
      return cloneAndTintToolModel(pickaxeModelTemplate, scale, headType, false);
    }

    function makeToolHeadMaterial(headType, defaultMetalness = 0.45) {
      return new THREE.MeshStandardMaterial({
        color: headType === 'wood' ? 0x6f4328 : (headType === 'stone' ? 0x9aa1a8 : (headType === 'iron' ? 0x4d5359 : 0xbcc3cb)),
        metalness: headType === 'metal' ? defaultMetalness : 0.05,
        roughness: headType === 'metal' ? 0.32 : 0.82
      });
    }

    // Low-poly axe inspired by the supplied reference: long slightly curved wooden
    // handle, compact eye, and a broad wedge-shaped metal head with a single cutting edge.
    function createAxeVisual(scale = 1, headType = 'metal', starter = false) {
      const actual = createActualAxeVisual(scale * 4.625, headType, starter);
      if (actual) return actual;
      const group = new THREE.Group();
      const handleMat = new THREE.MeshStandardMaterial({ color: 0x8b5a32, roughness: 0.84 });

      // Build the handle from three faceted sections to suggest the gentle natural curve
      // of the reference while keeping the model deliberately low-poly/cartoon-like.
      const handleParts = [
        { y: -0.33, len: 0.44, x: -0.035, zRot: -0.08, r1: 0.070, r2: 0.060 },
        { y:  0.00, len: 0.56, x: -0.005, zRot: -0.02, r1: 0.064, r2: 0.055 },
        { y:  0.35, len: 0.46, x:  0.055, zRot:  0.08, r1: 0.058, r2: 0.048 }
      ];
      for (const part of handleParts) {
        const mesh = new THREE.Mesh(
          new THREE.CylinderGeometry(part.r1, part.r2, part.len, 7),
          handleMat
        );
        mesh.position.set(part.x, part.y, 0);
        mesh.rotation.z = part.zRot;
        group.add(mesh);
      }

      const mat = makeToolHeadMaterial(headType, 0.52);

      // Small metal eye/collar where the head passes over the handle.
      const eye = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.20, 0.13), mat);
      eye.position.set(0.12, 0.57, 0);
      eye.rotation.z = 0.10;
      group.add(eye);

      // Broad, slightly downward-swept wedge. The single low-poly extrusion gives it the
      // silhouette of the reference axe without trying to make a realistic high-poly blade.
      const bladeShape = new THREE.Shape();
      bladeShape.moveTo(0.14, 0.66);
      bladeShape.lineTo(0.48, 0.73);
      bladeShape.lineTo(0.68, 0.58);
      bladeShape.lineTo(0.55, 0.32);
      bladeShape.lineTo(0.26, 0.43);
      bladeShape.lineTo(0.10, 0.50);
      bladeShape.closePath();
      const bladeGeo = new THREE.ExtrudeGeometry(bladeShape, {
        depth: 0.13,
        bevelEnabled: false,
        curveSegments: 1,
        steps: 1
      });
      bladeGeo.translate(0, 0, -0.065);
      const blade = new THREE.Mesh(bladeGeo, mat);
      blade.rotation.z = 0.02;
      group.add(blade);

      group.scale.setScalar(scale * 1.25);
      return group;
    }

    // Low-poly pickaxe inspired by the supplied reference: a long wooden handle with a
    // chunky center eye and two broad, slightly drooping tapered picks.
    function createPickaxeVisual(scale = 1, headType = 'wood') {
      const actual = createActualPickaxeVisual(scale * 5.0, headType);
      if (actual) return actual;
      const group = new THREE.Group();
      const handleMat = new THREE.MeshStandardMaterial({ color: 0x8b5a32, roughness: 0.84 });

      const handle = new THREE.Mesh(
        new THREE.CylinderGeometry(0.070, 0.090, 1.32, 7),
        handleMat
      );
      handle.rotation.z = -0.08;
      handle.position.set(-0.04, -0.10, 0);
      group.add(handle);

      // Slightly thicker butt-cap to match the sturdy carved handle silhouette.
      const butt = new THREE.Mesh(new THREE.CylinderGeometry(0.095, 0.105, 0.18, 7), handleMat);
      butt.position.set(-0.10, -0.77, 0);
      butt.rotation.z = -0.08;
      group.add(butt);

      const mat = makeToolHeadMaterial(headType, 0.46);
      const eye = new THREE.Mesh(new THREE.BoxGeometry(0.20, 0.19, 0.14), mat);
      eye.position.set(0.08, 0.50, 0);
      eye.rotation.z = -0.04;
      group.add(eye);

      function addPick(points, x, rot = 0) {
        const shape = new THREE.Shape();
        shape.moveTo(points[0][0], points[0][1]);
        for (let i = 1; i < points.length; i++) shape.lineTo(points[i][0], points[i][1]);
        shape.closePath();
        const geo = new THREE.ExtrudeGeometry(shape, {
          depth: 0.13,
          bevelEnabled: false,
          curveSegments: 1,
          steps: 1
        });
        geo.translate(0, 0, -0.065);
        const mesh = new THREE.Mesh(geo, mat);
        mesh.position.x = x;
        mesh.rotation.z = rot;
        group.add(mesh);
      }

      // Broad shoulders into long pointed ends. They angle down just enough to echo the
      // reference without making the tool overly realistic.
      addPick([
        [-0.02, 0.58], [-0.44, 0.62], [-0.68, 0.48], [-0.79, 0.28],
        [-0.58, 0.39], [-0.18, 0.52]
      ], 0.08, -0.04);
      addPick([
        [0.02, 0.58], [0.44, 0.62], [0.68, 0.48], [0.79, 0.28],
        [0.58, 0.39], [0.18, 0.52]
      ], 0.08, 0.04);

      group.scale.setScalar(scale);
      return group;
    }


    function createFurnaceVisual(scale = 1) {
      if (furnaceModelTemplate) {
        const actual = furnaceModelTemplate.clone(true);
        // The supplied Blockbench mesh is 0.75 world units tall at scale 1;
        // boost it so the in-game furnace keeps approximately its old footprint.
        actual.scale.setScalar(scale * 1.30);
        return actual;
      }
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
      if (jerrycanModelTemplate) {
        const actual = jerrycanModelTemplate.clone(true);
        // The Blockbench source is ~1.67 world units tall at scale 1. A 0.63
        // wrapper factor keeps the in-game proportions close to the old can.
        actual.scale.setScalar(scale * 0.63);
        actual.rotation.y = Math.PI;
        return actual;
      }
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

    function createDrillVisual(scale = 1) {
      const group = new THREE.Group();
      const bodyMat = new THREE.MeshStandardMaterial({ color: 0x4f5559, roughness: 0.55, metalness: 0.42 });
      const darkMat = new THREE.MeshStandardMaterial({ color: 0x2b3034, roughness: 0.62, metalness: 0.38 });
      const copperMat = new THREE.MeshStandardMaterial({ color: 0xc86b32, roughness: 0.46, metalness: 0.62 });
      const gripMat = new THREE.MeshStandardMaterial({ color: 0x34383c, roughness: 0.92 });
      const body = new THREE.Mesh(new THREE.BoxGeometry(0.50, 0.30, 0.24), bodyMat);
      body.position.set(0.10, 0.30, 0); body.rotation.z = -0.08; group.add(body);
      const battery = new THREE.Mesh(new THREE.BoxGeometry(0.30, 0.18, 0.18), darkMat);
      battery.position.set(-0.05, 0.07, 0); group.add(battery);
      const grip = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.50, 0.18), gripMat);
      grip.position.set(0.00, -0.08, 0); grip.rotation.z = -0.24; group.add(grip);
      const trigger = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.12, 0.10), copperMat);
      trigger.position.set(0.08, 0.10, 0.12); group.add(trigger);
      const collar = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.14, 0.12, 12), copperMat);
      collar.rotation.z = Math.PI / 2; collar.position.set(0.39, 0.30, 0); group.add(collar);
      const chuck = new THREE.Mesh(new THREE.CylinderGeometry(0.10, 0.09, 0.18, 10), darkMat);
      chuck.rotation.z = Math.PI / 2; chuck.position.set(0.52, 0.30, 0); group.add(chuck);
      const bit = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.035, 0.34, 8), new THREE.MeshStandardMaterial({ color: 0x9aa0a5, roughness: 0.35, metalness: 0.85 }));
      bit.rotation.z = Math.PI / 2; bit.position.set(0.76, 0.30, 0); group.add(bit);
      group.scale.setScalar(scale);
      return group;
    }

    function createCopperWireVisual(scale = 1) {
      const group = new THREE.Group();
      const mat = new THREE.MeshStandardMaterial({ color: 0xd47a3d, roughness: 0.42, metalness: 0.72 });
      for (let i = 0; i < 3; i++) {
        const coil = new THREE.Mesh(new THREE.TorusGeometry(0.11, 0.025, 6, 14), mat);
        coil.rotation.x = Math.PI / 2;
        coil.position.set((i - 1) * 0.11, 0.10 + i * 0.045, 0);
        group.add(coil);
      }
      group.scale.setScalar(scale);
      return group;
    }

    function createJournalVisual(scale = 1) {
      const group = new THREE.Group();
      const coverMat = new THREE.MeshStandardMaterial({ color: 0x5b3b29, roughness: 0.86, metalness: 0.03 });
      const pageMat = new THREE.MeshStandardMaterial({ color: 0xe7d7ae, roughness: 0.98 });
      const spineMat = new THREE.MeshStandardMaterial({ color: 0x3d271d, roughness: 0.92 });
      const cover = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.68, 0.10), coverMat);
      cover.rotation.z = -0.12;
      cover.position.y = 0.04;
      group.add(cover);
      const pages = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.59, 0.085), pageMat);
      pages.rotation.z = -0.12;
      pages.position.set(0.045, 0.04, 0.014);
      group.add(pages);
      const spine = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.70, 0.12), spineMat);
      spine.rotation.z = -0.12;
      spine.position.set(-0.245, 0.04, 0.005);
      group.add(spine);
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
        fpModel = createAxeVisual(0.92, headType, typeId === 'axe');
        tpModel = createAxeVisual(0.66, headType, typeId === 'axe');
      } else if (typeId === 'wooden_pickaxe' || typeId === 'stone_pickaxe' || typeId === 'iron_pickaxe') {
        const headType = typeId === 'stone_pickaxe' ? 'stone' : (typeId === 'iron_pickaxe' ? 'iron' : 'wood');
        fpModel = createPickaxeVisual(0.92, headType);
        tpModel = createPickaxeVisual(0.66, headType);
      } else if (typeId === 'wooden_scythe' || typeId === 'stone_scythe' || typeId === 'iron_scythe') {
        const headType = typeId === 'stone_scythe' ? 'stone' : (typeId === 'iron_scythe' ? 'iron' : 'wood');
        fpModel = createScytheVisual(0.88, headType);
        tpModel = createScytheVisual(0.64, headType);
        // Lower the scythe slightly in the hand so the long shaft/blade sit lower in
        // the first-person view instead of appearing to float in the middle of the screen.
        fpModel.position.y -= 0.12;
        tpModel.position.y -= 0.05;
      } else if (typeId === 'drill') {
        fpModel = createDrillVisual(0.90);
        tpModel = createDrillVisual(0.64);
      } else if (typeId === 'iron_wrench' || typeId === 'titanium_wrench') {
        const tier = typeId === 'titanium_wrench' ? 'titanium' : 'iron';
        fpModel = createWrenchVisual(0.86, tier);
        tpModel = createWrenchVisual(0.62, tier);
        // Lower the custom wrench slightly in both views so the tool stays visible
        // instead of sitting too high behind the player's view/hand.
        fpModel.position.y -= 0.12;
        tpModel.position.y -= 0.05;
      } else if (itemById[typeId]?.kind === 'blueprint') {
        fpModel = createBlueprintVisual(0.80);
        tpModel = createBlueprintVisual(0.58);
        fpModel.position.y -= 0.05;
        tpModel.position.y -= 0.02;
      } else if (typeId === 'backpack') {
        fpModel = createBackpackVisual(0.74);
        tpModel = createBackpackVisual(0.52);
      } else if (crystalById[typeId]) {
        fpModel = createCrystalVisual(typeId, false, 0.85);
        tpModel = createCrystalVisual(typeId, false, 0.58);
      } else if (typeId === 'container') {
        fpModel = createContainerVisual(0.78);
        tpModel = createContainerVisual(0.54);
      } else if (typeId === 'jerrycan') {
        fpModel = createJerrycanVisual(0.85);
        tpModel = createJerrycanVisual(0.60);
      } else if (typeId === 'journal') {
        fpModel = createJournalVisual(0.86);
        tpModel = createJournalVisual(0.62);
      } else if (typeId === 'warp_drive') {
        const warpVisual = (scale) => { const g=new THREE.Group(); const core=new THREE.Mesh(new THREE.SphereGeometry(.22,12,10),new THREE.MeshStandardMaterial({color:0x59ceff,emissive:0x198ac1,emissiveIntensity:1.4,metalness:.35,roughness:.25})); const ring=new THREE.Mesh(new THREE.TorusGeometry(.3,.05,8,20),new THREE.MeshStandardMaterial({color:0xdaf5ff,emissive:0x3f9fc8,emissiveIntensity:.8,metalness:.55,roughness:.25})); ring.rotation.x=Math.PI/2; g.add(core,ring); g.scale.setScalar(scale); return g; };
        fpModel=warpVisual(.9); tpModel=warpVisual(.65);
      } else {
        return;
      }
      heldCrystalFirstPerson.add(fpModel);
      heldCrystalThirdPerson.add(tpModel);
      heldCrystalFirstPerson.visible = !playerState.thirdPerson;
      heldCrystalThirdPerson.visible = playerState.thirdPerson;
      updatePlayerHatVisibility();
    }

    function createScytheVisual(scale = 1, headType = 'wood') {
      if (scytheModelTemplate) {
        const actual = scytheModelTemplate.clone(true);
        actual.traverse((node) => {
          if (!node.isMesh) return;
          if (node.material && node.material.clone) node.material = node.material.clone();
          const mat = node.material;
          if (!mat || !mat.color) return;
          if (node.name === 'ScytheBlade' || String(mat.name || '').toLowerCase().includes('blade')) {
            const bladeColor = headType === 'wood' ? 0x6b462f : headType === 'stone' ? 0x90979d : 0x4b525a;
            mat.color.setHex(bladeColor);
            mat.roughness = headType === 'wood' ? 0.74 : 0.42;
            mat.metalness = headType === 'wood' ? 0.06 : 0.55;
          } else {
            mat.color.setHex(0x7a4d2c);
            mat.roughness = 0.88;
            mat.metalness = 0.03;
          }
          mat.side = THREE.DoubleSide;
        });
        // The supplied model is held with the blade facing inward in the source pose.
        // Rotate the finished scythe 180 degrees around its vertical axis so the crescent
        // blade points outward from the player's hand while keeping the shaft upright.
        actual.scale.setScalar(scale * 0.055);
        actual.rotation.set(0, Math.PI, -0.10);
        return actual;
      }

      const group = new THREE.Group();
      const handleMat = new THREE.MeshStandardMaterial({ color: 0x8b5a32, roughness: 0.82 });
      const handle = new THREE.Mesh(
        new THREE.CylinderGeometry(0.048, 0.068, 1.42, 10),
        handleMat
      );
      handle.rotation.z = -0.10;
      handle.position.set(-0.02, -0.08, 0);
      group.add(handle);

      const mat = makeToolHeadMaterial(headType, 0.52);
      const collar = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.075, 0.13, 10), mat);
      collar.rotation.z = Math.PI / 2;
      collar.position.set(0.09, 0.62, 0);
      group.add(collar);

      const bladeShape = new THREE.Shape();
      bladeShape.moveTo(0.07, 0.66);
      bladeShape.quadraticCurveTo(0.46, 0.78, 0.84, 0.64);
      bladeShape.quadraticCurveTo(1.02, 0.57, 1.03, 0.39);
      bladeShape.quadraticCurveTo(1.00, 0.24, 0.88, 0.10);
      bladeShape.quadraticCurveTo(0.78, 0.00, 0.66, 0.00);
      bladeShape.quadraticCurveTo(0.78, 0.16, 0.78, 0.31);
      bladeShape.quadraticCurveTo(0.76, 0.47, 0.59, 0.54);
      bladeShape.quadraticCurveTo(0.34, 0.64, 0.07, 0.57);
      bladeShape.closePath();

      const bladeGeo = new THREE.ExtrudeGeometry(bladeShape, { depth: 0.075, bevelEnabled: false });
      bladeGeo.translate(0, 0, -0.0375);
      const blade = new THREE.Mesh(bladeGeo, mat);
      blade.position.set(0.02, 0, 0);
      group.add(blade);

      group.scale.setScalar(scale);
      return group;
    }

    function createBackpackVisual(scale = 1) {
      const group = new THREE.Group();
      const bundleMat = new THREE.MeshStandardMaterial({ color: 0x9a7849, roughness: 1 });
      const ropeMat = new THREE.MeshStandardMaterial({ color: 0x5f4327, roughness: 0.95 });
      for (let i = 0; i < 4; i++) {
        const bale = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.22, 0.52, 8), bundleMat);
        bale.rotation.z = (i - 1.5) * 0.18;
        bale.position.set((i - 1.5) * 0.15, 0.20 + Math.abs(i - 1.5) * 0.02, 0);
        group.add(bale);
      }
      const rope = new THREE.Mesh(new THREE.TorusGeometry(0.34, 0.025, 6, 18, Math.PI * 1.15), ropeMat);
      rope.rotation.x = Math.PI / 2;
      rope.rotation.z = Math.PI / 2;
      rope.position.y = 0.32;
      group.add(rope);
      group.scale.setScalar(scale);
      return group;
    }

    function createBlueprintVisual(scale = 1) {
      if (blueprintModelTemplate) {
        const group = blueprintModelTemplate.clone(true);
        group.traverse((node) => {
          if (!node.isMesh) return;
          if (node.material && node.material.clone) node.material = node.material.clone();
          if (node.material) {
            node.material.side = THREE.DoubleSide;
            node.material.transparent = true;
          }
        });
        group.scale.setScalar(scale * 0.90);
        group.rotation.set(-0.08, 0.12, -0.08);
        return group;
      }
      const fallback = new THREE.Group();
      const paper = new THREE.MeshStandardMaterial({ color: 0x2f63ff, roughness: 0.72, metalness: 0.0, side: THREE.DoubleSide });
      const sheet = new THREE.Mesh(new THREE.BoxGeometry(0.58, 0.82, 0.035), paper);
      sheet.rotation.z = -0.10;
      fallback.add(sheet);
      fallback.scale.setScalar(scale);
      return fallback;
    }

    function createWrenchVisual(scale = 1, tier = 'iron') {
      if (wrenchModelTemplate) {
        const group = wrenchModelTemplate.clone(true);
        const metalColor = tier === 'titanium' ? 0x8fb9d2 : 0x8c939a;
        const emissiveColor = tier === 'titanium' ? 0x163d52 : 0x202830;
        group.traverse((node) => {
          if (!node.isMesh) return;
          node.material = new THREE.MeshStandardMaterial({
            color: metalColor,
            roughness: 0.34,
            metalness: 0.86,
            emissive: emissiveColor,
            emissiveIntensity: tier === 'titanium' ? 0.16 : 0.06,
            side: THREE.DoubleSide
          });
          node.frustumCulled = false;
        });
        group.scale.setScalar(scale * 2.6);
        // Blockbench model is thin on X and wide on Z; the embedded model already rotates
        // into the same hand-facing orientation as the existing placeholder wrench.
        group.rotation.z = -0.10;
        return group;
      }
      const group = new THREE.Group();
      const metalColor = tier === 'titanium' ? 0x8fb9d2 : 0x8c939a;
      const emissiveColor = tier === 'titanium' ? 0x163d52 : 0x202830;
      const metal = new THREE.MeshStandardMaterial({ color: metalColor, roughness: 0.34, metalness: 0.86, emissive: emissiveColor, emissiveIntensity: tier === 'titanium' ? 0.16 : 0.06 });
      const dark = new THREE.MeshStandardMaterial({ color: tier === 'titanium' ? 0x5f7f91 : 0x555b61, roughness: 0.42, metalness: 0.88 });
      const handle = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.78, 0.09), metal);
      handle.position.y = -0.04;
      handle.rotation.z = -0.16;
      group.add(handle);
      const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.095, 0.11, 0.33, 8), dark);
      grip.position.set(0.05, -0.43, 0);
      grip.rotation.z = -0.16;
      group.add(grip);
      const jaw = new THREE.Mesh(new THREE.TorusGeometry(0.19, 0.072, 8, 18, Math.PI * 1.48), metal);
      jaw.rotation.z = Math.PI * 0.58;
      jaw.position.set(-0.07, 0.38, 0);
      group.add(jaw);
      const innerCut = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.14, 0.11), new THREE.MeshStandardMaterial({ color: 0x20262c, roughness: 0.9, metalness: 0.15 }));
      innerCut.position.set(-0.19, 0.46, 0);
      innerCut.rotation.z = -0.32;
      group.add(innerCut);
      group.scale.setScalar(scale);
      return group;
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

    // Tool swing animation state. The held-item groups keep their existing base pose while
    // an action briefly rotates/translates them through a responsive swing arc.
    const toolSwingState = { active: false, startedAt: 0, duration: 240, strength: 1.0 };
    const toolImpactState = { active: false, startedAt: 0, duration: 90, strength: 1.0 };
    const toolSwingBase = {
      fpPosition: heldCrystalFirstPerson.position.clone(),
      fpRotation: heldCrystalFirstPerson.rotation.clone(),
      tpPosition: heldCrystalThirdPerson.position.clone(),
      tpRotation: heldCrystalThirdPerson.rotation.clone()
    };

    // The player is intentionally a simple capsule, so jump/landing feedback is shown through
    // the held item instead of a full character rig.
    const heldItemJumpAnim = {
      wasGrounded: true,
      landingStartedAt: -Infinity,
      landingDuration: 180
    };

    // Walking/sprinting held-item bob. This is layered after the swing and jump animations
    // so it adds motion without resetting either action. The bob is deliberately subtle at
    // walking speed and a little stronger/faster while sprinting.
    const heldItemBobAnim = {
      phase: 0,
      strength: 0
    };

    function triggerToolSwing(strength = 1.0, duration = 240) {
      toolSwingState.active = true;
      toolSwingState.startedAt = performance.now();
      toolSwingState.duration = duration;
      toolSwingState.strength = strength;
    }

    function triggerToolImpact(strength = 1.0) {
      toolImpactState.active = true;
      toolImpactState.startedAt = performance.now();
      toolImpactState.strength = strength;
    }

    function getToolImpactPulse() {
      if (!toolImpactState.active) return 0;
      const t = (performance.now() - toolImpactState.startedAt) / toolImpactState.duration;
      if (t >= 1) {
        toolImpactState.active = false;
        return 0;
      }
      // Quick punch, followed by a fast settle.
      return Math.sin(Math.PI * t) * toolImpactState.strength;
    }

    function updateToolSwing() {
      const selected = uiState.equippedItemType;
      const isTool = selected === 'axe' || selected === 'wooden_axe' || selected === 'stone_axe' || selected === 'iron_axe' ||
        selected === 'wooden_pickaxe' || selected === 'stone_pickaxe' || selected === 'iron_pickaxe' ||
        selected === 'wooden_scythe' || selected === 'stone_scythe' || selected === 'iron_scythe' || selected === 'drill';

      // Always restore the exact resting pose when no tool action is active.
      if (!toolSwingState.active || !isTool) {
        heldCrystalFirstPerson.position.copy(toolSwingBase.fpPosition);
        heldCrystalFirstPerson.rotation.copy(toolSwingBase.fpRotation);
        heldCrystalThirdPerson.position.copy(toolSwingBase.tpPosition);
        heldCrystalThirdPerson.rotation.copy(toolSwingBase.tpRotation);
        return;
      }

      const t = (performance.now() - toolSwingState.startedAt) / toolSwingState.duration;
      if (t >= 1) {
        toolSwingState.active = false;
        heldCrystalFirstPerson.position.copy(toolSwingBase.fpPosition);
        heldCrystalFirstPerson.rotation.copy(toolSwingBase.fpRotation);
        heldCrystalThirdPerson.position.copy(toolSwingBase.tpPosition);
        heldCrystalThirdPerson.rotation.copy(toolSwingBase.tpRotation);
        return;
      }

      const s = toolSwingState.strength;
      const isScytheSwing = isScythe(selected);

      if (isScytheSwing) {
        // Give the scythe a genuine harvesting swing: a small wind-up, a fast
        // side-to-side cutting sweep, then a soft return to the resting pose.
        let arc = 0;
        let sweep = 0;
        if (t < 0.28) {
          const p = t / 0.28;
          const eased = 1 - Math.pow(1 - p, 3);
          arc = THREE.MathUtils.lerp(0, 0.62, eased);
          sweep = eased;
        } else if (t < 0.72) {
          const p = (t - 0.28) / 0.44;
          const eased = p * p * (3 - 2 * p);
          arc = THREE.MathUtils.lerp(0.62, -0.98, eased);
          sweep = 1 + eased;
        } else {
          const p = (t - 0.72) / 0.28;
          const eased = 1 - Math.pow(1 - p, 3);
          arc = THREE.MathUtils.lerp(-0.98, 0, eased);
          sweep = 2 - eased;
        }

        heldCrystalFirstPerson.position.copy(toolSwingBase.fpPosition);
        heldCrystalFirstPerson.position.x += (sweep - 1) * 0.055 * s;
        heldCrystalFirstPerson.position.y -= Math.sin(Math.PI * t) * 0.035 * s;
        heldCrystalFirstPerson.position.z -= Math.sin(Math.PI * t) * 0.055 * s;
        heldCrystalFirstPerson.rotation.copy(toolSwingBase.fpRotation);
        heldCrystalFirstPerson.rotation.z += arc * s;
        heldCrystalFirstPerson.rotation.x -= Math.sin(Math.PI * t) * 0.22 * s;

        heldCrystalThirdPerson.position.copy(toolSwingBase.tpPosition);
        heldCrystalThirdPerson.position.x += (sweep - 1) * 0.045 * s;
        heldCrystalThirdPerson.position.y -= Math.sin(Math.PI * t) * 0.03 * s;
        heldCrystalThirdPerson.position.z -= Math.sin(Math.PI * t) * 0.045 * s;
        heldCrystalThirdPerson.rotation.copy(toolSwingBase.tpRotation);
        heldCrystalThirdPerson.rotation.z += arc * 0.82 * s;
        heldCrystalThirdPerson.rotation.x -= Math.sin(Math.PI * t) * 0.16 * s;
      } else {
        // Smooth out/back arc: quick strike, then a softer return to the resting pose.
        const strike = Math.sin(Math.PI * t);

        heldCrystalFirstPerson.position.copy(toolSwingBase.fpPosition);
        heldCrystalFirstPerson.position.y -= strike * 0.10 * s;
        heldCrystalFirstPerson.position.z -= strike * 0.10 * s;
        heldCrystalFirstPerson.rotation.copy(toolSwingBase.fpRotation);
        heldCrystalFirstPerson.rotation.x -= strike * 1.05 * s;
        heldCrystalFirstPerson.rotation.z += strike * 0.20 * s;

        heldCrystalThirdPerson.position.copy(toolSwingBase.tpPosition);
        heldCrystalThirdPerson.position.y -= strike * 0.09 * s;
        heldCrystalThirdPerson.position.z -= strike * 0.08 * s;
        heldCrystalThirdPerson.rotation.copy(toolSwingBase.tpRotation);
        heldCrystalThirdPerson.rotation.x -= strike * 0.90 * s;
        heldCrystalThirdPerson.rotation.z += strike * 0.16 * s;
      }

      const impactPulse = getToolImpactPulse();
      if (impactPulse > 0) {
        heldCrystalFirstPerson.position.z += impactPulse * 0.055;
        heldCrystalFirstPerson.rotation.x += impactPulse * 0.16;
        heldCrystalThirdPerson.position.z += impactPulse * 0.045;
        heldCrystalThirdPerson.rotation.x += impactPulse * 0.12;
      }
    }


    function updateHeldItemJumpAnimation() {
      const airborne = playerState.heightOffset > 0.02;
      const now = performance.now();
      if (heldItemJumpAnim.wasGrounded && airborne && playerState.verticalVelocity > 0) {
        // Takeoff: a tiny upward/backward lift keeps the action responsive without obscuring the view.
      }
      if (!heldItemJumpAnim.wasGrounded && !airborne) {
        heldItemJumpAnim.landingStartedAt = now;
      }

      let lift = 0;
      let tilt = 0;
      if (airborne) {
        const heightFactor = Math.min(1, playerState.heightOffset / 1.35);
        lift = heightFactor * 0.055 + THREE.MathUtils.clamp(playerState.verticalVelocity * 0.003, -0.03, 0.03);
        tilt = -THREE.MathUtils.clamp(playerState.verticalVelocity * 0.010, -0.08, 0.08);
      }

      const landingAge = now - heldItemJumpAnim.landingStartedAt;
      if (landingAge >= 0 && landingAge < heldItemJumpAnim.landingDuration) {
        const t = landingAge / heldItemJumpAnim.landingDuration;
        const pulse = Math.sin(Math.PI * t);
        lift -= pulse * 0.07;
        tilt += pulse * 0.10;
      }

      // updateToolSwing() runs immediately before this function, so its base pose (plus any
      // active swing) is already applied. Add the jump/landing motion on top of that pose.
      if (heldCrystalFirstPerson.visible) {
        heldCrystalFirstPerson.position.y += lift;
        heldCrystalFirstPerson.position.z -= lift * 0.35;
        heldCrystalFirstPerson.rotation.x += tilt;
      }
      if (heldCrystalThirdPerson.visible) {
        heldCrystalThirdPerson.position.y += lift * 0.9;
        heldCrystalThirdPerson.position.z -= lift * 0.25;
        heldCrystalThirdPerson.rotation.x += tilt * 0.9;
      }

      heldItemJumpAnim.wasGrounded = !airborne;
    }

    function updateHeldItemBob(delta) {
      if (state.gameState !== 'playing' || state.paused || playerState.inRocket) {
        heldItemBobAnim.strength = THREE.MathUtils.damp(heldItemBobAnim.strength, 0, 14, delta);
        return;
      }

      const selected = uiState.equippedItemType;
      const hasHeldItem = !!selected;
      if (!hasHeldItem) {
        heldItemBobAnim.strength = THREE.MathUtils.damp(heldItemBobAnim.strength, 0, 16, delta);
        return;
      }

      const moving = isActionDown('moveForward') || isActionDown('moveBackward') || isActionDown('moveLeft') || isActionDown('moveRight');
      const grounded = playerState.heightOffset <= 0.02 && Math.abs(playerState.verticalVelocity) < 0.45;
      const sprinting = isActionDown('sprint');
      const wantsBob = moving && grounded;
      const targetStrength = wantsBob ? (sprinting ? 1.0 : 0.62) : 0;
      heldItemBobAnim.strength = THREE.MathUtils.damp(heldItemBobAnim.strength, targetStrength, 16, delta);

      // Even when standing still, give the held item a tiny breathing/idle motion.
      // This is deliberately much subtler than the walking bob.
      if (!moving || !grounded) {
        heldItemBobAnim.phase += delta * 1.6;
        const idleWave = Math.sin(heldItemBobAnim.phase);
        const idleSide = Math.sin(heldItemBobAnim.phase * 0.7) * 0.5;
        if (heldCrystalFirstPerson.visible) {
          heldCrystalFirstPerson.position.y += idleWave * 0.0045;
          heldCrystalFirstPerson.position.x += idleSide * 0.0022;
          heldCrystalFirstPerson.rotation.z += idleSide * 0.008;
          heldCrystalFirstPerson.rotation.y += idleWave * 0.006;
        }
        if (heldCrystalThirdPerson.visible) {
          heldCrystalThirdPerson.position.y += idleWave * 0.0065;
          heldCrystalThirdPerson.position.x += idleSide * 0.003;
          heldCrystalThirdPerson.rotation.z += idleSide * 0.010;
          heldCrystalThirdPerson.rotation.y += idleWave * 0.008;
        }
        return;
      }

      if (heldItemBobAnim.strength < 0.001) return;

      // Sprinting gets a faster cadence and a slightly larger bob.
      const cadence = sprinting ? 11.0 : 7.5;
      heldItemBobAnim.phase += delta * cadence;
      const wave = Math.sin(heldItemBobAnim.phase);
      const sideWave = Math.sin(heldItemBobAnim.phase * 2) * 0.35;
      const s = heldItemBobAnim.strength;

      if (heldCrystalFirstPerson.visible) {
        heldCrystalFirstPerson.position.y += wave * 0.020 * s;
        heldCrystalFirstPerson.position.x += sideWave * 0.010 * s;
        heldCrystalFirstPerson.position.z += Math.abs(wave) * 0.010 * s;
        heldCrystalFirstPerson.rotation.z += sideWave * 0.028 * s;
        heldCrystalFirstPerson.rotation.y += wave * 0.018 * s;
      }
      if (heldCrystalThirdPerson.visible) {
        heldCrystalThirdPerson.position.y += wave * 0.030 * s;
        heldCrystalThirdPerson.position.x += sideWave * 0.014 * s;
        heldCrystalThirdPerson.position.z += Math.abs(wave) * 0.014 * s;
        heldCrystalThirdPerson.rotation.z += sideWave * 0.035 * s;
        heldCrystalThirdPerson.rotation.y += wave * 0.020 * s;
      }
    }

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
    const backpackSlots = window.PocketUniverseInventoryState.backpackSlots;
    let activeBackpackItem = null;
    let nextBackpackId = 1;

    function createBackpackStorage() {
      return Array.from({ length: window.PocketUniverseInventoryState.backpackSlotCount }, () => null);
    }

    function createBackpackItem(storage = null, backpackId = null) {
      const id = backpackId || ('backpack_' + (nextBackpackId++));
      const parsedId = /^backpack_(\d+)$/.exec(id);
      if (parsedId) nextBackpackId = Math.max(nextBackpackId, Number(parsedId[1]) + 1);
      return {
        typeId: 'backpack',
        count: 1,
        backpackId: id,
        storage: Array.isArray(storage) && storage.length === backpackSlots.length ? storage.map(slot => slot ? { ...slot } : null) : createBackpackStorage()
      };
    }

    function normalizeBackpackItem(item) {
      if (!item || item.typeId !== 'backpack') return item;
      if (!item.backpackId || !Array.isArray(item.storage) || item.storage.length !== backpackSlots.length) {
        const replacement = createBackpackItem(item.storage, item.backpackId);
        Object.assign(item, replacement);
      } else {
        const parsedId = /^backpack_(\d+)$/.exec(item.backpackId);
        if (parsedId) nextBackpackId = Math.max(nextBackpackId, Number(parsedId[1]) + 1);
      }
      return item;
    }

    function commitActiveBackpackStorage() {
      if (!activeBackpackItem) return;
      normalizeBackpackItem(activeBackpackItem);
      activeBackpackItem.storage = backpackSlots.map(slot => slot ? { ...slot } : null);
    }

    function loadBackpackStorage(backpackItem) {
      normalizeBackpackItem(backpackItem);
      for (let i = 0; i < backpackSlots.length; i++) backpackSlots[i] = backpackItem.storage[i] ? { ...backpackItem.storage[i] } : null;
    }
    // Cache backpack UI elements before any early UI refresh can reference them.
    const backpackStorage = document.getElementById('backpackStorage');
    const backpackSlotsEl = document.getElementById('backpackSlots');
    const backpackClose = document.getElementById('backpackClose');
    // Must exist before the first early backpack UI refresh.
    let backpackOpen = false;

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

    function addItemToInventory(typeId, amount = 1, durability = null, pickupFeedback = false) {
      const item = itemById[typeId];
      if (!item || amount <= 0) return false;
      // Any successful pickup/craft/purchase becomes a permanent journal discovery.
      const journalWasNew = !journalDiscoveredItems.has(typeId);
      if (typeId === 'backpack') {
        let remaining = Math.floor(amount);
        for (let i = 0; i < INVENTORY_SLOT_COUNT && remaining > 0; i++) {
          if (inventorySlots[i]) continue;
          inventorySlots[i] = createBackpackItem();
          remaining--;
        }
        updateHotbarUI();
        updateInventoryUI();
        refreshEquippedItem();
        const success = remaining === 0;
        if (success && journalWasNew) markJournalItemDiscovered(typeId);
        if (success && pickupFeedback) showInventoryPickupPopup(typeId, amount);
        return success;
      }

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
      const success = remaining === 0;
      if (success && journalWasNew) markJournalItemDiscovered(typeId);
      if (success && pickupFeedback) showInventoryPickupPopup(typeId, amount);
      return success;
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
        + ((typeId === 'iron_axe' || typeId === 'iron_pickaxe' || typeId === 'iron_scythe') ? ' ironTool' : '')
        + ((typeId === 'wooden_scythe') ? ' woodenTool' : '')
        + ((typeId === 'stone_scythe') ? ' stoneTool' : '');
      if (data.kind === 'crystal') {
        icon.style.background = data.css;
        icon.style.boxShadow = '0 0 12px ' + data.css;
      }
      if (data.kind === 'tungsten_ore') { icon.style.background = 'linear-gradient(135deg,#8e857b 0%,#6c6057 50%,#a45f3d 51%,#4d4947 100%)'; icon.style.boxShadow = '0 0 10px rgba(164,95,61,.35)'; }
      if (data.kind === 'tungsten_ingot') { icon.style.background = 'linear-gradient(145deg,#928c87,#4e4b49 72%)'; icon.style.boxShadow = 'inset 0 1px 0 rgba(255,255,255,.18),0 0 8px rgba(120,116,110,.25)'; }
      if (data.kind === 'titanium_ore') { icon.style.background = 'linear-gradient(135deg,#d7e6f2 0%,#8196a8 38%,#c4d8e6 56%,#5d7182 100%)'; icon.style.boxShadow = '0 0 10px rgba(160,200,230,.45)'; }
      if (data.kind === 'titanium_ingot') { icon.style.background = 'linear-gradient(145deg,#eef7ff,#9eb0bf 65%,#dce8f0)'; icon.style.boxShadow = 'inset 0 1px 0 rgba(255,255,255,.45),0 0 10px rgba(190,220,240,.36)'; }
      if (data.kind === 'iron_plate') { icon.style.background = 'linear-gradient(145deg,#cbd0d5 0%,#6e747a 62%,#aeb5bb 100%)'; icon.style.boxShadow = 'inset 0 1px 0 rgba(255,255,255,.25),0 0 8px rgba(160,170,180,.24)'; }
      if (data.kind === 'titanium_plate') { icon.style.background = 'linear-gradient(145deg,#f7fcff 0%,#9eb2c1 58%,#dce8ef 100%)'; icon.style.boxShadow = 'inset 0 1px 0 rgba(255,255,255,.4),0 0 9px rgba(180,215,235,.34)'; }
      if (data.kind === 'wrench') { icon.classList.add(data.wrenchTier === 'titanium' ? 'titaniumWrench' : 'ironWrench'); icon.innerHTML = '<span class="wrenchIconGlyph"></span>'; }
      if (data.kind === 'container') {
        const tex = window.PocketUniverseContainerTextureDataURL;
        if (tex) { icon.style.backgroundImage = 'url("' + tex + '")'; icon.style.backgroundSize = 'contain'; icon.style.backgroundPosition = 'center'; icon.style.backgroundRepeat = 'no-repeat'; icon.style.imageRendering = 'pixelated'; icon.style.backgroundColor = 'rgba(82,95,105,.18)'; icon.style.boxShadow = 'inset 0 1px 0 rgba(255,255,255,.12), 0 0 10px rgba(150,170,185,.22)'; }
      }
      if (data.kind === 'blueprint') {
        icon.style.backgroundImage = 'url("models/Blueprint.png")';
        icon.style.backgroundSize = 'contain';
        icon.style.backgroundPosition = 'center';
        icon.style.backgroundRepeat = 'no-repeat';
        icon.style.imageRendering = 'pixelated';
        icon.style.backgroundColor = '#1737a8';
        icon.style.boxShadow = '0 0 14px rgba(68,120,255,.58)';
      }
      if (data.kind === 'warp_drive') { icon.style.background = 'radial-gradient(circle at 50% 50%,#f5fbff 0 10%,#66cfff 12% 24%,#174a78 27% 45%,#1b1f27 47% 100%)'; icon.style.boxShadow = '0 0 14px rgba(70,190,255,.65)'; }
      if (data.kind === 'warp_drive_mk2') { icon.style.background = 'radial-gradient(circle at 50% 50%,#fff1ff 0 10%,#ff82ea 12% 24%,#6f2d75 27% 45%,#211927 47% 100%)'; icon.style.boxShadow = '0 0 14px rgba(255,108,232,.62)'; }
      if (data.kind === 'engine_mark_3') { icon.style.background = 'linear-gradient(145deg,#f5fbff 0%,#9ed9ef 42%,#d7eef8 60%,#6f8794 100%)'; icon.style.boxShadow = '0 0 12px rgba(175,225,245,.5)'; }
      // Dedicated CSS icons are used for special multi-part items too.
      // Keeping this function data-driven means inventory, hotbar, and journal
      // entries all render the same item identity.
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
        slot.addEventListener('contextmenu', (e) => {
          const held = inventorySlots[getHotbarInventoryIndex(index)];
          if (held && held.typeId === 'journal') { e.preventDefault(); e.stopPropagation(); openJournal(false); return; }
          if (held && held.typeId === 'backpack') {
            e.preventDefault(); e.stopPropagation(); openBackpackStorage(held);
          }
        });
      });
    }

    let inventoryFeedbackInitialized = false;
    let previousInventoryFeedback = [];

    function inventoryFeedbackSignature(slotData) {
      if (!slotData) return 'empty';
      return [slotData.typeId || '', slotData.count || 0, slotData.durability == null ? '' : slotData.durability].join('|');
    }

    function hideInventoryTooltip() {
      const tooltip = document.getElementById('inventoryTooltip');
      if (!tooltip) return;
      tooltip.classList.remove('show');
      tooltip.classList.add('hidden');
      tooltip.setAttribute('aria-hidden', 'true');
    }

    function positionInventoryTooltip(clientX, clientY) {
      const tooltip = document.getElementById('inventoryTooltip');
      if (!tooltip || tooltip.classList.contains('hidden')) return;
      if (typeof clientX !== 'number' || typeof clientY !== 'number') return;
      const pad = 12;
      const gap = 14;
      const rect = tooltip.getBoundingClientRect();
      // Follow the actual mouse cursor, keeping the tooltip fully inside the viewport.
      let left = clientX + gap;
      let top = clientY + gap;
      if (left + rect.width > window.innerWidth - pad) left = clientX - rect.width - gap;
      if (top + rect.height > window.innerHeight - pad) top = clientY - rect.height - gap;
      left = Math.max(pad, Math.min(left, window.innerWidth - rect.width - pad));
      top = Math.max(pad, Math.min(top, window.innerHeight - rect.height - pad));
      tooltip.style.left = left + 'px';
      tooltip.style.top = top + 'px';
    }

    function showInventoryTooltip(slotData, slotEl, event) {
      const tooltip = document.getElementById('inventoryTooltip');
      if (!tooltip || !slotData || !slotEl || !event) return;
      // Keep the tooltip directly under <body>. The inventory panel uses backdrop-filter,
      // which can establish a containing block for position:fixed descendants.
      // Appending it to body guarantees clientX/clientY use the same viewport as the cursor.
      if (tooltip.parentElement !== document.body) document.body.appendChild(tooltip);
      const item = itemById[slotData.typeId];
      if (!item) return;
      const journalInfo = JOURNAL_ITEM_INFO[slotData.typeId];
      const parts = ['x' + slotData.count];
      if (item.tool) {
        const maxDurability = getToolMaxDurability(item);
        const durability = Math.max(0, Math.min(maxDurability, slotData.durability == null ? maxDurability : slotData.durability));
        parts.push('DURABILITY ' + durability + '/' + maxDurability);
      }
      tooltip.innerHTML = '<div class="inventoryTooltipName">' + item.name + '</div>' +
        '<div class="inventoryTooltipDescription">' + (journalInfo?.description || 'An item stored in your inventory.') + '</div>' +
        '<div class="inventoryTooltipMeta"><span>' + parts.join('</span><span>') + '</span></div>';
      tooltip.classList.remove('hidden');
      tooltip.setAttribute('aria-hidden', 'false');
      requestAnimationFrame(() => {
        tooltip.classList.add('show');
        positionInventoryTooltip(event.clientX, event.clientY);
      });
    }

    function showInventoryPickupPopup(typeId, amount = 1) {
      const stack = document.getElementById('inventoryPickupStack');
      const item = itemById[typeId];
      if (!stack || !item || amount <= 0) return;
      const popup = document.createElement('div');
      popup.className = 'inventoryPickupPopup';

      const iconWrap = document.createElement('div');
      iconWrap.className = 'inventoryPickupPopupIcon';
      iconWrap.appendChild(makeItemIconElement(typeId, 'inventoryPickupPopupItem'));
      popup.appendChild(iconWrap);

      const textWrap = document.createElement('div');
      textWrap.className = 'inventoryPickupPopupText';
      const label = document.createElement('div');
      label.className = 'inventoryPickupPopupLabel';
      label.textContent = 'PICKED UP';
      const name = document.createElement('div');
      name.className = 'inventoryPickupPopupName';
      name.textContent = item.name;
      textWrap.appendChild(label);
      textWrap.appendChild(name);
      popup.appendChild(textWrap);

      const amountEl = document.createElement('div');
      amountEl.className = 'inventoryPickupPopupAmount';
      amountEl.textContent = '+' + amount;
      popup.appendChild(amountEl);

      stack.appendChild(popup);
      while (stack.children.length > 4) stack.removeChild(stack.firstElementChild);
      requestAnimationFrame(() => popup.classList.add('show'));
      setTimeout(() => {
        popup.classList.remove('show');
        popup.classList.add('closing');
        setTimeout(() => popup.remove(), 260);
      }, 1250);
    }

    function updateInventoryUI() {
      const grid = document.getElementById('inventoryGrid');
      if (!grid) return;
      grid.innerHTML = '';
      hideInventoryTooltip();
      const currentFeedback = inventorySlots.map(inventoryFeedbackSignature);

      for (let i = 0; i < INVENTORY_SLOT_COUNT; i++) {
        const slotData = inventorySlots[i];
        const slot = document.createElement('div');
        slot.className = 'inventorySlot' + (i >= INVENTORY_MAIN_SLOTS ? ' hotbarInventorySlot' : '');
        if (i === getSelectedHotbarInventoryIndex()) slot.classList.add('selectedHotbar');
        // Use the custom inventory tooltip instead of the browser-native title popup.
        slot.title = '';

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

        const slotChanged = inventoryFeedbackInitialized && currentFeedback[i] !== previousInventoryFeedback[i];
        if (slotChanged) slot.classList.add('inventoryFeedbackPulse');
        if (slotData) {
          slot.addEventListener('mouseenter', (event) => showInventoryTooltip(slotData, slot, event));
          slot.addEventListener('mousemove', (event) => positionInventoryTooltip(event.clientX, event.clientY));
          slot.addEventListener('mouseleave', hideInventoryTooltip);
        }

        bindDragSlot(slot, { type: 'inventory', index: i });
        slot.addEventListener('click', () => {
          // A plain click on a hotbar slot still equips/selects it; item movement uses drag.
          if (i >= INVENTORY_MAIN_SLOTS && !lastDragMoved) {
            selectHotbarSlot(i - INVENTORY_MAIN_SLOTS);
          }
        });
        slot.addEventListener('contextmenu', (e) => {
          const held = inventorySlots[i];
          if (held && held.typeId === 'journal') { e.preventDefault(); e.stopPropagation(); openJournal(true); return; }
          if (held && held.typeId === 'backpack') { e.preventDefault(); e.stopPropagation(); openBackpackStorage(held); }
        });
        grid.appendChild(slot);
      }
      previousInventoryFeedback = currentFeedback;
      inventoryFeedbackInitialized = true;
    }

    // Keep the dedicated backpack row synchronized with the normal inventory.
    updateBackpackUI();

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
      if (ref.type === 'backpack') return backpackSlots[ref.index] || null;
      if (ref.type === 'furnace') return activeFurnace ? activeFurnace.inventory[ref.key] || null : null;
      if (ref.type === 'container') return activeContainer && activeContainer.containerId === ref.containerId ? activeContainer.inventory[ref.index] || null : null;
      return null;
    }

    function setDragRefData(ref, value) {
      if (ref.type === 'inventory') inventorySlots[ref.index] = value;
      else if (ref.type === 'backpack') backpackSlots[ref.index] = value;
      else if (ref.type === 'furnace' && activeFurnace) activeFurnace.inventory[ref.key] = value;
      else if (ref.type === 'container' && activeContainer && activeContainer.containerId === ref.containerId) activeContainer.inventory[ref.index] = value;
    }

    function canDropItemOnRef(item, ref) {
      if (!item || !ref) return false;
      if (ref.type === 'inventory') return true;
      if (ref.type === 'backpack') return item.typeId !== 'backpack';
      if (ref.type === 'container') return item.typeId !== 'container';
      if (ref.type !== 'furnace' || !activeFurnace) return false;
      if (ref.key === 'fuel') return item.typeId === 'planks';
      if (ref.key === 'input') return item.typeId === 'iron_ore' || item.typeId === 'copper_ore' || item.typeId === 'tungsten_ore' || item.typeId === 'titanium_ore';
      if (ref.key === 'output') return item.typeId === 'iron_ingot' || item.typeId === 'copper_ingot';
      return false;
    }

    function refsEqual(a, b) {
      return !!a && !!b && a.type === b.type && (a.type === 'inventory' || a.type === 'backpack' ? a.index === b.index : a.type === 'container' ? a.containerId === b.containerId && a.index === b.index : a.key === b.key);
    }

    function clearDragHighlight() {
      if (activeDragTargetEl) activeDragTargetEl.classList.remove('drag-over');
      activeDragTargetEl = null;
      document.querySelectorAll('.inventorySlot.drag-source, .furnaceSlot.drag-source, .containerSlot.drag-source').forEach(el => el.classList.remove('drag-source'));
    }

    function findDragTargetAt(x, y) {
      const el = document.elementFromPoint(x, y);
      if (!el) return { ref: null, el: null };
      const slotEl = el.closest && el.closest('.inventorySlot, .furnaceSlot, .backpackSlot, .containerSlot');
      if (!slotEl) return { ref: null, el: null };
      if (slotEl.closest('#backpackSlots')) {
        const index = Number(slotEl.dataset.backpackIndex);
        if (Number.isInteger(index)) return { ref: { type: 'backpack', index }, el: slotEl };
      }
      if (slotEl.closest('#inventoryGrid')) {
        const index = Number(slotEl.dataset.inventoryIndex);
        if (Number.isInteger(index)) return { ref: { type: 'inventory', index }, el: slotEl };
      }
      if (slotEl.closest('#containerPlayerInventoryGrid')) {
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
      if (slotEl.closest('#containerGrid')) {
        const index = Number(slotEl.dataset.containerIndex);
        const containerId = slotEl.dataset.containerId;
        if (Number.isInteger(index) && containerId) return { ref: { type: 'container', containerId, index }, el: slotEl };
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
      slotEl.dataset.backpackIndex = ref.type === 'backpack' ? String(ref.index) : '';
      if (ref.type === 'furnace') slotEl.dataset.furnaceKey = ref.key;
      if (ref.type === 'container') { slotEl.dataset.containerId = ref.containerId; slotEl.dataset.containerIndex = String(ref.index); }
      slotEl.addEventListener('mouseenter', () => { hoveredItemRef = { ...ref }; });
      slotEl.addEventListener('mouseleave', () => { if (hoveredItemRef && refsEqual(hoveredItemRef, ref)) hoveredItemRef = null; });
      const hasItem = !!getDragRefData(ref);
      if (!hasItem) return;

      slotEl.style.cursor = 'grab';
      slotEl.addEventListener('mousedown', (e) => {
        if (e.button !== 0) return;
        if (state.gameState !== 'playing' || !uiState.inventoryOpen && !uiState.furnaceOpen && !uiState.containerOpen) return;
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
      if (backpackOpen) updateBackpackUI();
      if (uiState.furnaceOpen) updateFurnaceUI();
      if (uiState.containerOpen) updateContainerUI();
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
      closeBackpackStorage();
      for (let i = 0; i < backpackSlots.length; i++) backpackSlots[i] = null;
      clearHeldItem(heldCrystalFirstPerson);
      clearHeldItem(heldCrystalThirdPerson);
      // A brand-new player starts with the Starter Axe and Journal.
      inventorySlots[INVENTORY_MAIN_SLOTS] = { typeId: 'axe', count: 1, durability: TOOL_MAX_DURABILITY };
      inventorySlots[INVENTORY_MAIN_SLOTS + 1] = { typeId: 'journal', count: 1 };
      journalDiscoveredItems = new Set(['journal', 'axe']);
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
    // ---------- backpack storage ----------
    function updateBackpackUI() {
      if (!backpackSlotsEl) return;
      backpackSlotsEl.innerHTML = '';
      for (let i = 0; i < backpackSlots.length; i++) {
        const data = backpackSlots[i];
        const slot = document.createElement('div');
        slot.className = 'inventorySlot backpackSlot';
        slot.dataset.backpackIndex = String(i);
        slot.title = data ? 'Backpack slot ' + (i + 1) + ' · drag to move' : 'Backpack slot ' + (i + 1);
        if (data) {
          slot.appendChild(makeItemIconElement(data.typeId, 'inventoryGem'));
          const count = document.createElement('div');
          count.className = 'inventoryStackCount';
          count.textContent = data.count;
          slot.appendChild(count);
        } else {
          const empty = document.createElement('div');
          empty.className = 'inventoryEmptyLabel';
          empty.textContent = 'EMPTY';
          slot.appendChild(empty);
        }
        bindDragSlot(slot, { type: 'backpack', index: i });
        backpackSlotsEl.appendChild(slot);
      }
      if (backpackStorage) backpackStorage.classList.toggle('hidden', !backpackOpen);
    }

    function openBackpackStorage(backpackItem = null) {
      if (state.gameState !== 'playing' || playerState.inRocket) return false;
      const target = normalizeBackpackItem(backpackItem || inventorySlots[getSelectedHotbarInventoryIndex()]);
      if (!target || target.typeId !== 'backpack') return false;
      // Opening inventory closes any previous backpack context first. Do that before
      // assigning the new active backpack so openInventory() cannot clear our target.
      if (!uiState.inventoryOpen) openInventory();
      if (activeBackpackItem !== target) {
        commitActiveBackpackStorage();
        activeBackpackItem = target;
        loadBackpackStorage(target);
      }
      backpackOpen = true;
      updateBackpackUI();
      updateInventoryUI();
      return true;
    }

    function closeBackpackStorage() {
      commitActiveBackpackStorage();
      activeBackpackItem = null;
      backpackOpen = false;
      if (backpackStorage) backpackStorage.classList.add('hidden');
    }

    // ---------- landed rocket upgrade inventory ----------
    // This is intentionally upgrade-only for now: the rocket has no general-purpose storage.
    // A right-click with an empty hand on a landed rocket opens this panel.
    function getNearbyLandedRocketForShipInventory() {
      if (state.gameState !== 'playing' || state.paused || playerState.inRocket) return null;
      const playerWorld = player.getWorldPosition(new THREE.Vector3());
      let best = null;
      let bestDistance = Infinity;

      const consider = (rocket, pad) => {
        if (!rocket || !rocket.root || !rocket.root.visible || !pad) return;
        const pos = rocket.root.getWorldPosition(new THREE.Vector3());
        const d = pos.distanceTo(playerWorld);
        if (d <= 4.5 && d < bestDistance) { best = { rocket, pad }; bestDistance = d; }
      };

      // Ivis: the rocket remains mounted to its launch pad.
      const ivisPad = findNearbyLaunchPad();
      if (ivisPad && ivisPad.rocket) consider(ivisPad.rocket, ivisPad);

      // Moon / Cordelia: the parked rocket itself is parented to the body.
      if (moonWalking && moonLandedRocket && moonLandingPad) consider(moonLandedRocket, moonLandingPad);
      if (cordeliaWalking && cordeliaLandedRocket && cordeliaLandingPad) consider(cordeliaLandedRocket, cordeliaLandingPad);

      // Aurora / Mileria: the Omega parked rocket is parented to the corresponding moon.
      if (omegaWalkingBodyId && omegaLandedRocket && omegaLandingPad) consider(omegaLandedRocket, omegaLandingPad);

      return best;
    }

    function getRocketEquippedUpgradeIds(rocket, pad) {
      const upgrades = [];
      const engineType = pad?.engineType || rocket?.engineType || 'standard';
      if (engineType === 'mark3') upgrades.push('engine_mark_3');
      else if (engineType === 'upgraded') upgrades.push('upgraded_engine');
      if ((pad?.warpDrive) || (rocket?.warpDrive)) upgrades.push((pad?.warpDriveType || rocket?.warpDriveType) === 'mk2' ? 'warp_drive_mk2' : 'warp_drive');
      return upgrades;
    }

    function openShipInventory(rocket, pad) {
      if (!rocket || !pad || state.gameState !== 'playing' || playerState.inRocket || uiState.shipInventoryOpen) return false;
      uiState.shipInventoryOpen = true;
      state.paused = true;
      for (const k in systemState.keys) systemState.keys[k] = false;
      clearPhysicalKeys();
      renderShipInventory(rocket, pad);
      const overlay = document.getElementById('shipInventoryOverlay');
      overlay.classList.remove('hidden');
      overlay.setAttribute('aria-hidden', 'false');
      pauseOverlay.classList.add('hidden');
      if (document.pointerLockElement === canvas) document.exitPointerLock();
      return true;
    }

    function closeShipInventory() {
      if (!uiState.shipInventoryOpen) return;
      uiState.shipInventoryOpen = false;
      const overlay = document.getElementById('shipInventoryOverlay');
      overlay.classList.add('hidden');
      overlay.setAttribute('aria-hidden', 'true');
      document.getElementById('shipInventoryStatus').textContent = '';
      if (state.gameState === 'playing') {
        state.paused = false;
        attemptPointerLock();
      }
    }

    function renderShipInventory(rocket, pad) {
      const list = document.getElementById('shipUpgradeList');
      const status = document.getElementById('shipInventoryStatus');
      list.replaceChildren();
      status.textContent = '';
      const upgradeIds = getRocketEquippedUpgradeIds(rocket, pad);
      if (!upgradeIds.length) {
        const empty = document.createElement('div');
        empty.className = 'shipUpgradeEmpty';
        empty.textContent = 'No upgrades are currently equipped on this rocket.';
        list.appendChild(empty);
        return;
      }

      for (const typeId of upgradeIds) {
        const item = itemById[typeId];
        const card = document.createElement('div');
        card.className = 'shipUpgradeCard';
        const icon = document.createElement('div');
        icon.className = 'shipUpgradeIcon';
        icon.appendChild(makeItemIconElement(typeId, 'inventoryGem'));

        const body = document.createElement('div');
        body.className = 'shipUpgradeBody';
        const name = document.createElement('div');
        name.className = 'shipUpgradeName';
        name.textContent = item ? item.name : typeId;
        const description = document.createElement('div');
        description.className = 'shipUpgradeDescription';
        description.textContent = typeId === 'upgraded_engine'
          ? 'Engine Mark 2 · increases rocket fuel capacity to 200%'
          : typeId === 'engine_mark_3'
            ? 'Engine Mark 3 · 300% fuel capacity and Supersonic speed'
            : typeId === 'warp_drive_mk2'
              ? 'Warp Drive Mark 2 · 4,000u/s-class warp timing and Rainbow Opal fuel'
              : 'Unlocks the Space Navigation Map and long-distance warp travel';
        body.append(name, description);

        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'shipUpgradeTakeOut';
        button.textContent = 'TAKE OUT';
        button.addEventListener('click', (e) => {
          e.stopPropagation();
          takeOutRocketUpgrade(rocket, pad, typeId);
        });

        card.append(icon, body, button);
        list.appendChild(card);
      }
    }

    function takeOutRocketUpgrade(rocket, pad, typeId) {
      if (!rocket || !pad || !uiState.shipInventoryOpen) return false;
      if (!getRocketEquippedUpgradeIds(rocket, pad).includes(typeId)) return false;
      if (!canAddItemToInventory(typeId, 1)) {
        document.getElementById('shipInventoryStatus').textContent = 'Inventory full — make room before taking this upgrade out.';
        return true;
      }

      if (typeId === 'upgraded_engine') {
        pad.engineType = 'standard';
        rocket.engineType = 'standard';
        pad.fuel = Math.min(Math.max(0, Number(pad.fuel) || 0), ROCKET_FUEL_CAPACITY);
        ensureRocketEngineVisual(rocket);
      } else if (typeId === 'engine_mark_3') {
        pad.engineType = 'upgraded';
        rocket.engineType = 'upgraded';
        pad.fuel = Math.min(Math.max(0, Number(pad.fuel) || 0), ENGINE_MARK_2_FUEL_CAPACITY);
        ensureRocketEngineVisual(rocket);
      } else if (typeId === 'warp_drive') {
        pad.warpDrive = false;
        pad.warpDriveType = null;
        rocket.warpDrive = false;
        rocket.warpDriveType = null;
      } else if (typeId === 'warp_drive_mk2') {
        pad.warpDrive = false;
        pad.warpDriveType = null;
        rocket.warpDrive = false;
        rocket.warpDriveType = null;
      } else {
        return false;
      }

      addItemToInventory(typeId, 1);
      playAudio('uiClick', 0.72, 1.04, 350);
      updateHotbarUI();
      updateInventoryUI();
      refreshEquippedItem();
      renderShipInventory(rocket, pad);
      document.getElementById('shipInventoryStatus').textContent = itemById[typeId]?.name + ' returned to your inventory.';
      return true;
    }

    // ---------- inventory window ----------
    function openInventory() {
      if (state.gameState !== 'playing' || uiState.craftingOpen || uiState.freeplayInventoryOpen || playerState.inRocket) return;
      uiState.inventoryOpen = true;
      closeBackpackStorage();
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
      closeBackpackStorage();
      document.getElementById('inventoryOverlay').classList.add('hidden');
      if (state.gameState === 'playing') {
        state.paused = false;
        attemptPointerLock();
      }
    }

    function toggleInventory() {
      if (uiState.craftingOpen || uiState.freeplayInventoryOpen) return;
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
        id: 'wooden_scythe',
        name: 'Wooden Scythe',
        ingredients: [{ typeId: 'sticks', count: 2 }, { typeId: 'planks', count: 3 }],
        output: { typeId: 'wooden_scythe', count: 1 }
      },
      {
        id: 'stone_scythe',
        name: 'Stone Scythe',
        ingredients: [{ typeId: 'sticks', count: 2 }, { typeId: 'stone', count: 3 }],
        output: { typeId: 'stone_scythe', count: 1 }
      },
      {
        id: 'iron_scythe',
        name: 'Iron Scythe',
        ingredients: [{ typeId: 'sticks', count: 2 }, { typeId: 'iron_ingot', count: 3 }],
        output: { typeId: 'iron_scythe', count: 1 }
      },
      {
        id: 'copper_wire',
        name: 'Copper Wire',
        ingredients: [{ typeId: 'copper_ingot', count: 1 }],
        output: { typeId: 'copper_wire', count: 3 }
      },
      {
        id: 'iron_plate',
        name: 'Iron Plate',
        ingredients: [{ typeId: 'iron_ingot', count: 1 }],
        output: { typeId: 'iron_plate', count: 2 }
      },
      {
        id: 'titanium_plate',
        name: 'Titanium Plate',
        ingredients: [{ typeId: 'titanium_ingot', count: 1 }],
        output: { typeId: 'titanium_plate', count: 2 }
      },
      {
        id: 'iron_wrench',
        name: 'Iron Wrench',
        ingredients: [{ typeId: 'iron_ingot', count: 1 }, { typeId: 'iron_plate', count: 1 }],
        output: { typeId: 'iron_wrench', count: 1 }
      },
      {
        id: 'titanium_wrench',
        name: 'Titanium Wrench',
        ingredients: [{ typeId: 'titanium_ingot', count: 1 }, { typeId: 'titanium_plate', count: 1 }],
        output: { typeId: 'titanium_wrench', count: 1 }
      },
      {
        id: 'upgraded_engine',
        name: 'Engine Mark 2',
        ingredients: [{ typeId: 'moon_quartz', count: 2 }, { typeId: 'rocket_engine', count: 1 }, { typeId: 'copper_wire', count: 3 }],
        output: { typeId: 'upgraded_engine', count: 1 },
        blueprintId: 'upgraded_engine_blueprint'
      },
      {
        id: 'warp_drive',
        name: 'Warp Drive',
        ingredients: [{ typeId: 'tungsten_ingot', count: 5 }, { typeId: 'iron_ingot', count: 3 }, { typeId: 'amethyst', count: 1 }],
        output: { typeId: 'warp_drive', count: 1 },
        blueprintId: 'warp_drive_blueprint'
      },
      {
        id: 'warp_drive_mk2',
        name: 'Warp Drive Mark 2',
        ingredients: [{ typeId: 'titanium_ingot', count: 8 }, { typeId: 'tungsten_ingot', count: 3 }, { typeId: 'rainbow_opal', count: 1 }, { typeId: 'warp_drive', count: 1 }],
        output: { typeId: 'warp_drive_mk2', count: 1 },
        blueprintId: 'warp_drive_mk2_blueprint'
      },
      {
        id: 'engine_mark_3',
        name: 'Engine Mark 3',
        ingredients: [{ typeId: 'upgraded_engine', count: 1 }, { typeId: 'titanium_ingot', count: 5 }, { typeId: 'rainbow_opal', count: 2 }, { typeId: 'tungsten_ingot', count: 1 }],
        output: { typeId: 'engine_mark_3', count: 1 },
        blueprintId: 'engine_mark_3_blueprint'
      },
      {
        id: 'woven_grass_fiber',
        name: 'Woven Grass Fiber',
        ingredients: [{ typeId: 'grass_fiber', count: 6 }],
        output: { typeId: 'woven_grass_fiber', count: 1 }
      },
      {
        id: 'backpack',
        name: 'Backpack',
        ingredients: [{ typeId: 'sticks', count: 4 }, { typeId: 'planks', count: 1 }, { typeId: 'woven_grass_fiber', count: 1 }],
        output: { typeId: 'backpack', count: 1 }
      },
      {
        id: 'furnace',
        name: 'Furnace',
        ingredients: [{ typeId: 'stone', count: 5 }, { typeId: 'planks', count: 3 }],
        output: { typeId: 'furnace', count: 1 }
      },
      {
        id: 'container',
        name: 'Container',
        ingredients: [{ typeId: 'iron_plate', count: 6 }],
        output: { typeId: 'container', count: 1 }
      },
      {
        id: 'rocket_engine',
        name: 'Rocket Engine',
        ingredients: [{ typeId: 'iron_ingot', count: 5 }, { typeId: 'sticks', count: 2 }, { typeId: 'stone', count: 1 }],
        output: { typeId: 'rocket_engine', count: 1 },
        blueprintId: 'rocket_engine_blueprint'
      },
      {
        id: 'rocket',
        name: 'Rocket',
        ingredients: [{ typeId: 'rocket_engine', count: 1 }, { typeId: 'iron_ingot', count: 5 }, { typeId: 'ruby', count: 2 }],
        output: { typeId: 'rocket', count: 1 },
        blueprintId: 'rocket_blueprint'
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

    function hasBlueprintForRecipe(recipe) {
      return !recipe.blueprintId || countItem(recipe.blueprintId) > 0;
    }

    function canCraft(recipe) {
      // A blueprint is a permanent unlock and is required in every game mode.
      if (!hasBlueprintForRecipe(recipe)) return false;
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
      if (!hasBlueprintForRecipe(recipe)) {
        craftingStatusEl.textContent = 'You need the ' + itemById[recipe.blueprintId].name + ' to craft this.';
        return;
      }
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
      if (itemById[recipe.output.typeId] && itemById[recipe.output.typeId].tool) awardAchievement('first_tool');
      if (recipe.output.typeId === 'rocket') awardAchievement('first_rocket');
      if (/^stone_/.test(recipe.output.typeId) && itemById[recipe.output.typeId] && itemById[recipe.output.typeId].tool) awardAchievement('first_stone_tool');
      if (recipe.output.typeId === 'furnace') awardAchievement('first_furnace');
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
      const materialText = state.gameMode === 'freeplay'
        ? 'FREE · no materials required'
        : recipe.ingredients.map(input => input.count + ' × ' + itemById[input.typeId].name).join(' + ');
      ingredients.textContent = materialText;
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
      const availableRecipes = CRAFTING_RECIPES.filter(hasBlueprintForRecipe);
      const pageCount = Math.max(1, Math.ceil(availableRecipes.length / CRAFTING_PAGE_SIZE));
      craftingPage = Math.max(0, Math.min(craftingPage, pageCount - 1));
      const filteredStart = craftingPage * CRAFTING_PAGE_SIZE;
      const recipesOnPage = availableRecipes.slice(filteredStart, filteredStart + CRAFTING_PAGE_SIZE);

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


    // ---------- freeplay inventory ----------
    let freeplayInventoryPage = 0;
    const FREEPLAY_INVENTORY_PAGE_SIZE = 20;
    const freeplayInventoryOverlay = document.getElementById('freeplayInventoryOverlay');
    const freeplayInventoryItemsEl = document.getElementById('freeplayInventoryItems');
    const freeplayInventoryStatusEl = document.getElementById('freeplayInventoryStatus');
    const freeplayInventoryClose = document.getElementById('freeplayInventoryClose');
    const freeplayInventoryNextPage = document.getElementById('freeplayInventoryNextPage');

    function openFreeplayInventory() {
      if (state.gameState !== 'playing' || state.gameMode !== 'freeplay' || playerState.inRocket || uiState.inventoryOpen || uiState.craftingOpen) return;
      uiState.freeplayInventoryOpen = true;
      state.paused = true;
      for (const k in systemState.keys) systemState.keys[k] = false;
      clearPhysicalKeys();
      freeplayInventoryPage = 0;
      freeplayInventoryStatusEl.textContent = '';
      updateFreeplayInventoryUI();
      freeplayInventoryOverlay.classList.remove('hidden');
      if (document.pointerLockElement === canvas) document.exitPointerLock();
    }

    function closeFreeplayInventory() {
      uiState.freeplayInventoryOpen = false;
      freeplayInventoryOverlay.classList.add('hidden');
      freeplayInventoryStatusEl.textContent = '';
      if (state.gameState === 'playing') { state.paused = false; attemptPointerLock(); }
    }

    function addFreeplayItem(typeId) {
      if (state.gameMode !== 'freeplay') return;
      const item = itemById[typeId];
      if (!item) return;
      if (!canAddItemToInventory(typeId, 1)) {
        freeplayInventoryStatusEl.textContent = 'Inventory is full.';
        return;
      }
      const durability = item.tool ? getToolMaxDurability(item) : null;
      if (addItemToInventory(typeId, 1, durability)) {
        freeplayInventoryStatusEl.textContent = 'Added 1 × ' + item.name + '.';
      }
      updateFreeplayInventoryUI();
    }

    function updateFreeplayInventoryUI() {
      if (!freeplayInventoryItemsEl) return;
      freeplayInventoryItemsEl.innerHTML = '';
      const pageCount = Math.max(1, Math.ceil(ITEM_TYPES.length / FREEPLAY_INVENTORY_PAGE_SIZE));
      freeplayInventoryPage = Math.max(0, Math.min(freeplayInventoryPage, pageCount - 1));
      const start = freeplayInventoryPage * FREEPLAY_INVENTORY_PAGE_SIZE;
      const items = ITEM_TYPES.slice(start, start + FREEPLAY_INVENTORY_PAGE_SIZE);
      for (let i = 0; i < FREEPLAY_INVENTORY_PAGE_SIZE; i++) {
        const item = items[i];
        const card = document.createElement('div');
        card.className = 'freeplayItemCard';
        if (!item) { card.style.visibility = 'hidden'; freeplayInventoryItemsEl.appendChild(card); continue; }
        const canAdd = canAddItemToInventory(item.id, 1);
        if (!canAdd) card.classList.add('full');
        card.appendChild(makeItemIconElement(item.id, 'inventoryGem'));
        const name = document.createElement('div');
        name.className = 'freeplayItemName';
        name.textContent = item.name;
        card.appendChild(name);
        card.title = canAdd ? 'Add 1 × ' + item.name : 'Inventory is full';
        card.addEventListener('click', (e) => { e.stopPropagation(); addFreeplayItem(item.id); });
        freeplayInventoryItemsEl.appendChild(card);
      }
      freeplayInventoryNextPage.disabled = pageCount <= 1;
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
      if (input && (input.typeId==='iron_ore' || input.typeId==='copper_ore' || input.typeId==='tungsten_ore' || input.typeId==='titanium_ore') && fuel && fuel.typeId==='planks' && (!output || ((output.typeId==='iron_ingot' || output.typeId==='copper_ingot' || output.typeId==='tungsten_ingot' || output.typeId==='titanium_ingot') && output.count<10))) {
        const pct=activeFurnace && activeFurnace.smeltStartedAt ? Math.min(100, ((performance.now()-activeFurnace.smeltStartedAt)/2000)*100) : 0;
        const oreLabel = input.typeId==='copper_ore' ? 'Copper Ore' : (input.typeId==='tungsten_ore' ? 'Tungsten Ore' : (input.typeId==='titanium_ore' ? 'Titanium Ore' : 'Iron Ore'));
        status.textContent='Smelting ' + oreLabel + '… ' + Math.round(pct) + '%';
      } else status.textContent='1 Plank + 1 Ore → 1 Ingot';
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
        (key === 'input' && (inventoryItem.typeId === 'iron_ore' || inventoryItem.typeId === 'copper_ore' || inventoryItem.typeId === 'tungsten_ore' || inventoryItem.typeId === 'titanium_ore')) ||
        (key === 'output' && (inventoryItem.typeId === 'iron_ingot' || inventoryItem.typeId === 'copper_ingot' || inventoryItem.typeId === 'tungsten_ingot' || inventoryItem.typeId === 'titanium_ingot'));
      if (!validForSlot) {
        const status = document.getElementById('furnaceStatus');
        if (status) {
          status.textContent = key === 'fuel' ? 'Only Planks can be used as fuel' :
            key === 'input' ? 'Only Iron, Copper, Tungsten, or Titanium Ore can be smelted here' :
            'Only Iron, Copper, Tungsten, or Titanium Ingots can be taken from the output slot';
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
        f.input && (f.input.typeId==='iron_ore' || f.input.typeId==='copper_ore' || f.input.typeId==='tungsten_ore' || f.input.typeId==='titanium_ore') && f.input.count>0 &&
        (!f.output || ((f.input.typeId==='copper_ore' ? f.output.typeId==='copper_ingot' : (f.input.typeId==='tungsten_ore' ? f.output.typeId==='tungsten_ingot' : (f.input.typeId==='titanium_ore' ? f.output.typeId==='titanium_ingot' : f.output.typeId==='iron_ingot'))) && f.output.count<10)));
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
        const resultType = f.input.typeId==='copper_ore' ? 'copper_ingot' : (f.input.typeId==='tungsten_ore' ? 'tungsten_ingot' : (f.input.typeId==='titanium_ore' ? 'titanium_ingot' : 'iron_ingot'));
        if (resultType === 'iron_ingot') awardAchievement('first_iron_ingot');
        f.input.count--; if (f.input.count<=0) f.input=null;
        if (!f.output) f.output={typeId:resultType,count:1}; else f.output.count++;
        furnace.smeltStartedAt=0;
      }
      const furnaceActiveNow = furnaces.some(f => furnaceCanSmelt(f));
      if (furnaceActiveNow && !furnaceWasActive) {
        playAudio('furnace', 0.12, 1.0);
      } else if (!furnaceActiveNow && furnaceWasActive) {
        stopAudio('furnace');
      }
      furnaceWasActive = furnaceActiveNow;
      if (uiState.furnaceOpen) updateFurnaceUI();
    }

    function openFurnace(furnace) {
      if (!furnace || state.gameState!=='playing') return;
      awardAchievement('use_furnace');
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


    // ---------- particles ----------
    // Lightweight procedural particles for mining/chopping impacts and player landings.
    // The particles live in planetSystem-local space so they follow the spherical world.
    const particleSystems = [];
    const particleClock = new THREE.Clock();
    let rocketParticleTimer = 0;
    let playerDustTimer = 0;
    let crystalSparkleTimer = 0;
    let waterSplashTimer = 0;

    function spawnImpactParticles(position, color, options = {}) {
      const count = options.count ?? 14;
      const life = options.life ?? 0.55;
      const speed = options.speed ?? 2.6;
      const size = options.size ?? 0.075;
      const gravity = options.gravity ?? 5.5;
      const spread = options.spread ?? 0.9;
      const group = new THREE.Group();
      // getParticleWorldPosition() returns a world-space position, while planetSystem
      // (the rotating planet) expects local coordinates. Convert before attaching so
      // mining/chopping particles appear exactly at the object instead of being rotated
      // a second time.
      group.position.copy(planetSystem.worldToLocal(position.clone()));

      const positions = new Float32Array(count * 3);
      const velocities = [];
      const sizes = new Float32Array(count);
      for (let i = 0; i < count; i++) {
        positions[i * 3] = (Math.random() - 0.5) * 0.06;
        positions[i * 3 + 1] = (Math.random() - 0.5) * 0.06;
        positions[i * 3 + 2] = (Math.random() - 0.5) * 0.06;
        const dir = new THREE.Vector3(
          (Math.random() - 0.5) * spread,
          Math.random() * 0.9 + 0.15,
          (Math.random() - 0.5) * spread
        ).normalize();
        velocities.push(dir.multiplyScalar(speed * (0.65 + Math.random() * 0.7)));
        sizes[i] = size * (0.65 + Math.random() * 0.7);
      }

      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      const material = new THREE.PointsMaterial({
        color,
        size,
        sizeAttenuation: true,
        transparent: true,
        opacity: 0.95,
        depthWrite: false,
        fog: true
      });
      const points = new THREE.Points(geometry, material);
      group.add(points);
      planetSystem.add(group);

      particleSystems.push({ group, geometry, material, velocities, age: 0, life, gravity, sizes });
    }

    function spawnWorldParticles(position, color, options = {}) {
      const count = options.count ?? 12;
      const life = options.life ?? 0.6;
      const speed = options.speed ?? 1.8;
      const size = options.size ?? 0.08;
      const gravity = options.gravity ?? 0.8;
      const spread = options.spread ?? 0.9;
      const upward = options.upward ?? 0.35;
      const group = new THREE.Group();
      group.position.copy(position);
      const positions = new Float32Array(count * 3);
      const velocities = [];
      for (let i = 0; i < count; i++) {
        positions[i * 3] = (Math.random() - 0.5) * 0.05;
        positions[i * 3 + 1] = (Math.random() - 0.5) * 0.05;
        positions[i * 3 + 2] = (Math.random() - 0.5) * 0.05;
        const dir = new THREE.Vector3(
          (Math.random() - 0.5) * spread,
          Math.random() * upward + 0.08,
          (Math.random() - 0.5) * spread
        ).normalize();
        velocities.push(dir.multiplyScalar(speed * (0.55 + Math.random() * 0.9)));
      }
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      const material = new THREE.PointsMaterial({
        color, size, sizeAttenuation: true, transparent: true, opacity: 0.9,
        depthWrite: false, fog: false
      });
      const points = new THREE.Points(geometry, material);
      group.add(points);
      scene.add(group);
      particleSystems.push({ group, geometry, material, velocities, age: 0, life, gravity, sizes: null, worldSpace: true });
    }

    function spawnRocketExhaust() {
      if (!flightRocket || !playerState.inRocket) return;
      const nozzleLocal = new THREE.Vector3(0, -0.92, 0);
      const nozzleWorld = flightRocket.root.localToWorld(nozzleLocal);
      const worldDir = new THREE.Vector3(0, -1, 0).applyQuaternion(flightRocket.root.quaternion).normalize();
      const count = playerState.rocketInSpace ? 5 : 8;
      const group = new THREE.Group();
      group.position.copy(nozzleWorld);
      const positions = new Float32Array(count * 3);
      const velocities = [];
      for (let i = 0; i < count; i++) {
        positions[i * 3] = (Math.random() - 0.5) * 0.09;
        positions[i * 3 + 1] = (Math.random() - 0.5) * 0.09;
        positions[i * 3 + 2] = (Math.random() - 0.5) * 0.09;
        const dir = worldDir.clone().multiplyScalar(1.2 + Math.random() * 1.5)
          .add(new THREE.Vector3((Math.random()-0.5)*0.55, (Math.random()-0.5)*0.55, (Math.random()-0.5)*0.55));
        velocities.push(dir);
      }
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      const material = new THREE.PointsMaterial({ color: playerState.rocketInSpace ? 0xffffff : 0xffb347, size: 0.09, sizeAttenuation: true, transparent: true, opacity: 0.9, depthWrite: false, fog: false });
      group.add(new THREE.Points(geometry, material));
      scene.add(group);
      particleSystems.push({ group, geometry, material, velocities, age: 0, life: 0.22, gravity: 0.15, sizes: null, worldSpace: true });
    }

    function updateSpecialParticles(delta) {
      const playing = state.gameState === 'playing' && !state.paused;

      // Rocket exhaust: small puffs while thrusting, more vivid in atmosphere and white in space.
      if (playing && playerState.inRocket) {
        const anyFlightInput = typeof isRocketFlightInputActive === 'function' ? isRocketFlightInputActive() : false;
        if (anyFlightInput) {
          rocketParticleTimer -= delta;
          if (rocketParticleTimer <= 0) {
            spawnRocketExhaust();
            rocketParticleTimer = playerState.rocketInSpace ? 0.08 : 0.055;
          }
        } else {
          rocketParticleTimer = 0;
        }
      } else {
        rocketParticleTimer = 0;
      }

      // Running dust. Only emits while moving on the ground and stays subtle.
      if (playing && !playerState.inRocket) {
        const moving = typeof isPlayerMovingForParticles === 'function' ? isPlayerMovingForParticles() : false;
        const grounded = playerState.heightOffset <= 0.02;
        if (moving && grounded) {
          playerDustTimer -= delta;
          if (playerDustTimer <= 0) {
            const dir = player.position.clone().normalize();
            const footPos = player.position.clone().multiplyScalar(1).addScaledVector(dir, 0.06);
            spawnImpactParticles(footPos, 0xa9987a, { count: 5, life: 0.38, speed: 0.45, size: 0.045, gravity: 0.7, spread: 0.7 });
            playerDustTimer = 0.16;
          }
        } else playerDustTimer = 0;

        // Crystal sparkles when nearby, just enough to make collectible crystals readable.
        crystalSparkleTimer -= delta;
        if (crystalSparkleTimer <= 0) {
          crystalSparkleTimer = 0.28;
          const playerWorld = player.getWorldPosition(new THREE.Vector3());
          let nearest = null, best = Infinity;
          for (const spawn of crystalSpawns.concat(cordeliaCrystalSpawns, auroraCrystalSpawns)) {
            if (spawn.collected || !spawn.root.visible) continue;
            const pos = spawn.root.getWorldPosition(new THREE.Vector3());
            const d = pos.distanceTo(playerWorld);
            if (d < 10 && d < best) { best = d; nearest = pos; }
          }
          if (nearest) spawnWorldParticles(nearest, 0xbfeaff, { count: 2, life: 0.5, speed: 0.18, size: 0.05, gravity: -0.05, spread: 0.65, upward: 1.0 });
        }

        // Water spray near the river shoreline.
        const localDir = player.position.clone().normalize();
        const riverInfo = nearestRiverInfo(localDir);
        if (riverInfo && riverInfo.angle < 0.065) {
          waterSplashTimer -= delta;
          if (waterSplashTimer <= 0) {
            const riverDir = riverPoints[riverInfo.index];
            const waterPos = riverDir.clone().multiplyScalar(PLANET_RADIUS + heightAt(riverDir) + 0.48);
            spawnImpactParticles(waterPos, 0x9edcf5, { count: 4, life: 0.42, speed: 0.5, size: 0.045, gravity: 1.4, spread: 1.0 });
            waterSplashTimer = 0.45 + Math.random() * 0.35;
          }
        } else waterSplashTimer = 0;
      } else {
        playerDustTimer = crystalSparkleTimer = waterSplashTimer = 0;
      }
    }

    function isRocketFlightInputActive() {
      if (!playerState.inRocket) return false;
      return ['moveForward','moveBackward','moveLeft','moveRight','jump','sprint'].some(action => isActionDown(action));
    }

    function isPlayerMovingForParticles() {
      if (playerState.inRocket) return false;
      return ['moveForward','moveBackward','moveLeft','moveRight'].some(action => isActionDown(action));
    }

    function spawnLandingDust(position, normal) {
      const group = new THREE.Group();
      group.position.copy(position);
      const count = 22;
      const positions = new Float32Array(count * 3);
      const velocities = [];
      for (let i = 0; i < count; i++) {
        const tangent = new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5);
        tangent.addScaledVector(normal, -tangent.dot(normal)).normalize();
        const outward = tangent.multiplyScalar(1.4 + Math.random() * 1.9).addScaledVector(normal, 0.35 + Math.random() * 0.55);
        velocities.push(outward);
      }
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      const material = new THREE.PointsMaterial({
        color: 0xb7a98d,
        size: 0.11,
        sizeAttenuation: true,
        transparent: true,
        opacity: 0.7,
        depthWrite: false,
        fog: true
      });
      const points = new THREE.Points(geometry, material);
      group.add(points);
      planetSystem.add(group);
      particleSystems.push({ group, geometry, material, velocities, age: 0, life: 0.65, gravity: 1.6, sizes: new Float32Array(count) });
    }



    // ---------- final particle pass ----------
    // Decorative world/space particles: drifting leaves, snowy flurries, launch exhaust bursts,
    // and very subtle high-speed space dust. These are intentionally sparse to stay lightweight.
    let leafTimer = 0;
    let snowTimer = 0;
    let spaceDustTimer = 0;
    let launchBurstCooldown = 0;

    function spawnLaunchBurst() {
      if (!flightRocket) return;
      const nozzleLocal = new THREE.Vector3(0, -0.95, 0);
      const nozzleWorld = flightRocket.root.localToWorld(nozzleLocal);
      const worldDir = new THREE.Vector3(0, -1, 0).applyQuaternion(flightRocket.root.quaternion).normalize();
      const count = 52;
      const group = new THREE.Group();
      group.position.copy(nozzleWorld);
      const positions = new Float32Array(count * 3);
      const velocities = [];
      for (let i = 0; i < count; i++) {
        const spread = 0.22;
        positions[i*3] = (Math.random()-0.5)*spread;
        positions[i*3+1] = (Math.random()-0.5)*spread;
        positions[i*3+2] = (Math.random()-0.5)*spread;
        const dir = worldDir.clone().multiplyScalar(2.5 + Math.random()*4.5)
          .add(new THREE.Vector3((Math.random()-0.5)*1.5, (Math.random()-0.5)*1.5, (Math.random()-0.5)*1.5));
        velocities.push(dir);
      }
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      const material = new THREE.PointsMaterial({
        color: 0xffc45a, size: 0.27, sizeAttenuation: true, transparent: true, opacity: 0.95,
        depthWrite: false, fog: false
      });
      group.add(new THREE.Points(geometry, material));
      scene.add(group);
      particleSystems.push({ group, geometry, material, velocities, age: 0, life: 0.9, gravity: 0.18, sizes: null, worldSpace: true });
    }

    function spawnDriftingLeaf(position) {
      spawnWorldParticles(position, 0x78a94f, { count: 3, life: 2.8, speed: 0.28, size: 0.15, gravity: -0.02, spread: 1.8, upward: 1.2 });
    }

    function spawnSnowFlurry(position) {
      spawnWorldParticles(position, 0xffffff, { count: 10, life: 2.2, speed: 0.32, size: 0.14, gravity: 0.08, spread: 1.4, upward: 1.1 });
    }

    function spawnSpaceDust() {
      if (!flightRocket || !playerState.inRocket || !playerState.rocketInSpace) return;
      const shipPos = flightRocket.root.getWorldPosition(new THREE.Vector3());
      const moveDir = new THREE.Vector3();
      flightCamera.getWorldDirection(moveDir).normalize();
      const side = new THREE.Vector3().crossVectors(moveDir, flightCamera.up).normalize();
      const up = flightCamera.up.clone().normalize();
      const pos = shipPos.clone()
        .addScaledVector(moveDir, (Math.random()-0.5)*5)
        .addScaledVector(side, (Math.random()-0.5)*10)
        .addScaledVector(up, (Math.random()-0.5)*10);
      const vel = moveDir.clone().multiplyScalar(5 + Math.random()*5);
      const group = new THREE.Group();
      group.position.copy(pos);
      const positions = new Float32Array([0,0,0]);
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      const material = new THREE.PointsMaterial({ color:0xffffff, size:0.045, transparent:true, opacity:0.7, depthWrite:false, fog:false });
      group.add(new THREE.Points(geometry, material));
      scene.add(group);
      particleSystems.push({ group, geometry, material, velocities:[vel], age:0, life:0.45, gravity:0, sizes:null, worldSpace:true });
    }

    function updateFinalParticles(delta) {
      const playing = state.gameState === 'playing' && !state.paused;
      launchBurstCooldown = Math.max(0, launchBurstCooldown - delta);
      if (!playing) return;

      // Occasional leaves near living trees.
      if (!playerState.inRocket) {
        // Leaves: emit near any living tree in a generous radius so the effect is actually
        // noticeable while exploring, without covering the whole planet in particles.
        leafTimer -= delta;
        if (leafTimer <= 0) {
          leafTimer = 1.0 + Math.random()*1.8;
          const playerWorld = player.getWorldPosition(new THREE.Vector3());
          let nearest = null, best = Infinity;
          for (const tree of treeSpawns) {
            if (tree.chopped || !tree.root.visible) continue;
            const pos = tree.root.getWorldPosition(new THREE.Vector3());
            const d = pos.distanceTo(playerWorld);
            if (d < 24 && d < best) { best=d; nearest=pos; }
          }
          if (nearest) {
            const offset = new THREE.Vector3((Math.random()-0.5)*1.8, 1.6 + Math.random()*2.0, (Math.random()-0.5)*1.8);
            spawnDriftingLeaf(nearest.clone().add(offset));
          }
        }

        // Snow: use a lower threshold so the effect is visible across the snowy upper
        // slopes, even on flatter procedural peaks.
        snowTimer -= delta;
        if (snowTimer <= 0) {
          snowTimer = 0.35 + Math.random()*0.65;
          const dir = player.position.clone().normalize();
          const h = heightAt(dir);
          if (h >= 8.0) {
            const pos = player.getWorldPosition(new THREE.Vector3()).add(new THREE.Vector3((Math.random()-0.5)*6, 2.0 + Math.random()*3.0, (Math.random()-0.5)*6));
            spawnSnowFlurry(pos);
          }
        }
      } else {
        leafTimer = 0;
        snowTimer = 0;
        if (isRocketFlightInputActive()) {
          const speed = FLIGHT_SPEED;
          if (playerState.rocketInSpace && speed > 0) {
            spaceDustTimer -= delta;
            if (spaceDustTimer <= 0) {
              spawnSpaceDust();
              spaceDustTimer = 0.08;
            }
          } else spaceDustTimer = 0;
        } else spaceDustTimer = 0;
      }
    }

    function updateParticles(delta) {
      for (let i = particleSystems.length - 1; i >= 0; i--) {
        const system = particleSystems[i];
        system.age += delta;
        const posAttr = system.geometry.getAttribute('position');
        const arr = posAttr.array;
        for (let j = 0; j < system.velocities.length; j++) {
          const v = system.velocities[j];
          v.y -= system.gravity * delta;
          arr[j * 3] += v.x * delta;
          arr[j * 3 + 1] += v.y * delta;
          arr[j * 3 + 2] += v.z * delta;
        }
        posAttr.needsUpdate = true;
        system.material.opacity = Math.max(0, 1 - system.age / system.life);
        if (system.age >= system.life) {
          if (system.group.parent) system.group.parent.remove(system.group);
          system.geometry.dispose();
          system.material.dispose();
          particleSystems.splice(i, 1);
        }
      }
    }

    function getParticleWorldPosition(root, offset = 0.15) {
      const position = new THREE.Vector3();
      root.getWorldPosition(position);
      const normal = position.clone().normalize();
      return position.addScaledVector(normal, offset);
    }

    // ---------- audio ----------
    // Small local sound manager. All files live in /audio so the GitHub Pages build can
    // load them without needing any external audio service.
    const audioBank = {
      pickaxe: new Audio('audio/pickaxe-blow.mp3'),
      footsteps: new Audio('audio/footsteps-nature-trail.mp3'),
      uiClick: new Audio('audio/ui-click.mp3'),
      chop: new Audio('audio/chopping-tree-root.mp3'),
      river: new Audio('audio/river-water.mp3'),
      rocketThrust: new Audio('audio/rocket-thrust.mp3'),
      rocketIdle: new Audio('audio/rocket-idle.mp3'),
      rocketLaunch: new Audio('audio/rocket-launch.wav'),
      spaceAtmosphereBoom: new Audio('audio/space-atmosphere-boom.mp3'),
      crystalPickup: new Audio('audio/crystal-pickup.mp3'),
      moonQuartzPickup: new Audio('audio/moon-quartz-pickup.mp3'),
      furnace: new Audio('audio/furnace-loop.mp3'),
      wind: new Audio('audio/wind-loop.mp3'),
      rain: new Audio('audio/rain.mp3'),
      jumpLanding: new Audio('audio/jump-landing.mp3'),
      land2: new Audio('audio/land2.mp3'),
      drill: new Audio('audio/drill.mp3'),
      achievement: new Audio('audio/achievement-unlock.mp3'),
      warpDrive: new Audio('audio/warp-drive.mp3'),
    };

    const AUDIO_CATEGORY = Object.freeze({
      interact: new Set(['pickaxe', 'uiClick', 'chop', 'crystalPickup', 'moonQuartzPickup', 'drill', 'furnace']),
      player: new Set(['footsteps', 'jumpLanding', 'land2', 'rocketThrust', 'rocketIdle', 'rocketLaunch']),
      nature: new Set(['wind', 'rain', 'river']),
      world: new Set(['spaceAtmosphereBoom', 'achievement', 'warpDrive']),
    });
    const musicBank = {
      ivisAmbient: new Audio('music/ivis-ambient.mp3'),
      ivisSunset: new Audio('music/ivis-sunset.mp3'),
      ivisNight: new Audio('music/ivis-night.mp3'),
      storm: new Audio('music/storm.mp3'),
      moon: new Audio('music/moon.mp3'),
      cordelia: new Audio('music/cordelia.m4a'),
      deepSpace: new Audio('music/deep-space.mp3'),
      merchant: new Audio('music/stall.m4a'),
    };
    for (const track of Object.values(musicBank)) {
      track.loop = true;
      track.preload = 'auto';
      track.volume = 0;
    }

    // Background music is intentionally separate from the five gameplay sound categories.
    // Every transition waits until the current track has played for at least 30 seconds,
    // then fades the old track out before fading the new scene's track in.
    const MUSIC_MIN_RUNTIME_SECONDS = 30;
    const MUSIC_FADE_OUT_SECONDS = 1.6;
    const MUSIC_FADE_IN_SECONDS = 1.8;
    const MUSIC_TRACK_BASE_VOLUME = Object.freeze({
      ivisAmbient: 0.52,
      ivisSunset: 0.52,
      ivisNight: 0.50,
      storm: 0.20,
      moon: 0.52,
      cordelia: 0.52,
      deepSpace: 0.48,
      merchant: 0.50,
    });
    let musicCurrentKey = null;
    let musicTargetKey = null;
    let musicTransition = null;
    let musicTrackStartedAt = 0;
    let musicUserInteracted = false;

    // Merchant music is a deliberate exception to the normal 30-second scene-change rule.
    // Opening the stall immediately fades out the current track, pauses it without resetting
    // its playback position, and plays the stall track. Closing the stall fades the stall track
    // out and resumes the exact previous track position.
    let musicMerchantOverride = false;
    let musicMerchantResumeKey = null;
    let musicMerchantResumeTime = 0;
    let musicMerchantTransition = null;

    function getMusicVolume() {
      return Math.max(0, Math.min(1, settingsMasterVolume * settingsMusicVolume));
    }

    function getMusicTargetVolume(key) {
      return Math.max(0, Math.min(1, (MUSIC_TRACK_BASE_VOLUME[key] || 0.5) * getMusicVolume()));
    }

    function setMusicTrackVolume(key, normalized) {
      const track = musicBank[key];
      if (!track) return;
      track.volume = Math.max(0, Math.min(1, normalized * getMusicVolume()));
    }

    function startMusicTrack(key, fadeIn = true) {
      const track = musicBank[key];
      if (!track) return;
      musicCurrentKey = key;
      musicTargetKey = key;
      musicTrackStartedAt = performance.now();
      track.loop = true;
      track.currentTime = 0;
      track.volume = fadeIn ? 0 : getMusicTargetVolume(key);
      if (musicUserInteracted) track.play().catch(() => {});
      if (fadeIn) {
        musicTransition = { phase: 'in', key, elapsed: 0 };
      } else {
        musicTransition = null;
      }
    }

    function stopMusicTrack(key) {
      const track = musicBank[key];
      if (!track) return;
      track.pause();
      try { track.currentTime = 0; } catch {}
      track.volume = 0;
    }

    function getMusicSceneKey() {
      if (state.gameState !== 'playing') return 'ivisAmbient';

      // Surface exploration has its own planetary identity. Merchant music is handled as a
      // temporary override so the previous track can resume at its exact playback position.
      if (moonWalking) return 'moon';
      if (cordeliaWalking) return 'cordelia';

      if (playerState.inRocket && playerState.rocketInSpace) {
        // Close approach to a body's sphere of influence uses that body's music; otherwise
        // the ship is in open deep space. This avoids a jarring space-track swap right at landing.
        if (moonGravityActive) return 'moon';
        if (cordeliaGravityActive) return 'cordelia';
        return 'deepSpace';
      }

      // Ivis surface/atmosphere: storm takes priority over the normal day-cycle tracks.
      if (!playerState.inRocket && isWeatherAllowedHere() && (weatherState === 'building' || weatherState === 'raining' || weatherState === 'clearing')) {
        return 'storm';
      }

      const worldPos = player.getWorldPosition(new THREE.Vector3());
      const posDir = worldPos.lengthSq() > 0.000001 ? worldPos.normalize() : new THREE.Vector3(0, 1, 0);
      const sunDir = sunMesh.position.clone().normalize();
      const sunDot = posDir.dot(sunDir);
      const daylight = THREE.MathUtils.smoothstep(sunDot, -0.48, -0.10);
      const sunset = 1 - Math.min(1, Math.abs(sunDot) / 0.35);
      const night = THREE.MathUtils.smoothstep(-sunDot, 0.02, 0.42);

      if (night > 0.55) return 'ivisNight';
      // Use the sunset track around both dusk and dawn, where the existing visuals are orange.
      if (sunset > 0.12 || daylight < 0.18) return 'ivisSunset';
      return 'ivisAmbient';
    }

    function requestMusicScene(key) {
      if (!musicBank[key]) return;
      musicTargetKey = key;
      if (musicCurrentKey === null) {
        if (!musicTransition) startMusicTrack(key, true);
        return;
      }
      if (musicCurrentKey === key) return;
      if (musicTransition && musicTransition.targetKey === key) return;
      const elapsed = (performance.now() - musicTrackStartedAt) / 1000;
      if (elapsed < MUSIC_MIN_RUNTIME_SECONDS) return;
      if (!musicTransition || musicTransition.phase !== 'out') {
        musicTransition = { phase: 'out', key: musicCurrentKey, targetKey: key, elapsed: 0 };
      } else {
        musicTransition.targetKey = key;
      }
    }

    function beginMerchantMusic() {
      if (musicMerchantOverride) return;
      musicMerchantOverride = true;
      musicMerchantResumeKey = musicCurrentKey;
      musicMerchantResumeTime = (musicCurrentKey && musicBank[musicCurrentKey])
        ? Number(musicBank[musicCurrentKey].currentTime) || 0
        : 0;
      musicMerchantTransition = null;
      musicTransition = null;

      if (musicCurrentKey && musicBank[musicCurrentKey]) {
        // Freeze the previous song immediately at the captured timestamp. Its volume can still
        // fade to zero while paused, guaranteeing that a 21.00s track resumes at 21.00s later.
        musicBank[musicCurrentKey].pause();
        musicMerchantTransition = { phase: 'outCurrent', key: musicCurrentKey, elapsed: 0 };
      } else {
        startMusicTrack('merchant', true);
        musicMerchantTransition = { phase: 'merchantIn', key: 'merchant', elapsed: 0 };
      }
    }

    function endMerchantMusic() {
      if (!musicMerchantOverride) return;
      musicMerchantOverride = false;
      const resumeKey = musicMerchantResumeKey;
      const resumeTime = musicMerchantResumeTime;
      musicMerchantResumeKey = null;
      musicMerchantResumeTime = 0;
      musicMerchantTransition = {
        phase: 'outMerchant',
        key: 'merchant',
        elapsed: 0,
        resumeKey,
        resumeTime,
      };
    }

    function updateMerchantMusic(delta) {
      const dt = Math.max(0, Math.min(delta, 0.1));
      if (musicMerchantOverride) {
        if (!musicMerchantTransition) {
          const stall = musicBank.merchant;
          if (stall && stall.paused) stall.play().catch(() => {});
          if (stall) stall.volume = getMusicTargetVolume('merchant');
          return;
        }

        musicMerchantTransition.elapsed += dt;
        const phase = musicMerchantTransition.phase;

        if (phase === 'outCurrent') {
          const currentKey = musicMerchantTransition.key;
          const current = musicBank[currentKey];
          const t = THREE.MathUtils.clamp(musicMerchantTransition.elapsed / MUSIC_FADE_OUT_SECONDS, 0, 1);
          const eased = 1 - Math.pow(1 - t, 2);
          if (current) current.volume = getMusicTargetVolume(currentKey) * (1 - eased);
          if (t >= 1) {
            if (current) current.pause();
            const stall = musicBank.merchant;
            musicCurrentKey = 'merchant';
            musicTargetKey = 'merchant';
            if (stall) {
              stall.loop = true;
              stall.currentTime = 0;
              stall.volume = 0;
              if (musicUserInteracted) stall.play().catch(() => {});
            }
            musicMerchantTransition = { phase: 'merchantIn', key: 'merchant', elapsed: 0 };
          }
        } else if (phase === 'merchantIn') {
          const stall = musicBank.merchant;
          const t = THREE.MathUtils.clamp(musicMerchantTransition.elapsed / MUSIC_FADE_IN_SECONDS, 0, 1);
          const eased = 1 - Math.pow(1 - t, 2);
          if (stall) stall.volume = getMusicTargetVolume('merchant') * eased;
          if (t >= 1) musicMerchantTransition = null;
        } else if (phase === 'outMerchant') {
          const stall = musicBank.merchant;
          const t = THREE.MathUtils.clamp(musicMerchantTransition.elapsed / MUSIC_FADE_OUT_SECONDS, 0, 1);
          const eased = 1 - Math.pow(1 - t, 2);
          if (stall) stall.volume = getMusicTargetVolume('merchant') * (1 - eased);
          if (t >= 1) {
            if (stall) {
              stall.pause();
              try { stall.currentTime = 0; } catch {}
              stall.volume = 0;
            }
            const resumeKey = musicMerchantTransition.resumeKey;
            const resumeTime = musicMerchantTransition.resumeTime;
            if (resumeKey && musicBank[resumeKey]) {
              const resumeTrack = musicBank[resumeKey];
              musicCurrentKey = resumeKey;
              musicTargetKey = resumeKey;
              try {
                resumeTrack.currentTime = Math.max(0, Math.min(
                  Number.isFinite(resumeTrack.duration) && resumeTrack.duration > 0 ? resumeTrack.duration : Infinity,
                  resumeTime
                ));
              } catch {}
              resumeTrack.volume = 0;
              if (musicUserInteracted) resumeTrack.play().catch(() => {});
              musicTrackStartedAt = performance.now();
              musicMerchantTransition = { phase: 'resumeIn', key: resumeKey, elapsed: 0 };
            } else {
              musicCurrentKey = null;
              musicMerchantTransition = null;
            }
          }
        } else if (phase === 'resumeIn') {
          const resumeKey = musicMerchantTransition.key;
          const resumeTrack = musicBank[resumeKey];
          const t = THREE.MathUtils.clamp(musicMerchantTransition.elapsed / MUSIC_FADE_IN_SECONDS, 0, 1);
          const eased = 1 - Math.pow(1 - t, 2);
          if (resumeTrack) resumeTrack.volume = getMusicTargetVolume(resumeKey) * eased;
          if (t >= 1) musicMerchantTransition = null;
        }
      }
    }

    function updateMusic(delta) {
      if (musicMerchantOverride || musicMerchantTransition) {
        updateMerchantMusic(delta);
        if (musicMerchantOverride || musicMerchantTransition) return;
      }

      const targetKey = getMusicSceneKey();
      requestMusicScene(targetKey);

      if (musicCurrentKey === null) return;
      const current = musicBank[musicCurrentKey];
      if (!current) return;

      if (musicUserInteracted && current.paused && !musicTransition?.phase?.startsWith('out')) {
        current.play().catch(() => {});
      }

      if (!musicTransition) {
        current.volume = getMusicTargetVolume(musicCurrentKey);
        return;
      }

      musicTransition.elapsed += Math.max(0, Math.min(delta, 0.1));
      if (musicTransition.phase === 'out') {
        const t = THREE.MathUtils.clamp(musicTransition.elapsed / MUSIC_FADE_OUT_SECONDS, 0, 1);
        const eased = 1 - Math.pow(1 - t, 2);
        current.volume = getMusicTargetVolume(musicCurrentKey) * (1 - eased);
        if (t >= 1) {
          stopMusicTrack(musicCurrentKey);
          const nextKey = musicTargetKey || musicTransition.targetKey;
          musicTransition = null;
          if (nextKey && musicBank[nextKey]) startMusicTrack(nextKey, true);
        }
      } else if (musicTransition.phase === 'in') {
        const t = THREE.MathUtils.clamp(musicTransition.elapsed / MUSIC_FADE_IN_SECONDS, 0, 1);
        const eased = 1 - Math.pow(1 - t, 2);
        current.volume = getMusicTargetVolume(musicCurrentKey) * eased;
        if (t >= 1) musicTransition = null;
      }
    }

    document.addEventListener('pointerdown', () => {
      musicUserInteracted = true;
      if (musicCurrentKey && musicBank[musicCurrentKey]?.paused) musicBank[musicCurrentKey].play().catch(() => {});
    }, { capture: true });
    document.addEventListener('keydown', () => {
      musicUserInteracted = true;
      if (musicCurrentKey && musicBank[musicCurrentKey]?.paused) musicBank[musicCurrentKey].play().catch(() => {});
    }, { capture: true });

    const activeAudioClones = new Set();

    function getAudioCategory(key) {
      for (const [category, keys] of Object.entries(AUDIO_CATEGORY)) {
        if (keys.has(key)) return category;
      }
      return 'world';
    }

    function getAudioCategoryVolume(category) {
      if (category === 'interact') return settingsInteractVolume;
      if (category === 'player') return settingsPlayerVolume;
      if (category === 'nature') return settingsNatureVolume;
      return settingsWorldVolume;
    }

    function getAudioVolume(key, baseVolume) {
      return Math.max(0, Math.min(1, baseVolume * settingsMasterVolume * getAudioCategoryVolume(getAudioCategory(key))));
    }
    audioBank.footsteps.loop = true;
    audioBank.river.loop = true;
    audioBank.rocketThrust.loop = true;
    audioBank.rocketIdle.loop = true;
    audioBank.furnace.loop = true;
    audioBank.wind.loop = true;
    audioBank.rain.loop = true;
    audioBank.warpDrive.loop = true;
    for (const key of Object.keys(audioBank)) audioBank[key].preload = 'auto';

    function playAudio(key, volume = 1, playbackRate = 1, maxDurationMs = 0) {
      const base = audioBank[key];
      if (!base) return;
      const category = getAudioCategory(key);
      // Clone one-shot sounds so repeated impacts do not cut each other off.
      if (key === 'pickaxe' || key === 'chop' || key === 'uiClick' || key === 'crystalPickup' || key === 'moonQuartzPickup' || key === 'jumpLanding' || key === 'land2' || key === 'rocketLaunch' || key === 'spaceAtmosphereBoom' || key === 'drill' || key === 'achievement') {
        const sound = base.cloneNode(true);
        sound._settingsBaseVolume = Math.max(0, Math.min(1, volume));
        sound._settingsAudioKey = key;
        sound.volume = getAudioVolume(key, sound._settingsBaseVolume);
        sound.playbackRate = playbackRate;
        activeAudioClones.add(sound);
        sound.play().catch(() => {});
        if (maxDurationMs > 0) {
          setTimeout(() => {
            try { sound.pause(); sound.currentTime = 0; } catch {}
          }, maxDurationMs);
        }
        const cleanup = () => activeAudioClones.delete(sound);
        sound.addEventListener('ended', cleanup, { once: true });
        return;
      }
      base._settingsBaseVolume = Math.max(0, Math.min(1, volume));
      base._settingsAudioKey = key;
      base._settingsCategory = category;
      base.volume = getAudioVolume(key, base._settingsBaseVolume);
      base.playbackRate = playbackRate;
      base.play().catch(() => {});
    }

    function stopAudio(key) {
      const sound = audioBank[key];
      if (!sound) return;
      sound.pause();
      sound.currentTime = 0;
    }

    // Any click on an actual UI element gets the common interface click sound. The game
    // canvas itself is deliberately excluded so camera look/mining do not sound like UI.
    document.addEventListener('click', (e) => {
      if (state.gameState === 'playing' && (e.target === canvas || (e.target.closest && e.target.closest('canvas')))) return;
      if (e.target && e.target.closest) {
        const uiTarget = e.target.closest('button, input, select, textarea, a, .hotbarSlot, .inventorySlot, .merchantItemRow, .merchantBuyButton, .craftRecipe, .mapControl, .overlayPanel');
        if (uiTarget || e.target.closest('#homeScreen, #pauseOverlay, #settingsModal, #inventoryOverlay, #craftingOverlay, #furnaceOverlay, #merchantOverlay, #mapOverlay')) {
          playAudio('uiClick', 0.34);
        }
      }
    }, true);

    let footstepWasActive = false;
    let nextPickaxeSoundAt = 0;
    let nextChopSoundAt = 0;
    let wasGroundedForAudio = true;
    let windNextStartAt = performance.now() + 12000 + Math.random() * 12000;
    let windStopAt = 0;
    let riverWasNear = false;
    let furnaceWasActive = false;
    let rocketEngineMode = 'off';
    let rocketLaunchPlayed = false;
    let lastRocketSpaceState = false;

    function setLoopAudioMode(key, active, volume = 0.25, playbackRate = 1) {
      const sound = audioBank[key];
      if (!sound) return;
      if (active) {
        sound._settingsBaseVolume = Math.max(0, Math.min(1, volume));
        sound._settingsAudioKey = key;
        sound._settingsCategory = getAudioCategory(key);
        sound.volume = getAudioVolume(key, sound._settingsBaseVolume);
        sound.playbackRate = playbackRate;
        if (sound.paused) sound.play().catch(() => {});
      } else if (!sound.paused) {
        sound.pause();
        sound.currentTime = 0;
      }
    }

    function updateAmbientAudio() {
      const now = performance.now();
      const canHearRain = state.gameState === 'playing' && !state.paused && weatherState === 'raining' && isWeatherAllowedHere();
      const weatherTransitioning = state.gameState === 'playing' && !state.paused && (weatherState === 'building' || weatherState === 'clearing') && isWeatherAllowedHere();
      // The uploaded rain recording is the dedicated weather loop. It plays continuously
      // for the actual raining phase and stops as soon as rain ends or the player rises
      // above the cloud deck.
      if (canHearRain) {
        setLoopAudioMode('rain', true, weatherThunderstorm ? 0.18 : 0.15, weatherThunderstorm ? 1.02 : 1.0);
      } else {
        setLoopAudioMode('rain', false);
      }
      if (weatherTransitioning) {
        const clearFactor = weatherState === 'clearing' ? 1 - THREE.MathUtils.clamp(weatherClearTimer / WEATHER_CLEARING_SECONDS, 0, 1) : 1;
        const buildFactor = weatherState === 'building' ? THREE.MathUtils.clamp(weatherBuildTimer / WEATHER_BUILDUP_SECONDS, 0, 1) : 1;
        const volume = (weatherThunderstorm ? 0.20 : 0.15) * clearFactor * (0.35 + 0.65 * buildFactor);
        // Keep the original wind loop as the subtle buildup/clearing ambience.
        setLoopAudioMode('wind', true, volume, weatherThunderstorm ? 1.02 : 1.0);
      } else if (canHearRain) {
        // During rain the dedicated rain loop replaces the old wind-as-rain workaround.
        setLoopAudioMode('wind', false);
      } else {
        setLoopAudioMode('wind', false);
      }
      const weatherAudioActive = weatherTransitioning || canHearRain;
      const playingWorld = state.gameState === 'playing' && !state.paused && !uiState.inventoryOpen && !uiState.craftingOpen && !uiState.furnaceOpen && !uiState.merchantOpen && !playerState.inRocket;
      let nearRiver = false;
      if (playingWorld) {
        const localDir = player.position.clone().normalize();
        const riverInfo = nearestRiverInfo(localDir);
        // A soft radius around the river lets the water ambience fade in before the shoreline.
        nearRiver = !!riverInfo && riverInfo.angle < 0.085;
      }
      if (nearRiver && !riverWasNear) setLoopAudioMode('river', true, 0.16, 1.0);
      else if (!nearRiver && riverWasNear) setLoopAudioMode('river', false);
      riverWasNear = nearRiver;

      if (playingWorld && !weatherAudioActive) {
        if (!windStopAt && now >= windNextStartAt) {
          windStopAt = now + 9000 + Math.random() * 9000;
          setLoopAudioMode('wind', true, 0.10 + Math.random() * 0.035, 0.96 + Math.random() * 0.08);
        }
        if (windStopAt && now >= windStopAt) {
          setLoopAudioMode('wind', false);
          windStopAt = 0;
          windNextStartAt = now + 18000 + Math.random() * 24000;
        }
      } else if (!weatherAudioActive) {
        setLoopAudioMode('rain', false);
        setLoopAudioMode('river', false);
        riverWasNear = false;
        setLoopAudioMode('wind', false);
        windStopAt = 0;
        windNextStartAt = now + 18000 + Math.random() * 24000;
      }
    }

    // ---------- home screen, pause overlay, settings modal ----------
    const homeScreen = document.getElementById("homeScreen");
    const homeLoading = document.getElementById("homeLoading");
    const homeButtons = document.getElementById("homeButtons");
    const playButton = document.getElementById("playButton");
    const homeSettingsButton = document.getElementById("homeSettingsButton");
    const loadGameButton = document.getElementById("loadGameButton");

    // ---------- achievements (account-wide, stored with the Supabase account) ----------
    // Gems are awarded from the achievement difficulty score discussed for each advancement.
    // Scores 1-4 earn 5 gems; 5-100 map to tier rewards 10-100.
    function achievementGemReward(difficulty) {
      const score = Math.max(1, Math.min(100, Number(difficulty) || 1));
      return score < 5 ? 5 : Math.min(100, Math.ceil(score / 10) * 10);
    }
    const ACHIEVEMENT_DIFFICULTIES = {
      spawn_ivis:1, first_crystal:2, all_crystals:18, first_tree:3, first_tool:5, first_stone_tool:8,
      first_iron_ingot:15, first_furnace:10, use_furnace:12, buy_merchant:6, sell_merchant:6, first_100_credits:22,
      far_from_home:17, reach_moon:28, land_moon:35, return_moon:40, reach_cordelia:45, land_cordelia:52,
      return_cordelia:58, catalogued:63, away_from_home:48, total_flight_distance:55, first_rocket:30,
      first_launch_pad:24, fuel_rocket:38, launch_first_space:32, voyager:62, long_spaceflight_land:72,
      takeoff_100:68, low_fuel_return:76, safe_flight:66, fuel_emergency:58, full_day_night:43, first_night:20,
      stone_20:14, iron_20:25, credits_1000:70, low_durability:34, tough_nut:64, space_10min:88, mir_station:98,
      sun_blackout_survived:60, moon_quartz_sale:24, upgraded_engine:42
    };

    const ACHIEVEMENTS = [
      { id: 'spawn_ivis', name: 'Welcome Home!', requirement: 'Spawn on Ivis for the first time.', icon: '⌂' },
      { id: 'first_crystal', name: 'Ooh, Shiny!', requirement: 'Collect your first crystal.', icon: '◆' },
      { id: 'all_crystals', name: 'Collectionist', requirement: 'Collect one of every crystal type.', icon: '✦' },
      { id: 'first_tree', name: 'Off with the stump!', requirement: 'Chop your first tree.', icon: '♣' },
      { id: 'first_tool', name: 'Handy!', requirement: 'Craft your first tool.', icon: '⚒' },
      { id: 'first_stone_tool', name: 'Upgrade!', requirement: 'Craft your first stone tool.', icon: '◆' },
      { id: 'first_iron_ingot', name: 'This one will last!', requirement: 'Smelt your first iron ingot.', icon: '▣' },
      { id: 'first_furnace', name: 'Burner 100', requirement: 'Craft your first furnace.', icon: '▤' },
      { id: 'use_furnace', name: 'ITS BURNING!!!', requirement: 'Use a furnace for the first time.', icon: '🔥' },
      { id: 'buy_merchant', name: 'Thanks for scamming me!', requirement: 'Buy something from the merchant.', icon: '¢' },
      { id: 'sell_merchant', name: 'Ill take that off yer hands!', requirement: 'Sell something to the merchant.', icon: '↗' },
      { id: 'first_100_credits', name: 'Business booming!', requirement: 'Earn your first 100 Credits.', icon: '100' },
      { id: 'far_from_home', name: 'Far from home', requirement: 'Travel 1000 units away from Ivis.', icon: '⇢' },
      { id: 'reach_moon', name: 'Artemis II', requirement: 'Reach the Moon for the first time.', icon: '☾' },
      { id: 'land_moon', name: 'One small step for a man', requirement: 'Land on the Moon safely.', icon: '◐' },
      { id: 'return_moon', name: 'Back home!', requirement: 'Return from the Moon to Ivis.', icon: '⌂' },
      { id: 'reach_cordelia', name: 'An alien world', requirement: 'Reach Cordelia for the first time.', icon: '◉' },
      { id: 'land_cordelia', name: 'Sandy!', requirement: 'Land on Cordelia safely.', icon: '≈' },
      { id: 'return_cordelia', name: 'East, West, Home is best!', requirement: 'Return from Cordelia.', icon: '⌂' },
      { id: 'catalogued', name: 'Catalogued', requirement: 'Visit every currently available celestial body.', icon: '✧' },
      { id: 'away_from_home', name: 'Земля в иллюминаторе', requirement: 'Spend 5 minutes away from Ivis.', icon: '◎' },
      { id: 'total_flight_distance', name: 'That mile counter!', requirement: 'Travel 10000 units across all flights combined.', icon: '↝' },
      { id: 'first_rocket', name: 'Space X', requirement: 'Build your first rocket.', icon: '🚀' },
      { id: 'first_launch_pad', name: 'I hope it wont fall over!', requirement: 'Place your first launchpad.', icon: '▰' },
      { id: 'fuel_rocket', name: 'Expensive Boom!', requirement: 'Fuel a rocket completely.', icon: '⛽' },
      { id: 'launch_first_space', name: 'TAKEOFF!', requirement: 'Launch into space for the first time.', icon: '↑' },
      { id: 'voyager', name: 'Voyager', requirement: 'Fly 3000 units in a single flight.', icon: '➜' },
      { id: 'long_spaceflight_land', name: 'Back Home (safely!)', requirement: 'Successfully land after a 5 minute spaceflight.', icon: '⌂' },
      { id: 'takeoff_100', name: 'Takeoff 100', requirement: 'Take off from every planet/moon that allows it.', icon: '✈' },
      { id: 'low_fuel_return', name: 'Survived by a whisker', requirement: 'Return to Ivis with under 10% fuel remaining.', icon: '10%' },
      { id: 'safe_flight', name: 'Better then Space X!', requirement: 'Complete a flight without crashing.', icon: '✓' },
      { id: 'fuel_emergency', name: 'Dont worry it happens to the worst of us!', requirement: 'Run out of fuel in space and trigger emergency recovery.', icon: '!' },
      { id: 'full_day_night', name: 'Day and Night', requirement: 'Survive your first full day/night cycle.', icon: '◒' },
      { id: 'first_night', name: "You didn't die!", requirement: 'Survive your first night.', icon: '☾' },
      { id: 'stone_20', name: 'Каменщик', requirement: 'Mine 20 stone.', icon: '20' },
      { id: 'iron_20', name: 'Iron ore, Best ore', requirement: 'Mine 20 iron.', icon: 'Fe' },
      { id: 'credits_1000', name: 'Leave some for the rest of us!', requirement: 'Reach 1000 Credits.', icon: '¢' },
      { id: 'low_durability', name: 'You still use that?', requirement: 'Keep an item/tool until its durability is under 5.', icon: '!' },
      { id: 'tough_nut', name: 'Tough nut to Crack', requirement: 'Complete 20 minutes of gameplay without dying/recovering.', icon: '20m' },
      { id: 'space_10min', name: 'Planning on going back anytime soon?', requirement: 'Spend 10 minutes in space.', icon: '10m' },
      { id: 'mir_station', name: 'Mir station is jealous', requirement: 'Travel 10000 units from Ivis in one trip and make it back.', icon: '???', secret: true },
      { id: 'sun_blackout_survived', name: "Can't touch that!", requirement: 'Start blacking out near the Sun and survive the recovery.', icon: '☀' },
      { id: 'moon_quartz_sale', name: 'Deal of a Lifetime', requirement: 'Collect Moon Quartz and sell it to the merchant.', icon: '☾' },
      { id: 'upgraded_engine', name: 'Houston, We Have an Upgrade!', requirement: 'Install Engine Mark 2.', icon: '🚀' },
    ];
    for (const achievement of ACHIEVEMENTS) {
      achievement.difficulty = ACHIEVEMENT_DIFFICULTIES[achievement.id] || 1;
      achievement.gems = achievementGemReward(achievement.difficulty);
    }
    const achievementsModal = document.getElementById('achievementsModal');
    const achievementsPanel = document.getElementById('achievementsPanel');
    const achievementsClose = document.getElementById('achievementsClose');
    const achievementsList = document.getElementById('achievementsList');
    const achievementsCounter = document.getElementById('achievementsCounter');
    const homeAchievementsButton = document.getElementById('homeAchievementsButton');
    const homeGems = document.getElementById('homeGems');
    const homeGemsAmount = document.getElementById('homeGemsAmount');
    const pauseAchievementsButton = document.getElementById('pauseAchievementsButton');
    let currentAccountUser = null;
    let accountAchievements = {};
    let accountGems = 0;
    // Account-wide lifetime statistics introduced in Day 8.
    let accountStatistics = {
      totalPlaytimeSeconds: 0,
      totalUnitsTraveled: 0,
      totalCreditsEarned: 0,
      totalCreditsSpent: 0,
      totalSpaceSeconds: 0
    };
    let accountStatsSaveTimer = 0;
    // ---------- character customization / hat shop ----------
    const COSMETIC_COLORS = [
      { id:'red', name:'Red', hex:0xe34a4a, free:true },
      { id:'orange', name:'Orange', hex:0xf28a2e, free:true },
      { id:'yellow', name:'Yellow', hex:0xf3d447, free:true },
      { id:'green', name:'Green', hex:0x48b75a, free:true },
      { id:'blue', name:'Blue', hex:0x4e83d8, free:true },
      { id:'purple', name:'Purple', hex:0x9b6be8, free:true },
      { id:'pink', name:'Pink', hex:0xf18bb7, cost:5 },
      { id:'black', name:'Black', hex:0x17191f, cost:5 },
      { id:'white', name:'White', hex:0xf1f3f6, cost:5 },
      { id:'gray', name:'Gray', hex:0x858c96, cost:5 },
      { id:'lime', name:'Lime', hex:0x9ad83f, cost:5 },
      { id:'teal', name:'Teal', hex:0x2db9ad, cost:5 },
      { id:'light_blue', name:'Light Blue', hex:0x71c8f4, cost:5 },
      { id:'rainbow', name:'Rainbow', hex:0xffffff, cost:10, rainbow:true },
    ];
    const COSMETIC_HATS = [
      { id:'banana_skin_hat', name:'Banana Hat', cost:15, fixed:true },
      { id:'fedora_hat', name:'Fedora Hat', cost:15, colored:true },
      { id:'top_hat', name:'Top-Hat', cost:20, fixed:true },
      { id:'baseball_hat', name:'Baseball Cap', cost:15, colored:true },
      { id:'wizard_hat_blue', name:'Wizard Hat', cost:30, fixed:true, fixedColor:'blue' },
      { id:'wizard_hat_red', name:'Wizard Hat', cost:30, fixed:true, fixedColor:'red' },
    ];
    const cosmeticColorById = Object.fromEntries(COSMETIC_COLORS.map(c => [c.id, c]));
    const cosmeticHatById = Object.fromEntries(COSMETIC_HATS.map(h => [h.id, h]));
    const FREE_COSMETIC_COLOR_IDS = COSMETIC_COLORS.filter(c => c.free).map(c => c.id);
    const DEFAULT_COSMETIC_STATE = {
      ownedColors: [...FREE_COSMETIC_COLOR_IDS],
      ownedHats: [],
      equippedColor: 'red',
      equippedHat: null,
    };
    let accountCosmetics = structuredClone(DEFAULT_COSMETIC_STATE);
    let cosmeticShopOpen = false;
    let rainbowCosmeticTime = 0;
    let accountAchievementProgress = {
      crystals: [],
      celestialBodies: ['ivis'],
      totalFlightDistance: 0,
      awayFromIvisSeconds: 0,
      takeoffBodies: [],
      stoneMined: 0,
      ironMined: 0,
      spaceSeconds: 0
    };
    let survivalRunSeconds = 0;
    let survivalRunSawNight = false;
    let rocketFlightMaxIvisDistance = 0;
    let achievementWriteChain = Promise.resolve();

    const ACHIEVEMENT_FAR_DISTANCE = 1000;
    const ACHIEVEMENT_AWAY_DISTANCE = 300;
    const ACHIEVEMENT_AWAY_TIME = 5 * 60;
    const ACHIEVEMENT_TOTAL_FLIGHT_DISTANCE = 10000;
    const flightAchievementFrameStart = new THREE.Vector3();
    let achievementTelemetrySaveTimer = 0;
    let rocketFlightElapsedSeconds = 0;
    let rocketFlightDistance = 0;
    let rocketFlightOriginBody = 'ivis';
    let rocketFlightHasMoved = false;

    function sanitizeAchievementState(raw) {
      const out = {};
      if (raw && typeof raw === 'object') {
        for (const a of ACHIEVEMENTS) if (raw[a.id]) out[a.id] = true;
      }
      return out;
    }
    function sanitizeAccountGems(raw) {
      return Math.max(0, Math.floor(Number(raw) || 0));
    }
    function sanitizeAccountStatistics(raw) {
      return {
        totalPlaytimeSeconds: Math.max(0, Number(raw && raw.totalPlaytimeSeconds) || 0),
        totalUnitsTraveled: Math.max(0, Number(raw && raw.totalUnitsTraveled) || 0),
        totalCreditsEarned: Math.max(0, Number(raw && raw.totalCreditsEarned) || 0),
        totalCreditsSpent: Math.max(0, Number(raw && raw.totalCreditsSpent) || 0),
        totalSpaceSeconds: Math.max(0, Number(raw && raw.totalSpaceSeconds) || 0)
      };
    }
    function sanitizeCosmeticState(raw) {
      const state = {
        ownedColors: [...FREE_COSMETIC_COLOR_IDS],
        ownedHats: [],
        equippedColor: 'red',
        equippedHat: null,
      };
      if (raw && typeof raw === 'object') {
        if (Array.isArray(raw.ownedColors)) state.ownedColors.push(...raw.ownedColors.filter(id => cosmeticColorById[id]));
        if (Array.isArray(raw.ownedHats)) state.ownedHats.push(...raw.ownedHats.filter(id => {
          if (cosmeticHatById[id]) return true;
          const parts = String(id).split(':');
          return parts.length === 2 && cosmeticHatById[parts[0]] && cosmeticColorById[parts[1]] && cosmeticHatById[parts[0]].colored;
        }));
        if (cosmeticColorById[raw.equippedColor]) state.equippedColor = raw.equippedColor;
        if (raw.equippedHat == null || cosmeticHatById[raw.equippedHat] || (typeof raw.equippedHat === 'string' && raw.equippedHat.includes(':'))) state.equippedHat = raw.equippedHat || null;
      }
      state.ownedColors = [...new Set(state.ownedColors)];
      state.ownedHats = [...new Set(state.ownedHats)];
      if (!state.ownedColors.includes(state.equippedColor)) state.equippedColor = 'red';
      if (state.equippedHat && !state.ownedHats.includes(state.equippedHat)) state.equippedHat = null;
      return state;
    }
    function cosmeticHatDisplay(hatId) {
      const [baseId, colorId] = String(hatId).split(':');
      const hat = cosmeticHatById[baseId];
      const color = colorId ? cosmeticColorById[colorId] : null;
      return hat ? (hat.name + (color ? ' · ' + color.name : '')) : hatId;
    }
    function cosmeticColorHex(colorId) {
      return cosmeticColorById[colorId]?.hex ?? 0xe0763c;
    }
    function cosmeticHatKey(baseId, colorId=null) {
      return colorId ? baseId + ':' + colorId : baseId;
    }
    function getEquippedHatVisualSpec() {
      if (!accountCosmetics.equippedHat) return null;
      const [baseId, colorId] = String(accountCosmetics.equippedHat).split(':');
      const hatDef = cosmeticHatById[baseId];
      return { baseId, colorId: hatDef?.fixedColor || colorId || accountCosmetics.equippedColor };
    }
    function applyRainbowHatColors(root, phase) {
      if (!root) return;
      const hue = ((phase % (Math.PI * 2)) / (Math.PI * 2) + 1) % 1;
      root.traverse(obj => {
        const mat = obj && obj.material;
        if (!mat || !mat.userData || !mat.userData.cosmeticRainbowPart || !mat.color) return;
        mat.color.setHSL((hue + (obj.id % 7) * 0.045) % 1, 0.82, 0.56);
      });
    }
    function updatePlayerHatVisibility() {
      if (typeof playerBody === 'undefined' || !playerBody) return;
      const hatVisible = !!playerState.thirdPerson;
      for (const child of playerBody.children) {
        if (child && child.userData && child.userData.cosmeticHatVisual) child.visible = hatVisible;
      }
    }
    function applyPlayerCosmetics() {
      if (typeof playerBody === 'undefined' || !playerBody) return;
      playerBody.material.color.setHex(cosmeticColorHex(accountCosmetics.equippedColor));
      while (playerBody.children.length) playerBody.remove(playerBody.children[playerBody.children.length-1]);
      const spec = getEquippedHatVisualSpec();
      if (spec) {
        const hat = createHatVisual(spec.baseId, cosmeticColorHex(spec.colorId));
        hat.position.set(0, 0.72, 0);
        hat.rotation.y = 0;
        hat.scale.setScalar(1.05);
        hat.layers.set(1);
        hat.visible = !!playerState.thirdPerson;
        playerBody.add(hat);
        if(spec.colorId === 'rainbow') applyRainbowHatColors(hat, rainbowCosmeticTime);
      }
      updatePlayerHatVisibility();
    }
    function cosmeticMetadataSnapshot() {
      return {
        ownedColors: [...accountCosmetics.ownedColors],
        ownedHats: [...accountCosmetics.ownedHats],
        equippedColor: accountCosmetics.equippedColor,
        equippedHat: accountCosmetics.equippedHat
      };
    }
    function updateHomeGemsAndCosmeticsUI() {
      renderAccountGems();
      renderCosmeticShop();
      updateCosmeticPreview();
    }
    function renderAccountGems() {
      if (!homeGems || !homeGemsAmount) return;
      homeGemsAmount.textContent = String(accountGems);
      homeGems.classList.toggle('hidden', !currentAccountUser);
    }

    function formatAccountDuration(seconds) {
      const whole = Math.max(0, Math.floor(Number(seconds) || 0));
      const days = Math.floor(whole / 86400);
      const hours = Math.floor((whole % 86400) / 3600);
      const minutes = Math.floor((whole % 3600) / 60);
      const secs = whole % 60;
      if (days > 0) return days + 'd ' + hours + 'h ' + minutes + 'm';
      if (hours > 0) return hours + 'h ' + minutes + 'm ' + String(secs).padStart(2, '0') + 's';
      return minutes + 'm ' + String(secs).padStart(2, '0') + 's';
    }

    function renderAccountStatistics() {
      if (!currentAccountUser) return;
      const valueMap = {
        accountStatPlaytime: formatAccountDuration(accountStatistics.totalPlaytimeSeconds),
        accountStatTravel: Math.floor(accountStatistics.totalUnitsTraveled).toLocaleString() + ' u',
        accountStatEarned: '¢ ' + Math.floor(accountStatistics.totalCreditsEarned).toLocaleString(),
        accountStatSpent: '¢ ' + Math.floor(accountStatistics.totalCreditsSpent).toLocaleString(),
        accountStatAway: formatAccountDuration(accountStatistics.totalSpaceSeconds),
        accountStatAchievements: ACHIEVEMENTS.reduce((n, a) => n + (accountAchievements[a.id] ? 1 : 0), 0) + ' / ' + ACHIEVEMENTS.length
      };
      for (const [id, value] of Object.entries(valueMap)) {
        const el = document.getElementById(id);
        if (el) el.textContent = value;
      }
    }
    function sanitizeAchievementProgress(raw) {
      const crystals = Array.isArray(raw && raw.crystals) ? raw.crystals.filter(id => crystalById && crystalById[id]) : [];
      const celestialBodies = Array.isArray(raw && raw.celestialBodies)
        ? raw.celestialBodies.filter(id => ['ivis', 'moon', 'cordelia'].includes(id))
        : [];
      if (!celestialBodies.includes('ivis')) celestialBodies.push('ivis');
      return {
        crystals: [...new Set(crystals)],
        celestialBodies: [...new Set(celestialBodies)],
        totalFlightDistance: Math.max(0, Number(raw && raw.totalFlightDistance) || 0),
        awayFromIvisSeconds: Math.max(0, Number(raw && raw.awayFromIvisSeconds) || 0),
        takeoffBodies: [...new Set(Array.isArray(raw && raw.takeoffBodies) ? raw.takeoffBodies.filter(id => ['ivis', 'moon', 'cordelia'].includes(id)) : [])],
        stoneMined: Math.max(0, Math.floor(Number(raw && raw.stoneMined) || 0)),
        ironMined: Math.max(0, Math.floor(Number(raw && raw.ironMined) || 0)),
        spaceSeconds: Math.max(0, Number(raw && raw.spaceSeconds) || 0)
      };
    }
    function renderAchievements() {
      if (!achievementsList) return;
      const unlockedCount = ACHIEVEMENTS.reduce((n, a) => n + (accountAchievements[a.id] ? 1 : 0), 0);
      achievementsCounter.textContent = unlockedCount + ' / ' + ACHIEVEMENTS.length;
      achievementsList.replaceChildren();
      for (const achievement of ACHIEVEMENTS) {
        const unlocked = !!accountAchievements[achievement.id];
        const card = document.createElement('div');
        card.className = 'achievementCard ' + (unlocked ? 'unlocked' : 'locked');
        const displayRequirement = achievement.secret && !unlocked
          ? 'This advancement needs something to get it!'
          : achievement.requirement;
        card.title = currentAccountUser
          ? displayRequirement
          : 'Log in to earn account achievements. ' + displayRequirement;
        const icon = document.createElement('div');
        icon.className = 'achievementIcon';
        icon.textContent = achievement.icon;
        const info = document.createElement('div');
        info.className = 'achievementInfo';
        const name = document.createElement('div');
        name.className = 'achievementName';
        name.textContent = achievement.name;
        const requirement = document.createElement('div');
        requirement.className = 'achievementRequirement';
        requirement.textContent = displayRequirement;
        info.append(name, requirement);
        const reward = document.createElement('div');
        reward.className = 'achievementReward';
        reward.innerHTML = '<span class="achievementRewardIcon">◆</span> ' + achievement.gems + ' GEMS';
        reward.title = achievement.gems + ' gems';
        const status = document.createElement('div');
        status.className = 'achievementState';
        status.textContent = unlocked ? 'UNLOCKED' : 'LOCKED';
        card.append(icon, info, reward, status);
        achievementsList.appendChild(card);
      }
    }
    function openAchievements() {
      renderAchievements();
      // Never allow the achievements overlay to coexist with the gameplay pointer lock.
      if (document.pointerLockElement === canvas) document.exitPointerLock();
      achievementsModal.classList.remove('hidden');
      achievementsModal.setAttribute('aria-hidden', 'false');
      document.body.classList.add('achievements-open');
    }
    function closeAchievements() {
      achievementsModal.classList.add('hidden');
      achievementsModal.setAttribute('aria-hidden', 'true');
      document.body.classList.remove('achievements-open');
    }
    function hydrateAccountAchievementState(user) {
      currentAccountUser = user || null;
      accountAchievements = sanitizeAchievementState(user && user.user_metadata && user.user_metadata.pocketUniverseAchievements);
      const rawGems = user && user.user_metadata ? user.user_metadata.pocketUniverseGems : undefined;
      if (rawGems === undefined && user) {
        // One-time migration for accounts that already had achievements before gems existed.
        accountGems = ACHIEVEMENTS.reduce((sum, achievement) => sum + (accountAchievements[achievement.id] ? achievement.gems : 0), 0);
        const metadata = { ...(user.user_metadata || {}) };
        metadata.pocketUniverseGems = accountGems;
        if (pocketSupabase) pocketSupabase.auth.updateUser({ data: metadata }).catch(error => console.warn('Could not initialize account gems', error));
      } else {
        accountGems = sanitizeAccountGems(rawGems);
      }
      renderAccountGems();
      accountAchievementProgress = sanitizeAchievementProgress(user && user.user_metadata && user.user_metadata.pocketUniverseAchievementProgress);
      const rawStatistics = user && user.user_metadata ? user.user_metadata.pocketUniverseStatistics : undefined;
      accountStatistics = sanitizeAccountStatistics(rawStatistics);
      // Migrate the two statistics we already tracked during Day 7 for existing accounts.
      if (rawStatistics === undefined) {
        accountStatistics.totalUnitsTraveled = accountAchievementProgress.totalFlightDistance;
        accountStatistics.totalSpaceSeconds = accountAchievementProgress.spaceSeconds;
      }
      accountStatsSaveTimer = 0;
      accountCosmetics = sanitizeCosmeticState(user && user.user_metadata && user.user_metadata.pocketUniverseCosmetics);
      applyPlayerCosmetics();
      renderAchievements();
      updateHomeGemsAndCosmeticsUI();
    }
    function persistAchievementState() {
      if (!pocketSupabase || !currentAccountUser) return Promise.resolve(false);
      const user = currentAccountUser;
      const metadata = { ...(user.user_metadata || {}) };
      metadata.pocketUniverseAchievements = { ...accountAchievements };
      metadata.pocketUniverseGems = accountGems;
      metadata.pocketUniverseStatistics = {
        totalPlaytimeSeconds: accountStatistics.totalPlaytimeSeconds,
        totalUnitsTraveled: accountStatistics.totalUnitsTraveled,
        totalCreditsEarned: accountStatistics.totalCreditsEarned,
        totalCreditsSpent: accountStatistics.totalCreditsSpent,
        totalSpaceSeconds: accountStatistics.totalSpaceSeconds
      };
      metadata.pocketUniverseAchievementProgress = {
        crystals: [...accountAchievementProgress.crystals],
        celestialBodies: [...accountAchievementProgress.celestialBodies],
        totalFlightDistance: accountAchievementProgress.totalFlightDistance,
        awayFromIvisSeconds: accountAchievementProgress.awayFromIvisSeconds,
        takeoffBodies: [...accountAchievementProgress.takeoffBodies],
        stoneMined: accountAchievementProgress.stoneMined,
        ironMined: accountAchievementProgress.ironMined,
        spaceSeconds: accountAchievementProgress.spaceSeconds
      };
      metadata.pocketUniverseCosmetics = cosmeticMetadataSnapshot();
      achievementWriteChain = achievementWriteChain.then(async () => {
        const { data, error } = await pocketSupabase.auth.updateUser({ data: metadata });
        if (error) throw error;
        if (data && data.user) currentAccountUser = data.user;
        return true;
      }).catch(error => {
        console.warn('Could not save achievement progress', error);
        return false;
      });
      return achievementWriteChain;
    }
    const achievementToast = document.getElementById('achievementToast');
    const achievementToastName = document.getElementById('achievementToastName');
    let achievementToastQueue = [];
    let achievementToastBusy = false;

    function showAchievementToast(achievement) {
      if (!achievementToast || !achievementToastName) return;
      achievementToastQueue.push(achievement);
      if (!achievementToastBusy) processAchievementToastQueue();
    }

    async function processAchievementToastQueue() {
      if (achievementToastBusy || !achievementToast || !achievementToastName) return;
      const next = achievementToastQueue.shift();
      if (!next) return;
      achievementToastBusy = true;
      achievementToast.classList.remove('hide', 'show');
      // Restart the CSS animation even when two achievements are earned close together.
      void achievementToast.offsetWidth;
      achievementToastName.textContent = next.name;
      achievementToast.classList.add('show');
      playAudio('achievement', 0.72);
      await new Promise(resolve => setTimeout(resolve, 2000));
      achievementToast.classList.remove('show');
      void achievementToast.offsetWidth;
      achievementToast.classList.add('hide');
      await new Promise(resolve => setTimeout(resolve, 450));
      achievementToast.classList.remove('hide');
      achievementToastBusy = false;
      if (achievementToastQueue.length) processAchievementToastQueue();
    }

    function awardAchievement(id) {
      // Achievements are deliberately Survival-only. Freeplay can never unlock or progress them.
      if (state.gameMode !== 'survival') return false;
      if (!currentAccountUser || !ACHIEVEMENTS.some(a => a.id === id) || accountAchievements[id]) return false;
      const achievement = ACHIEVEMENTS.find(a => a.id === id);
      accountAchievements[id] = true;
      accountGems += achievement.gems;
      renderAchievements();
      renderAccountGems();
      persistAchievementState();
      showAchievementToast(achievement);
      return true;
    }
    function recordCrystalAchievement(typeId) {
      if (!currentAccountUser || state.gameMode !== 'survival') return;
      if (!accountAchievementProgress.crystals.includes(typeId)) {
        accountAchievementProgress.crystals.push(typeId);
        persistAchievementState();
      }
      awardAchievement('first_crystal');
      if (accountAchievementProgress.crystals.length >= CRYSTAL_TYPES.length) awardAchievement('all_crystals');
    }

    function recordCelestialBodyVisit(bodyId) {
      markJournalBodyVisited(bodyId);
      if (!currentAccountUser || state.gameMode !== 'survival') return;
      if (!accountAchievementProgress.celestialBodies.includes(bodyId)) {
        accountAchievementProgress.celestialBodies.push(bodyId);
        persistAchievementState();
      }
      if (bodyId === 'moon') awardAchievement('reach_moon');
      if (bodyId === 'cordelia') awardAchievement('reach_cordelia');
      if (accountAchievementProgress.celestialBodies.includes('ivis') &&
          accountAchievementProgress.celestialBodies.includes('moon') &&
          accountAchievementProgress.celestialBodies.includes('cordelia')) {
        awardAchievement('catalogued');
      }
    }

    function recordRocketTakeoff(bodyId) {
      if (!currentAccountUser || state.gameMode !== 'survival') return;
      if (bodyId && !accountAchievementProgress.takeoffBodies.includes(bodyId)) {
        accountAchievementProgress.takeoffBodies.push(bodyId);
        persistAchievementState();
      }
      if (['ivis', 'moon', 'cordelia'].every(id => accountAchievementProgress.takeoffBodies.includes(id))) {
        awardAchievement('takeoff_100');
      }
      rocketFlightElapsedSeconds = 0;
      rocketFlightDistance = 0;
      rocketFlightOriginBody = bodyId || 'ivis';
      rocketFlightHasMoved = false;
      rocketFlightMaxIvisDistance = 0;
    }

    function recordFlightAchievementProgress(distanceThisFrame, delta, currentWorldDistance) {
      if (!currentAccountUser || state.gameMode !== 'survival') return;
      let changed = false;
      if (playerState.inRocket && !playerState.rocketLanded) {
        rocketFlightElapsedSeconds += Math.max(0, delta);
        if (distanceThisFrame > 0.0001) {
          rocketFlightDistance += distanceThisFrame;
          rocketFlightHasMoved = true;
          accountAchievementProgress.totalFlightDistance += distanceThisFrame;
          changed = true;
          if (accountAchievementProgress.totalFlightDistance >= ACHIEVEMENT_TOTAL_FLIGHT_DISTANCE) {
            awardAchievement('total_flight_distance');
          }
          if (rocketFlightDistance >= 3000) awardAchievement('voyager');
        }
      }
      if (currentWorldDistance >= ACHIEVEMENT_FAR_DISTANCE) awardAchievement('far_from_home');
      if (changed && Math.random() < 0.08) persistAchievementState();
    }
    // Achievement UI is completely isolated from the menu planet drag system.
    function stopAchievementPointerEvent(e) {
      e.stopPropagation();
    }
    homeAchievementsButton.addEventListener('pointerdown', (e) => e.stopPropagation());
    homeAchievementsButton.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation(); openAchievements(); });
    pauseAchievementsButton.addEventListener('pointerdown', (e) => e.stopPropagation());
    pauseAchievementsButton.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation(); openAchievements(); });
    achievementsClose.addEventListener('pointerdown', stopAchievementPointerEvent);
    achievementsClose.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation(); closeAchievements(); });
    achievementsPanel.addEventListener('pointerdown', stopAchievementPointerEvent);
    achievementsPanel.addEventListener('pointermove', stopAchievementPointerEvent);
    achievementsPanel.addEventListener('pointerup', stopAchievementPointerEvent);
    achievementsPanel.addEventListener('click', stopAchievementPointerEvent);
    achievementsModal.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
    });
    achievementsModal.addEventListener('pointermove', (e) => e.stopPropagation());
    achievementsModal.addEventListener('pointerup', (e) => e.stopPropagation());
    achievementsModal.addEventListener('click', (e) => {
      e.stopPropagation();
      if (e.target === achievementsModal) closeAchievements();
    });
    document.addEventListener('keydown', (e) => {
      if (!achievementsModal.classList.contains('hidden') && e.key === 'Escape') { e.preventDefault(); closeAchievements(); }
    });
    renderAchievements();

    // ---------- account dialog (isolated from the menu preview) ----------
    const homeCreditsButton = document.getElementById("homeCreditsButton");
    const creditsModal = document.getElementById("creditsModal");
    const creditsPanel = document.getElementById("creditsPanel");
    const creditsClose = document.getElementById("creditsClose");

    function openCredits() {
      if (document.pointerLockElement === canvas) document.exitPointerLock();
      creditsModal.classList.remove("hidden");
      creditsModal.setAttribute("aria-hidden", "false");
    }
    function closeCredits() {
      creditsModal.classList.add("hidden");
      creditsModal.setAttribute("aria-hidden", "true");
    }
    homeCreditsButton.addEventListener("click", (e) => { e.preventDefault(); e.stopPropagation(); openCredits(); });
    creditsClose.addEventListener("click", (e) => { e.preventDefault(); e.stopPropagation(); closeCredits(); });
    creditsPanel.addEventListener("click", (e) => e.stopPropagation());
    creditsModal.addEventListener("click", (e) => { if (e.target === creditsModal) closeCredits(); });
    document.addEventListener("keydown", (e) => { if (!creditsModal.classList.contains("hidden") && e.key === "Escape") { e.preventDefault(); closeCredits(); } });

    const accountButton = document.getElementById("accountButton");
    const accountModal = document.getElementById("accountModal");
    const accountPanel = document.getElementById("accountPanel");
    const accountClose = document.getElementById("accountClose");
    const accountLoggedOut = document.getElementById("accountLoggedOut");
    const accountLoggedIn = document.getElementById("accountLoggedIn");
    const accountTitle = document.getElementById("accountTitle");
    const accountSubtitle = document.getElementById("accountSubtitle");
    const accountEmail = document.getElementById("accountEmail");
    const accountUsername = document.getElementById("accountUsername");
    const accountPassword = document.getElementById("accountPassword");
    const accountSubmit = document.getElementById("accountSubmit");
    const accountModeToggle = document.getElementById("accountModeToggle");
    const accountStatus = document.getElementById("accountStatus");
    const accountProfileUsername = document.getElementById("accountProfileUsername");
    const accountProfileEmail = document.getElementById("accountProfileEmail");
    const accountLogout = document.getElementById("accountLogout");
    const accountLoggedInStatus = document.getElementById("accountLoggedInStatus");
    let accountSignupMode = false;

    function setAccountStatus(message, kind = "") {
      accountStatus.textContent = message || "";
      accountStatus.className = "accountStatus" + (kind ? " " + kind : "");
    }
    function setAccountLoggedInStatus(message, kind = "") {
      accountLoggedInStatus.textContent = message || "";
      accountLoggedInStatus.className = "accountStatus" + (kind ? " " + kind : "");
    }
    function renderAccountMode() {
      accountPanel.classList.toggle("accountSignup", accountSignupMode);
      accountTitle.textContent = accountSignupMode ? "Create account" : "Log in";
      accountSubtitle.textContent = accountSignupMode ? "Create your Pocket Universe account." : "Log in to your Pocket Universe account.";
      accountSubmit.textContent = accountSignupMode ? "CREATE ACCOUNT" : "LOG IN";
      accountModeToggle.textContent = accountSignupMode ? "Already have an account? Log in" : "Need an account? Create one";
      accountPassword.autocomplete = accountSignupMode ? "new-password" : "current-password";
      setAccountStatus("");
    }
    async function refreshAccountState() {
      if (!pocketSupabase) return null;
      const { data, error } = await pocketSupabase.auth.getSession();
      if (error) { console.warn("Supabase session lookup failed", error); return null; }
      const user = data && data.session ? data.session.user : null;
      hydrateAccountAchievementState(user);
      if (!user) { accountLoggedOut.classList.remove("hidden"); accountLoggedIn.classList.add("hidden"); return null; }
      const username = (user.user_metadata && user.user_metadata.username) || (user.email ? user.email.split("@")[0] : "Explorer");
      accountProfileUsername.textContent = username;
      accountProfileEmail.textContent = user.email || "—";
      accountLoggedOut.classList.add("hidden");
      accountLoggedIn.classList.remove("hidden");
      return user;
    }
    function openAccount() {
      accountSignupMode = false;
      renderAccountMode();
      accountModal.classList.remove("hidden");
      accountModal.setAttribute("aria-hidden", "false");
      refreshAccountState();
      setTimeout(() => accountEmail.focus(), 0);
    }
    function closeAccount() {
      accountModal.classList.add("hidden");
      accountModal.setAttribute("aria-hidden", "true");
      accountPassword.value = "";
      setAccountStatus("");
      setAccountLoggedInStatus("");
    }
    async function submitAccount() {
      if (!pocketSupabase) { setAccountStatus("Account service is unavailable right now.", "error"); return; }
      const email = accountEmail.value.trim();
      const password = accountPassword.value;
      const username = accountUsername.value.trim();
      if (!email || !password || (accountSignupMode && !username)) {
        setAccountStatus(accountSignupMode ? "Enter a username, email, and password." : "Enter your email and password.", "error");
        return;
      }
      accountSubmit.disabled = true;
      setAccountStatus(accountSignupMode ? "Creating your account…" : "Logging in…");
      try {
        if (accountSignupMode) {
          const { data, error } = await pocketSupabase.auth.signUp({ email, password, options: { data: { username } } });
          if (error) throw error;
          accountPassword.value = "";
          if (data && data.session) {
            await refreshAccountState();
            setAccountLoggedInStatus("Account created successfully.", "success");
          } else {
            accountSignupMode = false;
            renderAccountMode();
            setAccountStatus("Account created! Check your email if confirmation is required, then log in.", "success");
          }
        } else {
          const { error } = await pocketSupabase.auth.signInWithPassword({ email, password });
          if (error) throw error;
          accountPassword.value = "";
          await refreshAccountState();
          setAccountLoggedInStatus("Logged in successfully.", "success");
        }
      } catch (error) {
        setAccountStatus(error && error.message ? error.message : "Something went wrong.", "error");
      } finally { accountSubmit.disabled = false; }
    }
    async function logoutAccount() {
      if (!pocketSupabase) return;
      accountLogout.disabled = true;
      setAccountLoggedInStatus("Logging out…");
      try {
        const { error } = await pocketSupabase.auth.signOut();
        if (error) throw error;
        accountLoggedIn.classList.add("hidden");
        accountLoggedOut.classList.remove("hidden");
        hydrateAccountAchievementState(null);
        accountSignupMode = false;
        renderAccountMode();
        setAccountStatus("Logged out successfully.", "success");
      } catch (error) {
        setAccountLoggedInStatus(error && error.message ? error.message : "Could not log out.", "error");
      } finally { accountLogout.disabled = false; }
    }
    accountButton.addEventListener("click", (e) => { e.preventDefault(); e.stopPropagation(); openAccount(); });
    accountClose.addEventListener("click", (e) => { e.preventDefault(); e.stopPropagation(); closeAccount(); });
    accountPanel.addEventListener("click", (e) => e.stopPropagation());
    accountModal.addEventListener("pointerdown", (e) => e.stopPropagation());
    accountModal.addEventListener("pointermove", (e) => e.stopPropagation());
    accountModal.addEventListener("pointerup", (e) => e.stopPropagation());
    accountSubmit.addEventListener("click", (e) => { e.preventDefault(); e.stopPropagation(); submitAccount(); });
    accountModeToggle.addEventListener("click", (e) => { e.preventDefault(); e.stopPropagation(); accountSignupMode = !accountSignupMode; renderAccountMode(); (accountSignupMode ? accountUsername : accountEmail).focus(); });
    accountLogout.addEventListener("click", (e) => { e.preventDefault(); e.stopPropagation(); logoutAccount(); });
    [accountEmail, accountUsername, accountPassword].forEach((el) => {
      el.addEventListener("pointerdown", (e) => e.stopPropagation());
      el.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); submitAccount(); } });
    });
    accountModal.addEventListener("click", (e) => { if (e.target === accountModal) closeAccount(); });
    renderAccountMode();
    if (pocketSupabase) {
      pocketSupabase.auth.onAuthStateChange(() => setTimeout(refreshAccountState, 0));
      refreshAccountState();
    }

    function updateInventoryActionButton() {
      if (!inventoryCraftButton) return;
      const freeplay = state.gameMode === 'freeplay';
      inventoryCraftButton.textContent = freeplay ? 'Freeplay Inventory' : 'Craft';
      inventoryCraftButton.title = freeplay ? 'Open Freeplay Inventory' : 'Open crafting';
    }
    const saveFileInput = document.getElementById("saveFileInput");
    const pauseOverlay = document.getElementById("pauseOverlay");
    const settingsModal = document.getElementById("settingsModal");
    const settingsClose = document.getElementById("settingsClose");
    const transitionFade = document.getElementById("transitionFade");
    const controlsToggle = document.getElementById("controlsToggle");
    const flashlightStatus = document.getElementById("flashlightStatus");
    const rocketFlightStatus = document.getElementById("rocketFlightStatus");
    const rocketFlightFlightStats = document.getElementById("rocketFlightFlightStats");
    const rocketFlightNearbyStats = document.getElementById("rocketFlightNearbyStats");
    const rocketFlightFuel = document.getElementById("rocketFlightFuel");
    const rocketFlightTime = document.getElementById("rocketFlightTime");
    const rocketFlightSpeed = document.getElementById("rocketFlightSpeed");
    const rocketFlightConsumption = document.getElementById("rocketFlightConsumption");
    const rocketFlightUpgradeStats = document.getElementById("rocketFlightUpgradeStats");
    const rocketFlightUpgrades = document.getElementById("rocketFlightUpgrades");
    const rocketNearbyEngine = document.getElementById("rocketNearbyEngine");
    const rocketNearbyTank = document.getElementById("rocketNearbyTank");
    const rocketFlightContext = document.getElementById("rocketFlightContext");
    const rocketFlightAltitude = document.getElementById("rocketFlightAltitude");
    const rocketFlightRange = document.getElementById("rocketFlightRange");
    const saveToast = document.getElementById("saveToast");

    document.getElementById('inventorySortButton').addEventListener('click', (e) => { e.stopPropagation(); sortInventoryResources(); });
    inventoryCraftButton.addEventListener('click', (e) => {
      e.stopPropagation();
      if (state.gameMode === 'freeplay') {
        // The Freeplay Inventory button lives inside the normal inventory window.
        // Close that window first so its open-state guard does not block the new UI.
        if (uiState.inventoryOpen) {
          uiState.inventoryOpen = false;
          document.getElementById('inventoryOverlay').classList.add('hidden');
        }
        openFreeplayInventory();
      } else {
        openCrafting();
      }
    });
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

    freeplayInventoryClose.addEventListener('click', (e) => { e.stopPropagation(); closeFreeplayInventory(); });
    backpackClose.addEventListener('click', (e) => { e.stopPropagation(); closeBackpackStorage(); updateInventoryUI(); });
    freeplayInventoryOverlay.addEventListener('click', (e) => { if (e.target === freeplayInventoryOverlay) closeFreeplayInventory(); });
    freeplayInventoryNextPage.addEventListener('click', (e) => {
      e.stopPropagation();
      const pageCount = Math.max(1, Math.ceil(ITEM_TYPES.length / FREEPLAY_INVENTORY_PAGE_SIZE));
      if (pageCount <= 1) return;
      freeplayInventoryPage = (freeplayInventoryPage + 1) % pageCount;
      freeplayInventoryStatusEl.textContent = '';
      updateFreeplayInventoryUI();
    });

    document.querySelectorAll('.hotbarSlot').forEach((slot, index) => {
      slot.addEventListener('click', () => selectHotbarSlot(index));
    });

    const settingsHome = document.getElementById('settingsHome');
    const settingsControlsPage = document.getElementById('settingsControlsPage');
    const settingsSoundPage = document.getElementById('settingsSoundPage');
    const settingsFovPage = document.getElementById('settingsFovPage');
    const settingsUpdateLogPage = document.getElementById('settingsUpdateLogPage');
    const settingsControlsButton = document.getElementById('settingsControlsButton');
    const settingsSoundButton = document.getElementById('settingsSoundButton');
    const settingsFovButton = document.getElementById('settingsFovButton');
    const settingsUpdateLogButton = document.getElementById('settingsUpdateLogButton');
    const settingsVolumeSlider = document.getElementById('settingsVolumeSlider');
    const settingsVolumeValue = document.getElementById('settingsVolumeValue');
    const settingsInteractSlider = document.getElementById('settingsInteractSlider');
    const settingsInteractValue = document.getElementById('settingsInteractValue');
    const settingsPlayerSlider = document.getElementById('settingsPlayerSlider');
    const settingsPlayerValue = document.getElementById('settingsPlayerValue');
    const settingsNatureSlider = document.getElementById('settingsNatureSlider');
    const settingsNatureValue = document.getElementById('settingsNatureValue');
    const settingsWorldSlider = document.getElementById('settingsWorldSlider');
    const settingsWorldValue = document.getElementById('settingsWorldValue');
    const settingsMusicSlider = document.getElementById('settingsMusicSlider');
    const settingsMusicValue = document.getElementById('settingsMusicValue');
    const settingsFovSlider = document.getElementById('settingsFovSlider');
    const settingsFovValue = document.getElementById('settingsFovValue');

    function showSettingsPage(page) {
      [settingsHome, settingsControlsPage, settingsSoundPage, settingsFovPage, settingsUpdateLogPage].forEach((el) => el.classList.add('hidden'));
      (page || settingsHome).classList.remove('hidden');
    }
    function syncSettingsUI() {
      const volumePercent = Math.round(settingsMasterVolume * 100);
      const interactPercent = Math.round(settingsInteractVolume * 100);
      const playerPercent = Math.round(settingsPlayerVolume * 100);
      const naturePercent = Math.round(settingsNatureVolume * 100);
      const worldPercent = Math.round(settingsWorldVolume * 100);
      const musicPercent = Math.round(settingsMusicVolume * 100);
      if (settingsVolumeSlider) settingsVolumeSlider.value = String(volumePercent);
      if (settingsVolumeValue) settingsVolumeValue.textContent = volumePercent + '%';
      if (settingsInteractSlider) settingsInteractSlider.value = String(interactPercent);
      if (settingsInteractValue) settingsInteractValue.textContent = interactPercent + '%';
      if (settingsPlayerSlider) settingsPlayerSlider.value = String(playerPercent);
      if (settingsPlayerValue) settingsPlayerValue.textContent = playerPercent + '%';
      if (settingsNatureSlider) settingsNatureSlider.value = String(naturePercent);
      if (settingsNatureValue) settingsNatureValue.textContent = naturePercent + '%';
      if (settingsWorldSlider) settingsWorldSlider.value = String(worldPercent);
      if (settingsWorldValue) settingsWorldValue.textContent = worldPercent + '%';
      if (settingsMusicSlider) settingsMusicSlider.value = String(musicPercent);
      if (settingsMusicValue) settingsMusicValue.textContent = musicPercent + '%';
      if (settingsFovSlider) settingsFovSlider.value = String(settingsFov);
      if (settingsFovValue) settingsFovValue.textContent = String(settingsFov);
    }
    function applySettingsFov(value) {
      settingsFov = clampSettingsFov(value);
      camera.fov = settingsFov;
      camera.updateProjectionMatrix();
      if (typeof flightCamera !== 'undefined' && flightCamera) {
        flightCamera.fov = settingsFov;
        flightCamera.updateProjectionMatrix();
      }
      localStorage.setItem('pocketUniverseFov', String(settingsFov));
      syncSettingsUI();
    }
    function refreshAllSoundVolumes() {
      for (const [key, sound] of Object.entries(audioBank)) {
        if (!sound.paused) {
          const base = Number.isFinite(sound._settingsBaseVolume) ? sound._settingsBaseVolume : sound.volume;
          sound._settingsBaseVolume = base;
          sound._settingsAudioKey = key;
          sound.volume = getAudioVolume(key, base);
        }
      }
      for (const sound of activeAudioClones) {
        const key = sound._settingsAudioKey;
        const base = Number.isFinite(sound._settingsBaseVolume) ? sound._settingsBaseVolume : sound.volume;
        if (key) sound.volume = getAudioVolume(key, base);
      }
       for (const [key, track] of Object.entries(musicBank)) {
        if (key !== musicCurrentKey && key !== 'merchant') {
          if (track.paused) track.volume = 0;
          continue;
        }

        if (musicMerchantTransition) {
          const phase = musicMerchantTransition.phase;
          if (phase === 'outCurrent' && key === musicMerchantTransition.key) {
            const t = THREE.MathUtils.clamp(musicMerchantTransition.elapsed / MUSIC_FADE_OUT_SECONDS, 0, 1);
            const eased = 1 - Math.pow(1 - t, 2);
            track.volume = getMusicTargetVolume(key) * (1 - eased);
          } else if (phase === 'merchantIn' && key === 'merchant') {
            const t = THREE.MathUtils.clamp(musicMerchantTransition.elapsed / MUSIC_FADE_IN_SECONDS, 0, 1);
            const eased = 1 - Math.pow(1 - t, 2);
            track.volume = getMusicTargetVolume('merchant') * eased;
          } else if (phase === 'outMerchant' && key === 'merchant') {
            const t = THREE.MathUtils.clamp(musicMerchantTransition.elapsed / MUSIC_FADE_OUT_SECONDS, 0, 1);
            const eased = 1 - Math.pow(1 - t, 2);
            track.volume = getMusicTargetVolume('merchant') * (1 - eased);
          } else if (phase === 'resumeIn' && key === musicMerchantTransition.key) {
            const t = THREE.MathUtils.clamp(musicMerchantTransition.elapsed / MUSIC_FADE_IN_SECONDS, 0, 1);
            const eased = 1 - Math.pow(1 - t, 2);
            track.volume = getMusicTargetVolume(key) * eased;
          } else if (key !== musicCurrentKey) {
            if (track.paused) track.volume = 0;
          }
          continue;
        }

        if (key !== musicCurrentKey) {
          if (track.paused) track.volume = 0;
          continue;
        }
        if (musicTransition?.phase === 'out') {
          const t = THREE.MathUtils.clamp(musicTransition.elapsed / MUSIC_FADE_OUT_SECONDS, 0, 1);
          const eased = 1 - Math.pow(1 - t, 2);
          track.volume = getMusicTargetVolume(key) * (1 - eased);
        } else if (musicTransition?.phase === 'in') {
          const t = THREE.MathUtils.clamp(musicTransition.elapsed / MUSIC_FADE_IN_SECONDS, 0, 1);
          const eased = 1 - Math.pow(1 - t, 2);
          track.volume = getMusicTargetVolume(key) * eased;
        } else {
          track.volume = getMusicTargetVolume(key);
        }
      }
    }

    function applySettingsVolume(value) {
      settingsMasterVolume = Math.max(0, Math.min(1, Number(value) / 100));
      localStorage.setItem('pocketUniverseVolume', String(settingsMasterVolume));
      refreshAllSoundVolumes();
      syncSettingsUI();
    }

    function applySettingsMusicVolume(value) {
      settingsMusicVolume = Math.max(0, Math.min(1, Number(value) / 100));
      localStorage.setItem('pocketUniverseMusicVolume', String(settingsMusicVolume));
      refreshAllSoundVolumes();
      syncSettingsUI();
    }

    function applySettingsSoundCategory(category, value) {
      const next = Math.max(0, Math.min(1, Number(value) / 100));
      if (category === 'interact') {
        settingsInteractVolume = next;
        localStorage.setItem('pocketUniverseInteractVolume', String(settingsInteractVolume));
      } else if (category === 'player') {
        settingsPlayerVolume = next;
        localStorage.setItem('pocketUniversePlayerVolume', String(settingsPlayerVolume));
      } else if (category === 'nature') {
        settingsNatureVolume = next;
        localStorage.setItem('pocketUniverseNatureVolume', String(settingsNatureVolume));
      } else if (category === 'world') {
        settingsWorldVolume = next;
        localStorage.setItem('pocketUniverseWorldVolume', String(settingsWorldVolume));
      }
      refreshAllSoundVolumes();
      syncSettingsUI();
    }
    function openSettings() {
      settingsModal.classList.remove("hidden");
      showSettingsPage(settingsHome);
      syncSettingsUI();
      if (document.pointerLockElement === canvas) document.exitPointerLock();
    }
    function closeSettings() {
      settingsModal.classList.add("hidden");
      showSettingsPage(settingsHome);
    }
    settingsClose.addEventListener("click", (e) => { e.stopPropagation(); closeSettings(); });
    settingsModal.addEventListener("click", (e) => {
      if (e.target === settingsModal) closeSettings();
    });
    homeSettingsButton.addEventListener("click", (e) => { e.stopPropagation(); openSettings(); });
    controlsToggle.addEventListener("click", (e) => { e.stopPropagation(); openSettings(); });
    settingsControlsButton.addEventListener('click', (e) => { e.stopPropagation(); showSettingsPage(settingsControlsPage); });
    settingsSoundButton.addEventListener('click', (e) => { e.stopPropagation(); showSettingsPage(settingsSoundPage); syncSettingsUI(); });
    settingsFovButton.addEventListener('click', (e) => { e.stopPropagation(); showSettingsPage(settingsFovPage); syncSettingsUI(); });
    settingsUpdateLogButton.addEventListener('click', (e) => { e.stopPropagation(); showSettingsPage(settingsUpdateLogPage); });
    document.querySelectorAll('[data-settings-back]').forEach((button) => button.addEventListener('click', (e) => { e.stopPropagation(); showSettingsPage(settingsHome); }));
    settingsVolumeSlider.addEventListener('input', (e) => applySettingsVolume(Number(e.target.value)));
    settingsInteractSlider.addEventListener('input', (e) => applySettingsSoundCategory('interact', Number(e.target.value)));
    settingsPlayerSlider.addEventListener('input', (e) => applySettingsSoundCategory('player', Number(e.target.value)));
    settingsNatureSlider.addEventListener('input', (e) => applySettingsSoundCategory('nature', Number(e.target.value)));
    settingsWorldSlider.addEventListener('input', (e) => applySettingsSoundCategory('world', Number(e.target.value)));
    settingsMusicSlider.addEventListener('input', (e) => applySettingsMusicVolume(Number(e.target.value)));
    settingsFovSlider.addEventListener('input', (e) => applySettingsFov(Number(e.target.value)));
    syncSettingsUI();

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
    const merchantNpcLine = document.getElementById('merchantNpcLine');
    const creditsDisplay = document.getElementById('creditsDisplay');
    const helnaNpcLine = document.getElementById('helnaNpcLine');

    // Helna's welcome lines appear in the small dialogue bubble every time the hat shop opens.
    const HELNA_MERCHANT_LINES = Object.freeze([
      'Hey! Take a look around.',
      'Anything catch your eye?',
      'I got a few new things in. Let me know what you like.',
      'That one is pretty nice, honestly.',
      'Oh, I like that color too.',
      'You can never really have too many hats, right?',
      'The wizard hats are a little ridiculous... I love them.',
      'Need something for your next trip into space?',
      'Jaecob keeps an eye on the credits. I just make sure you look good.',
      'He says I spend too much time making hats. He might be right.',
      'Take your time. There is no rush.',
      'Good to see you again! Anything new you want to try?'
    ]);
    let lastHelnaLineIndex = -1;

    function chooseHelnaLine() {
      if (!helnaNpcLine || HELNA_MERCHANT_LINES.length === 0) return;
      let index = Math.floor(Math.random() * HELNA_MERCHANT_LINES.length);
      if (HELNA_MERCHANT_LINES.length > 1 && index === lastHelnaLineIndex) {
        index = (index + 1 + Math.floor(Math.random() * (HELNA_MERCHANT_LINES.length - 1))) % HELNA_MERCHANT_LINES.length;
      }
      lastHelnaLineIndex = index;
      helnaNpcLine.textContent = HELNA_MERCHANT_LINES[index];
    }

    // Jaecob's welcome lines appear in the small dialogue bubble every time the shop opens.
    const JAECOB_MERCHANT_LINES = Object.freeze([
      'Hey! What can I do for you?',
      'Got anything you want to sell?',
      'Need supplies?',
      'Back again? Nice to see you.',
      'Those crystals look pretty valuable.',
      'I should have what you need... probably.',
      'Heading back out there? You might want some extra fuel.',
      "If you found something interesting, let's see it.",
      'Have a look. Take your time.',
      'Helna keeps telling me to charge more. I think my prices are fine.',
      'You looking for anything in particular?',
      'Let me know if you need a hand finding something.'
    ]);
    let lastJaecobLineIndex = -1;

    function chooseJaecobLine() {
      if (!merchantNpcLine || JAECOB_MERCHANT_LINES.length === 0) return;
      let index = Math.floor(Math.random() * JAECOB_MERCHANT_LINES.length);
      if (JAECOB_MERCHANT_LINES.length > 1 && index === lastJaecobLineIndex) {
        index = (index + 1 + Math.floor(Math.random() * (JAECOB_MERCHANT_LINES.length - 1))) % JAECOB_MERCHANT_LINES.length;
      }
      lastJaecobLineIndex = index;
      merchantNpcLine.textContent = JAECOB_MERCHANT_LINES[index];
    }

    function updateCreditsUI() {
      const credits = Math.max(0, Math.floor(economyState.credits));
      if (creditsDisplay) creditsDisplay.textContent = '¢ ' + credits;
      if (credits >= 100) awardAchievement('first_100_credits');
      if (credits >= 1000) awardAchievement('credits_1000');
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
        if (item.id === 'journal' || SELL_PRICES[item.id] == null) continue;
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
      { id: 'jerrycan',      name: 'Jerrycan (Full)',price: 250, max: 1 },
      { id: 'rocket_engine_blueprint', name: 'Engine Mark 1 Blueprint', price: 100, max: 1, unique: true },
      { id: 'warp_drive_blueprint', name: 'Warp Drive Mark 1 Blueprint', price: 200, max: 1, unique: true },
      { id: 'rocket_blueprint', name: 'Rocket Blueprint', price: 300, max: 1, unique: true },
      { id: 'upgraded_engine_blueprint', name: 'Engine Mark 2 Blueprint', price: 250, max: 1, unique: true },
      { id: 'engine_mark_3_blueprint', name: 'Engine Mark 3 Blueprint', price: 400, max: 1, unique: true },
      { id: 'warp_drive_mk2_blueprint', name: 'Warp Drive Mark 2 Blueprint', price: 500, max: 1, unique: true }
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
      if (item && item.kind === 'blueprint') {
        icon.textContent = '';
        icon.style.backgroundImage = 'url("models/Blueprint2.png")';
        icon.style.backgroundSize = 'contain';
        icon.style.backgroundRepeat = 'no-repeat';
        icon.style.backgroundPosition = 'center';
        icon.style.imageRendering = 'pixelated';
      }
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
      const alreadyOwned = !!catalogItem.unique && hasItemType(catalogItem.id);
      button.disabled = alreadyOwned || economyState.credits < catalogItem.price * qty;
      button.textContent = alreadyOwned ? 'OWNED' : 'BUY';
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

      if (catalogItem.unique && hasItemType(catalogItem.id)) {
        merchantStatus.textContent = 'You already own this blueprint.';
        updateMerchantBuyButton(row, catalogItem);
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
      if (currentAccountUser) {
        accountStatistics.totalCreditsSpent += total;
        renderAccountStatistics();
        persistAchievementState();
      }
      awardAchievement('buy_merchant');
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
      markJournalPersonMet('jaecob');
      economyState.merchantOpen = true;
      economyState.merchantSection = 'dialogue';
      beginMerchantMusic();
      state.paused = true;
      merchantOverlay.classList.remove('hidden');
      chooseJaecobLine();
      setMerchantView('dialogue');
      updateCreditsUI();
      if (document.pointerLockElement === canvas) document.exitPointerLock();
      for (const k in systemState.keys) systemState.keys[k] = false;
      clearPhysicalKeys();
      return true;
    }

    function closeMerchant() {
      const wasOpen = economyState.merchantOpen || musicMerchantOverride;
      economyState.merchantOpen = false;
      merchantOverlay.classList.add('hidden');
      if (wasOpen) endMerchantMusic();
      economyState.selectedSellTypeId = null;
      economyState.merchantSection = 'dialogue';
      if (state.gameState === 'playing') {
        state.paused = false;
        attemptPointerLock();
      }
    }

    function sellSelectedMerchantItem() {
      const typeId = economyState.selectedSellTypeId;
      // The journal is a permanent/key item and can never be sold, even if stale UI state
      // or a previously selected item tries to submit it.
      if (typeId === 'journal') {
        economyState.selectedSellTypeId = null;
        updateMerchantSellSelection();
        return;
      }
      if (!typeId || !itemById[typeId] || SELL_PRICES[typeId] == null) return;
      const owned = getInventoryCount(typeId);
      const qty = Math.max(1, Math.min(owned, Math.floor(Number(merchantSellQuantity.value) || 1)));
      if (owned < qty || !removeItemsFromInventory(typeId, qty)) { merchantStatus.textContent = 'You do not have enough of that item.'; return; }
      const earned = qty * SELL_PRICES[typeId];
      economyState.credits += earned;
      if (currentAccountUser) {
        accountStatistics.totalCreditsEarned += earned;
        renderAccountStatistics();
        persistAchievementState();
      }
      awardAchievement('sell_merchant');
      if (typeId === 'moon_quartz') awardAchievement('moon_quartz_sale');
      if (economyState.credits >= 100) awardAchievement('first_100_credits');
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
      if (pad.fuel >= getRocketFuelCapacity(pad)) {
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
      const refillAmount = pad.engineType === 'upgraded' ? ROCKET_FUEL_REFILL_AMOUNT_UPGRADED : ROCKET_FUEL_REFILL_AMOUNT_STANDARD;
      pad.fuel = Math.min(getRocketFuelCapacity(pad), (Number(pad.fuel) || 0) + refillAmount);
      if (pad.fuel >= getRocketFuelCapacity(pad)) awardAchievement('fuel_rocket');
      economyState.fuelingPad = null;
      economyState.fuelingStartedAt = 0;
      economyState.drillRefueling = null;
      economyState.drillRefuelingStartedAt = 0;
      refreshEquippedItem();
      updateHotbarUI();
      updateInventoryUI();
      prompt.innerHTML = '<span class="promptKey">FUELED</span> Rocket fuel: ' + Math.round(getRocketFuelPercent(pad)) + '%';
      setTimeout(() => { if (state.gameState === 'playing') updateCrystalPrompt(); }, 900);
    }

    // ---------- spaceship flight ----------
    // Dedicated spaceship controller. The rocket is the vehicle; the player object is only
    // a hidden passenger/proxy used by the rest of the game. Flight input is completely
    // separate from the walking movement state so UI/pointer-lock transitions cannot break it.
    const flightCamera = new THREE.PerspectiveCamera(settingsFov, window.innerWidth / window.innerHeight, 0.1, 1000000);
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
    const ROCKET_SPEED_MODES = {
      1: { label: 'CURRENT', multiplier: 1, fuelInterval: 5 },
      2: { label: 'BOOSTED', multiplier: 2, fuelInterval: 3 },
      3: { label: 'WARP', multiplier: 4, fuelInterval: 1.5 },
      4: { label: 'SUPERSONIC', multiplier: 200 / FLIGHT_SPEED, fuelInterval: 1 }
    };
    let rocketSpeedMode = 1;
    const FLIGHT_CAMERA_SMOOTH = 10;
    const FLIGHT_TERRAIN_CLEARANCE = 1.15;
    const FLIGHT_PROP_COLLISION_RADIUS = 1.15;
    const FLIGHT_TREE_COLLISION_EXTRA = 0.35;

    let flightPad = null;
    let flightRocket = null;
    let flightWasThirdPerson = false;

    // Celestial-frame tracking lets a free-flight rocket inherit the actual WORLD transform
    // (translation + axial rotation) of whichever landable body currently controls its local
    // gravity. Inside that body's gravity region the rocket therefore moves with the rotating
    // / orbiting world beneath it, making atmospheric approach and landing much easier. Once
    // no landable body is within its gravity region, the carry stops and the ship is inertial
    // in deep space.
    let flightFrameBodyId = null;
    let flightFrameReady = false;
    const flightFramePreviousCenter = new THREE.Vector3();
    const flightFramePreviousQuat = new THREE.Quaternion();
    const flightFrameCurrentCenter = new THREE.Vector3();
    const flightFrameCurrentQuat = new THREE.Quaternion();
    const flightFramePreviousInvQuat = new THREE.Quaternion();
    const flightFrameRelativePos = new THREE.Vector3();
    const flightFrameDeltaQuat = new THREE.Quaternion();

    function getFlightFrameDescriptor(position) {
      const candidates = [
        { id: 'aurora', center: auroraWorldPosition, object: auroraMesh, radius: AURORA_GRAVITY_SWITCH_DISTANCE },
        { id: 'mileria', center: mileriaWorldPosition, object: mileriaMesh, radius: MILERIA_GRAVITY_SWITCH_DISTANCE },
        { id: 'syspo', center: syspoWorldPosition, object: syspoSystem, radius: SYSP0_GRAVITY_SWITCH_DISTANCE },
        { id: 'moon', center: moonWorldPosition, object: moonMesh, radius: MOON_GRAVITY_SWITCH_DISTANCE },
        { id: 'cordelia', center: cordeliaWorldPosition, object: cordeliaMesh, radius: CORDELIA_GRAVITY_SWITCH_DISTANCE },
        { id: 'ivis', center: ivisSolarOrbitPosition, object: planetSystem, radius: FREE_SPACE_PLANE_SWITCH_DISTANCE },
      ];
      let best = null;
      let bestDistance = Infinity;
      for (const candidate of candidates) {
        if (!candidate.object || !candidate.center) continue;
        const d = position.distanceTo(candidate.center);
        if (d <= candidate.radius && d < bestDistance) {
          best = candidate;
          bestDistance = d;
        }
      }
      return best;
    }

    function resetFlightFrameTracking() {
      flightFrameBodyId = null;
      flightFrameReady = false;
    }

    function applyCelestialFlightFrameCarry() {
      const descriptor = getFlightFrameDescriptor(flightPosition);
      if (!descriptor) {
        resetFlightFrameTracking();
        return;
      }

      descriptor.object.getWorldPosition(flightFrameCurrentCenter);
      descriptor.object.getWorldQuaternion(flightFrameCurrentQuat);

      // When entering a body's gravity region, initialize the reference frame instead of
      // applying the full transform delta from some unrelated body / deep-space period.
      if (!flightFrameReady || flightFrameBodyId !== descriptor.id) {
        flightFrameBodyId = descriptor.id;
        flightFramePreviousCenter.copy(flightFrameCurrentCenter);
        flightFramePreviousQuat.copy(flightFrameCurrentQuat);
        flightFrameReady = true;
        return;
      }

      flightFrameRelativePos.copy(flightPosition).sub(flightFramePreviousCenter);
      flightFramePreviousInvQuat.copy(flightFramePreviousQuat).invert();
      flightFrameRelativePos.applyQuaternion(flightFramePreviousInvQuat);
      flightFrameRelativePos.applyQuaternion(flightFrameCurrentQuat);
      flightPosition.copy(flightFrameCurrentCenter).add(flightFrameRelativePos);

      flightFrameDeltaQuat.copy(flightFrameCurrentQuat).multiply(flightFramePreviousInvQuat);
      flightForward.applyQuaternion(flightFrameDeltaQuat).normalize();

      flightFramePreviousCenter.copy(flightFrameCurrentCenter);
      flightFramePreviousQuat.copy(flightFrameCurrentQuat);
    }

    // These keys belong only to the spaceship controller. They are deliberately independent
    // of systemState.keys and physicalKeys used by walking/UI.
    const rocketKeys = Object.create(null);
    const rocketKeyDown = (e) => {
      if (!playerState.inRocket) return;

      // Keep speed selection isolated from movement and camera input.
      let digitMode = 0;
      if (e.code === 'Digit1' || e.code === 'Numpad1') digitMode = 1;
      else if (e.code === 'Digit2' || e.code === 'Numpad2') digitMode = 2;
      else if (e.code === 'Digit3' || e.code === 'Numpad3') digitMode = 3;
      else if (e.code === 'Digit4' || e.code === 'Numpad4') digitMode = 4;
      if (digitMode) {
        if (digitMode === 4 && flightPad?.engineType !== 'mark3') return;
        rocketSpeedMode = digitMode;
        e.preventDefault();
        return;
      }

      const reboundFlightCodes = new Set([
        ...getBoundCodes('moveForward'), ...getBoundCodes('moveBackward'), ...getBoundCodes('moveLeft'), ...getBoundCodes('moveRight'),
        ...getBoundCodes('jump'), ...getBoundCodes('sprint')
      ]);
      if (reboundFlightCodes.has(e.code)) {
        rocketKeys[e.code] = true;
        e.preventDefault();
      }
    };
    const rocketKeyUp = (e) => {
      const reboundFlightCodes = new Set([
        ...getBoundCodes('moveForward'), ...getBoundCodes('moveBackward'), ...getBoundCodes('moveLeft'), ...getBoundCodes('moveRight'),
        ...getBoundCodes('jump'), ...getBoundCodes('sprint')
      ]);
      if (reboundFlightCodes.has(e.code)) rocketKeys[e.code] = false;
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

    function getMoonLocalUp(out = new THREE.Vector3()) {
      return out.copy(player.position).normalize();
    }

    function getMoonWorldPositionForPlayer(out = new THREE.Vector3()) {
      return moonMesh.localToWorld(out.copy(player.position));
    }

    function getMoonWorldNormalForPlayer(out = new THREE.Vector3()) {
      out.copy(getMoonLocalUp(new THREE.Vector3()));
      const q = moonMesh.getWorldQuaternion(new THREE.Quaternion());
      return out.applyQuaternion(q).normalize();
    }

    function landRocketOnMoon() {
      if (!flightRocket || !flightPad) return false;
      moonMesh.getWorldPosition(moonWorldPosition);
      const surfaceNormal = flightPosition.clone().sub(moonWorldPosition);
      if (surfaceNormal.lengthSq() < 0.0001) surfaceNormal.set(0, 1, 0);
      surfaceNormal.normalize();

      // The rocket is now physically parked on the Moon, so it must travel with the Moon's
      // rotation and orbit rather than remaining a free world-space object.
      const moonWorldQuat = moonMesh.getWorldQuaternion(new THREE.Quaternion());
      const worldForward = flightForward.clone().addScaledVector(surfaceNormal, -flightForward.dot(surfaceNormal));
      if (worldForward.lengthSq() < 0.00001) {
        worldForward.set(0, 0, 1).addScaledVector(surfaceNormal, -surfaceNormal.z).normalize();
      } else worldForward.normalize();
      const worldRight = new THREE.Vector3().crossVectors(worldForward, surfaceNormal).normalize();
      const worldRear = worldForward.clone().negate();
      const worldBasis = new THREE.Matrix4().makeBasis(worldRight, surfaceNormal, worldRear);
      const worldRocketQuat = new THREE.Quaternion().setFromRotationMatrix(worldBasis);

      moonMesh.attach(flightRocket.root);
      const localNormal = surfaceNormal.clone().applyQuaternion(moonWorldQuat.clone().invert()).normalize();
      flightRocket.root.position.copy(localNormal).multiplyScalar(MOON_RADIUS + 0.9);
      const localRocketQuat = moonWorldQuat.clone().invert().multiply(worldRocketQuat);
      flightRocket.root.quaternion.copy(localRocketQuat);
      flightPosition.copy(flightRocket.root.getWorldPosition(new THREE.Vector3()));

      moonLandedRocket = flightRocket;
      moonLandingPad = flightPad;
      // A single rocket cannot be docked to two bodies. Clear any stale Cordelia reference
      // before treating this rocket as a Moon-docked ship.
      if (cordeliaLandedRocket === flightRocket) {
        cordeliaLandedRocket = null;
        cordeliaLandingPad = null;
      }
      moonLandingArmed = false;
      moonTakeoffActive = false;
      if (rocketFlightElapsedSeconds >= 300) awardAchievement('long_spaceflight_land');
      if (rocketFlightHasMoved) awardAchievement('safe_flight');
      rocketFlightElapsedSeconds = 0;
      rocketFlightDistance = 0;
      rocketFlightHasMoved = false;
      rocketFlightMaxIvisDistance = 0;
      playerState.rocketLanded = true;
      flightCameraYaw.value = 0;
      flightCameraPitch.value = 0.22;
      playerState.rocketInSpace = true;
      clearRocketKeys();
      rocketLaunchPlayed = false;
      moonGravityActive = true;
      awardAchievement('land_moon');
      return true;
    }

    function exitRocketToMoon() {
      if (!flightRocket || !moonLandedRocket || !moonLandingPad) return false;
      const rocketWorldPos = flightRocket.root.getWorldPosition(new THREE.Vector3());
      const rocketWorldQuat = flightRocket.root.getWorldQuaternion(new THREE.Quaternion());
      const moonCenter = moonMesh.getWorldPosition(new THREE.Vector3());
      const surfaceNormalWorld = rocketWorldPos.clone().sub(moonCenter).normalize();
      const playerWorldPos = moonCenter.clone().addScaledVector(surfaceNormalWorld, MOON_RADIUS + EYE_HEIGHT);

      moonMesh.attach(player);
      player.position.copy(moonMesh.worldToLocal(playerWorldPos.clone()));

      // Rebuild the player orientation from the rocket heading while aligning the player's
      // local +Y with the Moon surface normal.
      const playerWorldBasis = new THREE.Matrix4();
      const forwardWorld = new THREE.Vector3(0, 0, 1).applyQuaternion(rocketWorldQuat);
      forwardWorld.addScaledVector(surfaceNormalWorld, -forwardWorld.dot(surfaceNormalWorld));
      if (forwardWorld.lengthSq() < 0.00001) forwardWorld.set(0, 0, 1).addScaledVector(surfaceNormalWorld, -surfaceNormalWorld.z);
      forwardWorld.normalize();
      const rightWorld = new THREE.Vector3().crossVectors(forwardWorld, surfaceNormalWorld).normalize();
      playerWorldBasis.makeBasis(rightWorld, surfaceNormalWorld, forwardWorld.clone().negate());
      const playerWorldQuat = new THREE.Quaternion().setFromRotationMatrix(playerWorldBasis);
      const moonWorldQuat = moonMesh.getWorldQuaternion(new THREE.Quaternion());
      player.quaternion.copy(moonWorldQuat.clone().invert().multiply(playerWorldQuat));
      orientation.copy(player.quaternion);

      playerState.inRocket = false;
      playerState.rocketInSpace = false;
      playerState.rocketLanded = false;
      playerState.heightOffset = 0;
      playerState.verticalVelocity = 0;
      playerState.stamina = STAMINA_MAX;
      playerState.exhausted = false;
      moonWalking = true;
      moonGravityActive = true;
      moonTakeoffActive = false;
      playerBody.visible = true;
      document.body.classList.remove('rocket-flight');
      heldCrystalFirstPerson.visible = !playerState.thirdPerson;
      heldCrystalThirdPerson.visible = playerState.thirdPerson;
      flashlight.visible = false;
      clearRocketKeys();
      updateRocketEngineAudio(false, false);

      // The rocket remains exactly where it landed and is still associated with its Ivis pad
      // for fuel accounting. It can be entered again from the Moon.
      flightPad = moonLandingPad;
      flightRocket = moonLandedRocket;
      if (playerState.thirdPerson !== flightWasThirdPerson) {
        playerState.thirdPerson = flightWasThirdPerson;
      }
      camera.layers.enable(0);
      if (playerState.thirdPerson) camera.layers.enable(1);
      else camera.layers.disable(1);
      camera.position.copy(playerState.thirdPerson ? CAM_THIRD : CAM_FIRST);
      targetCamPos.copy(camera.position);
      state.paused = false;
      moonDustTimer = 0;
      setRocketFlightUI();
      return true;
    }

    function landRocketOnCordelia() {
      if (!flightRocket || !flightPad) return false;
      cordeliaMesh.getWorldPosition(cordeliaWorldPosition);
      const surfaceNormal = flightPosition.clone().sub(cordeliaWorldPosition);
      if (surfaceNormal.lengthSq() < 0.0001) surfaceNormal.set(0, 1, 0);
      surfaceNormal.normalize();
      const cordeliaWorldQuat = cordeliaMesh.getWorldQuaternion(new THREE.Quaternion());
      const worldForward = flightForward.clone().addScaledVector(surfaceNormal, -flightForward.dot(surfaceNormal));
      if (worldForward.lengthSq() < 0.00001) {
        const fallback = Math.abs(surfaceNormal.y) < 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
        worldForward.copy(fallback).addScaledVector(surfaceNormal, -fallback.dot(surfaceNormal));
      }
      worldForward.normalize();
      const worldRight = new THREE.Vector3().crossVectors(worldForward, surfaceNormal).normalize();
      const worldRear = worldForward.clone().negate();
      const worldBasis = new THREE.Matrix4().makeBasis(worldRight, surfaceNormal, worldRear);
      const worldRocketQuat = new THREE.Quaternion().setFromRotationMatrix(worldBasis);

      cordeliaMesh.attach(flightRocket.root);
      const localNormal = surfaceNormal.clone().applyQuaternion(cordeliaWorldQuat.clone().invert()).normalize();
      const localSurfaceRadius = CORDELIA_RADIUS + cordeliaHeightAt(localNormal);
      flightRocket.root.position.copy(localNormal).multiplyScalar(localSurfaceRadius + 0.95);
      const localRocketQuat = cordeliaWorldQuat.clone().invert().multiply(worldRocketQuat);
      flightRocket.root.quaternion.copy(localRocketQuat);
      flightPosition.copy(flightRocket.root.getWorldPosition(new THREE.Vector3()));
      flightRocket.root.visible = true;

      cordeliaLandedRocket = flightRocket;
      cordeliaLandingPad = flightPad;
      // A single rocket cannot be docked to the Moon and Cordelia simultaneously. If this
      // rocket arrived here directly from the Moon, clear the stale lunar reference so the
      // Cordelia dock/takeoff branch is the one that wins.
      if (moonLandedRocket === flightRocket) {
        moonLandedRocket = null;
        moonLandingPad = null;
      }
      cordeliaLandingArmed = false;
      if (rocketFlightElapsedSeconds >= 300) awardAchievement('long_spaceflight_land');
      if (rocketFlightHasMoved) awardAchievement('safe_flight');
      rocketFlightElapsedSeconds = 0;
      rocketFlightDistance = 0;
      rocketFlightHasMoved = false;
      playerState.rocketLanded = true;
      playerState.rocketInSpace = true;
      cordeliaGravityActive = true;
      clearRocketKeys();
      rocketLaunchPlayed = false;
      awardAchievement('land_cordelia');
      return true;
    }

    function exitRocketToCordelia() {
      if (!flightRocket || !cordeliaLandedRocket || !cordeliaLandingPad) return false;
      const rocketWorldPos = flightRocket.root.getWorldPosition(new THREE.Vector3());
      const rocketWorldQuat = flightRocket.root.getWorldQuaternion(new THREE.Quaternion());
      const planetCenter = cordeliaMesh.getWorldPosition(new THREE.Vector3());
      const surfaceNormalWorld = rocketWorldPos.clone().sub(planetCenter).normalize();
      const dirHeight = cordeliaHeightAt(surfaceNormalWorld.clone().applyQuaternion(cordeliaMesh.getWorldQuaternion(new THREE.Quaternion()).invert()).normalize());
      const playerWorldPos = planetCenter.clone().addScaledVector(surfaceNormalWorld, CORDELIA_RADIUS + dirHeight + EYE_HEIGHT);

      cordeliaMesh.attach(player);
      player.position.copy(cordeliaMesh.worldToLocal(playerWorldPos.clone()));
      const forwardWorld = new THREE.Vector3(0, 0, 1).applyQuaternion(rocketWorldQuat);
      forwardWorld.addScaledVector(surfaceNormalWorld, -forwardWorld.dot(surfaceNormalWorld));
      if (forwardWorld.lengthSq() < 0.00001) forwardWorld.set(0, 0, 1).addScaledVector(surfaceNormalWorld, -surfaceNormalWorld.z);
      forwardWorld.normalize();
      const rightWorld = new THREE.Vector3().crossVectors(forwardWorld, surfaceNormalWorld).normalize();
      const basis = new THREE.Matrix4().makeBasis(rightWorld, surfaceNormalWorld, forwardWorld.clone().negate());
      const playerWorldQuat = new THREE.Quaternion().setFromRotationMatrix(basis);
      const cordeliaWorldQuat = cordeliaMesh.getWorldQuaternion(new THREE.Quaternion());
      player.quaternion.copy(cordeliaWorldQuat.clone().invert().multiply(playerWorldQuat));
      orientation.copy(player.quaternion);

      playerState.inRocket = false;
      playerState.rocketInSpace = false;
      playerState.rocketLanded = false;
      // Surface exploration resumes in the normal first-person camera. Rocket flight always
      // forces third-person while piloting, so do not leak that temporary camera mode outside.
      playerState.thirdPerson = false;
      playerState.heightOffset = 0;
      playerState.verticalVelocity = 0;
      playerState.stamina = STAMINA_MAX;
      playerState.exhausted = false;
      cordeliaWalking = true;
      cordeliaGravityActive = true;
      cordeliaTakeoffActive = false;
      playerBody.visible = true;
      document.body.classList.remove('rocket-flight');
      heldCrystalFirstPerson.visible = !playerState.thirdPerson;
      heldCrystalThirdPerson.visible = playerState.thirdPerson;
      flashlight.visible = false;
      clearRocketKeys();
      updateRocketEngineAudio(false, false);
      flightPad = cordeliaLandingPad;
      flightRocket = cordeliaLandedRocket;
      camera.layers.enable(0);
      if (playerState.thirdPerson) camera.layers.enable(1); else camera.layers.disable(1);
      camera.position.copy(playerState.thirdPerson ? CAM_THIRD : CAM_FIRST);
      targetCamPos.copy(camera.position);
      state.paused = false;
      cordeliaDustTimer = 0;
      setRocketFlightUI();
      return true;
    }

    function updateDockedCordeliaRocketCamera(delta) {
      if (!flightRocket) return;
      const rocketWorldPos = flightRocket.root.getWorldPosition(new THREE.Vector3());
      const rocketWorldQuat = flightRocket.root.getWorldQuaternion(new THREE.Quaternion());
      const cordeliaCenter = cordeliaMesh.getWorldPosition(new THREE.Vector3());
      const up = rocketWorldPos.clone().sub(cordeliaCenter).normalize();
      const baseForward = new THREE.Vector3(0, 0, 1).applyQuaternion(rocketWorldQuat);
      baseForward.addScaledVector(up, -baseForward.dot(up));
      if (baseForward.lengthSq() < 0.00001) baseForward.set(0, 0, 1).addScaledVector(up, -up.z);
      baseForward.normalize();
      const yawQuat = new THREE.Quaternion().setFromAxisAngle(up, flightCameraYaw.value);
      const orbitForward = baseForward.clone().applyQuaternion(yawQuat).normalize();
      const orbitRight = new THREE.Vector3().crossVectors(orbitForward, up).normalize();
      const pitchQuat = new THREE.Quaternion().setFromAxisAngle(orbitRight, flightCameraPitch.value);
      const cameraForward = orbitForward.clone().applyQuaternion(pitchQuat).normalize();
      const target = rocketWorldPos.clone().addScaledVector(up, 1.4);
      const desiredPos = target.clone().addScaledVector(cameraForward, -FLIGHT_CAMERA_DISTANCE);
      const blend = Math.min(1, delta * FLIGHT_CAMERA_SMOOTH);
      if (flightCamera.position.distanceTo(desiredPos) > FLIGHT_CAMERA_DISTANCE * 2.5) flightCamera.position.copy(desiredPos);
      else flightCamera.position.lerp(desiredPos, blend);
      flightCamera.up.copy(up);
      flightCamera.lookAt(target);
    }

    function updateCordeliaPlayer(delta) {
      if (!cordeliaWalking || state.gameState !== 'playing' || state.paused) return;
      let moveX = 0, moveZ = 0;
      if (isActionDown('moveForward')) moveZ -= 1;
      if (isActionDown('moveBackward')) moveZ += 1;
      if (isActionDown('moveLeft')) moveX -= 1;
      if (isActionDown('moveRight')) moveX += 1;
      const isMoving = moveX !== 0 || moveZ !== 0;
      const shiftHeld = isActionDown('sprint');
      let speed = MOVE_SPEED;
      if (state.gameMode === 'freeplay') { speed = MOVE_SPEED * SPRINT_MULTIPLIER; if (shiftHeld && isMoving) speed *= 1.35; playerState.stamina = STAMINA_MAX; playerState.exhausted = false; }
      else {
        const wantsSprint = shiftHeld && isMoving && !playerState.exhausted && playerState.stamina > 0;
        if (wantsSprint) { speed = MOVE_SPEED * SPRINT_MULTIPLIER; playerState.stamina -= STAMINA_DRAIN_PER_SEC * delta; if (playerState.stamina <= 0) { playerState.stamina = 0; playerState.exhausted = true; } }
        else { playerState.stamina = Math.min(STAMINA_MAX, playerState.stamina + STAMINA_REGEN_PER_SEC * delta); if (playerState.stamina >= STAMINA_EXHAUST_RECOVER) playerState.exhausted = false; }
      }
      updateStaminaBar();
      const localDir = player.position.clone().normalize();
      if (isMoving) {
        tmpMove.set(moveX, 0, moveZ).normalize();
        const up = localDir.clone();
        const moveSurfaceUpWorld = getActiveWalkingSurfaceWorld(new THREE.Vector3());
        getCameraRelativePlanetMove(tmpMove.x, tmpMove.z, moveSurfaceUpWorld, cordeliaMesh, tmpWorldMove);
        if (tmpWorldMove.lengthSq() < 0.00001) tmpWorldMove.copy(tmpMove).applyQuaternion(orientation);
        tmpWorldMove.addScaledVector(up, -tmpWorldMove.dot(up)).normalize();
        const angularStep = (speed * delta) / CORDELIA_PLAYER_GROUND_RADIUS;
        const newDir = localDir.clone().addScaledVector(tmpWorldMove, angularStep).normalize();
        const newSurfaceRadius = CORDELIA_RADIUS + cordeliaHeightAt(newDir) + EYE_HEIGHT + playerState.heightOffset;
        player.position.copy(newDir).multiplyScalar(newSurfaceRadius);
      }
      const grounded = playerState.heightOffset <= 0;
      if (grounded && isActionDown('jump') && playerState.verticalVelocity <= 0) playerState.verticalVelocity = CORDELIA_JUMP_SPEED;
      playerState.verticalVelocity -= GRAVITY * delta;
      playerState.heightOffset += playerState.verticalVelocity * delta;
      if (playerState.heightOffset < 0) { playerState.heightOffset = 0; playerState.verticalVelocity = 0; }
      const groundDir = player.position.clone().normalize();
      const groundH = cordeliaHeightAt(groundDir);
      player.position.copy(groundDir).multiplyScalar(CORDELIA_RADIUS + groundH + EYE_HEIGHT + playerState.heightOffset);
      const oldUp = new THREE.Vector3(0, 1, 0).applyQuaternion(orientation);
      const align = new THREE.Quaternion().setFromUnitVectors(oldUp, groundDir);
      orientation.premultiply(align);
      if (playerState.thirdPerson && isMoving) {
        const travelDir = tmpWorldMove.clone().normalize();
        const travelRight = new THREE.Vector3().crossVectors(travelDir, groundDir).normalize();
        orientation.setFromRotationMatrix(new THREE.Matrix4().makeBasis(travelRight, groundDir, travelDir.clone().negate()));
      }
      player.quaternion.copy(orientation);
      if (playerState.thirdPerson) {
        const up = groundDir;
        const baseForward = thirdPersonCameraForward.clone().addScaledVector(up, -thirdPersonCameraForward.dot(up));
        if (baseForward.lengthSq() < 0.00001) baseForward.set(0, 0, -1);
        baseForward.normalize();
        const camRight = new THREE.Vector3().crossVectors(baseForward, up).normalize();
        const pitchQuat = new THREE.Quaternion().setFromAxisAngle(camRight, playerState.thirdPersonOrbitPitch);
        const camForward = baseForward.clone().applyQuaternion(pitchQuat).normalize();
        const target = player.position.clone().addScaledVector(up, 1.05);
        const desiredLocal = target.clone().addScaledVector(camForward, -5.2);
        const desiredWorld = cordeliaMesh.localToWorld(desiredLocal.clone());
        player.worldToLocal(thirdPersonCameraLocalDesired.copy(desiredWorld));
        camera.position.lerp(thirdPersonCameraLocalDesired, Math.min(1, delta * 10));
        camera.updateMatrixWorld(true);
        const targetWorld = cordeliaMesh.localToWorld(target.clone());
        const thirdPersonCameraWorldPos = camera.getWorldPosition(new THREE.Vector3());
        const cordeliaCenterWorld = cordeliaMesh.getWorldPosition(new THREE.Vector3());
        camera.up.copy(thirdPersonCameraWorldPos.sub(cordeliaCenterWorld).normalize());
        camera.lookAt(targetWorld);
      } else { camera.rotation.set(playerState.pitch, 0, 0); camera.position.lerp(targetCamPos, Math.min(1, delta * 10)); }
      if (isMoving && shiftHeld && grounded) {
        cordeliaDustTimer -= delta;
        if (cordeliaDustTimer <= 0) {
          const footWorld = cordeliaMesh.localToWorld(groundDir.clone().multiplyScalar(CORDELIA_RADIUS + groundH + 0.05));
          spawnWorldParticles(footWorld, 0xcaa06a, { count: 4, life: 0.48, speed: 0.32, size: 0.055, gravity: 0.22, spread: 1.4, upward: 0.5 });
          cordeliaDustTimer = 0.12;
        }
      } else cordeliaDustTimer = 0;
    }

    function formatRocketTime(seconds) {
      const whole = Math.max(0, Math.ceil(Number(seconds) || 0));
      const mins = Math.floor(whole / 60);
      const secs = whole % 60;
      return mins + ':' + String(secs).padStart(2, '0');
    }

    function getRocketTankFillPercent(pad) {
      if (!pad) return 0;
      const cap = getRocketFuelCapacity(pad);
      if (cap <= 0) return 0;
      return Math.max(0, Math.min(100, ((Number(pad.fuel) || 0) / cap) * 100));
    }

    function getRocketHudBodyInfo(position) {
      const bodies = [
        { id: 'ivis', name: 'IVIS', center: ivisSolarOrbitPosition.clone(), radius: PLANET_RADIUS },
        { id: 'moon', name: 'MOON', center: moonMesh.getWorldPosition(new THREE.Vector3()), radius: MOON_RADIUS },
        { id: 'cordelia', name: 'CORDELIA', center: cordeliaMesh.getWorldPosition(new THREE.Vector3()), radius: CORDELIA_RADIUS },
        { id: 'syspo', name: 'SYSPO', center: syspoMesh.getWorldPosition(new THREE.Vector3()), radius: SYSP0_RADIUS },
        { id: 'aurora', name: 'AURORA', center: auroraMesh.getWorldPosition(new THREE.Vector3()), radius: AURORA_RADIUS },
        { id: 'mileria', name: 'MILERIA', center: mileriaMesh.getWorldPosition(new THREE.Vector3()), radius: MILERIA_RADIUS },
        { id: 'sun', name: 'SUN', center: sunMesh.position.clone(), radius: SUN_RADIUS }
      ];
      let nearest = bodies[0];
      let nearestDistance = position.distanceTo(nearest.center);
      for (let i = 1; i < bodies.length; i++) {
        const d = position.distanceTo(bodies[i].center);
        if (d < nearestDistance) { nearest = bodies[i]; nearestDistance = d; }
      }
      return { nearest, nearestDistance };
    }

    function updateRocketHudSpatialReadout() {
      if (!playerState.inRocket) return;
      const bodyInfo = getRocketHudBodyInfo(flightPosition);
      let altitudeBody = null;
      if (!playerState.rocketInSpace) {
        altitudeBody = { name: 'IVIS', radius: PLANET_RADIUS, center: ivisSolarOrbitPosition };
      } else if (moonGravityActive) {
        altitudeBody = { name: 'MOON', radius: MOON_RADIUS, center: moonMesh.getWorldPosition(new THREE.Vector3()) };
      } else if (cordeliaGravityActive) {
        altitudeBody = { name: 'CORDELIA', radius: CORDELIA_RADIUS, center: cordeliaMesh.getWorldPosition(new THREE.Vector3()) };
      } else if (auroraGravityActive) {
        altitudeBody = { name: 'AURORA', radius: AURORA_RADIUS, center: auroraMesh.getWorldPosition(new THREE.Vector3()) };
      } else if (mileriaGravityActive) {
        altitudeBody = { name: 'MILERIA', radius: MILERIA_RADIUS, center: mileriaMesh.getWorldPosition(new THREE.Vector3()) };
      } else if (syspoGravityActive) {
        altitudeBody = { name: 'SYSPO CORE', radius: SYSP0_RADIUS, center: syspoMesh.getWorldPosition(new THREE.Vector3()) };
      }

      if (altitudeBody) {
        const altitude = Math.max(0, flightPosition.distanceTo(altitudeBody.center) - altitudeBody.radius);
        rocketFlightAltitude.textContent = Math.round(altitude) + 'u';
      } else {
        rocketFlightAltitude.textContent = '—';
      }
      rocketFlightRange.textContent = bodyInfo.nearest.name + ' · ' + Math.round(bodyInfo.nearestDistance).toLocaleString() + 'u';
    }

    function setRocketFlightUI() {
      const active = !!playerState.inRocket;
      // This panel is a cockpit HUD, not a nearby-rocket interaction prompt. It should only
      // exist while the player is actually seated in the rocket. Nearby rocket information is
      // still available through the normal interaction prompt when approaching the pad.
      rocketFlightStatus.classList.toggle('hidden', !active);
      if (!active) {
        rocketFlightFlightStats.classList.remove('hidden');
        rocketFlightNearbyStats.classList.add('hidden');
        rocketFlightUpgradeStats.classList.add('hidden');
        return;
      }

      rocketFlightFlightStats.classList.remove('hidden');
      rocketFlightNearbyStats.classList.add('hidden');
      rocketFlightUpgradeStats.classList.remove('hidden');
      const upgradeSource = flightPad;
      const upgradeList = [];
      if (upgradeSource?.engineType === 'mark3') upgradeList.push('ENGINE MARK 3');
      else if (upgradeSource?.engineType === 'upgraded') upgradeList.push('ENGINE MARK 2');
      if (upgradeSource?.warpDrive || upgradeSource?.rocket?.warpDrive) upgradeList.push((upgradeSource?.warpDriveType === 'mk2' || upgradeSource?.rocket?.warpDriveType === 'mk2') ? 'WARP DRIVE MARK 2' : 'WARP DRIVE');
      rocketFlightUpgrades.textContent = upgradeList.length ? upgradeList.join(' · ') : 'NONE';

      if (active) {
        const rawFuel = flightPad ? Math.max(0, Number(flightPad.fuel) || 0) : 0;
        const speedMode = ROCKET_SPEED_MODES[rocketSpeedMode] || ROCKET_SPEED_MODES[1];
        const speedValue = FLIGHT_SPEED * speedMode.multiplier;
        const timeLeft = rawFuel * speedMode.fuelInterval;
        const fuelTime = speedMode.fuelInterval === 1.5 ? '1.5' : String(speedMode.fuelInterval);

        rocketFlightFuel.textContent = Math.round(rawFuel) + '%';
        rocketFlightTime.textContent = formatRocketTime(timeLeft);
        rocketFlightSpeed.textContent = speedValue + 'u/s';
        rocketFlightConsumption.textContent = '1% / ' + fuelTime + 's';
        const flightContext = playerState.rocketInSpace ? (moonGravityActive ? 'SPACE · MOON GRAVITY' : (cordeliaGravityActive ? 'SPACE · CORDELIA GRAVITY' : (freeSpacePlaneActive ? 'SPACE · DEEP SPACE' : 'SPACE · FREE FLIGHT'))) : 'ATMOSPHERE';
        rocketFlightContext.textContent = flightContext + ' · SPEED ' + (flightPad?.engineType === 'mark3' ? '[1/2/3/4]' : '[1/2/3]');
        updateRocketHudSpatialReadout();
      }

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
      const localToIvis = out.copy(position).sub(ivisSolarOrbitPosition);
      if (localToIvis.lengthSq() < 0.0001) return out.set(0, 1, 0);
      return localToIvis.normalize();
    }

    // Build a local ship frame from the planet's curvature. +Y is always away from the
    // planet center, meaning the ship's bottom (-Y) always faces the planet. Forward is
    // continuously re-projected onto the tangent plane so it does not point into the ground
    // as the ship moves around the sphere. The ship never turns to face its velocity.
    function getFlightBasis() {
      // In normal local flight the ship follows Ivis' curvature. Around 1000 units from
      // Ivis, the ship deliberately stops using any celestial center and instead keeps a
      // randomly chosen world-space "down" vector, producing flat/planar space travel.
      // The Moon still overrides this when the ship enters its local influence radius.
      updateSpacePlaneState(flightPosition);
      const gravityCenter = getActiveGravityCenter(flightPosition, flightGravityCenter);
      const up = gravityCenter.lengthSq() > 0.0001
        ? flightUp.copy(flightPosition).sub(gravityCenter).normalize()
        : (freeSpacePlaneActive ? flightUp.copy(freeSpaceDown) : getPlanetUpAt(flightPosition, flightUp));

      const forwardDotUp = flightForward.dot(up);
      flightForward.addScaledVector(up, -forwardDotUp);
      if (flightForward.lengthSq() < 0.00001) {
        const reference = Math.abs(up.y) < 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
        flightForward.copy(reference).addScaledVector(up, -reference.dot(up));
      }
      flightForward.normalize();

      flightRight.crossVectors(flightForward, up).normalize();
      return { up, forward: flightForward, right: flightRight, gravityCenter };
    }

    function updateFlightRocketVisual() {
      if (!flightRocket) return;

      // A landed lunar rocket is parented to the Moon. Its local transform must remain
      // untouched so it moves with the Moon instead of receiving a world-space position
      // as though it were still parented to the scene.
      const ivisLandedRocket = !!(playerState.rocketLanded && flightPad && flightRocket === flightPad.rocket && flightRocket.root.parent === flightPad.root);
      if ((ivisLandedRocket || moonLandedRocket === flightRocket || cordeliaLandedRocket === flightRocket || omegaLandedRocket === flightRocket) && playerState.rocketLanded) {
        flightRocket.root.visible = true;
        flightRocket.root.getWorldPosition(flightPosition);
        flightRocket.root.getWorldQuaternion(flightRocketQuat);
        return;
      }

      const basis = getFlightBasis();

      // Keep the ship visually upright to the spherical planet while preserving its heading.
      // Local +Y = planetary up, local +Z = rearward, so the engine remains at the back.
      const rear = basis.forward.clone().negate();
      flightShipBasis.makeBasis(basis.right, basis.up, rear);
      flightRocket.root.quaternion.setFromRotationMatrix(flightShipBasis);
      flightRocket.root.position.copy(flightPosition);
      flightRocket.root.visible = true;
    }

    function updateDockedIvisRocketCamera(delta) {
      if (!flightRocket) return;
      const rocketWorldPos = flightRocket.root.getWorldPosition(new THREE.Vector3());
      const rocketWorldQuat = flightRocket.root.getWorldQuaternion(new THREE.Quaternion());
      const center = ivisSolarOrbitPosition;
      const up = rocketWorldPos.clone().sub(center);
      if (up.lengthSq() < 0.00001) up.set(0, 1, 0);
      up.normalize();

      const baseForward = new THREE.Vector3(0, 0, 1).applyQuaternion(rocketWorldQuat);
      baseForward.addScaledVector(up, -baseForward.dot(up));
      if (baseForward.lengthSq() < 0.00001) {
        const fallback = Math.abs(up.y) < 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
        baseForward.copy(fallback).addScaledVector(up, -fallback.dot(up));
      }
      baseForward.normalize();

      const yawQuat = new THREE.Quaternion().setFromAxisAngle(up, flightCameraYaw.value);
      const orbitForward = baseForward.clone().applyQuaternion(yawQuat).normalize();
      const orbitRight = new THREE.Vector3().crossVectors(orbitForward, up).normalize();
      const pitchQuat = new THREE.Quaternion().setFromAxisAngle(orbitRight, flightCameraPitch.value);
      const cameraForward = orbitForward.clone().applyQuaternion(pitchQuat).normalize();

      const target = rocketWorldPos.clone().addScaledVector(up, 1.4);
      const desiredPos = target.clone().addScaledVector(cameraForward, -FLIGHT_CAMERA_DISTANCE);
      const blend = Math.min(1, delta * FLIGHT_CAMERA_SMOOTH);

      if (flightCamera.position.distanceTo(desiredPos) > FLIGHT_CAMERA_DISTANCE * 2.5) {
        flightCamera.position.copy(desiredPos);
      } else {
        flightCamera.position.lerp(desiredPos, blend);
      }

      flightCamera.up.copy(up);
      flightCamera.lookAt(target);
    }

    function updateDockedMoonRocketCamera(delta) {
      if (!flightRocket) return;

      const rocketWorldPos = flightRocket.root.getWorldPosition(new THREE.Vector3());
      const rocketWorldQuat = flightRocket.root.getWorldQuaternion(new THREE.Quaternion());
      const moonCenter = moonMesh.getWorldPosition(new THREE.Vector3());
      const up = rocketWorldPos.clone().sub(moonCenter);
      if (up.lengthSq() < 0.00001) up.set(0, 1, 0);
      up.normalize();

      const baseForward = new THREE.Vector3(0, 0, 1).applyQuaternion(rocketWorldQuat);
      baseForward.addScaledVector(up, -baseForward.dot(up));
      if (baseForward.lengthSq() < 0.00001) {
        const fallback = Math.abs(up.y) < 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
        baseForward.copy(fallback).addScaledVector(up, -fallback.dot(up));
      }
      baseForward.normalize();

      const yawQuat = new THREE.Quaternion().setFromAxisAngle(up, flightCameraYaw.value);
      const orbitForward = baseForward.clone().applyQuaternion(yawQuat).normalize();
      const orbitRight = new THREE.Vector3().crossVectors(orbitForward, up).normalize();
      const pitchQuat = new THREE.Quaternion().setFromAxisAngle(orbitRight, flightCameraPitch.value);
      const cameraForward = orbitForward.clone().applyQuaternion(pitchQuat).normalize();

      const target = rocketWorldPos.clone().addScaledVector(up, 1.4);
      const desiredPos = target.clone().addScaledVector(cameraForward, -FLIGHT_CAMERA_DISTANCE);
      const blend = Math.min(1, delta * FLIGHT_CAMERA_SMOOTH);

      // When the Moon moves by a large amount between frames, snap the camera to the
      // new frame instead of letting it trail hundreds of units behind the parked ship.
      if (flightCamera.position.distanceTo(desiredPos) > FLIGHT_CAMERA_DISTANCE * 2.5) {
        flightCamera.position.copy(desiredPos);
      } else {
        flightCamera.position.lerp(desiredPos, blend);
      }

      flightCamera.up.copy(up);
      flightCamera.lookAt(target);
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
      if (rocketFlightElapsedSeconds >= 300) awardAchievement('long_spaceflight_land');
      if (rocketFlightHasMoved) awardAchievement('safe_flight');
      if (getRocketFuelPercent(flightPad) < 10) awardAchievement('low_fuel_return');
      if (rocketFlightOriginBody === 'ivis' && rocketFlightMaxIvisDistance >= 10000) awardAchievement('mir_station');
      rocketFlightElapsedSeconds = 0;
      rocketFlightDistance = 0;
      rocketFlightHasMoved = false;
      playerState.rocketLanded = true;
      playerState.rocketInSpace = flightPosition.distanceTo(ivisSolarOrbitPosition) >= ROCKET_ATMOSPHERE_RADIUS;

      // This is an Ivis launch-pad landing, not a lunar landing. Clear the lunar-docked
      // reference so exiting the rocket returns the player to Ivis instead of incorrectly
      // sending them back to the Moon after a Moon -> Ivis round trip.
      if (flightRocket === moonLandedRocket) {
        awardAchievement('return_moon');
        moonLandedRocket = null;
        moonLandingPad = null;
        moonWalking = false;
      }
      if (flightRocket === cordeliaLandedRocket) {
        awardAchievement('return_cordelia');
        cordeliaLandedRocket = null;
        cordeliaLandingPad = null;
        cordeliaWalking = false;
      }
      // Landing on an Ivis launch pad always returns the flight frame to Ivis. This also
      // clears any stale Moon/Cordelia gravity state left over from a previous excursion.
      moonGravityActive = false;
      cordeliaGravityActive = false;
      freeSpacePlaneActive = false;
      freeSpaceDown.set(0, 1, 0);

      if (flightRocket) {
        // Ivis' launch pad is part of the moving/rotating planetSystem. Keep a landed rocket
        // parented directly to that pad so it follows Ivis perfectly instead of drifting away
        // as the planet rotates or orbits the Sun. scene.attach() is used later when the rocket
        // actually takes off, preserving the correct world transform at the moment of release.
        const desiredWorldPos = flightPosition.clone();
        const desiredWorldQuat = pad._flightWorldQuat.clone();
        if (flightRocket.root.parent !== pad.root) {
          pad.root.attach(flightRocket.root);
        }
        flightRocket.root.position.copy(pad.root.worldToLocal(desiredWorldPos));
        const padWorldQuat = pad.root.getWorldQuaternion(new THREE.Quaternion());
        flightRocket.root.quaternion.copy(padWorldQuat.invert().multiply(desiredWorldQuat));
        flightRocket.root.visible = true;
      }
      return true;
    }

    function undockCordeliaRocketForFlight() {
      if (!flightRocket || !cordeliaLandedRocket || flightRocket !== cordeliaLandedRocket || !playerState.rocketLanded) return false;

      const cordeliaCenter = cordeliaMesh.getWorldPosition(new THREE.Vector3());
      const cordeliaWorldQuat = cordeliaMesh.getWorldQuaternion(new THREE.Quaternion());
      const worldPos = flightRocket.root.getWorldPosition(new THREE.Vector3());
      const worldQuat = flightRocket.root.getWorldQuaternion(new THREE.Quaternion());

      // Detach first, preserving the exact world transform. From this point onward the rocket
      // is a real free-flight object and is no longer a child of the moving planet.
      scene.attach(flightRocket.root);
      flightRocket.root.position.copy(worldPos);
      flightRocket.root.quaternion.copy(worldQuat);
      flightRocket.root.visible = true;

      // Work entirely in Cordelia's moving local frame to find the surface normal at the
      // current landing location. The old implementation only nudged the rocket a few units,
      // which could still intersect the planet collision shell on the next frame.
      const localNormal = worldPos.clone().sub(cordeliaCenter);
      if (localNormal.lengthSq() < 0.0001) localNormal.set(0, 1, 0);
      localNormal.applyQuaternion(cordeliaWorldQuat.clone().invert()).normalize();
      const surfaceRadius = CORDELIA_RADIUS + cordeliaHeightAt(localNormal);
      const worldNormal = localNormal.clone().applyQuaternion(cordeliaWorldQuat).normalize();

      // Start well outside both the visible terrain and the flight collision shell. This is
      // deliberately much farther out than the normal landed position.
      const launchWorldPos = cordeliaCenter.clone().addScaledVector(
        worldNormal,
        Math.max(surfaceRadius + CORDELIA_COLLISION_CLEARANCE + CORDELIA_TAKEOFF_CLEARANCE, surfaceRadius + 40)
      );
      flightRocket.root.position.copy(launchWorldPos);
      flightRocket.root.quaternion.copy(worldQuat);
      flightPosition.copy(launchWorldPos);
      flightRocketQuat.copy(worldQuat);
      flightAchievementFrameStart.copy(flightPosition);

      recordRocketTakeoff('cordelia');
      playerState.rocketLanded = false;
      playerState.rocketInSpace = true;
      resetFlightFrameTracking();
      cordeliaGravityActive = true;
      cordeliaTakeoffActive = true;
      cordeliaLandingArmed = false;
      lastRocketSpaceState = true;

      // Keep the first frame of input from being lost. The normal update loop will continue
      // moving the ship immediately, while the dedicated boost guarantees outward clearance.
      rocketLaunchPlayed = false;
      return true;
    }

    function isNearLandedSurfaceRocket() {
      const activeRocket = moonWalking ? moonLandedRocket : (cordeliaWalking ? cordeliaLandedRocket : (omegaWalkingBodyId ? omegaLandedRocket : null));
      if (!activeRocket || !activeRocket.root || !activeRocket.root.visible) return false;
      const playerWorld = player.getWorldPosition(new THREE.Vector3());
      const rocketWorld = activeRocket.root.getWorldPosition(new THREE.Vector3());
      return playerWorld.distanceTo(rocketWorld) <= 4.2;
    }

    function getActiveOmegaRocketBodyId() {
      return omegaLandedBodyId || (omegaWalkingBodyId ? omegaWalkingBodyId : null);
    }

    function landRocketOnOmega(bodyId) {
      const body = getOmegaMesh(bodyId);
      if (!body || !flightRocket || !flightPad) return false;
      const omegaTempCenter = body.getWorldPosition(new THREE.Vector3());
      const surfaceNormal = flightPosition.clone().sub(omegaTempCenter);
      if (surfaceNormal.lengthSq() < 0.0001) surfaceNormal.set(0, 1, 0);
      surfaceNormal.normalize();
      const bodyWorldQuat = body.getWorldQuaternion(new THREE.Quaternion());
      const localNormal = surfaceNormal.clone().applyQuaternion(bodyWorldQuat.clone().invert()).normalize();
      const localSurfaceRadius = getOmegaSurfaceRadius(bodyId, localNormal);

      const worldForward = flightForward.clone().addScaledVector(surfaceNormal, -flightForward.dot(surfaceNormal));
      if (worldForward.lengthSq() < 0.00001) {
        const fallback = Math.abs(surfaceNormal.y) < 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
        worldForward.copy(fallback).addScaledVector(surfaceNormal, -fallback.dot(surfaceNormal));
      }
      worldForward.normalize();
      const worldRight = new THREE.Vector3().crossVectors(worldForward, surfaceNormal).normalize();
      const worldRear = worldForward.clone().negate();
      const worldBasis = new THREE.Matrix4().makeBasis(worldRight, surfaceNormal, worldRear);
      const worldRocketQuat = new THREE.Quaternion().setFromRotationMatrix(worldBasis);

      body.attach(flightRocket.root);
      flightRocket.root.position.copy(localNormal).multiplyScalar(localSurfaceRadius + 0.95);
      flightRocket.root.quaternion.copy(bodyWorldQuat.clone().invert().multiply(worldRocketQuat));
      flightRocket.root.visible = true;
      flightPosition.copy(flightRocket.root.getWorldPosition(new THREE.Vector3()));

      omegaLandedRocket = flightRocket;
      omegaLandedBodyId = bodyId;
      omegaLandingPad = flightPad;
      if (moonLandedRocket === flightRocket) { moonLandedRocket = null; moonLandingPad = null; moonLandingArmed = true; }
      if (cordeliaLandedRocket === flightRocket) { cordeliaLandedRocket = null; cordeliaLandingPad = null; cordeliaLandingArmed = true; }
      omegaTakeoffActive = false;
      omegaTakeoffBodyId = null;
      omegaLandingArmed = false;
      playerState.rocketLanded = true;
      playerState.rocketInSpace = true;
      moonGravityActive = false;
      cordeliaGravityActive = false;
      auroraGravityActive = bodyId === 'aurora';
      mileriaGravityActive = bodyId === 'mileria';
      syspoGravityActive = false;
      clearRocketKeys();
      rocketLaunchPlayed = false;
      recordCelestialBodyVisit(bodyId);
      return true;
    }

    function exitRocketToOmega(bodyId) {
      const body = getOmegaMesh(bodyId);
      const activeRocket = omegaLandedRocket;
      const pad = omegaLandingPad;
      if (!body || !activeRocket || !pad || activeRocket !== flightRocket || omegaLandedBodyId !== bodyId) return false;
      const rocketWorldPos = activeRocket.root.getWorldPosition(new THREE.Vector3());
      const rocketWorldQuat = activeRocket.root.getWorldQuaternion(new THREE.Quaternion());
      const bodyCenter = body.getWorldPosition(new THREE.Vector3());
      const bodyWorldQuat = body.getWorldQuaternion(new THREE.Quaternion());
      const surfaceNormalWorld = rocketWorldPos.clone().sub(bodyCenter).normalize();
      const localDir = surfaceNormalWorld.clone().applyQuaternion(bodyWorldQuat.clone().invert()).normalize();
      const playerWorldPos = bodyCenter.clone().addScaledVector(surfaceNormalWorld, getOmegaSurfaceRadius(bodyId, localDir) + EYE_HEIGHT);

      body.attach(player);
      player.position.copy(body.worldToLocal(playerWorldPos.clone()));
      const forwardWorld = new THREE.Vector3(0,0,1).applyQuaternion(rocketWorldQuat);
      forwardWorld.addScaledVector(surfaceNormalWorld, -forwardWorld.dot(surfaceNormalWorld));
      if (forwardWorld.lengthSq() < 0.00001) forwardWorld.set(0,0,1).addScaledVector(surfaceNormalWorld, -surfaceNormalWorld.z);
      forwardWorld.normalize();
      const rightWorld = new THREE.Vector3().crossVectors(forwardWorld, surfaceNormalWorld).normalize();
      const basis = new THREE.Matrix4().makeBasis(rightWorld, surfaceNormalWorld, forwardWorld.clone().negate());
      const playerWorldQuat = new THREE.Quaternion().setFromRotationMatrix(basis);
      player.quaternion.copy(bodyWorldQuat.clone().invert().multiply(playerWorldQuat));
      orientation.copy(player.quaternion);

      playerState.inRocket = false;
      playerState.rocketInSpace = false;
      playerState.rocketLanded = false;
      playerState.thirdPerson = false;
      playerState.heightOffset = 0;
      playerState.verticalVelocity = 0;
      playerState.stamina = STAMINA_MAX;
      playerState.exhausted = false;
      omegaWalkingBodyId = bodyId;
      moonGravityActive = false;
      cordeliaGravityActive = false;
      auroraGravityActive = bodyId === 'aurora';
      mileriaGravityActive = bodyId === 'mileria';
      syspoGravityActive = false;
      playerBody.visible = true;
      document.body.classList.remove('rocket-flight');
      heldCrystalFirstPerson.visible = true;
      heldCrystalThirdPerson.visible = false;
      flashlight.visible = false;
      clearRocketKeys();
      updateRocketEngineAudio(false, false);
      flightPad = pad;
      flightRocket = activeRocket;
      camera.layers.enable(0); camera.layers.disable(1);
      camera.position.copy(CAM_FIRST); targetCamPos.copy(CAM_FIRST);
      state.paused = false;
      omegaDustTimer = 0;
      setRocketFlightUI();
      return true;
    }

    function undockOmegaRocketForFlight() {
      if (!flightRocket || !omegaLandedRocket || flightRocket !== omegaLandedRocket || !playerState.rocketLanded || !omegaLandedBodyId) return false;
      const body = getOmegaMesh(omegaLandedBodyId);
      if (!body) return false;
      const worldPos = flightRocket.root.getWorldPosition(new THREE.Vector3());
      const worldQuat = flightRocket.root.getWorldQuaternion(new THREE.Quaternion());
      scene.attach(flightRocket.root);
      flightRocket.root.position.copy(worldPos);
      flightRocket.root.quaternion.copy(worldQuat);
      flightRocket.root.visible = true;
      flightPosition.copy(worldPos);
      flightRocketQuat.copy(worldQuat);
      flightAchievementFrameStart.copy(flightPosition);
      recordRocketTakeoff(omegaLandedBodyId);
      omegaTakeoffBodyId = omegaLandedBodyId;
      omegaTakeoffActive = true;
      omegaLandingArmed = false;
      playerState.rocketLanded = false;
      playerState.rocketInSpace = true;
      resetFlightFrameTracking();
      moonGravityActive = false;
      cordeliaGravityActive = false;
      auroraGravityActive = omegaLandedBodyId === 'aurora';
      mileriaGravityActive = omegaLandedBodyId === 'mileria';
      syspoGravityActive = false;
      lastRocketSpaceState = true;
      return true;
    }

    function updateDockedOmegaRocketCamera(delta) {
      if (!flightRocket || !omegaLandedBodyId) return;
      const body = getOmegaMesh(omegaLandedBodyId);
      if (!body) return;
      const rocketWorldPos = flightRocket.root.getWorldPosition(new THREE.Vector3());
      const rocketWorldQuat = flightRocket.root.getWorldQuaternion(new THREE.Quaternion());
      const center = body.getWorldPosition(new THREE.Vector3());
      const up = rocketWorldPos.clone().sub(center).normalize();
      const baseForward = new THREE.Vector3(0,0,1).applyQuaternion(rocketWorldQuat).addScaledVector(up, -new THREE.Vector3(0,0,1).applyQuaternion(rocketWorldQuat).dot(up));
      if (baseForward.lengthSq() < 0.00001) baseForward.set(0,0,1).addScaledVector(up, -up.z);
      baseForward.normalize();
      const yawQuat = new THREE.Quaternion().setFromAxisAngle(up, flightCameraYaw.value);
      const orbitForward = baseForward.clone().applyQuaternion(yawQuat).normalize();
      const orbitRight = new THREE.Vector3().crossVectors(orbitForward, up).normalize();
      const pitchQuat = new THREE.Quaternion().setFromAxisAngle(orbitRight, flightCameraPitch.value);
      const cameraForward = orbitForward.clone().applyQuaternion(pitchQuat).normalize();
      const target = rocketWorldPos.clone().addScaledVector(up, 1.4);
      const desiredPos = target.clone().addScaledVector(cameraForward, -FLIGHT_CAMERA_DISTANCE);
      const blend = Math.min(1, delta * FLIGHT_CAMERA_SMOOTH);
      if (flightCamera.position.distanceTo(desiredPos) > FLIGHT_CAMERA_DISTANCE * 2.5) flightCamera.position.copy(desiredPos);
      else flightCamera.position.lerp(desiredPos, blend);
      flightCamera.up.copy(up); flightCamera.lookAt(target);
    }

    function enterRocket() {
      if (playerState.inRocket || state.gameState !== 'playing' || state.paused) return false;
      if (uiState.equippedItemType) return false;

      let pad = findRocketEntryPad();
      const reenteringMoonRocket = !!(moonWalking && moonLandedRocket && isNearLandedSurfaceRocket());
      const reenteringCordeliaRocket = !!(cordeliaWalking && cordeliaLandedRocket && isNearLandedSurfaceRocket());
      const reenteringOmegaRocket = !!(omegaWalkingBodyId && omegaLandedRocket && isNearLandedSurfaceRocket());
      if (!pad || !pad.rocket) {
        if (reenteringMoonRocket) pad = moonLandingPad;
        else if (reenteringCordeliaRocket) pad = cordeliaLandingPad;
        else if (reenteringOmegaRocket) pad = omegaLandingPad;
      }
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
      resetFlightFrameTracking();
      flightPosition.copy(rocketWorldPos);
      flightRocketQuat.copy(rocketWorldQuat);
      flightAchievementFrameStart.copy(flightPosition);

      // A landed lunar rocket stays parented to the Moon while you are sitting inside it.
      // That keeps the ship physically docked to the moving Moon until you actually press a
      // flight control to take off. Ivis rockets are detached immediately as before.
      if (!reenteringMoonRocket && !reenteringCordeliaRocket && !reenteringOmegaRocket) {
        scene.attach(flightRocket.root);
        flightRocket.root.position.copy(flightPosition);
        flightRocket.root.quaternion.copy(flightRocketQuat);
      } else {
        flightRocket.root.visible = true;
      }

      // Preserve the rocket's current surface heading. On Ivis this uses Ivis' center; on
      // the Moon it uses the Moon center, so re-entry does not suddenly twist the ship.
      let initialUp;
      if (reenteringMoonRocket) {
        const moonCenter = moonMesh.getWorldPosition(new THREE.Vector3());
        initialUp = flightPosition.clone().sub(moonCenter).normalize();
      } else if (reenteringCordeliaRocket) {
        const cordeliaCenter = cordeliaMesh.getWorldPosition(new THREE.Vector3());
        initialUp = flightPosition.clone().sub(cordeliaCenter).normalize();
      } else if (reenteringOmegaRocket) {
        const omegaBody = getOmegaMesh(omegaLandedBodyId);
        const omegaCenter = omegaBody ? omegaBody.getWorldPosition(new THREE.Vector3()) : new THREE.Vector3();
        initialUp = flightPosition.clone().sub(omegaCenter).normalize();
      } else {
        initialUp = getPlanetUpAt(flightPosition, new THREE.Vector3());
      }
      flightForward.set(0, 0, 1).applyQuaternion(flightRocketQuat);
      flightForward.addScaledVector(initialUp, -flightForward.dot(initialUp));
      if (flightForward.lengthSq() < 0.00001) {
        const fallback = Math.abs(initialUp.y) < 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
        flightForward.copy(fallback).addScaledVector(initialUp, -fallback.dot(initialUp));
      }
      flightForward.normalize();
      flightRight.crossVectors(flightForward, initialUp).normalize();
      clearRocketKeys();
      rocketLaunchPlayed = false;
      lastRocketSpaceState = flightPosition.distanceTo(ivisSolarOrbitPosition) >= ROCKET_ATMOSPHERE_RADIUS;

      scene.attach(player);
      player.position.copy(flightPosition);
      player.quaternion.copy(flightRocketQuat);
      playerState.inRocket = true;
      playerState.rocketInSpace = (reenteringMoonRocket || reenteringCordeliaRocket || reenteringOmegaRocket) ? true : (flightPosition.distanceTo(ivisSolarOrbitPosition) >= ROCKET_ATMOSPHERE_RADIUS);
      playerState.rocketLanded = reenteringMoonRocket || reenteringCordeliaRocket || reenteringOmegaRocket;
      moonWalking = false;
      cordeliaWalking = false;
      omegaWalkingBodyId = null;
      // Reset stale celestial gravity/landing state whenever entering a normal Ivis rocket.
      // After visiting the Moon or Cordelia, their gravity flags can remain active until the
      // next flight update. An Ivis launch must always start from Ivis' own reference frame.
      if (!reenteringMoonRocket && !reenteringCordeliaRocket && !reenteringOmegaRocket) {
        moonGravityActive = false;
        cordeliaGravityActive = false;
        auroraGravityActive = false;
        mileriaGravityActive = false;
        syspoGravityActive = false;
        freeSpacePlaneActive = false;
        freeSpaceDown.set(0, 1, 0);
      }
      // A rocket can only be docked to one celestial body at a time. Explicitly clear
      // stale lunar gravity when entering the Cordelia rocket (and vice versa), otherwise
      // the old Moon state can win the gravity-priority check and show "MOON GRAVITY"
      // while sitting on Cordelia.
      if (reenteringMoonRocket) {
        moonGravityActive = true;
        cordeliaGravityActive = false;
        auroraGravityActive = false; mileriaGravityActive = false; syspoGravityActive = false;
      } else if (reenteringCordeliaRocket) {
        moonGravityActive = false;
        cordeliaGravityActive = true;
        auroraGravityActive = false; mileriaGravityActive = false; syspoGravityActive = false;
      } else if (reenteringOmegaRocket) {
        moonGravityActive = false;
        cordeliaGravityActive = false;
        auroraGravityActive = omegaLandedBodyId === 'aurora';
        mileriaGravityActive = omegaLandedBodyId === 'mileria';
        syspoGravityActive = false;
      }
      playerState.rocketFuelTimer = 0;
      playerState.verticalVelocity = 0;
      rocketSpeedMode = 1;

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
      for (const code of getBoundCodes('interact')) { systemState.keys[code] = false; physicalKeys[code] = false; }
      document.body.classList.add('rocket-flight');

      if (reenteringMoonRocket) {
        updateDockedMoonRocketCamera(1 / 60);
      } else if (reenteringCordeliaRocket) {
        updateDockedCordeliaRocketCamera(1 / 60);
      } else if (reenteringOmegaRocket) {
        updateDockedOmegaRocketCamera(1 / 60);
      } else {
        flightCamera.position.copy(flightPosition).addScaledVector(initialUp, 8);
        flightCamera.up.copy(initialUp);
        flightCamera.lookAt(flightPosition);
        updateFlightCamera(1 / 60);
      }
      updateFlightRocketVisual();
      if (reenteringMoonRocket) updateDockedMoonRocketCamera(1 / 60);
      if (reenteringCordeliaRocket) updateDockedCordeliaRocketCamera(1 / 60);
      if (reenteringOmegaRocket) updateDockedOmegaRocketCamera(1 / 60);
      setRocketFlightUI();
      showFlightPrompt('Rocket ready · Move / Up / Down controls are rebindable in Settings · 1 Current · 2 Boosted · 3 Warp');
      return true;
    }

    function exitRocketFlight(force = false) {
      if (!playerState.inRocket) return false;
      if (!force && !playerState.rocketLanded) {
        showFlightPrompt('Land before exiting the spaceship.');
        return true;
      }
      // Only use the special Moon exit when the rocket is physically parented to the Moon.
      // A rocket can later land on Ivis again, and in that state it must use the normal Ivis
      // launch-pad exit instead of teleporting the player back onto the Moon.
      const rocketIsPhysicallyDockedToMoon = !!(
        moonLandedRocket &&
        flightRocket === moonLandedRocket &&
        flightRocket.root.parent === moonMesh &&
        playerState.rocketLanded
      );
      if (!force && rocketIsPhysicallyDockedToMoon) {
        return exitRocketToMoon();
      }
      const rocketIsPhysicallyDockedToCordelia = !!(
        cordeliaLandedRocket &&
        flightRocket === cordeliaLandedRocket &&
        flightRocket.root.parent === cordeliaMesh &&
        playerState.rocketLanded
      );
      if (!force && rocketIsPhysicallyDockedToCordelia) {
        return exitRocketToCordelia();
      }
      const rocketIsPhysicallyDockedToOmega = !!(
        omegaLandedRocket && flightRocket === omegaLandedRocket && omegaLandedBodyId &&
        flightRocket.root.parent === getOmegaMesh(omegaLandedBodyId) && playerState.rocketLanded
      );
      if (!force && rocketIsPhysicallyDockedToOmega) {
        return exitRocketToOmega(omegaLandedBodyId);
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
      if (moonLandedRocket && !moonWalking) {
        moonLandedRocket = null;
        moonLandingPad = null;
        moonLandingArmed = true;
      }
      if (cordeliaLandedRocket && !cordeliaWalking) {
        cordeliaLandedRocket = null;
        cordeliaLandingPad = null;
        cordeliaLandingArmed = true;
      }
      if (omegaLandedRocket && !omegaWalkingBodyId) {
        omegaLandedRocket = null;
        omegaLandedBodyId = null;
        omegaLandingPad = null;
        omegaLandingArmed = true;
      }
      playerState.inRocket = false;
      playerState.rocketInSpace = false;
      playerState.rocketLanded = false;
      playerState.rocketFuelTimer = 0;
      freeSpacePlaneActive = false;
      freeSpaceDown.set(0, 1, 0);
      rocketLaunchPlayed = false;
      lastRocketSpaceState = false;
      playerState.thirdPerson = flightWasThirdPerson;
      clearRocketKeys();
      updateRocketEngineAudio(false, false);

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

      // Omega bodies live in world space beneath the moving Syspo hierarchy. Test the moons
      // before Ivis-local terrain collision so the ship can approach their moving surfaces.
      for (const bodyId of ['aurora', 'mileria']) {
        const body = getOmegaMesh(bodyId);
        if (!body) continue;
        const center = body.getWorldPosition(new THREE.Vector3());
        const bodyLocal = worldPosition.clone().sub(center).applyQuaternion(body.getWorldQuaternion(new THREE.Quaternion()).invert());
        const bodyDir = bodyLocal.clone().normalize();
        const surface = getOmegaSurfaceRadius(bodyId, bodyDir);
        const takeoffBody = omegaTakeoffActive && omegaTakeoffBodyId === bodyId;
        if (!takeoffBody && bodyLocal.length() < surface + FLIGHT_TERRAIN_CLEARANCE + 1.2) return true;
      }

      // Syspo's core is a hazard, not a normal landing collider.
      // The detached rocket can travel tens of thousands of units from Ivis. Running the
      // entire Ivis terrain/tree collision stack for every space-flight substep at those
      // distances creates thousands of temporary Vector3 allocations per frame and can
      // stall rendering while the audio thread continues. Only run Ivis-local collisions
      // when the ship is actually near Ivis' atmosphere.
      const nearIvisCollisionZone = radius <= ROCKET_ATMOSPHERE_RADIUS + 200;
      if (nearIvisCollisionZone) {
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

        // Meteor crash-site collision. Keep the same ellipsoid used by player collision,
        // but add the ship's hull clearance so the full meteor remains solid in flight.
        if (meteorCrashSite?.meteor) {
          const meteorCenter = collisionMeteorCenter.copy(meteorCrashSite.root.position);
          meteorCenter.add(collisionMeteorLocalPos.copy(meteorCrashSite.meteor.position).applyQuaternion(meteorCrashSite.root.quaternion));
          collisionMeteorOffset.copy(local).sub(meteorCenter);
          collisionMeteorInverse.copy(meteorCrashSite.root.quaternion).invert();
          collisionMeteorLocal.copy(collisionMeteorOffset).applyQuaternion(collisionMeteorInverse);
          const sx = 14.7, sy = 9.3, sz = 11.9;
          const q = (collisionMeteorLocal.x / sx) ** 2 + (collisionMeteorLocal.y / sy) ** 2 + (collisionMeteorLocal.z / sz) ** 2;
          if (q < 1.0) return true;
        }

        // Both permanent Ivis stalls are solid to the spaceship as well.
        for (const stall of [crystalStall, hatStall]) {
          if (!stall) continue;
          collisionStallOffset.copy(local).sub(stall.position);
          collisionStallInverse.copy(stall.quaternion).invert();
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
      }

      // Syspo has NO flight collision. Its core is handled exclusively by updateSyspoDanger()
      // so the warning/recovery sequence can be reached by flying directly toward the core.

      // Moon collision: the Moon is a solid space object. Always read its WORLD position
      // so the collision follows the moving/orbiting Moon exactly. During the brief Moon
      // takeoff phase the collision is intentionally ignored so the parked rocket can clear
      // the landing shell before normal flight collision resumes.
      moonMesh.getWorldPosition(moonWorldPosition);
      if (!moonTakeoffActive) {
        const moonCollisionDistance = worldPosition.distanceTo(moonWorldPosition);
        if (moonCollisionDistance < MOON_COLLISION_RADIUS + 120) {
          if (moonCollisionDistance < MOON_COLLISION_RADIUS) return true;
        }
      }

      // Cordelia collision: during the dedicated takeoff phase the rocket is already placed
      // safely outside the surface, so ignore this one collider until the ship reaches the
      // release distance. That prevents the launch frame from being cancelled by a tangent
      // chord entering the collision shell.
      cordeliaMesh.getWorldPosition(cordeliaCollisionCenter);
      cordeliaCollisionLocal.copy(worldPosition).sub(cordeliaCollisionCenter);
      const cordeliaDistance = cordeliaCollisionLocal.length();
      if (cordeliaDistance <= CORDELIA_RADIUS + 220) {
        cordeliaCollisionInverse.copy(cordeliaMesh.getWorldQuaternion(cordeliaCollisionQuat)).invert();
        cordeliaCollisionLocal.applyQuaternion(cordeliaCollisionInverse);
        const cordeliaDir = cordeliaCollisionLocal.clone().normalize();
        const cordeliaSurfaceRadius = CORDELIA_RADIUS + cordeliaHeightAt(cordeliaDir) + CORDELIA_COLLISION_CLEARANCE;
        if (!cordeliaTakeoffActive && cordeliaCollisionLocal.length() < cordeliaSurfaceRadius) return true;
        for (const rock of cordeliaRockSpawns) {
          if (rock.mined || !rock.root.visible) continue;
          const rockLocal = cordeliaCollisionLocal.clone().sub(rock.root.position);
          const rockRadius = 1.7 * Math.max(0.7, rock.root.scale.x) + FLIGHT_PROP_COLLISION_RADIUS;
          if (rockLocal.length() < rockRadius) return true;
        }
      }

      // Both permanent stalls are solid to the spaceship as well.
      for (const stall of [crystalStall, hatStall]) {
        if (!stall) continue;
        collisionStallOffset.copy(local).sub(stall.position);
        collisionStallInverse.copy(stall.quaternion).invert();
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

    function undockMoonRocketForFlight() {
      if (!flightRocket || !moonLandedRocket || flightRocket !== moonLandedRocket || !playerState.rocketLanded) return false;

      const worldPos = flightRocket.root.getWorldPosition(new THREE.Vector3());
      const worldQuat = flightRocket.root.getWorldQuaternion(new THREE.Quaternion());
      scene.attach(flightRocket.root);
      flightRocket.root.position.copy(worldPos);
      flightRocket.root.quaternion.copy(worldQuat);
      flightRocket.root.visible = true;

      flightPosition.copy(worldPos);
      flightRocketQuat.copy(worldQuat);
      flightAchievementFrameStart.copy(flightPosition);
      recordRocketTakeoff('moon');
      playerState.rocketLanded = false;
      moonLandingArmed = false;
      playerState.rocketInSpace = true;
      resetFlightFrameTracking();
      moonGravityActive = true;
      moonTakeoffActive = true;
      lastRocketSpaceState = true;
      return true;
    }

    function updateRocketEngineAudio(hasFuel, anyFlightInput) {
      if (!playerState.inRocket || !hasFuel) {
        if (rocketEngineMode !== 'off') {
          setLoopAudioMode('rocketIdle', false);
          setLoopAudioMode('rocketThrust', false);
          rocketEngineMode = 'off';
        }
        return;
      }
      const thrusting = anyFlightInput;
      const nextMode = thrusting ? 'thrust' : 'idle';
      if (nextMode !== rocketEngineMode) {
        setLoopAudioMode('rocketIdle', nextMode === 'idle', 0.11, 0.92);
        setLoopAudioMode('rocketThrust', nextMode === 'thrust', 0.16, 0.96);
        rocketEngineMode = nextMode;
      }
    }

    function undockIvisRocketForFlight() {
      if (!flightRocket || !playerState.rocketLanded) return false;
      const worldPos = flightRocket.root.getWorldPosition(new THREE.Vector3());
      const worldQuat = flightRocket.root.getWorldQuaternion(new THREE.Quaternion());
      scene.attach(flightRocket.root);
      flightRocket.root.position.copy(worldPos);
      flightRocket.root.quaternion.copy(worldQuat);
      flightRocket.root.visible = true;
      flightPosition.copy(worldPos);
      flightRocketQuat.copy(worldQuat);
      flightAchievementFrameStart.copy(flightPosition);
      recordRocketTakeoff('ivis');
      playerState.rocketLanded = false;
      playerState.rocketInSpace = flightPosition.distanceTo(ivisSolarOrbitPosition) >= ROCKET_ATMOSPHERE_RADIUS;
      moonGravityActive = false;
      cordeliaGravityActive = false;
      freeSpacePlaneActive = false;
      freeSpaceDown.set(0, 1, 0);
      resetFlightFrameTracking();
      lastRocketSpaceState = playerState.rocketInSpace;
      return true;
    }

    function updateRocketFlight(delta) {
      if (!playerState.inRocket || !flightPad || !flightRocket) return;
      state.paused = false;

      // A Moon-landed rocket stays docked to the Moon while the pilot is stationary.
      // The first held flight control undocks it into world space and allows normal flight.
      const physicallyDockedToMoon = !!(moonLandedRocket && flightRocket === moonLandedRocket && flightRocket.root.parent === moonMesh);
      const physicallyDockedToCordelia = !!(cordeliaLandedRocket && flightRocket === cordeliaLandedRocket && flightRocket.root.parent === cordeliaMesh);
      const omegaDockedBody = omegaLandedBodyId ? getOmegaMesh(omegaLandedBodyId) : null;
      const physicallyDockedToOmega = !!(omegaLandedRocket && flightRocket === omegaLandedRocket && omegaDockedBody && flightRocket.root.parent === omegaDockedBody);

      if (physicallyDockedToMoon && playerState.rocketLanded) {
        const shouldTakeOff = ['moveForward','moveBackward','moveLeft','moveRight','jump','sprint'].some(action => rocketKeyHeld(...getBoundCodes(action)));

        if (shouldTakeOff && (Number(flightPad.fuel) || 0) > 0) {
          undockMoonRocketForFlight();
        } else {
          flightRocket.root.visible = true;
          flightRocket.root.getWorldPosition(flightPosition);
          const parkedQuat = flightRocket.root.getWorldQuaternion(new THREE.Quaternion());
          flightRocketQuat.copy(parkedQuat);
          moonGravityActive = true;
          player.position.copy(flightPosition);
          player.quaternion.copy(parkedQuat);
          updateRocketEngineAudio(false, false);
          updateDockedMoonRocketCamera(delta);
          setRocketFlightUI();
          return;
        }
      }

      if (physicallyDockedToCordelia && playerState.rocketLanded) {
        const shouldTakeOff = ['moveForward','moveBackward','moveLeft','moveRight','jump','sprint'].some(action => rocketKeyHeld(...getBoundCodes(action)));
        if (shouldTakeOff && (Number(flightPad.fuel) || 0) > 0) {
          undockCordeliaRocketForFlight();
        } else {
          flightRocket.root.visible = true;
          flightRocket.root.getWorldPosition(flightPosition);
          flightRocket.root.getWorldQuaternion(flightRocketQuat);
          cordeliaGravityActive = true;
          player.position.copy(flightPosition);
          player.quaternion.copy(flightRocketQuat);
          updateRocketEngineAudio(false, false);
          updateDockedCordeliaRocketCamera(delta);
          setRocketFlightUI();
          return;
        }
      }

      if (physicallyDockedToOmega && playerState.rocketLanded) {
        const shouldTakeOff = ['moveForward','moveBackward','moveLeft','moveRight','jump','sprint'].some(action => rocketKeyHeld(...getBoundCodes(action)));
        if (shouldTakeOff && (Number(flightPad.fuel) || 0) > 0) {
          undockOmegaRocketForFlight();
        } else {
          flightRocket.root.visible = true;
          flightRocket.root.getWorldPosition(flightPosition);
          flightRocket.root.getWorldQuaternion(flightRocketQuat);
          moonGravityActive = false;
          cordeliaGravityActive = false;
          auroraGravityActive = omegaLandedBodyId === 'aurora';
          mileriaGravityActive = omegaLandedBodyId === 'mileria';
          syspoGravityActive = false;
          player.position.copy(flightPosition);
          player.quaternion.copy(flightRocketQuat);
          updateRocketEngineAudio(false, false);
          updateDockedOmegaRocketCamera(delta);
          setRocketFlightUI();
          return;
        }
      }

      // Defensive safeguard: a landed rocket must never enter free-flight movement just because
      // its parent/reference state changed for a frame. Surface-docked rockets are handled above;
      // a normal Ivis-pad rocket can still undock on the first real flight input.
      if (playerState.rocketLanded) {
        const shouldTakeOff = ['moveForward','moveBackward','moveLeft','moveRight','jump','sprint'].some(action => rocketKeyHeld(...getBoundCodes(action)));
        if (shouldTakeOff && (Number(flightPad.fuel) || 0) > 0 && !moonLandedRocket && !cordeliaLandedRocket && !omegaLandedRocket) {
          undockIvisRocketForFlight();
        } else {
          flightRocket.root.visible = true;
          flightRocket.root.getWorldPosition(flightPosition);
          flightRocket.root.getWorldQuaternion(flightRocketQuat);
          player.position.copy(flightPosition);
          player.quaternion.copy(flightRocketQuat);
          updateRocketEngineAudio(false, false);
          updateDockedIvisRocketCamera(delta);
          setRocketFlightUI();
          return;
        }
      }

      // Fuel drain follows the selected speed mode: 5s / 3s / 1.5s per 1%.
      if (rocketSpeedMode === 4 && flightPad?.engineType !== 'mark3') rocketSpeedMode = 3;
      const selectedSpeedMode = ROCKET_SPEED_MODES[rocketSpeedMode];
      playerState.rocketFuelTimer += delta;
      while (playerState.rocketFuelTimer >= selectedSpeedMode.fuelInterval && (Number(flightPad.fuel) || 0) > 0) {
        flightPad.fuel = Math.max(0, (Number(flightPad.fuel) || 0) - 1);
        playerState.rocketFuelTimer -= selectedSpeedMode.fuelInterval;
      }
      if ((Number(flightPad.fuel) || 0) <= 0) playerState.rocketFuelTimer = 0;

      const radiusFromCenter = flightPosition.distanceTo(ivisSolarOrbitPosition);
      playerState.rocketInSpace = radiusFromCenter >= ROCKET_ATMOSPHERE_RADIUS;
      updateSpacePlaneState(flightPosition);
      updateTravelTransitions();

      // Carry the detached ship with the CURRENT landable celestial body while it remains
      // inside that body's gravity region. This is the same local-frame behavior that made
      // Ivis landings easier, now extended to the Moon, Cordelia, Aurora, and Mileria.
      // Once no landable body is inside its gravity region, the ship is in deep space and
      // the frame carry stops automatically.
      applyCelestialFlightFrameCarry();

      // The 600-unit boundary marks the transition into space. Beyond roughly 1000 units
      // from Ivis, there is no planet/star center at all: the ship gets a fixed random down
      // direction and flies on a flat plane until it returns inside the 950-unit hysteresis band.
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

      if (rocketKeyHeld(...getBoundCodes('moveForward'))) forwardInput += 1;
      if (rocketKeyHeld(...getBoundCodes('moveBackward'))) forwardInput -= 1;
      if (rocketKeyHeld(...getBoundCodes('moveLeft'))) rightInput -= 1;
      if (rocketKeyHeld(...getBoundCodes('moveRight'))) rightInput += 1;
      if (rocketKeyHeld(...getBoundCodes('jump'))) verticalInput += 1;
      if (rocketKeyHeld(...getBoundCodes('sprint'))) verticalInput -= 1;

      // Dedicated Moon takeoff: always provide an outward escape vector for the first
      // moments after undocking. Moon collision is ignored during this phase so the rocket can
      // escape the parked landing shell before normal flight collision checks resume.
      if (hasFuel && moonTakeoffActive) {
        const mCenter = moonMesh.getWorldPosition(new THREE.Vector3());
        const outward = flightPosition.clone().sub(mCenter);
        if (outward.lengthSq() < 0.0001) outward.set(0, 1, 0);
        outward.normalize();
        const takeoffDistance = MOON_TAKEOFF_BOOST * selectedSpeedMode.multiplier * delta;
        flightPosition.addScaledVector(outward, takeoffDistance);
        const mDistance = flightPosition.distanceTo(mCenter);
        if (mDistance >= MOON_TAKEOFF_RELEASE_DISTANCE) {
          moonTakeoffActive = false;
          moonLandingArmed = true;
        }
      // Dedicated Cordelia takeoff: always provide an outward escape vector for the first
      // moments after undocking. This completely separates launch from the ordinary movement
      // solver, so no surface snap can eat the launch.
      } else if (hasFuel && cordeliaTakeoffActive) {
        const cCenter = cordeliaMesh.getWorldPosition(new THREE.Vector3());
        const outward = flightPosition.clone().sub(cCenter);
        if (outward.lengthSq() < 0.0001) outward.set(0, 1, 0);
        outward.normalize();
        const takeoffDistance = CORDELIA_TAKEOFF_BOOST * selectedSpeedMode.multiplier * delta;
        flightPosition.addScaledVector(outward, takeoffDistance);
        const cDistance = flightPosition.distanceTo(cCenter);
        if (cDistance >= CORDELIA_TAKEOFF_RELEASE_DISTANCE) {
          cordeliaTakeoffActive = false;
          cordeliaLandingArmed = true;
        }
      } else if (hasFuel && omegaTakeoffActive) {
        const body = getOmegaMesh(omegaTakeoffBodyId);
        const center = body ? body.getWorldPosition(new THREE.Vector3()) : new THREE.Vector3();
        const outward = flightPosition.clone().sub(center);
        if (outward.lengthSq() < 0.0001) outward.set(0, 1, 0);
        outward.normalize();
        const release = (omegaTakeoffBodyId === 'aurora' ? 760 : 540);
        const boost = (omegaTakeoffBodyId === 'aurora' ? 55 : 48);
        flightPosition.addScaledVector(outward, boost * selectedSpeedMode.multiplier * delta);
        if (flightPosition.distanceTo(center) >= release) {
          omegaTakeoffActive = false;
          omegaLandingArmed = true;
        }
      } else if (hasFuel) {
        // In atmosphere, keep the ship's altitude and move around the planet's curve when
        // pressing W/A/S/D. This avoids the old tangent-vector + surface-clamp snap-back.
        if (!playerState.rocketInSpace) {
          // Flight coordinates are world-space while Ivis is now orbiting the Sun. Convert
          // into Ivis-local coordinates for all spherical-surface math, then convert movement
          // candidates back into world space for collision testing.
          const currentLocal = planetSystem.worldToLocal(flightPosition.clone());
          const currentDir = currentLocal.lengthSq() > 0.0001 ? currentLocal.normalize() : new THREE.Vector3(0, 1, 0);
          const currentGroundRadius = PLANET_RADIUS + heightAt(currentDir);
          // Preserve the ship's altitude above the local ground while moving around the sphere.
          // This is the important valley fix: entering a lower region lowers the ship with the
          // valley, while entering higher terrain raises it smoothly instead of ejecting it.
          const currentAltitude = Math.max(
            FLIGHT_TERRAIN_CLEARANCE,
            flightPosition.distanceTo(ivisSolarOrbitPosition) - currentGroundRadius
          );

          const horizontal = new THREE.Vector3();
          horizontal.addScaledVector(cameraMoveForward, forwardInput);
          horizontal.addScaledVector(cameraMoveRight, rightInput);
          if (horizontal.lengthSq() > 1) horizontal.normalize();

          // Camera-relative movement is world-space, so keep the tangent direction in world
          // coordinates and derive its angular step from the Ivis-local radius.
          const localHorizontal = horizontal.clone();
          localHorizontal.applyQuaternion(planetSystem.quaternion.clone().invert());
          const horizontalDistance = FLIGHT_SPEED * selectedSpeedMode.multiplier * delta;
          if (localHorizontal.lengthSq() > 0.000001) {
            const newDir = currentDir.clone();
            newDir.addScaledVector(localHorizontal, horizontalDistance / Math.max(currentLocal.length(), PLANET_RADIUS + 1));
            newDir.normalize();

            const desiredRadius = PLANET_RADIUS + heightAt(newDir) + currentAltitude;
            const horizontalCandidateLocal = newDir.multiplyScalar(desiredRadius);
            const horizontalCandidate = planetSystem.localToWorld(horizontalCandidateLocal.clone());
            if (!isFlightPositionBlocked(horizontalCandidate)) {
              flightPosition.copy(horizontalCandidate);
            } else {
              // If a diagonal move is blocked, try each camera-relative axis separately so the
              // pilot can slide around trees/stalls without losing altitude in a valley.
              const tryMoveAxis = (axisDir) => {
                if (axisDir.lengthSq() < 0.000001) return false;
                const axisDirNorm = axisDir.clone().applyQuaternion(planetSystem.quaternion.clone().invert()).normalize();
                const axisCandidateDir = currentDir.clone();
                axisCandidateDir.addScaledVector(axisDirNorm, horizontalDistance / Math.max(currentLocal.length(), PLANET_RADIUS + 1));
                axisCandidateDir.normalize();
                const axisRadius = PLANET_RADIUS + heightAt(axisCandidateDir) + currentAltitude;
                const axisCandidate = planetSystem.localToWorld(axisCandidateDir.clone().multiplyScalar(axisRadius));
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
            const verticalDistance = verticalInput * FLIGHT_VERTICAL_SPEED * selectedSpeedMode.multiplier * delta;
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
            const spaceDistance = FLIGHT_SPEED * selectedSpeedMode.multiplier * delta;
            const spaceMove = flightMove.clone().multiplyScalar(spaceDistance);

            // In deep space, most frames are nowhere near any body. Running the full
            // collision stack (including every Ivis tree/resource) for each of the tiny
            // anti-tunnelling substeps was the main source of the apparent 'frozen screen'
            // on Omega flights: the audio kept playing while the main thread spent too long
            // allocating vectors for collision checks. Only use substep collision when the
            // rocket is close enough to a body for a collision to be possible.
            const nearIvis = flightPosition.distanceTo(ivisSolarOrbitPosition) <= ROCKET_ATMOSPHERE_RADIUS + 200;
            const nearMoon = flightPosition.distanceTo(moonWorldPosition) <= MOON_COLLISION_RADIUS + 120;
            const nearCordelia = flightPosition.distanceTo(cordeliaWorldPosition) <= CORDELIA_RADIUS + 220;
            const nearAurora = flightPosition.distanceTo(auroraWorldPosition) <= AURORA_RADIUS + 110;
            const nearMileria = flightPosition.distanceTo(mileriaWorldPosition) <= MILERIA_RADIUS + 110;
            const nearAnyCollisionBody = nearIvis || nearMoon || nearCordelia || nearAurora || nearMileria;

            if (!nearAnyCollisionBody) {
              flightPosition.add(spaceMove);
            } else {
              const moveLength = spaceMove.length();
              const subSteps = Math.max(1, Math.ceil(moveLength / 1.4));
              const stepMove = spaceMove.clone().multiplyScalar(1 / subSteps);
              for (let step = 0; step < subSteps; step++) {
                const candidate = flightPosition.clone().add(stepMove);
                if (!isFlightPositionBlocked(candidate)) {
                  flightPosition.copy(candidate);
                } else {
                  // A blocked space step means the hull touched the Moon/another space prop.
                  // Cancel only that step so the ship can slide along the surface rather than
                  // tunnelling through it at high flight speed.
                  break;
                }
              }
            }
          }
        }
      }

      // Account-wide flight distance is measured from actual rocket displacement, not elapsed
      // time or intended input, so blocked movement and stationary flight do not inflate it.
      if (currentAccountUser && !playerState.rocketLanded) {
        const movedThisFrame = flightAchievementFrameStart.distanceTo(flightPosition);
        accountStatistics.totalUnitsTraveled += Math.max(0, movedThisFrame);
        if (state.gameMode === 'survival') {
          recordFlightAchievementProgress(movedThisFrame, delta, flightPosition.distanceTo(ivisSolarOrbitPosition));
        }
      }
      flightAchievementFrameStart.copy(flightPosition);

      // Landing is deliberate: entering the small landing zone does NOT immediately snap the
      // ship back to the pad while the pilot is still moving. Release all flight controls while
      // parked over the pad and the ship settles onto the exact launch position.
      playerState.rocketLanded = false;
      const anyFlightInput = forwardInput !== 0 || rightInput !== 0 || verticalInput !== 0;

      // A launch sound fires once when the player actually starts moving the fueled rocket.
      if (hasFuel && anyFlightInput && !rocketLaunchPlayed) {
        playAudio('rocketLaunch', 0.72, 1.0);
        if (launchBurstCooldown <= 0) { spawnLaunchBurst(); launchBurstCooldown = 0.7; }
        rocketLaunchPlayed = true;
      }

      // Play the cinematic boom whenever the ship crosses the atmosphere/space boundary
      // in either direction. The 600-unit line is the gameplay state change.
      if (playerState.rocketInSpace !== lastRocketSpaceState) {
        if (playerState.rocketInSpace) awardAchievement('launch_first_space');
        playAudio('spaceAtmosphereBoom', 0.62, 1.0);
        lastRocketSpaceState = playerState.rocketInSpace;
      }

      updateRocketEngineAudio(hasFuel, anyFlightInput);

      // Re-arm Moon landing only after the ship has moved well away from the surface.
      // This prevents an immediate re-snap after takeoff while allowing unlimited future landings.
      moonMesh.getWorldPosition(moonWorldPosition);
      const moonDistanceNow = flightPosition.distanceTo(moonWorldPosition);
      // Do not re-arm the Moon landing trigger while the dedicated takeoff phase is
      // still clearing the landing shell. The parked rocket starts just outside the
      // 50-unit re-arm threshold, so re-arming here would allow the landing check below
      // to immediately snap the ship back onto the Moon on the same frame it undocks.
      if (!moonTakeoffActive && !moonLandingArmed && moonDistanceNow >= MOON_LANDING_REARM_DISTANCE) {
        moonLandingArmed = true;
      }

      if (!moonTakeoffActive && moonLandingArmed && moonGravityActive && playerState.rocketInSpace && !playerState.rocketLanded) {
        if (moonDistanceNow <= MOON_LANDING_SURFACE_DISTANCE) {
          landRocketOnMoon();
        }
      }

      cordeliaMesh.getWorldPosition(cordeliaWorldPosition);
      const cordeliaDistanceNow = flightPosition.distanceTo(cordeliaWorldPosition);
      if (cordeliaTakeoffActive) {
        // Never allow an immediate re-landing during the dedicated escape phase.
        cordeliaLandingArmed = false;
      } else if (!cordeliaLandingArmed && cordeliaDistanceNow >= CORDELIA_LANDING_REARM_DISTANCE) {
        cordeliaLandingArmed = true;
      }
      if (!cordeliaTakeoffActive && cordeliaLandingArmed && cordeliaGravityActive && playerState.rocketInSpace && !playerState.rocketLanded) {
        const cordeliaLocal = flightPosition.clone().sub(cordeliaWorldPosition).applyQuaternion(cordeliaMesh.getWorldQuaternion(new THREE.Quaternion()).invert()).normalize();
        const cordeliaSurface = CORDELIA_RADIUS + cordeliaHeightAt(cordeliaLocal);
        if (Math.abs(cordeliaDistanceNow - cordeliaSurface) <= CORDELIA_LANDING_SURFACE_DISTANCE) landRocketOnCordelia();
      }

      auroraMesh.getWorldPosition(auroraWorldPosition);
      mileriaMesh.getWorldPosition(mileriaWorldPosition);
      const omegaCandidates = [
        { id: 'aurora', center: auroraWorldPosition, active: auroraGravityActive },
        { id: 'mileria', center: mileriaWorldPosition, active: mileriaGravityActive }
      ];
      if (omegaTakeoffActive) {
        omegaLandingArmed = false;
      } else if (!omegaLandingArmed && omegaTakeoffBodyId) {
        const releaseCenter = getOmegaBodyWorldPosition(omegaTakeoffBodyId, new THREE.Vector3());
        const releaseDistance = omegaTakeoffBodyId === 'aurora' ? 790 : 590;
        if (flightPosition.distanceTo(releaseCenter) >= releaseDistance) omegaLandingArmed = true;
      }
      if (!omegaTakeoffActive && omegaLandingArmed && playerState.rocketInSpace && !playerState.rocketLanded) {
        let bestBody = null, bestGap = Infinity;
        for (const candidate of omegaCandidates) {
          if (!candidate.active) continue;
          const localDir = flightPosition.clone().sub(candidate.center).applyQuaternion(getOmegaMesh(candidate.id).getWorldQuaternion(new THREE.Quaternion()).invert()).normalize();
          const surface = getOmegaSurfaceRadius(candidate.id, localDir);
          const gap = Math.abs(flightPosition.distanceTo(candidate.center) - surface);
          if (gap <= 9 && gap < bestGap) { bestGap = gap; bestBody = candidate.id; }
        }
        if (bestBody) landRocketOnOmega(bestBody);
      }

      if (!playerState.rocketInSpace && flightPad && !anyFlightInput) {
        flightPad.root.getWorldPosition(flightPadWorld);
        const padDistance = flightPosition.distanceTo(flightPadWorld);
        const radialDifference = Math.abs(
          flightPosition.distanceTo(ivisSolarOrbitPosition) - flightPadWorld.distanceTo(ivisSolarOrbitPosition)
        );
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
    const SAVE_VERSION = 16;
    const LOCAL_SAVE_KEY = "pocketUniverseSave_v16";

    function serializeSave() {
      commitActiveBackpackStorage();
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
          credits: Math.max(0, Math.floor(economyState.credits)),
          surfaceBodyId: omegaWalkingBodyId || (moonWalking ? 'moon' : (cordeliaWalking ? 'cordelia' : 'ivis'))
        },
        planet: {
          spinAngle: state.planetSpinAngle,
          moonOrbitAngle,
          syspoSolarOrbitAngle,
          ivisSolarOrbitAngle,
          auroraOrbitAngle,
          mileriaOrbitAngle
        },
        omega: {
          parkedBodyId: omegaLandedBodyId || null,
          parkedPadIndex: omegaLandingPad ? launchPads.indexOf(omegaLandingPad) : -1,
          parkedLocalPosition: (omegaLandedRocket && omegaLandingPad && omegaLandedBodyId && omegaLandedRocket.root.parent === getOmegaMesh(omegaLandedBodyId)) ? omegaLandedRocket.root.position.toArray() : null,
          parkedLocalQuaternion: (omegaLandedRocket && omegaLandingPad && omegaLandedBodyId && omegaLandedRocket.root.parent === getOmegaMesh(omegaLandedBodyId)) ? omegaLandedRocket.root.quaternion.toArray() : null
        },
        inventory: inventorySlots.map(slot => {
          if (!slot) return null;
          if (slot.typeId === 'backpack') {
            normalizeBackpackItem(slot);
            return { typeId: 'backpack', count: 1, backpackId: slot.backpackId, storage: slot.storage.map(inner => inner ? {
              typeId: inner.typeId,
              count: inner.count,
              ...(itemById[inner.typeId] && itemById[inner.typeId].tool ? { durability: inner.durability == null ? getToolMaxDurability(itemById[inner.typeId]) : inner.durability } : {})
            } : null) };
          }
          return {
            typeId: slot.typeId,
            count: slot.count,
            ...(itemById[slot.typeId] && itemById[slot.typeId].tool ? { durability: slot.durability == null ? getToolMaxDurability(itemById[slot.typeId]) : slot.durability } : {})
          };
        }),
        journal: {
          discoveredItems: [...journalDiscoveredItems],
          visitedBodies: [...journalVisitedBodies],
          metPeople: [...journalMetPeople]
        },
        // Crystal positions are saved too. The world uses random placement, so storing the
        // directions makes sure a loaded save restores the SAME crystal locations.
        crystals: crystalSpawns.map(spawn => ({
          typeId: spawn.typeId,
          direction: spawn.root.position.clone().normalize().toArray(),
          collected: spawn.collected,
          respawnAtSpin: spawn.respawnAtSpin
        })),
        grass: grassSpawns.map(grass => ({ direction: grass.root.position.clone().normalize().toArray(), size: grass.size, yaw: grass.yaw, cut: grass.cut })),
        trees: treeSpawns.map(tree => ({
          direction: tree.direction.toArray(),
          size: tree.size,
          yaw: tree.yaw,
          chopped: tree.chopped
        })),
        saplings: saplingSpawns.filter(s => s.active).map(s => ({
          treeIndex: s.treeIndex,
          direction: s.direction.toArray(),
          size: s.size,
          yaw: s.yaw,
          plantedAtSpin: s.plantedAtSpin
        })),
        rocks: rockSpawns.map(rock => ({
          direction: rock.direction.toArray(),
          mined: rock.mined
        }))
,
        ironOres: ironOreSpawns.map(ore => ({
          direction: ore.direction.toArray(),
          mined: ore.mined,
          oreType: ore.oreType === 'copper_ore' ? 'copper_ore' : 'iron_ore'
        })),
        moonQuartz: moonQuartzSpawns.map(spawn => ({
          direction: spawn.root.position.clone().normalize().toArray(),
          collected: spawn.collected,
          respawnAtSpin: spawn.respawnAtSpin
        })),
        moonTungsten: moonTungstenSpawns.map(ore => ({ direction: ore.direction.toArray(), mined: ore.mined })),
        cordeliaTungsten: cordeliaTungstenSpawns.map(ore => ({ direction: ore.direction.toArray(), mined: ore.mined })),
        omegaTitanium: omegaTitaniumSpawns.map(ore => ({ direction: ore.direction.toArray(), mined: ore.mined, yieldCount: ore.yieldCount })),
        auroraCrystals: auroraCrystalSpawns.map(spawn => ({ direction: spawn.direction.toArray(), collected: spawn.collected, respawnAtSpin: spawn.respawnAtSpin })),
        auroraTrees: auroraTreeSpawns.map(tree => ({ direction: tree.direction.toArray(), size: tree.size, yaw: tree.yaw, chopped: tree.chopped })),
        furnaces: furnaces.map(furnace => ({
          direction: furnace.direction.toArray(),
          yaw: furnace.yaw,
          inventory: furnace.inventory,
          surfaceBodyId: furnace.surfaceBodyId || 'ivis'
        })),
        launchPads: launchPads.map(pad => ({
          direction: pad.direction.toArray(),
          yaw: pad.yaw,
          hasRocket: !!pad.rocket,
          fuel: Math.max(0, Math.min(getRocketFuelCapacity(pad), Number(pad.fuel) || 0)),
          engineType: pad.engineType === 'mark3' ? 'mark3' : (pad.engineType === 'upgraded' ? 'upgraded' : 'standard'),
          warpDrive: !!pad.warpDrive,
          warpDriveType: pad.warpDriveType || null,
          surfaceBodyId: pad.surfaceBodyId || 'ivis'
        })),
        containers: containers.map(container => ({ containerId: container.containerId, direction: container.direction.toArray(), yaw: container.yaw, surfaceBodyId: container.surfaceBodyId || 'ivis', inventory: container.inventory.map(slot => slot ? { typeId: slot.typeId, count: slot.count, ...(itemById[slot.typeId]?.tool ? { durability: slot.durability } : {}) } : null) })),
        drills: placedDrills.map(drill => ({ direction: drill.direction.toArray(), yaw: drill.yaw, durability: drill.durability, surfaceBodyId: drill.surfaceBodyId || 'ivis' })),
        droppedItems: droppedItems.map(drop => ({ typeId: drop.typeId, count: drop.count, direction: drop.direction.toArray() }))
      };
    }

    function applySaveData(data) {
      if (!data || ![1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16].includes(data.version)) {
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
        if (item.id === 'backpack') {
          const storage = Array.isArray(slot.storage) && slot.storage.length === backpackSlots.length ? slot.storage.map(inner => {
            if (!inner) return null;
            const innerItem = itemById[inner.typeId];
            if (!innerItem || innerItem.id === 'backpack') return null;
            return {
              typeId: inner.typeId,
              count: Math.max(1, Math.min(innerItem.maxStack, Math.floor(inner.count))),
              ...(innerItem.tool ? { durability: Math.max(0, Math.min(getToolMaxDurability(innerItem), Number.isFinite(inner.durability) ? Math.floor(inner.durability) : getToolMaxDurability(innerItem))) } : {})
            };
          }) : createBackpackStorage();
          inventorySlots[i] = createBackpackItem(storage, slot.backpackId);
        } else {
          inventorySlots[i] = {
            typeId: slot.typeId,
            count: Math.max(1, Math.min(item.maxStack, Math.floor(slot.count))),
            ...(item.tool ? { durability: Math.max(0, Math.min(getToolMaxDurability(item), Number.isFinite(slot.durability) ? Math.floor(slot.durability) : getToolMaxDurability(item))) } : {})
          };
        }
      }
      if (Array.isArray(data.backpack) && data.backpack.length === backpackSlots.length) {
        // Legacy builds stored one shared backpack inventory. Keep it by migrating it into
        // the first backpack found, while newly created backpacks always have unique storage.
        const firstBackpack = inventorySlots.find(slot => slot && slot.typeId === 'backpack');
        if (firstBackpack) {
          const storage = data.backpack.map(slot => {
            if (!slot) return null;
            const item = itemById[slot.typeId];
            if (!item || item.id === 'backpack') return null;
            return {
              typeId: slot.typeId,
              count: Math.max(1, Math.min(item.maxStack, Math.floor(slot.count))),
              ...(item.tool ? { durability: Math.max(0, Math.min(getToolMaxDurability(item), Number.isFinite(slot.durability) ? Math.floor(slot.durability) : getToolMaxDurability(item))) } : {})
            };
          });
          firstBackpack.storage = storage;
        }
      }

      for (const slot of inventorySlots) if (slot && slot.typeId === 'backpack') normalizeBackpackItem(slot);
      for (let i = 0; i < backpackSlots.length; i++) backpackSlots[i] = null;


      uiState.selectedHotbarSlot = Math.max(0, Math.min(HOTBAR_SLOT_COUNT - 1, data.player.selectedHotbarSlot | 0));
      state.gameMode = data.player && data.player.mode === 'freeplay' ? 'freeplay' : 'survival';

      const savedJournal = data.journal && typeof data.journal === 'object' ? data.journal : null;
      const validJournalItems = new Set(ITEM_TYPES.map(item => item.id));
      const validJournalBodies = new Set(Object.keys(JOURNAL_BODY_INFO));
      const validJournalPeople = new Set(Object.keys(JOURNAL_PERSON_INFO));
      journalDiscoveredItems = journalSafeIds(savedJournal && savedJournal.discoveredItems, validJournalItems);
      journalDiscoveredItems.add('journal');
      if (hasItemType('axe')) journalDiscoveredItems.add('axe');
      if (!savedJournal) {
        for (const slot of inventorySlots) if (slot) journalDiscoveredItems.add(slot.typeId);
      }
      journalVisitedBodies = journalSafeIds(savedJournal && savedJournal.visitedBodies, validJournalBodies);
      journalVisitedBodies.add('ivis');
      journalMetPeople = journalSafeIds(savedJournal && savedJournal.metPeople, validJournalPeople);

      // Legacy v1 saves predate the axe/plank system. Give those worlds the starter axe too
      // when possible, so loading an older world does not strand the player without tools.
      if (data.version === 1 && !hasItemType('axe') && !inventorySlots[getHotbarInventoryIndex(0)]) {
        inventorySlots[getHotbarInventoryIndex(0)] = { typeId: 'axe', count: 1, durability: TOOL_MAX_DURABILITY };
      }

      // Restore the planet rotation/time of day and the Moon's orbital phase when available.
      state.planetSpinAngle = Number.isFinite(data.planet.spinAngle) ? data.planet.spinAngle : 0;
      moonOrbitAngle = Number.isFinite(data.planet.moonOrbitAngle) ? data.planet.moonOrbitAngle : 0;
      syspoSolarOrbitAngle = Number.isFinite(data.planet.syspoSolarOrbitAngle) ? data.planet.syspoSolarOrbitAngle : 0;
      ivisSolarOrbitAngle = Number.isFinite(data.planet.ivisSolarOrbitAngle) ? data.planet.ivisSolarOrbitAngle : 0;
      auroraOrbitAngle = Number.isFinite(data.planet.auroraOrbitAngle) ? data.planet.auroraOrbitAngle : 0;
      mileriaOrbitAngle = Number.isFinite(data.planet.mileriaOrbitAngle) ? data.planet.mileriaOrbitAngle : Math.PI;
      updateIvisSolarOrbit(0);
      updateMoon(0);
      updateOmegaSystem(0);

      // Restore crystal placement and pickup/respawn state.
      if (!Array.isArray(data.crystals) || data.crystals.length !== crystalSpawns.length) {
        throw new Error("Save file has an invalid crystal layout.");
      }
      for (let i = 0; i < crystalSpawns.length; i++) {
        const saved = data.crystals[i];
        const spawn = crystalSpawns[i];
        const dir = new THREE.Vector3().fromArray(saved.direction).normalize();
        if (spawn.root.parent === cordeliaMesh) {
          // Cordelia crystals live in Cordelia's own local coordinate system. Do not restore
          // them with Ivis' PLANET_RADIUS/heightAt math or they will float above the surface.
          placeCordeliaProp(spawn.root, dir, 0.01);
        } else {
          const h = heightAt(dir);
          spawn.root.position.copy(dir).multiplyScalar(PLANET_RADIUS + h + 0.02);
          spawn.root.quaternion.setFromUnitVectors(crystalPlacementUp, dir);
        }
        spawn.collected = !!saved.collected;
        spawn.respawnAtSpin = Number.isFinite(saved.respawnAtSpin) ? saved.respawnAtSpin : 0;
        spawn.crystal.visible = !spawn.collected;
        spawn.ghost.visible = spawn.collected;
      }

      if (Array.isArray(data.grass) && data.grass.length === grassSpawns.length) {
        for (let i = 0; i < grassSpawns.length; i++) {
          const saved = data.grass[i];
          const grass = grassSpawns[i];
          const dir = new THREE.Vector3().fromArray(saved.direction).normalize();
          const h = heightAt(dir);
          grass.direction.copy(dir);
          grass.size = Number.isFinite(saved.size) ? saved.size : grass.size;
          grass.yaw = Number.isFinite(saved.yaw) ? saved.yaw : grass.yaw;
          grass.cut = !!saved.cut;
          grass.root.scale.set(grass.size, grass.size * 0.9, grass.size);
          grass.root.position.copy(dir).multiplyScalar(PLANET_RADIUS + h + 0.18 * grass.size);
          grass.root.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0), dir);
          grass.root.rotateY(grass.yaw);
          grass.root.visible = !grass.cut;
        }
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

      // Restore living tree saplings. Older saves have no saplings field and continue to work.
      for (const sapling of saplingSpawns) {
        if (sapling.root && sapling.root.parent) sapling.root.parent.remove(sapling.root);
      }
      saplingSpawns.length = 0;
      if (Array.isArray(data.saplings)) {
        for (const saved of data.saplings) {
          const treeIndex = Number.isInteger(saved.treeIndex) ? saved.treeIndex : -1;
          const tree = treeSpawns[treeIndex];
          if (!tree || !Array.isArray(saved.direction)) continue;
          const sapling = {
            root: null,
            treeIndex,
            direction: new THREE.Vector3().fromArray(saved.direction).normalize(),
            size: Number.isFinite(saved.size) ? Math.max(1.5, Math.min(4, saved.size)) : tree.size,
            yaw: Number.isFinite(saved.yaw) ? saved.yaw : tree.yaw,
            plantedAtSpin: Number.isFinite(saved.plantedAtSpin) ? saved.plantedAtSpin : state.planetSpinAngle,
            active: true
          };
          const root = new THREE.Group();
          root.name = 'TreeSapling';
          const trunk = new THREE.Mesh(treeTrunkGeo, treeTrunkMat);
          const leaves = new THREE.Mesh(treeLeafGeo, treeLeafMat);
          trunk.position.y = 0.7;
          leaves.position.y = 2.0;
          root.add(trunk);
          root.add(leaves);
          sapling.root = root;
          planetSystem.add(root);
          saplingSpawns.push(sapling);
        }
      }
      updateTreeSaplings();

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
          ore.oreType = saved.oreType === 'copper_ore' ? 'copper_ore' : 'iron_ore';
          ore.root.position.copy(dir).multiplyScalar(PLANET_RADIUS + h + 0.25);
          ore.mined = !!saved.mined;
          ore.root.visible = !ore.mined;
        }
      }

      if (Array.isArray(data.moonQuartz) && data.moonQuartz.length === moonQuartzSpawns.length) {
        for (let i = 0; i < moonQuartzSpawns.length; i++) {
          const saved = data.moonQuartz[i];
          const spawn = moonQuartzSpawns[i];
          if (Array.isArray(saved.direction)) {
            spawn.direction.copy(new THREE.Vector3().fromArray(saved.direction).normalize());
            spawn.root.position.copy(spawn.direction).multiplyScalar(MOON_RADIUS + 0.6);
            spawn.root.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), spawn.direction);
          }
          spawn.collected = !!saved.collected;
          spawn.respawnAtSpin = Number.isFinite(saved.respawnAtSpin) ? saved.respawnAtSpin : 0;
          spawn.visual.visible = !spawn.collected;
          spawn.ghost.visible = spawn.collected;
          spawn.root.visible = true;
        }
      }

      if (Array.isArray(data.moonTungsten) && data.moonTungsten.length === moonTungstenSpawns.length) {
        for (let i=0;i<moonTungstenSpawns.length;i++) {
          const saved=data.moonTungsten[i], ore=moonTungstenSpawns[i];
          if (Array.isArray(saved.direction)) { ore.direction.copy(new THREE.Vector3().fromArray(saved.direction).normalize()); ore.root.position.copy(ore.direction).multiplyScalar(MOON_RADIUS+.22); ore.root.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0),ore.direction); }
          ore.mined=!!saved.mined; ore.root.visible=!ore.mined;
        }
      }
      if (Array.isArray(data.cordeliaTungsten) && data.cordeliaTungsten.length === cordeliaTungstenSpawns.length) {
        for (let i=0;i<cordeliaTungstenSpawns.length;i++) {
          const saved=data.cordeliaTungsten[i], ore=cordeliaTungstenSpawns[i];
          if (Array.isArray(saved.direction)) { ore.direction.copy(new THREE.Vector3().fromArray(saved.direction).normalize()); placeCordeliaProp(ore.root,ore.direction,.10); }
          ore.mined=!!saved.mined; ore.root.visible=!ore.mined;
        }
      }

      if (Array.isArray(data.omegaTitanium) && data.omegaTitanium.length === omegaTitaniumSpawns.length) {
        for (let i = 0; i < omegaTitaniumSpawns.length; i++) {
          const saved = data.omegaTitanium[i], ore = omegaTitaniumSpawns[i];
          if (Array.isArray(saved.direction)) {
            ore.direction.copy(new THREE.Vector3().fromArray(saved.direction).normalize());
            placeMileriaProp(ore.root, ore.direction, 0.18);
          }
          ore.yieldCount = Math.max(1, Math.min(5, Number(saved.yieldCount) || ore.yieldCount || 1));
          ore.mined = !!saved.mined;
          ore.root.visible = !ore.mined;
        }
      }
      if (Array.isArray(data.auroraCrystals) && data.auroraCrystals.length === auroraCrystalSpawns.length) {
        for (let i = 0; i < auroraCrystalSpawns.length; i++) {
          const saved = data.auroraCrystals[i], spawn = auroraCrystalSpawns[i];
          if (Array.isArray(saved.direction)) {
            spawn.direction.copy(new THREE.Vector3().fromArray(saved.direction).normalize());
            placeAuroraProp(spawn.root, spawn.direction, 0.02);
          }
          spawn.collected = !!saved.collected;
          spawn.respawnAtSpin = Number.isFinite(saved.respawnAtSpin) ? saved.respawnAtSpin : 0;
          spawn.crystal.visible = !spawn.collected;
          spawn.ghost.visible = spawn.collected;
        }
      }
      if (Array.isArray(data.auroraTrees) && data.auroraTrees.length === auroraTreeSpawns.length) {
        for (let i = 0; i < auroraTreeSpawns.length; i++) {
          const saved = data.auroraTrees[i], tree = auroraTreeSpawns[i];
          if (Array.isArray(saved.direction)) {
            tree.direction.copy(new THREE.Vector3().fromArray(saved.direction).normalize());
            placeAuroraProp(tree.root, tree.direction, 0);
          }
          tree.size = Number.isFinite(saved.size) ? Math.max(1.25, Math.min(4, saved.size)) : tree.size;
          tree.yaw = Number.isFinite(saved.yaw) ? saved.yaw : tree.yaw;
          if (tree.root.children[0]) { tree.root.children[0].scale.setScalar(tree.size); tree.root.children[0].position.y = 0.7 * tree.size; }
          if (tree.root.children[1]) { tree.root.children[1].scale.setScalar(tree.size); tree.root.children[1].position.y = 2.0 * tree.size; }
          tree.root.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0), tree.direction);
          tree.root.rotateY(tree.yaw);
          tree.chopped = !!saved.chopped;
          tree.root.visible = !tree.chopped;
        }
      }

      // Restore placed furnaces and their inventories.
      for (const furnace of furnaces) if (furnace.root && furnace.root.parent) furnace.root.parent.remove(furnace.root);
      furnaces.length = 0;
      if (Array.isArray(data.furnaces)) {
        for (const saved of data.furnaces) {
          if (!Array.isArray(saved.direction)) continue;
          const furnace = createFurnaceObject(new THREE.Vector3().fromArray(saved.direction).normalize(), Number.isFinite(saved.yaw) ? saved.yaw : 0, saved.surfaceBodyId || 'ivis');
          if (saved.inventory && typeof saved.inventory === 'object') {
            for (const key of ['fuel','input','output']) {
              const v=saved.inventory[key];
              if (v && itemById[v.typeId] && ((key==='fuel' && v.typeId==='planks') || (key==='input' && (v.typeId==='iron_ore' || v.typeId==='copper_ore' || v.typeId==='tungsten_ore' || v.typeId==='titanium_ore')) || (key==='output' && (v.typeId==='iron_ingot' || v.typeId==='copper_ingot' || v.typeId==='tungsten_ingot' || v.typeId==='titanium_ingot')))) furnace.inventory[key]={typeId:v.typeId,count:Math.max(1,Math.min(10,Math.floor(v.count||1)))};
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
          const pad = createLaunchPadObject(new THREE.Vector3().fromArray(saved.direction).normalize(), Number.isFinite(saved.yaw) ? saved.yaw : 0, saved.surfaceBodyId || 'ivis');
          if (saved.hasRocket) placeRocketOnLaunchPad(pad);
          pad.engineType = saved.engineType === 'mark3' ? 'mark3' : (saved.engineType === 'upgraded' ? 'upgraded' : 'standard');
          pad.warpDrive = !!saved.warpDrive;
          pad.warpDriveType = saved.warpDriveType === 'mk2' ? 'mk2' : (pad.warpDrive ? 'mk1' : null);
          pad.fuel = Math.max(0, Math.min(getRocketFuelCapacity(pad), Number(saved.fuel) || 0));
          if (pad.rocket) { pad.rocket.engineType = pad.engineType; pad.rocket.warpDrive = pad.warpDrive; pad.rocket.warpDriveType = pad.warpDriveType; ensureRocketEngineVisual(pad.rocket); }
        }
      }

      omegaLandedRocket = null;
      omegaLandedBodyId = null;
      omegaLandingPad = null;
      const savedOmega = data.omega && typeof data.omega === 'object' ? data.omega : null;
      if (savedOmega && (savedOmega.parkedBodyId === 'aurora' || savedOmega.parkedBodyId === 'mileria') && Number.isInteger(savedOmega.parkedPadIndex)) {
        const parkedPad = launchPads[savedOmega.parkedPadIndex];
        const parkedBody = getOmegaMesh(savedOmega.parkedBodyId);
        if (parkedPad && parkedPad.rocket && parkedBody) {
          const parkedRocket = parkedPad.rocket;
          parkedBody.attach(parkedRocket.root);
          if (Array.isArray(savedOmega.parkedLocalPosition)) parkedRocket.root.position.fromArray(savedOmega.parkedLocalPosition);
          if (Array.isArray(savedOmega.parkedLocalQuaternion)) parkedRocket.root.quaternion.fromArray(savedOmega.parkedLocalQuaternion);
          parkedRocket.root.visible = true;
          omegaLandedRocket = parkedRocket;
          omegaLandedBodyId = savedOmega.parkedBodyId;
          omegaLandingPad = parkedPad;
          omegaLandingArmed = false;
        }
      }

      for (const drill of placedDrills) if (drill.root && drill.root.parent) drill.root.parent.remove(drill.root);
      placedDrills.length = 0;
      if (Array.isArray(data.drills)) {
        for (const saved of data.drills) {
          if (!Array.isArray(saved.direction)) continue;
          createDrillObject(new THREE.Vector3().fromArray(saved.direction).normalize(), Number.isFinite(saved.yaw) ? saved.yaw : 0, Math.max(0, Math.min(100, Number(saved.durability) || 0)), saved.surfaceBodyId || 'ivis');
        }
      }

      for (const container of containers) if (container.root && container.root.parent) container.root.parent.remove(container.root);
      containers.length = 0;
      nextContainerId = 1;
      if (Array.isArray(data.containers)) {
        for (const saved of data.containers) {
          if (!Array.isArray(saved.direction)) continue;
          const inventory = Array.isArray(saved.inventory) && saved.inventory.length === 20
            ? saved.inventory.map(normalizeContainerSlot)
            : createContainerStorage();
          createContainerObject(new THREE.Vector3().fromArray(saved.direction).normalize(), Number.isFinite(saved.yaw) ? saved.yaw : 0, saved.surfaceBodyId || 'ivis', inventory, typeof saved.containerId === 'string' ? saved.containerId : null);
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

      // Restore the player's local coordinate frame for Omega moons. Position is saved in the
      // body's local space, so re-parent before the final camera/orientation refresh.
      moonWalking = false; cordeliaWalking = false; omegaWalkingBodyId = null;
      if (p.surfaceBodyId === 'aurora' || p.surfaceBodyId === 'mileria') {
        const omegaBody = getOmegaMesh(p.surfaceBodyId);
        if (omegaBody) {
          omegaBody.attach(player);
          omegaWalkingBodyId = p.surfaceBodyId;
          auroraGravityActive = p.surfaceBodyId === 'aurora';
          mileriaGravityActive = p.surfaceBodyId === 'mileria';
          moonGravityActive = false; cordeliaGravityActive = false; syspoGravityActive = false;
          playerState.inRocket = false; playerState.rocketInSpace = false; playerState.rocketLanded = false;
        }
      }

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

    let saveToastTimer = null;
    function showSaveToast() {
      if (!saveToast) return;
      saveToast.classList.remove('hidden');
      clearTimeout(saveToastTimer);
      saveToastTimer = setTimeout(() => saveToast.classList.add('hidden'), 1500);
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
      showSaveToast();
    }

    function loadGameFromData(data) {
      closeAchievements();
      applySaveData(data);
      updateInventoryActionButton();
      state.gameState = "playing";
      state.paused = false;
      uiState.inventoryOpen = false;
      uiState.craftingOpen = false;
      uiState.freeplayInventoryOpen = false;
      uiState.shipInventoryOpen = false;
      backpackOpen = false;
      if (backpackStorage) backpackStorage.classList.add('hidden');
      closeMerchant();
      craftingOverlay.classList.add("hidden");
      freeplayInventoryOverlay.classList.add("hidden");
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
      moonWalking = false;
      moonGravityActive = false;
      moonDustTimer = 0;
      cordeliaWalking = false;
      cordeliaGravityActive = false;
      cordeliaDustTimer = 0;
      moonLandedRocket = null;
      moonLandingPad = null;
      moonLandingArmed = true;
      cordeliaLandedRocket = null;
      cordeliaLandingPad = null;
      cordeliaLandingArmed = true;
      cordeliaTakeoffActive = false;
      omegaWalkingBodyId = null;
      omegaLandedRocket = null;
      omegaLandedBodyId = null;
      omegaLandingPad = null;
      omegaTakeoffActive = false;
      omegaTakeoffBodyId = null;
      omegaLandingArmed = true;
      syspoGravityActive = false;
      auroraGravityActive = false;
      mileriaGravityActive = false;
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
      // Rainbow Opal intentionally uses the same standard crystal pickup sound.
      // The player must have an available stack/slot before the crystal disappears.
      if (!addItemToInventory(spawn.typeId, 1, null, true)) return false;

      spawn.collected = true;
      playAudio('crystalPickup', 0.55, 0.98 + Math.random() * 0.06, 500);
      spawn.crystal.visible = false;
      spawn.ghost.visible = true;
      // Respawn after two complete planet rotations, exactly as before.
      spawn.respawnAtSpin = state.planetSpinAngle + Math.PI * 4;
      recordCrystalAchievement(spawn.typeId);
      return true;
    }

    let nearbyMoonQuartz = null;

    function findNearbyMoonQuartz() {
      if (!moonWalking) return null;
      const playerWorld = player.getWorldPosition(new THREE.Vector3());
      let best = null, bestDist = Infinity;
      for (const spawn of moonQuartzSpawns) {
        if (spawn.collected || !spawn.root.visible) continue;
        const pos = spawn.root.getWorldPosition(new THREE.Vector3());
        const d = pos.distanceTo(playerWorld);
        if (d < 3.0 && d < bestDist) { bestDist = d; best = spawn; }
      }
      return best;
    }

    function tryCollectNearbyMoonQuartz() {
      if (!nearbyMoonQuartz) return false;
      if (!addItemToInventory('moon_quartz', 1, null, true)) {
        const prompt = document.getElementById('crystalPrompt'); prompt.classList.remove('hidden'); prompt.textContent = 'Inventory full — make room first';
        return true;
      }
      nearbyMoonQuartz.collected = true;
      nearbyMoonQuartz.visual.visible = false;
      nearbyMoonQuartz.ghost.visible = true;
      nearbyMoonQuartz.respawnAtSpin = state.planetSpinAngle + Math.PI * 4;
      nearbyMoonQuartz = null;
      playAudio('crystalPickup', 0.55, 0.98 + Math.random() * 0.06, 500);
      const prompt = document.getElementById('crystalPrompt'); prompt.classList.remove('hidden');
      prompt.innerHTML = '<span class="promptKey">+1</span> Moon Quartz collected';
      setTimeout(() => { if (state.gameState === 'playing') updateCrystalPrompt(); }, 600);
      return true;
    }

    function findNearbyTungsten() {
      const sources=moonTungstenSpawns.concat(cordeliaTungstenSpawns);
      if (sources.length===0 || (!moonWalking && !cordeliaWalking)) return null;
      const cameraWorld=camera.getWorldPosition(new THREE.Vector3());
      const lookDir=camera.getWorldDirection(new THREE.Vector3()).normalize();
      let best=null,bestScore=Infinity;
      for (const ore of sources) {
        if (ore.mined || !ore.root.visible) continue;
        const oreWorld=ore.root.getWorldPosition(new THREE.Vector3());
        const to=oreWorld.clone().sub(cameraWorld); const distance=to.length();
        if (distance>4.8) continue; to.normalize(); const facing=lookDir.dot(to);
        if (facing<.30) continue; const score=distance-facing*.8;
        if (score<bestScore) { bestScore=score; best=ore; }
      }
      return best;
    }

    function findNearbyUpgradeableRocket() {
      const playerWorld = player.getWorldPosition(new THREE.Vector3());
      if (moonWalking && moonLandedRocket) {
        const pos = moonLandedRocket.root.getWorldPosition(new THREE.Vector3());
        if (pos.distanceTo(playerWorld) <= 4.5) return moonLandedRocket;
      }
      if (cordeliaWalking && cordeliaLandedRocket) {
        const pos = cordeliaLandedRocket.root.getWorldPosition(new THREE.Vector3());
        if (pos.distanceTo(playerWorld) <= 4.5) return cordeliaLandedRocket;
      }
      const pad = findNearbyLaunchPad();
      return pad && pad.rocket ? pad.rocket : null;
    }

    function getRequiredWrenchForInstallation(typeId) {
      if (typeId === 'warp_drive' || typeId === 'upgraded_engine') return 'iron_wrench';
      if (typeId === 'warp_drive_mk2' || typeId === 'engine_mark_3') return 'titanium_wrench';
      return null;
    }

    function hasRequiredWrench(typeId) {
      const wrenchId = getRequiredWrenchForInstallation(typeId);
      return !wrenchId || countItem(wrenchId) > 0;
    }

    function showMissingWrenchPrompt(typeId) {
      const wrenchId = getRequiredWrenchForInstallation(typeId);
      if (!wrenchId) return;
      const wrenchName = itemById[wrenchId]?.name || wrenchId;
      showFlightPrompt('INSTALLATION REQUIRES ' + wrenchName.toUpperCase());
    }

    function tryInstallWarpDriveNearbyRocket() {
      if (state.gameState !== 'playing' || state.paused || uiState.inventoryOpen || uiState.craftingOpen || uiState.furnaceOpen) return false;
      if (uiState.equippedItemType !== 'warp_drive') return false;
      const rocket = findNearbyUpgradeableRocket();
      if (!rocket || !rocket.pad) return false;
      if (rocket.warpDrive || rocket.pad.warpDrive) { showFlightPrompt((rocket.pad.warpDriveType === 'mk2' || rocket.warpDriveType === 'mk2') ? 'Rocket already has Warp Drive Mark 2.' : 'Rocket already has a Warp Drive.'); return true; }
      if (!hasRequiredWrench('warp_drive')) { showMissingWrenchPrompt('warp_drive'); return true; }
      const idx = getSelectedHotbarInventoryIndex();
      if (!inventorySlots[idx] || inventorySlots[idx].typeId !== 'warp_drive') return false;
      rocket.pad.warpDrive = true; rocket.pad.warpDriveType = 'mk1'; rocket.warpDrive = true; rocket.warpDriveType = 'mk1'; inventorySlots[idx] = null;
      refreshEquippedItem(); updateHotbarUI(); updateInventoryUI();
      showFlightPrompt('WARP DRIVE INSTALLED · Space Map unlocked');
      setTimeout(() => { if (state.gameState === 'playing') updateCrystalPrompt(); }, 1000);
      return true;
    }

    function tryInstallWarpDriveMark2NearbyRocket() {
      if (state.gameState !== 'playing' || state.paused || uiState.inventoryOpen || uiState.craftingOpen || uiState.furnaceOpen) return false;
      if (uiState.equippedItemType !== 'warp_drive_mk2') return false;
      const rocket = findNearbyUpgradeableRocket();
      if (!rocket || !rocket.pad) return false;
      // Warp Drive Mark 2 is a complete replacement upgrade and can be installed on any landed rocket.
      // It no longer requires the old Warp Drive to be installed first; the Mk2 upgrade already contains
      // everything needed to operate as a warp drive.
      if ((rocket.pad.warpDriveType === 'mk2') || (rocket.warpDriveType === 'mk2')) { showFlightPrompt('Rocket already has Warp Drive Mark 2.'); return true; }
      if (!hasRequiredWrench('warp_drive_mk2')) { showMissingWrenchPrompt('warp_drive_mk2'); return true; }
      const idx = getSelectedHotbarInventoryIndex();
      if (!inventorySlots[idx] || inventorySlots[idx].typeId !== 'warp_drive_mk2') return false;
      rocket.pad.warpDrive = true; rocket.pad.warpDriveType = 'mk2'; rocket.warpDrive = true; rocket.warpDriveType = 'mk2'; inventorySlots[idx] = null;
      refreshEquippedItem(); updateHotbarUI(); updateInventoryUI();
      showFlightPrompt('WARP DRIVE MARK 2 INSTALLED · Warp fuel: Rainbow Opal');
      setTimeout(() => { if (state.gameState === 'playing') updateCrystalPrompt(); }, 1000);
      return true;
    }

    function tryUpgradeNearbyRocket() {
      if (state.gameState !== 'playing' || state.paused || uiState.inventoryOpen || uiState.craftingOpen || uiState.furnaceOpen) return false;
      if (uiState.equippedItemType !== 'upgraded_engine') return false;
      const rocket = findNearbyUpgradeableRocket();
      if (!rocket || !rocket.pad) return false;
      if (rocket.engineType === 'upgraded' || rocket.pad.engineType === 'upgraded') { showFlightPrompt('Rocket already has Engine Mark 2.'); return true; }
      if (rocket.engineType === 'mark3' || rocket.pad.engineType === 'mark3') { showFlightPrompt('Rocket already has Engine Mark 3.'); return true; }
      if (!hasRequiredWrench('upgraded_engine')) { showMissingWrenchPrompt('upgraded_engine'); return true; }
      const idx = getSelectedHotbarInventoryIndex();
      if (!inventorySlots[idx] || inventorySlots[idx].typeId !== 'upgraded_engine') return false;
      rocket.pad.engineType = 'upgraded'; rocket.engineType = 'upgraded'; rocket.pad.fuel = 0;
      ensureRocketEngineVisual(rocket);
      inventorySlots[idx] = null;
      refreshEquippedItem(); updateHotbarUI(); updateInventoryUI();
      awardAchievement('upgraded_engine');
      showFlightPrompt('ENGINE MARK 2 INSTALLED · Fuel tank: 200%');
      setTimeout(() => { if (state.gameState === 'playing') updateCrystalPrompt(); }, 1000);
      return true;
    }

    function tryInstallEngineMark3NearbyRocket() {
      if (state.gameState !== 'playing' || state.paused || uiState.inventoryOpen || uiState.craftingOpen || uiState.furnaceOpen) return false;
      if (uiState.equippedItemType !== 'engine_mark_3') return false;
      const rocket = findNearbyUpgradeableRocket();
      if (!rocket || !rocket.pad) return false;
      // Engine Mark 3 is a complete replacement upgrade and can be installed directly on a landed rocket.
      // The Engine Mark 2 is only a crafting ingredient for making the Mk3 item; it does not need to be
      // currently installed on the rocket.
      if (rocket.engineType === 'mark3' || rocket.pad.engineType === 'mark3') { showFlightPrompt('Rocket already has Engine Mark 3.'); return true; }
      if (!hasRequiredWrench('engine_mark_3')) { showMissingWrenchPrompt('engine_mark_3'); return true; }
      const idx = getSelectedHotbarInventoryIndex();
      if (!inventorySlots[idx] || inventorySlots[idx].typeId !== 'engine_mark_3') return false;
      rocket.pad.engineType = 'mark3'; rocket.engineType = 'mark3'; rocket.pad.fuel = 0;
      ensureRocketEngineVisual(rocket);
      inventorySlots[idx] = null;
      refreshEquippedItem(); updateHotbarUI(); updateInventoryUI();
      showFlightPrompt('ENGINE MARK 3 INSTALLED · Supersonic speed unlocked · Fuel tank: 300%');
      setTimeout(() => { if (state.gameState === 'playing') updateCrystalPrompt(); }, 1000);
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
      const mineableRocks = rockSpawns.concat(ironOreSpawns, cordeliaRockSpawns, moonTungstenSpawns, cordeliaTungstenSpawns, omegaTitaniumSpawns);
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
      const allTreeSpawns = treeSpawns.concat(auroraTreeSpawns);
      for (const tree of allTreeSpawns) {
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

    function findNearbyGrass() {
      const cameraWorld = new THREE.Vector3();
      const lookDir = new THREE.Vector3();
      camera.getWorldPosition(cameraWorld);
      camera.getWorldDirection(lookDir).normalize();
      let best = null;
      let bestScore = Infinity;
      for (const grass of grassSpawns) {
        if (grass.cut || !grass.root.visible) continue;
        const grassWorld = new THREE.Vector3();
        grass.root.getWorldPosition(grassWorld);
        const toGrass = grassWorld.clone().sub(cameraWorld);
        const distance = toGrass.length();
        if (distance > 4.6 || distance < 0.2) continue;
        toGrass.normalize();
        const facing = lookDir.dot(toGrass);
        if (facing < 0.12) continue;
        const score = distance - facing * 1.0;
        if (score < bestScore) { bestScore = score; best = grass; }
      }
      return best;
    }

    const SCYTHE_CUT_TIME = 360;
    let scytheCutting = false;
    let scytheCuttingStartedAt = 0;
    let scytheCuttingTarget = null;

    function isScythe(typeId) { return typeId === 'wooden_scythe' || typeId === 'stone_scythe' || typeId === 'iron_scythe'; }

    function cutNearbyGrass() {
      if (state.gameState !== 'playing' || state.paused || uiState.inventoryOpen || uiState.craftingOpen || uiState.furnaceOpen) return false;
      if (!isScythe(uiState.equippedItemType) || scytheCutting) return false;
      const grass = findNearbyGrass();
      if (!grass) return false;
      if (!canAddItemToInventory('grass_fiber', 3)) {
        const prompt = document.getElementById('crystalPrompt');
        prompt.classList.remove('hidden');
        prompt.innerHTML = '<span class="promptKey">FULL</span> Not enough inventory space for 3 Grass Fibers';
        return false;
      }
      const current = getCurrentToolSlot();
      if (!current || current.slot.durability < 1) return false;
      scytheCutting = true;
      scytheCuttingTarget = grass;
      scytheCuttingStartedAt = performance.now();
      triggerToolSwing(0.88, 240);
      return true;
    }

    function finishScytheCut() {
      if (!scytheCutting) return;
      const elapsed = performance.now() - scytheCuttingStartedAt;
      if (elapsed < SCYTHE_CUT_TIME) return;
      scytheCutting = false;
      scytheCuttingStartedAt = 0;
      const grass = scytheCuttingTarget;
      scytheCuttingTarget = null;
      if (!grass || grass.cut || !grass.root.visible || findNearbyGrass() !== grass) return;
      if (!addItemToInventory('grass_fiber', 3, null, true)) return;
      useToolOnce();
      grass.cut = true;
      grass.root.visible = false;
      playAudio('chop', 0.38, 1.12);
      spawnImpactParticles(getParticleWorldPosition(grass.root, 0.08), 0x79a95b, { count: 12, life: 0.45, speed: 2.2, size: 0.06, gravity: 4.2 });
      const prompt = document.getElementById('crystalPrompt');
      prompt.classList.remove('hidden');
      prompt.innerHTML = '<span class="promptKey">+3</span> Grass Fibers collected';
      setTimeout(() => { if (state.gameState === 'playing') updateCrystalPrompt(); }, 700);
    }

    // Chopping now takes the same short action time as mining stone. The player must
    // keep the mouse button held down for the whole duration or the action resets.
    const TREE_CHOP_TIME = 1200;
    let choppingTree = false;
    let choppingTreeStartedAt = 0;
    let choppingTreeTarget = null;

    function getTreeChopTimeForTool(typeId = uiState.equippedItemType) { return isDrill(typeId) ? TREE_CHOP_TIME * 0.5 : TREE_CHOP_TIME; }

    function chopNearbyTree() {
      if (state.gameState !== 'playing' || state.paused || uiState.inventoryOpen || uiState.craftingOpen || settingsModal.classList.contains('hidden') === false) return false;
      if (uiState.equippedItemType !== 'axe' && uiState.equippedItemType !== 'wooden_axe' && uiState.equippedItemType !== 'stone_axe' && uiState.equippedItemType !== 'iron_axe' && !isDrill(uiState.equippedItemType)) return false;
      if (isDrill(uiState.equippedItemType)) { const drill = getCurrentToolSlot(); if (!drill || drill.slot.durability <= 0) return false; }
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
      nextChopSoundAt = performance.now();
      triggerToolSwing(1.0, 300);
      const prompt = document.getElementById('crystalPrompt');
      prompt.classList.remove('hidden');
      prompt.innerHTML = '<span class="promptKey">CHOPPING</span> Chopping Tree…';
      return true;
    }

    function finishChoppingTree() {
      if (!choppingTree) return;
      const elapsed = performance.now() - choppingTreeStartedAt;
      if (elapsed < getTreeChopTimeForTool()) return;

      choppingTree = false;
      choppingTreeStartedAt = 0;

      const tree = choppingTreeTarget;
      choppingTreeTarget = null;
      const valid = state.gameState === 'playing' && !state.paused && !uiState.inventoryOpen && !uiState.craftingOpen &&
        settingsModal.classList.contains('hidden') && tree && !tree.chopped && tree.root.visible &&
        findNearbyTree() === tree && isToolUseHeld();
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

      addItemToInventory('planks', plankYield, null, true);
      useToolDurability(isDrill(uiState.equippedItemType) ? 1 : plankYield);
      spawnImpactParticles(getParticleWorldPosition(tree.root, 0.7), 0x8b5a35, { count: 18, life: 0.65, speed: 2.8, size: 0.085, gravity: 5.0 });
      tree.chopped = true;
      tree.root.visible = false;
      const treeIndex = treeSpawns.indexOf(tree);
      if (treeIndex >= 0) createTreeSapling(tree, treeIndex);
      awardAchievement('first_tree');
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
      if (current.slot.durability < 5) awardAchievement('low_durability');
      const broke = current.slot.durability === 0;
      if (broke && !isDrill(current.item.id)) {
        inventorySlots[current.index] = null;
        uiState.equippedItemType = null;
        clearHeldItem(heldCrystalFirstPerson);
        clearHeldItem(heldCrystalThirdPerson);
      }
      updateHotbarUI();
      updateInventoryUI();
      refreshEquippedItem();
      return !broke || isDrill(current.item.id);
    }

    // Most tool actions, like a single mining hit, only cost one durability point.
    function useToolOnce() {
      return useToolDurability(1);
    }

    function isDrill(typeId) { return typeId === 'drill'; }
    function isPickaxe(typeId) {
      return typeId === 'wooden_pickaxe' || typeId === 'stone_pickaxe' || typeId === 'iron_pickaxe' || typeId === 'drill';
    }

    function canMineStoneHere() {
      if (omegaWalkingBodyId || moonWalking || cordeliaWalking) return false;
      if (!isPickaxe(uiState.equippedItemType)) return false;
      const dir = player.position.clone().normalize();
      // Regular stone remains a high-mountain resource.
      return heightAt(dir) >= MINEABLE_STONE_MIN_HEIGHT;
    }

    function getMiningTimeForTool(typeId = uiState.equippedItemType, target = miningRock) {
      let base;
      if (typeId === 'drill') base = 324;
      else if (typeId === 'iron_pickaxe') base = 648;
      else base = typeId === 'stone_pickaxe' ? 810 : 900;
      return target?.oreType === 'titanium_ore' ? base * 3 : base;
    }

    // Mining is deliberately not instant. Stone pickaxes mine 10% faster than wooden pickaxes.
    const STONE_MINE_TIME = 900; // milliseconds per stone with a wooden pickaxe
    let miningStone = false;
    let miningStoneStartedAt = 0;
    let miningRock = null;
    let mouseButtonDown = false;
    let keyboardToolUseDown = false;
    const isMouseToolBound = () => keyBindings.useTool === 'MouseLeft';
    const isToolUseHeld = () => mouseButtonDown || keyboardToolUseDown;
    let nearbyDroppedItem = null;

    function mineStone() {
      if (state.gameState !== 'playing' || state.paused || uiState.inventoryOpen || uiState.craftingOpen || !settingsModal.classList.contains('hidden')) return false;
      if (miningStone) return false;
      const targetRock = findNearbyRock();
      if (!targetRock && !canMineStoneHere()) return false;
      const current = getCurrentToolSlot();
      if (!current || !isPickaxe(current.item.id)) return false;
      if (isDrill(current.item.id) && current.slot.durability <= 0) {
        const prompt = document.getElementById('crystalPrompt');
        prompt.classList.remove('hidden');
        prompt.innerHTML = '<span class="promptKey">EMPTY</span> Drill needs fuel';
        return false;
      }
      if (targetRock && (targetRock.oreType === 'iron_ore' || targetRock.oreType === 'copper_ore' || targetRock.oreType === 'titanium_ore') && current.item.id !== 'stone_pickaxe' && current.item.id !== 'iron_pickaxe' && !isDrill(current.item.id)) {
        const prompt = document.getElementById('crystalPrompt');
        prompt.classList.remove('hidden');
        if (targetRock.oreType === 'titanium_ore') prompt.innerHTML = '<span class="promptKey">LOCKED</span> Titanium Ore requires an Iron Pickaxe or Drill';
        else prompt.innerHTML = '<span class="promptKey">LOCKED</span> ' + (targetRock.oreType === 'copper_ore' ? 'Copper Ore' : 'Iron Ore') + ' requires a Stone or Iron Pickaxe';
        return false;
      }
      const minedItemId = targetRock ? ((targetRock.oreType === 'iron_ore' || targetRock.oreType === 'copper_ore' || targetRock.oreType === 'titanium_ore') ? targetRock.oreType : 'stone') : 'stone';
      const reservedYield = targetRock && targetRock.oreType === 'titanium_ore' ? Math.max(1, Math.min(5, Number(targetRock.yieldCount) || 1)) : 1;
      if (!canAddItemToInventory(minedItemId, reservedYield)) {
        const prompt = document.getElementById('crystalPrompt');
        prompt.classList.remove('hidden');
        prompt.innerHTML = '<span class="promptKey">FULL</span> Not enough inventory space for ' + (minedItemId === 'iron_ore' ? 'Iron Ore' : (minedItemId === 'copper_ore' ? 'Copper Ore' : (minedItemId === 'titanium_ore' ? 'Titanium Ore' : 'Stone')));
        return false;
      }

      // Start the mining action without changing the inventory yet. The stone is only
      // awarded when the timer finishes successfully. This also means canceling a mine
      // can never accidentally consume or lose a stone.
      miningStone = true;
      miningRock = targetRock;
      miningStoneStartedAt = performance.now();
      nextPickaxeSoundAt = performance.now();
      triggerToolSwing(0.92, 260);
      const prompt = document.getElementById('crystalPrompt');
      prompt.classList.remove('hidden');
      const targetName = targetRock && targetRock.oreType === 'iron_ore' ? 'Iron Ore' : (targetRock && targetRock.oreType === 'copper_ore' ? 'Copper Ore' : (targetRock && targetRock.oreType === 'titanium_ore' ? 'Titanium Deposit' : (targetRock ? 'Boulder' : 'Stone')));
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
      const valid = state.gameState === 'playing' && !state.paused && !uiState.inventoryOpen && !uiState.craftingOpen && settingsModal.classList.contains('hidden') && isToolUseHeld() && uiState.equippedItemType === 'iron_pickaxe' && target && pad && target.root.visible;
      systemState.breakingSpaceObject = false;
      systemState.breakingSpaceObjectStartedAt = 0;
      systemState.breakingSpaceObjectTarget = null;
      systemState.breakingSpaceObjectType = null;
      if (!valid) {
        if (prompt) { prompt.classList.remove('hidden'); prompt.textContent = 'Breaking canceled'; setTimeout(() => { if (state.gameState === 'playing') updateCrystalPrompt(); }, 500); }
        return;
      }
      addItemToInventory(type, 1, null, true);
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
        furnace.root.visible && findNearbyFurnace() === furnace && isToolUseHeld() &&
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

      addItemToInventory('furnace', 1, null, true);
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
        settingsModal.classList.contains('hidden') && isToolUseHeld() && (validRock || validTerrain);
      const prompt = document.getElementById('crystalPrompt');
      if (!valid) {
        prompt.classList.remove('hidden');
        prompt.textContent = 'Mining canceled';
        miningRock = null;
        setTimeout(() => { if (state.gameState === 'playing') updateCrystalPrompt(); }, 500);
        return;
      }

      const tool = getCurrentToolSlot();
      const tungstenBlocked = targetRock && targetRock.oreType === 'tungsten_ore' && tool.item.id !== 'iron_pickaxe' && !isDrill(tool.item.id);
      const titaniumBlocked = targetRock && targetRock.oreType === 'titanium_ore' && tool.item.id !== 'iron_pickaxe' && !isDrill(tool.item.id);
      const baseOreBlocked = targetRock && (targetRock.oreType === 'iron_ore' || targetRock.oreType === 'copper_ore') && tool.item.id !== 'stone_pickaxe' && tool.item.id !== 'iron_pickaxe' && !isDrill(tool.item.id);
      if (!tool || !isPickaxe(tool.item.id) || tungstenBlocked || titaniumBlocked || baseOreBlocked) {
        prompt.classList.remove('hidden');
        prompt.textContent = 'Mining canceled';
        miningRock = null;
        setTimeout(() => { if (state.gameState === 'playing') updateCrystalPrompt(); }, 500);
        return;
      }

      const minedItemId = targetRock ? ((targetRock.oreType === 'iron_ore' || targetRock.oreType === 'copper_ore' || targetRock.oreType === 'tungsten_ore' || targetRock.oreType === 'titanium_ore') ? targetRock.oreType : 'stone') : 'stone';
      const minedItemName = minedItemId === 'iron_ore' ? 'Iron Ore' : (minedItemId === 'copper_ore' ? 'Copper Ore' : (minedItemId === 'tungsten_ore' ? 'Tungsten Ore' : (minedItemId === 'titanium_ore' ? 'Titanium Ore' : 'Stone')));

      // Put the reserved resource into the inventory only after the mining action succeeds.
      const miningYield = (targetRock && targetRock.oreType === 'titanium_ore') ? Math.max(1, Math.min(5, Number(targetRock.yieldCount) || 1)) : 1;
      if (!canAddItemToInventory(minedItemId, miningYield) || !addItemToInventory(minedItemId, miningYield, null, true)) {
        prompt.classList.remove('hidden');
        prompt.textContent = 'Inventory full — ' + minedItemName + ' was not collected';
        setTimeout(() => { if (state.gameState === 'playing') updateCrystalPrompt(); }, 700);
        return;
      }
      if (targetRock) {
        spawnImpactParticles(getParticleWorldPosition(targetRock.root, 0.18), minedItemId === 'iron_ore' ? 0x7f8791 : (minedItemId === 'copper_ore' ? 0xc86b32 : (minedItemId === 'titanium_ore' ? 0x9ba7b5 : 0x8d8d8d)), { count: 16, life: 0.55, speed: 2.5, size: 0.075, gravity: 5.5 });
      }
      if (minedItemId === 'iron_ore') {
        accountAchievementProgress.ironMined += 1;
        persistAchievementState();
        if (accountAchievementProgress.ironMined >= 20) awardAchievement('iron_20');
        targetRock.mined = true;
        targetRock.root.visible = false;
        miningRock = null;
      }

      if (minedItemId === 'stone') {
        accountAchievementProgress.stoneMined += 1;
        persistAchievementState();
        if (accountAchievementProgress.stoneMined >= 20) awardAchievement('stone_20');
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
        prompt.innerHTML = '<span class="promptKey">+' + miningYield + '</span> ' + minedItemName + ' collected · Pickaxe ' + durability + '/' + getToolMaxDurability(current.item);
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
        const fuel = flightPad ? Math.round(getRocketFuelPercent(flightPad)) : 0;
        if (playerState.rocketLanded) {
          const onMoon = !!(moonLandedRocket && flightRocket === moonLandedRocket && flightRocket.root.parent === moonMesh);
          const onCordelia = !!(cordeliaLandedRocket && flightRocket === cordeliaLandedRocket && flightRocket.root.parent === cordeliaMesh);
          const place = onMoon ? 'the Moon' : (onCordelia ? 'Cordelia' : 'Ivis launch pad');
          prompt.innerHTML = '<span class="promptKey">E</span> Exit spaceship · Landed on ' + place + ' · Fuel ' + fuel + '%';
        } else {
          prompt.innerHTML = 'WASD Move · <span class="promptKey">SPACE</span> Up · <span class="promptKey">SHIFT</span> Down · Fuel ' + fuel + '%';
        }
        return;
      }

      if (omegaWalkingBodyId) {
        if (!uiState.equippedItemType && omegaLandedRocket && flightRocket === omegaLandedRocket) {
          const playerWorld = player.getWorldPosition(new THREE.Vector3());
          const rocketWorld = omegaLandedRocket.root.getWorldPosition(new THREE.Vector3());
          if (playerWorld.distanceTo(rocketWorld) <= 4.2) {
            prompt.classList.remove('hidden');
            const fuel = Math.round(getRocketFuelPercent(omegaLandingPad || null));
            prompt.innerHTML = '<span class="promptKey">E</span> Enter spaceship · ' + (omegaWalkingBodyId === 'aurora' ? 'Aurora' : 'Mileria') + ' base · Fuel ' + fuel + '%' + (!uiState.equippedItemType ? '<br><span class="promptKey">RMB</span> Manage ship upgrades' : '');
            return;
          }
        }
      }
      if (moonWalking || cordeliaWalking) {
        const activeRocket = moonWalking ? moonLandedRocket : cordeliaLandedRocket;
        const activePad = moonWalking ? moonLandingPad : cordeliaLandingPad;
        if (!uiState.equippedItemType && activeRocket && flightRocket === activeRocket) {
          const playerWorld = player.getWorldPosition(new THREE.Vector3());
          const rocketWorld = activeRocket.root.getWorldPosition(new THREE.Vector3());
          if (playerWorld.distanceTo(rocketWorld) <= 4.2) {
            prompt.classList.remove('hidden');
            const fuel = Math.round(getRocketFuelPercent(activePad || null));
            prompt.innerHTML = '<span class="promptKey">E</span> Enter spaceship · ' + (moonWalking ? 'Moon' : 'Cordelia') + ' base · Fuel ' + fuel + '%' + (!uiState.equippedItemType ? '<br><span class="promptKey">RMB</span> Manage ship upgrades' : '');
            return;
          }
        }
        // Otherwise continue into the normal interaction search so crystals, rocks, dropped
        // items, and other surface resources remain usable on the Moon/Cordelia.
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
        if (fuel > 0) prompt.innerHTML = '<span class="promptKey">E</span> Enter spaceship · Fuel ' + fuel + (!uiState.equippedItemType ? '%<br><span class="promptKey">RMB</span> Manage ship upgrades' : '%');
        else prompt.innerHTML = 'Rocket empty · Fill it with a jerrycan first' + (!uiState.equippedItemType ? '<br><span class="promptKey">RMB</span> Manage ship upgrades' : '');
        return;
      }

      const nearbyMerchant = findNearbyMerchant();
      const nearbyHatMerchant = findNearbyHatMerchant();
      if (nearbyMerchant || nearbyHatMerchant) {
        const crystalWorld = nearbyMerchant ? nearbyMerchant.getWorldPosition(new THREE.Vector3()) : null;
        const hatWorld = nearbyHatMerchant ? nearbyHatMerchant.getWorldPosition(new THREE.Vector3()) : null;
        const playerWorld = player.getWorldPosition(new THREE.Vector3());
        const crystalDist = crystalWorld ? playerWorld.distanceTo(crystalWorld) : Infinity;
        const hatDist = hatWorld ? playerWorld.distanceTo(hatWorld) : Infinity;
        prompt.classList.remove('hidden');
        if (hatDist < crystalDist) prompt.innerHTML = '<span class="promptKey">E</span> Open Hat Shop';
        else prompt.innerHTML = '<span class="promptKey">E</span> Talk to Merchant';
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

      const nearbyUpgradeableRocket = findNearbyUpgradeableRocket();
      if (nearbyUpgradeableRocket && uiState.equippedItemType === 'warp_drive_mk2') {
        prompt.classList.remove('hidden');
        const hasMk1 = !!(nearbyUpgradeableRocket.warpDrive || nearbyUpgradeableRocket.pad?.warpDrive);
        const isMk2 = (nearbyUpgradeableRocket.warpDriveType === 'mk2' || nearbyUpgradeableRocket.pad?.warpDriveType === 'mk2');
        prompt.innerHTML = isMk2 ? '<span class="promptKey">INSTALLED</span> Warp Drive Mark 2 already installed' : '<span class="promptKey">E</span> Install Warp Drive Mark 2 · Rainbow Opal · Titanium Wrench';
        return;
      }
      if (nearbyUpgradeableRocket && uiState.equippedItemType === 'warp_drive') {
        prompt.classList.remove('hidden');
        prompt.innerHTML = (nearbyUpgradeableRocket.warpDrive || nearbyUpgradeableRocket.pad?.warpDrive) ? '<span class="promptKey">INSTALLED</span> Warp Drive already installed' : '<span class="promptKey">E</span> Install Warp Drive · Iron Wrench';
        return;
      }
      if (nearbyUpgradeableRocket && uiState.equippedItemType === 'engine_mark_3') {
        prompt.classList.remove('hidden');
        const hasMk2 = nearbyUpgradeableRocket.engineType === 'upgraded' || nearbyUpgradeableRocket.pad?.engineType === 'upgraded';
        const isMk3 = nearbyUpgradeableRocket.engineType === 'mark3' || nearbyUpgradeableRocket.pad?.engineType === 'mark3';
        prompt.innerHTML = isMk3 ? '<span class="promptKey">INSTALLED</span> Engine Mark 3 already installed' : '<span class="promptKey">E</span> Install Engine Mark 3 · Titanium Wrench';
        return;
      }
      if (nearbyUpgradeableRocket && uiState.equippedItemType === 'upgraded_engine') {
        prompt.classList.remove('hidden');
        prompt.innerHTML = nearbyUpgradeableRocket.engineType === 'mark3' ? '<span class="promptKey">MARK 3</span> Rocket already upgraded' : nearbyUpgradeableRocket.engineType === 'upgraded' ? '<span class="promptKey">MARK 2</span> Engine Mark 2 already installed' : '<span class="promptKey">E</span> Install Engine Mark 2 · Iron Wrench · 200% fuel capacity';
        return;
      }
      if (nearbyRock && nearbyRock.oreType === 'titanium_ore' && isPickaxe(uiState.equippedItemType)) {
        prompt.classList.remove('hidden');
        const canMineTitanium = uiState.equippedItemType === 'iron_pickaxe' || uiState.equippedItemType === 'drill';
        prompt.innerHTML = canMineTitanium ? '<span class="promptKey">LMB</span> Mine Titanium Deposit · up to ' + nearbyRock.yieldCount + ' Titanium Ore' : '<span class="promptKey">IRON</span> Need an Iron Pickaxe or Drill';
        return;
      }
      const nearbyTungsten=findNearbyTungsten();
      if (nearbyTungsten && isPickaxe(uiState.equippedItemType)) {
        prompt.classList.remove('hidden');
        const canMineTungsten = uiState.equippedItemType==='iron_pickaxe' || uiState.equippedItemType==='drill';
        prompt.innerHTML = canMineTungsten ? '<span class="promptKey">LMB</span> Mine Tungsten Ore' : '<span class="promptKey">IRON</span> Need an Iron Pickaxe or Drill';
        return;
      }
      nearbyMoonQuartz = findNearbyMoonQuartz();
      if (nearbyMoonQuartz && uiState.equippedItemType !== 'upgraded_engine') {
        prompt.classList.remove('hidden');
        prompt.innerHTML = '<span class="promptKey">E</span> Collect Moon Quartz';
        return;
      }
      let nearestDistanceSq = Infinity;
      const playerCrystalWorld = player.getWorldPosition(new THREE.Vector3());
      const allCrystalSpawns = crystalSpawns.concat(cordeliaCrystalSpawns, auroraCrystalSpawns);
      for (const spawn of allCrystalSpawns) {
        if (spawn.collected || !spawn.root.visible) continue;
        const crystalWorld = spawn.root.getWorldPosition(new THREE.Vector3());
        const distanceSq = playerCrystalWorld.distanceToSquared(crystalWorld);
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

      if (scytheCutting) {
        const elapsed = performance.now() - scytheCuttingStartedAt;
        const pct = Math.max(0, Math.min(100, (elapsed / SCYTHE_CUT_TIME) * 100));
        prompt.classList.remove('hidden');
        prompt.innerHTML = '<span class="promptKey">' + Math.round(pct) + '%</span> Cutting grass…';
        return;
      }

      if (isScythe(uiState.equippedItemType)) {
        const grass = findNearbyGrass();
        const current = getCurrentToolSlot();
        const durability = current ? current.slot.durability : getToolMaxDurability(uiState.equippedItemType);
        if (grass) {
          prompt.classList.remove('hidden');
          prompt.innerHTML = '<span class="promptKey">LMB</span> Cut grass for 3 Grass Fibers · ' + durability + '/' + getToolMaxDurability(uiState.equippedItemType);
          return;
        }
      }

      if (choppingTree) {
        const elapsed = performance.now() - choppingTreeStartedAt;
        const pct = Math.max(0, Math.min(100, (elapsed / getTreeChopTimeForTool()) * 100));
        const activeTree = choppingTreeTarget;
        const yieldCount = activeTree ? Math.round(activeTree.size * 4) : 0;
        prompt.classList.remove('hidden');
        prompt.innerHTML = '<span class="promptKey">' + Math.round(pct) + '%</span> Chopping Tree for ' + yieldCount + ' Planks…';
        return;
      }

      nearbyTree = findNearbyTree();
      if (nearbyTree && (uiState.equippedItemType === 'axe' || uiState.equippedItemType === 'wooden_axe' || uiState.equippedItemType === 'stone_axe' || uiState.equippedItemType === 'iron_axe' || isDrill(uiState.equippedItemType))) {
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
        const miningTime = getMiningTimeForTool(uiState.equippedItemType, miningRock);
        const pct = Math.max(0, Math.min(100, (elapsed / miningTime) * 100));
        prompt.classList.remove('hidden');
        const miningName = miningRock && miningRock.oreType === 'iron_ore' ? 'Iron Ore' : (miningRock && miningRock.oreType === 'copper_ore' ? 'Copper Ore' : (miningRock && miningRock.oreType === 'titanium_ore' ? 'Titanium Deposit' : (miningRock ? 'Boulder' : 'Stone')));
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
        const cap = getRocketFuelCapacity(nearbyPad);
        const pct = Math.round(getRocketFuelPercent(nearbyPad));
        if ((nearbyPad.fuel || 0) >= cap) prompt.innerHTML = '<span class="promptKey">FULL</span> Rocket fuel: 100% · Remove jerrycan to enter';
        else prompt.innerHTML = '<span class="promptKey">E</span> Fuel Rocket · ' + pct + '% (+' + Math.round(100 / cap * 100) + '%)';
        return;
      }
      if (nearbyPad && nearbyPad.rocket) {
        prompt.classList.remove('hidden');
        prompt.innerHTML = '<span class="promptKey">E</span> Enter Spaceship · Fuel ' + Math.round(getRocketFuelPercent(nearbyPad)) + '%';
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
        const rockName = nearbyRock.oreType === 'iron_ore' ? 'Iron Ore Boulder' : (nearbyRock.oreType === 'copper_ore' ? 'Copper Ore Boulder' : 'Boulder');
        const rewardName = nearbyRock.oreType === 'iron_ore' ? '1 Iron Ore' : (nearbyRock.oreType === 'copper_ore' ? '1 Copper Ore' : '1 Stone');
        prompt.classList.remove('hidden');
        if ((nearbyRock.oreType === 'iron_ore' || nearbyRock.oreType === 'copper_ore') && uiState.equippedItemType !== 'stone_pickaxe' && uiState.equippedItemType !== 'iron_pickaxe') {
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
      addItemToInventory(drop.typeId, drop.count, null, true);
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
      for (const spawn of crystalSpawns.concat(cordeliaCrystalSpawns)) {
        if (!spawn.collected) continue;
        if (state.planetSpinAngle >= spawn.respawnAtSpin) {
          spawn.collected = false;
          spawn.crystal.visible = true;
          spawn.ghost.visible = false;
          spawn.respawnAtSpin = 0;
        }
      }
      for (const spawn of moonQuartzSpawns) {
        if (!spawn.collected) continue;
        if (state.planetSpinAngle >= spawn.respawnAtSpin) {
          spawn.collected = false;
          spawn.visual.visible = true;
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
      closeAchievements();
      if (playerState.inRocket) exitRocketFlight(true);
      // Keep an automatic browser backup before resetting the live world. The portable JSON
      // save is still created with the Save Game button.
      try { persistLocalBackup(); } catch (e) {}
      state.paused = false;
      uiState.craftingOpen = false;
      uiState.shipInventoryOpen = false;
      const shipInventoryOverlay = document.getElementById('shipInventoryOverlay');
      if (shipInventoryOverlay) { shipInventoryOverlay.classList.add('hidden'); shipInventoryOverlay.setAttribute('aria-hidden', 'true'); }
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
      if (weatherControlOverlay) weatherControlOverlay.classList.add('hidden');
      if (weatherControlToggle) weatherControlToggle.classList.add('hidden');
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
      closeAchievements();
      state.gameMode = mode === 'freeplay' ? 'freeplay' : 'survival';
      updateInventoryActionButton();

      // Starting a new game always begins with the normal fresh-player state.
      resetPlayerState();
      // Freeplay is a sandbox, so the Journal opens as a complete encyclopedia.
      // Survival keeps the normal discovery-based progression.
      if (state.gameMode === 'freeplay') {
        journalDiscoveredItems = new Set(ITEM_TYPES.map(item => item.id));
        journalVisitedBodies = new Set(Object.keys(JOURNAL_BODY_INFO));
        journalMetPeople = new Set(Object.keys(JOURNAL_PERSON_INFO));
      }
      resetContinuousSurvivalAchievementRun();
      closeModeChooser();

      // pointer lock must be requested synchronously, right inside this real click
      // handler, or the browser will silently refuse it
      attemptPointerLock();

      state.gameState = "playing";
      recordCelestialBodyVisit('ivis');
      if (playerState.currentPlanetId === 'ivis' || !playerState.currentPlanetId) awardAchievement('spawn_ivis');
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
        if (!playerState.inRocket && !uiState.inventoryOpen && !uiState.freeplayInventoryOpen && !uiState.shipInventoryOpen && !uiState.containerOpen && !economyState.merchantOpen && (!weatherControlOverlay || weatherControlOverlay.classList.contains('hidden'))) pauseGame();
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
      if (state.gameState === 'playing' && !playerState.inRocket && uiState.equippedItemType === 'journal' && !uiState.craftingOpen && !uiState.furnaceOpen && !economyState.merchantOpen && !cosmeticShopOpen && !journalOpen) {
        e.preventDefault(); e.stopPropagation(); openJournal(false); return;
      }
      if (state.gameState === 'playing' && !playerState.inRocket && pickupNearbyDrill()) { e.preventDefault(); return; }
      if (state.gameState === 'playing' && !playerState.inRocket && uiState.equippedItemType === 'backpack' && !uiState.inventoryOpen && !uiState.craftingOpen && !uiState.furnaceOpen) {
        e.preventDefault();
        openBackpackStorage(inventorySlots[getSelectedHotbarInventoryIndex()]);
        return;
      }
      if (state.gameState === 'playing' && !playerState.inRocket && !uiState.equippedItemType && !uiState.inventoryOpen && !uiState.craftingOpen && !uiState.furnaceOpen && !uiState.shipInventoryOpen && !uiState.containerOpen) {
        const landedRocket = getNearbyLandedRocketForShipInventory();
        if (landedRocket) {
          e.preventDefault();
          openShipInventory(landedRocket.rocket, landedRocket.pad);
          return;
        }
      }
      if (state.gameState === 'playing' && !playerState.inRocket && !uiState.equippedItemType && !uiState.inventoryOpen && !uiState.craftingOpen && !uiState.furnaceOpen && !uiState.shipInventoryOpen && !uiState.containerOpen) {
        const container = findNearbyContainer();
        if (container) {
          e.preventDefault();
          openContainer(container);
          return;
        }
      }
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
      if (state.gameState === 'playing' && !playerState.inRocket && uiState.equippedItemType === 'journal' && !uiState.craftingOpen && !uiState.furnaceOpen && !economyState.merchantOpen && !cosmeticShopOpen && !journalOpen) {
        e.preventDefault(); e.stopPropagation(); openJournal(false); return;
      }
      if (state.gameState === 'playing' && !playerState.inRocket && pickupNearbyDrill()) { e.preventDefault(); return; }
      if (state.gameState === 'playing' && !playerState.inRocket && uiState.equippedItemType === 'backpack' && !uiState.inventoryOpen && !uiState.craftingOpen && !uiState.furnaceOpen) {
        e.preventDefault();
        openBackpackStorage(inventorySlots[getSelectedHotbarInventoryIndex()]);
        return;
      }
      if (state.gameState === 'playing' && !playerState.inRocket && !uiState.equippedItemType && !uiState.inventoryOpen && !uiState.craftingOpen && !uiState.furnaceOpen && !uiState.shipInventoryOpen && !uiState.containerOpen) {
        const landedRocket = getNearbyLandedRocketForShipInventory();
        if (landedRocket) {
          e.preventDefault();
          openShipInventory(landedRocket.rocket, landedRocket.pad);
          return;
        }
      }
      if (state.gameState === 'playing' && !playerState.inRocket && !uiState.equippedItemType && !uiState.inventoryOpen && !uiState.craftingOpen && !uiState.furnaceOpen && !uiState.shipInventoryOpen && !uiState.containerOpen) {
        const container = findNearbyContainer();
        if (container) {
          e.preventDefault();
          openContainer(container);
          return;
        }
      }
      if (state.gameState === 'playing' && !playerState.inRocket && !uiState.inventoryOpen && !uiState.craftingOpen && !uiState.furnaceOpen) {
        const furnace=findNearbyFurnace();
        if (furnace) { e.preventDefault(); openFurnace(furnace); return; }
      }
      if (uiState.furnaceOpen) e.preventDefault();
    });
    document.getElementById('containerClose').addEventListener('click', (e) => { e.stopPropagation(); closeContainer(); });
    document.getElementById('containerPanel').addEventListener('click', (e) => e.stopPropagation());
    document.getElementById('containerOverlay').addEventListener('click', (e) => { if (e.target === e.currentTarget) closeContainer(); });
    document.addEventListener('keydown', (e) => { if (uiState.containerOpen && e.key === 'Escape') { e.preventDefault(); closeContainer(); } });
    document.getElementById('shipInventoryClose').addEventListener('click', (e) => { e.stopPropagation(); closeShipInventory(); });
    document.getElementById('shipInventoryPanel').addEventListener('click', (e) => e.stopPropagation());
    document.getElementById('shipInventoryOverlay').addEventListener('click', (e) => {
      if (e.target === e.currentTarget) closeShipInventory();
    });
    document.addEventListener('keydown', (e) => {
      if (uiState.shipInventoryOpen && e.key === 'Escape') { e.preventDefault(); closeShipInventory(); }
    });

    // ---------- rebindable keyboard controls ----------
    // Bindings are shared across walking, planetary movement, and spaceship flight.
    // They persist locally so changing a key survives reloads without touching save data.
    const DEFAULT_KEY_BINDINGS = {
      moveForward: 'KeyW', moveLeft: 'KeyA', moveBackward: 'KeyS', moveRight: 'KeyD',
      sprint: 'ShiftLeft', jump: 'Space', toggleView: 'KeyC', flashlight: 'KeyF',
      interact: 'KeyE', drop: 'KeyQ', inventory: 'KeyI', slot1: 'Digit1', slot2: 'Digit2',
      slot3: 'Digit3', slot4: 'Digit4', map: 'KeyM', weather: 'KeyG', useTool: 'MouseLeft', pause: 'Escape'
    };
    const KEY_BINDING_STORAGE = 'pocketUniverseKeyBindings';
    let keyBindings = { ...DEFAULT_KEY_BINDINGS };
    try {
      const stored = JSON.parse(localStorage.getItem(KEY_BINDING_STORAGE) || '{}');
      if (stored && typeof stored === 'object') {
        for (const action of Object.keys(DEFAULT_KEY_BINDINGS)) {
          if (typeof stored[action] === 'string' && stored[action]) keyBindings[action] = stored[action];
        }
      }
    } catch (err) { console.warn('Could not load key bindings', err); }

    const KEY_BINDING_LABELS = {
      moveForward: 'Move forward', moveLeft: 'Move left', moveBackward: 'Move backward', moveRight: 'Move right',
      sprint: 'Sprint / ship down', jump: 'Jump / ship up', toggleView: 'Toggle view', flashlight: 'Flashlight',
      interact: 'Interact / collect / enter-exit', drop: 'Drop item', inventory: 'Inventory',
      slot1: 'Hotbar slot 1', slot2: 'Hotbar slot 2', slot3: 'Hotbar slot 3', slot4: 'Hotbar slot 4',
      map: 'Open map', weather: 'Weather menu (Freeplay)', useTool: 'Chop / use tool', pause: 'Pause menu'
    };
    const getBoundCodes = (action) => {
      const code = keyBindings[action];
      return code ? [code] : [];
    };
    const isKeyBoundTo = (code, action) => keyBindings[action] === code;
    const isActionDown = (action) => getBoundCodes(action).some(code => !!physicalKeys[code] || !!systemState.keys[code]);
    const isActionEvent = (event, action) => isKeyBoundTo(event.code, action);
    const allBoundCodes = () => new Set(Object.values(keyBindings));
    const prettyKeyCode = (code) => {
      const names = { Space: 'Space', Escape: 'Esc', ShiftLeft: 'Shift', ShiftRight: 'Shift', ControlLeft: 'Ctrl', ControlRight: 'Ctrl',
        AltLeft: 'Alt', AltRight: 'Alt', Tab: 'Tab', MouseLeft: 'LMB', Enter: 'Enter', Backspace: 'Backspace', Delete: 'Delete',
        ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→', NumpadDecimal: 'Num .', NumpadAdd: 'Num +',
        NumpadSubtract: 'Num −', NumpadMultiply: 'Num ×', NumpadDivide: 'Num ÷', CapsLock: 'Caps Lock',
        Backquote: '`', Minus: '-', Equal: '=', BracketLeft: '[', BracketRight: ']', Backslash: '\\\\',
        Semicolon: ';', Quote: "'", Comma: ',', Period: '.', Slash: '/', Pause: 'Pause', Insert: 'Insert', Home: 'Home', End: 'End', PageUp: 'PgUp', PageDown: 'PgDn'
      };
      if (names[code]) return names[code];
      if (/^Key[A-Z]$/.test(code)) return code.slice(3);
      if (/^Digit[0-9]$/.test(code)) return code.slice(5);
      if (/^Numpad[0-9]$/.test(code)) return 'Num ' + code.slice(6);
      if (/^F([1-9]|1[0-2])$/.test(code)) return code;
      return code.replace(/^Numpad/, 'Num ').replace(/^Intl/, 'Intl ');
    };
    let activeRebindAction = null;
    const rebindStatus = document.getElementById('rebindStatus');
    function saveKeyBindings() { localStorage.setItem(KEY_BINDING_STORAGE, JSON.stringify(keyBindings)); }
    function renderKeyBindings() {
      document.querySelectorAll('.rebindKey').forEach((button) => {
        const action = button.dataset.bind;
        if (!action || !keyBindings[action]) return;
        button.textContent = prettyKeyCode(keyBindings[action]);
        button.classList.toggle('rebinding', activeRebindAction === action);
      });
      if (rebindStatus) {
        rebindStatus.textContent = activeRebindAction
          ? `Press a key for ${KEY_BINDING_LABELS[activeRebindAction] || 'this action'}… Press Esc to cancel.`
          : 'Click a key, then press the new keyboard key. Click again to cancel.';
      }
    }
    function beginKeyRebind(action) {
      if (!keyBindings[action]) return;
      if (activeRebindAction === action) { activeRebindAction = null; renderKeyBindings(); return; }
      activeRebindAction = action;
      if (document.pointerLockElement === canvas) document.exitPointerLock();
      clearPhysicalKeys();
      for (const k in systemState.keys) systemState.keys[k] = false;
      renderKeyBindings();
    }
    function finishKeyRebind(code) {
      if (!activeRebindAction || !code) return;
      const action = activeRebindAction;
      if (code === 'Escape') { activeRebindAction = null; renderKeyBindings(); return; }
      // Keep one clean binding per action: if the chosen key is already assigned,
      // swap the two actions rather than creating an invisible conflict.
      const oldCode = keyBindings[action];
      const otherAction = Object.keys(keyBindings).find(a => a !== action && keyBindings[a] === code);
      keyBindings[action] = code;
      if (otherAction) keyBindings[otherAction] = oldCode;
      saveKeyBindings();
      // Refresh the preventDefault set so newly chosen keys behave exactly like the originals.
      GAME_KEYS.clear();
      for (const code of allBoundCodes()) if (code !== 'MouseLeft') GAME_KEYS.add(code);
      ['ArrowUp','ArrowDown','ArrowLeft','ArrowRight','ShiftRight'].forEach(code => GAME_KEYS.add(code));
      activeRebindAction = null;
      clearPhysicalKeys();
      for (const k in systemState.keys) systemState.keys[k] = false;
      renderKeyBindings();
    }
    document.querySelectorAll('.rebindKey').forEach((button) => {
      button.addEventListener('click', (e) => { e.stopPropagation(); beginKeyRebind(button.dataset.bind); });
    });
    renderKeyBindings();

    // ---------- keyboard input ----------
    // Keep a dedicated physical-key map as a safety net. The gameplay state can be
    // cleared when opening/closing UI, so movement keys are read from this map first.
    const physicalKeys = Object.create(null);
    const isPhysicalKeyDown = (code) => !!physicalKeys[code] || !!systemState.keys[code];
    const clearPhysicalKeys = () => { for (const k in physicalKeys) physicalKeys[k] = false; };

    // Keyboard state is shared through systemState.
    const GAME_KEYS = new Set([
      ...[...allBoundCodes()].filter(code => code !== 'MouseLeft'),
      "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight",
      "ShiftRight"
    ]);

    window.addEventListener("keydown", (e) => {
      // Let text fields behave like normal form controls. The gameplay key handler
      // below calls preventDefault() for movement/action keys, which would otherwise
      // swallow letters while typing into the account form (W/A/S/D/etc.).
      const editableTarget = e.target && (
        e.target.matches?.("input, textarea, select") ||
        e.target.isContentEditable
      );
      if (editableTarget) {
        if (e.key === "Escape") {
          if (!accountModal.classList.contains("hidden")) {
            e.preventDefault();
            closeAccount();
          }
        }
        return;
      }

      if (activeRebindAction && !settingsModal.classList.contains('hidden')) {
        e.preventDefault();
        e.stopPropagation();
        if (!e.repeat) finishKeyRebind(e.code);
        return;
      }

      physicalKeys[e.code] = true;
      if (isActionEvent(e, 'interact') && !e.repeat && state.gameState === "playing" && !state.paused && settingsModal.classList.contains("hidden") && playerState.inRocket) {
        e.preventDefault();
        exitRocketFlight(false);
        return;
      }

      if (isActionEvent(e, 'interact') && !e.repeat && state.gameState === "playing" && !state.paused && !uiState.inventoryOpen && !economyState.merchantOpen && settingsModal.classList.contains("hidden")) {
        e.preventDefault();
        if (openMerchant()) return;
        if (openNearbyHatShop()) return;
        if (tryInstallEngineMark3NearbyRocket()) return;
        if (tryUpgradeNearbyRocket()) return;
        if (tryInstallWarpDriveMark2NearbyRocket()) return;
        if (tryInstallWarpDriveNearbyRocket()) return;
        if (startRocketFueling()) return;
        if (startDrillRefueling()) return;
        // On Moon/Cordelia, only allow re-entry when the player is actually beside the landed
        // rocket. Previously enterRocket() could fall back to the landed rocket reference even
        // when the player was standing near a crystal, causing E to teleport them back inside.
        const canEnterSurfaceRocket = (moonWalking || cordeliaWalking) && isNearLandedSurfaceRocket();
        if (!uiState.equippedItemType && (!moonWalking && !cordeliaWalking || canEnterSurfaceRocket) && enterRocket()) return;
        if (uiState.equippedItemType === 'furnace' && tryPlaceFurnace()) return;
        if (uiState.equippedItemType === 'drill' && tryPlaceDrill()) return;
        if (uiState.equippedItemType === 'launch_pad' && tryPlaceLaunchPad()) return;
        if (uiState.equippedItemType === 'container' && tryPlaceContainer()) return;
        if (uiState.equippedItemType === 'rocket' && tryPlaceRocketOnNearbyPad()) return;
        if (tryPickupNearbyDroppedItem()) return;
        if (tryCollectNearbyMoonQuartz()) return;
        tryCollectNearbyCrystal();
        return;
      }

      if (isActionEvent(e, 'weather') && !e.repeat && state.gameState === "playing" && !state.paused && settingsModal.classList.contains("hidden")) {
        const inCreative = state.gameMode === 'freeplay' || state.gameMode === 'creative';
        if (inCreative && !playerState.inRocket) {
          e.preventDefault();
          toggleWeatherControlMenu();
          return;
        }
      }

      if (isActionEvent(e, 'drop') && !e.repeat && state.gameState === "playing") {
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

      if (isActionEvent(e, 'inventory') && !e.repeat && state.gameState === "playing" && settingsModal.classList.contains("hidden")) {
        if (playerState.inRocket) return;
        e.preventDefault();
        toggleInventory();
        return;
      }

      if (isActionEvent(e, 'slot1') || isActionEvent(e, 'slot2') || isActionEvent(e, 'slot3') || isActionEvent(e, 'slot4')) {
        if (playerState.inRocket) return;
        if (state.gameState === "playing" && !uiState.inventoryOpen && settingsModal.classList.contains("hidden")) {
          e.preventDefault();
          selectHotbarSlot(isActionEvent(e, 'slot1') ? 0 : isActionEvent(e, 'slot2') ? 1 : isActionEvent(e, 'slot3') ? 2 : 3);
        }
        return;
      }

      if (isActionEvent(e, 'useTool') && !e.repeat && state.gameState === 'playing' && settingsModal.classList.contains('hidden')) {
        e.preventDefault();
        keyboardToolUseDown = true;
        startPrimaryToolAction();
        return;
      }

      if (isActionEvent(e, 'map') && !e.repeat && state.gameState === "playing" && settingsModal.classList.contains("hidden")) {
        e.preventDefault();
        if (playerState.inRocket && playerState.rocketInSpace && !playerState.rocketLanded) toggleSpaceMap();
        else togglePlanetMap();
        return;
      }

      if (isActionEvent(e, 'pause')) {
        if (spaceMapOpen) { closeSpaceMap(); return; }
        if (mapOpen) {
          closePlanetMap();
          return;
        }
        if (economyState.merchantOpen) {
          closeMerchant();
          return;
        }
        if (cosmeticShopOpen) {
          closeCosmeticShop();
          return;
        }
        if (!modeChooser.classList.contains('hidden')) {
          closeModeChooser();
          return;
        }
        if (uiState.shipInventoryOpen) {
          closeShipInventory();
          return;
        }
        if (uiState.containerOpen) {
          closeContainer();
          return;
        }
        if (uiState.craftingOpen) {
          closeCrafting();
          return;
        }
        if (uiState.freeplayInventoryOpen) {
          closeFreeplayInventory();
          return;
        }
        if (uiState.inventoryOpen) {
          if (backpackOpen) { closeBackpackStorage(); return; }
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
      if (isActionEvent(e, 'toggleView') && !e.repeat && state.gameState === "playing") {
        if (!playerState.inRocket) toggleThirdPerson();
      }
      if (isActionEvent(e, 'flashlight') && !e.repeat && state.gameState === "playing" && settingsModal.classList.contains("hidden")) {
        if (playerState.inRocket) return;
        setFlashlight(!playerState.flashlightOn);
      }
    });
    window.addEventListener("keyup", (e) => {
      if (GAME_KEYS.has(e.code)) e.preventDefault();
      physicalKeys[e.code] = false;
      systemState.keys[e.code] = false;
      if (isActionEvent(e, 'useTool')) keyboardToolUseDown = false;
    });
    window.addEventListener("blur", () => {
      clearPhysicalKeys();
      for (const k in systemState.keys) systemState.keys[k] = false;
      clearPhysicalKeys();
    });

    window.addEventListener('pointerdown', (e) => {
      if (!activeRebindAction || settingsModal.classList.contains('hidden')) return;
      if (e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();
      keyBindings[activeRebindAction] = 'MouseLeft';
      saveKeyBindings();
      GAME_KEYS.delete('MouseLeft');
      activeRebindAction = null;
      clearPhysicalKeys();
      for (const k in systemState.keys) systemState.keys[k] = false;
      renderKeyBindings();
    }, true);

    // ---------- main-menu planet rotation ----------
    // The menu buttons/overlay are drawn on top of the Three.js canvas, so listening
    // for mousedown directly on the canvas is unreliable: the canvas often never
    // receives the event. Instead, we listen at the window level so dragging works
    // even when the cursor starts over the visible menu area.
    window.addEventListener("pointerdown", (e) => {
      if (state.gameState !== "menu" || e.button !== 0) return;

      // Do not start rotating when the player is clicking a menu button or control.
      if (e.target.closest && e.target.closest("button, input, textarea, select, a, #controlsToggle, #settingsModal, #accountModal, #achievementsModal, #homeButtons, #modeChooser, #pauseOverlay")) return;

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

    // ---------- primary tool action ----------
    // Left-click is the default binding, but the same action can be rebound to any keyboard key.
    function startPrimaryToolAction() {
      if (state.gameState !== 'playing' || playerState.inRocket || uiState.inventoryOpen || !settingsModal.classList.contains('hidden')) return false;
      if (uiState.equippedItemType === 'drill') {
        if (breakNearbyFurnace()) return true;
        if (findNearbyRock()) { mineStone(); return true; }
        if (findNearbyTree()) { chopNearbyTree(); return true; }
        return mineStone();
      }
      if (uiState.equippedItemType === 'wooden_pickaxe' || uiState.equippedItemType === 'stone_pickaxe' || uiState.equippedItemType === 'iron_pickaxe') {
        if (uiState.equippedItemType === 'iron_pickaxe' && breakNearbySpaceObject()) return true;
        return breakNearbyFurnace() || mineStone();
      }
      if (uiState.equippedItemType === 'axe' || uiState.equippedItemType === 'wooden_axe' || uiState.equippedItemType === 'stone_axe' || uiState.equippedItemType === 'iron_axe') {
        return chopNearbyTree();
      }
      if (isScythe(uiState.equippedItemType)) return cutNearbyGrass();
      return false;
    }

    let isDragging = false;

    canvas.addEventListener("mousedown", (e) => {
      if (state.gameState === "playing" && e.button === 0) {
        isDragging = true;
        if (playerState.inRocket) { mouseButtonDown = false; return; }
        mouseButtonDown = isMouseToolBound();
        if (mouseButtonDown) startPrimaryToolAction();
      }
    });
    window.addEventListener("mouseup", (e) => {
      if (e.button === 0 || e.button === undefined) {
        isDragging = false;
        mouseButtonDown = false;
        keyboardToolUseDown = false;
        if (choppingTree || miningStone || scytheCutting) {
          choppingTree = false;
          choppingTreeStartedAt = 0;
          choppingTreeTarget = null;
          nextChopSoundAt = 0;
          miningStone = false;
          miningStoneStartedAt = 0;
          miningRock = null;
          nextPickaxeSoundAt = 0;
          scytheCutting = false;
          scytheCuttingStartedAt = 0;
          scytheCuttingTarget = null;
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
      keyboardToolUseDown = false;
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
        // First-person yaw must behave exactly like Ivis on every spherical body.
        //
        // Ivis uses the player's current surface normal as the yaw axis. Moon/Cordelia are
        // also represented in their own local planet space, so their surface normal is the
        // correct axis too. The important difference is quaternion order: the yaw is a
        // rotation in the CURRENT PLANET/LOCAL frame, so it must be pre-multiplied onto the
        // player's orientation. Post-multiplying it rotates around the player's own local
        // axis and can cause the camera to reverse or become effectively locked at certain
        // latitudes/longitudes as the surface orientation changes.
        if (moonWalking || cordeliaWalking) {
          const activeSurfaceUp = player.position.clone().normalize();
          const yawQuat = new THREE.Quaternion().setFromAxisAngle(activeSurfaceUp, -dx);
          orientation.premultiply(yawQuat);
        } else {
          const yawQuat = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), -dx);
          orientation.multiply(yawQuat);
        }
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
    const cordeliaCollisionCenter = new THREE.Vector3();
    const cordeliaCollisionLocal = new THREE.Vector3();
    const cordeliaCollisionQuat = new THREE.Quaternion();
    const cordeliaCollisionInverse = new THREE.Quaternion();
    const collisionStallInverse = new THREE.Quaternion();
    const collisionTreeInverse = new THREE.Quaternion();
    const collisionTreeLocal = new THREE.Vector3();
    const collisionMeteorCenter = new THREE.Vector3();
    const collisionMeteorLocalPos = new THREE.Vector3();
    const collisionMeteorOffset = new THREE.Vector3();
    const collisionMeteorInverse = new THREE.Quaternion();
    const collisionMeteorLocal = new THREE.Vector3();
    const flightGravityCenter = new THREE.Vector3();

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

      // Stall collisions: both permanent stalls are solid.
      for (const stall of [crystalStall, hatStall]) {
        if (!stall || !stall.userData.collision) continue;
        collisionStallOffset.copy(localPosition).sub(stall.position);
        collisionStallInverse.copy(stall.quaternion).invert();
        collisionStallLocal.copy(collisionStallOffset).applyQuaternion(collisionStallInverse);

        const c = stall.userData.collision;
        if (Math.abs(collisionStallLocal.x) <= c.halfX + c.padding &&
            Math.abs(collisionStallLocal.z) <= c.halfZ + c.padding &&
            Math.abs(collisionStallLocal.y) < 3.0) {
          return true;
        }
      }

      // Meteor crash-site collision. Use the actual meteor transform and an ellipsoid
      // approximation so both the player and spaceship cannot walk/fly through the rock.
      if (meteorCrashSite?.meteor) {
        const meteorCenter = collisionMeteorCenter.copy(meteorCrashSite.root.position);
        meteorCenter.add(collisionMeteorLocalPos.copy(meteorCrashSite.meteor.position).applyQuaternion(meteorCrashSite.root.quaternion));
        collisionMeteorOffset.copy(localPosition).sub(meteorCenter);
        collisionMeteorInverse.copy(meteorCrashSite.root.quaternion).invert();
        collisionMeteorLocal.copy(collisionMeteorOffset).applyQuaternion(collisionMeteorInverse);
        collisionMeteorLocal.x /= 14.0;
        collisionMeteorLocal.y /= 8.6;
        collisionMeteorLocal.z /= 11.2;
        if (collisionMeteorLocal.lengthSq() < 1.0) return true;
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

    // Build movement from the actual gameplay camera so WASD always follows what the player
    // is looking at. This is deliberately world-space first, then converted into the active
    // planet's local space. That keeps the control scheme identical on Ivis, the Moon, and
    // Cordelia even when those bodies are rotated/orbited in world space.
    function getCameraRelativePlanetMove(inputX, inputZ, surfaceUpWorld, planetObject = null, out = new THREE.Vector3()) {
      const cameraForwardWorld = new THREE.Vector3();
      // In third person, movement must use the dedicated orbit heading rather than
      // camera.getWorldDirection(). The render camera is looked-at/lerped every frame,
      // so deriving movement from its current quaternion creates a tiny feedback loop
      // that makes straight movement visibly wobble left/right.
      if (playerState.thirdPerson) {
        // thirdPersonCameraForward is stored in the CURRENT CELESTIAL BODY'S
        // local tangent frame. The planet/moon itself can rotate in world space,
        // so convert that heading into world space before projecting it onto the
        // current surface. This keeps WASD aligned with the actual third-person
        // camera heading even while the celestial body is rotating beneath you.
        cameraForwardWorld.copy(thirdPersonCameraForward);
        if (planetObject) {
          cameraForwardWorld.applyQuaternion(planetObject.getWorldQuaternion(new THREE.Quaternion()));
        }
      } else {
        camera.getWorldDirection(cameraForwardWorld);
      }
      cameraForwardWorld.normalize();
      cameraForwardWorld.addScaledVector(surfaceUpWorld, -cameraForwardWorld.dot(surfaceUpWorld));
      if (cameraForwardWorld.lengthSq() < 0.00001) {
        cameraForwardWorld.set(0, 0, -1);
        cameraForwardWorld.addScaledVector(surfaceUpWorld, -cameraForwardWorld.dot(surfaceUpWorld));
      }
      cameraForwardWorld.normalize();

      const cameraRightWorld = new THREE.Vector3().crossVectors(cameraForwardWorld, surfaceUpWorld).normalize();
      out.copy(cameraRightWorld).multiplyScalar(inputX)
        .addScaledVector(cameraForwardWorld, -inputZ);
      out.addScaledVector(surfaceUpWorld, -out.dot(surfaceUpWorld));
      if (out.lengthSq() < 0.00001) return out.set(0, 0, 0);
      out.normalize();

      if (planetObject) {
        const invPlanetQuat = planetObject.getWorldQuaternion(new THREE.Quaternion()).invert();
        out.applyQuaternion(invPlanetQuat).normalize();
      }
      return out;
    }

    function getActiveWalkingSurfaceWorld(out = new THREE.Vector3()) {
      const playerWorld = player.getWorldPosition(new THREE.Vector3());
      let centerWorld;
      if (moonWalking) centerWorld = moonMesh.getWorldPosition(new THREE.Vector3());
      else if (cordeliaWalking) centerWorld = cordeliaMesh.getWorldPosition(new THREE.Vector3());
      else if (omegaWalkingBodyId) centerWorld = getOmegaBodyWorldPosition(omegaWalkingBodyId, new THREE.Vector3());
      else centerWorld = planetSystem.getWorldPosition(new THREE.Vector3());
      out.copy(playerWorld).sub(centerWorld);
      if (out.lengthSq() < 0.00001) out.set(0, 1, 0);
      return out.normalize();
    }

    function groundedForAudio(ps) {
      return ps.heightOffset <= 0.02 && Math.abs(ps.verticalVelocity) < 0.4;
    }

    function updatePlayer(delta) {
      let moveX = 0, moveZ = 0;
      if (isActionDown('moveForward')) moveZ -= 1;
      if (isActionDown('moveBackward')) moveZ += 1;
      if (isActionDown('moveLeft')) moveX -= 1;
      if (isActionDown('moveRight')) moveX += 1;

      const isMoving = (moveX !== 0 || moveZ !== 0);
      const shiftHeld = isActionDown('sprint');

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

      // Walking/sprinting uses the supplied nature-trail footsteps recording as a looping
      // movement bed. It stops immediately when the player stops or leaves the ground.
      const footstepActive = isMoving && groundedForAudio(playerState);
      if (footstepActive) {
        const sprintingNow = state.gameMode === 'freeplay'
          ? (shiftHeld && isMoving)
          : (shiftHeld && isMoving && !playerState.exhausted && playerState.stamina > 0);
        if (!footstepWasActive) playAudio('footsteps', sprintingNow ? 0.42 : 0.32, sprintingNow ? 1.10 : 1.0);
        setLoopAudioMode('footsteps', true, sprintingNow ? 0.42 : 0.32, sprintingNow ? 1.10 : 1.0);
      } else if (footstepWasActive) {
        stopAudio('footsteps');
      }
      footstepWasActive = footstepActive;

      if (isToolUseHeld() && isScythe(uiState.equippedItemType) && !scytheCutting) cutNearbyGrass();
      const nowAudio = performance.now();
      finishScytheCut();
      if (scytheCutting) {
        const elapsed = nowAudio - scytheCuttingStartedAt;
        if (elapsed >= SCYTHE_CUT_TIME) finishScytheCut();
      }
      if (choppingTree && nowAudio >= nextChopSoundAt) {
        triggerToolSwing(1.0, 300);
        triggerToolImpact(1.0);
        playAudio(isDrill(uiState.equippedItemType) ? 'drill' : 'chop', 0.56, 1.0 + Math.random() * 0.04 - 0.02, isDrill(uiState.equippedItemType) ? 520 : 0);
        nextChopSoundAt = nowAudio + (isDrill(uiState.equippedItemType) ? 560 : 1050);
      }
      if (miningStone && nowAudio >= nextPickaxeSoundAt) {
        // Titanium Deposits deliberately use the standard mining/pickaxe sound too.
        triggerToolSwing(0.92, 260);
        triggerToolImpact(0.9);
        playAudio(isDrill(uiState.equippedItemType) ? 'drill' : 'pickaxe', 0.52, isDrill(uiState.equippedItemType) ? 1.0 : (0.98 + Math.random() * 0.06), isDrill(uiState.equippedItemType) ? 300 : 0);
        nextPickaxeSoundAt = nowAudio + getMiningTimeForTool();
      }

      if (isMoving) {
        tmpMove.set(moveX, 0, moveZ).normalize();

        const moveSurfaceUpWorld = getActiveWalkingSurfaceWorld(new THREE.Vector3());
        getCameraRelativePlanetMove(tmpMove.x, tmpMove.z, moveSurfaceUpWorld, planetSystem, tmpWorldMove);
        // updatePlayer() already lives in Ivis/planetSystem local space, so the helper
        // result is immediately usable here.
        if (tmpWorldMove.lengthSq() < 0.00001) tmpWorldMove.copy(tmpMove).applyQuaternion(orientation).normalize();

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
      if (grounded && !wasGroundedForAudio) {
        playAudio('land2', 0.5, 0.98 + Math.random() * 0.04);
        const landingPos = player.position.clone();
        const landingNormal = landingPos.clone().normalize();
        spawnLandingDust(landingPos, landingNormal);
      }
      wasGroundedForAudio = grounded;
      if (grounded && isActionDown('jump')) {
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

        // Keep the third-person camera upright relative to the spherical planet surface.
        // THREE.Camera.lookAt() otherwise uses the global Y-up reference, which makes the
        // view roll upside down after walking onto the far side of a spherical world.
        camera.updateMatrixWorld(true);
        const thirdPersonCameraWorldPos = new THREE.Vector3();
        const thirdPersonPlanetCenterWorld = planetSystem.getWorldPosition(new THREE.Vector3());
        camera.getWorldPosition(thirdPersonCameraWorldPos);
        const thirdPersonCameraWorldUp = thirdPersonCameraWorldPos
          .sub(thirdPersonPlanetCenterWorld)
          .normalize();
        camera.up.copy(thirdPersonCameraWorldUp);
        camera.lookAt(planetSystem.localToWorld(thirdPersonCameraTarget.clone()));
        const impactPulse = getToolImpactPulse();
        if (impactPulse > 0) {
          camera.position.z += impactPulse * 0.018;
          camera.rotation.z += impactPulse * 0.010;
        }
      } else {
        camera.rotation.set(playerState.pitch, 0, 0);
        camera.position.lerp(targetCamPos, Math.min(1, delta * 10));
        const impactPulse = getToolImpactPulse();
        if (impactPulse > 0) {
          camera.position.z += impactPulse * 0.022;
          camera.rotation.z += impactPulse * 0.012;
        }
      }
    }

    function updateMoonPlayer(delta) {
      if (!moonWalking || state.gameState !== 'playing' || state.paused) return;

      let moveX = 0, moveZ = 0;
      if (isActionDown('moveForward')) moveZ -= 1;
      if (isActionDown('moveBackward')) moveZ += 1;
      if (isActionDown('moveLeft')) moveX -= 1;
      if (isActionDown('moveRight')) moveX += 1;
      const isMoving = moveX !== 0 || moveZ !== 0;
      const shiftHeld = isActionDown('sprint');

      let speed = MOVE_SPEED;
      if (state.gameMode === 'freeplay') {
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

      const moonUp = getMoonLocalUp(new THREE.Vector3());
      if (isMoving) {
        tmpMove.set(moveX, 0, moveZ).normalize();
        const moveSurfaceUpWorld = getActiveWalkingSurfaceWorld(new THREE.Vector3());
        getCameraRelativePlanetMove(tmpMove.x, tmpMove.z, moveSurfaceUpWorld, moonMesh, tmpWorldMove);
        if (tmpWorldMove.lengthSq() < 0.00001) tmpWorldMove.copy(tmpMove).applyQuaternion(orientation);
        tmpWorldMove.addScaledVector(moonUp, -tmpWorldMove.dot(moonUp)).normalize();
        const moveDistance = speed * delta;
        const angularStep = moveDistance / MOON_PLAYER_GROUND_RADIUS;
        const newDir = moonUp.clone().addScaledVector(tmpWorldMove, angularStep).normalize();
        player.position.copy(newDir).multiplyScalar(MOON_PLAYER_GROUND_RADIUS + EYE_HEIGHT + playerState.heightOffset);
      }

      const grounded = playerState.heightOffset <= 0;
      if (grounded && isActionDown('jump') && playerState.verticalVelocity <= 0) {
        playerState.verticalVelocity = MOON_JUMP_SPEED;
      }
      playerState.verticalVelocity -= GRAVITY * delta;
      playerState.heightOffset += playerState.verticalVelocity * delta;
      if (playerState.heightOffset < 0) {
        playerState.heightOffset = 0;
        playerState.verticalVelocity = 0;
      }

      const groundDir = player.position.clone().normalize();
      player.position.copy(groundDir).multiplyScalar(MOON_PLAYER_GROUND_RADIUS + EYE_HEIGHT + playerState.heightOffset);

      const oldUp = new THREE.Vector3(0, 1, 0).applyQuaternion(orientation);
      const align = new THREE.Quaternion().setFromUnitVectors(oldUp, groundDir);
      orientation.premultiply(align);

      if (playerState.thirdPerson && isMoving) {
        const travelDir = tmpWorldMove.clone().normalize();
        const travelRight = new THREE.Vector3().crossVectors(travelDir, groundDir).normalize();
        const basis = new THREE.Matrix4().makeBasis(travelRight, groundDir, travelDir.clone().negate());
        orientation.setFromRotationMatrix(basis);
      }
      player.quaternion.copy(orientation);

      if (playerState.thirdPerson) {
        const camRadius = 5.2;
        const up = groundDir;
        const baseForward = thirdPersonCameraForward.clone().addScaledVector(up, -thirdPersonCameraForward.dot(up));
        if (baseForward.lengthSq() < 0.00001) baseForward.set(0, 0, -1);
        baseForward.normalize();
        const camRight = new THREE.Vector3().crossVectors(baseForward, up).normalize();
        const pitchQuat = new THREE.Quaternion().setFromAxisAngle(camRight, playerState.thirdPersonOrbitPitch);
        const camForward = baseForward.clone().applyQuaternion(pitchQuat).normalize();
        const target = player.position.clone().addScaledVector(up, 1.05);
        const desiredMoonLocal = target.clone().addScaledVector(camForward, -camRadius);
        const desiredWorld = moonMesh.localToWorld(desiredMoonLocal.clone());
        player.worldToLocal(thirdPersonCameraLocalDesired.copy(desiredWorld));
        camera.position.lerp(thirdPersonCameraLocalDesired, Math.min(1, delta * 10));
        camera.updateMatrixWorld(true);
        const targetWorld = moonMesh.localToWorld(target.clone());
        const thirdPersonCameraWorldPos = camera.getWorldPosition(new THREE.Vector3());
        const moonCenterWorld = moonMesh.getWorldPosition(new THREE.Vector3());
        camera.up.copy(thirdPersonCameraWorldPos.sub(moonCenterWorld).normalize());
        camera.lookAt(targetWorld);
      } else {
        camera.rotation.set(playerState.pitch, 0, 0);
        camera.position.lerp(targetCamPos, Math.min(1, delta * 10));
      }

      // Subtle lunar dust appears while sprinting across the surface. It is world-space so it
      // remains visually attached to the moving/rotating Moon for the brief lifetime of each puff.
      if (isMoving && shiftHeld && grounded) {
        moonDustTimer -= delta;
        if (moonDustTimer <= 0) {
          const footWorld = getMoonWorldPositionForPlayer(new THREE.Vector3());
          const normalWorld = getMoonWorldNormalForPlayer(new THREE.Vector3());
          footWorld.addScaledVector(normalWorld, -EYE_HEIGHT + 0.05);
          spawnWorldParticles(footWorld, 0x918e88, { count: 4, life: 0.48, speed: 0.32, size: 0.055, gravity: 0.22, spread: 1.4, upward: 0.5 });
          moonDustTimer = 0.12;
        }
      } else {
        moonDustTimer = 0;
      }
    }

    function updateOmegaPlayer(delta) {
      if (!omegaWalkingBodyId || state.gameState !== 'playing' || state.paused) return;
      const body = getOmegaMesh(omegaWalkingBodyId);
      if (!body) return;
      const bodyRadius = omegaWalkingBodyId === 'aurora' ? AURORA_RADIUS : MILERIA_RADIUS;
      const bodyGravity = GRAVITY * getOmegaBodyGravityMultiplier(omegaWalkingBodyId);
      const jumpSpeed = JUMP_SPEED * Math.sqrt(getOmegaBodyGravityMultiplier(omegaWalkingBodyId));
      let moveX = 0, moveZ = 0;
      if (isActionDown('moveForward')) moveZ -= 1;
      if (isActionDown('moveBackward')) moveZ += 1;
      if (isActionDown('moveLeft')) moveX -= 1;
      if (isActionDown('moveRight')) moveX += 1;
      const isMoving = moveX !== 0 || moveZ !== 0;
      const shiftHeld = isActionDown('sprint');

      let speed = MOVE_SPEED;
      if (state.gameMode === 'freeplay') {
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
          playerState.stamina = Math.min(STAMINA_MAX, playerState.stamina + STAMINA_REGEN_PER_SEC * delta);
          if (playerState.stamina >= STAMINA_EXHAUST_RECOVER) playerState.exhausted = false;
        }
      }
      updateStaminaBar();

      const localDir = player.position.clone().normalize();
      if (isMoving) {
        tmpMove.set(moveX, 0, moveZ).normalize();
        const surfaceUpWorld = getActiveWalkingSurfaceWorld(new THREE.Vector3());
        getCameraRelativePlanetMove(tmpMove.x, tmpMove.z, surfaceUpWorld, body, tmpWorldMove);
        if (tmpWorldMove.lengthSq() < 0.00001) tmpWorldMove.copy(tmpMove).applyQuaternion(orientation);
        const up = localDir.clone();
        tmpWorldMove.addScaledVector(up, -tmpWorldMove.dot(up)).normalize();
        const angularStep = (speed * delta) / Math.max(1, bodyRadius + omegaHeightForPlayer(omegaWalkingBodyId, localDir));
        const newDir = localDir.clone().addScaledVector(tmpWorldMove, angularStep).normalize();
        const newSurfaceRadius = bodyRadius + omegaHeightForPlayer(omegaWalkingBodyId, newDir) + EYE_HEIGHT + playerState.heightOffset;
        player.position.copy(newDir).multiplyScalar(newSurfaceRadius);
      }

      const grounded = playerState.heightOffset <= 0;
      if (grounded && isActionDown('jump') && playerState.verticalVelocity <= 0) playerState.verticalVelocity = jumpSpeed;
      playerState.verticalVelocity -= bodyGravity * delta;
      playerState.heightOffset += playerState.verticalVelocity * delta;
      if (playerState.heightOffset < 0) {
        playerState.heightOffset = 0;
        playerState.verticalVelocity = 0;
      }
      const groundDir = player.position.clone().normalize();
      player.position.copy(groundDir).multiplyScalar(bodyRadius + omegaHeightForPlayer(omegaWalkingBodyId, groundDir) + EYE_HEIGHT + playerState.heightOffset);

      const oldUp = new THREE.Vector3(0, 1, 0).applyQuaternion(orientation);
      orientation.premultiply(new THREE.Quaternion().setFromUnitVectors(oldUp, groundDir));
      if (playerState.thirdPerson && isMoving) {
        const travelDir = tmpWorldMove.clone().normalize();
        const travelRight = new THREE.Vector3().crossVectors(travelDir, groundDir).normalize();
        orientation.setFromRotationMatrix(new THREE.Matrix4().makeBasis(travelRight, groundDir, travelDir.clone().negate()));
      }
      player.quaternion.copy(orientation);

      if (playerState.thirdPerson) {
        const camRadius = 5.2;
        const up = groundDir;
        const baseForward = thirdPersonCameraForward.clone().addScaledVector(up, -thirdPersonCameraForward.dot(up));
        if (baseForward.lengthSq() < 0.00001) baseForward.set(0, 0, -1);
        baseForward.normalize();
        const camRight = new THREE.Vector3().crossVectors(baseForward, up).normalize();
        const pitchQuat = new THREE.Quaternion().setFromAxisAngle(camRight, playerState.thirdPersonOrbitPitch);
        const camForward = baseForward.clone().applyQuaternion(pitchQuat).normalize();
        const target = player.position.clone().addScaledVector(up, 1.05);
        const desiredLocal = target.clone().addScaledVector(camForward, -camRadius);
        const desiredWorld = body.localToWorld(desiredLocal.clone());
        player.worldToLocal(thirdPersonCameraLocalDesired.copy(desiredWorld));
        camera.position.lerp(thirdPersonCameraLocalDesired, Math.min(1, delta * 10));
        camera.updateMatrixWorld(true);
        const camWorld = camera.getWorldPosition(new THREE.Vector3());
        const centerWorld = body.getWorldPosition(new THREE.Vector3());
        camera.up.copy(camWorld.sub(centerWorld).normalize());
        camera.lookAt(body.localToWorld(target.clone()));
      } else {
        camera.rotation.set(playerState.pitch, 0, 0);
        camera.position.lerp(targetCamPos, Math.min(1, delta * 10));
      }

      const footstepActive = isMoving && groundedForAudio(playerState);
      if (footstepActive) {
        const sprintingNow = state.gameMode === 'freeplay' ? (shiftHeld && isMoving) : (shiftHeld && isMoving && !playerState.exhausted && playerState.stamina > 0);
        if (!footstepWasActive) playAudio('footsteps', sprintingNow ? 0.42 : 0.32, sprintingNow ? 1.10 : 1.0);
        setLoopAudioMode('footsteps', true, sprintingNow ? 0.42 : 0.32, sprintingNow ? 1.10 : 1.0);
      } else if (footstepWasActive) stopAudio('footsteps');
      footstepWasActive = footstepActive;

      if (isMoving && shiftHeld && grounded) {
        omegaDustTimer -= delta;
        if (omegaDustTimer <= 0) {
          const footWorld = player.getWorldPosition(new THREE.Vector3());
          const normalWorld = getActiveWalkingSurfaceWorld(new THREE.Vector3());
          footWorld.addScaledVector(normalWorld, -EYE_HEIGHT + 0.05);
          spawnWorldParticles(footWorld, omegaWalkingBodyId === 'aurora' ? 0x5ca85d : 0x898b8d, { count: 3, life: 0.42, speed: 0.34, size: 0.05, gravity: 0.2, spread: 1.2, upward: 0.45 });
          omegaDustTimer = 0.14;
        }
      } else omegaDustTimer = 0;
    }

    function omegaHeightForPlayer(bodyId, dir) {
      return getOmegaSurfaceHeight(bodyId, dir);
    }

    function resetContinuousSurvivalAchievementRun() {
      survivalRunSeconds = 0;
      survivalRunSawNight = false;
    }

    function updateAccountStatisticsTelemetry(delta) {
      if (!currentAccountUser || state.gameState !== 'playing' || state.paused) return;
      const dt = Math.max(0, Math.min(Number(delta) || 0, 0.25));
      if (dt <= 0) return;
      accountStatistics.totalPlaytimeSeconds += dt;
      if (playerState.inRocket && playerState.rocketInSpace && !playerState.rocketLanded) {
        accountStatistics.totalSpaceSeconds += dt;
      }
      accountStatsSaveTimer += dt;
      if (accountStatsSaveTimer >= 10) {
        accountStatsSaveTimer = 0;
        renderAccountStatistics();
        persistAchievementState();
      }
    }

    function updateSurvivalAchievementTelemetry(delta, nightAmount) {
      if (!currentAccountUser || state.gameMode !== 'survival' || state.gameState !== 'playing' || state.paused) return;
      survivalRunSeconds += Math.max(0, delta);
      if (nightAmount > 0.55) {
        survivalRunSawNight = true;
        awardAchievement('first_night');
      }
      if (survivalRunSeconds >= DAY_LENGTH_SECONDS) awardAchievement('full_day_night');
      if (survivalRunSeconds >= 20 * 60) awardAchievement('tough_nut');
    }

    function updateAccountAchievementTelemetry(delta) {
      if (!currentAccountUser || state.gameMode !== 'survival' || state.gameState !== 'playing' || state.paused) return;

      const playerWorldPosition = new THREE.Vector3();
      player.getWorldPosition(playerWorldPosition);
      const distanceFromIvis = playerWorldPosition.distanceTo(ivisSolarOrbitPosition);

      // 'Away from Ivis' means genuinely outside Ivis' local area. The five-minute threshold
      // is cumulative on the account, so players may earn it across multiple trips.
      if (distanceFromIvis >= ACHIEVEMENT_AWAY_DISTANCE) {
        accountAchievementProgress.awayFromIvisSeconds += Math.max(0, delta);
        if (accountAchievementProgress.awayFromIvisSeconds >= ACHIEVEMENT_AWAY_TIME) {
          awardAchievement('away_from_home');
        }
        achievementTelemetrySaveTimer += Math.max(0, delta);
        if (achievementTelemetrySaveTimer >= 10) {
          achievementTelemetrySaveTimer = 0;
          persistAchievementState();
        }
      }

      if (playerState.inRocket && !playerState.rocketLanded && distanceFromIvis >= ACHIEVEMENT_FAR_DISTANCE) {
        awardAchievement('far_from_home');
      }

      if (playerState.inRocket && playerState.rocketInSpace && !playerState.rocketLanded) {
        accountAchievementProgress.spaceSeconds += Math.max(0, delta);
        if (accountAchievementProgress.spaceSeconds >= 10 * 60) awardAchievement('space_10min');
      }
      if (economyState.credits >= 1000) awardAchievement('credits_1000');
    }

    // ---------- main loop ----------
    let interactionPromptUpdateTimer = 0;
    const clock = new THREE.Clock();
    function animate() {
      requestAnimationFrame(animate);
      rainbowCosmeticTime += 0.012;
      if (accountCosmetics.equippedColor === 'rainbow' && typeof playerBody !== 'undefined' && playerBody?.material) {
        playerBody.material.color.setHSL((rainbowCosmeticTime % 1),0.78,0.58);
      }
      const equippedHatSpec = getEquippedHatVisualSpec();
      if (equippedHatSpec?.colorId === 'rainbow') {
        if (typeof playerBody !== 'undefined' && playerBody) {
          const liveHat = playerBody.children.find(ch => ch.userData?.cosmeticHatVisual);
          if (liveHat) applyRainbowHatColors(liveHat, rainbowCosmeticTime);
          else if (playerBody.children.length) applyRainbowHatColors(playerBody.children[playerBody.children.length - 1], rainbowCosmeticTime);
        }
      }
      const delta = Math.min(clock.getDelta(), 0.05);
      updateParticles(delta);
      updateSpecialParticles(delta);
      updateFinalParticles(delta);
      updateRainParticles(delta);
      updateLightning(delta);
      updateFallingStar(delta);
      if (playerState.inRocket || state.gameState !== 'playing' || state.paused) {
        if (footstepWasActive) { stopAudio('footsteps'); footstepWasActive = false; }
      }
      spawnPinGroup.visible = state.gameState !== "playing"; // GPS pin only shows on the main-menu view
      syspoSystem.visible = state.gameState === 'playing';

      // Ivis orbits the Sun during gameplay. Keep the main-menu preview centered at the origin
      // so its existing camera and presentation are unchanged.
      if (state.gameState === 'playing') updateIvisSolarOrbit(delta);
      else {
        planetSystem.position.set(0, 0, 0);
        ivisSolarOrbitPosition.copy(sunMesh.position)
          .addScaledVector(ivisSolarOrbitBasisA, IVIS_SUN_ORBIT_DISTANCE);
      }

      // Run the sun/day-night simulation in both game and menu so the planet preview
      // also shows the same lighting system.
      updateDayNight(delta);
      nightSamplePlayerPos.copy(player.getWorldPosition(nightSamplePlayerPos));
      const ps = nightSamplePlayerPos.lengthSq() > 0.000001 ? nightSamplePlayerPos.normalize() : nightSamplePlayerPos.set(0, 1, 0);
      nightSampleSunPos.copy(sunMesh.position);
      const ss = nightSampleSunPos.lengthSq() > 0.000001 ? nightSampleSunPos.normalize() : nightSampleSunPos.set(0, 1, 0);
      const currentNightAmount = THREE.MathUtils.smoothstep(-ps.dot(ss), 0.02, 0.42);
      if (state.gameState === 'playing') {
        updateSurvivalAchievementTelemetry(delta, currentNightAmount);
        updateTreeSaplings();
        updateMoon(delta);
        updateCordelia(delta);
        updateOmegaSystem(delta);
        updateWeather(delta);
        player.getWorldPosition(omegaAtmosphereWorldPos);
        updateOmegaAtmosphere(omegaAtmosphereWorldPos);
        updateWeatherControlVisibility();
        updateCrystalRespawns();
        updateAllFurnaceSmelting();
        updateAmbientAudio();
      }
      updateMusic(delta);
      const solarHazardLock = updateSunDanger(delta);
      const spaceFuelHazardLock = updateSpaceFuelDanger(delta);
      const syspoHazardLock = updateSyspoDanger(delta);
      updateToolSwing();
      updateHeldItemJumpAnimation();
      updateHeldItemBob(delta);
      if (!playerState.inRocket) {
        travelTransitionState = 'ground';
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
          droppedItemBobPos.copy(drop.basePosition).addScaledVector(drop.direction, bobOffset);
          drop.root.position.copy(droppedItemBobPos);
        }
      }
      updateRocketFueling();
      updateDrillRefueling();

      if (state.gameState === "playing") {
        const activeCamera = playerState.inRocket ? flightCamera : camera;
        const cameraDistanceFromOrigin = activeCamera.position.length();
        // Day 9 doubled the Sun and celestial-body spacing: Cordelia can now sit
        // roughly 16,000 units from Ivis, and the enlarged Sun extends beyond 10,000.
        // A 10,000-unit far plane therefore clipped distant celestial bodies when the
        // player was still near Ivis, making them appear to be sliced or disappear from
        // certain viewing angles. Keep a generous minimum far plane for the expanded system.
        const desiredCameraFar = Math.max(30000, cameraDistanceFromOrigin * 4 + 4000);
        if (activeCamera.far !== desiredCameraFar) {
          activeCamera.far = desiredCameraFar;
          activeCamera.updateProjectionMatrix();
        }
        // Keep background-only layers centered on the viewer so their finite world-space
        // radius can never leave the camera behind at extreme flight distances.
        skyMesh.position.copy(activeCamera.position);
        stars.position.copy(activeCamera.position);

        // Atmospheric fog should not hide Ivis once the rocket is genuinely in space.
        // The atmospheric fog ends around 1020 units, but the ship can travel many
        // thousands of units away from Ivis. In space we render the celestial bodies
        // against the space sky with no distance fog, so Ivis remains visible at long range.
        scene.fog = (playerState.inRocket && playerState.rocketInSpace) ? null : sceneFog;
        interactionPromptUpdateTimer += delta;
        if (interactionPromptUpdateTimer >= 0.075) {
          interactionPromptUpdateTimer = 0;
          updateCrystalPrompt();
        }
        flashlightStatus.classList.toggle("hidden", !playerState.flashlightOn);
        updatePlayerHatVisibility();
        if (!solarHazardLock && !spaceFuelHazardLock && !syspoHazardLock) {
          if (playerState.inRocket && !warpInProgress) {
            updateRocketFlight(delta);
            setRocketFlightUI();
          } else if (moonWalking) {
            updateMoonPlayer(delta);
          } else if (cordeliaWalking) {
            updateCordeliaPlayer(delta);
          } else if (omegaWalkingBodyId) {
            updateOmegaPlayer(delta);
          } else if (!state.paused) {
            updatePlayer(delta);
          }
          updateAccountStatisticsTelemetry(delta);
          updateAccountAchievementTelemetry(delta);
        }
        renderer.render(scene, activeCamera);
        if (mapOpen) {
          updateMapPlayerMarker();
          mapRenderer.render(mapScene, mapCamera);
        }
        if (spaceMapOpen) drawSpaceMap();
        if (warpInProgress) { const elapsedWarp=Math.max(0,(performance.now()-warpStartedAt)/1000); const remainingWarp=Math.max(0,warpDurationSeconds-elapsedWarp); warpOverlaySubtext.textContent=formatWarpSeconds(remainingWarp)+' REMAINING'; if(remainingWarp<=0) finishWarp(); }
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
    document.querySelectorAll('button').forEach((button) => button.classList.add('uiPolishButton'));
    homeLoading.classList.add("hidden");
    homeButtons.classList.remove("hidden");

    animate();
  }

  boot();
})();
