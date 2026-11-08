"use client";

// Three.js 3D toolpath canvas
// Renders: stock bounding box, colored toolpath lines (rapid=green, feed=cyan, arc=red),
// animated cutter cylinder, axes helpers, orbit controls.

import { useEffect, useRef, useCallback, useState } from "react";
import type { ParseResult } from "@/lib/gcode/parser";

// Color map per move type
const MOVE_COLORS: Record<string, number> = {
  rapid:   0x00ff88,   // bright green
  feed:    0x00e5ff,   // cyan
  arc_cw:  0xff4444,   // red
  arc_ccw: 0xff8800,   // orange
};

interface Props {
  parseResult: ParseResult | null;
  highlightLine?: number;   // G-code line to highlight (from editor click)
  isPlaying?: boolean;      // animate cutter along path
  onSegmentClick?: (lineIndex: number) => void;
  onPlayhead?: (lineIndex: number) => void;
  onPlayEnd?: () => void;
}

export default function Canvas3D({ parseResult, highlightLine, isPlaying, onSegmentClick, onPlayhead, onPlayEnd }: Props) {
  const mountRef   = useRef<HTMLDivElement>(null);
  const sceneRef   = useRef<unknown>(null);   // THREE.Scene
  const rendererRef = useRef<unknown>(null);  // THREE.WebGLRenderer
  const cameraRef  = useRef<unknown>(null);   // THREE.PerspectiveCamera
  const controlsRef = useRef<unknown>(null);
  const rafRef     = useRef<number>(0);
  const cutterRef  = useRef<unknown>(null);   // THREE.Mesh cutter
  const playProgressRef = useRef<number>(0);
  const onPlayheadRef = useRef(onPlayhead);
  const onPlayEndRef = useRef(onPlayEnd);
  onPlayheadRef.current = onPlayhead;
  onPlayEndRef.current = onPlayEnd;
  const [sceneReady, setSceneReady] = useState(0);

  // ── Init scene ──────────────────────────────────────────────────────────────
  useEffect(() => {
    const container = mountRef.current;
    if (!container) return;
    let cancelled = false;
    let renderer: import("three").WebGLRenderer | null = null;
    let observer: ResizeObserver | null = null;

    (async () => {
      try {
      const THREE = await import("three");
      const { OrbitControls } = await import("three/examples/jsm/controls/OrbitControls.js");
      if (cancelled) return;

      const scene = new THREE.Scene();
      scene.background = new THREE.Color(0x0f172a);
      sceneRef.current = scene;

      const width = container.clientWidth || container.parentElement?.clientWidth || 800;
      const height = container.clientHeight || container.parentElement?.clientHeight || 600;
      renderer = new THREE.WebGLRenderer({ antialias: true });
      renderer.setPixelRatio(window.devicePixelRatio);
      renderer.setSize(width, Math.max(height, 1), false);
      renderer.domElement.style.width = "100%";
      renderer.domElement.style.height = "100%";
      renderer.domElement.style.display = "block";
      container.replaceChildren(renderer.domElement);
      rendererRef.current = renderer;

      const camera = new THREE.PerspectiveCamera(50, width / Math.max(height, 1), 0.1, 100000);
      camera.position.set(150, 150, 200);
      cameraRef.current = camera;

      const controls = new OrbitControls(camera, renderer.domElement);
      controls.enableDamping = true;
      controls.dampingFactor = 0.05;
      controlsRef.current = controls;

      scene.add(new THREE.GridHelper(300, 30, 0x334155, 0x1e293b));
      scene.add(new THREE.AxesHelper(30));
      scene.add(new THREE.AmbientLight(0xffffff, 0.6));
      const dir = new THREE.DirectionalLight(0xffffff, 0.9);
      dir.position.set(100, 200, 100);
      scene.add(dir);

      const cutter = new THREE.Mesh(
        new THREE.SphereGeometry(4, 20, 16),
        new THREE.MeshStandardMaterial({ color: 0xfbbf24, emissive: 0xf59e0b, emissiveIntensity: 1 })
      );
      cutter.position.set(0, 10, 0);
      cutter.name = "cutter";
      scene.add(cutter);
      cutterRef.current = cutter;

      observer = new ResizeObserver(() => {
        const w = container.clientWidth;
        const h = container.clientHeight;
        if (w < 2 || h < 2) return;
        camera.aspect = w / h;
        camera.updateProjectionMatrix();
        renderer?.setSize(w, h, false);
      });
      observer.observe(container);

      const animate = () => {
        if (cancelled) return;
        rafRef.current = requestAnimationFrame(animate);
        controls.update();
        renderer?.render(scene, camera);
      };
      animate();
      if (!cancelled) setSceneReady((n) => n + 1);
      } catch (err) {
        console.error("[Canvas3D] Init error:", err);
      }
    })();

    return () => {
      cancelled = true;
      cancelAnimationFrame(rafRef.current);
      observer?.disconnect();
      renderer?.dispose();
      rendererRef.current = null;
      sceneRef.current = null;
      cutterRef.current = null;
      container.replaceChildren();
    };
  }, []);

  // ── Rebuild toolpath geometry when parseResult changes ────────────────────
  useEffect(() => {
    if (!sceneReady || !sceneRef.current || !parseResult) return;

    (async () => {
      const THREE = await import("three");
      const scene = sceneRef.current as import("three").Scene;

      // Remove old toolpath group
      const old = scene.getObjectByName("toolpath");
      if (old) scene.remove(old);
      const oldTrace = scene.getObjectByName("playtrace");
      if (oldTrace) scene.remove(oldTrace);
      const oldStock = scene.getObjectByName("stock");
      if (oldStock) scene.remove(oldStock);

      const group = new THREE.Group();
      group.name = "toolpath";

      const finite = (n: number) => Number.isFinite(n);
      for (const seg of parseResult.segments) {
        const from = new THREE.Vector3(seg.from[0], seg.from[2], -seg.from[1]);
        const to = new THREE.Vector3(seg.to[0], seg.to[2], -seg.to[1]);
        if (![from.x, from.y, from.z, to.x, to.y, to.z].every(finite)) continue;
        const color = MOVE_COLORS[seg.type] ?? 0xffffff;
        const mat = new THREE.LineBasicMaterial({ color });
        const geo = new THREE.BufferGeometry().setFromPoints([from, to]);
        const line = new THREE.Line(geo, mat);
        line.userData.lineIndex = seg.lineIndex;
        line.userData.order = group.children.length;
        line.userData.baseColor = color;
        group.add(line);
      }

      scene.add(group);

      const box = new THREE.Box3().setFromObject(group);
      if (!box.isEmpty()) {
        const center = box.getCenter(new THREE.Vector3());
        const sizeVec = box.getSize(new THREE.Vector3());
        const size = Math.max(sizeVec.x, sizeVec.y, sizeVec.z, 20);
        const stock = new THREE.Mesh(
          new THREE.BoxGeometry(Math.max(sizeVec.x, 1), Math.max(sizeVec.y, 1), Math.max(sizeVec.z, 1)),
          new THREE.MeshBasicMaterial({ color: 0x64748b, wireframe: true })
        );
        stock.name = "stock";
        stock.position.copy(center);
        scene.add(stock);

        const cam = cameraRef.current as import("three").PerspectiveCamera | null;
        const controls = controlsRef.current as { target: import("three").Vector3; update: () => void } | null;
        if (cam) {
          const dist = size * 1.8;
          cam.near = Math.max(size / 1000, 0.01);
          cam.far = dist * 50;
          cam.position.set(center.x + dist, center.y + dist * 0.75, center.z + dist);
          cam.lookAt(center);
          cam.updateProjectionMatrix();
          if (controls) {
            controls.target.copy(center);
            controls.update();
          }
        }
        const cutter = cutterRef.current as import("three").Mesh | null;
        if (cutter) cutter.scale.setScalar(Math.max(size * 0.004, 0.15));
      }
    })();
  }, [parseResult, sceneReady]);

  // ── Highlight line ────────────────────────────────────────────────────────
  useEffect(() => {
    if (isPlaying || !sceneRef.current || !parseResult || highlightLine === undefined) return;

    (async () => {
      const THREE = await import("three");
      const scene = sceneRef.current as import("three").Scene;

      // Reset all line colors
      const group = scene.getObjectByName("toolpath") as import("three").Group | undefined;
      if (!group) return;

      group.traverse((obj) => {
        if (obj instanceof THREE.Line) {
          const mat = obj.material as import("three").LineBasicMaterial;
          mat.color.setHex((obj.userData.baseColor as number) ?? 0x00e5ff);
        }
      });

      // Find segments for this line and highlight them yellow
      group.traverse((obj) => {
        if (obj instanceof THREE.Line && obj.userData.lineIndex === highlightLine) {
          const mat = obj.material as import("three").LineBasicMaterial;
          mat.color.setHex(0xfbbf24);   // amber highlight
        }
      });

      // Move cutter to that position
      const segIdx = parseResult.lineToSegment.get(highlightLine);
      if (segIdx !== undefined && cutterRef.current) {
        const seg = parseResult.segments[segIdx];
        const cutter = cutterRef.current as import("three").Mesh;
        cutter.position.set(seg.to[0], seg.to[2] + 10, -seg.to[1]);
      }
    })();
  }, [highlightLine, parseResult, isPlaying]);

  // ── Animation playback ────────────────────────────────────────────────────
  useEffect(() => {
    if (!sceneReady || !isPlaying || !parseResult?.segments.length || !sceneRef.current) return;

    let cancelled = false;
    let frame = 0;

    (async () => {
      const THREE = await import("three");
      if (cancelled || !sceneRef.current) return;
      const scene = sceneRef.current as import("three").Scene;
      const segs = parseResult.segments;
      const world: import("three").Vector3[] = [
        new THREE.Vector3(segs[0].from[0], segs[0].from[2], -segs[0].from[1]),
      ];
      const cum = [0];
      let length = 0;
      for (const seg of segs) {
        const dx = seg.to[0] - seg.from[0];
        const dy = seg.to[1] - seg.from[1];
        const dz = seg.to[2] - seg.from[2];
        const stepLength = Math.hypot(dx, dy, dz);
        if (Number.isFinite(stepLength)) length += stepLength;
        cum.push(length);
        world.push(new THREE.Vector3(seg.to[0], seg.to[2], -seg.to[1]));
      }

      const old = scene.getObjectByName("playtrace");
      if (old) scene.remove(old);
      const geometry = new THREE.BufferGeometry().setFromPoints(world);
      const trace = new THREE.Line(
        geometry,
        new THREE.LineBasicMaterial({ color: 0xffe14a })
      );
      trace.name = "playtrace";
      trace.frustumCulled = false;
      geometry.setDrawRange(0, 2);
      scene.add(trace);

      const span = new THREE.Box3().setFromPoints(world);
      const size = Math.max(span.getSize(new THREE.Vector3()).length(), 20);
      const cutter = cutterRef.current as import("three").Mesh | null;
      if (cutter) {
        cutter.visible = true;
        cutter.scale.setScalar(Math.max(size * 0.004, 0.15));
        cutter.position.copy(world[0]);
      }

      const duration = 7000;
      const started = performance.now();
      let lastLine = -1;

      const step = (now: number) => {
        if (cancelled) return;
        const travelled = Math.min(1, (now - started) / duration) * Math.max(length, 0.001);
        let point = world.length - 1;
        for (let i = 1; i < cum.length; i += 1) {
          if (cum[i] >= travelled) {
            point = i;
            const segLen = Math.max(cum[i] - cum[i - 1], 0.001);
            const u = Math.min(1, (travelled - cum[i - 1]) / segLen);
            const pos = world[i - 1].clone().lerp(world[i], u);
            if (cutterRef.current) (cutterRef.current as import("three").Mesh).position.copy(pos);
            break;
          }
        }
        geometry.setDrawRange(0, Math.max(2, point + 1));
        const seg = segs[Math.min(point - 1, segs.length - 1)] ?? segs[0];
        if (seg && seg.lineIndex !== lastLine) {
          lastLine = seg.lineIndex;
          onPlayheadRef.current?.(seg.lineIndex);
        }
        if ((now - started) >= duration) {
          geometry.setDrawRange(0, world.length);
          onPlayEndRef.current?.();
          return;
        }
        frame = requestAnimationFrame(step);
      };
      frame = requestAnimationFrame(step);
    })();

    return () => {
      cancelled = true;
      cancelAnimationFrame(frame);
      const scene = sceneRef.current as import("three").Scene | null;
      const old = scene?.getObjectByName("playtrace");
      if (old && scene) scene.remove(old);
    };
  }, [isPlaying, parseResult, sceneReady]);

  // ── Click-to-select ───────────────────────────────────────────────────────
  const handleClick = useCallback(async (e: React.MouseEvent<HTMLDivElement>) => {
    if (!sceneRef.current || !rendererRef.current || !cameraRef.current || !parseResult) return;
    if (!mountRef.current) return;

    // Use mountRef directly — e.currentTarget is unreliable in async handlers in React 19
    const rect    = mountRef.current.getBoundingClientRect();
    const clientX = e.clientX;
    const clientY = e.clientY;

    const THREE = await import("three");
    const ndc  = new THREE.Vector2(
      ((clientX - rect.left) / rect.width)  * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1,
    );

    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(ndc, cameraRef.current as import("three").PerspectiveCamera);

    const scene   = sceneRef.current as import("three").Scene;
    const group   = scene.getObjectByName("toolpath") as import("three").Group | undefined;
    if (!group) return;

    const hits = raycaster.intersectObjects(group.children, false);
    if (hits.length > 0) {
      const lineIdx = hits[0].object.userData.lineIndex as number | undefined;
      if (lineIdx !== undefined) onSegmentClick?.(lineIdx);
    }
  }, [parseResult, onSegmentClick]);

  return (
    <div
      ref={mountRef}
      className="absolute inset-0"
      onClick={handleClick}
      style={{ cursor: "crosshair" }}
    />
  );
}
