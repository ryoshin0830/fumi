export const MAX_BYTES = 50 * 1024 * 1024;
export const MAX_CONTAINER_BYTES = MAX_BYTES + 2 * 1024 * 1024;
export const MAX_ENCRYPTED_BYTES = 72 * 1024 * 1024;
export const MAX_KEY_BYTES = 1024 * 1024;
export const byteLength = (value) =>
  typeof value === 'string' ? new TextEncoder().encode(value).length : value?.byteLength || 0;
