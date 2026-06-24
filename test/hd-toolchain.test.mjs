import test from 'node:test';
import assert from 'node:assert/strict';

// Plan 1 / Task 1: proves the compiler-only toolchain loads on the supported
// Node runtime. These four packages are devDependencies used only by the
// offline HD compiler under tools/hd-course/ — never by the packaged runtime.
test('compiler dependencies load on the supported Node runtime', async () => {
  const [{ fromArrayBuffer }, proj4, sharp, Ajv] = await Promise.all([
    import('geotiff'),
    import('proj4'),
    import('sharp'),
    import('ajv'),
  ]);
  assert.equal(typeof fromArrayBuffer, 'function');
  assert.equal(typeof proj4.default, 'function');
  assert.equal(typeof sharp.default, 'function');
  assert.equal(typeof Ajv.default, 'function');
});
