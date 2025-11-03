"use client";

import { useEffect, useState } from "react";
import { useAccount, useReadContract, useWriteContract } from "wagmi";
import { http } from "viem";
import contractABI from "../contracts/settlX.json";
import { readContract } from "wagmi/actions";
import { arbitrum } from "viem/chains";
import { createConfig } from "@privy-io/wagmi";
import { aggregatorV3InterfaceABI } from "../contracts/aggregrator";

export default function Dashboard() {
  const { address } = useAccount();
  const [payments, setPayments] = useState<any[]>([]);
  const [exchangeRate, setExchangeRate] = useState<number>(1500); // Default rate, you can fetch from API
  const CONTRACT_ADDRESS = "0xA0FeAB4eC9C431e36c0d901ada9b040aD2D85A82";

  const [accountNumber, setAccountNumber] = useState("");
  const [bankCode, setBankCode] = useState("");
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
    abi: contractABI.abi,
    functionName: "getMerchantPaymentIds",
    args: [address],
  });

  const config = createConfig({
    chains: [arbitrum],
    transports: {
      [arbitrum.id]: http("https://arb1.arbitrum.io/rpc"),
    },
    ssr: true,
  });

  const usdcUsdPriceFeed = "0x50834F3163758fcC1Df9973b6e91f0F0F0434aD3";

  const {
    data: roundData,
    isError,
    isLoading,
    refetch,
    //error
  } = useReadContract({
    abi: aggregatorV3InterfaceABI,
    address: usdcUsdPriceFeed,
    functionName: "latestRoundData",
    chainId: arbitrum.id,
  });

  // Extract price data from the tuple
  const usdcPrice = roundData ? Number(roundData[1]) / 10 ** 8 : null;

  // Register merchant bank details on blockchain
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
        abi: contractABI.abi,
        functionName: "registerMerchantBankDetails",
        args: [bankName, accountName, accountNumber],
      });
      console.log("Bank details registered successfully");
      // Refresh merchant info after registration
      setTimeout(() => {
        window.location.reload();
      }, 2000);
    } catch (err) {
      setError("Failed to register bank details");
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  // Fetch merchant info on component load
  useEffect(() => {
    const fetchMerchantInfo = async () => {
      if (!address) return;

      try {
        const result: any = await readContract(config, {
          address: CONTRACT_ADDRESS,
          abi: contractABI.abi,
          functionName: "getMerchantBankDetails",
          args: [address],
        });

        if (result && result[0]) {
          // Check if bank name exists
          setMerchantInfo({
            bankName: result[0],
            accountName: result[1],
            accountNumber: result[2],
          });
        }
      } catch (err) {
        console.error("Error fetching merchant info:", err);
      }
    };

    fetchMerchantInfo();
  }, [address]);

  useEffect(() => {
    const fetchNgnUsdRate = async () => {
      try {
        setRateLoading(true);
        const response = await fetch(
          "https://api.exchangerate.host/live?access_key=ea1d0dec876fe03fb68693737b4216bb&currencies=NGN"
        );
        const data = await response.json();

        if (data.success && data.quotes && data.quotes.USDNGN) {
          // The API returns USDNGN (1 USD = X NGN)
          const usdToNgn = data.quotes.USDNGN;

          // Calculate exchange rate: 1 USDC = (USDC price in USD) * (NGN per USD)
          if (usdcPrice) {
            const calculatedRate = usdcPrice * usdToNgn; // This gives 1 USDC = X NGN
            setExchangeRate(calculatedRate);
          } else {
            // If USDC price is not available, use direct USD to NGN rate
            setExchangeRate(usdToNgn);
          }
        }
      } catch (error) {
        console.error("Error fetching NGN/USD rate:", error);
        setError("Failed to fetch exchange rates");
      } finally {
        setRateLoading(false);
      }
    };

    fetchNgnUsdRate();
    // Refresh every 5 minutes
    const interval = setInterval(fetchNgnUsdRate, 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, []);

  // Update exchange rate when USDC price changes
  useEffect(() => {
    if (usdcPrice) {
      const fetchCurrentNgnRate = async () => {
        try {
          const response = await fetch(
            "https://api.exchangerate.host/live?access_key=ea1d0dec876fe03fb68693737b4216bb&currencies=NGN"
          );
          const data = await response.json();

          if (data.success && data.quotes && data.quotes.USDNGN) {
            const usdToNgn = data.quotes.USDNGN;
            const calculatedRate = usdcPrice * usdToNgn;
            setExchangeRate(calculatedRate);
          }
        } catch (error) {
          console.error("Error updating exchange rate:", error);
        }
      };

      fetchCurrentNgnRate();
    }
  }, [usdcPrice]);

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
              // ngnAmount: ngnAmount.toLocaleString(undefined, {
              //   minimumFractionDigits: 2,
              //   maximumFractionDigits: 2,
              // }),
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

  // const acceptPayment = async (id: string) => {
  //   await writeAccept({
  //     address: CONTRACT_ADDRESS,
  //     abi: contractABI.abi,
  //     functionName: "acceptPayment",
  //     args: [BigInt(id)],
  //   });
  // };

  // Accept payment and lock rate in one transaction

  const acceptPaymentWithRate = async (
    paymentId: string,
    ngnAmount: number
  ) => {
    // setAcceptingPayment(paymentId);
    try {
      // Convert rate to wei (multiply by 10^18 for precision)
      // const rateInWei = BigInt(Math.floor(rate * 10**18));
      const ngnAmountInWei = BigInt(Math.floor(ngnAmount * 10 ** 18));

      await writeAccept({
        address: CONTRACT_ADDRESS,
        abi: contractABI.abi,
        functionName: "acceptPaymentWithRate",
        args: [BigInt(paymentId), ngnAmountInWei],
      });

      // Update local state immediately for better UX
      // setPayments((prev) =>
      //   prev.map((p) =>
      //     p.id === paymentId
      //       ? {
      //           ...p,
      //           status: "Accepted",
      //           lockedRate: rate,
      //           rateLockTimestamp: new Date().toLocaleString(),
      //           effectiveRate: rate,
      //         }
      //       : p
      //   )
      // );

      console.log("Payment accepted with rate locked successfully");
    } catch (err) {
      setError("Failed to accept payment and lock rate");
      console.error(err);
    } finally {
      // setAcceptingPayment(null);
    }
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

  const verifyAccount = async () => {
    if (!accountNumber || !bankCode) {
      setError("Please fill in all fields");
      return;
    }

    setLoading(true);
    setError("");

    try {
      const response = await fetch(
        `/api/verify-account?account_number=${accountNumber}&bank_code=${bankCode}`
      );

      const data = await response.json();

      if (data.status) {
        setAccountName(data.data.account_name);
      } else {
        setError(data.message || "Account verification failed");
        setAccountName("");
      }
    } catch (err) {
      setError("An error occurred while verifying account");
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 text-gray-900 p-4 sm:p-8">
      <br />
      <br />
      <div className=" mx-auto bg-white shadow-lg rounded-xl p-6 sm:p-8">
        {/* Header */}
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center mb-8">
          <div>
            <h2 className="text-2xl font-bold text-gray-900">
              {" "}
              Hello Welcome to Your Merchant Dashboard{" "}
            </h2>
            {/* <p className="text-gray-600 mt-1">Hello</p> */}
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
            {/* Current Bank Details */}
            <section className="mb-8">
              <h3 className="text-lg font-semibold text-gray-900 mb-4">
                Bank Details
              </h3>
              {merchantInfo ? (
                <div className="border border-green-200 rounded-lg p-6 bg-green-50">
                  <div className="space-y-3">
                    <div>
                      <label className="text-sm font-medium text-gray-600">
                        Account Name
                      </label>
                      <p className="text-gray-900">
                        {merchantInfo.accountName}
                      </p>
                    </div>
                    <div>
                      <label className="text-sm font-medium text-gray-600">
                        Account Number
                      </label>
                      <p className="text-gray-900">
                        {merchantInfo.accountNumber}
                      </p>
                    </div>
                    <div>
                      <label className="text-sm font-medium text-gray-600">
                        Bank Name
                      </label>
                      <p className="text-gray-900">{merchantInfo.bankName}</p>
                    </div>
                  </div>
                  <div className="mt-4 p-3 bg-green-100 rounded">
                    <p className="text-sm text-green-700">
                      ✅ Bank details registered on blockchain
                    </p>
                  </div>
                </div>
              ) : (
                <div className="border border-yellow-200 rounded-lg p-6 bg-yellow-50">
                  <p className="text-yellow-700 text-sm">
                    No bank details registered yet. Please register your bank
                    details below.
                  </p>
                </div>
              )}
            </section>

            {/* Register Bank Details Form */}
            {!merchantInfo && (
              <div className="p-6 bg-white rounded-xl shadow-md mb-8">
                <h2 className="text-xl font-bold mb-4">
                  Register Bank Details
                </h2>

                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700">
                      Bank
                    </label>
                    <select
                      value={bankName}
                      onChange={(e) => setBankName(e.target.value)}
                      className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                    >
                      <option value="">Select Bank</option>
                      <option value="Access Bank">Access Bank</option>
                      <option value="GTBank Bank">GTBank Bank</option>
                      <option value="Heritage Bank">Heritage Bank</option>
                      <option value="First Bank">First Bank</option>
                      <option value="United Bank for Africa">
                        United Bank for Africa
                      </option>
                      <option value="Wema Bank">Wema Bank</option>
                      <option value="Ecobank Nigeria">Ecobank Nigeria</option>
                      <option value="Fidelity Bank">Fidelity Bank</option>
                      <option value="First Bankof Nigeria ">
                        First Bank of Nigeria
                      </option>
                      <option value="First City of Nigeria">
                        First City Monument Bank
                      </option>
                      <option value="Jaiz Bank">Jaiz Bank</option>
                      <option value="Keystone Bank">Keystone Bank</option>
                      <option value="Polaris Bank">Polaris Bank</option>
                      <option value="Providus Bank">Providus Bank</option>
                      <option value="Stanbic IBTC ">Stanbic IBTC Bank</option>
                      <option value="Standard Chartered ">
                        Standard Chartered Bank
                      </option>
                      <option value="Sterling Bank">Sterling Bank</option>
                      <option value="Suntrust Bank">Suntrust Bank</option>
                      <option value="Union Bank ">Union Bank of Nigeria</option>
                      <option value="Unity Bank">Unity Bank</option>
                      <option value="VFD Microfinance Bank">
                        VFD Microfinance Bank
                      </option>
                      <option value="Wema Bank">Wema Bank</option>
                      <option value="Zenith Bank">Zenith Bank</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700">
                      Account Number
                    </label>
                    <input
                      type="text"
                      value={accountNumber}
                      onChange={(e) =>
                        setAccountNumber(e.target.value.replace(/\D/g, ""))
                      }
                      placeholder="Enter account number"
                      className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                      // maxLength={10}
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700">
                      Account Name
                    </label>
                    <input
                      type="text"
                      value={accountName}
                      onChange={(e) => setAccountName(e.target.value)}
                      placeholder="Enter account name"
                      className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                      // maxLength={10}
                    />
                  </div>

                  {/* <button
                    onClick={verifyAccount}
                    disabled={loading || !accountNumber || !bankCode}
                    className="w-full bg-blue-600 text-white py-2 px-4 rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:opacity-50"
                  >
                    {loading ? "Verifying..." : "Verify Account"}
                  </button> */}

                  {error && (
                    <div className="text-red-600 text-sm mt-2">{error}</div>
                  )}

                  {accountName && (
                    <div className="mt-4 p-3 bg-green-50 border border-green-200 rounded-md">
                      <p className="text-sm text-green-800">
                        <strong>Verified Account Name:</strong> {accountName}{" "}
                        {accountNumber} {bankName}
                      </p>
                      <p className="text-sm text-green-800 mt-1">
                        <strong>Bank:</strong> {bankName}
                      </p>

                      <button
                        onClick={registerBankDetails}
                        disabled={loading}
                        className="w-full mt-3 bg-green-600 text-white py-2 px-4 rounded-md hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-green-500 focus:ring-offset-2 disabled:opacity-50"
                      >
                        {loading
                          ? "Registering..."
                          : "Register Bank Details on Blockchain"}
                      </button>
                    </div>
                  )}
                </div>
              </div>
            )}

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
                              ₦{payment.ngnAmount}
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
                                  onClick={() =>
                                    acceptPaymentWithRate(
                                      payment.id,
                                      payment.ngnAmount
                                    )
                                  }
                                  className="bg-green-600 text-white px-3 py-2 rounded text-sm hover:bg-green-700 transition-colors font-medium"
                                >
                                  Lock in Rate
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
