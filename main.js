import * as THREE from 'three';

import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const DEBUG_COLLIDERS = new URLSearchParams(window.location.search).get('debugColliders') === '1';
const PERF_QUERY_ENABLED = new URLSearchParams(window.location.search).get('perf') === '1';
const SETTINGS_STORAGE_KEY = 'motokurye-istanbul-settings-v1';
const PREFERRED_GRAPHICS = window.matchMedia?.('(pointer: coarse)').matches ? 'low' : 'high';
const DEFAULT_SETTINGS = {
    graphics: PREFERRED_GRAPHICS,
    controlMethod: 'buttons',
    controlSensitivity: 100,
    audio: { master: 100, music: 40, radio: 35, engine: 55, traffic: 28, environment: 16, voices: 42, ui: 80, muted: false },
};
function readGameSettings() {
    try {
        const source = JSON.parse(window.localStorage.getItem(SETTINGS_STORAGE_KEY) || '{}');
        const audio = source.audio && typeof source.audio === 'object' ? source.audio : {};
        const percent = (value, fallback) => Number.isFinite(Number(value)) ? Math.max(0, Math.min(100, Math.round(Number(value)))) : fallback;
        return {
            graphics: ['low', 'medium', 'high', 'ultra'].includes(source.graphics) ? source.graphics : DEFAULT_SETTINGS.graphics,
            controlMethod: ['buttons', 'touch', 'tilt'].includes(source.controlMethod) ? source.controlMethod : DEFAULT_SETTINGS.controlMethod,
            controlSensitivity: Number.isFinite(Number(source.controlSensitivity))
                ? Math.max(50, Math.min(150, Math.round(Number(source.controlSensitivity))))
                : DEFAULT_SETTINGS.controlSensitivity,
            audio: {
                master: percent(audio.master, DEFAULT_SETTINGS.audio.master),
                music: percent(audio.music, DEFAULT_SETTINGS.audio.music),
                radio: percent(audio.radio, DEFAULT_SETTINGS.audio.radio),
                engine: percent(audio.engine, DEFAULT_SETTINGS.audio.engine),
                traffic: percent(audio.traffic, DEFAULT_SETTINGS.audio.traffic),
                environment: percent(audio.environment, DEFAULT_SETTINGS.audio.environment),
                voices: percent(audio.voices, DEFAULT_SETTINGS.audio.voices),
                ui: percent(audio.ui, DEFAULT_SETTINGS.audio.ui),
                muted: Boolean(audio.muted),
            },
        };
    } catch {
        return { ...DEFAULT_SETTINGS, audio: { ...DEFAULT_SETTINGS.audio } };
    }
}
const settings = readGameSettings();
const PERF_ENABLED = PERF_QUERY_ENABLED;
function saveGameSettings() {
    try { window.localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(settings)); } catch {}
}
const GRAPHICS_PRESETS = {
    low: { pixelRatio: 0.75, maxTextureEdge: 768, shadows: false, shadowMap: 512, fogFar: 110, cameraFar: 140, shadowType: THREE.BasicShadowMap },
    medium: { pixelRatio: 0.85, maxTextureEdge: 1024, shadows: true, shadowMap: 512, fogFar: 135, cameraFar: 175, shadowType: THREE.BasicShadowMap },
    high: { pixelRatio: 1.0, maxTextureEdge: 1536, shadows: true, shadowMap: 1024, fogFar: 165, cameraFar: 215, shadowType: THREE.PCFShadowMap },
    ultra: { pixelRatio: 1.25, maxTextureEdge: 2048, shadows: true, shadowMap: 1536, fogFar: 195, cameraFar: 265, shadowType: THREE.PCFShadowMap },
};
const BIKE_R = 0.8;
const BIKE_HALF_WIDTH = 0.43;
const BIKE_HALF_LENGTH = 1.0;

// ---------- Renderer / scene ----------

const container = document.getElementById('game-container');

const renderer = new THREE.WebGLRenderer({ antialias: true });

renderer.setSize(window.innerWidth, window.innerHeight);

renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, GRAPHICS_PRESETS[settings.graphics].pixelRatio));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.08;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;

container.appendChild(renderer.domElement);



const scene = new THREE.Scene();

scene.background = new THREE.Color(0xb8ccd1);

scene.fog = new THREE.Fog(0xb8ccd1, 60, 170);

const camera = new THREE.PerspectiveCamera(65, window.innerWidth / window.innerHeight, 0.1, 400);



scene.add(new THREE.HemisphereLight(0xe9f2f1, 0x756957, 1.55));

const sun = new THREE.DirectionalLight(0xffedcf, 2.65);

sun.castShadow = true;
sun.shadow.bias = -0.00025;
sun.shadow.normalBias = 0.035;
sun.shadow.radius = 3;
sun.shadow.mapSize.set(1024, 1024);

Object.assign(sun.shadow.camera, { left: -40, right: 40, top: 40, bottom: -40, far: 150 });

// These collections are needed by the initial graphics-preset application below,
// so declare them before applyGraphicsPreset can run during module startup.
const loadedTextureRoots = new Set();
const worldStaticBatches = [];
let shadowRefreshElapsed = 1;

function applyTextureBudget(root, preset) {
    if (!root) return;
    const maxEdge = preset.maxTextureEdge;
    const anisotropy = Math.min(preset.pixelRatio <= 0.85 ? 2 : 4, renderer.capabilities.getMaxAnisotropy());
    const visited = new Set();
    root.traverse(object => {
        if (!object.isMesh) return;
        const materials = Array.isArray(object.material) ? object.material : [object.material];
        for (const material of materials) {
            if (!material) continue;
            for (const value of Object.values(material)) {
                if (!value?.isTexture || visited.has(value)) continue;
                visited.add(value);
                const texture = value;
                const image = texture.userData.__originalImage || texture.image;
                const width = Number(image?.width || image?.videoWidth || image?.naturalWidth || 0);
                const height = Number(image?.height || image?.videoHeight || image?.naturalHeight || 0);
                if (width > maxEdge || height > maxEdge) {
                    texture.userData.__originalImage ||= image;
                    const scale = Math.min(maxEdge / width, maxEdge / height);
                    const canvas = document.createElement('canvas');
                    canvas.width = Math.max(1, Math.round(width * scale));
                    canvas.height = Math.max(1, Math.round(height * scale));
                    const context = canvas.getContext('2d');
                    if (context) {
                        context.imageSmoothingEnabled = true;
                        context.imageSmoothingQuality = 'high';
                        context.drawImage(image, 0, 0, canvas.width, canvas.height);
                        texture.image = canvas;
                        texture.needsUpdate = true;
                    }
                } else if (texture.userData.__originalImage && texture.image !== image) {
                    texture.image = image;
                    texture.needsUpdate = true;
                }
                texture.minFilter = THREE.LinearMipmapLinearFilter;
                texture.magFilter = THREE.LinearFilter;
                texture.generateMipmaps = true;
                texture.anisotropy = anisotropy;
            }
        }
    });
}

function applyGraphicsPreset(presetName = settings.graphics) {
    const key = GRAPHICS_PRESETS[presetName] ? presetName : DEFAULT_SETTINGS.graphics;
    const preset = GRAPHICS_PRESETS[key];
    settings.graphics = key;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, preset.pixelRatio));
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.shadowMap.enabled = preset.shadows;
    renderer.shadowMap.type = preset.shadowType;
    sun.castShadow = preset.shadows;
    if (sun.shadow.map) {
        sun.shadow.map.dispose();
        sun.shadow.map = null;
    }
    sun.shadow.mapSize.set(preset.shadowMap, preset.shadowMap);
    for (const batch of worldStaticBatches) batch.mesh.castShadow = false;
    shadowRefreshElapsed = 1;
    for (const root of loadedTextureRoots) applyTextureBudget(root, preset);
    scene.fog.near = 60;
    scene.fog.far = preset.fogFar;
    camera.far = preset.cameraFar;
    camera.updateProjectionMatrix();
    saveGameSettings();
}

applyGraphicsPreset(settings.graphics);
scene.add(sun, sun.target);



window.addEventListener('resize', () => {

    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, GRAPHICS_PRESETS[settings.graphics].pixelRatio));
    renderer.setSize(window.innerWidth, window.innerHeight);
    resizeDealerPreview();
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();

});



// ---------- City layout ----------

const GRID = 6;          // blocks per side

const BLOCK = 26;        // block size

const ROAD = 10;         // road width

const CELL = BLOCK + ROAD;

const HALF = (GRID * CELL) / 2;

const ROAD_LINES = Array.from({ length: GRID }, (_, i) => -HALF + ROAD / 2 + i * CELL);

const colliders = [];    // {minX,maxX,minZ,maxZ}
const collidersByCell = new Map();
const COLLISION_CELL_SIZE = 24;
const BIKE_COLLISION_REACH = Math.hypot(BIKE_HALF_WIDTH, BIKE_HALF_LENGTH);
let colliderQuerySerial = 0;
let perfColliderCandidates = 0;
let perfTrafficObbTests = 0;

const restaurants = [];  // {pos, marker}

const customers = [];    // Vector3 positions on sidewalk

const gasStations = [];  // exactly three physical roadside fuel stops
const GAS_STATION_BLOCKS = new Map([
    ['1,1', 'north'],
    ['3,0', 'west'],
    ['4,4', 'east'],
]);



const mats = {};
const boxGeometryCache = new Map();

function mat(color) {

    if (!mats[color]) {

        mats[color] = new THREE.MeshStandardMaterial({ color, roughness: 0.84, metalness: 0.02 });

    }

    return mats[color];

}



function box(w, h, d, color, x, y, z, parent = scene) {

    const geometryKey = `${w}|${h}|${d}`;
    if (!boxGeometryCache.has(geometryKey)) boxGeometryCache.set(geometryKey, new THREE.BoxGeometry(w, h, d));
    const m = new THREE.Mesh(boxGeometryCache.get(geometryKey), mat(color));

    m.position.set(x, y, z);

    m.castShadow = true;

    m.receiveShadow = true;

    parent.add(m);

    return m;

}



const destinationMarkerGeometry = {

    disk: new THREE.CircleGeometry(3.1, 48),

    ring: new THREE.RingGeometry(2.65, 3.2, 48),

};

const destinationMarkerMaterials = {

    pickupDisk: new THREE.MeshBasicMaterial({ color: 0xffd12e, transparent: true, opacity: 0.24, depthWrite: false, side: THREE.DoubleSide }),

    pickupRing: new THREE.MeshBasicMaterial({ color: 0xffd12e, transparent: true, opacity: 0.98, depthWrite: false, side: THREE.DoubleSide }),

    deliveryDisk: new THREE.MeshBasicMaterial({ color: 0x20e58a, transparent: true, opacity: 0.24, depthWrite: false, side: THREE.DoubleSide }),

    deliveryRing: new THREE.MeshBasicMaterial({ color: 0x20e58a, transparent: true, opacity: 0.98, depthWrite: false, side: THREE.DoubleSide }),

};



function createDestinationMarker(x, z, isDelivery = false) {

    const marker = new THREE.Group();

    marker.position.set(x, 0, z);

    marker.visible = false;

    const palette = isDelivery

        ? [destinationMarkerMaterials.deliveryDisk, destinationMarkerMaterials.deliveryRing]

        : [destinationMarkerMaterials.pickupDisk, destinationMarkerMaterials.pickupRing];

    const disk = new THREE.Mesh(destinationMarkerGeometry.disk, palette[0]);

    disk.rotation.x = -Math.PI / 2;

    disk.position.y = 0.36;

    disk.renderOrder = 2;

    const ring = new THREE.Mesh(destinationMarkerGeometry.ring, palette[1]);

    ring.rotation.x = -Math.PI / 2;

    ring.position.y = 0.38;

    ring.renderOrder = 3;

    marker.add(disk, ring);

    scene.add(marker);

    return marker;

}



// Reused beam meshes keep the active destination obvious without adding
// geometry for every inactive restaurant and customer.

const DESTINATION_BEAM_HEIGHT = 52;

const destinationBeamGeometry = {

    outer: new THREE.CylinderGeometry(0.1, 0.72, DESTINATION_BEAM_HEIGHT, 12, 1, true),

    core: new THREE.CylinderGeometry(0.055, 0.2, DESTINATION_BEAM_HEIGHT, 10, 1, true),

};

function createDestinationBeam(color) {

    const beam = new THREE.Group();

    const outer = new THREE.Mesh(destinationBeamGeometry.outer, new THREE.MeshBasicMaterial({

        color, transparent: true, opacity: 0.25, depthWrite: false, side: THREE.DoubleSide,

        blending: THREE.AdditiveBlending, fog: false,

    }));

    const core = new THREE.Mesh(destinationBeamGeometry.core, new THREE.MeshBasicMaterial({

        color, transparent: true, opacity: 0.78, depthWrite: false, side: THREE.DoubleSide,

        blending: THREE.AdditiveBlending, fog: false,

    }));

    outer.position.y = DESTINATION_BEAM_HEIGHT / 2;

    core.position.y = DESTINATION_BEAM_HEIGHT / 2;

    beam.add(outer, core);

    beam.visible = false;

    scene.add(beam);

    return beam;

}

const pickupBeam = createDestinationBeam(0xffd000);

const deliveryBeam = createDestinationBeam(0x00f078);



function addCollider(x, z, w, d) {
    colliders.push({
        minX: x - w / 2, maxX: x + w / 2,
        minZ: z - d / 2, maxZ: z + d / 2,
        centerX: x, centerZ: z, halfWidth: w / 2, halfDepth: d / 2,
    });
}

function buildColliderSpatialIndex() {
    collidersByCell.clear();
    for (const collider of colliders) {
        const minX = Math.floor(collider.minX / COLLISION_CELL_SIZE);
        const maxX = Math.floor(collider.maxX / COLLISION_CELL_SIZE);
        const minZ = Math.floor(collider.minZ / COLLISION_CELL_SIZE);
        const maxZ = Math.floor(collider.maxZ / COLLISION_CELL_SIZE);
        for (let cellX = minX; cellX <= maxX; cellX++) {
            let column = collidersByCell.get(cellX);
            if (!column) collidersByCell.set(cellX, column = new Map());
            for (let cellZ = minZ; cellZ <= maxZ; cellZ++) {
                let bucket = column.get(cellZ);
                if (!bucket) column.set(cellZ, bucket = []);
                bucket.push(collider);
            }
        }
    }
}

function makeNoiseTexture(base, spread, seed, repeat = 48) {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 256;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    const image = context.createImageData(canvas.width, canvas.height);
    let randomState = seed >>> 0;
    const random = () => {
        randomState = (randomState * 1664525 + 1013904223) >>> 0;
        return randomState / 4294967296;
    };
    for (let i = 0; i < image.data.length; i += 4) {
        const variation = Math.round((random() - 0.5) * spread);
        const value = Math.max(0, Math.min(255, base + variation));
        image.data[i] = value;
        image.data[i + 1] = value;
        image.data[i + 2] = value;
        image.data[i + 3] = 255;
    }
    context.putImageData(image, 0, 0);
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(repeat, repeat);
    texture.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
    return texture;
}

const asphaltTexture = makeNoiseTexture(112, 42, 1941, 64);
const sidewalkTexture = makeNoiseTexture(190, 22, 817, 8);
const waterTexture = makeNoiseTexture(99, 24, 2718, 150);
const asphaltMaterial = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    map: asphaltTexture,
    roughness: 0.96,
    metalness: 0,
});
const sidewalkMaterial = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    map: sidewalkTexture,
    roughness: 0.92,
    metalness: 0,
});
const waterMaterial = new THREE.MeshStandardMaterial({
    color: 0x75a7ad,
    map: waterTexture,
    roughness: 0.46,
    metalness: 0.08,
});

function buildGround() {
    const asphalt = new THREE.Mesh(new THREE.PlaneGeometry(GRID * CELL + 60, GRID * CELL + 60), asphaltMaterial);
    asphalt.rotation.x = -Math.PI / 2;
    asphalt.receiveShadow = true;
    scene.add(asphalt);

    // The old 800 m square sea sheet was the source of the hard blue rectangle
    // visible at the edge of the camera view. Keep the Bosphorus backdrop, but
    // make it a broad round, textured water surface that fades into the city fog.
    const sea = new THREE.Mesh(new THREE.CircleGeometry(440, 128), waterMaterial);
    sea.rotation.x = -Math.PI / 2;
    sea.position.y = -0.3;
    sea.receiveShadow = false;
    scene.add(sea);

    // Repeated city slabs, curb strips, and lane dashes retain their original
    // materials and dimensions while replacing hundreds of individual meshes.
    const staticBlockCount = GRID * GRID;
    const sidewalkBatch = new THREE.InstancedMesh(
        new THREE.BoxGeometry(BLOCK, 0.25, BLOCK), sidewalkMaterial, staticBlockCount,
    );
    const curbLongBatch = new THREE.InstancedMesh(
        new THREE.BoxGeometry(BLOCK + 0.24, 0.14, 0.34), mat(0x77766f), staticBlockCount * 2,
    );
    const curbSideBatch = new THREE.InstancedMesh(
        new THREE.BoxGeometry(0.34, 0.14, BLOCK + 0.24), mat(0x77766f), staticBlockCount * 2,
    );
    const staticTransform = new THREE.Object3D();
    let sidewalkIndex = 0;
    let curbLongIndex = 0;
    let curbSideIndex = 0;
    for (let bx = 0; bx < GRID; bx++) {
        for (let bz = 0; bz < GRID; bz++) {
            const cx = -HALF + bx * CELL + ROAD / 2 + BLOCK / 2 + ROAD / 2;
            const cz = -HALF + bz * CELL + ROAD / 2 + BLOCK / 2 + ROAD / 2;
            staticTransform.position.set(cx, 0.12, cz);
            staticTransform.rotation.set(0, 0, 0);
            staticTransform.updateMatrix();
            sidewalkBatch.setMatrixAt(sidewalkIndex++, staticTransform.matrix);
            for (const side of [-1, 1]) {
                staticTransform.position.set(cx, 0.32, cz + side * (BLOCK / 2 - 0.05));
                staticTransform.rotation.set(0, 0, 0);
                staticTransform.updateMatrix();
                curbLongBatch.setMatrixAt(curbLongIndex++, staticTransform.matrix);
                staticTransform.position.set(cx + side * (BLOCK / 2 - 0.05), 0.32, cz);
                staticTransform.rotation.set(0, 0, 0);
                staticTransform.updateMatrix();
                curbSideBatch.setMatrixAt(curbSideIndex++, staticTransform.matrix);
            }
        }
    }
    sidewalkBatch.instanceMatrix.needsUpdate = true;
    curbLongBatch.instanceMatrix.needsUpdate = true;
    curbSideBatch.instanceMatrix.needsUpdate = true;
    sidewalkBatch.receiveShadow = curbLongBatch.receiveShadow = curbSideBatch.receiveShadow = true;
    scene.add(sidewalkBatch, curbLongBatch, curbSideBatch);

    const dashGeo = new THREE.PlaneGeometry(0.3, 2.5);
    const dashMat = new THREE.MeshStandardMaterial({ color: 0xe8dfbf, roughness: 0.9 });
    const dashesPerRoad = Math.ceil((HALF * 2) / 6);
    const dashBatch = new THREE.InstancedMesh(dashGeo, dashMat, GRID * dashesPerRoad * 2);
    const dashTransform = new THREE.Object3D();
    let dashIndex = 0;
    for (let i = 0; i < GRID; i++) {
        const center = ROAD_LINES[i];
        for (let along = -HALF; along < HALF; along += 6) {
            dashTransform.position.set(center, 0.025, along);
            dashTransform.rotation.set(-Math.PI / 2, 0, 0);
            dashTransform.updateMatrix();
            dashBatch.setMatrixAt(dashIndex++, dashTransform.matrix);
            dashTransform.position.set(along, 0.025, center);
            dashTransform.rotation.set(-Math.PI / 2, 0, Math.PI / 2);
            dashTransform.updateMatrix();
            dashBatch.setMatrixAt(dashIndex++, dashTransform.matrix);
        }
    }
    dashBatch.count = dashIndex;
    dashBatch.instanceMatrix.needsUpdate = true;
    dashBatch.receiveShadow = false;
    scene.add(dashBatch);

    // Instanced zebra crossings improve intersections without multiplying draw calls.
    const stripeGeometry = new THREE.BoxGeometry(ROAD - 1, 0.025, 0.32);
    const stripeMaterial = new THREE.MeshStandardMaterial({ color: 0xe5e0cf, roughness: 0.9 });
    const stripesPerCrossing = 6;
    const crosswalks = new THREE.InstancedMesh(stripeGeometry, stripeMaterial, GRID * GRID * 4 * stripesPerCrossing);
    const stripeMatrix = new THREE.Matrix4();
    const stripePosition = new THREE.Vector3();
    const stripeRotation = new THREE.Quaternion();
    const stripeScale = new THREE.Vector3(1, 1, 1);
    const stripeEuler = new THREE.Euler();
    let stripeIndex = 0;
    for (const roadX of ROAD_LINES) {
        for (const roadZ of ROAD_LINES) {
            for (const side of [-1, 1]) {
                for (let stripe = 0; stripe < stripesPerCrossing; stripe++) {
                    const offset = (stripe - (stripesPerCrossing - 1) / 2) * 0.58;
                    stripePosition.set(roadX, 0.035, roadZ + side * 4.2 + offset);
                    stripeEuler.set(0, 0, 0);
                    stripeRotation.setFromEuler(stripeEuler);
                    stripeMatrix.compose(stripePosition, stripeRotation, stripeScale);
                    crosswalks.setMatrixAt(stripeIndex++, stripeMatrix);
                }
                for (let stripe = 0; stripe < stripesPerCrossing; stripe++) {
                    const offset = (stripe - (stripesPerCrossing - 1) / 2) * 0.58;
                    stripePosition.set(roadX + side * 4.2 + offset, 0.035, roadZ);
                    stripeEuler.set(0, Math.PI / 2, 0);
                    stripeRotation.setFromEuler(stripeEuler);
                    stripeMatrix.compose(stripePosition, stripeRotation, stripeScale);
                    crosswalks.setMatrixAt(stripeIndex++, stripeMatrix);
                }
            }
        }
    }
    crosswalks.count = stripeIndex;
    crosswalks.instanceMatrix.needsUpdate = true;
    crosswalks.receiveShadow = true;
    scene.add(crosswalks);

    const edge = HALF + ROAD;
    addCollider(0, -edge - 2, edge * 2 + 8, 4);
    addCollider(0, edge + 2, edge * 2 + 8, 4);
    addCollider(-edge - 2, 0, 4, edge * 2 + 8);
    addCollider(edge + 2, 0, 4, edge * 2 + 8);
}



const WORLD_MODEL_PATHS = {
    sedan: 'assets/models/istanbul-compact-sedan.glb',
    van: 'assets/models/istanbul-delivery-van.glb',
    apartment: 'assets/models/istanbul-balcony-apartment.glb',
    townhouse: 'assets/models/istanbul-heritage-townhouse.glb',
    courtyard: 'assets/models/istanbul-stone-courtyard-house.glb',
    shop: 'assets/models/istanbul-corner-shop.glb',
    planeTree: 'assets/models/istanbul-plane-tree.glb',
    cypress: 'assets/models/istanbul-cypress-tree.glb',
    mosque: 'assets/models/istanbul-neighborhood-mosque.glb',
    streetlamp: 'assets/models/istanbul-decorative-streetlamp.glb',
};
const worldModelLoader = new GLTFLoader();
const worldModelCache = new Map();
const worldModelPromises = new Map();
const worldVisualPlacements = new Map(Object.keys(WORLD_MODEL_PATHS).map(key => [key, []]));

function loadWorldModel(key) {
    if (worldModelCache.has(key)) return Promise.resolve(worldModelCache.get(key));
    if (worldModelPromises.has(key)) return worldModelPromises.get(key);
    const requestStartedAt = PERF_ENABLED ? performance.now() : 0;
    const promise = new Promise(resolve => {
        worldModelLoader.load(WORLD_MODEL_PATHS[key], gltf => {
            loadedTextureRoots.add(gltf.scene);
            applyTextureBudget(gltf.scene, GRAPHICS_PRESETS[settings.graphics]);
            resolve(gltf.scene);
        }, undefined, error => {
            console.warn(`[World] GLB asset failed to load: ${WORLD_MODEL_PATHS[key]}`, error);
            resolve(null);
        });
    }).then(model => {
        worldModelPromises.delete(key);
        if (model) worldModelCache.set(key, model);
        if (PERF_ENABLED) console.info(`[PerfAsset] ${key} ${model ? 'loaded' : 'failed'} in ${(performance.now() - requestStartedAt).toFixed(1)} ms`);
        return model;
    });
    worldModelPromises.set(key, promise);
    return promise;
}

function queueWorldVisual(key, x, z, yaw, width, height, depth) {
    worldVisualPlacements.get(key)?.push({ x, z, yaw, width, height, depth });
}

const STATIC_VISUAL_CHUNK_SIZE = CELL * 2;

function addWorldVisualBatch(key, source, placements) {
    source.updateMatrixWorld(true);
    const bounds = new THREE.Box3().setFromObject(source);
    const size = bounds.getSize(new THREE.Vector3());
    if (bounds.isEmpty() || size.x < 1e-5 || size.y < 1e-5 || size.z < 1e-5) {
        console.warn(`[World] Skipped invalid model bounds for ${key}.`);
        return;
    }
    const normalize = new THREE.Matrix4().makeTranslation(
        -(bounds.min.x + bounds.max.x) * 0.5,
        -bounds.min.y,
        -(bounds.min.z + bounds.max.z) * 0.5,
    );
    const chunks = new Map();
    for (const placement of placements) {
        const ix = Math.floor((placement.x + HALF) / STATIC_VISUAL_CHUNK_SIZE);
        const iz = Math.floor((placement.z + HALF) / STATIC_VISUAL_CHUNK_SIZE);
        const chunkKey = `${ix},${iz}`;
        let chunk = chunks.get(chunkKey);
        if (!chunk) {
            chunk = { placements: [], centerX: -HALF + (ix + 0.5) * STATIC_VISUAL_CHUNK_SIZE, centerZ: -HALF + (iz + 0.5) * STATIC_VISUAL_CHUNK_SIZE };
            chunks.set(chunkKey, chunk);
        }
        chunk.placements.push(placement);
    }
    source.traverse(object => {
        if (!object.isMesh || !object.geometry || !object.material) return;
        object.castShadow = false;
        object.receiveShadow = true;
        if (object.material.map) object.material.map.colorSpace = THREE.SRGBColorSpace;
        for (const [chunkKey, chunk] of chunks) {
            const instances = new THREE.InstancedMesh(object.geometry, object.material, chunk.placements.length);
            instances.name = `${key}-${object.name || 'mesh'}-chunk-${chunkKey}`;
            instances.castShadow = false;
            instances.receiveShadow = true;
            instances.instanceMatrix.setUsage(THREE.StaticDrawUsage);
            const transform = new THREE.Matrix4();
            const position = new THREE.Vector3();
            const rotation = new THREE.Quaternion();
            const scale = new THREE.Vector3();
            for (let i = 0; i < chunk.placements.length; i++) {
                const placement = chunk.placements[i];
                position.set(placement.x, 0, placement.z);
                rotation.setFromAxisAngle(UP_AXIS, placement.yaw);
                scale.set(placement.width / size.x, placement.height / size.y, placement.depth / size.z);
                transform.compose(position, rotation, scale).multiply(normalize).multiply(object.matrixWorld);
                instances.setMatrixAt(i, transform);
            }
            instances.instanceMatrix.needsUpdate = true;
            scene.add(instances);
            worldStaticBatches.push({ mesh: instances, centerX: chunk.centerX, centerZ: chunk.centerZ });
        }
    });
}

const UP_AXIS = new THREE.Vector3(0, 1, 0);

function updateWorldShadowCasters(dt) {
    shadowRefreshElapsed += dt;
    if (shadowRefreshElapsed < 0.4) return;
    shadowRefreshElapsed = 0;
    const allowShadows = GRAPHICS_PRESETS[settings.graphics].shadows;
    const rangeSq = 55 * 55;
    for (const batch of worldStaticBatches) {
        const dx = batch.centerX - state.x;
        const dz = batch.centerZ - state.z;
        const shouldCast = allowShadows && dx * dx + dz * dz <= rangeSq;
        if (batch.mesh.castShadow !== shouldCast) batch.mesh.castShadow = shouldCast;
    }
}

async function flushWorldVisuals() {
    const jobs = [];
    for (const [key, placements] of worldVisualPlacements) {
        if (!placements.length) continue;
        jobs.push(loadWorldModel(key).then(source => {
            if (source) addWorldVisualBatch(key, source, placements);
        }));
    }
    await Promise.all(jobs);
    console.info(`[World] Loaded detailed GLB city assets; batched ${[...worldVisualPlacements.values()].reduce((total, entries) => total + entries.length, 0)} static placements.`);
}

function buildTree(x, z) {
    const seed = Math.abs(Math.round(x * 17 + z * 29));
    const broadleaf = seed % 3 !== 0;
    if (broadleaf) {
        const height = 5.7 + (seed % 3) * 0.5;
        const width = 4.4 + (seed % 2) * 0.35;
        queueWorldVisual('planeTree', x, z, (seed % 4) * Math.PI / 2, width, height, width * 0.9);
        addCollider(x, z, 1.3, 1.3);
    } else {
        const height = 7 + (seed % 3) * 0.6;
        queueWorldVisual('cypress', x, z, (seed % 4) * Math.PI / 2, 2.7, height, 2.7);
        addCollider(x, z, 0.9, 0.9);
    }
}

function buildResidentialBuilding(x, z, height, color, yaw = 0) {
    const seed = Math.abs(Math.round(x * 19 + z * 31));
    const modelKey = seed % 7 === 0 ? 'courtyard' : seed % 4 === 0 ? 'townhouse' : 'apartment';
    const targetHeight = modelKey === 'courtyard'
        ? Math.max(8.2, Math.min(9.5, height))
        : modelKey === 'townhouse'
            ? Math.max(10.8, height)
            : Math.max(8.4, height);
    queueWorldVisual(modelKey, x, z, yaw, 9.4, targetHeight, 9.2);
    addCollider(x, z, 9.4, 9.2);
}

function buildMosque(cx, cz) {
    queueWorldVisual('mosque', cx, cz, 0, 14, 18, 14);
    addCollider(cx, cz, 14, 14);
}

function buildRestaurant(x, z, w, faceX, faceZ, color) {
    const yaw = Math.atan2(faceX, faceZ);
    queueWorldVisual('shop', x, z, yaw, w + 1, 7, w);
    addCollider(x, z, w + 1, w);

    const front = new THREE.Vector3(x + faceX * (w / 2 + 3), 0, z + faceZ * (w / 2 + 3));
    const marker = createDestinationMarker(front.x, front.z, false);
    restaurants.push({ pos: front, marker });
}



function buildBlock(bx, bz) {

    const cx = -HALF + bx * CELL + ROAD / 2 + BLOCK / 2 + ROAD / 2;

    const cz = -HALF + bz * CELL + ROAD / 2 + BLOCK / 2 + ROAD / 2;

    const stationSide = GAS_STATION_BLOCKS.get(`${bx},${bz}`);
    if (stationSide) {
        createGasStation(`station-${gasStations.length + 1}`, cx, cz, stationSide);
        return;
    }

    if ((bx === 2 && bz === 2)) {

        buildMosque(cx, cz);

        return;

    }

    // Four lots per block

    let lot = 0;

    for (const [ox, oz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {

        const x = cx + ox * 6.5;

        const z = cz + oz * 6.5;

        const isRest = (bx * 7 + bz * 3 + lot) % 9 === 0;

        if (isRest) {

            buildRestaurant(x, z, 8, ox, 0, 0xfff1d0);

        } else if ((bx + bz + lot) % 7 === 3) {

            buildTree(x, z);

        } else {

            const h = 8 + ((bx * 13 + bz * 7 + lot * 5) % 7);
            const facesBlockStreet = (bx + bz + lot) % 2 === 0;
            const buildingYaw = facesBlockStreet ? (oz > 0 ? 0 : Math.PI) : (ox > 0 ? Math.PI / 2 : -Math.PI / 2);
            buildResidentialBuilding(x, z, h, 0xffffff, buildingYaw);

            const customer = new THREE.Vector3(x, 0, z + oz * 8.5);

            customer.marker = createDestinationMarker(customer.x, customer.z, true);

            customers.push(customer);

        }

        lot++;

    }

    buildTree(cx + BLOCK / 2 - 1, cz + BLOCK / 2 - 1);
    if ((bx + bz) % 4 === 0) {
        queueWorldVisual('streetlamp', cx - BLOCK / 2 + 0.9, cz + BLOCK / 2 - 0.9, Math.PI, 0.9, 5.2, 0.9);
    }

}

function createGasStation(id, x, z, entranceSide = 'north') {
    const root = new THREE.Group();
    root.position.set(x, 0, z);
    const facing = { north: 0, south: Math.PI, west: Math.PI / 2, east: -Math.PI / 2 }[entranceSide] ?? 0;
    root.rotation.y = facing;
    scene.add(root);

    // A real paved forecourt and a clear driveway connect each parcel directly
    // to its neighboring street; the interaction target is beside the pumps.
    const forecourt = new THREE.Mesh(new THREE.PlaneGeometry(25.5, 25.5), mat(0x77756d));
    forecourt.rotation.x = -Math.PI / 2;
    forecourt.position.y = 0.27;
    forecourt.receiveShadow = true;
    root.add(forecourt);
    const driveway = new THREE.Mesh(new THREE.PlaneGeometry(5.2, 13.5), mat(0x41474b));
    driveway.rotation.x = -Math.PI / 2;
    driveway.position.set(5.5, 0.29, -9.5);
    driveway.receiveShadow = true;
    root.add(driveway);
    for (const edgeX of [2.8, 8.2]) {
        box(0.18, 0.13, 9.2, 0xe4d7b9, edgeX, 0.35, -10.1, root);
    }
    box(17, 0.12, 0.5, 0xc4b899, 0, 0.36, -12.65, root);
    box(17, 0.12, 0.5, 0xc4b899, 0, 0.36, 12.65, root);

    // Reuse the detailed neighborhood storefront GLB and turn its entrance
    // toward the existing fuel forecourt without changing station gameplay.
    const stationShopPosition = new THREE.Vector3(0, 0, 7.2)
        .applyAxisAngle(new THREE.Vector3(0, 1, 0), facing)
        .add(root.position);
    queueWorldVisual('shop', stationShopPosition.x, stationShopPosition.z, facing + Math.PI, 12.4, 6.2, 7.4);

    // Brand-style roadside pylon and bright forecourt canopy.
    box(0.42, 4.4, 0.42, 0x263e50, -8.8, 2.5, -7.9, root);
    box(2.8, 1.55, 0.34, 0xf6f1e5, -8.8, 4.25, -7.9, root);
    box(2.8, 0.38, 0.42, 0xd84335, -8.8, 5.05, -7.9, root);
    box(2.55, 0.7, 0.12, 0x17445b, -8.8, 4.25, -7.68, root);
    box(0.85, 0.12, 0.14, 0xffd04a, -8.8, 4.23, -7.59, root);

    for (const canopyX of [-4.8, 4.8]) {
        for (const canopyZ of [-4.4, 2.4]) {
            const column = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.2, 3.6, 10), mat(0xf4eee0));
            column.position.set(canopyX, 1.95, canopyZ);
            column.castShadow = true;
            root.add(column);
        }
    }
    box(11.2, 0.4, 8.4, 0xf3efe6, 0, 3.8, -1.0, root);
    box(11.3, 0.45, 0.18, 0xd84335, 0, 3.38, -5.15, root);
    box(11.3, 0.45, 0.18, 0x1f7795, 0, 3.38, 3.15, root);
    box(4.2, 0.18, 0.22, 0xf5d366, 0, 4.1, -5.15, root);

    const pumpGeometry = new THREE.BoxGeometry(0.9, 1.5, 0.78);
    const pumpFrontMaterial = new THREE.MeshLambertMaterial({ color: 0x236b8c });
    const pumpPositions = [[-2.75, -1.3], [2.75, -1.3]];
    for (const [pumpX, pumpZ] of pumpPositions) {
        box(1.15, 0.16, 1.05, 0x9a9993, pumpX, 0.4, pumpZ, root);
        const pump = new THREE.Mesh(pumpGeometry, mat(0xecece4));
        pump.position.set(pumpX, 1.2, pumpZ);
        pump.castShadow = true;
        root.add(pump);
        box(0.64, 0.24, 0.1, 0x26333c, pumpX, 1.45, pumpZ - 0.4, root);
        box(0.56, 0.42, 0.1, 0x236b8c, pumpX, 1.08, pumpZ - 0.41, root);
        box(0.82, 0.1, 0.82, 0xd84335, pumpX, 1.98, pumpZ, root);
        const hoseCurve = new THREE.CatmullRomCurve3([
            new THREE.Vector3(pumpX + 0.42, 1.75, pumpZ),
            new THREE.Vector3(pumpX + 0.78, 1.55, pumpZ - 0.1),
            new THREE.Vector3(pumpX + 0.8, 0.72, pumpZ - 0.13),
            new THREE.Vector3(pumpX + 0.56, 0.55, pumpZ - 0.2),
        ]);
        const hose = new THREE.Mesh(new THREE.TubeGeometry(hoseCurve, 8, 0.045, 5, false), mat(0x24292d));
        root.add(hose);
        box(0.12, 0.44, 0.1, 0x262c2e, pumpX + 0.55, 0.69, pumpZ - 0.2, root);
    }

    const interactionPoint = new THREE.Vector3(0, 0, -2.15).applyAxisAngle(new THREE.Vector3(0, 1, 0), facing).add(root.position);
    const interactionRing = new THREE.Mesh(
        new THREE.RingGeometry(4.15, 4.45, 40),
        new THREE.MeshBasicMaterial({ color: 0x31d891, transparent: true, opacity: 0.9, side: THREE.DoubleSide, depthWrite: false }),
    );
    interactionRing.rotation.x = -Math.PI / 2;
    interactionRing.position.set(interactionPoint.x, 0.32, interactionPoint.z);
    interactionRing.renderOrder = 3;
    scene.add(interactionRing);

    const buildingLocalCenter = new THREE.Vector3(0, 0, 7.2).applyAxisAngle(new THREE.Vector3(0, 1, 0), facing).add(root.position);
    const swapAxes = Math.abs(Math.sin(facing)) > 0.5;
    addCollider(buildingLocalCenter.x, buildingLocalCenter.z, swapAxes ? 7.4 : 12.4, swapAxes ? 12.4 : 7.4);

    gasStations.push({ id, pos: interactionPoint, root, marker: interactionRing, entranceSide, radius: 4.8 });
}

buildGround();

for (let bx = 0; bx < GRID; bx++) {

    for (let bz = 0; bz < GRID; bz++) {

        buildBlock(bx, bz);

    }

}

buildColliderSpatialIndex();
void flushWorldVisuals();

if (gasStations.length !== 3) throw new Error('The city must contain exactly three physical fuel stations.');
for (const station of gasStations) {
    const nearestRoadDistance = Math.min(...ROAD_LINES.map(line => Math.min(Math.abs(station.pos.x - line), Math.abs(station.pos.z - line))));
    if (nearestRoadDistance < 1.5) throw new Error(`Fuel interaction point ${station.id} was placed on a road.`);
}

// Ambient traffic keeps the original lane loops and speeds, but now uses real
// GLB bodies with distinct sedan/van proportions and matching OBB footprints.
let trafficCars = [];
function fitTrafficVehicleModel(source, car) {
    const model = source.clone(true);
    let bounds = new THREE.Box3().setFromObject(model);
    let size = bounds.getSize(new THREE.Vector3());
    if (size.x > size.z * 1.15) {
        model.rotation.y += Math.PI / 2;
        bounds = new THREE.Box3().setFromObject(model);
        size = bounds.getSize(new THREE.Vector3());
    }
    const target = car.type === 'van'
        ? { width: 2.02, height: 2.28, length: 4.75 }
        : { width: 1.9, height: 1.55, length: 4.3 };
    model.scale.set(target.width / size.x, target.height / size.y, target.length / size.z);
    bounds = new THREE.Box3().setFromObject(model);
    model.position.x -= (bounds.min.x + bounds.max.x) * 0.5;
    model.position.z -= (bounds.min.z + bounds.max.z) * 0.5;
    model.position.y -= bounds.min.y;
    car.wheelMeshes = [];
    model.traverse(object => {
        if (!object.isMesh) return;
        object.castShadow = true;
        object.receiveShadow = true;
        if (/(wheel|tire|tyre|rim)/i.test(object.name)) car.wheelMeshes.push(object);
        if (object.material?.map) object.material.map.colorSpace = THREE.SRGBColorSpace;
    });
    return model;
}

function createTrafficCar(axis, line, lane, coordinate, direction, speed, color, type = 'sedan') {
    const root = new THREE.Group();
    root.rotation.y = axis === 'x' ? (direction > 0 ? Math.PI / 2 : -Math.PI / 2) : (direction > 0 ? 0 : Math.PI);
    const car = {
        root, axis, line, lane, coordinate, direction, speed, type,
        halfWidth: type === 'van' ? 1.01 : 0.95,
        halfLength: type === 'van' ? 2.38 : 2.15,
        wheelMeshes: [],
    };
    if (DEBUG_COLLIDERS) {
        const footprint = new THREE.Mesh(
            new THREE.BoxGeometry(car.halfWidth * 2, 0.035, car.halfLength * 2),
            new THREE.MeshBasicMaterial({ color: 0xff3030, wireframe: true, depthTest: false }),
        );
        footprint.position.y = 0.08;
        root.add(footprint);
    }
    scene.add(root);
    trafficCars.push(car);
    placeTrafficCar(car);
    loadWorldModel(type === 'van' ? 'van' : 'sedan').then(source => {
        if (!source) return;
        root.add(fitTrafficVehicleModel(source, car));
    });
}
function placeTrafficCar(car) {
    if (car.axis === 'x') car.root.position.set(car.coordinate, 0, car.line + car.lane);
    else car.root.position.set(car.line + car.lane, 0, car.coordinate);
}
function updateTraffic(dt) {
    const limit = HALF - 2;
    for (const car of trafficCars) {
        car.coordinate += car.direction * car.speed * dt;
        if (car.coordinate > limit) car.coordinate = -limit;
        else if (car.coordinate < -limit) car.coordinate = limit;
        placeTrafficCar(car);
        for (const wheel of car.wheelMeshes) wheel.rotateX(car.direction * car.speed * dt / 0.36);
    }
}
function orientedFootprintsOverlap(ax, az, aHeading, aHalfWidth, aHalfLength, bx, bz, bHeading, bHalfWidth, bHalfLength) {
    const dx = bx - ax;
    const dz = bz - az;
    const cosA = Math.cos(aHeading);
    const sinA = Math.sin(aHeading);
    const cosB = Math.cos(bHeading);
    const sinB = Math.sin(bHeading);
    const absCos = Math.abs(cosA * cosB + sinA * sinB);
    const absSin = Math.abs(sinA * cosB - cosA * sinB);
    let distance = Math.abs(dx * cosA - dz * sinA);
    let radiusA = aHalfWidth;
    let radiusB = bHalfWidth * absCos + bHalfLength * absSin;
    if (distance >= radiusA + radiusB - 0.0001) return false;

    distance = Math.abs(dx * sinA + dz * cosA);
    radiusA = aHalfLength;
    radiusB = bHalfWidth * absSin + bHalfLength * absCos;
    if (distance >= radiusA + radiusB - 0.0001) return false;

    distance = Math.abs(dx * cosB - dz * sinB);
    radiusA = aHalfWidth * absCos + aHalfLength * absSin;
    radiusB = bHalfWidth;
    if (distance >= radiusA + radiusB - 0.0001) return false;

    distance = Math.abs(dx * sinB + dz * cosB);
    radiusA = aHalfWidth * absSin + aHalfLength * absCos;
    radiusB = bHalfLength;
    if (distance >= radiusA + radiusB - 0.0001) return false;
    return true;
}

function trafficCollisionAt(x, z, heading = state.heading) {
    for (const car of trafficCars) {
        if (PERF_ENABLED) perfTrafficObbTests++;
        if (orientedFootprintsOverlap(
            x, z, heading, BIKE_HALF_WIDTH, BIKE_HALF_LENGTH,
            car.root.position.x, car.root.position.z, car.root.rotation.y, car.halfWidth, car.halfLength,
        )) return car;
    }
    return null;
}

function runTrafficFootprintChecks() {
    const overlaps = (x, z, carHeading = 0) => orientedFootprintsOverlap(
        0, 0, 0, BIKE_HALF_WIDTH, BIKE_HALF_LENGTH,
        x, z, carHeading, 0.95, 2.15,
    );
    const results = {
        nearPass: !overlaps(1.41, 0),
        narrowGap: !overlaps(0, 3.3),
        physicalContact: overlaps(1.2, 0),
        turningVehicle: overlaps(1.2, 0, Math.PI / 4),
    };
    if (Object.values(results).some(result => !result)) {
        throw new Error('Traffic oriented-footprint self-check failed.');
    }
    console.info('[Collision] OBB checks passed: close pass, narrow gap, genuine overlap, and rotated vehicle.');
}
runTrafficFootprintChecks();
[

    ['x', ROAD_LINES[1], -1.8, -78, 1, 5.8, 0xd9544d, 'sedan'],
    ['x', ROAD_LINES[2], 1.8, 18, -1, 6.7, 0xe5c04f, 'van'],
    ['x', ROAD_LINES[4], -1.8, 70, 1, 5.2, 0x4c91c4, 'sedan'],
    ['x', ROAD_LINES[5], 1.8, -12, -1, 6.1, 0x68a979, 'van'],
    ['z', ROAD_LINES[0], 1.8, 54, -1, 5.5, 0xd99542, 'sedan'],
    ['z', ROAD_LINES[2], -1.8, -74, 1, 6.4, 0xa879c2, 'sedan'],
    ['z', ROAD_LINES[4], 1.8, 4, 1, 5.7, 0x45a9a1, 'van'],
    ['z', ROAD_LINES[5], -1.8, -42, -1, 6.2, 0xd66c83, 'sedan'],
].forEach(config => createTrafficCar(...config));

// ---------- Scooter ----------

const bike = new THREE.Group();

scene.add(bike);

const bikeVisual = new THREE.Group();

bike.add(bikeVisual);

if (DEBUG_COLLIDERS) {
    const footprint = new THREE.Mesh(
        new THREE.BoxGeometry(BIKE_HALF_WIDTH * 2, 0.04, BIKE_HALF_LENGTH * 2),
        new THREE.MeshBasicMaterial({ color: 0x35a7ff, wireframe: true, depthTest: false }),
    );
    footprint.position.y = 0.1;
    bike.add(footprint);
}

bikeVisual.visible = false;



const motorcycleGLTFLoader = new GLTFLoader();
const motorcycleModelCache = new Map();
const motorcycleModelPromises = new Map();
let bikeModelRequest = 0;
let selectedDealerModelKey = 'moto-50-classic';
let dealerPreviewRenderer = null;
let dealerPreviewScene = null;
let dealerPreviewCamera = null;
let dealerPreviewTurntable = null;
let dealerPreviewBike = null;
let dealerPreviewSize = { width: 0, height: 0 };

function loadMotorcycleModel(modelKey) {
    if (motorcycleModelCache.has(modelKey)) return Promise.resolve(motorcycleModelCache.get(modelKey));
    if (motorcycleModelPromises.has(modelKey)) return motorcycleModelPromises.get(modelKey);
    const catalogItem = getMotorcycleModel(modelKey);
    const requestStartedAt = PERF_ENABLED ? performance.now() : 0;
    const load = new Promise((resolve, reject) => {
        motorcycleGLTFLoader.load(catalogItem.asset, gltf => {
            loadedTextureRoots.add(gltf.scene);
            applyTextureBudget(gltf.scene, GRAPHICS_PRESETS[settings.graphics]);
            resolve(gltf.scene);
        }, undefined, reject);
    }).then(model => {
        motorcycleModelCache.set(catalogItem.key, model);
        motorcycleModelPromises.delete(catalogItem.key);
        if (PERF_ENABLED) console.info(`[PerfAsset] motorcycle:${catalogItem.key} loaded in ${(performance.now() - requestStartedAt).toFixed(1)} ms`);
        return model;
    }).catch(error => {
        motorcycleModelPromises.delete(catalogItem.key);
        if (PERF_ENABLED) console.info(`[PerfAsset] motorcycle:${catalogItem.key} failed after ${(performance.now() - requestStartedAt).toFixed(1)} ms`);
        console.warn(`[Motosiklet] ${catalogItem.name} modeli yüklenemedi.`, error);
        return null;
    });
    motorcycleModelPromises.set(catalogItem.key, load);
    return load;
}

function fitMotorcycleModel(source) {
    const model = source.clone(true);
    const initialSize = new THREE.Box3().setFromObject(model).getSize(new THREE.Vector3());
    if (initialSize.x > initialSize.z * 1.15) model.rotation.y += Math.PI / 2;
    let bounds = new THREE.Box3().setFromObject(model);
    const size = bounds.getSize(new THREE.Vector3());
    model.scale.setScalar(2.0 / Math.max(size.x, size.y, size.z, 0.001));
    bounds = new THREE.Box3().setFromObject(model);
    model.position.x -= (bounds.min.x + bounds.max.x) * 0.5;
    model.position.z -= (bounds.min.z + bounds.max.z) * 0.5;
    model.position.y -= bounds.min.y;
    model.traverse(object => {
        if (!object.isMesh) return;
        object.castShadow = true;
        object.receiveShadow = true;
        if (object.material?.map) object.material.map.colorSpace = THREE.SRGBColorSpace;
    });
    return model;
}

async function setPlayerMotorcycleVisual(modelKey) {
    const requestId = ++bikeModelRequest;
    const source = await loadMotorcycleModel(modelKey);
    if (!source || requestId !== bikeModelRequest) return;
    bikeVisual.clear();
    bikeVisual.add(fitMotorcycleModel(source));
    bikeVisual.visible = true;
}

function initDealerPreview() {
    const stage = document.querySelector('.dealer-preview-stage');
    if (!stage) return false;
    if (dealerPreviewRenderer) {
        if (dealerPreviewRenderer.domElement.parentElement !== stage) stage.appendChild(dealerPreviewRenderer.domElement);
        resizeDealerPreview();
        return true;
    }
    try {
        dealerPreviewRenderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
        dealerPreviewRenderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.25));
        dealerPreviewRenderer.shadowMap.enabled = true;
        dealerPreviewRenderer.shadowMap.type = THREE.BasicShadowMap;
        dealerPreviewRenderer.domElement.setAttribute('aria-label', 'Seçili motosikletin döndürülebilir 3B önizlemesi');
        dealerPreviewScene = new THREE.Scene();
        dealerPreviewScene.background = new THREE.Color(0x152232);
        dealerPreviewScene.add(new THREE.HemisphereLight(0xd9efff, 0x4c3e2d, 2.1));
        const keyLight = new THREE.DirectionalLight(0xffe0b2, 3.1);
        keyLight.position.set(-4, 7, 5);
        keyLight.castShadow = true;
        dealerPreviewScene.add(keyLight);
        const fillLight = new THREE.DirectionalLight(0x8bc9ff, 1.4);
        fillLight.position.set(4, 3, -4);
        dealerPreviewScene.add(fillLight);
        const platform = new THREE.Mesh(new THREE.CylinderGeometry(2.2, 2.3, 0.16, 48), new THREE.MeshStandardMaterial({ color: 0x3b4b5b, metalness: 0.28, roughness: 0.62 }));
        platform.position.y = -0.1;
        platform.receiveShadow = true;
        dealerPreviewScene.add(platform);
        const edge = new THREE.Mesh(new THREE.TorusGeometry(2.05, 0.025, 8, 56), new THREE.MeshBasicMaterial({ color: 0xffcf3f }));
        edge.rotation.x = Math.PI / 2;
        edge.position.y = 0.0;
        dealerPreviewScene.add(edge);
        dealerPreviewTurntable = new THREE.Group();
        dealerPreviewScene.add(dealerPreviewTurntable);
        dealerPreviewBike = new THREE.Group();
        dealerPreviewTurntable.add(dealerPreviewBike);
        dealerPreviewCamera = new THREE.PerspectiveCamera(36, 1, 0.1, 50);
        dealerPreviewCamera.position.set(3.2, 2.15, 4.8);
        dealerPreviewCamera.lookAt(0, 0.82, 0);
        dealerPreviewRenderer.domElement.addEventListener('pointerdown', event => {
            dealerPreviewRenderer.domElement.setPointerCapture(event.pointerId);
            dealerPreviewRenderer.domElement.dataset.dragX = String(event.clientX);
        });
        dealerPreviewRenderer.domElement.addEventListener('pointermove', event => {
            if (event.buttons !== 1 || !dealerPreviewTurntable) return;
            const previousX = Number(dealerPreviewRenderer.domElement.dataset.dragX || event.clientX);
            dealerPreviewTurntable.rotation.y += (event.clientX - previousX) * 0.012;
            dealerPreviewRenderer.domElement.dataset.dragX = String(event.clientX);
        });
        stage.appendChild(dealerPreviewRenderer.domElement);
        resizeDealerPreview();
        return true;
    } catch (error) {
        console.warn('[Bayi] 3B önizleme oluşturulamadı; satın alma ve katalog kullanılabilir.', error);
        dealerPreviewRenderer = null;
        return false;
    }
}

function resizeDealerPreview() {
    if (!dealerPreviewRenderer || !dealerPreviewCamera) return;
    const stage = dealerPreviewRenderer.domElement.parentElement;
    if (!stage) return;
    const rect = stage.getBoundingClientRect();
    const width = Math.max(1, Math.round(rect.width));
    const height = Math.max(1, Math.round(rect.height));
    if (width === dealerPreviewSize.width && height === dealerPreviewSize.height) return;
    dealerPreviewSize = { width, height };
    dealerPreviewRenderer.setSize(width, height, false);
    dealerPreviewCamera.aspect = width / height;
    dealerPreviewCamera.updateProjectionMatrix();
}

async function showDealerPreview(modelKey) {
    selectedDealerModelKey = getMotorcycleModel(modelKey).key;
    const catalogItem = getMotorcycleModel(selectedDealerModelKey);
    const classSpec = MOTORCYCLE_CLASSES[catalogItem.classKey];
    const ready = initDealerPreview();
    document.querySelectorAll('.dealer-model-card').forEach(card => card.classList.toggle('selected', card.dataset.model === selectedDealerModelKey));
    document.querySelectorAll('[data-action="dealer-select"]').forEach(button => {
        const selected = button.dataset.model === selectedDealerModelKey;
        button.setAttribute('aria-pressed', String(selected));
        button.textContent = selected ? 'Seçili model' : '3B önizle';
    });
    const title = document.getElementById('dealer-preview-title');
    const details = document.getElementById('dealer-preview-details');
    const purchaseButton = document.getElementById('dealer-preview-buy');
    const purchaseNote = document.getElementById('dealer-purchase-note');
    if (title) title.textContent = catalogItem.name;
    if (details) details.textContent = `${classSpec.label} · ${catalogItem.style} · ${formatMoney(classSpec.retailPrice)} · Depo ${classSpec.tankLiters} L · Azami ${Math.round(classSpec.maxSpeed * 3.6)} km/sa`;
    if (purchaseButton) {
        purchaseButton.dataset.model = catalogItem.key;
        purchaseButton.disabled = playerState.shiftActive || playerState.motorcycles.length >= playerState.garageCapacity
            || classSpec.retailPrice === null || game.money < classSpec.retailPrice;
    }
    if (purchaseNote) {
        purchaseNote.textContent = playerState.shiftActive ? 'Vardiya sırasında motosiklet satın alınamaz.'
            : playerState.motorcycles.length >= playerState.garageCapacity ? `Garaj dolu (${playerState.motorcycles.length}/${playerState.garageCapacity}); önce kapasite artır.`
                : game.money < classSpec.retailPrice ? `Bakiye yetersiz · Gerekli: ${formatMoney(classSpec.retailPrice)} · Mevcut: ${formatMoney(game.money)}`
                    : `Garaj kapasitesi ${playerState.motorcycles.length}/${playerState.garageCapacity} · Satın alma sonrası mevcut motosikletin aktif kalır.`;
    }
    if (!ready) return;
    const selectedKey = selectedDealerModelKey;
    const model = await loadMotorcycleModel(selectedKey);
    if (!model || selectedDealerModelKey !== selectedKey || !dealerPreviewBike) return;
    dealerPreviewBike.clear();
    dealerPreviewBike.add(fitMotorcycleModel(model));
    resizeDealerPreview();
}





const state = { x: 5, z: 0, heading: 0, speed: 0, lean: 0 };

bike.position.set(state.x, 0, state.z);

// ---------- Cached world-faithful minimap ----------

const minimapCanvas = document.getElementById('minimap-canvas');
const minimapContext = minimapCanvas.getContext('2d', { alpha: false });
const minimapBase = document.createElement('canvas');
minimapBase.width = 512;
minimapBase.height = 512;
const minimapBaseContext = minimapBase.getContext('2d', { alpha: false });
const MINIMAP_EDGE = HALF + ROAD;
const MINIMAP_MARGIN = 7;
const MINIMAP_WORLD_SPAN = MINIMAP_EDGE * 2;
const minimapPhaseLabel = document.getElementById('minimap-phase');
let minimapPixelRatio = 1;
let minimapTransform = { scale: 1, offsetX: 0, offsetY: 0 };
let previousMinimapPhaseLabel = '';

function buildMinimapBase() {

    if (!minimapBaseContext) return;

    const ctx = minimapBaseContext;
    const scale = minimapBase.width / (MINIMAP_WORLD_SPAN + MINIMAP_MARGIN * 2);
    const mapX = worldX => (MINIMAP_MARGIN + worldX + MINIMAP_EDGE) * scale;
    const mapY = worldZ => (MINIMAP_MARGIN + worldZ + MINIMAP_EDGE) * scale;
    const worldRect = (x, z, width, depth) => ctx.fillRect(mapX(x), mapY(z), width * scale, depth * scale);

    ctx.fillStyle = '#4a4d55';
    ctx.fillRect(0, 0, minimapBase.width, minimapBase.height);

    // Match the six real sidewalk slabs created by buildBlock().
    ctx.fillStyle = '#cfc6b4';
    for (let bx = 0; bx < GRID; bx++) {
        for (let bz = 0; bz < GRID; bz++) {
            const centerX = -HALF + bx * CELL + ROAD / 2 + BLOCK / 2 + ROAD / 2;
            const centerZ = -HALF + bz * CELL + ROAD / 2 + BLOCK / 2 + ROAD / 2;
            worldRect(centerX - BLOCK / 2, centerZ - BLOCK / 2, BLOCK, BLOCK);
        }
    }

    // Road strips use the same centers and width as the existing city grid.
    ctx.fillStyle = '#29333b';
    for (const line of ROAD_LINES) {
        worldRect(line - ROAD / 2, -HALF, ROAD, HALF * 2);
        worldRect(-HALF, line - ROAD / 2, HALF * 2, ROAD);
    }

    // Small center dashes follow the real lane-marking spacing and lengths.
    ctx.fillStyle = '#e7d8a4';
    for (const line of ROAD_LINES) {
        for (let along = -HALF; along < HALF; along += 6) {
            worldRect(line - 0.15, along - 1.25, 0.3, 2.5);
            worldRect(along - 1.25, line - 0.15, 2.5, 0.3);
        }
    }

    // Existing colliders are the actual building, tree and mosque footprints.
    for (const collider of colliders) {
        const width = collider.maxX - collider.minX;
        const depth = collider.maxZ - collider.minZ;
        if (width > 28 || depth > 28) continue;
        const centerX = (collider.minX + collider.maxX) * 0.5;
        const centerZ = (collider.minZ + collider.maxZ) * 0.5;
        if (width <= 1.5 && depth <= 1.5) {
            ctx.fillStyle = '#438456';
            ctx.beginPath();
            ctx.arc(mapX(centerX), mapY(centerZ), Math.max(width, depth) * scale * 0.65, 0, Math.PI * 2);
            ctx.fill();
        } else {
            ctx.fillStyle = '#66737a';
            worldRect(collider.minX, collider.minZ, width, depth);
            ctx.strokeStyle = 'rgba(15,25,32,.65)';
            ctx.lineWidth = 1.2;
            ctx.strokeRect(mapX(collider.minX), mapY(collider.minZ), width * scale, depth * scale);
        }
    }

    // The boundary matches the actual outer collision walls. Static POIs are
    // baked into this one cached layer; only the active objective and rider move.
    ctx.strokeStyle = '#f2cb68';
    ctx.lineWidth = 2.5;
    ctx.strokeRect(mapX(-MINIMAP_EDGE), mapY(-MINIMAP_EDGE), MINIMAP_WORLD_SPAN * scale, MINIMAP_WORLD_SPAN * scale);

    for (const restaurant of restaurants) {
        ctx.beginPath();
        ctx.arc(mapX(restaurant.pos.x), mapY(restaurant.pos.z), 5, 0, Math.PI * 2);
        ctx.fillStyle = '#20df78';
        ctx.fill();
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 1.5;
        ctx.stroke();
    }
    for (const customer of customers) {
        ctx.beginPath();
        ctx.arc(mapX(customer.x), mapY(customer.z), 3.7, 0, Math.PI * 2);
        ctx.fillStyle = '#ffd33d';
        ctx.fill();
        ctx.strokeStyle = 'rgba(255,255,255,.9)';
        ctx.lineWidth = 1;
        ctx.stroke();
    }
    for (const station of gasStations) {
        const x = mapX(station.pos.x);
        const y = mapY(station.pos.z);
        ctx.fillStyle = '#087c9e';
        ctx.beginPath();
        ctx.arc(x, y, 7, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 1.5;
        ctx.stroke();
        ctx.fillStyle = '#fff';
        ctx.fillRect(x - 2, y - 3.6, 4, 7.2);
        ctx.fillStyle = '#087c9e';
        ctx.fillRect(x - 1.2, y - 2.6, 2.4, 2);
    }
}

function resizeMinimap() {

    const rect = minimapCanvas.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;

    const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
    const width = Math.max(1, Math.round(rect.width * pixelRatio));
    const height = Math.max(1, Math.round(rect.height * pixelRatio));
    if (minimapCanvas.width !== width || minimapCanvas.height !== height) {
        minimapCanvas.width = width;
        minimapCanvas.height = height;
    }
    minimapPixelRatio = pixelRatio;
    const scale = Math.min(width, height) / (MINIMAP_WORLD_SPAN + MINIMAP_MARGIN * 2);
    const imageSize = (MINIMAP_WORLD_SPAN + MINIMAP_MARGIN * 2) * scale;
    minimapTransform = {
        scale,
        offsetX: (width - imageSize) * 0.5 + MINIMAP_MARGIN * scale,
        offsetY: (height - imageSize) * 0.5 + MINIMAP_MARGIN * scale,
    };
}

function minimapPoint(worldX, worldZ) {
    return {
        x: minimapTransform.offsetX + (worldX + MINIMAP_EDGE) * minimapTransform.scale,
        y: minimapTransform.offsetY + (worldZ + MINIMAP_EDGE) * minimapTransform.scale,
    };
}

function drawMinimapObjective(worldX, worldZ, color) {
    const { x, y } = minimapPoint(worldX, worldZ);
    const radius = 5.2 * minimapPixelRatio;
    minimapContext.beginPath();
    minimapContext.arc(x, y, radius + 2.5 * minimapPixelRatio, 0, Math.PI * 2);
    minimapContext.fillStyle = 'rgba(8,18,27,.92)';
    minimapContext.fill();
    minimapContext.beginPath();
    minimapContext.arc(x, y, radius, 0, Math.PI * 2);
    minimapContext.fillStyle = color;
    minimapContext.fill();
    minimapContext.lineWidth = 1.5 * minimapPixelRatio;
    minimapContext.strokeStyle = '#fff';
    minimapContext.stroke();
}

function drawMinimap() {

    if (!minimapContext || minimapCanvas.width <= 0) return;

    const ctx = minimapContext;
    const width = minimapCanvas.width;
    const height = minimapCanvas.height;
    const imageSize = (MINIMAP_WORLD_SPAN + MINIMAP_MARGIN * 2) * minimapTransform.scale;
    const imageX = (width - imageSize) * 0.5;
    const imageY = (height - imageSize) * 0.5;

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#18313d';
    ctx.fillRect(0, 0, width, height);
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, width, height);
    ctx.clip();
    ctx.drawImage(minimapBase, imageX, imageY, imageSize, imageSize);

    let phaseLabel = 'BEKLEMEDE';
    if (game.phase === 'pickup') phaseLabel = 'RESTORAN';
    else if (game.phase === 'deliver') phaseLabel = 'MÜŞTERİ';
    if (phaseLabel !== previousMinimapPhaseLabel) {
        minimapPhaseLabel.textContent = phaseLabel;
        previousMinimapPhaseLabel = phaseLabel;
    }

    if (game.phase === 'pickup' && game.restaurant) {
        drawMinimapObjective(game.restaurant.pos.x, game.restaurant.pos.z, '#20df78');
    } else if (game.phase === 'deliver' && game.customer) {
        drawMinimapObjective(game.customer.x, game.customer.z, '#ffd33d');
    }

    const { x: playerX, y: playerY } = minimapPoint(state.x, state.z);
    const arrowSize = 7 * minimapPixelRatio;
    ctx.save();
    ctx.translate(playerX, playerY);
    ctx.rotate(Math.PI - state.heading);
    ctx.beginPath();
    ctx.moveTo(0, -arrowSize * 1.45);
    ctx.lineTo(arrowSize, arrowSize);
    ctx.lineTo(0, arrowSize * 0.48);
    ctx.lineTo(-arrowSize, arrowSize);
    ctx.closePath();
    ctx.fillStyle = '#36a8ff';
    ctx.fill();
    ctx.lineWidth = 1.6 * minimapPixelRatio;
    ctx.strokeStyle = '#fff';
    ctx.stroke();
    ctx.restore();
    ctx.restore();

    ctx.fillStyle = 'rgba(7,17,27,.8)';
    ctx.beginPath();
    ctx.arc(width - 12 * minimapPixelRatio, 12 * minimapPixelRatio, 8 * minimapPixelRatio, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.font = `800 ${9 * minimapPixelRatio}px Inter, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('K', width - 12 * minimapPixelRatio, 12 * minimapPixelRatio);
}

buildMinimapBase();
resizeMinimap();
window.addEventListener('resize', resizeMinimap, { passive: true });

const MAX_SPEED = 20;

const MAX_REVERSE = -5;

const scooterForward = new THREE.Vector3();

const scooterRight = new THREE.Vector3();

function setScooterBasis(heading, forward, right) {

    forward.set(Math.sin(heading), 0, Math.cos(heading));

    right.set(Math.cos(heading), 0, -Math.sin(heading));

}





/*
function updateNavigationIndicator() {

    const active = game.running && (game.phase === 'pickup' || game.phase === 'deliver');

    const isDelivery = game.phase === 'deliver';

    // Track only the marker currently made visible for this mission phase. Its
    // world position is also the origin of the matching visible destination beam.

    const marker = isDelivery ? game.customer?.marker : game.restaurant?.marker;

    const beam = isDelivery ? deliveryBeam : pickupBeam;

    if (!active || !marker?.visible || !beam.visible) {

        navigationIndicator.hidden = true;

        return;

    }

    bike.getWorldPosition(navigationBikeWorld);

    marker.getWorldPosition(navigationTargetWorld);

    scooterToPoint.subVectors(navigationTargetWorld, navigationBikeWorld).setY(0);

    if (scooterToPoint.lengthSq() < 1e-10) {

        navigationIndicator.hidden = true;

        return;

    }

    getScooterWorldBasis(scooterForward, scooterRight);

    const bearing = scooterRelativeBearing(scooterToPoint, scooterForward, scooterRight);

    // The SVG tip points up by default; CSS positive rotation is clockwise, so
    // a positive scooter-relative bearing correctly points the graphic right.

    navigationArrow.style.transform = `rotate(${bearing}rad)`;

    navigationIndicator.classList.toggle('delivery', isDelivery);

    navigationIndicator.classList.toggle('pickup', !isDelivery);

    camera.updateMatrixWorld();

    navigationAnchor.set(navigationBikeWorld.x, navigationBikeWorld.y + 1.7, navigationBikeWorld.z).project(camera);

    const screenX = THREE.MathUtils.clamp((navigationAnchor.x * 0.5 + 0.5) * window.innerWidth, 38, window.innerWidth - 38);

    const projectedY = (navigationAnchor.y * -0.5 + 0.5) * window.innerHeight;

    const screenY = THREE.MathUtils.clamp(projectedY - 10, 86, window.innerHeight - 150);

    navigationIndicator.style.left = `${screenX}px`;

    navigationIndicator.style.top = `${screenY}px`;

    navigationIndicator.hidden = false;

}



*/

function syncDestinationMarkers(phase, restaurant, customer) {

    for (const candidate of restaurants) {

        candidate.marker.visible = phase === 'pickup' && candidate === restaurant;

    }

    for (const candidate of customers) {

        candidate.marker.visible = phase === 'deliver' && candidate === customer;

    }

    pickupBeam.visible = phase === 'pickup' && Boolean(restaurant);

    if (restaurant) pickupBeam.position.set(restaurant.pos.x, 0, restaurant.pos.z);

    deliveryBeam.visible = phase === 'deliver' && Boolean(customer);

    if (customer) deliveryBeam.position.set(customer.x, 0, customer.z);

}



function runDestinationMarkerSelfChecks() {

    const restaurant = restaurants[0];

    const customer = customers[0];

    if (!restaurant || !customer) throw new Error('Pickup/delivery destination markers need valid targets.');

    for (const candidate of restaurants) {

        const marker = candidate.marker;

        if (marker.parent !== scene || marker.children.length !== 2

            || Math.abs(marker.position.x - candidate.pos.x) > 1e-5

            || Math.abs(marker.position.z - candidate.pos.z) > 1e-5) {

            throw new Error('Restaurant marker is not a circular world-space marker at its pickup point.');

        }

    }

    for (const candidate of customers) {

        const marker = candidate.marker;

        if (marker.parent !== scene || marker.children.length !== 2

            || Math.abs(marker.position.x - candidate.x) > 1e-5

            || Math.abs(marker.position.z - candidate.z) > 1e-5) {

            throw new Error('Customer marker is not a circular world-space marker at its delivery point.');

        }

    }



    syncDestinationMarkers('pickup', restaurant, customer);

    if (!restaurant.marker.visible || restaurants.some(r => r !== restaurant && r.marker.visible)

        || customers.some(c => c.marker.visible) || !pickupBeam.visible || deliveryBeam.visible

        || Math.abs(pickupBeam.position.x - restaurant.pos.x) > 1e-5

        || Math.abs(pickupBeam.position.z - restaurant.pos.z) > 1e-5

        || DESTINATION_BEAM_HEIGHT < 22) {

        throw new Error('Pickup stage marker visibility check failed.');

    }

    syncDestinationMarkers('deliver', restaurant, customer);

    if (!customer.marker.visible || customers.some(c => c !== customer && c.marker.visible)

        || restaurants.some(r => r.marker.visible) || !deliveryBeam.visible || pickupBeam.visible

        || Math.abs(deliveryBeam.position.x - customer.x) > 1e-5

        || Math.abs(deliveryBeam.position.z - customer.z) > 1e-5) {

        throw new Error('Delivery stage marker visibility check failed.');

    }

    syncDestinationMarkers('wait', restaurant, customer);

    if (restaurants.some(r => r.marker.visible) || customers.some(c => c.marker.visible)

        || pickupBeam.visible || deliveryBeam.visible) {

        throw new Error('Inactive mission markers should be hidden.');

    }

}



/*
function runNavigationIndicatorSelfChecks() {

    const style = getComputedStyle(navigationIndicator);

    if (navigationIndicator.parentElement !== document.body

        || navigationArrow.tagName.toLowerCase() !== 'svg'

        || style.position !== 'fixed'

        || Math.abs(Number.parseFloat(style.width) - 72) > 0.5

        || style.borderRadius !== '50%'

        || !navigationIndicator.hidden) {

        throw new Error('Screen-space navigation compass size, placement, or initial hidden state check failed.');

    }

    navigationIndicator.classList.add('delivery');

    const deliveryColor = getComputedStyle(navigationIndicator).getPropertyValue('--navigation-color').trim();

    navigationIndicator.classList.remove('delivery');

    const pickupColor = getComputedStyle(navigationIndicator).getPropertyValue('--navigation-color').trim();

    if (pickupColor !== '#ffdf00' || deliveryColor !== '#20f090') {

        throw new Error('Pickup/delivery compass colors are incorrect.');

    }

}



function runGuidanceSelfChecks() {

    runDestinationMarkerSelfChecks();

    runNavigationIndicatorSelfChecks();

    const previous = {

        running: game.running,

        phase: game.phase,

        restaurant: game.restaurant,

        customer: game.customer,

        bikePosition: bike.position.clone(),

        bikeRotation: bike.rotation.clone(),

        indicatorHidden: navigationIndicator.hidden,

        indicatorLeft: navigationIndicator.style.left,

        indicatorTop: navigationIndicator.style.top,

        arrowTransform: navigationArrow.style.transform,

        pickupClass: navigationIndicator.classList.contains('pickup'),

        deliveryClass: navigationIndicator.classList.contains('delivery'),

    };

    const forward = new THREE.Vector3();

    const right = new THREE.Vector3();

    const targetWorld = new THREE.Vector3();

    const beamWorld = new THREE.Vector3();

    const bikeWorld = new THREE.Vector3();

    const toTarget = new THREE.Vector3();

    let renderedChecks = 0;

    try {

        game.running = true;

        game.restaurant = restaurants[0];

        game.customer = customers[0];

        const phases = [

            { phase: 'pickup', marker: () => game.restaurant.marker, beam: pickupBeam },

            { phase: 'deliver', marker: () => game.customer.marker, beam: deliveryBeam },

        ];

        const directions = [

            { bearing: 0, label: 'ahead' },

            { bearing: Math.PI / 2, label: 'right' },

            { bearing: Math.PI, label: 'behind' },

            { bearing: -Math.PI / 2, label: 'left' },

        ];

        for (const stage of phases) {

            game.phase = stage.phase;

            syncDestinationMarkers(game.phase, game.restaurant, game.customer);

            const marker = stage.marker();

            marker.getWorldPosition(targetWorld);

            stage.beam.getWorldPosition(beamWorld);

            if (!marker.visible || !stage.beam.visible

                || Math.hypot(targetWorld.x - beamWorld.x, targetWorld.z - beamWorld.z) > 1e-5) {

                throw new Error(`The active ${stage.phase} marker and visible beam do not share a world position.`);

            }

            for (const direction of directions) {

                // Keep the real active marker in place, then turn the actual bike
                // so this same world target falls ahead/right/behind/left of it.

                bike.position.set(targetWorld.x + 17, 0, targetWorld.z - 23);

                const worldBearing = Math.atan2(targetWorld.x - bike.position.x, targetWorld.z - bike.position.z);

                bike.rotation.set(0, worldBearing - direction.bearing, 0);

                bike.updateMatrixWorld(true);

                updateNavigationIndicator();

                bike.getWorldPosition(bikeWorld);

                marker.getWorldPosition(targetWorld);

                toTarget.subVectors(targetWorld, bikeWorld).setY(0);

                getScooterWorldBasis(forward, right);

                const actualBearing = scooterRelativeBearing(toTarget, forward, right);

                const angleError = Math.atan2(Math.sin(actualBearing - direction.bearing), Math.cos(actualBearing - direction.bearing));

                const matrixValues = getComputedStyle(navigationArrow).transform.match(/^matrix\(([^)]+)\)$/);

                const matrix = matrixValues?.[1].split(',').map(Number);

                // The SVG tip starts at (0,-1) from its center. Apply its actual
                // browser-computed CSS matrix and compare that visible tip to the
                // expected screen-space direction for this real marker.

                const renderedTipX = matrix ? -matrix[2] : NaN;

                const renderedTipY = matrix ? -matrix[3] : NaN;

                const expectedTipX = Math.sin(direction.bearing);

                const expectedTipY = -Math.cos(direction.bearing);

                if (navigationIndicator.hidden || !marker.visible || !stage.beam.visible

                    || !Number.isFinite(actualBearing) || Math.abs(angleError) > 1e-5

                    || !matrix || matrix.length < 6

                    || Math.hypot(renderedTipX - expectedTipX, renderedTipY - expectedTipY) > 1e-5) {

                    throw new Error(`Rendered ${stage.phase} compass did not point ${direction.label} toward its active marker.`);

                }

                renderedChecks++;

            }

        }

    } finally {

        game.running = previous.running;

        game.phase = previous.phase;

        game.restaurant = previous.restaurant;

        game.customer = previous.customer;

        bike.position.copy(previous.bikePosition);

        bike.rotation.copy(previous.bikeRotation);

        bike.updateMatrixWorld(true);

        syncDestinationMarkers(previous.phase, previous.restaurant, previous.customer);

        navigationIndicator.hidden = previous.indicatorHidden;

        navigationIndicator.style.left = previous.indicatorLeft;

        navigationIndicator.style.top = previous.indicatorTop;

        navigationArrow.style.transform = previous.arrowTransform;

        navigationIndicator.classList.toggle('pickup', previous.pickupClass);

        navigationIndicator.classList.toggle('delivery', previous.deliveryClass);

    }

    console.info(`[Guidance] Verified ${renderedChecks} rendered compass directions against the exact active pickup/delivery marker and matching visible beam; preserved destination markers and overlay styling.`);

}



*/

// ---------- Input ----------

const input = { gas: false, brake: false, left: false, right: false };

const keyMap = { KeyW: 'gas', ArrowUp: 'gas', KeyS: 'brake', ArrowDown: 'brake', KeyA: 'left', ArrowLeft: 'left', KeyD: 'right', ArrowRight: 'right' };

window.addEventListener('keydown', e => {

    if (e.code === 'Escape') {
        e.preventDefault();
        if (settingsOverlayOpen) closeSettingsMenu();
        else if (!document.getElementById('day-summary').classList.contains('open')
            && !document.getElementById('garage-confirm').classList.contains('open')) openSettingsMenu();
        return;
    }
    if (settingsOverlayOpen) return;

    if (e.code === 'KeyE') {
        e.preventDefault();
        if (stationMenuOpen) hideServicePanel();
        else if (playerState.shiftActive && game.running) openNearestStation();
        else openRoadsideMaintenance();
        return;
    }
    if (!keyMap[e.code]) return;

    e.preventDefault();

    const canDrive = game.running && !simulationPaused && !garageOpen && !stationMenuOpen
        && !playerState.roadsideAssistance.active && !playerState.roadsideRepair.active
        && !(servicePanelOpen && serviceMode === 'roadside');
    if (canDrive) input[keyMap[e.code]] = true;

});

window.addEventListener('keyup', e => { if (keyMap[e.code]) input[keyMap[e.code]] = false; });



function bindTouch(id, key) {

    const el = document.getElementById(id);

    const set = v => e => {

        e.preventDefault();

        input[key] = v && game.running && !simulationPaused && !garageOpen && !stationMenuOpen
            && !playerState.roadsideAssistance.active && !playerState.roadsideRepair.active
            && !(servicePanelOpen && serviceMode === 'roadside');

        el.classList.toggle('on', input[key]);

    };

    el.addEventListener('pointerdown', set(true));

    el.addEventListener('pointerup', set(false));

    el.addEventListener('pointerleave', set(false));

    el.addEventListener('pointercancel', set(false));

}

bindTouch('bL', 'left');

bindTouch('bR', 'right');

bindTouch('bB', 'brake');

bindTouch('bG', 'gas');

const steeringArea = document.getElementById('steering-area');
let steeringPointerId = null;
let steeringDragOriginX = 0;
let touchSteerTarget = 0;
let tiltSteerTarget = 0;
let smoothedAnalogSteer = 0;
const tiltControl = {
    supported: typeof window.DeviceOrientationEvent !== 'undefined' && window.isSecureContext !== false,
    enabled: false,
    raw: null,
    center: null,
    status: 'Sensör izni verilmedi.',
};

function syncSteeringArea() {
    if (!steeringArea) return;
    const active = settings.controlMethod === 'touch';
    steeringArea.classList.toggle('active', active);
    steeringArea.setAttribute('aria-hidden', String(!active));
}

function updateTiltStatus(message) {
    tiltControl.status = message;
    const status = document.getElementById('tilt-control-status');
    if (status) status.textContent = message;
}

function handleDeviceOrientation(event) {
    if (!tiltControl.enabled || !Number.isFinite(event.beta) || !Number.isFinite(event.gamma)) return;
    const angle = Number(window.screen?.orientation?.angle ?? window.orientation ?? 0);
    const landscape = Math.abs(angle % 180) === 90;
    const raw = landscape ? event.beta * (angle < 0 || angle === 270 ? -1 : 1) : event.gamma;
    tiltControl.raw = raw;
    if (tiltControl.center === null) tiltControl.center = raw;
    let offset = raw - tiltControl.center;
    const deadZone = 3;
    if (Math.abs(offset) <= deadZone) offset = 0;
    else offset = Math.sign(offset) * (Math.abs(offset) - deadZone);
    tiltSteerTarget = THREE.MathUtils.clamp(-offset / 17, -1, 1);
}

async function enableTiltControls() {
    if (!tiltControl.supported) {
        updateTiltStatus('Bu cihazda eğim sensörü desteklenmiyor; yön düğmeleri kullanılabilir.');
        return;
    }
    if (tiltControl.enabled) {
        if (Number.isFinite(tiltControl.raw)) {
            tiltControl.center = tiltControl.raw;
            tiltSteerTarget = 0;
            updateTiltStatus('Sensör yeniden ortalandı.');
        }
        return;
    }
    try {
        const Orientation = window.DeviceOrientationEvent;
        if (typeof Orientation.requestPermission === 'function') {
            const permission = await Orientation.requestPermission();
            if (permission !== 'granted') {
                updateTiltStatus('Sensör izni verilmedi; yön düğmeleri kullanılabilir.');
                return;
            }
        }
        window.addEventListener('deviceorientation', handleDeviceOrientation, { passive: true });
        tiltControl.enabled = true;
        tiltControl.center = null;
        updateTiltStatus('Sensör açık. Telefonu düz tutup yeniden ortala.');
    } catch (error) {
        console.info('[Kontrol] Eğim sensörü açılamadı; yön düğmeleri kullanılabilir.', error);
        updateTiltStatus('Sensör açılamadı; yön düğmeleri kullanılabilir.');
    }
}

steeringArea?.addEventListener('pointerdown', event => {
    if (settings.controlMethod !== 'touch' || !game.running || simulationPaused || garageOpen || stationMenuOpen) return;
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    event.preventDefault();
    steeringPointerId = event.pointerId;
    steeringDragOriginX = event.clientX;
    touchSteerTarget = 0;
    steeringArea.setPointerCapture(event.pointerId);
});
steeringArea?.addEventListener('pointermove', event => {
    if (event.pointerId !== steeringPointerId) return;
    event.preventDefault();
    const deadZone = 7;
    let offset = event.clientX - steeringDragOriginX;
    if (Math.abs(offset) <= deadZone) offset = 0;
    else offset = Math.sign(offset) * (Math.abs(offset) - deadZone);
    const travel = Math.max(58, Math.min(112, steeringArea.clientWidth * 0.44));
    touchSteerTarget = THREE.MathUtils.clamp(-offset / travel, -1, 1);
});
function releaseSteeringPointer(event) {
    if (event.pointerId !== steeringPointerId) return;
    steeringPointerId = null;
    touchSteerTarget = 0;
}
steeringArea?.addEventListener('pointerup', releaseSteeringPointer);
steeringArea?.addEventListener('pointercancel', releaseSteeringPointer);
steeringArea?.addEventListener('lostpointercapture', releaseSteeringPointer);
syncSteeringArea();

function getSteeringIntent(dt) {
    const hasDigitalInput = input.left || input.right;
    const digitalSteer = (input.left ? 1 : 0) - (input.right ? 1 : 0);
    const analogTarget = settings.controlMethod === 'touch' ? touchSteerTarget
        : settings.controlMethod === 'tilt' && tiltControl.enabled ? tiltSteerTarget : 0;
    smoothedAnalogSteer = THREE.MathUtils.damp(smoothedAnalogSteer, analogTarget, analogTarget === 0 ? 10 : 8, dt);
    return hasDigitalInput ? digitalSteer : smoothedAnalogSteer;
}



// ---------- Shared audio graph ----------

// One media element per authored clip; the uploaded theme is the only music track.
const music = new Audio('assets/audio/engine-pulse.mp3');
music.loop = true;
music.preload = 'auto';
const environmentAudio = new Audio('assets/audio/istanbul-nontraffic-ambience.mp3');
environmentAudio.loop = true;
environmentAudio.preload = 'auto';
const chime = new Audio('assets/audio/cash-chime.mp3');
chime.preload = 'auto';

let muted = settings.audio.muted;
let actx = null;
let audioMasterGain = null;
let audioVisibilityGain = null;
let audioLimiter = null;
let audioBuses = null;
let engineFilter = null;
let engineVoiceGain = null;
let engineOscillators = [];
let engineEnvelope = 0;
let engineAudioTick = 0;
let audioUnlocked = false;
let audioWasActiveWhenHidden = false;
let visibilitySuspendTimer = 0;
let cityAmbiencePanner = null;
let trafficAudioElapsed = 1;
let trafficVoicePool = [];
let deliveryVoiceUnavailableReported = false;
const mediaAudioSources = new WeakMap();
const TRAFFIC_AUDIO_POOL_SIZE = 3;
const TRAFFIC_AUDIO_RANGE = 46;
const TRAFFIC_AUDIO_RANGE_SQ = TRAFFIC_AUDIO_RANGE * TRAFFIC_AUDIO_RANGE;

function smoothAudioParam(param, value, timeConstant = 0.08) {
    if (!actx || !param) return;
    const now = actx.currentTime;
    param.cancelScheduledValues(now);
    param.setTargetAtTime(value, now, timeConstant);
}

function createToneVoice({ destination, secondGain = 0.08, filterFrequency = 900, panner = null } = {}) {
    const filter = actx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = filterFrequency;
    filter.Q.value = 0.7;
    const voiceGain = actx.createGain();
    voiceGain.gain.value = 0;
    const fundamental = actx.createOscillator();
    fundamental.type = 'sawtooth';
    fundamental.frequency.value = 55;
    const fundamentalGain = actx.createGain();
    fundamentalGain.gain.value = 0.24;
    fundamental.connect(fundamentalGain).connect(filter);
    const overtone = actx.createOscillator();
    overtone.type = 'triangle';
    overtone.frequency.value = 110;
    const overtoneGain = actx.createGain();
    overtoneGain.gain.value = secondGain;
    overtone.connect(overtoneGain).connect(filter);
    filter.connect(voiceGain);
    if (panner) voiceGain.connect(panner).connect(destination);
    else voiceGain.connect(destination);
    fundamental.start();
    overtone.start();
    return { fundamental, overtone, filter, gain: voiceGain, panner, car: null };
}

function setPannerPosition(panner, x, y = 1.4, z) {
    if (!panner || !actx) return;
    const now = actx.currentTime;
    if (panner.positionX) {
        panner.positionX.setTargetAtTime(x, now, 0.08);
        panner.positionY.setTargetAtTime(y, now, 0.08);
        panner.positionZ.setTargetAtTime(z, now, 0.08);
    } else {
        panner.setPosition(x, y, z);
    }
}

function connectMediaElement(element, destination) {
    if (mediaAudioSources.has(element)) return;
    try {
        const source = actx.createMediaElementSource(element);
        mediaAudioSources.set(element, source);
        source.connect(destination);
        element.volume = 1;
        element.muted = false;
    } catch (error) {
        console.warn('[Ses] Ses düğümü bağlanamadı; doğrudan medya oynatımı kullanılacak.', error);
    }
}

function createAudioGraph() {
    if (actx) return true;
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return false;
    try {
        actx = new AudioContextClass();
        audioMasterGain = actx.createGain();
        audioVisibilityGain = actx.createGain();
        audioLimiter = actx.createDynamicsCompressor();
        audioLimiter.threshold.value = -12;
        audioLimiter.knee.value = 12;
        audioLimiter.ratio.value = 4;
        audioLimiter.attack.value = 0.006;
        audioLimiter.release.value = 0.16;
        audioMasterGain.connect(audioVisibilityGain).connect(audioLimiter).connect(actx.destination);
        audioVisibilityGain.gain.value = 1;
        audioBuses = Object.fromEntries(['music', 'radio', 'engine', 'traffic', 'environment', 'voices', 'ui']
            .map(category => {
                const gain = actx.createGain();
                gain.gain.value = 1;
                gain.connect(audioMasterGain);
                return [category, gain];
            }));

        connectMediaElement(music, audioBuses.music);
        connectMediaElement(chime, audioBuses.ui);

        const ambienceSource = actx.createMediaElementSource(environmentAudio);
        mediaAudioSources.set(environmentAudio, ambienceSource);
        cityAmbiencePanner = actx.createPanner();
        cityAmbiencePanner.panningModel = 'equalpower';
        cityAmbiencePanner.distanceModel = 'inverse';
        cityAmbiencePanner.refDistance = 28;
        cityAmbiencePanner.maxDistance = 190;
        cityAmbiencePanner.rolloffFactor = 1.25;
        setPannerPosition(cityAmbiencePanner, HALF + 34, 2, 0);
        ambienceSource.connect(cityAmbiencePanner).connect(audioBuses.environment);
        environmentAudio.volume = 1;
        environmentAudio.muted = false;

        engineFilter = actx.createBiquadFilter();
        engineFilter.type = 'lowpass';
        engineFilter.frequency.value = 650;
        engineFilter.Q.value = 0.75;
        engineVoiceGain = actx.createGain();
        engineVoiceGain.gain.value = 0;
        engineFilter.connect(engineVoiceGain).connect(audioBuses.engine);
        const fundamental = actx.createOscillator();
        fundamental.type = 'sawtooth';
        const fundamentalGain = actx.createGain();
        fundamentalGain.gain.value = 0.22;
        fundamental.connect(fundamentalGain).connect(engineFilter);
        const harmonic = actx.createOscillator();
        harmonic.type = 'triangle';
        const harmonicGain = actx.createGain();
        harmonicGain.gain.value = 0.075;
        harmonic.connect(harmonicGain).connect(engineFilter);
        const upperHarmonic = actx.createOscillator();
        upperHarmonic.type = 'sawtooth';
        const upperGain = actx.createGain();
        upperGain.gain.value = 0.018;
        upperHarmonic.connect(upperGain).connect(engineFilter);
        for (const oscillator of [fundamental, harmonic, upperHarmonic]) oscillator.start();
        engineOscillators = [fundamental, harmonic, upperHarmonic];

        trafficVoicePool = Array.from({ length: TRAFFIC_AUDIO_POOL_SIZE }, () => {
            const panner = actx.createPanner();
            panner.panningModel = 'equalpower';
            panner.distanceModel = 'inverse';
            panner.refDistance = 7;
            panner.maxDistance = TRAFFIC_AUDIO_RANGE;
            panner.rolloffFactor = 1.35;
            return createToneVoice({ destination: audioBuses.traffic, secondGain: 0.11, filterFrequency: 430, panner });
        });
        return true;
    } catch (error) {
        console.warn('[Ses] Web Audio kurulamadı; desteklenen medya sesleri doğrudan çalınacak.', error);
        return false;
    }
}

function applyAudioSettings() {
    muted = Boolean(settings.audio.muted);
    const master = settings.audio.master / 100;
    if (audioBuses && actx) {
        for (const category of Object.keys(audioBuses)) {
            const categoryVolume = category === 'ui' ? settings.audio.ui : settings.audio[category];
            smoothAudioParam(audioBuses[category].gain, (Number(categoryVolume) || 0) / 100, 0.09);
        }
        smoothAudioParam(audioMasterGain.gain, muted ? 0 : master, 0.1);
        music.volume = environmentAudio.volume = chime.volume = 1;
        music.muted = environmentAudio.muted = chime.muted = false;
    } else {
        music.volume = Math.max(0, Math.min(1, master * settings.audio.music / 100));
        environmentAudio.volume = Math.max(0, Math.min(1, master * settings.audio.environment / 100));
        chime.volume = Math.max(0, Math.min(1, master * settings.audio.ui / 100));
        music.muted = environmentAudio.muted = chime.muted = muted;
    }
    const muteButton = document.getElementById('mute');
    if (muteButton) muteButton.textContent = muted ? '🔇' : '🔊';
}

function startAudio() {
    audioUnlocked = true;
    createAudioGraph();
    if (actx?.state === 'suspended') actx.resume().catch(() => {});
    if (audioVisibilityGain && !document.hidden) smoothAudioParam(audioVisibilityGain.gain, 1, 0.12);
    applyAudioSettings();
    if (music.paused) music.play().catch(() => {});
    if (environmentAudio.paused) environmentAudio.play().catch(() => {});
}

function pauseAudio() {
    if (!audioUnlocked) return;
    audioWasActiveWhenHidden = !music.paused || actx?.state === 'running';
    if (audioVisibilityGain && actx?.state === 'running') smoothAudioParam(audioVisibilityGain.gain, 0, 0.045);
    window.clearTimeout(visibilitySuspendTimer);
    visibilitySuspendTimer = window.setTimeout(() => {
        if (!document.hidden) return;
        music.pause();
        environmentAudio.pause();
        chime.pause();
        if ('speechSynthesis' in window) window.speechSynthesis.cancel();
        if (actx?.state === 'running') actx.suspend().catch(() => {});
    }, 160);
}

document.addEventListener('visibilitychange', () => {
    if (document.hidden) pauseAudio();
    else if (audioWasActiveWhenHidden && audioUnlocked) {
        window.clearTimeout(visibilitySuspendTimer);
        audioWasActiveWhenHidden = false;
        startAudio();
    }
});

function updateEngineAudio(dt) {
    if (!engineOscillators.length || !actx || actx.state !== 'running') return;
    engineAudioTick += dt;
    if (engineAudioTick < 0.06) return;
    const updateStep = engineAudioTick;
    engineAudioTick = 0;
    const spec = currentMotorcycleSpec();
    const classProfile = spec.label === '50 cc'
        ? { idle: 47, sweep: 98, throttle: 19, filter: 520, harmonic: 1.82, upper: 2.73 }
        : spec.label === '250 cc'
            ? { idle: 70, sweep: 176, throttle: 37, filter: 1120, harmonic: 2.04, upper: 3.08 }
            : { idle: 59, sweep: 139, throttle: 27, filter: 820, harmonic: 1.96, upper: 2.94 };
    const speedRatio = THREE.MathUtils.clamp(Math.abs(state.speed) / Math.max(1, spec.maxSpeed), 0, 1);
    const active = game.running && !simulationPaused && !garageOpen && activeMotorcycle.condition > 0;
    const revs = active ? speedRatio : 0;
    const rpmTone = classProfile.idle + classProfile.sweep * revs + (active && input.gas ? classProfile.throttle : 0);
    const requestedEnvelope = active ? 0.13 + speedRatio * 0.38 + (input.gas ? 0.23 : 0) : 0;
    engineEnvelope = THREE.MathUtils.damp(engineEnvelope, requestedEnvelope, 4.5, updateStep);
    const now = actx.currentTime;
    engineOscillators[0].frequency.setTargetAtTime(rpmTone, now, 0.11);
    engineOscillators[1].frequency.setTargetAtTime(rpmTone * classProfile.harmonic, now, 0.13);
    engineOscillators[2].frequency.setTargetAtTime(rpmTone * classProfile.upper, now, 0.15);
    engineFilter.frequency.setTargetAtTime(classProfile.filter + speedRatio * classProfile.filter * 0.62, now, 0.16);
    smoothAudioParam(engineVoiceGain.gain, engineEnvelope * 0.11, 0.09);
}

function updateSpatialAudio(dt) {
    if (!actx || actx.state !== 'running') return;
    trafficAudioElapsed += dt;
    if (trafficAudioElapsed < 0.14) return;
    trafficAudioElapsed = 0;
    const listener = actx.listener;
    const now = actx.currentTime;
    const listenerX = state.x;
    const listenerY = 1.45;
    const listenerZ = state.z;
    if (listener.positionX) {
        listener.positionX.setTargetAtTime(listenerX, now, 0.1);
        listener.positionY.setTargetAtTime(listenerY, now, 0.1);
        listener.positionZ.setTargetAtTime(listenerZ, now, 0.1);
        listener.forwardX.setTargetAtTime(Math.sin(state.heading), now, 0.1);
        listener.forwardY.setTargetAtTime(0, now, 0.1);
        listener.forwardZ.setTargetAtTime(Math.cos(state.heading), now, 0.1);
        listener.upX.setTargetAtTime(0, now, 0.1);
        listener.upY.setTargetAtTime(1, now, 0.1);
        listener.upZ.setTargetAtTime(0, now, 0.1);
    } else {
        listener.setPosition(listenerX, listenerY, listenerZ);
        listener.setOrientation(Math.sin(state.heading), 0, Math.cos(state.heading), 0, 1, 0);
    }

    const nearest = [];
    if (game.running && !simulationPaused) {
        for (const car of trafficCars) {
            const dx = car.root.position.x - listenerX;
            const dz = car.root.position.z - listenerZ;
            const distanceSq = dx * dx + dz * dz;
            if (distanceSq > TRAFFIC_AUDIO_RANGE_SQ) continue;
            let insertAt = nearest.length;
            while (insertAt > 0 && nearest[insertAt - 1].distanceSq > distanceSq) insertAt--;
            if (insertAt >= TRAFFIC_AUDIO_POOL_SIZE) continue;
            nearest.splice(insertAt, 0, { car, distanceSq });
            if (nearest.length > TRAFFIC_AUDIO_POOL_SIZE) nearest.pop();
        }
    }

    for (let index = 0; index < trafficVoicePool.length; index++) {
        const voice = trafficVoicePool[index];
        const entry = nearest[index];
        if (!entry) {
            smoothAudioParam(voice.gain.gain, 0, 0.12);
            voice.car = null;
            continue;
        }
        const { car } = entry;
        if (voice.car !== car) {
            smoothAudioParam(voice.gain.gain, 0, 0.04);
            voice.car = car;
            setPannerPosition(voice.panner, car.root.position.x, 0.8, car.root.position.z);
        } else {
            setPannerPosition(voice.panner, car.root.position.x, 0.8, car.root.position.z);
        }
        const van = car.type === 'van';
        const movingRatio = THREE.MathUtils.clamp(car.speed / 10, 0, 1);
        const baseHz = (van ? 34 : 42) + movingRatio * (van ? 16 : 20);
        voice.fundamental.frequency.setTargetAtTime(baseHz, now, 0.16);
        voice.overtone.frequency.setTargetAtTime(baseHz * (van ? 1.91 : 2.06), now, 0.18);
        voice.filter.frequency.setTargetAtTime(van ? 380 + movingRatio * 140 : 500 + movingRatio * 220, now, 0.18);
        smoothAudioParam(voice.gain.gain, 0.105, 0.12);
    }
}

function playDeliveryVoice() {
    if (muted || settings.audio.voices <= 0 || !('speechSynthesis' in window)) return;
    const turkishVoice = window.speechSynthesis.getVoices().find(voice => /^tr(?:-|$)/i.test(voice.lang));
    if (!turkishVoice) {
        if (!deliveryVoiceUnavailableReported) {
            console.info('[Ses] Türkçe sistem konuşma sesi bulunamadı; teslimat diyaloğu bu cihazda atlandı.');
            deliveryVoiceUnavailableReported = true;
        }
        return;
    }
    const utterance = new SpeechSynthesisUtterance('Siparişiniz geldi, afiyet olsun.');
    utterance.lang = 'tr-TR';
    utterance.voice = turkishVoice;
    utterance.rate = 0.94;
    utterance.pitch = 1.02;
    utterance.volume = THREE.MathUtils.clamp(settings.audio.master / 100 * settings.audio.voices / 100, 0, 1);
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(utterance);
}

function playChime() {
    if (muted || !audioUnlocked || !chime.paused) return;
    chime.currentTime = 0;
    chime.play().catch(() => {});
}

function unlockAudioFromGesture() {
    startAudio();
}
window.addEventListener('pointerdown', unlockAudioFromGesture, { once: true, capture: true });
window.addEventListener('keydown', unlockAudioFromGesture, { once: true, capture: true });

applyAudioSettings();
document.getElementById('mute').addEventListener('click', () => {
    settings.audio.muted = !settings.audio.muted;
    saveGameSettings();
    applyAudioSettings();
});



// ---------- Missions ----------

const ui = {
    money: document.getElementById('money'),
    count: document.getElementById('count'),
    time: document.getElementById('time'),
    msg: document.getElementById('msg'),
    speed: document.getElementById('bike-speed'),
    fuelMeter: document.getElementById('fuel-meter'),
    fuelValue: document.getElementById('fuel-value'),
    conditionMeter: document.getElementById('condition-meter'),
    conditionValue: document.getElementById('condition-value'),
};

const SAVE_KEY = 'motokurye-istanbul-save-v1';
const LEGACY_SAVE_KEYS = ['motokurye-save', 'motokuryeSave', 'moto-kurye-save', 'motoKuryeSave'];
const MARKET_MAX_DAYS = 4;
const WORLD_UNIT_KM = 0.02;
const SHIFT_DURATION_SECONDS = 15 * 60;
const SHIFT_GAME_MINUTES = 9 * 60;
const DELIVERY_DISTANCE_KM = { shortMax: 2, mediumMax: 4 };
const DELIVERY_CLASSES = {
    short: { label: 'Kısa', fee: 60, targetSeconds: 60, graceSeconds: 30 },
    medium: { label: 'Orta', fee: 90, targetSeconds: 90, graceSeconds: 45 },
    long: { label: 'Uzun', fee: 130, targetSeconds: 120, graceSeconds: 60 },
};
const COURIER_COMPANIES = {
    paketjet: { name: 'PaketJet', unlockLevel: 5, target: 8, durationDays: 3, reward: 800, description: '3 oyun gününde 8 başarılı teslimat · ₺800 ek ödül' },
    istanbulEkspres: { name: 'İstanbul Ekspres', unlockLevel: 8, target: 12, durationDays: 4, reward: 1500, description: '4 oyun gününde 12 başarılı teslimat · ₺1.500 ek ödül' },
};
const MOTORCYCLE_CLASSES = {
    cc50: { label: '50 cc', retailPrice: 4500, tankLiters: 5, consumptionPer100Km: 2.5, acceleration: 9.5, maxSpeed: 16, upgradeAccelerationCap: 11.8 },
    cc125: { label: '125 cc', retailPrice: 8000, tankLiters: 6, consumptionPer100Km: 2.8, acceleration: 12, maxSpeed: 20, upgradeAccelerationCap: 15.5 },
    cc250: { label: '250 cc', retailPrice: 18000, tankLiters: 10, consumptionPer100Km: 3.5, acceleration: 13.5, maxSpeed: 23, upgradeAccelerationCap: 18.5 },
};
const MOTORCYCLE_CATALOG = [
    { key: 'moto-50-classic', name: 'Şehir 50 Classic', classKey: 'cc50', style: 'Kompakt basamaklı scooter · kiraz kırmızısı ve krem', asset: 'assets/models/moto-50-classic.glb' },
    { key: 'moto-50-retro', name: 'Şehir 50 Retro', classKey: 'cc50', style: 'Turkuaz retro scooter · krom detaylar ve yuvarlak far', asset: 'assets/models/moto-50-retro.glb' },
    { key: 'moto-125-commuter', name: 'Yol 125 Commuter', classKey: 'cc125', style: 'Sarı tanklı klasik commuter · açık şasi', asset: 'assets/models/moto-125-commuter.glb' },
    { key: 'moto-125-scrambler', name: 'Yol 125 Scrambler', classKey: 'cc125', style: 'Turuncu depo · yüksek çamurluk ve dişli lastikler', asset: 'assets/models/moto-125-scrambler.glb' },
    { key: 'moto-250-sport', name: 'Rota 250 Sport', classKey: 'cc250', style: 'Kırmızı tam grenaj · yatık sportif sürüş', asset: 'assets/models/moto-250-sport.glb' },
    { key: 'moto-250-street', name: 'Rota 250 Street', classKey: 'cc250', style: 'Grafit roadster · açık motor ve camgöbeği detaylar', asset: 'assets/models/moto-250-street.glb' },
];
const DEFAULT_MODEL_BY_CLASS = { cc50: 'moto-50-classic', cc125: 'moto-125-commuter', cc250: 'moto-250-sport' };
function getMotorcycleModel(key, fallbackClass = null) {
    const selected = MOTORCYCLE_CATALOG.find(model => model.key === key && (!fallbackClass || model.classKey === fallbackClass));
    return selected
        || MOTORCYCLE_CATALOG.find(model => model.key === DEFAULT_MODEL_BY_CLASS[fallbackClass || 'cc50'])
        || MOTORCYCLE_CATALOG[0];
}
const FUEL_REFERENCE_PRICE = 60;
const REPAIR_REFERENCE_PRICES = { small: 100, medium: 250, full: 500 };
const REPAIR_OPTIONS = {
    small: { label: 'Küçük bakım', points: 15, seconds: 5 },
    medium: { label: 'Orta bakım', points: 40, seconds: 10 },
    full: { label: 'Kapsamlı bakım', points: 100, seconds: 20 },
};
const UPGRADE_CATEGORIES = [
    { key: 'engine', label: 'Motor', parts: ['Yüksek akışlı hava filtresi', 'Güçlendirilmiş silindir kiti', 'Performans bujisi'], basePrices: [1200, 3000, 6500], lifespanKm: [1000, 1500, 2000], effects: [{ acceleration: 0.05, topSpeed: 0.02 }, { acceleration: 0.10, topSpeed: 0.04 }, { acceleration: 0.15, topSpeed: 0.06 }] },
    { key: 'brakes', label: 'Fren', parts: ['Örgülü fren hortumu', 'Performans balatası', 'Güçlü fren diski'], basePrices: [600, 1400, 3000], lifespanKm: [600, 900, 1200], effects: [{ braking: 0.08 }, { braking: 0.15 }, { braking: 0.22 }] },
    { key: 'tires', label: 'Lastik', parts: ['Yol tutuş lastiği', 'Dört mevsim lastik', 'Geniş arka lastik'], basePrices: [800, 2000, 4500], lifespanKm: [400, 600, 800], effects: [{ grip: 0.06 }, { grip: 0.12 }, { grip: 0.18 }] },
    { key: 'suspension', label: 'Süspansiyon', parts: ['Ayarlanabilir arka amortisör', 'Güçlendirilmiş ön maşa', 'Konfor süspansiyon yayı'], basePrices: [900, 2200, 4800], lifespanKm: [1200, 1800, 2400], effects: [{ stability: 0.05 }, { stability: 0.10 }, { stability: 0.15 }] },
    { key: 'efficiency', label: 'Yakıt Tasarrufu', parts: ['Ekonomik karbüratör', 'Verimli yakıt enjektörü', 'Tasarruf ayar kiti'], basePrices: [700, 1800, 3800], lifespanKm: [1500, 2250, 3000], effects: [{ fuelReduction: 0.04 }, { fuelReduction: 0.08 }, { fuelReduction: 0.12 }] },
    { key: 'exhaust', label: 'Egzoz', parts: ['Spor egzoz', 'Hafif susturucu', 'Akışkan egzoz manifoldu'], basePrices: [500, 1300, 2800], lifespanKm: [1800, 2700, 3600], effects: [{ throttleResponse: 0.02 }, { throttleResponse: 0.04 }, { throttleResponse: 0.06 }] },
];
const UPGRADE_QUALITY_TIERS = [
    { name: 'Standart+', weight: 0.50 },
    { name: 'Sport', weight: 0.35 },
    { name: 'Pro', weight: 0.15 },
];
const UPGRADE_CLASS_PRICE_MULTIPLIERS = { cc50: 0.7, cc125: 1, cc250: 1.5 };
const UPGRADE_COMPATIBILITY = [
    { categories: ['engine', 'exhaust'], label: 'Motor + Egzoz', stat: 'acceleration', values: [0.01, 0.02, 0.03] },
    { categories: ['tires', 'suspension'], label: 'Lastik + Süspansiyon', stat: 'grip', values: [0.02, 0.03, 0.05] },
    { categories: ['brakes', 'tires'], label: 'Fren + Lastik', stat: 'braking', values: [0.02, 0.03, 0.04] },
    { categories: ['engine', 'efficiency'], label: 'Motor + Yakıt Tasarrufu', stat: 'acceleration', values: [0.01, 0.015, 0.02] },
];
const UPGRADE_TIER_LIFESPAN_STATUS = [
    { minimum: 26, className: 'normal', label: 'Normal' },
    { minimum: 11, className: 'warning', label: 'Az kaldı' },
    { minimum: 1, className: 'critical', label: 'Kritik' },
    { minimum: 0, className: 'expired', label: 'Ömrü bitti' },
];
const COSMETIC_CATEGORIES = [
    { key: 'paint', label: 'Boya', weight: 0.35, options: [{ name: 'Mat siyah boya', purchasePrice: 700 }, { name: 'Turkuaz kaplama', purchasePrice: 750 }, { name: 'Kırmızı şerit', purchasePrice: 400 }] },
    { key: 'deliveryBag', label: 'Kurye çantası', weight: 0.30, options: [{ name: 'Termal kurye çantası', purchasePrice: 900 }, { name: 'Kare kurye çantası', purchasePrice: 750 }, { name: 'Çift katlı kurye çantası', purchasePrice: 1100 }] },
    { key: 'rims', label: 'Jant', weight: 0.20, options: [{ name: 'Altın jant', purchasePrice: 700 }, { name: 'Siyah jant', purchasePrice: 550 }, { name: 'Krom jant', purchasePrice: 800 }] },
    { key: 'seat', label: 'Sele', weight: 0.15, options: [{ name: 'Konfor sele', purchasePrice: 500 }, { name: 'Spor sele', purchasePrice: 450 }, { name: 'Deri sele', purchasePrice: 650 }] },
];
const COSMETIC_CATALOG = COSMETIC_CATEGORIES.flatMap(category => category.options.map(option => ({ ...option, categoryKey: category.key, categoryLabel: category.label })));
const STORAGE = (() => {
    try { return window.localStorage; } catch { return null; }
})();
let saveWriteBlocked = !STORAGE;
let originalSaveFound = false;
let malformedSaveFound = false;
let legacySaveKey = null;
let stored = null;
if (STORAGE) {
    for (const key of [SAVE_KEY, ...LEGACY_SAVE_KEYS]) {
        try {
            const raw = STORAGE.getItem(key);
            if (raw === null) continue;
            originalSaveFound = true;
            const parsed = JSON.parse(raw);
            if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
                stored = parsed;
                if (key !== SAVE_KEY) legacySaveKey = key;
                break;
            }
            malformedSaveFound = true;
        } catch {
            malformedSaveFound = true;
        }
    }
}
if (originalSaveFound && !stored && malformedSaveFound) saveWriteBlocked = true;

function safeNumber(value, fallback, min = 0, max = Number.MAX_SAFE_INTEGER) {
    const number = Number(value);
    return Number.isFinite(number) ? THREE.MathUtils.clamp(number, min, max) : fallback;
}
function xpRequiredForLevel(level) {
    return 100 + 40 * Math.max(0, level - 1);
}
function normalizeCareer(value, legacyDeliveries = 0) {
    const source = value && typeof value === 'object' ? value : {};
    const legacyLevel = 1 + Math.floor(safeNumber(legacyDeliveries, 0, 0) / 5);
    let level = safeNumber(source.level, legacyLevel, 1, 10000);
    let xp = safeNumber(source.xp, 0, 0);
    while (xp >= xpRequiredForLevel(level) && level < 10000) {
        xp -= xpRequiredForLevel(level);
        level++;
    }
    const contracts = Array.isArray(source.contracts) ? source.contracts.filter(item => item && typeof item === 'object').map(item => {
        const companyKey = COURIER_COMPANIES[item.companyKey] ? item.companyKey : '';
        const company = COURIER_COMPANIES[companyKey];
        const target = safeNumber(item.target, company?.target || 1, 1, 100000);
        const progress = safeNumber(item.progress, 0, 0, target);
        const status = ['active', 'completed', 'failed'].includes(item.status) ? item.status : 'failed';
        const rewardPaid = Boolean(item.rewardPaid || status === 'completed');
        return {
            id: String(item.id || `contract-${companyKey}-${item.startDay || 1}`),
            companyKey,
            target,
            durationDays: safeNumber(item.durationDays, company?.durationDays || 1, 1, 365),
            reward: safeNumber(item.reward, company?.reward || 0, 0),
            progress,
            startDay: safeNumber(item.startDay, 1, 1),
            deadlineDay: safeNumber(item.deadlineDay, 1, 1),
            status,
            rewardPaid,
        };
    }) : [];
    return {
        level,
        xp,
        reputation: safeNumber(source.reputation, 50, 0, 100),
        successfulDeliveries: safeNumber(source.successfulDeliveries, legacyDeliveries, 0),
        failedDeliveries: safeNumber(source.failedDeliveries, 0, 0),
        totalCareerEarnings: safeNumber(source.totalCareerEarnings ?? source.totalEarnings, 0, 0),
        contracts,
    };
}
function makeDailySummary(day, balance) {
    return {
        day,
        completedDeliveries: 0,
        failedDeliveries: 0,
        baseEarnings: 0,
        tips: 0,
        shiftBonus: 0,
        contractRewards: 0,
        fuelExpenses: 0,
        repairExpenses: 0,
        upgradeExpenses: 0,
        xpEarned: 0,
        reputationChange: 0,
        startBalance: safeNumber(balance, 0, 0),
        endBalance: safeNumber(balance, 0, 0),
        ended: false,
        fullShift: false,
    };
}
function normalizeDailySummary(value, day, balance) {
    const source = value && typeof value === 'object' ? value : {};
    const summary = makeDailySummary(safeNumber(source.day, day, 1), balance);
    for (const key of ['completedDeliveries', 'failedDeliveries', 'baseEarnings', 'tips', 'shiftBonus', 'contractRewards', 'fuelExpenses', 'repairExpenses', 'upgradeExpenses', 'xpEarned']) {
        summary[key] = safeNumber(source[key], 0, 0);
    }
    summary.reputationChange = safeNumber(source.reputationChange, 0, -100, 100);
    summary.startBalance = safeNumber(source.startBalance, balance, 0);
    summary.endBalance = safeNumber(source.endBalance, balance, 0);
    summary.ended = Boolean(source.ended);
    summary.fullShift = Boolean(source.fullShift);
    return summary;
}
function recordDailyExpense(category, amount) {
    if (!['fuelExpenses', 'repairExpenses', 'upgradeExpenses'].includes(category)) return;
    const expense = roundMoney(Math.max(0, Number(amount) || 0));
    if (expense <= 0) return;
    playerState.dailySummary[category] = roundMoney(playerState.dailySummary[category] + expense);
    if (playerState.dailySummary.ended) playerState.dailySummary.endBalance = game.money;
}
function normalizeDailyPrices(prices) {
    const source = prices && typeof prices === 'object' ? prices : {};
    const repairs = source.repairs && typeof source.repairs === 'object' ? source.repairs : {};
    return {
        fuel: safeNumber(source.fuel, FUEL_REFERENCE_PRICE, FUEL_REFERENCE_PRICE * 0.9, FUEL_REFERENCE_PRICE * 1.1),
        repairs: {
            small: safeNumber(repairs.small, REPAIR_REFERENCE_PRICES.small, 90, 110),
            medium: safeNumber(repairs.medium, REPAIR_REFERENCE_PRICES.medium, 225, 275),
            full: safeNumber(repairs.full, REPAIR_REFERENCE_PRICES.full, 450, 550),
        },
    };
}
function rollDailyPrice(previous, reference) {
    const moved = previous * (0.95 + Math.random() * 0.10);
    const next = THREE.MathUtils.clamp(moved, Math.max(reference * 0.9, previous * 0.95), Math.min(reference * 1.1, previous * 1.05));
    return roundMoney(next);
}
function rollDailyPrices(prices) {
    return {
        fuel: rollDailyPrice(prices.fuel, FUEL_REFERENCE_PRICE),
        repairs: Object.fromEntries(Object.entries(REPAIR_REFERENCE_PRICES).map(([key, reference]) => [key, rollDailyPrice(prices.repairs[key], reference)])),
    };
}
function normalizeRoadsideAssistance(value) {
    const source = value && typeof value === 'object' ? value : {};
    const active = Boolean(source.active && source.paymentComplete);
    return {
        active,
        motorcycleId: String(source.motorcycleId || ''),
        remainingSeconds: safeNumber(source.remainingSeconds, 15, 0, 15),
        targetLiters: safeNumber(source.targetLiters, 2, 0, 2),
        paidAmount: safeNumber(source.paidAmount, 150, 0, 150),
        paymentComplete: Boolean(source.paymentComplete),
    };
}
function normalizeRoadsideRepair(value) {
    const source = value && typeof value === 'object' ? value : {};
    const kind = REPAIR_OPTIONS[source.kind] ? source.kind : 'small';
    return {
        active: Boolean(source.active && source.paymentComplete),
        motorcycleId: String(source.motorcycleId || ''),
        kind,
        restoreAmount: safeNumber(source.restoreAmount, 0, 0, 100),
        remainingSeconds: safeNumber(source.remainingSeconds, REPAIR_OPTIONS[kind].seconds, 0, REPAIR_OPTIONS[kind].seconds),
        paidAmount: safeNumber(source.paidAmount, 0, 0),
        paymentComplete: Boolean(source.paymentComplete),
    };
}
function makeId(prefix) {
    return `${prefix}-${globalThis.crypto?.randomUUID?.() || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`}`;
}
function formatMoney(value) {
    return `₺${Math.round(value).toLocaleString('tr-TR')}`;
}
function formatDecimal(value, digits = 1) {
    return Number(value).toLocaleString('tr-TR', { minimumFractionDigits: digits, maximumFractionDigits: digits });
}
function escapeHTML(value) {
    return String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
}
function upgradeTierIndex(tierName) {
    const index = UPGRADE_QUALITY_TIERS.findIndex(tier => tier.name === tierName);
    return index < 0 ? 0 : index;
}
function getUpgradeCategory(key) {
    return UPGRADE_CATEGORIES.find(category => category.key === key) || UPGRADE_CATEGORIES[0];
}
function getUpgradePrice(categoryKey, tierName, classKey = 'cc125') {
    const category = getUpgradeCategory(categoryKey);
    const tierIndex = upgradeTierIndex(tierName);
    const multiplier = UPGRADE_CLASS_PRICE_MULTIPLIERS[classKey] || 1;
    return Math.round(category.basePrices[tierIndex] * multiplier / 50) * 50;
}
function getUpgradeFullLifespanKm(categoryKey, tierName) {
    return getUpgradeCategory(categoryKey).lifespanKm[upgradeTierIndex(tierName)];
}
function getUpgradeRemainingKm(upgrade) {
    const fullLife = getUpgradeFullLifespanKm(upgrade.categoryKey, upgrade.qualityTier);
    return safeNumber(upgrade.remainingLifespanKm, fullLife * safeNumber(upgrade.remainingLifespan, 0, 0, 100) / 100, 0, fullLife);
}
function getUpgradeRemainingPercent(upgrade) {
    const fullLife = getUpgradeFullLifespanKm(upgrade.categoryKey, upgrade.qualityTier);
    return fullLife > 0 ? THREE.MathUtils.clamp(getUpgradeRemainingKm(upgrade) / fullLife * 100, 0, 100) : 0;
}
function getUpgradeResaleValue(upgrade) {
    return roundMoney(upgrade.purchasePrice * 0.5 * getUpgradeRemainingKm(upgrade) / getUpgradeFullLifespanKm(upgrade.categoryKey, upgrade.qualityTier));
}
function findUpgradeCategory(value, partName = '') {
    const text = String(value || '').toLowerCase();
    const nameText = String(partName).toLowerCase();
    const byKeyOrLabel = UPGRADE_CATEGORIES.find(category => category.key === value || category.label.toLowerCase() === text);
    if (byKeyOrLabel) return byKeyOrLabel;
    const knownPart = UPGRADE_CATEGORIES.find(category => category.parts.includes(partName));
    if (knownPart) return knownPart;
    if (/motor|silindir|hava filtresi|performans bujisi/.test(`${text} ${nameText}`)) return UPGRADE_CATEGORIES.find(item => item.key === 'engine');
    if (/fren|balata|disk/.test(`${text} ${nameText}`)) return UPGRADE_CATEGORIES.find(item => item.key === 'brakes');
    if (/lastik|yol tutuş/.test(`${text} ${nameText}`)) return UPGRADE_CATEGORIES.find(item => item.key === 'tires');
    if (/süspansiyon|amortisör|maşa/.test(`${text} ${nameText}`)) return UPGRADE_CATEGORIES.find(item => item.key === 'suspension');
    if (/yakıt|karbüratör|enjektör/.test(`${text} ${nameText}`)) return UPGRADE_CATEGORIES.find(item => item.key === 'efficiency');
    if (/egzoz|susturucu/.test(`${text} ${nameText}`)) return UPGRADE_CATEGORIES.find(item => item.key === 'exhaust');
    return UPGRADE_CATEGORIES[0];
}
function normalizeUpgrade(upgrade, classKey = 'cc125') {
    const item = upgrade && typeof upgrade === 'object' ? upgrade : { name: String(upgrade || 'Bilinmeyen parça') };
    const name = String(item.name || item.partName || 'Bilinmeyen parça');
    const category = findUpgradeCategory(item.categoryKey || item.category, name);
    const tier = UPGRADE_QUALITY_TIERS.find(entry => entry.name === (item.qualityTier || item.tier)) || UPGRADE_QUALITY_TIERS[0];
    const fullLifeKm = getUpgradeFullLifespanKm(category.key, tier.name);
    const preciseRemaining = item.remainingLifespanKm ?? item.remainingLifeKm;
    const rawLifespan = item.remainingLifespanPercent ?? item.remainingLifespan ?? item.remainingLifePercent ?? 0;
    const lifespanNumber = Number(rawLifespan);
    const lifespanPercent = Number.isFinite(lifespanNumber) ? (lifespanNumber > 100 ? lifespanNumber / 100 : lifespanNumber) : 0;
    const remainingLifespanKm = preciseRemaining === undefined
        ? fullLifeKm * safeNumber(lifespanPercent, 0, 0, 100) / 100
        : safeNumber(preciseRemaining, 0, 0, fullLifeKm);
    const legacyPrice = item.purchasePrice ?? item.originalPurchasePrice ?? item.resaleValue;
    return {
        categoryKey: category.key,
        categoryLabel: category.label,
        name,
        qualityTier: tier.name,
        purchasePrice: safeNumber(legacyPrice, getUpgradePrice(category.key, tier.name, classKey)),
        remainingLifespanKm,
        remainingLifespan: fullLifeKm > 0 ? remainingLifespanKm / fullLifeKm * 100 : 0,
        criticalNotified: Boolean(item.criticalNotified ?? item.lifespanCriticalNotified),
        expiredNotified: Boolean(item.expiredNotified ?? item.lifespanExpiredNotified),
    };
}
function normalizeInstalledUpgrades(upgrades, classKey) {
    const unique = new Map();
    for (const raw of upgrades) {
        const item = normalizeUpgrade(raw, classKey);
        const previous = unique.get(item.categoryKey);
        if (!previous || getUpgradeRemainingKm(item) > getUpgradeRemainingKm(previous)
            || (getUpgradeRemainingKm(item) === getUpgradeRemainingKm(previous) && upgradeTierIndex(item.qualityTier) > upgradeTierIndex(previous.qualityTier))) {
            unique.set(item.categoryKey, item);
        }
    }
    return [...unique.values()];
}
function normalizeCosmetic(cosmetic) {
    const item = cosmetic && typeof cosmetic === 'object' ? cosmetic : { name: String(cosmetic || 'Bilinmeyen kozmetik') };
    const name = String(item.name || item.label || 'Bilinmeyen kozmetik');
    const catalogItem = COSMETIC_CATALOG.find(entry => entry.name === name);
    const legacyCategory = name === 'Altın jant' ? 'rims' : (name === 'Kırmızı şerit' || name === 'Turkuaz kaplama' ? 'paint' : 'legacy');
    const category = COSMETIC_CATEGORIES.find(entry => entry.key === (item.categoryKey || catalogItem?.categoryKey || legacyCategory));
    const legacyPurchasePrice = typeof cosmetic === 'string' ? 375 : (item.purchasePrice ?? item.originalPurchasePrice);
    return {
        categoryKey: category?.key || 'legacy',
        categoryLabel: category?.label || 'Önceki kozmetik',
        name,
        purchasePrice: safeNumber(legacyPurchasePrice, catalogItem?.purchasePrice ?? 375),
    };
}
function formatUpgrade(item) {
    return `${item.categoryLabel}: ${item.name} · ${item.qualityTier} · %${Math.round(getUpgradeRemainingPercent(item))} ömür`;
}
function formatCosmetic(item) {
    return `${item.categoryLabel}: ${item.name}`;
}
function normalizeMotorcycle(motorcycle, fallbackClass = 'cc50') {
    const source = motorcycle && typeof motorcycle === 'object' ? motorcycle : {};
    const classKey = MOTORCYCLE_CLASSES[source.classKey] ? source.classKey : (MOTORCYCLE_CLASSES[source.motorcycleClass] ? source.motorcycleClass : fallbackClass);
    const spec = MOTORCYCLE_CLASSES[classKey];
    return {
        id: String(source.id || makeId('moto')),
        classKey,
        modelKey: getMotorcycleModel(source.modelKey, classKey).key,
        odometerKm: safeNumber(source.odometerKm ?? source.odometer, 0, 0, 5000000),
        fuelLiters: safeNumber(source.fuelLiters ?? source.fuel, spec.tankLiters, 0, spec.tankLiters),
        condition: safeNumber(source.condition, 100, 0, 100),
        conditionWearProgressKm: safeNumber(source.conditionWearProgressKm ?? source.conditionWearProgress, 0, 0, 9.999999),
        installedUpgrades: normalizeInstalledUpgrades(Array.isArray(source.installedUpgrades) ? source.installedUpgrades : (Array.isArray(source.upgrades) ? source.upgrades : []), classKey),
        cosmetics: Array.isArray(source.cosmetics) ? source.cosmetics.map(normalizeCosmetic) : [],
        marketplaceListingStatus: source.marketplaceListingStatus && typeof source.marketplaceListingStatus === 'object' ? { ...source.marketplaceListingStatus } : (source.listedForSale ? { listed: true } : null),
        marketplaceLastSaleRollDay: safeNumber(source.marketplaceLastSaleRollDay, 0, 0),
    };
}
function roundMoney(value) {
    return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}
function safeListingPrice(listing, motorcycle, sellerMargin) {
    const spec = MOTORCYCLE_CLASSES[motorcycle.classKey];
    if (!spec || spec.retailPrice === null) return null;
    const base = calculateMotorcycleResaleValue(motorcycle);
    if (base === null) return null;
    const roundedSellerPrice = Math.round((base * (1 + sellerMargin)) / 50) * 50;
    return Math.max(base, roundedSellerPrice);
}
function calculateMotorcycleResaleValue(motorcycle) {
    const spec = MOTORCYCLE_CLASSES[motorcycle.classKey];
    if (!spec || spec.retailPrice === null) return null;
    const km = motorcycle.odometerKm;
    const mileageDiscount = km < 5000 ? 0 : km < 15000 ? 0.03 : km < 30000 ? 0.06 : 0.10;
    const body = spec.retailPrice * (0.40 + 0.30 * motorcycle.condition / 100) * (1 - mileageDiscount);
    const upgrades = motorcycle.installedUpgrades.reduce((sum, item) => sum + getUpgradeResaleValue(item), 0);
    const cosmetics = motorcycle.cosmetics.reduce((sum, cosmetic) => sum + cosmetic.purchasePrice * 0.40, 0);
    return roundMoney(body + upgrades + cosmetics);
}
function weightedPick(values, weights = values.map(value => value.weight)) {
    const total = weights.reduce((sum, weight) => sum + weight, 0);
    let roll = Math.random() * total;
    for (let index = 0; index < values.length; index++) {
        roll -= weights[index];
        if (roll < 0) return values[index];
    }
    return values[values.length - 1];
}
function generateUsedUpgrades(condition, classKey = 'cc125') {
    if (Math.random() >= 0.40) return [];
    const count = weightedPick([1, 2, 3, 4, 5, 6], [0.34, 0.30, 0.22, 0.08, 0.04, 0.02]);
    const categories = [...UPGRADE_CATEGORIES];
    const lifespanShift = ((condition - 60) / 40) * 0.12;
    const lifespanWeights = [0.50 + lifespanShift, 0.35, 0.15 - lifespanShift];
    const lifespanBands = [[61, 100], [21, 60], [0, 20]];
    const upgrades = [];
    for (let index = 0; index < count; index++) {
        const categoryIndex = Math.floor(Math.random() * categories.length);
        const category = categories.splice(categoryIndex, 1)[0];
        const name = category.parts[Math.floor(Math.random() * category.parts.length)];
        const tier = weightedPick(UPGRADE_QUALITY_TIERS, UPGRADE_QUALITY_TIERS.map(item => item.weight));
        const band = weightedPick(lifespanBands, lifespanWeights);
        const remainingLifespan = Math.round(band[0] + Math.random() * (band[1] - band[0]));
        const fullLifeKm = getUpgradeFullLifespanKm(category.key, tier.name);
        upgrades.push({
            categoryKey: category.key, categoryLabel: category.label, name, qualityTier: tier.name,
            purchasePrice: getUpgradePrice(category.key, tier.name, classKey),
            remainingLifespan: remainingLifespan,
            remainingLifespanKm: fullLifeKm * remainingLifespan / 100,
            criticalNotified: false, expiredNotified: false,
        });
    }
    return upgrades;
}
function generateUsedCosmetics() {
    if (Math.random() >= 0.30) return [];
    const count = weightedPick([1, 2, 3, 4], [0.45, 0.30, 0.18, 0.07]);
    const remaining = [...COSMETIC_CATEGORIES];
    const cosmetics = [];
    for (let index = 0; index < count; index++) {
        const category = weightedPick(remaining, remaining.map(item => item.weight));
        remaining.splice(remaining.indexOf(category), 1);
        const option = category.options[Math.floor(Math.random() * category.options.length)];
        cosmetics.push({ ...option, categoryKey: category.key, categoryLabel: category.label });
    }
    return cosmetics;
}
function generateUsedMotorcycle() {
    const classRoll = Math.random();
    const classKey = classRoll < 0.45 ? 'cc50' : classRoll < 0.80 ? 'cc125' : 'cc250';
    const odometerKm = Math.round(500 + Math.random() * 49500);
    const mileagePressure = (odometerKm - 500) / 49500;
    const conditionWeights = [0.35 - 0.15 * mileagePressure, 0.45 - 0.05 * mileagePressure, 0.20 + 0.20 * mileagePressure];
    const conditionBand = weightedPick([[71, 100], [41, 70], [20, 40]], conditionWeights);
    const condition = Math.round(conditionBand[0] + Math.random() * (conditionBand[1] - conditionBand[0]));
    const spec = MOTORCYCLE_CLASSES[classKey];
    const bikeData = normalizeMotorcycle({
        id: makeId('used-moto'), classKey, odometerKm,
        fuelLiters: spec.tankLiters * (0.10 + Math.random() * 0.90), condition,
        installedUpgrades: generateUsedUpgrades(condition, classKey),
        cosmetics: generateUsedCosmetics(),
    }, classKey);
    const sellerMargin = 0.05 + Math.random() * 0.15;
    const listing = {
        id: makeId('ilan'), motorcycle: bikeData, sellerMargin,
        generatedDay: playerState.currentDay, expiresDay: playerState.currentDay + MARKET_MAX_DAYS,
        price: null, originalPrice: null, negotiationUsed: false, negotiationAccepted: false, negotiatedPrice: null,
    };
    listing.price = safeListingPrice(listing, bikeData, sellerMargin);
    listing.originalPrice = listing.price;
    bikeData.marketplaceListingStatus = { listed: true, listingId: listing.id, generatedDay: listing.generatedDay, listingType: 'npc' };
    return listing;
}
function normalizeListing(listing) {
    const source = listing && typeof listing === 'object' ? listing : {};
    const motorcycle = normalizeMotorcycle(source.motorcycle || source, 'cc50');
    const generatedDay = safeNumber(source.generatedDay, safeNumber(stored?.currentDay ?? stored?.day ?? 1, 1, 1), 1);
    const sellerMargin = safeNumber(source.sellerMargin, 0.10, 0.05, 0.20);
    const rawPrice = source.price ?? source.askingPrice;
    const normalized = {
        ...source,
        id: String(source.id || makeId('ilan')),
        motorcycle,
        sellerMargin,
        generatedDay,
        expiresDay: safeNumber(source.expiresDay, generatedDay + MARKET_MAX_DAYS, generatedDay, generatedDay + MARKET_MAX_DAYS),
        price: rawPrice === null || rawPrice === undefined ? null : safeNumber(rawPrice, null),
        negotiationUsed: Boolean(source.negotiationUsed),
        negotiationAccepted: Boolean(source.negotiationAccepted),
        negotiatedDiscount: safeNumber(source.negotiatedDiscount, 0, 0, 0.10),
        negotiatedPrice: source.negotiatedPrice == null ? null : safeNumber(source.negotiatedPrice, null),
    };
    if (normalized.price === null) normalized.price = safeListingPrice(normalized, motorcycle, sellerMargin);
    if (normalized.negotiationAccepted && normalized.negotiatedPrice !== null) normalized.price = normalized.negotiatedPrice;
    const resaleFloor = calculateMotorcycleResaleValue(motorcycle);
    normalized.originalPrice = source.originalPrice == null ? normalized.price : safeNumber(source.originalPrice, normalized.price);
    if (resaleFloor !== null) {
        if (normalized.originalPrice !== null) normalized.originalPrice = Math.max(resaleFloor, normalized.originalPrice);
        if (normalized.negotiatedPrice !== null) normalized.negotiatedPrice = Math.max(resaleFloor, normalized.negotiatedPrice);
        if (normalized.price !== null) normalized.price = Math.max(resaleFloor, normalized.price);
    }
    motorcycle.marketplaceListingStatus = { listed: true, listingId: normalized.id, generatedDay, listingType: 'npc' };
    return normalized;
}

function normalizePlayerSaleListing(listing) {
    const source = listing && typeof listing === 'object' ? listing : {};
    const createdDay = safeNumber(source.createdDay, safeNumber(stored?.currentDay ?? stored?.day ?? 1, 1, 1), 1);
    const rawMarkup = safeNumber(source.markup, 0.05, 0.05, 0.20);
    const markup = [0.05, 0.10, 0.15, 0.20].reduce((nearest, candidate) => Math.abs(candidate - rawMarkup) < Math.abs(nearest - rawMarkup) ? candidate : nearest, 0.05);
    return {
        id: String(source.id || makeId('satilik-ilan')),
        motorcycleId: String(source.motorcycleId || ''),
        price: safeNumber(source.price ?? source.askingPrice, 0, 0),
        markup,
        createdDay,
        expiresDay: safeNumber(source.expiresDay, createdDay + MARKET_MAX_DAYS, createdDay, createdDay + MARKET_MAX_DAYS),
        lastSaleRollDay: safeNumber(source.lastSaleRollDay, 0, 0),
    };
}
const storedPlayer = stored?.player && typeof stored.player === 'object' ? stored.player : {};
const initialMoney = safeNumber(stored?.money ?? stored?.cash ?? storedPlayer.money, 500);
const savedDelivery = stored?.deliveryState && typeof stored.deliveryState === 'object' ? stored.deliveryState : {};
const savedPhase = ['wait', 'pickup', 'deliver'].includes(savedDelivery.phase) ? savedDelivery.phase : 'wait';
const savedRestaurantIndex = Number.isInteger(savedDelivery.restaurantIndex) ? savedDelivery.restaurantIndex : -1;
const savedCustomerIndex = Number.isInteger(savedDelivery.customerIndex) ? savedDelivery.customerIndex : -1;
const game = {
    running: false,
    money: initialMoney,
    deliveries: safeNumber(stored?.deliveries, 0),
    phase: Boolean(stored?.shiftActive ?? storedPlayer.shiftActive) ? savedPhase : 'wait',
    timeLeft: safeNumber(savedDelivery.timeLeft, 0, 0, 1000),
    restaurant: savedRestaurantIndex >= 0 ? restaurants[savedRestaurantIndex] || null : null,
    customer: savedCustomerIndex >= 0 ? customers[savedCustomerIndex] || null : null,
    reward: safeNumber(savedDelivery.reward, 0, 0),
    activeOrderId: String(savedDelivery.activeOrderId || ''),
    orderSettled: Boolean(savedDelivery.orderSettled),
    deliveryClass: DELIVERY_CLASSES[savedDelivery.deliveryClass] ? savedDelivery.deliveryClass : '',
    deliveryTargetSeconds: safeNumber(savedDelivery.deliveryTargetSeconds, 0, 0, 600),
    deliveryGraceSeconds: safeNumber(savedDelivery.deliveryGraceSeconds, 0, 0, 300),
    deliveryElapsed: safeNumber(savedDelivery.deliveryElapsed, 0, 0, 1000),
    pickupDistanceKm: safeNumber(savedDelivery.pickupDistanceKm, 0, 0, 100),
};
const savedMotorcycles = Array.isArray(stored?.motorcycles) ? stored.motorcycles : (Array.isArray(stored?.garage?.motorcycles) ? stored.garage.motorcycles : []);
const rawMarketListings = Array.isArray(stored?.usedMarketListings) ? stored.usedMarketListings : (Array.isArray(stored?.marketListings) ? stored.marketListings : []);
const playerState = {
    currentDay: safeNumber(stored?.currentDay ?? stored?.day ?? storedPlayer.currentDay, 1, 1),
    shiftActive: Boolean(stored?.shiftActive ?? storedPlayer.shiftActive ?? false),
    shiftStartsAt: '09:00',
    shiftSecondsRemaining: safeNumber(stored?.shiftSecondsRemaining, SHIFT_DURATION_SECONDS, 0, SHIFT_DURATION_SECONDS),
    shiftDeliveries: safeNumber(stored?.shiftDeliveries, 0, 0),
    shiftEndPending: Boolean(stored?.shiftEndPending ?? false),
    career: normalizeCareer(stored?.career, safeNumber(stored?.deliveries, 0)),
    dailySummary: normalizeDailySummary(stored?.dailySummary, safeNumber(stored?.currentDay ?? stored?.day ?? storedPlayer.currentDay, 1, 1), initialMoney),
    pendingNextDay: Boolean(stored?.pendingNextDay ?? false),
    garageCapacity: safeNumber(stored?.garageCapacity ?? stored?.garage?.capacity, 2, 1, 10),
    maximumGarageCapacity: 10,
    motorcycles: savedMotorcycles.map(motorcycle => normalizeMotorcycle(motorcycle)),
    activeMotorcycleId: String(stored?.activeMotorcycleId ?? stored?.garage?.activeMotorcycleId ?? ''),
    usedMarketListings: rawMarketListings.map(normalizeListing),
    playerSaleListings: Array.isArray(stored?.playerSaleListings) ? stored.playerSaleListings.map(normalizePlayerSaleListing) : [],
    favorites: Array.isArray(stored?.favorites) ? [...new Set(stored.favorites.map(String))] : [],
    marketNotifications: Array.isArray(stored?.marketNotifications) ? stored.marketNotifications.map(String) : [],
    dailyPrices: normalizeDailyPrices(stored?.dailyPrices),
    roadsideAssistance: normalizeRoadsideAssistance(stored?.roadsideAssistance),
    roadsideRepair: normalizeRoadsideRepair(stored?.roadsideRepair),
};
if (playerState.motorcycles.length === 0) {
    const starter = normalizeMotorcycle({ id: makeId('moto'), classKey: 'cc50', odometerKm: 0, fuelLiters: 5, condition: 100, installedUpgrades: [], cosmetics: [], marketplaceListingStatus: null });
    playerState.motorcycles.push(starter);
}
playerState.garageCapacity = Math.min(10, Math.max(playerState.garageCapacity, playerState.motorcycles.length));
const motorcycleIds = new Set(playerState.motorcycles.map(motorcycle => motorcycle.id));
const playerListingIds = new Set();
playerState.playerSaleListings = playerState.playerSaleListings.filter(listing => {
    if (!motorcycleIds.has(listing.motorcycleId) || playerListingIds.has(listing.motorcycleId)) return false;
    playerListingIds.add(listing.motorcycleId);
    return true;
});
for (const motorcycle of playerState.motorcycles) {
    const playerListing = playerState.playerSaleListings.find(listing => listing.motorcycleId === motorcycle.id);
    if (playerListing) {
        motorcycle.marketplaceListingStatus = { listed: true, listingId: playerListing.id, listingType: 'player', createdDay: playerListing.createdDay, expiresDay: playerListing.expiresDay };
    } else if (motorcycle.marketplaceListingStatus?.listed) {
        motorcycle.marketplaceListingStatus = null;
    }
}
if (!playerState.motorcycles.some(motorcycle => !motorcycle.marketplaceListingStatus?.listed)) {
    const recoveredMotorcycle = playerState.motorcycles[0];
    playerState.playerSaleListings = playerState.playerSaleListings.filter(listing => listing.motorcycleId !== recoveredMotorcycle.id);
    recoveredMotorcycle.marketplaceListingStatus = null;
    playerState.marketNotifications.push('Kayıt uyumluluğu için en az bir motosiklet garajda kullanılabilir duruma getirildi.');
}
if (!playerState.motorcycles.some(motorcycle => motorcycle.id === playerState.activeMotorcycleId && !motorcycle.marketplaceListingStatus?.listed)) {
    playerState.activeMotorcycleId = playerState.motorcycles.find(motorcycle => !motorcycle.marketplaceListingStatus?.listed)?.id || playerState.motorcycles[0].id;
}
let activeMotorcycle = playerState.motorcycles.find(motorcycle => motorcycle.id === playerState.activeMotorcycleId) || playerState.motorcycles[0];
setPlayerMotorcycleVisual(activeMotorcycle.modelKey);
const savedPosition = stored?.playerPosition && typeof stored.playerPosition === 'object' ? stored.playerPosition : {};
state.x = safeNumber(savedPosition.x, state.x, -MINIMAP_EDGE + BIKE_R, MINIMAP_EDGE - BIKE_R);
state.z = safeNumber(savedPosition.z, state.z, -MINIMAP_EDGE + BIKE_R, MINIMAP_EDGE - BIKE_R);
state.heading = safeNumber(savedPosition.heading, state.heading, -Math.PI * 100, Math.PI * 100);
state.speed = 0;
bike.position.set(state.x, 0, state.z);
bike.rotation.y = state.heading;
if ((game.phase === 'pickup' && !game.restaurant) || (game.phase === 'deliver' && (!game.restaurant || !game.customer || !game.deliveryClass))) {
    game.phase = 'wait';
    game.timeLeft = 0;
    game.restaurant = null;
    game.customer = null;
}
const savedMotorcycleIds = new Set(playerState.motorcycles.map(motorcycle => motorcycle.id));
if (!savedMotorcycleIds.has(playerState.roadsideAssistance.motorcycleId)) playerState.roadsideAssistance = normalizeRoadsideAssistance(null);
if (!savedMotorcycleIds.has(playerState.roadsideRepair.motorcycleId)) playerState.roadsideRepair = normalizeRoadsideRepair(null);
const marketWasMissing = !Array.isArray(stored?.usedMarketListings) && !Array.isArray(stored?.marketListings);
const uniqueMarketListings = new Map();
for (const listing of playerState.usedMarketListings) {
    if (listing?.id && !uniqueMarketListings.has(listing.id)) uniqueMarketListings.set(listing.id, listing);
}
let marketListings = [...uniqueMarketListings.values()].slice(0, 5);
let marketNeedsRepair = marketWasMissing || marketListings.length !== 5 || marketListings.length !== playerState.usedMarketListings.length;
if (marketWasMissing || marketListings.length === 0) marketListings = Array.from({ length: 5 }, generateUsedMotorcycle);
while (marketListings.length < 5) marketListings.push(generateUsedMotorcycle());
if (marketListings.length > 5) marketListings.length = 5;
playerState.usedMarketListings = marketListings;
let activeGarageTab = 'owned';
let selectedPerformanceMotorcycleId = '';
let selectedMarketListingId = '';
let selectedSellMotorcycleId = '';
let garageOpen = false;
let simulationPaused = false;
let settingsOverlayOpen = false;
let resumeWasRunning = false;
let activeSettingsTab = 'graphics';
let pendingConfirmation = null;

const settingsOverlay = document.getElementById('settings-overlay');
const settingsContent = document.getElementById('settings-content');

function settingsSliderRow(title, description, value, attribute, key, min = 0, max = 100, disabled = false) {
    const settingId = `${attribute}-${key}`;
    return `<label class="settings-row">
      <span><strong>${title}</strong><small>${description}</small></span>
      <span class="settings-control"><input class="settings-range" type="range" min="${min}" max="${max}" step="1" value="${value}" data-${attribute}="${key}" aria-label="${title}" ${disabled ? 'disabled' : ''}><output class="settings-value" data-setting-value="${settingId}">${value}%</output></span>
    </label>`;
}

function renderSettingsContent() {
    if (activeSettingsTab === 'graphics') {
        const presets = [
            ['low', 'Düşük', 'Daha akıcı performans, gölgesiz ve kısa çizim mesafesi.'],
            ['medium', 'Orta', 'Dengeli performans ve temel gölgeler.'],
            ['high', 'Yüksek', 'Daha net görüntü, yumuşak gölgeler ve geniş görüş.'],
            ['ultra', 'Ultra', 'En yüksek çözünürlük ve çizim mesafesi; güçlü cihaz önerilir.'],
        ];
        settingsContent.innerHTML = `<h3 class="settings-section-title">Görüntü kalitesi</h3>
          <div class="settings-presets">${presets.map(([key, label]) => `<button class="settings-preset${settings.graphics === key ? ' active' : ''}" data-graphics-preset="${key}" aria-pressed="${settings.graphics === key}">${label}</button>`).join('')}</div>
          <p class="settings-note">${presets.find(([key]) => key === settings.graphics)?.[2] || ''} Değişiklik anında uygulanır.</p>`;
        return;
    }
    if (activeSettingsTab === 'audio') {
        const audioRows = [
            ['master', 'Ana Ses', 'Tüm oyun seslerinin genel seviyesi.'],
            ['music', 'Müzik', 'engine-pulse.mp3 ana tema.'],
            ['radio', 'Radyo', 'Canlı istasyonlar doğrulanmadı; radyo sesi devre dışı.', true],
            ['engine', 'Motosiklet', 'Oyuncunun motor sesi.'],
            ['traffic', 'Trafik', 'Yakındaki gerçek trafik araçlarına bağlı motor sesi.'],
            ['environment', 'Çevre Sesleri', 'Uzak kıyı ambiyansı; motor ve trafik içermez.'],
            ['voices', 'İnsan Sesleri', 'Teslimatta yalnızca Türkçe sistem sesi varsa konuşur.'],
            ['ui', 'Arayüz', 'Teslimat ve para bildirimleri.'],
        ];
        settingsContent.innerHTML = `<h3 class="settings-section-title">Ses düzeyleri</h3>
          ${audioRows.map(([key, title, description, disabled]) => settingsSliderRow(title, description, settings.audio[key], 'setting-audio', key, 0, 100, disabled)).join('')}
          <div class="settings-row settings-mute-row"><span><strong>Ses</strong><small>Üstteki hoparlör düğmesiyle de değiştirilebilir.</small></span><button class="garage-action ${settings.audio.muted ? 'secondary' : ''}" data-settings-action="toggle-mute" aria-pressed="${settings.audio.muted}">${settings.audio.muted ? 'Sesi aç' : 'Sesi kapat'}</button></div>
          <p class="settings-note">Ayarlar kaydedilip yumuşak geçişle uygulanır. Doğrulanmış canlı radyo yayını eklenmedi.</p>`;
        return;
    }
    settingsContent.innerHTML = `<h3 class="settings-section-title">Sürüş ve kontroller</h3>
      <label class="settings-row"><span><strong>Kontrol Yöntemi</strong><small>Yön düğmeleri varsayılandır; klavye her yöntemde çalışır.</small></span>
        <span class="settings-control"><select class="settings-range" data-control-method aria-label="Kontrol Yöntemi">
          <option value="buttons" ${settings.controlMethod === 'buttons' ? 'selected' : ''}>Yön Tuşları</option>
          <option value="touch" ${settings.controlMethod === 'touch' ? 'selected' : ''}>Dokunmatik Kaydırma</option>
          <option value="tilt" ${settings.controlMethod === 'tilt' ? 'selected' : ''} ${tiltControl.supported ? '' : 'disabled'}>Telefonu Eğerek${tiltControl.supported ? '' : ' (desteklenmiyor)'}</option>
        </select></span></label>
      ${settings.controlMethod === 'tilt' ? `<div class="settings-row"><span><strong>Eğim sensörü</strong><small id="tilt-control-status">${tiltControl.status}</small></span><button class="garage-action" data-settings-action="enable-tilt" ${tiltControl.supported ? '' : 'disabled'}>İzin Ver / Yeniden Ortala</button></div>` : ''}
      ${settingsSliderRow('Direksiyon Hassasiyeti', 'Dokunmatik ve eğim dönüş hassasiyeti; klavye ve yön tuşlarına da uygulanır.', settings.controlSensitivity, 'setting-control', 'sensitivity', 50, 150)}
      <div class="settings-row"><span><strong>Bilgisayar</strong><small>W / ↑ gaz · S / ↓ fren ve geri · A/D veya ←/→ direksiyon · E istasyonda etkileşim · Esc duraklat</small></span></div>
      <div class="settings-row"><span><strong>Mobil</strong><small>Dokunmatik kaydırmada gaz ve fren için sağ alttaki düğmeleri kullan. Eğim sensörü izni cihaz ayarına bağlıdır.</small></span></div>
      <p class="settings-note">Yöntem ve hassasiyet ayarları kaydedilir. Kaydırma alanı oyun sırasında sol altta görünür.</p>`;
}

function openSettingsMenu() {
    if (settingsOverlayOpen) return;
    resumeWasRunning = game.running;
    simulationPaused = true;
    settingsOverlayOpen = true;
    for (const key of Object.keys(input)) input[key] = false;
    touchSteerTarget = 0;
    document.querySelectorAll('.tb').forEach(button => button.classList.remove('on'));
    document.querySelector('[data-settings-action="resume"]').textContent = resumeWasRunning ? 'Devam Et' : 'Kapat';
    settingsOverlay.classList.add('open');
    settingsOverlay.setAttribute('aria-hidden', 'false');
    renderSettingsContent();
}

function closeSettingsMenu() {
    if (!settingsOverlayOpen) return;
    settingsOverlay.classList.remove('open');
    settingsOverlay.setAttribute('aria-hidden', 'true');
    settingsOverlayOpen = false;
    simulationPaused = false;
}
let saveTimer = 0;
let fuelEmptyShown = false;
let fuelWarningLowShown = false;
let fuelWarningCriticalShown = false;
let conditionWarningShown = false;
let conditionCriticalShown = false;
let conditionImmobilizedShown = false;
let stationMenuOpen = false;
let currentStation = null;
let servicePanelOpen = false;
let serviceMode = '';
let serviceRefuelMode = 'liters';
let pushMode = false;
let pushTarget = null;
let collisionDamageCooldown = 0;
let collisionContactActive = false;
let serviceSaveTimer = 0;
let missionTransitionTimer = 0;
let shiftSaveTimer = 0;

function persistGame() {
    if (!STORAGE || saveWriteBlocked) return false;
    const payload = {
        ...(stored || {}),
        version: 5,
        money: game.money,
        deliveries: game.deliveries,
        currentDay: playerState.currentDay,
        shiftActive: playerState.shiftActive,
        shiftStartsAt: playerState.shiftStartsAt,
        shiftSecondsRemaining: playerState.shiftSecondsRemaining,
        shiftDeliveries: playerState.shiftDeliveries,
        shiftEndPending: playerState.shiftEndPending,
        pendingNextDay: playerState.pendingNextDay,
        career: playerState.career,
        dailySummary: playerState.dailySummary,
        deliveryState: {
            phase: game.phase,
            restaurantIndex: game.restaurant ? restaurants.indexOf(game.restaurant) : -1,
            customerIndex: game.customer ? customers.indexOf(game.customer) : -1,
            timeLeft: game.timeLeft,
            reward: game.reward,
            activeOrderId: game.activeOrderId,
            orderSettled: game.orderSettled,
            deliveryClass: game.deliveryClass,
            deliveryTargetSeconds: game.deliveryTargetSeconds,
            deliveryGraceSeconds: game.deliveryGraceSeconds,
            deliveryElapsed: game.deliveryElapsed,
            pickupDistanceKm: game.pickupDistanceKm,
        },
        playerPosition: { x: state.x, z: state.z, heading: state.heading },
        motorcycles: playerState.motorcycles,
        activeMotorcycleId: playerState.activeMotorcycleId,
        garageCapacity: playerState.garageCapacity,
        maximumGarageCapacity: playerState.maximumGarageCapacity,
        usedMarketListings: playerState.usedMarketListings,
        playerSaleListings: playerState.playerSaleListings,
        favorites: playerState.favorites,
        marketNotifications: playerState.marketNotifications,
        dailyPrices: playerState.dailyPrices,
        roadsideAssistance: playerState.roadsideAssistance,
        roadsideRepair: playerState.roadsideRepair,
    };
    try {
        STORAGE.setItem(SAVE_KEY, JSON.stringify(payload));
        stored = payload;
        if (legacySaveKey && legacySaveKey !== SAVE_KEY) {
            try { STORAGE.setItem(legacySaveKey, JSON.stringify(payload)); } catch { /* Keep the current save even if old storage is read-only. */ }
        }
        return true;
    } catch (error) {
        console.warn('[Garaj] Kayıt yapılamadı:', error);
        saveWriteBlocked = true;
        return false;
    }
}
function restoreMarketplaceSnapshot(snapshot) {
    game.money = snapshot.money;
    playerState.currentDay = snapshot.currentDay;
    playerState.pendingNextDay = snapshot.pendingNextDay;
    playerState.shiftActive = snapshot.shiftActive;
    playerState.shiftSecondsRemaining = snapshot.shiftSecondsRemaining;
    playerState.shiftDeliveries = snapshot.shiftDeliveries;
    playerState.shiftEndPending = snapshot.shiftEndPending;
    playerState.career = snapshot.career;
    playerState.dailySummary = snapshot.dailySummary;
    playerState.garageCapacity = snapshot.garageCapacity;
    playerState.motorcycles = snapshot.motorcycles.map(motorcycle => normalizeMotorcycle(motorcycle));
    playerState.activeMotorcycleId = snapshot.activeMotorcycleId;
    playerState.usedMarketListings = snapshot.usedMarketListings.map(normalizeListing);
    playerState.playerSaleListings = snapshot.playerSaleListings.map(normalizePlayerSaleListing);
    playerState.favorites = [...snapshot.favorites];
    playerState.marketNotifications = [...snapshot.marketNotifications];
    playerState.dailyPrices = normalizeDailyPrices(snapshot.dailyPrices);
    playerState.roadsideAssistance = normalizeRoadsideAssistance(snapshot.roadsideAssistance);
    playerState.roadsideRepair = normalizeRoadsideRepair(snapshot.roadsideRepair);
    activeMotorcycle = getActiveMotorcycle();
}
function commitMarketplaceTransaction(mutator, allowVolatile = false) {
    const canPersist = Boolean(STORAGE && !saveWriteBlocked);
    if (!canPersist && !allowVolatile) {
        showGarageMessage('İşlem güvenli biçimde kaydedilemiyor; kayıt erişimi düzelene kadar pazar işlemi yapılamaz.');
        return false;
    }
    const snapshot = JSON.parse(JSON.stringify({
        money: game.money,
        currentDay: playerState.currentDay,
        pendingNextDay: playerState.pendingNextDay,
        shiftActive: playerState.shiftActive,
        shiftSecondsRemaining: playerState.shiftSecondsRemaining,
        shiftDeliveries: playerState.shiftDeliveries,
        shiftEndPending: playerState.shiftEndPending,
        career: JSON.parse(JSON.stringify(playerState.career)),
        dailySummary: JSON.parse(JSON.stringify(playerState.dailySummary)),
        garageCapacity: playerState.garageCapacity,
        motorcycles: playerState.motorcycles,
        activeMotorcycleId: playerState.activeMotorcycleId,
        usedMarketListings: playerState.usedMarketListings,
        playerSaleListings: playerState.playerSaleListings,
        favorites: playerState.favorites,
        marketNotifications: playerState.marketNotifications,
        dailyPrices: playerState.dailyPrices,
        roadsideAssistance: playerState.roadsideAssistance,
        roadsideRepair: playerState.roadsideRepair,
    }));
    try {
        mutator();
    } catch (error) {
        restoreMarketplaceSnapshot(snapshot);
        console.error('[Pazar] İşlem geri alındı:', error);
        showGarageMessage('Pazar işlemi tamamlanamadı; değişiklikler geri alındı.');
        return false;
    }
    if (!canPersist || persistGame()) return true;
    restoreMarketplaceSnapshot(snapshot);
    showGarageMessage('Kayıt başarısız oldu; pazar işlemi geri alındı.');
    return false;
}
window.addEventListener('pagehide', persistGame);

const hasLegacyMotorcycleMarketData = savedMotorcycles.some(motorcycle => {
    const bikeData = motorcycle && typeof motorcycle === 'object' ? motorcycle : {};
    const parts = Array.isArray(bikeData.installedUpgrades) ? bikeData.installedUpgrades : (Array.isArray(bikeData.upgrades) ? bikeData.upgrades : []);
    const cosmetics = Array.isArray(bikeData.cosmetics) ? bikeData.cosmetics : [];
    return !('marketplaceLastSaleRollDay' in bikeData)
        || !('conditionWearProgressKm' in bikeData)
        || parts.some(upgrade => typeof upgrade === 'string' || !upgrade?.categoryKey || !upgrade?.qualityTier)
        || cosmetics.some(cosmetic => typeof cosmetic === 'string');
});
const hasLegacyListingData = rawMarketListings.some(listing => {
    const source = listing && typeof listing === 'object' ? listing : {};
    return !('negotiationUsed' in source) || !('originalPrice' in source);
});
const saveMigrationNeeded = !stored || legacySaveKey || marketNeedsRepair || hasLegacyMotorcycleMarketData || hasLegacyListingData
    || stored?.version !== 5
    || !stored?.career || !stored?.dailySummary || !stored?.deliveryState || !stored?.playerPosition
    || !('shiftSecondsRemaining' in (stored || {})) || !('shiftDeliveries' in (stored || {}))
    || !stored?.dailyPrices
    || !('roadsideAssistance' in (stored || {}))
    || !('roadsideRepair' in (stored || {}))
    || playerState.motorcycles.length !== savedMotorcycles.length
    || !('money' in stored && ('currentDay' in stored || 'day' in stored))
    || !('shiftActive' in stored)
    || !('activeMotorcycleId' in stored)
    || !('garageCapacity' in stored)
    || !Array.isArray(stored?.favorites)
    || !Array.isArray(stored?.playerSaleListings);
if (!saveWriteBlocked && saveMigrationNeeded) persistGame();

function currentMotorcycleSpec() {
    return MOTORCYCLE_CLASSES[activeMotorcycle.classKey] || MOTORCYCLE_CLASSES.cc50;
}
function canModifyGarage() {
    if (playerState.shiftActive) {
        setGarageNotice('Aktif vardiyada garaj işlemleri yapılamaz. Önce vardiyayı bitir.');
        return false;
    }
    return true;
}
function setGarageNotice(message) {
    const notice = document.getElementById('garage-notice');
    notice.textContent = message;
}
function formatMoneyPrecise(value) {
    return `₺${Number(value).toLocaleString('tr-TR', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
}
function pushMarketNotification(message) {
    playerState.marketNotifications.push(message);
    if (playerState.marketNotifications.length > 20) playerState.marketNotifications.splice(0, playerState.marketNotifications.length - 20);
}
function getCareerLevel() {
    return playerState.career.level;
}
function negotiationAcceptanceChance(discount) {
    const base = discount === 0.05 ? 0.80 : discount === 0.07 ? 0.55 : 0.30;
    const levelBonus = Math.min(0.10, Math.floor(getCareerLevel() / 5) * 0.02);
    return Math.min(1, base + levelBonus);
}
function playerSaleChance(markup) {
    if (markup <= 0.05) return 0.70;
    if (markup <= 0.10) return 0.50;
    if (markup <= 0.15) return 0.30;
    return 0.15;
}
function replaceListing(index) {
    const old = playerState.usedMarketListings[index];
    if (old && playerState.favorites.includes(old.id)) {
        playerState.favorites = playerState.favorites.filter(id => id !== old.id);
        pushMarketNotification(`${MOTORCYCLE_CLASSES[old.motorcycle.classKey].label} ilanı pazardan kalktı; favorilerinden çıkarıldı. Favoriler ilanı ayırmaz.`);
    }
    playerState.usedMarketListings[index] = generateUsedMotorcycle();
}
function refreshMarketForNewDay(day) {
    const expiredIndices = [];
    for (let index = 0; index < playerState.usedMarketListings.length; index++) {
        if (day >= playerState.usedMarketListings[index].expiresDay) expiredIndices.push(index);
    }
    const replaceIndices = [...expiredIndices];
    if (expiredIndices.length < 3) {
        const remaining = playerState.usedMarketListings.map((_, index) => index).filter(index => !expiredIndices.includes(index));
        const extraCount = Math.min(remaining.length, 1 + Math.floor(Math.random() * 2));
        for (let i = 0; i < extraCount; i++) {
            const pick = Math.floor(Math.random() * remaining.length);
            replaceIndices.push(remaining.splice(pick, 1)[0]);
        }
    }
    for (const index of replaceIndices) replaceListing(index);
    while (playerState.usedMarketListings.length < 5) playerState.usedMarketListings.push(generateUsedMotorcycle());
    if (playerState.usedMarketListings.length > 5) playerState.usedMarketListings.length = 5;
}
function processPlayerListingsForNewDay(day) {
    for (const listing of [...playerState.playerSaleListings]) {
        const motorcycle = playerState.motorcycles.find(item => item.id === listing.motorcycleId);
        if (!motorcycle) {
            playerState.playerSaleListings = playerState.playerSaleListings.filter(item => item.id !== listing.id);
            continue;
        }
        if (playerState.motorcycles.length <= 1 || motorcycle.id === playerState.activeMotorcycleId) {
            playerState.playerSaleListings = playerState.playerSaleListings.filter(item => item.id !== listing.id);
            motorcycle.marketplaceListingStatus = null;
            pushMarketNotification('Güvenlik nedeniyle son veya aktif motosikletin satış ilanı kapatıldı.');
            continue;
        }
        if (day > listing.createdDay && motorcycle.marketplaceLastSaleRollDay < day && listing.lastSaleRollDay < day) {
            listing.lastSaleRollDay = day;
            motorcycle.marketplaceLastSaleRollDay = day;
            if (Math.random() < playerSaleChance(listing.markup)) {
                const salePrice = listing.price;
                playerState.motorcycles = playerState.motorcycles.filter(item => item.id !== motorcycle.id);
                playerState.playerSaleListings = playerState.playerSaleListings.filter(item => item.id !== listing.id);
                game.money = roundMoney(game.money + salePrice);
                pushMarketNotification(`${MOTORCYCLE_CLASSES[motorcycle.classKey].label} motosikletin ${formatMoneyPrecise(salePrice)} karşılığında satıldı.`);
                continue;
            }
        }
        if (day >= listing.expiresDay) {
            playerState.playerSaleListings = playerState.playerSaleListings.filter(item => item.id !== listing.id);
            motorcycle.marketplaceListingStatus = null;
            pushMarketNotification(`${MOTORCYCLE_CLASSES[motorcycle.classKey].label} satış ilanının süresi doldu; motosikletin yeniden kullanılabilir.`);
        }
    }
}
function getActiveMotorcycle() {
    return playerState.motorcycles.find(motorcycle => motorcycle.id === playerState.activeMotorcycleId && !motorcycle.marketplaceListingStatus?.listed) || playerState.motorcycles.find(motorcycle => !motorcycle.marketplaceListingStatus?.listed) || playerState.motorcycles[0];
}
function getUpgradeMap(motorcycle) {
    return new Map(motorcycle.installedUpgrades.map(item => [item.categoryKey, item]));
}
function getActiveCompatibilityBonuses(motorcycle) {
    const installed = getUpgradeMap(motorcycle);
    return UPGRADE_COMPATIBILITY.flatMap(pair => {
        const first = installed.get(pair.categories[0]);
        const second = installed.get(pair.categories[1]);
        if (!first || !second || getUpgradeRemainingKm(first) <= 0 || getUpgradeRemainingKm(second) <= 0) return [];
        const tierIndex = Math.min(upgradeTierIndex(first.qualityTier), upgradeTierIndex(second.qualityTier));
        return [{ ...pair, tierIndex, amount: pair.values[tierIndex] }];
    });
}
let performanceEffectsCache = null;
let performanceEffectsMotorcycle = null;
let performanceEffectsParts = null;
let performanceEffectsAge = 0;
function getPerformanceEffects(motorcycle, dt = 0) {
    const parts = motorcycle.installedUpgrades;
    performanceEffectsAge += Math.max(0, dt);
    if (performanceEffectsCache && performanceEffectsMotorcycle === motorcycle
        && performanceEffectsParts === parts && performanceEffectsAge < 0.25) {
        return performanceEffectsCache;
    }

    const totals = { acceleration: 0, topSpeed: 0, braking: 0, grip: 0, stability: 0, fuelReduction: 0, throttleResponse: 0 };
    const installed = getUpgradeMap(motorcycle);
    for (const item of parts) {
        if (getUpgradeRemainingKm(item) <= 0) continue;
        const effect = getUpgradeCategory(item.categoryKey).effects[upgradeTierIndex(item.qualityTier)];
        for (const [stat, value] of Object.entries(effect)) totals[stat] += value;
    }
    for (const pair of UPGRADE_COMPATIBILITY) {
        const first = installed.get(pair.categories[0]);
        const second = installed.get(pair.categories[1]);
        if (!first || !second || getUpgradeRemainingKm(first) <= 0 || getUpgradeRemainingKm(second) <= 0) continue;
        const tierIndex = Math.min(upgradeTierIndex(first.qualityTier), upgradeTierIndex(second.qualityTier));
        totals[pair.stat] += pair.values[tierIndex];
    }

    performanceEffectsCache = totals;
    performanceEffectsMotorcycle = motorcycle;
    performanceEffectsParts = parts;
    performanceEffectsAge = 0;
    return performanceEffectsCache;
}
function formatUpgradePercent(value, includePlus = true) {
    const formatted = Number((value * 100).toFixed(2)).toLocaleString('tr-TR', { maximumFractionDigits: 2 });
    return `${includePlus && value > 0 ? '+' : ''}${formatted}%`;
}
function getUpgradeEffectLabels(effects) {
    const labels = {
        acceleration: 'Hızlanma', topSpeed: 'Azami hız', braking: 'Frenleme', grip: 'Yol tutuşu',
        stability: 'Denge', fuelReduction: 'Yakıt tüketimi azalması', throttleResponse: 'Gaz tepkisi',
    };
    return Object.entries(effects).filter(([, value]) => value !== 0).map(([stat, value]) => `${labels[stat]} ${formatUpgradePercent(value)}`);
}
function getUpgradeStatus(upgrade) {
    const percent = getUpgradeRemainingPercent(upgrade);
    return UPGRADE_TIER_LIFESPAN_STATUS.find(status => percent >= status.minimum) || UPGRADE_TIER_LIFESPAN_STATUS.at(-1);
}
function getUpgradeCompatibilityText(motorcycle, categoryKey) {
    const installed = getUpgradeMap(motorcycle);
    return UPGRADE_COMPATIBILITY.filter(pair => pair.categories.includes(categoryKey)).map(pair => {
        const otherKey = pair.categories.find(key => key !== categoryKey);
        const first = installed.get(pair.categories[0]);
        const second = installed.get(pair.categories[1]);
        const firstFunctional = first && getUpgradeRemainingKm(first) > 0;
        const secondFunctional = second && getUpgradeRemainingKm(second) > 0;
        if (firstFunctional && secondFunctional) {
            const tierIndex = Math.min(upgradeTierIndex(first.qualityTier), upgradeTierIndex(second.qualityTier));
            return `${pair.label}: etkin · ${getUpgradeEffectLabels({ [pair.stat]: pair.values[tierIndex] }).join(', ')} (${UPGRADE_QUALITY_TIERS[tierIndex].name} seviyesi)`;
        }
        const otherPart = installed.get(otherKey);
        const stateText = !otherPart ? `${getUpgradeCategory(otherKey).label} takılınca etkinleşir` : 'parçalardan birinin ömrü bitmiş';
        return `${pair.label}: ${stateText} · ${pair.values.map(value => formatUpgradePercent(value)).join(' / ')}`;
    });
}
function getCurrentUpgradeBonusText(motorcycle, categoryKey) {
    const item = getUpgradeMap(motorcycle).get(categoryKey);
    if (!item) return 'Takılı parça yok; etkin bonus yok.';
    if (getUpgradeRemainingKm(item) <= 0) return 'Parça ömrünü tamamladı; performans bonusu yok.';
    const own = getUpgradeCategory(categoryKey).effects[upgradeTierIndex(item.qualityTier)];
    const compatibility = getActiveCompatibilityBonuses(motorcycle).filter(pair => pair.categories.includes(categoryKey));
    const details = getUpgradeEffectLabels(own);
    for (const pair of compatibility) details.push(`${pair.label} uyumu: ${getUpgradeEffectLabels({ [pair.stat]: pair.amount }).join(', ')}`);
    return details.join(' · ') || 'Ek performans bonusu yok.';
}
function renderPerformanceTab() {
    if (!playerState.motorcycles.some(motorcycle => motorcycle.id === selectedPerformanceMotorcycleId)) {
        selectedPerformanceMotorcycleId = activeMotorcycle.id;
    }
    const motorcycle = playerState.motorcycles.find(item => item.id === selectedPerformanceMotorcycleId) || activeMotorcycle;
    const listed = Boolean(motorcycle.marketplaceListingStatus?.listed);
    const editable = !playerState.shiftActive && !listed;
    const selector = playerState.motorcycles.map(item => {
        const isSelected = item.id === motorcycle.id;
        const className = MOTORCYCLE_CLASSES[item.classKey].label;
        return `<button class="garage-action ${isSelected ? '' : 'secondary'}" data-action="performance-select" data-id="${escapeHTML(item.id)}">${escapeHTML(className)}${item.id === activeMotorcycle.id ? ' · Aktif' : ''}${item.marketplaceListingStatus?.listed ? ' · İlanda' : ''}</button>`;
    }).join(' ');
    const cards = UPGRADE_CATEGORIES.map(category => {
        const installed = motorcycle.installedUpgrades.find(item => item.categoryKey === category.key);
        const percent = installed ? getUpgradeRemainingPercent(installed) : 0;
        const lifeStatus = installed ? getUpgradeStatus(installed) : null;
        const tradeIn = installed ? getUpgradeResaleValue(installed) : 0;
        const compatibility = getUpgradeCompatibilityText(motorcycle, category.key);
        return `<article class="garage-card performance-card">
          <h3>${escapeHTML(category.label)}</h3>
          ${installed ? `<p>Takılı: <strong>${escapeHTML(installed.name)}</strong> · <strong>${escapeHTML(installed.qualityTier)}</strong></p>
            <p class="part-life ${lifeStatus.className}">Kalan ömür: <strong>%${Math.round(percent)}</strong> · ${formatDecimal(getUpgradeRemainingKm(installed), 2)} / ${getUpgradeFullLifespanKm(category.key, installed.qualityTier).toLocaleString('tr-TR')} km · ${lifeStatus.label}</p>
            <p>Mevcut performans bonusu: <strong>${escapeHTML(getCurrentUpgradeBonusText(motorcycle, category.key))}</strong></p>
            <p>Takas / satış değeri: <strong>${formatMoneyPrecise(tradeIn)}</strong> (parça bedelinin %50'si × kalan ömür)</p>`
            : `<p><strong>Takılı değil</strong></p><p>Mevcut performans bonusu: <strong>Yok</strong></p><p>Takas değeri: <strong>₺0</strong></p>`}
          ${compatibility.map(text => `<p class="compatibility-note">Uyum: ${escapeHTML(text)}</p>`).join('')}
          <p class="upgrade-options-title">Mevcut yükseltme seçenekleri:</p>
          ${UPGRADE_QUALITY_TIERS.map(tier => `<button class="garage-action secondary" data-action="performance-buy" data-category="${category.key}" data-tier="${escapeHTML(tier.name)}" ${editable ? '' : 'disabled'}>${tier.name} · ${formatMoney(getUpgradePrice(category.key, tier.name, motorcycle.classKey))}</button>`).join('')}
          ${installed ? `<button class="garage-action secondary" data-action="performance-remove" data-category="${category.key}" ${editable ? '' : 'disabled'}>Parçayı sat · ${formatMoneyPrecise(tradeIn)}</button>` : ''}
          ${playerState.shiftActive ? '<p>Aktif vardiyada parçalar incelenebilir; değişiklik yapılamaz.</p>' : ''}
          ${listed ? '<p>Satış ilanındaki motosikletin parçaları değiştirilemez.</p>' : ''}
        </article>`;
    }).join('');
    return `<article class="garage-card performance-selector"><h3>Performans · ${escapeHTML(MOTORCYCLE_CLASSES[motorcycle.classKey].label)}</h3><p>Parça yönetilecek motosiklet (ilanlı motosikletler yalnızca incelenebilir):</p><div class="performance-bike-selector">${selector}</div><p>Parça ömrü yalnızca vardiyada gerçekten sürülen kilometreyle azalır. Her kategoride tek parça bulunur; değişimde eski parçanın takas değeri otomatik uygulanır.</p></article><div class="garage-grid performance-grid">${cards}</div>`;
}
function renderDealershipTab(editable) {
    const selected = getMotorcycleModel(selectedDealerModelKey);
    const selectedClass = MOTORCYCLE_CLASSES[selected.classKey];
    const purchaseBlocked = !editable || playerState.motorcycles.length >= playerState.garageCapacity
        || selectedClass.retailPrice === null || game.money < selectedClass.retailPrice;
    const cards = MOTORCYCLE_CATALOG.map(model => {
        const spec = MOTORCYCLE_CLASSES[model.classKey];
        const isSelected = model.key === selectedDealerModelKey;
        const full = playerState.motorcycles.length >= playerState.garageCapacity;
        const disabled = !editable || full || spec.retailPrice === null || game.money < spec.retailPrice;
        const reason = !editable ? 'Vardiyada kapalı' : full ? 'Garaj dolu' : game.money < spec.retailPrice ? 'Bakiye yetersiz' : '';
        return `<article class="dealer-model-card garage-card${isSelected ? ' selected' : ''}" data-model="${escapeHTML(model.key)}">
            <div class="dealer-card-top"><span class="dealer-class-chip">${escapeHTML(spec.label)}</span><strong>${formatMoney(spec.retailPrice)}</strong></div>
            <h3>${escapeHTML(model.name)}</h3>
            <p>${escapeHTML(model.style)}</p>
            <p class="dealer-model-specs">Depo ${spec.tankLiters} L <span>·</span> Azami ${Math.round(spec.maxSpeed * 3.6)} km/sa <span>·</span> İvmelenme ${formatDecimal(spec.acceleration, 1)}</p>
            <div class="dealer-model-actions">
                <button class="garage-action secondary" data-action="dealer-select" data-model="${escapeHTML(model.key)}" aria-pressed="${isSelected}">${isSelected ? 'Seçili model' : '3B önizle'}</button>
                <button class="garage-action" data-action="dealer-buy" data-model="${escapeHTML(model.key)}" ${disabled ? 'disabled' : ''}>Satın al${reason ? ` · ${reason}` : ` · ${formatMoney(spec.retailPrice)}`}</button>
            </div>
        </article>`;
    }).join('');
    return `<article class="dealer-preview-card">
        <div class="dealer-preview-stage" role="img" aria-label="Seçili motosikletin döndürülebilir 3B önizlemesi"></div>
        <div class="dealer-preview-copy">
            <span class="dealer-eyebrow">ŞEHİR BAYİSİ · YENİ MOTOSİKLETLER</span>
            <h3 id="dealer-preview-title">${escapeHTML(selected.name)}</h3>
            <p id="dealer-preview-details">${escapeHTML(selectedClass.label)} · ${escapeHTML(selected.style)} · ${formatMoney(selectedClass.retailPrice)} · Depo ${selectedClass.tankLiters} L</p>
            <p id="dealer-purchase-note" class="dealer-purchase-note">${purchaseBlocked ? (!editable ? 'Vardiyada motosiklet satın alınamaz.' : playerState.motorcycles.length >= playerState.garageCapacity ? `Garaj dolu (${playerState.motorcycles.length}/${playerState.garageCapacity}); önce kapasite artır.` : 'Bakiye yetersiz.') : `Garaj kapasitesi ${playerState.motorcycles.length}/${playerState.garageCapacity} · Mevcut motosikletin aktif kalır.`}</p>
            <button id="dealer-preview-buy" class="garage-action dealer-preview-buy" data-action="dealer-buy" data-model="${escapeHTML(selected.key)}" ${purchaseBlocked ? 'disabled' : ''}>Satın al · ${formatMoney(selectedClass.retailPrice)}</button>
            <p class="dealer-drag-hint">Motosikleti sürükleyerek farklı açılardan incele.</p>
        </div>
    </article>
    <div class="dealer-catalog-heading"><h3>Model kataloğu</h3><span>${MOTORCYCLE_CATALOG.length} model · ${playerState.motorcycles.length}/${playerState.garageCapacity} garaj yeri</span></div>
    <div class="dealer-catalog-grid">${cards}</div>`;
}

function renderCareerTab() {
    const career = playerState.career;
    const requiredXp = xpRequiredForLevel(career.level);
    const activeContract = career.contracts.find(contract => contract.status === 'active');
    const companies = Object.entries(COURIER_COMPANIES).map(([key, company]) => {
        const existing = career.contracts.find(contract => contract.companyKey === key && contract.status === 'active');
        const unlocked = career.level >= company.unlockLevel;
        const disabled = !unlocked || Boolean(activeContract) || playerState.shiftActive;
        return `<article class="garage-card career-company"><h3>${escapeHTML(company.name)}</h3><p>${escapeHTML(company.description)}</p><p>Açılma seviyesi: <strong>${company.unlockLevel}</strong> · Durum: <strong>${existing ? 'Aktif' : unlocked ? 'Hazır' : `Seviye ${company.unlockLevel} gerekli`}</strong></p><button class="garage-action" data-action="contract-accept" data-company="${escapeHTML(key)}" ${disabled ? 'disabled' : ''}>${existing ? 'Sözleşme aktif' : unlocked ? 'Sözleşmeyi kabul et' : 'Kilitli'}</button></article>`;
    }).join('');
    const history = career.contracts.length
        ? career.contracts.slice().reverse().map(contract => {
            const company = COURIER_COMPANIES[contract.companyKey]?.name || 'Önceki şirket';
            const status = contract.status === 'completed' ? 'Tamamlandı' : contract.status === 'failed' ? 'Süresi doldu' : `Aktif · Gün ${contract.deadlineDay} son`;
            return `<p>${escapeHTML(company)} · ${contract.progress}/${contract.target} teslimat · ${escapeHTML(status)}${contract.rewardPaid ? ` · ${formatMoney(contract.reward)} ödendi` : ''}</p>`;
        }).join('')
        : '<p>Henüz şirket sözleşmesi yok.</p>';
    return `<div class="garage-grid"><article class="garage-card"><h3>Kurye kariyeri · Seviye ${career.level}</h3><p>Toplam XP: <strong>${Math.floor(career.xp)}</strong> / ${requiredXp} · Başarılı teslimat: <strong>${career.successfulDeliveries}</strong> · Başarısız: <strong>${career.failedDeliveries}</strong></p><div class="career-progress"><i style="width:${THREE.MathUtils.clamp(career.xp / requiredXp * 100, 0, 100)}%"></i></div><p>İtibar: <strong>%${Math.round(career.reputation)}</strong> · Kariyer kazancı: <strong>${formatMoney(career.totalCareerEarnings)}</strong></p><p>Başarılı teslimatlar XP ve itibar kazandırır. Süresi dolan siparişler itibarını düşürür; sözleşme ödülü hedef tamamlanınca bir kez ödenir.</p></article><article class="garage-card"><h3>Şirket sözleşmeleri</h3><p>${activeContract ? `${escapeHTML(COURIER_COMPANIES[activeContract.companyKey]?.name || 'Şirket')} sözleşmesi aktif: ${activeContract.progress}/${activeContract.target} · Son gün ${activeContract.deadlineDay}.` : 'Aynı anda yalnızca bir sözleşme yürütülebilir.'}</p></article>${companies}</div><article class="garage-card" style="margin-top:10px"><h3>Sözleşme geçmişi</h3>${history}</article>`;
}

function renderGarage() {
    activeMotorcycle = getActiveMotorcycle();
    const content = document.getElementById('garage-content');
    const summary = document.getElementById('garage-summary');
    const shiftButton = document.getElementById('garage-shift-action');
    summary.textContent = `${formatMoney(game.money)} bakiye · Gün ${playerState.currentDay} · Vardiya başlangıcı ${playerState.shiftStartsAt}`;
    shiftButton.textContent = playerState.shiftActive ? 'Vardiyayı Bitir' : 'Vardiyaya Başla';
    shiftButton.classList.toggle('secondary', playerState.shiftActive);
    const marketTabActive = ['market', 'market-detail', 'market-negotiate'].includes(activeGarageTab);
    document.querySelectorAll('[data-garage-tab]').forEach(button => button.classList.toggle('active', button.dataset.garageTab === activeGarageTab || (button.dataset.garageTab === 'market' && marketTabActive)));
    const editable = !playerState.shiftActive;
    if (['market', 'market-detail', 'market-negotiate', 'favorites', 'player-listings'].includes(activeGarageTab) && playerState.marketNotifications.length) {
        setGarageNotice(playerState.marketNotifications.splice(0).join(' '));
        persistGame();
    }
    let html = '';
    if (activeGarageTab === 'owned') {
        html = `<div class="garage-grid">${playerState.motorcycles.map(motorcycle => {
            const spec = MOTORCYCLE_CLASSES[motorcycle.classKey];
            const active = motorcycle.id === playerState.activeMotorcycleId;
            const listed = Boolean(motorcycle.marketplaceListingStatus?.listed);
            const resale = calculateMotorcycleResaleValue(motorcycle);
            const canSell = editable && !listed && !active && playerState.motorcycles.length > 1 && resale !== null;
            const blockedReason = listed ? 'Bu motosiklet zaten satış ilanında.' : (active ? 'Satıştan önce başka bir motosikleti sen etkinleştirmelisin.' : (playerState.motorcycles.length <= 1 ? 'Son motosikletin satılamaz veya ilana çıkarılamaz.' : (resale === null ? '50 cc perakende fiyatı yapılandırılana kadar değerleme kapalı.' : '')));
            const upgradeText = motorcycle.installedUpgrades.length ? motorcycle.installedUpgrades.map(item => escapeHTML(formatUpgrade(item))).join('<br>') : 'Yok';
            const cosmeticText = motorcycle.cosmetics.length ? motorcycle.cosmetics.map(item => escapeHTML(formatCosmetic(item))).join('<br>') : 'Yok';
            return `<article class="garage-card"><h3>${escapeHTML(spec.label)} ${active ? '· Aktif' : ''}</h3>
                <p>Durum: <strong>%${Math.round(motorcycle.condition)}</strong> · Yakıt: <strong>${formatDecimal(motorcycle.fuelLiters)} / ${spec.tankLiters} L (%${Math.round(motorcycle.fuelLiters / spec.tankLiters * 100)})</strong></p>
                <p>Kilometre: <strong>${Math.round(motorcycle.odometerKm).toLocaleString('tr-TR')} km</strong></p>
                <p>Performans parçaları:<br>${upgradeText}</p><p>Kozmetik:<br>${cosmeticText}</p>
                <p>${listed ? 'Satış ilanında; kullanılamaz, yakıt alınamaz ve bakım yapılamaz.' : (active ? 'Şu anda kullandığın motosiklet.' : 'Garajında hazır.')}</p>
                ${blockedReason ? `<p>${escapeHTML(blockedReason)}</p>` : ''}
                ${!active && !listed ? `<button class="garage-action" data-action="switch" data-id="${escapeHTML(motorcycle.id)}" ${editable ? '' : 'disabled'}>Bu motosikleti kullan</button>` : ''}
                <button class="garage-action secondary" data-action="instant-sell" data-id="${escapeHTML(motorcycle.id)}" ${canSell ? '' : 'disabled'}>Anında sat${resale === null ? '' : ` · ${formatMoneyPrecise(resale)}`}</button>
                <button class="garage-action secondary" data-action="start-player-listing" data-id="${escapeHTML(motorcycle.id)}" ${canSell ? '' : 'disabled'}>Satışa çıkar</button>
            </article>`;
        }).join('')}</div>
        <div class="garage-card" style="margin-top:10px"><h3>Yeni motosiklet al</h3><p>Alım onayı öncesinde bakiye ve kalan bakiye gösterilir. Yeni motosiklet aktif edilmez.</p>
        ${Object.entries(MOTORCYCLE_CLASSES).map(([key, spec]) => `<button class="garage-action secondary" data-action="buy-new" data-class="${key}" ${editable && spec.retailPrice !== null ? '' : 'disabled'}>${escapeHTML(spec.label)} · ${spec.retailPrice === null ? 'Fiyat yapılandırılmalı' : formatMoney(spec.retailPrice)}</button>`).join('')}</div>`;
    } else if (activeGarageTab === 'dealership') {
        html = renderDealershipTab(editable);
    } else if (activeGarageTab === 'maintenance') {
        const listed = Boolean(activeMotorcycle.marketplaceListingStatus?.listed);
        const spec = currentMotorcycleSpec();
        const freeTank = Math.max(0, spec.tankLiters - activeMotorcycle.fuelLiters);
        const fuelPercent = activeMotorcycle.fuelLiters / spec.tankLiters * 100;
        const warnings = [
            fuelPercent <= 10 ? 'Yakıt kritik seviyede.' : fuelPercent <= 25 ? 'Yakıt azaldı.' : '',
            activeMotorcycle.condition <= 20 ? 'Motosikletin durumu kritik.' : activeMotorcycle.condition <= 40 ? 'Bakım önerilir.' : '',
        ].filter(Boolean);
        html = `<div class="garage-grid"><article class="garage-card"><h3>Bakım · ${escapeHTML(MOTORCYCLE_CLASSES[activeMotorcycle.classKey].label)}</h3>
          <p>Durum: <strong>%${Math.round(activeMotorcycle.condition)}</strong> · Yakıt: <strong>${formatDecimal(activeMotorcycle.fuelLiters)} / ${spec.tankLiters} L (%${Math.round(fuelPercent)})</strong></p>
          <p>Kilometre: <strong>${Math.round(activeMotorcycle.odometerKm).toLocaleString('tr-TR')} km</strong></p>
          <p>Güncel yakıt fiyatı: <strong>${formatMoneyPrecise(playerState.dailyPrices.fuel)} / L</strong> · Bu motosiklete en fazla ${formatDecimal(freeTank)} L alınabilir.</p>
          <label>Litre ile al <input class="listing-price-input" type="number" min="0.001" step="0.1" value="${formatDecimal(Math.min(1, freeTank), 1).replace(',', '.') }" data-garage-refuel-liters></label>
          <button class="garage-action secondary" data-action="garage-refuel-liters" ${editable && !listed && freeTank > 0 ? '' : 'disabled'}>Seçilen litreyi al</button>
          <label>₺ tutarıyla al <input class="listing-price-input" type="number" min="0.01" step="0.01" value="60" data-garage-refuel-money></label>
          <button class="garage-action secondary" data-action="garage-refuel-money" ${editable && !listed && freeTank > 0 ? '' : 'disabled'}>Tutar kadar yakıt al</button>
          <p>Onay ekranında alınacak gerçek litre, toplam fiyat ve işlem sonrası bakiye gösterilir.</p>
          <p>Günlük onarım fiyatları: küçük ${formatMoneyPrecise(playerState.dailyPrices.repairs.small)} / 15 puan · orta ${formatMoneyPrecise(playerState.dailyPrices.repairs.medium)} / 40 puan · kapsamlı ${formatMoneyPrecise(playerState.dailyPrices.repairs.full)} / 100 puan.</p>
          ${Object.entries(REPAIR_OPTIONS).map(([kind, option]) => {
              const quote = getRepairQuote(activeMotorcycle, kind, false);
              return `<button class="garage-action" data-action="repair" data-kind="${kind}" ${editable && !listed && quote.restoreAmount > 0 ? '' : 'disabled'}>${option.label} · +${formatDecimal(quote.restoreAmount)} puan · ${formatMoneyPrecise(quote.price)}</button>`;
          }).join('')}
          ${warnings.length ? `<p><strong>Uyarı:</strong> ${warnings.map(escapeHTML).join(' ')}</p>` : '<p>Bakım uyarısı bulunmuyor.</p>'}
          ${listed ? '<p>İlandaki motosiklete bakım veya yakıt işlemi yapılamaz.</p>' : ''}</article></div>`;
    } else if (activeGarageTab === 'performance') {
        html = renderPerformanceTab();
    } else if (activeGarageTab === 'career') {
        html = renderCareerTab();
    } else if (activeGarageTab === 'cosmetics') {
        html = `<div class="garage-grid"><article class="garage-card"><h3>Kozmetik</h3><p>Aktif motosikletin görünümleri:</p><p>${activeMotorcycle.cosmetics.length ? activeMotorcycle.cosmetics.map(item => escapeHTML(formatCosmetic(item))).join('<br>') : 'Standart görünüm'}</p><p>Kozmetik modelleri henüz uygulanmıyor; kişiselleştirmeler burada ve pazarda kayıtlı gösterilir.</p></article></div>`;
    } else if (activeGarageTab === 'market') {
        html = `<article class="garage-card"><h3>İkinci El Pazarı</h3><p>Her zaman 5 NPC motosiklet ilanı bulunur. İlanlar menü açılıp kapandığında yenilenmez; günlük yenilemede ilanlar en fazla 4 oyun günü kalır ve daha erken kalkabilir.</p><p>Favoriler motosikleti ayırmaz.</p>${MOTORCYCLE_CLASSES.cc50.retailPrice === null ? '<p>50 cc ikinci el fiyatlandırması, gerçek 50 cc perakende fiyatı MOTORCYCLE_CLASSES içinde yapılandırılana kadar güvenlik için kapalıdır.</p>' : ''}</article>
          <div class="garage-grid">${playerState.usedMarketListings.map(listing => {
            const motorcycle = listing.motorcycle;
            const spec = MOTORCYCLE_CLASSES[motorcycle.classKey];
            const daysLeft = Math.max(0, Math.min(MARKET_MAX_DAYS, listing.expiresDay - playerState.currentDay));
            const favorite = playerState.favorites.includes(listing.id);
            const priceText = listing.price === null ? 'Fiyat kapalı · 50 cc fiyatı yapılandırılmalı' : formatMoney(listing.price);
            const negotiationText = !listing.negotiationUsed ? 'Kullanılmadı' : (listing.negotiationAccepted ? `Kabul edildi (%${Math.round(listing.negotiatedDiscount * 100)})` : 'Reddedildi · ilk fiyat geçerli');
            return `<article class="garage-card"><h3>${escapeHTML(spec.label)} · ${priceText}</h3>
              <p>Durum: <strong>%${Math.round(motorcycle.condition)}</strong> · Kilometre: <strong>${Math.round(motorcycle.odometerKm).toLocaleString('tr-TR')} km</strong></p>
              <p>Yakıt: <strong>${formatDecimal(motorcycle.fuelLiters)} / ${spec.tankLiters} L (%${Math.round(motorcycle.fuelLiters / spec.tankLiters * 100)})</strong></p>
              <p>Performans parçaları:<br>${motorcycle.installedUpgrades.length ? motorcycle.installedUpgrades.map(item => escapeHTML(formatUpgrade(item))).join('<br>') : 'Yok'}</p>
              <p>Kozmetik:<br>${motorcycle.cosmetics.length ? motorcycle.cosmetics.map(item => escapeHTML(formatCosmetic(item))).join('<br>') : 'Yok'}</p>
              <p>Pazarlık: <strong>${negotiationText}</strong></p>
              <p>En fazla ${daysLeft} oyun günü daha ilanda kalır. Günlük pazar yenilemesi nedeniyle ilan daha erken kalkabilir.</p>
              <button class="garage-action secondary" data-action="favorite" data-id="${escapeHTML(listing.id)}" ${editable ? '' : 'disabled'}>${favorite ? '★ Favorilerden çıkar' : '☆ Favorilere ekle'}</button>
              <button class="garage-action" data-action="market-detail" data-id="${escapeHTML(listing.id)}">İlan Detayı</button>
            </article>`;
        }).join('')}</div>`;
    } else if (activeGarageTab === 'market-detail') {
        const listing = playerState.usedMarketListings.find(item => item.id === selectedMarketListingId);
        if (!listing) {
            html = `<article class="garage-card"><h3>İlan Detayı</h3><p>Bu ilan artık pazarda değil. Favoriler motosikleti ayırmaz.</p><button class="garage-action" data-action="market-back">Pazara dön</button></article>`;
        } else {
            const motorcycle = listing.motorcycle;
            const spec = MOTORCYCLE_CLASSES[motorcycle.classKey];
            const base = calculateMotorcycleResaleValue(motorcycle);
            const daysLeft = Math.max(0, Math.min(MARKET_MAX_DAYS, listing.expiresDay - playerState.currentDay));
            const favorite = playerState.favorites.includes(listing.id);
            const negotiationStatus = !listing.negotiationUsed ? 'Bu ilan için pazarlık hakkı kullanılmadı.' : (listing.negotiationAccepted ? `Pazarlık kabul edildi; güncel fiyat: ${formatMoney(listing.price)}.` : `Pazarlık reddedildi; ilk fiyat ${formatMoney(listing.originalPrice)} olarak korunuyor.`);
            html = `<article class="garage-card"><h3>İlan Detayı · ${escapeHTML(spec.label)}</h3>
              <p>Fiyat: <strong>${listing.price === null ? '50 cc fiyatı yapılandırılana kadar kapalı' : formatMoney(listing.price)}</strong></p>
              <p>Durum: <strong>%${Math.round(motorcycle.condition)}</strong> · Kilometre: <strong>${Math.round(motorcycle.odometerKm).toLocaleString('tr-TR')} km</strong></p>
              <p>Yakıt: <strong>${formatDecimal(motorcycle.fuelLiters)} / ${spec.tankLiters} L (%${Math.round(motorcycle.fuelLiters / spec.tankLiters * 100)})</strong></p>
              <p>Parçalar:<br>${motorcycle.installedUpgrades.length ? motorcycle.installedUpgrades.map(item => escapeHTML(formatUpgrade(item))).join('<br>') : 'Performans parçası yok.'}</p>
              <p>Kozmetik kişiselleştirmeler:<br>${motorcycle.cosmetics.length ? motorcycle.cosmetics.map(item => escapeHTML(formatCosmetic(item))).join('<br>') : 'Yok'}</p>
              <p>Anında satış değeri: <strong>${base === null ? 'Fiyatlandırma kapalı' : formatMoneyPrecise(base)}</strong> · Satıcı payı: %${Math.round(listing.sellerMargin * 100)}</p>
              <p>İlan en fazla ${daysLeft} oyun günü daha kalır; günlük pazar yenilemesi ilanı daha erken kaldırabilir.</p>
              <p>Pazarlık durumu: <strong>${escapeHTML(negotiationStatus)}</strong></p>
              <button class="garage-action secondary" data-action="market-back">Pazara dön</button>
              <button class="garage-action secondary" data-action="favorite" data-id="${escapeHTML(listing.id)}" ${editable ? '' : 'disabled'}>${favorite ? '★ Favorilerden çıkar' : '☆ Favorilere ekle'}</button>
              <button class="garage-action secondary" data-action="negotiate-open" data-id="${escapeHTML(listing.id)}" ${editable && !listing.negotiationUsed && listing.price !== null ? '' : 'disabled'}>Pazarlık Yap</button>
              <button class="garage-action" data-action="buy-used" data-id="${escapeHTML(listing.id)}" ${editable && listing.price !== null && playerState.motorcycles.length < playerState.garageCapacity ? '' : 'disabled'}>${listing.price === null ? 'Fiyatlandırma kapalı' : 'Motosiklet Satın Al'}</button>
              ${playerState.motorcycles.length >= playerState.garageCapacity ? '<p>Garaj dolu; satın almadan önce kapasite artır.</p>' : ''}
            </article>`;
        }
    } else if (activeGarageTab === 'market-negotiate') {
        const listing = playerState.usedMarketListings.find(item => item.id === selectedMarketListingId);
        if (!listing) {
            html = `<article class="garage-card"><h3>Pazarlık Yap</h3><p>İlan artık bulunmuyor.</p><button class="garage-action" data-action="market-back">Pazara dön</button></article>`;
        } else {
            const chanceText = discount => `${Math.round(negotiationAcceptanceChance(discount) * 100)}%`;
            const alreadyUsed = listing.negotiationUsed;
            html = `<article class="garage-card"><h3>Pazarlık Yap · ${escapeHTML(MOTORCYCLE_CLASSES[listing.motorcycle.classKey].label)}</h3>
              <p>Kurye seviyesi: <strong>${getCareerLevel()}</strong> · Her 5 seviyede kabul olasılığına +2 puan (en fazla +10 puan).</p>
              <p>Pazarlık para düşmez ve motosikleti satın almaz. Bu ilanda yalnızca bir kez denenebilir. Ret halinde özgün satın alma fiyatı korunur.</p>
              <p>${alreadyUsed ? 'Bu ilan için pazarlık hakkı kullanıldı.' : 'Bir indirim seç:'}</p>
              ${[0.05, 0.07, 0.10].map(discount => `<button class="garage-action secondary" data-action="negotiate" data-id="${escapeHTML(listing.id)}" data-discount="${discount}" ${editable && !alreadyUsed ? '' : 'disabled'}>%${Math.round(discount * 100)} indirim iste · Kabul olasılığı ${chanceText(discount)}</button>`).join('')}
              <button class="garage-action" data-action="market-detail" data-id="${escapeHTML(listing.id)}">İlan Detayına dön</button>
            </article>`;
        }
    } else if (activeGarageTab === 'favorites') {
        const favorites = playerState.usedMarketListings.filter(listing => playerState.favorites.includes(listing.id));
        html = `<article class="garage-card"><h3>Favorilerim</h3><p>Favoriler motosikleti ayırmaz; ilan günlük yenilemede veya alımda kaybolabilir.</p></article>
          ${favorites.length ? `<div class="garage-grid">${favorites.map(listing => `<article class="garage-card"><h3>${escapeHTML(MOTORCYCLE_CLASSES[listing.motorcycle.classKey].label)} · ${listing.price === null ? 'Fiyat kapalı' : formatMoney(listing.price)}</h3><p>Durum: %${Math.round(listing.motorcycle.condition)} · ${Math.round(listing.motorcycle.odometerKm).toLocaleString('tr-TR')} km</p><button class="garage-action" data-action="market-detail" data-id="${escapeHTML(listing.id)}">İlan Detayı</button><button class="garage-action secondary" data-action="favorite" data-id="${escapeHTML(listing.id)}" ${editable ? '' : 'disabled'}>Favorilerden çıkar</button></article>`).join('')}</div>` : '<article class="garage-card"><p>Şu anda favorilerinde ilan yok.</p></article>'}`;
    } else if (activeGarageTab === 'sell-form') {
        const motorcycle = playerState.motorcycles.find(item => item.id === selectedSellMotorcycleId);
        if (!motorcycle) {
            html = `<article class="garage-card"><h3>Satışa Çıkar</h3><p>Motosiklet bulunamadı.</p><button class="garage-action" data-action="owned-back">Garaja dön</button></article>`;
        } else {
            const base = calculateMotorcycleResaleValue(motorcycle);
            html = `<article class="garage-card"><h3>Satışa Çıkar · ${escapeHTML(MOTORCYCLE_CLASSES[motorcycle.classKey].label)}</h3>
              <p>Durum: %${Math.round(motorcycle.condition)} · Kilometre: ${Math.round(motorcycle.odometerKm).toLocaleString('tr-TR')} km · Yakıt: %${Math.round(motorcycle.fuelLiters / MOTORCYCLE_CLASSES[motorcycle.classKey].tankLiters * 100)}</p>
              <p>Anında satış değeri: <strong>${base === null ? '50 cc fiyatı yapılandırılana kadar kapalı' : formatMoneyPrecise(base)}</strong>. Bu işlem ücretsizdir; ilan en fazla 4 oyun günü kalır.</p>
              <p>Bir kez her oyun gününde alıcı kontrolü yapılır. İlanı iptal etmek veya fiyatını düşürmek ek kontrol oluşturmaz. İlandaki motosiklet sürülemez.</p>
              ${[0.05, 0.10, 0.15, 0.20].map(markup => `<button class="garage-action secondary" data-action="create-player-listing" data-id="${escapeHTML(motorcycle.id)}" data-markup="${markup}" ${editable && base !== null ? '' : 'disabled'}>%${Math.round(markup * 100)} üstüne fiyat · ${base === null ? 'Değerleme kapalı' : formatMoneyPrecise(roundMoney(base * (1 + markup)))}</button>`).join('')}
              <button class="garage-action" data-action="owned-back">Garaja dön</button>
            </article>`;
        }
    } else if (activeGarageTab === 'player-listings') {
        html = `<article class="garage-card"><h3>İlanlarım</h3><p>İlanlar ücretsizdir, motosiklet garajında yer tutar ve satılana kadar kullanılamaz. Fiyat düşürülebilir; süre ve günlük alıcı kontrolü yenilenmez.</p></article>
          ${playerState.playerSaleListings.length ? `<div class="garage-grid">${playerState.playerSaleListings.map(listing => {
            const motorcycle = playerState.motorcycles.find(item => item.id === listing.motorcycleId);
            if (!motorcycle) return '';
            const spec = MOTORCYCLE_CLASSES[motorcycle.classKey];
            const daysLeft = Math.max(0, Math.min(MARKET_MAX_DAYS, listing.expiresDay - playerState.currentDay));
            const upgrades = motorcycle.installedUpgrades.length ? motorcycle.installedUpgrades.map(item => escapeHTML(formatUpgrade(item))).join('<br>') : 'Yok';
            const cosmetics = motorcycle.cosmetics.length ? motorcycle.cosmetics.map(item => escapeHTML(formatCosmetic(item))).join('<br>') : 'Yok';
            return `<article class="garage-card"><h3>${escapeHTML(spec.label)} · ${formatMoneyPrecise(listing.price)}</h3>
              <p>Durum: %${Math.round(motorcycle.condition)} · Kilometre: ${Math.round(motorcycle.odometerKm).toLocaleString('tr-TR')} km · Yakıt: %${Math.round(motorcycle.fuelLiters / spec.tankLiters * 100)}</p>
              <p>Parçalar:<br>${upgrades}</p><p>Kozmetik:<br>${cosmetics}</p>
              <p>İstenen fiyat: <strong>${formatMoneyPrecise(listing.price)}</strong> · İlk değer üstüne %${Math.round(listing.markup * 100)}</p>
              <p>En fazla ${daysLeft} oyun günü kaldı. Günlük alıcı kontrolü en fazla bir kez yapılır.</p>
              <label>Daha düşük yeni fiyat (₺) <input class="listing-price-input" type="number" min="0.01" step="0.01" value="${listing.price}" data-listing-price="${escapeHTML(listing.id)}"></label>
              <button class="garage-action secondary" data-action="lower-player-listing" data-id="${escapeHTML(listing.id)}" ${editable ? '' : 'disabled'}>Fiyatı düşür</button>
              <button class="garage-action" data-action="cancel-player-listing" data-id="${escapeHTML(listing.id)}" ${editable ? '' : 'disabled'}>İlanı ücretsiz iptal et</button>
            </article>`;
        }).join('')}</div>` : '<article class="garage-card"><p>Aktif satış ilanı bulunmuyor.</p></article>'}`;
    } else if (activeGarageTab === 'capacity') {
        const upgradeCost = 2500 + Math.max(0, playerState.garageCapacity - 2) * 1500;
        html = `<div class="garage-grid"><article class="garage-card"><h3>Garaj kapasitesi</h3><p>Kullanım: <strong>${playerState.motorcycles.length} / ${playerState.garageCapacity}</strong></p><p>Azami kapasite: <strong>${playerState.maximumGarageCapacity} motosiklet</strong></p><p>Bir sonraki yerin bedeli: <strong>${formatMoney(upgradeCost)}</strong></p><button class="garage-action" data-action="expand" ${editable && playerState.garageCapacity < playerState.maximumGarageCapacity ? '' : 'disabled'}>Kapasiteyi 1 artır</button></article>
          <article class="garage-card"><h3>Yeni motosiklet fiyatları</h3><p>50 cc: ${formatMoney(MOTORCYCLE_CLASSES.cc50.retailPrice)}</p><p>125 cc: ${formatMoney(MOTORCYCLE_CLASSES.cc125.retailPrice)}</p><p>250 cc: ${formatMoney(MOTORCYCLE_CLASSES.cc250.retailPrice)}</p></article></div>`;
    }
    content.innerHTML = html;
    document.getElementById('garage-overlay').classList.toggle('open', garageOpen);
    document.getElementById('garage-overlay').setAttribute('aria-hidden', String(!garageOpen));
    if (garageOpen && activeGarageTab === 'dealership') void showDealerPreview(selectedDealerModelKey);
    updateHUD();
}

runDestinationMarkerSelfChecks();

function showGarageMessage(message) {
    setGarageNotice(message);
    showMsg(message, 3);
}
function openGarage() {
    garageOpen = true;
    for (const key of Object.keys(input)) input[key] = false;
    document.querySelectorAll('.tb').forEach(button => button.classList.remove('on'));
    renderGarage();
}
function closeGarage() {
    garageOpen = false;
    document.getElementById('garage-overlay').classList.remove('open');
    document.getElementById('garage-overlay').setAttribute('aria-hidden', 'true');
    document.getElementById('garage-confirm').classList.remove('open');
    document.getElementById('garage-confirm').setAttribute('aria-hidden', 'true');
    pendingConfirmation = null;
}
function requestConfirmation(title, text, action) {
    if (!canModifyGarage() || pendingConfirmation) return;
    pendingConfirmation = action;
    document.getElementById('garage-confirm-title').textContent = title;
    document.getElementById('garage-confirm-text').textContent = text;
    const modal = document.getElementById('garage-confirm');
    modal.classList.add('open');
    modal.setAttribute('aria-hidden', 'false');
}
function requestPaidAction(title, price, action) {
    if (!canModifyGarage()) return;
    const amount = roundMoney(Math.max(0, price));
    if (!Number.isFinite(amount) || game.money < amount) {
        showGarageMessage(`Yetersiz bakiye. Gerekli: ${formatMoneyPrecise(amount)} · Mevcut: ${formatMoneyPrecise(game.money)}.`);
        renderGarage();
        return;
    }
    requestConfirmation(title, `Mevcut bakiye: ${formatMoneyPrecise(game.money)}\nFiyat: ${formatMoneyPrecise(amount)}\nAlım sonrası bakiye: ${formatMoneyPrecise(game.money - amount)}\n\nBu işlemi onaylıyor musun?`, action);
}
function canModifyPerformanceMotorcycle(motorcycleId) {
    if (!canModifyGarage()) return null;
    const motorcycle = playerState.motorcycles.find(item => item.id === motorcycleId);
    if (!motorcycle) {
        showGarageMessage('Performans parçası için motosiklet bulunamadı.');
        return null;
    }
    if (motorcycle.marketplaceListingStatus?.listed) {
        showGarageMessage('Satış ilanındaki motosikletin performans parçaları değiştirilemez.');
        return null;
    }
    return motorcycle;
}
function getPerformancePurchaseQuote(motorcycle, categoryKey, tierName) {
    const category = UPGRADE_CATEGORIES.find(item => item.key === categoryKey);
    const tier = UPGRADE_QUALITY_TIERS.find(item => item.name === tierName);
    if (!category || !tier) return null;
    const oldPart = motorcycle.installedUpgrades.find(item => item.categoryKey === categoryKey) || null;
    const newPartPrice = getUpgradePrice(categoryKey, tierName, motorcycle.classKey);
    const expiredSameTier = Boolean(oldPart && getUpgradeRemainingKm(oldPart) <= 0 && oldPart.qualityTier === tierName);
    const discount = expiredSameTier ? roundMoney(newPartPrice * 0.25) : 0;
    const tradeIn = oldPart && !expiredSameTier ? getUpgradeResaleValue(oldPart) : 0;
    const payable = roundMoney(Math.max(0, newPartPrice - discount - tradeIn));
    return { category, tier, oldPart, newPartPrice, discount, tradeIn, payable, expiredSameTier };
}
function purchasePerformanceUpgrade(motorcycleId, categoryKey, tierName) {
    const motorcycle = canModifyPerformanceMotorcycle(motorcycleId);
    if (!motorcycle) return;
    const quote = getPerformancePurchaseQuote(motorcycle, categoryKey, tierName);
    if (!quote) return;
    if (game.money < quote.payable) {
        const missing = roundMoney(quote.payable - game.money);
        showGarageMessage(`Yetersiz bakiye. Eksik tutar: ${formatMoneyPrecise(missing)} · Ödenecek: ${formatMoneyPrecise(quote.payable)} · Mevcut bakiye: ${formatMoneyPrecise(game.money)}.`);
        return;
    }
    const discountText = quote.discount > 0 ? `Uygulanan süresi dolmuş aynı kademe indirimi: −${formatMoneyPrecise(quote.discount)}\n` : '';
    const tradeText = quote.tradeIn > 0 ? `Eski parça takas değeri: −${formatMoneyPrecise(quote.tradeIn)}\n` : (quote.oldPart ? 'Eski parça takas değeri: ₺0\n' : 'Takas değeri: uygulanmıyor\n');
    requestConfirmation('Performans Parçası Onayı', `Motosiklet: ${MOTORCYCLE_CLASSES[motorcycle.classKey].label}\nKategori: ${quote.category.label} · ${quote.tier.name}\nMevcut bakiye: ${formatMoneyPrecise(game.money)}\nYeni parça fiyatı: ${formatMoneyPrecise(quote.newPartPrice)}\n${discountText}${tradeText}Ödenecek net tutar: ${formatMoneyPrecise(quote.payable)}\nAlım sonrası bakiye: ${formatMoneyPrecise(game.money - quote.payable)}\n\nParça %100 ömürle takılır. İşlemi onaylıyor musun?`, () => {
        const current = canModifyPerformanceMotorcycle(motorcycleId);
        if (!current) return;
        const updatedQuote = getPerformancePurchaseQuote(current, categoryKey, tierName);
        if (!updatedQuote || game.money < updatedQuote.payable) {
            const missing = updatedQuote ? roundMoney(updatedQuote.payable - game.money) : 0;
            showGarageMessage(`Koşullar değişti; işlem yapılmadı.${missing > 0 ? ` Eksik tutar: ${formatMoneyPrecise(missing)}.` : ''}`);
            return;
        }
        const fullLifeKm = getUpgradeFullLifespanKm(categoryKey, tierName);
        const committed = commitMarketplaceTransaction(() => {
            game.money = roundMoney(game.money - updatedQuote.payable);
            recordDailyExpense('upgradeExpenses', updatedQuote.payable);
            current.installedUpgrades = current.installedUpgrades.filter(item => item.categoryKey !== categoryKey);
            current.installedUpgrades.push({
                categoryKey, categoryLabel: updatedQuote.category.label,
                name: `${tierName} ${updatedQuote.category.label} Parçası`, qualityTier: tierName,
                purchasePrice: updatedQuote.newPartPrice, remainingLifespanKm: fullLifeKm,
                remainingLifespan: 100, criticalNotified: false, expiredNotified: false,
            });
        });
        if (!committed) return;
        activeMotorcycle = getActiveMotorcycle();
        showGarageMessage(`${updatedQuote.category.label} · ${tierName} takıldı. ${formatMoneyPrecise(updatedQuote.payable)} ödendi; eski parçanın takas indirimi bir kez uygulandı.`);
        renderGarage();
    });
}
function removePerformanceUpgrade(motorcycleId, categoryKey) {
    const motorcycle = canModifyPerformanceMotorcycle(motorcycleId);
    if (!motorcycle) return;
    const item = motorcycle.installedUpgrades.find(part => part.categoryKey === categoryKey);
    if (!item) return showGarageMessage('Bu kategoride satılacak parça takılı değil.');
    const value = getUpgradeResaleValue(item);
    requestConfirmation('Performans Parçasını Sat', `${MOTORCYCLE_CLASSES[motorcycle.classKey].label} · ${item.categoryLabel} · ${item.qualityTier}\nKalan ömür: %${Math.round(getUpgradeRemainingPercent(item))}\nParça satış bedeli: ${formatMoneyPrecise(value)}\nMevcut bakiye: ${formatMoneyPrecise(game.money)}\nSatış sonrası bakiye: ${formatMoneyPrecise(game.money + value)}\n\nParça motosikletten kaldırılır; onaylıyor musun?`, () => {
        const current = canModifyPerformanceMotorcycle(motorcycleId);
        const currentPart = current?.installedUpgrades.find(part => part.categoryKey === categoryKey);
        if (!current || !currentPart) return;
        const currentValue = getUpgradeResaleValue(currentPart);
        const committed = commitMarketplaceTransaction(() => {
            current.installedUpgrades = current.installedUpgrades.filter(part => part.categoryKey !== categoryKey);
            game.money = roundMoney(game.money + currentValue);
        });
        if (!committed) return;
        activeMotorcycle = getActiveMotorcycle();
        showGarageMessage(`${currentPart.categoryLabel} parçası satıldı; ${formatMoneyPrecise(currentValue)} bakiyene eklendi.`);
        renderGarage();
    });
}
function purchaseNewMotorcycle(classKey, modelKey = DEFAULT_MODEL_BY_CLASS[classKey]) {
    if (!canModifyGarage()) return;
    const spec = MOTORCYCLE_CLASSES[classKey];
    const catalogItem = getMotorcycleModel(modelKey, classKey);
    if (!spec || catalogItem.classKey !== classKey) return;
    if (spec.retailPrice === null) {
        showGarageMessage('50 cc motosikletin yeni satış fiyatı henüz belirlenmedi.');
        return;
    }
    if (playerState.motorcycles.length >= playerState.garageCapacity) {
        showGarageMessage('Garaj dolu. Önce kapasite artır veya bir motosiklet için yer aç.');
        return;
    }
    if (game.money < spec.retailPrice) {
        showGarageMessage(`Bu motosiklet için bakiye yetersiz. Gerekli: ${formatMoney(spec.retailPrice)} · Mevcut: ${formatMoney(game.money)}.`);
        return;
    }
    requestPaidAction(`${catalogItem.name} satın al`, spec.retailPrice, () => {
        if (!canModifyGarage() || game.money < spec.retailPrice || playerState.motorcycles.length >= playerState.garageCapacity) {
            showGarageMessage('Satın alma koşulları değişti; işlem gerçekleştirilmedi.');
            return;
        }
        const committed = commitMarketplaceTransaction(() => {
            game.money = roundMoney(game.money - spec.retailPrice);
            const motorcycle = normalizeMotorcycle({
                id: makeId('moto'), classKey, modelKey: catalogItem.key, odometerKm: 0, fuelLiters: spec.tankLiters,
                condition: 100, installedUpgrades: [], cosmetics: [], marketplaceListingStatus: null,
            }, classKey);
            playerState.motorcycles.push(motorcycle);
        });
        if (!committed) return;
        showGarageMessage(`${catalogItem.name} · ${spec.label} satın alındı ve garaja eklendi. Aktif motosikletin değiştirilmedi.`);
        renderGarage();
    });
}
function purchaseUsedMotorcycle(listingId) {
    if (!canModifyGarage()) return;
    const listing = playerState.usedMarketListings.find(item => item.id === listingId);
    if (!listing || listing.price === null) return showGarageMessage('Bu motosikletin geçerli bir satış fiyatı yok. 50 cc fiyatı yapılandırılana kadar alım kapalıdır.');
    if (playerState.motorcycles.length >= playerState.garageCapacity) return showGarageMessage('Garaj dolu. Önce kapasite artır.');
    const resaleFloor = calculateMotorcycleResaleValue(listing.motorcycle);
    if (resaleFloor === null || listing.price < resaleFloor) return showGarageMessage('İlan fiyatı güvenli anında satış değerinin altına indiği için alım durduruldu.');
    if (game.money < listing.price) return showGarageMessage(`Yetersiz bakiye. Gerekli: ${formatMoneyPrecise(listing.price)} · Mevcut: ${formatMoneyPrecise(game.money)}.`);
    requestPaidAction('Motosiklet Satın Al · ' + MOTORCYCLE_CLASSES[listing.motorcycle.classKey].label, listing.price, () => {
        if (!canModifyGarage()) return;
        const index = playerState.usedMarketListings.findIndex(item => item.id === listingId);
        const current = playerState.usedMarketListings[index];
        const floor = current ? calculateMotorcycleResaleValue(current.motorcycle) : null;
        if (!current || current.price === null || floor === null || current.price < floor || game.money < current.price || playerState.motorcycles.length >= playerState.garageCapacity) {
            showGarageMessage('İlan artık alınamıyor; bakiye, güvenli fiyat veya garaj kapasitesini kontrol et.');
            return;
        }
        const committed = commitMarketplaceTransaction(() => {
            game.money = roundMoney(game.money - current.price);
            const purchased = normalizeMotorcycle({ ...current.motorcycle, id: makeId('moto'), marketplaceListingStatus: null }, current.motorcycle.classKey);
            playerState.motorcycles.push(purchased);
            replaceListing(index);
        });
        if (!committed) return;
        selectedMarketListingId = '';
        showGarageMessage('İkinci el motosiklet garaja eklendi. Parçaları, kozmetikleri, yakıtı, durumu ve kilometresi korundu; aktif motosikletin değişmedi.');
        renderGarage();
    });
}
function attemptNegotiation(listingId, discount) {
    if (!canModifyGarage()) return;
    if (![0.05, 0.07, 0.10].includes(discount)) return;
    const listing = playerState.usedMarketListings.find(item => item.id === listingId);
    if (!listing || listing.price === null) return showGarageMessage('Bu ilan için pazarlık yapılamıyor.');
    if (listing.negotiationUsed) return showGarageMessage('Bu ilan için pazarlık hakkını zaten kullandın.');
    const resaleFloor = calculateMotorcycleResaleValue(listing.motorcycle);
    if (resaleFloor === null) return showGarageMessage('50 cc fiyatı yapılandırılana kadar bu ilanda pazarlık kapalıdır.');
    const chance = negotiationAcceptanceChance(discount);
    const accepted = Math.random() < chance;
    const originalPrice = listing.originalPrice ?? listing.price;
    const negotiatedPrice = Math.max(resaleFloor, roundMoney(originalPrice * (1 - discount)));
    const committed = commitMarketplaceTransaction(() => {
        const current = playerState.usedMarketListings.find(item => item.id === listingId);
        if (!current || current.negotiationUsed) throw new Error('Bu ilan için pazarlık hakkı daha önce kullanılmış.');
        current.negotiationUsed = true;
        current.negotiationAccepted = accepted;
        current.negotiatedDiscount = discount;
        current.negotiatedPrice = accepted ? negotiatedPrice : null;
        current.price = accepted ? negotiatedPrice : current.originalPrice;
    });
    if (!committed) return;
    showGarageMessage(accepted
        ? `Pazarlık kabul edildi: fiyat ${formatMoneyPrecise(negotiatedPrice)} oldu. Para düşülmedi ve motosiklet satın alınmadı.`
        : `Pazarlık reddedildi. İlk fiyat ${formatMoneyPrecise(originalPrice)} korunuyor; motosikleti yine satın alabilirsin.`);
    renderGarage();
}
function getSellableMotorcycle(motorcycleId) {
    if (!canModifyGarage()) return null;
    const motorcycle = playerState.motorcycles.find(item => item.id === motorcycleId);
    if (!motorcycle || motorcycle.marketplaceListingStatus?.listed) {
        showGarageMessage('Bulunamayan veya zaten satışta olan motosiklet için işlem yapılamaz.');
        return null;
    }
    if (playerState.motorcycles.length <= 1) {
        showGarageMessage('Son motosikletini satamaz veya satışa çıkaramazsın.');
        return null;
    }
    if (motorcycle.id === playerState.activeMotorcycleId) {
        showGarageMessage('Aktif motosikleti satmak için önce garajdan başka bir motosikleti kendin etkinleştir.');
        return null;
    }
    if (playerState.motorcycles.filter(item => !item.marketplaceListingStatus?.listed).length <= 1) {
        showGarageMessage('Satıştan sonra kullanılabilir motosiklet kalmayacağı için bu işlem yapılamaz.');
        return null;
    }
    const value = calculateMotorcycleResaleValue(motorcycle);
    if (value === null) {
        showGarageMessage('50 cc perakende fiyatı henüz yapılandırılmadı; geçersiz değerleme önlendi. MOTORCYCLE_CLASSES.cc50.retailPrice alanına gerçek fiyatı gir.');
        return null;
    }
    return motorcycle;
}
function openPlayerListingForm(motorcycleId) {
    if (!getSellableMotorcycle(motorcycleId)) return;
    selectedSellMotorcycleId = motorcycleId;
    activeGarageTab = 'sell-form';
    renderGarage();
}
function requestInstantSale(motorcycleId) {
    const motorcycle = getSellableMotorcycle(motorcycleId);
    if (!motorcycle) return;
    const value = calculateMotorcycleResaleValue(motorcycle);
    const label = MOTORCYCLE_CLASSES[motorcycle.classKey].label;
    requestConfirmation('Anında Satış Onayı', `${label} motosikletinin hesaplanan anında satış değeri: ${formatMoneyPrecise(value)}. Satıştan sonra motosiklet garajdan kaldırılır. Bu işlem tek seferliktir; onaylıyor musun?`, () => {
        const current = getSellableMotorcycle(motorcycleId);
        if (!current) return;
        const amount = calculateMotorcycleResaleValue(current);
        const committed = commitMarketplaceTransaction(() => {
            if (playerState.motorcycles.length <= 1 || current.id === playerState.activeMotorcycleId) throw new Error('Son veya aktif motosiklet satılamaz.');
            playerState.motorcycles = playerState.motorcycles.filter(item => item.id !== current.id);
            game.money = roundMoney(game.money + amount);
        });
        if (!committed) return;
        activeMotorcycle = getActiveMotorcycle();
        showGarageMessage(`${label} anında satıldı; ${formatMoneyPrecise(amount)} bakiyene eklendi ve garaj yeri boşaldı.`);
        renderGarage();
    });
}
function createPlayerListing(motorcycleId, markup) {
    if (![0.05, 0.10, 0.15, 0.20].includes(markup)) return;
    const motorcycle = getSellableMotorcycle(motorcycleId);
    if (!motorcycle) return;
    const resaleValue = calculateMotorcycleResaleValue(motorcycle);
    const askingPrice = roundMoney(resaleValue * (1 + markup));
    const listingId = makeId('satilik-ilan');
    const committed = commitMarketplaceTransaction(() => {
        if (playerState.playerSaleListings.some(listing => listing.motorcycleId === motorcycleId)) throw new Error('Bu motosiklet için zaten aktif ilan var.');
        playerState.playerSaleListings.push({
            id: listingId, motorcycleId, price: askingPrice, markup,
            createdDay: playerState.currentDay, expiresDay: playerState.currentDay + MARKET_MAX_DAYS,
            lastSaleRollDay: motorcycle.marketplaceLastSaleRollDay,
        });
        motorcycle.marketplaceListingStatus = { listed: true, listingId, listingType: 'player', createdDay: playerState.currentDay, expiresDay: playerState.currentDay + MARKET_MAX_DAYS };
    });
    if (!committed) return;
    activeGarageTab = 'player-listings';
    showGarageMessage(`Motosiklet ücretsiz olarak ${formatMoneyPrecise(askingPrice)} fiyatla satışa çıkarıldı. Aktif motosikletin değişmedi.`);
    renderGarage();
}
function lowerPlayerListingPrice(listingId, requestedPrice) {
    if (!canModifyGarage()) return;
    const listing = playerState.playerSaleListings.find(item => item.id === listingId);
    if (!listing) return showGarageMessage('Aktif satış ilanı bulunamadı.');
    const newPrice = roundMoney(Number(requestedPrice));
    if (!Number.isFinite(newPrice) || newPrice <= 0 || newPrice >= listing.price) return showGarageMessage('Yeni fiyat pozitif olmalı ve mevcut ilan fiyatından düşük olmalı; fiyat artırılamaz.');
    const committed = commitMarketplaceTransaction(() => {
        const current = playerState.playerSaleListings.find(item => item.id === listingId);
        if (!current || newPrice >= current.price) throw new Error('İlan fiyatı yalnızca düşürülebilir.');
        current.price = roundMoney(newPrice);
    });
    if (!committed) return;
    showGarageMessage(`İlan fiyatı ${formatMoneyPrecise(roundMoney(newPrice))} olarak düşürüldü. Süre ve bugünkü alıcı kontrolü değişmedi.`);
    renderGarage();
}
function cancelPlayerListing(listingId) {
    if (!canModifyGarage()) return;
    const listing = playerState.playerSaleListings.find(item => item.id === listingId);
    const motorcycle = listing && playerState.motorcycles.find(item => item.id === listing.motorcycleId);
    if (!listing || !motorcycle) return showGarageMessage('İptal edilecek ilan bulunamadı.');
    const committed = commitMarketplaceTransaction(() => {
        playerState.playerSaleListings = playerState.playerSaleListings.filter(item => item.id !== listingId);
        motorcycle.marketplaceListingStatus = null;
    });
    if (!committed) return;
    showGarageMessage('İlan ücretsiz iptal edildi. Motosiklet yeniden kullanılabilir; otomatik olarak etkinleştirilmedi.');
    renderGarage();
}
function switchMotorcycle(motorcycleId) {
    if (!canModifyGarage()) return;
    const motorcycle = playerState.motorcycles.find(item => item.id === motorcycleId);
    if (!motorcycle || motorcycle.marketplaceListingStatus?.listed) {
        showGarageMessage('Satış ilanındaki veya bulunamayan motosiklet kullanılamaz.');
        return;
    }
    const committed = commitMarketplaceTransaction(() => {
        playerState.activeMotorcycleId = motorcycle.id;
    });
    if (!committed) return;
    activeMotorcycle = getActiveMotorcycle();
    state.speed = 0;
    state.lean = 0;
    fuelEmptyShown = false;
    showGarageMessage(`${MOTORCYCLE_CLASSES[motorcycle.classKey].label} aktif motosiklet olarak seçildi.`);
    renderGarage();
}
function toggleFavorite(listingId) {
    if (!canModifyGarage()) return;
    if (!playerState.usedMarketListings.some(listing => listing.id === listingId)) return;
    const removing = playerState.favorites.includes(listingId);
    const committed = commitMarketplaceTransaction(() => {
        if (removing) playerState.favorites = playerState.favorites.filter(id => id !== listingId);
        else playerState.favorites.push(listingId);
    });
    if (!committed) return;
    setGarageNotice(removing
        ? 'İlan favorilerinden çıkarıldı.'
        : 'İlan favorilerine eklendi. Favorilemek ücretsizdir ve motosikleti ayırmaz.');
    renderGarage();
}
function getRepairQuote(motorcycle, kind, onSite = false) {
    const option = REPAIR_OPTIONS[kind];
    if (!option) return { restoreAmount: 0, price: 0 };
    const restoreAmount = Math.max(0, Math.min(option.points, 100 - motorcycle.condition));
    const basePrice = playerState.dailyPrices.repairs[kind];
    const price = roundMoney(basePrice * restoreAmount / option.points * (onSite ? 1.10 : 1));
    return { restoreAmount, price };
}
function showServiceConfirmation(title, text, action) {
    if (pendingConfirmation) return;
    pendingConfirmation = action;
    document.getElementById('garage-confirm-title').textContent = title;
    document.getElementById('garage-confirm-text').textContent = text;
    const modal = document.getElementById('garage-confirm');
    modal.classList.add('open');
    modal.setAttribute('aria-hidden', 'false');
}
function getRefuelQuote(motorcycle, mode, requestedValue) {
    const spec = MOTORCYCLE_CLASSES[motorcycle.classKey];
    const tankSpace = Math.max(0, spec.tankLiters - motorcycle.fuelLiters);
    const pricePerLiter = playerState.dailyPrices.fuel;
    const requested = Number(requestedValue);
    if (!Number.isFinite(requested) || requested <= 0 || tankSpace <= 0 || pricePerLiter <= 0) {
        return { liters: 0, price: 0, remaining: game.money, tankSpace };
    }
    const wantedLiters = mode === 'money' ? requested / pricePerLiter : requested;
    let liters = Math.min(wantedLiters, tankSpace, game.money / pricePerLiter);
    liters = Math.floor((liters + 1e-9) * 1000) / 1000;
    let price = roundMoney(liters * pricePerLiter);
    while (liters >= 0.001 && price > game.money) {
        liters = Math.max(0, liters - 0.001);
        price = roundMoney(liters * pricePerLiter);
    }
    return { liters, price, remaining: roundMoney(game.money - price), tankSpace };
}
function confirmFuelPurchase(mode, requestedValue, source) {
    const motorcycle = getActiveMotorcycle();
    if (source === 'garage' && !canModifyGarage()) return;
    if (motorcycle.marketplaceListingStatus?.listed) return showGarageMessage('İlandaki motosiklete yakıt alınamaz.');
    if (source === 'station' && (!playerState.shiftActive || !stationMenuOpen || !currentStation)) return;
    const quote = getRefuelQuote(motorcycle, mode, requestedValue);
    if (quote.liters <= 0 || quote.price <= 0) return source === 'garage'
        ? showGarageMessage('İstenen yakıt miktarı alınamıyor; bakiye ve depo kapasitesini kontrol et.')
        : showMsg('Bu tutarla alınabilecek yakıt yok; bakiye ve depo kapasitesini kontrol et.');
    const motorcycleId = motorcycle.id;
    const modeLabel = mode === 'money' ? 'belirtilen tutar karşılığında' : 'belirtilen litre miktarında';
    const place = source === 'station' ? `İstasyon: ${currentStation.id.replace('station-', 'No. ')} · ` : '';
    showServiceConfirmation('Yakıt Alımını Onayla', `${place}${modeLabel}\nAlınacak gerçek miktar: ${formatDecimal(quote.liters, 3)} L\nToplam fiyat: ${formatMoneyPrecise(quote.price)} (${formatMoneyPrecise(playerState.dailyPrices.fuel)} / L)\nMevcut bakiye: ${formatMoneyPrecise(game.money)}\nİşlem sonrası bakiye: ${formatMoneyPrecise(quote.remaining)}\n\nAlımı onaylıyor musun?`, () => {
        const current = getActiveMotorcycle();
        if (current.id !== motorcycleId || current.marketplaceListingStatus?.listed) return;
        if (source === 'garage' && !canModifyGarage()) return;
        if (source === 'station' && (!playerState.shiftActive || !stationMenuOpen || !currentStation)) return;
        const currentQuote = getRefuelQuote(current, mode, requestedValue);
        if (currentQuote.liters <= 0 || currentQuote.price <= 0 || currentQuote.price > game.money) return showMsg('Yakıt alımı koşulları değişti; işlem yapılmadı.');
        const committed = commitMarketplaceTransaction(() => {
            game.money = roundMoney(game.money - currentQuote.price);
            recordDailyExpense('fuelExpenses', currentQuote.price);
            current.fuelLiters = Math.min(MOTORCYCLE_CLASSES[current.classKey].tankLiters, current.fuelLiters + currentQuote.liters);
        });
        if (!committed) return;
        fuelEmptyShown = false;
        fuelWarningLowShown = false;
        fuelWarningCriticalShown = false;
        if (pushMode && current.fuelLiters > 0) {
            pushMode = false;
            pushTarget = null;
            state.speed = 0;
        }
        showMsg(`${formatDecimal(currentQuote.liters, 3)} L yakıt alındı · ${formatMoneyPrecise(currentQuote.price)} ödendi.`, 4);
        updateHUD();
        if (source === 'garage') renderGarage();
        else renderServicePanel('station');
    });
}
function repairActiveMotorcycle(kind = 'full', onSite = false) {
    if (!REPAIR_OPTIONS[kind]) return;
    if (!onSite && !canModifyGarage()) return;
    if (onSite && !playerState.shiftActive) return;
    if (playerState.roadsideRepair.active || playerState.roadsideAssistance.active) return showMsg('Önce devam eden yol yardımını tamamla.');
    const motorcycle = getActiveMotorcycle();
    if (motorcycle.marketplaceListingStatus?.listed) return showGarageMessage('İlandaki motosiklete bakım yapılamaz.');
    const quote = getRepairQuote(motorcycle, kind, onSite);
    if (quote.restoreAmount <= 0 || quote.price <= 0) return showMsg('Motosikletin durumu bu bakım için zaten yeterli.');
    if (game.money < quote.price) return showGarageMessage(`Yetersiz bakiye. Gerekli: ${formatMoneyPrecise(quote.price)} · Mevcut: ${formatMoneyPrecise(game.money)}.`);
    const motorcycleId = motorcycle.id;
    const option = REPAIR_OPTIONS[kind];
    const details = `${option.label} · Gerçek onarım: +${formatDecimal(quote.restoreAmount)} puan\n${onSite ? 'Yol kenarı ek ücreti: %10 · ' : ''}Toplam: ${formatMoneyPrecise(quote.price)}\nMevcut bakiye: ${formatMoneyPrecise(game.money)}\nİşlem sonrası bakiye: ${formatMoneyPrecise(game.money - quote.price)}${onSite ? `\nSüre: ${option.seconds} saniye; ücret şimdi alınır, onarım süre bitince uygulanır.` : ''}\n\nOnaylıyor musun?`;
    const confirm = () => {
        const current = getActiveMotorcycle();
        if (current.id !== motorcycleId || current.marketplaceListingStatus?.listed) return;
        if (!onSite && !canModifyGarage()) return;
        if (onSite && !playerState.shiftActive) return;
        const currentQuote = getRepairQuote(current, kind, onSite);
        if (currentQuote.restoreAmount <= 0 || currentQuote.price <= 0 || game.money < currentQuote.price) return showGarageMessage('Bakiye veya motosiklet durumu değişti; bakım yapılmadı.');
        const committed = commitMarketplaceTransaction(() => {
            game.money = roundMoney(game.money - currentQuote.price);
            recordDailyExpense('repairExpenses', currentQuote.price);
            if (onSite) {
                playerState.roadsideRepair = {
                    active: true, motorcycleId, kind, restoreAmount: currentQuote.restoreAmount,
                    remainingSeconds: option.seconds, paidAmount: currentQuote.price, paymentComplete: true,
                };
            } else {
                current.condition = Math.min(100, current.condition + currentQuote.restoreAmount);
            }
        });
        if (!committed) return;
        if (onSite) {
            state.speed = 0;
            for (const key of Object.keys(input)) input[key] = false;
            serviceMode = 'roadside';
            servicePanelOpen = true;
            showMsg(`${option.label} başladı. Ücret kesildi; motosiklet ${option.seconds} saniye sonra onarılacak.`, 4);
            renderServicePanel('roadside');
        } else {
            showGarageMessage(`${option.label} tamamlandı; motosikletin durumu %${Math.round(current.condition)} oldu.`);
            renderGarage();
        }
    };
    showServiceConfirmation('Bakım Onayı', details, confirm);
}
function expandGarage() {
    if (!canModifyGarage()) return;
    if (playerState.garageCapacity >= playerState.maximumGarageCapacity) return showGarageMessage('Garaj en yüksek kapasitede.');
    const price = 2500 + Math.max(0, playerState.garageCapacity - 2) * 1500;
    requestPaidAction('Garaj kapasitesini artır', price, () => {
        if (!canModifyGarage() || playerState.garageCapacity >= playerState.maximumGarageCapacity) return;
        const currentPrice = 2500 + Math.max(0, playerState.garageCapacity - 2) * 1500;
        if (game.money < currentPrice) return showGarageMessage('Bakiye değişti; kapasite artışı için yeterli para yok.');
        const committed = commitMarketplaceTransaction(() => {
            game.money = roundMoney(game.money - currentPrice);
            playerState.garageCapacity++;
        });
        if (!committed) return;
        showGarageMessage(`Garaj kapasitesi ${playerState.garageCapacity} motosiklete yükseltildi.`);
        renderGarage();
    });
}
function acceptContract(companyKey) {
    const company = COURIER_COMPANIES[companyKey];
    if (!company || playerState.shiftActive || playerState.career.level < company.unlockLevel
        || playerState.career.contracts.some(contract => contract.status === 'active')) return;
    const contract = {
        id: makeId('contract'), companyKey, target: company.target, durationDays: company.durationDays,
        reward: company.reward, progress: 0, startDay: playerState.currentDay,
        deadlineDay: playerState.currentDay + company.durationDays - 1, status: 'active', rewardPaid: false,
    };
    const committed = commitMarketplaceTransaction(() => playerState.career.contracts.push(contract));
    if (!committed) return;
    setGarageNotice(`${company.name} sözleşmesi başladı. ${company.durationDays} oyun gününde ${company.target} teslimat yap.`);
    renderGarage();
}
function settleExpiredContracts(day) {
    for (const contract of playerState.career.contracts) {
        if (contract.status === 'active' && day > contract.deadlineDay) {
            contract.status = 'failed';
            showMsg(`${COURIER_COMPANIES[contract.companyKey]?.name || 'Şirket'} sözleşmesi süresi dolduğu için başarısız oldu.`, 5);
        }
    }
}
function showDaySummary() {
    const summary = playerState.dailySummary;
    const net = summary.endBalance - summary.startBalance;
    const content = document.getElementById('day-summary-content');
    content.innerHTML = `
      <p>Oyun günü <strong>${summary.day}</strong> · ${summary.fullShift ? 'Tam vardiya' : 'Vardiya sona erdi'}</p>
      <p>Teslimatlar: <strong>${summary.completedDeliveries}</strong> başarılı · ${summary.failedDeliveries} başarısız</p>
      <p>Temel kazanç: <strong>${formatMoney(summary.baseEarnings)}</strong></p>
      <p>Hız bahşişi: <strong>${formatMoney(summary.tips)}</strong></p>
      <p>Şirket ödülleri: <strong>${formatMoney(summary.contractRewards)}</strong></p>
      <p>Tam vardiya bonusu: <strong>${formatMoney(summary.shiftBonus)}</strong></p>
      <p>Giderler: Yakıt ${formatMoney(summary.fuelExpenses)} · Bakım ${formatMoney(summary.repairExpenses)} · Parça ${formatMoney(summary.upgradeExpenses)}</p>
      <p>XP: <strong>+${summary.xpEarned}</strong> · İtibar: <strong>${summary.reputationChange >= 0 ? '+' : ''}${summary.reputationChange}</strong></p>
      <p>Başlangıç bakiyesi: ${formatMoney(summary.startBalance)}</p>
      <p>Gün sonu bakiyesi: <strong>${formatMoney(summary.endBalance)}</strong> · Net değişim: <strong>${net >= 0 ? '+' : ''}${formatMoney(net)}</strong></p>`;
    const modal = document.getElementById('day-summary');
    modal.classList.add('open');
    modal.setAttribute('aria-hidden', 'false');
}
function endShift(fullShift = false) {
    if (!playerState.shiftActive) return;
    const wasGarageOpen = garageOpen;
    const maintenanceParts = activeMotorcycle.installedUpgrades
        .filter(item => getUpgradeRemainingPercent(item) <= 25)
        .map(item => `${item.categoryLabel} %${Math.round(getUpgradeRemainingPercent(item))}`);
    const bonus = fullShift ? 250 + playerState.shiftDeliveries * 10 : 0;
    const committed = commitMarketplaceTransaction(() => {
        if (bonus > 0) {
            game.money = roundMoney(game.money + bonus);
            playerState.dailySummary.shiftBonus += bonus;
        }
        playerState.dailySummary.fullShift = Boolean(fullShift);
        playerState.dailySummary.ended = true;
        playerState.dailySummary.endBalance = game.money;
        playerState.shiftActive = false;
        playerState.shiftSecondsRemaining = 0;
        playerState.shiftEndPending = false;
        playerState.pendingNextDay = true;
    }, true);
    if (!committed) return;
    game.running = false;
    game.phase = 'wait';
    game.timeLeft = 0;
    missionTransitionTimer = 0;
    state.speed = 0;
    pushMode = false;
    pushTarget = null;
    hideServicePanel();
    for (const key of Object.keys(input)) input[key] = false;
    document.querySelectorAll('.tb').forEach(item => item.classList.remove('on'));
    syncDestinationMarkers('wait', game.restaurant, game.customer);
    const maintenanceSummary = maintenanceParts.length
        ? `Bakım özeti (${MOTORCYCLE_CLASSES[activeMotorcycle.classKey].label}): ${maintenanceParts.join(', ')}. Parçalar otomatik yenilenmedi.`
        : 'Bakım özeti: %25 ve altında parça ömrü bulunmuyor.';
    setGarageNotice(`Vardiya bitti. ${maintenanceSummary} Yeni vardiya bir sonraki oyun gününde 09:00’da başlayacak.`);
    if (!wasGarageOpen) document.getElementById('start').style.display = 'flex';
    document.getElementById('play').textContent = 'YENİ GÜNE BAŞLA';
    renderGarage();
    persistGame();
    showDaySummary();
}
function beginShift() {
    startAudio();
    if (playerState.shiftActive) {
        if (playerState.shiftSecondsRemaining <= 0) return endShift(true);
        document.getElementById('start').style.display = 'none';
        game.running = true;
        shiftSaveTimer = 0;
        syncDestinationMarkers(game.phase, game.restaurant, game.customer);
        if (game.phase === 'wait' && missionTransitionTimer <= 0) newMission();
        updateMotorcycleWarnings(true);
        updateUpgradeLifespanWarnings(activeMotorcycle);
        if (playerState.roadsideAssistance.active || playerState.roadsideRepair.active) {
            servicePanelOpen = true;
            serviceMode = playerState.roadsideAssistance.active ? 'empty' : 'roadside';
            renderServicePanel(serviceMode);
        } else if (activeMotorcycle.fuelLiters <= 0) openEmptyFuelPanel();
        persistGame();
        renderGarage();
        return;
    }
    const shiftStarted = commitMarketplaceTransaction(() => {
        if (playerState.pendingNextDay) {
            const nextDay = playerState.currentDay + 1;
            playerState.currentDay = nextDay;
            playerState.pendingNextDay = false;
            playerState.dailyPrices = rollDailyPrices(playerState.dailyPrices);
            refreshMarketForNewDay(nextDay);
            processPlayerListingsForNewDay(nextDay);
            settleExpiredContracts(nextDay);
        }
        playerState.shiftActive = true;
        playerState.shiftSecondsRemaining = SHIFT_DURATION_SECONDS;
        playerState.shiftDeliveries = 0;
        playerState.shiftEndPending = false;
        playerState.dailySummary = makeDailySummary(playerState.currentDay, game.money);
    }, true);
    if (!shiftStarted) return;
    document.getElementById('start').style.display = 'none';
    document.getElementById('play').textContent = 'VARDİYAYA DÖN';
    game.running = true;
    newMission();
    updateMotorcycleWarnings(true);
    updateUpgradeLifespanWarnings(activeMotorcycle);
    if (playerState.roadsideAssistance.active || playerState.roadsideRepair.active) {
        servicePanelOpen = true;
        serviceMode = playerState.roadsideAssistance.active ? 'empty' : 'roadside';
        renderServicePanel(serviceMode);
    } else if (activeMotorcycle.fuelLiters <= 0) openEmptyFuelPanel();
    persistGame();
    renderGarage();
}

document.getElementById('day-summary-close').addEventListener('click', () => {
    const modal = document.getElementById('day-summary');
    modal.classList.remove('open');
    modal.setAttribute('aria-hidden', 'true');
});

document.getElementById('settings-open').addEventListener('click', openSettingsMenu);
settingsOverlay.addEventListener('click', event => {
    if (event.target === settingsOverlay) {
        closeSettingsMenu();
        return;
    }
    const tabButton = event.target.closest('[data-settings-tab]');
    if (tabButton) {
        activeSettingsTab = tabButton.dataset.settingsTab;
        settingsOverlay.querySelectorAll('[data-settings-tab]').forEach(button => {
            const active = button === tabButton;
            button.classList.toggle('active', active);
            button.setAttribute('aria-selected', String(active));
        });
        renderSettingsContent();
        return;
    }
    const actionButton = event.target.closest('[data-settings-action]');
    if (actionButton?.dataset.settingsAction === 'resume') {
        closeSettingsMenu();
        return;
    }
    if (actionButton?.dataset.settingsAction === 'enable-tilt') {
        void enableTiltControls();
        return;
    }
    if (actionButton?.dataset.settingsAction === 'toggle-mute') {
        settings.audio.muted = !settings.audio.muted;
        saveGameSettings();
        applyAudioSettings();
        renderSettingsContent();
        return;
    }
    const presetButton = event.target.closest('[data-graphics-preset]');
    if (presetButton) {
        applyGraphicsPreset(presetButton.dataset.graphicsPreset);
        renderSettingsContent();
    }
});
settingsContent.addEventListener('change', event => {
    const methodSelect = event.target.closest('[data-control-method]');
    if (!methodSelect) return;
    const method = methodSelect.value;
    if (!['buttons', 'touch', 'tilt'].includes(method)) return;
    if (method === 'tilt' && !tiltControl.supported) {
        settings.controlMethod = 'buttons';
        syncSteeringArea();
        renderSettingsContent();
        return;
    }
    settings.controlMethod = method;
    touchSteerTarget = 0;
    tiltSteerTarget = 0;
    saveGameSettings();
    syncSteeringArea();
    renderSettingsContent();
});
settingsContent.addEventListener('input', event => {
    const audioSlider = event.target.closest('[data-setting-audio]');
    if (audioSlider) {
        const key = audioSlider.dataset.settingAudio;
        if (!(key in settings.audio) || key === 'muted') return;
        settings.audio[key] = THREE.MathUtils.clamp(Math.round(Number(audioSlider.value) || 0), 0, 100);
        const output = settingsContent.querySelector(`[data-setting-value="setting-audio-${key}"]`);
        if (output) output.value = `${settings.audio[key]}%`;
        saveGameSettings();
        applyAudioSettings();
        return;
    }
    const controlSlider = event.target.closest('[data-setting-control]');
    if (controlSlider?.dataset.settingControl === 'sensitivity') {
        settings.controlSensitivity = THREE.MathUtils.clamp(Math.round(Number(controlSlider.value) || 100), 50, 150);
        const output = settingsContent.querySelector('[data-setting-value="setting-control-sensitivity"]');
        if (output) output.value = `${settings.controlSensitivity}%`;
        saveGameSettings();
    }
});

document.getElementById('garage-open').addEventListener('click', openGarage);
document.getElementById('garage-close').addEventListener('click', closeGarage);
document.getElementById('garage-tabs').addEventListener('click', event => {
    const button = event.target.closest('[data-garage-tab]');
    if (!button) return;
    activeGarageTab = button.dataset.garageTab;
    renderGarage();
});
document.getElementById('garage-content').addEventListener('click', event => {
    const button = event.target.closest('[data-action]');
    if (!button) return;
    const { action, id, class: classKey, category, tier } = button.dataset;
    if (action === 'dealer-select') void showDealerPreview(button.dataset.model);
    else if (action === 'dealer-buy') {
        const model = getMotorcycleModel(button.dataset.model);
        purchaseNewMotorcycle(model.classKey, model.key);
    } else if (action === 'contract-accept') acceptContract(button.dataset.company);
    else if (action === 'performance-select') {
        if (playerState.motorcycles.some(item => item.id === id)) {
            selectedPerformanceMotorcycleId = id;
            renderGarage();
        }
    } else if (action === 'performance-buy') purchasePerformanceUpgrade(selectedPerformanceMotorcycleId, category, tier);
    else if (action === 'performance-remove') removePerformanceUpgrade(selectedPerformanceMotorcycleId, category);
    else if (action === 'switch') switchMotorcycle(id);
    else if (action === 'buy-new') purchaseNewMotorcycle(classKey);
    else if (action === 'buy-used') purchaseUsedMotorcycle(id);
    else if (action === 'favorite') toggleFavorite(id);
    else if (action === 'market-detail') { selectedMarketListingId = id; activeGarageTab = 'market-detail'; renderGarage(); }
    else if (action === 'market-back') { activeGarageTab = 'market'; renderGarage(); }
    else if (action === 'negotiate-open') { selectedMarketListingId = id; activeGarageTab = 'market-negotiate'; renderGarage(); }
    else if (action === 'negotiate') attemptNegotiation(id, Number(button.dataset.discount));
    else if (action === 'instant-sell') requestInstantSale(id);
    else if (action === 'start-player-listing') openPlayerListingForm(id);
    else if (action === 'create-player-listing') createPlayerListing(id, Number(button.dataset.markup));
    else if (action === 'lower-player-listing') {
        const input = button.closest('.garage-card')?.querySelector('.listing-price-input');
        lowerPlayerListingPrice(id, input?.value);
    }
    else if (action === 'cancel-player-listing') cancelPlayerListing(id);
    else if (action === 'owned-back') { activeGarageTab = 'owned'; renderGarage(); }
    else if (action === 'repair') repairActiveMotorcycle(button.dataset.kind || 'full', false);
    else if (action === 'garage-refuel-liters') {
        const field = button.closest('.garage-card')?.querySelector('[data-garage-refuel-liters]');
        confirmFuelPurchase('liters', field?.value, 'garage');
    }
    else if (action === 'garage-refuel-money') {
        const field = button.closest('.garage-card')?.querySelector('[data-garage-refuel-money]');
        confirmFuelPurchase('money', field?.value, 'garage');
    }
    else if (action === 'expand') expandGarage();
});
document.getElementById('service-panel').addEventListener('click', event => {
    const button = event.target.closest('[data-service-action]');
    if (!button) return;
    const action = button.dataset.serviceAction;
    if (action === 'close') hideServicePanel();
    else if (action === 'assistance') startRoadsideAssistance();
    else if (action === 'push') startPushingMotorcycle();
    else if (action === 'roadside-maintenance') {
        state.speed = 0;
        for (const key of Object.keys(input)) input[key] = false;
        document.querySelectorAll('.tb').forEach(item => item.classList.remove('on'));
        serviceMode = 'roadside';
        renderServicePanel('roadside');
    } else if (action === 'fuel-options') renderServicePanel('empty');
    else if (action === 'mode-liters' || action === 'mode-money') {
        serviceRefuelMode = action === 'mode-money' ? 'money' : 'liters';
        renderServicePanel('station');
    } else if (action === 'buy-fuel') {
        const input = serviceRefuelMode === 'money'
            ? document.querySelector('[data-service-refuel-money]')
            : document.querySelector('[data-service-refuel-liters]');
        confirmFuelPurchase(serviceRefuelMode, input?.value, 'station');
    } else if (action.startsWith('repair-')) {
        repairActiveMotorcycle(action.slice('repair-'.length), true);
    }
});
document.getElementById('service-panel').addEventListener('input', updateRefuelQuotePreview);
document.getElementById('maintenance-open').addEventListener('click', openRoadsideMaintenance);
document.getElementById('station-interact').addEventListener('click', openNearestStation);
document.getElementById('garage-shift-action').addEventListener('click', () => {
    if (playerState.shiftActive) endShift();
    else beginShift();
});
document.getElementById('garage-confirm-cancel').addEventListener('click', () => {
    pendingConfirmation = null;
    const modal = document.getElementById('garage-confirm');
    modal.classList.remove('open');
    modal.setAttribute('aria-hidden', 'true');
});
document.getElementById('garage-confirm-accept').addEventListener('click', () => {
    const action = pendingConfirmation;
    pendingConfirmation = null;
    const modal = document.getElementById('garage-confirm');
    modal.classList.remove('open');
    modal.setAttribute('aria-hidden', 'true');
    if (action) action();
});
document.getElementById('garage-overlay').addEventListener('click', event => {
    if (event.target.id === 'garage-overlay') closeGarage();
});

const foods = ['Döner', 'Lahmacun', 'Pide', 'İskender', 'Mantı', 'Balık Ekmek', 'Köfte'];

let msgTimer = 0;



function showMsg(text, seconds = 3) {

    ui.msg.textContent = text;

    msgTimer = seconds;

}

function currentOrderSummary() {
    if (game.phase === 'pickup' && game.restaurant) return 'Sipariş: restorandan alım bekleniyor.';
    if (game.phase === 'deliver' && game.customer) return 'Sipariş: müşteriye teslimat sürüyor.';
    return 'Aktif sipariş yok.';
}
function hideServicePanel() {
    servicePanelOpen = false;
    if (stationMenuOpen) {
        stationMenuOpen = false;
        currentStation = null;
    }
    document.getElementById('service-panel').classList.remove('open');
    document.getElementById('station-interact').classList.remove('visible');
}
function updateRefuelQuotePreview() {
    if (serviceMode !== 'station' || !currentStation) return;
    const litersInput = document.querySelector('[data-service-refuel-liters]');
    const moneyInput = document.querySelector('[data-service-refuel-money]');
    const input = serviceRefuelMode === 'money' ? moneyInput : litersInput;
    const quote = getRefuelQuote(getActiveMotorcycle(), serviceRefuelMode, input?.value);
    const preview = document.getElementById('service-refuel-preview');
    if (!preview) return;
    preview.textContent = quote.liters > 0
        ? `Gerçek alım: ${formatDecimal(quote.liters, 3)} L · Toplam: ${formatMoneyPrecise(quote.price)} · Kalan bakiye: ${formatMoneyPrecise(quote.remaining)}`
        : 'Bu miktarla yakıt alınamıyor. Bakiye ve depo kapasitesini kontrol et.';
}
function renderServicePanel(mode = serviceMode) {
    serviceMode = mode;
    const panel = document.getElementById('service-panel');
    const content = document.getElementById('service-content');
    const motorcycle = getActiveMotorcycle();
    const spec = MOTORCYCLE_CLASSES[motorcycle.classKey];
    const fuelPercent = motorcycle.fuelLiters / spec.tankLiters * 100;
    const balance = formatMoneyPrecise(game.money);
    let html = '';

    if (mode === 'station' && currentStation) {
        const room = Math.max(0, spec.tankLiters - motorcycle.fuelLiters);
        const litersValue = Math.min(1, room);
        const cashValue = Math.min(60, Math.max(0, game.money));
        html = `<h3>Yakıt İstasyonu · ${currentStation.id.replace('station-', 'No. ')}</h3>
          <p>Güncel fiyat: <strong>${formatMoneyPrecise(playerState.dailyPrices.fuel)} / L</strong> · Depoda ${formatDecimal(motorcycle.fuelLiters)} / ${spec.tankLiters} L (%${Math.round(fuelPercent)}).</p>
          <p>Bakiye: <strong>${balance}</strong> · En fazla ${formatDecimal(room)} L alınabilir. Vardiya ve sipariş süresi bu menü açıkken duraklar.</p>
          <label>Litre seç <input class="service-input" type="number" min="0.001" step="0.1" max="${spec.tankLiters}" value="${Math.max(0.001, litersValue).toFixed(1)}" data-service-refuel-liters></label>
          <label>₺ tutarı seç <input class="service-input" type="number" min="0.01" step="0.01" value="${cashValue.toFixed(2)}" data-service-refuel-money></label>
          <div class="service-actions"><button class="${serviceRefuelMode === 'liters' ? '' : 'secondary'}" data-service-action="mode-liters">Litreyle al</button><button class="${serviceRefuelMode === 'money' ? '' : 'secondary'}" data-service-action="mode-money">Tutarla al</button><button data-service-action="buy-fuel" ${room <= 0 || game.money <= 0 ? 'disabled' : ''}>Alımı Onayla</button><button class="secondary" data-service-action="close">Kapat</button></div>
          <p id="service-refuel-preview"></p>`;
    } else if (mode === 'empty') {
        if (playerState.roadsideAssistance.active) {
            html = `<h3>Yol Yardımı Bekleniyor</h3><p>Ücret ödendi: ${formatMoneyPrecise(playerState.roadsideAssistance.paidAmount)} · Yakıt, ${Math.ceil(playerState.roadsideAssistance.remainingSeconds)} saniye sonra eklenecek.</p>
              <p>${currentOrderSummary()} Bakiye: <strong>${balance}</strong></p><div class="service-actions"><button class="secondary" data-service-action="close">Haritaya dön</button></div>`;
        } else {
            const target = pushTarget || gasStations.reduce((best, station) => {
                const distance = Math.hypot(station.pos.x - state.x, station.pos.z - state.z);
                return !best || distance < best.distance ? { station, distance } : best;
            }, null)?.station;
            html = `<h3>Yakıt Bitti</h3><p>${pushMode ? 'İtme modu açık: GAZ ile ilerle ve direksiyonla yön ver.' : 'Motosiklet hareket ettirilemiyor.'} En yakın istasyon: <strong>${target ? target.id.replace('station-', 'No. ') : 'bulunamadı'}</strong>.</p>
              <p>${currentOrderSummary()} Vardiya ve sipariş süresi devam ediyor. Bakiye: <strong>${balance}</strong></p>
              <div class="service-actions"><button data-service-action="assistance" ${game.money < 150 || playerState.roadsideAssistance.active ? 'disabled' : ''}>Yol yardımı · ₺150</button><button class="secondary" data-service-action="push">Motosikleti it · ücretsiz</button><button class="secondary" data-service-action="roadside-maintenance">Bakım seçenekleri</button><button class="secondary" data-service-action="close">Haritayı göster</button></div>
              ${game.money < 150 ? '<p>Yol yardımı için bakiye yetersiz; ücretsiz itme seçeneği kullanılabilir.</p>' : ''}`;
        }
    } else if (mode === 'roadside') {
        if (playerState.roadsideAssistance.active) {
            html = `<h3>Yol Yardımı Bekleniyor</h3><p>Ödeme tamamlandı (${formatMoneyPrecise(playerState.roadsideAssistance.paidAmount)}). ${Math.ceil(playerState.roadsideAssistance.remainingSeconds)} saniye kaldı; yakıt henüz eklenmedi.</p><p>${currentOrderSummary()} Bakiye: <strong>${balance}</strong></p><div class="service-actions"><button class="secondary" data-service-action="close">Haritayı göster</button></div>`;
        } else if (playerState.roadsideRepair.active) {
            const repair = playerState.roadsideRepair;
            html = `<h3>${REPAIR_OPTIONS[repair.kind].label} Sürüyor</h3><p>Ücret önceden ödendi: ${formatMoneyPrecise(repair.paidAmount)}. Onarım ${Math.ceil(repair.remainingSeconds)} saniye sonra uygulanacak; mevcut durum bu sırada değişmez.</p><p>${currentOrderSummary()} Bakiye: <strong>${balance}</strong></p><div class="service-actions"><button class="secondary" data-service-action="close">Haritayı göster</button></div>`;
        } else {
            html = `<h3>Yol Kenarı Bakım</h3><p>Durum: <strong>%${Math.round(motorcycle.condition)}</strong> · Yakıt: ${formatDecimal(motorcycle.fuelLiters)} L · Yol kenarı onarımında %10 ek ücret alınır.</p><p>${currentOrderSummary()} Bakiye: <strong>${balance}</strong>. Vardiya ve sipariş süresi işlem sırasında devam eder.</p>
              <div class="service-actions">${Object.entries(REPAIR_OPTIONS).map(([kind, option]) => {
                  const quote = getRepairQuote(motorcycle, kind, true);
                  return `<button data-service-action="repair-${kind}" ${quote.restoreAmount <= 0 || game.money < quote.price ? 'disabled' : ''}>${option.label} · +${formatDecimal(quote.restoreAmount)} · ${formatMoneyPrecise(quote.price)} · ${option.seconds} sn</button>`;
              }).join('')}${motorcycle.fuelLiters <= 0 ? '<button class="secondary" data-service-action="fuel-options">Yakıt seçeneklerine dön</button>' : ''}<button class="secondary" data-service-action="close">Haritaya dön</button></div>`;
        }
    }

    content.innerHTML = html;
    panel.classList.toggle('open', servicePanelOpen);
    if (servicePanelOpen && mode === 'station') updateRefuelQuotePreview();
}
function openEmptyFuelPanel() {
    if (!game.running || !playerState.shiftActive || playerState.roadsideAssistance.active) return;
    fuelEmptyShown = true;
    servicePanelOpen = true;
    serviceMode = 'empty';
    renderServicePanel('empty');
}
function openNearestStation() {
    if (!playerState.shiftActive || !game.running || garageOpen || playerState.roadsideAssistance.active || playerState.roadsideRepair.active) return;
    const station = gasStations.reduce((nearest, candidate) => {
        const distance = Math.hypot(candidate.pos.x - state.x, candidate.pos.z - state.z);
        return !nearest || distance < nearest.distance ? { station: candidate, distance } : nearest;
    }, null);
    if (!station || station.distance > station.station.radius) return showMsg('Yakıt almak için bir istasyonun yanına gel.');
    if (Math.abs(state.speed) > 1.25) return showMsg('Yakıt almak için istasyonda tamamen dur.');
    state.speed = 0;
    currentStation = station.station;
    stationMenuOpen = true;
    servicePanelOpen = true;
    serviceRefuelMode = 'liters';
    for (const key of Object.keys(input)) input[key] = false;
    renderServicePanel('station');
}
function openRoadsideMaintenance() {
    if (playerState.shiftActive && game.running) {
        if (stationMenuOpen) hideServicePanel();
        if (playerState.roadsideAssistance.active || playerState.roadsideRepair.active) {
            servicePanelOpen = true;
            renderServicePanel('roadside');
            return;
        }
        state.speed = 0;
        for (const key of Object.keys(input)) input[key] = false;
        document.querySelectorAll('.tb').forEach(button => button.classList.remove('on'));
        servicePanelOpen = true;
        serviceMode = motorcycleFuelEmpty() ? 'empty' : 'roadside';
        renderServicePanel(serviceMode);
        return;
    }
    activeGarageTab = 'maintenance';
    openGarage();
}
function motorcycleFuelEmpty() {
    return getActiveMotorcycle().fuelLiters <= 0;
}
function startRoadsideAssistance() {
    const motorcycle = getActiveMotorcycle();
    if (!game.running || !playerState.shiftActive || motorcycle.fuelLiters > 0) return;
    if (playerState.roadsideAssistance.active || playerState.roadsideRepair.active) return;
    if (game.money < 150) return showMsg('Yol yardımı için ₺150 gerekiyor; ücretsiz itme seçeneğini kullan.');
    const motorcycleId = motorcycle.id;
    const committed = commitMarketplaceTransaction(() => {
        if (playerState.roadsideAssistance.active || game.money < 150) throw new Error('Yol yardımı zaten sürüyor veya bakiye yetersiz.');
        game.money = roundMoney(game.money - 150);
        recordDailyExpense('fuelExpenses', 150);
        playerState.roadsideAssistance = {
            active: true, motorcycleId, remainingSeconds: 15, targetLiters: 2,
            paidAmount: 150, paymentComplete: true,
        };
    });
    if (!committed) return;
    pushMode = false;
    pushTarget = null;
    state.speed = 0;
    servicePanelOpen = true;
    serviceMode = 'empty';
    renderServicePanel('empty');
    showMsg('Yol yardımı çağrıldı. ₺150 ödendi; 2 L yakıt 15 saniye sonra eklenecek.', 4);
}
function startPushingMotorcycle() {
    if (!game.running || !playerState.shiftActive || getActiveMotorcycle().fuelLiters > 0 || playerState.roadsideAssistance.active || playerState.roadsideRepair.active) return;
    const target = gasStations.reduce((nearest, station) => {
        const distance = Math.hypot(station.pos.x - state.x, station.pos.z - state.z);
        return !nearest || distance < nearest.distance ? { station, distance } : nearest;
    }, null);
    if (!target) return showMsg('Yakınlarda ulaşılabilir bir istasyon yok.');
    pushMode = true;
    pushTarget = target.station;
    state.speed = 0;
    for (const key of Object.keys(input)) input[key] = false;
    document.querySelectorAll('.tb').forEach(button => button.classList.remove('on'));
    state.heading = Math.atan2(target.station.pos.x - state.x, target.station.pos.z - state.z);
    servicePanelOpen = true;
    serviceMode = 'empty';
    renderServicePanel('empty');
    showMsg(`Motosikleti iterek ${target.station.id.replace('station-', 'No. ')} istasyonuna ilerle. GAZ ile it, direksiyonla yön ver.`, 5);
}
function finishRoadsideAssistance() {
    const assistance = playerState.roadsideAssistance;
    if (!assistance.active || !assistance.paymentComplete) return;
    const motorcycle = playerState.motorcycles.find(item => item.id === assistance.motorcycleId);
    if (!motorcycle) {
        playerState.roadsideAssistance = normalizeRoadsideAssistance(null);
        persistGame();
        return;
    }
    const added = Math.min(assistance.targetLiters, MOTORCYCLE_CLASSES[motorcycle.classKey].tankLiters - motorcycle.fuelLiters);
    const committed = commitMarketplaceTransaction(() => {
        if (!playerState.roadsideAssistance.active || !playerState.roadsideAssistance.paymentComplete) throw new Error('Yol yardımı daha önce tamamlandı.');
        motorcycle.fuelLiters = Math.min(MOTORCYCLE_CLASSES[motorcycle.classKey].tankLiters, motorcycle.fuelLiters + added);
        playerState.roadsideAssistance = { ...playerState.roadsideAssistance, active: false, remainingSeconds: 0 };
    }, true);
    if (!committed) return;
    fuelEmptyShown = false;
    fuelWarningLowShown = false;
    fuelWarningCriticalShown = false;
    if (serviceMode === 'empty' || serviceMode === 'roadside') {
        servicePanelOpen = true;
        serviceMode = 'roadside';
        renderServicePanel('roadside');
    }
    showMsg(`${formatDecimal(added, 2)} L yol yardımı yakıtı eklendi.`, 4);
}
function finishRoadsideRepair() {
    const repair = playerState.roadsideRepair;
    if (!repair.active || !repair.paymentComplete) return;
    const motorcycle = playerState.motorcycles.find(item => item.id === repair.motorcycleId);
    if (!motorcycle) {
        playerState.roadsideRepair = normalizeRoadsideRepair(null);
        persistGame();
        return;
    }
    const restoreAmount = Math.min(repair.restoreAmount, 100 - motorcycle.condition);
    const committed = commitMarketplaceTransaction(() => {
        if (!playerState.roadsideRepair.active || !playerState.roadsideRepair.paymentComplete) throw new Error('Onarım daha önce tamamlandı.');
        motorcycle.condition = Math.min(100, motorcycle.condition + restoreAmount);
        playerState.roadsideRepair = { ...playerState.roadsideRepair, active: false, remainingSeconds: 0 };
    }, true);
    if (!committed) return;
    conditionImmobilizedShown = false;
    servicePanelOpen = true;
    serviceMode = 'roadside';
    renderServicePanel('roadside');
    showMsg(`Yol kenarı bakımı tamamlandı. Durum %${Math.round(motorcycle.condition)} oldu.`, 4);
}
function updateRoadsideTimers(dt) {
    let changed = false;
    if (playerState.roadsideAssistance.active) {
        playerState.roadsideAssistance.remainingSeconds = Math.max(0, playerState.roadsideAssistance.remainingSeconds - dt);
        changed = true;
        if (playerState.roadsideAssistance.remainingSeconds <= 0) {
            finishRoadsideAssistance();
            serviceSaveTimer = 0;
            return;
        }
    }
    if (playerState.roadsideRepair.active) {
        playerState.roadsideRepair.remainingSeconds = Math.max(0, playerState.roadsideRepair.remainingSeconds - dt);
        changed = true;
        if (playerState.roadsideRepair.remainingSeconds <= 0) {
            finishRoadsideRepair();
            serviceSaveTimer = 0;
            return;
        }
    }
    if (changed) {
        serviceSaveTimer += dt;
        if (serviceSaveTimer >= 0.5) {
            serviceSaveTimer = 0;
            persistGame();
        }
        if (servicePanelOpen && (serviceMode === 'empty' || serviceMode === 'roadside')) renderServicePanel(serviceMode);
    }
}
function updateStationProximity() {
    const button = document.getElementById('station-interact');
    const nearest = gasStations.reduce((best, station) => {
        const distance = Math.hypot(station.pos.x - state.x, station.pos.z - state.z);
        return !best || distance < best.distance ? { station, distance } : best;
    }, null);
    if (pushMode && nearest && nearest.distance <= nearest.station.radius) {
        pushMode = false;
        pushTarget = null;
        state.speed = 0;
        servicePanelOpen = false;
        document.getElementById('service-panel').classList.remove('open');
        showMsg('İstasyona ulaştın. Yakıt almak için ⛽ Yakıt Al düğmesine bas veya E tuşunu kullan.', 5);
    }
    const canInteract = Boolean(game.running && playerState.shiftActive && nearest && nearest.distance <= nearest.station.radius
        && !stationMenuOpen && !garageOpen && !playerState.roadsideAssistance.active && !playerState.roadsideRepair.active
        && !(servicePanelOpen && serviceMode === 'roadside'));
    button.classList.toggle('visible', canInteract);
    if (canInteract) button.textContent = `⛽ Yakıt Al · ${nearest.station.id.replace('station-', 'No. ')}`;
}
function newMission() {
    missionTransitionTimer = 0;
    game.restaurant = restaurants[Math.floor(Math.random() * restaurants.length)];
    game.customer = null;
    game.phase = 'pickup';
    game.timeLeft = 45;
    game.reward = 0;
    game.activeOrderId = makeId('order');
    game.orderSettled = false;
    game.deliveryClass = '';
    game.deliveryTargetSeconds = 0;
    game.deliveryGraceSeconds = 0;
    game.deliveryElapsed = 0;
    game.pickupDistanceKm = 0;
    syncDestinationMarkers(game.phase, game.restaurant, game.customer);
    showMsg('Yeni sipariş hazır! Sarı hedefte siparişi al.');
    persistGame();
}

function pickUp() {
    const options = customers.filter(customer => customer.distanceTo(game.restaurant.pos) > 40);
    if (!options.length) return;
    game.customer = options[Math.floor(Math.random() * options.length)];
    const distance = game.customer.distanceTo(game.restaurant.pos);
    const distanceKm = distance * WORLD_UNIT_KM;
    game.pickupDistanceKm = distanceKm;
    game.deliveryClass = distanceKm <= DELIVERY_DISTANCE_KM.shortMax ? 'short'
        : distanceKm <= DELIVERY_DISTANCE_KM.mediumMax ? 'medium' : 'long';
    const delivery = DELIVERY_CLASSES[game.deliveryClass];
    game.deliveryTargetSeconds = delivery.targetSeconds;
    game.deliveryGraceSeconds = delivery.graceSeconds;
    game.deliveryElapsed = 0;
    game.timeLeft = delivery.targetSeconds + delivery.graceSeconds;
    game.reward = delivery.fee;
    game.phase = 'deliver';
    syncDestinationMarkers(game.phase, game.restaurant, game.customer);
    playChime();
    showMsg(`${foods[Math.floor(Math.random() * foods.length)]} alındı · ${delivery.label} teslimat (${formatDecimal(distanceKm, 1)} km) · ${formatMoney(delivery.fee)} taban ücret.`);
    persistGame();
}

function changeReputation(amount) {
    const previous = playerState.career.reputation;
    playerState.career.reputation = THREE.MathUtils.clamp(previous + amount, 0, 100);
    const actualChange = playerState.career.reputation - previous;
    playerState.dailySummary.reputationChange += actualChange;
    return actualChange;
}
function awardCareerXp(amount) {
    const career = playerState.career;
    career.xp += amount;
    playerState.dailySummary.xpEarned += amount;
    let levelsGained = 0;
    while (career.xp >= xpRequiredForLevel(career.level)) {
        career.xp -= xpRequiredForLevel(career.level);
        career.level++;
        levelsGained++;
    }
    if (levelsGained) showMsg(`Kurye seviyesi yükseldi! Seviye ${career.level} · yeni şirket sözleşmeleri açılabilir.`, 5);
}
function updateContractProgress() {
    const contract = playerState.career.contracts.find(item => item.status === 'active');
    if (!contract || playerState.currentDay > contract.deadlineDay) return 0;
    contract.progress = Math.min(contract.target, contract.progress + 1);
    if (contract.progress < contract.target || contract.rewardPaid) return 0;
    contract.status = 'completed';
    contract.rewardPaid = true;
    game.money = roundMoney(game.money + contract.reward);
    playerState.career.totalCareerEarnings += contract.reward;
    playerState.dailySummary.contractRewards += contract.reward;
    awardCareerXp(80);
    showMsg(`${COURIER_COMPANIES[contract.companyKey]?.name || 'Şirket'} sözleşmesi tamamlandı · ${formatMoney(contract.reward)} ödül ödendi!`, 5);
    return contract.reward;
}
function failCurrentOrder() {
    if (game.orderSettled) return;
    game.orderSettled = true;
    game.money = Math.max(0, game.money - 20);
    playerState.dailySummary.failedDeliveries++;
    playerState.career.failedDeliveries++;
    changeReputation(-3);
    showMsg('Süre doldu! Sipariş iptal edildi (−₺20, itibar −3).');
    persistGame();
    newMission();
}
function deliver() {
    if (game.orderSettled) return;
    game.orderSettled = true;
    const delivery = DELIVERY_CLASSES[game.deliveryClass] || DELIVERY_CLASSES.short;
    const onTime = game.deliveryElapsed <= game.deliveryTargetSeconds;
    const urgency = onTime ? THREE.MathUtils.clamp((game.deliveryTargetSeconds - game.deliveryElapsed) / Math.max(1, game.deliveryTargetSeconds), 0, 1) : 0;
    const tip = Math.round(delivery.fee * 0.5 * urgency);
    const earned = delivery.fee + tip;
    game.money = roundMoney(game.money + earned);
    game.deliveries++;
    playerState.shiftDeliveries++;
    playerState.career.successfulDeliveries++;
    playerState.career.totalCareerEarnings += earned;
    playerState.dailySummary.completedDeliveries++;
    playerState.dailySummary.baseEarnings += delivery.fee;
    playerState.dailySummary.tips += tip;
    awardCareerXp(onTime ? 35 : 25);
    changeReputation(onTime ? 2 : 1);
    const contractReward = updateContractProgress();
    game.phase = 'wait';
    game.timeLeft = 0;
    syncDestinationMarkers(game.phase, game.restaurant, game.customer);
    missionTransitionTimer = 1.5;
    persistGame();
    playChime();
    playDeliveryVoice();
    showMsg(`Teslimat tamam! ${delivery.label} +${formatMoney(delivery.fee)}${tip ? ` · hız bahşişi +${formatMoney(tip)}` : ''}${contractReward ? ` · sözleşme +${formatMoney(contractReward)}` : ''}`);
}

function setTextIfChanged(element, value) {
    if (element.textContent !== value) element.textContent = value;
}

function updateHUD() {
    setTextIfChanged(ui.money, formatMoney(game.money));
    setTextIfChanged(ui.count, `Teslimat: ${game.deliveries} · Lv ${getCareerLevel()}`);
    const orderTime = Math.max(0, Math.ceil(game.timeLeft));
    const shiftSeconds = Math.max(0, Math.ceil(playerState.shiftSecondsRemaining));
    const gameMinutes = Math.floor(((SHIFT_DURATION_SECONDS - shiftSeconds) / SHIFT_DURATION_SECONDS) * SHIFT_GAME_MINUTES);
    const clockMinutes = SHIFT_GAME_MINUTES === 0 ? 0 : (9 * 60 + gameMinutes) % (24 * 60);
    const clock = `${String(Math.floor(clockMinutes / 60)).padStart(2, '0')}:${String(clockMinutes % 60).padStart(2, '0')}`;
    const phaseText = game.phase === 'pickup' ? `Restoran ${orderTime}s` : game.phase === 'deliver' ? `Müşteri ${orderTime}s` : 'Sipariş bekleniyor';
    const shiftText = playerState.shiftActive ? `Vardiya ${Math.floor(shiftSeconds / 60)}:${String(shiftSeconds % 60).padStart(2, '0')}` : 'Vardiya kapalı';
    setTextIfChanged(ui.time, `Gün ${playerState.currentDay} · ${clock} · ${shiftText} · ${phaseText}`);
    const timeBackground = playerState.shiftActive && shiftSeconds <= 60 || orderTime <= 10 && game.phase !== 'wait' ? 'rgba(200,30,30,.85)' : '';
    if (ui.time.style.background !== timeBackground) ui.time.style.background = timeBackground;

    const motorcycle = getActiveMotorcycle();
    const spec = MOTORCYCLE_CLASSES[motorcycle.classKey];
    const fuelPercent = THREE.MathUtils.clamp(motorcycle.fuelLiters / spec.tankLiters * 100, 0, 100);
    const conditionPercent = THREE.MathUtils.clamp(motorcycle.condition, 0, 100);
    setTextIfChanged(ui.speed, String(Math.round(Math.abs(state.speed) * 3.6)));
    const fuelWidth = `${fuelPercent}%`;
    if (ui.fuelMeter.style.width !== fuelWidth) ui.fuelMeter.style.width = fuelWidth;
    ui.fuelMeter.classList.toggle('warning', fuelPercent <= 25 && fuelPercent > 10);
    ui.fuelMeter.classList.toggle('critical', fuelPercent <= 10);
    setTextIfChanged(ui.fuelValue, `${formatDecimal(motorcycle.fuelLiters)} L`);
    const conditionWidth = `${conditionPercent}%`;
    if (ui.conditionMeter.style.width !== conditionWidth) ui.conditionMeter.style.width = conditionWidth;
    ui.conditionMeter.classList.toggle('warning', conditionPercent <= 40 && conditionPercent > 20);
    ui.conditionMeter.classList.toggle('critical', conditionPercent <= 20);
    setTextIfChanged(ui.conditionValue, `%${Math.round(conditionPercent)}`);
}

function updateMissions(dt, allowObjectives = true, pauseOrderClock = false) {
    if (!playerState.shiftActive || !game.running) return;
    playerState.shiftSecondsRemaining = Math.max(0, playerState.shiftSecondsRemaining - dt);
    shiftSaveTimer += dt;
    if (shiftSaveTimer >= 3) {
        shiftSaveTimer %= 3;
        persistGame();
    }
    if (playerState.shiftSecondsRemaining <= 0) {
        playerState.shiftEndPending = true;
        endShift(true);
        return;
    }
    const pos = bike.position;
    if (game.phase === 'wait' && missionTransitionTimer > 0) {
        missionTransitionTimer = Math.max(0, missionTransitionTimer - dt);
        if (missionTransitionTimer === 0 && game.running && playerState.shiftActive) newMission();
    }
    if (!pauseOrderClock && (game.phase === 'pickup' || game.phase === 'deliver')) {
        game.timeLeft -= dt;
        if (game.phase === 'deliver') game.deliveryElapsed += dt;
        if (game.timeLeft <= 0) {
            failCurrentOrder();
            updateHUD();
            return;
        }
    }
    if (allowObjectives && game.phase === 'pickup' && game.restaurant && pos.distanceTo(game.restaurant.pos) < 3.5) {
        pickUp();
    } else if (allowObjectives && game.phase === 'deliver' && game.customer && pos.distanceTo(game.customer) < 3.5) {
        deliver();
    }
    updateHUD();
    if (msgTimer > 0) {
        msgTimer -= dt;
        if (msgTimer <= 0) ui.msg.textContent = '';
    }
}



// ---------- Driving physics ----------

function collides(x, z, heading = state.heading) {
    const minCellX = Math.floor((x - BIKE_COLLISION_REACH) / COLLISION_CELL_SIZE);
    const maxCellX = Math.floor((x + BIKE_COLLISION_REACH) / COLLISION_CELL_SIZE);
    const minCellZ = Math.floor((z - BIKE_COLLISION_REACH) / COLLISION_CELL_SIZE);
    const maxCellZ = Math.floor((z + BIKE_COLLISION_REACH) / COLLISION_CELL_SIZE);
    const queryStamp = ++colliderQuerySerial;
    for (let cellX = minCellX; cellX <= maxCellX; cellX++) {
        const column = collidersByCell.get(cellX);
        if (!column) continue;
        for (let cellZ = minCellZ; cellZ <= maxCellZ; cellZ++) {
            const bucket = column.get(cellZ);
            if (!bucket) continue;
            for (const collider of bucket) {
                if (collider.queryStamp === queryStamp) continue;
                collider.queryStamp = queryStamp;
                if (PERF_ENABLED) perfColliderCandidates++;
                if (orientedFootprintsOverlap(
                    x, z, heading, BIKE_HALF_WIDTH, BIKE_HALF_LENGTH,
                    collider.centerX, collider.centerZ, 0,
                    collider.halfWidth, collider.halfDepth,
                )) return true;
            }
        }
    }
    return false;
}



function updateUpgradeLifespanWarnings(motorcycle) {
    const messages = [];
    for (const item of motorcycle.installedUpgrades) {
        const percent = getUpgradeRemainingPercent(item);
        if (percent <= 0) {
            if (!item.expiredNotified) {
                item.expiredNotified = true;
                item.criticalNotified = true;
                messages.push(`${item.categoryLabel} ${item.qualityTier} parçasının ömrü bitti; performans bonusu artık etkin değil.`);
            }
        } else if (percent <= 10 && !item.criticalNotified) {
            item.criticalNotified = true;
            messages.push(`${item.categoryLabel} ${item.qualityTier} parçası kritik seviyede: kalan ömür %${Math.ceil(percent)}.`);
        }
    }
    if (messages.length) {
        showMsg(messages.join(' '), 5);
        persistGame();
    }
}

function updateMotorcycleWarnings(force = false) {

    const fuelPercent = activeMotorcycle.fuelLiters / currentMotorcycleSpec().tankLiters * 100;
    const condition = activeMotorcycle.condition;
    const warnings = [];

    if (fuelPercent > 25) fuelWarningLowShown = false;
    if (fuelPercent > 10) fuelWarningCriticalShown = false;
    if (condition > 40) conditionWarningShown = false;
    if (condition > 20) conditionCriticalShown = false;
    if (condition > 0) conditionImmobilizedShown = false;

    if (fuelPercent <= 10 && (force || !fuelWarningCriticalShown)) {
        warnings.push('Yakıt kritik seviyede.');
        fuelWarningLowShown = true;
        fuelWarningCriticalShown = true;
    } else if (fuelPercent <= 25 && (force || !fuelWarningLowShown)) {
        warnings.push('Yakıt azalıyor; yakındaki YAKIT istasyonunu kullan.');
        fuelWarningLowShown = true;
    }
    if (condition <= 0 && (force || !conditionImmobilizedShown)) {
        warnings.push('Motosikletin durumu %0; motor hareket etmiyor. Bakım menüsünü aç.');
        conditionImmobilizedShown = true;
        conditionCriticalShown = true;
        conditionWarningShown = true;
    } else if (condition <= 20 && (force || !conditionCriticalShown)) {
        warnings.push('Motosikletin durumu kritik; bakım yaptır.');
        conditionCriticalShown = true;
        conditionWarningShown = true;
    } else if (condition <= 40 && (force || !conditionWarningShown)) {
        warnings.push('Motosikletin durumu düşük; performans azalıyor.');
        conditionWarningShown = true;
    }

    if (warnings.length) showMsg(warnings.join(' '), force ? 6 : 4);
}

function updateBike(dt) {

    const motorcycleSpec = currentMotorcycleSpec();
    const performance = getPerformanceEffects(activeMotorcycle, dt);
    const previousX = state.x;
    const previousZ = state.z;
    const previousFuel = activeMotorcycle.fuelLiters;
    const conditionFactor = 0.45 + 0.55 * (activeMotorcycle.condition / 100);
    const isPushing = pushMode && activeMotorcycle.fuelLiters <= 0;
    collisionDamageCooldown = Math.max(0, collisionDamageCooldown - dt);

    if (isPushing) {
        if (input.gas) state.speed = Math.min(2.8, state.speed + 4.5 * dt);
        else if (input.brake) state.speed = Math.max(0, state.speed - 8 * dt);
        else state.speed = Math.max(0, state.speed - 3 * dt);
    } else if (activeMotorcycle.condition <= 0) {
        state.speed = Math.sign(state.speed) * Math.max(0, Math.abs(state.speed) - 12 * dt);
    } else if (input.gas && activeMotorcycle.fuelLiters > 0) {
        const acceleration = state.speed < 0 ? 30 : Math.min(
            motorcycleSpec.upgradeAccelerationCap,
            motorcycleSpec.acceleration * (1 + performance.acceleration)
                * (1 + performance.throttleResponse) * conditionFactor,
        );
        state.speed += acceleration * dt;
    } else if (input.gas && activeMotorcycle.fuelLiters <= 0) {
        state.speed = Math.sign(state.speed) * Math.max(0, Math.abs(state.speed) - 8 * dt);
    } else if (input.brake) {
        state.speed -= (state.speed > 0 ? 28 : 8) * (1 + performance.braking) * conditionFactor * dt;
    } else {
        state.speed -= Math.sign(state.speed) * Math.min(Math.abs(state.speed), 5 * dt);
    }

    const maxSpeed = isPushing ? 2.8 : motorcycleSpec.maxSpeed * (1 + performance.topSpeed) * conditionFactor;
    state.speed = THREE.MathUtils.clamp(state.speed, isPushing ? 0 : MAX_REVERSE, maxSpeed);

    const steer = getSteeringIntent(dt);
    const steerRate = 2.4 * (settings.controlSensitivity / 100) * (1 + performance.grip) * Math.min(1, Math.abs(state.speed) / 5) * Math.sign(state.speed);
    state.heading += steer * steerRate * dt;
    const leanTarget = -steer * Math.min(1, Math.abs(state.speed) / 10) * 0.35 / (1 + performance.stability);
    state.lean = THREE.MathUtils.damp(state.lean, leanTarget, 8 + performance.stability * 18, dt);

    setScooterBasis(state.heading, scooterForward, scooterRight);
    const dx = scooterForward.x * state.speed * dt;
    const dz = scooterForward.z * state.speed * dt;
    let hit = false;
    let trafficImpact = false;
    const xTraffic = trafficCollisionAt(state.x + dx, state.z, state.heading);
    if (!collides(state.x + dx, state.z, state.heading) && !xTraffic) state.x += dx;
    else { hit = true; trafficImpact = Boolean(xTraffic); }
    const zTraffic = trafficCollisionAt(state.x, state.z + dz, state.heading);
    if (!collides(state.x, state.z + dz, state.heading) && !zTraffic) state.z += dz;
    else { hit = true; trafficImpact = trafficImpact || Boolean(zTraffic); }

    if (hit) {
        const impactSpeedKmh = Math.abs(state.speed) * 3.6;
        if (!collisionContactActive && collisionDamageCooldown <= 0 && impactSpeedKmh > 0.5 && !isPushing) {
            const damage = impactSpeedKmh <= 20 ? 2 : impactSpeedKmh <= 50 ? 5 : 10;
            activeMotorcycle.condition = Math.max(0, activeMotorcycle.condition - damage);
            collisionDamageCooldown = 2;
            showMsg(`${trafficImpact ? 'Trafiğe çarptın' : 'Çarpışma'} · motosiklet %${damage} durum kaybetti.`, 2);
            persistGame();
            updateMotorcycleWarnings();
        }
        collisionContactActive = true;
        state.speed *= 0.5;
    } else {
        collisionContactActive = false;
    }

    const traveledKm = Math.hypot(state.x - previousX, state.z - previousZ) * WORLD_UNIT_KM;
    if (traveledKm > 0) {
        activeMotorcycle.odometerKm += traveledKm;
        if (!isPushing && activeMotorcycle.fuelLiters > 0) {
            const conditionFuelPenalty = 1 + (100 - activeMotorcycle.condition) / 100 * 0.35;
            const consumptionPer100Km = motorcycleSpec.consumptionPer100Km * (1 - performance.fuelReduction) * conditionFuelPenalty;
            activeMotorcycle.fuelLiters = Math.max(0, activeMotorcycle.fuelLiters - traveledKm * consumptionPer100Km / 100);
            if (activeMotorcycle.fuelLiters <= 0.001) activeMotorcycle.fuelLiters = 0;
        }
        if (!isPushing && activeMotorcycle.condition > 0) {
            const totalWearKm = activeMotorcycle.conditionWearProgressKm + traveledKm;
            const wearPoints = Math.floor(totalWearKm / 10);
            activeMotorcycle.conditionWearProgressKm = activeMotorcycle.condition - wearPoints <= 0 ? 0 : totalWearKm - wearPoints * 10;
            if (wearPoints > 0) activeMotorcycle.condition = Math.max(0, activeMotorcycle.condition - wearPoints);
        }
        const partWearAllowed = playerState.shiftActive && !isPushing
            && !playerState.roadsideAssistance.active && !playerState.roadsideRepair.active;
        if (partWearAllowed) {
            for (const part of activeMotorcycle.installedUpgrades) {
                const fullLifeKm = getUpgradeFullLifespanKm(part.categoryKey, part.qualityTier);
                part.remainingLifespanKm = Math.max(0, getUpgradeRemainingKm(part) - traveledKm);
                part.remainingLifespan = fullLifeKm > 0 ? part.remainingLifespanKm / fullLifeKm * 100 : 0;
            }
        }
        saveTimer += dt;
        if (saveTimer >= 2) {
            persistGame();
            saveTimer %= 2;
        }
    }

    if (previousFuel > 0 && activeMotorcycle.fuelLiters <= 0 && playerState.shiftActive) {
        fuelEmptyShown = true;
        showMsg('Yakıt bitti. Yol yardımı çağırabilir veya motosikleti en yakın istasyona itebilirsin.', 5);
        openEmptyFuelPanel();
    } else if (activeMotorcycle.fuelLiters <= 0 && input.gas && !fuelEmptyShown && playerState.shiftActive) {
        fuelEmptyShown = true;
        showMsg('Yakıt bitti. Yol yardımı çağırabilir veya motosikleti en yakın istasyona itebilirsin.', 5);
        openEmptyFuelPanel();
    }
    updateMotorcycleWarnings();
    updateUpgradeLifespanWarnings(activeMotorcycle);

    bike.position.set(state.x, 0, state.z);
    bike.rotation.y = state.heading;
    bikeVisual.rotation.z = state.lean;
    updateStationProximity();

}



// ---------- Camera ----------

const camPos = new THREE.Vector3(state.x, 6, state.z - 10);

function updateCamera(dt) {

    const back = 8 + Math.abs(state.speed) * 0.12;

    const desired = new THREE.Vector3(

        state.x - Math.sin(state.heading) * back,

        4.5,

        state.z - Math.cos(state.heading) * back,

    );

    camPos.lerp(desired, 1 - Math.exp(-4 * dt));

    camera.position.copy(camPos);

    camera.lookAt(state.x + Math.sin(state.heading) * 4, 1.2, state.z + Math.cos(state.heading) * 4);

    sun.position.set(state.x + 20, 40, state.z + 15);

    sun.target.position.set(state.x, 0, state.z);

}



// ---------- Start & loop ----------

const playButton = document.getElementById('play');

playButton.textContent = playerState.shiftActive ? 'VARDİYAYA DÖN' : 'VARDİYAYA BAŞLA';

playButton.addEventListener('click', beginShift);



const perf = PERF_ENABLED ? {
    lastFrameAt: 0,
    windowStartedAt: performance.now(),
    frameTimes: [],
    updateTimes: [],
    bikeTimes: [],
    renderCpuTimes: [],
    gpuTimes: [],
    longTaskCount: 0,
    longTaskMs: 0,
    gcCount: 0,
    gcMs: 0,
    gpuQueries: [],
    gpuExt: null,
    gpuContext: renderer.getContext(),
    overlay: null,
} : null;

if (perf) {
    const gl = perf.gpuContext;
    try { perf.gpuExt = gl.getExtension('EXT_disjoint_timer_query_webgl2'); } catch {}
    perf.overlay = document.createElement('pre');
    perf.overlay.id = 'dev-performance-overlay';
    Object.assign(perf.overlay.style, {
        position: 'fixed', left: '8px', bottom: '8px', zIndex: '1000', margin: '0',
        padding: '8px 10px', border: '1px solid #8de1ff', borderRadius: '7px',
        background: 'rgba(4,12,20,.88)', color: '#dcf5ff', font: '11px/1.4 monospace',
        pointerEvents: 'none', whiteSpace: 'pre-wrap',
    });
    document.body.appendChild(perf.overlay);

    const auditControls = () => {
        const controls = ['bL', 'bR', 'bB', 'bG'].map(id => {
            const element = document.getElementById(id);
            const rect = element.getBoundingClientRect();
            const style = getComputedStyle(element);
            return { id, tag: element.tagName, rect: [Math.round(rect.x), Math.round(rect.y), Math.round(rect.width), Math.round(rect.height)], background: style.backgroundColor, radius: style.borderRadius };
        });
        const points = [[0.08, 0.7], [0.08, 0.84], [0.28, 0.84]].map(([x, y]) => {
            const stack = document.elementsFromPoint(innerWidth * x, innerHeight * y).slice(0, 5).map(element => {
                const style = getComputedStyle(element);
                return `${element.tagName.toLowerCase()}${element.id ? `#${element.id}` : ''}${typeof element.className === 'string' && element.className ? `.${element.className.trim().replace(/\\s+/g, '.')}` : ''} bg=${style.backgroundColor}`;
            });
            return { point: [x, y], stack };
        });
        console.info('[PerfDOM] bottom-left controls/layers', JSON.stringify({ controls, points }));
    };
    auditControls();

    if ('PerformanceObserver' in window) {
        try {
            const observer = new PerformanceObserver(list => {
                for (const entry of list.getEntries()) {
                    perf.longTaskCount++;
                    perf.longTaskMs += entry.duration;
                }
            });
            observer.observe({ type: 'longtask', buffered: true });
        } catch {}
        try {
            if (PerformanceObserver.supportedEntryTypes?.includes('gc')) {
                const observer = new PerformanceObserver(list => {
                    for (const entry of list.getEntries()) { perf.gcCount++; perf.gcMs += entry.duration; }
                });
                observer.observe({ type: 'gc', buffered: true });
            }
        } catch {}
    }
}

function profileSummary() {
    if (!perf) return;
    const sorted = values => values.slice().sort((a, b) => a - b);
    const average = values => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
    const percentile = (values, fraction) => {
        const ordered = sorted(values);
        return ordered.length ? ordered[Math.min(ordered.length - 1, Math.floor((ordered.length - 1) * fraction))] : 0;
    };
    const gl = perf.gpuContext;
    const pending = perf.gpuQueries;
    for (let i = pending.length - 1; i >= 0; i--) {
        const query = pending[i];
        if (!gl.getQueryParameter(query, gl.QUERY_RESULT_AVAILABLE)) continue;
        if (!gl.getParameter(perf.gpuExt.GPU_DISJOINT_EXT)) perf.gpuTimes.push(gl.getQueryParameter(query, gl.QUERY_RESULT) / 1e6);
        gl.deleteQuery(query);
        pending.splice(i, 1);
    }
    const objects = { meshes: 0, instancedMeshes: 0, visibleMeshes: 0, geometries: new Set(), materials: new Set(), textures: new Set(), estimatedTextureBytes: 0 };
    const addTexture = texture => {
        if (!texture?.isTexture || objects.textures.has(texture)) return;
        objects.textures.add(texture);
        const image = texture.image || texture.source?.data;
        const width = Number(image?.width || image?.videoWidth || image?.naturalWidth || 0);
        const height = Number(image?.height || image?.videoHeight || image?.naturalHeight || 0);
        if (width && height) objects.estimatedTextureBytes += width * height * 4 * (texture.generateMipmaps === false ? 1 : 4 / 3);
    };
    scene.traverse(object => {
        if (!object.isMesh) return;
        objects.meshes++;
        if (object.visible) objects.visibleMeshes++;
        if (object.isInstancedMesh) objects.instancedMeshes++;
        if (object.geometry) objects.geometries.add(object.geometry);
        const materials = Array.isArray(object.material) ? object.material : [object.material];
        for (const material of materials) {
            if (!material) continue;
            objects.materials.add(material);
            for (const value of Object.values(material)) if (value?.isTexture) addTexture(value);
        }
    });
    const rendererInfo = renderer.info;
    const frameMs = average(perf.frameTimes);
    const p99FrameMs = percentile(perf.frameTimes, 0.99);
    const dpr = renderer.getPixelRatio();
    const report = {
        preset: settings.graphics,
        viewport: `${innerWidth}x${innerHeight}`,
        dpr,
        frames: perf.frameTimes.length,
        fpsAverage: frameMs ? +(1000 / frameMs).toFixed(1) : null,
        frameMsAverage: +frameMs.toFixed(2),
        frameMsP99: +p99FrameMs.toFixed(2),
        fps1PercentLow: p99FrameMs ? +(1000 / p99FrameMs).toFixed(1) : null,
        jsUpdateMsAverage: +average(perf.updateTimes).toFixed(2),
        bikeUpdateMsAverage: +average(perf.bikeTimes).toFixed(2),
        renderSubmissionMsAverage: +average(perf.renderCpuTimes).toFixed(2),
        gpuRenderMsAverage: perf.gpuTimes.length ? +average(perf.gpuTimes).toFixed(2) : 'unavailable',
        gpuTimerSupported: Boolean(perf.gpuExt),
        draws: rendererInfo.render.calls,
        triangles: rendererInfo.render.triangles,
        meshes: objects.meshes,
        visibleMeshes: objects.visibleMeshes,
        instancedMeshBatches: objects.instancedMeshes,
        uniqueGeometries: objects.geometries.size,
        uniqueMaterials: objects.materials.size,
        uniqueTextures: objects.textures.size,
        estimatedTextureMB: +(objects.estimatedTextureBytes / 1048576).toFixed(1),
        rendererGeometries: rendererInfo.memory.geometries,
        rendererTextures: rendererInfo.memory.textures,
        shaderPrograms: rendererInfo.programs?.length ?? null,
        longTasks: `${perf.longTaskCount}/${perf.longTaskMs.toFixed(1)}ms`,
        gcEvents: `${perf.gcCount}/${perf.gcMs.toFixed(1)}ms`,
    };
    perf.overlay.textContent = `${report.fpsAverage ?? '--'} FPS · ${report.frameMsAverage} ms (p99 ${report.frameMsP99})\nDraws ${report.draws} · Tris ${report.triangles}\nMeshes ${report.meshes} · Mats ${report.uniqueMaterials} · Tex ~${report.estimatedTextureMB} MB\nJS ${report.jsUpdateMsAverage} ms · GPU ${report.gpuRenderMsAverage} ms · ${report.preset.toUpperCase()}`;
    console.info('[PerfProfile]', JSON.stringify(report));
    perf.frameTimes.length = perf.updateTimes.length = perf.bikeTimes.length = perf.renderCpuTimes.length = perf.gpuTimes.length = 0;
    perf.longTaskCount = perf.longTaskMs = perf.gcCount = perf.gcMs = 0;
    perf.windowStartedAt = performance.now();
}

if (perf) window.setInterval(profileSummary, 5000);

const timer = new THREE.Timer();

updateCamera(1);

renderer.setAnimationLoop(time => {

    const profileNow = perf ? performance.now() : 0;
    if (perf) {
        if (perf.lastFrameAt) perf.frameTimes.push(profileNow - perf.lastFrameAt);
        perf.lastFrameAt = profileNow;
    }
    timer.update(time);

    const dt = Math.min(0.05, timer.getDelta());
    const updateStartedAt = perf ? performance.now() : 0;
    let bikeElapsed = 0;

    if (game.running && !simulationPaused) {
        updateTraffic(dt);
        if (!garageOpen && !stationMenuOpen) {
            const bikeStartedAt = perf ? performance.now() : 0;
            updateBike(dt);
            if (perf) bikeElapsed = performance.now() - bikeStartedAt;
        }
        // Settings pause the complete simulation; the existing garage and fuel
        // station retain their established order-clock behavior when used alone.
        updateRoadsideTimers(dt);
        updateMissions(dt, !garageOpen, stationMenuOpen);
    }

    updateEngineAudio(dt);
    updateSpatialAudio(dt);
    if (!simulationPaused) updateCamera(dt);

    updateWorldShadowCasters(dt);
    drawMinimap();
    if (perf) {
        perf.updateTimes.push(performance.now() - updateStartedAt);
        perf.bikeTimes.push(bikeElapsed);
    }

    if (perf?.gpuExt) {
        try {
            const query = perf.gpuContext.createQuery();
            perf.gpuContext.beginQuery(perf.gpuExt.TIME_ELAPSED_EXT, query);
            perf.gpuQueries.push(query);
        } catch {}
    }
    if (perf) renderer.info.reset();
    const renderStartedAt = perf ? performance.now() : 0;
    renderer.render(scene, camera);
    if (perf) perf.renderCpuTimes.push(performance.now() - renderStartedAt);
    if (perf?.gpuExt && perf.gpuQueries.length) {
        try { perf.gpuContext.endQuery(perf.gpuExt.TIME_ELAPSED_EXT); } catch {}
    }
    if (dealerPreviewRenderer && garageOpen && activeGarageTab === 'dealership') {
        resizeDealerPreview();
        if (dealerPreviewTurntable) dealerPreviewTurntable.rotation.y += dt * 0.22;
        dealerPreviewRenderer.render(dealerPreviewScene, dealerPreviewCamera);
    }

});

/* ==========================================
   MOTOKURYE ISTANBUL - CANLI RADYO
   Mevcut JavaScript dosyasinin en altina ekle.
   ========================================== */

const mkRadioStations = [
  {
    name: "Power Türk",
    genre: "Türkçe Pop",
    url: "https://listen.powerapp.com.tr/powerturk/128/icecast.audio"
  },
  {
    name: "Kral Türk FM",
    genre: "Türkçe Müzik",
    url: "https://live.radyositesihazir.com/8032/stream"
  },
  {
    name: "Damar Türk FM",
    genre: "Arabesk",
    url: "https://live.radyositesihazir.com:10997/"
  }
];

// Bu adresler burada canlı olarak doğrulanmamistir.
// Calismayan veya kullanim izni olmayan yayinlar
// resmi ve izinli yayin adresleriyle degistirilmelidir.

const mkRadioAudio = new Audio();
mkRadioAudio.preload = "none";

let mkRadioIndex = 0;
let mkRadioActive = false;
let mkRadioRequest = 0;
let mkRadioTimer = null;

function mkRadioVolume() {
  const master = (settings.audio.master ?? 100) / 100;
  const radio = (settings.audio.radio ?? 35) / 100;

  mkRadioAudio.volume = Math.max(
    0,
    Math.min(1, master * radio)
  );

  mkRadioAudio.muted = Boolean(settings.audio.muted);
}

function mkRadioStatus(message) {
  const status = document.getElementById("mk-radio-status");
  const station = document.getElementById("mk-radio-station");
  const toggle = document.getElementById("mk-radio-toggle");

  if (status) status.textContent = message;

  if (station) {
    const current = mkRadioStations[mkRadioIndex];
    station.textContent = current.name + " - " + current.genre;
  }

  if (toggle) {
    toggle.textContent = mkRadioActive
      ? "■ Kapat"
      : "▶ Aç";
  }
}

function mkRadioStop() {
  mkRadioActive = false;
  mkRadioRequest++;

  clearTimeout(mkRadioTimer);

  mkRadioAudio.pause();
  mkRadioAudio.removeAttribute("src");
  mkRadioAudio.load();

  mkRadioStatus("Radyo kapalı");

  if (typeof music !== "undefined" && audioUnlocked) {
    music.play().catch(() => {});
  }
}

async function mkRadioPlay(index = mkRadioIndex) {
  mkRadioIndex = (
    index + mkRadioStations.length
  ) % mkRadioStations.length;

  mkRadioActive = true;

  const request = ++mkRadioRequest;

  clearTimeout(mkRadioTimer);
  mkRadioAudio.pause();

  const selected = mkRadioStations[mkRadioIndex];

  mkRadioAudio.src = selected.url;
  mkRadioAudio.load();

  mkRadioVolume();

  if (typeof music !== "undefined") {
    music.pause();
  }

  mkRadioStatus("Bağlanıyor...");

  mkRadioTimer = setTimeout(() => {
    if (
      mkRadioActive &&
      request === mkRadioRequest &&
      mkRadioAudio.readyState < 2
    ) {
      mkRadioAudio.pause();
      mkRadioStatus("Bağlantı zaman aşımı");
    }
  }, 14000);

  try {
    await mkRadioAudio.play();

    if (mkRadioActive && request === mkRadioRequest) {
      clearTimeout(mkRadioTimer);
      mkRadioStatus("● Canlı yayın");
    }
  } catch (error) {
    if (mkRadioActive && request === mkRadioRequest) {
      clearTimeout(mkRadioTimer);
      mkRadioStatus("Yayın açılamadı");
      console.warn("[Radyo]", selected.name, error);
    }
  }
}

mkRadioAudio.addEventListener("playing", () => {
  if (mkRadioActive) {
    clearTimeout(mkRadioTimer);
    mkRadioStatus("● Canlı yayın");
  }
});

mkRadioAudio.addEventListener("waiting", () => {
  if (mkRadioActive) {
    mkRadioStatus("Yükleniyor...");
  }
});

mkRadioAudio.addEventListener("error", () => {
  if (mkRadioActive) {
    clearTimeout(mkRadioTimer);
    mkRadioStatus("Yayın hatası - başka istasyon deneyin");
  }
});

function mkCreateRadioUI() {
  if (document.getElementById("mk-radio-ui")) return;

  const style = document.createElement("style");

  style.textContent = `
    #mk-radio-ui {
      position: fixed;
      top: 125px;
      right: 16px;
      z-index: 950;
      font-family: Arial, sans-serif;
      color: white;
      pointer-events: none;
    }

    #mk-radio-ui button,
    #mk-radio-ui input,
    #mk-radio-panel {
      pointer-events: auto;
    }

    #mk-radio-open {
      background: rgba(20, 34, 52, 0.94);
      color: white;
      border: 1px solid #607e98;
      border-radius: 24px;
      padding: 10px 15px;
      font-weight: bold;
      cursor: pointer;
    }

    #mk-radio-panel {
      display: none;
      width: 260px;
      max-width: calc(100vw - 32px);
      margin-top: 8px;
      padding: 15px;
      border-radius: 14px;
      background: rgba(15, 27, 43, 0.97);
      border: 1px solid #607e98;
      box-shadow: 0 8px 25px #0007;
      box-sizing: border-box;
    }

    #mk-radio-panel.open {
      display: block;
    }

    #mk-radio-panel h3 {
      margin: 0 0 12px;
      font-size: 16px;
      color: #ffd25a;
    }

    #mk-radio-station {
      font-weight: bold;
      font-size: 13px;
      margin-bottom: 8px;
    }

    #mk-radio-status {
      font-size: 12px;
      color: #b8d5e9;
      min-height: 18px;
    }

    .mk-radio-controls {
      display: flex;
      gap: 7px;
      margin: 12px 0;
    }

    .mk-radio-controls button {
      flex: 1;
      background: #29425e;
      border: 1px solid #6c8eac;
      border-radius: 8px;
      color: white;
      padding: 10px 4px;
      cursor: pointer;
    }

    #mk-radio-volume {
      width: 100%;
      accent-color: #ffd25a;
    }

    @media (max-width: 600px) {
      #mk-radio-ui {
        top: 110px;
        right: 8px;
      }

      #mk-radio-panel {
        max-height: 50vh;
        overflow-y: auto;
      }
    }
  `;

  document.head.appendChild(style);

  const ui = document.createElement("div");
  ui.id = "mk-radio-ui";

  ui.innerHTML = `
    <button id="mk-radio-open" type="button"
      aria-expanded="false" aria-controls="mk-radio-panel">
      📻 Radyo
    </button>

    <div id="mk-radio-panel">
      <h3>📻 Canlı Türk Radyoları</h3>

      <div id="mk-radio-station"></div>
      <div id="mk-radio-status" role="status"></div>

      <div class="mk-radio-controls">
        <button id="mk-radio-prev" type="button">◀</button>
        <button id="mk-radio-toggle" type="button">▶ Aç</button>
        <button id="mk-radio-next" type="button">▶</button>
      </div>

      <label for="mk-radio-volume">
        Radyo Sesi: <span id="mk-radio-volume-text"></span>
      </label>

      <input
        id="mk-radio-volume"
        type="range"
        min="0"
        max="100"
      >
    </div>
  `;

  document.body.appendChild(ui);

  const panel = document.getElementById("mk-radio-panel");
  const open = document.getElementById("mk-radio-open");

  open.addEventListener("click", () => {
    const visible = panel.classList.toggle("open");
    open.setAttribute("aria-expanded", String(visible));
  });

  document.getElementById("mk-radio-toggle")
    .addEventListener("click", () => {
      if (mkRadioActive) {
        mkRadioStop();
      } else {
        mkRadioPlay();
      }
    });

  document.getElementById("mk-radio-prev")
    .addEventListener("click", () => {
      mkRadioPlay(mkRadioIndex - 1);
    });

  document.getElementById("mk-radio-next")
    .addEventListener("click", () => {
      mkRadioPlay(mkRadioIndex + 1);
    });

  const slider = document.getElementById("mk-radio-volume");
  const label = document.getElementById("mk-radio-volume-text");

  slider.value = settings.audio.radio ?? 35;
  label.textContent = slider.value + "%";

  slider.addEventListener("input", () => {
    settings.audio.radio = Number(slider.value);
    label.textContent = slider.value + "%";

    mkRadioVolume();

    if (typeof saveGameSettings === "function") {
      saveGameSettings();
    }
  });

  mkRadioStatus("Radyo kapalı");
}

mkCreateRadioUI();

// Mevcut ses ayarları değiştiğinde radyo da güncellensin.
if (typeof applyAudioSettings === "function") {
  const originalApplyAudioSettings = applyAudioSettings;

  applyAudioSettings = function (...args) {
    const result = originalApplyAudioSettings(...args);
    mkRadioVolume();
    return result;
  };
}

// Oyun ana müziği yeniden başlatmaya çalışırsa,
// radyo çalarken müziği kapalı tut.
if (typeof startAudio === "function") {
  const originalStartAudio = startAudio;

  startAudio = function (...args) {
    const result = originalStartAudio(...args);

    if (mkRadioActive && typeof music !== "undefined") {
      music.pause();
    }

    return result;
  };
}

// Sekme arka plana geçtiğinde radyo sesini durdur.
document.addEventListener("visibilitychange", () => {
  if (document.hidden) {
    mkRadioAudio.pause();
  } else if (mkRadioActive) {
    mkRadioPlay(mkRadioIndex);
  }
});
