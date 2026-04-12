# Void Marine

side-scrolling run-and-gun built with phaser 3. single self-contained HTML file.

## architecture

- `void-marine/index.html` — entire game in one file (inline JS, CDN phaser)
- no build step needed — served as static HTML by vite

## mechanics

- 3 themed worlds: void station, lava depths, ice citadel
- side-scrolling platformer with shooting
- boss fights per level (mech, brute, drone, wyrm, overlord)
- powerups, lives system, slippery ice physics
- touch controls for mobile

## controls

- WASD / arrows: move & jump
- SPACE: shoot
- R: restart
- B: debug skip level
