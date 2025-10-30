"use client";

import { useEffect, useState } from "react";
import { useAccount, useWriteContract } from "wagmi";
import { parseUnits, erc20Abi } from "viem";
import contractABI from "../contracts/settlX.json";
import toast from "react-hot-toast";

export default function Transact() {
  const { address } = useAccount();
  const [merchant, setMerchant] = useState("");
  const [amount, setAmount] = useState("");
  const [rfce, setRfce] = useState("");

  const [approvalToastId, setApprovalToastId] = useState<string | null>(null);
  const [paymentToastId, setPaymentToastId] = useState<string | null>(null);

  const [isApprovalConfirmed, setIsApprovalConfirmed] = useState(false);
  const [isPaymentConfirmed, setIsPaymentConfirmed] = useState(false);

  // ✅ Replace these with your actual deployed addresses
  const USDC_ADDRESS = "0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d"; // Arbitrum Sepolia USDC
  const CONTRACT_ADDRESS = "0x4b1af11B7e8Ec44634A47c8b420b445cE5d6c578";

  // --- Approve USDC Spending ---
  const { writeContractAsync: writeApproval, isPending: isApproving } =
    useWriteContract();

  const approveUSDC = async (amount: string) => {
    const amountInWei = parseUnits(amount, 6); // USDC has 6 decimals
    try {
      if (approvalToastId) toast.dismiss(approvalToastId);
      const toastId = toast.loading("Approving USDC spending...");
      setApprovalToastId(toastId);

      await writeApproval({
        address: USDC_ADDRESS,
        abi: erc20Abi,
        functionName: "approve",
        args: [CONTRACT_ADDRESS, amountInWei],
      });

      toast.success("✅ USDC approved successfully!");
      setIsApprovalConfirmed(true);
      toast.dismiss(toastId);
      setApprovalToastId(null);
    } catch (error) {
      console.error("Approval failed:", error);
      toast.error("Failed to approve USDC spending");
      setApprovalToastId(null);
    }
  };

  // --- Pay Merchant ---
  const { writeContractAsync: writePay, isPending: isPaying } =
    useWriteContract();

  const payMerchant = async (
    merchant: string,
    amount: string,
    rfce: string
  ) => {
    const amountInWei = parseUnits(amount, 6);
    try {
      if (paymentToastId) toast.dismiss(paymentToastId);
      const toastId = toast.loading("Creating payment...");
      setPaymentToastId(toastId);

      await writePay({
        address: CONTRACT_ADDRESS,
        abi: contractABI.abi,
        functionName: "payMerchant",
        args: [merchant, amountInWei, rfce],
      });

      toast.success("✅ Payment created successfully!");
      setIsPaymentConfirmed(true);
      toast.dismiss(toastId);
      setPaymentToastId(null);
    } catch (error) {
      console.error("Payment failed:", error);
      toast.error("Failed to create payment");
      setPaymentToastId(null);
    }
  };

  // --- Combined Flow ---
  const handleSubmit = async () => {
    if (!merchant || !amount || !rfce) {
      toast.error("Please fill in all fields");
      return;
    }

    await approveUSDC(amount);
    if (isApprovalConfirmed) {
      await payMerchant(merchant, amount, rfce);
    }
  };

  // --- Reactivity ---
  useEffect(() => {
    if (isPaymentConfirmed) {
      toast.success("💰 Payment sent and pending merchant approval!");
    }
  }, [isPaymentConfirmed]);

  const isLoading = isApproving || isPaying;

  // --- UI ---
  return (
    <div className="flex flex-col items-center justify-center min-h-screen p-10">
      <h1 className="text-2xl font-bold mb-4">Send USDC to Merchant</h1>

      <div className="flex flex-col gap-3 w-80">
        <input
          placeholder="Merchant address"
          value={merchant}
          onChange={(e) => setMerchant(e.target.value)}
          className="border p-2 rounded"
        />
        <input
          placeholder="Amount (USDC)"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          className="border p-2 rounded"
        />
        <input
          placeholder="Reference (RFCE)"
          value={rfce}
          onChange={(e) => setRfce(e.target.value)}
          className="border p-2 rounded"
        />

        <button
          onClick={handleSubmit}
          disabled={isLoading}
          className="bg-blue-600 text-white py-2 rounded mt-2 disabled:opacity-50"
        >
          {isLoading ? "Processing..." : "Pay Merchant"}
        </button>
      </div>
    </div>
  );
}
