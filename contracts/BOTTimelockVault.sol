// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";

/**
 * @title BOTTimelockVault
 * @notice Self-custody timelock vault for native BOT.
 *         Users deposit BOT with an unlock timestamp; funds can only be
 *         withdrawn by the depositor after unlockTime passes.
 *         No admin key can move user funds under normal operation.
 *         emergencyWithdraw only works when paused and returns funds to their
 *         rightful owners (does NOT let admin steal).
 */
contract BOTTimelockVault is Ownable, ReentrancyGuard, Pausable {
    struct Deposit {
        uint256 amount;
        uint256 unlockTime;
        bool withdrawn;
    }

    /// @dev per-user deposit history (append-only; withdrawn flag marks completion)
    mapping(address => Deposit[]) private _deposits;

    /// @notice total BOT currently locked in the contract (across all users, non-withdrawn)
    uint256 public totalLocked;

    /// @notice hard limit on unlock horizon (10 years) to prevent typos
    uint256 public constant MAX_LOCK_SECONDS = 365 days * 10;

    event Deposited(address indexed user, uint256 amount, uint256 unlockTime, uint256 index);
    event Withdrawn(address indexed user, uint256 amount, uint256 index);
    event EmergencyWithdrawn(address indexed user, uint256 amount, uint256 depositCount);

    constructor() Ownable(msg.sender) {}

    // ─────────────────────────────────────────────────────────
    // Core: deposit / withdraw
    // ─────────────────────────────────────────────────────────

    /**
     * @notice Lock msg.value of BOT until `unlockTime`. Creates a new deposit slot.
     */
    function deposit(uint256 unlockTime) external payable whenNotPaused nonReentrant {
        require(msg.value > 0, "Amount must be > 0");
        require(unlockTime > block.timestamp, "Unlock must be in future");
        require(unlockTime <= block.timestamp + MAX_LOCK_SECONDS, "Unlock too far ahead");

        uint256 index = _deposits[msg.sender].length;
        _deposits[msg.sender].push(Deposit({
            amount: msg.value,
            unlockTime: unlockTime,
            withdrawn: false
        }));
        totalLocked += msg.value;

        emit Deposited(msg.sender, msg.value, unlockTime, index);
    }

    /**
     * @notice Withdraw a specific deposit after its unlockTime has passed.
     */
    function withdraw(uint256 depositIndex) external nonReentrant {
        require(depositIndex < _deposits[msg.sender].length, "Invalid deposit index");
        Deposit storage d = _deposits[msg.sender][depositIndex];
        require(!d.withdrawn, "Already withdrawn");
        require(block.timestamp >= d.unlockTime, "Still locked");

        uint256 amt = d.amount;
        d.withdrawn = true;
        totalLocked -= amt;

        (bool ok, ) = payable(msg.sender).call{value: amt}("");
        require(ok, "Transfer failed");

        emit Withdrawn(msg.sender, amt, depositIndex);
    }

    // ─────────────────────────────────────────────────────────
    // Admin: pause / emergency escape hatch
    // ─────────────────────────────────────────────────────────

    /**
     * @notice Pause new deposits. Existing users can still withdraw once unlocked.
     */
    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    /**
     * @notice Emergency escape: only while paused, owner can force-return all
     *         non-withdrawn funds to the listed users, regardless of unlockTime.
     *         Funds ALWAYS go back to their rightful owner (never to admin).
     *         Intended for contract deprecation / catastrophic bug scenarios.
     */
    function emergencyWithdraw(address[] calldata users) external onlyOwner whenPaused nonReentrant {
        for (uint256 u = 0; u < users.length; u++) {
            address user = users[u];
            uint256 count = _deposits[user].length;
            uint256 refund = 0;
            for (uint256 i = 0; i < count; i++) {
                Deposit storage d = _deposits[user][i];
                if (!d.withdrawn) {
                    refund += d.amount;
                    d.withdrawn = true;
                }
            }
            if (refund > 0) {
                totalLocked -= refund;
                (bool ok, ) = payable(user).call{value: refund}("");
                require(ok, "Transfer failed");
                emit EmergencyWithdrawn(user, refund, count);
            }
        }
    }

    // ─────────────────────────────────────────────────────────
    // Views (matches frontend ABI exactly)
    // ─────────────────────────────────────────────────────────

    function getDeposit(address user, uint256 index)
        external
        view
        returns (uint256 amount, uint256 unlockTime, bool withdrawn)
    {
        require(index < _deposits[user].length, "Invalid deposit index");
        Deposit storage d = _deposits[user][index];
        return (d.amount, d.unlockTime, d.withdrawn);
    }

    function getDepositCount(address user) external view returns (uint256) {
        return _deposits[user].length;
    }

    function getTotalLocked() external view returns (uint256) {
        return totalLocked;
    }
}
