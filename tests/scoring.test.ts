import { describe, it, expect } from 'vitest';
import {
  scoreVisibility,
  scoreSemantic,
  scoreNetworkPressure,
  scoreSF,
  scoreEE,
  scoreFR,
  scoreTaskIntent,
  layersForMode,
  cacheHintForMode,
  buildScheduleDecision,
  buildScheduleResponse,
  rankVisibleBlocks,
  computeSemanticRankingMetrics
} from '../packages/scheduler-service/src/scoring.js';
import { DEFAULT_PROFILE } from '../packages/scheduler-service/src/profile.js';
import type { VisibleBlockTelemetry, ScheduleRequest } from '../packages/shared-contracts/src/index.js';

const makeBlock = (overrides: Partial<VisibleBlockTelemetry> = {}): VisibleBlockTelemetry => ({
  blockId: 'block_0001',
  centerScore: 0.8,
  visibleAreaScore: 0.7,
  semanticScore: 0.9,
  taskMatchScore: 0.85,
  edgeHitRate: 0.6,
  fidelityGain: 0.5,
  remoteLatencyMs: 80,
  bytes: { sem: 512, coarse: 50000, residual: 80000 },
  ...overrides
});

const makeRequest = (blocks: VisibleBlockTelemetry[]): ScheduleRequest => ({
  visibleBlocks: blocks,
  network: { bwEstimateMbps: 8, rttMs: 40 },
  device: { cpuLoad: 0.3, hotCacheBytes: 0 },
  taskLabels: ['overview']
});

describe('scoreVisibility', () => {
  it('blends centerScore and visibleAreaScore', () => {
    const score = scoreVisibility(makeBlock({ centerScore: 1.0, visibleAreaScore: 1.0 }));
    expect(score).toBeCloseTo(1.0, 2);
  });

  it('clamps to [0, 1]', () => {
    expect(scoreVisibility(makeBlock({ centerScore: 2, visibleAreaScore: 2 }))).toBeLessThanOrEqual(1);
    expect(scoreVisibility(makeBlock({ centerScore: -1, visibleAreaScore: -1 }))).toBeGreaterThanOrEqual(0);
  });
});

describe('scoreSemantic', () => {
  it('blends semanticScore and taskMatchScore', () => {
    const score = scoreSemantic(makeBlock({ semanticScore: 1.0, taskMatchScore: 1.0 }));
    expect(score).toBeCloseTo(1.0, 2);
  });

  it('zero inputs → zero output', () => {
    expect(scoreSemantic(makeBlock({ semanticScore: 0, taskMatchScore: 0 }))).toBe(0);
  });
});

describe('scoreTaskIntent', () => {
  it('gives inspect higher intent than overview', () => {
    expect(scoreTaskIntent(['inspect'])).toBeGreaterThan(scoreTaskIntent(['overview']));
  });

  it('returns a bounded score for mixed task labels', () => {
    const score = scoreTaskIntent(['overview', 'navigation', 'inspect']);
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(1);
  });
});

describe('scoreNetworkPressure', () => {
  it('is 0 when bandwidth equals ceiling', () => {
    const request = makeRequest([]);
    const req = { ...request, network: { ...request.network, bwEstimateMbps: DEFAULT_PROFILE.bandwidthCeilingMbps } };
    expect(scoreNetworkPressure(req, DEFAULT_PROFILE)).toBe(0);
  });

  it('is ~1 when bandwidth is near zero', () => {
    const req = makeRequest([]);
    const r = { ...req, network: { bwEstimateMbps: 0.01 } };
    expect(scoreNetworkPressure(r, DEFAULT_PROFILE)).toBeGreaterThan(0.9);
  });
});

describe('scoreSF / scoreEE / scoreFR', () => {
  const factors = { visibility: 0.8, semantic: 0.9, network: 0.3, latency: 0.2, bytes: 0.1, edgeHit: 0.6, fidelity: 0.5 };

  it('SF score is in [0,1]', () => {
    const s = scoreSF(factors, DEFAULT_PROFILE);
    expect(s).toBeGreaterThanOrEqual(0);
    expect(s).toBeLessThanOrEqual(1);
  });

  it('EE score is in [0,1]', () => {
    const s = scoreEE(factors, DEFAULT_PROFILE);
    expect(s).toBeGreaterThanOrEqual(0);
    expect(s).toBeLessThanOrEqual(1);
  });

  it('FR score is in [0,1]', () => {
    const s = scoreFR(factors, DEFAULT_PROFILE);
    expect(s).toBeGreaterThanOrEqual(0);
    expect(s).toBeLessThanOrEqual(1);
  });

  it('high semantic block favors SF over FR in default profile', () => {
    const highSem = { ...factors, semantic: 1.0, visibility: 1.0, fidelity: 0.0 };
    const sfScore = scoreSF(highSem, DEFAULT_PROFILE);
    const frScore = scoreFR(highSem, DEFAULT_PROFILE);
    expect(sfScore).toBeGreaterThan(frScore);
  });

  it('inspect task can influence scheduling factors through task intent', () => {
    const inspectBlocks = [
      makeBlock({ blockId: 'near', centerScore: 0.6, semanticScore: 0.8, taskMatchScore: 0.95 }),
      makeBlock({ blockId: 'far', centerScore: 0.3, semanticScore: 0.4, taskMatchScore: 0.2 })
    ];
    const decisions = rankVisibleBlocks({
      visibleBlocks: inspectBlocks,
      network: { bwEstimateMbps: 8, rttMs: 40 },
      device: { cpuLoad: 0.3, hotCacheBytes: 0 },
      taskLabels: ['inspect']
    });
    expect(decisions).toHaveLength(2);
    expect(decisions[0].priority).toBeGreaterThanOrEqual(decisions[1].priority);
  });
});

describe('layersForMode', () => {
  it('SF returns sem+coarse', () => expect(layersForMode('SF')).toEqual(['sem', 'coarse']));
  it('EE returns sem+coarse+residual', () => expect(layersForMode('EE')).toEqual(['sem', 'coarse', 'residual']));
  it('FR returns coarse+residual', () => expect(layersForMode('FR')).toEqual(['coarse', 'residual']));
  it('drops semantic layers when strategy disables semantic mode selection', () => {
    expect(layersForMode('SF', {
      semanticPriority: false,
      semanticModeSelection: false,
      useSPLQ: false,
      edgeReuse: false,
      cacheReuseWeight: 0,
      residualDelayMs: 0,
      maxConcurrentLoads: 2,
      priorityMode: 'lod'
    })).toEqual(['coarse', 'residual']);
  });
});

describe('cacheHintForMode', () => {
  it('SF promotes', () => expect(cacheHintForMode('SF')).toBe('promote'));
  it('EE retains', () => expect(cacheHintForMode('EE')).toBe('retain'));
  it('FR allows eviction', () => expect(cacheHintForMode('FR')).toBe('allow-evict'));
  it('allows eviction when edge reuse is disabled', () => {
    expect(cacheHintForMode('SF', {
      semanticPriority: true,
      semanticModeSelection: true,
      useSPLQ: true,
      edgeReuse: false,
      cacheReuseWeight: 0,
      residualDelayMs: 900,
      maxConcurrentLoads: 3,
      priorityMode: 'semantic'
    })).toBe('allow-evict');
  });
});

describe('buildScheduleDecision', () => {
  it('returns a ScheduleDecision with required fields', () => {
    const decision = buildScheduleDecision(makeBlock(), makeRequest([makeBlock()]));
    expect(decision.blockId).toBe('block_0001');
    expect(['SF', 'EE', 'FR']).toContain(decision.mode);
    expect(decision.priority).toBeGreaterThanOrEqual(0);
    expect(decision.priority).toBeLessThanOrEqual(1);
    expect(decision.layers.length).toBeGreaterThan(0);
    expect(decision.ttl).toBeGreaterThan(0);
    expect(decision.reason).toBeTruthy();
  });

  it('priority is clamped to [0,1]', () => {
    const decision = buildScheduleDecision(makeBlock({ centerScore: 2, semanticScore: 2 }), makeRequest([makeBlock()]));
    expect(decision.priority).toBeLessThanOrEqual(1);
  });

  it('honors MT-Web3DRC-like strategy without semantic priority or mode selection', () => {
    const request = {
      ...makeRequest([makeBlock()]),
      strategy: {
        semanticPriority: false,
        semanticModeSelection: false,
        useSPLQ: false,
        edgeReuse: true,
        cacheReuseWeight: 0.12,
        residualDelayMs: 350,
        maxConcurrentLoads: 3,
        priorityMode: 'lod' as const
      }
    };
    const decision = buildScheduleDecision(makeBlock(), request);
    expect(decision.layers).toEqual(['coarse', 'residual']);
    expect(['promote', 'retain', 'allow-evict']).toContain(decision.cacheHint);
  });
});

describe('rankVisibleBlocks', () => {
  it('returns one decision per block sorted by priority desc', () => {
    const blocks = [
      makeBlock({ blockId: 'b1', centerScore: 0.1, semanticScore: 0.1 }),
      makeBlock({ blockId: 'b2', centerScore: 0.9, semanticScore: 0.95 })
    ];
    const decisions = rankVisibleBlocks(makeRequest(blocks));
    expect(decisions).toHaveLength(2);
    expect(decisions[0].priority).toBeGreaterThanOrEqual(decisions[1].priority);
  });
});

describe('buildScheduleResponse', () => {
  it('includes generatedAt and items', () => {
    const resp = buildScheduleResponse(makeRequest([makeBlock()]));
    expect(resp.generatedAt).toBeTruthy();
    expect(resp.items).toHaveLength(1);
  });
});

describe('computeSemanticRankingMetrics', () => {
  it('returns Precision@K = 1 for a complete top-K hit', () => {
    const metrics = computeSemanticRankingMetrics(
      ['a', 'b', 'c'],
      [
        { blockId: 'a', semanticScore: 0.9, saliencyScore: 0.8, taskRelevance: 0.8 },
        { blockId: 'b', semanticScore: 0.8, saliencyScore: 0.8, taskRelevance: 0.7 },
        { blockId: 'c', semanticScore: 0.7, saliencyScore: 0.7, taskRelevance: 0.7 },
        { blockId: 'd', semanticScore: 0.1, saliencyScore: 0.1, taskRelevance: 0.1 }
      ],
      3
    );
    expect(metrics.semantic_precision_at_k).toBe(1);
    expect(metrics.top1_semantic_hit).toBe(1);
    expect(metrics.semantic_ndcg_at_k).toBeCloseTo(1, 5);
  });

  it('computes partial Precision@K correctly', () => {
    const metrics = computeSemanticRankingMetrics(
      ['a', 'b', 'x'],
      [
        { blockId: 'a', semanticScore: 0.9 },
        { blockId: 'b', semanticScore: 0.8 },
        { blockId: 'c', semanticScore: 0.7 },
        { blockId: 'x', semanticScore: 0.2 }
      ],
      3
    );
    expect(metrics.semantic_precision_at_k).toBeCloseTo(2 / 3, 5);
    expect(metrics.semantic_ndcg_at_k).toBeGreaterThan(0);
    expect(metrics.semantic_ndcg_at_k).toBeLessThan(1);
  });

  it('returns null metrics with a missing reason when semantic data is unavailable', () => {
    const metrics = computeSemanticRankingMetrics(['a', 'b'], [{ blockId: 'a' }, { blockId: 'b' }], 3);
    expect(metrics.semantic_precision_at_k).toBeNull();
    expect(metrics.semantic_ndcg_at_k).toBeNull();
    expect(metrics.top1_semantic_hit).toBeNull();
    expect(metrics.missing_reason).toContain('semantic');
  });
});
