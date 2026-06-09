// Error code constants that match the server's ErrorCode enum.
// Only codes the server actually emits are listed here — don't add speculative
// codes that the server doesn't send, as they make the contract ambiguous.

export const ErrorCode = {
  INVALID_NAME:    'INVALID_NAME',
  INVALID_ICON:    'INVALID_ICON',
  CODE_REQUIRED:   'CODE_REQUIRED',
  GROUP_NOT_FOUND: 'GROUP_NOT_FOUND',
  GROUP_FULL:      'GROUP_FULL',
  RATE_LIMITED:    'RATE_LIMITED',
  SERVER_ERROR:    'SERVER_ERROR',
}
