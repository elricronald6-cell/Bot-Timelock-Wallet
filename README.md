# BOT Timelock Vault

Self-custody timelock vault DApp on BOT Chain. Deposit BOT with an unlock date; only the depositor can withdraw, and only after unlock. No admin key can move user funds under normal operation.

## Contract surface

- `deposit(uint256 unlockTime) payable` — lock `msg.value` until `unlockTime` (max 10 years out)
- `withdraw(uint256 depositIndex)` — reclaim a specific deposit after unlock
- `getDeposit(address, uint256) view` → `(amount, unlockTime, withdrawn)`
- `getDepositCount(address) view` → `uint256`
- `getTotalLocked() view` → `uint256` (contract-wide)
- Admin: `pause() / unpause()`
- Escape hatch: `emergencyWithdraw(address[])` — only while paused, returns funds to rightful owners regardless of unlock (never to admin)

Events: `Deposited(user, amount, unlockTime, index)`, `Withdrawn(user, amount, index)`, `EmergencyWithdrawn(user, amount, depositCount)`.

## Quick start

```bash
npm install
cp .env.example .env               # add your PRIVATE_KEY
npx hardhat test                   # 15 tests
npm run deploy:testnet             # deploys to BOT Chain Testnet
```

After deploy, paste the printed address into `frontend/index.html` at `CONTRACT_ADDRESS`, commit, and Vercel/Netlify auto-redeploys.

## BOT Chain networks

| | Testnet | Mainnet |
|---|---|---|
| Chain ID | 968 (0x3C8) | 677 (0x2A5) |
| RPC | https://rpc.bohr.life | https://rpc.botchain.ai |
| Explorer | https://scan.bohr.life | https://scan.botchain.ai |
| Faucet | https://faucet.botchain.ai | — |
| Hardhat network name | `botchain_testnet` | `botchain` |

## Testnet → Mainnet swap in `frontend/index.html`

Five values in the `BOT_CHAIN` object + `CONTRACT_ADDRESS`:

```js
const BOT_CHAIN = {
  chainId: "0x2A5",
  chainName: "BOT Chain",
  nativeCurrency: { name: "BOT", symbol: "BOT", decimals: 18 },
  rpcUrls: ["https://rpc.botchain.ai"],
  blockExplorerUrls: ["https://scan.botchain.ai/"]
};
const CONTRACT_ADDRESS = "0x<mainnet-address>";
```

## Security notes

- `emergencyWithdraw` **cannot** send funds anywhere except the depositor. The admin can only trigger the return, not redirect it.
- `pause()` only blocks new deposits — withdrawals of already-unlocked deposits keep working.
- Max lock horizon is 10 years (`MAX_LOCK_SECONDS`) to prevent typos.
- ReentrancyGuard on `deposit` / `withdraw` / `emergencyWithdraw`.

## Project structure

```
bot-timelock-wallet/
├── contracts/BOTTimelockVault.sol
├── test/BOTTimelockVault.test.js
├── scripts/deploy.js
├── frontend/index.html              # your uploaded frontend, unchanged
├── hardhat.config.js
├── package.json
├── vercel.json
├── .env.example
├── .gitignore
└── README.md
```
