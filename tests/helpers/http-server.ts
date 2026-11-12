import http from 'http';
import type { AddressInfo } from 'net';

export interface Recorded { method: string; url: string; headers: http.IncomingHttpHeaders; body: unknown }

/** A local HTTP server whose reply the test sets per request. */
export async function startServer(reply: (req: Recorded) => { status: number; body?: unknown; delayMs?: number; text?: string }) {
  const requests: Recorded[] = [];
  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (chunk) => { raw += chunk; });
    req.on('end', () => {
      const recorded = { method: req.method ?? '', url: req.url ?? '', headers: req.headers, body: raw ? JSON.parse(raw) : undefined };
      requests.push(recorded);
      const answer = reply(recorded);
      setTimeout(() => {
        if (answer.text !== undefined) {
          res.writeHead(answer.status, { 'content-type': 'text/plain' }).end(answer.text);
          return;
        }
        res.writeHead(answer.status, { 'content-type': 'application/json' }).end(JSON.stringify(answer.body ?? {}));
      }, answer.delayMs ?? 0);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    requests,
    close: () => new Promise<void>((resolve) => { server.closeAllConnections(); server.close(() => resolve()); }),
  };
}
