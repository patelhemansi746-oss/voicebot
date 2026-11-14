import { Router } from 'express';
import { sessionController } from '../controllers/session.controller';
import { validateBody } from '../middleware/validate.middleware';
import {
  createSessionSchema,
  updateSessionContextSchema
} from '../types/session.types';

const router = Router();

// POST /api/v1/sessions - Create new voice session (created state)
router.post('/', validateBody(createSessionSchema), sessionController.createSession);

// GET /api/v1/sessions - List active sessions
router.get('/', sessionController.getAllSessions);

// GET /api/v1/sessions/:id - Get session details
router.get('/:id', sessionController.getSessionById);

// GET /api/v1/sessions/:id/events - SSE Event stream
router.get('/:id/events', sessionController.streamSessionEvents);

// POST /api/v1/sessions/:id/start - Start session (created -> active)
router.post('/:id/start', sessionController.startSession);

// POST /api/v1/sessions/:id/pause - Idempotent pause (active -> paused)
router.post('/:id/pause', sessionController.pauseSession);

// POST /api/v1/sessions/:id/resume - Idempotent resume (paused/created -> active)
router.post('/:id/resume', sessionController.resumeSession);

// POST /api/v1/sessions/:id/stop - Idempotent stop (active/paused/created -> stopping -> completed)
router.post('/:id/stop', sessionController.stopSession);

// POST /api/v1/sessions/:id/fail - Fail session
router.post('/:id/fail', sessionController.failSession);

// PATCH /api/v1/sessions/:id/context - Update screen/workspace context
router.patch(
  '/:id/context',
  validateBody(updateSessionContextSchema),
  sessionController.updateContext
);

// DELETE /api/v1/sessions/:id - Remove session
router.delete('/:id', sessionController.deleteSession);

export default router;
