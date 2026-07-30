'use strict';

const assert = require('assert');
const fsp = require('fs').promises;
const path = require('path');

process.env.PORT = '0';
process.env.LOCALAPPDATA = path.join(__dirname, '..', 'tmp', 'smoke-data');
const { startServer, stopServer } = require('../server');

(async () => {
  const { url, port } = await startServer();
  const fixtureRoot = path.join(__dirname, '..', 'tmp', 'smoke-images');
  try {
    assert.ok(port > 0, 'A local port was not assigned.');

    const healthResponse = await fetch(`${url}/api/health`);
    assert.strictEqual(healthResponse.status, 200);
    const health = await healthResponse.json();
    assert.strictEqual(health.app, 'student-submission-viewer');

    const pageResponse = await fetch(url);
    assert.strictEqual(pageResponse.status, 200);
    const page = await pageResponse.text();
    assert.ok(page.includes('id="thumbnailView"'), 'Thumbnail switch is missing.');
    assert.ok(page.includes('id="conversionProgress"'), 'Conversion progress is missing.');
    assert.ok(page.includes('id="fileSplitter"'), 'Resizable panel splitter is missing.');
    assert.ok(page.includes('id="galleryMode"'), 'Gallery mode switch is missing.');
    assert.ok(page.includes('id="needsReview"'), 'Manual-review filter is missing.');
    assert.ok(page.includes('id="notesToggle"'), 'Notes visibility toggle is missing.');

    const statusResponse = await fetch(`${url}/api/status`);
    assert.strictEqual(statusResponse.status, 200);
    const status = await statusResponse.json();
    assert.ok(Array.isArray(status.files));

    await fsp.rm(fixtureRoot, { recursive: true, force: true });
    await fsp.mkdir(fixtureRoot, { recursive: true });
    await fsp.writeFile(path.join(fixtureRoot, 'sample.png'), Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAF/gL+X5WwWQAAAABJRU5ErkJggg==',
      'base64'
    ));
    await fsp.writeFile(path.join(fixtureRoot, 'sample.jpg'), Buffer.from(
      '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////2wBDAf//////////////////////////////////////////////////////////////////////////////////////wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAX/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIQAxAAAAEf/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABBQJ//8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAwEBPwF//8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAgEBPwF//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQAGPwJ//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPyF//9oADAMBAAIAAwAAABAf/8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAwEBPxB//8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAgEBPxB//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxB//9k=',
      'base64'
    ));
    await fsp.writeFile(path.join(fixtureRoot, 'unreadable.pages'), 'unsupported fixture');
    await fsp.writeFile(path.join(fixtureRoot, 'sample.gdoc'), JSON.stringify({
      url: 'https://docs.google.com/document/d/example-id/edit'
    }));

    const scanResponse = await fetch(`${url}/api/scan`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ folder: fixtureRoot, recursive: true })
    });
    assert.strictEqual(scanResponse.status, 200);
    const scan = await scanResponse.json();
    assert.deepStrictEqual(scan.files.map((file) => file.ext).sort(), ['.gdoc', '.jpg', '.pages', '.png']);
    assert.strictEqual(scan.files.filter((file) => file.status === 'ready').length, 2);
    assert.strictEqual(scan.files.filter((file) => file.status === 'unsupported').length, 1);
    assert.strictEqual(scan.files.filter((file) => file.status === 'online').length, 1);

    for (const file of scan.files.filter((item) => item.status === 'ready')) {
      const previewResponse = await fetch(`${url}/api/preview/${file.id}`);
      assert.strictEqual(previewResponse.status, 200);
      assert.strictEqual(previewResponse.headers.get('content-type'), file.ext === '.png' ? 'image/png' : 'image/jpeg');
    }
    const unsupported = scan.files.find((file) => file.status === 'unsupported');
    const unsupportedResponse = await fetch(`${url}/api/preview/${unsupported.id}`);
    assert.strictEqual(unsupportedResponse.status, 415);
    const googleFile = scan.files.find((file) => file.status === 'online');
    const googleResponse = await fetch(`${url}/api/preview/${googleFile.id}`);
    assert.strictEqual(googleResponse.status, 409);

    console.log(`Smoke test passed: ${url}`);
  } finally {
    await stopServer();
    await fsp.rm(fixtureRoot, { recursive: true, force: true });
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
