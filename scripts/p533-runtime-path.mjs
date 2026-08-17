import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const runtimeRoot = path.join(root, 'p533-assets', 'runtime');

export function getP533RuntimePath(fileName = '') {
  if (fileName.includes('/') || fileName.includes('\\') || fileName === '.' || fileName === '..') throw new Error('P.533 runtime asset names must be local basenames.');
  return path.join(runtimeRoot, fileName);
}

export {runtimeRoot};