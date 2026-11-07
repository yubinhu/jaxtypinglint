import { build } from 'esbuild';
import { runTests } from '@vscode/test-electron';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
const testRoot = path.join(root, '.vscode-test');
const workspace = path.join(testRoot, 'workspace');
await mkdir(path.join(workspace, '.vscode'), { recursive: true });
await writeFile(path.join(workspace, '.vscode', 'settings.json'), JSON.stringify({
  'security.workspace.trust.enabled': false,
  'workbench.startupEditor': 'none',
  'telemetry.telemetryLevel': 'off',
  'extensions.autoCheckUpdates': false,
  'extensions.autoUpdate': false,
  'update.mode': 'none',
}));
await build({
  entryPoints: [path.join(root, 'test/integration/index.ts')],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node20',
  external: ['vscode'],
  outfile: path.join(root, 'dist/integration.js'),
  sourcemap: true,
});

const installedMac = ['Code', 'Electron']
  .map(name => `/Applications/Visual Studio Code.app/Contents/MacOS/${name}`)
  .find(existsSync);
const executable = process.env.VSCODE_EXECUTABLE_PATH
  || (process.platform === 'darwin' ? installedMac : undefined);

// Terminals launched by Electron-based tools may inherit Node-only mode.
// The test executable must start the editor and its extension host instead.
delete process.env.ELECTRON_RUN_AS_NODE;
delete process.env.VSCODE_IPC_HOOK_CLI;

await runTests({
  extensionDevelopmentPath: root,
  extensionTestsPath: path.join(root, 'dist/integration.js'),
  extensionTestsEnv: { JAXTYPINGLINT_EXTENSION_ID: `${manifest.publisher}.${manifest.name}` },
  ...(executable ? { vscodeExecutablePath: executable } : {}),
  launchArgs: [
    workspace,
    '--disable-extensions',
    '--disable-workspace-trust',
    '--skip-welcome',
    '--skip-release-notes',
    `--user-data-dir=${path.join(testRoot, 'user-data')}`,
    `--extensions-dir=${path.join(testRoot, 'extensions')}`,
  ],
});
