const serverless = require('serverless-http');
const app = require('../../server');

// Wrap the express application in the serverless handler
module.exports.handler = serverless(app);
