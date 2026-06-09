// Shared error codes sent in join-error and REST error responses.
// The client mirrors these in client/src/errorCodes.js — keep both in sync.

export const ErrorCode = {
  INVALID_NAME:    'INVALID_NAME',
  INVALID_ICON:    'INVALID_ICON',
  CODE_REQUIRED:   'CODE_REQUIRED',
  GROUP_NOT_FOUND: 'GROUP_NOT_FOUND',
  GROUP_FULL:      'GROUP_FULL',
  RATE_LIMITED:    'RATE_LIMITED',
  SERVER_ERROR:    'SERVER_ERROR',
}

// HTTP status for each error code. makeError() uses this mapping so callers
// never need to specify a status — the code alone carries the semantic.
const ErrorStatus = {
  [ErrorCode.INVALID_NAME]:    400,
  [ErrorCode.INVALID_ICON]:    400,
  [ErrorCode.CODE_REQUIRED]:   400,
  [ErrorCode.GROUP_NOT_FOUND]: 404,
  [ErrorCode.GROUP_FULL]:      400,
  [ErrorCode.RATE_LIMITED]:    429,
  [ErrorCode.SERVER_ERROR]:    500,
}

export function makeError(code, message) {
  return { code, message, status: ErrorStatus[code] ?? 500 }
}
