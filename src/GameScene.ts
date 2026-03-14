import Phaser from 'phaser';
import { TILE, COLS, ROWS, WIDTH, HEIGHT, PLAYER_SPEED, SNEAK_SPEED, CONE_RANGE } from './constants';
import { generateLevel } from './procgen';
import { setGrid, isPointInCone, buildConePolygon, nearestConeDistance } from './vision';
import type { TileType, CameraDef, CameraState } from './types';

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
  private coneGfx!: Phaser.GameObjects.Graphics;
  private alertBar!: Phaser.GameObjects.Graphics;
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
    const { grid, cameras } = generateLevel(seed);
    this.grid = grid;
    this.cameraDefs = cameras;
    setGrid(grid);

    this.drawMap();
    this.spawnPlayer();
    this.buildCameras();
    this.buildExit();

    this.cursors = this.input.keyboard!.createCursorKeys();
    this.shiftKey = this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.SHIFT);
    this.wasd = this.input.keyboard!.addKeys('W,A,S,D') as Record<'W' | 'A' | 'S' | 'D', Phaser.Input.Keyboard.Key>;

    this.trailGfx = this.add.graphics().setDepth(1);
    this.coneGfx = this.add.graphics();
    this.vignetteGfx = this.add.graphics().setDepth(90);
    this.alertBar = this.add.graphics();
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

    this.updateHud();
  }

  update(_time: number, delta: number): void {
    if (this.caught || this.won) return;

    const dt = delta / 1000;
    this.elapsed += dt;
    this.exitTime += dt;
    this.movePlayer(dt);
    this.updateCameras(dt);
    this.applyNoise(dt);
    this.drawTrail(dt);
    this.drawCones();
    this.drawPlayer();
    this.drawExitPortal();
    this.checkDetection(dt);
    this.drawVignette();
    this.checkExit();
    this.updateHud();
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

    const sneaking = this.shiftKey.isDown;
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

  private movePlayer(dt: number): void {
    const sneaking = this.shiftKey.isDown;
    const speed = sneaking ? SNEAK_SPEED : PLAYER_SPEED;
    let vx = 0;
    let vy = 0;

    if (this.cursors.left.isDown || this.wasd.A.isDown) vx = -1;
    if (this.cursors.right.isDown || this.wasd.D.isDown) vx = 1;
    if (this.cursors.up.isDown || this.wasd.W.isDown) vy = -1;
    if (this.cursors.down.isDown || this.wasd.S.isDown) vy = 1;

    if (vx !== 0 && vy !== 0) { vx *= 0.707; vy *= 0.707; }

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
      const t = this.elapsed.toFixed(1);
      const total = this.totalTime.toFixed(1);
      this.hudText.setText(`ESCAPED LVL ${this.level} in ${t}s (total: ${total}s) · R retry · N next`);
      this.input.keyboard!.once('keydown-R', () => this.scene.restart());
      this.input.keyboard!.once('keydown-N', () => {
        this.level++;
        this.scene.restart();
      });
    }
  }

  // ── cameras ─────────────────────────────────────────────
  private buildCameras(): void {
    this.cams = this.cameraDefs.map(def => ({
      ...def,
      x: def.col * TILE + TILE / 2,
      y: def.row * TILE + TILE / 2,
      currentAngle: def.baseAngle,
      time: Math.random() * Math.PI * 2,
      detected: false,
    }));

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

  private applyNoise(dt: number): void {
    const sneaking = this.shiftKey.isDown;
    if (sneaking) return;

    const moving = this.cursors.left.isDown || this.cursors.right.isDown ||
      this.cursors.up.isDown || this.cursors.down.isDown ||
      this.wasd.A.isDown || this.wasd.D.isDown ||
      this.wasd.W.isDown || this.wasd.S.isDown;

    if (!moving) return;

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
  }

  // ── detection ───────────────────────────────────────────
  private checkDetection(dt: number): void {
    let seen = false;

    this.proximity = this.cams.reduce((closest, cam) => {
      const d = nearestConeDistance(this.playerX, this.playerY, cam);
      return Math.min(closest, d);
    }, Infinity);

    this.cams.forEach(cam => {
      cam.detected = isPointInCone(this.playerX, this.playerY, cam);
      if (cam.detected) seen = true;
    });

    if (seen) {
      this.alert = Math.min(1, this.alert + dt * 0.8);
      if (this.alert >= 1) {
        this.caught = true;
        const t = this.elapsed.toFixed(1);
        this.hudText.setText(`DETECTED at ${t}s! press R to retry`);
        this.input.keyboard!.once('keydown-R', () => this.scene.restart());
      }
    } else {
      this.alert = Math.max(0, this.alert - dt * 0.5);
    }
  }

  // ── proximity vignette ─────────────────────────────────
  private drawVignette(): void {
    const gfx = this.vignetteGfx;
    gfx.clear();

    const dangerDist = CONE_RANGE * 0.6;
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
    const bar = this.alertBar;
    bar.clear();
    bar.setDepth(100);

    const barW = 120;
    const barH = 8;
    const bx = WIDTH - barW - 16;
    const by = 10;

    bar.fillStyle(0x222222, 0.8);
    bar.fillRect(bx, by, barW, barH);

    const color = this.alert > 0.6 ? 0xff2222 : this.alert > 0.3 ? 0xffaa22 : 0x44dd88;
    bar.fillStyle(color);
    bar.fillRect(bx, by, barW * this.alert, barH);

    bar.lineStyle(1, 0x888888);
    bar.strokeRect(bx, by, barW, barH);

    this.timerText.setText(this.elapsed.toFixed(1) + 's');

    if (!this.caught && !this.won) {
      this.hudText.setText('WASD/arrows · SHIFT to sneak (silent) · reach the portal');
    }
  }
}
