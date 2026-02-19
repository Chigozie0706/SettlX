"use client";

import { useEffect, useState } from "react";
import { useAccount, useWriteContract, useReadContract } from "wagmi";
import { parseUnits, erc20Abi, http } from "viem";
import contractABI from "../contracts/SettlX1.json";
import toast from "react-hot-toast";
import { readContract } from "wagmi/actions";
import { createConfig } from "@privy-io/wagmi";
import { arbitrumSepolia } from "viem/chains";
import { aggregatorV3InterfaceABI } from "../contracts/aggregrator";

// ── Config & constants outside component ─────────────────────────────────────
const config = createConfig({
  chains: [arbitrumSepolia],
  transports: {
    [arbitrumSepolia.id]: http("https://sepolia-rollup.arbitrum.io/rpc"),
  },
  ssr: true,
});

const USDC_ADDRESS = "0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d";
const CONTRACT_ADDRESS = "0xc7de1f51613c80557c65b7ef07718952158a445e";
const USDC_USD_PRICE_FEED = "0x50834F3163758fcC1Df9973b6e91f0F0F0434aD3";

export default function Transact() {
  const { address } = useAccount();

  // Form state
  const [merchant, setMerchant] = useState("");
  const [amount, setAmount] = useState("");
  const [rfce, setRfce] = useState("");

  // Data state
  const [payments, setPayments] = useState<any[]>([]);
  const [exchangeRate, setExchangeRate] = useState<number>(1500);
  const [paymentsLoading, setPaymentsLoading] = useState(false);

  // ── On-chain reads ─────────────────────────────────────────────────────────
  const { data: paymentIds, refetch: refetchPayments } = useReadContract({
    address: CONTRACT_ADDRESS,
    abi: contractABI,
    functionName: "getPayerPaymentIds",
    args: [address],
  });

  const { data: roundData } = useReadContract({
    abi: aggregatorV3InterfaceABI,
    address: USDC_USD_PRICE_FEED,
    functionName: "latestRoundData",
    chainId: arbitrumSepolia.id,
  });

  const usdcPrice = roundData ? Number(roundData[1]) / 10 ** 8 : null;

  // ── Write hooks ───────────────────────────────────────────────────────────
  const { writeContractAsync: writeApproval, isPending: isApproving } =
    useWriteContract();
  const { writeContractAsync: writePay, isPending: isPaying } =
    useWriteContract();

  const isLoading = isApproving || isPaying;

  // ── Fetch live NGN/USD rate ───────────────────────────────────────────────
  useEffect(() => {
    const fetchNgnUsdRate = async () => {
      try {
        const response = await fetch(
          "https://api.exchangerate.host/live?access_key=ea1d0dec876fe03fb68693737b4216bb&currencies=NGN",
        );
        const data = await response.json();
        if (data.success && data.quotes?.USDNGN) {
          const usdToNgn = data.quotes.USDNGN;
          setExchangeRate(usdcPrice ? usdcPrice * usdToNgn : usdToNgn);
        }
      } catch (err) {
        console.error("Error fetching NGN/USD rate:", err);
      }
    };
    fetchNgnUsdRate();
  }, [usdcPrice]);

  // ── Fetch payments with real rfce + locked NGN from events ────────────────
  useEffect(() => {
    const fetchPayments = async () => {
      if (
        !paymentIds ||
        !Array.isArray(paymentIds) ||
        paymentIds.length === 0
      ) {
        setPayments([]);
        return;
      }

      setPaymentsLoading(true);
      try {
        const { createPublicClient } = await import("viem");
        const client = createPublicClient({
          chain: arbitrumSepolia,
          transport: http("https://sepolia-rollup.arbitrum.io/rpc"),
        });

        // Fetch PaymentCreated events → original rfce strings
        const createdLogs = await client.getLogs({
          address: CONTRACT_ADDRESS as `0x${string}`,
          event: {
            type: "event",
            name: "PaymentCreated",
            inputs: [
              { type: "uint256", name: "id", indexed: true },
              { type: "address", name: "payer", indexed: true },
              { type: "address", name: "merchant", indexed: true },
              { type: "uint256", name: "amount" },
              { type: "string", name: "rfce" },
            ],
          },
          fromBlock: BigInt(0),
        });

        // Map: payment id -> original rfce string
        const rfceMap: Record<string, string> = {};
        for (const log of createdLogs) {
          const args = log.args as any;
          if (args.id !== undefined && args.rfce) {
            rfceMap[args.id.toString()] = args.rfce;
          }
        }

        // Fetch PaymentAccepted events → locked NGN rate per payment
        const acceptedLogs = await client.getLogs({
          address: CONTRACT_ADDRESS as `0x${string}`,
          event: {
            type: "event",
            name: "PaymentAccepted",
            inputs: [
              { type: "uint256", name: "id", indexed: true },
              { type: "uint256", name: "lockedRate" },
            ],
          },
          fromBlock: BigInt(0),
        });

        // Map: payment id -> lockedRate (NGN per USDC × 1e18)
        const lockedRateMap: Record<string, bigint> = {};
        for (const log of acceptedLogs) {
          const args = log.args as any;
          if (args.id !== undefined && args.lockedRate !== undefined) {
            lockedRateMap[args.id.toString()] = args.lockedRate;
          }
        }

        // Fetch each payment from contract
        const results = await Promise.all(
          paymentIds.map(async (id: bigint) => {
            try {
              const result: any = await readContract(config, {
                address: CONTRACT_ADDRESS,
                abi: contractABI,
                functionName: "getPayment",
                args: [id],
              });

              const [pid, payer, merchant, amount, timestamp, , status] =
                result;

              const usdcAmount = Number(amount) / 1e6;
              const statusStr =
                ["Pending", "Accepted", "Rejected", "Paid"][Number(status)] ||
                "Unknown";

              // Real rfce from PaymentCreated event
              const rfceDisplay =
                rfceMap[pid.toString()] || `Ref-${pid.toString()}`;

              // Locked NGN from PaymentAccepted event
              const rawLockedRate = lockedRateMap[pid.toString()];
              const lockedRateNGN = rawLockedRate
                ? Number(rawLockedRate) / 1e18
                : null;
              const lockedAmountNGN = lockedRateNGN
                ? lockedRateNGN * usdcAmount
                : null;

              const liveNgnAmount = usdcAmount * exchangeRate;

              return {
                id: pid.toString(),
                payer,
                merchant,
                amount: usdcAmount,
                // Show locked NGN for accepted/paid; live rate for pending/rejected
                ngnAmount: lockedAmountNGN ?? liveNgnAmount,
                lockedAmountNGN,
                lockedRateNGN,
                liveNgnAmount,
                isRateLocked: !!lockedAmountNGN,
                timestamp: new Date(Number(timestamp) * 1000).toLocaleString(),
                rfce: rfceDisplay,
                status: statusStr,
              };
            } catch (err) {
              console.error("Error fetching payment:", err);
              return null;
            }
          }),
        );

        setPayments(results.filter(Boolean));
      } catch (err) {
        console.error("Error fetching payment events:", err);
      } finally {
        setPaymentsLoading(false);
      }
    };

    fetchPayments();
  }, [paymentIds, exchangeRate]);

  // ── Actions ───────────────────────────────────────────────────────────────
  const approveUSDC = async (amountStr: string): Promise<boolean> => {
    const amountInWei = parseUnits(amountStr, 6);
    const toastId = toast.loading("Approving USDC spending...");
    try {
      await writeApproval({
        address: USDC_ADDRESS,
        abi: erc20Abi,
        functionName: "approve",
        args: [CONTRACT_ADDRESS, amountInWei],
      });
      toast.success("✅ USDC approved!", { id: toastId });
      return true;
    } catch (err) {
      console.error("Approval failed:", err);
      toast.error("Failed to approve USDC", { id: toastId });
      return false;
    }
  };

  const payMerchant = async (
    merchantAddr: string,
    amountStr: string,
    reference: string,
  ): Promise<boolean> => {
    const amountInWei = parseUnits(amountStr, 6);
    const toastId = toast.loading("Creating payment...");
    try {
      await writePay({
        address: CONTRACT_ADDRESS,
        abi: contractABI,
        functionName: "payMerchant",
        args: [merchantAddr, amountInWei, reference],
      });
      toast.success("✅ Payment created!", { id: toastId });
      setTimeout(() => refetchPayments(), 2000);
      return true;
    } catch (err) {
      console.error("Payment failed:", err);
      toast.error("Failed to create payment", { id: toastId });
      return false;
    }
  };

  const handleSubmit = async () => {
    if (!merchant || !amount || !rfce) {
      toast.error("Please fill in all fields");
      return;
    }
    if (!address) {
      toast.error("Please connect your wallet");
      return;
    }

    const approved = await approveUSDC(amount);
    if (approved) {
      const paid = await payMerchant(merchant, amount, rfce);
      if (paid) {
        setMerchant("");
        setAmount("");
        setRfce("");
        toast.success("💰 Payment sent! Awaiting merchant approval.");
      }
    }
  };

  // ── Derived values ────────────────────────────────────────────────────────
  const totalUSDC = payments.reduce((s, p) => s + p.amount, 0);
  const totalNGN = totalUSDC * exchangeRate;
  const pendingCount = payments.filter((p) => p.status === "Pending").length;
  const acceptedCount = payments.filter((p) => p.status === "Accepted").length;
  const rejectedCount = payments.filter((p) => p.status === "Rejected").length;
  const paidCount = payments.filter((p) => p.status === "Paid").length;

  const fmtNGN = (n: number) =>
    `₦${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  // ── Status badge ──────────────────────────────────────────────────────────
  const StatusBadge = ({ status }: { status: string }) => {
    const map: Record<string, string> = {
      Pending: "bg-yellow-100 text-yellow-800",
      Accepted: "bg-blue-100 text-blue-800",
      Paid: "bg-green-100 text-green-800",
      Rejected: "bg-red-100 text-red-800",
    };
    return (
      <span
        className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold ${map[status] || "bg-gray-100 text-gray-600"}`}
      >
        {status}
      </span>
    );
  };

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-gray-50 p-4 sm:p-8">
      <br />
      <br />
      <br />

      <div className="mx-auto">
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-gray-900">Make a Payment</h1>
          <p className="text-gray-500 mt-1">
            Send USDC to merchants on Arbitrum Sepolia
          </p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* ── LEFT — Payment Form + Summary ── */}
          <div className="lg:col-span-1 space-y-6">
            {/* Payment Form */}
            <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
              <h2 className="text-lg font-semibold text-gray-900 mb-5">
                New Payment
              </h2>

              <div className="space-y-4">
                {/* Merchant address */}
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">
                    Merchant Address
                  </label>
                  <input
                    type="text"
                    placeholder="0x..."
                    value={merchant}
                    onChange={(e) => setMerchant(e.target.value)}
                    className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 text-gray-900 placeholder-gray-400 font-mono"
                  />
                </div>

                {/* Amount */}
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">
                    Amount (USDC)
                  </label>
                  <input
                    type="number"
                    placeholder="0.00"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    step="0.001"
                    min="0"
                    className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 text-gray-900 placeholder-gray-400"
                  />
                  {amount && parseFloat(amount) > 0 && (
                    <div className="mt-2 px-3 py-2 bg-blue-50 rounded-lg">
                      <p className="text-xs text-blue-600 font-medium">
                        ≈ {fmtNGN(parseFloat(amount) * exchangeRate)}
                      </p>
                      <p className="text-xs text-blue-400 mt-0.5">
                        at live rate: 1 USDC = {fmtNGN(exchangeRate)}
                      </p>
                    </div>
                  )}
                </div>

                {/* Reference */}
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">
                    Payment Reference
                  </label>
                  <input
                    type="text"
                    placeholder="e.g. INV-2024-001"
                    value={rfce}
                    onChange={(e) => setRfce(e.target.value)}
                    className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 text-gray-900 placeholder-gray-400"
                  />
                  <p className="text-xs text-gray-400 mt-1">
                    Stored as a hash on-chain. Your original reference will be
                    visible in payment history.
                  </p>
                </div>

                {/* Submit */}
                <button
                  onClick={handleSubmit}
                  disabled={isLoading || !address}
                  className="w-full bg-blue-600 text-white py-3 px-4 rounded-lg hover:bg-blue-700 disabled:opacity-50 font-semibold text-sm transition-colors"
                >
                  {isApproving
                    ? "⏳ Approving USDC..."
                    : isPaying
                      ? "⏳ Creating Payment..."
                      : "Send Payment"}
                </button>

                {/* Step indicator while processing */}
                {isLoading && (
                  <div className="flex items-center gap-3 text-xs text-gray-500">
                    <div
                      className={`flex items-center gap-1 ${isApproving ? "text-blue-600 font-semibold" : "text-green-600"}`}
                    >
                      <span>{isApproving ? "⏳" : "✅"}</span>
                      <span>Step 1: Approve USDC</span>
                    </div>
                    <span>→</span>
                    <div
                      className={`flex items-center gap-1 ${isPaying ? "text-blue-600 font-semibold" : "text-gray-400"}`}
                    >
                      <span>{isPaying ? "⏳" : "○"}</span>
                      <span>Step 2: Pay Merchant</span>
                    </div>
                  </div>
                )}

                {!address && (
                  <p className="text-xs text-red-500 text-center">
                    Connect your wallet to make a payment
                  </p>
                )}
              </div>
            </div>

            {/* Payment Summary */}
            <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
              <h3 className="text-base font-semibold text-gray-900 mb-4">
                Summary
              </h3>
              <div className="space-y-3">
                {[
                  {
                    label: "Total Payments",
                    value: payments.length,
                    color: "text-gray-900",
                  },
                  {
                    label: "Pending",
                    value: pendingCount,
                    color: "text-yellow-600",
                  },
                  {
                    label: "Accepted",
                    value: acceptedCount,
                    color: "text-blue-600",
                  },
                  { label: "Paid", value: paidCount, color: "text-green-600" },
                  {
                    label: "Rejected",
                    value: rejectedCount,
                    color: "text-red-500",
                  },
                ].map(({ label, value, color }) => (
                  <div
                    key={label}
                    className="flex justify-between items-center text-sm"
                  >
                    <span className="text-gray-500">{label}</span>
                    <span className={`font-semibold ${color}`}>{value}</span>
                  </div>
                ))}

                <div className="pt-3 mt-1 border-t border-gray-100">
                  <div className="flex justify-between items-start">
                    <span className="text-sm text-gray-500">Total Sent</span>
                    <div className="text-right">
                      <p className="font-bold text-gray-900">
                        {totalUSDC.toFixed(3)} USDC
                      </p>
                      <p className="text-xs text-gray-400">
                        {fmtNGN(totalNGN)}
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* ── RIGHT — Payment History ── */}
          <div className="lg:col-span-2">
            <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
              <div className="flex justify-between items-center mb-5">
                <h2 className="text-lg font-semibold text-gray-900">
                  Payment History
                </h2>
                <span className="text-xs bg-gray-100 text-gray-500 px-3 py-1 rounded-full">
                  {payments.length} total
                </span>
              </div>

              {paymentsLoading ? (
                <div className="text-center py-12 text-gray-400">
                  <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500 mx-auto mb-3" />
                  <p className="text-sm">Loading payment history...</p>
                </div>
              ) : (
                <div className="border border-gray-200 rounded-xl overflow-hidden overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-gray-50 border-b text-xs text-gray-500 uppercase tracking-wide">
                      <tr>
                        <th className="text-left p-4 font-medium">Details</th>
                        <th className="text-right p-4 font-medium">USDC</th>
                        <th className="text-right p-4 font-medium">NGN</th>
                        <th className="text-right p-4 font-medium">Status</th>
                        <th className="text-right p-4 font-medium">Merchant</th>
                      </tr>
                    </thead>
                    <tbody>
                      {payments.length === 0 ? (
                        <tr>
                          <td
                            colSpan={5}
                            className="text-center py-12 text-gray-400"
                          >
                            <div className="text-4xl mb-2">💸</div>
                            <p className="font-medium">No payments yet</p>
                            <p className="text-xs mt-1 text-gray-300">
                              Your payment history will appear here
                            </p>
                          </td>
                        </tr>
                      ) : (
                        payments.map((payment) => (
                          <tr
                            key={payment.id}
                            className="border-b hover:bg-gray-50"
                          >
                            <td className="p-4">
                              <p className="font-semibold text-gray-900">
                                Payment #{payment.id}
                              </p>
                              {/* Real reference from PaymentCreated event */}
                              <p className="text-gray-500 text-xs mt-0.5">
                                Ref:{" "}
                                <span className="font-medium text-gray-700">
                                  {payment.rfce}
                                </span>
                              </p>
                              <p className="text-gray-400 text-xs mt-0.5">
                                {payment.timestamp}
                              </p>
                            </td>
                            <td className="text-right p-4 font-semibold text-gray-900">
                              {payment.amount.toFixed(3)}
                            </td>
                            <td className="text-right p-4">
                              <p className="font-semibold text-gray-900">
                                {fmtNGN(payment.ngnAmount)}
                              </p>
                              {payment.isRateLocked ? (
                                <p className="text-xs text-green-600 mt-0.5">
                                  🔒 {fmtNGN(payment.lockedRateNGN!)}/USDC
                                </p>
                              ) : (
                                <p className="text-xs text-gray-400 mt-0.5">
                                  live rate
                                </p>
                              )}
                            </td>
                            <td className="text-right p-4">
                              <StatusBadge status={payment.status} />
                            </td>
                            <td className="text-right p-4 font-mono text-xs text-gray-400">
                              {payment.merchant?.slice(0, 6)}...
                              {payment.merchant?.slice(-4)}
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              )}

              {/* Footer summary */}
              {payments.length > 0 && (
                <div className="mt-4 grid grid-cols-2 sm:grid-cols-4 gap-3">
                  {[
                    { label: "Payments", value: payments.length, sub: "total" },
                    {
                      label: pendingCount.toString(),
                      sub: "pending",
                      valueColor: "text-yellow-600",
                    },
                    { label: totalUSDC.toFixed(3), sub: "USDC sent" },
                    { label: fmtNGN(totalNGN), sub: "NGN equiv." },
                  ].map(({ label, sub, valueColor }) => (
                    <div
                      key={sub}
                      className="bg-gray-50 rounded-lg p-3 text-center border border-gray-100"
                    >
                      <p
                        className={`font-bold text-gray-900 ${valueColor || ""}`}
                      >
                        {label}
                      </p>
                      <p className="text-xs text-gray-400 mt-0.5">{sub}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
