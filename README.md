# MIDI Visuals

An interactive 3D visualization that responds to MIDI controller input. The application creates an organic, particle-based model that can be manipulated in real-time using MIDI controllers or on-screen sliders. By default configure to work with Music Thing Modular 8mu.

Live demo: [https://8mu-demo.vercel.app/](https://8mu-demo.vercel.app/)

![MIDI Visuals Screenshot](./docs/demo.gif)

## Features

- Real-time 3D physics: particles fall under gravity, bounce off the terrain, walls and each other (mass-based collisions), attract each other in proportion to their mass, and are linked by damped spring connections
- Faders: **Gravity** (downward pull), **Turbulence** (wind field), **Randomness** (random hops), **Speed** (time scale), plus size, density, connections and terrain height
- 8mu gestures: **Tilt** swirls the swarm and pitches the camera, **Lift** strengthens mutual attraction and rolls the camera, **Rotate** spins the view
- MIDI controller support with **hot-plug**, **MIDI learn** and mappings saved in the browser
- Glass-style control panel with smoothed sliders; the 8mu tilt gestures appear as bipolar sliders that spring back to centre
- Every parameter change eases in (frame-rate independent), and particles fade in/out instead of the scene rebuilding
- Terrain is uploaded to the GPU once and scaled at draw time, so the render loop does very little CPU work
- Orbit camera: drag, scroll/pinch zoom, double-click to reset; works on touch screens

## Controls

| Key | Action |
| --- | --- |
| **Space** / **P** | Pause / play |
| **R** | New terrain & particles |
| **C** | Toggle control panel |
| **S** | MIDI mapping & display settings |
| **A** | Auto-rotate camera |
| **W** | Terrain wireframe |
| **V** | Reset camera view |
| **H** | Hide / show interface |
| **F** | Fullscreen |
| **1–8** | Nudge a parameter up (**Shift** = down) |
| **?** | Shortcut overview |
| Drag / Scroll / Pinch | Orbit / zoom camera |
| Double-click | Reset view (canvas) or parameter (slider) |

## Project layout

| File | Purpose |
| --- | --- |
| `src/index.js` | p5 sketch entry: frame loop, lighting |
| `src/params.js` | Parameter definitions, smoothing, saved preferences |
| `src/midi.js` | Web MIDI setup, hot-plug, MIDI learn |
| `src/simulation.js` | Terrain, particles, physics, drawing |
| `src/camera.js` | Orbit camera and pointer input |
| `src/ui.js` / `src/style.css` | HUD, control panel, dialogs, shortcuts |

## Getting Started

### Prerequisites

- Node.js (v14 or higher)
- npm

### Installation

1. Clone the repository
2. Install dependencies:
   ```
   npm install
   ```

### Running the Application

Start the development server:
```
npm run dev
```

Then open your browser to the URL shown in the terminal (typically http://localhost:5173).

### Building for Production

```
npm run build
```

### Deploying to GitHub Pages

No build output is committed. `.github/workflows/pages.yml` builds with Vite and publishes `dist/` on every push to `main`. One-time setup: **Settings → Pages → Source: GitHub Actions**. `vite.config.js` uses a relative `base`, so the same build also works at a domain root (e.g. Vercel).

## MIDI Controller Setup

Plug in your controller at any time; it is detected automatically. If no MIDI controller is found, the on-screen control panel opens automatically.

Default CC mappings match the 8mu (CC 34–47). To remap, press **S**, then type a CC number or press **Learn** and move a control. Mappings are stored in the browser's local storage.
