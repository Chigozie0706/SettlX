"use client";

import { useEffect, useState } from "react";
import { useAccount, useReadContract, useWriteContract } from "wagmi";
import { http } from "viem";
import contractABI from "../contracts/SettlX1.json";
import { readContract } from "wagmi/actions";
import { arbitrumSepolia } from "viem/chains";
import { createConfig } from "@privy-io/wagmi";
import { aggregatorV3InterfaceABI } from "../contracts/aggregrator";

// ── Config outside component to avoid re-creation on every render ────────────
const config = createConfig({
  chains: [arbitrumSepolia],
  transports: {
    [arbitrumSepolia.id]: http("https://sepolia-rollup.arbitrum.io/rpc"),
  },
  ssr: true,
});

const CONTRACT_ADDRESS = "0xc7de1f51613c80557c65b7ef07718952158a445e";
const USDC_USD_PRICE_FEED = "0x50834F3163758fcC1Df9973b6e91f0F0F0434aD3";

export default function Dashboard() {
  const { address } = useAccount();
  const [payments, setPayments] = useState<any[]>([]);
  const [exchangeRate, setExchangeRate] = useState<number>(1500);
  const [activeTab, setActiveTab] = useState<"pending" | "all">("pending");

  const [accountNumber, setAccountNumber] = useState("");
  const [accountName, setAccountName] = useState("");
  const [bankName, setBankName] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [rateLoading, setRateLoading] = useState(true);
  const [merchantInfo, setMerchantInfo] = useState<any>(null);

  const { writeContract: writeAccept } = useWriteContract();
  const { writeContract: writeReject } = useWriteContract();
  const { writeContract: writeRegister } = useWriteContract();

  const { data: paymentIds } = useReadContract({
    address: CONTRACT_ADDRESS,
    abi: contractABI,
    functionName: "getMerchantPaymentIds",
    args: [address],
  });

  const { data: roundData } = useReadContract({
    abi: aggregatorV3InterfaceABI,
    address: USDC_USD_PRICE_FEED,
    functionName: "latestRoundData",
    chainId: arbitrumSepolia.id,
  });

  const usdcPrice = roundData ? Number(roundData[1]) / 10 ** 8 : null;

  // ── Register bank details ──────────────────────────────────────────────────
  const registerBankDetails = async () => {
    if (!bankName || !accountName || !accountNumber) {
      setError("Please fill in all fields");
      return;
    }
    setLoading(true);
    setError("");
    try {
      await writeRegister({
        address: CONTRACT_ADDRESS,
        abi: contractABI,
        functionName: "registerMerchantBankDetails",
        args: [bankName, accountName, accountNumber],
        maxFeePerGas: BigInt(100000000),
        maxPriorityFeePerGas: BigInt(10000000),
      });
      setTimeout(() => window.location.reload(), 2000);
    } catch (err) {
      setError("Failed to register bank details");
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  // ── Fetch merchant info from MerchantRegistered events ────────────────────
  useEffect(() => {
    const fetchMerchantInfo = async () => {
      if (!address) return;
      try {
        const result: any = await readContract(config, {
          address: CONTRACT_ADDRESS,
          abi: contractABI,
          functionName: "getMerchantBankDetails",
          args: [address],
        });

        const ZERO_HASH =
          "0x0000000000000000000000000000000000000000000000000000000000000000";
        const isRegistered = result && result[0] && result[0] !== ZERO_HASH;

        if (isRegistered) {
          const { createPublicClient } = await import("viem");
          const client = createPublicClient({
            chain: arbitrumSepolia,
            transport: http("https://sepolia-rollup.arbitrum.io/rpc"),
          });

          const logs = await client.getLogs({
            address: CONTRACT_ADDRESS,
            event: {
              type: "event",
              name: "MerchantRegistered",
              inputs: [
                { type: "address", name: "merchant", indexed: true },
                { type: "string", name: "bankName" },
                { type: "string", name: "accountName" },
                { type: "string", name: "accountNumber" },
              ],
            },
            args: { merchant: address },
            fromBlock: BigInt(0),
          });

          if (logs.length > 0) {
            const latest = logs[logs.length - 1];
            setMerchantInfo({
              isRegistered: true,
              bankName: (latest.args as any).bankName,
              accountName: (latest.args as any).accountName,
              accountNumber: (latest.args as any).accountNumber,
            });
          }
        }
      } catch (err) {
        console.error("Error fetching merchant info:", err);
      }
    };
    fetchMerchantInfo();
  }, [address]);

  // ── Fetch live NGN/USD rate ───────────────────────────────────────────────
  useEffect(() => {
    const fetchNgnUsdRate = async () => {
      try {
        setRateLoading(true);
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
      } finally {
        setRateLoading(false);
      }
    };
    fetchNgnUsdRate();
    const interval = setInterval(fetchNgnUsdRate, 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, [usdcPrice]);

  // ── Fetch payments + locked rates from PaymentAccepted events ────────────
  useEffect(() => {
    const fetchPayments = async () => {
      if (!paymentIds || !Array.isArray(paymentIds) || paymentIds.length === 0)
        return;

      // Fetch PaymentAccepted events to get locked NGN rates
      const { createPublicClient } = await import("viem");
      const client = createPublicClient({
        chain: arbitrumSepolia,
        transport: http("https://sepolia-rollup.arbitrum.io/rpc"),
      });

      const acceptedLogs = await client.getLogs({
        address: CONTRACT_ADDRESS as `0x${string}`,
        event: {
          type: "event",
          name: "PaymentAccepted",
          inputs: [
            { type: "uint256", name: "id", indexed: true },
            { type: "uint256", name: "lockedRate", indexed: false },
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

      const results = await Promise.all(
        paymentIds.map(async (id: bigint) => {
          try {
            const result: any = await readContract(config, {
              address: CONTRACT_ADDRESS,
              abi: contractABI,
              functionName: "getPayment",
              args: [id],
            });

            const [pid, payer, merchant, amount, timestamp, rfceHash, status] =
              result;

            const usdcAmount = Number(amount) / 1e6;

            // Use locked rate for accepted/paid payments, live rate for pending
            const rawLockedRate = lockedRateMap[pid.toString()];
            const lockedRateNGN = rawLockedRate
              ? Number(rawLockedRate) / 1e18
              : null;
            const lockedAmountNGN = lockedRateNGN
              ? lockedRateNGN * usdcAmount
              : null;
            const liveNgnAmount = usdcAmount * exchangeRate;

            const rfceDisplay =
              typeof rfceHash === "string"
                ? `${rfceHash.slice(0, 10)}...`
                : `Ref-${pid.toString()}`;

            const statusStr =
              ["Pending", "Accepted", "Rejected", "Paid"][Number(status)] ||
              "Unknown";

            return {
              id: pid.toString(),
              payer,
              merchant,
              amount: usdcAmount,
              // For pending: show live rate. For accepted/paid: show locked rate
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
    };

    fetchPayments();
  }, [paymentIds, exchangeRate]);

  // ── Actions ───────────────────────────────────────────────────────────────
  const acceptPaymentWithRate = async (
    paymentId: string,
    ngnAmount: number,
  ) => {
    try {
      const ngnAmountInWei = BigInt(Math.floor(ngnAmount * 10 ** 18));
      await writeAccept({
        address: CONTRACT_ADDRESS,
        abi: contractABI,
        functionName: "acceptPaymentWithRate",
        args: [BigInt(paymentId), ngnAmountInWei],
        maxFeePerGas: BigInt(100000000),
        maxPriorityFeePerGas: BigInt(10000000),
      });
    } catch (err) {
      setError("Failed to accept payment and lock rate");
      console.error(err);
    }
  };

  const rejectPayment = async (id: string) => {
    try {
      await writeReject({
        address: CONTRACT_ADDRESS,
        abi: contractABI,
        functionName: "rejectPayment",
        args: [BigInt(id)],
        maxFeePerGas: BigInt(100000000),
        maxPriorityFeePerGas: BigInt(10000000),
      });
    } catch (err) {
      setError("Failed to reject payment");
      console.error(err);
    }
  };

  // ── Derived values ─────────────────────────────────────────────────────────
  const pendingPayments = payments.filter((p) => p.status === "Pending");
  const displayedPayments =
    activeTab === "pending" ? pendingPayments : payments;

  const totalUSDC = payments.reduce((sum, p) => sum + p.amount, 0);
  const totalNGN = totalUSDC * exchangeRate;
  const totalLockedNGN = payments
    .filter((p) => p.lockedAmountNGN)
    .reduce((sum, p) => sum + p.lockedAmountNGN, 0);

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

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-gray-50 text-gray-900 p-4 sm:p-8">
      <br />
      <br />
      <div className="mx-auto bg-white shadow-lg rounded-xl p-6 sm:p-8">
        {/* Header */}
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center mb-8">
          <div>
            <h2 className="text-2xl font-bold text-gray-900">
              Merchant Dashboard
            </h2>
            {address && (
              <p className="text-xs text-gray-400 font-mono mt-1">
                {address.slice(0, 8)}...{address.slice(-6)}
              </p>
            )}
          </div>
          <div className="mt-4 sm:mt-0 bg-blue-50 px-4 py-2 rounded-lg">
            <p className="text-xs text-blue-500 font-medium">
              Live Exchange Rate
            </p>
            <p className="text-sm text-blue-700 font-bold">
              1 USDC = {fmtNGN(exchangeRate)}
            </p>
            {rateLoading && (
              <p className="text-xs text-blue-400">Updating...</p>
            )}
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* ── LEFT COLUMN ── */}
          <div className="lg:col-span-1 space-y-6">
            {/* Bank Details */}
            <section>
              <h3 className="text-base font-semibold text-gray-900 mb-3">
                Bank Details
              </h3>
              {merchantInfo?.isRegistered ? (
                <div className="border border-green-200 rounded-xl p-5 bg-green-50 space-y-3">
                  {[
                    { label: "Account Name", value: merchantInfo.accountName },
                    {
                      label: "Account Number",
                      value: merchantInfo.accountNumber,
                    },
                    { label: "Bank Name", value: merchantInfo.bankName },
                  ].map(({ label, value }) => (
                    <div key={label}>
                      <p className="text-xs text-gray-500 font-medium">
                        {label}
                      </p>
                      <p className="text-sm font-semibold text-gray-900">
                        {value}
                      </p>
                    </div>
                  ))}
                  <div className="pt-2 border-t border-green-200">
                    <p className="text-xs text-green-700">
                      ✅ Registered on blockchain
                    </p>
                  </div>
                </div>
              ) : (
                <div className="border border-yellow-200 rounded-xl p-5 bg-yellow-50">
                  <p className="text-sm text-yellow-700">
                    No bank details registered yet.
                  </p>
                </div>
              )}
            </section>

            {/* Register Form */}
            {!merchantInfo?.isRegistered && (
              <section className="border border-gray-200 rounded-xl p-5 bg-white shadow-sm">
                <h3 className="text-base font-semibold text-gray-900 mb-4">
                  Register Bank Details
                </h3>
                <div className="space-y-4">
                  <div>
                    <label className="block text-xs font-medium text-gray-700 mb-1">
                      Bank
                    </label>
                    <select
                      value={bankName}
                      onChange={(e) => setBankName(e.target.value)}
                      className="block w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    >
                      <option value="">Select Bank</option>
                      {[
                        "Access Bank",
                        "GTBank",
                        "First Bank",
                        "United Bank for Africa",
                        "Zenith Bank",
                        "Wema Bank",
                        "Ecobank Nigeria",
                        "Fidelity Bank",
                        "First City Monument Bank",
                        "Keystone Bank",
                        "Polaris Bank",
                        "Providus Bank",
                        "Stanbic IBTC Bank",
                        "Sterling Bank",
                        "Union Bank of Nigeria",
                        "Unity Bank",
                        "VFD Microfinance Bank",
                      ].map((b) => (
                        <option key={b} value={b}>
                          {b}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-gray-700 mb-1">
                      Account Number
                    </label>
                    <input
                      type="text"
                      value={accountNumber}
                      onChange={(e) =>
                        setAccountNumber(e.target.value.replace(/\D/g, ""))
                      }
                      placeholder="Enter account number"
                      className="block w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-gray-700 mb-1">
                      Account Name
                    </label>
                    <input
                      type="text"
                      value={accountName}
                      onChange={(e) => setAccountName(e.target.value)}
                      placeholder="Enter account name"
                      className="block w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>

                  {error && <p className="text-red-600 text-xs">{error}</p>}

                  {accountName && bankName && accountNumber && (
                    <div className="bg-gray-50 border border-gray-200 rounded-lg p-3 space-y-1.5">
                      <p className="text-xs text-gray-500 font-semibold uppercase tracking-wide mb-2">
                        Review
                      </p>
                      <p className="text-xs text-gray-700">
                        <span className="font-medium">Name:</span> {accountName}
                      </p>
                      <p className="text-xs text-gray-700">
                        <span className="font-medium">Bank:</span> {bankName}
                      </p>
                      <p className="text-xs text-gray-700">
                        <span className="font-medium">Number:</span>{" "}
                        {accountNumber}
                      </p>
                      <p className="text-xs text-gray-400 mt-2">
                        ⚠️ Stored as secure hashes on-chain
                      </p>
                      <button
                        onClick={registerBankDetails}
                        disabled={loading}
                        className="w-full mt-2 bg-green-600 text-white py-2 px-4 rounded-lg text-sm hover:bg-green-700 disabled:opacity-50 font-medium"
                      >
                        {loading ? "Registering..." : "Register on Blockchain"}
                      </button>
                    </div>
                  )}
                </div>
              </section>
            )}

            {/* Quick Stats */}
            <section>
              <h3 className="text-base font-semibold text-gray-900 mb-3">
                Quick Stats
              </h3>
              <div className="grid grid-cols-2 gap-3">
                <div className="bg-yellow-50 border border-yellow-100 rounded-xl p-4 text-center">
                  <p className="text-2xl font-bold text-yellow-700">
                    {pendingPayments.length}
                  </p>
                  <p className="text-xs text-yellow-600 mt-1">Pending</p>
                </div>
                <div className="bg-green-50 border border-green-100 rounded-xl p-4 text-center">
                  <p className="text-2xl font-bold text-green-700">
                    {payments.filter((p) => p.status === "Paid").length}
                  </p>
                  <p className="text-xs text-green-600 mt-1">Paid</p>
                </div>
                <div className="bg-blue-50 border border-blue-100 rounded-xl p-4 col-span-2">
                  <p className="text-xs text-blue-600 font-medium mb-1">
                    Total Volume
                  </p>
                  <p className="text-lg font-bold text-blue-900">
                    {totalUSDC.toFixed(3)} USDC
                  </p>
                  <p className="text-sm text-blue-700">
                    {fmtNGN(totalNGN)}{" "}
                    <span className="text-xs font-normal text-blue-500">
                      (live rate)
                    </span>
                  </p>
                  {totalLockedNGN > 0 && (
                    <p className="text-sm text-green-700 mt-1">
                      {fmtNGN(totalLockedNGN)}{" "}
                      <span className="text-xs font-normal text-green-500">
                        (locked)
                      </span>
                    </p>
                  )}
                </div>
              </div>
            </section>
          </div>

          {/* ── RIGHT COLUMN ── */}
          <div className="lg:col-span-2">
            {/* Tab bar */}
            <div className="flex items-center justify-between mb-4">
              <div className="flex gap-2">
                <button
                  onClick={() => setActiveTab("pending")}
                  className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                    activeTab === "pending"
                      ? "bg-blue-600 text-white"
                      : "text-gray-500 hover:bg-gray-100"
                  }`}
                >
                  Pending
                  {pendingPayments.length > 0 && (
                    <span
                      className={`ml-2 px-1.5 py-0.5 rounded-full text-xs ${activeTab === "pending" ? "bg-blue-500 text-white" : "bg-yellow-100 text-yellow-700"}`}
                    >
                      {pendingPayments.length}
                    </span>
                  )}
                </button>
                <button
                  onClick={() => setActiveTab("all")}
                  className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                    activeTab === "all"
                      ? "bg-blue-600 text-white"
                      : "text-gray-500 hover:bg-gray-100"
                  }`}
                >
                  All Transactions
                  <span
                    className={`ml-2 px-1.5 py-0.5 rounded-full text-xs ${activeTab === "all" ? "bg-blue-500 text-white" : "bg-gray-100 text-gray-600"}`}
                  >
                    {payments.length}
                  </span>
                </button>
              </div>
            </div>

            {/* Transactions table */}
            <div className="border border-gray-200 rounded-xl overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 border-b text-xs text-gray-500 uppercase tracking-wide">
                  <tr>
                    <th className="text-left p-4 font-medium">
                      Payment Details
                    </th>
                    <th className="text-right p-4 font-medium">USDC</th>
                    <th className="text-right p-4 font-medium">NGN</th>
                    <th className="text-right p-4 font-medium">Status</th>
                    <th className="text-right p-4 font-medium">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {displayedPayments.length === 0 ? (
                    <tr>
                      <td
                        colSpan={5}
                        className="text-center py-12 text-gray-400"
                      >
                        <div className="text-4xl mb-2">📝</div>
                        <p className="font-medium">
                          {activeTab === "pending"
                            ? "No pending transactions"
                            : "No transactions yet"}
                        </p>
                        <p className="text-xs mt-1 text-gray-300">
                          Transactions will appear here when customers pay
                        </p>
                      </td>
                    </tr>
                  ) : (
                    displayedPayments.map((payment) => (
                      <tr
                        key={payment.id}
                        className="border-b hover:bg-gray-50"
                      >
                        <td className="p-4">
                          <p className="font-semibold text-gray-900">
                            Payment #{payment.id}
                          </p>
                          <p className="text-gray-400 text-xs mt-0.5 font-mono">
                            {payment.payer?.slice(0, 8)}...
                            {payment.payer?.slice(-6)}
                          </p>
                          <p className="text-gray-400 text-xs mt-0.5 font-mono">
                            Ref: {payment.rfce}
                          </p>
                          <p className="text-gray-400 text-xs">
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
                            <p className="text-xs text-green-600 font-medium mt-0.5">
                              🔒 Locked @ {fmtNGN(payment.lockedRateNGN!)}/USDC
                            </p>
                          ) : (
                            <p className="text-xs text-gray-400 mt-0.5">
                              Live rate
                            </p>
                          )}
                        </td>
                        <td className="text-right p-4">
                          <StatusBadge status={payment.status} />
                        </td>
                        <td className="text-right p-4">
                          {payment.status === "Pending" ? (
                            <div className="flex flex-col gap-1.5 items-end">
                              <button
                                onClick={() =>
                                  acceptPaymentWithRate(
                                    payment.id,
                                    payment.liveNgnAmount,
                                  )
                                }
                                className="bg-green-600 text-white px-3 py-1.5 rounded-lg text-xs hover:bg-green-700 font-medium whitespace-nowrap"
                              >
                                🔒 Lock Rate
                              </button>
                              <button
                                onClick={() => rejectPayment(payment.id)}
                                className="bg-red-50 text-red-600 border border-red-200 px-3 py-1.5 rounded-lg text-xs hover:bg-red-100 font-medium"
                              >
                                Reject
                              </button>
                            </div>
                          ) : (
                            <span className="text-gray-400 text-xs">—</span>
                          )}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            {/* Summary footer */}
            {payments.length > 0 && (
              <div className="mt-4 bg-gray-50 rounded-xl p-5 border border-gray-200">
                <h4 className="text-sm font-semibold text-gray-900 mb-3">
                  Summary
                </h4>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-sm">
                  <div>
                    <p className="text-xs text-gray-500">Pending</p>
                    <p className="font-bold text-yellow-700 text-lg">
                      {pendingPayments.length}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-gray-500">Accepted</p>
                    <p className="font-bold text-blue-700 text-lg">
                      {payments.filter((p) => p.status === "Accepted").length}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-gray-500">Total USDC</p>
                    <p className="font-bold text-gray-900 text-lg">
                      {totalUSDC.toFixed(3)}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-gray-500">NGN (live)</p>
                    <p className="font-bold text-gray-900 text-base">
                      {fmtNGN(totalNGN)}
                    </p>
                    {totalLockedNGN > 0 && (
                      <p className="text-xs text-green-600 font-medium mt-0.5">
                        {fmtNGN(totalLockedNGN)} locked
                      </p>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
