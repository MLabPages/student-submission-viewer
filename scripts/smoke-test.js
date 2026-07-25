'use strict';

const assert = require('assert');
const path = require('path');

process.env.PORT = '0';
process.env.LOCALAPPDATA = path.join(__dirname, '..', 'tmp', 'smoke-data');
const { startServer, stopServer } = require('../server');

(async () => {
  const { url, port } = await startServer();
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

    const statusResponse = await fetch(`${url}/api/status`);
    assert.strictEqual(statusResponse.status, 200);
    const status = await statusResponse.json();
    assert.ok(Array.isArray(status.files));

    console.log(`Smoke test passed: ${url}`);
  } finally {
    await stopServer();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
