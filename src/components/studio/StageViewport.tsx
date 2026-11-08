"use client";

import { useEffect, useRef } from "react";
import type { MachiningStage, TurningJob } from "@/lib/studio/stages";

interface Props {
  job: TurningJob;
  stage: MachiningStage;
  isPlaying: boolean;
  onPlayEnd?: () => void;
}

export default function StageViewport({ job, stage, isPlaying, onPlayEnd }: Props) {
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

      const length = job.stockLength;
      const grip = stage.grip;
      const cut = Math.max(length - grip, 1);
      const half = length / 2;
      const alongX = new THREE.Matrix4().makeRotationZ(Math.PI / 2);

      const scene = new THREE.Scene();
      scene.background = new THREE.Color(0x0f172a);
      const width = container.clientWidth || 800;
      const height = container.clientHeight || 600;
      renderer = new THREE.WebGLRenderer({ antialias: true });
      renderer.setPixelRatio(window.devicePixelRatio);
      renderer.setSize(width, height, false);
      renderer.domElement.style.width = "100%";
      renderer.domElement.style.height = "100%";
      renderer.domElement.style.display = "block";
      if (cancelled) return;
      container.replaceChildren(renderer.domElement);

      const camera = new THREE.PerspectiveCamera(45, width / Math.max(height, 1), 0.1, 2000);
      camera.position.set(length * 0.15, length * 0.55, length * 1.15);
      const controls = new OrbitControls(camera, renderer.domElement);
      controls.target.set(0, 0, 0);
      controls.update();

      scene.add(new THREE.AmbientLight(0xffffff, 0.75));
      const light = new THREE.DirectionalLight(0xffffff, 0.85);
      light.position.set(30, 80, 40);
      scene.add(light);
      scene.add(new THREE.GridHelper(220, 22, 0x334155, 0x1e293b));

      const metal = (color: number) => new THREE.MeshStandardMaterial({
        color, metalness: 0.35, roughness: 0.4, side: THREE.DoubleSide,
      });

      const chuck = new THREE.Mesh(
        new THREE.CylinderGeometry(job.stockWidth * 0.72, job.stockWidth * 0.72, 18, 28),
        metal(0x475569)
      );
      chuck.applyMatrix4(alongX);
      chuck.position.x = -half - 10;
      scene.add(chuck);

      const bar = new THREE.Mesh(
        new THREE.BoxGeometry(length, job.stockHeight, job.stockWidth),
        metal(0x94a3b8)
      );
      scene.add(bar);

      const round = new THREE.Mesh(
        new THREE.CylinderGeometry(job.diameter / 2, job.diameter / 2, cut, 48),
        metal(0xcbd5e1)
      );
      round.applyMatrix4(alongX);
      scene.add(round);

      const tube = new THREE.Mesh(
        new THREE.LatheGeometry([
          new THREE.Vector2(job.bore / 2, 0),
          new THREE.Vector2(job.diameter / 2, 0),
          new THREE.Vector2(job.diameter / 2, 1),
          new THREE.Vector2(job.bore / 2, 1),
        ], 48),
        metal(0xe2e8f0)
      );
      tube.applyMatrix4(alongX);
      scene.add(tube);

      const tool = new THREE.Mesh(
        new THREE.SphereGeometry(1.6, 16, 12),
        new THREE.MeshStandardMaterial({ color: 0xfbbf24, emissive: 0xf59e0b, emissiveIntensity: 0.7 })
      );
      scene.add(tool);

      const apply = (progress: number) => {
        const turned = stage.before === "cylinder" ? cut : cut * progress;
        const bored = stage.after === "tube" ? cut * progress : 0;
        const remain = length - turned;
        const solid = Math.max(cut - bored, 0);

        const showBar = remain > 0.2;
        bar.visible = showBar;
        bar.scale.x = showBar ? remain / length : 0.001;
        bar.position.x = -half + remain / 2;

        const showRound = solid > 0.2;
        round.visible = showRound;
        round.scale.y = showRound ? solid / cut : 0.001;
        round.position.x = (grip - bored) / 2;

        const showTube = bored > 0.2;
        tube.visible = showTube;
        tube.scale.y = showTube ? bored : 0.001;
        tube.position.x = half;

        const front = stage.after === "tube" ? half - bored : half - turned;
        tool.position.set(front, job.diameter / 2 + 2.5, 0);
      };

      if (isPlaying) progressRef.current = 0;
      apply(progressRef.current);

      const started = performance.now();
      const tick = (now: number) => {
        if (cancelled || !renderer) return;
        if (isPlaying) {
          const next = Math.min(1, (now - started) / 6000);
          progressRef.current = next;
          apply(next);
          if (next >= 1) onPlayEndRef.current?.();
        }
        controls.update();
        renderer.render(scene, camera);
        if (!isPlaying || progressRef.current < 1) frame = requestAnimationFrame(tick);
      };
      frame = requestAnimationFrame(tick);

      const resize = () => {
        if (!renderer || container.clientWidth < 2 || container.clientHeight < 2) return;
        camera.aspect = container.clientWidth / container.clientHeight;
        camera.updateProjectionMatrix();
        renderer.setSize(container.clientWidth, container.clientHeight, false);
      };
      const observer = new ResizeObserver(resize);
      observer.observe(container);
      if (cancelled) observer.disconnect();
    })();

    return () => {
      cancelled = true;
      cancelAnimationFrame(frame);
      renderer?.dispose();
      container.replaceChildren();
    };
  }, [job, stage, isPlaying]);

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
