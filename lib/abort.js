'use strict';

function abortError(signal) {
  if (signal?.reason instanceof Error) return signal.reason;
  const error = new Error('The operation was aborted');
  error.name = 'AbortError';
  return error;
}

function throwIfAborted(signal) {
  if (signal?.aborted) throw abortError(signal);
}

function isAbortError(error, signal) {
  return Boolean(
    signal?.aborted ||
    error?.name === 'AbortError' ||
    error?.code === 'ABORT_ERR',
  );
}

function abortableDelay(ms, signal) {
  throwIfAborted(signal);
  if (!signal) return new Promise((resolve) => setTimeout(resolve, ms));
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(abortError(signal));
    };
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

function withTimeoutSignal(signal, timeoutMs) {
  const timeout = AbortSignal.timeout(timeoutMs);
  return signal ? AbortSignal.any([signal, timeout]) : timeout;
}

module.exports = {
  abortableDelay,
  isAbortError,
  throwIfAborted,
  withTimeoutSignal,
};
