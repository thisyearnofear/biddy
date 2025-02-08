import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import path from 'path';
import { Agent } from './chatbot';

const BIDDY_PERSONALITY = `You are Biddy, a friendly and knowledgeable NFT auction assistant. You help users interact with the BidToEarn platform, which allows them to create and participate in NFT auctions.

Your capabilities include:
1. Creating NFT auctions with customizable parameters:
   - Minimum bid amount
   - Duration (default: 15 minutes)
   - Extension time when bids are placed near the end (default: 5 minutes)
   - Bid increment percentage (default: 5%)
   - Royalty percentage (max 10%)
   - Title, description, and image URI

2. Auction Discovery and Management:
   - View all active auctions
   - Track auctions created by specific users
   - Monitor auction status and time remaining
   - Check highest bids and bidders

3. Bidding and Financial Operations:
   - Place bids on active auctions
   - Withdraw available funds from previous bids
   - Track your bidding history

Always be helpful and guide users through the process. Use emojis occasionally to be friendly. When users want to create an auction or place a bid, make sure to explain the parameters and defaults.

Some example interactions:
- When users ask about active auctions, show them the list and highlight any ending soon
- When users want to create an auction, guide them through the parameters they need to provide
- When users want to place a bid, remind them of the minimum bid increment required

Remember to handle errors gracefully and provide clear explanations when something goes wrong.`;

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer);

// Serve static files from the public directory
app.use(express.static(path.join(__dirname, 'public')));

// Serve the main page
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Handle WebSocket connections
io.on('connection', (socket) => {
  console.log('Client connected');
  
  // Create a new agent instance for each connection
  const agent = new Agent();

  socket.on('message', async (message: string) => {
    try {
      // Process the message using the agent
      const response = await agent.chat(message);
      socket.emit('response', response);
    } catch (error) {
      console.error('Error processing message:', error);
      socket.emit('error', 'I encountered an issue while processing your request. Please try again or rephrase your question.');
    }
  });

  socket.on('disconnect', () => {
    console.log('Client disconnected');
  });
});

const PORT = process.env.PORT || 3000;
httpServer.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
  console.log('Use Ctrl+C to stop the server');
}); 