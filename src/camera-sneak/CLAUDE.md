# Camera Sneak

metal gear solid-style stealth game built with phaser 3 + typescript.

## architecture

- `main.ts` — phaser game bootstrap
- `GameScene.ts` — main scene: player movement, camera/guard AI ticking, alert system, level progression, HUD, death sequence
- `vision.ts` — raycasted vision cones. `raycast()` steps along a ray checking wall collisions. `isPointInCone()` / `buildConePolygon()` used for detection and rendering. operates on a grid set via `setGrid()`
- `procgen.ts` — procedural level generation with seeded RNG (`mulberry32`). generates grid, cameras, and guard patrols. uses flood fill to guarantee connectivity between player start and exit
- `agentAPI.ts` — AI playtesting API activated via `?agent` query param. exposes `window.agent` with `step()`, `getState()`, `observe()` for programmatic control. reads/writes `agentInput` which GameScene consumes
- `constants.ts` — tile size (32), grid dimensions (25x19), cone range/angle, player/sneak speeds
- `types.ts` — shared types: `TileType` (0=floor, 1=wall, 2=start, 3=exit), `CameraDef`/`CameraState`, `GuardDef`/`GuardState`, `VisionSource`, `Point`

## key design decisions

- vision uses grid-based raycasting (step size 4px) — walls block line of sight
- cameras are wall-mounted (have `wallCol`/`wallRow` for their mount point, skipped during own raycast)
- guards walk waypoint paths, pause at each waypoint, and snap toward noise (running player)
- procgen is seeded — same seed = same level layout. flood fill validates solvability
- agent API uses step mode with configurable fixed dt for deterministic replays

## mechanics

- cameras sweep back and forth with raycasted line-of-sight blocked by walls
- running near cameras/guards creates noise that attracts them; sneaking is silent
- alert bar fills when spotted — full bar = instant death with dramatic camera-snap
- patrol guards walk corridors between waypoints and spot the player
- proximity warning: screen edges glow red near vision cones
- footstep trail visible when running, invisible when sneaking
- speedrun timer tracks escape time

## controls

- WASD / arrows: move
- SHIFT: sneak (slower, silent)
- R: restart after win/loss
