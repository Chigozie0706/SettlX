// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {AggregatorV3Interface} from "@chainlink/contracts/src/v0.8/shared/interfaces/AggregatorV3Interface.sol";

contract SettlX is ReentrancyGuard {
    using SafeERC20 for IERC20;

    IERC20 public immutable stableToken; // e.g. USDC
    uint256 private nextPaymentId = 1;
    uint256[] private allPayments; // track all payment IDs for admin

    enum Status {
        Pending,
        Accepted,
        Rejected
    }

    struct Payment {
        uint256 id;
        address payer;
        address merchant;
        uint256 amount;
        uint256 timestamp;
        string rfce;
        Status status;
    }

    struct MerchantInfo {
        string bankName;
        string accountName;
        string accountNumber;
        bool isRegistered;
    }

    mapping(uint256 => Payment) public payments;
    mapping(address => uint256[]) private merchantPayments;
    mapping(address => MerchantInfo) public merchants;

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
    event PaymentAccepted(uint256 indexed id);
    event PaymentRejected(uint256 indexed id);

    constructor(address tokenAddress) {
        require(tokenAddress != address(0), "Invalid token");
        stableToken = IERC20(tokenAddress);
    }

    /// @notice Payer must approve contract first
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
            status: Status.Pending
        });
        merchantPayments[merchant].push(id);

        emit PaymentCreated(id, msg.sender, merchant, amount, rfce);
    }

    /// @notice Merchant accepts a pending payment -> funds released
    function acceptPayment(uint256 paymentId) external nonReentrant {
        Payment storage p = payments[paymentId];
        require(p.merchant == msg.sender, "Not your payment");
        require(p.status == Status.Pending, "Already processed");

        p.status = Status.Accepted;
        stableToken.safeTransfer(p.merchant, p.amount);

        emit PaymentAccepted(paymentId);
    }

    /// @notice Merchant rejects payment -> refund to payer
    function rejectPayment(uint256 paymentId) external nonReentrant {
        Payment storage p = payments[paymentId];
        require(p.merchant == msg.sender, "Not your payment");
        require(p.status == Status.Pending, "Already processed");

        p.status = Status.Rejected;
        stableToken.safeTransfer(p.payer, p.amount);

        emit PaymentRejected(paymentId);
    }

    /// @notice View all payment IDs for a merchant
    function getMerchantPaymentIds(
        address merchant
    ) external view returns (uint256[] memory) {
        return merchantPayments[merchant];
    }

    /// @notice Get full details of a specific payment
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

    /// @notice Register merchant bank details (merchant calls this)
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

    function getPaymentInfo(
        uint256 id
    ) external view returns (Payment memory, MerchantInfo memory) {
        Payment memory p = payments[id];
        MerchantInfo memory m = merchants[p.merchant];
        return (p, m);
    }
}
