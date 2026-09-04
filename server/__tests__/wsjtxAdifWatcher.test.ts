import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { WsjtxAdifWatcher } from '../wsjtxAdifWatcher';

const directories: string[] = [];
afterEach(() => { for (const directory of directories.splice(0)) fs.rmSync(directory, { recursive: true, force: true }); });

function setup(initial = '', createFile = true) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'fieldops-wsjtx-adif-')); directories.push(directory);
  const filePath = path.join(directory, 'wsjtx_log.adi'); if (createFile) fs.writeFileSync(filePath, initial);
  const checkpointPath = path.join(directory, 'checkpoint.json');
  return { directory, filePath, checkpointPath };
}

function record(callsign = 'W1AW', time = '174200', eor = 'EOR') { return `<CALL:${callsign.length}>${callsign}<QSO_DATE:8>20260904<TIME_ON:6>${time}<BAND:3>20M<FREQ:6>14.074<MODE:3>FT8<${eor}>`; }

describe('WSJT-X ADIF file watcher', () => {
  it('seeds EOF on first startup and imports only a newly appended record', async () => {
    const files = setup(record()); const accepted: string[] = []; const watcher = new WsjtxAdifWatcher({ ...files, onRecord: candidate => { accepted.push(candidate.callsign); return 'persisted'; } });
    await watcher.pollNow();
    expect(accepted).toEqual([]);
    fs.appendFileSync(files.filePath, record('K1ABC'));
    await watcher.pollNow();
    expect(accepted).toEqual(['K1ABC']);
  });

  it('imports multiple appended records in order and handles case-insensitive EOR', async () => {
    const files = setup(); const accepted: string[] = []; const watcher = new WsjtxAdifWatcher({ ...files, onRecord: candidate => { accepted.push(candidate.callsign); return 'persisted'; } });
    await watcher.pollNow(); fs.appendFileSync(files.filePath, record('W1AW') + record('K1ABC', '174300', 'eOr')); await watcher.pollNow();
    expect(accepted).toEqual(['W1AW', 'K1ABC']);
  });

  it('waits for a split record to receive its EOR marker', async () => {
    const files = setup(); const accepted: string[] = []; const watcher = new WsjtxAdifWatcher({ ...files, onRecord: candidate => { accepted.push(candidate.callsign); return 'persisted'; } });
    await watcher.pollNow(); fs.appendFileSync(files.filePath, record('N0CALL').replace('<EOR>', '')); await watcher.pollNow(); expect(accepted).toEqual([]);
    fs.appendFileSync(files.filePath, '<EOR>'); await watcher.pollNow(); expect(accepted).toEqual(['N0CALL']);
  });

  it('resumes from a durable checkpoint after restart', async () => {
    const files = setup(); const first: string[] = []; const watcher = new WsjtxAdifWatcher({ ...files, onRecord: candidate => { first.push(candidate.callsign); return 'persisted'; } });
    await watcher.pollNow(); fs.appendFileSync(files.filePath, record('W1AW')); await watcher.pollNow();
    const resumed: string[] = []; const restarted = new WsjtxAdifWatcher({ ...files, onRecord: candidate => { resumed.push(candidate.callsign); return 'persisted'; } }); await restarted.pollNow();
    expect(first).toEqual(['W1AW']); expect(resumed).toEqual([]);
  });

  it('imports the first complete record in a file created after a restart while waiting', async () => {
    const files = setup('', false); const first = new WsjtxAdifWatcher({ ...files, onRecord: () => 'persisted' });
    await first.pollNow();
    const accepted: string[] = []; const restarted = new WsjtxAdifWatcher({ ...files, onRecord: candidate => { accepted.push(candidate.callsign); return 'persisted'; } });
    await restarted.pollNow(); fs.writeFileSync(files.filePath, record('N0CALL')); await restarted.pollNow(); await restarted.pollNow();
    expect(accepted).toEqual(['N0CALL']);
  });

  it('recovers a partial tail after restart without skipping it', async () => {
    const files = setup(); const first = new WsjtxAdifWatcher({ ...files, onRecord: () => 'persisted' }); await first.pollNow();
    const contact = record('N0CALL'); fs.appendFileSync(files.filePath, contact.slice(0, -5)); await first.pollNow();
    const resumed: string[] = []; const restarted = new WsjtxAdifWatcher({ ...files, onRecord: candidate => { resumed.push(candidate.callsign); return 'persisted'; } });
    fs.appendFileSync(files.filePath, contact.slice(-5)); await restarted.pollNow();
    expect(resumed).toEqual(['N0CALL']);
  });

  it('consumes a zero-active result and does not retry it after a later Activation starts', async () => {
    const files = setup(); const accepted: string[] = []; const watcher = new WsjtxAdifWatcher({ ...files, onRecord: candidate => { accepted.push(candidate.callsign); return 'activation:zero_active'; } });
    await watcher.pollNow(); fs.appendFileSync(files.filePath, record('W1AW')); await watcher.pollNow();
    expect(watcher.getDiagnostics()).toMatchObject({ recordsAccepted: 0, recordsRejected: 1, checkpointOffset: fs.statSync(files.filePath).size });
    await watcher.pollNow(); expect(accepted).toEqual(['W1AW']);
  });

  it('consumes multiple-active, retries persistence failures, and imports a later valid record', async () => {
    const files = setup(); let mode: 'multiple' | 'persistence' | 'valid' = 'multiple'; const accepted: string[] = [];
    const watcher = new WsjtxAdifWatcher({ ...files, onRecord: candidate => {
      if (candidate.callsign === 'W1AW' && mode === 'multiple') return 'activation:multiple_active';
      if (candidate.callsign === 'K1ABC' && mode === 'persistence') return 'persistence_failed';
      accepted.push(candidate.callsign); return 'persisted';
    } });
    await watcher.pollNow(); fs.appendFileSync(files.filePath, record('W1AW')); await watcher.pollNow();
    expect(watcher.getDiagnostics()).toMatchObject({ recordsRejected: 1, checkpointOffset: fs.statSync(files.filePath).size });
    mode = 'persistence'; fs.appendFileSync(files.filePath, record('K1ABC')); await watcher.pollNow();
    expect(watcher.getDiagnostics().checkpointOffset).toBe(fs.statSync(files.filePath).size - Buffer.byteLength(record('K1ABC')));
    mode = 'valid'; await watcher.pollNow();
    expect(accepted).toEqual(['K1ABC']);
  });

  it('continues after a malformed record and does not bulk-import after truncation or replacement', async () => {
    const files = setup(record('HIST')); const accepted: string[] = []; const watcher = new WsjtxAdifWatcher({ ...files, onRecord: candidate => { accepted.push(candidate.callsign); return 'persisted'; } });
    await watcher.pollNow(); fs.appendFileSync(files.filePath, '<CALL:3>BAD<EOR>' + record('VALID')); await watcher.pollNow(); expect(accepted).toEqual(['VALID']); expect(watcher.getDiagnostics().parseImportFailures).toBe(1);
    fs.writeFileSync(files.filePath, record('NEW-HISTORY')); await watcher.pollNow(); expect(accepted).toEqual(['VALID']);
  });

  it('remains nonfatal when the file is missing or no LOCALAPPDATA path is configured', async () => {
    const files = setup(); fs.rmSync(files.filePath); const watcher = new WsjtxAdifWatcher({ filePath: files.filePath, onRecord: () => 'persisted' }); await watcher.pollNow();
    expect(watcher.getDiagnostics()).toMatchObject({ enabled: true, filePresent: false, state: 'waiting' });
    const unavailable = new WsjtxAdifWatcher({ filePath: null, onRecord: () => 'persisted' }); await unavailable.pollNow(); expect(unavailable.getDiagnostics()).toMatchObject({ enabled: false, state: 'unavailable', resolvedPath: null });
  });

  it('is start-idempotent and releases its polling timer on stop', () => {
    const files = setup(); const watcher = new WsjtxAdifWatcher({ ...files, onRecord: () => 'persisted', pollIntervalMs: 60_000 }); watcher.start(); watcher.start(); watcher.stop(); expect(watcher.getDiagnostics().state).toBe('stopped');
  });
});