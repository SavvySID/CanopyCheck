require("@nomicfoundation/hardhat-chai-matchers");
require("@nomicfoundation/hardhat-ethers");

const { PRIVATE_KEY, RPC_URL } = process.env;

module.exports = {
  solidity: {
    version: "0.8.28",
    settings: { optimizer: { enabled: true, runs: 200 }, evmVersion: "cancun", viaIR: true },
  },
  networks: {
    ...(RPC_URL && PRIVATE_KEY ? { testnet: { url: RPC_URL, accounts: [PRIVATE_KEY] } } : {}),
  },
};
