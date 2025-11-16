# IntentSwaps Resolver

Automated resolver service for the IntentSwaps cross-chain atomic swap protocol.

## Overview

The resolver monitors the IntentSwaps canister for new swap orders and automatically fulfills profitable orders by:
1. Detecting orders with creator deposits confirmed
2. Accepting the order and receiving canister addresses
3. Depositing the required funds to the canister
4. Monitoring the order until completion
5. Receiving funds when the creator reveals the secret

## Setup

### 1. Install Dependencies

```bash
npm install
```

### 2. Configure Environment Variables

Create a `.env` file in the resolver directory:

```env
# Canister Configuration
CANISTER_ID=uxrrr-q7777-77774-qaaaq-cai
IC_HOST=http://127.0.0.1:4943

# Polling Configuration
POLL_INTERVAL=10000  # 10 seconds

# Bitcoin Configuration
BITCOIN_NETWORK=testnet
BTC_PRIVATE_KEY=your_btc_private_key_in_WIF_format

# Solana Configuration
SOLANA_RPC=https://api.devnet.solana.com
SOL_PRIVATE_KEY=your_sol_private_key_base58

# Resolver Settings
MIN_PROFIT_MARGIN=0.5
MAX_BTC_AMOUNT=100000000    # 1 BTC in satoshis
MAX_SOL_AMOUNT=100000000000 # 100 SOL in lamports
```

### 3. Private Key Formats

**Bitcoin (WIF format):**
- Testnet: Starts with `c` (e.g., `cVt4o7BGAig1UXywgGSmARhxMdzP5qvQsxKkSsc1XEkw3tDTQFpy`)
- Mainnet: Starts with `K` or `L`
- Generate: Use `bitcoin-cli` or `bitcoinjs-lib`

**Solana:**
Supports multiple formats:
1. Base58 string (87-88 chars) - from Phantom wallet
2. JSON array format - from `~/.config/solana/id.json`
3. Comma-separated numbers
4. Hex string (128 chars)

## Usage

```bash
npm start
```

For development with auto-reload:
```bash
npm run dev
```

## API Endpoints

- `GET /health` - Resolver status, wallet balances, and active orders
- `GET /balances` - Detailed wallet balances
- `GET /orders/pending` - All pending orders from the canister
- `GET /orders/processed` - Orders processed by this resolver
- `POST /orders/:orderId/accept` - Manually accept a specific order
- `GET /config` - View resolver configuration
- `POST /config` - Update resolver configuration

## Order Processing Flow

1. **Detection**: Resolver polls `get_pending_orders()` every 10 seconds
2. **Filter**: Only processes orders with status `DepositReceived` (creator has deposited)
3. **Validation**: Checks if resolver has required wallet and sufficient balance
4. **Accept**: Calls `accept_order()` with resolver's wallet addresses
5. **Deposit**: Sends required funds to canister addresses
6. **Confirm**: Calls `confirm_resolver_deposit()` with transaction ID
7. **Monitor**: Tracks order status until completion
8. **Complete**: When creator reveals secret, order becomes `Completed` and resolver receives funds

## Order Status Flow

```
AwaitingDeposit
    ↓ (creator deposits)
DepositReceived
    ↓ (resolver accepts) → RESOLVER PROCESSES HERE
ResolverDeposited
    ↓ (creator reveals secret)
Completed → RESOLVER RECEIVES FUNDS
```

## Monitoring

The resolver actively monitors orders it has accepted:
- Tracks status changes in real-time
- Logs when orders complete
- Notifies when funds are received
- Detects cancellations/expirations and expects automatic refunds

## Development

### Update Canister Interface

When the canister interface changes:

```bash
cd ../icp
dfx generate intentswaps_backend
cd ../resolver
cp -r ../icp/src/declarations/intentswaps_backend ./declarations/
```

### Test Locally

1. Start local IC replica: `cd ../icp && dfx start --background && dfx deploy`
2. Start resolver: `cd ../resolver && npm start`
3. Create test order (from frontend or CLI)
4. Monitor resolver logs for processing
