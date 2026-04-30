export const ErrorCode = {
  INVALID_NAME:    'INVALID_NAME',
  INVALID_ICON:    'INVALID_ICON',
  CODE_REQUIRED:   'CODE_REQUIRED',
  GROUP_NOT_FOUND: 'GROUP_NOT_FOUND',
  SERVER_ERROR:    'SERVER_ERROR',
}

const ErrorStatus = {
  [ErrorCode.INVALID_NAME]:    400,
  [ErrorCode.INVALID_ICON]:    400,
  [ErrorCode.CODE_REQUIRED]:   400,
  [ErrorCode.GROUP_NOT_FOUND]: 404,
  [ErrorCode.SERVER_ERROR]:    500,
}

export function makeError(code, message) {
  return { code, message, status: ErrorStatus[code] ?? 500 }
}
