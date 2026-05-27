import type { SchedulingStrategy } from '@mtweb/shared-contracts';

export interface ExperimentConfig {
  method: string;
  bandwidth: number;
  taskLabels: string[];
  useScheduling: boolean;
  useSemantic: boolean;
  useLOD: boolean;
  useSPLQ: boolean;
  rotationAngle: number;
  sceneRoot: string;
  strategy: SchedulingStrategy;
  ablationModules: {
    semantic_mode_selection: boolean;
    SPLQ: boolean;
    edge_reuse: boolean;
  };
}

function readBooleanParam(params: URLSearchParams, name: string, fallback: boolean): boolean {
  const value = params.get(name);
  if (value === null) return fallback;
  return ['1', 'true', 'yes', 'on'].includes(value.trim().toLowerCase());
}

function readNumberParam(params: URLSearchParams, name: string, fallback: number): number {
  const value = params.get(name);
  if (value === null) return fallback;
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

const STRATEGIES: Record<string, SchedulingStrategy> = {
  'Seq-Load': {
    semanticPriority: false,
    semanticModeSelection: false,
    useSPLQ: false,
    edgeReuse: false,
    cacheReuseWeight: 0,
    residualDelayMs: 0,
    maxConcurrentLoads: 1,
    priorityMode: 'fifo'
  },
  'Std-LOD': {
    semanticPriority: false,
    semanticModeSelection: false,
    useSPLQ: false,
    edgeReuse: false,
    cacheReuseWeight: 0,
    residualDelayMs: 200,
    maxConcurrentLoads: 2,
    priorityMode: 'distance'
  },
  'MT-Web3DRC': {
    semanticPriority: false,
    semanticModeSelection: false,
    useSPLQ: false,
    edgeReuse: true,
    cacheReuseWeight: 0.12,
    residualDelayMs: 350,
    maxConcurrentLoads: 3,
    priorityMode: 'lod'
  },
  Ours: {
    semanticPriority: true,
    semanticModeSelection: true,
    useSPLQ: true,
    edgeReuse: true,
    cacheReuseWeight: 0.3,
    residualDelayMs: 900,
    maxConcurrentLoads: 3,
    priorityMode: 'semantic'
  },
  full: {
    semanticPriority: true,
    semanticModeSelection: true,
    useSPLQ: true,
    edgeReuse: true,
    cacheReuseWeight: 0.3,
    residualDelayMs: 900,
    maxConcurrentLoads: 3,
    priorityMode: 'semantic'
  },
  'w/o_semantic_mode_selection': {
    semanticPriority: true,
    semanticModeSelection: false,
    useSPLQ: true,
    edgeReuse: true,
    cacheReuseWeight: 0.3,
    residualDelayMs: 650,
    maxConcurrentLoads: 3,
    priorityMode: 'semantic'
  },
  'w/o_SPLQ': {
    semanticPriority: true,
    semanticModeSelection: true,
    useSPLQ: false,
    edgeReuse: true,
    cacheReuseWeight: 0.3,
    residualDelayMs: 500,
    maxConcurrentLoads: 3,
    priorityMode: 'distance'
  },
  'w/o_edge_reuse': {
    semanticPriority: true,
    semanticModeSelection: true,
    useSPLQ: true,
    edgeReuse: false,
    cacheReuseWeight: 0,
    residualDelayMs: 900,
    maxConcurrentLoads: 3,
    priorityMode: 'semantic'
  },
  baseline_MTWeb3DRC: {
    semanticPriority: false,
    semanticModeSelection: false,
    useSPLQ: false,
    edgeReuse: true,
    cacheReuseWeight: 0.12,
    residualDelayMs: 350,
    maxConcurrentLoads: 3,
    priorityMode: 'lod'
  },
  demo: {
    semanticPriority: true,
    semanticModeSelection: true,
    useSPLQ: true,
    edgeReuse: true,
    cacheReuseWeight: 0.3,
    residualDelayMs: 900,
    maxConcurrentLoads: 3,
    priorityMode: 'semantic'
  }
};

export function parseExperimentConfig(): ExperimentConfig {
  // If not running in a browser, provide a safe default
  if (typeof window === 'undefined') {
    return {
      method: 'demo',
      bandwidth: 8,
      taskLabels: ['overview'],
      useScheduling: true,
      useSemantic: true,
      useLOD: true,
      useSPLQ: true,
      rotationAngle: 0,
      sceneRoot: '/scenes/demo-scene',
      strategy: strategyForMethod('demo'),
      ablationModules: modulesForStrategy(strategyForMethod('demo'))
    };
  }

  return parseExperimentConfigFromSearch(window.location.search);
}

export function parseExperimentConfigFromSearch(search: string): ExperimentConfig {
  const urlParams = new URLSearchParams(search);
  const method = urlParams.get('method') ?? 'demo';
  const bandwidth = parseFloat(urlParams.get('bandwidth') ?? '8');
  const taskLabels = (urlParams.get('taskLabels') ?? 'overview').split(',').map(s => s.trim()).filter(Boolean);
  const rotationAngle = parseFloat(urlParams.get('rotationAngle') ?? '0');
  const sceneRoot = normalizeSceneRoot(urlParams.get('sceneRoot') ?? '/scenes/demo-scene');

  const strategy = strategyFromParams(strategyForMethod(method), urlParams);
  let useSemantic = strategy.semanticPriority || strategy.semanticModeSelection;
  let useLOD = method !== 'Seq-Load';
  let useScheduling = method !== 'Seq-Load' && method !== 'Std-LOD';
  let useSPLQ = strategy.useSPLQ;

  if (method === 'Seq-Load') {
    useSemantic = false;
    useLOD = false;
    useScheduling = false;
    useSPLQ = false;
  } else if (method === 'Std-LOD') {
    useSemantic = false;
    useLOD = true;
    useScheduling = false;
    useSPLQ = false;
  } else if (method === 'MT-Web3DRC') {
    useSemantic = false;
    useLOD = true;
    useScheduling = true;
    useSPLQ = false;
  } else if (method === 'Ours' || method === 'full') {
    useSemantic = true;
    useLOD = true;
    useScheduling = true;
    useSPLQ = true;
  } else if (method === 'w/o_semantic_mode_selection') {
    useSemantic = true;
    useLOD = true;
    useScheduling = true;
    useSPLQ = true;
  } else if (method === 'w/o_SPLQ') {
    useSemantic = true;
    useLOD = true;
    useScheduling = true;
    useSPLQ = false;
  } else if (method === 'w/o_edge_reuse') {
    useSemantic = true;
    useLOD = true;
    useScheduling = true;
    useSPLQ = true;
  } else if (method === 'baseline_MTWeb3DRC') {
    useSemantic = false;
    useLOD = true;
    useScheduling = true;
    useSPLQ = false;
  } else {
    // demo mode defaults (same as previous hardcoded values)
    useSemantic = true;
    useLOD = true;
    useScheduling = true;
    useSPLQ = true;
  }

  return {
    method,
    bandwidth,
    taskLabels,
    useScheduling,
    useSemantic: useSemantic && (strategy.semanticPriority || strategy.semanticModeSelection),
    useLOD,
    useSPLQ: useSPLQ && strategy.useSPLQ,
    rotationAngle,
    sceneRoot,
    strategy,
    ablationModules: modulesForStrategy(strategy)
  };
}

export function strategyForMethod(method: string): SchedulingStrategy {
  return STRATEGIES[method] ?? STRATEGIES.demo;
}

function strategyFromParams(base: SchedulingStrategy, params: URLSearchParams): SchedulingStrategy {
  const strategy: SchedulingStrategy = {
    ...base,
    semanticPriority: readBooleanParam(params, 'semanticPriority', base.semanticPriority),
    semanticModeSelection: readBooleanParam(params, 'semanticModeSelection', base.semanticModeSelection),
    edgeReuse: readBooleanParam(params, 'edgeReuse', base.edgeReuse),
    residualDelayMs: Math.max(0, Math.round(readNumberParam(params, 'residualDelayMs', base.residualDelayMs))),
    maxConcurrentLoads: Math.max(1, Math.round(readNumberParam(params, 'maxConcurrentLoads', base.maxConcurrentLoads)))
  };
  strategy.useSPLQ = readBooleanParam(params, 'useSPLQ', strategy.useSPLQ);

  if (!strategy.semanticPriority && !strategy.semanticModeSelection && base.priorityMode === 'semantic') {
    strategy.priorityMode = 'lod';
  }
  if (!strategy.edgeReuse) {
    strategy.cacheReuseWeight = 0;
  }
  return strategy;
}

function modulesForStrategy(strategy: SchedulingStrategy): ExperimentConfig['ablationModules'] {
  return {
    semantic_mode_selection: strategy.semanticModeSelection,
    SPLQ: strategy.useSPLQ,
    edge_reuse: strategy.edgeReuse
  };
}

function normalizeSceneRoot(value: string): string {
  const normalized = value.trim().replace(/\\/g, '/').replace(/\/+$/g, '');
  if (normalized.startsWith('/')) return normalized;
  return `/${normalized}`;
}
