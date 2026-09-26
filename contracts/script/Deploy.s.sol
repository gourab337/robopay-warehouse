// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {MockUSDC} from "../src/MockUSDC.sol";
import {JobMarket} from "../src/JobMarket.sol";
import {ChargingDock} from "../src/ChargingDock.sol";
import {HonkVerifier} from "../src/HonkVerifier.sol";

/// Deployer = warehouse + dock operator. ROBOTS = comma-separated robot addresses to fund.
contract Deploy is Script {
    function run() external {
        address[] memory robots = vm.envOr("ROBOTS", ",", new address[](0));
        uint256 gasPerRobot = vm.envOr("GAS_PER_ROBOT", uint256(0.02 ether));

        vm.startBroadcast();
        MockUSDC usdc = new MockUSDC();
        HonkVerifier verifier = new HonkVerifier();
        JobMarket market = new JobMarket(usdc, verifier, vm.envBytes32("STATION_COMMITMENT"));
        ChargingDock dock = new ChargingDock(usdc, msg.sender, 0.1e6);
        usdc.mint(msg.sender, 1_000e6);
        for (uint256 i; i < robots.length; i++) {
            usdc.mint(robots[i], 50e6);
            payable(robots[i]).transfer(gasPerRobot);
        }
        vm.stopBroadcast();

        console.log("MockUSDC", address(usdc));
        console.log("JobMarket", address(market));
        console.log("ChargingDock", address(dock));
        console.log("HonkVerifier", address(verifier));
    }
}
