import 'dotenv/config';
import {HardhatUserConfig} from 'hardhat/types';
import 'hardhat-deploy';
import '@nomiclabs/hardhat-ethers';
import 'hardhat-gas-reporter';
import '@typechain/hardhat';
import 'hardhat-contract-sizer';
import "solidity-coverage";
import "hardhat-tracer";
import "@openzeppelin/hardhat-upgrades";
import { task } from 'hardhat/config'

import {node_url, accounts} from './utils/network';

if (process.env.HARDHAT_FORK) {
  process.env['HARDHAT_DEPLOY_FORK'] = process.env.HARDHAT_FORK;
}

const config: HardhatUserConfig = {
  solidity: {
    compilers: [
      {
        version: '0.8.17',
        settings: {
          optimizer: {
            enabled: true,
            runs: 200
          },
        }
      }
    ]
  },
  namedAccounts: {
    deployer: 0,
    simpleERC20Beneficiary: 1,
  },
  networks: {
    hardhat: {
      initialBaseFeePerGas: 0,
      allowUnlimitedContractSize: true,
      initialDate: "1970-01-01T02:00:00+00:00",
      accounts: accounts(process.env.HARDHAT_FORK),
      tags: ["local", "test"],
      forking: process.env.HARDHAT_FORK
        ? {
            url: node_url(process.env.HARDHAT_FORK),
            blockNumber: process.env.HARDHAT_FORK_NUMBER
              ? parseInt(process.env.HARDHAT_FORK_NUMBER)
              : undefined,
          }
        : undefined,
    },
    localhost: {
      url: node_url('localhost'),
      accounts: accounts(),
    },
    staging: {
      url: node_url('rinkeby'),
      accounts: accounts('rinkeby'),
    },
    production: {
      url: node_url('mainnet'),
      accounts: accounts('mainnet'),
    },
    mainnet: {
      url: node_url('mainnet'),
      accounts: accounts('mainnet'),
    },
    rinkeby: {
      url: node_url('rinkeby'),
      accounts: accounts('rinkeby'),
    },
    kovan: {
      url: node_url('kovan'),
      accounts: accounts('kovan'),
    },
    goerli: {
      url: node_url('goerli'),
      accounts: accounts('goerli'),
    },
    fuji: {
      url: node_url('fuji'),
      accounts: accounts('fuji'),
      tags: ["testnet"]
    },
    arbrinkeby: {
      url: node_url('arbrinkeby'),
      accounts: accounts('arbrinkeby'),
      tags: ["testnet"]
    },
    mumbai: {
      url: node_url('mumbai'),
      accounts: accounts('mumbai'),
      tags: ["testnet"],
      gas: 5100000,
      gasPrice: 8000000000
    },
    solana: {
      url: node_url('solana'),
      accounts: accounts('solana'),
      tags: ["testnet"],
    },
  },
  typechain: {
    outDir: 'typechain',
    target: 'ethers-v5'
  },
  gasReporter: {
    currency: 'USD',
    enabled: true,
    maxMethodDiff: 10,
  },
  mocha: {
    timeout: 0,
  }
};

export default config;
