const { buildModule } = require("@nomicfoundation/hardhat-ignition/modules");
const { ethers } = require("ethers");

module.exports = buildModule("SettlX", (m) => {
  const USDC_ADDRESS = "0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d";

  const settlX = m.contract("SettlX", [USDC_ADDRESS]);
  return { settlX };
});
