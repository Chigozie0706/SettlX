"use client";

import { useCallback, useEffect, useState } from "react";
import { useAccount, useReadContract, useWriteContract } from "wagmi";
import { http } from "viem";
import contractABI from "../contracts/settlX.json";
import { readContract, waitForTransactionReceipt } from "wagmi/actions";
import { arbitrumSepolia } from "viem/chains";
import { createConfig } from "@privy-io/wagmi";
import { aggregatorV3InterfaceABI } from "../contracts/aggregrator";
import toast from "react-hot-toast";

// ── Config outside component ──────────────────────────────────────────────────
const config = createConfig({
  chains: [arbitrumSepolia],
  transports: {
    [arbitrumSepolia.id]: http("https://sepolia-rollup.arbitrum.io/rpc"),
  },
  ssr: true,
});

const CONTRACT_ADDRESS = "0x4855dcefa1a1ecf8b2fbd7eae38b6f73a90f48d1";
const USDC_USD_PRICE_FEED = "0x50834F3163758fcC1Df9973b6e91f0F0F0434aD3";

const NIGERIAN_BANKS = [
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
];

// ── Status badge (defined outside component to avoid remounting on every render) ──
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

export default function Dashboard() {
  const { address } = useAccount();
  const [payments, setPayments] = useState<any[]>([]);
  const [exchangeRate, setExchangeRate] = useState<number>(1500);
  const [activeTab, setActiveTab] = useState<"pending" | "all">("pending");

  // Shared form state — used for both register and update
  const [accountNumber, setAccountNumber] = useState("");
  const [accountName, setAccountName] = useState("");
  const [bankName, setBankName] = useState("");

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [rateLoading, setRateLoading] = useState(true);
  const [merchantInfo, setMerchantInfo] = useState<any>(null);

  // Controls whether the update form is shown (collapsed by default)
  const [showUpdateForm, setShowUpdateForm] = useState(false);

  const { writeContractAsync: writeAccept } = useWriteContract();
  const { writeContractAsync: writeReject } = useWriteContract();
  const { writeContractAsync: writeRegister } = useWriteContract();
  const { writeContractAsync: writeUpdate } = useWriteContract();

  const { data: paymentIds, refetch: refetchPayments } = useReadContract({
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

  // ── Fetch merchant info (MerchantRegistered + MerchantUpdated events) ─────
  // Wrapped in useCallback so it can be safely listed in useEffect deps
  // without causing infinite re-render loops.
  const fetchMerchantInfo = useCallback(async () => {
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

      if (!isRegistered) {
        setMerchantInfo(null);
        return;
      }

      const { createPublicClient } = await import("viem");
      const client = createPublicClient({
        chain: arbitrumSepolia,
        transport: http("https://sepolia-rollup.arbitrum.io/rpc"),
      });

      // Fetch both event types in parallel
      const [registeredLogs, updatedLogs] = await Promise.all([
        client.getLogs({
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
        }),
        client.getLogs({
          address: CONTRACT_ADDRESS,
          event: {
            type: "event",
            name: "MerchantUpdated",
            inputs: [
              { type: "address", name: "merchant", indexed: true },
              { type: "string", name: "bankName" },
              { type: "string", name: "accountName" },
              { type: "string", name: "accountNumber" },
            ],
          },
          args: { merchant: address },
          fromBlock: BigInt(0),
        }),
      ]);

      // Merge and sort by block number — highest block = most recent event
      type LogEntry = { blockNumber: bigint | null; args: any };
      const allLogs: LogEntry[] = [
        ...registeredLogs.map((l) => ({
          blockNumber: l.blockNumber,
          args: l.args,
        })),
        ...updatedLogs.map((l) => ({
          blockNumber: l.blockNumber,
          args: l.args,
        })),
      ].sort((a, b) =>
        Number((a.blockNumber ?? BigInt(0)) - (b.blockNumber ?? BigInt(0))),
      );

      if (allLogs.length > 0) {
        const latest = allLogs[allLogs.length - 1];
        setMerchantInfo({
          isRegistered: true,
          bankName: (latest.args as any).bankName,
          accountName: (latest.args as any).accountName,
          accountNumber: (latest.args as any).accountNumber,
        });
      }
    } catch (err) {
      console.error("Error fetching merchant info:", err);
    }
  }, [address]); // useCallback re-creates only when address changes

  useEffect(() => {
    fetchMerchantInfo();
  }, [fetchMerchantInfo]);

  // ── Register bank details (first time) ───────────────────────────────────
  const registerBankDetails = async () => {
    if (!bankName || !accountName || !accountNumber) {
      toast.error(
        <div>
          <p className="font-semibold text-sm">Missing Fields</p>
          <p className="text-xs text-gray-500 mt-0.5">
            Please fill in all bank details before registering.
          </p>
        </div>,
      );
      return;
    }

    setLoading(true);
    setError("");

    const toastId = toast.loading(
      <div>
        <p className="font-semibold text-sm">Registering Bank Details</p>
        <p className="text-xs text-gray-500 mt-0.5">
          Storing your bank info securely on-chain as hashed data. Confirm in
          your wallet.
        </p>
      </div>,
      { duration: Infinity },
    );

    try {
      // writeContractAsync resolves with the tx hash as soon as MetaMask receives
      // the request — before you sign. waitForTransactionReceipt waits for the
      // chain to actually confirm the block. Success toast only fires after that.
      const hash = await writeRegister({
        address: CONTRACT_ADDRESS,
        abi: contractABI,
        functionName: "registerMerchantBankDetails",
        args: [bankName, accountName, accountNumber],
        maxFeePerGas: BigInt(25_000_000),
        maxPriorityFeePerGas: BigInt(1_000_000),
      });

      toast.loading(
        <div>
          <p className="font-semibold text-sm">⏳ Waiting for Confirmation</p>
          <p className="text-xs text-gray-500 mt-0.5">
            Transaction signed. Waiting for Arbitrum to confirm the block…
          </p>
        </div>,
        { id: toastId },
      );

      await waitForTransactionReceipt(config, { hash });

      toast.success(
        <div>
          <p className="font-semibold text-sm">✅ Bank Details Registered!</p>
          <p className="text-xs text-gray-500 mt-0.5">
            <strong>{accountName}</strong> at <strong>{bankName}</strong> is now
            stored on-chain. Reloading…
          </p>
        </div>,
        { id: toastId, duration: 4000 },
      );

      setTimeout(() => window.location.reload(), 2000);
    } catch (err: any) {
      console.error(err);
      const isUserRejected =
        err?.message?.toLowerCase().includes("user rejected") ||
        err?.code === 4001;

      toast.error(
        <div>
          <p className="font-semibold text-sm">
            {isUserRejected ? "Registration Cancelled" : "Registration Failed"}
          </p>
          <p className="text-xs text-gray-500 mt-0.5">
            {isUserRejected
              ? "You rejected the wallet signature. No data was stored."
              : "Failed to register bank details on-chain. Please try again."}
          </p>
        </div>,
        { id: toastId, duration: 5000 },
      );
      setError(
        isUserRejected
          ? "Registration cancelled."
          : "Failed to register bank details.",
      );
    } finally {
      setLoading(false);
    }
  };

  // ── Update bank details (already registered) ─────────────────────────────
  const updateBankDetails = async () => {
    if (!bankName || !accountName || !accountNumber) {
      toast.error(
        <div>
          <p className="font-semibold text-sm">Missing Fields</p>
          <p className="text-xs text-gray-500 mt-0.5">
            All three fields are required to update bank details.
          </p>
        </div>,
      );
      return;
    }

    // Warn if nothing actually changed
    if (
      bankName === merchantInfo?.bankName &&
      accountName === merchantInfo?.accountName &&
      accountNumber === merchantInfo?.accountNumber
    ) {
      toast(
        <div>
          <p className="font-semibold text-sm">No Changes Detected</p>
          <p className="text-xs text-gray-500 mt-0.5">
            The details you entered match what's already on-chain.
          </p>
        </div>,
        { icon: "ℹ️", duration: 4000 },
      );
      return;
    }

    setLoading(true);
    setError("");

    const toastId = toast.loading(
      <div>
        <p className="font-semibold text-sm">Updating Bank Details</p>
        <p className="text-xs text-gray-500 mt-0.5">
          Overwriting your existing bank info on-chain with new hashes. Confirm
          in your wallet.
        </p>
      </div>,
      { duration: Infinity },
    );

    try {
      const updateHash = await writeUpdate({
        address: CONTRACT_ADDRESS,
        abi: contractABI,
        functionName: "updateMerchantBankDetails",
        args: [bankName, accountName, accountNumber],
        maxFeePerGas: BigInt(25_000_000), // 25 gwei — safe buffer above current base fee
        maxPriorityFeePerGas: BigInt(1_000_000), // 0.001 gwei tip
      });

      toast.loading(
        <div>
          <p className="font-semibold text-sm">⏳ Waiting for Confirmation</p>
          <p className="text-xs text-gray-500 mt-0.5">
            Transaction signed. Waiting for Arbitrum to confirm the block…
          </p>
        </div>,
        { id: toastId },
      );

      await waitForTransactionReceipt(config, { hash: updateHash });

      toast.success(
        <div>
          <p className="font-semibold text-sm">✅ Bank Details Updated!</p>
          <p className="text-xs text-gray-500 mt-0.5">
            Your account is now set to <strong>{accountName}</strong> at{" "}
            <strong>{bankName}</strong> · <strong>{accountNumber}</strong>.
            Refreshing…
          </p>
        </div>,
        { id: toastId, duration: 5000 },
      );

      // Re-fetch from events — no full page reload needed
      setTimeout(async () => {
        await fetchMerchantInfo();
        setShowUpdateForm(false);
        setBankName("");
        setAccountName("");
        setAccountNumber("");
      }, 1000);
    } catch (err: any) {
      console.error(err);
      const isUserRejected =
        err?.message?.toLowerCase().includes("user rejected") ||
        err?.code === 4001;

      toast.error(
        <div>
          <p className="font-semibold text-sm">
            {isUserRejected ? "Update Cancelled" : "Update Failed"}
          </p>
          <p className="text-xs text-gray-500 mt-0.5">
            {isUserRejected
              ? "You rejected the wallet signature. Your details are unchanged."
              : "Failed to update bank details on-chain. Please try again."}
          </p>
        </div>,
        { id: toastId, duration: 5000 },
      );
      setError(
        isUserRejected ? "Update cancelled." : "Failed to update bank details.",
      );
    } finally {
      setLoading(false);
    }
  };

  // Pre-fill the update form with current on-chain values when it opens
  const openUpdateForm = () => {
    setBankName(merchantInfo?.bankName ?? "");
    setAccountName(merchantInfo?.accountName ?? "");
    setAccountNumber(merchantInfo?.accountNumber ?? "");
    setError("");
    setShowUpdateForm(true);
  };

  const cancelUpdate = () => {
    setShowUpdateForm(false);
    setBankName("");
    setAccountName("");
    setAccountNumber("");
    setError("");
  };

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

  // ── Fetch payments + locked rates from events ─────────────────────────────
  useEffect(() => {
    const fetchPayments = async () => {
      if (!paymentIds || !Array.isArray(paymentIds) || paymentIds.length === 0)
        return;

      const { createPublicClient } = await import("viem");
      const client = createPublicClient({
        chain: arbitrumSepolia,
        transport: http("https://sepolia-rollup.arbitrum.io/rpc"),
      });

      const [acceptedLogs, createdLogs] = await Promise.all([
        client.getLogs({
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
        }),
        client.getLogs({
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
        }),
      ]);

      const lockedRateMap: Record<string, bigint> = {};
      for (const log of acceptedLogs) {
        const args = log.args as any;
        if (args.id !== undefined && args.lockedRate !== undefined) {
          lockedRateMap[args.id.toString()] = args.lockedRate;
        }
      }

      const rfceMap: Record<string, string> = {};
      for (const log of createdLogs) {
        const args = log.args as any;
        if (args.id !== undefined && args.rfce) {
          rfceMap[args.id.toString()] = args.rfce;
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

            const [pid, payer, merchant, amount, timestamp, , status] = result;
            const usdcAmount = Number(amount) / 1e6;
            const rawLockedRate = lockedRateMap[pid.toString()];
            const lockedRateNGN = rawLockedRate
              ? Number(rawLockedRate) / 1e18
              : null;
            const lockedAmountNGN = lockedRateNGN
              ? lockedRateNGN * usdcAmount
              : null;
            const liveNgnAmount = usdcAmount * exchangeRate;
            const rfceDisplay =
              rfceMap[pid.toString()] || `Ref-${pid.toString()}`;
            const statusStr =
              ["Pending", "Accepted", "Rejected", "Paid"][Number(status)] ||
              "Unknown";

            return {
              id: pid.toString(),
              payer,
              merchant,
              amount: usdcAmount,
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

  // ── Accept payment with locked rate ───────────────────────────────────────
  const acceptPaymentWithRate = async (
    paymentId: string,
    ngnAmount: number,
  ) => {
    const ngnAmountInWei = BigInt(Math.floor(ngnAmount * 10 ** 18));
    const payment = payments.find((p) => p.id === paymentId);
    const usdcAmt = payment?.amount?.toFixed(3) ?? "?";
    const shortPayer = payment?.payer
      ? `${payment.payer.slice(0, 6)}...${payment.payer.slice(-4)}`
      : "payer";

    const toastId = toast.loading(
      <div>
        <p className="font-semibold text-sm">🔒 Locking Exchange Rate</p>
        <p className="text-xs text-gray-500 mt-0.5">
          Accepting <strong>{usdcAmt} USDC</strong> from{" "}
          <span className="font-mono">{shortPayer}</span> at{" "}
          <strong>{fmtNGN(ngnAmount)}</strong>. Confirm in your wallet.
        </p>
      </div>,
      { duration: Infinity },
    );

    try {
      const acceptHash = await writeAccept({
        address: CONTRACT_ADDRESS,
        abi: contractABI,
        functionName: "acceptPaymentWithRate",
        args: [BigInt(paymentId), ngnAmountInWei],
        maxFeePerGas: BigInt(25_000_000),
        maxPriorityFeePerGas: BigInt(1_000_000),
      });

      toast.loading(
        <div>
          <p className="font-semibold text-sm">⏳ Waiting for Confirmation</p>
          <p className="text-xs text-gray-500 mt-0.5">
            Transaction signed. Waiting for Arbitrum to confirm the block…
          </p>
        </div>,
        { id: toastId },
      );

      await waitForTransactionReceipt(config, { hash: acceptHash });

      toast.success(
        <div>
          <p className="font-semibold text-sm">✅ Rate Locked!</p>
          <p className="text-xs text-gray-500 mt-0.5">
            Payment #{paymentId} accepted at{" "}
            <strong>{fmtNGN(ngnAmount)}</strong>. USDC has moved to treasury.
            Awaiting NGN bank transfer from admin.
          </p>
        </div>,
        { id: toastId, duration: 6000 },
      );

      setTimeout(() => refetchPayments(), 1000);
    } catch (err: any) {
      console.error(err);
      const isUserRejected =
        err?.message?.toLowerCase().includes("user rejected") ||
        err?.code === 4001;

      toast.error(
        <div>
          <p className="font-semibold text-sm">
            {isUserRejected ? "Acceptance Cancelled" : "Acceptance Failed"}
          </p>
          <p className="text-xs text-gray-500 mt-0.5">
            {isUserRejected
              ? "You rejected the wallet signature. The payment is still pending."
              : `Failed to lock rate for Payment #${paymentId}. Please try again.`}
          </p>
        </div>,
        { id: toastId, duration: 5000 },
      );
    }
  };

  // ── Reject payment ─────────────────────────────────────────────────────────
  const rejectPayment = async (id: string) => {
    const payment = payments.find((p) => p.id === id);
    const usdcAmt = payment?.amount?.toFixed(3) ?? "?";
    const shortPayer = payment?.payer
      ? `${payment.payer.slice(0, 6)}...${payment.payer.slice(-4)}`
      : "payer";

    toast(
      <div>
        <p className="font-semibold text-sm">⚠️ Rejecting Payment #{id}</p>
        <p className="text-xs text-gray-500 mt-0.5">
          <strong>{usdcAmt} USDC</strong> will be refunded to{" "}
          <span className="font-mono">{shortPayer}</span>. This cannot be
          undone.
        </p>
      </div>,
      { icon: "⚠️", duration: 4000 },
    );

    const toastId = toast.loading(
      <div>
        <p className="font-semibold text-sm">Rejecting Payment</p>
        <p className="text-xs text-gray-500 mt-0.5">
          Sending refund of <strong>{usdcAmt} USDC</strong> back to{" "}
          <span className="font-mono">{shortPayer}</span>. Confirm in your
          wallet.
        </p>
      </div>,
      { duration: Infinity },
    );

    try {
      const rejectHash = await writeReject({
        address: CONTRACT_ADDRESS,
        abi: contractABI,
        functionName: "rejectPayment",
        args: [BigInt(id)],
        maxFeePerGas: BigInt(25_000_000),
        maxPriorityFeePerGas: BigInt(1_000_000),
      });

      toast.loading(
        <div>
          <p className="font-semibold text-sm">⏳ Waiting for Confirmation</p>
          <p className="text-xs text-gray-500 mt-0.5">
            Transaction signed. Waiting for Arbitrum to confirm the block…
          </p>
        </div>,
        { id: toastId },
      );

      await waitForTransactionReceipt(config, { hash: rejectHash });

      toast.success(
        <div>
          <p className="font-semibold text-sm">✅ Payment Rejected</p>
          <p className="text-xs text-gray-500 mt-0.5">
            Payment #{id} rejected. <strong>{usdcAmt} USDC</strong> has been
            refunded to <span className="font-mono">{shortPayer}</span>.
          </p>
        </div>,
        { id: toastId, duration: 6000 },
      );

      setTimeout(() => refetchPayments(), 1000);
    } catch (err: any) {
      console.error(err);
      const isUserRejected =
        err?.message?.toLowerCase().includes("user rejected") ||
        err?.code === 4001;

      toast.error(
        <div>
          <p className="font-semibold text-sm">
            {isUserRejected ? "Rejection Cancelled" : "Rejection Failed"}
          </p>
          <p className="text-xs text-gray-500 mt-0.5">
            {isUserRejected
              ? "You cancelled the wallet signature. The payment remains pending."
              : `Failed to reject Payment #${id}. Please try again.`}
          </p>
        </div>,
        { id: toastId, duration: 5000 },
      );
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

  // BankFormFields intentionally inlined in JSX below (not a sub-component)
  // to avoid focus-loss on every keystroke caused by component remounting.

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
            {/* ── Bank Details Display ── */}
            <section>
              <h3 className="text-base font-semibold text-gray-900 mb-3">
                Bank Details
              </h3>

              {merchantInfo?.isRegistered ? (
                <>
                  {/* Current details card */}
                  <div className="border border-green-200 rounded-xl p-5 bg-green-50 space-y-3">
                    {[
                      {
                        label: "Account Name",
                        value: merchantInfo.accountName,
                      },
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
                    <div className="pt-2 border-t border-green-200 flex items-center justify-between">
                      <p className="text-xs text-green-700">
                        ✅ Registered on blockchain
                      </p>
                      {/* Toggle update form */}
                      {!showUpdateForm && (
                        <button
                          onClick={openUpdateForm}
                          className="text-xs text-blue-600 hover:text-blue-800 font-semibold underline underline-offset-2 transition-colors"
                        >
                          Update
                        </button>
                      )}
                    </div>
                  </div>

                  {/* ── Update form (collapsible) ── */}
                  {showUpdateForm && (
                    <div className="mt-4 border border-blue-200 rounded-xl p-5 bg-blue-50 shadow-sm">
                      <div className="flex items-center justify-between mb-4">
                        <h4 className="text-sm font-semibold text-gray-900">
                          Update Bank Details
                        </h4>
                        <button
                          onClick={cancelUpdate}
                          className="text-xs text-gray-400 hover:text-gray-600 transition-colors"
                        >
                          ✕ Cancel
                        </button>
                      </div>

                      {/* Inlined fields — must NOT be a sub-component or focus is lost on every keystroke */}
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
                            {NIGERIAN_BANKS.map((b) => (
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
                              setAccountNumber(
                                e.target.value.replace(/\D/g, ""),
                              )
                            }
                            placeholder="Enter 10-digit account number"
                            maxLength={10}
                            className="block w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono"
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
                        {error && (
                          <p className="text-red-600 text-xs">{error}</p>
                        )}
                      </div>

                      {/* Preview changes */}
                      {bankName && accountName && accountNumber && (
                        <div className="mt-4 bg-white border border-blue-100 rounded-lg p-3 space-y-1.5">
                          <p className="text-xs text-gray-500 font-semibold uppercase tracking-wide mb-2">
                            New Details Preview
                          </p>
                          <p className="text-xs text-gray-700">
                            <span className="font-medium">Name:</span>{" "}
                            {accountName}
                          </p>
                          <p className="text-xs text-gray-700">
                            <span className="font-medium">Bank:</span>{" "}
                            {bankName}
                          </p>
                          <p className="text-xs text-gray-700 font-mono">
                            <span className="font-medium font-sans">
                              Number:
                            </span>{" "}
                            {accountNumber}
                          </p>
                          <p className="text-xs text-gray-400 mt-2">
                            ⚠️ This overwrites your current bank details
                            on-chain.
                          </p>
                          <button
                            onClick={updateBankDetails}
                            disabled={loading}
                            className={`w-full mt-2 py-2 px-4 rounded-lg text-sm font-medium transition-all ${
                              loading
                                ? "bg-gray-100 text-gray-400 cursor-not-allowed"
                                : "bg-blue-600 text-white hover:bg-blue-700"
                            }`}
                          >
                            {loading ? (
                              <span className="flex items-center justify-center gap-2">
                                <svg
                                  className="animate-spin h-3.5 w-3.5"
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
                                Updating…
                              </span>
                            ) : (
                              "Confirm Update on Blockchain"
                            )}
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                </>
              ) : (
                <div className="border border-yellow-200 rounded-xl p-5 bg-yellow-50">
                  <p className="text-sm text-yellow-700">
                    No bank details registered yet.
                  </p>
                </div>
              )}
            </section>

            {/* ── Register Form (first time only) ── */}
            {!merchantInfo?.isRegistered && (
              <section className="border border-gray-200 rounded-xl p-5 bg-white shadow-sm">
                <h3 className="text-base font-semibold text-gray-900 mb-4">
                  Register Bank Details
                </h3>
                {/* Inlined fields — must NOT be a sub-component or focus is lost on every keystroke */}
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
                      {NIGERIAN_BANKS.map((b) => (
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
                      placeholder="Enter 10-digit account number"
                      maxLength={10}
                      className="block w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono"
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
                </div>
                {accountName && bankName && accountNumber && (
                  <div className="mt-4 bg-gray-50 border border-gray-200 rounded-lg p-3 space-y-1.5">
                    <p className="text-xs text-gray-500 font-semibold uppercase tracking-wide mb-2">
                      Review
                    </p>
                    <p className="text-xs text-gray-700">
                      <span className="font-medium">Name:</span> {accountName}
                    </p>
                    <p className="text-xs text-gray-700">
                      <span className="font-medium">Bank:</span> {bankName}
                    </p>
                    <p className="text-xs text-gray-700 font-mono">
                      <span className="font-medium font-sans">Number:</span>{" "}
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
                          <p className="text-gray-500 text-xs mt-0.5">
                            Ref:{" "}
                            <span className="font-medium text-gray-700">
                              {payment.rfce}
                            </span>
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
