import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  createMetrics,
  recordLayerReady,
  recordLayerStart,
  recordViewCycle,
  recordSchedule,
  recordScheduleFailure,
  recordBandwidthSaving,
  recordRotationComplete,
  recordRotationRecovered,
  recordRotationStart,
  markSemanticGuidedCoarseCandidate,
  recordSemanticRankingSample,
  recordSemanticPriorityHit,
  recordSemanticFidelity,
  setExpectedSemanticTargets,
  setExpectedResidualTargets,
  fsvMs,
  semanticCompletionMs,
  firstCoarseMs,
  fullFidelityMs,
  ttfbMs,
  totalBytes,
  totalLoadCount,
  recordRenderFrame,
  getStatistics,
  exportLayerEventsCsv,
  exportViewCyclesCsv,
  exportSummaryCsv
} from '../packages/web-client/src/runtime/metrics.js';
import type { RuntimeMetrics } from '../packages/web-client/src/runtime/metrics.js';

const mockScheduleResponse = (mode: 'SF' | 'EE' | 'FR') => ({
  generatedAt: new Date().toISOString(),
  items: [{ blockId: 'b1', mode, priority: 0.8, layers: ['sem' as const, 'coarse' as const], ttl: 300, cacheHint: 'promote' as const, reason: 'test' }]
});

describe('createMetrics', () => {
  it('initializes with zero counts', () => {
    const m = createMetrics();
    expect(m.bytesByLayer.sem).toBe(0);
    expect(m.bytesByLayer.coarse).toBe(0);
    expect(m.bytesByLayer.residual).toBe(0);
    expect(m.loadCountByLayer.sem).toBe(0);
    expect(m.scheduleRoundtrips).toBe(0);
    expect(m.layerEvents).toHaveLength(0);
    expect(m.viewCycles).toHaveLength(0);
  });

  it('bootstrapAt is set to a recent timestamp', () => {
    const before = performance.now();
    const m = createMetrics();
    const after = performance.now();
    expect(m.bootstrapAt).toBeGreaterThanOrEqual(before);
    expect(m.bootstrapAt).toBeLessThanOrEqual(after);
  });
});

describe('recordLayerReady', () => {
  let m: RuntimeMetrics;
  beforeEach(() => { m = createMetrics(); });

  it('accumulates bytes and load count', () => {
    recordLayerReady(m, 'coarse', 50000, 'b1', recordLayerStart(), 'SF');
    expect(m.bytesByLayer.coarse).toBe(50000);
    expect(m.loadCountByLayer.coarse).toBe(1);
  });

  it('sets fsvAt on first sem ready', () => {
    expect(m.fsvAt).toBeUndefined();
    recordLayerReady(m, 'sem', 512, 'b1', recordLayerStart(), 'SF');
    expect(m.fsvAt).toBeDefined();
  });

  it('fsvAt only set once', () => {
    recordLayerReady(m, 'sem', 512, 'b1', recordLayerStart(), 'SF');
    const first = m.fsvAt;
    recordLayerReady(m, 'sem', 512, 'b2', recordLayerStart(), 'SF');
    expect(m.fsvAt).toBe(first);
  });

  it('sets firstBlockReadyAt on first call regardless of layer', () => {
    expect(m.firstBlockReadyAt).toBeUndefined();
    recordLayerReady(m, 'residual', 80000, 'b1', recordLayerStart(), 'FR');
    expect(m.firstBlockReadyAt).toBeDefined();
  });

  it('tracks first coarse geometry latency', () => {
    expect(firstCoarseMs(m)).toBeUndefined();
    recordLayerReady(m, 'coarse', 50000, 'b1', recordLayerStart(), 'SF');
    expect(firstCoarseMs(m)).toBeGreaterThanOrEqual(0);
  });

  it('tracks full fidelity after expected residual targets complete', () => {
    setExpectedResidualTargets(m, 2);
    recordLayerReady(m, 'residual', 1000, 'b1', recordLayerStart(), 'SF');
    expect(fullFidelityMs(m)).toBeUndefined();
    recordLayerReady(m, 'residual', 1000, 'b2', recordLayerStart(), 'SF');
    expect(fullFidelityMs(m)).toBeGreaterThanOrEqual(0);
  });

  it('pushes LayerEvent when blockId is provided', () => {
    const startedAt = recordLayerStart();
    recordLayerReady(m, 'coarse', 50000, 'b1', startedAt, 'EE');
    expect(m.layerEvents).toHaveLength(1);
    expect(m.layerEvents[0].blockId).toBe('b1');
    expect(m.layerEvents[0].layer).toBe('coarse');
    expect(m.layerEvents[0].mode).toBe('EE');
    expect(m.layerEvents[0].bytes).toBe(50000);
    expect(m.layerEvents[0].completedAt).toBeGreaterThanOrEqual(m.layerEvents[0].startedAt);
  });

  it('does not push LayerEvent when blockId is empty', () => {
    recordLayerReady(m, 'sem', 512);
    expect(m.layerEvents).toHaveLength(0);
  });
});

describe('fsvMs / ttfbMs', () => {
  it('both undefined before any layer ready', () => {
    const m = createMetrics();
    expect(fsvMs(m)).toBeUndefined();
    expect(ttfbMs(m)).toBeUndefined();
  });

  it('fsvMs defined after first sem ready', () => {
    const m = createMetrics();
    recordLayerReady(m, 'sem', 512, 'b1', recordLayerStart(), 'SF');
    const fsv = fsvMs(m);
    expect(fsv).toBeDefined();
    expect(fsv!).toBeGreaterThanOrEqual(0);
  });

  it('ttfbMs defined after any layer ready', () => {
    const m = createMetrics();
    recordLayerReady(m, 'coarse', 50000, 'b1', recordLayerStart(), 'FR');
    const ttfb = ttfbMs(m);
    expect(ttfb).toBeDefined();
    expect(ttfb!).toBeGreaterThanOrEqual(0);
  });
});

describe('runtime render pressure metrics', () => {
  it('records CPU frame time and renderer complexity samples', () => {
    const m = createMetrics();
    recordRenderFrame(m, false, {
      cpuFrameTimeMs: 12.5,
      drawCalls: 4,
      triangles: 1200,
      meshObjects: 3,
      renderInstances: 3
    });

    const stats = getStatistics(m);
    expect(stats.cpuFrameTimeMs.mean).toBe(12.5);
    expect(stats.drawCalls.mean).toBe(4);
    expect(stats.triangles.mean).toBe(1200);
    expect(stats.meshObjects.mean).toBe(3);
    expect(stats.renderInstances.mean).toBe(3);
    expect(stats.stableFPS.mean).toBeGreaterThan(0);
  });

  it('keeps GPU frame time nullable when timer query is unavailable', () => {
    const m = createMetrics();
    recordRenderFrame(m, false, {
      cpuFrameTimeMs: 8,
      gpuFrameTimeMs: null,
      drawCalls: 1,
      triangles: 10,
      meshObjects: 1,
      renderInstances: 1
    });

    const stats = getStatistics(m);
    expect(stats.gpuFrameTimeMs.mean).toBeNull();
    expect(stats.gpuFrameTimeMs.p95).toBeNull();
    expect(stats.gpuFrameTimeMs.missing_reason).toContain('GPU');
  });

  it('uses the same stat shape for render pressure metrics', () => {
    const m = createMetrics();
    recordRenderFrame(m, false, { cpuFrameTimeMs: 10, drawCalls: 2, triangles: 100 });
    recordRenderFrame(m, false, { cpuFrameTimeMs: 20, drawCalls: 4, triangles: 200 });

    const stats = getStatistics(m);
    for (const key of ['cpuFrameTimeMs', 'drawCalls', 'triangles']) {
      expect(stats[key]).toHaveProperty('mean');
      expect(stats[key]).toHaveProperty('std');
      expect(stats[key]).toHaveProperty('p95');
    }
  });
});

describe('totalBytes / totalLoadCount', () => {
  it('sums across layers', () => {
    const m = createMetrics();
    recordLayerReady(m, 'sem', 1000);
    recordLayerReady(m, 'coarse', 2000);
    recordLayerReady(m, 'residual', 3000);
    expect(totalBytes(m)).toBe(6000);
    expect(totalLoadCount(m)).toBe(3);
  });
});

describe('recordViewCycle', () => {
  it('appends a ViewCycle entry', () => {
    const m = createMetrics();
    recordViewCycle(m, Math.PI / 4);
    expect(m.viewCycles).toHaveLength(1);
    expect(m.viewCycles[0].orbitAngle).toBeCloseTo(Math.PI / 4, 5);
  });

  it('bytesThisCycle reflects bytes loaded since last cycle', () => {
    const m = createMetrics();
    recordLayerReady(m, 'coarse', 10000);
    recordViewCycle(m, 0);
    expect(m.viewCycles[0].totalBytesLoaded).toBe(10000);
    // Next cycle: only new bytes count
    recordLayerReady(m, 'residual', 5000);
    recordViewCycle(m, 1);
    expect(m.viewCycles[1].totalBytesLoaded).toBe(5000);
  });
});

describe('recordSchedule / recordScheduleFailure', () => {
  it('increments roundtrips and mode distribution', () => {
    const m = createMetrics();
    recordSchedule(m, mockScheduleResponse('SF'));
    expect(m.scheduleRoundtrips).toBe(1);
    expect(m.modeDistribution.SF).toBe(1);
  });

  it('increments failures', () => {
    const m = createMetrics();
    recordScheduleFailure(m);
    recordScheduleFailure(m);
    expect(m.scheduleFailures).toBe(2);
  });
});

describe('recordBandwidthSaving', () => {
  it('records savings as bounded ratio samples', () => {
    const m = createMetrics();
    recordBandwidthSaving(m, 50, 200);
    recordBandwidthSaving(m, 120, 100);
    expect(m.bandwidthSavingSamples).toHaveLength(2);
    expect(m.bandwidthSavingSamples[0]).toBeCloseTo(0.75, 5);
    expect(m.bandwidthSavingSamples[1]).toBeCloseTo(0, 5);
  });

  it('ignores invalid byte totals', () => {
    const m = createMetrics();
    recordBandwidthSaving(m, 10, 0);
    expect(m.bandwidthSavingSamples).toHaveLength(0);
  });
});

describe('rotation and semantic fidelity metrics', () => {
  it('records rotation stall and recovery metrics separately', () => {
    const m = createMetrics();
    recordRotationStart(m);
    recordRotationComplete(m);
    recordRotationRecovered(m);
    const stats = getStatistics(m);
    expect(stats.rotationStallTime.mean).toBeGreaterThanOrEqual(0);
    expect(stats.rotationRecoveryTime.mean).toBeGreaterThanOrEqual(0);
  });

  it('derives semantic fidelity from bounded samples', () => {
    const m = createMetrics();
    recordSemanticFidelity(m, 0.8);
    recordSemanticFidelity(m, 1.5);
    const stats = getStatistics(m, { useSemantic: true });
    expect(stats.semanticFidelity.mean).toBeCloseTo(0.9, 5);
  });

  it('tracks semantic completion, quality alias, priority hit rate, and semantic byte ratio', () => {
    const m = createMetrics();
    setExpectedSemanticTargets(m, 2);
    recordLayerReady(m, 'sem', 100, 'b1', recordLayerStart(), 'SF');
    expect(semanticCompletionMs(m)).toBeUndefined();
    recordLayerReady(m, 'sem', 100, 'b2', recordLayerStart(), 'SF');
    recordLayerReady(m, 'coarse', 800, 'b1', recordLayerStart(), 'SF');
    recordSemanticFidelity(m, 0.75);
    recordSemanticPriorityHit(m, true);
    recordSemanticPriorityHit(m, false);
    expect(semanticCompletionMs(m)).toBeGreaterThanOrEqual(0);
    let stats = getStatistics(m, { useSemantic: true });
    expect(stats.semanticCompletionTime.mean).toBeGreaterThanOrEqual(0);
    expect(stats.semanticQualityScore.mean).toBeCloseTo(0.75, 5);
    recordSemanticRankingSample(m, {
      scheduledTopK: ['b1', 'b2', 'b3'],
      semanticTopK: ['b1', 'b3', 'b4'],
      relevanceByBlockId: { b1: 1, b2: 0.2, b3: 0.8, b4: 0.7 },
      k: 3
    });
    stats = getStatistics(m, { useSemantic: true });
    expect(stats.priorityHitRate.mean).toBeCloseTo(0.5, 5);
    expect(stats.semanticBytesRatio.mean).toBeCloseTo(0.2, 5);
  });

  it('separates semantic-layer saving from first-screen transfer bytes', () => {
    const m = createMetrics();
    recordLayerReady(m, 'sem', 300, 'b1', recordLayerStart(), 'SF');
    recordBandwidthSaving(m, 300, 100000);
    const stats = getStatistics(m, { useSemantic: true });
    expect(stats.semanticLayerSaving.mean).toBeCloseTo(0.997, 5);
    expect(stats.bandwidthSaving.mean).toBeCloseTo(stats.semanticLayerSaving.mean, 5);
    expect(stats.firstScreenTransferBytes.total).not.toBe(stats.semanticLayerSaving.mean);
  });

  it('tracks semantic-guided ready latency after semantic metadata and a guided coarse candidate', () => {
    const m = createMetrics();
    recordLayerReady(m, 'sem', 100, 'b1', recordLayerStart(), 'SF');
    markSemanticGuidedCoarseCandidate(m, 'b2');
    recordLayerReady(m, 'coarse', 1000, 'b2', recordLayerStart(), 'SF');
    const stats = getStatistics(m, { useSemantic: true });
    expect(stats.firstSemanticMetadataLatency.mean).toBeGreaterThanOrEqual(0);
    expect(stats.semanticGuidedReadyLatency.mean).toBeGreaterThanOrEqual(stats.firstSemanticMetadataLatency.mean);
  });

  it('reports semantic ranking metrics separately from legacy priority hit rate', () => {
    const m = createMetrics();
    recordSemanticPriorityHit(m, false);
    recordSemanticRankingSample(m, {
      scheduledTopK: ['a', 'b', 'x'],
      semanticTopK: ['a', 'b', 'c'],
      relevanceByBlockId: { a: 1, b: 0.8, c: 0.7, x: 0.1 },
      k: 3
    });
    const stats = getStatistics(m, { useSemantic: true });
    expect(stats.priorityHitRate.mean).toBe(0);
    expect(stats.semanticPrecisionAtK.mean).toBeCloseTo(2 / 3, 5);
    expect(stats.semanticNdcgAtK.mean).toBeGreaterThan(0);
    expect(stats.top1SemanticHit.mean).toBe(1);
  });
});

describe('getStatistics bandwidth windowing', () => {
  it('limits semantic methods to the first-semantic-ready window', () => {
    const m = createMetrics();
    m.bootstrapAt = 1000;
    m.firstSemReadyAt = 1500;

    const resources = [
      {
        name: 'http://localhost/scenes/demo-scene/manifest/blocks.json',
        responseEnd: 1200,
        transferSize: 1000,
        encodedBodySize: 1000,
        decodedBodySize: 1000
      },
      {
        name: 'http://localhost/scenes/demo-scene/semantic/block-1.json',
        responseEnd: 1400,
        transferSize: 2000,
        encodedBodySize: 2000,
        decodedBodySize: 2000
      },
      {
        name: 'http://localhost/scenes/demo-scene/coarse/block-1.glb',
        responseEnd: 1700,
        transferSize: 5000,
        encodedBodySize: 5000,
        decodedBodySize: 5000
      }
    ] as unknown as PerformanceResourceTiming[];

    const spy = vi.spyOn(performance, 'getEntriesByType').mockReturnValue(resources);
    const stats = getStatistics(m, { useSemantic: true });

    expect(stats.bandwidthTransferBytes.sem).toBe(3000);
    expect(stats.bandwidthTransferBytes.coarse).toBe(0);
    expect(stats.bandwidthTransferBytes.residual).toBe(0);
    expect(stats.bandwidthTransferBytes.total).toBe(3000);
    expect(stats.firstScreenTransferBytes.total).toBe(3000);
    expect(stats.fullSessionTransferBytes.total).toBe(8000);
    spy.mockRestore();
  });

  it('keeps the full session for baseline methods', () => {
    const m = createMetrics();
    m.bootstrapAt = 1000;

    const resources = [
      {
        name: 'http://localhost/scenes/demo-scene/manifest/blocks.json',
        responseEnd: 1200,
        transferSize: 1000,
        encodedBodySize: 1000,
        decodedBodySize: 1000
      },
      {
        name: 'http://localhost/scenes/demo-scene/coarse/block-1.glb',
        responseEnd: 1700,
        transferSize: 5000,
        encodedBodySize: 5000,
        decodedBodySize: 5000
      }
    ] as unknown as PerformanceResourceTiming[];

    const spy = vi.spyOn(performance, 'getEntriesByType').mockReturnValue(resources);
    const stats = getStatistics(m, { useSemantic: false });

    expect(stats.bandwidthTransferBytes.total).toBe(6000);
    expect(stats.firstScreenTransferBytes.total).toBe(6000);
    expect(stats.fullSessionTransferBytes.total).toBe(6000);
    spy.mockRestore();
  });
});

describe('CSV export', () => {
  let m: RuntimeMetrics;
  beforeEach(() => {
    m = createMetrics();
    const t = recordLayerStart();
    recordLayerReady(m, 'sem', 512, 'b1', t, 'SF');
    recordLayerReady(m, 'coarse', 50000, 'b1', recordLayerStart(), 'EE');
    recordBandwidthSaving(m, 512, 100000);
    recordViewCycle(m, 1.23);
    recordSchedule(m, mockScheduleResponse('SF'));
  });

  it('exportLayerEventsCsv has header and correct row count', () => {
    const csv = exportLayerEventsCsv(m);
    const lines = csv.split('\n');
    expect(lines[0]).toContain('blockId');
    expect(lines[0]).toContain('layer');
    expect(lines[0]).toContain('bytes');
    expect(lines[0]).toContain('mode');
    expect(lines).toHaveLength(3); // header + 2 events
  });

  it('exportViewCyclesCsv has header and one data row', () => {
    const csv = exportViewCyclesCsv(m);
    const lines = csv.split('\n');
    expect(lines[0]).toContain('orbitAngleDeg');
    expect(lines).toHaveLength(2); // header + 1 cycle
  });

  it('exportSummaryCsv contains key metrics', () => {
    const csv = exportSummaryCsv(m);
    expect(csv).toContain('fsv_ms');
    expect(csv).toContain('semantic_completion_ms');
    expect(csv).toContain('first_coarse_ms');
    expect(csv).toContain('full_fidelity_ms');
    expect(csv).toContain('sem_bytes,512');
    expect(csv).toContain('coarse_bytes,50000');
    expect(csv).toContain('semantic_fidelity');
    expect(csv).toContain('priority_hit_rate');
    expect(csv).toContain('semantic_precision_at_k');
    expect(csv).toContain('semantic_ndcg_at_k');
    expect(csv).toContain('semantic_bytes_ratio');
    expect(csv).toContain('semantic_layer_saving_pct');
    expect(csv).toContain('mode_SF,1');
    expect(csv).toContain('schedule_roundtrips,1');
  });
});
