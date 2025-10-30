import Dashboard from "@/components/Dashboard";

export default function Page() {
  return (
    <div>
      <nav className="flex items-center justify-between px-8 py-6">
        <div className="text-2xl font-bold">
          <a href="/" className="hover:text-fuchsia-400">
            SETTIX
          </a>
        </div>
        <div className="flex items-center gap-10 text-sm uppercase tracking-wide">
          <a href="/" className="hover:text-fuchsia-400">
            Home
          </a>
          <a href="/dashboard" className="hover:text-fuchsia-400">
            Dashboard
          </a>
          <a href="#" className="hover:text-fuchsia-400">
            Transact
          </a>
          <a href="#" className="hover:text-fuchsia-400">
            Pricing
          </a>
        </div>
        <button className="bg-fuchsia-600 hover:bg-fuchsia-700 text-white font-semibold px-6 py-2 rounded-lg">
          Connect Wallet
        </button>
      </nav>
    </div>
  );
}
