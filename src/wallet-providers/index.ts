import { Network } from "../network";

/**
 * Base class for wallet providers
 */
export abstract class WalletProvider {
  protected constructor(private readonly name: string) {}

  /**
   * Get the name of the wallet provider
   */
  getName(): string {
    return this.name;
  }

  /**
   * Get the wallet address
   */
  abstract getAddress(): string;

  /**
   * Get the network information
   */
  abstract getNetwork(): Network;
}

export * from "./cdp";
export * from "./evm"; 