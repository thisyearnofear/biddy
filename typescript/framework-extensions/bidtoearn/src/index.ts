import { Action, ActionProvider, Network, EvmWalletProvider } from "@coinbase/agentkit";
import { parseEther } from "@ethersproject/units";
import { z } from "zod";
import { Abi, parseAbiItem } from "viem";

const BID_TO_EARN_ABI = [
  parseAbiItem(
    "function createAuction(uint256 minBid, uint256 duration, uint16 extensionTime, uint16 bidIncrementPercentage, tuple(string title, string description, string imageURI, uint96 royaltyPercentage, uint96 reservePrice, bool reservePriceMet) metadata) external",
  ),
  parseAbiItem("function placeBid(uint256 tokenId) external payable"),
  parseAbiItem("function withdraw() external"),
  parseAbiItem(
    "function getAuction(uint256 tokenId) external view returns (tuple(uint256 tokenId, address seller, uint256 minBid, uint256 highestBid, address highestBidder, uint256 endTime, uint256 extensionTime, uint16 minBidIncrementPercentage, bool isActive, bool isEmergency) details, tuple(string title, string description, string imageURI, uint96 royaltyPercentage, uint96 reservePrice, bool reservePriceMet) metadata, address[] bidders)",
  ),
  parseAbiItem("function getUserAuctions(address user) external view returns (uint256[])"),
  parseAbiItem("function getUserBids(address user) external view returns (uint256[])"),
] as const;

const CONTRACT_ADDRESS = "0x7877Ac5C8158AB46ad608CB6990eCcB2A5265718" as const;

// Base Sepolia testnet chainId
const BASE_SEPOLIA_CHAIN_ID = 84532n;

export class BidToEarnProvider extends ActionProvider<EvmWalletProvider> {
  private walletProvider: EvmWalletProvider;

  constructor(walletProvider: EvmWalletProvider) {
    super("BidToEarn", []);
    this.walletProvider = walletProvider;
  }

  getActions(walletProvider: EvmWalletProvider): Action[] {
    const createAuctionSchema = z.object({
      minBid: z.string().describe("Minimum bid amount in ETH"),
      duration: z.number().describe("Duration of auction in seconds"),
      extensionTime: z.number().describe("Time to extend auction when bid is placed near end"),
      bidIncrementPercentage: z.number().describe("Minimum percentage increase for new bids"),
      title: z.string().describe("Title of the NFT"),
      description: z.string().describe("Description of the NFT"),
      imageURI: z.string().describe("URI of the NFT image"),
      royaltyPercentage: z.number().max(1000).describe("Royalty percentage (max 10%)"),
      reservePrice: z.string().describe("Reserve price in ETH"),
    });

    const placeBidSchema = z.object({
      tokenId: z.number().describe("Token ID of the auction"),
      bidAmount: z.string().describe("Bid amount in ETH"),
    });

    const withdrawSchema = z.object({});

    const viewAuctionSchema = z.object({
      tokenId: z.number().describe("Token ID of the auction"),
    });

    const viewUserAuctionsSchema = z.object({
      userAddress: z.string().describe("Address of the user"),
    });

    const viewUserBidsSchema = z.object({
      userAddress: z.string().describe("Address of the user"),
    });

    return [
      {
        name: "createAuction",
        description: "Create a new NFT auction",
        schema: createAuctionSchema,
        invoke: async args => {
          const tx = await this.walletProvider.sendTransaction({
            to: CONTRACT_ADDRESS,
            data: "0x" as `0x${string}`, // TODO: Encode function data
            value: BigInt(0),
          });

          await this.walletProvider.waitForTransactionReceipt(tx);
          return `Created auction with transaction hash: ${tx}`;
        },
      },
      {
        name: "placeBid",
        description: "Place a bid on an active auction",
        schema: placeBidSchema,
        invoke: async args => {
          const tx = await this.walletProvider.sendTransaction({
            to: CONTRACT_ADDRESS,
            data: "0x" as `0x${string}`, // TODO: Encode function data
            value: BigInt(parseEther(args.bidAmount).toString()),
          });

          await this.walletProvider.waitForTransactionReceipt(tx);
          return `Placed bid with transaction hash: ${tx}`;
        },
      },
      {
        name: "withdraw",
        description: "Withdraw available funds from previous bids",
        schema: withdrawSchema,
        invoke: async () => {
          const tx = await this.walletProvider.sendTransaction({
            to: CONTRACT_ADDRESS,
            data: "0x" as `0x${string}`, // TODO: Encode function data
          });

          await this.walletProvider.waitForTransactionReceipt(tx);
          return `Withdrawn funds with transaction hash: ${tx}`;
        },
      },
      {
        name: "viewAuction",
        description: "View details of a specific auction",
        schema: viewAuctionSchema,
        invoke: async args => {
          const result = await this.walletProvider.readContract({
            address: CONTRACT_ADDRESS,
            abi: BID_TO_EARN_ABI as Abi,
            functionName: "getAuction",
            args: [BigInt(args.tokenId)],
          });
          return JSON.stringify(result, null, 2);
        },
      },
      {
        name: "viewUserAuctions",
        description: "View all auctions created by a user",
        schema: viewUserAuctionsSchema,
        invoke: async args => {
          const result = await this.walletProvider.readContract({
            address: CONTRACT_ADDRESS,
            abi: BID_TO_EARN_ABI as Abi,
            functionName: "getUserAuctions",
            args: [args.userAddress as `0x${string}`],
          });
          return JSON.stringify(result, null, 2);
        },
      },
      {
        name: "viewUserBids",
        description: "View all auctions a user has bid on",
        schema: viewUserBidsSchema,
        invoke: async args => {
          const result = await this.walletProvider.readContract({
            address: CONTRACT_ADDRESS,
            abi: BID_TO_EARN_ABI as Abi,
            functionName: "getUserBids",
            args: [args.userAddress as `0x${string}`],
          });
          return JSON.stringify(result, null, 2);
        },
      },
    ];
  }

  supportsNetwork(network: Network): boolean {
    if (!network.chainId) return false;
    return BigInt(network.chainId) === BASE_SEPOLIA_CHAIN_ID;
  }
}
