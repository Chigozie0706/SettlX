"use client";

import { useEffect, useState } from "react";
import { useAccount, useReadContract, useWriteContract } from "wagmi";
import { http } from "viem";
import contractABI from "../contracts/settlX.json";
import { readContract } from "wagmi/actions";
import { arbitrumSepolia } from "viem/chains";
import { createConfig } from "@privy-io/wagmi";

export default function Dashboard() {
  const { address } = useAccount();
  const [payments, setPayments] = useState<any[]>([]);
  const [exchangeRate, setExchangeRate] = useState<number>(1500); // Default rate, you can fetch from API
  const CONTRACT_ADDRESS = "0x4b1af11B7e8Ec44634A47c8b420b445cE5d6c578";

  const { data: paymentIds } = useReadContract({
    address: CONTRACT_ADDRESS,
    abi: contractABI.abi,
    functionName: "getMerchantPaymentIds",
    args: [address],
  });

  const config = createConfig({
    chains: [arbitrumSepolia],
    transports: {
      [arbitrumSepolia.id]: http("https://sepolia-rollup.arbitrum.io/rpc"),
    },
    ssr: true,
  });

  // Fetch exchange rate (you can replace this with actual API call)
  useEffect(() => {
    const fetchExchangeRate = async () => {
      try {
        // Example: Fetch from Binance API or other crypto price API
        // const response = await fetch('https://api.binance.com/api/v3/ticker/price?symbol=USDCUSDT');
        // const data = await response.json();
        // Then convert USDT to NGN using another API
        setExchangeRate(1520); // Current approximate rate
      } catch (error) {
        console.error("Error fetching exchange rate:", error);
      }
    };

    fetchExchangeRate();
  }, []);

  useEffect(() => {
    const fetchPayments = async () => {
      if (!paymentIds || !Array.isArray(paymentIds) || paymentIds.length === 0)
        return;

      const results = await Promise.all(
        paymentIds.map(async (id: bigint) => {
          try {
            const result: any = await readContract(config, {
              address: CONTRACT_ADDRESS,
              abi: contractABI.abi,
              functionName: "getPayment",
              args: [id],
            });

            const [pid, payer, merchant, amount, timestamp, rfce, status] =
              result;

            const usdcAmount = Number(amount) / 1e6;
            const ngnAmount = usdcAmount * exchangeRate;

            return {
              id: pid.toString(),
              payer,
              merchant,
              amount: usdcAmount,
              ngnAmount: ngnAmount,
              timestamp: new Date(Number(timestamp) * 1000).toLocaleString(),
              rfce,
              status: ["Pending", "Accepted", "Rejected"][Number(status)],
            };
          } catch (err) {
            console.error("Error fetching payment:", err);
            return null;
          }
        })
      );

      setPayments(results.filter(Boolean));
    };

    fetchPayments();
  }, [paymentIds, exchangeRate]);

  const { writeContract: writeAccept } = useWriteContract();
  const { writeContract: writeReject } = useWriteContract();

  const acceptPayment = async (id: string) => {
    await writeAccept({
      address: CONTRACT_ADDRESS,
      abi: contractABI.abi,
      functionName: "acceptPayment",
      args: [BigInt(id)],
    });
  };

  const rejectPayment = async (id: string) => {
    await writeReject({
      address: CONTRACT_ADDRESS,
      abi: contractABI.abi,
      functionName: "rejectPayment",
      args: [BigInt(id)],
    });
  };

  // Calculate totals
  const totalUSDC = payments.reduce((sum, payment) => sum + payment.amount, 0);
  const totalNGN = totalUSDC * exchangeRate;

  return (
    <div className="min-h-screen bg-gray-50 text-gray-900 p-4 sm:p-8">
      <div className=" mx-auto bg-white shadow-lg rounded-xl p-6 sm:p-8">
        {/* Header */}
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center mb-8">
          <div>
            <h2 className="text-2xl font-bold text-gray-900">Hello Chigozie</h2>
            <p className="text-gray-600 mt-1">
              Welcome to your merchant dashboard
            </p>
          </div>
          <div className="mt-4 sm:mt-0 bg-blue-50 px-4 py-2 rounded-lg">
            <p className="text-sm text-blue-700">
              Exchange Rate: 1 USDC = ₦{exchangeRate.toLocaleString()}
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* Left Column - Bank Details */}
          <div className="lg:col-span-1">
            <section className="mb-8">
              <h3 className="text-lg font-semibold text-gray-900 mb-4">
                Bank Details
              </h3>
              <div className="border border-gray-200 rounded-lg p-6 bg-gray-50">
                <div className="space-y-3">
                  <div>
                    <label className="text-sm font-medium text-gray-600">
                      Account Name
                    </label>
                    <p className="text-gray-900">Chigozie Christopher</p>
                  </div>
                  <div>
                    <label className="text-sm font-medium text-gray-600">
                      Account Number
                    </label>
                    <p className="text-gray-900">0156561995</p>
                  </div>
                  <div>
                    <label className="text-sm font-medium text-gray-600">
                      Bank Name
                    </label>
                    <p className="text-gray-900">Guaranty Trust Bank</p>
                  </div>
                </div>
              </div>
            </section>

            {/* Quick Stats */}
            <section>
              <h3 className="text-lg font-semibold text-gray-900 mb-4">
                Quick Stats
              </h3>
              <div className="space-y-4">
                <div className="bg-green-50 p-4 rounded-lg border border-green-200">
                  <p className="text-sm text-green-600 font-medium">
                    Total Pending
                  </p>
                  <p className="text-2xl font-bold text-green-900">
                    {payments.filter((p) => p.status === "Pending").length}
                  </p>
                </div>
                <div className="bg-blue-50 p-4 rounded-lg border border-blue-200">
                  <p className="text-sm text-blue-600 font-medium">
                    Total Amount
                  </p>
                  <p className="text-lg font-bold text-blue-900">
                    {totalUSDC.toFixed(3)} USDC
                  </p>
                  <p className="text-sm text-blue-700">
                    ₦
                    {totalNGN.toLocaleString(undefined, {
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 2,
                    })}
                  </p>
                </div>
              </div>
            </section>
          </div>

          {/* Right Column - Transactions */}
          <div className="lg:col-span-2">
            <section className="mb-8">
              <div className="flex justify-between items-center mb-4">
                <h3 className="text-lg font-semibold text-gray-900">
                  Pending Transactions
                </h3>
                <span className="bg-gray-100 text-gray-600 px-3 py-1 rounded-full text-sm">
                  {payments.filter((p) => p.status === "Pending").length}{" "}
                  pending
                </span>
              </div>

              <div className="border border-gray-200 rounded-lg overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 border-b text-gray-600">
                    <tr>
                      <th className="text-left p-4 font-medium">
                        Payment Details
                      </th>
                      <th className="text-right p-4 font-medium">
                        USDC Amount
                      </th>
                      <th className="text-right p-4 font-medium">
                        NGN Equivalent
                      </th>
                      <th className="text-right p-4 font-medium">Status</th>
                      <th className="text-right p-4 font-medium">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {payments.length === 0 ? (
                      <tr>
                        <td
                          colSpan={5}
                          className="text-center p-8 text-gray-500"
                        >
                          <div className="flex flex-col items-center">
                            <div className="text-4xl mb-2">📝</div>
                            <p>No pending transactions</p>
                            <p className="text-sm text-gray-400 mt-1">
                              Transactions will appear here when customers pay
                            </p>
                          </div>
                        </td>
                      </tr>
                    ) : (
                      payments.map((payment) => (
                        <tr
                          key={payment.id}
                          className="border-b hover:bg-gray-50"
                        >
                          <td className="p-4">
                            <div className="font-medium text-gray-900">
                              Payment #{payment.id}
                            </div>
                            <div className="text-gray-500 text-xs mt-1">
                              From: {payment.payer?.slice(0, 8)}...
                              {payment.payer?.slice(-6)}
                            </div>
                            <div className="text-gray-400 text-xs mt-1">
                              Ref: {payment.rfce}
                            </div>
                            <div className="text-gray-400 text-xs">
                              {payment.timestamp}
                            </div>
                          </td>
                          <td className="text-right p-4 font-medium">
                            {payment.amount.toFixed(3)} USDC
                          </td>
                          <td className="text-right p-4">
                            <div className="font-medium text-gray-900">
                              ₦
                              {payment.ngnAmount.toLocaleString(undefined, {
                                minimumFractionDigits: 2,
                                maximumFractionDigits: 2,
                              })}
                            </div>
                          </td>
                          <td className="text-right p-4">
                            <span
                              className={`inline-flex items-center px-3 py-1 rounded-full text-xs font-medium ${
                                payment.status === "Pending"
                                  ? "bg-yellow-100 text-yellow-800"
                                  : payment.status === "Accepted"
                                  ? "bg-green-100 text-green-800"
                                  : "bg-red-100 text-red-800"
                              }`}
                            >
                              {payment.status}
                            </span>
                          </td>
                          <td className="text-right p-4">
                            {payment.status === "Pending" ? (
                              <div className="flex gap-2 justify-end">
                                <button
                                  onClick={() => acceptPayment(payment.id)}
                                  className="bg-green-600 text-white px-3 py-2 rounded text-sm hover:bg-green-700 transition-colors font-medium"
                                >
                                  Accept
                                </button>
                                <button
                                  onClick={() => rejectPayment(payment.id)}
                                  className="bg-red-600 text-white px-3 py-2 rounded text-sm hover:bg-red-700 transition-colors font-medium"
                                >
                                  Reject
                                </button>
                              </div>
                            ) : (
                              <span className="text-gray-400 text-sm">
                                Completed
                              </span>
                            )}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </section>

            {/* Summary Section */}
            {payments.length > 0 && (
              <div className="bg-gray-50 rounded-lg p-6 border border-gray-200">
                <h4 className="font-semibold text-gray-900 mb-4">
                  Transaction Summary
                </h4>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-sm">
                  <div>
                    <p className="text-gray-600">Pending Transactions</p>
                    <p className="font-semibold text-lg">
                      {payments.filter((p) => p.status === "Pending").length}
                    </p>
                  </div>
                  <div>
                    <p className="text-gray-600">Total USDC</p>
                    <p className="font-semibold text-lg">
                      {totalUSDC.toFixed(3)} USDC
                    </p>
                  </div>
                  <div>
                    <p className="text-gray-600">Total NGN</p>
                    <p className="font-semibold text-lg">
                      ₦
                      {totalNGN.toLocaleString(undefined, {
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 2,
                      })}
                    </p>
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
