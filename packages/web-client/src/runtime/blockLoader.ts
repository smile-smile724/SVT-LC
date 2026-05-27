import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { BlockManifest, LayerName, SemanticManifest } from '@mtweb/shared-contracts';

export type BlockLoadState = 'idle' | 'loading' | 'ready' | 'error';

export interface BlockRecord {
  block: BlockManifest;
  semantic?: SemanticManifest;
  semanticBytes?: number;
  center: THREE.Vector3;
  state: Record<LayerName, BlockLoadState>;
  group?: THREE.Group;
  cameraDistance: number;
  priority: number;
}

export function createBlockRecord(
  block: BlockManifest,
  semantic?: SemanticManifest,
  semanticBytes?: number
): BlockRecord {
  return {
    block,
    semantic,
    semanticBytes,
    center: new THREE.Vector3(...block.center),
    state: { sem: 'idle', coarse: 'idle', residual: 'idle' },
    cameraDistance: Number.POSITIVE_INFINITY,
    priority: 0
  };
}

export function getCoarseUri(block: BlockManifest): string | undefined {
  const coarse = block.layers.coarse;
  if (!coarse) return undefined;
  return Array.isArray(coarse) ? coarse[0] : coarse;
}

export class GltfLoader {
  private readonly loader = new GLTFLoader();
  private readonly inflight = new Map<string, Promise<THREE.Group>>();

  load(url: string): Promise<THREE.Group> {
    const existing = this.inflight.get(url);
    if (existing) return existing;

    const promise = this.loader.loadAsync(url).then((gltf) => gltf.scene);
    this.inflight.set(url, promise);
    promise.finally(() => this.inflight.delete(url));
    return promise;
  }
}

/** @deprecated use GltfLoader */
export const CoarseGltfLoader = GltfLoader;

export function getResidualUri(block: BlockManifest): string | undefined {
  const residual = block.layers.residual;
  if (!residual) return undefined;
  return Array.isArray(residual) ? residual[0] : residual;
}
