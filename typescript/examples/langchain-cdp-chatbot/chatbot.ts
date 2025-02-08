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
import { initializeAgentExecutorWithOptions } from "langchain/agents";
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
  const isProd = process.env.NODE_ENV === 'production';
  const requiredVars = [
    'OPENAI_API_KEY',
    isProd ? 'PROD_CDP_API_KEY_NAME' : 'DEV_CDP_API_KEY_NAME',
    isProd ? 'PROD_CDP_API_KEY_PRIVATE_KEY' : 'DEV_CDP_API_KEY_PRIVATE_KEY',
    'WALLET_TYPE'
  ];

  requiredVars.forEach(varName => {
    if (!process.env[varName]) {
      missingVars.push(varName);
    }
  });

  // Exit if any required variables are missing
  if (missingVars.length > 0) {
    console.error('Error: Required environment variables are not set');
    missingVars.forEach(varName => {
      console.error(`${varName}=your_${varName.toLowerCase()}_here`);
    });
    process.exit(1);
  }

  // Warn about optional NETWORK_ID
  if (!process.env.NETWORK_ID) {
    const defaultNetwork = isProd ? 'base-mainnet' : 'base-sepolia';
    console.warn(`Warning: NETWORK_ID not set, defaulting to ${defaultNetwork}`);
  }
}

// Add this right after imports and before any other code
validateEnvironment();

// Configure a file to persist the agent's CDP MPC Wallet Data
const WALLET_DATA_FILE = process.env.NODE_ENV === 'production' ? 'prod_wallet_data.txt' : 'dev_wallet_data.txt';

/**
 * Initialize the agent with CDP Agentkit
 *
 * @returns Agent executor and config
 */
async function initializeAgent() {
  try {
    // Initialize LLM
    const llm = new ChatOpenAI({
      modelName: "gpt-4",
      temperature: 0,
    });

    const isProd = process.env.NODE_ENV === 'production';
    
    // Configure CDP Wallet Provider with environment-specific settings
    const config: {
      apiKeyName: string | undefined;
      apiKeyPrivateKey: string | undefined;
      networkId: string;
      mnemonicPhrase?: string;
      cdpWalletData?: string;
    } = {
      apiKeyName: isProd ? process.env.PROD_CDP_API_KEY_NAME : process.env.DEV_CDP_API_KEY_NAME,
      apiKeyPrivateKey: (isProd ? process.env.PROD_CDP_API_KEY_PRIVATE_KEY : process.env.DEV_CDP_API_KEY_PRIVATE_KEY)?.replace(/\\n/g, "\n"),
      networkId: process.env.NETWORK_ID || (isProd ? 'base-mainnet' : 'base-sepolia'),
      mnemonicPhrase: process.env.MNEMONIC_PHRASE, // Optional: For importing existing wallets
    };

    let walletProvider;
    
    try {
      if (process.env.CDP_WALLET_DATA) {
        // If wallet data exists, use it
        config.cdpWalletData = process.env.CDP_WALLET_DATA;
        walletProvider = await CdpWalletProvider.configureWithWallet(config);
        console.log('Successfully initialized existing CDP wallet');
      } else {
        // First time setup - create a new wallet and log the data
        walletProvider = await CdpWalletProvider.configureWithWallet(config);
        const exportedWallet = await walletProvider.exportWallet();
        console.log('\n=== IMPORTANT: NEW WALLET CREATED ===');
        console.log('Add this to your Vercel environment variables:');
        console.log('CDP_WALLET_DATA=' + JSON.stringify(exportedWallet));
        console.log('=====================================\n');
        
        if (isProd) {
          console.log('⚠️  Production deployment detected without CDP_WALLET_DATA');
          console.log('Please:');
          console.log('1. Copy the CDP_WALLET_DATA value above');
          console.log('2. Add it to your Vercel environment variables');
          console.log('3. Redeploy the application');
          process.exit(1); // Stop deployment until wallet data is configured
        }
      }
    } catch (error) {
      console.error('Failed to initialize CDP wallet:', error);
      throw error;
    }

    // Initialize BidToEarn provider
    const bidToEarnProvider = new BidToEarnProvider(walletProvider);

    // Initialize AgentKit with configured providers
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

    const tools = await getLangChainTools(agentkit);

    // Initialize the agent executor with proper prompt template
    const executor = await initializeAgentExecutorWithOptions(tools as unknown as StructuredTool[], llm, {
      agentType: "structured-chat-zero-shot-react-description",
      verbose: false,
      handleParsingErrors: true,
      maxIterations: 3,
      returnIntermediateSteps: false,
    });

    const agentConfig = { configurable: { thread_id: "CDP AgentKit Chatbot Example!" } };

    // Save the latest wallet data to environment if it has changed
    const exportedWallet = await walletProvider.exportWallet();
    const currentWalletData = process.env.CDP_WALLET_DATA ? JSON.parse(process.env.CDP_WALLET_DATA) : null;
    
    // Compare stringified versions to ensure proper comparison
    if (JSON.stringify(exportedWallet) !== JSON.stringify(currentWalletData)) {
      // In production, implement secure storage (e.g., environment variables in your hosting platform)
      if (isProd) {
        console.log('Production environment detected - update CDP_WALLET_DATA in your hosting platform');
        console.log('New wallet data:', JSON.stringify(exportedWallet));
      } else {
        // For development, you might want to update your local .env file
        console.log('Development environment - update CDP_WALLET_DATA in your .env file with:');
        console.log('CDP_WALLET_DATA=' + JSON.stringify(exportedWallet));
      }
    }

    return { agent: executor, config: agentConfig };
  } catch (error) {
    console.error("Failed to initialize agent:", error);
    throw error;
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
   - Reserve price mechanism

Common earnings-related queries I can help with:
- "Show my withdrawable amount" - I'll check how much ETH you can withdraw
- "Withdraw my funds" - I'll help you withdraw your available funds directly
- "What are my auction earnings?" - I'll show proceeds from your auctions
- "Track my royalty earnings" - I'll show your royalty earnings from past sales

When users ask about earnings:
1. Check their pending withdrawals first
2. Look up their auction history
3. Calculate total earnings including royalties
4. Guide them through the withdrawal process if needed

For withdrawals:
1. First check available amount with "show my withdrawable amount"
2. If funds are available, use "withdraw my funds" to process the withdrawal
3. The withdrawal will be processed directly through our interface
4. No need to visit Basescan or interact with the contract directly

Always explain the earning opportunities:
- Sellers earn sale proceeds minus 2.5% platform fee
- Creators earn up to 10% royalties on sales
- Outbid bidders can withdraw their funds immediately
- All earnings can be withdrawn directly through our interface

Remember to:
- Proactively mention the auto-refund system when discussing bidding
- Highlight the low 2.5% platform fee compared to other platforms
- Explain how the reserve price can help maximize earnings
- Guide users to withdraw available funds when detected

Use emojis and be enthusiastic about earning opportunities, but maintain professionalism. Handle errors gracefully and always provide clear next steps.`;

    this.initializeAgent().catch(error => {
      console.error('Error initializing agent:', error);
      throw error;
    });
  }

  private async initializeAgent() {
    try {
      const { agent, config } = await initializeAgent();
      this.executor = agent;
      this.config = config;
    } catch (error) {
      console.error('Error initializing agent:', error);
      throw error;
    }
  }

  public async chat(message: string): Promise<string> {
    try {
      if (!this.executor) {
        throw new Error('Agent not initialized');
      }
      
      const result = await this.executor.invoke({
        input: message,
        config: {
          ...this.config,
          systemMessage: this.systemMessage,
        },
      });
      
      return result.output;
    } catch (error) {
      console.error('Error in chat:', error);
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
