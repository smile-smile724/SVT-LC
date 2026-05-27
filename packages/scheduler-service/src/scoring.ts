import type {
  DeliveryMode,
  LayerName,
  ScheduleDecision,
  ScheduleRequest,
  ScheduleResponse,
  SchedulingStrategy,
  VisibleBlockTelemetry
} from '@mtweb/shared-contracts';
import { DEFAULT_PROFILE, type ScheduleProfile } from './profile.js';

function clamp(value: number, min = 0, max = 1): number {
  return Math.min(max, Math.max(min, value));
}

function totalLayerBytes(block: VisibleBlockTelemetry): number {
  return Object.values(block.bytes).reduce<number>((sum, value) => sum + (value ?? 0), 0);
}

export function scoreVisibility(block: VisibleBlockTelemetry): number {
  return clamp(block.centerScore * 0.65 + block.visibleAreaScore * 0.35);
}

export function scoreSemantic(block: VisibleBlockTelemetry): number {
  return clamp(block.semanticScore * 0.55 + block.taskMatchScore * 0.45);
}

export function scoreTaskIntent(taskLabels: string[]): number {
  if (taskLabels.length === 0) return 0.5;
  let score = 0;
  for (const task of taskLabels) {
    const normalized = task.trim().toLowerCase();
    if (normalized === 'overview') score += 0.2;
    else if (normalized === 'inspect') score += 0.5;
    else if (normalized === 'navigation') score += 0.35;
    else score += 0.25;
  }
  return clamp(score / taskLabels.length);
}

export function scoreNetworkPressure(request: ScheduleRequest, profile: ScheduleProfile): number {
  return clamp(1 - request.network.bwEstimateMbps / profile.bandwidthCeilingMbps);
}

export function scoreLatencyPenalty(block: VisibleBlockTelemetry, profile: ScheduleProfile): number {
  return clamp(block.remoteLatencyMs / profile.latencyBudgetMs);
}

export function scoreBytePenalty(block: VisibleBlockTelemetry, profile: ScheduleProfile): number {
  return clamp(totalLayerBytes(block) / profile.byteBudget);
}

interface ModeFactors {
  visibility: number;
  semantic: number;
  taskIntent: number;
  network: number;
  latency: number;
  bytes: number;
  edgeHit: number;
  fidelity: number;
}

const DEFAULT_STRATEGY: SchedulingStrategy = {
  semanticPriority: true,
  semanticModeSelection: true,
  useSPLQ: true,
  edgeReuse: true,
  cacheReuseWeight: 0.3,
  residualDelayMs: 900,
  maxConcurrentLoads: 3,
  priorityMode: 'semantic'
};

function strategyForRequest(request: ScheduleRequest): SchedulingStrategy {
  return request.strategy ?? DEFAULT_STRATEGY;
}

function collectFactors(block: VisibleBlockTelemetry, request: ScheduleRequest, profile: ScheduleProfile): ModeFactors {
  return {
    visibility: scoreVisibility(block),
    semantic: scoreSemantic(block),
    taskIntent: scoreTaskIntent(request.taskLabels),
    network: scoreNetworkPressure(request, profile),
    latency: scoreLatencyPenalty(block, profile),
    bytes: scoreBytePenalty(block, profile),
    edgeHit: clamp(block.edgeHitRate),
    fidelity: clamp(block.fidelityGain)
  };
}

export function scoreSF(factors: ModeFactors, profile: ScheduleProfile): number {
  const taskIntent = clamp(factors.taskIntent ?? 0.5);
  const raw =
    factors.visibility * 0.25 +
    factors.semantic * 0.32 +
    taskIntent * 0.08 +
    factors.network * 0.2 +
    (1 - factors.bytes) * 0.15;
  return clamp(raw * profile.defaults.SF + (1 - profile.defaults.SF) * factors.semantic);
}

export function scoreEE(factors: ModeFactors, profile: ScheduleProfile): number {
  const taskIntent = clamp(factors.taskIntent ?? 0.5);
  const raw =
    factors.visibility * 0.3 +
    factors.semantic * 0.2 +
    taskIntent * 0.1 +
    factors.edgeHit * 0.25 +
    (1 - factors.latency) * 0.2;
  return clamp(raw * profile.defaults.EE + (1 - profile.defaults.EE) * factors.edgeHit);
}

export function scoreFR(factors: ModeFactors, profile: ScheduleProfile): number {
  const taskIntent = clamp(factors.taskIntent ?? 0.5);
  const raw =
    factors.visibility * 0.35 +
    taskIntent * 0.1 +
    factors.fidelity * 0.3 +
    (1 - factors.bytes) * 0.15 +
    (1 - factors.latency) * 0.2;
  return clamp(raw * profile.defaults.FR + (1 - profile.defaults.FR) * factors.fidelity);
}

function scoreModes(
  factors: ModeFactors,
  profile: ScheduleProfile,
  strategy: SchedulingStrategy
): Record<DeliveryMode, number> {
  const scores: Record<DeliveryMode, number> = {
    SF: scoreSF(factors, profile),
    EE: scoreEE(factors, profile),
    FR: scoreFR(factors, profile)
  };
  if (!strategy.semanticModeSelection) {
    scores.SF = 0;
  }
  if (!strategy.edgeReuse) {
    scores.EE = Math.max(0, scores.EE - factors.edgeHit * 0.2);
  } else {
    scores.EE = clamp(scores.EE + factors.edgeHit * strategy.cacheReuseWeight * 0.18);
  }
  if (strategy.priorityMode === 'lod') {
    scores.FR = clamp(scores.FR + 0.08);
  }
  return scores;
}

export function layersForMode(mode: DeliveryMode, strategy: SchedulingStrategy = DEFAULT_STRATEGY): LayerName[] {
  if (!strategy.semanticPriority && !strategy.semanticModeSelection) {
    return ['coarse', 'residual'];
  }
  switch (mode) {
    case 'SF':
      return ['sem', 'coarse'];
    case 'EE':
      return ['sem', 'coarse', 'residual'];
    case 'FR':
      return ['coarse', 'residual'];
  }
}

export function cacheHintForMode(
  mode: DeliveryMode,
  strategy: SchedulingStrategy = DEFAULT_STRATEGY
): ScheduleDecision['cacheHint'] {
  if (!strategy.edgeReuse) {
    return 'allow-evict';
  }
  switch (mode) {
    case 'SF':
      return 'promote';
    case 'EE':
      return 'retain';
    case 'FR':
      return 'allow-evict';
  }
}

function phaseForDecision(mode: DeliveryMode, factors: ModeFactors): string {
  if (mode === 'SF') {
    return factors.network > 0.75 ? 'first_screen_semantic_prefetch' : 'coarse_fast_path_semantic_prefetch';
  }
  if (mode === 'EE') {
    return factors.edgeHit > 0.35 ? 'edge_reuse_refine' : 'edge_enhanced_prefetch';
  }
  return 'residual_refine';
}

export function explainDecision(
  mode: DeliveryMode,
  scores: Record<DeliveryMode, number>,
  factors: ModeFactors
): string {
  const taskIntent = clamp(factors.taskIntent ?? 0.5);
  const ranked = Object.entries(scores).sort((a, b) => b[1] - a[1]) as Array<[DeliveryMode, number]>;
  const [topMode, topScore] = ranked[0];
  const [runnerMode, runnerScore] = ranked[1];
  const drivers = [
    `vis=${factors.visibility.toFixed(2)}`,
    `sem=${factors.semantic.toFixed(2)}`,
    `task=${taskIntent.toFixed(2)}`,
    `edge=${factors.edgeHit.toFixed(2)}`,
    `lat=${factors.latency.toFixed(2)}`,
    `bytes=${factors.bytes.toFixed(2)}`
  ].join(' ');
  return `${phaseForDecision(mode, factors)} | ${topMode}=${topScore.toFixed(2)} > ${runnerMode}=${runnerScore.toFixed(2)} | ${drivers} | chosen=${mode}`;
}

export function buildScheduleDecision(
  block: VisibleBlockTelemetry,
  request: ScheduleRequest,
  profile: ScheduleProfile = DEFAULT_PROFILE
): ScheduleDecision {
  const factors = collectFactors(block, request, profile);
  const strategy = strategyForRequest(request);
  const scores = scoreModes(factors, profile, strategy);
  const ranked = Object.entries(scores).sort((a, b) => b[1] - a[1]) as Array<[DeliveryMode, number]>;
  const [mode, topScore] = ranked[0];
  const taskIntent = clamp(factors.taskIntent ?? 0.5);
  const semanticComponent = strategy.semanticPriority ? factors.semantic * 0.13 : 0;
  const edgeComponent = strategy.edgeReuse ? factors.edgeHit * strategy.cacheReuseWeight * 0.08 : 0;

  return {
    blockId: block.blockId,
    mode,
    priority: clamp(topScore * 0.65 + factors.visibility * 0.12 + semanticComponent + taskIntent * 0.1 + edgeComponent),
    layers: layersForMode(mode, strategy),
    ttl: profile.ttlSeconds[mode],
    cacheHint: cacheHintForMode(mode, strategy),
    reason: explainDecision(mode, scores, factors)
  };
}

export function rankVisibleBlocks(
  request: ScheduleRequest,
  profile: ScheduleProfile = DEFAULT_PROFILE
): ScheduleDecision[] {
  return request.visibleBlocks
    .map((block) => buildScheduleDecision(block, request, profile))
    .sort((a, b) => b.priority - a.priority);
}

export interface SemanticRankingInput {
  blockId: string;
  semanticScore?: number | null;
  saliencyScore?: number | null;
  taskRelevance?: number | null;
}

export interface SemanticRankingMetrics {
  semantic_precision_at_k: number | null;
  semantic_ndcg_at_k: number | null;
  top1_semantic_hit: number | null;
  missing_reason?: string;
}

export function semanticRelevanceScore(block: SemanticRankingInput): number | null {
  const values = [
    { value: block.semanticScore, weight: 0.5 },
    { value: block.saliencyScore, weight: 0.25 },
    { value: block.taskRelevance, weight: 0.25 }
  ].filter((item): item is { value: number; weight: number } =>
    typeof item.value === 'number' && Number.isFinite(item.value)
  );

  if (values.length === 0) return null;
  const totalWeight = values.reduce((sum, item) => sum + item.weight, 0);
  return clamp(values.reduce((sum, item) => sum + clamp(item.value) * item.weight, 0) / totalWeight);
}

export function computeSemanticRankingMetrics(
  scheduledBlockIds: string[],
  blocks: SemanticRankingInput[],
  k = 3
): SemanticRankingMetrics {
  const normalizedK = Math.max(1, Math.floor(k));
  const relevance = new Map<string, number>();
  for (const block of blocks) {
    const score = semanticRelevanceScore(block);
    if (score !== null) {
      relevance.set(block.blockId, score);
    }
  }

  if (scheduledBlockIds.length === 0) {
    return {
      semantic_precision_at_k: null,
      semantic_ndcg_at_k: null,
      top1_semantic_hit: null,
      missing_reason: 'no scheduled blocks recorded'
    };
  }
  if (relevance.size === 0) {
    return {
      semantic_precision_at_k: null,
      semantic_ndcg_at_k: null,
      top1_semantic_hit: null,
      missing_reason: 'no semantic ranking data'
    };
  }

  const semanticRanking = [...relevance.entries()]
    .sort((a, b) => {
      if (b[1] !== a[1]) return b[1] - a[1];
      return a[0].localeCompare(b[0]);
    })
    .map(([blockId]) => blockId);
  const limit = Math.min(normalizedK, scheduledBlockIds.length, semanticRanking.length);
  const semanticTopK = new Set(semanticRanking.slice(0, limit));
  const scheduledTopK = scheduledBlockIds.slice(0, limit);
  const hits = scheduledTopK.filter((blockId) => semanticTopK.has(blockId)).length;
  const precision = limit > 0 ? hits / limit : null;

  const dcgFor = (ids: string[]) =>
    ids.slice(0, limit).reduce((sum, blockId, index) => {
      const rel = relevance.get(blockId) ?? 0;
      return sum + ((Math.pow(2, rel) - 1) / Math.log2(index + 2));
    }, 0);
  const idealDcg = dcgFor(semanticRanking);

  return {
    semantic_precision_at_k: precision,
    semantic_ndcg_at_k: idealDcg > 0 ? dcgFor(scheduledBlockIds) / idealDcg : null,
    top1_semantic_hit: scheduledBlockIds[0] === semanticRanking[0] ? 1 : 0
  };
}

export function buildScheduleResponse(
  request: ScheduleRequest,
  profile: ScheduleProfile = DEFAULT_PROFILE
): ScheduleResponse {
  return {
    generatedAt: new Date().toISOString(),
    items: rankVisibleBlocks(request, profile)
  };
}
