// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice HashKey Chain KYC soulbound token (testnet: 0xA45f42F09A7Ae50e556467cf65cF3Cf45711114E).
/// Levels: 0 NONE, 1 BASIC, 2 ADVANCED, 3 PREMIUM, 4 ULTIMATE.
interface IKycSBT {
    function isHuman(address account) external view returns (bool, uint8);
}
