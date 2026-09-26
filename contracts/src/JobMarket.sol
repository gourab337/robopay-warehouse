// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IVerifier} from "./HonkVerifier.sol";

/// @notice Escrowed jobs between any two wallets — warehouse→robot or robot→robot.
/// Poster locks reward, worker accepts and submits, poster confirms receipt to release payment.
contract JobMarket {
    using SafeERC20 for IERC20;

    enum Status { None, Open, Accepted, Submitted, Paid, Cancelled }

    struct Job {
        address poster;
        address worker;
        uint256 reward;
        uint256 parentId; // 0 = top-level job; else the job this subcontracts
        Status status;
        bytes32 proof;
        string spec;
    }

    IERC20 public immutable token;
    IVerifier public immutable deliveryVerifier; // Noir proof-of-delivery circuit (zk/)
    bytes32 public immutable stationCommitment; // pedersen(packing station scan secret)
    uint256 public jobCount;
    mapping(uint256 => Job) public jobs;
    mapping(address => uint256) public completed; // on-chain reputation
    mapping(uint256 => bytes32) public toteCommitment; // pedersen(tote_id, job_id), set by poster

    event JobPosted(uint256 indexed id, address indexed poster, uint256 reward, uint256 parentId, string spec);
    event JobAccepted(uint256 indexed id, address indexed worker);
    event JobSubmitted(uint256 indexed id, address indexed worker, bytes32 proof);
    event JobPaid(uint256 indexed id, address indexed worker, uint256 reward);
    event JobCancelled(uint256 indexed id);

    error WrongStatus(Status expected, Status actual);
    error NotPoster();
    error NotWorker();
    error ZeroReward();
    error InvalidProof();

    constructor(IERC20 _token, IVerifier _deliveryVerifier, bytes32 _stationCommitment) {
        token = _token;
        deliveryVerifier = _deliveryVerifier;
        stationCommitment = _stationCommitment;
    }

    function post(string calldata spec, uint256 reward, uint256 parentId) external returns (uint256 id) {
        if (reward == 0) revert ZeroReward();
        id = ++jobCount;
        jobs[id] = Job(msg.sender, address(0), reward, parentId, Status.Open, bytes32(0), spec);
        token.safeTransferFrom(msg.sender, address(this), reward);
        emit JobPosted(id, msg.sender, reward, parentId, spec);
    }

    function accept(uint256 id) external {
        Job storage j = _expect(id, Status.Open);
        j.worker = msg.sender;
        j.status = Status.Accepted;
        emit JobAccepted(id, msg.sender);
    }

    function submit(uint256 id, bytes32 proof) external {
        Job storage j = _expect(id, Status.Accepted);
        if (msg.sender != j.worker) revert NotWorker();
        j.proof = proof;
        j.status = Status.Submitted;
        emit JobSubmitted(id, msg.sender, proof);
    }

    /// Poster commits to the tote without revealing it; the worker must later prove delivery of that tote.
    function setToteCommitment(uint256 id, bytes32 commitment) external {
        Job storage j = jobs[id];
        if (msg.sender != j.poster) revert NotPoster();
        _expect(id, Status.Open);
        toteCommitment[id] = commitment;
    }

    /// Worker proves in zero knowledge that the packing station scanned the committed tote.
    /// A valid proof replaces the poster's confirm: payment is released by math, not trust.
    function submitWithProof(uint256 id, bytes calldata proof) external {
        Job storage j = _expect(id, Status.Accepted);
        if (msg.sender != j.worker) revert NotWorker();
        bytes32[] memory inputs = new bytes32[](4);
        inputs[0] = bytes32(id);
        inputs[1] = bytes32(uint256(uint160(msg.sender)));
        inputs[2] = toteCommitment[id];
        inputs[3] = stationCommitment;
        if (!deliveryVerifier.verify(proof, inputs)) revert InvalidProof();
        j.proof = keccak256(proof);
        j.status = Status.Paid;
        completed[j.worker]++;
        token.safeTransfer(j.worker, j.reward);
        emit JobSubmitted(id, msg.sender, j.proof);
        emit JobPaid(id, j.worker, j.reward);
    }

    function confirm(uint256 id) external {
        Job storage j = _expect(id, Status.Submitted);
        if (msg.sender != j.poster) revert NotPoster();
        j.status = Status.Paid;
        completed[j.worker]++;
        token.safeTransfer(j.worker, j.reward);
        emit JobPaid(id, j.worker, j.reward);
    }

    function cancel(uint256 id) external {
        Job storage j = _expect(id, Status.Open);
        if (msg.sender != j.poster) revert NotPoster();
        j.status = Status.Cancelled;
        token.safeTransfer(j.poster, j.reward);
        emit JobCancelled(id);
    }

    function _expect(uint256 id, Status s) private view returns (Job storage j) {
        j = jobs[id];
        if (j.status != s) revert WrongStatus(s, j.status);
    }
}
