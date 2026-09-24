// Visual effects: post-processing (bloom), pooled particles (smoke, sparks, dust, embers, confetti),
// skid marks and slipstream wind streaks. Everything is pooled so nothing is allocated mid-race.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

// ============================================================
// Post-processing
// ============================================================
export function createPost(renderer, scene, camera) {
    const size = renderer.getSize(new THREE.Vector2());
    const target = new THREE.WebGLRenderTarget(size.x * renderer.getPixelRatio(), size.y * renderer.getPixelRatio(), { type: THREE.HalfFloatType, samples: 4 });
    const composer = new EffectComposer(renderer, target);
    composer.addPass(new RenderPass(scene, camera));
    const bloom = new UnrealBloomPass(new THREE.Vector2(size.x, size.y), 0.38, 0.32, 1.25);
    composer.addPass(bloom);
    composer.addPass(new OutputPass());
    return {
        composer, bloom, enabled: true,
        setSize(w, h, pr) {
            composer.setPixelRatio(pr);
            composer.setSize(w, h);
        },
        render() {
            if (this.enabled) composer.render();
            else renderer.render(scene, camera);
        },
    };
}

// ============================================================
// Particles: one draw call per blend mode
// ============================================================
const VERT = `
attribute float aSize;
attribute float aAlpha;
attribute vec3 aColor;
uniform float uScale;
varying vec3 vColor;
varying float vAlpha;
void main() {
    vColor = aColor;
    vAlpha = aAlpha;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = min(aSize * uScale / max(0.1, -mv.z), 320.0);
    gl_Position = projectionMatrix * mv;
}`;
const FRAG = `
uniform float uSoft;
varying vec3 vColor;
varying float vAlpha;
void main() {
    vec2 c = gl_PointCoord - 0.5;
    float d = length(c) * 2.0;
    if (d > 1.0) discard;
    float a = vAlpha * (1.0 - smoothstep(uSoft, 1.0, d));
    gl_FragColor = vec4(vColor, a);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
}`;

export class Particles {
    constructor(scene, max, additive, soft = 0.2) {
        this.max = max;
        this.pos = new Float32Array(max * 3);
        this.vel = new Float32Array(max * 3);
        this.col = new Float32Array(max * 3);
        this.size = new Float32Array(max);
        this.alpha = new Float32Array(max);
        this.life = new Float32Array(max);
        this.maxLife = new Float32Array(max);
        this.grow = new Float32Array(max);
        this.a0 = new Float32Array(max);
        this.grav = new Float32Array(max);
        this.drag = new Float32Array(max);
        this.next = 0;
        this.budget = 1;   // emit fewer particles on low quality
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
        g.setAttribute('aColor', new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
        g.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
        g.setAttribute('aAlpha', new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage));
        g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
        this.mat = new THREE.ShaderMaterial({
            uniforms: { uScale: { value: 500 }, uSoft: { value: soft } },
            vertexShader: VERT, fragmentShader: FRAG,
            transparent: true, depthWrite: false,
            blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
        });
        this.points = new THREE.Points(g, this.mat);
        this.points.frustumCulled = false;
        this.points.renderOrder = additive ? 3 : 2;
        scene.add(this.points);
        this.geo = g;
    }
    // o: { x,y,z, vx,vy,vz, size, grow, life, r,g,b, a, grav, drag }
    emit(o) {
        if (this.budget < 1 && Math.random() > this.budget) return;
        const i = this.next;
        this.next = (this.next + 1) % this.max;
        this.pos[i * 3] = o.x; this.pos[i * 3 + 1] = o.y; this.pos[i * 3 + 2] = o.z;
        this.vel[i * 3] = o.vx || 0; this.vel[i * 3 + 1] = o.vy || 0; this.vel[i * 3 + 2] = o.vz || 0;
        this.col[i * 3] = o.r; this.col[i * 3 + 1] = o.g; this.col[i * 3 + 2] = o.b;
        this.size[i] = o.size || 1;
        this.grow[i] = o.grow || 0;
        this.life[i] = this.maxLife[i] = o.life || 1;
        this.a0[i] = this.alpha[i] = o.a ?? 1;
        this.grav[i] = o.grav || 0;
        this.drag[i] = o.drag || 0;
    }
    clear() {
        this.life.fill(0);
        this.alpha.fill(0);
        this.geo.attributes.aAlpha.needsUpdate = true;
    }
    update(dt, camera, heightPx) {
        const P = this.pos, V = this.vel;
        for (let i = 0; i < this.max; i++) {
            if (this.life[i] <= 0) continue;
            this.life[i] -= dt;
            if (this.life[i] <= 0) { this.alpha[i] = 0; continue; }
            const d = Math.exp(-this.drag[i] * dt);
            V[i * 3] *= d; V[i * 3 + 1] = V[i * 3 + 1] * d - this.grav[i] * dt; V[i * 3 + 2] *= d;
            P[i * 3] += V[i * 3] * dt; P[i * 3 + 1] += V[i * 3 + 1] * dt; P[i * 3 + 2] += V[i * 3 + 2] * dt;
            this.size[i] += this.grow[i] * dt;
            const t = this.life[i] / this.maxLife[i];
            this.alpha[i] = this.a0[i] * Math.min(1, t * 2.2) * Math.min(1, (1 - t) * 12 + 0.25);
        }
        const g = this.geo.attributes;
        g.position.needsUpdate = g.aColor.needsUpdate = g.aSize.needsUpdate = g.aAlpha.needsUpdate = true;
        this.mat.uniforms.uScale.value = heightPx / (2 * Math.tan((camera.fov * Math.PI) / 360));
    }
}

// ============================================================
// Skid marks: a ring buffer of quads laid on the road
// ============================================================
export class SkidMarks {
    constructor(scene, max = 900) {
        this.max = max;
        this.next = 0;
        this.pos = new Float32Array(max * 4 * 3);
        this.alpha = new Float32Array(max * 4);
        const idx = [];
        for (let i = 0; i < max; i++) { const b = i * 4; idx.push(b, b + 1, b + 2, b + 2, b + 1, b + 3); }
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
        g.setAttribute('aAlpha', new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage));
        g.setIndex(idx);
        g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
        this.geo = g;
        this.mat = new THREE.ShaderMaterial({
            vertexShader: 'attribute float aAlpha; varying float vA; void main() { vA = aAlpha; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
            fragmentShader: 'varying float vA; void main() { gl_FragColor = vec4(0.03, 0.03, 0.035, vA); }',
            transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4,
        });
        this.mesh = new THREE.Mesh(g, this.mat);
        this.mesh.frustumCulled = false;
        this.mesh.renderOrder = 1;
        scene.add(this.mesh);
        this.last = new Map();
    }
    // Continue the mark for key (racer id + wheel) to point (x, y, z); cut = start a new mark
    add(key, x, y, z, w, a, cut) {
        const prev = this.last.get(key);
        if (!prev || cut) { this.last.set(key, { x, y, z }); return; }
        const dx = x - prev.x, dz = z - prev.z, len = Math.hypot(dx, dz);
        if (len < 0.5) return;
        if (len > 4) { this.last.set(key, { x, y, z }); return; }
        const nx = -dz / len * w / 2, nz = dx / len * w / 2;
        const i = this.next;
        this.next = (this.next + 1) % this.max;
        const P = this.pos, b = i * 12;
        P[b] = prev.x + nx; P[b + 1] = prev.y; P[b + 2] = prev.z + nz;
        P[b + 3] = prev.x - nx; P[b + 4] = prev.y; P[b + 5] = prev.z - nz;
        P[b + 6] = x + nx; P[b + 7] = y; P[b + 8] = z + nz;
        P[b + 9] = x - nx; P[b + 10] = y; P[b + 11] = z - nz;
        this.alpha.fill(a, i * 4, i * 4 + 4);
        this.last.set(key, { x, y, z });
        this.geo.attributes.position.needsUpdate = true;
        this.geo.attributes.aAlpha.needsUpdate = true;
    }
    lift(key) { this.last.delete(key); }
    clear() {
        this.alpha.fill(0);
        this.geo.attributes.aAlpha.needsUpdate = true;
        this.last.clear();
    }
}

// ============================================================
// Wind streaks: thin bright lines rushing past the camera car while slipstreaming / on nitro
// ============================================================
export class Streaks {
    constructor(scene, count = 36) {
        this.count = count;
        this.pos = new Float32Array(count * 6);
        this.col = new Float32Array(count * 6);
        this.seeds = Array.from({ length: count }, () => ({ a: Math.random() * Math.PI * 2, r: 1.2 + Math.random() * 2.4, u: Math.random(), len: 2 + Math.random() * 4, y: Math.random() }));
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
        g.setAttribute('color', new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
        g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
        this.geo = g;
        this.lines = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
        this.lines.frustumCulled = false;
        this.lines.visible = false;
        scene.add(this.lines);
        this.level = 0;
    }
    update(dt, r, want) {
        this.level += (want - this.level) * (1 - Math.exp(-6 * dt));
        this.lines.visible = !!r && this.level > 0.02;
        if (!this.lines.visible) return;
        const fx = Math.cos(r.h), fz = Math.sin(r.h), rx = -fz, rz = fx;
        const y0 = (r.y || 0) + 1.2;
        const speed = Math.max(20, Math.abs(r.speed));
        for (let i = 0; i < this.count; i++) {
            const s = this.seeds[i];
            s.u -= dt * speed / 22;
            if (s.u < 0) { s.u += 1; s.a = Math.random() * Math.PI * 2; s.r = 1.4 + Math.random() * 2.6; }
            const along = -6 + s.u * 16;
            const ox = Math.cos(s.a) * s.r * 1.3, oy = Math.sin(s.a) * s.r * 0.7;
            const x = r.x + fx * along + rx * ox, z = r.z + fz * along + rz * ox, y = y0 + oy;
            const b = i * 6;
            this.pos[b] = x; this.pos[b + 1] = y; this.pos[b + 2] = z;
            this.pos[b + 3] = x - fx * s.len; this.pos[b + 4] = y; this.pos[b + 5] = z - fz * s.len;
            const fade = Math.sin(Math.PI * s.u) * this.level * 1.6;
            this.col[b] = this.col[b + 1] = this.col[b + 2] = fade;
            this.col[b + 3] = this.col[b + 4] = this.col[b + 5] = 0;
        }
        this.geo.attributes.position.needsUpdate = true;
        this.geo.attributes.color.needsUpdate = true;
    }
}
