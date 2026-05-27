import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { buildVisibleBlockTelemetry } from '../packages/web-client/src/runtime/telemetry.js';
import { createBlockRecord } from '../packages/web-client/src/runtime/blockLoader.js';
import type { BlockManifest } from '../packages/shared-contracts/src/index.js';

const makeBlock = (overrides: Partial<BlockManifest> = {}): BlockManifest => ({
  blockId: 'block_0001',
  bbox: [0, 0, 0, 1, 1, 1],
  center: [0.5, 0.5, 0.5],
  bytes: { coarse: 50000, residual: 15000 },
  layers: { coarse: 'block_0001/coarse/lod1.glb', residual: 'block_0001/residual/lod2.glb' },
  semantic: {
    manifestUri: 'block_0001/sem/sem.json',
    thumbUris: ['block_0001/sem/thumb_0.webp'],
    data: {
      blockId: 'block_0001',
      bbox: [0, 0, 0, 1, 1, 1],
      labels: [{ name: 'building', score: 0.95 }],
      saliency: [{ bbox: [0, 0, 1, 1], score: 0.88 }],
      thumbs: ['block_0001/sem/thumb_0.webp'],
      semanticScore: 0.9,
      lods: { coarse: 'block_0001/coarse/lod1.glb', residual: ['block_0001/residual/lod2.glb'] }
    }
  },
  ...overrides
});

describe('buildVisibleBlockTelemetry', () => {
  it('produces different task match scores for different task labels', () => {
    const record = createBlockRecord(makeBlock());
    const cameraPos = new THREE.Vector3(2, 2, 2);
    const overview = buildVisibleBlockTelemetry([record], {
      cameraPos,
      bandwidthMbps: 8,
      rttMs: 40,
      taskLabels: ['overview'],
      hotCacheBytes: 0
    })[0];
    const inspect = buildVisibleBlockTelemetry([record], {
      cameraPos,
      bandwidthMbps: 8,
      rttMs: 40,
      taskLabels: ['inspect'],
      hotCacheBytes: 0
    })[0];

    expect(overview.taskMatchScore).not.toBe(inspect.taskMatchScore);
    expect(overview.taskMatchScore).toBeGreaterThanOrEqual(0);
    expect(overview.taskMatchScore).toBeLessThanOrEqual(1);
    expect(inspect.taskMatchScore).toBeGreaterThanOrEqual(0);
    expect(inspect.taskMatchScore).toBeLessThanOrEqual(1);
  });
});
