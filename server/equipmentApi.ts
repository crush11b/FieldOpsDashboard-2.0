import express, { type Router } from 'express';
import { NotFoundError, type EquipmentStore } from './equipmentStore';

export function createEquipmentRouter(store: EquipmentStore): Router {
  const router = express.Router();
  router.get('/api/equipment', (_request, response) => { const result = store.loadInventory(); return response.status(result.status === 'ioError' ? 503 : result.status === 'invalid' ? 409 : 200).json({ kind: 'equipment_inventory', ...result }); });
  router.post('/api/equipment', (request, response) => mutate(response, () => store.createEquipment(request.body), 201));
  router.patch('/api/equipment/:equipmentId', (request, response) => mutate(response, () => store.updateEquipment(request.params.equipmentId, request.body)));
  router.delete('/api/equipment/:equipmentId', (request, response) => mutate(response, () => store.deleteEquipment(request.params.equipmentId)));
  router.post('/api/equipment/:equipmentId/restore', (request, response) => mutate(response, () => store.restoreEquipment(request.params.equipmentId)));
  router.get('/api/loadouts', (_request, response) => { const result = store.loadLoadouts(); return response.status(result.status === 'ioError' ? 503 : result.status === 'invalid' ? 409 : 200).json({ kind: 'loadouts', ...result }); });
  router.post('/api/loadouts', (request, response) => mutate(response, () => store.createLoadout(request.body), 201));
  router.patch('/api/loadouts/:loadoutId', (request, response) => mutate(response, () => store.updateLoadout(request.params.loadoutId, request.body)));
  router.delete('/api/loadouts/:loadoutId', (request, response) => mutate(response, () => store.deleteLoadout(request.params.loadoutId)));
  router.post('/api/loadouts/:loadoutId/restore', (request, response) => mutate(response, () => store.restoreLoadout(request.params.loadoutId)));
  return router;
}
function mutate(response: express.Response, operation: () => unknown, success = 200): express.Response { try { return response.status(success).json({ kind: 'equipment_mutation', status: 'succeeded', record: operation() }); } catch (error) { if (error instanceof NotFoundError) return response.status(404).json({ kind: 'equipment_error', code: 'not_found', message: 'The requested record was not found.' }); const message = error instanceof Error ? error.message : 'The request is invalid.'; const persistence = /store is not writable/.test(message); return response.status(persistence ? 409 : 400).json({ kind: 'equipment_error', code: persistence ? 'store_invalid' : 'invalid_request', message }); } }
