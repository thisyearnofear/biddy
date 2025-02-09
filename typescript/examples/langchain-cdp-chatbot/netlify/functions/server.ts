import { Handler, HandlerEvent, HandlerContext } from '@netlify/functions';
import serverless from 'serverless-http';
import { app } from '../../server';

// Create handler for Netlify Functions
export const handler: Handler = async (event: HandlerEvent, context: HandlerContext) => {
  // Handle WebSocket upgrade requests
  if (event.headers['upgrade']?.toLowerCase() === 'websocket') {
    return {
      statusCode: 200,
      headers: {
        'Upgrade': 'websocket',
        'Connection': 'Upgrade',
        'Sec-WebSocket-Accept': event.headers['sec-websocket-key'],
        'Sec-WebSocket-Protocol': event.headers['sec-websocket-protocol'] || '',
      },
      body: '',
    };
  }

  // Handle regular HTTP requests
  const handler = serverless(app);
  const response = await handler(event, context);
  return response;
}; 