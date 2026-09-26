// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/// @notice Robots pay the dock operator per unit of charge.
contract ChargingDock {
    using SafeERC20 for IERC20;

    IERC20 public immutable token;
    address public immutable operator;
    uint256 public immutable pricePerUnit;

    event Charged(address indexed robot, uint256 units, uint256 paid);

    constructor(IERC20 _token, address _operator, uint256 _pricePerUnit) {
        token = _token;
        operator = _operator;
        pricePerUnit = _pricePerUnit;
    }

    function charge(uint256 units) external {
        uint256 cost = units * pricePerUnit;
        token.safeTransferFrom(msg.sender, operator, cost);
        emit Charged(msg.sender, units, cost);
    }
}
