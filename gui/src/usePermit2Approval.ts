import { useReadContract, useWriteContract } from "wagmi";
import { erc20Abi, maxUint256 } from "viem";
import { MUSD_ADDRESS, PERMIT2_ADDRESS, mezoTestnet } from "./config";

export function usePermit2Approval(userAddress: `0x${string}` | undefined) {
  const { data: allowance, refetch } = useReadContract({
    address: MUSD_ADDRESS,
    abi: erc20Abi,
    functionName: "allowance",
    args: userAddress ? [userAddress, PERMIT2_ADDRESS] : undefined,
    chainId: mezoTestnet.id,
    query: { enabled: !!userAddress },
  });

  const { writeContract, isPending } = useWriteContract();

  const approve = () => {
    writeContract(
      {
        address: MUSD_ADDRESS,
        abi: erc20Abi,
        functionName: "approve",
        args: [PERMIT2_ADDRESS, maxUint256],
        chainId: mezoTestnet.id,
      },
      {
        onSuccess: () => refetch(),
        onError: (error) => {
          console.error("Permit2 approval failed:", error);
        },
      }
    );
  };

  const needsApproval = allowance !== undefined && allowance === 0n;

  return { needsApproval, approve, isPending };
}
