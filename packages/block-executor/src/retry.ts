export function canRetry(retryCount: number, maxRetries: number): boolean {
  return retryCount < maxRetries;
}
