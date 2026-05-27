import * as THREE from 'three';
import type {
  ScheduleRequest,
  ScheduleResponse,
  SchedulingStrategy,
  VisibleBlockTelemetry
} from '@mtweb/shared-contracts';
import type { BlockRecord } from './blockLoader.js';

export interface TelemetryContext {
  cameraPos: THREE.Vector3;
  bandwidthMbps: number;
  rttMs: number;
  taskLabels: string[];
  hotCacheBytes: number;
  method?: string;
  sceneId?: string;
  strategy?: SchedulingStrategy;
}

export function buildVisibleBlockTelemetry(records: BlockRecord[], context: TelemetryContext): VisibleBlockTelemetry[] {
  const distances = records.map((r) => context.cameraPos.distanceTo(r.center));
  const maxDistance = Math.max(1, ...distances);

  return records.map((record, index) => {
    const proximity = 1 - distances[index] / (maxDistance * 1.05);
    const semanticScore = context.strategy?.semanticPriority === false ? 0 : record.semantic?.semanticScore ?? 0.4;
    const semanticBytes = record.semanticBytes ?? estimateSemanticBytes(record);
    const taskMatchScore = context.strategy?.semanticPriority === false
      ? 0
      : computeTaskMatchScore(record, context.taskLabels, clamp(proximity), clamp(semanticScore));
    const readyRatio = layersReadyRatio(record);
    const edgeHitRate = context.strategy?.edgeReuse === false ? 0 : readyRatio;
    return {
      blockId: record.block.blockId,
      centerScore: clamp(proximity),
      visibleAreaScore: clamp(proximity * 0.9),
      semanticScore: clamp(semanticScore),
      taskMatchScore,
      edgeHitRate,
      fidelityGain: record.state.coarse === 'ready' ? 0.4 : 0.7,
      remoteLatencyMs: 80 + distances[index] * 8,
      bytes: {
        sem: semanticBytes,
        coarse: record.block.bytes?.coarse ?? 0,
        residual: record.block.bytes?.residual ?? 0
      },
      layerReady: {
        sem: record.state.sem === 'ready',
        coarse: record.state.coarse === 'ready',
        residual: record.state.residual === 'ready'
      }
    };
  });
}

export function buildScheduleRequest(records: BlockRecord[], context: TelemetryContext): ScheduleRequest {
  return {
    visibleBlocks: buildVisibleBlockTelemetry(records, context),
    sceneId: context.sceneId,
    method: context.method,
    strategy: context.strategy,
    network: {
      bwEstimateMbps: context.bandwidthMbps,
      rttMs: context.rttMs
    },
    device: {
      cpuLoad: 0.4,
      hotCacheBytes: context.hotCacheBytes
    },
    taskLabels: context.taskLabels
  };
}

export async function requestSchedule(
  schedulerUrl: string,
  request: ScheduleRequest,
  signal?: AbortSignal
): Promise<ScheduleResponse> {
  const response = await fetch(`${schedulerUrl}/schedule`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(request),
    signal
  });
  if (!response.ok) throw new Error(`scheduler ${response.status}`);
  return (await response.json()) as ScheduleResponse;
}

function clamp(value: number, min = 0, max = 1): number {
  return Math.min(max, Math.max(min, value));
}

function layersReadyRatio(record: BlockRecord): number {
  let ready = 0;
  if (record.state.sem === 'ready') ready += 1;
  if (record.state.coarse === 'ready') ready += 1;
  if (record.state.residual === 'ready') ready += 1;
  return ready / 3;
}

function estimateSemanticBytes(record: BlockRecord): number {
  if (!record.semantic) return 512;
  const sem = record.semantic;
  return 512 + sem.labels.length * 96 + sem.saliency.length * 64 + sem.thumbs.length * 160;
}

function computeTaskMatchScore(
  record: BlockRecord,
  taskLabels: string[],
  proximity: number,
  semanticScore: number
): number {
  if (taskLabels.length === 0) {
    return clamp(semanticScore * 0.8 + proximity * 0.2);
  }

  const scores = taskLabels.map((task) => scoreTaskLabel(record, task, proximity, semanticScore));
  return clamp(scores.reduce((sum, value) => sum + value, 0) / scores.length);
}

function scoreTaskLabel(record: BlockRecord, taskLabel: string, proximity: number, semanticScore: number): number {
  const task = taskLabel.trim().toLowerCase();
  const labels = record.semantic?.labels ?? [];
  const saliency = record.semantic?.saliency ?? [];
  const hasTaskLabelMatch = labels.some((label) => label.name.toLowerCase().includes(task));
  const labelConfidence = labels.length > 0
    ? labels.reduce((sum, label) => sum + clamp(label.score), 0) / labels.length
    : semanticScore;
  const saliencyScore = saliency.length > 0
    ? saliency.reduce((sum, region) => sum + clamp(region.score), 0) / saliency.length
    : semanticScore * 0.5;
  const edgeNeed = layersReadyRatio(record);
  const coarseNeed = record.state.coarse === 'ready' ? 0.2 : 0.8;

  switch (task) {
    case 'overview':
      return 0.5 * proximity + 0.2 * semanticScore + 0.2 * labelConfidence + 0.1 * (1 - edgeNeed);
    case 'inspect':
      return 0.45 * saliencyScore + 0.25 * labelConfidence + 0.2 * semanticScore + 0.1 * coarseNeed;
    case 'navigation':
      return 0.45 * proximity + 0.25 * (1 - edgeNeed) + 0.15 * semanticScore + 0.15 * coarseNeed;
    default:
      return hasTaskLabelMatch
        ? 0.4 * labelConfidence + 0.35 * semanticScore + 0.25 * proximity
        : 0.3 * semanticScore + 0.3 * proximity + 0.2 * labelConfidence + 0.2 * saliencyScore;
  }
}
