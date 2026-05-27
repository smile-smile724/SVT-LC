import type { DeliveryMode, LayerName, ScheduleResponse, SchedulingStrategy } from '@mtweb/shared-contracts';

export interface LayerEvent {
  blockId: string;
  layer: LayerName;
  /** ms since performance.timeOrigin */
  startedAt: number;
  completedAt: number;
  bytes: number;
  mode: DeliveryMode | 'local';
}

export interface ViewCycle {
  /** camera orbit angle (radians) at the time of the snapshot */
  orbitAngle: number;
  snapshotAt: number;
  totalBytesLoaded: number;
}

export interface RuntimeMetrics {
  bootstrapAt: number;
  firstSemReadyAt?: number;
  semanticCompletedAt?: number;
  firstCoarseReadyAt?: number;
  /** FSV = First Semantic View — timestamp when first sem layer completes */
  fsvAt?: number;
  firstBlockReadyAt?: number;
  fullFidelityCompletedAt?: number;
  expectedResidualTargets: number;
  expectedSemanticTargets: number;
  bytesByLayer: Record<LayerName, number>;
  loadCountByLayer: Record<LayerName, number>;
  modeDistribution: Record<DeliveryMode, number>;
  scheduleRoundtrips: number;
  scheduleFailures: number;
  /** Fine-grained per-block per-layer events for timeline diagrams */
  layerEvents: LayerEvent[];
  /** Bytes/View snapshots — one per camera cycle */
  viewCycles: ViewCycle[];
  /** Running count of bytes at the start of each view cycle */
  _bytesAtCycleStart: number;

  /** Rotation test metrics */
  rotationTriggeredAt?: number;
  rotationCompletedAt?: number;
  rotationRecoveredAt?: number;
  rotationStallMs: number; // 累积的旋转卡顿时间

  // Render and FPS metrics
  frameCount: number;
  lastFrameTimeMs: number;
  fpsSamples: number[];
  cpuFrameTimeMsSamples: number[];
  gpuFrameTimeMsSamples: number[];
  drawCallsSamples: number[];
  trianglesSamples: number[];
  meshObjectSamples: number[];
  renderInstanceSamples: number[];

  /** Samples of semantic-layer bytes saved versus full block bytes. */
  bandwidthSavingSamples: number[];
  semanticFidelitySamples: number[];
  semanticPriorityHitSamples: number[];
  semanticRankingSamples: SemanticRankingSample[];
  semanticGuidedCoarseCandidates: Set<string>;
  semanticGuidedReadyAt?: number;
}

export interface StatisticsContext {
  method?: string;
  useSemantic?: boolean;
  strategy?: SchedulingStrategy;
}

export interface SemanticRankingSample {
  scheduledTopK: string[];
  semanticTopK: string[];
  relevanceByBlockId: Record<string, number>;
  k: number;
}

export function createMetrics(): RuntimeMetrics {
  return {
    bootstrapAt: performance.now(),
    bytesByLayer: { sem: 0, coarse: 0, residual: 0 },
    expectedResidualTargets: 0,
    expectedSemanticTargets: 0,
    loadCountByLayer: { sem: 0, coarse: 0, residual: 0 },
    modeDistribution: { SF: 0, EE: 0, FR: 0 },
    scheduleRoundtrips: 0,
    scheduleFailures: 0,
    layerEvents: [],
    viewCycles: [],
    _bytesAtCycleStart: 0,
    bandwidthSavingSamples: [],
    rotationStallMs: 0,
    frameCount: 0,
    lastFrameTimeMs: performance.now(),
    fpsSamples: [],
    cpuFrameTimeMsSamples: [],
    gpuFrameTimeMsSamples: [],
    drawCallsSamples: [],
    trianglesSamples: [],
    meshObjectSamples: [],
    renderInstanceSamples: [],
    semanticFidelitySamples: [],
    semanticPriorityHitSamples: [],
    semanticRankingSamples: [],
    semanticGuidedCoarseCandidates: new Set()
  };
}

export function setExpectedSemanticTargets(metrics: RuntimeMetrics, count: number): void {
  metrics.expectedSemanticTargets = Math.max(0, count);
  if (metrics.expectedSemanticTargets === 0) {
    metrics.semanticCompletedAt = performance.now();
  }
}

export function setExpectedResidualTargets(metrics: RuntimeMetrics, count: number): void {
  metrics.expectedResidualTargets = Math.max(0, count);
  if (metrics.expectedResidualTargets === 0) {
    metrics.fullFidelityCompletedAt = performance.now();
  }
}

export function recordLayerStart(): number {
  return performance.now();
}

export function recordLayerReady(
  metrics: RuntimeMetrics,
  layer: LayerName,
  bytes: number,
  blockId = '',
  startedAt = performance.now(),
  mode: DeliveryMode | 'local' = 'local'
): void {
  const completedAt = performance.now();
  metrics.bytesByLayer[layer] += bytes;
  metrics.loadCountByLayer[layer] += 1;

  if (layer === 'sem' && metrics.firstSemReadyAt === undefined) {
    metrics.firstSemReadyAt = completedAt;
    metrics.fsvAt = completedAt;
  }
  if (
    layer === 'sem' &&
    metrics.expectedSemanticTargets > 0 &&
    metrics.loadCountByLayer.sem >= metrics.expectedSemanticTargets &&
    metrics.semanticCompletedAt === undefined
  ) {
    metrics.semanticCompletedAt = completedAt;
  }
  if (layer === 'coarse' && metrics.firstCoarseReadyAt === undefined) {
    metrics.firstCoarseReadyAt = completedAt;
  }
  if (
    layer === 'coarse' &&
    blockId &&
    metrics.semanticGuidedReadyAt === undefined &&
    metrics.firstSemReadyAt !== undefined &&
    metrics.semanticGuidedCoarseCandidates.has(blockId)
  ) {
    metrics.semanticGuidedReadyAt = completedAt;
  }
  if (
    layer === 'residual' &&
    metrics.expectedResidualTargets > 0 &&
    metrics.loadCountByLayer.residual >= metrics.expectedResidualTargets &&
    metrics.fullFidelityCompletedAt === undefined
  ) {
    metrics.fullFidelityCompletedAt = completedAt;
  }
  if (metrics.firstBlockReadyAt === undefined) {
    metrics.firstBlockReadyAt = completedAt;
  }

  if (blockId) {
    metrics.layerEvents.push({ blockId, layer, startedAt, completedAt, bytes, mode });
  }
}

export function recordViewCycle(metrics: RuntimeMetrics, orbitAngle: number): void {
  const snapshotAt = performance.now();
  const current = totalBytes(metrics);
  metrics.viewCycles.push({
    orbitAngle,
    snapshotAt,
    totalBytesLoaded: current - metrics._bytesAtCycleStart
  });
  metrics._bytesAtCycleStart = current;
}

export function recordSchedule(metrics: RuntimeMetrics, response: ScheduleResponse): void {
  metrics.scheduleRoundtrips += 1;
  for (const item of response.items) {
    metrics.modeDistribution[item.mode] += 1;
  }
}

export function recordScheduleFailure(metrics: RuntimeMetrics): void {
  metrics.scheduleFailures += 1;
}

export function recordBandwidthSaving(
  metrics: RuntimeMetrics,
  semanticLayeredBytes: number,
  fullBlockBytes: number
): void {
  if (!Number.isFinite(semanticLayeredBytes) || !Number.isFinite(fullBlockBytes) || fullBlockBytes <= 0) {
    return;
  }

  const saving = 1 - (semanticLayeredBytes / fullBlockBytes);
  if (Number.isFinite(saving)) {
    metrics.bandwidthSavingSamples.push(Math.min(1, Math.max(0, saving)));
  }
}

export function recordSemanticFidelity(metrics: RuntimeMetrics, fidelity: number): void {
  if (!Number.isFinite(fidelity)) {
    return;
  }
  metrics.semanticFidelitySamples.push(Math.min(1, Math.max(0, fidelity)));
}

export function recordSemanticPriorityHit(metrics: RuntimeMetrics, hit: boolean): void {
  metrics.semanticPriorityHitSamples.push(hit ? 1 : 0);
}

export function markSemanticGuidedCoarseCandidate(metrics: RuntimeMetrics, blockId: string): void {
  if (blockId) {
    metrics.semanticGuidedCoarseCandidates.add(blockId);
  }
}

export function recordSemanticRankingSample(metrics: RuntimeMetrics, sample: SemanticRankingSample): void {
  if (sample.k <= 0 || sample.scheduledTopK.length === 0 || sample.semanticTopK.length === 0) {
    return;
  }
  metrics.semanticRankingSamples.push(sample);
}

export function recordRotationStart(metrics: RuntimeMetrics): void {
  if (metrics.rotationTriggeredAt === undefined) {
    metrics.rotationTriggeredAt = performance.now();
  }
}

export function recordRotationComplete(metrics: RuntimeMetrics): void {
  metrics.rotationCompletedAt = performance.now();
}

export function recordRotationRecovered(metrics: RuntimeMetrics): void {
  metrics.rotationRecoveredAt = performance.now();
}

export function rotationDelayMs(metrics: RuntimeMetrics): number | undefined {
  if (metrics.rotationTriggeredAt === undefined || metrics.rotationCompletedAt === undefined) {
    return undefined;
  }
  // 直接返回累积的超出16.7ms的部分，而不是简单的结束时间减去触发时间
  return metrics.rotationStallMs;
}

export function rotationRecoveryMs(metrics: RuntimeMetrics): number | undefined {
  if (metrics.rotationTriggeredAt === undefined || metrics.rotationRecoveredAt === undefined) {
    return undefined;
  }
  return metrics.rotationRecoveredAt - metrics.rotationTriggeredAt;
}

export interface RenderFrameObservation {
  cpuFrameTimeMs?: number | null;
  gpuFrameTimeMs?: number | null;
  drawCalls?: number | null;
  triangles?: number | null;
  meshObjects?: number | null;
  renderInstances?: number | null;
}

function pushFiniteSample(samples: number[], value: number | null | undefined): void {
  if (typeof value === 'number' && Number.isFinite(value)) {
    samples.push(value);
  }
}

export function recordRenderFrame(
  metrics: RuntimeMetrics,
  isRotating: boolean,
  observation: RenderFrameObservation = {}
): void {
  const now = performance.now();
  const dt = now - metrics.lastFrameTimeMs;
  metrics.lastFrameTimeMs = now;

  if (dt > 0) {
    const currentFPS = 1000 / dt;
    metrics.fpsSamples.push(currentFPS);
  }
  pushFiniteSample(metrics.cpuFrameTimeMsSamples, observation.cpuFrameTimeMs);
  pushFiniteSample(metrics.gpuFrameTimeMsSamples, observation.gpuFrameTimeMs);
  pushFiniteSample(metrics.drawCallsSamples, observation.drawCalls);
  pushFiniteSample(metrics.trianglesSamples, observation.triangles);
  pushFiniteSample(metrics.meshObjectSamples, observation.meshObjects);
  pushFiniteSample(metrics.renderInstanceSamples, observation.renderInstances);

  // 累加卡顿时间 (Long task / Frame spike limit, > 16.7ms)
  if (isRotating && metrics.rotationTriggeredAt && dt > 16.7) {
    // 将多出的时间视为卡顿
    metrics.rotationStallMs += (dt - 16.7);
  }
}

export function fsvMs(metrics: RuntimeMetrics): number | undefined {
  return metrics.fsvAt === undefined ? undefined : metrics.fsvAt - metrics.bootstrapAt;
}

export function semanticCompletionMs(metrics: RuntimeMetrics): number | undefined {
  return metrics.semanticCompletedAt === undefined ? undefined : metrics.semanticCompletedAt - metrics.bootstrapAt;
}

export function ttfbMs(metrics: RuntimeMetrics): number | undefined {
  return metrics.firstBlockReadyAt === undefined
    ? undefined
    : metrics.firstBlockReadyAt - metrics.bootstrapAt;
}

export function firstCoarseMs(metrics: RuntimeMetrics): number | undefined {
  return metrics.firstCoarseReadyAt === undefined ? undefined : metrics.firstCoarseReadyAt - metrics.bootstrapAt;
}

export function semanticGuidedReadyMs(metrics: RuntimeMetrics): number | undefined {
  return metrics.semanticGuidedReadyAt === undefined ? undefined : metrics.semanticGuidedReadyAt - metrics.bootstrapAt;
}

export function fullFidelityMs(metrics: RuntimeMetrics): number | undefined {
  return metrics.fullFidelityCompletedAt === undefined ? undefined : metrics.fullFidelityCompletedAt - metrics.bootstrapAt;
}

export function totalBytes(metrics: RuntimeMetrics): number {
  return metrics.bytesByLayer.sem + metrics.bytesByLayer.coarse + metrics.bytesByLayer.residual;
}

export function totalLoadCount(metrics: RuntimeMetrics): number {
  return metrics.loadCountByLayer.sem + metrics.loadCountByLayer.coarse + metrics.loadCountByLayer.residual;
}

function meanOrNull(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function sampleStat(values: number[], missingReason: string): any {
  if (values.length === 0) {
    return { mean: null, std: null, p95: null, missing_reason: missingReason };
  }
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const variance = values.length > 1
    ? values.reduce((sum, value) => sum + Math.pow(value - mean, 2), 0) / (values.length - 1)
    : 0;
  const sorted = [...values].sort((a, b) => a - b);
  const p95Index = Math.min(sorted.length - 1, Math.max(0, Math.round(0.95 * (sorted.length - 1))));
  return {
    mean,
    std: Math.sqrt(variance),
    p95: sorted[p95Index]
  };
}

function derivedBandwidthSaving(metrics: RuntimeMetrics): number | null {
  const semanticBytes = metrics.bytesByLayer.sem;
  const baselineBytes = metrics.bytesByLayer.coarse + metrics.bytesByLayer.residual;

  if (semanticBytes > 0 && baselineBytes > 0) {
    return Math.min(1, Math.max(0, 1 - semanticBytes / baselineBytes));
  }

  return meanOrNull(metrics.bandwidthSavingSamples);
}

function derivedSemanticFidelity(metrics: RuntimeMetrics): number | null {
  return meanOrNull(metrics.semanticFidelitySamples);
}

function derivedPriorityHitRate(metrics: RuntimeMetrics): number | null {
  return meanOrNull(metrics.semanticPriorityHitSamples);
}

function precisionAtK(sample: SemanticRankingSample): number | null {
  const k = Math.min(sample.k, sample.scheduledTopK.length, sample.semanticTopK.length);
  if (k <= 0) return null;
  const groundTruth = new Set(sample.semanticTopK.slice(0, k));
  const hits = sample.scheduledTopK.slice(0, k).filter((blockId) => groundTruth.has(blockId)).length;
  return hits / k;
}

function dcg(blockIds: string[], relevanceByBlockId: Record<string, number>, k: number): number {
  return blockIds.slice(0, k).reduce((sum, blockId, index) => {
    const relevance = Math.max(0, relevanceByBlockId[blockId] ?? 0);
    return sum + ((Math.pow(2, relevance) - 1) / Math.log2(index + 2));
  }, 0);
}

function ndcgAtK(sample: SemanticRankingSample): number | null {
  const k = Math.min(sample.k, sample.scheduledTopK.length, sample.semanticTopK.length);
  if (k <= 0) return null;
  const ideal = dcg(sample.semanticTopK, sample.relevanceByBlockId, k);
  if (ideal <= 0) return null;
  return dcg(sample.scheduledTopK, sample.relevanceByBlockId, k) / ideal;
}

function top1SemanticHit(sample: SemanticRankingSample): number | null {
  if (sample.scheduledTopK.length === 0 || sample.semanticTopK.length === 0) return null;
  return sample.scheduledTopK[0] === sample.semanticTopK[0] ? 1 : 0;
}

function derivedRankingMetric(
  metrics: RuntimeMetrics,
  compute: (sample: SemanticRankingSample) => number | null
): number | null {
  const values = metrics.semanticRankingSamples
    .map(compute)
    .filter((value): value is number => value !== null && Number.isFinite(value));
  return meanOrNull(values);
}

function derivedSemanticBytesRatio(metrics: RuntimeMetrics): number | null {
  const total = totalBytes(metrics);
  if (total <= 0) return null;
  return metrics.bytesByLayer.sem / total;
}

// ---------------------------------------------------------------------------
// CSV export
// ---------------------------------------------------------------------------

export function exportLayerEventsCsv(metrics: RuntimeMetrics): string {
  const origin = metrics.bootstrapAt;
  const header = 'blockId,layer,startedAt_ms,completedAt_ms,durationMs,bytes,mode';
  const rows = metrics.layerEvents.map((ev) => {
    const start = (ev.startedAt - origin).toFixed(1);
    const end = (ev.completedAt - origin).toFixed(1);
    const dur = (ev.completedAt - ev.startedAt).toFixed(1);
    return `${ev.blockId},${ev.layer},${start},${end},${dur},${ev.bytes},${ev.mode}`;
  });
  return [header, ...rows].join('\n');
}

export function exportViewCyclesCsv(metrics: RuntimeMetrics): string {
  const origin = metrics.bootstrapAt;
  const header = 'cycleIndex,orbitAngleDeg,snapshotAt_ms,bytesThisCycle';
  const rows = metrics.viewCycles.map((vc, i) => {
    const t = (vc.snapshotAt - origin).toFixed(1);
    const deg = ((vc.orbitAngle * 180) / Math.PI).toFixed(1);
    return `${i},${deg},${t},${vc.totalBytesLoaded}`;
  });
  return [header, ...rows].join('\n');
}

export function exportSummaryCsv(metrics: RuntimeMetrics): string {
  const fsv = fsvMs(metrics);
  const semanticCompletion = semanticCompletionMs(metrics);
  const ttfb = ttfbMs(metrics);
  const dist = metrics.modeDistribution;
  const total = dist.SF + dist.EE + dist.FR || 1;
  const bandwidthSavingMean = derivedBandwidthSaving(metrics);
  const semanticFidelityMean = derivedSemanticFidelity(metrics);
  const priorityHitRateMean = derivedPriorityHitRate(metrics);
  const semanticBytesRatioMean = derivedSemanticBytesRatio(metrics);
  const lines = [
    'metric,value',
    `bootstrapAt_epoch_ms,${(performance.timeOrigin + metrics.bootstrapAt).toFixed(0)}`,
    `fsv_ms,${fsv === undefined ? '' : fsv.toFixed(1)}`,
    `semantic_completion_ms,${semanticCompletion === undefined ? '' : semanticCompletion.toFixed(1)}`,
    `ttfb_ms,${ttfb === undefined ? '' : ttfb.toFixed(1)}`,
    `first_coarse_ms,${firstCoarseMs(metrics) === undefined ? '' : firstCoarseMs(metrics)!.toFixed(1)}`,
    `full_fidelity_ms,${fullFidelityMs(metrics) === undefined ? '' : fullFidelityMs(metrics)!.toFixed(1)}`,
    `sem_bytes,${metrics.bytesByLayer.sem}`,
    `coarse_bytes,${metrics.bytesByLayer.coarse}`,
    `residual_bytes,${metrics.bytesByLayer.residual}`,
    `total_bytes,${totalBytes(metrics)}`,
    `sem_loads,${metrics.loadCountByLayer.sem}`,
    `coarse_loads,${metrics.loadCountByLayer.coarse}`,
    `residual_loads,${metrics.loadCountByLayer.residual}`,
    `mode_SF,${dist.SF}`,
    `mode_EE,${dist.EE}`,
    `mode_FR,${dist.FR}`,
    `mode_SF_pct,${((dist.SF / total) * 100).toFixed(1)}`,
    `mode_EE_pct,${((dist.EE / total) * 100).toFixed(1)}`,
    `mode_FR_pct,${((dist.FR / total) * 100).toFixed(1)}`,
    `schedule_roundtrips,${metrics.scheduleRoundtrips}`,
    `schedule_failures,${metrics.scheduleFailures}`,
    `view_cycles,${metrics.viewCycles.length}`,
    `semantic_fidelity,${semanticFidelityMean === null ? '' : semanticFidelityMean.toFixed(3)}`,
    `priority_hit_rate,${priorityHitRateMean === null ? '' : priorityHitRateMean.toFixed(3)}`,
    `semantic_precision_at_k,${derivedRankingMetric(metrics, precisionAtK)?.toFixed(3) ?? ''}`,
    `semantic_ndcg_at_k,${derivedRankingMetric(metrics, ndcgAtK)?.toFixed(3) ?? ''}`,
    `top1_semantic_hit,${derivedRankingMetric(metrics, top1SemanticHit)?.toFixed(3) ?? ''}`,
    `semantic_bytes_ratio,${semanticBytesRatioMean === null ? '' : semanticBytesRatioMean.toFixed(3)}`,
    `semantic_layer_saving_pct,${bandwidthSavingMean === null ? '' : (bandwidthSavingMean * 100).toFixed(1)}`
  ];
  return lines.join('\n');
}

export function triggerCsvDownload(filename: string, csv: string): void {
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

function getActualBytesFromPerformance(
  cutoffAt?: number
): { sem: number; coarse: number; residual: number; total: number } {
  const entries = performance.getEntriesByType('resource') as PerformanceResourceTiming[];
  const stats = { sem: 0, coarse: 0, residual: 0, total: 0 };

  for (const entry of entries) {
    if (cutoffAt !== undefined && entry.responseEnd > cutoffAt) {
      continue;
    }

    // We prefer transferSize for "actual transmitted bytes"
    // If it's 0 (e.g. CORS without Timing-Allow-Origin or cache hit), we fall back to body sizes
    const size = entry.transferSize > 0 ? entry.transferSize : (entry.encodedBodySize || entry.decodedBodySize || 0);

    const url = entry.name;

    // 过滤掉 Vite Dev Server 加载的未压缩的 Three.js 和业务代码 bundle
    if (!url.includes('/scenes/')) {
      continue;
    }

    // Basic heuristic based on standard project structure
    if (url.includes('/sem/') || url.includes('/manifest/') || url.endsWith('.json')) {
      stats.sem += size;
    } else if (url.includes('/coarse/')) {
      stats.coarse += size;
    } else if (url.includes('/residual/')) {
      stats.residual += size;
    } else {
      // Anything else (textures, scripts, etc.) we'll attribute to residual or just total
      stats.residual += size;
    }
    stats.total += size;
  }
  return stats;
}

export function getStatistics(metrics: RuntimeMetrics, context: StatisticsContext = {}): any {
  const fsv = fsvMs(metrics);
  const semanticCompletion = semanticCompletionMs(metrics);
  const ttfb = ttfbMs(metrics);
  const firstCoarse = firstCoarseMs(metrics);
  const semanticGuidedReady = semanticGuidedReadyMs(metrics);
  const fullFidelity = fullFidelityMs(metrics);

  const stat = (value: number | null | undefined, missingReason: string) => {
    if (value === undefined || value === null || !Number.isFinite(value)) {
      return { mean: null, std: null, p95: null, missing_reason: missingReason };
    }
    return { mean: value, std: 0, p95: value };
  };

  const interactionLatencyVal = firstCoarse !== undefined ? firstCoarse / 1000 : null;
  let semanticFirstLatencyVal = fsv !== undefined ? fsv / 1000 : null;

  if (!context.useSemantic) {
    semanticFirstLatencyVal = interactionLatencyVal;
  }

  const rotationDelay = rotationDelayMs(metrics);
  const rotationDelayVal = rotationDelay !== undefined ? rotationDelay / 1000 : null;
  const rotationRecovery = rotationRecoveryMs(metrics);
  const rotationRecoveryVal = rotationRecovery !== undefined ? rotationRecovery / 1000 : null;

  // For semantic methods, only count resources that completed before the first semantic view was ready.
  // This keeps the first-screen bandwidth window from being polluted by later coarse/residual loads.
  const transferCutoffAt = context.useSemantic && metrics.firstSemReadyAt !== undefined ? metrics.firstSemReadyAt : undefined;
  const firstScreenBytes = getActualBytesFromPerformance(transferCutoffAt);
  const fullSessionBytes = getActualBytesFromPerformance();

  // For bandwidth saving, we still use the samples recorded during the run 
  // which compare actual sem bytes vs manifest baseline, as we don't have
  // the actual baseline bytes in the same session if we didn't download them.
  const bandwidthSavingVal = derivedBandwidthSaving(metrics);
  const semanticFidelityVal = derivedSemanticFidelity(metrics);
  const priorityHitRateVal = derivedPriorityHitRate(metrics);
  const semanticPrecisionAtKVal = derivedRankingMetric(metrics, precisionAtK);
  const semanticNdcgAtKVal = derivedRankingMetric(metrics, ndcgAtK);
  const top1SemanticHitVal = derivedRankingMetric(metrics, top1SemanticHit);
  const semanticBytesRatioVal = derivedSemanticBytesRatio(metrics);
  const residualCompletionDelay =
    fullFidelity !== undefined && (context.useSemantic ? fsv !== undefined : ttfb !== undefined)
      ? (fullFidelity - (context.useSemantic ? fsv! : ttfb!)) / 1000
      : null;

  return {
    interactionLatency: stat(interactionLatencyVal, 'no block layer completed'),
    firstCoarseGeometryLatency: stat(firstCoarse !== undefined ? firstCoarse / 1000 : null, 'no coarse layer completed'),
    fullFidelityCompletionTime: stat(fullFidelity !== undefined ? fullFidelity / 1000 : null, 'not all residual targets completed'),
    firstFrameLatency: stat(semanticFirstLatencyVal, 'no first semantic or visible block signal'),
    stableFPS: sampleStat(metrics.fpsSamples, 'no render frame samples recorded'),
    cpuFrameTimeMs: sampleStat(metrics.cpuFrameTimeMsSamples, 'no CPU frame time samples recorded'),
    gpuFrameTimeMs: sampleStat(metrics.gpuFrameTimeMsSamples, 'GPU timer query unavailable or no GPU samples recorded'),
    drawCalls: sampleStat(metrics.drawCallsSamples, 'no renderer draw call samples recorded'),
    triangles: sampleStat(metrics.trianglesSamples, 'no renderer triangle samples recorded'),
    meshObjects: sampleStat(metrics.meshObjectSamples, 'no mesh object samples recorded'),
    renderInstances: sampleStat(metrics.renderInstanceSamples, 'no render instance samples recorded'),
    cacheHitRatio: stat(null, 'cache hit ratio is not collected by the browser runtime'),
    rotationDelay: stat(rotationDelayVal, 'rotation trial was not triggered or did not complete'),
    rotationStallTime: stat(rotationDelayVal, 'rotation trial was not triggered or did not complete'),
    rotationRecoveryTime: stat(rotationRecoveryVal, 'rotation trial was not triggered or did not recover'),
    semanticFirstLatency: stat(semanticFirstLatencyVal, 'no semantic layer completed'),
    firstSemanticMetadataLatency: stat(semanticFirstLatencyVal, 'no semantic layer completed'),
    semanticGuidedReadyLatency: stat(
      semanticGuidedReady !== undefined ? semanticGuidedReady / 1000 : null,
      'no semantic-guided coarse layer completed'
    ),
    semanticCompletionTime: stat(
      semanticCompletion !== undefined ? semanticCompletion / 1000 : null,
      'not all semantic targets completed'
    ),
    semanticFidelity: stat(semanticFidelityVal, 'no semantic fidelity samples recorded'),
    semanticQualityScore: stat(semanticFidelityVal, 'no semantic quality samples recorded'),
    priorityHitRate: stat(priorityHitRateVal, 'no semantic priority hit samples recorded'),
    semanticPrecisionAtK: stat(semanticPrecisionAtKVal, 'no semantic ranking samples recorded'),
    semanticNdcgAtK: stat(semanticNdcgAtKVal, 'no semantic ranking samples recorded'),
    top1SemanticHit: stat(top1SemanticHitVal, 'no semantic ranking samples recorded'),
    semanticBytesRatio: stat(semanticBytesRatioVal, 'no scene transfer bytes recorded'),
    residualCompletionDelay: stat(residualCompletionDelay, 'full fidelity or first usable state was not observed'),
    bandwidthSaving: stat(bandwidthSavingVal, 'no bandwidth saving samples recorded'),
    semanticLayerSaving: stat(bandwidthSavingVal, 'no semantic-layer saving samples recorded'),
    bandwidthTransferBytes: {
      sem: firstScreenBytes.sem,
      coarse: firstScreenBytes.coarse,
      residual: firstScreenBytes.residual,
      total: firstScreenBytes.total
    },
    firstScreenTransferBytes: firstScreenBytes,
    fullSessionTransferBytes: fullSessionBytes
  };
}
