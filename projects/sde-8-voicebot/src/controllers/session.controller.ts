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
        throw new AppError(`Session with ID '${id}' not found`, 404, 'SESSION_NOT_FOUND', undefined, false);
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
   * POST /api/v1/sessions/:id/start
   */
  public startSession = async (
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    try {
      const { id } = req.params;
      const session = sessionService.startSession(id);

      const response: ApiResponse = {
        success: true,
        message: `Session '${id}' started successfully`,
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
   * POST /api/v1/sessions/:id/fail
   */
  public failSession = async (
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    try {
      const { id } = req.params;
      const { reason } = req.body || {};
      const session = sessionService.failSession(id, reason);

      const response: ApiResponse = {
        success: true,
        message: `Session '${id}' failed`,
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
        throw new AppError(`Session with ID '${id}' not found`, 404, 'SESSION_NOT_FOUND', undefined, false);
      }

      const response: ApiResponse = {
        success: true,
        message: `Session '${id}' deleted successfully`,
        timestamp: new Date().toISOString()
      };

      res.status(200).json(response);
    } catch (error) {
      next(error);
    }
  };

  /**
   * GET /api/v1/sessions/:id/events (Server-Sent Events)
   * Streams ordered lifecycle and context events with historical replay
   */
  public streamSessionEvents = async (
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    try {
      const { id } = req.params;
      const session = sessionService.getSessionById(id);

      if (!session) {
        throw new AppError(`Session with ID '${id}' not found`, 404, 'SESSION_NOT_FOUND', undefined, false);
      }

      // Configure SSE response headers
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      res.flushHeaders();

      // 1. Replay historical events in chronological order
      const history = sessionService.getSessionEvents(id);
      for (const event of history) {
        res.write(`event: ${event.type}\n`);
        res.write(`data: ${JSON.stringify(event)}\n\n`);
      }

      // 2. Subscribe to real-time events
      const unsubscribe = sessionService.subscribeToSessionEvents(id, (event: SessionEvent) => {
        res.write(`event: ${event.type}\n`);
        res.write(`data: ${JSON.stringify(event)}\n\n`);
      });

      // Cleanup on client disconnect
      req.on('close', () => {
        unsubscribe();
        if (typeof res.end === 'function') {
          res.end();
        }
      });
    } catch (error) {
      next(error);
    }
  };
}

export const sessionController = new SessionController();
