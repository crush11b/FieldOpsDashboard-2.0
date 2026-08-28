import express, { type Router } from 'express';
import path from 'node:path';

export function createProductionStaticRouter(distPath: string): Router {
  const router = express.Router();
  router.use(express.static(distPath, {
    setHeaders: (response, filePath) => {
      if (filePath.startsWith(path.join(distPath, 'assets') + path.sep)) {
        response.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      } else if (path.basename(filePath) === 'index.html') {
        response.setHeader('Cache-Control', 'no-store, max-age=0');
      }
    },
  }));
  router.get('/assets/*', (_request, response) => {
    response.status(404).json({ error: 'Dashboard asset not found.' });
  });
  router.get('*', (_request, response) => {
    response.setHeader('Cache-Control', 'no-store, max-age=0');
    response.sendFile(path.join(distPath, 'index.html'));
  });
  return router;
}