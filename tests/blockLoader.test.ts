import { describe, it, expect } from 'vitest';
import { createBlockRecord, getCoarseUri, getResidualUri } from '../packages/web-client/src/runtime/blockLoader.js';
import type { BlockManifest } from '../packages/shared-contracts/src/index.js';

const makeBlock = (overrides: Partial<BlockManifest> = {}): BlockManifest => ({
  blockId: 'block_0001',
  bbox: [0, 0, 0, 1, 1, 1],
  center: [0.5, 0.5, 0.5],
  bytes: { coarse: 50000, residual: 15000 },
  layers: { coarse: 'block_0001/coarse/lod1.glb', residual: 'block_0001/residual/lod2.glb' },
  ...overrides
});

describe('createBlockRecord', () => {
  it('initializes all layer states to idle', () => {
    const record = createBlockRecord(makeBlock());
    expect(record.state.sem).toBe('idle');
    expect(record.state.coarse).toBe('idle');
    expect(record.state.residual).toBe('idle');
  });

  it('sets center from block.center', () => {
    const record = createBlockRecord(makeBlock({ center: [1, 2, 3] }));
    expect(record.center.x).toBeCloseTo(1);
    expect(record.center.y).toBeCloseTo(2);
    expect(record.center.z).toBeCloseTo(3);
  });

  it('initializes cameraDistance to Infinity', () => {
    const record = createBlockRecord(makeBlock());
    expect(record.cameraDistance).toBe(Infinity);
  });

  it('stores semantic when provided', () => {
    const sem = {
      blockId: 'block_0001',
      bbox: [0, 0, 0, 1, 1, 1] as [number, number, number, number, number, number],
      labels: [{ name: 'building', score: 0.9 }],
      saliency: [],
      thumbs: [],
      semanticScore: 0.85,
      lods: { coarse: 'block_0001/coarse/lod1.glb' }
    };
    const record = createBlockRecord(makeBlock(), sem);
    expect(record.semantic?.semanticScore).toBe(0.85);
  });

  it('semantic is undefined when not provided', () => {
    const record = createBlockRecord(makeBlock());
    expect(record.semantic).toBeUndefined();
  });
});

describe('getCoarseUri', () => {
  it('returns string when coarse is a string', () => {
    const block = makeBlock({ layers: { coarse: 'block_0001/coarse/lod1.glb' } });
    expect(getCoarseUri(block)).toBe('block_0001/coarse/lod1.glb');
  });

  it('returns first element when coarse is an array', () => {
    const block = makeBlock({ layers: { coarse: ['block_0001/coarse/lod1.glb', 'block_0001/coarse/lod2.glb'] } });
    expect(getCoarseUri(block)).toBe('block_0001/coarse/lod1.glb');
  });

  it('returns undefined when coarse is missing', () => {
    const block = makeBlock({ layers: {} });
    expect(getCoarseUri(block)).toBeUndefined();
  });
});

describe('getResidualUri', () => {
  it('returns string when residual is a string', () => {
    const block = makeBlock({ layers: { residual: 'block_0001/residual/lod2.glb' } });
    expect(getResidualUri(block)).toBe('block_0001/residual/lod2.glb');
  });

  it('returns first element when residual is an array', () => {
    const block = makeBlock({ layers: { residual: ['block_0001/residual/lod2.glb'] } });
    expect(getResidualUri(block)).toBe('block_0001/residual/lod2.glb');
  });

  it('returns undefined when residual is missing', () => {
    const block = makeBlock({ layers: { coarse: 'block_0001/coarse/lod1.glb' } });
    expect(getResidualUri(block)).toBeUndefined();
  });
});
