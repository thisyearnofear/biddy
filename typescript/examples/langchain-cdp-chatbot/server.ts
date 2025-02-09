import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";
import path from "path";
import { Agent } from "./chatbot";
import multer from "multer";
import axios from "axios";
import FormData from "form-data";

const PINATA_JWT =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySW5mb3JtYXRpb24iOnsiaWQiOiI0MTM4MWIzZC0yMmI4LTQyYjAtODEzMC1jN2NkOGY0NzQzM2UiLCJlbWFpbCI6InBhcGFhbmR0aGVqaW1qYW1zQGdtYWlsLmNvbSIsImVtYWlsX3ZlcmlmaWVkIjp0cnVlLCJwaW5fcG9saWN5Ijp7InJlZ2lvbnMiOlt7ImRlc2lyZWRSZXBsaWNhdGlvbkNvdW50IjoxLCJpZCI6IkZSQTEifSx7ImRlc2lyZWRSZXBsaWNhdGlvbkNvdW50IjoxLCJpZCI6Ik5ZQzEifV0sInZlcnNpb24iOjF9LCJtZmFfZW5hYmxlZCI6ZmFsc2UsInN0YXR1cyI6IkFDVElWRSJ9LCJhdXRoZW50aWNhdGlvblR5cGUiOiJzY29wZWRLZXkiLCJzY29wZWRLZXlLZXkiOiJjOGYzOWIxYTJiZWQ5NjI5Nzk3ZSIsInNjb3BlZEtleVNlY3JldCI6IjVmZGExYTUzOGZhOWNjMjZjOTA1MWY4NGQ5NmYzOWVjNWUwODJhMzkwYzY2MDc5OTM5ZjkwYTFhM2ExZWUwOTciLCJleHAiOjE3NTcyNDMwNzV9.hgf9T2vkSd2adVlFlWcr-blWyE6-bDwpt_kAtnOrJMg";
const PINATA_GATEWAY = "brown-continuous-rodent-619.mypinata.cloud";

// Create Express app
export const app = express();
const httpServer = createServer(app);
export const io = new Server(httpServer);

// Configure multer for file uploads
const upload = multer({
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB limit
  },
  fileFilter: (req, file, cb) => {
    // Accept images only
    if (!file.originalname.match(/\.(jpg|jpeg|png|gif)$/)) {
      return cb(new Error("Only image files are allowed!"));
    }
    cb(null, true);
  },
});

// Serve static files from the public directory
app.use(express.static(path.join(__dirname, "public")));
app.use(express.json());

// Serve the main page
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

// Upload to IPFS via Pinata
app.post("/api/upload", upload.single("file"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "No file uploaded" });
    }

    const formData = new FormData();
    formData.append("file", req.file.buffer, {
      filename: req.file.originalname,
      contentType: req.file.mimetype,
    });

    // Add pinata metadata
    const metadata = JSON.stringify({
      name: req.file.originalname,
      keyvalues: {
        app: "BidToEarn",
        type: "nft-image",
      },
    });
    formData.append("pinataMetadata", metadata);

    // Add pinata options
    const options = JSON.stringify({
      cidVersion: 1,
      wrapWithDirectory: false,
    });
    formData.append("pinataOptions", options);

    // Upload to Pinata
    const response = await axios.post("https://api.pinata.cloud/pinning/pinFileToIPFS", formData, {
      maxBodyLength: Infinity,
      headers: {
        Authorization: `Bearer ${PINATA_JWT}`,
        ...formData.getHeaders(),
      },
    });

    const ipfsHash = response.data.IpfsHash;
    const gatewayUrl = `https://${PINATA_GATEWAY}/ipfs/${ipfsHash}`;
    const ipfsUrl = `ipfs://${ipfsHash}`;

    res.json({
      success: true,
      ipfsUrl,
      gatewayUrl,
      hash: ipfsHash,
    });
  } catch (error) {
    console.error("Error uploading to Pinata:", error);
    res.status(500).json({
      error: "Failed to upload to IPFS",
      details: error instanceof Error ? error.message : "Unknown error",
    });
  }
});

// Upload metadata to IPFS
app.post("/api/upload/metadata", async (req, res) => {
  try {
    const metadata = req.body;
    if (!metadata) {
      return res.status(400).json({ error: "No metadata provided" });
    }

    const response = await axios.post("https://api.pinata.cloud/pinning/pinJSONToIPFS", metadata, {
      headers: {
        Authorization: `Bearer ${PINATA_JWT}`,
        "Content-Type": "application/json",
      },
    });

    const ipfsHash = response.data.IpfsHash;
    const gatewayUrl = `https://${PINATA_GATEWAY}/ipfs/${ipfsHash}`;
    const ipfsUrl = `ipfs://${ipfsHash}`;

    res.json({
      success: true,
      ipfsUrl,
      gatewayUrl,
      hash: ipfsHash,
    });
  } catch (error) {
    console.error("Error uploading metadata to Pinata:", error);
    res.status(500).json({
      error: "Failed to upload metadata to IPFS",
      details: error instanceof Error ? error.message : "Unknown error",
    });
  }
});

// Handle WebSocket connections
io.on("connection", socket => {
  console.log("Client connected");

  // Create a new agent instance for each connection
  const agent = new Agent();

  socket.on("message", async (message: string) => {
    try {
      // Process the message using the agent
      const response = await agent.chat(message);
      socket.emit("response", response);
    } catch (error) {
      console.error("Error processing message:", error);
      socket.emit(
        "error",
        "I encountered an issue while processing your request. Please try again or rephrase your question.",
      );
    }
  });

  socket.on("disconnect", () => {
    console.log("Client disconnected");
  });
});

// Only start the server if we're not in a Netlify Function
if (!process.env.NETLIFY) {
  const PORT = process.env.PORT || 3000;
  httpServer.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
    console.log("Use Ctrl+C to stop the server");
  });
}
