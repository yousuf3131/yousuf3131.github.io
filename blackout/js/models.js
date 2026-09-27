// Character models for Blackout: survivors and the hunter, built from primitives, with a
// procedural walk / run / death animation. Models face +Z; rotation.y is the facing angle.

import * as THREE from 'three';
import { fabricTexture, metalTexture } from './textures.js';

let FABRIC = null, METAL = null;
const fabric = () => FABRIC || (FABRIC = fabricTexture());
const metal = () => METAL || (METAL = metalTexture([70, 68, 66]));

const cloth = (color, rough = 0.92) => new THREE.MeshStandardMaterial({ color, map: fabric(), roughness: rough, metalness: 0 });
const solid = (color, rough = 0.7, metalness = 0) => new THREE.MeshStandardMaterial({ color, roughness: rough, metalness });

export const SURVIVOR_LOOKS = [
    { shirt: 0x8a2c2c, pants: 0x2b3440, skin: 0xd6a57c, hair: 0x2a1a10, style: 'short' },
    { shirt: 0x2f5d7c, pants: 0x3a3226, skin: 0x8d5a3b, hair: 0x0d0a08, style: 'long' },
    { shirt: 0x5f6b3a, pants: 0x25282c, skin: 0xf0c8a8, hair: 0xb58a4a, style: 'pony' },
    { shirt: 0xc9b58a, pants: 0x3b2f2a, skin: 0xb07850, hair: 0x1a1210, style: 'cap' },
    { shirt: 0x6a3d7a, pants: 0x1f2a36, skin: 0xe2b490, hair: 0x7a2a14, style: 'long' },
    { shirt: 0xd0d0cc, pants: 0x4a4a52, skin: 0x5c3a26, hair: 0x080606, style: 'short' },
    { shirt: 0xb86a24, pants: 0x2a3a2a, skin: 0xcf9c74, hair: 0x3a2818, style: 'cap' },
];

// A limb that pivots at its top: returns the pivot; the mesh hangs below it
function limb(radius, length, mat, x, y, z) {
    const pivot = new THREE.Group();
    pivot.position.set(x, y, z);
    const m = new THREE.Mesh(new THREE.CapsuleGeometry(radius, length, 4, 10), mat);
    m.position.y = -length / 2 - radius * 0.3;
    m.castShadow = true;
    pivot.add(m);
    pivot.userData.mesh = m;
    return pivot;
}

function shadows(root) { root.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } }); }

export function makeSurvivor(look) {
    const root = new THREE.Group();
    const body = new THREE.Group();          // everything that bobs with the walk
    root.add(body);
    const shirt = cloth(look.shirt), pants = cloth(look.pants), skin = solid(look.skin, 0.6);
    const hairM = solid(look.hair, 0.85), shoe = solid(0x1a1714, 0.8);

    // Legs (pivot at the hip) with shoes
    const legL = limb(0.085, 0.62, pants, -0.11, 0.9, 0), legR = limb(0.085, 0.62, pants, 0.11, 0.9, 0);
    for (const leg of [legL, legR]) {
        const foot = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.08, 0.26), shoe);
        foot.position.set(0, -0.84, 0.05);
        leg.add(foot);
        body.add(leg);
    }
    // Hips and torso
    const hips = new THREE.Mesh(new THREE.CapsuleGeometry(0.15, 0.08, 4, 10), pants);
    hips.position.y = 0.95; hips.scale.set(1.15, 1, 0.8);
    body.add(hips);
    const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.17, 0.38, 4, 12), shirt);
    torso.position.y = 1.25; torso.scale.set(1.15, 1, 0.75);
    body.add(torso);
    // Head, hair, eyes
    const head = new THREE.Group();
    head.position.y = 1.62;
    body.add(head);
    const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.06, 0.12, 8), skin);
    neck.position.y = -0.1;
    head.add(neck);
    const skull = new THREE.Mesh(new THREE.SphereGeometry(0.115, 16, 12), skin);
    skull.scale.set(0.92, 1.08, 1);
    skull.position.y = 0.05;
    head.add(skull);
    const hair = new THREE.Mesh(new THREE.SphereGeometry(0.125, 16, 10, 0, Math.PI * 2, 0, Math.PI * 0.55), hairM);
    hair.position.y = 0.07; hair.rotation.x = -0.25;
    head.add(hair);
    if (look.style === 'long') {
        const back = new THREE.Mesh(new THREE.CapsuleGeometry(0.1, 0.18, 4, 8), hairM);
        back.position.set(0, -0.04, -0.07); back.scale.set(1.2, 1, 0.6);
        head.add(back);
    } else if (look.style === 'pony') {
        const tail = new THREE.Mesh(new THREE.CapsuleGeometry(0.04, 0.16, 4, 6), hairM);
        tail.position.set(0, 0.02, -0.14); tail.rotation.x = 0.5;
        head.add(tail);
    } else if (look.style === 'cap') {
        const capM = solid(look.shirt, 0.8);
        const cap = new THREE.Mesh(new THREE.SphereGeometry(0.128, 16, 8, 0, Math.PI * 2, 0, Math.PI * 0.5), capM);
        cap.position.y = 0.08;
        head.add(cap);
        const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.015, 16, 1, false, -Math.PI / 2, Math.PI), capM);
        brim.position.set(0, 0.09, 0.1); brim.scale.set(1, 1, 1.1);
        head.add(brim);
    }
    const eyeM = solid(0x111111, 0.3);
    for (const s of [-1, 1]) {
        const eye = new THREE.Mesh(new THREE.SphereGeometry(0.014, 6, 6), eyeM);
        eye.position.set(s * 0.04, 0.06, 0.1);
        head.add(eye);
    }
    // Arms: the right one holds the flashlight out in front
    const armL = limb(0.055, 0.5, shirt, -0.26, 1.45, 0), armR = limb(0.055, 0.5, shirt, 0.26, 1.45, 0);
    for (const arm of [armL, armR]) {
        const hand = new THREE.Mesh(new THREE.SphereGeometry(0.05, 8, 8), skin);
        hand.position.y = -0.62;
        arm.add(hand);
        body.add(arm);
    }
    const torch = new THREE.Group();
    torch.position.set(0, -0.64, 0.02);
    torch.rotation.x = Math.PI / 2;           // arm points forward, so the torch points forward too
    const tube = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.024, 0.24, 10), new THREE.MeshStandardMaterial({ color: 0x2a2a2e, roughness: 0.35, metalness: 0.8 }));
    tube.rotation.x = -Math.PI / 2; tube.position.z = 0.06;
    torch.add(tube);
    const lensMat = new THREE.MeshBasicMaterial({ color: 0xfff2d8 });
    const lens = new THREE.Mesh(new THREE.CircleGeometry(0.03, 12), lensMat);
    lens.position.z = 0.185;
    torch.add(lens);
    armR.add(torch);
    const tip = new THREE.Object3D();          // where the beam starts (world position used for the spotlight)
    tip.position.z = 0.19;
    torch.add(tip);

    shadows(root);
    lens.castShadow = false;
    root.userData = { kind: 'survivor', body, legL, legR, armL, armR, head, torso, tip, lensMat, phase: Math.random() * 6, dead: 0, height: 1.75 };
    return root;
}

export function makeHunter() {
    const root = new THREE.Group();
    const body = new THREE.Group();
    root.add(body);
    body.scale.setScalar(1.14);
    const coat = cloth(0x1c1a18, 0.95), pants = cloth(0x141416), boots = solid(0x0e0c0a, 0.7);
    const skin = solid(0x8a7a6a, 0.8);

    const legL = limb(0.095, 0.62, pants, -0.12, 0.9, 0), legR = limb(0.095, 0.62, pants, 0.12, 0.9, 0);
    for (const leg of [legL, legR]) {
        const foot = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.12, 0.3), boots);
        foot.position.set(0, -0.82, 0.05);
        leg.add(foot);
        body.add(leg);
    }
    // Long coat: a flared skirt below a heavy torso
    const skirt = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.36, 0.75, 14, 1, true), coat);
    skirt.material.side = THREE.DoubleSide;
    skirt.position.y = 0.72;
    body.add(skirt);
    const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.2, 0.42, 4, 12), coat);
    torso.position.y = 1.25; torso.scale.set(1.2, 1, 0.8);
    body.add(torso);
    // Head: a hood around a pale cracked mask with glowing eyes
    const head = new THREE.Group();
    head.position.y = 1.64;
    body.add(head);
    const hood = new THREE.Mesh(new THREE.SphereGeometry(0.15, 16, 12), coat);
    hood.scale.set(1, 1.1, 1.05); hood.position.set(0, 0.04, -0.02);
    head.add(hood);
    const maskTex = (() => {
        const c = document.createElement('canvas'); c.width = 128; c.height = 128;
        const g = c.getContext('2d');
        g.fillStyle = '#d8d2c2'; g.fillRect(0, 0, 128, 128);
        for (let i = 0; i < 400; i++) { g.fillStyle = `rgba(90,80,60,${Math.random() * 0.12})`; g.fillRect(Math.random() * 128, Math.random() * 128, 3, 3); }
        g.strokeStyle = 'rgba(40,30,25,0.8)'; g.lineWidth = 1.2;
        g.beginPath(); g.moveTo(70, 10); g.lineTo(62, 40); g.lineTo(74, 58); g.lineTo(66, 90); g.stroke();
        g.fillStyle = 'rgba(100,10,10,0.55)'; g.beginPath(); g.ellipse(40, 100, 14, 8, 0.4, 0, Math.PI * 2); g.fill();
        g.fillStyle = '#050404';
        g.beginPath(); g.ellipse(44, 56, 11, 8, -0.2, 0, Math.PI * 2); g.fill();
        g.beginPath(); g.ellipse(84, 56, 11, 8, 0.2, 0, Math.PI * 2); g.fill();
        for (let i = 0; i < 6; i++) { g.beginPath(); g.arc(50 + i * 6, 96, 1.5, 0, Math.PI * 2); g.fill(); }
        const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
    })();
    const mask = new THREE.Mesh(new THREE.SphereGeometry(0.125, 20, 14, -Math.PI / 2 - 1.1, 2.2, 0.35, 2.3), new THREE.MeshStandardMaterial({ map: maskTex, roughness: 0.55 }));
    mask.rotation.y = Math.PI;
    mask.position.set(0, 0.03, 0.035);
    mask.scale.set(1, 1.15, 1);
    head.add(mask);
    // Eye glow is a bright unlit colour so the bloom pass picks it up in the dark
    const eyeM = new THREE.MeshBasicMaterial({ color: 0xff2a1a });
    for (const s of [-1, 1]) {
        const eye = new THREE.Mesh(new THREE.SphereGeometry(0.012, 6, 6), eyeM);
        eye.position.set(s * 0.042, 0.06, 0.14);
        head.add(eye);
    }
    // Arms both reach forward to hold the shotgun
    const armL = limb(0.065, 0.5, coat, -0.3, 1.45, 0), armR = limb(0.065, 0.5, coat, 0.3, 1.45, 0);
    for (const arm of [armL, armR]) {
        const hand = new THREE.Mesh(new THREE.SphereGeometry(0.055, 8, 8), skin);
        hand.position.y = -0.62;
        arm.add(hand);
        body.add(arm);
    }
    const gun = new THREE.Group();
    gun.position.set(0.1, 1.05, 0.3);
    const steel = new THREE.MeshStandardMaterial({ map: metal(), color: 0x6a6a70, roughness: 0.35, metalness: 0.85 });
    const wood = solid(0x4a2c18, 0.6);
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.75, 10), steel);
    barrel.rotation.x = Math.PI / 2; barrel.position.set(0, 0.03, 0.3);
    gun.add(barrel);
    const barrel2 = barrel.clone(); barrel2.position.y = -0.015; gun.add(barrel2);
    const pump = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.2, 10), wood);
    pump.rotation.x = Math.PI / 2; pump.position.set(0, -0.01, 0.2);
    gun.add(pump);
    const receiver = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.09, 0.22), steel);
    receiver.position.set(0, 0.01, -0.08);
    gun.add(receiver);
    const stock = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.1, 0.34), wood);
    stock.position.set(0, -0.04, -0.34); stock.rotation.x = 0.18;
    gun.add(stock);
    body.add(gun);
    const muzzle = new THREE.Object3D();
    muzzle.position.set(0, 0.02, 0.7);
    gun.add(muzzle);

    shadows(root);
    // Each hand holds a point on the gun: trigger grip and pump. Shielding the eyes when blinded.
    const grips = { R: new THREE.Vector3(0.1, 1.06, 0.22), L: new THREE.Vector3(0.1, 1.04, 0.5) };
    const shield = { R: new THREE.Vector3(0.1, 1.66, 0.2), L: new THREE.Vector3(-0.1, 1.68, 0.22) };
    root.userData = { kind: 'hunter', body, legL, legR, armL, armR, head, torso, gun, muzzle, eyeM, grips, shield, phase: 0, dead: 0, recoil: 0, height: 2.0 };
    return root;
}

const DOWN = new THREE.Vector3(0, -1, 0), ARM_T = new THREE.Vector3();

// Advance a model's animation. speed in m/s.
export function animate(model, dt, speed, opts = {}) {
    const u = model.userData;
    if (u.dead > 0) {
        // Topple over, then settle
        u.dead = Math.min(1, u.dead + dt * 2.2);
        const e = 1 - Math.pow(1 - u.dead, 3);
        u.body.rotation.x = -e * Math.PI / 2 * 0.98;
        u.body.position.y = e * 0.12;
        u.legL.rotation.x = e * 0.3; u.legR.rotation.x = -e * 0.2;
        u.armL.rotation.x = -e * 2.6; u.armR.rotation.x = -e * 2.2;
        return;
    }
    const moving = speed > 0.3;
    const run = Math.min(1, Math.max(0, (speed - 4.5) / 2));
    const stride = moving ? 0.45 + run * 0.35 : 0;
    u.phase += dt * (moving ? 2.2 + speed * 1.25 : 1.2);
    const s = Math.sin(u.phase), c = Math.cos(u.phase);
    const k = 1 - Math.exp(-14 * dt);
    const toward = (obj, axis, v) => { obj.rotation[axis] += (v - obj.rotation[axis]) * k; };
    toward(u.legL, 'x', s * stride);
    toward(u.legR, 'x', -s * stride);
    u.body.position.y = moving ? Math.abs(c) * (0.04 + run * 0.05) : Math.sin(u.phase) * 0.006;
    toward(u.body, 'x', run * 0.18 + (opts.stunned ? 0.35 : 0));
    if (u.kind === 'survivor') {
        toward(u.armL, 'x', -s * stride * 1.1 - run * 0.4);
        // Torch arm points forward; lowered and swinging a little when the light is off
        const aim = opts.lightOn ? -1.45 : -0.35 + s * stride * 0.6;
        toward(u.armR, 'x', aim);
        toward(u.armR, 'z', opts.lightOn ? -0.08 : 0);
        u.head.rotation.y = opts.look || 0;
    } else {
        u.recoil = Math.max(0, u.recoil - dt * 5);
        const sway = moving ? s * 0.06 : 0;
        u.stunK = (u.stunK || 0) + ((opts.stunned ? 1 : 0) - (u.stunK || 0)) * k;
        u.gun.rotation.x = -u.recoil * 0.6 + u.stunK * 1.1;
        u.gun.position.set(0.1, 1.05 - u.stunK * 0.25, 0.3 - u.recoil * 0.12);
        u.gun.rotation.y = sway;
        for (const side of ['R', 'L']) {
            const arm = side === 'R' ? u.armR : u.armL;
            ARM_T.copy(u.grips[side]).lerp(u.shield[side], u.stunK);
            ARM_T.z -= u.recoil * 0.12; ARM_T.y += u.recoil * 0.05;
            ARM_T.sub(arm.position);
            const len = ARM_T.length();
            arm.quaternion.setFromUnitVectors(DOWN, ARM_T.normalize());
            arm.scale.y = Math.min(1.35, len / 0.64);
        }
        u.head.rotation.x = u.stunK * (0.45 + Math.sin(u.phase * 4) * 0.1);
    }
}
