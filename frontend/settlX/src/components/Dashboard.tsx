"use client";

import { useEffect, useState } from "react";
import { useAccount, useReadContract, useWriteContract } from "wagmi";
import { http, parseUnits } from "viem";
import contractABI from "../contracts/settlX.json";
import { readContract } from "wagmi/actions";
import { arbitrumSepolia } from "viem/chains";
import { createConfig } from "@privy-io/wagmi";

export default function Dashboard() {
  const { address } = useAccount();
  const [payments, setPayments] = useState<any[]>([]);
  const CONTRACT_ADDRESS = "0x4b1af11B7e8Ec44634A47c8b420b445cE5d6c578";

  const { data: paymentIds } = useReadContract({
    address: CONTRACT_ADDRESS,
    abi: contractABI.abi,
    functionName: "getMerchantPaymentIds",
    args: [address],
  });

  const { data } = useReadContract({
    address: CONTRACT_ADDRESS,
    abi: contractABI.abi,
  });

  const config = createConfig({
    chains: [arbitrumSepolia],
    transports: {
      [arbitrumSepolia.id]: http("https://sepolia-rollup.arbitrum.io/rpc"),
    },
    ssr: true,
  });

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

            // Destructure the result
            const [pid, payer, merchant, amount, timestamp, rfce, status] =
              result;

            // Convert raw BigInt and numeric fields to readable data
            return {
              id: pid.toString(),
              payer,
              merchant,
              amount: Number(amount) / 1e6, // since USDC has 6 decimals
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

      setPayments(results.filter(Boolean)); // Filter out nulls
    };

    fetchPayments();
  }, [paymentIds]);

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

  return (
    <div className="min-h-screen bg-gray-50 text-gray-900 p-8">
      <div className=" mx-auto bg-white shadow-lg rounded-xl p-8">
        <h2 className="text-2xl font-semibold mb-6">Hello Chigozie</h2>

        {/* Customer */}
        <section className="mb-8">
          <h3 className="text-sm font-semibold text-gray-600 mb-2">
            Bank Details
          </h3>
          <div className="border border-gray-200 rounded-lg p-4">
            <p className="text-sm text-gray-500 mt-2">
              Account Name: Chigozie Christopher <br />
              Account Number: 0156561995 <br />
              Bank Name: Guranty Trust Bank
            </p>
          </div>
        </section>

        {/* Items */}
        <section className="mb-8">
          <h3 className="text-sm font-semibold text-gray-600 mb-2">
            Pending Transactions
          </h3>
          <div className="border border-gray-200 rounded-lg overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b text-gray-600">
                <tr>
                  <th className="text-left p-3">Item details</th>
                  <th className="text-right p-3">Qty</th>
                  <th className="text-right p-3">Price (USDC)</th>
                  <th className="text-right p-3">Price (NGN)</th>
                  <th className="text-right p-3">Actions</th>
                </tr>
              </thead>
              <tbody>
                {payments.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="text-center p-4 text-gray-500">
                      No pending transactions
                    </td>
                  </tr>
                ) : (
                  payments.map((payment) => (
                    <tr key={payment.id} className="border-b">
                      <td className="p-3">
                        <div className="font-medium">Payment #{payment.id}</div>
                        <div className="text-gray-500 text-xs">
                          From: {payment.payer?.slice(0, 8)}...
                          {payment.payer?.slice(-6)}
                        </div>
                      </td>
                      <td className="text-right p-3">{payment.rfce}</td>
                      <td className="text-right p-3">
                        {payment.amount.toFixed(2)} USDC
                      </td>
                      <td className="text-right p-3">{payment.timestamp}</td>
                      <td className="text-right p-3">
                        <span
                          className={`px-2 py-1 rounded-full text-xs ${
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
                      <td className="text-right p-3">
                        {payment.status === "Pending" ? (
                          <div className="flex gap-2 justify-end">
                            <button
                              onClick={() => acceptPayment(payment.id)}
                              className="bg-green-600 text-white px-3 py-1 rounded text-xs hover:bg-green-700"
                            >
                              Accept
                            </button>
                            <button
                              onClick={() => rejectPayment(payment.id)}
                              className="bg-red-600 text-white px-3 py-1 rounded text-xs hover:bg-red-700"
                            >
                              Reject
                            </button>
                          </div>
                        ) : (
                          <span className="text-gray-400">Completed</span>
                        )}
                      </td>
                    </tr>
                  ))
                )}

                <tr className="border-b">
                  <td className="p-3">
                    <div className="font-medium">Logo Design</div>
                    <div className="text-gray-500 text-xs">
                      Designed logo for the app.
                    </div>
                  </td>
                  <td className="text-right p-3">1</td>
                  <td className="text-right p-3">3,000.00 USDT</td>
                  <td className="text-right p-3">-</td>

                  <td className="text-right p-3 text-gray-400 cursor-pointer">
                    ✕
                  </td>
                </tr>
                <tr>
                  <td className="p-3">
                    <div className="flex items-center gap-2">
                      <span className="font-medium">PDF Creation</span>
                      <span className="bg-gray-100 border border-gray-300 text-xs px-2 py-0.5 rounded-full">
                        20.00 USDT off
                      </span>
                    </div>
                    <div className="text-gray-500 text-xs">
                      Designed 2 PDFs.
                    </div>
                  </td>
                  <td className="text-right p-3">1</td>
                  <td className="text-right p-3">100.00 USDT</td>
                  <td className="text-right p-3">6%</td>
                  <td className="text-right p-3 text-gray-400 cursor-pointer">
                    ✕
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          <button className="mt-3 text-fuchsia-600 hover:text-fuchsia-700 font-medium text-sm">
            + Add another item
          </button>
        </section>

        {/* Summary */}
        <div className="flex justify-end">
          <div className="w-full sm:w-1/2 border-t border-gray-200 pt-4 space-y-2 text-sm">
            <div className="flex justify-between">
              <span>Subtotal</span>
              <span>13,080.00 USDT</span>
            </div>
            <div className="flex justify-between">
              <span>GST (6% on 10,000.00)</span>
              <span>600.00 USDT</span>
            </div>
            <div className="flex justify-between">
              <span>GST (6% on 80.00)</span>
              <span>4.80 USDT</span>
            </div>
            <div className="flex justify-between text-base font-semibold mt-3">
              <span>Amount due</span>
              <span>13,684.80 USDT</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
