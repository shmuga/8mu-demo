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
  
  // Draw the settings UI
  function drawSettings() {
    if (!showSettings) return;
    
    p.push();
    p.fill(0, 200);
    p.noStroke();
    p.rect(0, 0, p.width, p.height);
    
    p.fill(255);
    p.textSize(24);
    p.textAlign(p.CENTER, p.CENTER);
    p.text('MIDI Settings', p.width/2, 50);
    
    p.textSize(16);
    p.textAlign(p.LEFT, p.CENTER);
    
    const startY = 100;
    const rowHeight = 40;
    
    for (let i = 0; i < 8; i++) {
      const y = startY + i * rowHeight;
      
      // Parameter name
      p.text(midiParams.paramNames[i], 100, y);
      
      // MIDI CC number
      p.fill(200);
      p.rect(300, y - 15, 60, 30);
      p.fill(0);
      p.text(midiParams.faderMappings[i], 320, y);
      
      // Value visualization
      p.fill(100, 200, 255);
      const barWidth = midiParams.faderValues[i] * 200;
      p.rect(400, y - 10, barWidth, 20);
      
      p.fill(255);
      p.text(Math.round(midiParams.faderValues[i] * 100) + '%', 610, y);
    }
    
    p.textAlign(p.CENTER, p.CENTER);
    p.text('Press S to close settings', p.width/2, p.height - 50);
    p.pop();
  }
  
  // Draw status bar
  function drawStatusBar() {
    p.push();
    p.fill(0, 150);
    p.rect(0, p.height - 30, p.width, 30);
    
    p.fill(255);
    p.textSize(14);
    p.textAlign(p.LEFT, p.CENTER);
    
    // Show simulation state
    p.text(`Simulation: ${simulationState.toUpperCase()}`, 20, p.height - 15);
    
    // Show controls help
    p.textAlign(p.RIGHT, p.CENTER);
    p.text('S: Settings | R: Reset | P: Pause/Play', p.width - 20, p.height - 15);
    p.pop();
  }
  
  // Handle keyboard input
  p.keyPressed = () => {
    if (p.key === 's' || p.key === 'S') {
      showSettings = !showSettings;
    } else if (p.key === 'r' || p.key === 'R') {
      simulationState = 'reset';
      initOrganicModel();
      simulationState = 'running';
    } else if (p.key === 'p' || p.key === 'P') {
      simulationState = simulationState === 'running' ? 'paused' : 'running';
    }
  };
  
  p.setup = () => {
    p.createCanvas(p.windowWidth, p.windowHeight, p.WEBGL);
    initMidi();
    initOrganicModel();
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
    
    // Reset camera for UI elements
    p.camera();
    p.noLights();
    
    drawSettings();
    drawStatusBar();
  };

  p.windowResized = () => {
    p.resizeCanvas(p.windowWidth, p.windowHeight);
  };
});
