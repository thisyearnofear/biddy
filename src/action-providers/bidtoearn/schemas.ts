import { z } from "zod";
import { createActionSchema } from "@coinbase/agentkit";

export const CreateAuctionSchema = createActionSchema({
  name: "createAuction",
  description: "Create a new NFT auction",
  parameters: z.object({
    minBid: z.string().describe("Minimum bid amount in ETH"),
    duration: z.number().describe("Duration of auction in seconds"),
    extensionTime: z.number().describe("Time to extend auction when bid is placed near end"),
    bidIncrementPercentage: z.number().describe("Minimum percentage increase for new bids"),
    title: z.string().describe("Title of the NFT"),
    description: z.string().describe("Description of the NFT"),
    imageURI: z.string().describe("URI of the NFT image"),
    royaltyPercentage: z.number().max(1000).describe("Royalty percentage (max 10%)"),
    reservePrice: z.string().describe("Reserve price in ETH"),
  }),
});

export const PlaceBidSchema = createActionSchema({
  name: "placeBid",
  description: "Place a bid on an active auction",
  parameters: z.object({
    tokenId: z.number().describe("Token ID of the auction"),
    bidAmount: z.string().describe("Bid amount in ETH"),
  }),
});

export const WithdrawSchema = createActionSchema({
  name: "withdraw",
  description: "Withdraw available funds from previous bids",
  parameters: z.object({}),
});

export const ViewAuctionSchema = createActionSchema({
  name: "viewAuction",
  description: "View details of a specific auction",
  parameters: z.object({
    tokenId: z.number().describe("Token ID of the auction"),
  }),
});

export const ViewUserAuctionsSchema = createActionSchema({
  name: "viewUserAuctions",
  description: "View all auctions created by a user",
  parameters: z.object({
    userAddress: z.string().describe("Address of the user"),
  }),
});

export const ViewUserBidsSchema = createActionSchema({
  name: "viewUserBids",
  description: "View all auctions a user has bid on",
  parameters: z.object({
    userAddress: z.string().describe("Address of the user"),
  }),
});
