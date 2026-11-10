type Request = (route: string, value?: unknown) => Promise<any>;
const disconnected = (error: any) => ['ENOENT','ECONNREFUSED','ECONNRESET','EPIPE'].includes(error?.code);
const unavailable = (error: any) => disconnected(error) || ['broker_unavailable','kswarm_unavailable','upstream_protocol_unavailable'].includes(error?.code);

/** Recover the connection, never replay a business mutation after a lost receipt. */
export function hostConnection(options: {request: Request; ensureHost: () => Promise<void>; now?: () => number}) {
 const now = options.now ?? Date.now;
 let recovery: Promise<void> | undefined, nextAttempt = 0;
 const reconnect = (force = false) => {
  if (recovery) return recovery;
  if (!force && now() < nextAttempt) return Promise.resolve();
  nextAttempt = now() + 5000;
  recovery = (async () => {
   await options.ensureHost();
   await options.request('/v1/services/ensure', {});
  })().finally(() => { recovery = undefined; nextAttempt = now() + 5000; });
  return recovery;
 };
 return async (route: string, value?: unknown) => {
  if (route === '/v1/services/ensure') {
   await reconnect(true);
   return options.request('/v1/status');
  }
  let result;
  try { result = await options.request(route, value); }
  catch (error) {
   if (value !== undefined || !unavailable(error)) throw error;
   await reconnect();
   result = await options.request(route);
  }
  if (route === '/v1/status' && !result.upstream?.ready) {
   try { await reconnect(); result = await options.request(route); }
   catch { /* Keep the real disconnected status visible; the next poll retries. */ }
  }
  return result;
 };
}
