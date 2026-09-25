import p5 from 'p5';
import './style.css';
import { loadStored, smoothParams } from './params.js';
import { initMidi } from './midi.js';
import { createSimulation } from './simulation.js';
import { createCamera } from './camera.js';
import { createUI } from './ui.js';

loadStored();

new p5((p) => {
  let simulation;
  let camera;
  let ui;
  let fps = 60;

  p.setup = () => {
    p.createCanvas(p.windowWidth, p.windowHeight, p.WEBGL);
    // Transparent canvas so the CSS gradient shows through.
    p.setAttributes({ antialias: true, alpha: true });
    p.pixelDensity(Math.min(2, window.devicePixelRatio || 1));

    simulation = createSimulation(p);
    simulation.reset();
    camera = createCamera(p, p.canvas);
    ui = createUI({
      togglePause: () => simulation.setPaused(!simulation.sim.paused),
      isPaused: () => simulation.sim.paused,
      reset: () => simulation.reset(),
      resetView: () => camera.resetView(),
      stats: () => ({ fps: Math.round(fps), particles: simulation.count })
    });
    initMidi();

    // Exposed for quick profiling from the console.
    window.__fps = () => Math.round(fps);
    if (import.meta.env.DEV) window.__sim = simulation.sim;
  };

  p.draw = () => {
    const now = p.millis();
    const dt = Math.min(0.1, p.deltaTime / 1000 || 1 / 60);
    fps += (1 / Math.max(dt, 1e-3) - fps) * 0.05;

    smoothParams(dt);
    camera.update(dt);
    simulation.update(dt, now);

    p.clear();
    camera.apply();

    p.ambientLight(80, 84, 100);
    p.directionalLight(235, 230, 220, 0.4, 0.8, -0.5); // warm key light from above
    p.directionalLight(90, 110, 170, -0.6, -0.3, 0.6); // cool rim light
    p.pointLight(200, 190, 255, 0, -300, 0);
    p.specularColor(220, 220, 240);

    simulation.draw();
    ui.frame(performance.now());
  };

  p.windowResized = () => {
    p.resizeCanvas(p.windowWidth, p.windowHeight);
  };
}, document.getElementById('stage'));
