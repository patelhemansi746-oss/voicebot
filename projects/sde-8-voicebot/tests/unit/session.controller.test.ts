import { Request, Response, NextFunction } from 'express';
import { sessionController } from '../../src/controllers/session.controller';
import { sessionService } from '../../src/services/session.service';
import { SessionStatus } from '../../src/types/session.types';

describe('SessionController Unit Tests', () => {
  let mockReq: Partial<Request>;
  let mockRes: Partial<Response>;
  let mockNext: NextFunction;
  let jsonOutput: any;
  let statusOutput: number;
  let headersSet: Record<string, string>;

  beforeEach(() => {
    sessionService.clearAllSessions();
    jsonOutput = undefined;
    statusOutput = 200;
    headersSet = {};

    mockRes = {
      status: jest.fn().mockImplementation((code: number) => {
        statusOutput = code;
        return mockRes;
      }),
      json: jest.fn().mockImplementation((data: any) => {
        jsonOutput = data;
        return mockRes;
      }),
      setHeader: jest.fn().mockImplementation((key: string, val: string) => {
        headersSet[key] = val;
        return mockRes;
      }),
      flushHeaders: jest.fn(),
      write: jest.fn()
    };
    mockNext = jest.fn();
  });

  afterEach(() => {
    sessionService.clearAllSessions();
  });

  it('createSession should return 201 with created session', async () => {
    mockReq = {
      body: { userId: 'intern-01' }
    };

    await sessionController.createSession(mockReq as Request, mockRes as Response, mockNext);

    expect(statusOutput).toBe(201);
    expect(jsonOutput.success).toBe(true);
    expect(jsonOutput.data.userId).toBe('intern-01');
  });

  it('createSession should forward error to next on failure', async () => {
    const error = new Error('Creation failure');
    jest.spyOn(sessionService, 'createSession').mockImplementationOnce(() => {
      throw error;
    });

    mockReq = { body: {} };
    await sessionController.createSession(mockReq as Request, mockRes as Response, mockNext);
    expect(mockNext).toHaveBeenCalledWith(error);
  });

  it('getAllSessions should return paginated list', async () => {
    sessionService.createSession({ userId: 'u1' });
    mockReq = {
      query: { page: '1', limit: '10' }
    };

    await sessionController.getAllSessions(mockReq as Request, mockRes as Response, mockNext);

    expect(statusOutput).toBe(200);
    expect(jsonOutput.data.total).toBe(1);
  });

  it('getAllSessions should forward error to next on failure', async () => {
    const error = new Error('DB failure');
    jest.spyOn(sessionService, 'getAllSessions').mockImplementationOnce(() => {
      throw error;
    });

    mockReq = { query: {} };
    await sessionController.getAllSessions(mockReq as Request, mockRes as Response, mockNext);
    expect(mockNext).toHaveBeenCalledWith(error);
  });

  it('getSessionById should return session or forward 404', async () => {
    const created = sessionService.createSession({ userId: 'u1' });
    mockReq = { params: { id: created.id } };

    await sessionController.getSessionById(mockReq as Request, mockRes as Response, mockNext);

    expect(statusOutput).toBe(200);
    expect(jsonOutput.data.id).toBe(created.id);

    // Not found
    mockReq = { params: { id: 'invalid-id' } };
    await sessionController.getSessionById(mockReq as Request, mockRes as Response, mockNext);
    expect(mockNext).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 404 }));
  });

  it('pauseSession should pause session and catch errors', async () => {
    const created = sessionService.createSession({ userId: 'u1' });
    mockReq = { params: { id: created.id } };

    await sessionController.pauseSession(mockReq as Request, mockRes as Response, mockNext);

    expect(statusOutput).toBe(200);
    expect(jsonOutput.data.status).toBe(SessionStatus.PAUSED);

    // Pause on non-existent
    mockReq = { params: { id: 'invalid-id' } };
    await sessionController.pauseSession(mockReq as Request, mockRes as Response, mockNext);
    expect(mockNext).toHaveBeenCalled();
  });

  it('resumeSession should resume session and catch errors', async () => {
    const created = sessionService.createSession({ userId: 'u1' });
    sessionService.pauseSession(created.id);
    mockReq = { params: { id: created.id } };

    await sessionController.resumeSession(mockReq as Request, mockRes as Response, mockNext);

    expect(statusOutput).toBe(200);
    expect(jsonOutput.data.status).toBe(SessionStatus.ACTIVE);

    // Resume on non-existent
    mockReq = { params: { id: 'invalid-id' } };
    await sessionController.resumeSession(mockReq as Request, mockRes as Response, mockNext);
    expect(mockNext).toHaveBeenCalled();
  });

  it('stopSession should stop session and catch errors', async () => {
    const created = sessionService.createSession({ userId: 'u1' });
    mockReq = { params: { id: created.id } };

    await sessionController.stopSession(mockReq as Request, mockRes as Response, mockNext);

    expect(statusOutput).toBe(200);
    expect(jsonOutput.data.status).toBe(SessionStatus.STOPPED);

    // Stop on non-existent
    mockReq = { params: { id: 'invalid-id' } };
    await sessionController.stopSession(mockReq as Request, mockRes as Response, mockNext);
    expect(mockNext).toHaveBeenCalled();
  });

  it('updateContext should update session context and catch errors', async () => {
    const created = sessionService.createSession({ userId: 'u1' });
    mockReq = {
      params: { id: created.id },
      body: { windowTitle: 'Editor' }
    };

    await sessionController.updateContext(mockReq as Request, mockRes as Response, mockNext);

    expect(statusOutput).toBe(200);
    expect(jsonOutput.data.context.windowTitle).toBe('Editor');

    // Context update on non-existent
    mockReq = { params: { id: 'invalid-id' }, body: {} };
    await sessionController.updateContext(mockReq as Request, mockRes as Response, mockNext);
    expect(mockNext).toHaveBeenCalled();
  });

  it('deleteSession should remove session or return 404', async () => {
    const created = sessionService.createSession({ userId: 'u1' });
    mockReq = { params: { id: created.id } };

    await sessionController.deleteSession(mockReq as Request, mockRes as Response, mockNext);
    expect(statusOutput).toBe(200);

    // Delete again should 404
    await sessionController.deleteSession(mockReq as Request, mockRes as Response, mockNext);
    expect(mockNext).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 404 }));
  });

  it('streamSessionEvents should set SSE headers, replay history and handle client close', async () => {
    const session = sessionService.createSession({ userId: 'stream-user' });
    sessionService.pauseSession(session.id);

    let closeHandler: () => void = () => {};
    mockReq = {
      params: { id: session.id },
      on: jest.fn().mockImplementation((event: string, handler: () => void) => {
        if (event === 'close') {
          closeHandler = handler;
        }
        return mockReq;
      })
    };

    await sessionController.streamSessionEvents(mockReq as Request, mockRes as Response, mockNext);

    expect(headersSet['Content-Type']).toBe('text/event-stream');
    expect(mockRes.write).toHaveBeenCalled();

    // Trigger close to test unsubscribe
    closeHandler();

    // Stream on non-existent session
    mockReq = { params: { id: 'invalid-id' } };
    await sessionController.streamSessionEvents(mockReq as Request, mockRes as Response, mockNext);
    expect(mockNext).toHaveBeenCalled();
  });
});
