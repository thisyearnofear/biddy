import { ActionProvider, CreateAction, WalletProvider, Network, Action } from "@coinbase/agentkit";
import { Contract, Provider, Signer } from "ethers";
import { parseEther } from "ethers/lib/utils";
import {
  CreateAuctionSchema,
  PlaceBidSchema,
  WithdrawSchema,
  ViewAuctionSchema,
  ViewUserAuctionsSchema,
  ViewUserBidsSchema,
} from "./schemas";

const BID_TO_EARN_ABI = [
  "function createAuction(uint256 minBid, uint256 duration, uint16 extensionTime, uint16 bidIncrementPercentage, tuple(string title, string description, string imageURI, uint96 royaltyPercentage, uint96 reservePrice, bool reservePriceMet) metadata) external",
  "function placeBid(uint256 tokenId) external payable",
  "function withdraw() external",
  "function getAuction(uint256 tokenId) external view returns (tuple(uint256 tokenId, address seller, uint256 minBid, uint256 highestBid, address highestBidder, uint256 endTime, uint256 extensionTime, uint16 minBidIncrementPercentage, bool isActive, bool isEmergency) details, tuple(string title, string description, string imageURI, uint96 royaltyPercentage, uint96 reservePrice, bool reservePriceMet) metadata, address[] bidders)",
  "function getUserAuctions(address user) external view returns (uint256[])",
  "function getUserBids(address user) external view returns (uint256[])",
];

const CONTRACT_ADDRESS = "0x7877Ac5C8158AB46ad608CB6990eCcB2A5265718";

export class BidToEarnProvider extends ActionProvider<WalletProvider> {
  private contract: Contract;
  public readonly name = "BidToEarn";

  constructor(provider: Provider, signer: Signer) {
    super(provider, signer);
    this.contract = new Contract(CONTRACT_ADDRESS, BID_TO_EARN_ABI, signer);
  }

  getActions(walletProvider: WalletProvider): Action[] {
    return [
      CreateAuctionSchema,
      PlaceBidSchema,
      WithdrawSchema,
      ViewAuctionSchema,
      ViewUserAuctionsSchema,
      ViewUserBidsSchema,
    ];
  }

  supportsNetwork(network: Network): boolean {
    // Base Sepolia testnet
    return network.chainId === 84532;
  }

  async execute(action: typeof CreateAction): Promise<string> {
    switch (action.name) {
      case "createAuction": {
        const {
          minBid,
          duration,
          extensionTime,
          bidIncrementPercentage,
          title,
          description,
          imageURI,
          royaltyPercentage,
          reservePrice,
        } = action.parameters;
        const tx = await this.contract.createAuction(
          parseEther(minBid),
          duration,
          extensionTime,
          bidIncrementPercentage,
          {
            title,
            description,
            imageURI,
            royaltyPercentage,
            reservePrice: parseEther(reservePrice),
            reservePriceMet: false,
          },
        );
        await tx.wait();
        return `Created auction with transaction hash: ${tx.hash}`;
      }

      case "placeBid": {
        const { tokenId, bidAmount } = action.parameters;
        const tx = await this.contract.placeBid(tokenId, {
          value: parseEther(bidAmount),
        });
        await tx.wait();
        return `Placed bid with transaction hash: ${tx.hash}`;
      }

      case "withdraw": {
        const tx = await this.contract.withdraw();
        await tx.wait();
        return `Withdrawn funds with transaction hash: ${tx.hash}`;
      }

      case "viewAuction": {
        const { tokenId } = action.parameters;
        const [details, metadata, bidders] = await this.contract.getAuction(tokenId);
        return JSON.stringify({ details, metadata, bidders }, null, 2);
      }

      case "viewUserAuctions": {
        const { userAddress } = action.parameters;
        const auctions = await this.contract.getUserAuctions(userAddress);
        return JSON.stringify(auctions, null, 2);
      }

      case "viewUserBids": {
        const { userAddress } = action.parameters;
        const bids = await this.contract.getUserBids(userAddress);
        return JSON.stringify(bids, null, 2);
      }

      default:
        throw new Error(`Unknown action: ${action.name}`);
    }
  }
}
