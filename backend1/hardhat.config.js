require("@nomicfoundation/hardhat-toolbox");
require("dotenv").config();

/** @type import('hardhat/config').HardhatUserConfig */
module.exports = {
  solidity: {
    version: "0.8.28",
    settings: {
      optimizer: {
        enabled: true,
        runs: 200,
      },
      viaIR: true, // Enable IR-based compilation to fix "Stack Too Deep"
    },
  },
  networks: {
    arbitrum_sepolia: {
      url: `https://sepolia-rollup.arbitrum.io/rpc`,
      accounts: [process.env.PRIVATE_KEY],
      chainId: 421614,
    },
  },
};
