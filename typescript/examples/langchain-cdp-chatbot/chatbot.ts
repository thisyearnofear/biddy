import {
  AgentKit,
  CdpWalletProvider,
  wethActionProvider,
  walletActionProvider,
  erc20ActionProvider,
  cdpApiActionProvider,
  cdpWalletActionProvider,
  pythActionProvider,
} from "@coinbase/agentkit";
import { getLangChainTools } from "@coinbase/agentkit-langchain";
import { HumanMessage } from "@langchain/core/messages";
import { ChatOpenAI } from "@langchain/openai";
import { StructuredTool } from "@langchain/core/tools";
import { AgentExecutor, createStructuredChatAgent } from "langchain/agents";
import { ChatPromptTemplate, MessagesPlaceholder } from "@langchain/core/prompts";
import * as dotenv from "dotenv";
import * as fs from "fs";
import * as readline from "readline";
import { BidToEarnProvider } from "./src/action-providers/bidtoearn";

dotenv.config();

/**
 * Validates that required environment variables are set
 *
 * @throws {Error} - If required environment variables are missing
 * @returns {void}
 */
function validateEnvironment(): void {
  const missingVars: string[] = [];

  // Check required variables based on environment
  const isProd = process.env.NODE_ENV === "production";
  const requiredVars = [
    "OPENAI_API_KEY",
    isProd ? "PROD_CDP_API_KEY_NAME" : "DEV_CDP_API_KEY_NAME",
    isProd ? "PROD_CDP_API_KEY_PRIVATE_KEY" : "DEV_CDP_API_KEY_PRIVATE_KEY",
    "WALLET_TYPE",
  ];

  requiredVars.forEach(varName => {
    if (!process.env[varName]) {
      missingVars.push(varName);
    }
  });

  // Exit if any required variables are missing
  if (missingVars.length > 0) {
    console.error("Error: Required environment variables are not set");
    missingVars.forEach(varName => {
      console.error(`${varName}=your_${varName.toLowerCase()}_here`);
    });
    process.exit(1);
  }

  // Warn about optional NETWORK_ID
  if (!process.env.NETWORK_ID) {
    const defaultNetwork = isProd ? "base-mainnet" : "base-sepolia";
    console.warn(`Warning: NETWORK_ID not set, defaulting to ${defaultNetwork}`);
  }
}

// Add this right after imports and before any other code
validateEnvironment();

// Configure a file to persist the agent's CDP MPC Wallet Data
const WALLET_DATA_FILE =
  process.env.NODE_ENV === "production" ? "prod_wallet_data.txt" : "dev_wallet_data.txt";

/**
 * Initialize the agent with CDP Agentkit
 *
 * @returns Agent executor and config
 */
async function initializeAgent() {
  try {
    // Initialize LLM with production-specific configurations
    const llm = new ChatOpenAI({
      modelName: "gpt-4",
      temperature: 0,
      maxRetries: 3,
      timeout: 60000, // 60 second timeout
    });

    let walletDataStr: string | null = null;
    const isProd = process.env.NODE_ENV === "production";
    const maxRetries = 3;
    let retryCount = 0;

    // Enhanced wallet data reading with retries
    while (retryCount < maxRetries) {
      try {
        if (fs.existsSync(WALLET_DATA_FILE)) {
          walletDataStr = fs.readFileSync(WALLET_DATA_FILE, "utf8");
          break;
        }
      } catch (error) {
        console.error(`Error reading wallet data (attempt ${retryCount + 1}/${maxRetries}):`, error);
        retryCount++;
        if (retryCount === maxRetries) {
          console.warn("Failed to read wallet data after maximum retries, continuing without wallet data");
        } else {
          await new Promise(resolve => setTimeout(resolve, 1000 * retryCount)); // Exponential backoff
        }
      }
    }

    // Enhanced CDP configuration
    const config = {
      apiKeyName: isProd ? process.env.PROD_CDP_API_KEY_NAME : process.env.DEV_CDP_API_KEY_NAME,
      apiKeyPrivateKey: (isProd
        ? process.env.PROD_CDP_API_KEY_PRIVATE_KEY
        : process.env.DEV_CDP_API_KEY_PRIVATE_KEY
      )?.replace(/\\n/g, "\n"),
      cdpWalletData: walletDataStr || undefined,
      networkId: process.env.NETWORK_ID || (isProd ? "base-mainnet" : "base-sepolia"),
      mnemonicPhrase: process.env.MNEMONIC_PHRASE,
      timeout: 30000, // 30 second timeout for wallet operations
      retryConfig: {
        maxRetries: 3,
        initialRetryDelay: 1000,
        maxRetryDelay: 5000,
      },
    };

    console.log(`Initializing wallet provider for ${isProd ? 'production' : 'development'} environment...`);
    const walletProvider = await CdpWalletProvider.configureWithWallet(config);
    console.log('Wallet provider initialized successfully');

    // Initialize BidToEarn provider with enhanced error handling
    console.log('Initializing BidToEarn provider...');
    const bidToEarnProvider = new BidToEarnProvider(walletProvider);
    console.log('BidToEarn provider initialized successfully');

    // Initialize AgentKit with all required providers
    console.log('Initializing AgentKit...');
    const agentkit = await AgentKit.from({
      walletProvider,
      actionProviders: [
        wethActionProvider(),
        pythActionProvider(),
        walletActionProvider(),
        erc20ActionProvider(),
        cdpApiActionProvider({
          apiKeyName: config.apiKeyName,
          apiKeyPrivateKey: config.apiKeyPrivateKey,
        }),
        cdpWalletActionProvider({
          apiKeyName: config.apiKeyName,
          apiKeyPrivateKey: config.apiKeyPrivateKey,
        }),
        bidToEarnProvider,
      ],
    });
    console.log('AgentKit initialized successfully');

    const tools = await getLangChainTools(agentkit);
    console.log(`Loaded ${tools.length} tools successfully`);

    // Enhanced prompt template with more context
    const prompt = ChatPromptTemplate.fromMessages([
      ["system", `You are Biddy, a friendly and knowledgeable NFT auction assistant that helps users earn through the BidToEarn platform. You are running in ${isProd ? 'production' : 'development'} mode on the ${config.networkId} network.`],
      ["system", "You have access to the following tools:\n{tools}\n\nTo use a tool, specify its name: {tool_names}"],
      ["human", "{input}"],
      ["ai", "{agent_scratchpad}"]
    ]);

    // Create agent with enhanced configuration
    const agent = await createStructuredChatAgent({
      llm,
      tools: tools as unknown as StructuredTool[],
      prompt,
    });

    // Configure executor with production-ready settings
    const executor = new AgentExecutor({
      agent,
      tools: tools as unknown as StructuredTool[],
      maxIterations: isProd ? 15 : 10, // More iterations in production
      returnIntermediateSteps: !isProd, // Only show debug steps in development
      verbose: !isProd, // Verbose logging in development only
    });

    const agentConfig = { 
      configurable: { 
        thread_id: `CDP AgentKit ${isProd ? 'Production' : 'Development'} Instance`,
        environment: isProd ? 'production' : 'development',
        network: config.networkId,
      } 
    };

    // Enhanced wallet data persistence
    const exportedWallet = await walletProvider.exportWallet();
    if (isProd) {
      // Production wallet data handling
      try {
        // TODO: Implement secure storage (AWS Secrets Manager, Azure Key Vault, etc.)
        console.log("Production environment detected - implement secure wallet storage");
        // For now, encrypt the wallet data before saving
        const encryptedData = JSON.stringify(exportedWallet); // TODO: Add encryption
        fs.writeFileSync(WALLET_DATA_FILE, encryptedData, { mode: 0o600 }); // Restrictive permissions
      } catch (error) {
        console.error("Error saving wallet data:", error);
        // Continue even if wallet save fails - don't break the agent
      }
    } else {
      fs.writeFileSync(WALLET_DATA_FILE, JSON.stringify(exportedWallet));
    }

    return { agent: executor, config: agentConfig };
  } catch (error) {
    console.error("Failed to initialize agent:", error);
    throw new Error(`Agent initialization failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

/**
 * Run the agent autonomously with specified intervals
 *
 * @param agent - The agent executor
 * @param config - Agent configuration
 * @param interval - Time interval between actions in seconds
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function runAutonomousMode(agent: any, config: any, interval = 10) {
  console.log("Starting autonomous mode...");

  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      const thought =
        "Be creative and do something interesting on the blockchain. " +
        "Choose an action or set of actions and execute it that highlights your abilities.";

      const result = await agent.invoke({
        input: thought,
      });

      console.log("\nResponse:", result.output);
      console.log("-------------------");

      await new Promise(resolve => setTimeout(resolve, interval * 1000));
    } catch (error) {
      if (error instanceof Error) {
        console.error("Error:", error.message);
      }
      process.exit(1);
    }
  }
}

/**
 * Run the agent interactively based on user input
 *
 * @param agent - The agent executor
 * @param config - Agent configuration
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function runChatMode(agent: any, config: any) {
  console.log("Starting chat mode... Type 'exit' to end.");

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const question = (prompt: string): Promise<string> =>
    new Promise(resolve => rl.question(prompt, resolve));

  try {
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const userInput = await question("\nPrompt: ");

      if (userInput.toLowerCase() === "exit") {
        break;
      }

      try {
        const result = await agent.invoke({
          input: userInput,
        });

        console.log("\nResponse:", result.output);
      } catch (error) {
        console.error("Error:", error instanceof Error ? error.message : "Unknown error");
      }
    }
  } catch (error) {
    if (error instanceof Error) {
      console.error("Error:", error.message);
    }
    process.exit(1);
  } finally {
    rl.close();
  }
}

/**
 * Choose whether to run in autonomous or chat mode based on user input
 *
 * @returns Selected mode
 */
async function chooseMode(): Promise<"chat" | "auto"> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const question = (prompt: string): Promise<string> =>
    new Promise(resolve => rl.question(prompt, resolve));

  // eslint-disable-next-line no-constant-condition
  while (true) {
    console.log("\nAvailable modes:");
    console.log("1. chat    - Interactive chat mode");
    console.log("2. auto    - Autonomous action mode");

    const choice = (await question("\nChoose a mode (enter number or name): "))
      .toLowerCase()
      .trim();

    if (choice === "1" || choice === "chat") {
      rl.close();
      return "chat";
    } else if (choice === "2" || choice === "auto") {
      rl.close();
      return "auto";
    }
    console.log("Invalid choice. Please try again.");
  }
}

/**
 * Start the chatbot agent
 */
async function main() {
  try {
    const { agent, config } = await initializeAgent();
    const mode = await chooseMode();

    if (mode === "chat") {
      await runChatMode(agent, config);
    } else {
      await runAutonomousMode(agent, config);
    }
  } catch (error) {
    if (error instanceof Error) {
      console.error("Error:", error.message);
    }
    process.exit(1);
  }
}

// Helper function to initialize wallet provider
async function initializeWalletProvider() {
  const walletData = fs.readFileSync("wallet_data.txt", "utf8");
  return JSON.parse(walletData);
}

export class Agent {
  private executor: any;
  private config: any;
  private systemMessage: string;
  private initialized: boolean = false;
  private initPromise: Promise<void>;
  private initRetries: number = 0;
  private readonly maxInitRetries: number = 3;
  private readonly initRetryDelay: number = 1000;
  private lastError: Error | null = null;
  private healthCheck: {
    lastCheck: number;
    status: 'healthy' | 'degraded' | 'failed';
    error?: string;
  } = {
    lastCheck: Date.now(),
    status: 'healthy'
  };

  constructor() {
    this.systemMessage = `You are Biddy, a friendly and knowledgeable NFT auction assistant that helps users earn through the BidToEarn platform. You specialize in helping users maximize their earnings through NFT auctions.

Your capabilities include:

1. Creating Profitable NFT Auctions:
   - Set optimal minimum bids and reserve prices
   - Configure royalties (up to 10%) for ongoing earnings
   - Recommend auction durations and bid increments
   - Platform fee is only 2.5%

2. Managing Earnings & Withdrawals:
   - Check available withdrawals with "show my withdrawable amount"
   - Withdraw funds directly with "withdraw my funds"
   - Track pending withdrawals and auction proceeds
   - View royalty earnings from past sales

3. Bidding Strategy:
   - Show active auctions with potential for profit
   - Explain minimum bid increments
   - Auto-refund system when outbid
   - Track bidding history and outcomes

4. Smart Contract Features:
   - Automatic refunds when outbid
   - Direct withdrawal through our interface
   - Transparent fee structure
   - Reserve price mechanism`;

    // Start initialization immediately in constructor
    this.initPromise = this.initializeWithRetry().catch(error => {
      console.error("Error initializing agent:", error);
      this.healthCheck.status = 'failed';
      this.healthCheck.error = error instanceof Error ? error.message : 'Unknown error';
      throw error;
    });
  }

  private async initializeWithRetry(): Promise<void> {
    while (this.initRetries < this.maxInitRetries) {
      try {
        const { agent, config } = await initializeAgent();
        this.executor = agent;
        this.config = config;
        this.initialized = true;
        this.healthCheck.status = 'healthy';
        this.healthCheck.lastCheck = Date.now();
        return;
      } catch (error) {
        this.initRetries++;
        this.lastError = error instanceof Error ? error : new Error('Unknown error during initialization');
        this.healthCheck.status = 'degraded';
        this.healthCheck.error = this.lastError.message;
        
        if (this.initRetries === this.maxInitRetries) {
          throw new Error(`Failed to initialize agent after ${this.maxInitRetries} attempts: ${this.lastError.message}`);
        }
        
        // Exponential backoff
        await new Promise(resolve => setTimeout(resolve, this.initRetryDelay * Math.pow(2, this.initRetries - 1)));
      }
    }
  }

  public async getHealth(): Promise<typeof this.healthCheck> {
    return this.healthCheck;
  }

  private async reinitializeIfNeeded(): Promise<void> {
    const now = Date.now();
    const hoursSinceLastCheck = (now - this.healthCheck.lastCheck) / (1000 * 60 * 60);
    
    // Reinitialize if it's been more than 12 hours or if status is degraded
    if (hoursSinceLastCheck > 12 || this.healthCheck.status === 'degraded') {
      this.initialized = false;
      this.initRetries = 0;
      this.initPromise = this.initializeWithRetry();
      await this.initPromise;
    }
  }

  public async chat(message: string): Promise<string> {
    try {
      // Wait for initialization and check health
      await this.initPromise;
      await this.reinitializeIfNeeded();
      
      if (!this.initialized || !this.executor) {
        throw new Error("Agent not initialized");
      }

      const startTime = Date.now();
      const result = await this.executor.invoke({
        input: message,
        config: {
          ...this.config,
          systemMessage: this.systemMessage,
        },
      });

      // Update health check after successful operation
      this.healthCheck.lastCheck = Date.now();
      this.healthCheck.status = 'healthy';
      delete this.healthCheck.error;

      // Log performance metrics in development
      if (process.env.NODE_ENV !== 'production') {
        const duration = Date.now() - startTime;
        console.log(`Chat request completed in ${duration}ms`);
        if (result.intermediateSteps) {
          console.log("Debug - Intermediate steps:", JSON.stringify(result.intermediateSteps, null, 2));
        }
      }

      return result.output;
    } catch (error: unknown) {
      console.error("Error in chat:", error);
      
      // Update health check on error
      this.healthCheck.status = 'degraded';
      this.healthCheck.error = error instanceof Error ? error.message : 'Unknown error';
      
      if (error instanceof Error) {
        if (error.message.includes("max iterations")) {
          return "I apologize, but I wasn't able to complete your request within the allowed number of steps. Could you please try rephrasing your request or breaking it down into smaller parts?";
        } else if (error.message.includes("Agent not initialized")) {
          return "I'm currently experiencing technical difficulties. Please try again in a few moments while I reinitialize.";
        }
      }
      
      throw error;
    }
  }
}

// If running directly (not imported)
if (require.main === module) {
  console.log("Starting Agent...");
  main().catch(error => {
    console.error("Fatal error:", error);
    process.exit(1);
  });
}
