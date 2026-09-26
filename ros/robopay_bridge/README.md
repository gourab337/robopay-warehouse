# robopay_bridge (ROS 2)

Runs the RoboPay agent on a real robot: the robot's own wallet takes jobs from `JobMarket` on HSK Chain, Nav2 drives it, and a ZK proof of delivery gets it paid.

```bash
# in a ROS 2 (Humble/Jazzy) workspace with Nav2 running
pip install web3 pyyaml requests
colcon build --packages-select robopay_bridge && source install/setup.bash
ROBOT_PRIVATE_KEY=0x... ros2 run robopay_bridge bridge --ros-args \
  -p role:=carrier -p market_abi:=/path/to/contracts/out/JobMarket.sol/JobMarket.json \
  -p map:=/path/to/config/warehouse.yaml
ros2 topic echo /robopay_bridge/status
```

Status: written at the hackathon and syntax-checked only — not yet run on a robot or in Gazebo. The tote ID hand-off (RFID) is stubbed via `TOTE_ID`.
