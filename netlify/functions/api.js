/**
 * Netlify Function: LexIndia AI REST API (serverless).
 *
 * Delegates to the Express app via server/src/lambda.js (serverless-http).
 * The SQLite knowledge base is built during the Netlify build step
 * (node server/src/ingest/pipeline.js --skip-network) and shipped with this
 * function via [functions].included_files.
 *
 * Netlify's proxy redirect delivers /api/* here; event.path arrives as the
 * original client path (/api/...), which matches the Express mounts.
 */
module.exports = require('../../server/src/lambda');
