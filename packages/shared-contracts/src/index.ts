export type LayerName = 'sem' | 'coarse' | 'residual';
export type DeliveryMode = 'SF' | 'EE' | 'FR';
export type PartitionMode = 'aabb-grid' | 'octree';
export type Vec3 = [number, number, number];
export type AABB = [number, number, number, number, number, number];
export type Box2D = [number, number, number, number];

export interface SchedulingStrategy {
  semanticPriority: boolean;
  semanticModeSelection: boolean;
  useSPLQ: boolean;
  edgeReuse: boolean;
  cacheReuseWeight: number;
  residualDelayMs: number;
  maxConcurrentLoads: number;
  priorityMode: 'semantic' | 'lod' | 'distance' | 'fifo';
}

export interface SemanticLabel {
  name: string;
  score: number;
}

export interface SaliencyRegion {
  bbox: Box2D;
  score: number;
}

export interface SemanticManifest {
  blockId: string;
  bbox: AABB;
  labels: SemanticLabel[];
  saliency: SaliencyRegion[];
  thumbs: string[];
  semanticScore: number;
  taskRelevance?: Record<string, number>;
  taskLabels?: string[];
  taskScores?: Record<string, number>;
  metadata?: {
    source: 'rule_generated' | 'manual_seeded' | 'external_service' | string;
    generator?: string;
    generatedAt?: string;
    incomplete?: boolean;
    missingFields?: string[];
  };
  lods: {
    coarse?: string;
    residual?: string[];
  };
  bytes?: Partial<Record<LayerName, number>>;
}

export interface BlockManifest {
  blockId: string;
  bbox: AABB;
  center: Vec3;
  bytes?: Partial<Record<LayerName, number>>;
  layers: Partial<Record<LayerName, string | string[]>>;
  semantic?: {
    manifestUri: string;
    thumbUris: string[];
    data?: SemanticManifest;
  };
}

export interface SceneManifest {
  schemaVersion: '0.1.0';
  sceneId: string;
  createdAt: string;
  partition: {
    mode: PartitionMode;
    blockCount: number;
  };
  blocks: BlockManifest[];
}

export interface VisibleBlockTelemetry {
  blockId: string;
  centerScore: number;
  visibleAreaScore: number;
  semanticScore: number;
  taskMatchScore: number;
  edgeHitRate: number;
  fidelityGain: number;
  remoteLatencyMs: number;
  bytes: Partial<Record<LayerName, number>>;
  layerReady?: Partial<Record<LayerName, boolean>>;
}

export interface ScheduleRequest {
  visibleBlocks: VisibleBlockTelemetry[];
  network: {
    bwEstimateMbps: number;
    rttMs?: number;
  };
  device: {
    cpuLoad: number;
    hotCacheBytes: number;
    idbBytes?: number;
  };
  taskLabels: string[];
  sceneId?: string;
  method?: string;
  strategy?: SchedulingStrategy;
}

export interface ScheduleDecision {
  blockId: string;
  mode: DeliveryMode;
  priority: number;
  layers: LayerName[];
  ttl: number;
  cacheHint: 'promote' | 'retain' | 'allow-evict';
  reason: string;
}

export interface ScheduleResponse {
  generatedAt: string;
  items: ScheduleDecision[];
}

export interface RuntimeQueueEntry {
  key: `${string}:${LayerName}`;
  blockId: string;
  layer: LayerName;
  priority: number;
  bytes: number;
  lastTouchedAt: number;
}

export interface TelemetryFrame {
  sceneId: string;
  capturedAt: string;
  method?: string;
  camera: {
    position: Vec3;
    target: Vec3;
    fovDeg: number;
  };
  visibleBlocks: VisibleBlockTelemetry[];
  network: {
    bwEstimateMbps: number;
    rttMs?: number;
  };
  device: {
    cpuLoad: number;
    hotCacheBytes: number;
    idbBytes?: number;
  };
  taskLabels: string[];
  strategy?: SchedulingStrategy;
}

export type EdgeCacheHint = 'promote' | 'retain' | 'allow-evict';

export interface EdgeCacheEntry {
  key: string;
  sceneId: string;
  blockId: string;
  layer: LayerName;
  version: string;
  bytes: number;
  ttlSeconds: number;
  hint: EdgeCacheHint;
  lastAccessedAt: string;
  hitCount: number;
}

export type EdgeInvalidationReason = 'version-bump' | 'manual' | 'eviction' | 'ttl-expired';

export interface EdgeInvalidationEvent {
  sceneId: string;
  blockId: string;
  layer?: LayerName;
  version?: string;
  reason: EdgeInvalidationReason;
  emittedAt: string;
}

export interface SemanticViewInput {
  imagePath: string;
  promptTerms: string[];
}

export interface SemanticExtractionRequest {
  blockId: string;
  bbox: AABB;
  views: SemanticViewInput[];
}

export interface SemanticExtractionResponse {
  blockId: string;
  labels: SemanticLabel[];
  saliency: SaliencyRegion[];
  thumbs: string[];
  semanticScore: number;
  notes?: string[];
}

export interface BlockArtifactDescriptor {
  uri: string;
  bytes: number;
  contentHash?: string;
}

export interface BlockArtifactIndex {
  blockId: string;
  bbox: AABB;
  center: Vec3;
  artifacts: {
    sem?: BlockArtifactDescriptor;
    coarse?: BlockArtifactDescriptor;
    residual?: BlockArtifactDescriptor[];
    thumbs?: BlockArtifactDescriptor[];
  };
}
