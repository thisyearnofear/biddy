/**
 * Network protocol family
 */
export type ProtocolFamily = "evm" | "bitcoin" | "solana";

/**
 * Network information
 */
export interface Network {
  /**
   * Network ID (e.g., "ethereum-mainnet", "base-mainnet")
   */
  networkId?: string;

  /**
   * Chain ID (e.g., 1 for Ethereum mainnet)
   */
  chainId?: string | number;

  /**
   * Protocol family (e.g., "evm", "bitcoin")
   */
  protocolFamily: ProtocolFamily;

  /**
   * Network name (e.g., "Ethereum", "Base")
   */
  name?: string;
} 