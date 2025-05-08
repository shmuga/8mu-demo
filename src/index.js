import * as m from './module.js';
import p5 from 'p5';
import { WebMidi } from 'webmidi';

new p5((p) => {
  // Simulation state
  let simulationState = 'running'; // 'running', 'paused', 'reset'
  let showSettings = false;
  let lastChangedParam = null;
  let paramChangeTimer = 0;
  
  // MIDI parameters
  const midiParams = {
    faderValues: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    smoothedValues: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], // For smoothed gesture values
    faderMappings: [34, 35, 36, 37, 38, 39, 40, 41, 42, 43, 44, 45, 46, 47], // Default MIDI CC values
    paramNames: [
      'Size', 
      'Speed', 
      'Complexity', 
      'Color Hue', 
      'Randomness', // Changed from Brightness to Randomness
      'Particle Density', 
      'Connection Density', 
      'Terrain Height',
      'Tilt Front', // CC 42
      'Tilt Back',  // CC 43
      'Lift Right', // CC 44
      'Lift Left',  // CC 45
      'Rotate Right', // CC 46
      'Rotate Left'   // CC 47
    ],
    smoothingFactor: 0.15 // Controls how quickly gesture values change (0-1)
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
    terrainHeight: 100, // Maximum height of terrain features
    particleDensity: 0.5, // Control particle density
    connectionDensity: 0.5 // Control connection density
  };
  
  // Physics parameters
  const turbulence = 0.05; // Controls random movement
  const elasticity = 0.01; // Controls how particles return to original positions
  
  // Camera parameters
  let cameraParams = {
    radius: 1000,
    height: 800, // Adjusted for 45-degree view
    autoRotate: true,
    rotationSpeed: 0.001,
    tiltAngle: 0,
    liftAngle: 0,
    rotationOffset: 0,
    orbitAngle: 0 // New parameter for vertical orbit
  };
  
  // Force parameters
  let forceParams = {
    vortexStrength: 0,
    gravityStrength: 0
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
            
            // Show parameter change notification
            showParamChangeNotification(paramIndex, ccValue);
          }
        });
      });
    } catch (err) {
      console.error("WebMidi could not be enabled:", err);
    }
  }
  
  // Show parameter change notification
  function showParamChangeNotification(paramIndex, value) {
    const isGesture = paramIndex >= 8; // Parameters 8-13 are gestures
    
    // Update the appropriate notification panel
    if (isGesture) {
      updateGesturePanel(paramIndex, value);
    } else {
      updateParameterPanel(paramIndex, value);
    }
    
    // Store the last changed parameter
    lastChangedParam = {
      index: paramIndex,
      value: value,
      isGesture: isGesture
    };
    
    // Reset the timer
    paramChangeTimer = 120; // Show for about 2 seconds (60 frames per second)
  }
  
  // Update the parameter panel on the left
  function updateParameterPanel(paramIndex, value) {
    const panel = document.getElementById('parameter-panel');
    if (panel) {
      const paramName = midiParams.paramNames[paramIndex];
      const valuePercent = Math.round(value * 100);
      
      // Update or create the parameter display
      let paramDisplay = document.getElementById(`param-display-${paramIndex}`);
      if (!paramDisplay) {
        paramDisplay = document.createElement('div');
        paramDisplay.id = `param-display-${paramIndex}`;
        paramDisplay.className = 'param-display';
        panel.appendChild(paramDisplay);
      }
      
      paramDisplay.innerHTML = `
        <div class="param-name">${paramName}</div>
        <div class="param-value-bar">
          <div class="param-value-fill" style="width: ${valuePercent}%"></div>
        </div>
        <div class="param-value-text">${valuePercent}%</div>
      `;
      
      // Make sure the panel is visible
      panel.style.opacity = '1';
    }
  }
  
  // Update the gesture panel on the right
  function updateGesturePanel(paramIndex, value) {
    const panel = document.getElementById('gesture-panel');
    if (panel) {
      const paramName = midiParams.paramNames[paramIndex];
      const valuePercent = Math.round(value * 100);
      
      // Update or create the gesture display
      let gestureDisplay = document.getElementById(`gesture-display-${paramIndex}`);
      if (!gestureDisplay) {
        gestureDisplay = document.createElement('div');
        gestureDisplay.id = `gesture-display-${paramIndex}`;
        gestureDisplay.className = 'gesture-display';
        panel.appendChild(gestureDisplay);
      }
      
      gestureDisplay.innerHTML = `
        <div class="gesture-name">${paramName}</div>
        <div class="gesture-value-bar">
          <div class="gesture-value-fill" style="width: ${valuePercent}%"></div>
        </div>
        <div class="gesture-value-text">${valuePercent}%</div>
      `;
      
      // Make sure the panel is visible
      panel.style.opacity = '1';
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
      
      // Connect to the closest particles based on connection density
      const maxPossibleConnections = Math.min(5, distances.length);
      const numConnections = Math.max(1, Math.floor(maxPossibleConnections * organicModel.connectionDensity));
      
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
  
  // Check if a particle collides with the terrain
  function checkTerrainCollision(particle) {
    const terrain = organicModel.terrain;
    const resolution = organicModel.terrainResolution;
    const size = organicModel.terrainSize;
    
    // Convert particle position to terrain grid coordinates
    const gridX = Math.floor(p.map(particle.position.x, -size/2, size/2, 0, resolution-1));
    const gridZ = Math.floor(p.map(particle.position.z, -size/2, size/2, 0, resolution-1));
    
    // Check if particle is within terrain bounds
    if (gridX >= 0 && gridX < resolution-1 && gridZ >= 0 && gridZ < resolution-1) {
      // Get the four terrain points around the particle
      const p00 = terrain[gridX][gridZ].position;
      const p10 = terrain[gridX+1][gridZ].position;
      const p01 = terrain[gridX][gridZ+1].position;
      const p11 = terrain[gridX+1][gridZ+1].position;
      
      // Interpolate to find the exact terrain height at particle's xz position
      const xRatio = p.map(particle.position.x, p00.x, p10.x, 0, 1);
      const zRatio = p.map(particle.position.z, p00.z, p01.z, 0, 1);
      
      const h1 = p.lerp(p00.y, p10.y, xRatio);
      const h2 = p.lerp(p01.y, p11.y, xRatio);
      const terrainHeight = p.lerp(h1, h2, zRatio);
      
      // Calculate surface normal for bounce reflection
      const v1 = p5.Vector.sub(p10, p00);
      const v2 = p5.Vector.sub(p01, p00);
      const normal = v1.cross(v2).normalize();
      
      // Check if particle is below terrain surface (with a small buffer for particle size)
      if (particle.position.y < terrainHeight + particle.size * 0.5) {
        return {
          collision: true,
          normal: normal,
          terrainHeight: terrainHeight
        };
      }
    }
    
    // No collision
    return {
      collision: false,
      normal: p.createVector(0, 1, 0),
      terrainHeight: -Infinity
    };
  }
  
  // Initialize the organic model
  function initOrganicModel() {
    // Generate terrain first
    organicModel.terrain = generateTerrain();
    
    // Create particles
    organicModel.particles = [];
    const actualParticles = Math.floor(organicModel.numParticles * organicModel.particleDensity);
    for (let i = 0; i < actualParticles; i++) {
      organicModel.particles.push(createParticle());
    }
    
    // Create connections between particles
    organicModel.connections = createConnections();
  }
  
  // Smooth gesture values
  function smoothGestureValues() {
    // Only smooth gesture values (indices 8-13)
    for (let i = 8; i < midiParams.faderValues.length; i++) {
      midiParams.smoothedValues[i] = midiParams.smoothedValues[i] + 
        (midiParams.faderValues[i] - midiParams.smoothedValues[i]) * midiParams.smoothingFactor;
    }
    
    // Copy non-gesture values directly
    for (let i = 0; i < 8; i++) {
      midiParams.smoothedValues[i] = midiParams.faderValues[i];
    }
  }
  
  // Update the organic model based on physics and MIDI parameters
  function updateOrganicModel() {
    if (simulationState !== 'running') return;
    
    // Smooth gesture values
    smoothGestureValues();
    
    const size = p.map(midiParams.smoothedValues[0], 0, 1, 0.5, 2);
    const speed = p.map(midiParams.smoothedValues[1], 0, 1, 0.1, 2);
    const complexity = p.map(midiParams.smoothedValues[2], 0, 1, 0.5, 3);
    const colorHue = p.map(midiParams.smoothedValues[3], 0, 1, 0, 360);
    const randomness = p.map(midiParams.smoothedValues[4], 0, 1, 0.01, 0.2); // Brightness now controls randomness
    const particleDensity = p.map(midiParams.smoothedValues[5], 0, 1, 0.2, 1);
    const connectionDensity = p.map(midiParams.smoothedValues[6], 0, 1, 0.2, 1);
    const terrainHeight = p.map(midiParams.smoothedValues[7], 0, 1, 20, 200);
    
    // Update camera parameters based on MIDI controls (using smoothed values)
    const tiltFront = midiParams.smoothedValues[8];
    const tiltBack = midiParams.smoothedValues[9];
    const liftRight = midiParams.smoothedValues[10];
    const liftLeft = midiParams.smoothedValues[11];
    const rotateRight = midiParams.smoothedValues[12];
    const rotateLeft = midiParams.smoothedValues[13];
    
    // Calculate net tilt (front-back) - accumulate for continuous rotation
    const tiltDelta = p.map(tiltFront - tiltBack, -1, 1, -0.01, 0.01);
    cameraParams.tiltAngle += tiltDelta;
    
    // Calculate net lift (right-left) - accumulate for continuous rotation
    const liftDelta = p.map(liftRight - liftLeft, -1, 1, -0.01, 0.01);
    cameraParams.liftAngle += liftDelta;
    
    // Calculate rotation offset (right-left) - accumulate for continuous rotation
    const rotationDelta = p.map(rotateRight - rotateLeft, -1, 1, -0.01, 0.01);
    cameraParams.rotationOffset += rotationDelta;
    
    // Update orbit angle for vertical rotation
    cameraParams.orbitAngle = cameraParams.tiltAngle;
    
    // Update force parameters
    forceParams.vortexStrength = p.map(tiltFront + tiltBack, 0, 2, 0, 0.05);
    forceParams.gravityStrength = p.map(liftRight + liftLeft, 0, 2, 0, 0.1);
    
    // Update terrain height based on MIDI control
    if (Math.abs(organicModel.terrainHeight - terrainHeight) > 5) {
      organicModel.terrainHeight = terrainHeight;
      organicModel.terrain = generateTerrain();
    }
    
    // Update particle and connection density if changed significantly
    if (Math.abs(organicModel.particleDensity - particleDensity) > 0.1 ||
        Math.abs(organicModel.connectionDensity - connectionDensity) > 0.1) {
      organicModel.particleDensity = particleDensity;
      organicModel.connectionDensity = connectionDensity;
      
      // Reinitialize with new densities
      const oldParticles = organicModel.particles.slice();
      initOrganicModel();
      
      // Transfer positions from old particles to maintain continuity
      const minLength = Math.min(oldParticles.length, organicModel.particles.length);
      for (let i = 0; i < minLength; i++) {
        organicModel.particles[i].position = oldParticles[i].position.copy();
        organicModel.particles[i].velocity = oldParticles[i].velocity.copy();
      }
    }
    
    // Update particles
    for (let i = 0; i < organicModel.particles.length; i++) {
      const particle = organicModel.particles[i];
      
      // Apply turbulence with randomness parameter
      particle.velocity.add(
        p.createVector(
          p.random(-turbulence - randomness, turbulence + randomness),
          p.random(-turbulence - randomness, turbulence + randomness),
          p.random(-turbulence - randomness, turbulence + randomness)
        )
      );
      
      // Apply gravity towards center
      const gravityForce = p5.Vector.sub(
        p.createVector(0, 0, 0),
        particle.position
      ).normalize().mult(p.map(midiParams.faderValues[7], 0, 1, 0, 0.05) + forceParams.gravityStrength);
      
      particle.velocity.add(gravityForce);
      
      // Apply vortex force (circular motion around y-axis)
      if (forceParams.vortexStrength > 0) {
        const vortexForce = p.createVector(
          -particle.position.z,
          0,
          particle.position.x
        ).normalize().mult(forceParams.vortexStrength);
        
        particle.velocity.add(vortexForce);
      }
      
      // Apply elasticity (return to original position)
      const elasticForce = p5.Vector.sub(
        particle.originalPosition,
        particle.position
      ).mult(elasticity);
      
      particle.velocity.add(elasticForce);
      
      // Add random movement based on randomness parameter
      if (randomness > 0.05) {
        // Add more chaotic movement when randomness is high
        const randomForce = p.createVector(
          p.random(-1, 1),
          p.random(-1, 1),
          p.random(-1, 1)
        ).normalize().mult(randomness * 2);
        
        particle.velocity.add(randomForce);
      }
      
      // Update position
      particle.velocity.mult(0.98); // Damping
      particle.position.add(p5.Vector.mult(particle.velocity, speed));
      
      // Check for collision with terrain and bounce
      const terrainCollision = checkTerrainCollision(particle);
      if (terrainCollision.collision) {
        // Bounce off the terrain surface
        const bounceForce = terrainCollision.normal.mult(0.2);
        particle.velocity.reflect(terrainCollision.normal);
        particle.velocity.mult(0.8); // Reduce velocity after bounce
        particle.position.add(bounceForce); // Push away from surface
      }
      
      // Update size and color
      particle.size = p.random(5, 15) * size;
      
      // Use HSB color mode for easier control
      p.colorMode(p.HSB, 360, 100, 100, 255);
      particle.color = p.color(
        (colorHue + i * complexity) % 360,
        70,
        80, // Fixed brightness value since we're using the parameter for randomness
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
      <div style="display: flex; justify-content: center; margin-bottom: 20px;">
        <div style="margin: 0 10px;">
          <button id="toggle-camera-rotation" style="padding: 8px 15px; background: #4a90e2; color: white; border: none; border-radius: 5px; cursor: pointer;">
            Toggle Camera Auto-Rotation
          </button>
        </div>
      </div>
      
      <!-- Simulation Controls Section -->
      <h2 style="text-align: center; margin: 20px 0; color: #4a90e2;">Simulation Controls</h2>
      <table style="width: 80%; margin: 0 auto; border-collapse: collapse;">
        <tr>
          <th style="text-align: left; padding: 10px;">Parameter</th>
          <th style="text-align: center; padding: 10px;">MIDI CC</th>
          <th style="text-align: left; padding: 10px;">Value</th>
        </tr>
    `;
    
    // First add simulation controls (parameters 0-7)
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
      
      <!-- Gesture Controls Section -->
      <h2 style="text-align: center; margin: 20px 0; color: #e24a4a;">Gesture Controls</h2>
      <table style="width: 80%; margin: 0 auto; border-collapse: collapse;">
        <tr>
          <th style="text-align: left; padding: 10px;">Parameter</th>
          <th style="text-align: center; padding: 10px;">MIDI CC</th>
          <th style="text-align: left; padding: 10px;">Value</th>
        </tr>
    `;
    
    // Then add gesture controls (parameters 8-13)
    for (let i = 8; i < midiParams.paramNames.length; i++) {
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
              <div id="midi-value-bar-${i}" style="height: 100%; background: #e24a4a; width: ${midiParams.faderValues[i] * 100}%;"></div>
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
    
    // Add event listeners
    document.getElementById('close-settings').addEventListener('click', () => {
      toggleSettings();
    });
    
    document.getElementById('toggle-camera-rotation').addEventListener('click', () => {
      cameraParams.autoRotate = !cameraParams.autoRotate;
      document.getElementById('toggle-camera-rotation').textContent = 
        cameraParams.autoRotate ? 'Disable Camera Auto-Rotation' : 'Enable Camera Auto-Rotation';
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
    
    for (let i = 0; i < midiParams.paramNames.length; i++) {
      const valueBar = document.getElementById(`midi-value-bar-${i}`);
      const valueText = document.getElementById(`midi-value-text-${i}`);
      
      if (valueBar && valueText) {
        valueBar.style.width = `${midiParams.faderValues[i] * 100}%`;
        valueText.textContent = `${Math.round(midiParams.faderValues[i] * 100)}%`;
      }
    }
  }
  
  // Create status bar and parameter panels as HTML
  function createStatusBar() {
    // Create status bar
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
    
    // Create parameter panel (left side)
    const parameterPanel = document.createElement('div');
    parameterPanel.id = 'parameter-panel';
    parameterPanel.style.position = 'absolute';
    parameterPanel.style.top = '20px';
    parameterPanel.style.left = '20px';
    parameterPanel.style.width = '220px';
    parameterPanel.style.backgroundColor = 'rgba(0, 0, 0, 0.7)';
    parameterPanel.style.color = 'white';
    parameterPanel.style.fontFamily = 'Arial, sans-serif';
    parameterPanel.style.borderRadius = '5px';
    parameterPanel.style.zIndex = '999';
    parameterPanel.style.padding = '15px';
    parameterPanel.style.transition = 'opacity 0.5s';
    parameterPanel.style.opacity = '0';
    
    // Add title to parameter panel
    const paramTitle = document.createElement('div');
    paramTitle.textContent = 'SIMULATION CONTROLS';
    paramTitle.style.textAlign = 'center';
    paramTitle.style.fontWeight = 'bold';
    paramTitle.style.marginBottom = '10px';
    paramTitle.style.color = '#4a90e2';
    parameterPanel.appendChild(paramTitle);
    
    document.body.appendChild(parameterPanel);
    
    // Create gesture panel (right side)
    const gesturePanel = document.createElement('div');
    gesturePanel.id = 'gesture-panel';
    gesturePanel.style.position = 'absolute';
    gesturePanel.style.top = '20px';
    gesturePanel.style.right = '20px';
    gesturePanel.style.width = '220px';
    gesturePanel.style.backgroundColor = 'rgba(0, 0, 0, 0.7)';
    gesturePanel.style.color = 'white';
    gesturePanel.style.fontFamily = 'Arial, sans-serif';
    gesturePanel.style.borderRadius = '5px';
    gesturePanel.style.zIndex = '999';
    gesturePanel.style.padding = '15px';
    gesturePanel.style.transition = 'opacity 0.5s';
    gesturePanel.style.opacity = '0';
    
    // Add title to gesture panel
    const gestureTitle = document.createElement('div');
    gestureTitle.textContent = 'GESTURE CONTROLS';
    gestureTitle.style.textAlign = 'center';
    gestureTitle.style.fontWeight = 'bold';
    gestureTitle.style.marginBottom = '10px';
    gestureTitle.style.color = '#e24a4a';
    gesturePanel.appendChild(gestureTitle);
    
    document.body.appendChild(gesturePanel);
    
    // Add CSS for parameter and gesture displays
    const style = document.createElement('style');
    style.textContent = `
      .param-display, .gesture-display {
        margin-bottom: 12px;
      }
      .param-name, .gesture-name {
        font-size: 12px;
        margin-bottom: 4px;
      }
      .param-value-bar, .gesture-value-bar {
        height: 8px;
        background-color: #333;
        border-radius: 4px;
        overflow: hidden;
        margin-bottom: 2px;
      }
      .param-value-fill {
        height: 100%;
        background-color: #4a90e2;
        border-radius: 4px;
      }
      .gesture-value-fill {
        height: 100%;
        background-color: #e24a4a;
        border-radius: 4px;
      }
      .param-value-text, .gesture-value-text {
        font-size: 10px;
        text-align: right;
      }
    `;
    document.head.appendChild(style);
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
      
      // Number keys 1-9 to manually adjust parameters
      const numKey = parseInt(event.key);
      if (!isNaN(numKey) && numKey >= 1 && numKey <= midiParams.paramNames.length) {
        const paramIndex = numKey - 1;
        let newValue = midiParams.faderValues[paramIndex];
        
        if (event.shiftKey) {
          // Decrease value with Shift+number
          newValue = Math.max(0, newValue - 0.1);
        } else {
          // Increase value with number
          newValue = Math.min(1, newValue + 0.1);
        }
        
        midiParams.faderValues[paramIndex] = newValue;
        showParamChangeNotification(paramIndex, newValue);
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
    
    // Create a camera view that can rotate 360 degrees in all directions
    let horizontalAngle = cameraParams.autoRotate ? p.frameCount * cameraParams.rotationSpeed : 0;
    horizontalAngle += cameraParams.rotationOffset; // Add horizontal rotation from MIDI controls
    
    // Calculate camera position using spherical coordinates for full 360-degree movement
    const verticalAngle = cameraParams.orbitAngle;
    
    // Convert spherical to Cartesian coordinates
    const camX = cameraParams.radius * Math.cos(verticalAngle) * Math.sin(horizontalAngle);
    const camY = cameraParams.radius * Math.sin(verticalAngle);
    const camZ = cameraParams.radius * Math.cos(verticalAngle) * Math.cos(horizontalAngle);
    
    // Apply additional lift adjustment
    const liftAxis = p.createVector(
      Math.cos(horizontalAngle + Math.PI/2),
      0,
      Math.cos(horizontalAngle)
    ).normalize();
    
    const liftAmount = cameraParams.liftAngle * cameraParams.radius * 0.5;
    const liftOffset = p5.Vector.mult(liftAxis, liftAmount);
    
    p.camera(
      camX + liftOffset.x, camY + liftOffset.y, camZ + liftOffset.z,  // Camera position
      0, 0, 0,                                                        // Look at center
      0, 1, 0                                                         // Up vector
    );
    
    // Center the model at origin
    p.push();
    p.translate(0, 0, 0);
    
    updateOrganicModel();
    drawOrganicModel();
    
    p.pop();
    
    // Update HTML UI elements
    updateSettingsUI();
    
    // Update parameter panels
    if (paramChangeTimer > 0) {
      paramChangeTimer--;
      
      // Fade out when timer is low
      if (paramChangeTimer < 30) {
        const paramPanel = document.getElementById('parameter-panel');
        const gesturePanel = document.getElementById('gesture-panel');
        
        if (paramPanel) {
          paramPanel.style.opacity = paramChangeTimer / 30;
        }
        
        if (gesturePanel) {
          gesturePanel.style.opacity = paramChangeTimer / 30;
        }
      }
    }
  };

  p.windowResized = () => {
    p.resizeCanvas(p.windowWidth, p.windowHeight);
  };
});
