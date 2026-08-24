import express, { type Router } from 'express';
import path from 'node:path';

export function createProductionStaticRouter(distPath: string): Router {
  const router = express.Router();
  router.use(express.static(distPath));
  router.get('/assets/*', (_request, response) => {
    response.status(404).json({ error: 'Dashboard asset not found.' });
  });
  router.get('*', (_request, response) => {
    response.sendFile(path.join(distPath, 'index.html'));
  });
  return router;
}