import { get, state } from './params.js';

const DEFAULT_VIEW = { yaw: Math.PI * 0.75, pitch: 0.42, distance: 820 };
const LIMITS = { pitchMin: -0.05, pitchMax: 1.45, distMin: 260, distMax: 2000 };

// Orbit camera: user input moves *targets*, the rendered view eases toward
// them every frame, which makes dragging, zooming and MIDI gestures feel fluid.
export function createCamera(p, canvas) {
  const target = { ...DEFAULT_VIEW };
  const view = { ...DEFAULT_VIEW, roll: 0 };
  const pointers = new Map();
  let pinchDist = 0;
  let dragging = false;
  let lastInteraction = -Infinity;

  canvas.style.touchAction = 'none';

  canvas.addEventListener('pointerdown', (e) => {
    canvas.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    dragging = true;
    canvas.classList.add('is-dragging');
    if (pointers.size === 2) pinchDist = pinchDistance();
  });

  canvas.addEventListener('pointermove', (e) => {
    const prev = pointers.get(e.pointerId);
    if (!prev) return;
    const dx = e.clientX - prev.x;
    const dy = e.clientY - prev.y;
    prev.x = e.clientX;
    prev.y = e.clientY;
    lastInteraction = performance.now();
    if (pointers.size === 1) {
      target.yaw -= dx * 0.006;
      target.pitch = clamp(target.pitch + dy * 0.005, LIMITS.pitchMin, LIMITS.pitchMax);
    } else if (pointers.size === 2) {
      const d = pinchDistance();
      if (pinchDist > 0) zoomBy(pinchDist / d);
      pinchDist = d;
    }
  });

  const release = (e) => {
    pointers.delete(e.pointerId);
    pinchDist = pointers.size === 2 ? pinchDistance() : 0;
    if (pointers.size === 0) {
      dragging = false;
      canvas.classList.remove('is-dragging');
    }
  };
  canvas.addEventListener('pointerup', release);
  canvas.addEventListener('pointercancel', release);

  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    // Normalize line/page deltas; trackpad pinch arrives as ctrl+wheel.
    const delta = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
    zoomBy(Math.exp(delta * (e.ctrlKey ? 0.01 : 0.0012)));
    lastInteraction = performance.now();
  }, { passive: false });

  canvas.addEventListener('dblclick', resetView);

  function pinchDistance() {
    const [a, b] = [...pointers.values()];
    return Math.hypot(a.x - b.x, a.y - b.y) || 1;
  }

  function zoomBy(factor) {
    target.distance = clamp(target.distance * factor, LIMITS.distMin, LIMITS.distMax);
  }

  function resetView() {
    Object.assign(target, DEFAULT_VIEW);
    // Keep the current heading so the reset doesn't spin wildly.
    target.yaw = view.yaw + wrapAngle(DEFAULT_VIEW.yaw - view.yaw);
  }

  function update(dt) {
    // Gestures: rotate spins continuously, tilt pitches, lift rolls.
    const spin = get('rotateRight') - get('rotateLeft');
    if (Math.abs(spin) > 0.02) target.yaw += spin * 1.6 * dt;

    const idle = !dragging && performance.now() - lastInteraction > 2500;
    if (state.prefs.autoRotate && idle) target.yaw += 0.06 * dt;

    const tilt = (get('tiltFront') - get('tiltBack')) * (Math.PI / 4);
    const roll = (get('liftRight') - get('liftLeft')) * (Math.PI / 6);

    const k = 1 - Math.exp(-8 * dt);
    view.yaw += (target.yaw - view.yaw) * k;
    view.pitch += (clamp(target.pitch + tilt, LIMITS.pitchMin, LIMITS.pitchMax) - view.pitch) * k;
    view.distance += (target.distance - view.distance) * k;
    view.roll += (roll - view.roll) * k;
  }

  function apply() {
    // p5 is Y-down; the look-at point sits slightly above the terrain.
    const cx = 0;
    const cy = -40;
    const cz = 0;
    // Pull back on narrow/portrait screens so the whole scene stays in frame.
    const fit = Math.max(1, Math.pow(1.2 / (p.width / p.height), 0.85));
    const dist = view.distance * fit;
    const cp = Math.cos(view.pitch);
    const ex = cx + dist * cp * Math.sin(view.yaw);
    const ey = cy - dist * Math.sin(view.pitch);
    const ez = cz + dist * cp * Math.cos(view.yaw);

    // Roll: rotate the up vector around the viewing axis.
    let fx = cx - ex;
    let fy = cy - ey;
    let fz = cz - ez;
    const fl = Math.hypot(fx, fy, fz);
    fx /= fl; fy /= fl; fz /= fl;
    let ux = -fy * fx;
    let uy = 1 - fy * fy;
    let uz = -fy * fz;
    const ul = Math.hypot(ux, uy, uz) || 1;
    ux /= ul; uy /= ul; uz /= ul;
    const rx = fy * uz - fz * uy;
    const ry = fz * ux - fx * uz;
    const rz = fx * uy - fy * ux;
    const c = Math.cos(view.roll);
    const s = Math.sin(view.roll);

    p.camera(ex, ey, ez, cx, cy, cz, ux * c + rx * s, uy * c + ry * s, uz * c + rz * s);
    p.perspective(Math.PI / 3.2, p.width / p.height, 5, 8000);
  }

  return { update, apply, resetView };
}

function clamp(v, a, b) {
  return Math.min(b, Math.max(a, v));
}

function wrapAngle(a) {
  return Math.atan2(Math.sin(a), Math.cos(a));
}
