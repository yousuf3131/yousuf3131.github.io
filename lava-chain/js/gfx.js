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

    // group = position anchor (never rotated)
    // moveGroup = rotates to face movement direction
    const group = new THREE.Group();
    const moveGroup = new THREE.Group();
    group.add(moveGroup);

    const col = PLAYER_COLORS[colorIdx % PLAYER_COLORS.length];
    const c = new THREE.Color(col);
    const dark = new THREE.Color(c.r * 0.45, c.g * 0.45, c.b * 0.45);
    const accent = new THREE.Color(0x110a04);

    const matMain  = new THREE.MeshStandardMaterial({ color: col,   roughness: 0.5,  metalness: 0.15, emissive: c, emissiveIntensity: 0.18 });
    const matDark  = new THREE.MeshStandardMaterial({ color: dark,  roughness: 0.6,  metalness: 0.1  });
    const matBlack = new THREE.MeshStandardMaterial({ color: accent, roughness: 0.8,  metalness: 0.05 });

    function box(w, h, d, mat, px, py, pz, parent) {
        const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
        m.position.set(px, py, pz);
        m.castShadow = true;
        parent.add(m);
        return m;
    }

    // ── Legs (pivot groups hanging from hip) ──────────────────────────────
    const legLPivot = new THREE.Group(); legLPivot.position.set(-0.17, 0.74, 0); moveGroup.add(legLPivot);
    const legRPivot = new THREE.Group(); legRPivot.position.set( 0.17, 0.74, 0); moveGroup.add(legRPivot);
    box(0.25, 0.74, 0.28, matDark,  0, -0.37, 0, legLPivot);
    box(0.25, 0.74, 0.28, matDark,  0, -0.37, 0, legRPivot);
    // Boots
    box(0.28, 0.18, 0.32, matBlack, 0, -0.77, 0.02, legLPivot);
    box(0.28, 0.18, 0.32, matBlack, 0, -0.77, 0.02, legRPivot);

    // ── Torso ─────────────────────────────────────────────────────────────
    box(0.72, 0.70, 0.46, matMain,  0, 1.09, 0, moveGroup);
    // Belt
    box(0.76, 0.10, 0.48, matBlack, 0, 0.74, 0, moveGroup);

    // ── Arms (pivot groups at shoulder) ───────────────────────────────────
    const armLPivot = new THREE.Group(); armLPivot.position.set(-0.47, 1.36, 0); moveGroup.add(armLPivot);
    const armRPivot = new THREE.Group(); armRPivot.position.set( 0.47, 1.36, 0); moveGroup.add(armRPivot);
    box(0.26, 0.60, 0.30, matDark,  0, -0.30, 0, armLPivot);
    box(0.26, 0.60, 0.30, matDark,  0, -0.30, 0, armRPivot);
    // Gloves
    box(0.28, 0.18, 0.28, matBlack, 0, -0.65, 0, armLPivot);
    box(0.28, 0.18, 0.28, matBlack, 0, -0.65, 0, armRPivot);

    // ── Head ─────────────────────────────────────────────────────────────
    box(0.58, 0.52, 0.54, matMain,  0, 1.65, 0, moveGroup);
    // Visor strip
    const visorMat = new THREE.MeshStandardMaterial({
        color: 0x1a0800, emissive: new THREE.Color(col), emissiveIntensity: 0.6,
        roughness: 0.3, metalness: 0.5,
    });
    box(0.52, 0.18, 0.10, visorMat, 0, 1.62, 0.29, moveGroup);
    // Eyes
    const eyeMat = new THREE.MeshStandardMaterial({
        color: 0xffffff, emissive: new THREE.Color(1, 0.9, 0.5), emissiveIntensity: 2.5,
        roughness: 0.2, metalness: 0,
    });
    const eyeGeo = new THREE.SphereGeometry(0.07, 7, 6);
    const eyeL = new THREE.Mesh(eyeGeo, eyeMat); eyeL.position.set(-0.13, 1.64, 0.30); moveGroup.add(eyeL);
    const eyeR = new THREE.Mesh(eyeGeo, eyeMat); eyeR.position.set( 0.13, 1.64, 0.30); moveGroup.add(eyeR);

    // ── Name label (always faces camera, not in moveGroup) ────────────────
    const nc = document.createElement('canvas');
    nc.width = 256; nc.height = 52;
    const nctx = nc.getContext('2d');
    nctx.font = 'bold 26px Inter, sans-serif';
    nctx.fillStyle = '#ffe0b0';
    nctx.textAlign = 'center';
    nctx.fillText(name.slice(0, 12), 128, 36);
    const nameSprite = new THREE.Sprite(new THREE.SpriteMaterial({
        map: new THREE.CanvasTexture(nc), transparent: true, opacity: 0.9, sizeAttenuation: true,
    }));
    nameSprite.scale.set(2.0, 0.52, 1);
    nameSprite.position.y = 2.25;
    group.add(nameSprite);

    scene.add(group);
    playerMeshes.set(id, {
        group, moveGroup,
        legLPivot, legRPivot, armLPivot, armRPivot,
        moveYaw: 0, walkT: 0,
    });
}

export function setPlayerPos(id, x, y, z, alive, vx, vz) {
    const m = playerMeshes.get(id);
    if (!m) return;
    m.group.position.set(x, y, z);
    m.group.visible = alive;
    if (!alive) return;

    const speed = Math.sqrt((vx||0)*(vx||0) + (vz||0)*(vz||0));

    // Rotate character to face movement direction (smooth)
    if (speed > 0.4) {
        const targetYaw = Math.atan2(vx || 0, vz || 0);
        let diff = targetYaw - m.moveYaw;
        while (diff >  Math.PI) diff -= Math.PI * 2;
        while (diff < -Math.PI) diff += Math.PI * 2;
        m.moveYaw += diff * 0.22;
        m.moveGroup.rotation.y = m.moveYaw;
    }

    // Leg/arm swing animation tied to speed
    const t = Date.now() * 0.0055;
    const amp = Math.min(speed / 7, 1) * 0.55;
    const swing = Math.sin(t * speed * 0.9 + 1) * amp;
    m.legLPivot.rotation.x =  swing;
    m.legRPivot.rotation.x = -swing;
    m.armLPivot.rotation.x = -swing * 0.75;
    m.armRPivot.rotation.x =  swing * 0.75;
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
