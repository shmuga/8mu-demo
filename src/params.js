// Parameter definitions and shared control state.
// `target` is what the user/MIDI asked for, `value` is the smoothed value the
// simulation actually uses, so every change eases in instead of jumping.

export const PARAMS = [
  { id: 'size',        name: 'Size',               cc: 34, group: 'sim',     def: 0.45 },
  { id: 'speed',       name: 'Speed',              cc: 35, group: 'sim',     def: 0.35 },
  { id: 'gravity',     name: 'Gravity',            cc: 36, group: 'sim',     def: 0.2 },
  { id: 'turbulence',  name: 'Turbulence',         cc: 37, group: 'sim',     def: 0.15 },
  { id: 'randomness',  name: 'Randomness',         cc: 38, group: 'sim',     def: 0.2 },
  { id: 'particles',   name: 'Particle Density',   cc: 39, group: 'sim',     def: 0.5 },
  { id: 'connections', name: 'Connection Density', cc: 40, group: 'sim',     def: 0.5 },
  { id: 'terrain',     name: 'Terrain Height',     cc: 41, group: 'sim',     def: 0.45 },
  { id: 'tiltFront',   name: 'Tilt Front',         cc: 42, group: 'gesture', def: 0 },
  { id: 'tiltBack',    name: 'Tilt Back',          cc: 43, group: 'gesture', def: 0 },
  { id: 'liftRight',   name: 'Lift Right',         cc: 44, group: 'gesture', def: 0 },
  { id: 'liftLeft',    name: 'Lift Left',          cc: 45, group: 'gesture', def: 0 },
  { id: 'rotateRight', name: 'Rotate Right',       cc: 46, group: 'gesture', def: 0 },
  { id: 'rotateLeft',  name: 'Rotate Left',        cc: 47, group: 'gesture', def: 0 }
];

// Gesture pairs are shown in the UI as a single bipolar control.
export const GESTURE_AXES = [
  { id: 'tilt',   name: 'Tilt',   pos: 'tiltFront',   neg: 'tiltBack',  posLabel: 'Front', negLabel: 'Back' },
  { id: 'lift',   name: 'Lift',   pos: 'liftRight',   neg: 'liftLeft',  posLabel: 'Right', negLabel: 'Left' },
  { id: 'rotate', name: 'Rotate', pos: 'rotateRight', neg: 'rotateLeft', posLabel: 'Right', negLabel: 'Left' }
];

export const DEFAULT_MAPPINGS = PARAMS.map((p) => p.cc);
const STORAGE_KEY = 'midi-visuals:v2';

export const indexOf = Object.fromEntries(PARAMS.map((p, i) => [p.id, i]));

export const state = {
  target: PARAMS.map((p) => p.def),
  value: PARAMS.map((p) => p.def),
  mappings: DEFAULT_MAPPINGS.slice(),
  prefs: {
    autoRotate: true,
    wireframe: true,
    showBox: true,
    springGestures: true,
    showStats: true
  }
};

const listeners = new Set();

// Subscribe to parameter changes: fn(index, value, source)
export function onParamChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function setParam(index, v, source = 'ui') {
  const clamped = Math.min(1, Math.max(0, v));
  state.target[index] = clamped;
  listeners.forEach((fn) => fn(index, clamped, source));
}

export function get(id) {
  return state.value[indexOf[id]];
}

// Exponential smoothing that is independent of frame rate.
// Gestures use a faster, value-adaptive rate like the original sketch.
export function smoothParams(dt) {
  for (let i = 0; i < PARAMS.length; i++) {
    const t = state.target[i];
    const isGesture = PARAMS[i].group === 'gesture';
    const rate = isGesture ? 6 * (1 + t * 2) : 8;
    const k = 1 - Math.exp(-rate * dt);
    state.value[i] += (t - state.value[i]) * k;
    if (Math.abs(t - state.value[i]) < 1e-4) state.value[i] = t;
  }
}

export function loadStored() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const data = JSON.parse(raw);
    if (Array.isArray(data.mappings) && data.mappings.length === PARAMS.length) {
      state.mappings = data.mappings.map((cc, i) => (Number.isInteger(cc) ? cc : DEFAULT_MAPPINGS[i]));
    }
    if (data.prefs) Object.assign(state.prefs, data.prefs);
  } catch {
    // Storage unavailable (private mode, blocked) — defaults are fine.
  }
}

export function saveStored() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ mappings: state.mappings, prefs: state.prefs }));
  } catch {
    // Ignore storage failures.
  }
}
