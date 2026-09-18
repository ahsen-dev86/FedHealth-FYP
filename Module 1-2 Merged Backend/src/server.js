// backend/src/server.js
// ---------------------------------------------------------------------------
// Process entrypoint: build the app and start listening.
// ---------------------------------------------------------------------------
const { createApp } = require('./app');
const { port } = require('./config');

const app = createApp();

app.listen(port, () => {
  console.log(`[fedhealth] backend API listening on http://localhost:${port}`);
});
