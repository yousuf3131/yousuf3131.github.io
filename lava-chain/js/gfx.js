// Lava Chain — gfx.js  (Three.js r0.169 physical lights)
import * as THREE from 'three';

let renderer, scene, camera;
let lavaPlane, lavaParticles = [], lavaParticleSys;
let chainMesh = null;
const playerMeshes = new Map(); // id → { group, body, head }
const platformMeshes = new Map(); // idx → mesh
let crackOverlays = new Map(); // idx → mesh (red crack overlay)
let ambientLight;
let skyBg;

// ── Constants ──────────────────────────────────────────────────────────────
export const GRAVITY        = -22;
export const JUMP_FORCE     = 11;
export const PLAYER_SPEED   = 7.5;
export const PLAYER_H       = 1.0;  // half-height of capsule body
export const PLAYER_R       = 0.35; // radius

export const CHAIN_MAX      = 9.0;  // metres before spring kicks in
export const CHAIN_SPRING   = 14;   // spring constant (N/kg)
export const CHAIN_DAMP     = 0.55; // velocity damping when stretched

export const LAVA_START_Y   = -6;
export const LAVA_RISE_BASE = 0.28; // m/s

// Platform layout definition — exported so main.js can use for collision
export let PLATFORMS = [];

export function buildPlatforms() {
    PLATFORMS = [];
    // Ground platform (wide, safe)
    PLATFORMS.push({ idx: 0, x: 0, y: 0, z: 0,  w: 14, d: 14, type: 'solid' });

    // Tier 1
    PLATFORMS.push({ idx: 1,  x: -8,  y: 3.5,  z:  3,  w: 5, d: 5, type: 'solid' });
    PLATFORMS.push({ idx: 2,  x:  8,  y: 3.5,  z: -3,  w: 5, d: 5, type: 'solid' });
    PLATFORMS.push({ idx: 3,  x:  0,  y: 4.5,  z: -9,  w: 5, d: 5, type: 'crumble' });
    PLATFORMS.push({ idx: 4,  x:  0,  y: 4.5,  z:  9,  w: 5, d: 5, type: 'crumble' });

    // Tier 2
    PLATFORMS.push({ idx: 5,  x: -12, y: 8,    z:  0,  w: 5, d: 4, type: 'solid' });
    PLATFORMS.push({ idx: 6,  x:  12, y: 8,    z:  0,  w: 5, d: 4, type: 'solid' });
    PLATFORMS.push({ idx: 7,  x:  0,  y: 9,    z: -6,  w: 4, d: 5, type: 'crumble' });
    PLATFORMS.push({ idx: 8,  x:  6,  y: 8.5,  z:  6,  w: 4, d: 4, type: 'solid' });
    PLATFORMS.push({ idx: 9,  x: -6,  y: 9,    z:  6,  w: 4, d: 4, type: 'crumble' });

    // Tier 3
    PLATFORMS.push({ idx: 10, x: -9,  y: 13,   z: -4,  w: 4, d: 4, type: 'solid' });
    PLATFORMS.push({ idx: 11, x:  9,  y: 13,   z:  4,  w: 4, d: 4, type: 'solid' });
    PLATFORMS.push({ idx: 12, x:  0,  y: 14,   z:  0,  w: 5, d: 5, type: 'solid' });
    PLATFORMS.push({ idx: 13, x: -4,  y: 13.5, z:  8,  w: 3.5, d: 3.5, type: 'crumble' });
    PLATFORMS.push({ idx: 14, x:  4,  y: 13.5, z: -8,  w: 3.5, d: 3.5, type: 'crumble' });

    // Tier 4
    PLATFORMS.push({ idx: 15, x: -11, y: 18,   z:  5,  w: 4, d: 4, type: 'solid' });
    PLATFORMS.push({ idx: 16, x:  11, y: 18,   z: -5,  w: 4, d: 4, type: 'solid' });
    PLATFORMS.push({ idx: 17, x:  0,  y: 18.5, z: -9,  w: 3.5, d: 3.5, type: 'crumble' });
    PLATFORMS.push({ idx: 18, x:  0,  y: 19,   z:  9,  w: 3.5, d: 3.5, type: 'crumble' });

    // Tier 5
    PLATFORMS.push({ idx: 19, x: -6,  y: 23,   z:  0,  w: 4, d: 4, type: 'solid' });
    PLATFORMS.push({ idx: 20, x:  6,  y: 23,   z:  0,  w: 4, d: 4, type: 'solid' });
    PLATFORMS.push({ idx: 21, x:  0,  y: 24,   z: -5,  w: 3.5, d: 3.5, type: 'crumble' });

    // Tier 6 (near top)
    PLATFORMS.push({ idx: 22, x: -8,  y: 28,   z: -4,  w: 4, d: 4, type: 'solid' });
    PLATFORMS.push({ idx: 23, x:  8,  y: 28,   z:  4,  w: 4, d: 4, type: 'solid' });
    PLATFORMS.push({ idx: 24, x:  0,  y: 29.5, z:  0,  w: 5, d: 5, type: 'solid' }); // summit
}

// ── Init ───────────────────────────────────────────────────────────────────
export function init(canvas) {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    renderer.setSize(innerWidth, innerHeight);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.1;

    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0d0200);
    scene.fog = new THREE.FogExp2(0x1a0500, 0.028);

    camera = new THREE.PerspectiveCamera(70, innerWidth / innerHeight, 0.1, 200);
    camera.position.set(0, 18, 22);
    camera.lookAt(0, 10, 0);

    window.addEventListener('resize', () => {
        renderer.setSize(innerWidth, innerHeight);
        camera.aspect = innerWidth / innerHeight;
        camera.updateProjectionMatrix();
    });
}

// ── Build level ────────────────────────────────────────────────────────────
export function buildLevel() {
    // Ambient
    ambientLight = new THREE.AmbientLight(0x1a0800, 1.2);
    scene.add(ambientLight);

    // Directional from below (lava glow)
    const lavaGlow = new THREE.DirectionalLight(0xff3300, 3);
    lavaGlow.position.set(0, -1, 0);
    scene.add(lavaGlow);

    // Platforms
    buildPlatforms();
    for (const plat of PLATFORMS) {
        _buildPlatformMesh(plat);
    }

    // Lava plane
    const lavGeo = new THREE.PlaneGeometry(120, 120, 32, 32);
    const lavMat = new THREE.MeshStandardMaterial({
        color: 0xff2200, emissive: 0xff2200, emissiveIntensity: 2.5,
        roughness: 0.8, metalness: 0.1,
    });
    lavaPlane = new THREE.Mesh(lavGeo, lavMat);
    lavaPlane.rotation.x = -Math.PI / 2;
    lavaPlane.position.y = LAVA_START_Y;
    scene.add(lavaPlane);

    // Lava point light (moves with lava)
    const lavLight = new THREE.PointLight(0xff4400, 80, 30, 1.5);
    lavLight.position.set(0, LAVA_START_Y + 1, 0);
    lavaPlane.add(lavLight);

    // Lava particles (floating embers)
    _buildLavaParticles();

    // Sky glow (top)
    const skyGeo = new THREE.SphereGeometry(90, 16, 8);
    const skyMat = new THREE.MeshBasicMaterial({
        color: 0x1a0400, side: THREE.BackSide,
    });
    skyBg = new THREE.Mesh(skyGeo, skyMat);
    scene.add(skyBg);
}

function _buildPlatformMesh(plat) {
    const h = 0.55;
    const geo = new THREE.BoxGeometry(plat.w, h, plat.d);

    // Procedural stone texture via canvas
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 128;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#1a1210';
    ctx.fillRect(0, 0, 128, 128);
    // cracks / grain
    for (let i = 0; i < 80; i++) {
        ctx.strokeStyle = `rgba(${50 + Math.random()*30},${20+Math.random()*15},${10+Math.random()*10},0.6)`;
        ctx.lineWidth = Math.random() * 1.5;
        ctx.beginPath();
        ctx.moveTo(Math.random()*128, Math.random()*128);
        ctx.lineTo(Math.random()*128, Math.random()*128);
        ctx.stroke();
    }
    const tex = new THREE.CanvasTexture(canvas);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(plat.w / 2.5, plat.d / 2.5);

    // Emissive glow for crumble platforms (dark orange hint)
    const isC = plat.type === 'crumble';
    const mat = new THREE.MeshStandardMaterial({
        map: tex, roughness: 0.88, metalness: 0.08,
        emissive: isC ? new THREE.Color(0x3a1800) : new THREE.Color(0x000000),
        emissiveIntensity: isC ? 0.4 : 0,
    });

    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(plat.x, plat.y - h / 2, plat.z);
    mesh.castShadow = true; mesh.receiveShadow = true;
    scene.add(mesh);
    platformMeshes.set(plat.idx, mesh);

    // Under-glow for each platform
    const pLight = new THREE.PointLight(0xff2200, isC ? 6 : 4, 5, 2);
    pLight.position.set(plat.x, plat.y - h, plat.z);
    scene.add(pLight);
}

function _buildLavaParticles() {
    const geo = new THREE.BufferGeometry();
    const N = 200;
    const pos = new Float32Array(N * 3);
    for (let i = 0; i < N; i++) {
        pos[i*3]   = (Math.random() - 0.5) * 50;
        pos[i*3+1] = LAVA_START_Y + Math.random() * 4;
        pos[i*3+2] = (Math.random() - 0.5) * 50;
    }
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const mat = new THREE.PointsMaterial({
        color: 0xff6600, size: 0.18,
        transparent: true, opacity: 0.85,
        sizeAttenuation: true,
    });
    lavaParticleSys = new THREE.Points(geo, mat);
    scene.add(lavaParticleSys);
    lavaParticles = pos;
}

// ── Clear level ────────────────────────────────────────────────────────────
export function clearLevel() {
    // Remove everything except camera
    const toRemove = [];
    scene.traverse(obj => { if (obj !== scene) toRemove.push(obj); });
    toRemove.forEach(o => scene.remove(o));
    platformMeshes.clear();
    crackOverlays.clear();
    lavaPlane = null;
    lavaParticleSys = null;
    skyBg = null;
}

// ── Set lava height ────────────────────────────────────────────────────────
export function setLavaY(y) {
    if (!lavaPlane) return;
    lavaPlane.position.y = y;
    // Animate particle heights
    if (lavaParticleSys) {
        const pos = lavaParticleSys.geometry.attributes.position;
        for (let i = 0; i < pos.count; i++) {
            const t = pos.getY(i);
            if (t < y + 0.2) pos.setY(i, y + Math.random() * 4);
        }
        pos.needsUpdate = true;
    }
}

// ── Platform crumble state ─────────────────────────────────────────────────
export function setPlatformCrumble(idx, phase) {
    // phase: 0=normal, 1=cracking(red), 2=gone
    const mesh = platformMeshes.get(idx);
    if (!mesh) return;
    if (phase === 1) {
        mesh.material.emissive.setHex(0xff2200);
        mesh.material.emissiveIntensity = 1.5;
        // wobble handled in update
        mesh.userData.crumbling = true;
    } else if (phase === 2) {
        mesh.visible = false;
    } else {
        mesh.material.emissive.setHex(0x3a1800);
        mesh.material.emissiveIntensity = 0.4;
        mesh.visible = true;
        mesh.userData.crumbling = false;
    }
}

// ── Player models ──────────────────────────────────────────────────────────
const PLAYER_COLORS = [0xff5500, 0x44aaff, 0xffcc00, 0x88ff44,
                       0xff44bb, 0x00ffcc, 0xaa44ff, 0xff9900];

export function addPlayerModel(id, colorIdx, name) {
    if (playerMeshes.has(id)) return;
    const group = new THREE.Group();

    const bodyGeo = new THREE.CylinderGeometry(PLAYER_R, PLAYER_R * 0.85, PLAYER_H * 2, 12);
    const col = PLAYER_COLORS[colorIdx % PLAYER_COLORS.length];
    const bodyMat = new THREE.MeshStandardMaterial({
        color: col, roughness: 0.45, metalness: 0.25,
        emissive: new THREE.Color(col), emissiveIntensity: 0.35,
    });
    const body = new THREE.Mesh(bodyGeo, bodyMat);
    body.position.y = PLAYER_H;
    body.castShadow = true;
    group.add(body);

    const headGeo = new THREE.SphereGeometry(PLAYER_R * 0.85, 12, 10);
    const head = new THREE.Mesh(headGeo, bodyMat.clone());
    head.position.y = PLAYER_H * 2 + PLAYER_R * 0.8;
    head.castShadow = true;
    group.add(head);

    // Name sprite
    const nameCanvas = document.createElement('canvas');
    nameCanvas.width = 256; nameCanvas.height = 64;
    const nc = nameCanvas.getContext('2d');
    nc.font = 'bold 28px Inter, sans-serif';
    nc.fillStyle = '#ffe0b0';
    nc.textAlign = 'center';
    nc.fillText(name.slice(0, 12), 128, 42);
    const nameTex = new THREE.CanvasTexture(nameCanvas);
    const nameSprite = new THREE.Sprite(new THREE.SpriteMaterial({
        map: nameTex, transparent: true, opacity: 0.85,
        sizeAttenuation: true,
    }));
    nameSprite.scale.set(2.2, 0.55, 1);
    nameSprite.position.y = PLAYER_H * 2 + PLAYER_R * 1.8 + 0.2;
    group.add(nameSprite);

    scene.add(group);
    playerMeshes.set(id, { group, body, head });
}

export function setPlayerPos(id, x, y, z, alive) {
    const m = playerMeshes.get(id);
    if (!m) return;
    m.group.position.set(x, y, z);
    m.group.visible = alive;
    // Running bob (subtle)
    m.head.position.y = PLAYER_H * 2 + PLAYER_R * 0.8 + Math.sin(Date.now() * 0.008) * 0.04;
}

export function removePlayerModel(id) {
    const m = playerMeshes.get(id);
    if (!m) return;
    scene.remove(m.group);
    playerMeshes.delete(id);
}

export function clearPlayerModels() {
    for (const [id] of playerMeshes) removePlayerModel(id);
}

// ── Chain ──────────────────────────────────────────────────────────────────
export function updateChain(ax, ay, az, bx, by, bz, stretch01) {
    // stretch01: 0 = slack, 1 = fully stretched
    if (chainMesh) { scene.remove(chainMesh); chainMesh = null; }

    const start = new THREE.Vector3(ax, ay + PLAYER_H, az);
    const end   = new THREE.Vector3(bx, by + PLAYER_H, bz);
    const dist  = start.distanceTo(end);

    const SEGS = 10;
    const points = [];
    const slack = Math.max(0, CHAIN_MAX - dist) * 0.22; // sag

    for (let i = 0; i <= SEGS; i++) {
        const t = i / SEGS;
        const p = new THREE.Vector3().lerpVectors(start, end, t);
        // Catenary sag
        p.y -= Math.sin(t * Math.PI) * slack;
        points.push(p);
    }

    const path = new THREE.CatmullRomCurve3(points);
    const tubeGeo = new THREE.TubeGeometry(path, SEGS * 2, 0.045, 5, false);
    // Colour: green→yellow→red by stretch
    const r = Math.round(stretch01 * 255);
    const g = Math.round((1 - stretch01) * 220);
    const chainCol = new THREE.Color(r / 255, g / 255, 0);
    const chainMat = new THREE.MeshStandardMaterial({
        color: chainCol, emissive: chainCol, emissiveIntensity: 0.9 + stretch01 * 1.5,
        roughness: 0.4, metalness: 0.6,
    });
    chainMesh = new THREE.Mesh(tubeGeo, chainMat);
    scene.add(chainMesh);
}

export function hideChain() {
    if (chainMesh) { scene.remove(chainMesh); chainMesh = null; }
}

// ── Camera ─────────────────────────────────────────────────────────────────
let camYaw = 0, camPitch = 0.4;
let targetPos = new THREE.Vector3();
let cameraSmooth = new THREE.Vector3();

export function rotateCam(dx, dy) {
    camYaw   -= dx * 0.002;
    camPitch  = Math.max(0.1, Math.min(1.1, camPitch + dy * 0.002));
}

export function updateCamera(followX, followY, followZ, dt) {
    const dist = 14;
    const tx = followX + Math.sin(camYaw) * dist;
    const ty = followY + 10 + camPitch * dist * 0.4;
    const tz = followZ + Math.cos(camYaw) * dist;

    targetPos.set(tx, ty, tz);
    cameraSmooth.lerp(targetPos, Math.min(1, dt * 9));
    camera.position.copy(cameraSmooth);
    camera.lookAt(followX, followY + 2, followZ);
}

export function updateMenuCamera(t) {
    const angle = t * 0.06;
    camera.position.set(
        Math.sin(angle) * 16,
        18 + Math.sin(t * 0.11) * 3,
        Math.cos(angle) * 16
    );
    camera.lookAt(0, 8, 0);
}

// ── Per-frame update ───────────────────────────────────────────────────────
let animT = 0;
export function update(dt) {
    animT += dt;
    // Animate lava surface vertices
    if (lavaPlane) {
        const pos = lavaPlane.geometry.attributes.position;
        for (let i = 0; i < pos.count; i++) {
            const x = pos.getX(i), z = pos.getZ(i);
            pos.setY(i, Math.sin(x * 0.3 + animT * 1.2) * 0.25
                      + Math.cos(z * 0.25 + animT * 0.9) * 0.25);
        }
        pos.needsUpdate = true;
        lavaPlane.material.emissiveIntensity = 2.2 + Math.sin(animT * 3) * 0.4;
    }

    // Animate lava particles
    if (lavaParticleSys) {
        const pos = lavaParticleSys.geometry.attributes.position;
        const lavaY = lavaPlane ? lavaPlane.position.y : LAVA_START_Y;
        for (let i = 0; i < pos.count; i++) {
            pos.setY(i, pos.getY(i) + dt * (0.5 + Math.random() * 1.5));
            if (pos.getY(i) > lavaY + 4) pos.setY(i, lavaY + Math.random() * 0.5);
        }
        pos.needsUpdate = true;
    }

    // Wobble crumbling platforms
    for (const [idx, mesh] of platformMeshes) {
        if (mesh.userData.crumbling) {
            mesh.rotation.z = Math.sin(animT * 18) * 0.025;
            mesh.rotation.x = Math.cos(animT * 14) * 0.015;
        }
    }

    renderer.render(scene, camera);
}

export function getPlayerCamForward() {
    const fwd = new THREE.Vector3(
        -Math.sin(camYaw), 0, -Math.cos(camYaw)
    );
    const right = new THREE.Vector3(
        Math.cos(camYaw), 0, -Math.sin(camYaw)
    );
    return { fwd, right };
}
