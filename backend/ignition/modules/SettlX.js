const { buildModule } = require("@nomicfoundation/hardhat-ignition/modules");
const { ethers } = require("ethers");

module.exports = buildModule("SettlX", (m) => {
  const USDC_ADDRESS = "0xaf88d065e77c8cC2239327C5EDb3A432268e5831";

  const settlX = m.contract("SettlX", [USDC_ADDRESS]);
  return { settlX };
});
