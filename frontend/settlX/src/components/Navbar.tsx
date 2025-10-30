"use client";

import { useState, useEffect, useRef } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Menu, X, ChevronDown } from "lucide-react";
import { useAccount, useDisconnect } from "wagmi";
import { usePrivy } from "@privy-io/react-auth";

export default function Navbar() {
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Wagmi hooks
  const { address, isConnected } = useAccount();
  const { disconnect: disconnectWagmi } = useDisconnect();

  // Privy hooks
  const { user, authenticated, login, logout: logoutPrivy } = usePrivy();

  // Close menus when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node))
        setMenuOpen(false);
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(e.target as Node)
      )
        setDropdownOpen(false);
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Close dropdown when route changes
  useEffect(() => {
    setDropdownOpen(false);
    setMenuOpen(false);
  }, [pathname]);

  const handleLogout = async () => {
    if (isConnected) disconnectWagmi();
    logoutPrivy();
  };

  const displayAddress = address || user?.wallet?.address;

  return (
    <nav className="fixed w-full z-50 bg-gray-900 text-white shadow-lg px-6 py-4 transition-colors duration-300">
      <div className="flex items-center justify-between">
        {/* Logo */}
        <div className="text-fuchsia-400 text-xl font-bold">
          <Link href="/">SETTIX</Link>
        </div>

        {/* Mobile Menu Toggle */}
        <button
          onClick={() => setMenuOpen(!menuOpen)}
          className="md:hidden focus:outline-none"
        >
          {menuOpen ? <X size={24} /> : <Menu size={24} />}
        </button>

        {/* Navigation Menu */}
        <div
          ref={menuRef}
          className={`absolute md:static top-16 left-0 w-full md:w-auto bg-gray-900 md:bg-transparent px-6 py-4 md:p-0 transition-all duration-300 ${
            menuOpen
              ? "flex flex-col space-y-4 md:space-y-0 md:flex md:flex-row md:space-x-6"
              : "hidden md:flex gap-6"
          } text-xs items-center`}
        >
          <Link
            href="/"
            className={`hover:text-fuchsia-400 transition ${
              pathname === "/" ? "text-fuchsia-400" : ""
            }`}
          >
            Home
          </Link>
          <Link
            href="/dashboard"
            className={`hover:text-fuchsia-400 transition ${
              pathname === "/dashboard" ? "text-fuchsia-400" : ""
            }`}
          >
            Dashboard
          </Link>
          <Link
            href="/transact"
            className={`hover:text-fuchsia-400 transition ${
              pathname === "/transact" ? "text-fuchsia-400" : ""
            }`}
          >
            Transact
          </Link>
          <Link
            href="/pricing"
            className={`hover:text-fuchsia-400 transition ${
              pathname === "/pricing" ? "text-fuchsia-400" : ""
            }`}
          >
            Pricing
          </Link>
        </div>

        {/* Auth + Wallet Connect Section */}
        <div>
          {!authenticated ? (
            <button
              onClick={login}
              className="bg-fuchsia-600 text-white px-4 py-2 rounded-lg text-xs hover:bg-fuchsia-700 transition"
            >
              Connect Wallet
            </button>
          ) : (
            <div className="flex items-center gap-2">
              <span className="text-gray-300 text-xs">
                {displayAddress
                  ? `${displayAddress.slice(0, 6)}...${displayAddress.slice(
                      -4
                    )}`
                  : "Connected"}
              </span>
              <button
                onClick={handleLogout}
                className="bg-gray-800 text-white px-3 py-2 rounded-lg text-xs hover:bg-gray-700 transition"
              >
                Logout
              </button>
            </div>
          )}
        </div>
      </div>
    </nav>
  );
}
