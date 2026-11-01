import { Request, Response, NextFunction } from 'express';
import { sessionService } from '../services/session.service';
import { AppError } from '../middleware/error.middleware';
import { ApiResponse } from '../types/common.types';
import { SessionStatus } from '../types/session.types';

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
   * PATCH /api/v1/sessions/:id/status
   */
  public updateStatus = async (
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    try {
      const { id } = req.params;
      const { status } = req.body as { status: SessionStatus };

      const updated = sessionService.updateSessionStatus(id, status);

      if (!updated) {
        throw new AppError(`Session with ID '${id}' not found`, 404, 'SESSION_NOT_FOUND');
      }

      const response: ApiResponse = {
        success: true,
        message: `Session status updated to '${status}'`,
        data: updated,
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

      if (!updated) {
        throw new AppError(`Session with ID '${id}' not found`, 404, 'SESSION_NOT_FOUND');
      }

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
        message: `Session '${id}' successfully terminated`,
        timestamp: new Date().toISOString()
      };

      res.status(200).json(response);
    } catch (error) {
      next(error);
    }
  };
}

export const sessionController = new SessionController();

