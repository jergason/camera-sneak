export type TileType = 0 | 1 | 2 | 3; // floor, wall, player start, exit

export interface VisionSource {
  x: number;
  y: number;
  currentAngle: number;
  range: number;
  halfAngle: number;
  wallCol: number;
  wallRow: number;
}

export interface CameraDef {
  col: number;
  row: number;
  wallCol: number;
  wallRow: number;
  baseAngle: number;
  sweep: number;
  speed: number;
  range: number;
  halfAngle: number;
}

export interface CameraState extends CameraDef, VisionSource {
  currentAngle: number;
  time: number;
  detected: boolean;
}

export interface GuardDef {
  waypoints: { col: number; row: number }[];
  speed: number;
  range: number;
  halfAngle: number;
  pauseTime: number;
}

export interface GuardState extends VisionSource {
  waypoints: { col: number; row: number }[];
  waypointIndex: number;
  direction: 1 | -1;
  walkSpeed: number;
  pauseTimer: number;
  pauseTime: number;
  noiseAngle: number | null;
  noiseTimer: number;
  detected: boolean;
}

export interface Point {
  x: number;
  y: number;
}
