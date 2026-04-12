# arcade

browser games built with phaser 3. each game lives in its own subdirectory and deploys to its own path on github pages.

## games

- **[camera-sneak](camera-sneak/)** — metal gear solid-style stealth game. dodge sweeping security cameras to reach the exit.
- **[void-marine](void-marine/)** — side-scrolling run-and-gun through alien-infested void stations.

## dev

```
pnpm install
pnpm dev
```

visit `/` for the game index, `/camera-sneak/` or `/void-marine/` for individual games.

## build & deploy

```
pnpm build
```

output goes to `dist/`. configured for github pages at `/camera-sneak/` base path.
