import path from 'node:path';
import fs from 'node:fs';

const root = path.resolve(process.cwd());
const sourceRuntimeRoot = path.join(root, 'p533-assets', 'runtime');
const packagedRuntimeRoot = path.join(root, 'dist', 'p533');
const runtimeRoot = fs.existsSync(path.join(sourceRuntimeRoot, 'p533.mjs')) ? sourceRuntimeRoot : packagedRuntimeRoot;

export function getP533RuntimePath(fileName = '') {
  if (fileName.includes('/') || fileName.includes('\\') || fileName === '.' || fileName === '..') throw new Error('P.533 runtime asset names must be local basenames.');
  return path.join(runtimeRoot, fileName);
}

export {runtimeRoot};