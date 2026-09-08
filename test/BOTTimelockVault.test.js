const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

describe("BOTTimelockVault", function () {
  let vault, owner, alice, bob, carol;

  beforeEach(async function () {
    [owner, alice, bob, carol] = await ethers.getSigners();
    const V = await ethers.getContractFactory("BOTTimelockVault");
    vault = await V.deploy();
    await vault.waitForDeployment();
  });

  async function futureTime(secs) {
    return (await time.latest()) + secs;
  }

  describe("deposit", function () {
    it("stores a new deposit and increments totalLocked", async function () {
      const t = await futureTime(3600);
      await expect(
        vault.connect(alice).deposit(t, { value: ethers.parseEther("1") })
      )
        .to.emit(vault, "Deposited")
        .withArgs(alice.address, ethers.parseEther("1"), t, 0);

      const d = await vault.getDeposit(alice.address, 0);
      expect(d.amount).to.equal(ethers.parseEther("1"));
      expect(d.unlockTime).to.equal(t);
      expect(d.withdrawn).to.equal(false);
      expect(await vault.getTotalLocked()).to.equal(ethers.parseEther("1"));
    });

    it("rejects zero-value deposit", async function () {
      const t = await futureTime(3600);
      await expect(
        vault.connect(alice).deposit(t, { value: 0 })
      ).to.be.revertedWith("Amount must be > 0");
    });

    it("rejects past unlockTime", async function () {
      const t = (await time.latest()) - 10;
      await expect(
        vault.connect(alice).deposit(t, { value: ethers.parseEther("1") })
      ).to.be.revertedWith("Unlock must be in future");
    });

    it("rejects unlockTime beyond MAX_LOCK_SECONDS (>10 years)", async function () {
      const t = (await time.latest()) + 365 * 24 * 3600 * 11;
      await expect(
        vault.connect(alice).deposit(t, { value: ethers.parseEther("1") })
      ).to.be.revertedWith("Unlock too far ahead");
    });

    it("allows multiple independent deposits per user", async function () {
      const t1 = await futureTime(3600);
      const t2 = await futureTime(7200);
      await vault.connect(alice).deposit(t1, { value: ethers.parseEther("1") });
      await vault.connect(alice).deposit(t2, { value: ethers.parseEther("2") });
      expect(await vault.getDepositCount(alice.address)).to.equal(2);
      expect(await vault.getTotalLocked()).to.equal(ethers.parseEther("3"));
    });
  });

  describe("withdraw", function () {
    it("reverts if still locked", async function () {
      const t = await futureTime(3600);
      await vault.connect(alice).deposit(t, { value: ethers.parseEther("1") });
      await expect(vault.connect(alice).withdraw(0)).to.be.revertedWith("Still locked");
    });

    it("succeeds after unlockTime and pays exactly", async function () {
      const t = await futureTime(3600);
      await vault.connect(alice).deposit(t, { value: ethers.parseEther("1") });
      await time.increaseTo(t + 1);

      const before = await ethers.provider.getBalance(alice.address);
      const tx = await vault.connect(alice).withdraw(0);
      const receipt = await tx.wait();
      const gas = receipt.gasUsed * receipt.gasPrice;
      const after = await ethers.provider.getBalance(alice.address);

      expect(after - before + gas).to.equal(ethers.parseEther("1"));
      expect(await vault.getTotalLocked()).to.equal(0);

      const d = await vault.getDeposit(alice.address, 0);
      expect(d.withdrawn).to.equal(true);
    });

    it("rejects invalid deposit index", async function () {
      await expect(vault.connect(alice).withdraw(0)).to.be.revertedWith("Invalid deposit index");
    });

    it("rejects double withdraw", async function () {
      const t = await futureTime(3600);
      await vault.connect(alice).deposit(t, { value: ethers.parseEther("1") });
      await time.increaseTo(t + 1);
      await vault.connect(alice).withdraw(0);
      await expect(vault.connect(alice).withdraw(0)).to.be.revertedWith("Already withdrawn");
    });

    it("does not let one user withdraw another user's deposit", async function () {
      const t = await futureTime(3600);
      await vault.connect(alice).deposit(t, { value: ethers.parseEther("1") });
      await time.increaseTo(t + 1);
      // Bob has no deposits at index 0 → invalid index
      await expect(vault.connect(bob).withdraw(0)).to.be.revertedWith("Invalid deposit index");
    });
  });

  describe("pause / unpause", function () {
    it("only owner can pause / unpause", async function () {
      await expect(vault.connect(alice).pause()).to.be.reverted;
      await vault.pause();
      await expect(vault.connect(alice).unpause()).to.be.reverted;
      await vault.unpause();
    });

    it("blocks deposits while paused; still allows withdraws after unlock", async function () {
      const t = await futureTime(3600);
      await vault.connect(alice).deposit(t, { value: ethers.parseEther("1") });
      await vault.pause();

      const t2 = await futureTime(3600);
      await expect(
        vault.connect(bob).deposit(t2, { value: ethers.parseEther("1") })
      ).to.be.reverted;

      await time.increaseTo(t + 1);
      await vault.connect(alice).withdraw(0); // still works
    });
  });

  describe("emergencyWithdraw", function () {
    it("reverts when not paused", async function () {
      await expect(vault.emergencyWithdraw([alice.address])).to.be.reverted;
    });

    it("only owner can call", async function () {
      await vault.pause();
      await expect(vault.connect(alice).emergencyWithdraw([alice.address])).to.be.reverted;
    });

    it("returns all non-withdrawn funds to rightful owners regardless of unlock", async function () {
      const t = await futureTime(365 * 24 * 3600); // 1 year lock
      await vault.connect(alice).deposit(t, { value: ethers.parseEther("2") });
      await vault.connect(bob).deposit(t, { value: ethers.parseEther("3") });

      await vault.pause();

      const aliceBefore = await ethers.provider.getBalance(alice.address);
      const bobBefore = await ethers.provider.getBalance(bob.address);

      await vault.emergencyWithdraw([alice.address, bob.address]);

      const aliceAfter = await ethers.provider.getBalance(alice.address);
      const bobAfter = await ethers.provider.getBalance(bob.address);

      expect(aliceAfter - aliceBefore).to.equal(ethers.parseEther("2"));
      expect(bobAfter - bobBefore).to.equal(ethers.parseEther("3"));
      expect(await vault.getTotalLocked()).to.equal(0);

      // both deposits marked withdrawn
      expect((await vault.getDeposit(alice.address, 0)).withdrawn).to.equal(true);
      expect((await vault.getDeposit(bob.address, 0)).withdrawn).to.equal(true);
    });

    it("skips users with no non-withdrawn deposits without reverting", async function () {
      await vault.pause();
      await vault.emergencyWithdraw([carol.address]); // no deposits — no-op
      expect(await vault.getTotalLocked()).to.equal(0);
    });
  });

  describe("view helpers", function () {
    it("getDepositCount reflects growth", async function () {
      expect(await vault.getDepositCount(alice.address)).to.equal(0);
      const t = await futureTime(3600);
      await vault.connect(alice).deposit(t, { value: ethers.parseEther("1") });
      expect(await vault.getDepositCount(alice.address)).to.equal(1);
    });

    it("getDeposit reverts on invalid index", async function () {
      await expect(vault.getDeposit(alice.address, 99)).to.be.revertedWith("Invalid deposit index");
    });
  });
});
