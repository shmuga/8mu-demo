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
    connectionDensity: 0.5, // Control connection density
    particlesToAdd: [], // Queue of particles to add
    particlesToRemove: [], // Queue of particles to remove
    minParticles: 10 // Minimum number of particles before spawning more
  };
  
  // Physics parameters
  const turbulence = 0.05; // Controls random movement
  const elasticity = 0.01; // Controls how particles return to original positions
  
  // Camera parameters
  let cameraParams = {
    radius: -300,
    height: -200, // Higher position to look down
    autoRotate: true,
    rotationSpeed: 0.0005, // Slower rotation
    zRotation: Math.PI, // Rotation around Z axis (tilt front/back) - 180 degrees
    xRotation: 0, // Rotation around X axis (lift right/left)
    yRotation: Math.PI * 1.25, // Rotation around Y axis (rotate right/left) - added 180 degrees
    mouseControl: false, // Flag to enable/disable mouse control
    mouseX: 0,
    mouseY: 0,
    targetYRotation: Math.PI * 1.25 // Added 180 degrees
  };
  
  // Force parameters
  let forceParams = {
    vortexStrength: 0,
    gravityStrength: 10
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
      const ccValue = midiParams.faderMappings[paramIndex];
      
      // Update or create the parameter display
      let paramDisplay = document.getElementById(`param-display-${paramIndex}`);
      if (!paramDisplay) {
        // Create new display element
        paramDisplay = document.createElement('div');
        paramDisplay.id = `param-display-${paramIndex}`;
        paramDisplay.className = 'param-display';
        paramDisplay.dataset.ccValue = ccValue; // Store CC value for sorting
        
        // Insert in sorted order based on CC value
        let inserted = false;
        Array.from(panel.children).forEach((child, index) => {
          if (index === 0) return; // Skip the title element
          
          const childCcValue = parseInt(child.dataset.ccValue || '0');
          if (!inserted && ccValue < childCcValue) {
            panel.insertBefore(paramDisplay, child);
            inserted = true;
          }
        });
        
        // If not inserted, append to the end
        if (!inserted) {
          panel.appendChild(paramDisplay);
        }
      }
      
      paramDisplay.innerHTML = `
        <div class="param-name">${paramName} (CC ${ccValue})</div>
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
      const ccValue = midiParams.faderMappings[paramIndex];
      
      // Update or create the gesture display
      let gestureDisplay = document.getElementById(`gesture-display-${paramIndex}`);
      if (!gestureDisplay) {
        // Create new display element
        gestureDisplay = document.createElement('div');
        gestureDisplay.id = `gesture-display-${paramIndex}`;
        gestureDisplay.className = 'gesture-display';
        gestureDisplay.dataset.ccValue = ccValue; // Store CC value for sorting
        
        // Insert in sorted order based on CC value
        let inserted = false;
        Array.from(panel.children).forEach((child, index) => {
          if (index === 0) return; // Skip the title element
          
          const childCcValue = parseInt(child.dataset.ccValue || '0');
          if (!inserted && ccValue < childCcValue) {
            panel.insertBefore(gestureDisplay, child);
            inserted = true;
          }
        });
        
        // If not inserted, append to the end
        if (!inserted) {
          panel.appendChild(gestureDisplay);
        }
      }
      
      gestureDisplay.innerHTML = `
        <div class="gesture-name">${paramName} (CC ${ccValue})</div>
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
  function createParticle(x, y, z) {
    // If position is not provided, create random position
    if (x === undefined || y === undefined || z === undefined) {
      x = p.random(-organicModel.terrainSize/2, organicModel.terrainSize/2);
      z = p.random(-organicModel.terrainSize/2, organicModel.terrainSize/2);
      
      // Use Perlin noise to create natural-looking height variations
      const noiseScale = 0.01;
      y = p.map(
        p.noise(x * noiseScale, z * noiseScale), 
        0, 1, 
        -organicModel.terrainHeight/2, 
        organicModel.terrainHeight/2
      );
    }
    
    // Generate a fixed size based on position for stability
    const sizeNoise = p.noise(x * 0.05, z * 0.05);
    const fixedSize = p.map(sizeNoise, 0, 1, 4, 12);
    
    // Generate a stable, accessible color based on position
    // Use a more limited color palette with good contrast
    const colorSeed = p.noise(x * 0.02, z * 0.02);
    let hue, sat, bri;
    
    // Create a palette of 5 distinct, accessible colors
    if (colorSeed < 0.2) {
      // Teal
      hue = 180;
      sat = 60;
      bri = 80;
    } else if (colorSeed < 0.4) {
      // Gold
      hue = 45;
      sat = 70;
      bri = 85;
    } else if (colorSeed < 0.6) {
      // Purple
      hue = 270;
      sat = 50;
      bri = 75;
    } else if (colorSeed < 0.8) {
      // Green
      hue = 120;
      sat = 40;
      bri = 70;
    } else {
      // Coral
      hue = 15;
      sat = 65;
      bri = 90;
    }
    
    p.colorMode(p.HSB, 360, 100, 100, 255);
    const stableColor = p.color(hue, sat, bri, 220);
    p.colorMode(p.RGB, 255, 255, 255, 255);
    
    // Create control points for Bezier motion
    const controlPoints = [];
    for (let i = 0; i < 4; i++) {
      controlPoints.push({
        x: x + p.random(-50, 50),
        y: y + p.random(-30, 30),
        z: z + p.random(-50, 50)
      });
    }
    
    return {
      position: p.createVector(x, y, z),
      velocity: p.createVector(p.random(-0.5, 0.5), p.random(-0.2, 0.2), p.random(-0.5, 0.5)),
      size: fixedSize,
      fixedSize: fixedSize, // Store the fixed size to prevent animation
      color: stableColor,
      originalPosition: p.createVector(x, y, z),
      controlPoints: controlPoints,
      bezierT: 0, // Parameter for Bezier curve (0-1)
      bezierDirection: 1, // Direction of movement along curve
      noiseOffset: p.random(1000), // Unique offset for Perlin noise
      terrainHits: 0, // Count how many times this particle has hit the terrain
      lastCollisionTime: 0 // Track when the last collision happened
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
  
  // Get color based on terrain height with neutral, accessible colors
  function getTerrainColor(height, maxHeight) {
    p.colorMode(p.HSB, 360, 100, 100, 255);
    
    // Deep water (muted blue-gray)
    if (height < -maxHeight * 0.3) {
      return p.color(210, 30, 50, 200);
    }
    // Shallow water (light gray-blue)
    else if (height < -maxHeight * 0.1) {
      return p.color(200, 20, 70, 200);
    }
    // Low ground (light beige)
    else if (height < maxHeight * 0.2) {
      return p.color(40, 20, 85, 200);
    }
    // Medium height (medium taupe)
    else if (height < maxHeight * 0.4) {
      return p.color(35, 25, 65, 200);
    }
    // High ground (dark gray-brown)
    else {
      return p.color(30, 30, 45, 200);
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
      
      // Make sure normal points upward (for consistent bouncing)
      if (normal.y < 0) {
        normal.mult(-1);
      }
      
      // Calculate penetration depth
      const penetrationDepth = (terrainHeight + particle.size * 0.5) - particle.position.y;
      
      // Check if particle is below terrain surface (with a small buffer for particle size)
      if (penetrationDepth > 0) {
        // Calculate velocity relative to surface
        const velMagnitude = particle.velocity.mag();
        
        return {
          collision: true,
          normal: normal,
          terrainHeight: terrainHeight,
          penetrationDepth: penetrationDepth,
          velocityMagnitude: velMagnitude
        };
      }
    }
    
    // No collision
    return {
      collision: false,
      normal: p.createVector(0, 1, 0),
      terrainHeight: -Infinity,
      penetrationDepth: 0,
      velocityMagnitude: 0
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
      // Make smoothing more responsive when value is higher
      // This creates faster acceleration when the value increases
      const adaptiveSmoothingFactor = midiParams.smoothingFactor * 
        (1 + midiParams.faderValues[i] * 2); // Increase smoothing factor based on value
      
      midiParams.smoothedValues[i] = midiParams.smoothedValues[i] + 
        (midiParams.faderValues[i] - midiParams.smoothedValues[i]) * adaptiveSmoothingFactor;
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
    
    // Calculate Z rotation (tilt front-back) - rotate around Z axis
    const zRotationValue = p.map(tiltFront - tiltBack, -1, 1, -Math.PI/4, Math.PI/4);
    cameraParams.zRotation = zRotationValue;
    
    // Calculate X rotation (lift right-left) - rotate around X axis
    const xRotationValue = p.map(liftRight - liftLeft, -1, 1, -Math.PI/4, Math.PI/4);
    cameraParams.xRotation = xRotationValue;
    
    // Calculate Y rotation (rotate right-left) - rotate around Y axis in 15-degree increments
    // Detect significant changes in rotation input
    const rotationInput = rotateRight - rotateLeft;
    if (Math.abs(rotationInput) > 0.5) { // Threshold for triggering rotation
      // Determine direction and apply 15-degree increment
      const rotationIncrement = Math.PI / 12; // 15 degrees
      if (rotationInput > 0) {
        cameraParams.yRotation += rotationIncrement;
      } else {
        cameraParams.yRotation -= rotationIncrement;
      }
      
      // Normalize rotation to keep it within 0-2π range
      cameraParams.yRotation = (cameraParams.yRotation + Math.PI * 2) % (Math.PI * 2);
    }
    
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
    
    // Check for particle-particle collisions
    const particleCollisions = [];
    for (let i = 0; i < organicModel.particles.length; i++) {
      for (let j = i + 1; j < organicModel.particles.length; j++) {
        const particleA = organicModel.particles[i];
        const particleB = organicModel.particles[j];
        
        // Calculate distance between particles
        const distance = p5.Vector.dist(particleA.position, particleB.position);
        
        // If particles are colliding
        if (distance < (particleA.size + particleB.size) * 0.8) {
          // Mark both particles for removal if they haven't already been marked
          if (!particleCollisions.includes(i) && !particleCollisions.includes(j)) {
            particleCollisions.push(i, j);
          }
        }
      }
    }
    
    // Add collision particles to removal queue
    organicModel.particlesToRemove.push(...particleCollisions);
    
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
      
      // Check if particle is going beyond terrain boundaries and wrap it to the other side
      const terrainSize = organicModel.terrainSize;
      const halfSize = terrainSize / 2;
      
      // Wrap around X axis
      if (particle.position.x > halfSize) {
        particle.position.x = -halfSize;
      } else if (particle.position.x < -halfSize) {
        particle.position.x = halfSize;
      }
      
      // Wrap around Z axis
      if (particle.position.z > halfSize) {
        particle.position.z = -halfSize;
      } else if (particle.position.z < -halfSize) {
        particle.position.z = halfSize;
      }
      
      // Check for collision with terrain and bounce
      const terrainCollision = checkTerrainCollision(particle);
      // Prevent particles from going below the terrain
      if (terrainCollision.collision || particle.position.y < -organicModel.terrainHeight) {
        // Only count as a hit if enough time has passed since last hit (to avoid multiple hits in a row)
        const currentTime = p.frameCount;
        if (currentTime - particle.lastCollisionTime > 10) {
          particle.terrainHits++;
          particle.lastCollisionTime = currentTime;
          
          // If this is the first hit, create a new particle
          if (particle.terrainHits === 1) {
            // Create a new particle near this one with a slight offset
            const newX = particle.position.x + p.random(-20, 20);
            const newY = particle.position.y + p.random(10, 30);
            const newZ = particle.position.z + p.random(-20, 20);
            organicModel.particlesToAdd.push(createParticle(newX, newY, newZ));
          }
          
          // If this particle has hit the terrain 5 times, mark it for removal
          if (particle.terrainHits >= 5) {
            organicModel.particlesToRemove.push(i);
          }
        }
        
        // Calculate bounce with proper physics
        // First, move the particle to just above the terrain surface with a bit more clearance
        particle.position.y = terrainCollision.terrainHeight + particle.size * 0.8;
        
        // Calculate reflection vector with some energy loss
        const bounciness = 0.7; // Higher values = more bouncy
        
        // Reflect velocity vector around the terrain normal
        const dot = particle.velocity.dot(terrainCollision.normal);
        const reflectionForce = p5.Vector.mult(terrainCollision.normal, 2 * dot);
        particle.velocity.sub(reflectionForce);
        
        // Apply bounciness factor (energy loss)
        particle.velocity.mult(bounciness);
        
        // Add a small upward impulse for more visible bouncing
        const bounceImpulse = p5.Vector.mult(terrainCollision.normal, 0.5 * speed);
        particle.velocity.add(bounceImpulse);
      }
      
      // Use fixed size with global size parameter
      particle.size = particle.fixedSize * size;
      
      // Apply Bezier curve motion
      particle.bezierT += 0.002 * speed * particle.bezierDirection;
      
      // Reverse direction at endpoints
      if (particle.bezierT > 1 || particle.bezierT < 0) {
        particle.bezierDirection *= -1;
      }
      
      // Constrain bezierT between 0 and 1
      particle.bezierT = p.constrain(particle.bezierT, 0, 1);
      
      // Calculate position along Bezier curve
      if (Math.random() < 0.05) { // Only occasionally use Bezier to allow other forces to work
        const cp = particle.controlPoints;
        const t = particle.bezierT;
        
        // Cubic Bezier formula
        const bx = p.bezierPoint(cp[0].x, cp[1].x, cp[2].x, cp[3].x, t);
        const by = p.bezierPoint(cp[0].y, cp[1].y, cp[2].y, cp[3].y, t);
        const bz = p.bezierPoint(cp[0].z, cp[1].z, cp[2].z, cp[3].z, t);
        
        // Gradually move toward the Bezier point
        particle.position.x = p.lerp(particle.position.x, bx, 0.03);
        particle.position.y = p.lerp(particle.position.y, by, 0.03);
        particle.position.z = p.lerp(particle.position.z, bz, 0.03);
      }
      
      // Apply 3D Perlin noise for more natural movement
      const noiseTime = p.frameCount * 0.01;
      const noiseX = p.noise(particle.noiseOffset, noiseTime) - 0.5;
      const noiseY = p.noise(particle.noiseOffset + 100, noiseTime) - 0.5;
      const noiseZ = p.noise(particle.noiseOffset + 200, noiseTime) - 0.5;
      
      particle.position.x += noiseX * randomness;
      particle.position.y += noiseY * randomness;
      particle.position.z += noiseZ * randomness;
    }
    
    // Apply connection constraints
    for (const connection of organicModel.connections) {
      const particleA = organicModel.particles[connection.from];
      const particleB = organicModel.particles[connection.to];
      
      if (particleA && particleB) {
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
    
    // Add new particles from the queue
    if (organicModel.particlesToAdd.length > 0) {
      organicModel.particles.push(...organicModel.particlesToAdd);
      organicModel.particlesToAdd = [];
      
      // Recreate connections when particles are added
      organicModel.connections = createConnections();
    }
    
    // Remove particles marked for deletion (in reverse order to avoid index issues)
    if (organicModel.particlesToRemove.length > 0) {
      // Sort indices in descending order
      organicModel.particlesToRemove.sort((a, b) => b - a);
      
      // Remove duplicates
      organicModel.particlesToRemove = [...new Set(organicModel.particlesToRemove)];
      
      // Remove particles
      for (const index of organicModel.particlesToRemove) {
        if (index >= 0 && index < organicModel.particles.length) {
          organicModel.particles.splice(index, 1);
        }
      }
      
      // Clear the removal queue
      organicModel.particlesToRemove = [];
      
      // Recreate connections when particles are removed
      organicModel.connections = createConnections();
    }
    
    // Check if we need to spawn more particles
    if (organicModel.particles.length < organicModel.minParticles) {
      const particlesToSpawn = organicModel.minParticles - organicModel.particles.length;
      for (let i = 0; i < particlesToSpawn; i++) {
        organicModel.particles.push(createParticle());
      }
      
      // Recreate connections for new particles
      organicModel.connections = createConnections();
    }
  }
  
  // Draw XYZ axes for orientation
  function drawAxes() {
    const axisLength = 200;
    p.strokeWeight(2);
    
    // X axis - Red (flipped for 180 degree rotation)
    p.stroke(255, 0, 0);
    p.line(0, 0, 0, -axisLength, 0, 0);
    
    // Y axis - Green
    p.stroke(0, 255, 0);
    p.line(0, 0, 0, 0, axisLength, 0);
    
    // Z axis - Blue (flipped for 180 degree rotation)
    p.stroke(0, 0, 255);
    p.line(0, 0, 0, 0, 0, -axisLength);
    
    // Reset stroke
    p.strokeWeight(1);
  }
  
  // Draw the organic model
  function drawOrganicModel() {
    // Draw terrain
    drawTerrain();
    
    // Draw axes for orientation
    drawAxes();
    
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
    
    // Draw particles as enhanced spheres
    p.noStroke();
    for (const particle of organicModel.particles) {
      p.push();
      p.translate(particle.position.x, particle.position.y, particle.position.z);
      
      // Use the stable color
      p.fill(particle.color);
      
      // Add specular highlight for more 3D appearance
      p.specularMaterial(250);
      p.shininess(50);
      
      // Draw the sphere with fixed size
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
          <div style="display: inline-block; margin: 10px; padding: 10px; border: 1px solid #555; border-radius: 5px;">
            <strong>M</strong> - Toggle Mouse Control
          </div>
        </div>
        <div style="margin: 20px 0;">
          <h3>Mouse Controls</h3>
          <div style="display: inline-block; margin: 10px; padding: 10px; border: 1px solid #555; border-radius: 5px;">
            <strong>Drag</strong> - Rotate Camera
          </div>
          <div style="display: inline-block; margin: 10px; padding: 10px; border: 1px solid #555; border-radius: 5px;">
            <strong>Scroll</strong> - Zoom In/Out
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
    
    // Disable mouse control when settings are open
    cameraParams.mouseControl = !showSettings;
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
    parameterPanel.style.width = '250px';
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
    gesturePanel.style.width = '250px';
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
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
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
      const mouseStatus = cameraParams.mouseControl ? 'MOUSE ENABLED' : 'MOUSE DISABLED';
      statusText.textContent = `Simulation: ${simulationState.toUpperCase()} | ${mouseStatus}`;
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
      } else if (event.key === 'm' || event.key === 'M') {
        cameraParams.mouseControl = !cameraParams.mouseControl;
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
  
  // Setup mouse control
  function setupMouseControl() {
    // Mouse drag to rotate camera
    p.mousePressed = () => {
      if (cameraParams.mouseControl && !showSettings) {
        cameraParams.mouseX = p.mouseX;
        cameraParams.mouseY = p.mouseY;
      }
    };
    
    p.mouseDragged = () => {
      if (cameraParams.mouseControl && !showSettings) {
        // Calculate mouse movement
        const dx = p.mouseX - cameraParams.mouseX;
        const dy = p.mouseY - cameraParams.mouseY;
        
        // Update Y rotation based on horizontal mouse movement
        cameraParams.targetYRotation += dx * 0.01;
        
        // Store current mouse position
        cameraParams.mouseX = p.mouseX;
        cameraParams.mouseY = p.mouseY;
      }
    };
    
    // Mouse wheel to zoom
    p.mouseWheel = (event) => {
      if (cameraParams.mouseControl && !showSettings) {
        // Adjust camera radius (zoom)
        cameraParams.radius = p.constrain(
          cameraParams.radius + event.delta,
          300,   // Minimum zoom
          2000   // Maximum zoom
        );
        return false; // Prevent default scrolling
      }
    };
  }
  
  p.setup = () => {
    p.createCanvas(p.windowWidth, p.windowHeight, p.WEBGL);
    
    // Enable smooth rendering and better lighting for spheres
    p.setAttributes('antialias', true);
    p.smooth();
    
    initMidi();
    initOrganicModel();
    createSettingsUI();
    createStatusBar();
    setupKeyboardShortcuts();
    setupMouseControl();
    
    // Enable mouse control by default
    cameraParams.mouseControl = true;
    updateStatusBar();
  };

  p.draw = () => {
    p.background(35); // Slightly lighter background for better contrast
    
    // Enhanced lighting for better 3D appearance with softer, more accessible lighting
    p.ambientLight(70, 70, 70); // Brighter ambient light for better visibility
    p.pointLight(240, 240, 220, 0, 0, 300); // Slightly warmer main light
    p.directionalLight(180, 180, 200, 0.5, 1, -0.5); // Cooler directional light
    p.specularColor(220, 220, 220); // Less harsh specular highlights
    
    // Add a second light source for better sphere rendering
    p.pointLight(160, 170, 190, -300, 200, 300); // Slightly blue fill light
    
    // Smoothly interpolate camera rotation when using mouse control
    if (cameraParams.mouseControl) {
      cameraParams.yRotation = p.lerp(cameraParams.yRotation, cameraParams.targetYRotation, 0.1);
    }
    
    // Create a camera view with separate rotations for each axis
    let baseAngle = cameraParams.autoRotate && !cameraParams.mouseControl 
      ? p.frameCount * cameraParams.rotationSpeed 
      : 0;
    baseAngle += cameraParams.yRotation; // Add Y rotation (around vertical axis)
    
    // Start with base camera position - rotated 180 degrees
    let camX = 0, camY = -cameraParams.height, camZ = cameraParams.radius; // Inverted Z for 180 degree rotation
    
    // Create rotation matrices
    // First rotate around Y axis (horizontal rotation)
    const cosY = Math.cos(baseAngle);
    const sinY = Math.sin(baseAngle);
    
    const tempX = camX * cosY - camZ * sinY;
    const tempZ = camX * sinY + camZ * cosY;
    camX = tempX;
    camZ = tempZ;
    
    // Then rotate around X axis (lift right/left)
    const cosX = Math.cos(cameraParams.xRotation);
    const sinX = Math.sin(cameraParams.xRotation);
    
    const tempY1 = camY * cosX - camZ * sinX;
    const tempZ1 = camY * sinX + camZ * cosX;
    camY = tempY1;
    camZ = tempZ1;
    
    // Finally rotate around Z axis (tilt front/back)
    const cosZ = Math.cos(cameraParams.zRotation);
    const sinZ = Math.sin(cameraParams.zRotation);
    
    const tempX2 = camX * cosZ - camY * sinZ;
    const tempY2 = camX * sinZ + camY * cosZ;
    camX = tempX2;
    camY = tempY2;
    
    p.camera(
      camX, camY, camZ,  // Camera position
      0, 0, 0,           // Look at center
      0, 1, 0            // Up vector
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
