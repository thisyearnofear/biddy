import { Handler, HandlerEvent, HandlerContext, HandlerResponse } from '@netlify/functions';
import serverless from 'serverless-http';
import { app } from '../../server';

interface ServerlessResponse {
  statusCode: number;
  headers?: { [key: string]: string | number | boolean };
  body: string;
  isBase64Encoded?: boolean;
}

// Create handler for Netlify Functions
export const handler: Handler = async (event: HandlerEvent, context: HandlerContext): Promise<HandlerResponse> => {
  // Handle WebSocket upgrade requests
  if (event.headers['upgrade']?.toLowerCase() === 'websocket') {
    return {
      statusCode: 200,
      headers: {
        'Upgrade': 'websocket',
        'Connection': 'Upgrade',
        'Sec-WebSocket-Accept': event.headers['sec-websocket-key'] || '',
        'Sec-WebSocket-Protocol': event.headers['sec-websocket-protocol'] || '',
      },
      body: '',
    };
  }

  // Handle regular HTTP requests
  const handler = serverless(app);
  const result = await handler(event, context) as ServerlessResponse;
  
  // Ensure the response matches HandlerResponse type
  return {
    statusCode: result.statusCode,
    headers: result.headers || {},
    body: result.body,
    ...(result.isBase64Encoded ? { isBase64Encoded: true } : {}),
  };
}; 