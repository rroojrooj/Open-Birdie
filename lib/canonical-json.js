'use strict';

function canonicalError(message) {
  const error = new TypeError(`Canonical JSON ${message}`);
  error.code = 'CANONICAL_JSON_INVALID';
  return error;
}

function canonicalStringify(value) {
  const ancestors = new WeakSet();

  function serialize(input) {
    if (input === null) return 'null';
    if (typeof input === 'string') return JSON.stringify(input.normalize('NFC'));
    if (typeof input === 'boolean') return input ? 'true' : 'false';
    if (typeof input === 'number') {
      if (!Number.isFinite(input)) throw canonicalError('requires finite numbers');
      return JSON.stringify(Object.is(input, -0) ? 0 : input);
    }
    if (typeof input !== 'object') {
      throw canonicalError(`does not support ${typeof input} values`);
    }
    if (ancestors.has(input)) throw canonicalError('does not support cyclic values');

    ancestors.add(input);
    let output;
    if (Array.isArray(input)) {
      const entries = [];
      for (let index = 0; index < input.length; index += 1) {
        if (!Object.prototype.hasOwnProperty.call(input, index)) {
          throw canonicalError('does not support sparse arrays');
        }
        entries.push(serialize(input[index]));
      }
      output = `[${entries.join(',')}]`;
    } else {
      const prototype = Object.getPrototypeOf(input);
      if (prototype !== Object.prototype && prototype !== null) {
        throw canonicalError('requires plain objects');
      }
      if (Object.getOwnPropertySymbols(input).some((symbol) =>
        Object.prototype.propertyIsEnumerable.call(input, symbol))) {
        throw canonicalError('does not support symbol keys');
      }
      const normalizedEntries = Object.keys(input).map((key) => ({
        key: key.normalize('NFC'),
        value: input[key],
      }));
      normalizedEntries.sort((left, right) => (
        left.key < right.key ? -1 : left.key > right.key ? 1 : 0
      ));
      for (let index = 1; index < normalizedEntries.length; index += 1) {
        if (normalizedEntries[index - 1].key === normalizedEntries[index].key) {
          throw canonicalError('contains keys that collide after Unicode normalization');
        }
      }
      output = `{${normalizedEntries.map(({ key, value: entry }) =>
        `${JSON.stringify(key)}:${serialize(entry)}`).join(',')}}`;
    }
    ancestors.delete(input);
    return output;
  }

  return serialize(value);
}

function canonicalUtf8(value) {
  return Buffer.from(canonicalStringify(value), 'utf8');
}

module.exports = {
  canonicalStringify,
  canonicalUtf8,
};
