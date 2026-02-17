import { useEffect, useState } from "react";
import { useAccount, useReadContract, useWriteContract } from "wagmi";
import contractABI from "../contracts/settlX.json";
import { readContract } from "wagmi/actions";
import { arbitrum } from "viem/chains";
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

  const CONTRACT_ADDRESS = "0xA0FeAB4eC9C431e36c0d901ada9b040aD2D85A82";
  console.log(CONTRACT_ADDRESS);
  const { writeContract: writeMarkAsPaid } = useWriteContract();

  const config = createConfig({
    chains: [arbitrum],
    transports: {
      [arbitrum.id]: http("https://arb1.arbitrum.io/rpc"),
    },
    ssr: true,
  });

  const isAdmin = true;

  // Mark payment as paid
  const markAsPaid = async (paymentId: string) => {
    setMarkingAsPaid(paymentId);
    try {
      await writeMarkAsPaid({
        address: CONTRACT_ADDRESS,
        abi: contractABI.abi,
        functionName: "markAsPaid",
        args: [BigInt(paymentId)],
      });

      // Update local state immediately for better UX
      setAllPayments((prev) =>
        prev.map((p) => (p.id === paymentId ? { ...p, status: "Paid" } : p)),
      );

      console.log("Payment marked as paid successfully");
    } catch (err) {
      console.error("Failed to mark payment as paid:", err);
    } finally {
      setMarkingAsPaid(null);
    }
  };

  const fetchAllPayments = async () => {
    setLoading(true);
    try {
      console.log("Fetching all payments in single call...");

      const result: any = await readContract(config, {
        address: CONTRACT_ADDRESS,
        abi: contractABI.abi,
        functionName: "getAllPayments",
        args: [],
      });

      console.log("Raw contract result:", result);

      const [paymentsData, merchantsData] = result;

      if (!paymentsData || !merchantsData) {
        console.log("No data returned from contract");
        setAllPayments([]);
        setMerchants([]);
        return;
      }

      console.log(
        `Found ${paymentsData.length} payments and ${merchantsData.length} merchant records`,
      );

      // Process payments data
      const processedPayments = paymentsData.map(
        (payment: any, index: number) => {
          const usdcAmount = Number(payment.amount) / 1e6;

          // Calculate locked amount in NGN
          const lockedAmountNGN =
            payment.lockedRate && payment.amount
              ? (Number(payment.amount) / 1e6) *
                (Number(payment.lockedRate) / 1e18)
              : null;

          // Get corresponding merchant info
          const merchantInfo = merchantsData[index];

          let merchantInfoProcessed = {
            bankName: "Not Registered",
            accountName: "N/A",
            accountNumber: "N/A",
            isRegistered: false,
          };

          if (merchantInfo && merchantInfo.isRegistered) {
            merchantInfoProcessed = {
              bankName: merchantInfo.bankName,
              accountName: merchantInfo.accountName,
              accountNumber: merchantInfo.accountNumber,
              isRegistered: true,
            };
          }

          return {
            id: payment.id?.toString() || (index + 1).toString(),
            payer: payment.payer,
            merchant: payment.merchant,
            amount: usdcAmount,
            lockedAmountNGN: lockedAmountNGN,
            timestamp: new Date(Number(payment.timestamp) * 1000),
            rfce: payment.rfce,
            status: ["Pending", "Accepted", "Rejected", "Paid"][
              Number(payment.status)
            ],
            lockedRate: payment.lockedRate
              ? Number(payment.lockedRate) / 10 ** 18
              : null,
            rateLockTimestamp:
              payment.rateLockTimestamp > 0
                ? new Date(Number(payment.rateLockTimestamp) * 1000)
                : null,
            merchantInfo: merchantInfoProcessed,
          };
        },
      );

      console.log(`Processed ${processedPayments.length} payments`);
      setAllPayments(processedPayments);

      // Process merchants data
      processMerchantsData(processedPayments);
    } catch (error) {
      console.error("Error fetching all payments:", error);
    } finally {
      setLoading(false);
    }
  };

  // Process merchants data from payments
  const processMerchantsData = async (payments: any[]) => {
    const uniqueMerchants = [...new Set(payments.map((p) => p.merchant))];
    const merchantsData = [];

    for (const merchantAddress of uniqueMerchants) {
      const merchantPayments = payments.filter(
        (p) => p.merchant === merchantAddress,
      );

      const firstPayment = merchantPayments[0];

      merchantsData.push({
        address: merchantAddress,
        bankName: firstPayment.merchantInfo.bankName,
        accountName: firstPayment.merchantInfo.accountName,
        accountNumber: firstPayment.merchantInfo.accountNumber,
        totalPayments: merchantPayments.length,
        totalRevenue: merchantPayments
          .filter((p) => p.status === "Accepted" || p.status === "Paid")
          .reduce((sum, p) => sum + p.amount, 0),
        pendingPayments: merchantPayments.filter((p) => p.status === "Pending")
          .length,
        isRegistered: firstPayment.merchantInfo.isRegistered,
      });
    }

    setMerchants(merchantsData);
  };

  useEffect(() => {
    const initializeAdminDashboard = async () => {
      await fetchAllPayments();
    };

    initializeAdminDashboard();
  }, []);

  // Filter payments based on search term
  const filteredPayments = allPayments.filter(
    (payment) =>
      payment.payer.toLowerCase().includes(searchTerm.toLowerCase()) ||
      payment.merchant.toLowerCase().includes(searchTerm.toLowerCase()) ||
      payment.rfce.toLowerCase().includes(searchTerm.toLowerCase()) ||
      payment.id.toString().includes(searchTerm),
  );

  const filteredMerchants = merchants.filter(
    (merchant) =>
      merchant.address.toLowerCase().includes(searchTerm.toLowerCase()) ||
      merchant.bankName.toLowerCase().includes(searchTerm.toLowerCase()) ||
      merchant.accountName.toLowerCase().includes(searchTerm.toLowerCase()) ||
      merchant.accountNumber.toLowerCase().includes(searchTerm.toLowerCase()),
  );

  // Calculate statistics
  const totalTransactions = allPayments.length;
  const totalVolume = allPayments.reduce((sum, p) => sum + p.amount, 0);
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

  if (!isAdmin) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <h1 className="text-2xl font-bold text-red-600 mb-4">
            Access Denied
          </h1>
          <p className="text-gray-600">You don't have admin privileges.</p>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
          <p className="text-gray-600">Loading admin dashboard...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 p-4 sm:p-8">
      <br />
      <br />
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-gray-900">Admin Dashboard</h1>
          <p className="text-gray-600 mt-2">
            Monitor all transactions and merchants
          </p>
        </div>

        {/* Stats Overview */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
          <div className="bg-white rounded-xl shadow-lg p-6">
            <div className="flex items-center">
              <div className="p-3 bg-blue-100 rounded-lg">
                <svg
                  className="w-6 h-6 text-blue-600"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"
                  />
                </svg>
              </div>
              <div className="ml-4">
                <p className="text-sm font-medium text-gray-600">
                  Total Transactions
                </p>
                <p className="text-2xl font-bold text-gray-900">
                  {totalTransactions}
                </p>
              </div>
            </div>
          </div>

          <div className="bg-white rounded-xl shadow-lg p-6">
            <div className="flex items-center">
              <div className="p-3 bg-green-100 rounded-lg">
                <svg
                  className="w-6 h-6 text-green-600"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1"
                  />
                </svg>
              </div>
              <div className="ml-4">
                <p className="text-sm font-medium text-gray-600">
                  Total Volume
                </p>
                <p className="text-2xl font-bold text-gray-900">
                  {totalVolume.toFixed(2)} USDC
                </p>
              </div>
            </div>
          </div>

          <div className="bg-white rounded-xl shadow-lg p-6">
            <div className="flex items-center">
              <div className="p-3 bg-yellow-100 rounded-lg">
                <svg
                  className="w-6 h-6 text-yellow-600"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
                  />
                </svg>
              </div>
              <div className="ml-4">
                <p className="text-sm font-medium text-gray-600">Pending</p>
                <p className="text-2xl font-bold text-gray-900">
                  {pendingTransactions}
                </p>
              </div>
            </div>
          </div>

          <div className="bg-white rounded-xl shadow-lg p-6">
            <div className="flex items-center">
              <div className="p-3 bg-purple-100 rounded-lg">
                <svg
                  className="w-6 h-6 text-purple-600"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z"
                  />
                </svg>
              </div>
              <div className="ml-4">
                <p className="text-sm font-medium text-gray-600">Merchants</p>
                <p className="text-2xl font-bold text-gray-900">
                  {registeredMerchants}
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Tabs and Search */}
        <div className="bg-white rounded-xl shadow-lg p-6 mb-8">
          <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-6">
            <div className="flex space-x-4">
              <button
                onClick={() => setActiveTab("overview")}
                className={`px-4 py-2 rounded-lg font-medium ${
                  activeTab === "overview"
                    ? "bg-blue-600 text-white"
                    : "text-gray-600 hover:bg-gray-100"
                }`}
              >
                Overview
              </button>
              <button
                onClick={() => setActiveTab("transactions")}
                className={`px-4 py-2 rounded-lg font-medium ${
                  activeTab === "transactions"
                    ? "bg-blue-600 text-white"
                    : "text-gray-600 hover:bg-gray-100"
                }`}
              >
                All Transactions
              </button>
              <button
                onClick={() => setActiveTab("merchants")}
                className={`px-4 py-2 rounded-lg font-medium ${
                  activeTab === "merchants"
                    ? "bg-blue-600 text-white"
                    : "text-gray-600 hover:bg-gray-100"
                }`}
              >
                Merchants
              </button>
            </div>

            <div className="w-full sm:w-64">
              <input
                type="text"
                placeholder="Search transactions or merchants..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white text-gray-900 placeholder-gray-500"
              />
            </div>
          </div>

          {/* Content based on active tab */}
          {activeTab === "overview" && (
            <div className="space-y-6">
              <div>
                <h3 className="text-lg font-semibold text-gray-900 mb-4">
                  Recent Transactions
                </h3>
                <div className="border border-gray-200 rounded-lg overflow-hidden">
                  <table className="w-full text-sm">
                    <thead className="bg-gray-50 border-b text-gray-600">
                      <tr>
                        <th className="text-left p-4 font-medium">
                          Payment ID
                        </th>
                        <th className="text-left p-4 font-medium">Payer</th>
                        <th className="text-left p-4 font-medium">Merchant</th>
                        <th className="text-right p-4 font-medium">
                          USDC Amount
                        </th>
                        <th className="text-right p-4 font-medium">
                          Locked Amount (NGN)
                        </th>
                        <th className="text-right p-4 font-medium">Status</th>
                        <th className="text-right p-4 font-medium">Date</th>
                        <th className="text-right p-4 font-medium">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredPayments.slice(0, 10).map((payment) => (
                        <tr
                          key={payment.id}
                          className="border-b hover:bg-gray-50"
                        >
                          <td className="p-4 font-medium text-gray-900">
                            #{payment.id}
                          </td>
                          <td className="p-4">
                            <div className="text-gray-600 font-mono text-xs">
                              {payment.payer.slice(0, 8)}...
                              {payment.payer.slice(-6)}
                            </div>
                          </td>
                          <td className="p-4">
                            <div className="text-gray-600 font-mono text-xs">
                              {payment.merchant.slice(0, 8)}...
                              {payment.merchant.slice(-6)}
                            </div>
                          </td>
                          <td className="text-right p-4 font-medium text-gray-900">
                            {payment.amount.toFixed(2)} USDC
                          </td>
                          <td className="text-right p-4 font-medium text-gray-900">
                            {payment.lockedAmountNGN
                              ? payment.lockedAmountNGN.toFixed(2) + " NGN"
                              : "Not locked"}
                          </td>
                          <td className="text-right p-4">
                            <span
                              className={`inline-flex items-center px-3 py-1 rounded-full text-xs font-medium ${
                                payment.status === "Pending"
                                  ? "bg-yellow-100 text-yellow-800 border border-yellow-200"
                                  : payment.status === "Accepted"
                                    ? "bg-blue-100 text-blue-800 border border-blue-200"
                                    : payment.status === "Paid"
                                      ? "bg-green-100 text-green-800 border border-green-200"
                                      : "bg-red-100 text-red-800 border border-red-200"
                              }`}
                            >
                              {payment.status}
                            </span>
                          </td>
                          <td className="text-right p-4 text-gray-500 text-xs">
                            {payment.timestamp.toLocaleDateString()}
                          </td>
                          <td className="text-right p-4">
                            {payment.status === "Accepted" && (
                              <button
                                onClick={() => markAsPaid(payment.id)}
                                disabled={markingAsPaid === payment.id}
                                className="bg-green-600 text-white px-3 py-1 rounded text-sm hover:bg-green-700 transition-colors font-medium disabled:opacity-50"
                              >
                                {markingAsPaid === payment.id
                                  ? "Marking..."
                                  : "Mark as Paid"}
                              </button>
                            )}
                            {payment.status === "Paid" && (
                              <span className="text-green-600 text-sm">
                                ✓ Paid
                              </span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <div>
                  <h3 className="text-lg font-semibold text-gray-900 mb-4">
                    Top Merchants
                  </h3>
                  <div className="bg-gray-50 rounded-lg p-4">
                    {merchants.slice(0, 5).map((merchant, index) => (
                      <div
                        key={merchant.address}
                        className="flex items-center justify-between py-3 border-b border-gray-200 last:border-b-0"
                      >
                        <div className="flex items-center">
                          <div className="w-8 h-8 bg-blue-100 rounded-full flex items-center justify-center text-blue-600 font-semibold text-sm">
                            {index + 1}
                          </div>
                          <div className="ml-3">
                            <div className="text-sm font-medium text-gray-900">
                              {merchant.accountName !== "N/A"
                                ? merchant.accountName
                                : "Unregistered"}
                            </div>
                            <div className="text-xs text-gray-500 font-mono">
                              Acc: {merchant.accountNumber}
                            </div>
                            <div className="text-xs text-gray-500 font-mono">
                              {merchant.address.slice(0, 8)}...
                              {merchant.address.slice(-6)}
                            </div>
                          </div>
                        </div>
                        <div className="text-right">
                          <div className="text-sm font-semibold text-gray-900">
                            {merchant.totalRevenue.toFixed(2)} USDC
                          </div>
                          <div className="text-xs text-gray-500">
                            {merchant.totalPayments} payments
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                <div>
                  <h3 className="text-lg font-semibold text-gray-900 mb-4">
                    Transaction Status
                  </h3>
                  <div className="bg-gray-50 rounded-lg p-6">
                    <div className="space-y-4">
                      <div className="flex justify-between items-center">
                        <span className="text-gray-600">Completed</span>
                        <div className="flex items-center">
                          <span className="font-semibold text-gray-900 mr-2">
                            {paidTransactions}
                          </span>
                          <div className="w-20 bg-gray-200 rounded-full h-2">
                            <div
                              className="bg-green-600 h-2 rounded-full"
                              style={{
                                width: `${
                                  (paidTransactions / totalTransactions) * 100
                                }%`,
                              }}
                            ></div>
                          </div>
                        </div>
                      </div>
                      <div className="flex justify-between items-center">
                        <span className="text-gray-600">Accepted</span>
                        <div className="flex items-center">
                          <span className="font-semibold text-gray-900 mr-2">
                            {acceptedTransactions}
                          </span>
                          <div className="w-20 bg-gray-200 rounded-full h-2">
                            <div
                              className="bg-blue-600 h-2 rounded-full"
                              style={{
                                width: `${
                                  (acceptedTransactions / totalTransactions) *
                                  100
                                }%`,
                              }}
                            ></div>
                          </div>
                        </div>
                      </div>
                      <div className="flex justify-between items-center">
                        <span className="text-gray-600">Pending</span>
                        <div className="flex items-center">
                          <span className="font-semibold text-gray-900 mr-2">
                            {pendingTransactions}
                          </span>
                          <div className="w-20 bg-gray-200 rounded-full h-2">
                            <div
                              className="bg-yellow-600 h-2 rounded-full"
                              style={{
                                width: `${
                                  (pendingTransactions / totalTransactions) *
                                  100
                                }%`,
                              }}
                            ></div>
                          </div>
                        </div>
                      </div>
                      <div className="flex justify-between items-center">
                        <span className="text-gray-600">Rejected</span>
                        <div className="flex items-center">
                          <span className="font-semibold text-gray-900 mr-2">
                            {
                              allPayments.filter((p) => p.status === "Rejected")
                                .length
                            }
                          </span>
                          <div className="w-20 bg-gray-200 rounded-full h-2">
                            <div
                              className="bg-red-600 h-2 rounded-full"
                              style={{
                                width: `${
                                  (allPayments.filter(
                                    (p) => p.status === "Rejected",
                                  ).length /
                                    totalTransactions) *
                                  100
                                }%`,
                              }}
                            ></div>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {activeTab === "transactions" && (
            <div>
              <h3 className="text-lg font-semibold text-gray-900 mb-4">
                All Transactions
              </h3>
              <div className="border border-gray-200 rounded-lg overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 border-b text-gray-600">
                    <tr>
                      <th className="text-left p-4 font-medium">Payment ID</th>
                      <th className="text-left p-4 font-medium">Payer</th>
                      <th className="text-left p-4 font-medium">Merchant</th>
                      <th className="text-left p-4 font-medium">Reference</th>
                      <th className="text-right p-4 font-medium">
                        USDC Amount
                      </th>
                      <th className="text-right p-4 font-medium">
                        Locked Amount (NGN)
                      </th>
                      <th className="text-right p-4 font-medium">Status</th>
                      <th className="text-right p-4 font-medium">Date</th>
                      <th className="text-right p-4 font-medium">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredPayments.map((payment) => (
                      <tr
                        key={payment.id}
                        className="border-b hover:bg-gray-50"
                      >
                        <td className="p-4 font-medium text-gray-900">
                          #{payment.id}
                        </td>
                        <td className="p-4">
                          <div className="text-gray-600 font-mono text-xs">
                            {payment.payer.slice(0, 8)}...
                            {payment.payer.slice(-6)}
                          </div>
                        </td>
                        <td className="p-4">
                          <div className="text-gray-600 font-mono text-xs">
                            {payment.merchant.slice(0, 8)}...
                            {payment.merchant.slice(-6)}
                          </div>
                        </td>
                        <td className="p-4 text-gray-500 text-xs">
                          {payment.rfce}
                        </td>
                        <td className="text-right p-4 font-medium text-gray-900">
                          {payment.amount.toFixed(2)} USDC
                        </td>
                        <td className="text-right p-4 font-medium text-gray-900">
                          {payment.lockedAmountNGN
                            ? payment.lockedAmountNGN.toFixed(2) + " NGN"
                            : "Not locked"}
                        </td>
                        <td className="text-right p-4">
                          <span
                            className={`inline-flex items-center px-3 py-1 rounded-full text-xs font-medium ${
                              payment.status === "Pending"
                                ? "bg-yellow-100 text-yellow-800 border border-yellow-200"
                                : payment.status === "Accepted"
                                  ? "bg-blue-100 text-blue-800 border border-blue-200"
                                  : payment.status === "Paid"
                                    ? "bg-green-100 text-green-800 border border-green-200"
                                    : "bg-red-100 text-red-800 border border-red-200"
                            }`}
                          >
                            {payment.status}
                          </span>
                        </td>
                        <td className="text-right p-4 text-gray-500 text-xs">
                          {payment.timestamp.toLocaleDateString()}
                        </td>
                        <td className="text-right p-4">
                          {payment.status === "Accepted" && (
                            <button
                              onClick={() => markAsPaid(payment.id)}
                              disabled={markingAsPaid === payment.id}
                              className="bg-green-600 text-white px-3 py-1 rounded text-sm hover:bg-green-700 transition-colors font-medium disabled:opacity-50"
                            >
                              {markingAsPaid === payment.id
                                ? "Marking..."
                                : "Mark as Paid"}
                            </button>
                          )}
                          {payment.status === "Paid" && (
                            <span className="text-green-600 text-sm">
                              ✓ Paid
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {activeTab === "merchants" && (
            <div>
              <h3 className="text-lg font-semibold text-gray-900 mb-4">
                All Merchants
              </h3>
              <div className="border border-gray-200 rounded-lg overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 border-b text-gray-600">
                    <tr>
                      <th className="text-left p-4 font-medium">
                        Merchant Address
                      </th>
                      <th className="text-left p-4 font-medium">
                        Bank Details
                      </th>
                      <th className="text-left p-4 font-medium">
                        Account Number
                      </th>
                      <th className="text-right p-4 font-medium">
                        Total Payments
                      </th>
                      <th className="text-right p-4 font-medium">
                        Total Revenue
                      </th>
                      <th className="text-right p-4 font-medium">Pending</th>
                      <th className="text-right p-4 font-medium">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredMerchants.map((merchant) => (
                      <tr
                        key={merchant.address}
                        className="border-b hover:bg-gray-50"
                      >
                        <td className="p-4">
                          <div className="font-medium text-gray-900 font-mono text-xs">
                            {merchant.address}
                          </div>
                        </td>
                        <td className="p-4">
                          {merchant.isRegistered ? (
                            <div>
                              <div className="text-sm font-medium text-gray-900">
                                {merchant.accountName}
                              </div>
                              <div className="text-xs text-gray-500">
                                {merchant.bankName}
                              </div>
                            </div>
                          ) : (
                            <span className="text-gray-400 text-sm">
                              Not Registered
                            </span>
                          )}
                        </td>
                        <td className="p-4">
                          {merchant.isRegistered ? (
                            <div className="text-sm font-medium text-gray-900 font-mono">
                              {merchant.accountNumber}
                            </div>
                          ) : (
                            <span className="text-gray-400 text-sm">N/A</span>
                          )}
                        </td>
                        <td className="text-right p-4 font-medium text-gray-900">
                          {merchant.totalPayments}
                        </td>
                        <td className="text-right p-4 font-medium text-gray-900">
                          {merchant.totalRevenue.toFixed(2)} USDC
                        </td>
                        <td className="text-right p-4">
                          <span className="text-yellow-600 font-medium">
                            {merchant.pendingPayments}
                          </span>
                        </td>
                        <td className="text-right p-4">
                          <span
                            className={`inline-flex items-center px-3 py-1 rounded-full text-xs font-medium ${
                              merchant.isRegistered
                                ? "bg-green-100 text-green-800 border border-green-200"
                                : "bg-gray-100 text-gray-800 border border-gray-200"
                            }`}
                          >
                            {merchant.isRegistered
                              ? "Registered"
                              : "Unregistered"}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
