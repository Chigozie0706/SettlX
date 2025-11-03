// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

/**
 * @title SettlX - De-risked Merchant Settlement Contract
 * @author
 * @notice This contract enables secure crypto-to-fiat settlements between payers and merchants.
 * @dev Funds are held in escrow until the merchant accepts or rejects the payment.
 * The admin manages final payment settlement after fiat disbursement.
 */

import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {AggregatorV3Interface} from "@chainlink/contracts/src/v0.8/shared/interfaces/AggregatorV3Interface.sol";

contract SettlX is ReentrancyGuard {
    using SafeERC20 for IERC20;

    /// @notice ERC20 stable token used for payments (e.g., USDC)
    IERC20 public immutable stableToken;

    /// @notice Counter for generating unique payment IDs
    uint256 private nextPaymentId = 1;

    /// @notice Admin address (controls off-chain fiat settlements)
    address public admin;

    /// @notice Possible states of a payment
    enum Status {
        Pending,
        Accepted,
        Rejected,
        Paid
    }

    /// @notice Represents a single payment record
    struct Payment {
        uint256 id;
        address payer;
        address merchant;
        uint256 amount;
        uint256 timestamp;
        string rfce;
        Status status;
        uint256 lockedRate;
        uint256 rateLockTimestamp;
    }

    /// @notice Merchant bank details for fiat settlements
    struct MerchantInfo {
        string bankName;
        string accountName;
        string accountNumber;
        bool isRegistered;
    }

    /// @dev Stores all payments by ID
    mapping(uint256 => Payment) public payments;

    /// @dev Tracks payments made to each merchant
    mapping(address => uint256[]) private merchantPayments;

    /// @dev Tracks bank details of registered merchants
    mapping(address => MerchantInfo) public merchants;

    /// @dev Tracks payments made by each payer
    mapping(address => uint256[]) private payerPayments;

    /// @notice Emitted when a merchant registers their bank details
    event MerchantRegistered(
        address indexed merchant,
        string bankName,
        string accountName,
        string accountNumber
    );

    /// @notice Emitted when a new payment is created
    event PaymentCreated(
        uint256 indexed id,
        address indexed payer,
        address indexed merchant,
        uint256 amount,
        string rfce
    );

    /// @notice Emitted when a payment is accepted by the merchant
    event PaymentAccepted(uint256 indexed id, uint256 lockedRate);

    /// @notice Emitted when a payment is rejected by the merchant
    event PaymentRejected(uint256 indexed id);

    /// @notice Emitted when admin marks a payment as paid
    event PaymentMarkedAsPaid(uint256 indexed id);

    /**
     * @param tokenAddress Address of the ERC20 stable token (e.g., USDC)
     * @dev Sets the stable token and assigns deployer as admin.
     */
    constructor(address tokenAddress) {
        require(tokenAddress != address(0), "Invalid token");
        stableToken = IERC20(tokenAddress);
        admin = msg.sender;
    }

    /// @notice Restricts access to the admin only
    modifier onlyAdmin() {
        require(msg.sender == admin, "Only admin can call this");
        _;
    }

    /**
     * @notice Allows a payer to make a payment to a merchant (escrowed until accepted/rejected)
     * @dev Payer must have approved this contract to spend tokens beforehand.
     * @param merchant Address of the merchant to be paid
     * @param amount Amount to be paid (in stable tokens)
     * @param rfce Unique transaction reference code
     */
    function payMerchant(
        address merchant,
        uint256 amount,
        string calldata rfce
    ) external nonReentrant {
        require(merchant != address(0), "Invalid merchant");
        require(amount > 0, "Invalid amount");

        // Transfer USDC from payer to contract (escrow)
        stableToken.safeTransferFrom(msg.sender, address(this), amount);

        uint256 id = nextPaymentId++;
        payments[id] = Payment({
            id: id,
            payer: msg.sender,
            merchant: merchant,
            amount: amount,
            timestamp: block.timestamp,
            rfce: rfce,
            status: Status.Pending,
            lockedRate: 0,
            rateLockTimestamp: 0
        });
        merchantPayments[merchant].push(id);
        payerPayments[msg.sender].push(id);
        emit PaymentCreated(id, msg.sender, merchant, amount, rfce);
    }

    /**
     * @notice Allows merchant to accept a payment and lock exchange rate
     * @param paymentId ID of the payment being accepted
     * @param rate Exchange rate locked for settlement
     * @dev Transfers escrowed funds to admin wallet for off-chain settlement
     */

    function acceptPaymentWithRate(
        uint256 paymentId,
        uint256 rate
    ) external nonReentrant {
        Payment storage p = payments[paymentId];
        require(p.merchant == msg.sender, "Not your payment");
        require(p.status == Status.Pending, "Already processed");
        require(rate > 0, "Invalid rate");

        p.status = Status.Accepted;
        p.lockedRate = rate;
        p.rateLockTimestamp = block.timestamp;

        // Transfer funds to admin
        stableToken.safeTransfer(admin, p.amount);

        emit PaymentAccepted(paymentId, rate);
    }

    /**
     * @notice Allows merchant to reject a payment
     * @param paymentId ID of the payment being rejected
     * @dev Refunds the payer immediately
     */
    function rejectPayment(uint256 paymentId) external nonReentrant {
        Payment storage p = payments[paymentId];
        require(p.merchant == msg.sender, "Not your payment");
        require(p.status == Status.Pending, "Already processed");

        p.status = Status.Rejected;
        stableToken.safeTransfer(p.payer, p.amount);

        emit PaymentRejected(paymentId);
    }

    /**
     * @notice Returns all payment IDs associated with a merchant
     * @param merchant Address of merchant
     * @return List of payment IDs
     */
    function getMerchantPaymentIds(
        address merchant
    ) external view returns (uint256[] memory) {
        return merchantPayments[merchant];
    }

    function getPayment(
        uint256 paymentId
    )
        external
        view
        returns (
            uint256 id,
            address payer,
            address merchant,
            uint256 amount,
            uint256 timestamp,
            string memory rfce,
            Status status
        )
    {
        Payment storage p = payments[paymentId];
        return (
            p.id,
            p.payer,
            p.merchant,
            p.amount,
            p.timestamp,
            p.rfce,
            p.status
        );
    }

    /**
     * @notice Registers merchant bank details for fiat settlements
     * @param bankName Merchant's bank name
     * @param accountName Merchant's bank account name
     * @param accountNumber Merchant's bank account number
     */
    function registerMerchantBankDetails(
        string calldata bankName,
        string calldata accountName,
        string calldata accountNumber
    ) external {
        require(bytes(bankName).length > 0, "Bank name required");
        require(bytes(accountName).length > 0, "Account name required");
        require(bytes(accountNumber).length > 0, "Account number required");

        merchants[msg.sender] = MerchantInfo({
            bankName: bankName,
            accountName: accountName,
            accountNumber: accountNumber,
            isRegistered: true
        });

        emit MerchantRegistered(
            msg.sender,
            bankName,
            accountName,
            accountNumber
        );
    }

    function getMerchantBankDetails(
        address merchant
    )
        external
        view
        returns (
            string memory bankName,
            string memory accountName,
            string memory accountNumber
        )
    {
        MerchantInfo storage info = merchants[merchant];
        return (info.bankName, info.accountName, info.accountNumber);
    }

    /**
     * @notice Returns full list of all payments with associated merchant info
     * @dev Designed for admin or off-chain dashboard queries
     * @return allPayments Array of all Payment structs
     * @return allMerchants Array of corresponding MerchantInfo structs
     */
    function getAllPayments()
        external
        view
        returns (Payment[] memory, MerchantInfo[] memory)
    {
        uint256 totalPayments = nextPaymentId - 1;
        Payment[] memory allPayments = new Payment[](totalPayments);
        MerchantInfo[] memory allMerchants = new MerchantInfo[](totalPayments);

        for (uint256 i = 1; i <= totalPayments; i++) {
            allPayments[i - 1] = payments[i];
            allMerchants[i - 1] = merchants[payments[i].merchant];
        }

        return (allPayments, allMerchants);
    }

    /**
     * @notice Returns all payment IDs associated with a payer
     * @param payer Address of payer
     * @return List of payment IDs
     */
    function getPayerPaymentIds(
        address payer
    ) external view returns (uint256[] memory) {
        return payerPayments[payer];
    }

    /**
     * @notice Admin marks a payment as paid after fiat transfer is completed
     * @param paymentId ID of the payment to update
     */
    function markAsPaid(uint256 paymentId) external onlyAdmin nonReentrant {
        Payment storage p = payments[paymentId];
        require(p.status == Status.Accepted, "Payment must be accepted first");

        p.status = Status.Paid;
        emit PaymentMarkedAsPaid(paymentId);
    }
}
