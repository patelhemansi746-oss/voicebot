import { Router } from 'express';
import { sessionController } from '../controllers/session.controller';
import { validateBody } from '../middleware/validate.middleware';
import {
  createSessionSchema,
  updateSessionStatusSchema,
  updateSessionContextSchema
} from '../types/session.types';

const router = Router();

// POST /api/v1/sessions - Create new voice session
router.post('/', validateBody(createSessionSchema), sessionController.createSession);

// GET /api/v1/sessions - List sessions
router.get('/', sessionController.getAllSessions);

// GET /api/v1/sessions/:id - Get session details
router.get('/:id', sessionController.getSessionById);

// PATCH /api/v1/sessions/:id/status - Update session status
router.patch(
  '/:id/status',
  validateBody(updateSessionStatusSchema),
  sessionController.updateStatus
);

// PATCH /api/v1/sessions/:id/context - Update session context
router.patch(
  '/:id/context',
  validateBody(updateSessionContextSchema),
  sessionController.updateContext
);

// DELETE /api/v1/sessions/:id - Terminate session
router.delete('/:id', sessionController.deleteSession);

export default router;

