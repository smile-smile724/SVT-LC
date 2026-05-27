import { mkdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { Document, NodeIO, type Mesh, type Node } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { copyToDocument, createDefaultPropertyResolver, simplify, weld } from '@gltf-transform/functions';
import type { AABB, Vec3 } from '@mtweb/shared-contracts';
import draco3d from 'draco3dgltf';
import { MeshoptDecoder, MeshoptEncoder, MeshoptSimplifier } from 'meshoptimizer';
import type { PreprocessConfig } from '../config.js';

export interface SceneInspection {
  sceneBounds: AABB;
  meshNodeCount: number;
  gridDivisions: [number, number, number];
}

export interface ExportedBlockArtifact {
  blockId: string;
  bbox: AABB;
  center: Vec3;
  coarseUri: string;
  coarseBytes: number;
  residualUri: string;
  residualBytes: number;
  nodeCount: number;
}

interface MeshNodeRecord {
  node: Node;
  mesh: Mesh;
  bbox: AABB;
  center: Vec3;
}

interface PartitionedBlock {
  bbox: AABB;
  cellCoords: [number, number, number];
  center: Vec3;
  entries: MeshNodeRecord[];
  blockId: string;
}

export interface GltfTransformAdapter {
  inspectScene(inputPath: string, config: PreprocessConfig): Promise<SceneInspection>;
  exportBlocks(inputPath: string, outputRoot: string, config: PreprocessConfig): Promise<ExportedBlockArtifact[]>;
}

let ioPromise: Promise<NodeIO> | undefined;

export class ScenePartitionGltfTransformAdapter implements GltfTransformAdapter {
  async inspectScene(inputPath: string, config: PreprocessConfig): Promise<SceneInspection> {
    const sourceDocument = await this.readDocument(inputPath);
    const meshNodes = collectMeshNodes(sourceDocument);

    if (meshNodes.length === 0) {
      throw new Error(`No mesh-bearing nodes found in source scene: ${inputPath}`);
    }

    const inspection: SceneInspection = {
      sceneBounds: computeAggregateBounds(meshNodes.map((entry) => entry.bbox)),
      meshNodeCount: meshNodes.length,
      gridDivisions: normalizeGridDivisions(config.gridDivisions)
    };

    console.log(`[preprocess] inspect scene via glTF Transform: ${inputPath}`);
    console.log(
      `[preprocess] found ${inspection.meshNodeCount} mesh nodes, bounds=${inspection.sceneBounds.join(', ')}, grid=${inspection.gridDivisions.join('x')}`
    );

    return inspection;
  }

  async exportBlocks(inputPath: string, outputRoot: string, config: PreprocessConfig): Promise<ExportedBlockArtifact[]> {
    if (config.partitionMode !== 'aabb-grid') {
      throw new Error(`Unsupported partition mode for current MVP adapter: ${config.partitionMode}`);
    }

    const sourceDocument = await this.readDocument(inputPath);
    const meshNodes = collectMeshNodes(sourceDocument);

    if (meshNodes.length === 0) {
      throw new Error(`No mesh-bearing nodes found in source scene: ${inputPath}`);
    }

    const partitionedBlocks = partitionMeshNodes(meshNodes, normalizeGridDivisions(config.gridDivisions));
    const io = await createConfiguredIo();
    const exportedBlocks: ExportedBlockArtifact[] = [];

    for (const block of partitionedBlocks) {
      const targetDocument = new Document();
      const targetScene = targetDocument.createScene(block.blockId);
      targetDocument.getRoot().setDefaultScene(targetScene);
      const resolve = createDefaultPropertyResolver(targetDocument, sourceDocument);

      for (const extension of sourceDocument.getRoot().listExtensionsUsed()) {
        const targetExtension = targetDocument.createExtension(extension.constructor as never);
        if (extension.isRequired()) {
          targetExtension.setRequired(true);
        }
      }

      for (const entry of block.entries) {
        const propertyMap = copyToDocument(targetDocument, sourceDocument, [entry.mesh], resolve);
        const targetMesh = propertyMap.get(entry.mesh) as Mesh | undefined;

        if (!targetMesh) {
          throw new Error(`Failed to copy mesh for node "${entry.node.getName() || '(unnamed)'}".`);
        }

        const targetNode = targetDocument
          .createNode(entry.node.getName() || `${block.blockId}-node`)
          .setMesh(targetMesh)
          .setMatrix(entry.node.getWorldMatrix())
          .setWeights(entry.node.getWeights());

        targetScene.addChild(targetNode);
      }

      const coarseDir = path.join(outputRoot, block.blockId, 'coarse');
      const coarsePath = path.join(coarseDir, 'lod1.glb');
      await mkdir(coarseDir, { recursive: true });
      await io.write(coarsePath, targetDocument);
      const coarseStats = await stat(coarsePath);

      // Residual: simplified copy of the coarse document (~30% target ratio)
      const residualDocument = await io.read(coarsePath);
      await residualDocument.transform(
        weld(),
        simplify({ simplifier: MeshoptSimplifier, ratio: 0.3, error: 0.01 })
      );
      const residualDir = path.join(outputRoot, block.blockId, 'residual');
      const residualPath = path.join(residualDir, 'lod2.glb');
      await mkdir(residualDir, { recursive: true });
      await io.write(residualPath, residualDocument);
      const residualStats = await stat(residualPath);

      exportedBlocks.push({
        blockId: block.blockId,
        bbox: block.bbox,
        center: block.center,
        coarseUri: toPortableRelativePath(outputRoot, coarsePath),
        coarseBytes: coarseStats.size,
        residualUri: toPortableRelativePath(outputRoot, residualPath),
        residualBytes: residualStats.size,
        nodeCount: block.entries.length
      });
    }

    console.log(
      `[preprocess] exported ${exportedBlocks.length} block glb files from ${path.basename(inputPath)} to ${outputRoot}`
    );

    return exportedBlocks;
  }

  private async readDocument(inputPath: string): Promise<Document> {
    const io = await createConfiguredIo();
    return io.read(inputPath);
  }
}

async function createConfiguredIo(): Promise<NodeIO> {
  if (!ioPromise) {
    ioPromise = (async () => {
      const [dracoDecoder, dracoEncoder] = await Promise.all([
        draco3d.createDecoderModule(),
        draco3d.createEncoderModule(),
        MeshoptDecoder.ready,
        MeshoptEncoder.ready
      ]).then(([decoder, encoder]) => [decoder, encoder] as const);

      return new NodeIO()
        .registerExtensions(ALL_EXTENSIONS)
        .registerDependencies({
          'draco3d.decoder': dracoDecoder,
          'draco3d.encoder': dracoEncoder,
          'meshopt.decoder': MeshoptDecoder,
          'meshopt.encoder': MeshoptEncoder
        });
    })();
  }

  return ioPromise;
}

function collectMeshNodes(sourceDocument: Document): MeshNodeRecord[] {
  const visited = new Set<Node>();
  const results: MeshNodeRecord[] = [];

  for (const scene of sourceDocument.getRoot().listScenes()) {
    for (const rootNode of scene.listChildren()) {
      rootNode.traverse((node) => {
        if (visited.has(node)) {
          return;
        }

        visited.add(node);
        const mesh = node.getMesh();
        if (!mesh) {
          return;
        }

        const bbox = computeNodeMeshBounds(node, mesh);
        results.push({
          node,
          mesh,
          bbox,
          center: getAabbCenter(bbox)
        });
      });
    }
  }

  return results;
}

function partitionMeshNodes(meshNodes: MeshNodeRecord[], gridDivisions: [number, number, number]): PartitionedBlock[] {
  const sceneBounds = computeAggregateBounds(meshNodes.map((entry) => entry.bbox));
  const blockMap = new Map<string, MeshNodeRecord[]>();

  for (const entry of meshNodes) {
    const cellCoords = getCellCoords(entry.center, sceneBounds, gridDivisions);
    const cellKey = cellCoords.join(':');
    const entries = blockMap.get(cellKey);

    if (entries) {
      entries.push(entry);
    } else {
      blockMap.set(cellKey, [entry]);
    }
  }

  return Array.from(blockMap.entries())
    .sort(([leftKey], [rightKey]) => leftKey.localeCompare(rightKey))
    .map(([cellKey, entries], index) => {
      const bbox = computeAggregateBounds(entries.map((entry) => entry.bbox));
      return {
        blockId: `block_${String(index + 1).padStart(4, '0')}`,
        bbox,
        center: getAabbCenter(bbox),
        cellCoords: cellKey.split(':').map((value) => Number.parseInt(value, 10)) as [number, number, number],
        entries
      };
    });
}

function computeNodeMeshBounds(node: Node, mesh: Mesh): AABB {
  const worldMatrix = node.getWorldMatrix();
  const points: Vec3[] = [];

  for (const primitive of mesh.listPrimitives()) {
    const position = primitive.getAttribute('POSITION');
    const indices = primitive.getIndices();

    if (!position) {
      continue;
    }

    const vertexCount = indices ? indices.getCount() : position.getCount();
    for (let index = 0; index < vertexCount; index += 1) {
      const accessorIndex = indices ? indices.getScalar(index) : index;
      const localPosition = position.getElement(accessorIndex, [0, 0, 0]) as Vec3;
      points.push(transformPoint(worldMatrix, localPosition));
    }
  }

  if (points.length === 0) {
    throw new Error(`Mesh node "${node.getName() || '(unnamed)'}" has no readable vertex positions.`);
  }

  return pointsToAabb(points);
}

function normalizeGridDivisions(gridDivisions?: [number, number, number]): [number, number, number] {
  const fallback: [number, number, number] = [2, 2, 2];
  if (!gridDivisions) {
    return fallback;
  }

  return [
    normalizeDivisionValue(gridDivisions[0]),
    normalizeDivisionValue(gridDivisions[1]),
    normalizeDivisionValue(gridDivisions[2])
  ];
}

function normalizeDivisionValue(value: number | undefined): number {
  if (!Number.isFinite(value) || value === undefined) {
    return 1;
  }

  return Math.max(1, Math.floor(value));
}

function getCellCoords(point: Vec3, bounds: AABB, gridDivisions: [number, number, number]): [number, number, number] {
  return [0, 1, 2].map((axis) => {
    const min = bounds[axis];
    const max = bounds[axis + 3];
    const divisionCount = gridDivisions[axis];
    const extent = max - min;

    if (!Number.isFinite(extent) || extent <= 0) {
      return 0;
    }

    const normalized = clamp((point[axis] - min) / extent, 0, 1 - Number.EPSILON);
    return Math.min(divisionCount - 1, Math.floor(normalized * divisionCount));
  }) as [number, number, number];
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function computeAggregateBounds(boundsList: AABB[]): AABB {
  if (boundsList.length === 0) {
    throw new Error('Cannot compute aggregate bounds for an empty bounds list.');
  }

  const aggregate: AABB = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];

  for (const bounds of boundsList) {
    aggregate[0] = Math.min(aggregate[0], bounds[0]);
    aggregate[1] = Math.min(aggregate[1], bounds[1]);
    aggregate[2] = Math.min(aggregate[2], bounds[2]);
    aggregate[3] = Math.max(aggregate[3], bounds[3]);
    aggregate[4] = Math.max(aggregate[4], bounds[4]);
    aggregate[5] = Math.max(aggregate[5], bounds[5]);
  }

  return aggregate;
}

function getAabbCenter(bounds: AABB): Vec3 {
  return [
    (bounds[0] + bounds[3]) / 2,
    (bounds[1] + bounds[4]) / 2,
    (bounds[2] + bounds[5]) / 2
  ];
}

function pointsToAabb(points: Vec3[]): AABB {
  const bounds: AABB = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];

  for (const point of points) {
    bounds[0] = Math.min(bounds[0], point[0]);
    bounds[1] = Math.min(bounds[1], point[1]);
    bounds[2] = Math.min(bounds[2], point[2]);
    bounds[3] = Math.max(bounds[3], point[0]);
    bounds[4] = Math.max(bounds[4], point[1]);
    bounds[5] = Math.max(bounds[5], point[2]);
  }

  return bounds;
}

function transformPoint(matrix: number[], point: Vec3): Vec3 {
  const [x, y, z] = point;
  const w = matrix[3] * x + matrix[7] * y + matrix[11] * z + matrix[15];
  const invW = w && Number.isFinite(w) ? 1 / w : 1;

  return [
    (matrix[0] * x + matrix[4] * y + matrix[8] * z + matrix[12]) * invW,
    (matrix[1] * x + matrix[5] * y + matrix[9] * z + matrix[13]) * invW,
    (matrix[2] * x + matrix[6] * y + matrix[10] * z + matrix[14]) * invW
  ];
}

function toPortableRelativePath(root: string, absolutePath: string): string {
  return path.relative(root, absolutePath).split(path.sep).join('/');
}
