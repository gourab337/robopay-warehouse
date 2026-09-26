// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IKycSBT} from "./IKycSBT.sol";

/// @notice Demo stand-in for HashKey's KYC SBT: the live testnet on-ramp is not self-serve.
/// Never deploy to production — point JobMarket at the real SBT instead.
contract MockKycSBT is IKycSBT {
    address public immutable admin;
    mapping(address => uint8) public level;

    constructor() {
        admin = msg.sender;
    }

    function approve(address account, uint8 lvl) external {
        require(msg.sender == admin, "not admin");
        level[account] = lvl;
    }

    function isHuman(address account) external view returns (bool, uint8) {
        return (level[account] > 0, level[account]);
    }
}
