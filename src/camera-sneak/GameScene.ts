import Phaser from 'phaser';
import { TILE, COLS, ROWS, WIDTH, HEIGHT, PLAYER_SPEED, SNEAK_SPEED, GUARD_NOISE_LOOK_TIME } from './constants';
import { generateLevel } from './procgen';
import { setGrid, isPointInCone, buildConePolygon, nearestConeDistance } from './vision';
import type { TileType, CameraDef, CameraState, GuardDef, GuardState } from './types';
import { agentInput, initAgentMode, updateAgentState } from './agentAPI';

const NOISE_RADIUS = 5 * TILE;
const NOISE_SNAP_SPEED = 2.5;

interface Footstep {
  x: number;
  y: number;
  life: number;
}

export class GameScene extends Phaser.Scene {
  private playerGfx!: Phaser.GameObjects.Graphics;
  private playerX = 0;
  private playerY = 0;
  private playerAngle = 0;

  private exitGfx!: Phaser.GameObjects.Graphics;
  private exitX = 0;
  private exitY = 0;
  private exitTime = 0;

  private grid: TileType[][] = [];
  private cameraDefs: CameraDef[] = [];
  private cams: CameraState[] = [];
  private guardDefs: GuardDef[] = [];
  private guards: GuardState[] = [];
  private guardGfx!: Phaser.GameObjects.Graphics;
  private coneGfx!: Phaser.GameObjects.Graphics;
  private vignetteGfx!: Phaser.GameObjects.Graphics;
  private trailGfx!: Phaser.GameObjects.Graphics;
  private hudText!: Phaser.GameObjects.Text;
  private timerText!: Phaser.GameObjects.Text;
  private levelText!: Phaser.GameObjects.Text;

  private cursors!: Phaser.Types.Input.Keyboard.CursorKeys;
  private shiftKey!: Phaser.Input.Keyboard.Key;
  private wasd!: Record<'W' | 'A' | 'S' | 'D', Phaser.Input.Keyboard.Key>;

  private alert = 0;
  private caught = false;
  private won = false;
  private elapsed = 0;
  private footsteps: Footstep[] = [];
  private footstepTimer = 0;
  private proximity = 0;

  private level = 1;
  private totalTime = 0;
  private flashAlpha = 0;
  private caughtTimer = 0;

  // touch controls
  private touchVx = 0;
  private touchVy = 0;
  private touchSneaking = false;
  private touchMoving = false;
  private joystickId: number | null = null;
  private joystickOrigin = { x: 0, y: 0 };
  private sneakBtnGfx!: Phaser.GameObjects.Graphics;
  private joystickGfx!: Phaser.GameObjects.Graphics;
  private isTouchDevice = false;

  constructor() {
    super('GameScene');
  }

  create(): void {
    this.alert = 0;
    this.caught = false;
    this.won = false;
    this.elapsed = 0;
    this.footsteps = [];
    this.footstepTimer = 0;
    this.proximity = 0;

    // generate level
    const seed = this.level * 7919 + 42;
    const { grid, cameras, guards } = generateLevel(seed, this.level);
    this.grid = grid;
    this.cameraDefs = cameras;
    this.guardDefs = guards;
    setGrid(grid);

    this.drawMap();
    this.spawnPlayer();
    this.buildCameras();
    this.buildGuards();
    this.buildExit();

    this.cursors = this.input.keyboard!.createCursorKeys();
    this.shiftKey = this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.SHIFT);
    this.wasd = this.input.keyboard!.addKeys('W,A,S,D') as Record<'W' | 'A' | 'S' | 'D', Phaser.Input.Keyboard.Key>;

    this.trailGfx = this.add.graphics().setDepth(1);
    this.coneGfx = this.add.graphics();
    this.guardGfx = this.add.graphics().setDepth(12);
    this.vignetteGfx = this.add.graphics().setDepth(90);

    this.hudText = this.add.text(WIDTH / 2, 12, '', {
      fontFamily: 'monospace',
      fontSize: '14px',
      color: '#ffffff',
    }).setOrigin(0.5, 0).setDepth(100);

    this.timerText = this.add.text(16, 10, '0.0s', {
      fontFamily: 'monospace',
      fontSize: '14px',
      color: '#aaaaaa',
    }).setOrigin(0, 0).setDepth(100);

    this.levelText = this.add.text(16, 26, `LVL ${this.level}`, {
      fontFamily: 'monospace',
      fontSize: '12px',
      color: '#666688',
    }).setOrigin(0, 0).setDepth(100);

    // show best time for this level
    const best = this.getBestTime(this.level);
    if (best !== null) {
      this.add.text(16, 42, `BEST ${best.toFixed(1)}s`, {
        fontFamily: 'monospace',
        fontSize: '11px',
        color: '#44dd88',
      }).setOrigin(0, 0).setDepth(100);
    }

    this.updateHud();
    this.setupTouch();
    initAgentMode({
      restart: () => this.scene.restart(),
      nextLevel: () => { this.level++; this.scene.restart(); },
    });
  }

  // ── touch controls ────────────────────────────────────
  private setupTouch(): void {
    this.isTouchDevice = this.sys.game.device.input.touch;
    if (!this.isTouchDevice) return;

    this.joystickGfx = this.add.graphics().setDepth(95);
    this.sneakBtnGfx = this.add.graphics().setDepth(95);
    this.drawSneakButton();

    this.input.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
      // right half = sneak toggle
      if (pointer.x > WIDTH * 0.65 && pointer.y > HEIGHT * 0.5) {
        this.touchSneaking = !this.touchSneaking;
        this.drawSneakButton();
        return;
      }
      // left side = joystick start
      if (this.joystickId === null && pointer.x < WIDTH * 0.65) {
        this.joystickId = pointer.id;
        this.joystickOrigin = { x: pointer.x, y: pointer.y };
      }
    });

    this.input.on('pointermove', (pointer: Phaser.Input.Pointer) => {
      if (pointer.id !== this.joystickId) return;
      const dx = pointer.x - this.joystickOrigin.x;
      const dy = pointer.y - this.joystickOrigin.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const deadzone = 8;
      if (dist < deadzone) {
        this.touchVx = 0;
        this.touchVy = 0;
        this.touchMoving = false;
      } else {
        const clamped = Math.min(dist, 50);
        this.touchVx = (dx / dist) * (clamped / 50);
        this.touchVy = (dy / dist) * (clamped / 50);
        this.touchMoving = true;
      }
    });

    this.input.on('pointerup', (pointer: Phaser.Input.Pointer) => {
      if (pointer.id === this.joystickId) {
        this.joystickId = null;
        this.touchVx = 0;
        this.touchVy = 0;
        this.touchMoving = false;
      }
    });
  }

  private drawSneakButton(): void {
    if (!this.sneakBtnGfx) return;
    const gfx = this.sneakBtnGfx;
    gfx.clear();
    const bx = WIDTH - 50;
    const by = HEIGHT - 50;
    const r = 28;
    const active = this.touchSneaking;
    gfx.fillStyle(active ? 0x227744 : 0x334455, active ? 0.7 : 0.4);
    gfx.fillCircle(bx, by, r);
    gfx.lineStyle(2, active ? 0x44dd88 : 0x667788, 0.8);
    gfx.strokeCircle(bx, by, r);
    // "S" label
    if (!this.sneakLabel) {
      this.sneakLabel = this.add.text(bx, by, 'snk', {
        fontFamily: 'monospace', fontSize: '12px', color: '#ffffff',
      }).setOrigin(0.5).setDepth(96);
    }
    this.sneakLabel.setAlpha(active ? 1 : 0.5);
  }

  private sneakLabel?: Phaser.GameObjects.Text;

  private drawJoystick(): void {
    if (!this.joystickGfx) return;
    const gfx = this.joystickGfx;
    gfx.clear();
    if (this.joystickId === null) return;
    const ox = this.joystickOrigin.x;
    const oy = this.joystickOrigin.y;
    // base ring
    gfx.lineStyle(2, 0x667788, 0.4);
    gfx.strokeCircle(ox, oy, 50);
    // thumb
    const tx = ox + this.touchVx * 50;
    const ty = oy + this.touchVy * 50;
    gfx.fillStyle(0xaabbcc, 0.5);
    gfx.fillCircle(tx, ty, 16);
  }

  update(_time: number, delta: number): void {
    // agent step mode: pause until __step() is called
    if (agentInput.enabled && agentInput.stepMode && agentInput.pendingSteps <= 0) {
      this.pushAgentState();
      return;
    }
    if (agentInput.enabled && agentInput.stepMode) {
      agentInput.pendingSteps--;
      delta = agentInput.fixedDt;
    }

    const dt = delta / 1000;

    if (this.caught) {
      this.caughtTimer += dt;
      this.updateDeathSequence(dt);
      this.pushAgentState();
      return;
    }

    if (this.won) {
      this.pushAgentState();
      return;
    }

    this.elapsed += dt;
    this.exitTime += dt;
    this.movePlayer(dt);
    this.updateCameras(dt);
    this.updateGuards(dt);
    this.applyNoise(dt);
    this.drawTrail(dt);
    this.drawCones();
    this.drawGuards();
    this.drawPlayer();
    this.drawExitPortal();
    this.checkDetection();
    this.drawVignette();
    this.checkExit();
    this.drawJoystick();
    this.updateHud();
    this.pushAgentState();
  }

  private updateDeathSequence(dt: number): void {
    const t = this.caughtTimer;

    // snap all cameras and guards toward player and extend range to reach them
    const snapToPlayer = (entity: { x: number; y: number; currentAngle: number; range: number; detected: boolean }) => {
      const dx = this.playerX - entity.x;
      const dy = this.playerY - entity.y;
      const distToPlayer = Math.sqrt(dx * dx + dy * dy) + TILE;
      const angleToPlayer = Phaser.Math.RadToDeg(Math.atan2(dy, dx));
      const diff = Phaser.Math.Angle.ShortestBetween(entity.currentAngle, angleToPlayer);
      entity.currentAngle += diff * Math.min(t * 8, 1);
      entity.range = Math.max(entity.range, distToPlayer);
      entity.detected = true;
    };
    this.cams.forEach(snapToPlayer);
    this.guards.forEach(snapToPlayer);

    // redraw cones and guards (all red, all pointing at player)
    this.drawCones();
    this.drawGuards();
    this.drawPlayer();

    // screen shake — decays over time
    const shakeIntensity = Math.max(0, 6 - t * 4);
    if (shakeIntensity > 0) {
      this.cameras.main.setScroll(
        (Math.random() - 0.5) * shakeIntensity * 2,
        (Math.random() - 0.5) * shakeIntensity * 2,
      );
    } else {
      this.cameras.main.setScroll(0, 0);
    }

    // red flash — peaks fast then fades
    const flashIntensity = t < 0.15 ? t / 0.15 : Math.max(0, 1 - (t - 0.15) * 1.5);
    this.vignetteGfx.clear();
    if (flashIntensity > 0) {
      this.vignetteGfx.fillStyle(0xff0000, flashIntensity * 0.5);
      this.vignetteGfx.fillRect(-10, -10, WIDTH + 20, HEIGHT + 20);
    }

    // show retry text after the drama settles
    if (t > 1.0) {
      this.cameras.main.setScroll(0, 0);
      const elapsed = this.elapsed.toFixed(1);
      this.hudText.setText(`DETECTED at ${elapsed}s! ${this.isTouchDevice ? 'tap' : 'press R'} to retry`);
      this.input.keyboard!.once('keydown-R', () => this.scene.restart());
      if (this.isTouchDevice) {
        this.input.once('pointerdown', () => this.scene.restart());
      }
    }
  }

  // ── map ─────────────────────────────────────────────────
  private drawMap(): void {
    const gfx = this.add.graphics();
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const tile = this.grid[r][c];
        if (tile === 1) {
          gfx.fillStyle(0x334455);
          gfx.fillRect(c * TILE, r * TILE, TILE, TILE);
          gfx.lineStyle(1, 0x556677);
          gfx.strokeRect(c * TILE, r * TILE, TILE, TILE);
        } else {
          gfx.fillStyle(0x1a1a2e);
          gfx.fillRect(c * TILE, r * TILE, TILE, TILE);
        }
      }
    }
  }

  // ── player ──────────────────────────────────────────────
  private spawnPlayer(): void {
    const pos = this.findTile(2);
    this.playerX = pos.col * TILE + TILE / 2;
    this.playerY = pos.row * TILE + TILE / 2;
    this.playerAngle = Math.PI / 2;
    this.playerGfx = this.add.graphics().setDepth(10);
  }

  private findTile(tile: TileType): { col: number; row: number } {
    for (let r = 0; r < this.grid.length; r++) {
      for (let c = 0; c < this.grid[r].length; c++) {
        if (this.grid[r][c] === tile) return { col: c, row: r };
      }
    }
    throw new Error(`tile ${tile} not found`);
  }

  private drawPlayer(): void {
    const gfx = this.playerGfx;
    gfx.clear();

    const sneaking = this.isSneaking();
    const x = this.playerX;
    const y = this.playerY;
    const angle = this.playerAngle;

    if (this.caught) {
      gfx.lineStyle(3, 0xff0000);
      gfx.beginPath();
      gfx.moveTo(x - 7, y - 7); gfx.lineTo(x + 7, y + 7);
      gfx.moveTo(x + 7, y - 7); gfx.lineTo(x - 7, y + 7);
      gfx.strokePath();
      return;
    }

    if (this.won) {
      gfx.fillStyle(0x44ddff);
      gfx.fillCircle(x, y, 10);
      gfx.lineStyle(2, 0xffffff, 0.8);
      gfx.strokeCircle(x, y, 10);
      return;
    }

    const bodyLen = sneaking ? 7 : 10;
    const bodyWidth = sneaking ? 5 : 7;
    const headR = sneaking ? 3 : 4;
    const bodyColor = sneaking ? 0x227744 : 0x44dd88;
    const outlineColor = sneaking ? 0x115522 : 0x22aa66;

    const dx = Math.cos(angle);
    const dy = Math.sin(angle);
    const px = -dy;
    const py = dx;

    const noseTipX = x + dx * bodyLen;
    const noseTipY = y + dy * bodyLen;
    const backLeftX = x - dx * (bodyLen * 0.4) + px * bodyWidth;
    const backLeftY = y - dy * (bodyLen * 0.4) + py * bodyWidth;
    const backRightX = x - dx * (bodyLen * 0.4) - px * bodyWidth;
    const backRightY = y - dy * (bodyLen * 0.4) - py * bodyWidth;

    gfx.fillStyle(bodyColor);
    gfx.beginPath();
    gfx.moveTo(noseTipX, noseTipY);
    gfx.lineTo(backLeftX, backLeftY);
    gfx.lineTo(backRightX, backRightY);
    gfx.closePath();
    gfx.fillPath();

    gfx.lineStyle(1, outlineColor);
    gfx.beginPath();
    gfx.moveTo(noseTipX, noseTipY);
    gfx.lineTo(backLeftX, backLeftY);
    gfx.lineTo(backRightX, backRightY);
    gfx.closePath();
    gfx.strokePath();

    const headX = x + dx * 2;
    const headY = y + dy * 2;
    gfx.fillStyle(bodyColor);
    gfx.fillCircle(headX, headY, headR);
    gfx.lineStyle(1, outlineColor);
    gfx.strokeCircle(headX, headY, headR);

    const eyeOffset = headR * 0.5;
    const eyeDist = headR * 0.35;
    gfx.fillStyle(0xffffff);
    gfx.fillCircle(headX + dx * eyeOffset + px * eyeDist, headY + dy * eyeOffset + py * eyeDist, 1.2);
    gfx.fillCircle(headX + dx * eyeOffset - px * eyeDist, headY + dy * eyeOffset - py * eyeDist, 1.2);
  }

  private isSneaking(): boolean {
    if (agentInput.enabled) return agentInput.sneaking;
    return this.shiftKey.isDown || this.touchSneaking;
  }

  private isMoving(): boolean {
    if (agentInput.enabled) return agentInput.vx !== 0 || agentInput.vy !== 0;
    return this.cursors.left.isDown || this.cursors.right.isDown ||
      this.cursors.up.isDown || this.cursors.down.isDown ||
      this.wasd.A.isDown || this.wasd.D.isDown ||
      this.wasd.W.isDown || this.wasd.S.isDown ||
      this.touchMoving;
  }

  private movePlayer(dt: number): void {
    const sneaking = this.isSneaking();
    const speed = sneaking ? SNEAK_SPEED : PLAYER_SPEED;
    let vx = 0;
    let vy = 0;

    if (this.cursors.left.isDown || this.wasd.A.isDown) vx = -1;
    if (this.cursors.right.isDown || this.wasd.D.isDown) vx = 1;
    if (this.cursors.up.isDown || this.wasd.W.isDown) vy = -1;
    if (this.cursors.down.isDown || this.wasd.S.isDown) vy = 1;

    if (vx !== 0 && vy !== 0) { vx *= 0.707; vy *= 0.707; }

    // merge touch input (touch overrides if active)
    if (this.touchMoving) {
      vx = this.touchVx;
      vy = this.touchVy;
    }

    // agent input overrides all
    if (agentInput.enabled) {
      vx = agentInput.vx;
      vy = agentInput.vy;
    }

    const moving = vx !== 0 || vy !== 0;
    if (moving) this.playerAngle = Math.atan2(vy, vx);

    const nx = this.playerX + vx * speed * dt;
    const ny = this.playerY + vy * speed * dt;
    const r = 8;

    if (!this.hitsWall(nx, this.playerY, r)) this.playerX = nx;
    if (!this.hitsWall(this.playerX, ny, r)) this.playerY = ny;

    this.playerX = Phaser.Math.Clamp(this.playerX, r, WIDTH - r);
    this.playerY = Phaser.Math.Clamp(this.playerY, r, HEIGHT - r);

    if (moving && !sneaking) {
      this.footstepTimer += dt;
      if (this.footstepTimer > 0.08) {
        this.footstepTimer = 0;
        this.footsteps.push({ x: this.playerX, y: this.playerY, life: 1.0 });
      }
    }
  }

  private hitsWall(x: number, y: number, r: number): boolean {
    const corners: [number, number][] = [
      [x - r, y - r], [x + r, y - r],
      [x - r, y + r], [x + r, y + r],
    ];
    return corners.some(([px, py]) => {
      const col = Math.floor(px / TILE);
      const row = Math.floor(py / TILE);
      if (col < 0 || col >= COLS || row < 0 || row >= ROWS) return true;
      return this.grid[row][col] === 1;
    });
  }

  // ── exit portal ─────────────────────────────────────────
  private buildExit(): void {
    const pos = this.findTile(3);
    this.exitX = pos.col * TILE + TILE / 2;
    this.exitY = pos.row * TILE + TILE / 2;
    this.exitTime = 0;
    this.exitGfx = this.add.graphics().setDepth(5);
  }

  private drawExitPortal(): void {
    const gfx = this.exitGfx;
    gfx.clear();
    const x = this.exitX;
    const y = this.exitY;
    const t = this.exitTime;

    gfx.fillStyle(0x44ddff, 0.08 + Math.sin(t * 3) * 0.04);
    gfx.fillCircle(x, y, 18);

    const rings = [
      { r: 14, width: 2, speed: 1.5, color: 0x44ddff, segments: 3 },
      { r: 10, width: 2, speed: -2.2, color: 0x88eeff, segments: 4 },
      { r: 6, width: 1.5, speed: 3.0, color: 0xffffff, segments: 2 },
    ];

    rings.forEach(ring => {
      const segAngle = (Math.PI * 2) / ring.segments;
      const gapAngle = segAngle * 0.3;
      gfx.lineStyle(ring.width, ring.color, 0.7 + Math.sin(t * 2) * 0.2);

      for (let i = 0; i < ring.segments; i++) {
        const start = t * ring.speed + i * segAngle;
        const end = start + segAngle - gapAngle;
        gfx.beginPath();
        gfx.arc(x, y, ring.r, start, end, false);
        gfx.strokePath();
      }
    });

    const pulse = 1 + Math.sin(t * 4) * 0.15;
    const s = 3 * pulse;
    gfx.fillStyle(0xffffff, 0.9);
    gfx.beginPath();
    gfx.moveTo(x, y - s); gfx.lineTo(x + s, y); gfx.lineTo(x, y + s); gfx.lineTo(x - s, y);
    gfx.closePath();
    gfx.fillPath();
  }

  private checkExit(): void {
    const dx = this.playerX - this.exitX;
    const dy = this.playerY - this.exitY;
    if (Math.abs(dx) < TILE / 2 && Math.abs(dy) < TILE / 2) {
      this.won = true;
      this.totalTime += this.elapsed;
      this.saveBestTime(this.level, this.elapsed);
      const t = this.elapsed.toFixed(1);
      const total = this.totalTime.toFixed(1);
      const best = this.getBestTime(this.level);
      const bestStr = best !== null && best < this.elapsed ? ` (best: ${best.toFixed(1)}s)` : ' NEW BEST!';
      if (this.isTouchDevice) {
        this.hudText.setText(`ESCAPED LVL ${this.level} in ${t}s${bestStr}\ntap left=retry · tap right=next`);
      } else {
        this.hudText.setText(`ESCAPED LVL ${this.level} in ${t}s${bestStr} · R retry · N next`);
      }
      this.input.keyboard!.once('keydown-R', () => this.scene.restart());
      this.input.keyboard!.once('keydown-N', () => {
        this.level++;
        this.scene.restart();
      });
      if (this.isTouchDevice) {
        this.input.once('pointerdown', (pointer: Phaser.Input.Pointer) => {
          if (pointer.x < WIDTH / 2) {
            this.scene.restart();
          } else {
            this.level++;
            this.scene.restart();
          }
        });
      }
    }
  }

  // ── cameras ─────────────────────────────────────────────
  private buildCameras(): void {
    this.cams = this.cameraDefs.map(def => {
      // offset camera toward its mount wall so it hugs the edge
      const wallDirX = def.wallCol - def.col;
      const wallDirY = def.wallRow - def.row;
      return {
        ...def,
        x: def.col * TILE + TILE / 2 + wallDirX * (TILE / 2 - 2),
        y: def.row * TILE + TILE / 2 + wallDirY * (TILE / 2 - 2),
        currentAngle: def.baseAngle,
        time: Math.random() * Math.PI * 2,
        detected: false,
      };
    });

    const gfx = this.add.graphics().setDepth(15);
    this.cams.forEach(cam => {
      gfx.fillStyle(0xff4444);
      gfx.fillCircle(cam.x, cam.y, 5);
      gfx.lineStyle(1, 0xff6666);
      gfx.strokeCircle(cam.x, cam.y, 7);
    });
  }

  private updateCameras(dt: number): void {
    this.cams.forEach(cam => {
      cam.time += dt * cam.speed;
      cam.currentAngle = cam.baseAngle + Math.sin(cam.time) * cam.sweep;
    });
  }

  // ── guards ──────────────────────────────────────────────
  private buildGuards(): void {
    this.guards = this.guardDefs.map(def => {
      const wp0 = def.waypoints[0];
      const wp1 = def.waypoints.length > 1 ? def.waypoints[1] : def.waypoints[0];
      const facingAngle = Phaser.Math.RadToDeg(
        Math.atan2((wp1.row - wp0.row), (wp1.col - wp0.col))
      );
      return {
        x: wp0.col * TILE + TILE / 2,
        y: wp0.row * TILE + TILE / 2,
        currentAngle: facingAngle,
        range: def.range,
        halfAngle: def.halfAngle,
        wallCol: -1,
        wallRow: -1,
        waypoints: def.waypoints,
        waypointIndex: 1,
        direction: 1 as const,
        walkSpeed: def.speed,
        pauseTimer: 0,
        pauseTime: def.pauseTime,
        noiseAngle: null,
        noiseTimer: 0,
        detected: false,
      };
    });
  }

  private updateGuards(dt: number): void {
    this.guards.forEach(guard => {
      // pausing at waypoint
      if (guard.pauseTimer > 0) {
        guard.pauseTimer -= dt;
        return;
      }

      // investigating noise — stand still and stare
      if (guard.noiseAngle !== null) {
        guard.currentAngle = guard.noiseAngle;
        guard.noiseTimer -= dt;
        if (guard.noiseTimer <= 0) {
          guard.noiseAngle = null;
        }
        return;
      }

      const target = guard.waypoints[guard.waypointIndex];
      const tx = target.col * TILE + TILE / 2;
      const ty = target.row * TILE + TILE / 2;
      const dx = tx - guard.x;
      const dy = ty - guard.y;
      const dist = Math.sqrt(dx * dx + dy * dy);

      if (dist > 0.5) {
        guard.currentAngle = Phaser.Math.RadToDeg(Math.atan2(dy, dx));
      }

      const step = guard.walkSpeed * TILE * dt;

      if (dist <= step) {
        guard.x = tx;
        guard.y = ty;
        guard.pauseTimer = guard.pauseTime;

        // ping-pong: reverse at ends
        const next = guard.waypointIndex + guard.direction;
        if (next < 0 || next >= guard.waypoints.length) {
          guard.direction = (guard.direction * -1) as 1 | -1;
          guard.waypointIndex += guard.direction;
        } else {
          guard.waypointIndex = next;
        }
      } else {
        guard.x += (dx / dist) * step;
        guard.y += (dy / dist) * step;
      }
    });
  }

  private drawGuards(): void {
    const gfx = this.guardGfx;
    gfx.clear();

    this.guards.forEach(guard => {
      const x = guard.x;
      const y = guard.y;
      const angle = Phaser.Math.DegToRad(guard.currentAngle);
      const bodyColor = guard.detected ? 0xff2222 : 0xdd8844;
      const outlineColor = guard.detected ? 0xff0000 : 0xaa6633;

      const dx = Math.cos(angle);
      const dy = Math.sin(angle);
      const px = -dy;
      const py = dx;

      // stockier triangle body
      const noseTipX = x + dx * 9;
      const noseTipY = y + dy * 9;
      const backLeftX = x - dx * 5 + px * 8;
      const backLeftY = y - dy * 5 + py * 8;
      const backRightX = x - dx * 5 - px * 8;
      const backRightY = y - dy * 5 - py * 8;

      gfx.fillStyle(bodyColor);
      gfx.beginPath();
      gfx.moveTo(noseTipX, noseTipY);
      gfx.lineTo(backLeftX, backLeftY);
      gfx.lineTo(backRightX, backRightY);
      gfx.closePath();
      gfx.fillPath();

      gfx.lineStyle(1.5, outlineColor);
      gfx.beginPath();
      gfx.moveTo(noseTipX, noseTipY);
      gfx.lineTo(backLeftX, backLeftY);
      gfx.lineTo(backRightX, backRightY);
      gfx.closePath();
      gfx.strokePath();

      // head
      const headX = x + dx * 1;
      const headY = y + dy * 1;
      gfx.fillStyle(bodyColor);
      gfx.fillCircle(headX, headY, 5);
      gfx.lineStyle(1, outlineColor);
      gfx.strokeCircle(headX, headY, 5);

      // red eyes
      const eyeOffset = 4;
      const eyeSpread = 2;
      gfx.fillStyle(0xff0000);
      gfx.fillCircle(headX + dx * eyeOffset + px * eyeSpread, headY + dy * eyeOffset + py * eyeSpread, 1.5);
      gfx.fillCircle(headX + dx * eyeOffset - px * eyeSpread, headY + dy * eyeOffset - py * eyeSpread, 1.5);
    });
  }

  private applyNoise(dt: number): void {
    if (this.isSneaking()) return;
    if (!this.isMoving()) return;

    this.cams.forEach(cam => {
      const dx = this.playerX - cam.x;
      const dy = this.playerY - cam.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist > NOISE_RADIUS) return;

      const angleToPlayer = Phaser.Math.RadToDeg(Math.atan2(dy, dx));
      const diff = Phaser.Math.Angle.ShortestBetween(cam.currentAngle, angleToPlayer);
      const strength = 1 - (dist / NOISE_RADIUS);
      cam.currentAngle += diff * NOISE_SNAP_SPEED * strength * dt;
    });

    // guards stop and stare at noise
    this.guards.forEach(guard => {
      const dx = this.playerX - guard.x;
      const dy = this.playerY - guard.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist > NOISE_RADIUS) return;

      guard.noiseAngle = Phaser.Math.RadToDeg(Math.atan2(dy, dx));
      guard.noiseTimer = GUARD_NOISE_LOOK_TIME;
    });
  }

  // ── footstep trail ──────────────────────────────────────
  private drawTrail(dt: number): void {
    const gfx = this.trailGfx;
    gfx.clear();
    this.footsteps = this.footsteps.filter(f => { f.life -= dt * 0.6; return f.life > 0; });
    this.footsteps.forEach(f => {
      gfx.fillStyle(0x44dd88, f.life * 0.2);
      gfx.fillCircle(f.x, f.y, 2);
    });
  }

  private drawCones(): void {
    const gfx = this.coneGfx;
    gfx.clear();

    this.cams.forEach(cam => {
      const points = buildConePolygon(cam);
      const color = cam.detected ? 0xff2222 : 0xffff44;
      const alpha = cam.detected ? 0.35 : 0.12;

      gfx.fillStyle(color, alpha);
      gfx.beginPath();
      gfx.moveTo(points[0].x, points[0].y);
      points.slice(1).forEach(p => gfx.lineTo(p.x, p.y));
      gfx.closePath();
      gfx.fillPath();

      gfx.lineStyle(1, color, alpha + 0.15);
      gfx.beginPath();
      gfx.moveTo(cam.x, cam.y);
      gfx.lineTo(points[1].x, points[1].y);
      gfx.moveTo(cam.x, cam.y);
      gfx.lineTo(points[points.length - 1].x, points[points.length - 1].y);
      gfx.strokePath();
    });

    // guard cones (orange)
    this.guards.forEach(guard => {
      const points = buildConePolygon(guard);
      const color = guard.detected ? 0xff2222 : 0xff8844;
      const alpha = guard.detected ? 0.35 : 0.15;

      gfx.fillStyle(color, alpha);
      gfx.beginPath();
      gfx.moveTo(points[0].x, points[0].y);
      points.slice(1).forEach(p => gfx.lineTo(p.x, p.y));
      gfx.closePath();
      gfx.fillPath();

      gfx.lineStyle(1, color, alpha + 0.15);
      gfx.beginPath();
      gfx.moveTo(guard.x, guard.y);
      gfx.lineTo(points[1].x, points[1].y);
      gfx.moveTo(guard.x, guard.y);
      gfx.lineTo(points[points.length - 1].x, points[points.length - 1].y);
      gfx.strokePath();
    });
  }

  // ── detection ───────────────────────────────────────────
  private checkDetection(): void {
    this.proximity = this.cams.reduce((closest, cam) => {
      const d = nearestConeDistance(this.playerX, this.playerY, cam);
      return Math.min(closest, d);
    }, Infinity);

    this.proximity = this.guards.reduce((closest, guard) => {
      const d = nearestConeDistance(this.playerX, this.playerY, guard);
      return Math.min(closest, d);
    }, this.proximity);

    this.cams.forEach(cam => {
      cam.detected = isPointInCone(this.playerX, this.playerY, cam);
    });

    this.guards.forEach(guard => {
      guard.detected = isPointInCone(this.playerX, this.playerY, guard);
    });

    const seen = this.cams.some(c => c.detected) || this.guards.some(g => g.detected);
    if (seen) {
      this.caught = true;
      this.caughtTimer = 0;
    }
  }

  // ── proximity vignette ─────────────────────────────────
  private drawVignette(): void {
    const gfx = this.vignetteGfx;
    gfx.clear();

    // use the closest camera/guard range for danger distance
    const maxRange = [...this.cams, ...this.guards].reduce((m, c) => Math.max(m, c.range), 0);
    const dangerDist = maxRange * 0.5;
    if (this.proximity < dangerDist) {
      const intensity = 1 - (this.proximity / dangerDist);
      const alpha = intensity * 0.3;
      const thickness = 8 + intensity * 24;

      gfx.fillStyle(0xff2222, alpha);
      gfx.fillRect(0, 0, WIDTH, thickness);
      gfx.fillRect(0, HEIGHT - thickness, WIDTH, thickness);
      gfx.fillRect(0, 0, thickness, HEIGHT);
      gfx.fillRect(WIDTH - thickness, 0, thickness, HEIGHT);
    }
  }

  // ── hud ─────────────────────────────────────────────────
  private updateHud(): void {
    this.timerText.setText(this.elapsed.toFixed(1) + 's');

    if (!this.caught && !this.won) {
      this.hudText.setText(this.isTouchDevice
        ? 'drag to move · SNK button to sneak · reach the portal'
        : 'WASD/arrows · SHIFT to sneak (silent) · reach the portal');
    }
  }

  // ── agent state push ──────────────────────────────────
  private pushAgentState(): void {
    if (!agentInput.enabled) return;
    updateAgentState({
      playerX: this.playerX, playerY: this.playerY, playerAngle: this.playerAngle,
      sneaking: this.isSneaking(), moving: this.isMoving(),
      cams: this.cams, guards: this.guards,
      exitX: this.exitX, exitY: this.exitY,
      caught: this.caught, won: this.won,
      elapsed: this.elapsed, level: this.level,
      grid: this.grid, proximity: this.proximity,
    });
  }

  // ── best time persistence ──────────────────────────────
  private getBestTime(level: number): number | null {
    try {
      const v = localStorage.getItem(`camera-sneak-best-${level}`);
      return v !== null ? parseFloat(v) : null;
    } catch { return null; }
  }

  private saveBestTime(level: number, time: number): void {
    try {
      const prev = this.getBestTime(level);
      if (prev === null || time < prev) {
        localStorage.setItem(`camera-sneak-best-${level}`, time.toString());
      }
    } catch { /* localStorage unavailable */ }
  }
}
