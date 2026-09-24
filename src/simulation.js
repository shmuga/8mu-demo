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

const ELASTICITY = 0.01;

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
    forces: { vortex: 0, gravity: 0 }
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

  function createParticle() {
    const x = p.random(-half * 0.9, half * 0.9);
    const z = p.random(-half * 0.9, half * 0.9);
    const y = groundAt(x, z).y + p.random(30, 140);
    const seed = p.noise(x * 0.02, z * 0.02);
    // Perlin noise clusters around 0.5, so stretch it before picking a colour.
    const pick = Math.floor(p.constrain((seed - 0.25) * 2, 0, 0.999) * PALETTE.length);
    const color = PALETTE[pick];
    const cp = [];
    for (let i = 0; i < 4; i++) {
      cp.push([x + p.random(-50, 50), y + p.random(-30, 30), z + p.random(-50, 50)]);
    }
    return {
      x, y, z,
      vx: p.random(-0.5, 0.5), vy: p.random(-0.2, 0.2), vz: p.random(-0.5, 0.5),
      ox: x, oy: y, oz: z,
      base: p.map(p.noise(x * 0.05, z * 0.05), 0, 1, 4, 12),
      r: 0,
      color,
      cp,
      t: p.random(),
      dir: 1,
      noise: p.random(1000),
      grow: 0,
      dying: false
    };
  }

  function targetCount() {
    return Math.round(WORLD.maxParticles * p.map(get('particles'), 0, 1, 0.2, 1));
  }

  // Rebuild nearest-neighbour springs. Pairs are de-duplicated.
  function buildConnections() {
    const per = Math.floor(5 * get('connections'));
    sim.connectionsPerParticle = per;
    sim.connections = [];
    sim.connectionsDirty = false;
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
        const j = d[k][0];
        const key = i < j ? i * 1000 + j : j * 1000 + i;
        if (seen.has(key)) continue;
        seen.add(key);
        sim.connections.push({ a, b: ps[j], strength: p.random(0.01, 0.03), maxLength: Math.sqrt(d[k][1]) * 1.5 });
      }
    }
  }

  function reset() {
    p.noiseSeed(Math.floor(Math.random() * 1e9));
    generateHeights();
    buildTerrainGeometry();
    sim.terrainHeight = p.map(get('terrain'), 0, 1, 20, 200);
    sim.particles = [];
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
    const k = Math.min(3, dt * 60); // 1.0 at 60fps

    const sizeScale = p.map(get('size'), 0, 1, 0.5, 2);
    const speed = p.map(get('speed'), 0, 1, 0.1, 2);
    const gravity = p.map(get('gravity'), 0, 1, 0.01, 0.2);
    const turbulence = p.map(get('turbulence'), 0, 1, 0.01, 0.3);
    const randomness = p.map(get('randomness'), 0, 1, 0.01, 0.2);
    sim.terrainHeight = p.map(get('terrain'), 0, 1, 20, 200);

    const tilt = get('tiltFront') + get('tiltBack');
    const lift = get('liftRight') + get('liftLeft');
    sim.forces.vortex = p.map(tilt, 0, 2, 0, 0.05);
    sim.forces.gravity = p.map(lift, 0, 2, 0, 0.1);

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

    const ps = sim.particles;

    // Soft particle-particle repulsion.
    for (let i = 0; i < ps.length; i++) {
      const a = ps[i];
      for (let j = i + 1; j < ps.length; j++) {
        const b = ps[j];
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const dz = b.z - a.z;
        const min = (a.r + b.r) * 0.8;
        const d2 = dx * dx + dy * dy + dz * dz;
        if (d2 < min * min && d2 > 1e-6) {
          const f = (0.5 * k) / Math.sqrt(d2);
          a.vx -= dx * f; a.vy -= dy * f; a.vz -= dz * f;
          b.vx += dx * f; b.vy += dy * f; b.vz += dz * f;
        }
      }
    }

    const damping = Math.pow(0.98, k);
    const impulseChance = randomness * 0.3 * k;
    const impulseStrength = p.map(randomness, 0, 0.2, 0.5, 3.0);
    const noiseStrength = p.map(randomness, 0, 0.2, 0.1, 0.5) * k;
    const noiseTime = now * 0.0006;
    const tv = turbulence + randomness;
    const g = gravity + sim.forces.gravity;

    for (const q of ps) {
      q.grow = q.dying ? q.grow - dt * 3 : Math.min(1, q.grow + dt * 2);

      // Turbulence (more vertical freedom).
      q.vx += (Math.random() * 2 - 1) * tv * k;
      q.vy += (Math.random() * 2 - 1) * (turbulence + randomness * 1.5) * k;
      q.vz += (Math.random() * 2 - 1) * tv * k;

      // Pull toward the centre.
      const dist = Math.hypot(q.x, q.y, q.z) || 1;
      q.vx -= (q.x / dist) * g * k;
      q.vy -= (q.y / dist) * g * k;
      q.vz -= (q.z / dist) * g * k;

      // Vortex around the vertical axis.
      if (sim.forces.vortex > 0) {
        const r = Math.hypot(q.x, q.z) || 1;
        q.vx += (-q.z / r) * sim.forces.vortex * k;
        q.vz += (q.x / r) * sim.forces.vortex * k;
      }

      // Elastic return to spawn point.
      q.vx += (q.ox - q.x) * ELASTICITY * k;
      q.vy += (q.oy - q.y) * ELASTICITY * k;
      q.vz += (q.oz - q.z) * ELASTICITY * k;

      // Occasional random kicks.
      if (Math.random() < impulseChance) {
        const ux = Math.random() * 2 - 1;
        const uy = Math.random() * 2 - 1;
        const uz = Math.random() * 2 - 1;
        const ul = Math.hypot(ux, uy, uz) || 1;
        q.vx += (ux / ul) * impulseStrength;
        q.vy += (uy / ul) * impulseStrength;
        q.vz += (uz / ul) * impulseStrength;
      }

      q.vx *= damping; q.vy *= damping; q.vz *= damping;
      q.x += q.vx * speed * k;
      q.y += q.vy * speed * k;
      q.z += q.vz * speed * k;

      // Box walls.
      if (q.x > half) { q.x = half; q.vx *= -0.8; } else if (q.x < -half) { q.x = -half; q.vx *= -0.8; }
      if (q.z > half) { q.z = half; q.vz *= -0.8; } else if (q.z < -half) { q.z = -half; q.vz *= -0.8; }
      if (q.y > WORLD.ceiling) { q.y = WORLD.ceiling; q.vy *= -0.8; }

      q.r = q.base * sizeScale * easeOutBack(Math.max(0, q.grow));

      // Terrain bounce: reflect only when moving into the surface.
      const ground = groundAt(q.x, q.z);
      if (q.y < ground.y + q.r * 0.5) {
        q.y = ground.y + q.r * 0.8;
        const dot = q.vx * ground.nx + q.vy * ground.ny + q.vz * ground.nz;
        if (dot < 0) {
          q.vx = (q.vx - 2 * dot * ground.nx) * 0.7;
          q.vy = (q.vy - 2 * dot * ground.ny) * 0.7;
          q.vz = (q.vz - 2 * dot * ground.nz) * 0.7;
        }
        q.vx += ground.nx * 0.5 * speed;
        q.vy += ground.ny * 0.5 * speed;
        q.vz += ground.nz * 0.5 * speed;
      }

      // Drift along a private Bezier path.
      q.t += 0.002 * speed * q.dir * k;
      if (q.t > 1 || q.t < 0) { q.dir *= -1; q.t = Math.min(1, Math.max(0, q.t)); }
      if (Math.random() < 0.05 * k) {
        const c = q.cp;
        const t = q.t;
        q.x += (p.bezierPoint(c[0][0], c[1][0], c[2][0], c[3][0], t) - q.x) * 0.03;
        q.y += (p.bezierPoint(c[0][1], c[1][1], c[2][1], c[3][1], t) - q.y) * 0.03;
        q.z += (p.bezierPoint(c[0][2], c[1][2], c[2][2], c[3][2], t) - q.z) * 0.03;
      }

      // Continuous Perlin wander.
      q.x += (p.noise(q.noise, noiseTime) - 0.5) * noiseStrength;
      q.y += (p.noise(q.noise + 100, noiseTime) - 0.5) * noiseStrength;
      q.z += (p.noise(q.noise + 200, noiseTime) - 0.5) * noiseStrength;
    }

    // Spring constraints.
    for (const c of sim.connections) {
      const dx = c.b.x - c.a.x;
      const dy = c.b.y - c.a.y;
      const dz = c.b.z - c.a.z;
      const d = Math.hypot(dx, dy, dz);
      if (d > c.maxLength) {
        const f = ((d - c.maxLength) * c.strength) / d;
        c.a.x += dx * f; c.a.y += dy * f; c.a.z += dz * f;
        c.b.x -= dx * f; c.b.y -= dy * f; c.b.z -= dz * f;
      }
    }

    // Drop fully shrunk particles.
    if (ps.some((q) => q.dying && q.grow <= 0)) {
      sim.particles = ps.filter((q) => !(q.dying && q.grow <= 0));
      sim.connectionsDirty = true;
      const gone = new Set(ps.filter((q) => q.dying && q.grow <= 0));
      sim.connections = sim.connections.filter((c) => !gone.has(c.a) && !gone.has(c.b));
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
