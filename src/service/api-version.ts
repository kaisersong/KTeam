/** Pure IPC/HTTP version contract; clients must not import the host implementation. */
export const API_VERSION=1;
export const SCHEMA_VERSION=1;
export function versionHeaders(){return {'x-kteam-api-version':String(API_VERSION),'x-kteam-schema-version':String(SCHEMA_VERSION)};}
