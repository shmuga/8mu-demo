import * as m from './module.js';

function setup() {
  createCanvas(windowWidth, windowHeight);
}

function draw() {
  background(220);
  
  // Draw a circle in the middle of the screen
  fill(100, 150, 255);
  noStroke();
  circle(windowWidth/2, windowHeight/2, 100);
}

function windowResized() {
  resizeCanvas(windowWidth, windowHeight);
}

// Attach p5.js functions to window to make them global
window.setup = setup;
window.draw = draw;
window.windowResized = windowResized;
