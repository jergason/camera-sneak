import { isPointInCone, nearestConeDistance } from './vision';
import { TILE, COLS, ROWS } from './constants';
import type { CameraState, GuardState, TileType, VisionSource } from './types';

// --- agent input (GameScene reads these) ---

export const agentInput = {
  enabled: false,
  stepMode: false,
  pendingSteps: 0,
  fixedDt: 100,
  vx: 0,
  vy: 0,
  sneaking: false,
};

// --- internal refs for queries ---

let visionSources: VisionSource[] = [];
let currentGrid: TileType[][] = [];

// --- public API setup ---

export const initAgentMode = (scene: {
  restart: () => void;
  nextLevel: () => void;
}) => {
  if (!new URLSearchParams(window.location.search).has('agent')) return;

  agentInput.enabled = true;
  agentInput.stepMode = true;

  const w = window as any;

  w.__gameActions = {
    move: (dx: number, dy: number) => {
      agentInput.vx = Math.max(-1, Math.min(1, dx));
      agentInput.vy = Math.max(-1, Math.min(1, dy));
    },
    stop: () => { agentInput.vx = 0; agentInput.vy = 0; },
    sneak: (on: boolean) => { agentInput.sneaking = on; },
    restart: () => scene.restart(),
    nextLevel: () => scene.nextLevel(),
  };

  w.__step = (n = 1): Promise<any> => {
    agentInput.pendingSteps += n;
    return new Promise(resolve => {
      const check = () => {
        if (agentInput.pendingSteps <= 0) resolve(w.__gameState);
        else requestAnimationFrame(check);
      };
      requestAnimationFrame(check);
    });
  };

  w.__ascii = () => renderAscii();

  w.__query = {
    isTileSafe: (col: number, row: number) => {
      const cx = col * TILE + TILE / 2;
      const cy = row * TILE + TILE / 2;
      return !visionSources.some(s => isPointInCone(cx, cy, s));
    },
    dangerAt: (x: number, y: number) =>
      visionSources.reduce((min, s) => Math.min(min, nearestConeDistance(x, y, s)), Infinity),
    safeTiles: () => {
      const tiles: { col: number; row: number }[] = [];
      for (let r = 0; r < ROWS; r++) {
        for (let c = 0; c < COLS; c++) {
          if (currentGrid[r][c] === 1) continue;
          const cx = c * TILE + TILE / 2;
          const cy = r * TILE + TILE / 2;
          if (!visionSources.some(s => isPointInCone(cx, cy, s)))
            tiles.push({ col: c, row: r });
        }
      }
      return tiles;
    },
    pathToExit: (fromCol?: number, fromRow?: number) => {
      const state = w.__gameState;
      if (!state) return null;

      const sc = fromCol ?? state.player.tileCol;
      const sr = fromRow ?? state.player.tileRow;
      const ec = state.exit.tileCol;
      const er = state.exit.tileRow;

      const parent = new Map<string, string | null>();
      const start = `${sr},${sc}`;
      const end = `${er},${ec}`;
      parent.set(start, null);
      const queue = [start];

      while (queue.length > 0) {
        const key = queue.shift()!;
        if (key === end) {
          const path: { col: number; row: number }[] = [];
          let cur: string | null = key;
          while (cur != null) {
            const [r, c] = cur.split(',').map(Number);
            path.unshift({ col: c, row: r });
            cur = parent.get(cur) ?? null;
          }
          return path;
        }

        const [r, c] = key.split(',').map(Number);
        for (const [dr, dc] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
          const nr = r + dr;
          const nc = c + dc;
          const nkey = `${nr},${nc}`;
          if (parent.has(nkey)) continue;
          if (nc < 0 || nc >= COLS || nr < 0 || nr >= ROWS) continue;
          if (currentGrid[nr]?.[nc] === 1) continue;

          const cx = nc * TILE + TILE / 2;
          const cy = nr * TILE + TILE / 2;
          const dangerous = visionSources.some(s => isPointInCone(cx, cy, s));
          if (dangerous && nkey !== end) continue;

          parent.set(nkey, key);
          queue.push(nkey);
        }
      }

      return null; // no safe path right now
    },
  };

  // predict if a point will be safe after N ticks
  w.__predictSafe = (px: number, py: number, ticksAhead: number = 1) => {
    const s = w.__gameState;
    if (!s) return false;
    const dt = agentInput.fixedDt / 1000;

    // check each camera's predicted angle
    for (const cam of s.cameras) {
      const futureTime = cam.time + dt * cam.speed * ticksAhead;
      const futureAngle = cam.baseAngle + Math.sin(futureTime) * cam.sweep;
      const dx = px - cam.x;
      const dy = py - cam.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist > cam.range) continue;
      const angleToPoint = Math.atan2(dy, dx) * 180 / Math.PI;
      let diff = futureAngle - angleToPoint;
      // normalize to [-180, 180]
      diff = ((diff + 540) % 360) - 180;
      if (Math.abs(diff) <= cam.halfAngle) {
        // would be in cone — but skip LOS check for speed
        return false;
      }
    }

    // simulate guard positions N ticks ahead
    for (const guard of s.guards) {
      let gx = guard.x, gy = guard.y;
      let wpIdx = guard.waypointIndex;
      let dir = guard.direction;
      let pause = guard.pauseTimer;
      const wps = guard.waypoints;
      const spd = guard.walkSpeed;

      // step the guard forward ticksAhead ticks
      for (let t = 0; t < ticksAhead; t++) {
        if (pause > 0) { pause -= dt; continue; }
        if (!wps || wps.length < 2) continue;
        const target = wps[wpIdx];
        if (!target) continue;
        const tx = target.col * TILE + TILE / 2;
        const ty = target.row * TILE + TILE / 2;
        const ddx = tx - gx, ddy = ty - gy;
        const dd = Math.sqrt(ddx * ddx + ddy * ddy);
        const step = spd * TILE * dt;
        if (dd <= step) {
          gx = tx; gy = ty;
          pause = guard.pauseTime;
          const next = wpIdx + dir;
          if (next < 0 || next >= wps.length) { dir *= -1; wpIdx += dir; }
          else wpIdx = next;
        } else {
          gx += (ddx / dd) * step;
          gy += (ddy / dd) * step;
        }
      }

      // check if point is in predicted guard cone
      const gdx = px - gx, gdy = py - gy;
      const gDist = Math.sqrt(gdx * gdx + gdy * gdy);
      if (gDist > guard.range) continue;
      // predict facing angle from movement direction
      const futureAngle = Math.atan2(gy - guard.y, gx - guard.x) * 180 / Math.PI;
      const guardAngle = (gx === guard.x && gy === guard.y) ? guard.angle : futureAngle;
      const angleToPoint = Math.atan2(gdy, gdx) * 180 / Math.PI;
      let diff = guardAngle - angleToPoint;
      diff = ((diff + 540) % 360) - 180;
      if (Math.abs(diff) <= guard.halfAngle) return false;
    }

    return true;
  };

  w.__configure = (opts: { stepMs?: number; stepMode?: boolean }) => {
    if (opts.stepMs !== undefined) agentInput.fixedDt = opts.stepMs;
    if (opts.stepMode !== undefined) agentInput.stepMode = opts.stepMode;
  };

  w.__agentReady = true;
};

// --- state push (called by GameScene each frame) ---

export const updateAgentState = (state: {
  playerX: number; playerY: number; playerAngle: number;
  sneaking: boolean; moving: boolean;
  cams: CameraState[]; guards: GuardState[];
  exitX: number; exitY: number;
  caught: boolean; won: boolean;
  elapsed: number; level: number;
  grid: TileType[][]; proximity: number;
}) => {
  visionSources = [...state.cams, ...state.guards];
  currentGrid = state.grid;

  (window as any).__gameState = {
    player: {
      x: state.playerX, y: state.playerY,
      angle: state.playerAngle,
      sneaking: state.sneaking, moving: state.moving,
      tileCol: Math.floor(state.playerX / TILE),
      tileRow: Math.floor(state.playerY / TILE),
    },
    cameras: state.cams.map(c => ({
      x: c.x, y: c.y, angle: c.currentAngle,
      detected: c.detected, range: c.range, halfAngle: c.halfAngle,
      // oscillation params for prediction
      baseAngle: c.baseAngle, sweep: c.sweep, speed: c.speed, time: c.time,
    })),
    guards: state.guards.map(g => ({
      x: g.x, y: g.y, angle: g.currentAngle,
      detected: g.detected, range: g.range, halfAngle: g.halfAngle,
      paused: g.pauseTimer > 0, pauseTimer: g.pauseTimer, pauseTime: g.pauseTime,
      investigating: g.noiseAngle !== null,
      // patrol prediction data
      waypoints: g.waypoints,
      waypointIndex: g.waypointIndex,
      direction: g.direction,
      walkSpeed: g.walkSpeed,
    })),
    exit: {
      x: state.exitX, y: state.exitY,
      tileCol: Math.floor(state.exitX / TILE),
      tileRow: Math.floor(state.exitY / TILE),
    },
    status: state.caught ? 'caught' : state.won ? 'won' : 'playing',
    elapsed: state.elapsed,
    level: state.level,
    proximity: state.proximity,
    grid: state.grid.map(row => row.map(t => t === 1 ? 1 : 0)),
    gridSize: { cols: COLS, rows: ROWS, tileSize: TILE },
  };
};

// --- ASCII renderer ---

const renderAscii = (): string => {
  const state = (window as any).__gameState;
  if (!state) return '';

  const pCol = state.player.tileCol;
  const pRow = state.player.tileRow;
  const eCol = state.exit.tileCol;
  const eRow = state.exit.tileRow;

  const camTiles = new Set(
    state.cameras.map((c: any) => `${Math.floor(c.y / TILE)},${Math.floor(c.x / TILE)}`)
  );
  const guardTiles = new Set(
    state.guards.map((g: any) => `${Math.floor(g.y / TILE)},${Math.floor(g.x / TILE)}`)
  );

  const lines: string[] = [];
  for (let r = 0; r < ROWS; r++) {
    let line = '';
    for (let c = 0; c < COLS; c++) {
      if (currentGrid[r]?.[c] === 1) { line += '#'; continue; }

      const key = `${r},${c}`;
      if (c === pCol && r === pRow) { line += '@'; continue; }
      if (c === eCol && r === eRow) { line += 'E'; continue; }
      if (camTiles.has(key)) { line += 'C'; continue; }
      if (guardTiles.has(key)) { line += 'G'; continue; }

      const cx = c * TILE + TILE / 2;
      const cy = r * TILE + TILE / 2;
      const inCone = visionSources.some(s => isPointInCone(cx, cy, s));
      line += inCone ? '~' : ' ';
    }
    lines.push(line);
  }

  return lines.join('\n');
};
