import { get, state } from './params.js';

// World units. Physics runs in a Y-up space; the renderer flips Y once when drawing.
export const WORLD = {
  size: 500,
  resolution: 44,
  maxParticles: 150,
  ceiling: 340
};

const PALETTE = [
  [94, 234, 212],  // teal
  [251, 191, 36],  // amber
  [167, 139, 250], // violet
  [134, 239, 172], // mint
  [251, 113, 133]  // coral
];

// Terrain colours by normalized height (-0.5..0.5), interpolated between stops.
const TERRAIN_STOPS = [
  [-0.5, [16, 42, 67]],
  [-0.2, [28, 78, 96]],
  [0.05, [52, 116, 118]],
  [0.25, [98, 110, 170]],
  [0.5, [226, 196, 222]]
];

// Physics constants (world units, seconds).
const STEP = 1 / 120;
const MAX_STEPS = 8;
const AIR_DRAG = 0.25;
const GROUND_FRICTION = 1.5;
const ATTRACTION = 15000; // gravitational constant for particle-particle pull
const SOFTENING = 25; // avoids infinite pull at tiny distances
const RESTITUTION = { ground: 0.72, wall: 0.8, particle: 0.85 };
const SPRING = { k: 20, damping: 1, maxRest: 90 };

const pairKey = (a, b) => (a.id < b.id ? `${a.id}:${b.id}` : `${b.id}:${a.id}`);

export function createSimulation(p) {
  const half = WORLD.size / 2;
  const res = WORLD.resolution;
  const cell = WORLD.size / (res - 1);

  const heights = new Float32Array(res * res); // normalized -0.5..0.5
  let terrainGeom = null;

  const sim = {
    particles: [],
    connections: [],
    terrainHeight: 0,
    paused: false,
    connectionsDirty: true,
    lastConnectionBuild: 0,
    connectionsPerParticle: -1,
    accumulator: 0
  };

  // --- Terrain -------------------------------------------------------------

  function generateHeights() {
    const s = 0.012;
    let min = Infinity;
    let max = -Infinity;
    for (let x = 0; x < res; x++) {
      for (let z = 0; z < res; z++) {
        const wx = -half + x * cell;
        const wz = -half + z * cell;
        const base = p.noise(wx * s, wz * s);
        const detail = p.noise(wx * s * 3, wz * s * 3) * 0.3;
        const micro = p.noise(wx * s * 8, wz * s * 8) * 0.06;
        const ridge = Math.abs(p.noise(wx * s * 2, wz * s * 2) - 0.5) * 0.3;
        const h = base + detail + micro + ridge;
        heights[x * res + z] = h;
        if (h < min) min = h;
        if (h > max) max = h;
      }
    }
    const range = max - min || 1;
    for (let i = 0; i < heights.length; i++) heights[i] = (heights[i] - min) / range - 0.5;
  }

  function terrainColor(h) {
    for (let i = 1; i < TERRAIN_STOPS.length; i++) {
      const [h1, c1] = TERRAIN_STOPS[i];
      if (h <= h1) {
        const [h0, c0] = TERRAIN_STOPS[i - 1];
        const t = (h - h0) / (h1 - h0);
        return [c0[0] + (c1[0] - c0[0]) * t, c0[1] + (c1[1] - c0[1]) * t, c0[2] + (c1[2] - c0[2]) * t];
      }
    }
    return TERRAIN_STOPS[TERRAIN_STOPS.length - 1][1];
  }

  // The terrain is built once as retained GPU geometry at unit height and
  // scaled vertically at draw time, so height changes are free and smooth.
  function buildTerrainGeometry() {
    if (terrainGeom) p.freeGeometry(terrainGeom);
    terrainGeom = p.buildGeometry(() => {
      p.stroke(255);
      p.beginShape(p.TRIANGLES);
      const tri = (a, b, c) => {
        const col = terrainColor((a[1] + b[1] + c[1]) / 3);
        p.fill(col[0], col[1], col[2]);
        p.vertex(a[0], a[1], a[2]);
        p.vertex(b[0], b[1], b[2]);
        p.vertex(c[0], c[1], c[2]);
      };
      for (let x = 0; x < res - 1; x++) {
        for (let z = 0; z < res - 1; z++) {
          const v00 = [-half + x * cell, heights[x * res + z], -half + z * cell];
          const v10 = [-half + (x + 1) * cell, heights[(x + 1) * res + z], -half + z * cell];
          const v01 = [-half + x * cell, heights[x * res + z + 1], -half + (z + 1) * cell];
          const v11 = [-half + (x + 1) * cell, heights[(x + 1) * res + z + 1], -half + (z + 1) * cell];
          // Counter-clockwise seen from above so computed normals point up.
          tri(v00, v01, v10);
          tri(v10, v01, v11);
        }
      }
      p.endShape();
    });
    terrainGeom.computeNormals();
  }

  // Bilinear terrain height (world units) and surface normal at x,z.
  function groundAt(x, z) {
    const gx = Math.min(res - 1.001, Math.max(0, (x + half) / cell));
    const gz = Math.min(res - 1.001, Math.max(0, (z + half) / cell));
    const ix = Math.floor(gx);
    const iz = Math.floor(gz);
    const fx = gx - ix;
    const fz = gz - iz;
    const H = sim.terrainHeight;
    const h00 = heights[ix * res + iz];
    const h10 = heights[(ix + 1) * res + iz];
    const h01 = heights[ix * res + iz + 1];
    const h11 = heights[(ix + 1) * res + iz + 1];
    const h = (h00 * (1 - fx) + h10 * fx) * (1 - fz) + (h01 * (1 - fx) + h11 * fx) * fz;
    const dhdx = (((h10 - h00) * (1 - fz) + (h11 - h01) * fz) * H) / cell;
    const dhdz = (((h01 - h00) * (1 - fx) + (h11 - h10) * fx) * H) / cell;
    const len = Math.hypot(dhdx, 1, dhdz);
    return { y: h * H, nx: -dhdx / len, ny: 1 / len, nz: -dhdz / len };
  }

  // --- Particles -----------------------------------------------------------

  let nextId = 1;

  function createParticle() {
    const x = p.random(-half * 0.85, half * 0.85);
    const z = p.random(-half * 0.85, half * 0.85);
    // Spawn high up so particles visibly fall onto the terrain.
    const y = p.random(WORLD.ceiling * 0.35, WORLD.ceiling * 0.9);
    const seed = p.noise(x * 0.02, z * 0.02);
    // Perlin noise clusters around 0.5, so stretch it before picking a colour.
    const pick = Math.floor(p.constrain((seed - 0.25) * 2, 0, 0.999) * PALETTE.length);
    return {
      id: nextId++,
      x, y, z,
      vx: p.random(-20, 20), vy: p.random(-10, 10), vz: p.random(-20, 20),
      base: p.random(4, 12),
      r: 0,
      m: 1,
      color: PALETTE[pick],
      grow: 0,
      dying: false
    };
  }

  function targetCount() {
    return Math.round(WORLD.maxParticles * p.map(get('particles'), 0, 1, 0.2, 1));
  }

  // Rebuild nearest-neighbour springs. Pairs are de-duplicated, and springs
  // that already existed keep their rest length so rebuilding doesn't jolt.
  function buildConnections() {
    const per = Math.floor(5 * get('connections'));
    sim.connectionsPerParticle = per;
    sim.connectionsDirty = false;
    const previous = new Map(sim.connections.map((c) => [pairKey(c.a, c.b), c.rest]));
    sim.connections = [];
    if (per <= 0) return;
    const ps = sim.particles.filter((q) => !q.dying);
    const seen = new Set();
    for (let i = 0; i < ps.length; i++) {
      const a = ps[i];
      const d = [];
      for (let j = 0; j < ps.length; j++) {
        if (i === j) continue;
        const b = ps[j];
        d.push([j, (a.x - b.x) ** 2 + (a.y - b.y) ** 2 + (a.z - b.z) ** 2]);
      }
      d.sort((m, n) => m[1] - n[1]);
      for (let k = 0; k < Math.min(per, d.length); k++) {
        const b = ps[d[k][0]];
        const key = pairKey(a, b);
        if (seen.has(key)) continue;
        seen.add(key);
        const rest = previous.get(key) ?? p.constrain(Math.sqrt(d[k][1]), 30, SPRING.maxRest);
        sim.connections.push({ a, b, rest });
      }
    }
  }

  function reset() {
    p.noiseSeed(Math.floor(Math.random() * 1e9));
    generateHeights();
    buildTerrainGeometry();
    sim.terrainHeight = p.map(get('terrain'), 0, 1, 20, 200);
    sim.particles = [];
    sim.connections = [];
    const n = targetCount();
    for (let i = 0; i < n; i++) {
      const q = createParticle();
      q.grow = Math.random() * 0.5; // staggered pop-in
      sim.particles.push(q);
    }
    sim.connectionsDirty = true;
  }

  // --- Update --------------------------------------------------------------

  function update(dt, now) {
    if (sim.paused) return;

    sim.terrainHeight = p.map(get('terrain'), 0, 1, 20, 200);

    // Grow/shrink the population a few particles per frame instead of rebuilding.
    const alive = sim.particles.filter((q) => !q.dying);
    const want = targetCount();
    if (alive.length < want) {
      for (let i = 0; i < Math.min(3, want - alive.length); i++) sim.particles.push(createParticle());
      sim.connectionsDirty = true;
    } else if (alive.length > want) {
      for (let i = 0; i < Math.min(3, alive.length - want); i++) alive[alive.length - 1 - i].dying = true;
      sim.connectionsDirty = true;
    }
    if (Math.floor(5 * get('connections')) !== sim.connectionsPerParticle) sim.connectionsDirty = true;
    if (sim.connectionsDirty && now - sim.lastConnectionBuild > 150) {
      buildConnections();
      sim.lastConnectionBuild = now;
    }

    // Size and mass (mass ~ volume) follow the Size fader and pop-in animation.
    const sizeScale = p.map(get('size'), 0, 1, 0.5, 2);
    for (const q of sim.particles) {
      q.grow = q.dying ? q.grow - dt * 3 : Math.min(1, q.grow + dt * 2);
      q.r = q.base * sizeScale * easeOutBack(Math.max(0, q.grow));
      q.m = Math.max(0.05, (q.base * sizeScale / 8) ** 3);
    }

    // Fixed sub-steps keep springs and collisions stable at any frame rate.
    const timeScale = p.map(get('speed'), 0, 1, 0.2, 2);
    sim.accumulator = Math.min(sim.accumulator + dt * timeScale, STEP * MAX_STEPS);
    while (sim.accumulator >= STEP) {
      step(STEP, now);
      sim.accumulator -= STEP;
    }

    // Drop fully shrunk particles.
    if (sim.particles.some((q) => q.dying && q.grow <= 0)) {
      const gone = new Set(sim.particles.filter((q) => q.dying && q.grow <= 0));
      sim.particles = sim.particles.filter((q) => !gone.has(q));
      sim.connections = sim.connections.filter((c) => !gone.has(c.a) && !gone.has(c.b));
      sim.connectionsDirty = true;
    }
  }

  function step(h, now) {
    const ps = sim.particles;
    const gravity = p.map(get('gravity'), 0, 1, 0, 800);
    const wind = p.map(get('turbulence'), 0, 1, 0, 500);
    const kickRate = get('randomness') * 1.5; // kicks per particle per second
    const kickSpeed = p.map(get('randomness'), 0, 1, 80, 420);
    // Gestures: tilt swirls the swarm, lift strengthens mutual attraction.
    const vortex = p.map(get('tiltFront') + get('tiltBack'), 0, 2, 0, 350);
    const G = ATTRACTION * (1 + 4 * (get('liftRight') + get('liftLeft')));
    const t = now * 0.0003;

    // Forces: gravity, air drag, wind, vortex, random kicks.
    const drag = Math.exp(-AIR_DRAG * h);
    for (const q of ps) {
      q.vy -= gravity * h;
      if (wind > 0) {
        q.vx += (p.noise(q.x * 0.006, q.z * 0.006, t) - 0.5) * 2 * wind * h;
        q.vy += (p.noise(q.x * 0.006 + 40, q.y * 0.006, t) - 0.5) * 2 * wind * h;
        q.vz += (p.noise(q.z * 0.006 + 80, q.y * 0.006, t) - 0.5) * 2 * wind * h;
      }
      if (vortex > 0) {
        const r = Math.hypot(q.x, q.z) || 1;
        q.vx += (-q.z / r) * vortex * h;
        q.vz += (q.x / r) * vortex * h;
      }
      if (kickRate > 0 && Math.random() < kickRate * h) {
        // Mostly upward hop in a random direction.
        const a = Math.random() * Math.PI * 2;
        q.vx += Math.cos(a) * kickSpeed * 0.5;
        q.vz += Math.sin(a) * kickSpeed * 0.5;
        q.vy += kickSpeed * (0.6 + Math.random() * 0.4);
      }
      q.vx *= drag; q.vy *= drag; q.vz *= drag;
    }

    // Pairwise: mass-weighted attraction (softened inverse square) and
    // elastic sphere collisions with momentum exchange.
    for (let i = 0; i < ps.length; i++) {
      const a = ps[i];
      for (let j = i + 1; j < ps.length; j++) {
        const b = ps[j];
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const dz = b.z - a.z;
        const d2 = dx * dx + dy * dy + dz * dz;
        if (d2 < 1e-6) continue;
        const d = Math.sqrt(d2);
        const nx = dx / d;
        const ny = dy / d;
        const nz = dz / d;

        const f = (G * h) / (d2 + SOFTENING * SOFTENING);
        a.vx += nx * f * b.m; a.vy += ny * f * b.m; a.vz += nz * f * b.m;
        b.vx -= nx * f * a.m; b.vy -= ny * f * a.m; b.vz -= nz * f * a.m;

        const overlap = a.r + b.r - d;
        if (overlap > 0) {
          const ia = 1 / a.m;
          const ib = 1 / b.m;
          const share = overlap / (ia + ib);
          a.x -= nx * share * ia; a.y -= ny * share * ia; a.z -= nz * share * ia;
          b.x += nx * share * ib; b.y += ny * share * ib; b.z += nz * share * ib;
          const vn = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny + (b.vz - a.vz) * nz;
          if (vn < 0) {
            const jn = (-(1 + RESTITUTION.particle) * vn) / (ia + ib);
            a.vx -= nx * jn * ia; a.vy -= ny * jn * ia; a.vz -= nz * jn * ia;
            b.vx += nx * jn * ib; b.vy += ny * jn * ib; b.vz += nz * jn * ib;
          }
        }
      }
    }

    // Connections are damped springs.
    for (const c of sim.connections) {
      const { a, b } = c;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const dz = b.z - a.z;
      const d = Math.hypot(dx, dy, dz) || 1;
      const nx = dx / d;
      const ny = dy / d;
      const nz = dz / d;
      const relV = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny + (b.vz - a.vz) * nz;
      const f = (SPRING.k * (d - c.rest) + SPRING.damping * relV) * h;
      a.vx += (nx * f) / a.m; a.vy += (ny * f) / a.m; a.vz += (nz * f) / a.m;
      b.vx -= (nx * f) / b.m; b.vy -= (ny * f) / b.m; b.vz -= (nz * f) / b.m;
    }

    // Integrate, then resolve walls, ceiling and terrain.
    for (const q of ps) {
      q.x += q.vx * h;
      q.y += q.vy * h;
      q.z += q.vz * h;

      const lim = half - q.r;
      if (q.x > lim) { q.x = lim; q.vx = -Math.abs(q.vx) * RESTITUTION.wall; }
      else if (q.x < -lim) { q.x = -lim; q.vx = Math.abs(q.vx) * RESTITUTION.wall; }
      if (q.z > lim) { q.z = lim; q.vz = -Math.abs(q.vz) * RESTITUTION.wall; }
      else if (q.z < -lim) { q.z = -lim; q.vz = Math.abs(q.vz) * RESTITUTION.wall; }
      if (q.y > WORLD.ceiling - q.r) { q.y = WORLD.ceiling - q.r; q.vy = -Math.abs(q.vy) * RESTITUTION.wall; }

      const g = groundAt(q.x, q.z);
      if (q.y - q.r < g.y) {
        q.y = g.y + q.r;
        const vn = q.vx * g.nx + q.vy * g.ny + q.vz * g.nz;
        if (vn < 0) {
          // Reflect the normal component; friction slows sliding along slopes.
          const e = 1 + RESTITUTION.ground;
          q.vx -= e * vn * g.nx;
          q.vy -= e * vn * g.ny;
          q.vz -= e * vn * g.nz;
        }
        const fr = Math.exp(-GROUND_FRICTION * h);
        q.vx *= fr;
        q.vz *= fr;
      }
    }
  }

  // --- Draw ----------------------------------------------------------------

  function draw() {
    const H = sim.terrainHeight;

    p.push();
    p.scale(1, -1, 1); // physics is Y-up, p5 is Y-down

    // Terrain
    p.push();
    p.scale(1, H, 1);
    if (state.prefs.wireframe) {
      p.stroke(255, 255, 255, 22);
      p.strokeWeight(0.6);
    } else {
      p.noStroke();
    }
    p.model(terrainGeom);
    p.pop();

    // Bounding box
    if (state.prefs.showBox) {
      p.push();
      p.noFill();
      p.stroke(160, 180, 255, 40);
      p.strokeWeight(0.8);
      p.translate(0, (WORLD.ceiling - H / 2) / 2, 0);
      p.box(WORLD.size, WORLD.ceiling + H / 2, WORLD.size);
      p.pop();
    }

    // Connections, batched into a single draw call.
    if (sim.connections.length) {
      p.push();
      p.stroke(210, 225, 255, 40 + 90 * get('connections'));
      p.strokeWeight(1);
      p.noFill();
      p.beginShape(p.LINES);
      for (const c of sim.connections) {
        p.vertex(c.a.x, c.a.y, c.a.z);
        p.vertex(c.b.x, c.b.y, c.b.z);
      }
      p.endShape();
      p.pop();
    }

    // Particles
    p.noStroke();
    for (const q of sim.particles) {
      if (q.r < 0.2) continue;
      const [r, g, b] = q.color;
      p.push();
      p.translate(q.x, q.y, q.z);
      p.fill(r, g, b);
      p.emissiveMaterial(r * 0.22, g * 0.22, b * 0.22);
      p.specularMaterial(255);
      p.shininess(60);
      p.sphere(q.r, 18, 12);
      p.pop();
    }

    p.pop();
  }

  return {
    sim,
    reset,
    update,
    draw,
    setPaused(v) { sim.paused = v; },
    get count() { return sim.particles.filter((q) => !q.dying).length; }
  };
}

function easeOutBack(t) {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
}
