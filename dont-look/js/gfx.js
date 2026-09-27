// Don't Look — Three.js graphics module
import * as THREE from 'three';

// ── Exports accessed by main.js ──────────────────────────────────────────────
export let scene, camera, renderer;

let flashlight;         // SpotLight child of camera
let monsterMesh;        // The monster group
let monsterEyes = [];   // Eye PointLights
let monsterEyeMeshes = [];
let playerModels = new Map(); // id → ghost mesh
let ritualMeshes = [];  // glowing floor circles
let exitMesh;           // exit door mesh
let walls = [];         // [{minX,maxX,minZ,maxZ}] for LOS checks
let lightList = [];     // flickering point lights {light, base, phase, amp}

let shake = new THREE.Vector3();
let shakeT = 0;

// Monster animation state
const M = { frozen: false, t: 0, eyeT: 0, tremorT: 0 };

// ── Init ─────────────────────────────────────────────────────────────────────
export function init(canvas) {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    renderer.setSize(innerWidth, innerHeight);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.1;
    renderer.outputColorSpace = THREE.SRGBColorSpace;

    addEventListener('resize', () => {
        renderer.setSize(innerWidth, innerHeight);
        camera.aspect = innerWidth / innerHeight;
        camera.updateProjectionMatrix();
    });

    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x000000);
    scene.fog = new THREE.FogExp2(0x000000, 0.035);

    camera = new THREE.PerspectiveCamera(75, innerWidth / innerHeight, 0.05, 80);
    camera.position.set(0, 1.7, 0);

    // Flashlight
    flashlight = new THREE.SpotLight(0xfff5e0, 180, 22, 0.38, 0.5, 1.2);
    flashlight.castShadow = true;
    flashlight.shadow.mapSize.set(512, 512);
    flashlight.shadow.camera.near = 0.1;
    flashlight.shadow.camera.far = 22;
    const target = new THREE.Object3D();
    camera.add(target);
    target.position.set(0, 0, -1);
    flashlight.target = target;
    camera.add(flashlight);
    scene.add(camera);

}

// ── Level geometry ─────────────────────────────────────────────────────────
// Level layout (rooms + corridors) ← unit = 1 m
// Each room: { cx, cz, w, d } centre, half-extents
// Each corridor connecting them: 2.4 wide
const CEIL_H = 4.2;
const WALL_T = 0.3;

const ROOMS = [
    { cx:  0,  cz:  0,  w: 12, d: 12, name: 'start'   },
    { cx: 22,  cz:  0,  w: 10, d: 10, name: 'ritual1'  },
    { cx: 22,  cz:-18,  w: 10, d: 10, name: 'hub'      },
    { cx: 38,  cz:-18,  w: 10, d: 10, name: 'ritual2'  },
    { cx: 22,  cz:-34,  w: 10, d: 10, name: 'ritual3'  },
    { cx: 40,  cz:-34,  w: 10, d: 10, name: 'exit'     },
];

// Corridors: [fromRoom, toRoom]
const CORRIDORS = [
    [0, 1], // start → ritual1
    [1, 2], // ritual1 → hub
    [2, 3], // hub → ritual2
    [2, 4], // hub → ritual3
    [4, 5], // ritual3 → exit
];

export const RITUAL_POSITIONS = [
    { x: ROOMS[1].cx, z: ROOMS[1].cz },
    { x: ROOMS[3].cx, z: ROOMS[3].cz },
    { x: ROOMS[4].cx, z: ROOMS[4].cz },
];
export const EXIT_POS = { x: ROOMS[5].cx, z: ROOMS[5].cz };
export const START_SPAWNS = [
    { x: -3, z: -3 }, { x: 3, z: -3 }, { x: -3, z: 3 }, { x: 3, z: 3 },
    { x:  0, z:  4 }, { x: 0, z: -4 }, { x: -4, z: 0 }, { x: 4, z: 0 },
];
export const MONSTER_SPAWN = { x: -4, z: 4 };

// Stone wall texture (canvas)
function makeWallTexture() {
    const sz = 256, cv = document.createElement('canvas');
    cv.width = cv.height = sz;
    const ctx = cv.getContext('2d');
    ctx.fillStyle = '#141418';
    ctx.fillRect(0, 0, sz, sz);
    // rough noise
    for (let i = 0; i < 3000; i++) {
        const x = Math.random() * sz, y = Math.random() * sz;
        const r = Math.random() * 2 + 0.5;
        const v = Math.floor(Math.random() * 25) + 10;
        ctx.fillStyle = `rgb(${v},${v},${v+2})`;
        ctx.fillRect(x, y, r, r);
    }
    // horizontal stone lines
    for (let y = 0; y < sz; y += 18 + Math.floor(Math.random() * 6)) {
        ctx.fillStyle = '#08080c';
        ctx.fillRect(0, y, sz, 1 + Math.random());
    }
    const tex = new THREE.CanvasTexture(cv);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    return tex;
}
function makeFloorTexture() {
    const sz = 256, cv = document.createElement('canvas');
    cv.width = cv.height = sz;
    const ctx = cv.getContext('2d');
    ctx.fillStyle = '#0c0c10';
    ctx.fillRect(0, 0, sz, sz);
    for (let i = 0; i < 2000; i++) {
        const x = Math.random() * sz, y = Math.random() * sz;
        const v = Math.floor(Math.random() * 18) + 8;
        ctx.fillStyle = `rgb(${v},${v},${v+1})`;
        ctx.fillRect(x, y, Math.random() * 3 + 0.5, Math.random() * 3 + 0.5);
    }
    const tex = new THREE.CanvasTexture(cv);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    return tex;
}

const wallTex = makeWallTexture();
wallTex.repeat.set(4, 2);
const floorTex = makeFloorTexture();

const matWall = new THREE.MeshStandardMaterial({ map: wallTex, roughness: 0.92, metalness: 0.0, color: 0x1a1a20 });
const matFloor = new THREE.MeshStandardMaterial({ map: floorTex, roughness: 0.85, metalness: 0.12, color: 0x111116, envMapIntensity: 0.3 });
const matCeil = new THREE.MeshStandardMaterial({ roughness: 0.97, metalness: 0, color: 0x0d0d10 });

function addBox(x, y, z, w, h, d, mat, castShadow = true) {
    const geo = new THREE.BoxGeometry(w, h, d);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(x, y, z);
    mesh.castShadow = castShadow;
    mesh.receiveShadow = true;
    scene.add(mesh);
    return mesh;
}

function addFlickerLight(x, z, color = 0xff8833, intensity = 40) {
    const light = new THREE.PointLight(color, intensity, 9, 2);
    light.position.set(x, CEIL_H - 0.5, z);
    light.castShadow = false; // too many shadow-casting lights = slow
    scene.add(light);
    lightList.push({ light, base: intensity, phase: Math.random() * Math.PI * 2, amp: intensity * (0.3 + Math.random() * 0.35) });
}

function buildRoom(room) {
    const { cx, cz, w, d } = room;
    const hw = w / 2, hd = d / 2;

    // Floor
    const floorMesh = addBox(cx, 0, cz, w, 0.2, d, matFloor, false);
    floorMesh.receiveShadow = true;
    // Ceiling
    addBox(cx, CEIL_H, cz, w, 0.2, d, matCeil, false);
    // Walls (4 sides, with openings handled later by trimming)
    walls.push({ minX: cx - hw - WALL_T, maxX: cx - hw, minZ: cz - hd, maxZ: cz + hd });
    walls.push({ minX: cx + hw, maxX: cx + hw + WALL_T, minZ: cz - hd, maxZ: cz + hd });
    walls.push({ minX: cx - hw, maxX: cx + hw, minZ: cz - hd - WALL_T, maxZ: cz - hd });
    walls.push({ minX: cx - hw, maxX: cx + hw, minZ: cz + hd, maxZ: cz + hd + WALL_T });

    // Light inside room
    addFlickerLight(cx, cz);
    if (w > 10) {
        addFlickerLight(cx - 3, cz - 3, 0xff7722, 28);
        addFlickerLight(cx + 3, cz + 3, 0xff9944, 22);
    }
}

function buildCorridor(rA, rB) {
    const A = ROOMS[rA], B = ROOMS[rB];
    const CW = 2.6; // corridor width
    // Determine axis
    const dx = B.cx - A.cx, dz = B.cz - A.cz;

    if (Math.abs(dx) > Math.abs(dz)) {
        // horizontal corridor (X axis)
        const x0 = A.cx + (dx > 0 ? A.w / 2 : -A.w / 2);
        const x1 = B.cx + (dx > 0 ? -B.w / 2 : B.w / 2);
        const cx = (x0 + x1) / 2, len = Math.abs(x1 - x0);
        const cz = A.cz;
        addBox(cx, 0, cz, len, 0.2, CW, matFloor, false).receiveShadow = true;
        addBox(cx, CEIL_H, cz, len, 0.2, CW, matCeil, false);
        // Corridor walls
        addBox(cx, CEIL_H / 2, cz - CW / 2, len, CEIL_H, WALL_T, matWall);
        addBox(cx, CEIL_H / 2, cz + CW / 2, len, CEIL_H, WALL_T, matWall);
        walls.push({ minX: Math.min(x0,x1), maxX: Math.max(x0,x1), minZ: cz - CW/2 - WALL_T, maxZ: cz - CW/2 });
        walls.push({ minX: Math.min(x0,x1), maxX: Math.max(x0,x1), minZ: cz + CW/2, maxZ: cz + CW/2 + WALL_T });
        addFlickerLight(cx, cz, 0xff6622, 0.4);
    } else {
        // vertical corridor (Z axis)
        const z0 = A.cz + (dz > 0 ? A.d / 2 : -A.d / 2);
        const z1 = B.cz + (dz > 0 ? -B.d / 2 : B.d / 2);
        const cz2 = (z0 + z1) / 2, len = Math.abs(z1 - z0);
        const cx = A.cx;
        addBox(cx, 0, cz2, CW, 0.2, len, matFloor, false).receiveShadow = true;
        addBox(cx, CEIL_H, cz2, CW, 0.2, len, matCeil, false);
        addBox(cx - CW / 2, CEIL_H / 2, cz2, WALL_T, CEIL_H, len, matWall);
        addBox(cx + CW / 2, CEIL_H / 2, cz2, WALL_T, CEIL_H, len, matWall);
        walls.push({ minX: cx - CW/2 - WALL_T, maxX: cx - CW/2, minZ: Math.min(z0,z1), maxZ: Math.max(z0,z1) });
        walls.push({ minX: cx + CW/2, maxX: cx + CW/2 + WALL_T, minZ: Math.min(z0,z1), maxZ: Math.max(z0,z1) });
        addFlickerLight(cx, cz2, 0xff6622, 20);
    }
}

// Each room side wall, cut with door opening per corridor
function buildRoomWalls(roomIdx) {
    const R = ROOMS[roomIdx];
    const hw = R.w / 2, hd = R.d / 2;

    // Find connected corridors to cut openings
    const connected = CORRIDORS.filter(([a, b]) => a === roomIdx || b === roomIdx);

    function openings(axis, side) {
        // Returns list of centre positions that need openings on this side
        const CW = 2.6;
        const opens = [];
        for (const [a, b] of connected) {
            const other = ROOMS[a === roomIdx ? b : a];
            if (axis === 'x') {
                // left (x = -hw) or right (x = +hw)
                const isLeft = other.cx < R.cx;
                if ((side === 'left' && isLeft) || (side === 'right' && !isLeft)) {
                    if (Math.abs(other.cz - R.cz) < 1) opens.push(other.cz);
                    else if (Math.abs(other.cx - R.cx) > 1) opens.push(R.cz); // corridor runs Z
                }
            } else {
                const isBack = other.cz < R.cz;
                if ((side === 'back' && isBack) || (side === 'front' && !isBack)) {
                    if (Math.abs(other.cx - R.cx) < 1) opens.push(other.cx);
                }
            }
        }
        return opens;
    }

    const CW = 2.6, OD = 0.3;
    // Helper: build a wall segment with an opening cutout
    function wallWithOpening(cx, cy, cz, tw, th, td, openCenters, openAxis) {
        if (openCenters.length === 0) {
            addBox(cx, cy, cz, tw, th, td, matWall);
            return;
        }
        // Build segments around each opening
        const isX = openAxis === 'x';
        const totalLen = isX ? tw : td;
        const centres = [...openCenters].sort((a, b) => a - b);
        let prev = isX ? cx - tw / 2 : cz - td / 2;
        for (const oc of centres) {
            const segEnd = oc - CW / 2;
            const segLen = segEnd - prev;
            if (segLen > 0.05) {
                const segCentre = prev + segLen / 2;
                if (isX) addBox(segCentre, cy, cz, segLen, th, td, matWall);
                else addBox(cx, cy, segCentre, tw, th, segLen, matWall);
            }
            // Above opening (door lintel)
            const lH = th - CEIL_H * 0.75;
            if (lH > 0.05) {
                if (isX) addBox(oc, cy + (th - lH) / 2, cz, CW, lH, td, matWall);
                else addBox(cx, cy + (th - lH) / 2, oc, tw, lH, CW, matWall);
            }
            prev = oc + CW / 2;
        }
        const finalLen = (isX ? cx + tw / 2 : cz + td / 2) - prev;
        if (finalLen > 0.05) {
            const segCentre = prev + finalLen / 2;
            if (isX) addBox(segCentre, cy, cz, finalLen, th, td, matWall);
            else addBox(cx, cy, segCentre, tw, th, finalLen, matWall);
        }
    }

    const mh = CEIL_H / 2;
    const ops_l = openings('x', 'left'), ops_r = openings('x', 'right');
    const ops_b = openings('z', 'back'), ops_f = openings('z', 'front');

    wallWithOpening(R.cx - hw, mh, R.cz, OD, CEIL_H, R.d + OD * 2, ops_l.length ? [R.cz] : [], 'z');
    wallWithOpening(R.cx + hw, mh, R.cz, OD, CEIL_H, R.d + OD * 2, ops_r.length ? [R.cz] : [], 'z');
    wallWithOpening(R.cx, mh, R.cz - hd, R.w + OD * 2, CEIL_H, OD, ops_b.length ? [R.cx] : [], 'x');
    wallWithOpening(R.cx, mh, R.cz + hd, R.w + OD * 2, CEIL_H, OD, ops_f.length ? [R.cx] : [], 'x');
}

export function buildLevel() {
    walls = [];
    lightList = [];
    ritualMeshes = [];

    // Dim ambient — re-added each time (clearLevel removes it)
    scene.add(new THREE.AmbientLight(0x151520, 0.8));

    for (let i = 0; i < ROOMS.length; i++) {
        buildRoom(ROOMS[i]);
        buildRoomWalls(i);
    }
    for (const [a, b] of CORRIDORS) buildCorridor(a, b);

    // Ritual circles
    const ritualGeo = new THREE.CircleGeometry(0.9, 32);
    for (const rp of RITUAL_POSITIONS) {
        const mat = new THREE.MeshStandardMaterial({
            color: 0x6b4c00, emissive: 0xc8a840, emissiveIntensity: 0.3,
            roughness: 0.5, metalness: 0.2, side: THREE.DoubleSide,
        });
        const mesh = new THREE.Mesh(ritualGeo, mat);
        mesh.rotation.x = -Math.PI / 2;
        mesh.position.set(rp.x, 0.12, rp.z);
        mesh.receiveShadow = true;
        scene.add(mesh);
        ritualMeshes.push(mesh);

        // Candle-like light above
        const rLight = new THREE.PointLight(0xc8a840, 25, 5, 2);
        rLight.position.set(rp.x, 1.5, rp.z);
        scene.add(rLight);
        lightList.push({ light: rLight, base: 25, phase: Math.random() * Math.PI * 2, amp: 12 });
    }

    // Exit door
    const exitR = ROOMS[5];
    const exitMat = new THREE.MeshStandardMaterial({ color: 0x001a00, emissive: 0x003300, emissiveIntensity: 0.4, roughness: 0.3 });
    exitMesh = addBox(exitR.cx, CEIL_H / 2 - 0.5, exitR.cz, 2, CEIL_H - 0.5, 0.3, exitMat);
    const exitLight = new THREE.PointLight(0x00ff44, 20, 6, 2);
    exitLight.position.set(exitR.cx, 2, exitR.cz);
    scene.add(exitLight);
    lightList.push({ light: exitLight, base: 20, phase: 0, amp: 5 });

    // Build monster
    buildMonster();
}

export function getWalls() { return walls; }

// ── Monster ───────────────────────────────────────────────────────────────
function buildMonster() {
    if (monsterMesh) scene.remove(monsterMesh);
    monsterEyes = [];
    monsterEyeMeshes = [];

    const root = new THREE.Group();

    const dark = new THREE.MeshStandardMaterial({ color: 0x080808, roughness: 0.25, metalness: 0.5 });
    const eyeMat = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xffffff, emissiveIntensity: 2.5, roughness: 0 });

    // Body — tall thin tapered cylinder
    const bodyGeo = new THREE.CylinderGeometry(0.12, 0.18, 3.4, 8);
    const body = new THREE.Mesh(bodyGeo, dark);
    body.castShadow = true;
    body.position.y = 1.7;
    root.add(body);

    // Neck
    const neckGeo = new THREE.CylinderGeometry(0.08, 0.12, 0.3, 8);
    const neck = new THREE.Mesh(neckGeo, dark);
    neck.castShadow = true;
    neck.position.y = 3.55;
    root.add(neck);

    // Head — elongated sphere
    const headGeo = new THREE.SphereGeometry(0.32, 12, 8);
    const head = new THREE.Mesh(headGeo, dark);
    head.castShadow = true;
    head.scale.y = 1.35;
    head.position.y = 4.0;
    root.add(head);

    // Eyes
    const eyeGeo = new THREE.SphereGeometry(0.065, 8, 6);
    for (const ex of [-0.12, 0.12]) {
        const eye = new THREE.Mesh(eyeGeo, eyeMat);
        eye.position.set(ex, 4.02, 0.28);
        root.add(eye);
        monsterEyeMeshes.push(eye);

        const light = new THREE.PointLight(0xffffff, 8, 3, 2);
        light.position.copy(eye.position);
        root.add(light);
        monsterEyes.push(light);
    }

    // Arms — unnaturally long, hanging at sides
    const armGeo = new THREE.CylinderGeometry(0.05, 0.04, 2.2, 6);
    for (const sign of [-1, 1]) {
        const arm = new THREE.Mesh(armGeo, dark);
        arm.castShadow = true;
        arm.position.set(sign * 0.22, 2.2, 0);
        arm.rotation.z = sign * 0.18;
        root.add(arm);
    }

    // Eerie aura (transparent disc at base)
    const auraGeo = new THREE.CircleGeometry(1.2, 24);
    const auraMat = new THREE.MeshBasicMaterial({ color: 0x220000, transparent: true, opacity: 0.25, side: THREE.DoubleSide });
    const aura = new THREE.Mesh(auraGeo, auraMat);
    aura.rotation.x = -Math.PI / 2;
    aura.position.y = 0.05;
    root.add(aura);

    root.visible = false; // hidden until game starts
    scene.add(root);
    monsterMesh = root;
}

export function setMonsterState(x, z, yaw, frozen) {
    if (!monsterMesh) return;
    monsterMesh.visible = true;
    monsterMesh.position.x += (x - monsterMesh.position.x) * 0.18;
    monsterMesh.position.z += (z - monsterMesh.position.z) * 0.18;
    monsterMesh.position.y = 0;
    const targetYaw = yaw || 0;
    // Smooth yaw
    let dy = targetYaw - monsterMesh.rotation.y;
    while (dy > Math.PI) dy -= Math.PI * 2;
    while (dy < -Math.PI) dy += Math.PI * 2;
    monsterMesh.rotation.y += dy * 0.15;
    M.frozen = frozen;
}

export function hideMonster() {
    if (monsterMesh) monsterMesh.visible = false;
}

// ── Ritual helpers ────────────────────────────────────────────────────────
export function setRitualDone(idx) {
    const m = ritualMeshes[idx];
    if (!m) return;
    m.material.emissive.setHex(0xffd700);
    m.material.emissiveIntensity = 1.2;
    m.material.color.setHex(0x3a2a00);
}

export function unlockExit() {
    if (!exitMesh) return;
    exitMesh.material.emissive.setHex(0x00ff44);
    exitMesh.material.emissiveIntensity = 2.5;
    exitMesh.material.color.setHex(0x002200);
    // Bright exit light
    const exitR = ROOMS[5];
    const bigLight = new THREE.PointLight(0x00ff88, 200, 14, 1.5);
    bigLight.position.set(exitR.cx, 2.5, exitR.cz);
    scene.add(bigLight);
}

// ── Player models ─────────────────────────────────────────────────────────
const PLAYER_COLORS = ['#e0584f','#3b82f6','#2ec495','#f2c14e','#a78bfa','#f97316','#ec4899','#e2e8f0'];

export function addPlayerModel(id, colorHex) {
    const geo = new THREE.CapsuleGeometry(0.28, 1.0, 4, 8);
    const mat = new THREE.MeshStandardMaterial({
        color: new THREE.Color(colorHex || '#888'), transparent: true, opacity: 0.45,
        roughness: 0.7, metalness: 0, emissive: new THREE.Color(colorHex || '#888'), emissiveIntensity: 0.15,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.castShadow = false;
    mesh.position.y = 1.0;
    scene.add(mesh);
    playerModels.set(id, mesh);
    return mesh;
}

export function setPlayerPos(id, x, z, yaw) {
    const m = playerModels.get(id);
    if (!m) return;
    m.position.x += (x - m.position.x) * 0.2;
    m.position.z += (z - m.position.z) * 0.2;
    m.rotation.y = yaw;
    m.visible = true;
}

export function removePlayerModel(id) {
    const m = playerModels.get(id);
    if (m) { scene.remove(m); playerModels.delete(id); }
}

export function clearPlayerModels() {
    for (const [, m] of playerModels) scene.remove(m);
    playerModels.clear();
}

// ── Camera control ────────────────────────────────────────────────────────
let headBobT = 0;
export const camState = { x: 0, y: 0, z: 0, pitch: 0, yaw: 0, moving: false };

export function updateCamera(dt) {
    if (camState.moving) headBobT += dt * 7.5;
    else headBobT *= 0.85;
    const bob = Math.sin(headBobT) * 0.045 * Math.min(1, Math.abs(Math.sin(headBobT)));

    camera.position.set(
        camState.x + shake.x,
        camState.y + 1.7 + bob + shake.y,
        camState.z + shake.z
    );
    camera.rotation.order = 'YXZ';
    camera.rotation.y = camState.yaw;
    camera.rotation.x = camState.pitch;
}

export function applyShake(amount) {
    shakeT = Math.max(shakeT, amount);
}

// Slow orbit in start room for menu background
export function updateMenuCamera(t) {
    const angle = t * 0.04;
    const cx = Math.sin(angle) * 4;
    const cz = Math.cos(angle) * 4;
    camera.position.set(cx, 1.7, cz);
    camera.rotation.order = 'YXZ';
    // Always look toward the corridor where monster stands
    const tdx = 8 - cx;
    const tdz = 0 - cz;
    camera.rotation.y = Math.atan2(-tdx, -tdz);
    camera.rotation.x = -0.05;
}

// ── Flashlight battery ────────────────────────────────────────────────────
let flashBattery = 1.0; // 0–1
export function setBatteryLevel(v) {
    flashBattery = Math.max(0, Math.min(1, v));
    if (flashlight) {
        flashlight.intensity = flashBattery > 0.08 ? 180 * flashBattery : 0;
        const temp = 3200 + flashBattery * 1800;
        flashlight.color.setHSL(0.08, 0.4 + flashBattery * 0.3, 0.85 + flashBattery * 0.1);
    }
}
export function getBattery() { return flashBattery; }

// ── Per-frame update ───────────────────────────────────────────────────────
export function update(dt, gameActive) {
    // Flickering lights
    for (const fl of lightList) {
        fl.phase += dt * (0.8 + Math.random() * 1.2);
        const flicker = fl.base + Math.sin(fl.phase * 7.3) * fl.amp * 0.4
                      + Math.sin(fl.phase * 3.1) * fl.amp * 0.6;
        fl.light.intensity = Math.max(0, flicker + (Math.random() < 0.01 ? -flicker * 0.8 : 0));
    }

    // Monster animation
    if (monsterMesh && monsterMesh.visible) {
        M.t += dt;
        M.eyeT += dt;
        if (M.frozen) {
            // Eyes pulse
            const pulse = 0.5 + 0.5 * Math.sin(M.eyeT * 3.5);
            for (const el of monsterEyes) el.intensity = 3 + pulse * 8;
            for (const em of monsterEyeMeshes) {
                em.material.emissiveIntensity = 1.5 + pulse * 2.0;
            }
            // Tremor
            monsterMesh.rotation.z = Math.sin(M.t * 18) * 0.012;
        } else {
            // Moving: eyes flare, subtle hover
            for (const el of monsterEyes) el.intensity = 15 + Math.sin(M.eyeT * 12) * 5;
            for (const em of monsterEyeMeshes) em.material.emissiveIntensity = 3.5;
            monsterMesh.position.y = Math.sin(M.t * 2.5) * 0.04;
            monsterMesh.rotation.z = 0;
        }
    }

    // Camera shake decay
    if (shakeT > 0) {
        shakeT -= dt * 4;
        const s = Math.max(0, shakeT);
        shake.set((Math.random() - 0.5) * s * 0.3, (Math.random() - 0.5) * s * 0.15, 0);
    } else {
        shake.set(0, 0, 0);
    }
}

export function render() {
    renderer.render(scene, camera);
}

export function clearLevel() {
    // Remove all scene objects except camera
    while (scene.children.length > 0) scene.remove(scene.children[0]);
    scene.add(camera);
    const ambient = new THREE.AmbientLight(0x0a0a14, 0.15);
    scene.add(ambient);
    walls = [];
    lightList = [];
    ritualMeshes = [];
    monsterMesh = null;
    monsterEyes = [];
    monsterEyeMeshes = [];
    exitMesh = null;
    playerModels.clear();
}
