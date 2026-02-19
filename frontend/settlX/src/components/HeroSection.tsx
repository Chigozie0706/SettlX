"use client";

import { usePrivy } from "@privy-io/react-auth";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";

// ── Animated counter ──────────────────────────────────────────────────────────
function AnimatedCounter({
  end,
  prefix = "",
  suffix = "",
  duration = 1800,
}: {
  end: number;
  prefix?: string;
  suffix?: string;
  duration?: number;
}) {
  const [count, setCount] = useState(0);
  const [started, setStarted] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) setStarted(true);
      },
      { threshold: 0.4 },
    );
    if (ref.current) observer.observe(ref.current);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!started) return;
    let current = 0;
    const step = end / (duration / 16);
    const timer = setInterval(() => {
      current += step;
      if (current >= end) {
        setCount(end);
        clearInterval(timer);
      } else setCount(Math.floor(current));
    }, 16);
    return () => clearInterval(timer);
  }, [started, end, duration]);

  return (
    <div
      ref={ref}
      className="text-4xl md:text-5xl font-black text-white tabular-nums"
    >
      {prefix}
      {count.toLocaleString()}
      {suffix}
    </div>
  );
}

// ── Feature card ──────────────────────────────────────────────────────────────
function FeatureCard({
  icon,
  title,
  desc,
  delay = 0,
}: {
  icon: string;
  title: string;
  desc: string;
  delay?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const observer = new IntersectionObserver(
      ([e]) => {
        if (e.isIntersecting) setVisible(true);
      },
      { threshold: 0.15 },
    );
    if (ref.current) observer.observe(ref.current);
    return () => observer.disconnect();
  }, []);

  return (
    <div
      ref={ref}
      style={{
        transitionDelay: `${delay}ms`,
        opacity: visible ? 1 : 0,
        transform: visible ? "translateY(0)" : "translateY(28px)",
        transition: "opacity 0.6s ease, transform 0.6s ease",
      }}
      className="group relative bg-gray-900 border border-gray-800 rounded-2xl p-6 hover:border-fuchsia-500/40 transition-all duration-300 overflow-hidden"
    >
      <div className="absolute inset-0 bg-gradient-to-br from-fuchsia-500/0 to-fuchsia-500/0 group-hover:from-fuchsia-500/5 group-hover:to-violet-600/5 transition-all duration-500 rounded-2xl" />
      <div className="relative z-10">
        <div className="text-3xl mb-4">{icon}</div>
        <h3 className="text-white font-bold text-base mb-2">{title}</h3>
        <p className="text-gray-400 text-sm leading-relaxed">{desc}</p>
      </div>
    </div>
  );
}

// ── Flow step ─────────────────────────────────────────────────────────────────
function Step({
  num,
  role,
  title,
  desc,
}: {
  num: string;
  role: string;
  title: string;
  desc: string;
}) {
  return (
    <div className="flex gap-4">
      <div className="flex-shrink-0 w-9 h-9 rounded-full bg-fuchsia-500/15 border border-fuchsia-500/40 flex items-center justify-center text-fuchsia-400 font-black text-xs">
        {num}
      </div>
      <div>
        <span className="text-xs text-fuchsia-400 font-semibold uppercase tracking-widest">
          {role}
        </span>
        <h4 className="text-white font-bold mt-0.5 mb-1 text-sm">{title}</h4>
        <p className="text-gray-400 text-sm leading-relaxed">{desc}</p>
      </div>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function HomePage() {
  const { authenticated, login } = usePrivy();

  return (
    <div className="min-h-screen bg-gray-950 text-white overflow-x-hidden">
      {/* ── HERO ─────────────────────────────────────────────────────────── */}
      <section className="relative min-h-screen flex flex-col items-center justify-center px-6 pt-28 pb-20 text-center overflow-hidden">
        {/* Background effects */}
        <div className="absolute inset-0 pointer-events-none overflow-hidden">
          <svg
            className="absolute inset-0 w-full h-full opacity-[0.04]"
            xmlns="http://www.w3.org/2000/svg"
          >
            <defs>
              <pattern
                id="grid"
                width="56"
                height="56"
                patternUnits="userSpaceOnUse"
              >
                <path
                  d="M 56 0 L 0 0 0 56"
                  fill="none"
                  stroke="#d946ef"
                  strokeWidth="0.6"
                />
              </pattern>
            </defs>
            <rect width="100%" height="100%" fill="url(#grid)" />
          </svg>
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[700px] h-[700px] rounded-full bg-fuchsia-900/25 blur-[120px]" />
          <div className="absolute top-1/4 right-1/4 w-[300px] h-[300px] rounded-full bg-violet-800/15 blur-[80px]" />
        </div>

        {/* Live badge */}
        <div className="relative z-10 mb-8 inline-flex items-center gap-2 bg-gray-900/80 border border-fuchsia-500/30 rounded-full px-4 py-2 text-xs text-fuchsia-300 backdrop-blur-sm">
          <span className="w-1.5 h-1.5 rounded-full bg-fuchsia-400 animate-pulse" />
          Live on Arbitrum Sepolia · Powered by Stylus
        </div>

        {/* Headline */}
        <h1 className="relative z-10 text-5xl md:text-7xl font-black leading-[1.05] tracking-tight max-w-4xl mb-6">
          <span className="text-fuchsia-400">Transact</span> Safely.
          <br />
          Settle{" "}
          <span className="relative inline-block">
            <span className="text-fuchsia-400">Natively.</span>
            <span className="absolute -bottom-1 left-0 w-full h-px bg-gradient-to-r from-fuchsia-500 to-transparent" />
          </span>
        </h1>

        {/* Subheadline */}
        <p className="relative z-10 text-gray-300 text-lg md:text-xl max-w-2xl leading-relaxed mb-10">
          Accept crypto payments and receive{" "}
          <span className="text-white font-semibold">
            guaranteed local-currency settlements
          </span>{" "}
          at a locked exchange rate — zero FX risk, instant, on-chain.
        </p>

        {/* CTAs */}
        <div className="relative z-10 flex flex-col sm:flex-row gap-4 items-center mb-14">
          {authenticated ? (
            <>
              <Link
                href="/transact"
                className="bg-fuchsia-600 hover:bg-fuchsia-500 text-white font-bold px-8 py-3.5 rounded-xl transition-all text-sm hover:shadow-lg hover:shadow-fuchsia-500/25"
              >
                Make a Payment →
              </Link>
              <Link
                href="/dashboard"
                className="border border-gray-700 hover:border-fuchsia-500/50 text-gray-300 hover:text-white font-semibold px-8 py-3.5 rounded-xl transition-all text-sm"
              >
                Merchant Dashboard
              </Link>
            </>
          ) : (
            <>
              <button
                onClick={login}
                className="bg-fuchsia-600 hover:bg-fuchsia-500 text-white font-bold px-8 py-3.5 rounded-xl transition-all text-sm hover:shadow-lg hover:shadow-fuchsia-500/25"
              >
                Connect Wallet to Start
              </button>
              <a
                href="#how-it-works"
                className="border border-gray-700 hover:border-gray-600 text-gray-400 hover:text-white font-semibold px-8 py-3.5 rounded-xl transition-all text-sm"
              >
                See How It Works
              </a>
            </>
          )}
        </div>

        {/* Trust bar */}
        <div className="relative z-10 flex flex-wrap justify-center items-center gap-6 text-xs text-gray-500">
          {[
            "Built on Arbitrum",
            "Chainlink Price Feeds",
            "Privy Wallet Auth",
            "USDC Stablecoin",
          ].map((item) => (
            <div key={item} className="flex items-center gap-1.5">
              <span className="w-1 h-1 rounded-full bg-fuchsia-500/60" />
              {item}
            </div>
          ))}
        </div>

        {/* Scroll hint */}
        <div className="absolute bottom-8 left-1/2 -translate-x-1/2 animate-bounce text-gray-600 text-xs">
          ↓
        </div>
      </section>

      {/* ── STATS ────────────────────────────────────────────────────────── */}
      <section className="border-y border-gray-800/60 bg-gray-900/40 py-16 px-6">
        <div className="max-w-4xl mx-auto grid grid-cols-2 md:grid-cols-4 gap-10">
          {[
            { end: 100, suffix: "%", label: "FX Risk Eliminated" },
            { end: 4, suffix: " steps", label: "End-to-End Flow" },
            { end: 0, suffix: " middlemen", label: "No Intermediaries" },
            { end: 24, suffix: "/7", label: "Always On-Chain" },
          ].map(({ end, suffix, label }) => (
            <div key={label} className="text-center">
              <AnimatedCounter end={end} suffix={suffix} />
              <p className="text-gray-500 text-xs tracking-widest uppercase mt-2">
                {label}
              </p>
            </div>
          ))}
        </div>
      </section>

      {/* ── THE PROBLEM ──────────────────────────────────────────────────── */}
      <section className="py-24 px-6 max-w-5xl mx-auto">
        <div className="grid md:grid-cols-2 gap-16 items-center">
          <div>
            <p className="text-fuchsia-400 text-xs font-semibold uppercase tracking-widest mb-3">
              The Problem
            </p>
            <h2 className="text-3xl md:text-4xl font-black leading-tight mb-6">
              FX Volatility is Killing{" "}
              <span className="text-fuchsia-400">Merchant Margins</span>
            </h2>
            <p className="text-gray-400 leading-relaxed mb-4">
              A merchant in Lagos sells a product for{" "}
              <span className="text-white font-semibold">$100 USDC</span>. By
              the time they convert it, the rate has slipped — they net only{" "}
              <span className="text-red-400 font-semibold">₦138,000</span>{" "}
              instead of the expected{" "}
              <span className="text-white font-semibold">₦150,000</span>. Margin
              gone.
            </p>
            <p className="text-gray-400 leading-relaxed">
              Uncontrollable FX volatility is the single biggest reason
              merchants in emerging markets refuse to adopt Web3 payments.
            </p>
          </div>

          {/* Visual comparison */}
          <div className="bg-gray-900 border border-gray-800 rounded-2xl p-6 space-y-3">
            <p className="text-xs text-gray-500 font-semibold uppercase tracking-widest">
              Without SettlX
            </p>
            {[
              {
                label: "Payment received",
                value: "$100 USDC",
                color: "text-white",
              },
              {
                label: "Rate at payment",
                value: "₦1,500/USDC",
                color: "text-white",
              },
              {
                label: "Rate at conversion",
                value: "₦1,380/USDC ↓",
                color: "text-red-400",
              },
            ].map(({ label, value, color }) => (
              <div
                key={label}
                className="flex justify-between items-center py-2.5 border-b border-gray-800"
              >
                <span className="text-gray-400 text-sm">{label}</span>
                <span className={`font-bold text-sm ${color}`}>{value}</span>
              </div>
            ))}
            <div className="flex justify-between items-center py-2.5 bg-red-900/20 rounded-lg px-3">
              <span className="text-red-400 text-sm font-semibold">
                Loss to FX slip
              </span>
              <span className="text-red-400 font-black">-₦12,000</span>
            </div>
            <div className="pt-3 border-t border-gray-800">
              <p className="text-xs text-gray-500 font-semibold uppercase tracking-widest mb-2">
                With SettlX
              </p>
              <div className="flex justify-between items-center py-2.5 bg-fuchsia-900/20 rounded-lg px-3">
                <span className="text-fuchsia-300 text-sm font-semibold">
                  🔒 Guaranteed NGN
                </span>
                <span className="text-fuchsia-300 font-black">₦150,000</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── FEATURES ─────────────────────────────────────────────────────── */}
      <section className="py-24 px-6 bg-gray-900/30">
        <div className="max-w-5xl mx-auto">
          <div className="text-center mb-14">
            <p className="text-fuchsia-400 text-xs font-semibold uppercase tracking-widest mb-3">
              Why SettlX
            </p>
            <h2 className="text-3xl md:text-4xl font-black">
              Built for the Real World
            </h2>
          </div>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5">
            <FeatureCard
              delay={0}
              icon="🔒"
              title="Locked Exchange Rate"
              desc="The moment a merchant accepts, the NGN rate is cryptographically locked on-chain. The exact amount is guaranteed no matter what the market does."
            />
            <FeatureCard
              delay={100}
              icon="⚡"
              title="Instant Settlement"
              desc="Built on Arbitrum L2. Fast block times mean rate locking and payment confirmations happen in seconds."
            />
            <FeatureCard
              delay={200}
              icon="🛡️"
              title="Smart Contract Escrow"
              desc="USDC is held in trustless on-chain escrow. Payers are protected if rejected; merchants are protected from FX moves after acceptance."
            />
            <FeatureCard
              delay={300}
              icon="🏦"
              title="Bank Account Payout"
              desc="Merchants register their Nigerian bank account. Admin settles the exact locked NGN amount directly to that account."
            />
            <FeatureCard
              delay={400}
              icon="📊"
              title="Full Transparency"
              desc="Every payment, rate lock, and status change is verifiable on-chain. Event logs preserve original references and bank details."
            />
            <FeatureCard
              delay={500}
              icon="💸"
              title="Ultra-Low Gas Fees"
              desc="Arbitrum L2 transactions cost cents. SettlX is economically viable for everyday merchant use at any payment size."
            />
          </div>
        </div>
      </section>

      {/* ── HOW IT WORKS ─────────────────────────────────────────────────── */}
      <section id="how-it-works" className="py-24 px-6 max-w-5xl mx-auto">
        <div className="text-center mb-14">
          <p className="text-fuchsia-400 text-xs font-semibold uppercase tracking-widest mb-3">
            The Flow
          </p>
          <h2 className="text-3xl md:text-4xl font-black">How It Works</h2>
          <p className="text-gray-400 mt-3 max-w-xl mx-auto text-sm">
            Four steps from stablecoin payment to guaranteed local-currency
            settlement.
          </p>
        </div>

        <div className="grid md:grid-cols-2 gap-5 mb-8">
          <div className="bg-gray-900 border border-gray-800 rounded-2xl p-7 space-y-7">
            <Step
              num="1"
              role="Payer"
              title="Approve & Send USDC"
              desc="The payer approves USDC spending and calls payMerchant(). USDC is held immediately in smart contract escrow."
            />
            <div className="border-l border-gray-800 ml-4 h-4" />
            <Step
              num="2"
              role="Merchant"
              title="Lock the Rate"
              desc="Merchant sees the payment with a live NGN equivalent. Clicking 'Lock Rate' writes the current exchange rate on-chain — permanently."
            />
          </div>
          <div className="bg-gray-900 border border-gray-800 rounded-2xl p-7 space-y-7">
            <Step
              num="3"
              role="Protocol"
              title="USDC Moves to Treasury"
              desc="On rate lock, USDC transfers from escrow to the SettlX treasury. The locked NGN amount is recorded in the PaymentAccepted event."
            />
            <div className="border-l border-gray-800 ml-4 h-4" />
            <Step
              num="4"
              role="Admin"
              title="NGN Sent to Bank"
              desc="Admin sends the exact locked NGN amount to the merchant's registered bank account, then calls markAsPaid() on-chain to close the cycle."
            />
          </div>
        </div>

        {/* Flow pills */}
        <div className="flex flex-wrap justify-center items-center gap-2 text-xs text-gray-500">
          {[
            "Payer sends USDC",
            "→",
            "Escrow holds funds",
            "→",
            "Merchant locks rate",
            "→",
            "NGN settled to bank",
          ].map((item, i) => (
            <span
              key={i}
              className={
                item === "→"
                  ? "text-fuchsia-600 font-bold"
                  : "bg-gray-900 border border-gray-800 px-3 py-1.5 rounded-full"
              }
            >
              {item}
            </span>
          ))}
        </div>
      </section>

      {/* ── TECH STACK ───────────────────────────────────────────────────── */}
      <section className="py-16 px-6 bg-gray-900/30 border-y border-gray-800/60">
        <div className="max-w-4xl mx-auto">
          <p className="text-center text-xs text-gray-500 font-semibold uppercase tracking-widest mb-10">
            Powered By
          </p>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {[
              {
                name: "Arbitrum Stylus",
                sub: "Rust smart contracts on L2",
                icon: "🔵",
              },
              { name: "Chainlink", sub: "USDC/USD price feeds", icon: "🔗" },
              { name: "Privy", sub: "Embedded wallet auth", icon: "🔑" },
              {
                name: "Wagmi + Viem",
                sub: "On-chain data & event logs",
                icon: "⚙️",
              },
            ].map(({ name, sub, icon }) => (
              <div
                key={name}
                className="bg-gray-900 border border-gray-800 rounded-xl p-4 text-center hover:border-fuchsia-500/30 transition-colors duration-200"
              >
                <div className="text-2xl mb-2">{icon}</div>
                <p className="text-white text-sm font-bold">{name}</p>
                <p className="text-gray-500 text-xs mt-1">{sub}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── CTA BANNER ───────────────────────────────────────────────────── */}
      <section className="py-24 px-6 relative overflow-hidden">
        <div className="absolute inset-0 pointer-events-none">
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[300px] rounded-full bg-fuchsia-900/20 blur-[80px]" />
        </div>
        <div className="relative z-10 max-w-2xl mx-auto text-center">
          <h2 className="text-3xl md:text-5xl font-black mb-4">
            Ready to settle <span className="text-fuchsia-400">risk-free?</span>
          </h2>
          <p className="text-gray-400 mb-10 text-lg">
            Accept crypto with guaranteed local-currency payouts.
          </p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            {authenticated ? (
              <>
                <Link
                  href="/dashboard"
                  className="bg-fuchsia-600 hover:bg-fuchsia-500 text-white font-bold px-8 py-4 rounded-xl transition-all text-sm hover:shadow-xl hover:shadow-fuchsia-500/20"
                >
                  Open Merchant Dashboard →
                </Link>
                <Link
                  href="/transact"
                  className="border border-gray-700 hover:border-fuchsia-500/40 text-gray-300 hover:text-white font-semibold px-8 py-4 rounded-xl transition-all text-sm"
                >
                  Make a Payment
                </Link>
              </>
            ) : (
              <button
                onClick={login}
                className="bg-fuchsia-600 hover:bg-fuchsia-500 text-white font-bold px-10 py-4 rounded-xl transition-all text-sm hover:shadow-xl hover:shadow-fuchsia-500/20"
              >
                Connect Wallet to Get Started →
              </button>
            )}
          </div>
        </div>
      </section>

      {/* ── FOOTER ───────────────────────────────────────────────────────── */}
      <footer className="border-t border-gray-800/60 py-8 px-6">
        <div className="max-w-5xl mx-auto flex flex-col md:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <span className="text-fuchsia-400 font-black text-lg">SETTIX</span>
            <span className="text-gray-600 text-xs">|</span>
            <span className="text-gray-500 text-xs">
              De-risked Merchant Settlements
            </span>
          </div>
          <div className="flex gap-6 text-xs text-gray-500">
            <Link
              href="/transact"
              className="hover:text-fuchsia-400 transition"
            >
              Transact
            </Link>
            <Link
              href="/dashboard"
              className="hover:text-fuchsia-400 transition"
            >
              Dashboard
            </Link>
            <Link href="/admin" className="hover:text-fuchsia-400 transition">
              Admin
            </Link>
          </div>
          <p className="text-gray-600 text-xs">
            Built on <span className="text-fuchsia-400">Arbitrum</span> ·
            Hackathon 2026
          </p>
        </div>
      </footer>
    </div>
  );
}
