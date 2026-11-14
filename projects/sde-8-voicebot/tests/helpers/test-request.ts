import http from 'http';
import { Application } from 'express';
import { v4 as uuidv4 } from 'uuid';

export interface TestResponse {
  status: number;
  headers: http.IncomingHttpHeaders;
  body: any;
  text: string;
}

export class TestRequest {
  private method: string = 'GET';
  private path: string = '/';
  private headers: Record<string, string> = {};
  private payload?: any;

  constructor(private app: Application) { }

  public get(path: string): this {
    this.method = 'GET';
    this.path = path;
    return this;
  }

  public post(path: string): this {
    this.method = 'POST';
    this.path = path;
    return this;
  }

  public patch(path: string): this {
    this.method = 'PATCH';
    this.path = path;
    return this;
  }

  public delete(path: string): this {
    this.method = 'DELETE';
    this.path = path;
    return this;
  }

  public set(key: string, value: string): this {
    this.headers[key] = value;
    return this;
  }

  public send(data: any): this {
    this.payload = data;
    return this;
  }

  public async then<TResult1 = TestResponse, TResult2 = never>(
    onfulfilled?: ((value: TestResponse) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | null
  ): Promise<TResult1 | TResult2> {
    try {
      const res = await this.execute();
      return onfulfilled ? onfulfilled(res) : (res as unknown as TResult1);
    } catch (err) {
      if (onrejected) return onrejected(err);
      throw err;
    }
  }

  private execute(): Promise<TestResponse> {
    return new Promise((resolve, reject) => {
      const server = http.createServer(this.app);
      server.unref();

      const pipeId = uuidv4().replace(/-/g, '').slice(0, 8);
      const pipeName =
        process.platform === 'win32'
          ? `\\\\.\\pipe\\test-${pipeId}`
          : `/tmp/test-${pipeId}.sock`;

      server.listen(pipeName, () => {
        let bodyBuffer: Buffer | undefined;
        if (this.payload !== undefined) {
          const bodyStr = typeof this.payload === 'string' ? this.payload : JSON.stringify(this.payload);
          bodyBuffer = Buffer.from(bodyStr);
          this.headers['Content-Type'] = this.headers['Content-Type'] || 'application/json';
          this.headers['Content-Length'] = String(bodyBuffer.length);
        }

        const req = http.request(
          {
            socketPath: pipeName,
            method: this.method,
            path: this.path,
            headers: this.headers
          },
          (res) => {
            let text = '';
            let sseDebounce: NodeJS.Timeout | undefined;

            res.on('data', (chunk) => {
              text += chunk.toString();
              // For SSE streams, wait for all historical replay events to arrive before closing
              if (res.headers['content-type']?.includes('text/event-stream')) {
                if (sseDebounce) {
                  clearTimeout(sseDebounce);
                }
                sseDebounce = setTimeout(() => {
                  req.destroy();
                }, 50);
              }
            });

            let finalized = false;
            const finalize = () => {
              if (finalized) return;
              finalized = true;

              if (sseDebounce) {
                clearTimeout(sseDebounce);
                sseDebounce = undefined;
              }

              try {
                server.close();
              } catch {
                // ignore
              }

              let body: any = {};
              try {
                body = JSON.parse(text);
              } catch {
                body = text;
              }

              setImmediate(() => {
                resolve({
                  status: res.statusCode || 200,
                  headers: res.headers,
                  body,
                  text
                });
              });
            };

            res.on('end', finalize);
            res.on('close', finalize);
          }
        );

        req.on('error', (err) => {
          try {
            server.close();
          } catch {
            // ignore
          }
          reject(err);
        });

        if (bodyBuffer) {
          req.write(bodyBuffer);
        }
        req.end();
      });
    });
  }
}

export const request = (app: Application) => new TestRequest(app);
