/**
 * Minimal binary glTF 2.0 (GLB) writer / reader — no browser APIs, no dependencies.
 * Used to produce the sample model whose node names (PLOT_001 …) map to
 * plot_geometry.mesh_id, and to validate uploaded GLB headers.
 */

const MAGIC = 0x46546c67; // "glTF"
const CHUNK_JSON = 0x4e4f534a; // "JSON"
const CHUNK_BIN = 0x004e4942; // "BIN\0"

export interface GlbBox {
  name: string;
  /** Centre of the box in glTF coordinates (y up, metres). */
  center: [number, number, number];
  size: [number, number, number];
  color?: [number, number, number, number];
}

/** Unit cube (−0.5…0.5) with per-face normals: 24 vertices, 36 indices. */
function unitCube() {
  const faces: { n: [number, number, number]; v: [number, number, number][] }[] = [
    { n: [1, 0, 0], v: [[0.5, -0.5, -0.5], [0.5, 0.5, -0.5], [0.5, 0.5, 0.5], [0.5, -0.5, 0.5]] },
    { n: [-1, 0, 0], v: [[-0.5, -0.5, 0.5], [-0.5, 0.5, 0.5], [-0.5, 0.5, -0.5], [-0.5, -0.5, -0.5]] },
    { n: [0, 1, 0], v: [[-0.5, 0.5, -0.5], [-0.5, 0.5, 0.5], [0.5, 0.5, 0.5], [0.5, 0.5, -0.5]] },
    { n: [0, -1, 0], v: [[-0.5, -0.5, 0.5], [-0.5, -0.5, -0.5], [0.5, -0.5, -0.5], [0.5, -0.5, 0.5]] },
    { n: [0, 0, 1], v: [[0.5, -0.5, 0.5], [0.5, 0.5, 0.5], [-0.5, 0.5, 0.5], [-0.5, -0.5, 0.5]] },
    { n: [0, 0, -1], v: [[-0.5, -0.5, -0.5], [-0.5, 0.5, -0.5], [0.5, 0.5, -0.5], [0.5, -0.5, -0.5]] },
  ];
  const positions: number[] = [];
  const normals: number[] = [];
  const indices: number[] = [];
  faces.forEach((f, i) => {
    for (const v of f.v) {
      positions.push(...v);
      normals.push(...f.n);
    }
    const b = i * 4;
    // Counter-clockwise when viewed from outside (along the normal).
    indices.push(b, b + 1, b + 2, b, b + 2, b + 3);
  });
  return { positions: new Float32Array(positions), normals: new Float32Array(normals), indices: new Uint16Array(indices) };
}

const pad4 = (n: number) => (n + 3) & ~3;

/** Builds a GLB with one node + one mesh per box (all meshes share the unit-cube buffers; size comes from node scale). */
export function buildBoxesGlb(boxes: GlbBox[], opts: { generator?: string; extras?: Record<string, unknown> } = {}): Buffer {
  const cube = unitCube();
  const posBytes = Buffer.from(cube.positions.buffer);
  const nrmBytes = Buffer.from(cube.normals.buffer);
  const idxBytes = Buffer.from(cube.indices.buffer);
  const posOffset = 0;
  const nrmOffset = posBytes.length;
  const idxOffset = nrmOffset + nrmBytes.length;
  const binLength = pad4(idxOffset + idxBytes.length);
  const bin = Buffer.alloc(binLength);
  posBytes.copy(bin, posOffset);
  nrmBytes.copy(bin, nrmOffset);
  idxBytes.copy(bin, idxOffset);

  const colors = new Map<string, number>();
  const materials: unknown[] = [];
  const materialFor = (c: [number, number, number, number]) => {
    const k = c.join(",");
    if (!colors.has(k)) {
      colors.set(k, materials.length);
      materials.push({ name: `mat_${materials.length}`, pbrMetallicRoughness: { baseColorFactor: c, metallicFactor: 0, roughnessFactor: 0.8 } });
    }
    return colors.get(k)!;
  };

  const gltf = {
    asset: { version: "2.0", generator: opts.generator ?? "uniklife-3d-venture glb writer" },
    scene: 0,
    scenes: [{ name: "Scene", nodes: boxes.map((_, i) => i) }],
    nodes: boxes.map((b, i) => ({ name: b.name, mesh: i, translation: b.center, scale: b.size })),
    meshes: boxes.map((b) => ({
      name: b.name,
      primitives: [{ attributes: { POSITION: 0, NORMAL: 1 }, indices: 2, material: materialFor(b.color ?? [0.75, 0.78, 0.85, 1]), mode: 4 }],
    })),
    materials,
    accessors: [
      { bufferView: 0, componentType: 5126, count: 24, type: "VEC3", min: [-0.5, -0.5, -0.5], max: [0.5, 0.5, 0.5] },
      { bufferView: 1, componentType: 5126, count: 24, type: "VEC3" },
      { bufferView: 2, componentType: 5123, count: 36, type: "SCALAR" },
    ],
    bufferViews: [
      { buffer: 0, byteOffset: posOffset, byteLength: posBytes.length, target: 34962 },
      { buffer: 0, byteOffset: nrmOffset, byteLength: nrmBytes.length, target: 34962 },
      { buffer: 0, byteOffset: idxOffset, byteLength: idxBytes.length, target: 34963 },
    ],
    buffers: [{ byteLength: binLength }],
    ...(opts.extras ? { extras: opts.extras } : {}),
  };

  const jsonRaw = Buffer.from(JSON.stringify(gltf), "utf8");
  const jsonLength = pad4(jsonRaw.length);
  const json = Buffer.alloc(jsonLength, 0x20); // pad with spaces
  jsonRaw.copy(json);

  const total = 12 + 8 + jsonLength + 8 + binLength;
  const out = Buffer.alloc(total);
  out.writeUInt32LE(MAGIC, 0);
  out.writeUInt32LE(2, 4);
  out.writeUInt32LE(total, 8);
  out.writeUInt32LE(jsonLength, 12);
  out.writeUInt32LE(CHUNK_JSON, 16);
  json.copy(out, 20);
  const binHeader = 20 + jsonLength;
  out.writeUInt32LE(binLength, binHeader);
  out.writeUInt32LE(CHUNK_BIN, binHeader + 4);
  bin.copy(out, binHeader + 8);
  return out;
}

export interface GlbInfo {
  version: number;
  length: number;
  json: { nodes?: { name?: string; mesh?: number }[]; meshes?: { name?: string }[]; asset?: { version?: string }; [k: string]: unknown };
  binLength: number;
}

/** Validates the GLB container (header, chunk layout, JSON) and returns the parsed JSON chunk. Throws on invalid input. */
export function readGlb(buf: Buffer): GlbInfo {
  if (buf.length < 20) throw new Error("File too small to be a GLB");
  if (buf.readUInt32LE(0) !== MAGIC) throw new Error("Missing glTF magic bytes");
  const version = buf.readUInt32LE(4);
  if (version !== 2) throw new Error(`Unsupported glTF container version ${version} (2 required)`);
  const length = buf.readUInt32LE(8);
  if (length !== buf.length) throw new Error("GLB length header does not match the file size");
  const jsonLength = buf.readUInt32LE(12);
  if (buf.readUInt32LE(16) !== CHUNK_JSON) throw new Error("First GLB chunk must be JSON");
  if (jsonLength % 4 !== 0 || 20 + jsonLength > length) throw new Error("Invalid JSON chunk length");
  let json: GlbInfo["json"];
  try {
    json = JSON.parse(buf.toString("utf8", 20, 20 + jsonLength));
  } catch {
    throw new Error("GLB JSON chunk is not valid JSON");
  }
  if (json?.asset?.version !== "2.0") throw new Error("glTF asset.version must be 2.0");
  let binLength = 0;
  const next = 20 + jsonLength;
  if (next + 8 <= length) {
    binLength = buf.readUInt32LE(next);
    if (buf.readUInt32LE(next + 4) !== CHUNK_BIN) throw new Error("Second GLB chunk must be BIN");
    if (next + 8 + binLength > length) throw new Error("Invalid BIN chunk length");
  }
  return { version, length, json, binLength };
}

/** Names of nodes that reference a mesh (these become three.js Mesh names). */
export function glbMeshNodeNames(info: GlbInfo): string[] {
  return (info.json.nodes ?? []).filter((n) => n.mesh !== undefined && n.name).map((n) => n.name!);
}
