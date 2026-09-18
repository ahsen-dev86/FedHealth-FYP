// backend/src/bootstrap.js
// Loads .env before anything else gets required, so every module (like
// db/pool.js) sees the real environment variables instead of falling
// back to defaults. server.js itself is left untouched.
require('dotenv').config();
require('./server');