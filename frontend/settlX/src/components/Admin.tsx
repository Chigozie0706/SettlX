"use client";

import { useEffect, useState } from "react";
import { useAccount, useWriteContract } from "wagmi";
import contractABI from "../contracts/settlX.json";
import { readContract } from "wagmi/actions";
import { arbitrumSepolia } from "viem/chains";
import { createConfig } from "@privy-io/wagmi";
import { http } from "viem";
import toast from "react-hot-toast";

// ── Config & constants outside component (prevents re-creation on every render)
const config = createConfig({
  chains: [arbitrumSepolia],
  transports: {
    [arbitrumSepolia.id]: http("https://sepolia-rollup.arbitrum.io/rpc"),
  },
  ssr: true,
});

const CONTRACT_ADDRESS = "0x4855dcefa1a1ecf8b2fbd7eae38b6f73a90f48d1";

export default function Admin() {
  const { address } = useAccount();
  const [allPayments, setAllPayments] = useState<any[]>([]);
  const [merchants, setMerchants] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState("overview");
  const [searchTerm, setSearchTerm] = useState("");
  const [expandedPayment, setExpandedPayment] = useState<string | null>(null);

  // Set-based lock: supports multiple payments processing simultaneously
  // without blocking each other, and prevents double-clicks per payment
  const [processingIds, setProcessingIds] = useState<Set<string>>(new Set());

  const { writeContract: writeMarkAsPaid } = useWriteContract();

  const isAdmin = true;

  // ── Helpers ────────────────────────────────────────────────────────────────
  const fmtNGN = (n: number) =>
    `₦${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  const lockButton = (id: string) =>
    setProcessingIds((prev) => new Set(prev).add(id));

  const unlockButton = (id: string) =>
    setProcessingIds((prev) => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });

  // ── Mark as Paid ───────────────────────────────────────────────────────────
  const markAsPaid = async (paymentId: string) => {
    // Hard guard — ignore if already processing this payment
    if (processingIds.has(paymentId)) return;

    const payment = allPayments.find((p) => p.id === paymentId);
    const usdcAmt = payment?.amount?.toFixed(3) ?? "?";
    const ngnAmt = payment?.lockedAmountNGN
      ? fmtNGN(payment.lockedAmountNGN)
      : "N/A";
    const merchantLabel = payment?.merchantInfo?.isRegistered
      ? payment.merchantInfo.accountName
      : `${payment?.merchant?.slice(0, 6)}...${payment?.merchant?.slice(-4)}`;
    const bankLabel = payment?.merchantInfo?.isRegistered
      ? `${payment.merchantInfo.bankName} · ${payment.merchantInfo.accountNumber}`
      : "No bank registered";

    // Lock immediately before any async work
    lockButton(paymentId);

    const toastId = toast.loading(
      <div>
        <p className="font-semibold text-sm">
          Marking Payment #{paymentId} as Paid
        </p>
        <p className="text-xs text-gray-500 mt-0.5">
          Settling <strong>{ngnAmt}</strong> to <strong>{merchantLabel}</strong>{" "}
          ({bankLabel}) for <strong>{usdcAmt} USDC</strong>. Confirm in your
          wallet.
        </p>
      </div>,
      { duration: Infinity },
    );

    try {
      await writeMarkAsPaid({
        address: CONTRACT_ADDRESS,
        abi: contractABI,
        functionName: "markAsPaid",
        args: [BigInt(paymentId)],
        maxFeePerGas: BigInt(25_000_000),
        maxPriorityFeePerGas: BigInt(1_000_000),
      });

      setAllPayments((prev) =>
        prev.map((p) => (p.id === paymentId ? { ...p, status: "Paid" } : p)),
      );

      toast.success(
        <div>
          <p className="font-semibold text-sm">
            ✅ Payment #{paymentId} Settled
          </p>
          <p className="text-xs text-gray-500 mt-0.5">
            <strong>{ngnAmt}</strong> confirmed as paid to{" "}
            <strong>{merchantLabel}</strong>. On-chain status is now{" "}
            <strong>Paid</strong>.
          </p>
        </div>,
        { id: toastId, duration: 6000 },
      );
    } catch (err: any) {
      console.error("Failed to mark payment as paid:", err);

      const isUserRejected =
        err?.message?.toLowerCase().includes("user rejected") ||
        err?.code === 4001;

      toast.error(
        <div>
          <p className="font-semibold text-sm">
            {isUserRejected ? "Transaction Cancelled" : "Transaction Failed"}
          </p>
          <p className="text-xs text-gray-500 mt-0.5">
            {isUserRejected
              ? `You rejected the signature. Payment #${paymentId} is still Accepted.`
              : `Failed to settle Payment #${paymentId} on-chain. Please try again.`}
          </p>
        </div>,
        { id: toastId, duration: 5000 },
      );
    } finally {
      // Always unlock — whether success or failure
      unlockButton(paymentId);
    }
  };

  // ── Fetch all payments ─────────────────────────────────────────────────────
  const fetchAllPayments = async () => {
    setLoading(true);

    const toastId = toast.loading(
      <div>
        <p className="font-semibold text-sm">Loading Admin Dashboard</p>
        <p className="text-xs text-gray-500 mt-0.5">
          Fetching events and payment data from Arbitrum Sepolia…
        </p>
      </div>,
      { duration: Infinity },
    );

    try {
      const { createPublicClient } = await import("viem");
      const client = createPublicClient({
        chain: arbitrumSepolia,
        transport: http("https://sepolia-rollup.arbitrum.io/rpc"),
      });

      // ── 1. MerchantRegistered → plain-text bank details ──────────────────
      const merchantLogs = await client.getLogs({
        address: CONTRACT_ADDRESS as `0x${string}`,
        event: {
          type: "event",
          name: "MerchantRegistered",
          inputs: [
            { type: "address", name: "merchant", indexed: true },
            { type: "string", name: "bankName", indexed: false },
            { type: "string", name: "accountName", indexed: false },
            { type: "string", name: "accountNumber", indexed: false },
          ],
        },
        fromBlock: BigInt(0),
      });

      const merchantDetailsMap: Record<string, any> = {};
      for (const log of merchantLogs) {
        const args = log.args as any;
        const addr = args.merchant?.toLowerCase();
        if (addr) {
          merchantDetailsMap[addr] = {
            bankName: args.bankName || "N/A",
            accountName: args.accountName || "N/A",
            accountNumber: args.accountNumber || "N/A",
            isRegistered: true,
          };
        }
      }

      // ── 2. PaymentAccepted → lockedRate per payment ID ───────────────────
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

      const lockedRateMap: Record<string, bigint> = {};
      for (const log of acceptedLogs) {
        const args = log.args as any;
        if (args.id !== undefined && args.lockedRate !== undefined) {
          lockedRateMap[args.id.toString()] = args.lockedRate;
        }
      }

      // ── 3. PaymentCreated → original rfce strings ────────────────────────
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

      const rfceMap: Record<string, string> = {};
      for (const log of createdLogs) {
        const args = log.args as any;
        if (args.id !== undefined && args.rfce) {
          rfceMap[args.id.toString()] = args.rfce;
        }
      }

      // ── 4. Probe payment IDs sequentially ───────────────────────────────
      const processedPayments: any[] = [];
      let id = BigInt(1);
      let consecutiveEmpty = 0;
      const MAX_CONSECUTIVE_EMPTY = 3;

      while (consecutiveEmpty < MAX_CONSECUTIVE_EMPTY) {
        try {
          const result: any = await readContract(config, {
            address: CONTRACT_ADDRESS,
            abi: contractABI,
            functionName: "getPayment",
            args: [id],
          });

          const [pid, payer, merchant, amount, timestamp, , status] = result;

          const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
          if (!pid || pid === BigInt(0) || payer === ZERO_ADDRESS) {
            consecutiveEmpty++;
            id++;
            continue;
          }

          consecutiveEmpty = 0;

          const usdcAmount = Number(amount) / 1e6;
          const statusStr =
            ["Pending", "Accepted", "Rejected", "Paid"][Number(status)] ||
            "Unknown";

          const merchantInfo = merchantDetailsMap[merchant?.toLowerCase()] || {
            bankName: "Not Registered",
            accountName: "N/A",
            accountNumber: "N/A",
            isRegistered: false,
          };

          const rawLockedRate = lockedRateMap[pid.toString()];
          const lockedRateNGN = rawLockedRate
            ? Number(rawLockedRate) / 1e18
            : null;
          const lockedAmountNGN = lockedRateNGN
            ? lockedRateNGN * usdcAmount
            : null;

          // Real reference from PaymentCreated event (not truncated hash)
          const rfceDisplay =
            rfceMap[pid.toString()] || `Ref-${pid.toString()}`;

          processedPayments.push({
            id: pid.toString(),
            payer,
            merchant,
            amount: usdcAmount,
            timestamp: new Date(Number(timestamp) * 1000),
            rfce: rfceDisplay,
            status: statusStr,
            lockedRateNGN,
            lockedAmountNGN,
            merchantInfo,
          });

          id++;
        } catch {
          consecutiveEmpty++;
          id++;
        }
      }

      setAllPayments(processedPayments);
      processMerchantsData(processedPayments);

      const uniqueMerchantCount = new Set(
        processedPayments.map((p) => p.merchant),
      ).size;

      toast.success(
        <div>
          <p className="font-semibold text-sm">Dashboard Ready</p>
          <p className="text-xs text-gray-500 mt-0.5">
            Loaded <strong>{processedPayments.length}</strong> payments across{" "}
            <strong>{uniqueMerchantCount}</strong> merchants.
          </p>
        </div>,
        { id: toastId, duration: 4000 },
      );
    } catch (error) {
      console.error("Error fetching all payments:", error);
      toast.error(
        <div>
          <p className="font-semibold text-sm">Failed to Load Dashboard</p>
          <p className="text-xs text-gray-500 mt-0.5">
            Could not fetch on-chain data. Check your connection and try
            refreshing.
          </p>
        </div>,
        { id: toastId, duration: 5000 },
      );
    } finally {
      setLoading(false);
    }
  };

  const processMerchantsData = (payments: any[]) => {
    const uniqueMerchants = [...new Set(payments.map((p) => p.merchant))];
    const merchantsData = uniqueMerchants.map((merchantAddress) => {
      const mp = payments.filter((p) => p.merchant === merchantAddress);
      const first = mp[0];
      return {
        address: merchantAddress,
        bankName: first?.merchantInfo?.bankName || "N/A",
        accountName: first?.merchantInfo?.accountName || "N/A",
        accountNumber: first?.merchantInfo?.accountNumber || "N/A",
        isRegistered: first?.merchantInfo?.isRegistered || false,
        totalPayments: mp.length,
        totalRevenue: mp
          .filter((p) => p.status === "Accepted" || p.status === "Paid")
          .reduce((s, p) => s + p.amount, 0),
        totalNGN: mp
          .filter((p) => p.lockedAmountNGN)
          .reduce((s, p) => s + (p.lockedAmountNGN || 0), 0),
        pendingPayments: mp.filter((p) => p.status === "Pending").length,
      };
    });
    setMerchants(merchantsData);
  };

  useEffect(() => {
    fetchAllPayments();
  }, []);

  // ── Filtered data ──────────────────────────────────────────────────────────
  const filteredPayments = allPayments.filter(
    (p) =>
      p.payer.toLowerCase().includes(searchTerm.toLowerCase()) ||
      p.merchant.toLowerCase().includes(searchTerm.toLowerCase()) ||
      p.rfce.toLowerCase().includes(searchTerm.toLowerCase()) ||
      p.id.toString().includes(searchTerm),
  );

  const filteredMerchants = merchants.filter(
    (m) =>
      m.address.toLowerCase().includes(searchTerm.toLowerCase()) ||
      m.bankName.toLowerCase().includes(searchTerm.toLowerCase()) ||
      m.accountName.toLowerCase().includes(searchTerm.toLowerCase()) ||
      m.accountNumber.toLowerCase().includes(searchTerm.toLowerCase()),
  );

  // ── Summary stats ──────────────────────────────────────────────────────────
  const totalTransactions = allPayments.length;
  const totalVolume = allPayments.reduce((s, p) => s + p.amount, 0);
  const pendingTransactions = allPayments.filter(
    (p) => p.status === "Pending",
  ).length;
  const acceptedTransactions = allPayments.filter(
    (p) => p.status === "Accepted",
  ).length;
  const paidTransactions = allPayments.filter(
    (p) => p.status === "Paid",
  ).length;
  const registeredMerchants = merchants.filter((m) => m.isRegistered).length;

  // ── Status badge ──────────────────────────────────────────────────────────
  const StatusBadge = ({ status }: { status: string }) => {
    const map: Record<string, string> = {
      Pending: "bg-yellow-100 text-yellow-800 border-yellow-200",
      Accepted: "bg-blue-100 text-blue-800 border-blue-200",
      Paid: "bg-green-100 text-green-800 border-green-200",
      Rejected: "bg-red-100 text-red-800 border-red-200",
    };
    return (
      <span
        className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold border ${map[status] || "bg-gray-100 text-gray-600 border-gray-200"}`}
      >
        {status}
      </span>
    );
  };

  // ── Expandable payment row ─────────────────────────────────────────────────
  const PaymentRow = ({ payment }: { payment: any }) => {
    const isExpanded = expandedPayment === payment.id;
    const isProcessing = processingIds.has(payment.id);

    return (
      <>
        <tr
          className="border-b hover:bg-gray-50 cursor-pointer select-none"
          onClick={() => setExpandedPayment(isExpanded ? null : payment.id)}
        >
          <td className="p-3">
            <div className="flex items-center gap-2">
              <span className="text-gray-300 text-xs">
                {isExpanded ? "▼" : "▶"}
              </span>
              <span className="font-semibold text-gray-900 text-sm">
                #{payment.id}
              </span>
            </div>
          </td>
          <td className="p-3 font-mono text-xs text-gray-500">
            {payment.payer.slice(0, 6)}...{payment.payer.slice(-4)}
          </td>
          <td className="p-3">
            {payment.merchantInfo.isRegistered ? (
              <div>
                <p className="text-sm font-medium text-gray-900 leading-tight">
                  {payment.merchantInfo.accountName}
                </p>
                <p className="text-xs text-gray-400">
                  {payment.merchantInfo.bankName}
                </p>
              </div>
            ) : (
              <span className="font-mono text-xs text-gray-400">
                {payment.merchant.slice(0, 6)}...{payment.merchant.slice(-4)}
              </span>
            )}
          </td>
          <td className="p-3 text-right">
            <p className="font-semibold text-gray-900 text-sm">
              {payment.amount.toFixed(2)} USDC
            </p>
            {payment.lockedAmountNGN ? (
              <p className="text-xs text-green-700 font-medium">
                {fmtNGN(payment.lockedAmountNGN)}
              </p>
            ) : payment.status === "Pending" ? (
              <p className="text-xs text-gray-400">Rate not locked</p>
            ) : null}
          </td>
          <td className="p-3 text-right">
            <StatusBadge status={payment.status} />
          </td>
          <td className="p-3 text-right text-xs text-gray-400">
            {payment.timestamp.toLocaleDateString()}
          </td>

          {/* Action cell — stopPropagation so clicks don't expand the row */}
          <td className="p-3 text-right" onClick={(e) => e.stopPropagation()}>
            {payment.status === "Accepted" && (
              <button
                onClick={() => markAsPaid(payment.id)}
                disabled={isProcessing}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap transition-all duration-150 ${
                  isProcessing
                    ? "bg-gray-100 text-gray-400 cursor-not-allowed border border-gray-200"
                    : "bg-green-600 text-white hover:bg-green-700 active:scale-95 shadow-sm"
                }`}
              >
                {isProcessing ? (
                  <span className="flex items-center gap-1.5">
                    {/* Inline spinner — no extra dep */}
                    <svg
                      className="animate-spin h-3 w-3 text-gray-400"
                      viewBox="0 0 24 24"
                      fill="none"
                    >
                      <circle
                        className="opacity-25"
                        cx="12"
                        cy="12"
                        r="10"
                        stroke="currentColor"
                        strokeWidth="4"
                      />
                      <path
                        className="opacity-75"
                        fill="currentColor"
                        d="M4 12a8 8 0 018-8v8H4z"
                      />
                    </svg>
                    Processing…
                  </span>
                ) : (
                  "Mark as Paid"
                )}
              </button>
            )}
            {payment.status === "Paid" && (
              <span className="text-green-600 text-xs font-semibold">
                ✓ Paid
              </span>
            )}
          </td>
        </tr>

        {/* Expanded detail panel */}
        {isExpanded && (
          <tr className="bg-blue-50/60 border-b">
            <td colSpan={7} className="px-5 py-4">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <div className="bg-white rounded-lg p-3 border border-blue-100">
                  <p className="text-xs text-gray-400 mb-1 font-medium uppercase tracking-wide">
                    Payer
                  </p>
                  <p className="font-mono text-xs text-gray-700 break-all">
                    {payment.payer}
                  </p>
                </div>
                <div className="bg-white rounded-lg p-3 border border-blue-100">
                  <p className="text-xs text-gray-400 mb-1 font-medium uppercase tracking-wide">
                    Merchant Bank
                  </p>
                  {payment.merchantInfo.isRegistered ? (
                    <>
                      <p className="text-sm font-semibold text-gray-900">
                        {payment.merchantInfo.accountName}
                      </p>
                      <p className="text-xs text-gray-500">
                        {payment.merchantInfo.bankName}
                      </p>
                      <p className="font-mono text-xs text-gray-600 mt-1 bg-gray-50 px-2 py-1 rounded">
                        {payment.merchantInfo.accountNumber}
                      </p>
                    </>
                  ) : (
                    <p className="text-xs text-gray-400">Not Registered</p>
                  )}
                </div>
                <div className="bg-white rounded-lg p-3 border border-blue-100">
                  <p className="text-xs text-gray-400 mb-1 font-medium uppercase tracking-wide">
                    Amount
                  </p>
                  <p className="text-sm font-semibold text-gray-900">
                    {payment.amount.toFixed(6)} USDC
                  </p>
                  {payment.lockedRateNGN ? (
                    <>
                      <div className="mt-2 pt-2 border-t border-gray-100">
                        <p className="text-xs text-gray-400">Locked rate</p>
                        <p className="text-xs font-medium text-gray-700">
                          {fmtNGN(payment.lockedRateNGN)} / USDC
                        </p>
                      </div>
                      <div className="mt-1">
                        <p className="text-xs text-gray-400">NGN total</p>
                        <p className="text-base font-bold text-green-700">
                          {fmtNGN(payment.lockedAmountNGN!)}
                        </p>
                      </div>
                    </>
                  ) : (
                    <p className="text-xs text-gray-400 mt-2">
                      Rate not yet locked
                    </p>
                  )}
                </div>
                <div className="bg-white rounded-lg p-3 border border-blue-100">
                  <p className="text-xs text-gray-400 mb-1 font-medium uppercase tracking-wide">
                    Reference
                  </p>
                  <p className="font-mono text-xs text-gray-600 break-all bg-gray-50 px-2 py-1 rounded">
                    {payment.rfce}
                  </p>
                  <p className="text-xs text-gray-400 mt-2">
                    🕐 {payment.timestamp.toLocaleString()}
                  </p>
                </div>
              </div>
            </td>
          </tr>
        )}
      </>
    );
  };

  // ── Guards ─────────────────────────────────────────────────────────────────
  if (!isAdmin) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <h1 className="text-2xl font-bold text-red-600 mb-2">
            Access Denied
          </h1>
          <p className="text-gray-500">You don't have admin privileges.</p>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4" />
          <p className="text-gray-600 font-medium">
            Loading admin dashboard...
          </p>
          <p className="text-gray-400 text-sm mt-1">
            Fetching on-chain events & payments
          </p>
        </div>
      </div>
    );
  }

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-gray-50 p-4 sm:p-8">
      <br />
      <br />
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="mb-8 flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold text-gray-900">
              Admin Dashboard
            </h1>
            <p className="text-gray-400 text-sm mt-1">
              SettlX · Arbitrum Sepolia
            </p>
          </div>
          <button
            onClick={fetchAllPayments}
            disabled={loading}
            className="flex items-center gap-2 px-4 py-2 bg-white border border-gray-200 rounded-lg text-sm text-gray-600 hover:bg-gray-50 shadow-sm disabled:opacity-50 disabled:cursor-not-allowed transition-all"
          >
            🔄 Refresh
          </button>
        </div>

        {/* Stat cards */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
          {[
            {
              label: "Total Transactions",
              value: totalTransactions,
              bg: "bg-blue-50",
              text: "text-blue-700",
              icon: "📋",
            },
            {
              label: "Total Volume",
              value: `${totalVolume.toFixed(2)} USDC`,
              bg: "bg-green-50",
              text: "text-green-700",
              icon: "💰",
            },
            {
              label: "Pending",
              value: pendingTransactions,
              bg: "bg-yellow-50",
              text: "text-yellow-700",
              icon: "⏳",
            },
            {
              label: "Registered Merchants",
              value: registeredMerchants,
              bg: "bg-purple-50",
              text: "text-purple-700",
              icon: "🏪",
            },
          ].map(({ label, value, bg, text, icon }) => (
            <div
              key={label}
              className={`${bg} rounded-xl p-5 shadow-sm border border-white`}
            >
              <div className="text-2xl mb-1">{icon}</div>
              <p className={`text-2xl font-bold ${text}`}>{value}</p>
              <p className="text-xs text-gray-500 mt-1">{label}</p>
            </div>
          ))}
        </div>

        {/* Tab panel */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
          {/* Tab bar + search */}
          <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-6">
            <div className="flex gap-2 flex-wrap">
              {[
                { key: "overview", label: "Overview" },
                {
                  key: "transactions",
                  label: `Transactions (${totalTransactions})`,
                },
                { key: "merchants", label: `Merchants (${merchants.length})` },
              ].map(({ key, label }) => (
                <button
                  key={key}
                  onClick={() => setActiveTab(key)}
                  className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                    activeTab === key
                      ? "bg-blue-600 text-white shadow-sm"
                      : "text-gray-500 hover:bg-gray-100"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
            <input
              type="text"
              placeholder="Search by ID, address, reference…"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full sm:w-64 px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 placeholder-gray-400"
            />
          </div>

          {/* ── OVERVIEW ── */}
          {activeTab === "overview" && (
            <div className="space-y-8">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                {[
                  {
                    label: "Pending",
                    count: pendingTransactions,
                    bar: "bg-yellow-400",
                  },
                  {
                    label: "Accepted",
                    count: acceptedTransactions,
                    bar: "bg-blue-500",
                  },
                  {
                    label: "Paid",
                    count: paidTransactions,
                    bar: "bg-green-500",
                  },
                  {
                    label: "Rejected",
                    count: allPayments.filter((p) => p.status === "Rejected")
                      .length,
                    bar: "bg-red-400",
                  },
                ].map(({ label, count, bar }) => (
                  <div
                    key={label}
                    className="bg-gray-50 rounded-lg p-4 border border-gray-100"
                  >
                    <div className="flex justify-between items-center mb-2">
                      <span className="text-sm text-gray-600">{label}</span>
                      <span className="text-xl font-bold text-gray-900">
                        {count}
                      </span>
                    </div>
                    <div className="w-full bg-gray-200 rounded-full h-1.5">
                      <div
                        className={`${bar} h-1.5 rounded-full transition-all duration-700`}
                        style={{
                          width: `${totalTransactions ? (count / totalTransactions) * 100 : 0}%`,
                        }}
                      />
                    </div>
                    <p className="text-xs text-gray-400 mt-1">
                      {totalTransactions
                        ? ((count / totalTransactions) * 100).toFixed(0)
                        : 0}
                      % of total
                    </p>
                  </div>
                ))}
              </div>

              <div>
                <div className="flex items-center gap-2 mb-3">
                  <h3 className="text-base font-semibold text-gray-900">
                    Recent Transactions
                  </h3>
                  <span className="text-xs text-gray-400 bg-gray-100 px-2 py-0.5 rounded">
                    Click row to expand
                  </span>
                </div>
                <div className="border border-gray-200 rounded-lg overflow-hidden overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-gray-50 border-b text-xs text-gray-500 uppercase tracking-wide">
                      <tr>
                        <th className="text-left p-3">ID</th>
                        <th className="text-left p-3">Payer</th>
                        <th className="text-left p-3">Merchant</th>
                        <th className="text-right p-3">Amount</th>
                        <th className="text-right p-3">Status</th>
                        <th className="text-right p-3">Date</th>
                        <th className="text-right p-3">Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredPayments.length === 0 ? (
                        <tr>
                          <td
                            colSpan={7}
                            className="text-center py-10 text-gray-400"
                          >
                            No transactions found
                          </td>
                        </tr>
                      ) : (
                        filteredPayments
                          .slice(0, 10)
                          .map((p) => <PaymentRow key={p.id} payment={p} />)
                      )}
                    </tbody>
                  </table>
                </div>
              </div>

              <div>
                <h3 className="text-base font-semibold text-gray-900 mb-3">
                  Top Merchants
                </h3>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                  {merchants.slice(0, 6).map((m, i) => (
                    <div
                      key={m.address}
                      className="bg-gray-50 border border-gray-100 rounded-lg p-4 flex items-start gap-3"
                    >
                      <div className="w-8 h-8 bg-blue-100 rounded-full flex items-center justify-center text-blue-600 font-bold text-sm shrink-0">
                        {i + 1}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold text-gray-900 truncate">
                          {m.isRegistered ? m.accountName : "Unregistered"}
                        </p>
                        {m.isRegistered && (
                          <>
                            <p className="text-xs text-gray-500">
                              {m.bankName}
                            </p>
                            <p className="font-mono text-xs text-gray-400">
                              {m.accountNumber}
                            </p>
                          </>
                        )}
                        <p className="font-mono text-xs text-gray-300 mt-0.5 truncate">
                          {m.address}
                        </p>
                      </div>
                      <div className="text-right shrink-0">
                        <p className="text-sm font-bold text-gray-900">
                          {m.totalRevenue.toFixed(2)}
                        </p>
                        <p className="text-xs text-gray-400">USDC</p>
                        {m.totalNGN > 0 && (
                          <p className="text-xs text-green-600 font-medium">
                            ₦
                            {m.totalNGN.toLocaleString(undefined, {
                              maximumFractionDigits: 0,
                            })}
                          </p>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* ── TRANSACTIONS ── */}
          {activeTab === "transactions" && (
            <div>
              <p className="text-xs text-gray-400 mb-3">
                Click any row to expand full payment details
              </p>
              <div className="border border-gray-200 rounded-lg overflow-hidden overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 border-b text-xs text-gray-500 uppercase tracking-wide">
                    <tr>
                      <th className="text-left p-3">ID</th>
                      <th className="text-left p-3">Payer</th>
                      <th className="text-left p-3">Merchant</th>
                      <th className="text-right p-3">Amount / NGN</th>
                      <th className="text-right p-3">Status</th>
                      <th className="text-right p-3">Date</th>
                      <th className="text-right p-3">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredPayments.length === 0 ? (
                      <tr>
                        <td
                          colSpan={7}
                          className="text-center py-10 text-gray-400"
                        >
                          No transactions found
                        </td>
                      </tr>
                    ) : (
                      filteredPayments.map((p) => (
                        <PaymentRow key={p.id} payment={p} />
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* ── MERCHANTS ── */}
          {activeTab === "merchants" && (
            <div>
              {filteredMerchants.length === 0 ? (
                <p className="text-center py-10 text-gray-400">
                  No merchants found
                </p>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {filteredMerchants.map((m) => (
                    <div
                      key={m.address}
                      className="bg-white border border-gray-200 rounded-xl p-5 shadow-sm hover:shadow-md transition-shadow"
                    >
                      <div className="flex items-start justify-between mb-3">
                        <div className="flex-1 min-w-0">
                          {m.isRegistered ? (
                            <>
                              <h4 className="font-semibold text-gray-900 truncate">
                                {m.accountName}
                              </h4>
                              <p className="text-xs text-gray-500">
                                {m.bankName}
                              </p>
                              <p className="font-mono text-xs text-gray-400 mt-0.5 bg-gray-50 inline-block px-2 py-0.5 rounded">
                                {m.accountNumber}
                              </p>
                            </>
                          ) : (
                            <h4 className="font-semibold text-gray-400">
                              Unregistered
                            </h4>
                          )}
                        </div>
                        <span
                          className={`ml-2 px-2 py-0.5 rounded-full text-xs font-semibold shrink-0 ${m.isRegistered ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-500"}`}
                        >
                          {m.isRegistered ? "✓ Registered" : "Unregistered"}
                        </span>
                      </div>
                      <div className="bg-gray-50 rounded-lg px-3 py-2 mb-3">
                        <p className="text-xs text-gray-400 mb-0.5">Wallet</p>
                        <p className="font-mono text-xs text-gray-600 break-all">
                          {m.address}
                        </p>
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        {[
                          {
                            label: "Total Payments",
                            value: m.totalPayments,
                            bg: "bg-blue-50",
                            text: "text-blue-700",
                          },
                          {
                            label: "Pending",
                            value: m.pendingPayments,
                            bg: "bg-yellow-50",
                            text: "text-yellow-700",
                          },
                          {
                            label: "USDC Revenue",
                            value: m.totalRevenue.toFixed(2),
                            bg: "bg-green-50",
                            text: "text-green-700",
                          },
                          {
                            label: "NGN Settled",
                            value:
                              m.totalNGN > 0
                                ? `₦${m.totalNGN.toLocaleString(undefined, { maximumFractionDigits: 0 })}`
                                : "—",
                            bg: "bg-purple-50",
                            text: "text-purple-700",
                          },
                        ].map(({ label, value, bg, text }) => (
                          <div
                            key={label}
                            className={`${bg} rounded-lg p-2.5 text-center`}
                          >
                            <p className={`text-sm font-bold ${text}`}>
                              {value}
                            </p>
                            <p className={`text-xs ${text} opacity-70`}>
                              {label}
                            </p>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
