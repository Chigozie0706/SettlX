"use client";

import { useEffect, useState } from "react";
import { useAccount, useWriteContract, useReadContract } from "wagmi";
import { parseUnits, erc20Abi, http } from "viem";
import contractABI from "../contracts/settlX.json";
import toast from "react-hot-toast";
import { readContract } from "wagmi/actions";
import { createConfig } from "@privy-io/wagmi";
import { arbitrum } from "viem/chains";
import { aggregatorV3InterfaceABI } from "../contracts/aggregrator";

export default function Transact() {
  const { address } = useAccount();
  const [merchant, setMerchant] = useState("");
  const [amount, setAmount] = useState("");
  const [rfce, setRfce] = useState("");
  const [payments, setPayments] = useState<any[]>([]);
  const [exchangeRate, setExchangeRate] = useState<number>(1500);

  const [approvalToastId, setApprovalToastId] = useState<string | null>(null);
  const [paymentToastId, setPaymentToastId] = useState<string | null>(null);

  const [isApprovalConfirmed, setIsApprovalConfirmed] = useState(false);

  // Contract addresses
  const USDC_ADDRESS = "0xaf88d065e77c8cC2239327C5EDb3A432268e5831";
  const CONTRACT_ADDRESS = "0x42F6d54A4C771894aD29063b3451C6206cc405f7";
  const usdcUsdPriceFeed = "0x0153002d20B96532C639313c2d54c3dA09109309";

  const config = createConfig({
    chains: [arbitrum],
    transports: {
      [arbitrum.id]: http("https://arb1.arbitrum.io/rpc"),
    },
    ssr: true,
  });

  // Fetch payer's payment IDs
  const { data: paymentIds, refetch: refetchPayments } = useReadContract({
    address: CONTRACT_ADDRESS,
    abi: contractABI.abi,
    functionName: "getPayerPaymentIds",
    args: [address],
  });

  // Fetch USDC price
  const { data: roundData } = useReadContract({
    abi: aggregatorV3InterfaceABI,
    address: usdcUsdPriceFeed,
    functionName: "latestRoundData",
    chainId: arbitrum.id,
  });

  const usdcPrice = roundData ? Number(roundData[1]) / 10 ** 8 : null;

  // Fetch exchange rate
  useEffect(() => {
    const fetchNgnUsdRate = async () => {
      try {
        const response = await fetch(
          "https://api.exchangerate.host/live?access_key=ea1d0dec876fe03fb68693737b4216bb&currencies=NGN"
        );
        const data = await response.json();

        if (data.success && data.quotes && data.quotes.USDNGN) {
          const usdToNgn = data.quotes.USDNGN;
          if (usdcPrice) {
            const calculatedRate = usdcPrice * usdToNgn;
            setExchangeRate(calculatedRate);
          } else {
            setExchangeRate(usdToNgn);
          }
        }
      } catch (error) {
        console.error("Error fetching NGN/USD rate:", error);
      }
    };

    fetchNgnUsdRate();
  }, [usdcPrice]);

  // Fetch payment details
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

  // --- Approve USDC Spending ---
  const { writeContractAsync: writeApproval, isPending: isApproving } =
    useWriteContract();

  const approveUSDC = async (amount: string) => {
    const amountInWei = parseUnits(amount, 6);
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
      return true;
    } catch (error) {
      console.error("Approval failed:", error);
      toast.error("Failed to approve USDC spending");
      setApprovalToastId(null);
      return false;
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
      toast.dismiss(toastId);
      setPaymentToastId(null);

      // Refresh payments list
      setTimeout(() => {
        refetchPayments();
      }, 2000);

      return true;
    } catch (error) {
      console.error("Payment failed:", error);
      toast.error("Failed to create payment");
      setPaymentToastId(null);
      return false;
    }
  };

  // --- Combined Flow ---
  const handleSubmit = async () => {
    if (!merchant || !amount || !rfce) {
      toast.error("Please fill in all fields");
      return;
    }

    if (!address) {
      toast.error("Please connect your wallet");
      return;
    }

    // Reset approval state for new transaction
    setIsApprovalConfirmed(false);

    const approvalSuccess = await approveUSDC(amount);
    if (approvalSuccess) {
      const paymentSuccess = await payMerchant(merchant, amount, rfce);
      if (paymentSuccess) {
        // Reset form
        setMerchant("");
        setAmount("");
        setRfce("");
        toast.success("💰 Payment sent and pending merchant approval!");
      }
    }
  };

  const isLoading = isApproving || isPaying;

  // Calculate totals
  const totalUSDC = payments.reduce((sum, payment) => sum + payment.amount, 0);
  const totalNGN = totalUSDC * exchangeRate;

  return (
    <div className="min-h-screen bg-gray-50 p-4 sm:p-8">
      <br />
      <br />
      <br />

      <div className=" mx-auto">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-gray-900">Make a Payment</h1>
          <p className="text-gray-600 mt-2">Send USDC to merchants securely</p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* Left Column - Payment Form */}
          <div className="lg:col-span-1">
            <div className="bg-white rounded-xl shadow-lg p-6">
              <h2 className="text-xl font-semibold text-gray-900 mb-6">
                New Payment
              </h2>

              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Merchant Address
                  </label>
                  <input
                    type="text"
                    placeholder="0x..."
                    value={merchant}
                    onChange={(e) => setMerchant(e.target.value)}
                    className="w-full px-3 py-3 border border-gray-300 rounded-lg shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white text-gray-900 placeholder-gray-500"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Amount (USDC)
                  </label>
                  <input
                    type="number"
                    placeholder="0.00"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    step="0.001"
                    min="0"
                    className="w-full px-3 py-3 border border-gray-300 rounded-lg shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white text-gray-900 placeholder-gray-500"
                  />
                  {amount && (
                    <p className="text-sm text-gray-500 mt-1">
                      ≈ ₦
                      {(
                        parseFloat(amount || "0") * exchangeRate
                      ).toLocaleString(undefined, {
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 2,
                      })}
                    </p>
                  )}
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Payment Reference
                  </label>
                  <input
                    type="text"
                    placeholder="Enter reference code"
                    value={rfce}
                    onChange={(e) => setRfce(e.target.value)}
                    className="w-full px-3 py-3 border border-gray-300 rounded-lg shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white text-gray-900 placeholder-gray-500"
                  />
                </div>

                <button
                  onClick={handleSubmit}
                  disabled={isLoading || !address}
                  className="w-full bg-blue-600 text-white py-3 px-4 rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:opacity-50 font-medium"
                >
                  {isLoading ? "Processing..." : "Make Payment"}
                </button>

                {!address && (
                  <p className="text-sm text-red-600 text-center">
                    Please connect your wallet to make a payment
                  </p>
                )}
              </div>

              {/* Exchange Rate Info */}
              <div className="mt-6 p-4 bg-blue-50 rounded-lg">
                <p className="text-sm text-blue-700 text-center">
                  Exchange Rate: 1 USDC = ₦{exchangeRate.toLocaleString()}
                </p>
              </div>
            </div>

            {/* Quick Stats */}
            <div className="mt-8 bg-white rounded-xl shadow-lg p-6">
              <h3 className="text-lg font-semibold text-gray-900 mb-4">
                Payment Summary
              </h3>
              <div className="space-y-4">
                <div className="flex justify-between items-center">
                  <span className="text-gray-600">Total Payments</span>
                  <span className="font-semibold">{payments.length}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-gray-600">Pending</span>
                  <span className="font-semibold text-yellow-600">
                    {payments.filter((p) => p.status === "Pending").length}
                  </span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-gray-600">Accepted</span>
                  <span className="font-semibold text-green-600">
                    {payments.filter((p) => p.status === "Accepted").length}
                  </span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-gray-600">Rejected</span>
                  <span className="font-semibold text-red-600">
                    {payments.filter((p) => p.status === "Rejected").length}
                  </span>
                </div>
                <div className="pt-4 border-t">
                  <div className="flex justify-between items-center text-lg">
                    <span className="text-gray-700 font-medium">
                      Total Sent
                    </span>
                    <div className="text-right">
                      <div className="font-bold text-gray-900">
                        {totalUSDC.toFixed(3)} USDC
                      </div>
                      <div className="text-sm text-gray-600">
                        ₦
                        {totalNGN.toLocaleString(undefined, {
                          minimumFractionDigits: 2,
                          maximumFractionDigits: 2,
                        })}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Right Column - Transaction History */}
          <div className="lg:col-span-2">
            <div className="bg-white rounded-xl shadow-lg p-6">
              <div className="flex justify-between items-center mb-6">
                <h2 className="text-xl font-semibold text-gray-900">
                  Payment History
                </h2>
                <span className="bg-gray-100 text-gray-600 px-3 py-1 rounded-full text-sm">
                  {payments.length} payments
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
                      <th className="text-right p-4 font-medium">Merchant</th>
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
                            <div className="text-4xl mb-2">💸</div>
                            <p>No payments yet</p>
                            <p className="text-sm text-gray-400 mt-1">
                              Your payment history will appear here
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
                            <div className="text-gray-400 text-xs mt-1">
                              Ref: {payment.rfce}
                            </div>
                            <div className="text-gray-400 text-xs">
                              {payment.timestamp}
                            </div>
                          </td>
                          <td className="text-right p-4 font-medium text-gray-900">
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
                            <div className="text-gray-500 text-xs">
                              {payment.merchant?.slice(0, 8)}...
                              {payment.merchant?.slice(-6)}
                            </div>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>

              {/* Summary for larger screens */}
              {payments.length > 0 && (
                <div className="mt-6 bg-gray-50 rounded-lg p-4 border border-gray-200">
                  <div className="grid grid-cols-1 sm:grid-cols-4 gap-4 text-sm">
                    <div>
                      <p className="text-gray-600">Total Payments</p>
                      <p className="font-medium text-lg text-gray-900">
                        {payments.length}
                      </p>
                    </div>
                    <div>
                      <p className="text-gray-600">Pending</p>
                      <p className="font-medium text-lg text-yellow-600">
                        {payments.filter((p) => p.status === "Pending").length}
                      </p>
                    </div>
                    <div>
                      <p className="text-gray-600">Total USDC</p>
                      <p className="font-semibold font-medium text-gray-900 text-lg">
                        {totalUSDC.toFixed(3)} USDC
                      </p>
                    </div>
                    <div>
                      <p className="text-gray-600">Total NGN</p>
                      <p className="font-semibold font-medium text-gray-900 text-lg">
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
    </div>
  );
}
