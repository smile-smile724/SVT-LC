import path from 'node:path';
import { loadConfig, resolveOutputRoot, runPreprocess } from './pipeline/runner.js';

async function main(): Promise<void> {
  const configIndex = process.argv.indexOf('--config');
  if (configIndex === -1 || !process.argv[configIndex + 1]) {
    console.error('Usage: npm run dev:preprocess -- --config <config-path>');
    process.exit(1);
  }

  const invocationCwd = process.env.INIT_CWD ?? process.cwd();
  const configPath = path.resolve(invocationCwd, process.argv[configIndex + 1]);
  const config = await loadConfig(configPath);
  const projectRoot = path.resolve(path.dirname(configPath), '..', '..');
  const configDir = path.dirname(configPath);

  config.rawScenePath = path.resolve(configDir, config.rawScenePath);

  config.outputRoot = resolveOutputRoot(projectRoot, config.outputRoot);
  if (config.publicMirrorRoot) {
    config.publicMirrorRoot = resolveOutputRoot(projectRoot, config.publicMirrorRoot);
  }
  await runPreprocess(config);
}

main().catch((error: unknown) => {
  console.error('[preprocess] fatal error', error);
  process.exit(1);
});
