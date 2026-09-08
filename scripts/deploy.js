const { ethers } = require("hardhat");

async function main() {
  const [deployer] = await ethers.getSigners();
  const network = await ethers.provider.getNetwork();

  console.log("─────────────────────────────────────────────");
  console.log("  Deploying BOTTimelockVault");
  console.log("─────────────────────────────────────────────");
  console.log("  Network:  ", network.name, "(chainId", network.chainId + ")");
  console.log("  Deployer: ", deployer.address);

  const balance = await ethers.provider.getBalance(deployer.address);
  console.log("  Balance:  ", ethers.formatEther(balance), "BOT");

  if (balance === 0n) {
    throw new Error("Deployer has 0 BOT. Fund it from the faucet first (https://faucet.botchain.ai).");
  }

  const Factory = await ethers.getContractFactory("BOTTimelockVault");
  const vault = await Factory.deploy();
  await vault.waitForDeployment();

  const addr = await vault.getAddress();
  console.log("─────────────────────────────────────────────");
  console.log("  ✅ BOTTimelockVault deployed to:", addr);
  console.log("─────────────────────────────────────────────");
  console.log("  Next step:");
  console.log("  → Update CONTRACT_ADDRESS in frontend/index.html with this address.");
  console.log("─────────────────────────────────────────────");
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
