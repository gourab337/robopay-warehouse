from setuptools import setup

setup(
    name='robopay_bridge',
    version='0.1.0',
    packages=['robopay_bridge'],
    data_files=[
        ('share/ament_index/resource_index/packages', ['resource/robopay_bridge']),
        ('share/robopay_bridge', ['package.xml']),
        ('share/robopay_bridge/config', ['config/warehouse.yaml']),
    ],
    install_requires=['setuptools', 'web3>=7', 'pyyaml', 'requests'],
    entry_points={'console_scripts': ['bridge = robopay_bridge.bridge_node:main']},
)
