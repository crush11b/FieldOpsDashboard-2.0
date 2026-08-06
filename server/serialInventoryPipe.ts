import * as net from 'node:net';

export const SERIAL_INVENTORY_PIPE = '\\\\.\\pipe\\FieldOps.SerialInventory.v1';
export type SerialInventory = { observedAtUtc: string; status: 'Ok' | 'Unavailable' | 'Error'; ports: unknown[]; error: string | null };

export function readSerialInventoryPipe(timeoutMs = 5000): Promise<SerialInventory> {
  if (process.platform !== 'win32') return Promise.resolve({ observedAtUtc: new Date().toISOString(), status: 'Unavailable', ports: [], error: 'Serial inventory is unavailable on this platform.' });
  return new Promise((resolve) => {
    const socket = net.connect(SERIAL_INVENTORY_PIPE); const timer = setTimeout(() => { socket.destroy(); resolve({ observedAtUtc: new Date().toISOString(), status: 'Unavailable', ports: [], error: 'Serial inventory request timed out.' }); }, timeoutMs); let data = Buffer.alloc(0);
    socket.on('error', () => { clearTimeout(timer); resolve({ observedAtUtc: new Date().toISOString(), status: 'Unavailable', ports: [], error: 'Serial inventory pipe is unavailable.' }); });
    socket.on('connect', () => { const payload = Buffer.from(JSON.stringify({ command: 'GetSerialPortInventory' })); const frame = Buffer.alloc(4 + payload.length); frame.writeInt32LE(payload.length, 0); payload.copy(frame, 4); socket.write(frame); });
    socket.on('data', chunk => { data = Buffer.concat([data, chunk]); if (data.length > 262144) { socket.destroy(); clearTimeout(timer); resolve({ observedAtUtc: new Date().toISOString(), status: 'Error', ports: [], error: 'Serial inventory response was too large.' }); return; } if (data.length < 4 || data.readInt32LE(0) > data.length - 4) return; clearTimeout(timer); socket.end(); try { const body = JSON.parse(data.subarray(4, 4 + data.readInt32LE(0)).toString()); if (typeof body.observedAtUtc !== 'string' || !['Ok', 'Unavailable', 'Error'].includes(body.status) || !Array.isArray(body.ports)) throw new Error(); resolve(body); } catch { resolve({ observedAtUtc: new Date().toISOString(), status: 'Error', ports: [], error: 'Serial inventory response was malformed.' }); } });
  });
}
