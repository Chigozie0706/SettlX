# SettlX — De-risked Merchant Settlements

> **Instant FX + Insurance for Web3 Payments** | Built on Arbitrum Stylus (Rust)

SettlX is a Web3 payment settlement platform that lets global merchants accept stablecoin (USDC) payments and receive guaranteed local-currency (NGN) settlements at a **locked exchange rate** — eliminating FX volatility risk entirely. Smart contracts written in **Rust using Arbitrum Stylus** handle escrow, rate locking, and settlement on-chain.

---

## Table of Contents

- [Overview](#overview)
- [The Problem](#the-problem)
- [How It Works](#how-it-works)
- [Smart Contract Architecture](#smart-contract-architecture)
- [Contract Functions](#contract-functions)
- [Events](#events)
- [Errors](#errors)
- [Project Structure](#project-structure)
- [Getting Started](#getting-started)
- [Deployment](#deployment)
- [Frontend](#frontend)
- [Tech Stack](#tech-stack)

---

## Overview

A merchant in Lagos sells a product for **$100 USDC**. By the time they convert it, the FX rate has slipped — and they net only ₦138,000 instead of ₦150,000. Their margin is gone.

**SettlX solves this.**

When a $100 USDC payment arrives, SettlX instantly quotes the merchant a guaranteed fiat value. The merchant clicks **"Lock Rate"** — the exchange rate is cryptographically locked on-chain at that exact moment. The merchant receives exactly ₦150,000, regardless of what the market does next. The platform manages the FX exposure in the background.

---

## The Problem

- Crypto payment margins in emerging markets are razor-thin
- FX volatility between payment creation and settlement can wipe out merchant profits
- No existing solution offers **guaranteed, locked-rate** settlement at the point of sale
- Merchants have no on-chain recourse if rates shift between payment and payout

---

## How It Works

```
Payer                    SettlX Contract              Merchant
  |                            |                          |
  |-- approve USDC ----------->|                          |
  |-- payMerchant() ---------->|                          |
  |   (USDC held in escrow)    |--- payment pending ----->|
  |                            |                          |
  |                            |<-- acceptPaymentWithRate()|
  |                            |   (rate locked on-chain) |
  |                            |-- USDC --> Admin treasury|
  |                            |                          |
  |                            |<-- markAsPaid() [admin]  |
  |                            |--- status: Paid -------->|
  |                            |   (NGN sent to bank)     |
```

### Payment Lifecycle

| Status     | Value | Description                               |
| ---------- | ----- | ----------------------------------------- |
| `Pending`  | `0`   | Payment created, awaiting merchant action |
| `Accepted` | `1`   | Rate locked, USDC transferred to admin    |
| `Rejected` | `2`   | Merchant rejected, USDC refunded to payer |
| `Paid`     | `3`   | Admin confirmed NGN bank transfer sent    |

---

## Smart Contract Architecture

The contract is written in **Rust** using the **Arbitrum Stylus SDK** and compiled to WASM for on-chain execution. This gives significantly lower gas costs compared to equivalent Solidity contracts.

### Storage Layout

```rust
pub struct Payment {
    id: uint256,
    payer: address,
    merchant: address,
    amount: uint256,        // USDC amount (6 decimals)
    timestamp: uint256,
    rfce: bytes32,          // keccak256 hash of payment reference
    status: uint8,          // 0=Pending, 1=Accepted, 2=Rejected, 3=Paid
    locked_rate: uint256,   // NGN per USDC × 10^18
}

pub struct MerchantInfo {
    bank_name: bytes32,     // keccak256 hash
    account_name: bytes32,  // keccak256 hash
    account_number: bytes32,// keccak256 hash
    is_registered: bool,
}

pub struct SettlX {
    stable_token: address,
    next_payment_id: uint256,
    admin: address,
    payments: mapping(uint256 => Payment),
    merchant_payments: mapping(address => uint256[]),
    merchants: mapping(address => MerchantInfo),
    payer_payments: mapping(address => uint256[]),
}
```

### Privacy by Design

Bank details (bank name, account name, account number) are stored on-chain as **keccak256 hashes** for privacy. The original plaintext strings are emitted in the `MerchantRegistered` event and can be recovered client-side from event logs. This means sensitive financial data is never stored in raw form on a public blockchain.

---

## Contract Functions

### Initialization

```rust
pub fn init(&mut self, token_address: Address) -> Result<(), SettlXError>
```

Initializes the contract with the USDC token address. Sets the deployer as admin. Must be called once after deployment.

---

### Payer Functions

```rust
pub fn pay_merchant(
    &mut self,
    merchant: Address,
    amount: U256,
    rfce: String,
) -> Result<(), SettlXError>
```

Creates a new payment. Transfers USDC from payer to contract escrow. The `rfce` (reference) string is hashed with keccak256 before storage but emitted in plaintext via the `PaymentCreated` event.

**Requirements:**

- Payer must have approved the contract to spend `amount` USDC
- `merchant` must not be the zero address
- `amount` must be greater than zero

---

### Merchant Functions

```rust
pub fn accept_payment_with_rate(
    &mut self,
    payment_id: U256,
    rate: U256,
) -> Result<(), SettlXError>
```

Locks the FX rate and accepts the payment. Transfers USDC from escrow to the admin treasury. The `rate` parameter is the NGN equivalent amount (in wei precision: NGN × 10^18).

```rust
pub fn reject_payment(&mut self, payment_id: U256) -> Result<(), SettlXError>
```

Rejects a pending payment. Refunds USDC back to the original payer.

```rust
pub fn register_merchant_bank_details(
    &mut self,
    bank_name: String,
    account_name: String,
    account_number: String,
) -> Result<(), SettlXError>
```

Registers a merchant's Nigerian bank account on-chain. Stores keccak256 hashes. Emits plaintext strings in `MerchantRegistered` event for client-side recovery.

---

### Admin Functions

```rust
pub fn mark_as_paid(&mut self, payment_id: U256) -> Result<(), SettlXError>
```

Marks an accepted payment as fully settled. Called by admin after confirming the NGN bank transfer has been sent to the merchant. Only callable by the admin address set during `init()`.

---

### View Functions

```rust
pub fn get_payment(
    &self,
    payment_id: U256,
) -> (U256, Address, Address, U256, U256, FixedBytes<32>, u8)
// Returns: (id, payer, merchant, amount, timestamp, rfce_hash, status)

pub fn get_merchant_payment_ids(&self, merchant: Address) -> Vec<U256>
pub fn get_payer_payment_ids(&self, payer: Address) -> Vec<U256>

pub fn get_merchant_bank_details(
    &self,
    merchant: Address,
) -> (FixedBytes<32>, FixedBytes<32>, FixedBytes<32>)
// Returns: (bank_name_hash, account_name_hash, account_number_hash)
// Note: check if non-zero to verify registration; recover plaintext from events
```

---

## Events

| Event                 | Parameters                                                                | Description                                                             |
| --------------------- | ------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| `MerchantRegistered`  | `merchant (indexed)`, `bankName`, `accountName`, `accountNumber`          | Emitted on bank detail registration. Contains plaintext strings.        |
| `PaymentCreated`      | `id (indexed)`, `payer (indexed)`, `merchant (indexed)`, `amount`, `rfce` | Emitted when a payment is created. Contains plaintext `rfce` reference. |
| `PaymentAccepted`     | `id (indexed)`, `lockedRate`                                              | Emitted when merchant locks rate. `lockedRate` = NGN × 10^18.           |
| `PaymentRejected`     | `id (indexed)`                                                            | Emitted when merchant rejects payment.                                  |
| `PaymentMarkedAsPaid` | `id (indexed)`                                                            | Emitted when admin confirms NGN settlement.                             |

> **Important:** Because `rfce` and bank details are hashed on-chain, the plaintext values only exist in event logs. Frontend clients should index `PaymentCreated` and `MerchantRegistered` events to display human-readable references and bank info.

---

## Errors

| Error                   | Trigger                                                        |
| ----------------------- | -------------------------------------------------------------- |
| `InvalidToken`          | Zero address passed to `init()`                                |
| `InvalidMerchant`       | Zero address passed as merchant to `payMerchant()`             |
| `InvalidAmount`         | Zero amount passed to `payMerchant()`                          |
| `OnlyAdmin`             | Non-admin calls `markAsPaid()`                                 |
| `NotYourPayment`        | Merchant tries to action a payment not assigned to them        |
| `AlreadyProcessed`      | Payment is not in `Pending` state when accept/reject is called |
| `InvalidRate`           | Zero rate passed to `acceptPaymentWithRate()`                  |
| `BankNameRequired`      | Empty bank name in `registerMerchantBankDetails()`             |
| `AccountNameRequired`   | Empty account name in `registerMerchantBankDetails()`          |
| `AccountNumberRequired` | Empty account number in `registerMerchantBankDetails()`        |
| `MustBeAcceptedFirst`   | `markAsPaid()` called on a non-Accepted payment                |

---

## Project Structure

```
settix/
├── src/
│   ├── main.rs          # Entrypoint (no_main for Stylus)
│   └── lib.rs           # Contract logic (SettlX struct + impl)
├── Cargo.toml           # Rust dependencies and build config
├── README.md
└── frontend/
    ├── app/
    │   ├── dashboard/   # Merchant dashboard
    │   ├── transact/    # Payer payment page
    │   └── admin/       # Admin settlement dashboard
    └── contracts/
        ├── SettlX1.json # Contract ABI
        └── aggregrator.ts # Chainlink AggregatorV3 ABI
```

---

## Getting Started

### Prerequisites

- [Rust](https://rustup.rs/) (stable toolchain)
- [cargo-stylus](https://github.com/OffchainLabs/cargo-stylus) CLI
- [Arbitrum Sepolia ETH](https://www.alchemy.com/faucets/arbitrum-sepolia) for deployment gas

```bash
# Install cargo-stylus
cargo install cargo-stylus

# Add WASM target
rustup target add wasm32-unknown-unknown
```

### Build

```bash
# Check contract compiles correctly for Stylus
cargo stylus check

# Build optimized WASM
cargo build --release --target wasm32-unknown-unknown
```

The `[profile.release]` in `Cargo.toml` is already configured for minimum WASM size:

```toml
opt-level = "z"   # Optimize for size
lto = true        # Link-time optimization
strip = true      # Strip debug symbols
panic = "abort"   # Smaller panic handler
```

---

## Deployment

### Deploy to Arbitrum Sepolia

```bash
# Export your private key
export PRIVATE_KEY=0x...

# Deploy
cargo stylus deploy \
  --private-key $PRIVATE_KEY \
  --endpoint https://sepolia-rollup.arbitrum.io/rpc
```

### Initialize the Contract

After deployment, call `init()` with the USDC token address:

```
# Arbitrum Sepolia USDC
USDC = 0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d

# Call init(USDC_ADDRESS) from your deployer wallet
```

### Verify ABI Export

```bash
cargo stylus export-abi
```

### Deployed Contracts (Testnet)

| Contract           | Network          | Address                                      |
| ------------------ | ---------------- | -------------------------------------------- |
| SettlX             | Arbitrum Sepolia | `0xc7de1f51613c80557c65b7ef07718952158a445e` |
| USDC (Test)        | Arbitrum Sepolia | `0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d` |
| Chainlink USDC/USD | Arbitrum Sepolia | `0x50834F3163758fcC1Df9973b6e91f0F0F0434aD3` |

---

## Frontend

The frontend is built with **Next.js 14**, **Privy** (wallet auth), **Wagmi v2**, and **Viem**.

```bash
cd frontend
npm install
npm run dev
```

### Key Frontend Features

- **Transact page** — payer approves USDC and creates payments with a real reference string
- **Merchant dashboard** — view pending/all payments, lock FX rate, see locked vs live NGN amounts
- **Admin dashboard** — full payment history, merchant bank details from events, Mark as Paid

### Recovering Plaintext Data from Events

Since `rfce` and bank details are hashed on-chain, the frontend recovers original strings from event logs:

```typescript
// Recover rfce from PaymentCreated events
const logs = await client.getLogs({
  event: { name: "PaymentCreated", inputs: [...] },
  fromBlock: BigInt(0),
});
const rfceMap = Object.fromEntries(
  logs.map(log => [log.args.id.toString(), log.args.rfce])
);

// Recover bank details from MerchantRegistered events
const merchantLogs = await client.getLogs({
  event: { name: "MerchantRegistered", inputs: [...] },
  args: { merchant: address },
  fromBlock: BigInt(0),
});
```

---

## Tech Stack

| Layer              | Technology                 |
| ------------------ | -------------------------- |
| Smart Contract     | Rust + Arbitrum Stylus SDK |
| Blockchain         | Arbitrum Sepolia (L2)      |
| Token Standard     | ERC-20 (USDC)              |
| Price Oracle       | Chainlink AggregatorV3     |
| Frontend Framework | Next.js 14 (App Router)    |
| Wallet Auth        | Privy                      |
| Web3 Client        | Wagmi v2 + Viem            |
| FX Rate API        | exchangerate.host          |

---

## Why Arbitrum Stylus?

- **Lower gas costs** — Rust/WASM contracts are more efficient than Solidity EVM bytecode
- **Fast finality** — Arbitrum's block times make real-time FX rate locking practical
- **Familiar tooling** — standard Rust ecosystem (`cargo`, `rustfmt`, etc.)
- **DeFi ecosystem** — deep Arbitrum liquidity pools available for future FX hedging module

---

## License

MIT OR Apache-2.0
