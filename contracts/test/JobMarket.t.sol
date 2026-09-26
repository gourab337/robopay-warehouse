// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {MockUSDC} from "../src/MockUSDC.sol";
import {JobMarket} from "../src/JobMarket.sol";
import {ChargingDock} from "../src/ChargingDock.sol";
import {HonkVerifier} from "../src/HonkVerifier.sol";
import {MockKycSBT} from "../src/MockKycSBT.sol";

contract JobMarketTest is Test {
    MockUSDC usdc;
    JobMarket market;
    ChargingDock dock;
    MockKycSBT kyc;
    bytes32 constant STATION = 0x0ca459d2d41ed0e8a64700e7171f724ab1616f2c7c652bc8614a4f4b46a05b7f;
    bytes32 constant TOTE = 0x133ec82d91b2fed6ff122ad6338137c5111b4001edbf209da4836a2e0d6cb2e4;
    address constant ZK_CARRIER = 0x199594c16c1F32cEa156367E13ea65B94eB67E8c; // carrier in zk/Prover.toml

    address warehouse = makeAddr("warehouse");
    address picker = makeAddr("picker");
    address carrier = makeAddr("carrier");
    address dockOperator = makeAddr("dockOperator");

    function setUp() public {
        usdc = new MockUSDC();
        kyc = new MockKycSBT();
        kyc.approve(warehouse, 1);
        market = new JobMarket(usdc, new HonkVerifier(), STATION, kyc);
        dock = new ChargingDock(usdc, dockOperator, 0.1e6);
        usdc.mint(warehouse, 100e6);
        usdc.mint(picker, 20e6);
        usdc.mint(carrier, 20e6);
        for (uint256 i; i < 3; i++) {
            address a = [warehouse, picker, carrier][i];
            vm.prank(a);
            usdc.approve(address(market), type(uint256).max);
        }
    }

    function test_RobotSubcontractsRobot() public {
        vm.prank(warehouse);
        uint256 order = market.post("pick SKU-42", 10e6, 0);

        vm.prank(picker);
        market.accept(order);

        vm.prank(picker);
        uint256 sub = market.post("carry tote to pack", 3e6, order);
        vm.prank(carrier);
        market.accept(sub);
        vm.prank(carrier);
        market.submit(sub, keccak256("tote@pack"));
        vm.prank(picker);
        market.confirm(sub);

        vm.prank(picker);
        market.submit(order, keccak256("SKU-42 packed"));
        vm.prank(warehouse);
        market.confirm(order);

        assertEq(usdc.balanceOf(carrier), 23e6);
        assertEq(usdc.balanceOf(picker), 27e6); // 20 - 3 + 10
        assertEq(usdc.balanceOf(warehouse), 90e6);
        assertEq(usdc.balanceOf(address(market)), 0);
        assertEq(market.completed(picker), 1);
        assertEq(market.completed(carrier), 1);
    }

    function test_SecondAcceptReverts() public {
        vm.prank(warehouse);
        uint256 id = market.post("x", 1e6, 0);
        vm.prank(picker);
        market.accept(id);
        vm.expectRevert(abi.encodeWithSelector(JobMarket.WrongStatus.selector, JobMarket.Status.Open, JobMarket.Status.Accepted));
        vm.prank(carrier);
        market.accept(id);
    }

    function test_OnlyWorkerSubmits_OnlyPosterConfirms() public {
        vm.prank(warehouse);
        uint256 id = market.post("x", 1e6, 0);
        vm.prank(picker);
        market.accept(id);
        vm.expectRevert(JobMarket.NotWorker.selector);
        vm.prank(carrier);
        market.submit(id, 0);
        vm.prank(picker);
        market.submit(id, 0);
        vm.expectRevert(JobMarket.NotPoster.selector);
        vm.prank(picker);
        market.confirm(id);
    }

    function test_CancelRefundsOpenJob() public {
        vm.prank(warehouse);
        uint256 id = market.post("x", 5e6, 0);
        vm.prank(warehouse);
        market.cancel(id);
        assertEq(usdc.balanceOf(warehouse), 100e6);
    }

    function test_RobotPaysDock() public {
        vm.startPrank(picker);
        usdc.approve(address(dock), type(uint256).max);
        dock.charge(20);
        vm.stopPrank();
        assertEq(usdc.balanceOf(dockOperator), 2e6);
    }

    function _zkJob() private returns (uint256 id) {
        vm.prank(warehouse);
        id = market.post("carry tote", 3e6, 0); // job 1, matching zk/Prover.toml
        vm.prank(warehouse);
        market.setToteCommitment(id, TOTE);
        vm.prank(ZK_CARRIER);
        market.accept(id);
    }

    function test_ZkProofOfDeliveryPays() public {
        uint256 id = _zkJob();
        bytes memory proof = vm.readFileBinary("test/fixtures/proof_job1");
        vm.prank(ZK_CARRIER);
        market.submitWithProof(id, proof);
        assertEq(usdc.balanceOf(ZK_CARRIER), 3e6);
        assertEq(market.completed(ZK_CARRIER), 1);
    }

    function test_ZkProofRejectedForWrongTote() public {
        uint256 id = _zkJob();
        vm.prank(warehouse);
        vm.expectRevert(); // commitment can only be set while Open
        market.setToteCommitment(id, bytes32(uint256(1)));
        bytes memory proof = vm.readFileBinary("test/fixtures/proof_job1");
        proof[100] ^= 0x01; // tampered proof
        vm.prank(ZK_CARRIER);
        vm.expectRevert();
        market.submitWithProof(id, proof);
    }

    function test_NonKycCannotPostOrder() public {
        vm.expectRevert(JobMarket.NotKycVerified.selector);
        vm.prank(picker);
        market.post("x", 1e6, 0);
    }

    function test_RobotCanOnlySubcontractItsOwnJob() public {
        vm.prank(warehouse);
        uint256 order = market.post("x", 1e6, 0);
        vm.expectRevert(JobMarket.UnknownParent.selector);
        vm.prank(carrier);
        market.post("sub", 1e6, order);
    }
}
