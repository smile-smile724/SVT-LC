import { describe, expect, it } from 'vitest';
import { parseExperimentConfigFromSearch } from '../packages/web-client/src/experiment/config.js';

describe('parseExperimentConfigFromSearch', () => {
  it('maps Seq-Load to strict non-semantic sequential baseline switches', () => {
    const config = parseExperimentConfigFromSearch('?method=Seq-Load&bandwidth=0.5');
    expect(config.useSemantic).toBe(false);
    expect(config.useLOD).toBe(false);
    expect(config.useScheduling).toBe(false);
    expect(config.useSPLQ).toBe(false);
    expect(config.bandwidth).toBe(0.5);
    expect(config.strategy.priorityMode).toBe('fifo');
    expect(config.ablationModules).toEqual({ semantic_mode_selection: false, SPLQ: false, edge_reuse: false });
  });

  it('maps Std-LOD to LOD without semantic scheduling or S-PLQ', () => {
    const config = parseExperimentConfigFromSearch('?method=Std-LOD');
    expect(config.useSemantic).toBe(false);
    expect(config.useLOD).toBe(true);
    expect(config.useScheduling).toBe(false);
    expect(config.useSPLQ).toBe(false);
    expect(config.strategy.priorityMode).toBe('distance');
  });

  it('maps MT-Web3DRC to scheduled non-semantic LOD without S-PLQ', () => {
    const config = parseExperimentConfigFromSearch('?method=MT-Web3DRC');
    expect(config.useSemantic).toBe(false);
    expect(config.useLOD).toBe(true);
    expect(config.useScheduling).toBe(true);
    expect(config.useSPLQ).toBe(false);
    expect(config.strategy.priorityMode).toBe('lod');
    expect(config.strategy.semanticModeSelection).toBe(false);
  });

  it('maps Ours to semantic LOD scheduling with S-PLQ', () => {
    const config = parseExperimentConfigFromSearch('?method=Ours&taskLabels=overview,inspect,navigation&rotationAngle=20');
    expect(config.useSemantic).toBe(true);
    expect(config.useLOD).toBe(true);
    expect(config.useScheduling).toBe(true);
    expect(config.useSPLQ).toBe(true);
    expect(config.taskLabels).toEqual(['overview', 'inspect', 'navigation']);
    expect(config.rotationAngle).toBe(20);
    expect(config.strategy.semanticPriority).toBe(true);
    expect(config.strategy.edgeReuse).toBe(true);
    expect(config.ablationModules).toEqual({ semantic_mode_selection: true, SPLQ: true, edge_reuse: true });
  });

  it('maps ablations to concrete disabled modules', () => {
    const noSem = parseExperimentConfigFromSearch('?method=w/o_semantic_mode_selection');
    expect(noSem.useSemantic).toBe(true);
    expect(noSem.strategy.semanticPriority).toBe(true);
    expect(noSem.strategy.semanticModeSelection).toBe(false);
    expect(noSem.ablationModules.semantic_mode_selection).toBe(false);
    expect(noSem.ablationModules.SPLQ).toBe(true);
    expect(noSem.ablationModules.edge_reuse).toBe(true);

    const noSplq = parseExperimentConfigFromSearch('?method=w/o_SPLQ');
    expect(noSplq.useSemantic).toBe(true);
    expect(noSplq.useSPLQ).toBe(false);
    expect(noSplq.ablationModules.SPLQ).toBe(false);

    const noEdge = parseExperimentConfigFromSearch('?method=w/o_edge_reuse');
    expect(noEdge.strategy.edgeReuse).toBe(false);
    expect(noEdge.ablationModules.edge_reuse).toBe(false);
  });

  it('lets URL parameters override experiment strategy switches', () => {
    const config = parseExperimentConfigFromSearch(
      '?method=Ours&semanticPriority=false&semanticModeSelection=false&edgeReuse=false&residualDelayMs=120&maxConcurrentLoads=1'
    );
    expect(config.strategy.semanticPriority).toBe(false);
    expect(config.strategy.semanticModeSelection).toBe(false);
    expect(config.strategy.edgeReuse).toBe(false);
    expect(config.strategy.residualDelayMs).toBe(120);
    expect(config.strategy.maxConcurrentLoads).toBe(1);
    expect(config.useSemantic).toBe(false);
  });
});
