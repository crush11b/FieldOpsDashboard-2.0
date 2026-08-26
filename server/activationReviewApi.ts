import express, { type Router } from 'express';
import { isValidQsoId } from './qso';
import { assembleActivationReview, type ActivationReviewDependencies } from './activationReview';
import type { ActivationStore } from './activationStore';

export interface ActivationReviewApiDependencies extends Omit<ActivationReviewDependencies, 'activation'> { readonly activationStore: ActivationStore; }

export function createActivationReviewRouter(dependencies: ActivationReviewApiDependencies): Router {
  const router = express.Router();
  router.get('/api/activations/:activationId/review', (request, response) => {
    if (!isValidQsoId(request.params.activationId)) { response.status(400).json({ kind: 'activation_review_error', code: 'invalid_id', message: 'The Activation ID is invalid.', diagnostics: [] }); return; }
    const activationResult = dependencies.activationStore.get(request.params.activationId);
    if (activationResult.status === 'notFound') { response.status(404).json({ kind: 'activation_review_error', code: 'not_found', message: 'The Activation was not found.', diagnostics: activationResult.diagnostics }); return; }
    try {
      response.json(assembleActivationReview({ ...dependencies, activation: activationResult.activation }));
    } catch {
      response.status(503).json({ kind: 'activation_review_error', code: 'review_unavailable', message: 'Activation Review is temporarily unavailable.', diagnostics: [] });
    }
  });
  return router;
}