import * as m from './module.js';
import p5 from 'p5';
import { WebMidi } from 'webmidi';

new p5((p) => {
  // Simulation state
  let simulationState = 'running'; // 'running', 'paused', 'reset'
  let showSettings = false;
  
  // MIDI parameters
  const midiParams = {
    faderValues: [0, 0, 0, 0, 0, 0, 0, 0],
    faderMappings: [34, 35, 36, 37, 38, 39, 40, 41], // Default MIDI CC values
    paramNames: [
      'Size', 
      'Speed', 
      'Complexity', 
      'Color Hue', 
      'Brightness', 
      'Turbulence', 
      'Elasticity', 
      'Terrain Height'
    ]
  };
  
  // Organic model parameters
  let organicModel = {
    particles: [],
    numParticles: 150, // Increased number of particles for more detail
    connections: [],
    centerX: 0,
    centerY: 0,
    centerZ: 0,
    terrain: [], // Add terrain data for landscape
    terrainResolution: 30, // Resolution of the terrain grid
    terrainSize: 500, // Size of the terrain
    terrainHeight: 100 // Maximum height of terrain features
  };
  
  // Initialize WebMidi
  async function initMidi() {
    try {
      await WebMidi.enable();
      console.log("WebMidi enabled!");
      
      // List available inputs
      WebMidi.inputs.forEach(input => {
        console.log(`Input: ${input.name}`);
        
        // Listen for control change messages on all channels
        input.addListener("controlchange", e => {
          const ccNumber = e.controller.number;
          const ccValue = e.value; // Normalized value between 0 and 1
          
          // Check if this CC number is mapped to one of our parameters
          const paramIndex = midiParams.faderMappings.indexOf(ccNumber);
          if (paramIndex !== -1) {
            midiParams.faderValues[paramIndex] = ccValue;
          }
        });
      });
    } catch (err) {
      console.error("WebMidi could not be enabled:", err);
    }
  }
  
  // Create a particle for the organic model
  function createParticle() {
    // Create particles in a more landscape-like distribution
    const x = p.random(-organicModel.terrainSize/2, organicModel.terrainSize/2);
    const z = p.random(-organicModel.terrainSize/2, organicModel.terrainSize/2);
    
    // Use Perlin noise to create natural-looking height variations
    const noiseScale = 0.01;
    const y = p.map(
      p.noise(x * noiseScale, z * noiseScale), 
      0, 1, 
      -organicModel.terrainHeight/2, 
      organicModel.terrainHeight/2
    );
    
    return {
      position: p.createVector(x, y, z),
      velocity: p.createVector(p.random(-0.5, 0.5), p.random(-0.2, 0.2), p.random(-0.5, 0.5)),
      size: p.random(3, 10),
      color: p.color(p.random(255), p.random(255), p.random(255), 200),
      originalPosition: p.createVector(x, y, z)
    };
  }
  
  // Create connections between particles
  function createConnections() {
    const connections = [];
    const particles = organicModel.particles;
    
    // Connect each particle to a few nearby particles
    for (let i = 0; i < particles.length; i++) {
      const distances = [];
      
      for (let j = 0; j < particles.length; j++) {
        if (i !== j) {
          const dist = p5.Vector.dist(particles[i].position, particles[j].position);
          distances.push({ index: j, distance: dist });
        }
      }
      
      // Sort by distance
      distances.sort((a, b) => a.distance - b.distance);
      
      // Connect to the 3 closest particles
      const numConnections = Math.min(3, distances.length);
      for (let k = 0; k < numConnections; k++) {
        connections.push({
          from: i,
          to: distances[k].index,
          strength: p.random(0.01, 0.03),
          maxLength: distances[k].distance * 1.5
        });
      }
    }
    
    return connections;
  }
  
  // Generate terrain mesh
  function generateTerrain() {
    const terrain = [];
    const resolution = organicModel.terrainResolution;
    const size = organicModel.terrainSize;
    const noiseScale = 0.02;
    
    for (let x = 0; x < resolution; x++) {
      terrain[x] = [];
      for (let z = 0; z < resolution; z++) {
        const xPos = p.map(x, 0, resolution-1, -size/2, size/2);
        const zPos = p.map(z, 0, resolution-1, -size/2, size/2);
        
        // Use multiple layers of noise for more interesting terrain
        const baseNoise = p.noise(xPos * noiseScale, zPos * noiseScale);
        const detailNoise = p.noise(xPos * noiseScale * 3, zPos * noiseScale * 3) * 0.3;
        
        const height = p.map(
          baseNoise + detailNoise, 
          0, 1.3, 
          -organicModel.terrainHeight/2, 
          organicModel.terrainHeight/2
        );
        
        terrain[x][z] = {
          position: p.createVector(xPos, height, zPos),
          color: getTerrainColor(height, organicModel.terrainHeight)
        };
      }
    }
    
    return terrain;
  }
  
  // Get color based on terrain height (like a topographic map)
  function getTerrainColor(height, maxHeight) {
    p.colorMode(p.HSB, 360, 100, 100, 255);
    
    // Water (blue)
    if (height < -maxHeight * 0.3) {
      return p.color(240, 70, 80, 200);
    }
    // Beach/lowlands (yellow/tan)
    else if (height < -maxHeight * 0.1) {
      return p.color(50, 60, 90, 200);
    }
    // Plains/grasslands (green)
    else if (height < maxHeight * 0.2) {
      return p.color(120, 60, 70, 200);
    }
    // Hills (darker green)
    else if (height < maxHeight * 0.4) {
      return p.color(140, 70, 50, 200);
    }
    // Mountains (brown/gray)
    else {
      return p.color(30, 30, 60, 200);
    }
  }
  
  // Initialize the organic model
  function initOrganicModel() {
    // Generate terrain first
    organicModel.terrain = generateTerrain();
    
    // Create particles
    organicModel.particles = [];
    for (let i = 0; i < organicModel.numParticles; i++) {
      organicModel.particles.push(createParticle());
    }
    
    // Create connections between particles
    organicModel.connections = createConnections();
  }
  
  // Update the organic model based on physics and MIDI parameters
  function updateOrganicModel() {
    if (simulationState !== 'running') return;
    
    const size = p.map(midiParams.faderValues[0], 0, 1, 0.5, 2);
    const speed = p.map(midiParams.faderValues[1], 0, 1, 0.1, 2);
    const complexity = p.map(midiParams.faderValues[2], 0, 1, 0.5, 3);
    const colorHue = p.map(midiParams.faderValues[3], 0, 1, 0, 360);
    const brightness = p.map(midiParams.faderValues[4], 0, 1, 0.2, 1);
    const turbulence = p.map(midiParams.faderValues[5], 0, 1, 0, 0.1);
    const elasticity = p.map(midiParams.faderValues[6], 0, 1, 0.01, 0.1);
    const terrainHeight = p.map(midiParams.faderValues[7], 0, 1, 20, 200);
    
    // Update terrain height based on MIDI control
    if (Math.abs(organicModel.terrainHeight - terrainHeight) > 5) {
      organicModel.terrainHeight = terrainHeight;
      organicModel.terrain = generateTerrain();
    }
    
    // Update particles
    for (let i = 0; i < organicModel.particles.length; i++) {
      const particle = organicModel.particles[i];
      
      // Apply turbulence
      particle.velocity.add(
        p.createVector(
          p.random(-turbulence, turbulence),
          p.random(-turbulence, turbulence),
          p.random(-turbulence, turbulence)
        )
      );
      
      // Apply gravity towards center
      const gravityForce = p5.Vector.sub(
        p.createVector(0, 0, 0),
        particle.position
      ).normalize().mult(p.map(midiParams.faderValues[7], 0, 1, 0, 0.05));
      
      particle.velocity.add(gravityForce);
      
      // Apply elasticity (return to original position)
      const elasticForce = p5.Vector.sub(
        particle.originalPosition,
        particle.position
      ).mult(elasticity);
      
      particle.velocity.add(elasticForce);
      
      // Update position
      particle.velocity.mult(0.98); // Damping
      particle.position.add(p5.Vector.mult(particle.velocity, speed));
      
      // Update size and color
      particle.size = p.random(5, 15) * size;
      
      // Use HSB color mode for easier control
      p.colorMode(p.HSB, 360, 100, 100, 255);
      particle.color = p.color(
        (colorHue + i * complexity) % 360,
        70,
        brightness * 100,
        200
      );
      p.colorMode(p.RGB, 255, 255, 255, 255);
    }
    
    // Apply connection constraints
    for (const connection of organicModel.connections) {
      const particleA = organicModel.particles[connection.from];
      const particleB = organicModel.particles[connection.to];
      
      const direction = p5.Vector.sub(particleB.position, particleA.position);
      const distance = direction.mag();
      
      if (distance > connection.maxLength) {
        direction.normalize();
        const correction = p5.Vector.mult(direction, (distance - connection.maxLength) * connection.strength);
        
        particleA.position.add(correction);
        particleB.position.sub(correction);
      }
    }
  }
  
  // Draw the organic model
  function drawOrganicModel() {
    p.push();
    p.translate(p.width/2, p.height/2, 0);
    
    // Draw terrain
    drawTerrain();
    
    // Draw connections
    p.stroke(255, 100);
    p.strokeWeight(1);
    
    for (const connection of organicModel.connections) {
      const particleA = organicModel.particles[connection.from];
      const particleB = organicModel.particles[connection.to];
      
      p.line(
        particleA.position.x, particleA.position.y, particleA.position.z,
        particleB.position.x, particleB.position.y, particleB.position.z
      );
    }
    
    // Draw particles
    p.noStroke();
    for (const particle of organicModel.particles) {
      p.push();
      p.translate(particle.position.x, particle.position.y, particle.position.z);
      p.fill(particle.color);
      p.sphere(particle.size);
      p.pop();
    }
    
    p.pop();
  }
  
  // Draw the terrain mesh
  function drawTerrain() {
    const terrain = organicModel.terrain;
    const resolution = organicModel.terrainResolution;
    
    // Draw terrain as triangles
    for (let x = 0; x < resolution-1; x++) {
      for (let z = 0; z < resolution-1; z++) {
        // Each grid cell is made of two triangles
        p.beginShape(p.TRIANGLES);
        
        // First triangle
        p.fill(terrain[x][z].color);
        p.vertex(
          terrain[x][z].position.x,
          terrain[x][z].position.y,
          terrain[x][z].position.z
        );
        
        p.fill(terrain[x+1][z].color);
        p.vertex(
          terrain[x+1][z].position.x,
          terrain[x+1][z].position.y,
          terrain[x+1][z].position.z
        );
        
        p.fill(terrain[x][z+1].color);
        p.vertex(
          terrain[x][z+1].position.x,
          terrain[x][z+1].position.y,
          terrain[x][z+1].position.z
        );
        
        p.endShape();
        
        // Second triangle
        p.beginShape(p.TRIANGLES);
        
        p.fill(terrain[x+1][z].color);
        p.vertex(
          terrain[x+1][z].position.x,
          terrain[x+1][z].position.y,
          terrain[x+1][z].position.z
        );
        
        p.fill(terrain[x+1][z+1].color);
        p.vertex(
          terrain[x+1][z+1].position.x,
          terrain[x+1][z+1].position.y,
          terrain[x+1][z+1].position.z
        );
        
        p.fill(terrain[x][z+1].color);
        p.vertex(
          terrain[x][z+1].position.x,
          terrain[x][z+1].position.y,
          terrain[x][z+1].position.z
        );
        
        p.endShape();
      }
    }
  }
  
  // Create settings UI as HTML
  function createSettingsUI() {
    const settingsDiv = document.createElement('div');
    settingsDiv.id = 'settings-panel';
    settingsDiv.style.display = 'none';
    settingsDiv.style.position = 'absolute';
    settingsDiv.style.top = '0';
    settingsDiv.style.left = '0';
    settingsDiv.style.width = '100%';
    settingsDiv.style.height = '100%';
    settingsDiv.style.backgroundColor = 'rgba(0, 0, 0, 0.8)';
    settingsDiv.style.color = 'white';
    settingsDiv.style.fontFamily = 'Arial, sans-serif';
    settingsDiv.style.zIndex = '1000';
    settingsDiv.style.padding = '20px';
    settingsDiv.style.boxSizing = 'border-box';
    settingsDiv.style.overflow = 'auto';
    
    let html = `
      <h1 style="text-align: center; margin-bottom: 30px;">MIDI Settings</h1>
      <table style="width: 80%; margin: 0 auto; border-collapse: collapse;">
        <tr>
          <th style="text-align: left; padding: 10px;">Parameter</th>
          <th style="text-align: center; padding: 10px;">MIDI CC</th>
          <th style="text-align: left; padding: 10px;">Value</th>
        </tr>
    `;
    
    for (let i = 0; i < 8; i++) {
      html += `
        <tr>
          <td style="padding: 10px;">${midiParams.paramNames[i]}</td>
          <td style="padding: 10px; text-align: center;">
            <input type="number" id="midi-cc-${i}" value="${midiParams.faderMappings[i]}" 
              style="width: 60px; text-align: center; background: #333; color: white; border: 1px solid #555;"
              onchange="updateMidiMapping(${i}, this.value)">
          </td>
          <td style="padding: 10px;">
            <div style="width: 200px; height: 20px; background: #333; position: relative;">
              <div id="midi-value-bar-${i}" style="height: 100%; background: #4a90e2; width: ${midiParams.faderValues[i] * 100}%;"></div>
            </div>
            <span id="midi-value-text-${i}" style="margin-left: 10px;">${Math.round(midiParams.faderValues[i] * 100)}%</span>
          </td>
        </tr>
      `;
    }
    
    html += `
      </table>
      <div style="text-align: center; margin-top: 30px;">
        <div style="margin: 20px 0;">
          <h3>Keyboard Shortcuts</h3>
          <div style="display: inline-block; margin: 10px; padding: 10px; border: 1px solid #555; border-radius: 5px;">
            <strong>S</strong> - Toggle Settings
          </div>
          <div style="display: inline-block; margin: 10px; padding: 10px; border: 1px solid #555; border-radius: 5px;">
            <strong>R</strong> - Reset Simulation
          </div>
          <div style="display: inline-block; margin: 10px; padding: 10px; border: 1px solid #555; border-radius: 5px;">
            <strong>P</strong> - Pause/Play
          </div>
        </div>
        <button id="close-settings" style="padding: 10px 20px; background: #4a90e2; color: white; border: none; border-radius: 5px; cursor: pointer;">
          Close Settings
        </button>
      </div>
    `;
    
    settingsDiv.innerHTML = html;
    document.body.appendChild(settingsDiv);
    
    // Add event listener to close button
    document.getElementById('close-settings').addEventListener('click', () => {
      toggleSettings();
    });
    
    // Add global function to update MIDI mappings
    window.updateMidiMapping = (index, value) => {
      midiParams.faderMappings[index] = parseInt(value, 10);
    };
  }
  
  // Toggle settings visibility
  function toggleSettings() {
    showSettings = !showSettings;
    const settingsPanel = document.getElementById('settings-panel');
    if (settingsPanel) {
      settingsPanel.style.display = showSettings ? 'block' : 'none';
    }
  }
  
  // Update settings UI with current values
  function updateSettingsUI() {
    if (!showSettings) return;
    
    for (let i = 0; i < 8; i++) {
      const valueBar = document.getElementById(`midi-value-bar-${i}`);
      const valueText = document.getElementById(`midi-value-text-${i}`);
      
      if (valueBar && valueText) {
        valueBar.style.width = `${midiParams.faderValues[i] * 100}%`;
        valueText.textContent = `${Math.round(midiParams.faderValues[i] * 100)}%`;
      }
    }
  }
  
  // Create status bar as HTML
  function createStatusBar() {
    const statusBar = document.createElement('div');
    statusBar.id = 'status-bar';
    statusBar.style.position = 'absolute';
    statusBar.style.bottom = '0';
    statusBar.style.left = '0';
    statusBar.style.width = '100%';
    statusBar.style.height = '30px';
    statusBar.style.backgroundColor = 'rgba(0, 0, 0, 0.6)';
    statusBar.style.color = 'white';
    statusBar.style.fontFamily = 'Arial, sans-serif';
    statusBar.style.zIndex = '999';
    statusBar.style.display = 'flex';
    statusBar.style.justifyContent = 'space-between';
    statusBar.style.alignItems = 'center';
    statusBar.style.padding = '0 20px';
    statusBar.style.boxSizing = 'border-box';
    
    const statusText = document.createElement('div');
    statusText.id = 'simulation-status';
    statusText.textContent = `Simulation: ${simulationState.toUpperCase()}`;
    
    const controlsText = document.createElement('div');
    controlsText.textContent = 'S: Settings | R: Reset | P: Pause/Play';
    
    statusBar.appendChild(statusText);
    statusBar.appendChild(controlsText);
    document.body.appendChild(statusBar);
  }
  
  // Update status bar with current state
  function updateStatusBar() {
    const statusText = document.getElementById('simulation-status');
    if (statusText) {
      statusText.textContent = `Simulation: ${simulationState.toUpperCase()}`;
    }
  }
  
  // Set up keyboard shortcuts using DOM events
  function setupKeyboardShortcuts() {
    document.addEventListener('keydown', (event) => {
      if (event.key === 's' || event.key === 'S') {
        toggleSettings();
      } else if (event.key === 'r' || event.key === 'R') {
        simulationState = 'reset';
        initOrganicModel();
        simulationState = 'running';
        updateStatusBar();
      } else if (event.key === 'p' || event.key === 'P') {
        simulationState = simulationState === 'running' ? 'paused' : 'running';
        updateStatusBar();
      }
    });
  }
  
  p.setup = () => {
    p.createCanvas(p.windowWidth, p.windowHeight, p.WEBGL);
    initMidi();
    initOrganicModel();
    createSettingsUI();
    createStatusBar();
    setupKeyboardShortcuts();
  };

  p.draw = () => {
    p.background(20);
    
    // Enable lighting for 3D
    p.ambientLight(60, 60, 60);
    p.pointLight(255, 255, 255, 0, 0, 300);
    p.directionalLight(200, 200, 200, 0.5, 1, -0.5);
    
    // Create a camera view that looks at the landscape from an angle
    const camRadius = 800;
    const camX = camRadius * Math.sin(p.frameCount * 0.001);
    const camZ = camRadius * Math.cos(p.frameCount * 0.001);
    const camY = 300;
    
    p.camera(
      camX, camY, camZ,  // Camera position
      0, 0, 0,           // Look at center
      0, 1, 0            // Up vector
    );
    
    updateOrganicModel();
    drawOrganicModel();
    
    // Update HTML UI elements
    updateSettingsUI();
  };

  p.windowResized = () => {
    p.resizeCanvas(p.windowWidth, p.windowHeight);
  };
});
