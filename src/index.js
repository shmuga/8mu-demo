import * as m from './module.js';
import p5 from 'p5';

new p5((p) => {
  p.setup = () => {
    p.createCanvas(p.windowWidth, p.windowHeight);
  };

  p.draw = () => {
    p.background(220);
    
    // Draw a circle in the middle of the screen
    p.fill(100, 150, 255);
    p.noStroke();
    p.circle(p.windowWidth/2, p.windowHeight/2, 100);
  };

  p.windowResized = () => {
    p.resizeCanvas(p.windowWidth, p.windowHeight);
  };
});
