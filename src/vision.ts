import Phaser from 'phaser';
import { TILE, COLS, ROWS, CONE_RANGE, CONE_HALF_ANGLE } from './constants';
import type { TileType, CameraState, Point } from './types';

const RAY_STEP = 4;

let currentGrid: TileType[][] = [];

export const setGrid = (grid: TileType[][]): void => {
  currentGrid = grid;
};

export const raycast = (ox: number, oy: number, angle: number, maxDist: number): number => {
  const rad = Phaser.Math.DegToRad(angle);
  const dx = Math.cos(rad);
  const dy = Math.sin(rad);
  let dist = 0;

  while (dist < maxDist) {
    dist += RAY_STEP;
    const x = ox + dx * dist;
    const y = oy + dy * dist;
    const col = Math.floor(x / TILE);
    const row = Math.floor(y / TILE);

    if (col < 0 || col >= COLS || row < 0 || row >= ROWS) return dist;
    if (currentGrid[row]?.[col] === 1) return dist;
  }
  return maxDist;
};

export const isPointInCone = (px: number, py: number, cam: CameraState): boolean => {
  const dx = px - cam.x;
  const dy = py - cam.y;
  const dist = Math.sqrt(dx * dx + dy * dy);

  if (dist > CONE_RANGE) return false;

  const angleToPoint = Phaser.Math.RadToDeg(Math.atan2(dy, dx));
  const diff = Phaser.Math.Angle.ShortestBetween(cam.currentAngle, angleToPoint);

  if (Math.abs(diff) > CONE_HALF_ANGLE) return false;

  const losRange = raycast(cam.x, cam.y, angleToPoint, CONE_RANGE);
  return dist <= losRange;
};

export const buildConePolygon = (cam: CameraState, numRays = 30): Point[] => {
  const startAngle = cam.currentAngle - CONE_HALF_ANGLE;
  const endAngle = cam.currentAngle + CONE_HALF_ANGLE;
  const step = (endAngle - startAngle) / numRays;

  const points: Point[] = [{ x: cam.x, y: cam.y }];

  for (let i = 0; i <= numRays; i++) {
    const angle = startAngle + step * i;
    const dist = raycast(cam.x, cam.y, angle, CONE_RANGE);
    const rad = Phaser.Math.DegToRad(angle);
    points.push({
      x: cam.x + Math.cos(rad) * dist,
      y: cam.y + Math.sin(rad) * dist,
    });
  }

  return points;
};

export const nearestConeDistance = (px: number, py: number, cam: CameraState): number => {
  const dx = px - cam.x;
  const dy = py - cam.y;
  const dist = Math.sqrt(dx * dx + dy * dy);

  if (dist > CONE_RANGE * 1.5) return dist;

  const angleToPoint = Phaser.Math.RadToDeg(Math.atan2(dy, dx));
  const diff = Math.abs(Phaser.Math.Angle.ShortestBetween(cam.currentAngle, angleToPoint));

  if (diff <= CONE_HALF_ANGLE && dist <= CONE_RANGE) {
    return 0;
  }

  const angularGap = Math.max(0, diff - CONE_HALF_ANGLE);
  const angularDist = Phaser.Math.DegToRad(angularGap) * Math.min(dist, CONE_RANGE);
  const radialGap = Math.max(0, dist - CONE_RANGE);

  return Math.sqrt(angularDist * angularDist + radialGap * radialGap);
};
