const { buildModule } = require("@nomicfoundation/hardhat-ignition/modules");
const { ethers } = require("ethers");

module.exports = buildModule("SettlX", (m) => {
  const USDC_ADDRESS = "0x50834F3163758fcC1Df9973b6e91f0F0F0434aD3";

  const settlX = m.contract("SettlX", [USDC_ADDRESS]);
  return { settlX };
});
