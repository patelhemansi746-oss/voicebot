import { Request, Response, NextFunction } from 'express';
import { sessionService } from '../services/session.service';
import { AppError } from '../middleware/error.middleware';
import { ApiResponse } from '../types/common.types';
import { SessionEvent } from '../types/session.types';

export class SessionController {
  /**
   * POST /api/v1/sessions
   */
  public createSession = async (
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    try {
      const session = sessionService.createSession(req.body);

      const response: ApiResponse = {
        success: true,
        message: 'Voice session created successfully',
        data: session,
        timestamp: new Date().toISOString()
      };

      res.status(201).json(response);
    } catch (error) {
      next(error);
    }
  };

  /**
   * GET /api/v1/sessions
   */
  public getAllSessions = async (
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    try {
      const page = req.query.page ? parseInt(req.query.page as string, 10) : 1;
      const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 20;

      const result = sessionService.getAllSessions(page, limit);

      const response: ApiResponse = {
        success: true,
        data: result,
        timestamp: new Date().toISOString()
      };

      res.status(200).json(response);
    } catch (error) {
      next(error);
    }
  };

  /**
   * GET /api/v1/sessions/:id
   */
  public getSessionById = async (
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    try {
      const { id } = req.params;
      const session = sessionService.getSessionById(id);

      if (!session) {
        throw new AppError(`Session with ID '${id}' not found`, 404, 'SESSION_NOT_FOUND');
      }

      const response: ApiResponse = {
        success: true,
        data: session,
        timestamp: new Date().toISOString()
      };

      res.status(200).json(response);
    } catch (error) {
      next(error);
    }
  };

  /**
   * POST /api/v1/sessions/:id/pause
   * Idempotent session pausing
   */
  public pauseSession = async (
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    try {
      const { id } = req.params;
      const session = sessionService.pauseSession(id);

      const response: ApiResponse = {
        success: true,
        message: `Session '${id}' is now paused`,
        data: session,
        timestamp: new Date().toISOString()
      };

      res.status(200).json(response);
    } catch (error) {
      next(error);
    }
  };

  /**
   * POST /api/v1/sessions/:id/resume
   * Idempotent session resuming
   */
  public resumeSession = async (
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    try {
      const { id } = req.params;
      const session = sessionService.resumeSession(id);

      const response: ApiResponse = {
        success: true,
        message: `Session '${id}' resumed to active`,
        data: session,
        timestamp: new Date().toISOString()
      };

      res.status(200).json(response);
    } catch (error) {
      next(error);
    }
  };

  /**
   * POST /api/v1/sessions/:id/stop
   * Idempotent session stopping
   */
  public stopSession = async (
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    try {
      const { id } = req.params;
      const session = sessionService.stopSession(id);

      const response: ApiResponse = {
        success: true,
        message: `Session '${id}' has been stopped`,
        data: session,
        timestamp: new Date().toISOString()
      };

      res.status(200).json(response);
    } catch (error) {
      next(error);
    }
  };

  /**
   * PATCH /api/v1/sessions/:id/context
   */
  public updateContext = async (
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    try {
      const { id } = req.params;
      const updated = sessionService.updateSessionContext(id, req.body);

      const response: ApiResponse = {
        success: true,
        message: 'Session context updated successfully',
        data: updated,
        timestamp: new Date().toISOString()
      };

      res.status(200).json(response);
    } catch (error) {
      next(error);
    }
  };

  /**
   * DELETE /api/v1/sessions/:id
   */
  public deleteSession = async (
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    try {
      const { id } = req.params;
      const deleted = sessionService.deleteSession(id);

      if (!deleted) {
        throw new AppError(`Session with ID '${id}' not found`, 404, 'SESSION_NOT_FOUND');
      }

      const response: ApiResponse = {
        success: true,
        message: `Session '${id}' successfully terminated and removed`,
        timestamp: new Date().toISOString()
      };

      res.status(200).json(response);
    } catch (error) {
      next(error);
    }
  };

  /**
   * GET /api/v1/sessions/:id/events
   * Server-Sent Events (SSE) streaming endpoint
   * Streams ordered session events in real-time and replays history.
   */
  public streamSessionEvents = async (
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    try {
      const { id } = req.params;
      // Validates session exists and fetches historical events
      const history = sessionService.getSessionEvents(id);

      // SSE Headers
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      res.setHeader('X-Accel-Buffering', 'no');
      res.flushHeaders();

      // Format helper for SSE
      const writeEvent = (event: SessionEvent) => {
        res.write(`id: ${event.id}\n`);
        res.write(`event: ${event.type}\n`);
        res.write(`data: ${JSON.stringify(event)}\n\n`);
      };

      // 1. Replay historical events in order
      for (const event of history) {
        writeEvent(event);
      }

      // 2. Subscribe to live events
      const unsubscribe = sessionService.subscribeToSessionEvents(id, (event) => {
        writeEvent(event);
      });

      // 3. Clean up on connection close
      req.on('close', () => {
        unsubscribe();
      });
    } catch (error) {
      next(error);
    }
  };
}

export const sessionController = new SessionController();
