# Camera Sneak

metal gear solid-style stealth game built with phaser 3 + typescript.

## architecture

- `src/camera-sneak/main.ts` — phaser game bootstrap
- `src/camera-sneak/GameScene.ts` — main scene with player, cameras, level gen
- `src/camera-sneak/vision.ts` — raycasted vision cones for security cameras
- `src/camera-sneak/procgen.ts` — procedural level generation
- `src/camera-sneak/agentAPI.ts` — AI agent playtesting API (activated via `?agent` query param)
- `src/camera-sneak/constants.ts` — game dimensions and tuning values
- `src/camera-sneak/types.ts` — shared type definitions

## mechanics

- cameras sweep with raycasted line-of-sight blocked by walls
- running near cameras creates noise that attracts them; sneaking is silent
- alert bar fills when spotted — full bar = caught
- patrol guards walk corridors and spot the player
- instant death on detection with dramatic camera-snap sequence

## controls

- WASD / arrows: move
- SHIFT: sneak (slower, silent)
- R: restart
