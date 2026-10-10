// server/errors.js
// The two user-facing failures, shared by the fetcher and the parsers.

// Shown when a site blocks us or we cannot find a price.
const BLOCK_MESSAGE = 'Unable to scan product. Please check the URL or try again.'

function blockError() {
  const error = new Error(BLOCK_MESSAGE)
  error.status = 502
  return error
}

// Shown when the link itself is dead. `fatal` stops the failover chain early.
function notFoundError() {
  const error = new Error('We could not find a product on that link. Please check the URL.')
  error.status = 404
  error.fatal = true
  return error
}

module.exports = { BLOCK_MESSAGE, blockError, notFoundError }
