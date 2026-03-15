import type { TileType, CameraDef } from './types';
import { COLS, ROWS } from './constants';

export interface GeneratedLevel {
  grid: TileType[][];
  cameras: CameraDef[];
}

// seeded rng for reproducible levels
const mulberry32 = (seed: number) => () => {
  seed |= 0; seed = seed + 0x6D2B79F5 | 0;
  let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
  t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
  return ((t ^ t >>> 14) >>> 0) / 4294967296;
};

// flood fill to check connectivity
const floodFill = (grid: TileType[][], startR: number, startC: number): Set<string> => {
  const visited = new Set<string>();
  const stack: [number, number][] = [[startR, startC]];

  while (stack.length > 0) {
    const [r, c] = stack.pop()!;
    const key = `${r},${c}`;
    if (visited.has(key)) continue;
    if (r < 0 || r >= ROWS || c < 0 || c >= COLS) continue;
    if (grid[r][c] === 1) continue;
    visited.add(key);
    stack.push([r - 1, c], [r + 1, c], [r, c - 1], [r, c + 1]);
  }

  return visited;
};

// place a single wall cluster — smaller, more varied shapes
const placeWallCluster = (grid: TileType[][], rng: () => number): void => {
  // mix of shapes: small squares, L-shapes, single walls
  const shape = Math.floor(rng() * 4);
  const c = 2 + Math.floor(rng() * (COLS - 6));
  const r = 2 + Math.floor(rng() * (ROWS - 6));

  const cells: [number, number][] = [];

  if (shape === 0) {
    // 2x2 block
    cells.push([r, c], [r, c + 1], [r + 1, c], [r + 1, c + 1]);
  } else if (shape === 1) {
    // L-shape
    cells.push([r, c], [r + 1, c], [r + 2, c], [r + 2, c + 1]);
  } else if (shape === 2) {
    // horizontal bar (2-3 wide)
    const w = 2 + Math.floor(rng() * 2);
    for (let dc = 0; dc < w; dc++) cells.push([r, c + dc]);
  } else {
    // vertical bar (2-3 tall)
    const h = 2 + Math.floor(rng() * 2);
    for (let dr = 0; dr < h; dr++) cells.push([r + dr, c]);
  }

  cells.forEach(([cr, cc]) => {
    if (cr > 0 && cr < ROWS - 1 && cc > 0 && cc < COLS - 1) {
      grid[cr][cc] = 1;
    }
  });
};

// find floor tiles adjacent to walls — camera goes on the FLOOR tile, facing away from wall
const findCameraSpots = (grid: TileType[][]): { col: number; row: number; wallDir: number }[] => {
  const spots: { col: number; row: number; wallDir: number }[] = [];

  for (let r = 1; r < ROWS - 1; r++) {
    for (let c = 1; c < COLS - 1; c++) {
      if (grid[r][c] !== 0) continue; // must be a floor tile

      // check each neighbor — if it's a wall, this is a camera spot facing away from it
      const neighbors: [number, number][] = [[-1, 0], [1, 0], [0, -1], [0, 1]];
      for (const [dr, dc] of neighbors) {
        const wr = r + dr;
        const wc = c + dc;
        if (wr >= 0 && wr < ROWS && wc >= 0 && wc < COLS && grid[wr][wc] === 1) {
          // camera on floor tile (r,c), facing AWAY from wall at (wr,wc)
          // away = opposite direction of wall relative to camera
          const facingAngle = Math.atan2(-dr, -dc) * (180 / Math.PI);
          spots.push({ col: c, row: r, wallDir: facingAngle });
        }
      }
    }
  }

  return spots;
};

export const generateLevel = (seed: number): GeneratedLevel => {
  const rng = mulberry32(seed);

  // start with border walls
  const grid: TileType[][] = Array.from({ length: ROWS }, (_, r) =>
    Array.from({ length: COLS }, (_, c) =>
      (r === 0 || r === ROWS - 1 || c === 0 || c === COLS - 1) ? 1 : 0
    ) as TileType[]
  );

  // place player start (top-left quadrant) and exit (bottom-right quadrant)
  const startR = 1 + Math.floor(rng() * 3);
  const startC = 1 + Math.floor(rng() * 3);
  const exitR = ROWS - 2 - Math.floor(rng() * 3);
  const exitC = COLS - 2 - Math.floor(rng() * 3);

  grid[startR][startC] = 2;
  grid[exitR][exitC] = 3;

  // place wall clusters — fewer, more strategic pieces of cover
  const numClusters = 6 + Math.floor(rng() * 4);
  let placed = 0;
  for (let attempt = 0; attempt < numClusters * 4 && placed < numClusters; attempt++) {
    const backup = grid.map(row => [...row]) as TileType[][];

    placeWallCluster(grid, rng);

    // don't overwrite start/exit
    grid[startR][startC] = 2;
    grid[exitR][exitC] = 3;

    // check connectivity — also ensure enough open space (at least 55% floor)
    const reachable = floodFill(grid, startR, startC);
    const totalFloor = grid.reduce((sum, row) =>
      sum + row.filter(t => t !== 1).length, 0);
    const minFloor = (COLS - 2) * (ROWS - 2) * 0.55;

    if (!reachable.has(`${exitR},${exitC}`) || totalFloor < minFloor) {
      for (let r = 0; r < ROWS; r++) {
        for (let c = 0; c < COLS; c++) {
          grid[r][c] = backup[r][c];
        }
      }
    } else {
      placed++;
    }
  }

  // place cameras on floor tiles next to walls, facing outward
  const wallSpots = findCameraSpots(grid);
  const numCameras = 4 + Math.floor(rng() * 4); // 4-7 cameras

  // shuffle and pick
  for (let i = wallSpots.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [wallSpots[i], wallSpots[j]] = [wallSpots[j], wallSpots[i]];
  }

  // space cameras apart — don't cluster them
  const cameras: CameraDef[] = [];
  const minCamDist = 5;

  for (const spot of wallSpots) {
    if (cameras.length >= numCameras) break;

    // too close to start or exit?
    const dStart = Math.abs(spot.col - startC) + Math.abs(spot.row - startR);
    const dExit = Math.abs(spot.col - exitC) + Math.abs(spot.row - exitR);
    if (dStart < 4 || dExit < 3) continue;

    // too close to another camera?
    const tooClose = cameras.some(cam => {
      const d = Math.abs(cam.col - spot.col) + Math.abs(cam.row - spot.row);
      return d < minCamDist;
    });
    if (tooClose) continue;

    cameras.push({
      col: spot.col,
      row: spot.row,
      baseAngle: spot.wallDir,
      sweep: 50 + Math.floor(rng() * 40),
      speed: 0.25 + rng() * 0.35,
    });
  }

  return { grid, cameras };
};
