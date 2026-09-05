/**
 * Lambda-style adapter for the LexIndia Express app (serverless targets).
 *
 * Lives inside the server package so `serverless-http` resolves through
 * server/node_modules; the Netlify function file is a thin re-export and
 * Netlify's bundler traces this require chain to include the dependency.
 */
const serverless = require('serverless-http');
const app = require('./app');

module.exports = { handler: serverless(app) };
