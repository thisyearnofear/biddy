import { Action, ActionProvider, Network, EvmWalletProvider } from '@coinbase/agentkit';
import { parseEther } from '@ethersproject/units';
import { z } from 'zod';
import { Abi, encodeFunctionData } from 'viem';

const BID_TO_EARN_ABI = [
  {
    name: 'createAuction',
    type: 'function',
    stateMutability: 'external',
    inputs: [
      { name: 'minBid', type: 'uint256' },
      { name: 'duration', type: 'uint256' },
      { name: 'extensionTime', type: 'uint16' },
      { name: 'bidIncrementPercentage', type: 'uint16' },
      {
        name: 'metadata',
        type: 'tuple',
        components: [
          { name: 'title', type: 'string' },
          { name: 'description', type: 'string' },
          { name: 'imageURI', type: 'string' },
          { name: 'royaltyPercentage', type: 'uint96' },
          { name: 'reservePrice', type: 'uint96' },
          { name: 'reservePriceMet', type: 'bool' },
        ],
      },
    ],
    outputs: [],
  },
  {
    name: 'placeBid',
    type: 'function',
    stateMutability: 'payable',
    inputs: [{ name: 'tokenId', type: 'uint256' }],
    outputs: [],
  },
  {
    name: 'withdraw',
    type: 'function',
    stateMutability: 'external',
    inputs: [],
    outputs: [],
  },
  {
    name: 'getAuction',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'tokenId', type: 'uint256' }],
    outputs: [
      {
        name: 'details',
        type: 'tuple',
        components: [
          { name: 'tokenId', type: 'uint256' },
          { name: 'seller', type: 'address' },
          { name: 'minBid', type: 'uint256' },
          { name: 'highestBid', type: 'uint256' },
          { name: 'highestBidder', type: 'address' },
          { name: 'endTime', type: 'uint256' },
          { name: 'extensionTime', type: 'uint16' },
          { name: 'minBidIncrementPercentage', type: 'uint16' },
          { name: 'isActive', type: 'bool' },
          { name: 'isEmergency', type: 'bool' },
        ],
      },
      {
        name: 'metadata',
        type: 'tuple',
        components: [
          { name: 'title', type: 'string' },
          { name: 'description', type: 'string' },
          { name: 'imageURI', type: 'string' },
          { name: 'royaltyPercentage', type: 'uint96' },
          { name: 'reservePrice', type: 'uint96' },
          { name: 'reservePriceMet', type: 'bool' },
        ],
      },
      { name: 'bidders', type: 'address[]' },
    ],
  },
  {
    name: 'getUserAuctions',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'user', type: 'address' }],
    outputs: [{ name: '', type: 'uint256[]' }],
  },
  {
    name: 'getUserBids',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'user', type: 'address' }],
    outputs: [{ name: '', type: 'uint256[]' }],
  },
  {
    name: '_tokenIdTracker',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    name: 'pendingWithdrawals',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'user', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
] as const;

const CONTRACT_ADDRESS = '0x7877Ac5C8158AB46ad608CB6990eCcB2A5265718' as const;

// Base Sepolia testnet chainId
const BASE_SEPOLIA_CHAIN_ID = 84532n;

export class BidToEarnProvider extends ActionProvider<EvmWalletProvider> {
  private walletProvider: EvmWalletProvider;

  constructor(walletProvider: EvmWalletProvider) {
    super('BidToEarn', []);
    this.walletProvider = walletProvider;
  }

  getActions(walletProvider: EvmWalletProvider): Action[] {
    const createAuctionSchema = z.object({
      minBid: z.string().describe('Minimum bid amount in ETH'),
      duration: z.number().optional().describe('Duration of auction in seconds (default: 15 minutes)'),
      extensionTime: z.number().optional().describe('Time to extend auction when bid is placed near end (default: 5 minutes)'),
      bidIncrementPercentage: z.number().optional().describe('Minimum percentage increase for new bids (default: 5%)'),
      title: z.string().optional().describe('Title of the NFT (default: "Test NFT Auction")'),
      description: z.string().optional().describe('Description of the NFT (default: "A test NFT auction")'),
      imageURI: z.string().optional().describe('URI of the NFT image (default: placeholder image)'),
      royaltyPercentage: z.number().max(1000).optional().describe('Royalty percentage, max 10% (default: 5%)'),
      reservePrice: z.string().optional().describe('Reserve price in ETH (default: same as minimum bid)'),
    });

    const placeBidSchema = z.object({
      tokenId: z.number().describe('Token ID of the auction'),
      bidAmount: z.string().describe('Bid amount in ETH'),
    });

    const withdrawSchema = z.object({});

    const viewAuctionSchema = z.object({
      tokenId: z.number().describe('Token ID of the auction'),
    });

    const viewUserAuctionsSchema = z.object({
      userAddress: z.string().describe('Address of the user'),
    });

    const viewUserBidsSchema = z.object({
      userAddress: z.string().describe('Address of the user'),
    });

    const viewActiveAuctionsSchema = z.object({
      _dummy: z.string().optional(),
    });

    interface AuctionDetails {
      tokenId: bigint;
      seller: string;
      minBid: bigint;
      highestBid: bigint;
      highestBidder: string;
      endTime: bigint;
      extensionTime: number;
      minBidIncrementPercentage: number;
      isActive: boolean;
      isEmergency: boolean;
    }

    interface AuctionMetadata {
      title: string;
      description: string;
      imageURI: string;
      royaltyPercentage: number;
      reservePrice: bigint;
      reservePriceMet: boolean;
    }

    interface AuctionSummary {
      id: number;
      title: string;
      currentBid: string;
      minBid: string;
      timeLeft: string;
      isActive: boolean;
    }

    // Helper function to format auction details
    const formatAuctionDetails = (details: AuctionDetails, metadata: AuctionMetadata): AuctionSummary => {
      const now = Math.floor(Date.now() / 1000);
      const timeLeft = Number(details.endTime) - now;
      let timeLeftStr: string;
      
      if (timeLeft <= 0) {
        timeLeftStr = 'Ended';
      } else if (timeLeft < 60) {
        timeLeftStr = `${timeLeft}s`;
      } else if (timeLeft < 3600) {
        timeLeftStr = `${Math.floor(timeLeft / 60)}m ${timeLeft % 60}s`;
      } else {
        timeLeftStr = `${Math.floor(timeLeft / 3600)}h ${Math.floor((timeLeft % 3600) / 60)}m`;
      }
      
      return {
        id: Number(details.tokenId),
        title: metadata.title,
        currentBid: details.highestBid ? `${Number(details.highestBid) / 1e18} ETH` : 'No bids',
        minBid: `${Number(details.minBid) / 1e18} ETH`,
        timeLeft: timeLeftStr,
        isActive: details.isActive
      };
    };

    return [
      {
        name: 'createAuction',
        description: 'Create a new NFT auction',
        schema: createAuctionSchema,
        invoke: async (args) => {
          // Set smart defaults
          const duration = args.duration || 15 * 60; // Default 15 minutes
          const extensionTime = args.extensionTime || 5 * 60; // Default 5 minutes
          const bidIncrementPercentage = args.bidIncrementPercentage || 500; // Default 5%
          const royaltyPercentage = args.royaltyPercentage || 500; // Default 5%
          const reservePrice = args.reservePrice || args.minBid; // Default to minBid if not specified

          const data = encodeFunctionData({
            abi: BID_TO_EARN_ABI,
            functionName: 'createAuction',
            args: [
              parseEther(args.minBid),
              BigInt(duration),
              extensionTime,
              bidIncrementPercentage,
              {
                title: args.title || "Test NFT Auction",
                description: args.description || "A test NFT auction",
                imageURI: args.imageURI || "https://placehold.co/600x400?text=Test+NFT",
                royaltyPercentage,
                reservePrice: parseEther(reservePrice),
                reservePriceMet: false,
              },
            ],
          });

          const tx = await this.walletProvider.sendTransaction({
            to: CONTRACT_ADDRESS,
            data,
            value: BigInt(0),
          });

          await this.walletProvider.waitForTransactionReceipt(tx);
          
          // Return a more informative message
          return `Created new auction with the following details:
- Minimum bid: ${args.minBid} ETH
- Duration: ${duration / 60} minutes
- Extension time: ${extensionTime / 60} minutes
- Bid increment: ${bidIncrementPercentage / 100}%
- Royalty: ${royaltyPercentage / 100}%
- Reserve price: ${reservePrice} ETH

Transaction hash: ${tx}`;
        },
      },
      {
        name: 'placeBid',
        description: 'Place a bid on an active auction',
        schema: placeBidSchema,
        invoke: async (args) => {
          const data = encodeFunctionData({
            abi: BID_TO_EARN_ABI,
            functionName: 'placeBid',
            args: [BigInt(args.tokenId)],
          });

          const tx = await this.walletProvider.sendTransaction({
            to: CONTRACT_ADDRESS,
            data,
            value: BigInt(parseEther(args.bidAmount).toString()),
          });

          await this.walletProvider.waitForTransactionReceipt(tx);
          return `Placed bid with transaction hash: ${tx}`;
        },
      },
      {
        name: 'checkWithdrawableAmount',
        description: 'Check how much ETH is available for withdrawal',
        schema: z.object({}),
        invoke: async () => {
          try {
            const address = await this.walletProvider.getAddress();
            const result = await this.walletProvider.readContract({
              address: CONTRACT_ADDRESS,
              abi: BID_TO_EARN_ABI as Abi,
              functionName: 'pendingWithdrawals',
              args: [address as `0x${string}`],
            }) as bigint;

            const amountInEth = Number(result) / 1e18;
            
            if (amountInEth === 0) {
              return "You don't have any funds available for withdrawal at the moment. This could be because:\n" +
                     "• You haven't been outbid in any auctions\n" +
                     "• You haven't earned any auction proceeds yet\n" +
                     "• You've already withdrawn your available funds";
            }

            return `You have ${amountInEth.toFixed(4)} ETH available for withdrawal! 💰\n` +
                   "Would you like me to help you withdraw these funds? Just say 'withdraw my funds' and I'll help you process the withdrawal.";
          } catch (error) {
            console.error('Error checking withdrawable amount:', error);
            return "I encountered an error while checking your withdrawable amount. This could be because you haven't connected your wallet yet.";
          }
        },
      },
      {
        name: 'withdraw',
        description: 'Withdraw available funds from previous bids or auction proceeds',
        schema: z.object({}),
        invoke: async () => {
          try {
            // First check available amount
            const address = await this.walletProvider.getAddress();
            const available = await this.walletProvider.readContract({
              address: CONTRACT_ADDRESS,
              abi: BID_TO_EARN_ABI as Abi,
              functionName: 'pendingWithdrawals',
              args: [address as `0x${string}`],
            }) as bigint;

            if (available === BigInt(0)) {
              return "You don't have any funds available to withdraw at the moment. This could be because:\n" +
                     "• You haven't been outbid in any auctions\n" +
                     "• You haven't earned any auction proceeds yet\n" +
                     "• You've already withdrawn your available funds";
            }

            const amountInEth = Number(available) / 1e18;

            const data = encodeFunctionData({
              abi: BID_TO_EARN_ABI,
              functionName: 'withdraw',
              args: [],
            });

            const tx = await this.walletProvider.sendTransaction({
              to: CONTRACT_ADDRESS,
              data,
              value: BigInt(0),
            });

            await this.walletProvider.waitForTransactionReceipt(tx);
            
            return `Successfully withdrew ${amountInEth.toFixed(4)} ETH! 🎉\n` +
                   `Transaction hash: ${tx}\n\n` +
                   "The funds should appear in your wallet shortly. Is there anything else I can help you with?";
          } catch (error: unknown) {
            console.error('Error withdrawing funds:', error);
            if (error && typeof error === 'object' && 'message' in error && 
                typeof error.message === 'string' && error.message.includes('NoPendingReturns')) {
              return "You don't have any funds available to withdraw at the moment.";
            }
            return "I encountered an error while processing your withdrawal. Please try again or let me know if you need help troubleshooting.";
          }
        },
      },
      {
        name: 'viewAuction',
        description: 'View details of a specific auction',
        schema: viewAuctionSchema,
        invoke: async (args) => {
          const result = await this.walletProvider.readContract({
            address: CONTRACT_ADDRESS,
            abi: BID_TO_EARN_ABI as Abi,
            functionName: 'getAuction',
            args: [BigInt(args.tokenId)],
          });
          return JSON.stringify(result, null, 2);
        },
      },
      {
        name: 'viewUserAuctions',
        description: 'View all auctions created by a user',
        schema: viewUserAuctionsSchema,
        invoke: async (args) => {
          const result = await this.walletProvider.readContract({
            address: CONTRACT_ADDRESS,
            abi: BID_TO_EARN_ABI as Abi,
            functionName: 'getUserAuctions',
            args: [args.userAddress as `0x${string}`],
          });
          return JSON.stringify(result, null, 2);
        },
      },
      {
        name: 'viewUserBids',
        description: 'View all auctions a user has bid on',
        schema: viewUserBidsSchema,
        invoke: async (args) => {
          const result = await this.walletProvider.readContract({
            address: CONTRACT_ADDRESS,
            abi: BID_TO_EARN_ABI as Abi,
            functionName: 'getUserBids',
            args: [args.userAddress as `0x${string}`],
          });
          return JSON.stringify(result, null, 2);
        },
      },
      {
        name: 'viewActiveAuctions',
        description: 'View all active auctions in the system',
        schema: viewActiveAuctionsSchema,
        invoke: async () => {
          try {
            // First get the user's address
            const address = await this.walletProvider.getAddress();
            
            // Get auctions created by the current user
            const userAuctions = await this.walletProvider.readContract({
              address: CONTRACT_ADDRESS,
              abi: BID_TO_EARN_ABI as Abi,
              functionName: 'getUserAuctions',
              args: [address as `0x${string}`],
            }) as bigint[];

            const activeAuctions: AuctionSummary[] = [];

            // Query each auction
            for (const tokenId of userAuctions) {
              try {
                const auctionData = await this.walletProvider.readContract({
                  address: CONTRACT_ADDRESS,
                  abi: BID_TO_EARN_ABI as Abi,
                  functionName: 'getAuction',
                  args: [tokenId],
                }) as [AuctionDetails, AuctionMetadata, string[]];

                if (auctionData) {
                  const [details, metadata] = auctionData;
                  if (details.isActive && !details.isEmergency) {
                    activeAuctions.push(formatAuctionDetails(details, metadata));
                  }
                }
              } catch (error) {
                console.error(`Error fetching auction ${tokenId}:`, error);
              }
            }

            if (activeAuctions.length === 0) {
              return "There are currently no active auctions. You can create a new auction by saying 'Create an auction with minimum bid X ETH'";
            }

            // Sort by time left
            activeAuctions.sort((a, b) => {
              if (a.timeLeft === 'Ended') return 1;
              if (b.timeLeft === 'Ended') return -1;
              const aTime = a.timeLeft.includes('h') ? 
                parseInt(a.timeLeft.split('h')[0]) * 3600 + parseInt(a.timeLeft.split('h')[1].split('m')[0]) * 60 :
                parseInt(a.timeLeft.split('m')[0]) * 60;
              const bTime = b.timeLeft.includes('h') ?
                parseInt(b.timeLeft.split('h')[0]) * 3600 + parseInt(b.timeLeft.split('h')[1].split('m')[0]) * 60 :
                parseInt(b.timeLeft.split('m')[0]) * 60;
              return aTime - bTime;
            });

            const endingSoon = activeAuctions.filter(a => 
              a.timeLeft !== 'Ended' && 
              !a.timeLeft.includes('h')
            );

            // Format a more readable response
            let response = `Found ${activeAuctions.length} active auction(s)\n`;
            if (endingSoon.length > 0) {
              response += `${endingSoon.length} auction(s) ending soon!\n\n`;
            }

            response += "Active auctions:\n";
            activeAuctions.forEach(auction => {
              response += `\n#${auction.id} - ${auction.title}
- Current bid: ${auction.currentBid}
- Minimum bid: ${auction.minBid}
- Time remaining: ${auction.timeLeft}\n`;
            });

            return response;
          } catch (error) {
            console.error('Error fetching auctions:', error);
            return "I encountered an error while fetching the auctions. This could be because you haven't created any auctions yet. You can create a new auction by saying 'Create an auction with minimum bid X ETH'";
          }
        },
      },
    ];
  }

  supportsNetwork(network: Network): boolean {
    if (!network.chainId) return false;
    return BigInt(network.chainId) === BASE_SEPOLIA_CHAIN_ID;
  }
} 