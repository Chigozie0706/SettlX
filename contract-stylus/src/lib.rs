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

// ERC20 interface for token transfers
sol_interface! {
    interface IERC20 {
        function transferFrom(address from, address to, uint256 amount) external returns (bool);
        function transfer(address to, uint256 amount) external returns (bool);
    }
}

// Events
sol! {
    event MerchantRegistered(
        address indexed merchant,
        string bankName,
        string accountName,
        string accountNumber
    );
    
    event PaymentCreated(
        uint256 indexed id,
        address indexed payer,
        address indexed merchant,
        uint256 amount,
        string rfce
    );
    
    event PaymentAccepted(uint256 indexed id, uint256 lockedRate);
    event PaymentRejected(uint256 indexed id);
    event PaymentMarkedAsPaid(uint256 indexed id);
}

// Errors
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
}

sol_storage! {
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

    #[derive(Erase)]
    pub struct MerchantInfo {
        bytes32 bank_name;
        bytes32 account_name;
        bytes32 account_number;
        bool is_registered;
    }

    #[entrypoint]
    pub struct SettlX {
        address stable_token;
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
    pub fn init(&mut self, token_address: Address) -> Result<(), SettlXError> {
        if token_address == Address::ZERO {
            return Err(SettlXError::InvalidToken(InvalidToken {}));
        }
        self.stable_token.set(token_address);
        self.next_payment_id.set(U256::from(1));
        self.admin.set(self.vm().msg_sender());
        Ok(())
    }

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
        
        let token = IERC20::new(stable_token);
        let _ = token.transfer_from(&mut *self, payer, contract_addr, amount);

        let id = self.next_payment_id.get();
        let mut payment = self.payments.setter(id);
        payment.id.set(id);
        payment.payer.set(payer);
        payment.merchant.set(merchant);
        payment.amount.set(amount);
        payment.timestamp.set(U256::from(current_time));
        payment.rfce.set(keccak256(rfce.as_bytes()));
        // payment.status.set(0u8);
        payment.status.set(U8::from(0u8));  // Pending
        payment.locked_rate.set(U256::ZERO);

        self.merchant_payments.setter(merchant).push(id);
        self.payer_payments.setter(payer).push(id);
        self.next_payment_id.set(id + U256::from(1));

        log(self.vm(), PaymentCreated {
            id,
            payer,
            merchant,
            amount,
            rfce,
        });

        Ok(())
    }

    pub fn accept_payment_with_rate(
        &mut self,
        payment_id: U256,
        rate: U256,
    ) -> Result<(), SettlXError> {
        let sender = self.vm().msg_sender();
        let current_time = self.vm().block_timestamp();
        
        let mut payment = self.payments.setter(payment_id);
        
        if payment.merchant.get() != sender {
            return Err(SettlXError::NotYourPayment(NotYourPayment {}));
        }
        if payment.status.get().to::<u8>() != 0u8 {
            return Err(SettlXError::AlreadyProcessed(AlreadyProcessed {}));
        }
        if rate == U256::ZERO {
            return Err(SettlXError::InvalidRate(InvalidRate {}));
        }

        // payment.status.set(1u8);
        payment.status.set(U8::from(1u8));  // Accepted
        payment.locked_rate.set(rate);

        let admin = self.admin.get();
        let amount = payment.amount.get();
        let stable_token = self.stable_token.get();
        
        drop(payment);
        
        let token = IERC20::new(stable_token);
        let _ = token.transfer(&mut *self, admin, amount);

        log(self.vm(), PaymentAccepted {
            id: payment_id,
            lockedRate: rate,
        });

        Ok(())
    }

    pub fn reject_payment(&mut self, payment_id: U256) -> Result<(), SettlXError> {
        let sender = self.vm().msg_sender();
        
        let mut payment = self.payments.setter(payment_id);
        
        if payment.merchant.get() != sender {
            return Err(SettlXError::NotYourPayment(NotYourPayment {}));
        }
        if payment.status.get().to::<u8>() != 0u8 {
            return Err(SettlXError::AlreadyProcessed(AlreadyProcessed {}));
        }

        // payment.status.set(2u8);
        payment.status.set(U8::from(2u8));  // Rejected

        let payer = payment.payer.get();
        let amount = payment.amount.get();
        let stable_token = self.stable_token.get();
        
        drop(payment);
        
        let token = IERC20::new(stable_token);
        let _ = token.transfer(&mut *self, payer, amount);

        log(self.vm(), PaymentRejected { id: payment_id });

        Ok(())
    }

    pub fn register_merchant_bank_details(
        &mut self,
        bank_name: String,
        account_name: String,
        account_number: String,
    ) -> Result<(), SettlXError> {
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
        merchant.bank_name.set(keccak256(bank_name.as_bytes()));
        merchant.account_name.set(keccak256(account_name.as_bytes()));
        merchant.account_number.set(keccak256(account_number.as_bytes()));
        merchant.is_registered.set(true);

        log(self.vm(), MerchantRegistered {
            merchant: sender,
            bankName: bank_name,
            accountName: account_name,
            accountNumber: account_number,
        });

        Ok(())
    }

    pub fn mark_as_paid(&mut self, payment_id: U256) -> Result<(), SettlXError> {
        if self.vm().msg_sender() != self.admin.get() {
            return Err(SettlXError::OnlyAdmin(OnlyAdmin {}));
        }

        let mut payment = self.payments.setter(payment_id);
        if payment.status.get().to::<u8>() != 1u8 {
            return Err(SettlXError::MustBeAcceptedFirst(MustBeAcceptedFirst {}));
        }

        // payment.status.set(3u8);
        payment.status.set(U8::from(3u8));  // Paid

        log(self.vm(), PaymentMarkedAsPaid { id: payment_id });

        Ok(())
    }

    pub fn get_merchant_payment_ids(&self, merchant: Address) -> Vec<U256> {
        let payments = self.merchant_payments.get(merchant);
        let mut result = Vec::new();
        for i in 0..payments.len() {
            result.push(payments.get(i).unwrap());
        }
        result
    }

    pub fn get_payer_payment_ids(&self, payer: Address) -> Vec<U256> {
        let payments = self.payer_payments.get(payer);
        let mut result = Vec::new();
        for i in 0..payments.len() {
            result.push(payments.get(i).unwrap());
        }
        result
    }

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