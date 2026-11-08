import type * as ThreeNS from "three";
import { latheGrid, type LatheEngine } from "@/lib/sim/latheEngine";
import { type MillEngine } from "@/lib/sim/millEngine";
import type { VoxelEngine } from "@/lib/sim/voxelEngine";
import { createEngine, type SimJob } from "@/lib/sim/prepare";
import type { Collision, ToolSpec, Vec3 } from "@/lib/sim/types";

type Three = typeof ThreeNS;

export interface SimControls {
  playing: boolean;
  speed: number;
  section: boolean;
  path: boolean;
}

export interface SimCallbacks {
  onProgress?: (fraction: number) => void;
  onLine?: (line: number) => void;
  onCollision?: (collision: Collision) => void;
  onEnd?: () => void;
}

export interface SimHandle {
  seek: (fraction: number) => void;
  step: () => void;
  snapshot: () => string;
  dispose: () => void;
  restart: () => void;
  finished: () => boolean;
}

const ROUGH = 0x64748b;
const CUT = 0xe5ecf4;

function colorAt(three: Three, cutFraction: number, out: Float32Array, offset: number): void {
  const rough = new three.Color(ROUGH);
  const cut = new three.Color(CUT);
  out[offset] = rough.r + (cut.r - rough.r) * cutFraction;
  out[offset + 1] = rough.g + (cut.g - rough.g) * cutFraction;
  out[offset + 2] = rough.b + (cut.b - rough.b) * cutFraction;
}

interface Surface {
  update: () => void;
  object: ThreeNS.Object3D;
  dispose: () => void;
  center: Vec3;
  span: number;
}

/** World mapping for milling: program X to world X, program Z to world Y (up), program Y to world -Z. */
function millWorld(point: Vec3): [number, number, number] {
  return [point[0], point[2], -point[1]];
}

function buildMillSurface(three: Three, engine: MillEngine): Surface {
  const { grid, state } = engine;
  const { nx, ny, cell, x0, y0, bottom } = grid;
  const vw = nx + 1;
  const vh = ny + 1;
  const xAt = (i: number) => x0 + i * cell;
  const yAt = (j: number) => y0 + j * cell;
  const heights = new Float32Array(vw * vh);
  const positions = new Float32Array(vw * vh * 3);
  const normals = new Float32Array(vw * vh * 3);
  const colors = new Float32Array(vw * vh * 3);

  const vertexHeight = (i: number, j: number) => {
    let sum = 0;
    let count = 0;
    let cut = 0;
    for (let dj = -1; dj <= 0; dj += 1) {
      for (let di = -1; di <= 0; di += 1) {
        const cx = i + di;
        const cy = j + dj;
        if (cx < 0 || cy < 0 || cx >= nx || cy >= ny) continue;
        sum += state.heights[cy * nx + cx];
        cut += state.cut[cy * nx + cx];
        count += 1;
      }
    }
    return { h: count ? sum / count : bottom, cut: count ? cut / count : 0 };
  };

  const applyVertex = (i: number, j: number) => {
    const index = j * vw + i;
    const { h, cut } = vertexHeight(i, j);
    heights[index] = h;
    positions[index * 3] = xAt(i);
    positions[index * 3 + 1] = h;
    positions[index * 3 + 2] = -yAt(j);
    colorAt(three, cut, colors, index * 3);
  };

  const applyNormal = (i: number, j: number) => {
    const at = (a: number, b: number) => heights[Math.min(vh - 1, Math.max(0, b)) * vw + Math.min(vw - 1, Math.max(0, a))];
    const hx = (at(i + 1, j) - at(i - 1, j)) / (2 * cell);
    const hy = (at(i, j + 1) - at(i, j - 1)) / (2 * cell);
    const nxv = -hx;
    const nzv = hy;
    const norm = Math.hypot(nxv, 1, nzv);
    const index = (j * vw + i) * 3;
    normals[index] = nxv / norm;
    normals[index + 1] = 1 / norm;
    normals[index + 2] = nzv / norm;
  };

  for (let j = 0; j < vh; j += 1) for (let i = 0; i < vw; i += 1) applyVertex(i, j);
  for (let j = 0; j < vh; j += 1) for (let i = 0; i < vw; i += 1) applyNormal(i, j);

  const indices: number[] = [];
  for (let j = 0; j < ny; j += 1) {
    for (let i = 0; i < nx; i += 1) {
      const a = j * vw + i;
      const b = (j + 1) * vw + i;
      const c = j * vw + i + 1;
      const d = (j + 1) * vw + i + 1;
      indices.push(a, c, b, c, d, b);
    }
  }
  const topGeometry = new three.BufferGeometry();
  const positionAttr = new three.BufferAttribute(positions, 3);
  const normalAttr = new three.BufferAttribute(normals, 3);
  const colorAttr = new three.BufferAttribute(colors, 3);
  topGeometry.setAttribute("position", positionAttr);
  topGeometry.setAttribute("normal", normalAttr);
  topGeometry.setAttribute("color", colorAttr);
  topGeometry.setIndex(indices);
  const material = new three.MeshStandardMaterial({ vertexColors: true, metalness: 0.35, roughness: 0.5, side: three.DoubleSide });
  const top = new three.Mesh(topGeometry, material);

  // Side walls follow the top edge down to the stock bottom.
  const edges: { count: number; at: (k: number) => number; normal: [number, number, number]; flip: boolean }[] = [
    { count: vh, at: (k) => k * vw, normal: [-1, 0, 0], flip: true },
    { count: vh, at: (k) => k * vw + nx, normal: [1, 0, 0], flip: false },
    { count: vw, at: (k) => k, normal: [0, 0, 1], flip: false },
    { count: vw, at: (k) => ny * vw + k, normal: [0, 0, -1], flip: true },
  ];
  const wallMaterial = new three.MeshStandardMaterial({ color: ROUGH, metalness: 0.3, roughness: 0.6, side: three.DoubleSide });
  const wallGeometries: ThreeNS.BufferGeometry[] = [];
  const wallMeshes = edges.map((edge) => {
    const wallPositions = new Float32Array(edge.count * 2 * 3);
    const wallNormals = new Float32Array(edge.count * 2 * 3);
    for (let k = 0; k < edge.count * 2; k += 1) wallNormals.set(edge.normal, k * 3);
    const wallIndices: number[] = [];
    for (let k = 0; k < edge.count - 1; k += 1) {
      const t0 = k * 2;
      const b0 = k * 2 + 1;
      const t1 = (k + 1) * 2;
      const b1 = (k + 1) * 2 + 1;
      if (edge.flip) wallIndices.push(t0, t1, b0, t1, b1, b0);
      else wallIndices.push(t0, b0, t1, t1, b0, b1);
    }
    const geometry = new three.BufferGeometry();
    geometry.setAttribute("position", new three.BufferAttribute(wallPositions, 3));
    geometry.setAttribute("normal", new three.BufferAttribute(wallNormals, 3));
    geometry.setIndex(wallIndices);
    wallGeometries.push(geometry);
    return { mesh: new three.Mesh(geometry, wallMaterial), edge, wallPositions };
  });

  const refreshWalls = () => {
    for (const { mesh, edge, wallPositions } of wallMeshes) {
      for (let k = 0; k < edge.count; k += 1) {
        const index = edge.at(k);
        const x = positions[index * 3];
        const z = positions[index * 3 + 2];
        wallPositions.set([x, heights[index], z, x, bottom, z], k * 6);
      }
      mesh.geometry.getAttribute("position").needsUpdate = true;
    }
  };
  refreshWalls();

  const floorGeometry = new three.PlaneGeometry(nx * cell, ny * cell);
  floorGeometry.rotateX(Math.PI / 2);
  floorGeometry.translate(x0 + (nx * cell) / 2, bottom, -(y0 + (ny * cell) / 2));
  const floor = new three.Mesh(floorGeometry, wallMaterial);

  const group = new three.Group();
  group.add(top, floor, ...wallMeshes.map((entry) => entry.mesh));

  const update = () => {
    const dirty = engine.takeDirty();
    if (dirty.length === 0) return;
    const vertices = new Set<number>();
    for (const cellIndex of dirty) {
      const ix = cellIndex % nx;
      const iy = Math.floor(cellIndex / nx);
      for (let dj = 0; dj <= 1; dj += 1) for (let di = 0; di <= 1; di += 1) vertices.add((iy + dj) * vw + ix + di);
    }
    for (const index of vertices) applyVertex(index % vw, Math.floor(index / vw));
    const shaded = new Set<number>();
    for (const index of vertices) {
      const i = index % vw;
      const j = Math.floor(index / vw);
      for (let dj = -1; dj <= 1; dj += 1) {
        for (let di = -1; di <= 1; di += 1) {
          if (i + di < 0 || j + dj < 0 || i + di >= vw || j + dj >= vh) continue;
          shaded.add((j + dj) * vw + i + di);
        }
      }
    }
    for (const index of shaded) applyNormal(index % vw, Math.floor(index / vw));
    positionAttr.needsUpdate = true;
    normalAttr.needsUpdate = true;
    colorAttr.needsUpdate = true;
    refreshWalls();
  };

  return {
    update,
    object: group,
    center: [x0 + (nx * cell) / 2, (grid.top + bottom) / 2, -(y0 + (ny * cell) / 2)],
    span: Math.max(nx * cell, ny * cell, grid.top - bottom),
    dispose: () => {
      topGeometry.dispose();
      floorGeometry.dispose();
      material.dispose();
      wallMaterial.dispose();
      wallGeometries.forEach((geometry) => geometry.dispose());
    },
  };
}

const FACES: { normal: [number, number, number]; corners: [number, number, number][] }[] = [
  { normal: [-1, 0, 0], corners: [[0, 0, 0], [0, 0, 1], [0, 1, 1], [0, 1, 0]] },
  { normal: [1, 0, 0], corners: [[1, 0, 0], [1, 1, 0], [1, 1, 1], [1, 0, 1]] },
  { normal: [0, -1, 0], corners: [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]] },
  { normal: [0, 1, 0], corners: [[0, 1, 0], [0, 1, 1], [1, 1, 1], [1, 1, 0]] },
  { normal: [0, 0, -1], corners: [[0, 0, 0], [0, 1, 0], [1, 1, 0], [1, 0, 0]] },
  { normal: [0, 0, 1], corners: [[0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]] },
];

/** Solid stock as a mesh of the box faces that are open to the air. It is rebuilt a few times a second while the tool cuts. */
function buildVoxelSurface(three: Three, engine: VoxelEngine): Surface {
  const { grid, state } = engine;
  const { nx, ny, nz, dx, dy, dz, x0, y0, z0 } = grid;
  const material = new three.MeshStandardMaterial({ vertexColors: true, metalness: 0.35, roughness: 0.5, side: three.DoubleSide });
  const mesh = new three.Mesh(new three.BufferGeometry(), material);
  const rough = new three.Color(ROUGH);
  const cut = new three.Color(CUT);
  const sizes = [dx, dy, dz];
  const open = (ix: number, iy: number, iz: number) =>
    ix < 0 || iy < 0 || iz < 0 || ix >= nx || iy >= ny || iz >= nz || state.occ[(iz * ny + iy) * nx + ix] === 0;

  const rebuild = () => {
    let faces = 0;
    for (let iz = 0; iz < nz; iz += 1) {
      for (let iy = 0; iy < ny; iy += 1) {
        for (let ix = 0; ix < nx; ix += 1) {
          if (state.occ[(iz * ny + iy) * nx + ix] === 0) continue;
          for (const face of FACES) if (open(ix + face.normal[0], iy + face.normal[1], iz + face.normal[2])) faces += 1;
        }
      }
    }
    const positions = new Float32Array(faces * 12);
    const normals = new Float32Array(faces * 12);
    const colors = new Float32Array(faces * 12);
    const indices = new Uint32Array(faces * 6);
    let face = 0;
    for (let iz = 0; iz < nz; iz += 1) {
      for (let iy = 0; iy < ny; iy += 1) {
        for (let ix = 0; ix < nx; ix += 1) {
          const value = state.occ[(iz * ny + iy) * nx + ix];
          if (value === 0) continue;
          const color = value === 2 ? cut : rough;
          for (const side of FACES) {
            if (!open(ix + side.normal[0], iy + side.normal[1], iz + side.normal[2])) continue;
            for (let corner = 0; corner < 4; corner += 1) {
              const [cx, cy, cz] = side.corners[corner];
              const px = x0 + (ix + cx) * sizes[0];
              const py = y0 + (iy + cy) * sizes[1];
              const pz = z0 + (iz + cz) * sizes[2];
              const at = (face * 4 + corner) * 3;
              // Program X, Z, -Y become world X, Y, Z.
              positions[at] = px;
              positions[at + 1] = pz;
              positions[at + 2] = -py;
              normals[at] = side.normal[0];
              normals[at + 1] = side.normal[2];
              normals[at + 2] = -side.normal[1];
              colors[at] = color.r;
              colors[at + 1] = color.g;
              colors[at + 2] = color.b;
            }
            const base = face * 4;
            indices.set([base, base + 1, base + 2, base, base + 2, base + 3], face * 6);
            face += 1;
          }
        }
      }
    }
    const geometry = new three.BufferGeometry();
    geometry.setAttribute("position", new three.BufferAttribute(positions, 3));
    geometry.setAttribute("normal", new three.BufferAttribute(normals, 3));
    geometry.setAttribute("color", new three.BufferAttribute(colors, 3));
    geometry.setIndex(new three.BufferAttribute(indices, 1));
    geometry.computeBoundingSphere();
    mesh.geometry.dispose();
    mesh.geometry = geometry;
  };
  rebuild();

  const group = new three.Group();
  group.add(mesh);
  let pending = false;
  let lastBuild = performance.now();
  return {
    object: group,
    update: () => {
      if (engine.takeDirty()) pending = true;
      const now = performance.now();
      if (pending && now - lastBuild > 90) {
        pending = false;
        lastBuild = now;
        rebuild();
      }
    },
    center: [x0 + (nx * dx) / 2, (z0 + grid.top) / 2, -(y0 + (ny * dy) / 2)],
    span: Math.max(nx * dx, ny * dy, nz * dz),
    dispose: () => {
      mesh.geometry.dispose();
      material.dispose();
    },
  };
}

function buildLatheSurface(three: Three, engine: LatheEngine): Surface {
  const setup = engine.setup;
  const { rows, sectors, dz } = latheGrid(setup);
  const stride = sectors + 1;
  const vertexCount = rows * stride;
  const outerPos = new Float32Array(vertexCount * 3);
  const innerPos = new Float32Array(vertexCount * 3);
  const outerCol = new Float32Array(vertexCount * 3);
  const innerCol = new Float32Array(vertexCount * 3);

  const build = (positions: Float32Array, colors: Float32Array, field: Float32Array) => {
    for (let i = 0; i < rows; i += 1) {
      for (let j = 0; j <= sectors; j += 1) {
        const cellJ = j % sectors;
        const radius = field[i * sectors + cellJ];
        const angle = ((cellJ + 0.5) / sectors) * Math.PI * 2;
        const index = i * stride + j;
        positions[index * 3] = -i * dz;
        positions[index * 3 + 1] = radius * Math.sin(angle);
        positions[index * 3 + 2] = radius * Math.cos(angle);
        colorAt(three, engine.state.cut[i * sectors + cellJ], colors, index * 3);
      }
    }
  };

  const outerIndices: number[] = [];
  for (let i = 0; i < rows - 1; i += 1) {
    for (let j = 0; j < sectors; j += 1) {
      const a = i * stride + j;
      const b = a + 1;
      const c = (i + 1) * stride + j;
      const d = c + 1;
      outerIndices.push(a, b, c, b, d, c);
    }
  }
  const innerIndices: number[] = [];
  for (let i = 0; i < outerIndices.length; i += 3) innerIndices.push(outerIndices[i], outerIndices[i + 2], outerIndices[i + 1]);

  const capIndices = (row: number, reverse: boolean) => {
    const list: number[] = [];
    for (let j = 0; j < sectors; j += 1) {
      const o0 = row * stride + j;
      const o1 = o0 + 1;
      if (reverse) list.push(o0, o1, o0 + vertexCount, o1, o1 + vertexCount, o0 + vertexCount);
      else list.push(o0, o0 + vertexCount, o1, o1, o0 + vertexCount, o1 + vertexCount);
    }
    return list;
  };

  const combinedPos = new Float32Array(vertexCount * 2 * 3);
  const combinedCol = new Float32Array(vertexCount * 2 * 3);
  const geometry = new three.BufferGeometry();
  const posAttr = new three.BufferAttribute(combinedPos, 3);
  const colAttr = new three.BufferAttribute(combinedCol, 3);
  geometry.setAttribute("position", posAttr);
  geometry.setAttribute("color", colAttr);

  const shellIndices: number[] = [];
  shellIndices.push(...outerIndices);
  for (let k = 0; k < innerIndices.length; k += 1) shellIndices.push(innerIndices[k] + vertexCount);
  shellIndices.push(...capIndices(0, false), ...capIndices(rows - 1, true));
  geometry.setIndex(shellIndices);

  const refresh = () => {
    build(outerPos, outerCol, engine.state.outer);
    build(innerPos, innerCol, engine.state.inner);
    combinedPos.set(outerPos, 0);
    combinedPos.set(innerPos, vertexCount * 3);
    combinedCol.set(outerCol, 0);
    combinedCol.set(innerCol, vertexCount * 3);
    posAttr.needsUpdate = true;
    colAttr.needsUpdate = true;
    geometry.computeVertexNormals();
    geometry.computeBoundingSphere();
  };
  refresh();

  const material = new three.MeshStandardMaterial({ vertexColors: true, metalness: 0.4, roughness: 0.45, side: three.DoubleSide });
  const mesh = new three.Mesh(geometry, material);
  const diameter = setup.shape.kind === "round" ? setup.shape.diameter : Math.hypot(setup.shape.width, setup.shape.height);

  const group = new three.Group();
  group.add(mesh);
  const chuckGeometry = new three.CylinderGeometry(setup.chuckRadius, setup.chuckRadius, 45, 48);
  chuckGeometry.rotateZ(Math.PI / 2);
  chuckGeometry.translate(setup.chuckZ - 22.5, 0, 0);
  const chuckMaterial = new three.MeshStandardMaterial({ color: 0x334155, metalness: 0.5, roughness: 0.55, transparent: true, opacity: 0.92 });
  group.add(new three.Mesh(chuckGeometry, chuckMaterial));

  return {
    object: group,
    update: () => {
      if (engine.takeDirtyRows()) refresh();
    },
    center: [-setup.length / 2, 0, 0],
    span: Math.max(setup.length, diameter),
    dispose: () => {
      geometry.dispose();
      material.dispose();
      chuckGeometry.dispose();
      chuckMaterial.dispose();
    },
  };
}

function buildSurface(three: Three, engine: object, lathe: boolean): Surface {
  if (lathe) return buildLatheSurface(three, engine as LatheEngine);
  if ((engine as { voxel?: boolean }).voxel) return buildVoxelSurface(three, engine as VoxelEngine);
  return buildMillSurface(three, engine as MillEngine);
}

function buildTool(three: Three, spec: ToolSpec, lathe: boolean): ThreeNS.Group {
  const group = new three.Group();
  const toolMaterial = new three.MeshStandardMaterial({ color: 0xfbbf24, emissive: 0xf59e0b, emissiveIntensity: 0.5, metalness: 0.4, roughness: 0.3 });
  const holderMaterial = new three.MeshStandardMaterial({ color: 0x475569, metalness: 0.5, roughness: 0.45 });
  group.userData.toolMaterial = toolMaterial;
  group.userData.holderMaterial = holderMaterial;
  const radius = Math.max(spec.diameter / 2, 0.4);

  if (lathe) {
    if (spec.kind === "drill") {
      const length = Math.max(spec.fluteLength, 20);
      const body = new three.Mesh(new three.CylinderGeometry(radius, radius, length, 24), toolMaterial);
      body.rotation.z = Math.PI / 2;
      body.position.set(length / 2, 0, 0);
      const chuckBlock = new three.Mesh(new three.CylinderGeometry(radius * 2.2, radius * 2.2, 30, 24), holderMaterial);
      chuckBlock.rotation.z = Math.PI / 2;
      chuckBlock.position.set(length + 15, 0, 0);
      group.add(body, chuckBlock);
    } else if (spec.kind === "bore") {
      const bar = new three.Mesh(new three.CylinderGeometry(3, 3, 70, 20), holderMaterial);
      bar.rotation.z = Math.PI / 2;
      bar.position.set(35, -3, 0);
      const insert = new three.Mesh(new three.BoxGeometry(3, 2, 5), toolMaterial);
      insert.position.set(1.5, -1, 0);
      group.add(bar, insert);
    } else {
      const holder = new three.Mesh(new three.BoxGeometry(14, 40, 14), holderMaterial);
      holder.position.set(6, 22, 0);
      const insert = new three.Mesh(new three.BoxGeometry(6, 2.4, 6), toolMaterial);
      insert.position.set(3, 1.2, 0);
      group.add(holder, insert);
    }
    return group;
  }

  if (spec.kind === "tslot" || spec.kind === "dovetail") {
    const neckRadius = Math.max((spec.neck ?? spec.diameter * 0.45) / 2, 0.4);
    const cutHeight = Math.max(spec.fluteLength, 1);
    const cutter = spec.kind === "tslot"
      ? new three.CylinderGeometry(radius, radius, cutHeight, 40)
      : new three.CylinderGeometry(neckRadius, radius, cutHeight, 40);
    const head = new three.Mesh(cutter, toolMaterial);
    head.position.y = cutHeight / 2;
    const neck = new three.Mesh(new three.CylinderGeometry(neckRadius, neckRadius, 40, 24), holderMaterial);
    neck.position.y = cutHeight + 20;
    const holder = new three.Mesh(new three.CylinderGeometry(14, 14, 30, 32), holderMaterial);
    holder.position.y = cutHeight + 55;
    group.add(head, neck, holder);
    return group;
  }

  const flute = Math.max(spec.fluteLength, 2);
  const bodyRadius = radius;
  if (spec.kind === "ball") {
    const ball = new three.Mesh(new three.SphereGeometry(bodyRadius, 24, 16), toolMaterial);
    ball.position.y = bodyRadius;
    const shank = new three.Mesh(new three.CylinderGeometry(bodyRadius, bodyRadius, Math.max(flute - bodyRadius, 0.5), 24), toolMaterial);
    shank.position.y = bodyRadius + Math.max(flute - bodyRadius, 0.5) / 2;
    group.add(ball, shank);
  } else if (spec.kind === "drill") {
    const tipHeight = bodyRadius * 0.6;
    const cone = new three.Mesh(new three.ConeGeometry(bodyRadius, tipHeight, 24), toolMaterial);
    cone.rotation.x = Math.PI;
    cone.position.y = tipHeight / 2;
    const shank = new three.Mesh(new three.CylinderGeometry(bodyRadius, bodyRadius, flute, 24), toolMaterial);
    shank.position.y = tipHeight + flute / 2;
    group.add(cone, shank);
  } else {
    const body = new three.Mesh(new three.CylinderGeometry(bodyRadius, bodyRadius, flute, 32), toolMaterial);
    body.position.y = flute / 2;
    group.add(body);
  }
  const holderRadius = Math.max(bodyRadius * (spec.kind === "face" ? 1.0 : 1.6), 3);
  const holder = new three.Mesh(new three.CylinderGeometry(holderRadius, holderRadius, 40, 32), holderMaterial);
  holder.position.y = flute + 20;
  group.add(holder);
  return group;
}

function pathLines(three: Three, job: SimJob): ThreeNS.LineSegments {
  const positions: number[] = [];
  const colors: number[] = [];
  const rapid = new three.Color(0x38bdf8);
  const feed = new three.Color(0xfbbf24);
  const lathe = job.setup.family === "lathe";
  for (const motion of job.program.motions) {
    const color = motion.kind === "rapid" ? rapid : feed;
    for (const point of [motion.from, motion.to]) {
      const world: Vec3 = lathe ? [point[2], point[0] / 2, 0] : millWorld(point);
      positions.push(world[0], world[1], world[2]);
      colors.push(color.r, color.g, color.b);
    }
  }
  const geometry = new three.BufferGeometry();
  geometry.setAttribute("position", new three.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("color", new three.Float32BufferAttribute(colors, 3));
  return new three.LineSegments(geometry, new three.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.8 }));
}

export async function createSimScene(
  container: HTMLElement,
  job: SimJob,
  controls: SimControls,
  callbacks: SimCallbacks
): Promise<SimHandle> {
  const three = await import("three");
  const { OrbitControls } = await import("three/examples/jsm/controls/OrbitControls.js");
  const lathe = job.setup.family === "lathe";

  const scene = new three.Scene();
  scene.background = new three.Color(0x0f172a);
  const renderer = new three.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(container.clientWidth || 800, container.clientHeight || 600, false);
  renderer.domElement.style.cssText = "width:100%;height:100%;display:block";
  renderer.localClippingEnabled = true;
  const host = document.createElement("div");
  host.style.cssText = "position:absolute;inset:0";
  host.appendChild(renderer.domElement);
  container.appendChild(host);
  const clip = new three.Plane(new three.Vector3(0, 0, -1), 0);

  let engine = createEngine(job);
  let surface: Surface = buildSurface(three, engine, lathe);
  scene.add(surface.object);

  const span = surface.span;
  const camera = new three.PerspectiveCamera(42, (container.clientWidth || 800) / Math.max(container.clientHeight || 600, 1), 0.1, 6000);
  const orbit = new OrbitControls(camera, renderer.domElement);
  const target = new three.Vector3(...surface.center);
  orbit.target.copy(target);
  const fit = Math.max(1, 1.45 / camera.aspect);
  camera.position.set(
    target.x + span * (lathe ? 0.15 : 0.7) * fit,
    target.y + span * (lathe ? 0.85 : 0.95) * fit,
    target.z + span * (lathe ? 1.4 : 1.0) * fit
  );
  orbit.update();

  scene.add(new three.AmbientLight(0xffffff, 0.75));
  const key = new three.DirectionalLight(0xffffff, 1.0);
  key.position.set(span, span * 1.6, span * 0.6);
  scene.add(key);
  const fill = new three.DirectionalLight(0x93c5fd, 0.35);
  fill.position.set(-span, span * 0.5, -span);
  scene.add(fill);
  const gridY = job.setup.family === "mill"
    ? job.setup.bottom - 3.5
    : -((job.setup.shape.kind === "round" ? job.setup.shape.diameter : Math.hypot(job.setup.shape.width, job.setup.shape.height)) / 2 + 20);
  const gridHelper = new three.GridHelper(Math.max(span * 4, 240), 24, 0x334155, 0x1e293b);
  gridHelper.position.set(target.x, gridY, target.z);
  scene.add(gridHelper);

  const path = pathLines(three, job);
  path.visible = false;
  scene.add(path);

  const toolRoot = new three.Group();
  scene.add(toolRoot);
  const worldUp = new three.Vector3(0, 1, 0);
  const toolAxis = new three.Vector3(0, 1, 0);
  const toolCache = new Map<number, ThreeNS.Group>();
  let activeTool = -1;
  const selectTool = (index: number) => {
    if (index === activeTool) return;
    toolRoot.clear();
    let tool = toolCache.get(index);
    if (!tool) {
      tool = buildTool(three, job.program.tools[index] ?? job.program.tools[0], lathe);
      toolCache.set(index, tool);
    }
    toolRoot.add(tool);
    activeTool = index;
  };

  const markerMaterial = new three.MeshBasicMaterial({ color: 0xef4444, transparent: true, opacity: 0.7, depthTest: false });
  const marker = new three.Mesh(new three.SphereGeometry(1, 24, 16), markerMaterial);
  marker.renderOrder = 10;
  marker.visible = false;
  scene.add(marker);
  const markerLight = new three.PointLight(0xef4444, 0, 0);
  scene.add(markerLight);

  const playSeconds = Math.min(Math.max(engine.duration, 8), 40);
  let clock = 0;
  let notifiedEnd = false;
  let notifiedCollision = false;
  let lastLine = -1;
  let wasPlaying = false;
  let last = performance.now();
  let frame = 0;
  let seekTo: number | null = null;
  let announce = false;
  let lastProgress = 0;
  let disposed = false;

  const rebuild = () => {
    scene.remove(surface.object);
    surface.dispose();
    engine = createEngine(job);
    surface = buildSurface(three, engine, lathe);
    scene.add(surface.object);
    clock = 0;
    notifiedEnd = false;
    notifiedCollision = false;
    lastLine = -1;
    marker.visible = false;
    markerLight.intensity = 0;
    toolCache.forEach((tool) => {
      (tool.userData.toolMaterial as ThreeNS.MeshStandardMaterial).color.set(0xfbbf24);
      (tool.userData.toolMaterial as ThreeNS.MeshStandardMaterial).emissive.set(0xf59e0b);
      (tool.userData.holderMaterial as ThreeNS.MeshStandardMaterial).color.set(0x475569);
    });
  };

  const place = (tip: Vec3) => {
    if (lathe) toolRoot.position.set(tip[2], tip[0] / 2, 0);
    else toolRoot.position.set(...millWorld(tip));
  };

  const tick = (now: number) => {
    if (disposed) return;
    frame = requestAnimationFrame(tick);
    const dt = Math.min((now - last) / 1000, 0.1);
    last = now;

    if (controls.playing && !wasPlaying && engine.done && seekTo === null) rebuild();
    if (seekTo !== null) {
      const goal = Math.min(Math.max(seekTo, 0), 1) * engine.duration;
      seekTo = null;
      if (goal < clock - 1e-9 || engine.collision) rebuild();
      clock = goal;
      announce = true;
      notifiedEnd = false;
      engine.advanceTo(clock + 1e-9);
    }
    wasPlaying = controls.playing;

    if (controls.playing && !engine.done) {
      const rate = (engine.duration / playSeconds) * controls.speed;
      clock = Math.min(clock + dt * rate, engine.duration);
      engine.advanceTo(clock);
    }

    const pose = engine.pose(clock);
    selectTool(pose.tool);
    place(pose.tip);
    if (!lathe) {
      // Tool axis in program coordinates maps to world X, Z, -Y, like the positions do.
      const axis = pose.axis ?? [0, 0, 1];
      toolAxis.set(axis[0], axis[2], -axis[1]);
      toolRoot.quaternion.setFromUnitVectors(worldUp, toolAxis);
    }
    if (pose.line !== lastLine) {
      lastLine = pose.line;
      if (controls.playing || announce) callbacks.onLine?.(pose.line);
      announce = false;
    }
    surface.update();

    const hit = engine.collision;
    if (hit) {
      const world: Vec3 = lathe ? [hit.point[2], hit.point[0] / 2, 0] : millWorld(hit.point);
      const size = Math.max(span * 0.04, 2) * (1 + 0.15 * Math.sin(now / 120));
      marker.position.set(world[0], world[1], world[2]);
      marker.scale.setScalar(size);
      marker.visible = true;
      markerLight.position.copy(marker.position);
      markerLight.intensity = 60;
      markerLight.distance = span;
      const tool = toolCache.get(pose.tool);
      if (tool) {
        (tool.userData.toolMaterial as ThreeNS.MeshStandardMaterial).color.set(0xef4444);
        (tool.userData.toolMaterial as ThreeNS.MeshStandardMaterial).emissive.set(0xdc2626);
        (tool.userData.holderMaterial as ThreeNS.MeshStandardMaterial).color.set(0x991b1b);
      }
      if (!notifiedCollision) {
        notifiedCollision = true;
        callbacks.onLine?.(hit.line);
        callbacks.onCollision?.(hit);
      }
    } else if (engine.done && controls.playing && !notifiedEnd) {
      notifiedEnd = true;
      callbacks.onEnd?.();
    }

    path.visible = controls.path;
    const sectionOn = controls.section;
    (surface.object as ThreeNS.Group).traverse((object) => {
      const material = (object as ThreeNS.Mesh).material as ThreeNS.Material | undefined;
      if (material) material.clippingPlanes = sectionOn ? [clip] : null;
    });
    if (now - lastProgress > 100) {
      lastProgress = now;
      callbacks.onProgress?.(engine.duration > 0 ? clock / engine.duration : 0);
    }
    container.dataset.simClock = clock.toFixed(2);
    container.dataset.simDone = String(engine.done);
    container.dataset.simCollision = hit ? `${hit.kind}@${hit.line + 1}` : "";
    orbit.update();
    renderer.render(scene, camera);
  };
  frame = requestAnimationFrame(tick);

  const resize = () => {
    const width = container.clientWidth || 800;
    const height = container.clientHeight || 600;
    renderer.setSize(width, height, false);
    camera.aspect = width / Math.max(height, 1);
    camera.updateProjectionMatrix();
  };
  const observer = new ResizeObserver(resize);
  observer.observe(container);

  return {
    restart: rebuild,
    seek: (fraction) => {
      seekTo = fraction;
    },
    step: () => {
      const { starts, durations } = (engine as unknown as { timeline: { starts: number[]; durations: number[] } }).timeline;
      const motions = job.program.motions;
      let index = 0;
      while (index < motions.length && starts[index] + durations[index] <= clock + 1e-6) index += 1;
      if (index >= motions.length) return;
      let group = index;
      while (group + 1 < motions.length && motions[group + 1].line === motions[index].line) group += 1;
      seekTo = (starts[group] + durations[group]) / engine.duration;
    },
    snapshot: () => {
      renderer.render(scene, camera);
      return renderer.domElement.toDataURL("image/png");
    },
    finished: () => engine.done,
    dispose: () => {
      disposed = true;
      cancelAnimationFrame(frame);
      observer.disconnect();
      surface.dispose();
      path.geometry.dispose();
      orbit.dispose();
      renderer.dispose();
      host.remove();
    },
  };
}
