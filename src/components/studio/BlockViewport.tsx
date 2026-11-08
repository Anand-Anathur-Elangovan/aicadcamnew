"use client";

import { useEffect, useRef } from "react";
import type { MachiningStage, TurningJob, VisibleCut } from "@/lib/studio/stages";
import {
  deburrPath,
  drillPose,
  facePose,
  layoutHoles,
  layoutPockets,
  pocketPose,
  pointAlong,
  type HoleSpot,
  type PocketFrame,
} from "@/lib/studio/cutMotion";

const NO_CUTS: VisibleCut[] = [];

interface Props {
  stock: TurningJob;
  stage: MachiningStage;
  previous?: VisibleCut[];
  isPlaying: boolean;
  onPlayEnd?: () => void;
}

function stageMode(stage: MachiningStage): "face" | "profile" | "pocket" | "drill" | "tap" | "deburr" | "other" {
  const name = stage.name.toLowerCase();
  if (name.includes("face")) return "face";
  if (name.includes("profile")) return "profile";
  if (name.includes("pocket") || name.includes("slot")) return "pocket";
  if (name.includes("drill") || name.includes("bore")) return "drill";
  if (name.includes("tap")) return "tap";
  if (name.includes("deburr")) return "deburr";
  return "other";
}

export default function BlockViewport({ stock, stage, previous = NO_CUTS, isPlaying, onPlayEnd }: Props) {
  const mountRef = useRef<HTMLDivElement>(null);
  const progressRef = useRef(0);
  const onPlayEndRef = useRef(onPlayEnd);
  useEffect(() => {
    onPlayEndRef.current = onPlayEnd;
  }, [onPlayEnd]);

  useEffect(() => {
    const container = mountRef.current;
    if (!container) return;
    let cancelled = false;
    let renderer: import("three").WebGLRenderer | null = null;
    let frame = 0;

    (async () => {
      const THREE = await import("three");
      const { OrbitControls } = await import("three/examples/jsm/controls/OrbitControls.js");
      if (cancelled) return;

      const length = stock.stockLength;
      const width = stock.stockWidth;
      const height = stock.stockHeight;
      const mode = stageMode(stage);
      const added = (stage.completed ?? []).slice(previous.length);
      const scene = new THREE.Scene();
      scene.background = new THREE.Color(0x0f172a);
      renderer = new THREE.WebGLRenderer({ antialias: true });
      renderer.setPixelRatio(window.devicePixelRatio);
      renderer.setSize(container.clientWidth || 800, container.clientHeight || 600, false);
      renderer.domElement.style.width = "100%";
      renderer.domElement.style.height = "100%";
      renderer.domElement.style.display = "block";
      if (cancelled) return;
      container.replaceChildren(renderer.domElement);

      const span = Math.max(length, width, height);
      const camera = new THREE.PerspectiveCamera(42, (container.clientWidth || 800) / Math.max(container.clientHeight || 600, 1), 0.1, 4000);
      camera.position.set(span * 0.95, span * 1.15, span * 1.05);
      const controls = new OrbitControls(camera, renderer.domElement);
      controls.target.set(0, height / 2, 0);
      controls.update();
      scene.add(new THREE.AmbientLight(0xffffff, 0.82));
      const key = new THREE.DirectionalLight(0xffffff, 0.9);
      key.position.set(span, span * 1.6, span * 0.4);
      scene.add(key);
      scene.add(new THREE.GridHelper(Math.max(span * 4, 240), 20, 0x334155, 0x1e293b));

      const roughMat = new THREE.MeshStandardMaterial({ color: 0x64748b, metalness: 0.25, roughness: 0.55 });
      const finishMat = new THREE.MeshStandardMaterial({ color: 0xd5dee8, metalness: 0.45, roughness: 0.32 });
      const floorMat = new THREE.MeshStandardMaterial({ color: 0xb7c3d0, metalness: 0.4, roughness: 0.38 });
      const toolMat = new THREE.MeshStandardMaterial({ color: 0xfbbf24, emissive: 0xf59e0b, emissiveIntensity: 0.55, metalness: 0.4, roughness: 0.3 });
      const part = new THREE.Group();
      scene.add(part);

      const jawMat = new THREE.MeshStandardMaterial({ color: 0x475569, metalness: 0.35, roughness: 0.5 });
      const jaw = new THREE.Mesh(new THREE.BoxGeometry(length * 0.55, Math.max(height * 0.45, 8), 8), jawMat);
      jaw.position.set(0, height * 0.28, width / 2 + 8);
      scene.add(jaw);
      const jaw2 = jaw.clone();
      jaw2.position.z = -width / 2 - 8;
      scene.add(jaw2);

      const faceMill = new THREE.Mesh(new THREE.CylinderGeometry(16, 16, 7, 28), toolMat);
      faceMill.geometry.translate(0, 3.5, 0);
      const ball = new THREE.Mesh(new THREE.SphereGeometry(3.2, 18, 14), toolMat);
      const drill = new THREE.Group();
      const drillShaft = new THREE.Mesh(new THREE.CylinderGeometry(2.2, 2.2, 22, 16), toolMat);
      drillShaft.geometry.translate(0, 14, 0);
      const drillTip = new THREE.Mesh(new THREE.ConeGeometry(2.2, 7, 16), toolMat);
      drillTip.geometry.translate(0, 3.2, 0);
      drill.add(drillTip, drillShaft);
      scene.add(faceMill, ball, drill);
      faceMill.visible = false;
      ball.visible = false;
      drill.visible = false;

      const edgeGeo = new THREE.BufferGeometry();
      const edgeMat = new THREE.LineBasicMaterial({ color: 0xfb923c });
      const doneMat = new THREE.LineBasicMaterial({ color: 0xe2e8f0 });
      const edgeLine = new THREE.Line(edgeGeo, edgeMat);
      const doneLine = new THREE.Line(edgeGeo, doneMat);
      scene.add(edgeLine, doneLine);
      edgeLine.visible = false;
      doneLine.visible = false;

      const clearPart = () => {
        while (part.children.length) {
          const child = part.children[0] as import("three").Mesh;
          child.geometry?.dispose();
          part.remove(child);
        }
      };

      const addBox = (w: number, h: number, d: number, x: number, y: number, z: number, material: import("three").Material) => {
        if (w <= 0.2 || h <= 0.2 || d <= 0.2) return;
        const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
        mesh.position.set(x, y, z);
        part.add(mesh);
      };

      const addSlab = (
        yBottom: number,
        thickness: number,
        x0: number,
        x1: number,
        z0: number,
        z1: number,
        circles: { x: number; z: number; radius: number }[],
        rects: PocketFrame[],
        material: import("three").Material,
      ) => {
        if (thickness <= 0.2 || x1 - x0 <= 0.2 || z1 - z0 <= 0.2) return;
        if (!circles.length && !rects.length) {
          addBox(x1 - x0, thickness, z1 - z0, (x0 + x1) / 2, yBottom + thickness / 2, (z0 + z1) / 2, material);
          return;
        }
        const contour = [
          new THREE.Vector2(x0, -z1),
          new THREE.Vector2(x1, -z1),
          new THREE.Vector2(x1, -z0),
          new THREE.Vector2(x0, -z0),
        ];
        if (THREE.ShapeUtils.isClockWise(contour)) contour.reverse();
        const shape = new THREE.Shape(contour);
        for (const rect of rects) {
          const hole = [
            new THREE.Vector2(rect.x0, -rect.z0),
            new THREE.Vector2(rect.x1, -rect.z0),
            new THREE.Vector2(rect.x1, -rect.z1),
            new THREE.Vector2(rect.x0, -rect.z1),
          ];
          if (!THREE.ShapeUtils.isClockWise(hole)) hole.reverse();
          shape.holes.push(new THREE.Path(hole));
        }
        for (const circle of circles) {
          const hole = new THREE.Path();
          hole.absarc(circle.x, -circle.z, Math.max(circle.radius, 0.4), 0, Math.PI * 2, true);
          shape.holes.push(hole);
        }
        const geo = new THREE.ExtrudeGeometry(shape, { depth: thickness, bevelEnabled: false, curveSegments: 10 });
        geo.rotateX(-Math.PI / 2);
        const mesh = new THREE.Mesh(geo, material);
        mesh.position.y = yBottom;
        part.add(mesh);
      };

      const apply = (progress: number) => {
        clearPart();
        const profileBefore = previous.some((cut) => cut.kind === "profile");
        const profileCut = Math.min(2, Math.min(length, width) * 0.1);
        const inset = mode === "profile" ? profileCut * progress : profileBefore ? profileCut : 0;
        const x0 = -length / 2 + inset;
        const x1 = length / 2 - inset;
        const z0 = -width / 2 + inset;
        const z1 = width / 2 - inset;
        const body = height;

        faceMill.visible = mode === "face";
        ball.visible = mode === "pocket" || mode === "deburr" || mode === "profile" || mode === "other";
        drill.visible = mode === "drill" || mode === "tap";
        edgeLine.visible = mode === "deburr";
        doneLine.visible = mode === "deburr";

        if (mode === "face") {
          const millDiameter = Math.min(32, Math.max(Math.min(length, width) * 0.8, 4));
          const pose = facePose(progress, length, width, millDiameter);
          faceMill.scale.set(millDiameter / 32, 1, millDiameter / 32);
          const rough = body + Math.min(2, Math.max(height * 0.1, 0.2));
          const zDone = Math.min(width / 2, -width / 2 + pose.pass * pose.step);
          const zPass = Math.min(width / 2, zDone + pose.step);
          if (zDone > -width / 2) addBox(length, body, zDone + width / 2, 0, body / 2, (zDone - width / 2) / 2, finishMat);
          if (zPass > zDone) {
            const cutX = pose.forward ? pose.x : pose.x;
            const doneX0 = pose.forward ? -length / 2 : cutX;
            const doneX1 = pose.forward ? cutX : length / 2;
            const roughX0 = pose.forward ? cutX : -length / 2;
            const roughX1 = pose.forward ? length / 2 : cutX;
            addBox(doneX1 - doneX0, body, zPass - zDone, (doneX0 + doneX1) / 2, body / 2, (zDone + zPass) / 2, finishMat);
            addBox(roughX1 - roughX0, rough, zPass - zDone, (roughX0 + roughX1) / 2, rough / 2, (zDone + zPass) / 2, roughMat);
          }
          if (width / 2 > zPass) addBox(length, rough, width / 2 - zPass, 0, rough / 2, (zPass + width / 2) / 2, roughMat);
          faceMill.position.set(pose.x, body, pose.z);
          return;
        }

        const donePockets = layoutPockets(previous.filter((cut) => cut.kind === "pocket" || cut.kind === "slot"), length, width, body);
        const liveFrames = mode === "pocket" ? layoutPockets(added.filter((cut) => cut.kind === "pocket" || cut.kind === "slot"), length, width, body) : [];
        const live = liveFrames[0];
        const pose = live ? pocketPose(progress, live, 3.2) : null;
        const openings: PocketFrame[] = [...donePockets];
        if (live && pose && (pose.plunge > 0.02 || pose.cleared > 0)) {
          const span = live.z1 - live.z0;
          openings.push(pose.plunge < 1
            ? { x0: pose.x - 3.2, x1: pose.x + 3.2, z0: pose.z - 3.2, z1: pose.z + 3.2, depth: live.depth * pose.plunge }
            : { x0: live.x0, x1: live.x1, z0: live.z0, z1: live.z0 + Math.max(span * pose.cleared, 6.4), depth: live.depth });
        }

        const doneHoles = previous.filter((cut) => cut.kind === "hole").flatMap((cut) => layoutHoles(cut, length, width, body));
        const liveHoles = mode === "drill"
          ? added.filter((cut) => cut.kind === "hole").flatMap((cut) => layoutHoles(cut, length, width, body))
          : [];
        const drilling = mode === "drill"
          ? drillPose(progress, liveHoles, body)
          : mode === "tap"
            ? drillPose(progress, doneHoles, body)
            : null;
        const holes: HoleSpot[] = [...doneHoles];
        if (mode === "drill" && drilling) {
          liveHoles.forEach((hole, index) => {
            if (index < drilling.index || (index === drilling.index && drilling.plunge > 0.02)) holes.push(hole);
          });
        }

        const holeDepth = holes.reduce((max, hole) => Math.max(max, hole.depth), 0);
        const pocketDepth = openings.reduce((max, opening) => Math.max(max, opening.depth), 0);
        const deepest = Math.max(holeDepth, pocketDepth);
        if (deepest <= 0.2) {
          addBox(x1 - x0, body, z1 - z0, (x0 + x1) / 2, body / 2, (z0 + z1) / 2, finishMat);
        } else {
          const baseTop = body - deepest;
          addBox(x1 - x0, baseTop, z1 - z0, (x0 + x1) / 2, baseTop / 2, (z0 + z1) / 2, finishMat);
          const breaks = [...new Set([baseTop, body - pocketDepth, body].filter((value) => value >= baseTop - 0.01 && value <= body + 0.01))].sort((a, b) => a - b);
          for (let index = 0; index < breaks.length - 1; index += 1) {
            const low = breaks[index];
            const high = breaks[index + 1];
            const circles = holes.filter((hole) => body - hole.depth <= low + 0.05).map((hole) => ({ x: hole.x, z: hole.z, radius: hole.radius }));
            const rects = openings.filter((opening) => body - opening.depth <= low + 0.05);
            addSlab(low, high - low, x0, x1, z0, z1, circles, rects, low >= body - pocketDepth - 0.05 ? floorMat : finishMat);
          }
        }

        if (mode === "drill" && drilling && drilling.plunge > 0.02 && drilling.plunge < 1) {
          const active = liveHoles[drilling.index];
          if (active) {
            const plugHeight = active.depth * (1 - drilling.plunge);
            const plug = new THREE.Mesh(
              new THREE.CylinderGeometry(active.radius * 0.92, active.radius * 0.92, Math.max(plugHeight, 0.2), 18),
              roughMat,
            );
            plug.position.set(active.x, body - active.depth + plugHeight / 2, active.z);
            part.add(plug);
          }
        }

        if (mode === "pocket" && live && pose) {
          const tip = body - live.depth * pose.plunge;
          ball.position.set(pose.x, tip + 3.2, pose.z);
        } else if (mode === "profile") {
          const perim = 2 * ((x1 - x0) + (z1 - z0));
          let dist = progress * perim;
          let x = x0;
          let z = z0;
          const sides = [x1 - x0, z1 - z0, x1 - x0, z1 - z0];
          const dirs = [[1, 0], [0, 1], [-1, 0], [0, -1]];
          for (let index = 0; index < 4; index += 1) {
            const step = Math.min(dist, sides[index]);
            x += dirs[index][0] * step;
            z += dirs[index][1] * step;
            dist -= step;
            if (dist <= 0) break;
          }
          ball.position.set(x, body + 3.2, z);
        } else if ((mode === "drill" || mode === "tap") && drilling) {
          const drop = mode === "tap" ? drilling.tipDrop * 0.45 : drilling.tipDrop;
          drill.position.set(drilling.x, body - drop, drilling.z);
          const active = mode === "drill" ? liveHoles[drilling.index] : doneHoles[drilling.index];
          drill.scale.set(active ? Math.max(active.radius / 2.2, 0.7) : 1, 1, active ? Math.max(active.radius / 2.2, 0.7) : 1);
        } else if (mode === "deburr") {
          const path = deburrPath(x1 - x0, z1 - z0, body, donePockets, doneHoles);
          const shifted = path.map((point) => ({ x: point.x + (x0 + x1) / 2, y: body, z: point.z + (z0 + z1) / 2 }));
          const positions = new Float32Array(shifted.length * 3);
          shifted.forEach((point, index) => {
            positions[index * 3] = point.x;
            positions[index * 3 + 1] = point.y + 0.4;
            positions[index * 3 + 2] = point.z;
          });
          edgeGeo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
          const count = Math.max(1, Math.floor(progress * shifted.length));
          doneLine.geometry.setDrawRange(0, count);
          edgeLine.geometry.setDrawRange(count, Math.max(shifted.length - count, 0));
          const tip = pointAlong(shifted, progress);
          ball.position.set(tip.x, tip.y + 3.2, tip.z);
        } else {
          ball.position.set(0, body + 8, 0);
        }
      };

      if (isPlaying) progressRef.current = 0;
      apply(isPlaying ? 0 : progressRef.current);
      const started = performance.now();
      const tick = (now: number) => {
        if (cancelled || !renderer) return;
        if (isPlaying) {
          const next = Math.min(1, (now - started) / 7000);
          progressRef.current = next;
          apply(next);
          if (next >= 1) onPlayEndRef.current?.();
        }
        controls.update();
        renderer.render(scene, camera);
        if (!isPlaying || progressRef.current < 1) frame = requestAnimationFrame(tick);
      };
      frame = requestAnimationFrame(tick);
    })();

    return () => {
      cancelled = true;
      cancelAnimationFrame(frame);
      renderer?.dispose();
      container.replaceChildren();
    };
  }, [stock, stage, previous, isPlaying]);

  return (
    <div className="absolute inset-0">
      <div ref={mountRef} className="absolute inset-0" />
      <div className="absolute bottom-3 left-3 z-10 max-w-md rounded bg-slate-900/90 px-3 py-2 text-[11px] text-slate-200">
        <div className="font-semibold text-cyan-300">OP{stage.opNumber} {stage.name}</div>
        <div>{stage.holding}</div>
        <div>{stage.fixture} · {stage.tool}</div>
        <div className="text-slate-400">{stage.toolPoint}</div>
      </div>
    </div>
  );
}
