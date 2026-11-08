import { describe, expect, it } from "vitest";
import { deburrPath, drillPose, facePose, layoutHoles, layoutPockets, pocketPose } from "@/lib/studio/cutMotion";
import type { VisibleCut } from "@/lib/studio/stages";

const hole: VisibleCut = { kind: "hole", count: 4, diameter: 8, depth: 12, width: 0, length: 0 };
const pocket: VisibleCut = { kind: "pocket", count: 1, diameter: 0, depth: 6, width: 30, length: 60 };

describe("machined cut motion", () => {
  it("faces the top in more than one pass", () => {
    const start = facePose(0, 150, 90, 32);
    const end = facePose(1, 150, 90, 32);
    expect(start.passes).toBeGreaterThan(1);
    expect(start.x).toBeCloseTo(-75);
    expect(end.pass).toBe(start.passes - 1);
    expect(end.z).toBeGreaterThan(start.z);
  });

  it("moves the pocket tool across the opening and down to the floor", () => {
    const [frame] = layoutPockets([pocket], 150, 90, 20);
    const plunged = pocketPose(0.16, frame, 3.2);
    const middle = pocketPose(0.55, frame, 3.2);
    expect(frame.depth).toBe(6);
    expect(plunged.plunge).toBe(1);
    expect(middle.cleared).toBeGreaterThan(0);
    expect(middle.cleared).toBeLessThan(1);
    expect(middle.x).toBeGreaterThan(frame.x0);
    expect(middle.x).toBeLessThan(frame.x1);
    expect(middle.z).toBeGreaterThanOrEqual(frame.z0);
    expect(middle.z).toBeLessThanOrEqual(frame.z1);
  });

  it("drills each hole in turn down to its depth", () => {
    const spots = layoutHoles(hole, 150, 90, 20);
    expect(spots).toHaveLength(4);
    expect(new Set(spots.map((spot) => `${spot.x},${spot.z}`)).size).toBe(4);
    const first = drillPose(0.04, spots, 20);
    const deep = drillPose(0.125, spots, 20);
    const later = drillPose(0.6, spots, 20);
    expect(first.index).toBe(0);
    expect(first.plunge).toBe(0);
    expect(deep.index).toBe(0);
    expect(deep.tipDrop).toBeGreaterThan(1);
    expect(deep.tipDrop).toBeLessThanOrEqual(12);
    expect(later.index).toBeGreaterThan(0);
  });

  it("walks the outer edge, the pocket rim, and each hole during deburr", () => {
    const spots = layoutHoles(hole, 150, 90, 20);
    const frames = layoutPockets([pocket], 150, 90, 20);
    const path = deburrPath(150, 90, 20, frames, spots);
    expect(path.length).toBeGreaterThan(5 + 14);
    expect(path[0]).toMatchObject({ x: -75, z: -45, y: 20 });
    expect(path.some((point) => Math.hypot(point.x - spots[0].x, point.z - spots[0].z) < spots[0].radius + 0.2)).toBe(true);
  });
});
