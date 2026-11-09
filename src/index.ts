export { hostRequest } from './service/client.js';
export { startHost, API_VERSION, SCHEMA_VERSION } from './service/server.js';
export { validateL0, intentProjection, intentHash, projection, signatureBytes, signProjection, verifyProjection } from './protocol/aimp.js';
export { canonical, parseJson } from './protocol/json.js';
export type { RoomExternalDiscussionAdapter, RoomExternalDiscussionCapability } from './vendor/xiaok/room-external-discussion.js';
