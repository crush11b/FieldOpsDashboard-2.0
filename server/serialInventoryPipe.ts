import * as net from 'node:net';

export const SERIAL_INVENTORY_PIPE = '\\\\.\\pipe\\FieldOps.SerialInventory.v1';
export const SERIAL_INVENTORY_MAX_FRAME = 256 * 1024;
const REQUEST = Buffer.from(JSON.stringify({ command: 'GetSerialPortInventory' }));

export type SerialInventory = {
  observedAtUtc: string;
  status: 'Ok' | 'Unavailable' | 'Error';
  ports: unknown[];
  error: string | null;
};

function result(status: SerialInventory['status'], error: string): SerialInventory {
  return { observedAtUtc: new Date().toISOString(), status, ports: [], error };
}

function validResponse(value: unknown): value is SerialInventory {
  if (!value || typeof value !== 'object') return false;
  const body = value as Record<string, unknown>;
  return typeof body.observedAtUtc === 'string'
    && (body.status === 'Ok' || body.status === 'Unavailable' || body.status === 'Error')
    && Array.isArray(body.ports)
    && (body.error === null || typeof body.error === 'string');
}

export function parseSerialInventoryFrame(frame: Buffer): SerialInventory {
  if (frame.length < 4) return result('Error', 'Serial inventory response framing was incomplete.');
  const length = frame.readInt32LE(0);
  if (length <= 0 || length > SERIAL_INVENTORY_MAX_FRAME) return result('Error', 'Serial inventory response framing was invalid.');
  if (frame.length < length + 4) return result('Error', 'Serial inventory response framing was incomplete.');
  if (frame.length !== length + 4) return result('Error', 'Serial inventory response contained trailing data.');
  try {
    const parsed: unknown = JSON.parse(frame.subarray(4).toString('utf8'));
    return validResponse(parsed) ? parsed : result('Error', 'Serial inventory response was malformed.');
  } catch { return result('Error', 'Serial inventory response was malformed.'); }
}

export function readSerialInventoryPipe(timeoutMs = 5000): Promise<SerialInventory> {
  if (process.platform !== 'win32') return Promise.resolve(result('Unavailable', 'Serial inventory is unavailable on this platform.'));
  return new Promise(resolve => {
    const socket = net.connect(SERIAL_INVENTORY_PIPE);
    let settled = false;
    let buffer = Buffer.alloc(0);
    const finish = (value: SerialInventory) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.removeAllListeners();
      socket.destroy();
      resolve(value);
    };
    const timer = setTimeout(() => finish(result('Unavailable', 'Serial inventory request timed out.')), timeoutMs);
    socket.once('connect', () => {
      const frame = Buffer.alloc(4 + REQUEST.length);
      frame.writeInt32LE(REQUEST.length, 0);
      REQUEST.copy(frame, 4);
      socket.write(frame);
    });
    socket.on('data', chunk => {
      if (settled) return;
      buffer = Buffer.concat([buffer, chunk]);
      if (buffer.length > SERIAL_INVENTORY_MAX_FRAME + 4) return finish(result('Error', 'Serial inventory response was too large.'));
      if (buffer.length < 4) return;
      const length = buffer.readInt32LE(0);
      if (length <= 0 || length > SERIAL_INVENTORY_MAX_FRAME) return finish(result('Error', 'Serial inventory response framing was invalid.'));
      if (buffer.length < length + 4) return;
      finish(parseSerialInventoryFrame(buffer));
    });
    socket.once('error', error => finish(result(error && ['EACCES', 'EPERM'].includes((error as NodeJS.ErrnoException).code ?? '') ? 'Error' : 'Unavailable', error && ['EACCES', 'EPERM'].includes((error as NodeJS.ErrnoException).code ?? '') ? 'Serial inventory access was denied.' : 'Serial inventory pipe is unavailable.')));
    socket.once('close', () => { if (!settled) finish(result('Unavailable', 'Serial inventory pipe closed before a complete response.')); });
  });
}
