const serverless = require('serverless-http');
const app = require('../../server');

const handler = serverless(app);

// Wrap the express application in the serverless handler
module.exports.handler = async (event, context) => {
    context.callbackWaitsForEmptyEventLoop = false;
    return await handler(event, context);
};

