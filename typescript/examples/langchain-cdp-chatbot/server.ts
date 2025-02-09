import express from "express";
import { createServer } from "http";
import path from "path";
import { Agent } from "./chatbot";
import multer from "multer";
import axios from "axios";
import FormData from "form-data";
import cors from "cors";

// Validate required environment variables
const REQUIRED_ENV_VARS = [
  "PINATA_JWT",
  "PINATA_GATEWAY",
  "OPENAI_API_KEY",
  "PROD_CDP_API_KEY_NAME",
  "PROD_CDP_API_KEY_PRIVATE_KEY",
];

REQUIRED_ENV_VARS.forEach(varName => {
  if (!process.env[varName]) {
    throw new Error(`Required environment variable ${varName} is not set`);
  }
});

// Create Express app
export const app = express();
const httpServer = createServer(app);

// Configure CORS
const corsOptions = {
  origin: true, // Reflects the request origin
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
  credentials: true,
  maxAge: 86400,
};

app.use(cors(corsOptions));
app.use(express.json());

// Serve static files
const publicPath = path.join(__dirname, "public");
app.use(express.static(publicPath));

// Fallback route for SPA
app.get("*", (req, res, next) => {
  if (req.path.startsWith("/api/") || req.path === "/health") {
    next();
  } else {
    res.sendFile(path.join(publicPath, "index.html"));
  }
});

// Configure multer for file uploads
const upload = multer({
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB limit
  },
  fileFilter: (req, file, cb) => {
    if (!file.originalname.match(/\.(jpg|jpeg|png|gif)$/)) {
      return cb(new Error("Only image files are allowed!"));
    }
    cb(null, true);
  },
});

// Initialize agent pool with cleanup
const agentPool: { [key: string]: { agent: Agent; lastAccessed: number } } = {};

// Cleanup inactive agents every 30 minutes
setInterval(() => {
  const now = Date.now();
  Object.entries(agentPool).forEach(([sessionId, data]) => {
    if (now - data.lastAccessed > 30 * 60 * 1000) {
      delete agentPool[sessionId];
    }
  });
}, 30 * 60 * 1000);

// Chat endpoint
app.post("/api/chat", async (req, res) => {
  try {
    const { message, sessionId } = req.body;

    if (!message) {
      return res.status(400).json({ error: "Message is required" });
    }

    if (!agentPool[sessionId]) {
      agentPool[sessionId] = {
        agent: new Agent(),
        lastAccessed: Date.now(),
      };
    } else {
      agentPool[sessionId].lastAccessed = Date.now();
    }

    const response = await agentPool[sessionId].agent.chat(message);
    res.json({ response });
  } catch (error) {
    console.error("Error in chat endpoint:", error);
    res.status(500).json({
      error: "An error occurred while processing your request",
      details: error instanceof Error ? error.message : "Unknown error",
    });
  }
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

    const metadata = JSON.stringify({
      name: req.file.originalname,
      keyvalues: {
        app: "BidToEarn",
        type: "nft-image",
      },
    });
    formData.append("pinataMetadata", metadata);

    const options = JSON.stringify({
      cidVersion: 1,
      wrapWithDirectory: false,
    });
    formData.append("pinataOptions", options);

    const response = await axios.post("https://api.pinata.cloud/pinning/pinFileToIPFS", formData, {
      maxBodyLength: Infinity,
      headers: {
        Authorization: `Bearer ${process.env.PINATA_JWT}`,
        ...formData.getHeaders(),
      },
    });

    const ipfsHash = response.data.IpfsHash;
    const gatewayUrl = `https://${process.env.PINATA_GATEWAY}/ipfs/${ipfsHash}`;
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
        Authorization: `Bearer ${process.env.PINATA_JWT}`,
        "Content-Type": "application/json",
      },
    });

    const ipfsHash = response.data.IpfsHash;
    const gatewayUrl = `https://${process.env.PINATA_GATEWAY}/ipfs/${ipfsHash}`;
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

// Health check endpoint
app.get("/health", async (req, res) => {
  try {
    const agent = new Agent();
    const health = await agent.getHealth();
    res.status(health.status === "healthy" ? 200 : 503).json(health);
  } catch (error) {
    res.status(500).json({
      status: "failed",
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
});

// Start server if not in serverless environment
if (!process.env.VERCEL) {
  const PORT = parseInt(process.env.PORT || "3000", 10);
  httpServer.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

// Export for serverless
export default app;
