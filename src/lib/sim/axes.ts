import type { Vec3 } from "@/lib/sim/types";

export const UP: Vec3 = [0, 0, 1];

const RAD = Math.PI / 180;

/**
 * Tool axis for rotary words, in program coordinates.
 * A tilts the tool about X, B tilts it about Y, and C turns the tilt direction about Z.
 * The tool tilts about its tip, as a control does with tool-centre-point control on (G43.4).
 * Real machines differ in sign and in which axis moves the table, so a post must match this convention.
 */
export function axisFromRotary(a: number, b: number, c: number): Vec3 {
  const ca = Math.cos(a * RAD);
  const x = ca * Math.sin(b * RAD);
  const y = -Math.sin(a * RAD);
  const z = ca * Math.cos(b * RAD);
  const cc = Math.cos(c * RAD);
  const sc = Math.sin(c * RAD);
  return normalize([x * cc - y * sc, x * sc + y * cc, z]);
}

export function normalize(vector: Vec3): Vec3 {
  const length = Math.hypot(vector[0], vector[1], vector[2]) || 1;
  return [vector[0] / length, vector[1] / length, vector[2] / length];
}

export function isTilted(axis: Vec3 | undefined): boolean {
  return axis !== undefined && (Math.abs(axis[0]) > 1e-9 || Math.abs(axis[1]) > 1e-9 || axis[2] < 1 - 1e-9);
}

export function sameAxis(a: Vec3, b: Vec3): boolean {
  return Math.abs(a[0] - b[0]) < 1e-9 && Math.abs(a[1] - b[1]) < 1e-9 && Math.abs(a[2] - b[2]) < 1e-9;
}

/** Angle between two unit axes, degrees. */
export function axisAngle(a: Vec3, b: Vec3): number {
  const dot = Math.min(Math.max(a[0] * b[0] + a[1] * b[1] + a[2] * b[2], -1), 1);
  return Math.acos(dot) / RAD;
}

export function lerpAxis(a: Vec3, b: Vec3, t: number): Vec3 {
  return normalize([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]);
}
