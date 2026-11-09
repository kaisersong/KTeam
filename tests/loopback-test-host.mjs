// Test infrastructure only: run the unmodified KSwarm HTTP server on a random
// loopback port. Business routes/state/authorization remain the upstream code.
import { Server } from 'node:net';
const listen = Server.prototype.listen;
Server.prototype.listen = function (...args) {
  if (typeof args[0] === 'number') {
    args[0] = { port: args[0], host: '127.0.0.1' };
    this.once('listening', () => process.send?.({ type: 'test-listening', address: this.address() }));
  }
  return Reflect.apply(listen, this, args);
};
