# MIDI Visuals

An interactive 3D visualization that responds to MIDI controller input. The application creates an organic, particle-based model that can be manipulated in real-time using MIDI controllers or on-screen sliders.

![MIDI Visuals Screenshot](./docs/demo.gif)

## Features

- Real-time 3D visualization with particles and connections
- MIDI controller support for parameter adjustment
- On-screen sliders when no MIDI controller is detected
- Interactive terrain with particle physics
- Camera controls for exploring the 3D space

## Controls

- **S**: Toggle Settings
- **R**: Reset Simulation
- **P**: Pause/Play
- **M**: Toggle Mouse Control
- **C**: Toggle Control Sliders
- **Mouse Drag**: Rotate Camera
- **Mouse Wheel**: Zoom In/Out

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

## MIDI Controller Setup

Connect your MIDI controller before starting the application for automatic detection. If no MIDI controller is detected, on-screen sliders will be displayed automatically.

Default MIDI CC mappings can be adjusted in the Settings panel (press S to access).
