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
      'Gravity'
    ]
  };
  
  // Organic model parameters
  let organicModel = {
    particles: [],
    numParticles: 50,
    connections: [],
    centerX: 0,
    centerY: 0,
    centerZ: 0
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
    const radius = p.random(50, 150);
    const theta = p.random(0, p.TWO_PI);
    const phi = p.random(0, p.PI);
    
    const x = radius * p.sin(phi) * p.cos(theta);
    const y = radius * p.sin(phi) * p.sin(theta);
    const z = radius * p.cos(phi);
    
    return {
      position: p.createVector(x, y, z),
      velocity: p.createVector(p.random(-1, 1), p.random(-1, 1), p.random(-1, 1)).mult(0.5),
      size: p.random(5, 15),
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
  
  // Initialize the organic model
  function initOrganicModel() {
    organicModel.particles = [];
    for (let i = 0; i < organicModel.numParticles; i++) {
      organicModel.particles.push(createParticle());
    }
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
    const gravity = p.map(midiParams.faderValues[7], 0, 1, 0, 0.05);
    
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
      ).normalize().mult(gravity);
      
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
    
    // Draw connections first
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
    
    // Rotate the view slightly for better 3D perception
    p.rotateX(p.frameCount * 0.005);
    p.rotateY(p.frameCount * 0.003);
    
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
