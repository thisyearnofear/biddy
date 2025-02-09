import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";
import path from "path";
import { Agent } from "./chatbot";
import multer from "multer";
import axios from "axios";
import FormData from "form-data";
import * as dotenv from "dotenv";

dotenv.config();

// Validate environment variables
function checkEnvironmentVariables(): { isValid: boolean; missingVars: string[]; isProd: boolean } {
  const isProd = process.env.NODE_ENV === "production";

  // For initial deployment, we'll use development credentials in production
  const requiredVars = [
    "OPENAI_API_KEY",
    "DEV_CDP_API_KEY_NAME", // Use DEV in both environments initially
    "DEV_CDP_API_KEY_PRIVATE_KEY", // Use DEV in both environments initially
    "NETWORK_ID",
    "WALLET_TYPE",
  ];

  const missingVars = requiredVars.filter(varName => !process.env[varName]);

  // If we're in production and using development credentials, copy them to production variables
  if (isProd) {
    if (process.env.DEV_CDP_API_KEY_NAME && !process.env.PROD_CDP_API_KEY_NAME) {
      process.env.PROD_CDP_API_KEY_NAME = process.env.DEV_CDP_API_KEY_NAME;
    }
    if (process.env.DEV_CDP_API_KEY_PRIVATE_KEY && !process.env.PROD_CDP_API_KEY_PRIVATE_KEY) {
      process.env.PROD_CDP_API_KEY_PRIVATE_KEY = process.env.DEV_CDP_API_KEY_PRIVATE_KEY;
    }
  }

  // Always return an object with all required properties
  return {
    isValid: missingVars.length === 0,
    missingVars,
    isProd,
  };
}

const PINATA_JWT =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySW5mb3JtYXRpb24iOnsiaWQiOiI0MTM4MWIzZC0yMmI4LTQyYjAtODEzMC1jN2NkOGY0NzQzM2UiLCJlbWFpbCI6InBhcGFhbmR0aGVqaW1qYW1zQGdtYWlsLmNvbSIsImVtYWlsX3ZlcmlmaWVkIjp0cnVlLCJwaW5fcG9saWN5Ijp7InJlZ2lvbnMiOlt7ImRlc2lyZWRSZXBsaWNhdGlvbkNvdW50IjoxLCJpZCI6IkZSQTEifSx7ImRlc2lyZWRSZXBsaWNhdGlvbkNvdW50IjoxLCJpZCI6Ik5ZQzEifV0sInZlcnNpb24iOjF9LCJtZmFfZW5hYmxlZCI6ZmFsc2UsInN0YXR1cyI6IkFDVElWRSJ9LCJhdXRoZW50aWNhdGlvblR5cGUiOiJzY29wZWRLZXkiLCJzY29wZWRLZXlLZXkiOiJjOGYzOWIxYTJiZWQ5NjI5Nzk3ZSIsInNjb3BlZEtleVNlY3JldCI6IjVmZGExYTUzOGZhOWNjMjZjOTA1MWY4NGQ5NmYzOWVjNWUwODJhMzkwYzY2MDc5OTM5ZjkwYTFhM2ExZWUwOTciLCJleHAiOjE3NTcyNDMwNzV9.hgf9T2vkSd2adVlFlWcr-blWyE6-bDwpt_kAtnOrJMg";
const PINATA_GATEWAY = "brown-continuous-rodent-619.mypinata.cloud";

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer);

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

// Health check endpoint
app.get("/health", (_req, res) => {
  const envCheck = checkEnvironmentVariables();
  if (!envCheck.isValid) {
    return res.status(500).json({
      status: "error",
      message: "Missing required environment variables",
      details: {
        missingVariables: envCheck.missingVars,
        environment: envCheck.isProd ? "production" : "development",
        instructions:
          "Please set the following environment variables in your Vercel project settings:",
        variables: envCheck.missingVars
          .map(varName => `${varName}=your_${varName.toLowerCase()}_here`)
          .join("\\n"),
      },
    });
  }
  res.json({
    status: "healthy",
    environment: envCheck.isProd ? "production" : "development",
    usingDevCredentials: envCheck.isProd && !process.env.PROD_CDP_API_KEY_NAME,
  });
});

// Serve the main page
app.get("/", (req, res) => {
  const envCheck = checkEnvironmentVariables();
  if (!envCheck.isValid) {
    return res.sendFile(path.join(__dirname, "public", "setup.html"));
  }
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

// Upload to IPFS via Pinata
app.post("/api/upload", upload.single("file"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, error: "No file uploaded" });
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
        Authorization: `Bearer ${process.env.PINATA_JWT}`,
        ...formData.getHeaders(),
      },
    });

    const ipfsHash = response.data.IpfsHash;
    const gatewayUrl = `https://${process.env.PINATA_GATEWAY}/ipfs/${ipfsHash}`;
    const ipfsUrl = `ipfs://${ipfsHash}`;

    return res.status(200).json({
      success: true,
      ipfsUrl: gatewayUrl,
      ipfsHash,
    });
  } catch (error) {
    console.error("Error uploading to IPFS:", error);
    return res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
});

// Upload metadata to IPFS
app.post("/api/upload/metadata", async (req, res) => {
  try {
    if (!req.body.metadata) {
      return res.status(400).json({ success: false, error: "No metadata provided" });
    }

    const response = await axios.post(
      "https://api.pinata.cloud/pinning/pinJSONToIPFS",
      req.body.metadata,
      {
        headers: {
          Authorization: `Bearer ${process.env.PINATA_JWT}`,
          "Content-Type": "application/json",
        },
      },
    );

    const metadataHash = response.data.IpfsHash;
    const gatewayUrl = `https://${process.env.PINATA_GATEWAY}/ipfs/${metadataHash}`;
    const metadataUrl = `ipfs://${metadataHash}`;

    return res.status(200).json({
      success: true,
      metadataUrl: gatewayUrl,
      metadataHash,
    });
  } catch (error) {
    console.error("Error uploading metadata to IPFS:", error);
    return res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
});

// Handle WebSocket connections
io.on("connection", async socket => {
  console.log("Client connected");

  const envCheck = checkEnvironmentVariables();
  if (!envCheck.isValid) {
    socket.emit("error", {
      type: "ENV_ERROR",
      message: "Missing required environment variables",
      details: {
        missingVariables: envCheck.missingVars,
        instructions:
          "Please set the following environment variables in your Vercel project settings:",
        variables: envCheck.missingVars
          .map(varName => `${varName}=your_${varName.toLowerCase()}_here`)
          .join("\\n"),
      },
    });
    return;
  }

  try {
    // Create a new agent instance for each connection
    const agent = new Agent();

    socket.on("message", async (message: string) => {
      try {
        // Process the message using the agent
        const response = await agent.chat(message);
        socket.emit("response", response);
      } catch (error) {
        console.error("Error processing message:", error);
        socket.emit("error", {
          type: "CHAT_ERROR",
          message: "Error processing your message",
          details: error instanceof Error ? error.message : "Unknown error",
        });
      }
    });

    socket.on("disconnect", () => {
      console.log("Client disconnected");
    });
  } catch (error) {
    console.error("Error initializing agent:", error);
    socket.emit("error", {
      type: "INIT_ERROR",
      message: "Error initializing the chat agent",
      details: error instanceof Error ? error.message : "Unknown error",
    });
  }
});

const PORT = process.env.PORT || 3000;
httpServer.listen(PORT, () => {
  const envCheck = checkEnvironmentVariables();
  if (!envCheck.isValid) {
    console.log("\n=== Environment Setup Required ===");
    console.log(`Environment: ${envCheck.isProd ? "Production" : "Development"}`);
    console.log("Missing required environment variables:");
    envCheck.missingVars.forEach(varName => {
      console.log(`${varName}=your_${varName.toLowerCase()}_here`);
    });
    console.log("\nPlease set these variables in your Vercel project settings.");
    console.log("===============================\n");
  } else if (envCheck.isProd && !process.env.PROD_CDP_API_KEY_NAME) {
    console.log("\n=== Using Development Credentials in Production ===");
    console.log("Note: Currently using development CDP credentials in production.");
    console.log("This is fine for initial testing, but you should set up production");
    console.log("credentials before going live.");
    console.log("===============================\n");
  }
  console.log(`Server running on http://localhost:${PORT}`);
});
