export default function HeroSection() {
  return (
    <div className="min-h-screen bg-black bg-[url('/stars-bg.png')] bg-cover bg-center text-white flex flex-col">
      {/* Hero Section */}
      <main className="flex-1 flex flex-col items-center justify-center text-center px-6">
        <h1 className="text-4xl md:text-6xl font-bold leading-tight">
          <span className="text-fuchsia-500">Transact</span> Safely,
          <br />
          Spend <span className="text-fuchsia-500">Natively.</span>
        </h1>
        <p className="text-gray-300 mt-4 max-w-lg">
          Receive crypto payments safely, instantly, and risk-free in your local
          currency.
        </p>

        <button className="mt-8 bg-fuchsia-600 hover:bg-fuchsia-700 text-white font-bold px-8 py-3 rounded-lg border border-fuchsia-500">
          CONNECT WALLET
        </button>

        <p className="text-sm text-gray-400 mt-3">
          Supported By: <span className="text-white">Privy</span>
        </p>
      </main>

      {/* Footer */}
      <footer className="text-center py-6 text-gray-400 text-sm">
        SETTIX | Built on <span className="text-fuchsia-400">Arbitrum</span>
      </footer>
    </div>
  );
}
