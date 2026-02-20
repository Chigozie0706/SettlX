#![cfg_attr(not(any(feature = "export-abi", test)), no_main)]
extern crate alloc;

use alloc::string::String;
use alloc::vec::Vec;
use alloy_primitives::{Address, U256, U8, FixedBytes, keccak256};
use alloy_sol_types::sol;
use stylus_sdk::{
    prelude::*,
    stylus_core::log,
};

// ── ERC20 interface ───────────────────────────────────────────────────────────
// Minimal interface for USDC interactions.
// We only need transferFrom (payer → escrow) and transfer (escrow → admin or payer refund).
sol_interface! {
    interface IERC20 {
        function transferFrom(address from, address to, uint256 amount) external returns (bool);
        function transfer(address to, uint256 amount) external returns (bool);
    }
}

// ── Events ────────────────────────────────────────────────────────────────────
// NOTE: Bank details are stored on-chain as keccak256 hashes for privacy.
// The original plaintext strings are ONLY available in these event logs.
// Frontends must index events to display human-readable bank info.
sol! {
    /// Emitted when a merchant registers their bank details for the first time.
    /// bankName, accountName, accountNumber are plaintext here — only time they exist unmasked.
    event MerchantRegistered(
        address indexed merchant,
        string bankName,
        string accountName,
        string accountNumber
    );

    /// Emitted when a merchant updates their bank details.
    /// Same pattern as MerchantRegistered — plaintext only in this event.
    event MerchantUpdated(
        address indexed merchant,
        string bankName,
        string accountName,
        string accountNumber
    );

    /// Emitted when a payer creates a payment and USDC enters escrow.
    /// rfce (Reference for Customer/External) is stored as keccak256 on-chain
    /// but emitted as plaintext here so frontends can display "INV-001" instead of "0x1234..."
    event PaymentCreated(
        uint256 indexed id,
        address indexed payer,
        address indexed merchant,
        uint256 amount,
        string rfce
    );

    /// Emitted when a merchant accepts a payment and locks the NGN exchange rate.
    /// lockedRate = NGN per USDC × 1e18 (scaled for precision).
    /// USDC moves from escrow to admin treasury at this point.
    event PaymentAccepted(uint256 indexed id, uint256 lockedRate);

    /// Emitted when a merchant rejects a payment.
    /// USDC is refunded to the original payer at this point.
    event PaymentRejected(uint256 indexed id);

    /// Emitted when admin confirms NGN has been sent to the merchant's bank.
    /// This is the final step — payment lifecycle is complete.
    event PaymentMarkedAsPaid(uint256 indexed id);
}

// ── Custom Errors ─────────────────────────────────────────────────────────────
sol! {
    error InvalidToken();         
    error InvalidMerchant();      
    error InvalidAmount();        
    error OnlyAdmin();            
    error NotYourPayment();       
    error AlreadyProcessed();     
    error InvalidRate();          
    error BankNameRequired();     
    error AccountNameRequired();  
    error AccountNumberRequired();
    error MustBeAcceptedFirst();  
    error NotRegistered();        
}

#[derive(SolidityError)]
pub enum SettlXError {
    InvalidToken(InvalidToken),
    InvalidMerchant(InvalidMerchant),
    InvalidAmount(InvalidAmount),
    OnlyAdmin(OnlyAdmin),
    NotYourPayment(NotYourPayment),
    AlreadyProcessed(AlreadyProcessed),
    InvalidRate(InvalidRate),
    BankNameRequired(BankNameRequired),
    AccountNameRequired(AccountNameRequired),
    AccountNumberRequired(AccountNumberRequired),
    MustBeAcceptedFirst(MustBeAcceptedFirst),
    NotRegistered(NotRegistered),
}

// ── Storage Layout ────────────────────────────────────────────────────────────
sol_storage! {
    /// A single payment record.
    /// - rfce and locked_rate are NOT returned by getPayment() as plaintext —
    ///   rfce is a hash, locked_rate only exists in PaymentAccepted event.
    #[derive(Erase)]
    pub struct Payment {
        uint256 id;
        address payer;
        address merchant;
        uint256 amount;       
        uint256 timestamp;    
        bytes32 rfce;         
        uint8 status;         
        uint256 locked_rate;  
    }

    /// A merchant's registered bank details.
    /// All three fields are stored as keccak256 hashes — NOT plaintext.
    /// Plaintext is only recoverable from MerchantRegistered / MerchantUpdated events.
    #[derive(Erase)]
    pub struct MerchantInfo {
        bytes32 bank_name;
        bytes32 account_name;
        bytes32 account_number;
        bool is_registered;   
    }

    /// Main contract storage.
    #[entrypoint]
    pub struct SettlX {
        address stable_token;                          // USDC token contract address
        uint256 next_payment_id;                       
        address admin;                                 
        mapping(uint256 => Payment) payments;          
        mapping(address => uint256[]) merchant_payments; 
        mapping(address => MerchantInfo) merchants;    
        mapping(address => uint256[]) payer_payments;  
    }
}

#[public]
impl SettlX {
    // ── Initialisation ────────────────────────────────────────────────────────

    /// One-time setup. Sets the USDC token address, initialises the payment ID
    /// counter to 1, and designates the deployer as admin.
    /// Must be called immediately after deployment.
    pub fn init(&mut self, token_address: Address) -> Result<(), SettlXError> {
        if token_address == Address::ZERO {
            return Err(SettlXError::InvalidToken(InvalidToken {}));
        }
        self.stable_token.set(token_address);
        self.next_payment_id.set(U256::from(1));
        self.admin.set(self.vm().msg_sender());
        Ok(())
    }

    // ── Merchant Registration ─────────────────────────────────────────────────

    /// Register bank details for the first time.
    /// Stores keccak256 hashes of all three fields on-chain for privacy.
    /// Emits MerchantRegistered with the PLAINTEXT values — this is the only
    /// place the original strings exist permanently; frontends must index this event.
    ///
    /// Reverts with NotRegistered if called again after already registering
    /// (use updateMerchantBankDetails instead).
    pub fn register_merchant_bank_details(
        &mut self,
        bank_name: String,
        account_name: String,
        account_number: String,
    ) -> Result<(), SettlXError> {
        // Validate inputs — all three fields are required
        if bank_name.is_empty() {
            return Err(SettlXError::BankNameRequired(BankNameRequired {}));
        }
        if account_name.is_empty() {
            return Err(SettlXError::AccountNameRequired(AccountNameRequired {}));
        }
        if account_number.is_empty() {
            return Err(SettlXError::AccountNumberRequired(AccountNumberRequired {}));
        }

        let sender = self.vm().msg_sender();
        let mut merchant = self.merchants.setter(sender);

        // Hash and store each field — original strings are NOT kept on-chain
        merchant.bank_name.set(keccak256(bank_name.as_bytes()));
        merchant.account_name.set(keccak256(account_name.as_bytes()));
        merchant.account_number.set(keccak256(account_number.as_bytes()));
        merchant.is_registered.set(true);

        // Emit plaintext values so frontends can recover them via event indexing
        log(self.vm(), MerchantRegistered {
            merchant: sender,
            bankName: bank_name,
            accountName: account_name,
            accountNumber: account_number,
        });

        Ok(())
    }

    /// Update bank details for an already-registered merchant.
    /// Overwrites all three hash fields and emits MerchantUpdated with plaintext.
    /// Frontends should always use the LATEST MerchantUpdated (or MerchantRegistered
    /// if no update has occurred) event for a given merchant address.
    ///
    /// Reverts with NotRegistered if the merchant has never called
    /// registerMerchantBankDetails first.
    pub fn update_merchant_bank_details(
        &mut self,
        bank_name: String,
        account_name: String,
        account_number: String,
    ) -> Result<(), SettlXError> {
        // Validate inputs
        if bank_name.is_empty() {
            return Err(SettlXError::BankNameRequired(BankNameRequired {}));
        }
        if account_name.is_empty() {
            return Err(SettlXError::AccountNameRequired(AccountNameRequired {}));
        }
        if account_number.is_empty() {
            return Err(SettlXError::AccountNumberRequired(AccountNumberRequired {}));
        }

        let sender = self.vm().msg_sender();
        let mut merchant = self.merchants.setter(sender);

        // Only registered merchants can update — prevents confusion from
        // calling update before register
        if !merchant.is_registered.get() {
            return Err(SettlXError::NotRegistered(NotRegistered {}));
        }

        // Overwrite stored hashes with the new values
        merchant.bank_name.set(keccak256(bank_name.as_bytes()));
        merchant.account_name.set(keccak256(account_name.as_bytes()));
        merchant.account_number.set(keccak256(account_number.as_bytes()));
        // is_registered stays true — no change needed

        // Emit plaintext so frontends can index the latest bank details
        log(self.vm(), MerchantUpdated {
            merchant: sender,
            bankName: bank_name,
            accountName: account_name,
            accountNumber: account_number,
        });

        Ok(())
    }

    // ── Payment Lifecycle ─────────────────────────────────────────────────────

    /// Create a new payment. Transfers USDC from payer into contract escrow.
    ///
    /// - merchant: must not be zero address
    /// - amount:   USDC amount in 6-decimal units (e.g. 5 USDC = 5_000_000)
    /// - rfce:     human-readable payment reference (e.g. "INV-2024-001")
    ///             stored as keccak256 hash on-chain; plaintext emitted in event
    ///
    /// The payment is created in Pending status. USDC stays in escrow until
    /// the merchant either accepts (→ moves USDC to admin) or rejects (→ refunds payer).
    pub fn pay_merchant(
        &mut self,
        merchant: Address,
        amount: U256,
        rfce: String,
    ) -> Result<(), SettlXError> {
        if merchant == Address::ZERO {
            return Err(SettlXError::InvalidMerchant(InvalidMerchant {}));
        }
        if amount == U256::ZERO {
            return Err(SettlXError::InvalidAmount(InvalidAmount {}));
        }

        let payer = self.vm().msg_sender();
        let contract_addr = self.vm().contract_address();
        let current_time = self.vm().block_timestamp();
        let stable_token = self.stable_token.get();

        // Pull USDC from payer into this contract (payer must have approved first)
        let token = IERC20::new(stable_token);
        let _ = token.transfer_from(&mut *self, payer, contract_addr, amount);

        // Write payment record to storage
        let id = self.next_payment_id.get();
        let mut payment = self.payments.setter(id);
        payment.id.set(id);
        payment.payer.set(payer);
        payment.merchant.set(merchant);
        payment.amount.set(amount);
        payment.timestamp.set(U256::from(current_time));
        payment.rfce.set(keccak256(rfce.as_bytes())); 
        payment.status.set(U8::from(0u8));            // 0 = Pending
        payment.locked_rate.set(U256::ZERO);           

        // Add this payment ID to both lookup lists
        self.merchant_payments.setter(merchant).push(id);
        self.payer_payments.setter(payer).push(id);

        // Advance the counter for the next payment
        self.next_payment_id.set(id + U256::from(1));

        // Emit with plaintext rfce — this is the only record of the original string
        log(self.vm(), PaymentCreated {
            id,
            payer,
            merchant,
            amount,
            rfce,
        });

        Ok(())
    }

    /// Merchant accepts a pending payment and locks the NGN exchange rate.
    ///
    /// - payment_id: ID of the payment to accept
    /// - rate:       current NGN per USDC exchange rate, scaled by 1e18
    ///               (e.g. 1500 NGN/USDC → pass 1500 * 10^18)
    ///               This is calculated off-chain using Chainlink price feeds.
    ///
    /// On success:
    ///   - Payment status → Accepted
    ///   - Locked rate written to storage
    ///   - USDC transferred from escrow to admin treasury
    ///   - PaymentAccepted event emitted with the locked rate
    ///
    /// Admin must then manually send the NGN equivalent to the merchant's bank
    /// and call markAsPaid() to complete the cycle.
    pub fn accept_payment_with_rate(
        &mut self,
        payment_id: U256,
        rate: U256,
    ) -> Result<(), SettlXError> {
        let sender = self.vm().msg_sender();

        let mut payment = self.payments.setter(payment_id);

        // Only the merchant on this specific payment can accept it
        if payment.merchant.get() != sender {
            return Err(SettlXError::NotYourPayment(NotYourPayment {}));
        }
        // Payment must still be Pending (status 0)
        if payment.status.get().to::<u8>() != 0u8 {
            return Err(SettlXError::AlreadyProcessed(AlreadyProcessed {}));
        }
        // Rate must be non-zero — accepting at 0 would mean NGN amount is 0
        if rate == U256::ZERO {
            return Err(SettlXError::InvalidRate(InvalidRate {}));
        }

        payment.status.set(U8::from(1u8)); // 1 = Accepted
        payment.locked_rate.set(rate);      // Rate is now immutable on-chain

        // Snapshot fields before dropping the mutable borrow
        let admin = self.admin.get();
        let amount = payment.amount.get();
        let stable_token = self.stable_token.get();

        drop(payment); // Release borrow before calling token transfer

        // Move USDC from escrow to admin — admin will handle NGN fiat transfer
        let token = IERC20::new(stable_token);
        let _ = token.transfer(&mut *self, admin, amount);

        log(self.vm(), PaymentAccepted {
            id: payment_id,
            lockedRate: rate,
        });

        Ok(())
    }

    /// Merchant rejects a pending payment and refunds USDC to the payer.
    ///
    /// - payment_id: ID of the payment to reject
    ///
    /// On success:
    ///   - Payment status → Rejected
    ///   - USDC refunded from escrow back to the original payer
    ///   - PaymentRejected event emitted
    pub fn reject_payment(&mut self, payment_id: U256) -> Result<(), SettlXError> {
        let sender = self.vm().msg_sender();

        let mut payment = self.payments.setter(payment_id);

        // Only the merchant on this payment can reject it
        if payment.merchant.get() != sender {
            return Err(SettlXError::NotYourPayment(NotYourPayment {}));
        }
        // Payment must still be Pending
        if payment.status.get().to::<u8>() != 0u8 {
            return Err(SettlXError::AlreadyProcessed(AlreadyProcessed {}));
        }

        payment.status.set(U8::from(2u8)); // 2 = Rejected

        // Snapshot before dropping borrow
        let payer = payment.payer.get();
        let amount = payment.amount.get();
        let stable_token = self.stable_token.get();

        drop(payment);

        // Refund USDC from escrow to the original payer
        let token = IERC20::new(stable_token);
        let _ = token.transfer(&mut *self, payer, amount);

        log(self.vm(), PaymentRejected { id: payment_id });

        Ok(())
    }

    /// Admin confirms that NGN has been sent to the merchant's bank account.
    /// This is the final step in the payment lifecycle.
    ///
    /// - payment_id: ID of the payment to mark as paid
    ///
    /// Reverts if:
    ///   - caller is not admin
    ///   - payment is not in Accepted state (must accept before marking paid)
    pub fn mark_as_paid(&mut self, payment_id: U256) -> Result<(), SettlXError> {
        // Strict admin-only — only the address set during init() can call this
        if self.vm().msg_sender() != self.admin.get() {
            return Err(SettlXError::OnlyAdmin(OnlyAdmin {}));
        }

        let mut payment = self.payments.setter(payment_id);

        // Must be Accepted (status 1) — cannot skip from Pending to Paid
        if payment.status.get().to::<u8>() != 1u8 {
            return Err(SettlXError::MustBeAcceptedFirst(MustBeAcceptedFirst {}));
        }

        payment.status.set(U8::from(3u8)); // 3 = Paid

        log(self.vm(), PaymentMarkedAsPaid { id: payment_id });

        Ok(())
    }

    // ── Read-only Getters ─────────────────────────────────────────────────────

    /// Returns all payment IDs created where `merchant` is the recipient.
    /// Use this to populate the merchant dashboard.
    pub fn get_merchant_payment_ids(&self, merchant: Address) -> Vec<U256> {
        let payments = self.merchant_payments.get(merchant);
        let mut result = Vec::new();
        for i in 0..payments.len() {
            result.push(payments.get(i).unwrap());
        }
        result
    }

    /// Returns all payment IDs created by `payer`.
    /// Use this to populate the payer (Transact) page.
    pub fn get_payer_payment_ids(&self, payer: Address) -> Vec<U256> {
        let payments = self.payer_payments.get(payer);
        let mut result = Vec::new();
        for i in 0..payments.len() {
            result.push(payments.get(i).unwrap());
        }
        result
    }

    /// Returns core fields for a single payment by ID.
    ///
    /// Return order: (id, payer, merchant, amount, timestamp, rfce_hash, status)
    ///
    /// NOTE: rfce is returned as a bytes32 hash — NOT the original string.
    ///       To get the original reference, index PaymentCreated events.
    /// NOTE: locked_rate is NOT returned here. Index PaymentAccepted events instead.
    pub fn get_payment(
        &self,
        payment_id: U256,
    ) -> (U256, Address, Address, U256, U256, FixedBytes<32>, u8) {
        let payment = self.payments.get(payment_id);
        (
            payment.id.get(),
            payment.payer.get(),
            payment.merchant.get(),
            payment.amount.get(),       
            payment.timestamp.get(),    
            payment.rfce.get(),         
            payment.status.get().to::<u8>(), 
        )
    }

    /// Returns stored bank detail hashes for a merchant.
    ///
    /// Return order: (bank_name_hash, account_name_hash, account_number_hash)
    ///
    /// NOTE: These are keccak256 hashes — NOT readable strings.
    ///       To get plaintext bank details, index MerchantRegistered / MerchantUpdated events.
    ///       Check is_registered by testing if bank_name_hash != bytes32(0).
    pub fn get_merchant_bank_details(
        &self,
        merchant: Address,
    ) -> (FixedBytes<32>, FixedBytes<32>, FixedBytes<32>) {
        let info = self.merchants.get(merchant);
        (
            info.bank_name.get(),
            info.account_name.get(),
            info.account_number.get(),
        )
    }
}