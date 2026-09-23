import fs from 'node:fs';
import { planQsoReassociation } from '../server/qsoRecovery';
import type { Activation } from '../server/activation';
import type { Qso } from '../server/qso';

const args = new Map(process.argv.slice(2).map(value => { const [key, ...rest] = value.split('='); return [key, rest.join('=')]; }));
const filePath = args.get('--file');
const sourceActivationId = args.get('--source');
const targetActivationId = args.get('--target');
if (!filePath || !sourceActivationId || !targetActivationId) throw new Error('Usage: npx tsx scripts/reassociate-qsos.ts --file=<qsos.json> --activations=<activations.json> --source=<id> --target=<id> [--expected-count=<n>]');
const activationPath = args.get('--activations');
if (!activationPath) throw new Error('The --activations path is required.');
const document = JSON.parse(fs.readFileSync(filePath, 'utf8')) as { qsos: Qso[] };
const activationDocument = JSON.parse(fs.readFileSync(activationPath, 'utf8')) as { activations: Activation[] };
const plan = planQsoReassociation(document.qsos, activationDocument.activations, { sourceActivationId, targetActivationId });
const expectedCount = args.get('--expected-count');
if (expectedCount && plan.selected.length !== Number(expectedCount)) throw new Error(`Expected ${expectedCount} records, selected ${plan.selected.length}.`);
