"use client";

import { useEffect, useState } from "react";
import { useAccount, useWriteContract } from "wagmi";
import contractABI from "../contracts/SettlX1.json";
import { readContract } from "wagmi/actions";
import { arbitrumSepolia } from "viem/chains";
import { createConfig } from "@privy-io/wagmi";
import { http } from "viem";

export default function Admin() {
  const { address } = useAccount();
  const [allPayments, setAllPayments] = useState<any[]>([]);
  const [merchants, setMerchants] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState("overview");
  const [searchTerm, setSearchTerm] = useState("");
  const [markingAsPaid, setMarkingAsPaid] = useState<string | null>(null);
  const [expandedPayment, setExpandedPayment] = useState<string | null>(null);

  const CONTRACT_ADDRESS = "0xc7de1f51613c80557c65b7ef07718952158a445e";

  const { writeContract: writeMarkAsPaid } = useWriteContract();

  const config = createConfig({
    chains: [arbitrumSepolia],
    transports: {
      [arbitrumSepolia.id]: http("https://sepolia-rollup.arbitrum.io/rpc"),
    },
    ssr: true,
  });

  const isAdmin = true;

  const markAsPaid = async (paymentId: string) => {
    setMarkingAsPaid(paymentId);
    try {
      await writeMarkAsPaid({
        address: CONTRACT_ADDRESS,
        abi: contractABI,
        functionName: "markAsPaid",
        args: [BigInt(paymentId)],
        maxFeePerGas: BigInt(100000000),
        maxPriorityFeePerGas: BigInt(10000000),
      });
      setAllPayments((prev) =>
        prev.map((p) => (p.id === paymentId ? { ...p, status: "Paid" } : p)),
      );
    } catch (err) {
      console.error("Failed to mark payment as paid:", err);
    } finally {
      setMarkingAsPaid(null);
    }
  };

  const fetchAllPayments = async () => {
    setLoading(true);
    try {
      const { createPublicClient } = await import("viem");
      const client = createPublicClient({
        chain: arbitrumSepolia,
        transport: http("https://sepolia-rollup.arbitrum.io/rpc"),
      });

      // ── 1. MerchantRegistered events → plain-text bank details ──────────────
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

      // ── 2. PaymentAccepted events → lockedRate per payment ID ───────────────
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

      // Map: payment id string -> lockedRate bigint (NGN per USDC × 1e18)
      const lockedRateMap: Record<string, bigint> = {};
      for (const log of acceptedLogs) {
        const args = log.args as any;
        if (args.id !== undefined && args.lockedRate !== undefined) {
          lockedRateMap[args.id.toString()] = args.lockedRate;
        }
      }

      // ── 3. Probe payment IDs sequentially ───────────────────────────────────
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

          const [pid, payer, merchant, amount, timestamp, rfceHash, status] =
            result;

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
          const rfceDisplay =
            typeof rfceHash === "string"
              ? `${rfceHash.slice(0, 10)}...`
              : `Ref-${pid.toString()}`;

          const merchantInfo = merchantDetailsMap[merchant?.toLowerCase()] || {
            bankName: "Not Registered",
            accountName: "N/A",
            accountNumber: "N/A",
            isRegistered: false,
          };

          // Locked NGN = (lockedRate / 1e18) * usdcAmount
          const rawLockedRate = lockedRateMap[pid.toString()];
          const lockedRateNGN = rawLockedRate
            ? Number(rawLockedRate) / 1e18
            : null;
          const lockedAmountNGN = lockedRateNGN
            ? lockedRateNGN * usdcAmount
            : null;

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
    } catch (error) {
      console.error("Error fetching all payments:", error);
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

  // ── Helpers ────────────────────────────────────────────────────────────────
  const fmtNGN = (n: number) =>
    `₦${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

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
            {payment.lockedAmountNGN && (
              <p className="text-xs text-green-700 font-medium">
                {fmtNGN(payment.lockedAmountNGN)}
              </p>
            )}
            {!payment.lockedAmountNGN && payment.status === "Pending" && (
              <p className="text-xs text-gray-400">Rate not locked</p>
            )}
          </td>
          <td className="p-3 text-right">
            <StatusBadge status={payment.status} />
          </td>
          <td className="p-3 text-right text-xs text-gray-400">
            {payment.timestamp.toLocaleDateString()}
          </td>
          <td className="p-3 text-right" onClick={(e) => e.stopPropagation()}>
            {payment.status === "Accepted" && (
              <button
                onClick={() => markAsPaid(payment.id)}
                disabled={markingAsPaid === payment.id}
                className="bg-green-600 text-white px-3 py-1.5 rounded-lg text-xs hover:bg-green-700 font-medium disabled:opacity-50 whitespace-nowrap"
              >
                {markingAsPaid === payment.id
                  ? "Processing..."
                  : "Mark as Paid"}
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
                {/* Payer */}
                <div className="bg-white rounded-lg p-3 border border-blue-100">
                  <p className="text-xs text-gray-400 mb-1 font-medium uppercase tracking-wide">
                    Payer
                  </p>
                  <p className="font-mono text-xs text-gray-700 break-all">
                    {payment.payer}
                  </p>
                </div>

                {/* Merchant Bank */}
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

                {/* Amount Breakdown */}
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

                {/* Reference + Time */}
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

  // ── Main render ────────────────────────────────────────────────────────────
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
            className="flex items-center gap-2 px-4 py-2 bg-white border border-gray-200 rounded-lg text-sm text-gray-600 hover:bg-gray-50 shadow-sm"
          >
            🔄 Refresh
          </button>
        </div>

        {/* Stat Cards */}
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
              placeholder="Search..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full sm:w-56 px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 placeholder-gray-400"
            />
          </div>

          {/* ── OVERVIEW ── */}
          {activeTab === "overview" && (
            <div className="space-y-8">
              {/* Status mini-cards */}
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
                        className={`${bar} h-1.5 rounded-full`}
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

              {/* Recent transactions */}
              <div>
                <div className="flex items-center gap-2 mb-3">
                  <h3 className="text-base font-semibold text-gray-900">
                    Recent Transactions
                  </h3>
                  <span className="text-xs text-gray-400 bg-gray-100 px-2 py-0.5 rounded">
                    Click a row to expand
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

              {/* Top merchants */}
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
                      {/* Card header */}
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

                      {/* Wallet address */}
                      <div className="bg-gray-50 rounded-lg px-3 py-2 mb-3">
                        <p className="text-xs text-gray-400 mb-0.5">Wallet</p>
                        <p className="font-mono text-xs text-gray-600 break-all">
                          {m.address}
                        </p>
                      </div>

                      {/* Stats grid */}
                      <div className="grid grid-cols-2 gap-2">
                        <div className="bg-blue-50 rounded-lg p-2.5 text-center">
                          <p className="text-xl font-bold text-blue-700">
                            {m.totalPayments}
                          </p>
                          <p className="text-xs text-blue-500">
                            Total Payments
                          </p>
                        </div>
                        <div className="bg-yellow-50 rounded-lg p-2.5 text-center">
                          <p className="text-xl font-bold text-yellow-700">
                            {m.pendingPayments}
                          </p>
                          <p className="text-xs text-yellow-500">Pending</p>
                        </div>
                        <div className="bg-green-50 rounded-lg p-2.5 text-center">
                          <p className="text-sm font-bold text-green-700">
                            {m.totalRevenue.toFixed(2)}
                          </p>
                          <p className="text-xs text-green-500">USDC Revenue</p>
                        </div>
                        <div className="bg-purple-50 rounded-lg p-2.5 text-center">
                          <p className="text-sm font-bold text-purple-700">
                            {m.totalNGN > 0
                              ? `₦${m.totalNGN.toLocaleString(undefined, { maximumFractionDigits: 0 })}`
                              : "—"}
                          </p>
                          <p className="text-xs text-purple-500">NGN Settled</p>
                        </div>
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
