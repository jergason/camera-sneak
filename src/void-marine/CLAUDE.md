# Void Marine

side-scrolling run-and-gun built with phaser 3 + typescript.

## architecture

- `main.ts` — phaser game bootstrap + touch init
- `GameScene.ts` — main game scene (player, enemies, boss fights, lava, etc). biggest file by far — contains all gameplay logic, boss AI, combat, movement, HUD, and end states
- `TitleScene.ts` — title screen with level select and debug keys (1/2/3)
- `levelgen.ts` — procedural level generation (ground, pits, platforms, enemies, powerups, boss arena). pure function, most testable module
- `levels.ts` — level theme definitions, boss names/HP, typescript types (`LevelDef`, `BossType`, `HazardType`)
- `constants.ts` — game dimensions, physics tuning values (gravity, speeds, fire rate, etc)
- `textures.ts` — runtime pixel-art texture generation for all sprites via phaser graphics
- `sfx.ts` — web audio oscillator synth for all sound effects. singleton `sfx` export
- `touch.ts` — mobile touch control state (`touchState`) and DOM event binding

## key design decisions

- all textures are generated at runtime (no asset files) — `createTextures()` redraws on each level bc themes change colors
- boss AI lives entirely in `GameScene.updateBoss()` with a big type switch — not ideal but keeps state close to the phaser scene
- `sfx.rawTone()` exposed for one-off tones that don't fit named methods
- level gen is seeded by `Math.random()` — not deterministic across runs

## mechanics

- 3 themed worlds: void station (normal), lava depths (rising lava + wyrm), ice citadel (slippery + overlord)
- 5 boss types: mech (stationary turret), brute (charge + slam), drone (flying figure-8), wyrm (dive + fireballs), overlord (teleport + ice walls)
- coyote time (80ms) + jump buffer (100ms) for responsive platforming
- double jump powerup only on level 1, carries across levels
- 3 lives with checkpoint respawn, invincibility frames on hit

## controls

- WASD / arrows: move & jump
- SPACE: shoot
- R: restart
- B: debug skip to boss (gives double jump + full HP)
- 1/2/3: debug start on level (from title screen only)

## tests

- `__tests__/constants.test.ts` — validates game constants
- `__tests__/levels.test.ts` — validates level/boss definitions
- `__tests__/levelgen.test.ts` — tests procedural level generation
- run with `pnpm test`
