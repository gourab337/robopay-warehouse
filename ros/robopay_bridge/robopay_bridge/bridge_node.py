"""RoboPay ROS 2 bridge.

Runs the same agent loop as web/src/robot.ts on a real robot:
  - watches JobMarket on HSK Chain for open jobs matching its role,
  - accepts one with the robot's own wallet,
  - drives there with Nav2 (NavigateToPose),
  - picker: hires a carrier by posting a sub-job + tote commitment,
  - carrier: at PACK, gets a ZK proof of delivery and calls submitWithProof.
Publishes human-readable status on ~/status.
"""
import json
import os
import random
import time

import rclpy
import requests
import yaml
from action_msgs.msg import GoalStatus
from geometry_msgs.msg import PoseStamped
from nav2_msgs.action import NavigateToPose
from rclpy.action import ActionClient
from rclpy.node import Node
from std_msgs.msg import String
from web3 import Web3

OPEN, SUBMITTED, PAID = 1, 3, 4
SUBJOB_REWARD = 3 * 10**6  # 3 mUSDC


class RoboPayBridge(Node):
    def __init__(self):
        super().__init__('robopay_bridge')
        p = self.declare_parameter
        self.role = p('role', 'carrier').value  # picker | carrier
        rpc = p('rpc_url', 'https://testnet.hsk.xyz').value
        market = p('market', '0xF0f0c15a7e05e81C11Dcbd1E2036A7fa83993351').value
        abi_path = p('market_abi', 'contracts/out/JobMarket.sol/JobMarket.json').value
        map_path = p('map', 'config/warehouse.yaml').value
        self.prover_url = p('prover_url', 'http://localhost:5199').value

        key = os.environ.get('ROBOT_PRIVATE_KEY')
        if not key:
            raise RuntimeError('set ROBOT_PRIVATE_KEY (testnet burner) for this robot')
        self.w3 = Web3(Web3.HTTPProvider(rpc))
        self.account = self.w3.eth.account.from_key(key)
        with open(abi_path) as f:
            abi = json.load(f)['abi']
        self.market = self.w3.eth.contract(address=Web3.to_checksum_address(market), abi=abi)
        with open(map_path) as f:
            cfg = yaml.safe_load(f)
        self.frame, self.locations = cfg['frame_id'], cfg['locations']

        self.nav = ActionClient(self, NavigateToPose, 'navigate_to_pose')
        self.status_pub = self.create_publisher(String, '~/status', 10)
        self.status(f'{self.role} online as {self.account.address}')

    # --- helpers -----------------------------------------------------------
    def status(self, msg):
        self.get_logger().info(msg)
        self.status_pub.publish(String(data=msg))

    def tx(self, fn, *args):
        """Simulate, then send from the robot's own wallet and wait for the receipt."""
        call = getattr(self.market.functions, fn)(*args)
        result = call.call({'from': self.account.address})  # reverts locally if we'd lose a race
        txn = call.build_transaction({
            'from': self.account.address,
            'nonce': self.w3.eth.get_transaction_count(self.account.address, 'pending'),
        })
        signed = self.account.sign_transaction(txn)
        h = self.w3.eth.send_raw_transaction(signed.raw_transaction)
        rcpt = self.w3.eth.wait_for_transaction_receipt(h)
        if rcpt.status != 1:
            raise RuntimeError(f'{fn} reverted: {h.hex()}')
        self.status(f'{fn} ok {h.hex()}')
        return result

    def job(self, job_id):
        poster, worker, reward, parent_id, status, proof, spec = self.market.functions.jobs(job_id).call()
        return dict(id=job_id, poster=poster, worker=worker, reward=reward, parent_id=parent_id, status=status, spec=spec)

    def open_jobs(self, last_n=12):
        count = self.market.functions.jobCount().call()
        jobs = [self.job(i) for i in range(count, max(0, count - last_n), -1)]
        if self.role == 'picker':
            return [j for j in jobs if j['status'] == OPEN and j['parent_id'] == 0]
        # carriers only take sub-jobs whose tote the picker has committed to
        return [j for j in jobs if j['status'] == OPEN and j['parent_id'] != 0
                and self.market.functions.toteCommitment(j['id']).call() != b'\x00' * 32]

    def drive_to(self, name):
        """Send a Nav2 goal and block until it finishes."""
        x, y = self.locations[name]
        goal = NavigateToPose.Goal()
        goal.pose = PoseStamped()
        goal.pose.header.frame_id = self.frame
        goal.pose.header.stamp = self.get_clock().now().to_msg()
        goal.pose.pose.position.x, goal.pose.pose.position.y = float(x), float(y)
        goal.pose.pose.orientation.w = 1.0
        self.status(f'driving to {name}')
        self.nav.wait_for_server()
        handle_future = self.nav.send_goal_async(goal)
        rclpy.spin_until_future_complete(self, handle_future)
        handle = handle_future.result()
        if not handle.accepted:
            raise RuntimeError(f'Nav2 rejected goal to {name}')
        result_future = handle.get_result_async()
        rclpy.spin_until_future_complete(self, result_future)
        if result_future.result().status != GoalStatus.STATUS_SUCCEEDED:
            raise RuntimeError(f'Nav2 failed to reach {name}')

    # --- roles -------------------------------------------------------------
    def pick(self, order):
        spec = json.loads(order['spec'])
        self.drive_to(spec['shelf'])
        sub_id = self.tx('post', json.dumps({'from': spec['shelf'], 'to': 'PACK'}), SUBJOB_REWARD, order['id'])
        tote = str(random.randrange(10**9))  # in production: read from the tote's RFID tag
        commitment = requests.get(f'{self.prover_url}/api/commit', params={'tote': tote, 'job': sub_id}, timeout=30).json()['commitment']
        self.tx('setToteCommitment', sub_id, commitment)
        self.status(f'tote {tote} handed to carrier for job #{sub_id}')
        deadline = time.time() + 300
        while self.job(sub_id)['status'] < SUBMITTED:
            if time.time() > deadline:
                raise RuntimeError(f'carrier for job #{sub_id} timed out')
            time.sleep(2)
        if self.job(sub_id)['status'] != PAID:
            self.tx('confirm', sub_id)
        self.tx('submit', order['id'], Web3.keccak(text=f"{spec['sku']} packed"))

    def carry(self, job, tote):
        spec = json.loads(job['spec'])
        self.drive_to(spec['from'])
        self.drive_to('PACK')
        self.status('generating ZK proof of delivery')
        proof = requests.get(f'{self.prover_url}/api/prove', params={
            'tote': tote, 'job': job['id'], 'carrier': self.account.address}, timeout=120).json()['proof']
        self.tx('submitWithProof', job['id'], proof)

    def run(self):
        while rclpy.ok():
            try:
                for j in self.open_jobs():
                    try:
                        self.tx('accept', j['id'])
                    except Exception:
                        continue  # another robot won the race
                    if self.role == 'picker':
                        self.pick(j)
                    else:
                        # tote ID arrives physically with the tote (RFID scan); here from a parameter/topic
                        self.carry(j, os.environ.get('TOTE_ID', '0'))
                    break
            except Exception as e:
                self.status(f'error: {e}')
            time.sleep(2)


def main():
    rclpy.init()
    node = RoboPayBridge()
    try:
        node.run()
    finally:
        node.destroy_node()
        rclpy.shutdown()


if __name__ == '__main__':
    main()
