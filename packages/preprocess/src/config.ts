import type { PartitionMode } from '@mtweb/shared-contracts';

export interface PreprocessConfig {
  sceneId: string;
  rawScenePath: string;
  outputRoot: string;
  publicMirrorRoot?: string;
  partitionMode: PartitionMode;
  gridDivisions?: [number, number, number];
  generateSemanticPlaceholders?: boolean;
}
