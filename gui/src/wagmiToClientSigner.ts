import { toClientEvmSigner } from "@x402/evm";
import type { WalletClient, PublicClient, Account } from "viem";

export function wagmiToClientSigner(
  walletClient: WalletClient,
  publicClient: PublicClient
) {
  if (!walletClient.account) {
    throw new Error("Wallet client must have an account");
  }

  const account = walletClient.account as Account;

  return toClientEvmSigner(
    {
      address: account.address,
      signTypedData: async (message: {
        domain: Record<string, unknown>;
        types: Record<string, unknown>;
        primaryType: string;
        message: Record<string, unknown>;
      }) => {
        return walletClient.signTypedData({
          account,
          domain: message.domain,
          types: message.types,
          primaryType: message.primaryType,
          message: message.message,
        });
      },
    },
    {
      readContract: (args: {
        address: `0x${string}`;
        abi: readonly unknown[];
        functionName: string;
        args?: readonly unknown[];
      }) => publicClient.readContract(args),
    }
  );
}
