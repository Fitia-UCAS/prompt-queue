function shouldRetry(error, attempt, maxAttempts) {
  return error?.code === 'E_TEMP' && attempt < maxAttempts;
}

module.exports = { shouldRetry };
