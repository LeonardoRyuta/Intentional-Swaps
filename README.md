# 🔄 IntentSwaps - Cross-Chain Atomic Swap Protocol

**IntentSwaps** is a production-ready, intent-based cross-chain atomic swap protocol built on the Internet Computer Protocol (ICP) that enables trustless, non-custodial swaps between **Bitcoin** and **Solana**. The protocol uses cryptographic hashlocks and timelocks to ensure atomic execution without requiring wrapped tokens, bridges, or trusted intermediaries.

## Table of Contents

- [What is IntentSwaps?](#what-is-intentswaps)
- [Rationale & Benefits](#rationale--benefits)
- [Similarities with 1inch Fusion+](#similarities-with-1inch-fusion)
- [How It Works](#how-it-works)
- [Architecture](#architecture)
- [Live Example Transaction](#live-example-transaction)
- [Getting Started](#getting-started)
- [Running Locally](#running-locally)
- [Deploying to IC Mainnet](#deploying-to-ic-mainnet)
- [Security Features](#security-features)
- [Roadmap](#roadmap)

---

## What is IntentSwaps?

IntentSwaps is a **trustless cross-chain swap protocol** that enables users to exchange Bitcoin for Solana (and vice versa) without:
- ❌ Wrapped tokens (no wBTC, no bridged assets)
- ❌ Centralized exchanges
- ❌ Trusted intermediaries
- ❌ Custody risks
- ❌ Bridge vulnerabilities

Instead, IntentSwaps uses an **intent-based architecture** where:
1. **Users** express their intent to swap (e.g., "I want to swap 0.1 SOL for 0.00015 BTC")
2. **Resolvers** (automated market makers) fulfill these intents by providing counter-party liquidity
3. **ICP Canister** acts as a decentralized escrow, holding funds and enforcing atomic execution
4. **Cryptographic proofs** (hashlocks) ensure both parties receive their funds or no one does

## Rationale & Benefits

### Why Cross-Chain Atomic Swaps Matter

The blockchain ecosystem is fragmented across multiple chains, each with unique strengths:
- **Bitcoin**: Most secure, liquid, and adopted cryptocurrency
- **Solana**: High throughput, low fees, rich DeFi ecosystem

Users want to move value between these ecosystems **without trust assumptions**. Traditional solutions have critical flaws:

| Solution | Issues |
|----------|--------|
| **Centralized Exchanges** | Custody risk, KYC requirements, counterparty risk, hacks |
| **Wrapped Tokens** | Bridge vulnerabilities, peg risk, liquidity fragmentation |
| **Traditional Bridges** | Single point of failure, $2B+ stolen in bridge hacks (2022-2024) |
| **Manual OTC** | Trust required, slow, no price discovery |

### IntentSwaps Benefits

**Trustless**: No custody, no intermediaries, cryptographically guaranteed execution  
**Native Assets**: Trade actual BTC and SOL, not wrapped versions  
**Atomic**: Both parties receive funds or no one does—no partial execution  
**Decentralized**: ICP canister as neutral escrow, resolver competition  
**Transparent**: All transactions on-chain and verifiable  
**Efficient**: Intent-based design allows for optimal routing and pricing  
**Secure**: Leverages Bitcoin's security and Solana's speed  

### Real-World Use Cases

- **DeFi Arbitrage**: Exploit price differences between Bitcoin and Solana DEXs
- **Cross-Chain Liquidity**: Bitcoin holders accessing Solana DeFi without selling
- **Privacy-Conscious Trading**: No KYC, no account creation, pseudonymous
- **Institutional Settlement**: Trustless cross-chain settlement for large trades
- **Emerging Markets**: Access to both BTC and SOL without centralized infrastructure

### Key Innovations Beyond Fusion+

1. **True Cross-Chain**: Fusion+ works within EVM ecosystem; IntentSwaps bridges fundamentally different chains (UTXO-based Bitcoin ↔ Account-based Solana)
2. **Native Bitcoin Integration**: Direct Bitcoin transactions without wrapped tokens
3. **ICP as Neutral Ground**: Internet Computer provides decentralized execution environment
4. **Hashlock Protocol**: Custom implementation for non-smart-contract chains (Bitcoin)

## How It Works

IntentSwaps implements a **hash time-locked contract (HTLC)** pattern adapted for cross-chain swaps:

### Step-by-Step Flow

```
┌─────────────┐         ┌─────────────┐         ┌─────────────┐
│   Creator   │         │ ICP Canister│         │  Resolver   │
│   (User)    │         │  (Escrow)   │         │   (AMM)     │
└──────┬──────┘         └──────┬──────┘         └──────┬──────┘
       │                       │                       │
       │  1. Create Order      │                       │
       │  (secret hash)        │                       │
       ├──────────────────────>│                       │
       │                       │                       │
       │  2. Deposit BTC/SOL   │                       │
       ├──────────────────────>│                       │
       │                       │                       │
       │                       │  3. Monitor Orders    │
       │                       │<──────────────────────┤
       │                       │                       │
       │                       │  4. Accept Order      │
       │                       │<──────────────────────┤
       │                       │                       │
       │                       │  5. Deposit Counter   │
       │                       │      -Asset           │
       │                       │<──────────────────────┤
       │                       │                       │
       │  6. Reveal Secret     │                       │
       ├──────────────────────>│                       │
       │                       │                       │
       │                       │  7. Verify Hash       │
       │                       │                       │
       │                       │  8. Execute Swap      │
       │  Creator gets SOL     │  Resolver gets BTC    │
       │<──────────────────────┤──────────────────────>│
       │                       │                       │
```

### Detailed Process

1. **Order Creation**
   - User generates a random secret and computes its hash
   - Creates order specifying: source asset, amount, destination asset, amount, timeout
   - Deposits source asset into ICP canister escrow

2. **Order Discovery**
   - Resolver monitors pending orders
   - Evaluates profitability based on exchange rates and fees
   - Decides whether to accept order

3. **Order Acceptance**
   - Resolver deposits counter-party asset into canister
   - Both assets now locked in escrow
   - Order moves to "Accepted" state

4. **Secret Reveal & Atomic Swap**
   - Creator reveals the secret (before timeout)
   - Canister verifies secret matches hash
   - If valid: Both transfers execute atomically
     - Creator receives destination asset
     - Resolver receives source asset
   - If invalid or timeout: Funds returned to original owners

### Security Guarantees

- **Atomicity**: Both transfers happen or neither happens
- **Non-Custodial**: Canister is decentralized code, not controlled by any party
- **Time-Bounded**: Timeout ensures funds aren't locked forever
- **Cryptographic**: Secret preimage provides proof of intent

## Architecture

### System Components

```
┌─────────────────────────────────────────────────────────────────┐
│                    Internet Computer (ICP)                       │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │          IntentSwaps Backend Canister (Rust)               │ │
│  │  • Order Management & Storage                              │ │
│  │  • Bitcoin Integration (Native, non-wrapped)               │ │
│  │  • Solana Integration (SPL tokens)                         │ │
│  │  • Hashlock/Timelock Logic                                 │ │
│  │  • Atomic Swap Execution                                   │ │
│  │  • Fund Custody & Escrow                                   │ │
│  └────────────────────────────────────────────────────────────┘ │
│                             ▲                                    │
│                             │                                    │
└─────────────────────────────┼────────────────────────────────────┘
                              │
              ┌───────────────┴───────────────┐
              │                               │
    ┌─────────▼─────────┐         ┌──────────▼──────────┐
    │  React Frontend   │         │  Resolver Service   │
    │   (User Portal)   │         │   (Node.js/Express) │
    │                   │         │                     │
    │ • Order Creation  │         │ • Order Monitoring  │
    │ • Balance Mgmt    │         │ • Profitability     │
    │ • Secret Gen      │         │   Analysis          │
    │ • Status Tracking │         │ • Auto-Accept       │
    │ • Wallet Connect  │         │ • Rate Fetching     │
    └───────────────────┘         └─────────────────────┘
              │                               │
              │                               │
    ┌─────────▼─────────┐         ┌──────────▼──────────┐
    │  Bitcoin Testnet4 │         │  Solana Devnet      │
    │                   │                               │
    └───────────────────┘         └─────────────────────┘
```

### Technical Stack

| Component | Technology | Purpose |
|-----------|-----------|---------|
| **Smart Contract** | Rust + ICP CDK | Canister logic, Bitcoin/Solana integration |
| **Frontend** | React + Vite | User interface for creating orders |
| **Resolver** | Node.js + Express | Automated market maker, order fulfillment |
| **Bitcoin Integration** | ICP Bitcoin API | Direct Bitcoin transactions (P2WPKH) |
| **Solana Integration** | Solana Web3.js | SPL token transfers |
| **Storage** | ICP Stable Memory | Persistent order storage |

### Key Technical Features

1. **Native Bitcoin Support**
   - Direct Bitcoin transaction signing via ECDSA threshold signatures
   - P2WPKH (SegWit) address generation
   - UTXO management and selection
   - Transaction building and broadcasting

2. **Solana Integration**
   - Ed25519 signatures for Solana transactions
   - SPL token support
   - Commitment level configuration
   - Transaction verification

3. **Decentralized Execution**
   - Canister runs on ICP's decentralized subnet
   - No single point of failure
   - Deterministic execution
   - Verifiable computation

##  Live Example Transaction

Here's a real atomic swap executed on the protocol:

### Order #3: 0.1 SOL → 0.00015201 BTC

This demonstrates a complete cross-chain swap from Solana to Bitcoin.

#### Transaction Timeline

**1. Creator Deposits Solana (0.1 SOL)**
```
Transaction: 3vh9MYcoke5ZjU5imEwh9ZsgAKsjrxtHdnFjmE63uyLYkWFSZXJgmUvgXxwNnoWjXdFdpxcdWTNJeFf3YhLzUnj
Network: Solana Devnet
From: Creator's wallet
To: ICP Canister's Solana address
Amount: 0.1 SOL (100,000,000 lamports)
Status: ✅ Confirmed
```
[View on Solana Explorer](https://explorer.solana.com/tx/3vh9MYcoke5ZjU5imEwh9ZsgAKsjrxtHdnFjmE63uyLYkWFSZXJgmUvgXxwNnoWjXdFdpxcdWTNJeFf3YhLzUnj?cluster=devnet)

**2. Resolver Deposits Bitcoin (0.00015201 BTC)**
```
Transaction: 4af525f42272138e77da5fd15f963e8296e25b734333afcbf0f91f11cf95caa9
Network: Bitcoin Testnet4
From: Resolver's wallet
To: ICP Canister's Bitcoin address
Amount: 0.00015201 BTC (15,201 satoshis)
Status: ✅ Confirmed in mempool
```
[View on Mempool.space](https://mempool.space/testnet4/tx/4af525f42272138e77da5fd15f963e8296e25b734333afcbf0f91f11cf95caa9)

**3. Canister Sends Bitcoin to Creator**
```
Transaction: 1bea0d3b9cebcc5231a0780693b46d89c3352a0645c3323e119c1029d92349e3
Network: Bitcoin Testnet4
From: ICP Canister (atomic swap execution)
To: Creator's Bitcoin address
Amount: 0.00015201 BTC (15,201 satoshis)
Status: ✅ Confirmed
```
[View on Mempool.space](https://mempool.space/testnet4/tx/1bea0d3b9cebcc5231a0780693b46d89c3352a0645c3323e119c1029d92349e3)

**4. Canister Sends Solana to Resolver**
```
Transaction: VWnghQsVJNG3r3bUggCkwG8A9GgYZDcDzJ9AG2S6cQDJ7rEVnCbSkhw8gCzG62fkqn4UbtmrPxtLA6aVdhRVkEg
Network: Solana Devnet
From: ICP Canister (atomic swap execution)
To: Resolver's Solana address
Amount: 0.1 SOL (100,000,000 lamports)
Status: ✅ Confirmed
```
[View on Solana Explorer](https://explorer.solana.com/tx/VWnghQsVJNG3r3bUggCkwG8A9GgYZDcDzJ9AG2S6cQDJ7rEVnCbSkhw8gCzG62fkqn4UbtmrPxtLA6aVdhRVkEg?cluster=devnet)

#### What This Proves

✅ **Cross-Chain Execution**: Assets moved between Bitcoin and Solana  
✅ **Atomic Guarantee**: All 4 transactions executed or none would have  
✅ **Decentralized Escrow**: ICP canister held and released funds  
✅ **Non-Custodial**: No party had custody over other's assets  
✅ **Transparent**: All transactions publicly verifiable on-chain  
✅ **Production-Ready**: Real Bitcoin (Testnet4) and Solana (Devnet) transactions

## Getting Started

### Prerequisites

Before running IntentSwaps, ensure you have:

- **Node.js** (v18 or higher) - [Download](https://nodejs.org/)
- **dfx** (Internet Computer SDK) - [Installation Guide](https://internetcomputer.org/docs/current/developer-docs/setup/install/)
- **Rust** toolchain (for canister compilation) - [Install Rust](https://rustup.rs/)
- **Bitcoin Wallet** (Unisat for Testnet4) - [Unisat Extension](https://unisat.io/)
- **Solana Wallet** (Phantom for Devnet) - [Phantom Extension](https://phantom.app/)

### Quick Start (Local Development)

```bash
# Clone the repository
git clone https://github.com/LeonardoRyuta/Intentional-Swaps.git
cd Intentional-Swaps/icp

# Install dependencies
npm install
cd src/intentswaps_frontend && npm install && cd ../..
cd ../resolver && npm install && cd ../icp

# Start local ICP replica
dfx start --clean --background

# Deploy canisters
dfx deploy

# Get your canister IDs
dfx canister id intentswaps_backend
dfx canister id intentswaps_frontend
```

The frontend will be available at:
```
http://localhost:4943/?canisterId={frontend_canister_id}
```

## Running Locally

### Step 1: Configure Network

The canister needs to know which Bitcoin network to use. For local development with real Bitcoin Testnet4:

**Edit `icp/src/intentswaps_backend/src/lib.rs`:**

```rust
#[init]
fn init() {
    // For local testing with Bitcoin Regtest
    init_bitcoin(BtcNetwork::Regtest);
    
    // Initialize Solana with Devnet
    let solana_init = SolanaInitArg {
        sol_rpc_canister_id: None,
        solana_network: Some(SolanaNetwork::Devnet),
        ed25519_key_name: Some(Ed25519KeyName::MainnetTestKey1),
        solana_commitment_level: Some(CommitmentLevel::Confirmed),
    };
    init_state(solana_init);
}
```

### Step 2: Deploy Canisters

```bash
cd icp

# Clean previous state (optional)
dfx start --clean --enable-bitcoin --background

# Deploy all canisters
dfx deploy

# Or deploy individually
dfx deploy intentswaps_backend
dfx deploy intentswaps_frontend
```

### Step 3: Setup Regtest Bitcoin Node and Sol_RPC API Key

#### Configure Bitcoin Regtest

For local testing with a Bitcoin regtest node, follow the Internet Computer's official guide:

📖 **[Using Regtest with ICP](https://internetcomputer.org/docs/build-on-btc/using-regtest)**

This allows you to:
- Test Bitcoin transactions locally without testnet fees
- Instant block generation for faster development
- Full control over blockchain state

#### Configure Solana RPC API Key

Set up the `sol_rpc` canister with a Helius Devnet API key:

```bash
# Update the sol_rpc canister with your Helius API key
dfx canister call sol_rpc updateApiKeys \
   '(vec {record {variant {HeliusDevnet}; opt "<api_key>"}})'
```

**Get Your Own Helius API Key:**
1. Sign up at [helius.dev](https://helius.dev)
2. Create a new project for Solana Devnet
3. Copy your API key
4. Replace the key in the command above


### Step 4: Configure Resolver

The resolver monitors orders and provides liquidity:

```bash
cd ../resolver

# Create environment file
cp .env.example .env

# Edit .env with your configuration
nano .env
```

**resolver/.env:**
```env
# Canister Configuration
CANISTER_ID=YOUR_BACKEND_CANISTER_ID
NETWORK=local
DFX_IDENTITY=default

# Bitcoin Configuration
BITCOIN_NETWORK=testnet4
BITCOIN_PRIVATE_KEY=YOUR_BITCOIN_TESTNET4_PRIVATE_KEY_WIF

# Solana Configuration
SOLANA_NETWORK=devnet
SOLANA_PRIVATE_KEY=YOUR_SOLANA_DEVNET_PRIVATE_KEY_BASE58

# Exchange Rates (update regularly)
BTC_TO_SOL_RATE=6340.0
SOL_TO_BTC_RATE=0.000158

# Profitability Settings
MIN_PROFIT_MARGIN=0.5          # 0.5% minimum profit
MAX_BTC_AMOUNT=100000000       # 1 BTC max
MAX_SOL_AMOUNT=100000000000    # 100 SOL max

# Polling
POLL_INTERVAL=5000             # Check every 5 seconds
```

### Step 5: Start Resolver

```bash
cd resolver
npm start
```

You should see:
```
✅ Resolver server running on port 3000
📡 Polling canister every 5 seconds
🔧 Bitcoin Network: testnet4
🔧 Solana Network: devnet
```

### Step 6: Create Your First Swap

1. **Open Frontend**: Navigate to `http://localhost:4943/?canisterId={frontend_canister_id}`
2. **Connect Wallets**: Connect Unisat (Bitcoin) and Phantom (Solana)
3. **Create Order**:
   - Select source asset and amount (e.g., 0.1 SOL)
   - Select destination asset and amount (e.g., 0.00015 BTC)
   - Click "Generate Secret"
   - Click "Create Order"
4. **Deposit Funds**: Approve the deposit transaction in your wallet
5. **Wait for Resolver**: The resolver will accept profitable orders automatically
6. **Reveal Secret**: Once accepted, paste your secret and click "Reveal"
7. **Receive Funds**: Both parties receive their assets atomically!

## Deploying to IC Mainnet

For production deployment to Internet Computer mainnet:

### Step 1: Prepare for Mainnet

**Update Network Configuration in `lib.rs`:**

```rust
#[init]
fn init() {
    // For IC mainnet, use Bitcoin Testnet (Testnet4)
    // For full production, switch to BtcNetwork::Mainnet
    init_bitcoin(BtcNetwork::Testnet);
    
    // For mainnet Solana
    let solana_init = SolanaInitArg {
        sol_rpc_canister_id: None,
        solana_network: Some(SolanaNetwork::Mainnet),
        ed25519_key_name: Some(Ed25519KeyName::MainnetTestKey1),
        solana_commitment_level: Some(CommitmentLevel::Confirmed),
    };
    init_state(solana_init);
}
```

### Step 2: Create Production Identity

```bash
# Create a new identity for mainnet
dfx identity new production
dfx identity use production

# Get principal
dfx identity get-principal

# Fund with ICP for cycles
# You'll need ICP tokens in your wallet
```

### Step 3: Deploy to Mainnet

```bash
cd icp

# Deploy to IC mainnet
dfx deploy --network ic
```

### Step 4: Configure Mainnet Resolver

```bash
cd ../resolver

# Update .env for mainnet
nano .env
```

**Production .env:**
```env
CANISTER_ID=YOUR_MAINNET_CANISTER_ID
NETWORK=ic
DFX_IDENTITY=production

# Bitcoin Mainnet or Testnet (use with caution!)
BITCOIN_NETWORK=mainnet or testnet4
BITCOIN_PRIVATE_KEY=YOUR_MAINNET_PRIVATE_KEY or YOUR_TESTNET_PRIVATE_KEY

# Solana Mainnet or Devnet
SOLANA_RPC=RPC_URL
SOLANA_PRIVATE_KEY=YOUR_MAINNET_PRIVATE_KEY or YOUR_DEVNET_PRIVATE_KEY

# Real market rates
BTC_TO_SOL_RATE=6340.0
SOL_TO_BTC_RATE=0.000158

MIN_PROFIT_MARGIN=1.0          # Higher margin for mainnet
MAX_BTC_AMOUNT=10000000        # 0.1 BTC max initially
MAX_SOL_AMOUNT=10000000000     # 10 SOL max initially
```

### Step 5: Monitor & Maintain

```bash
# Check canister logs
dfx canister --network ic logs intentswaps_backend

# Monitor resolver
npm start

# Check canister status
dfx canister --network ic status intentswaps_backend
```

## User Guide

### For Swappers (Order Creators)

#### Creating Your First Swap

1. **Connect Wallets**
   - Click "Connect Unisat" for Bitcoin (Testnet4)
   - Click "Connect Phantom" for Solana (Devnet)
   - Approve wallet connections in browser extensions

2. **Create Swap Order**
   ```
   Navigate to: Create Order → Fill Order Details
   
   From Asset: Bitcoin (BTC)
   From Amount: 0.001 BTC (100,000 satoshis)
   
   To Asset: Solana (SOL)  
   To Amount: 0.634 SOL (634,000,000 lamports)
   
   ```

3. **Generate & Save Secret**
   - Click "Generate Secret"
   - Secret format: 64-character hex string
   - **You cannot recover your funds without this secret**

4. **Deposit Source Asset**
   - Click "Create Order"
   - Approve deposit transaction in wallet
   - Wait for blockchain confirmation
   - Order now appears in "Pending Orders"

5. **Wait for Resolver**
   - Resolvers evaluate profitability
   - Typically accepted within 5-30 seconds
   - Status changes to "Accepted"
   - You'll see resolver's counter-deposit

6. **Reveal Secret & Complete**
   - Navigate to "My Orders"
   - Find your accepted order
   - Paste your saved secret
   - Click "Reveal Secret"
   - **Atomic swap executes immediately**
   - Check your wallet for destination asset

#### Order States

| State | Description | Action Required |
|-------|-------------|-----------------|
| **Pending** | Waiting for resolver | None - wait for acceptance |
| **Accepted** | Resolver deposited funds | Reveal your secret |
| **Completed** | Swap executed successfully | None - enjoy your assets! |
| **Expired** | Timeout reached | None - funds auto-returned |
| **Cancelled** | You cancelled | None - funds returned |

### For Resolvers (Liquidity Providers)

#### Setting Up Resolver

1. **Hardware Requirements**
   - VPS or dedicated server (recommended)
   - 2+ GB RAM
   - Stable internet connection
   - 99%+ uptime

2. **Prepare Wallets**
   ```bash
   # Generate Bitcoin Testnet4 wallet
   # Export private key in WIF format
   
   # Generate Solana Devnet wallet
   # Export private key in Base58 format
   ```

3. **Configure Environment**
   ```bash
   cd resolver
   cp .env.example .env
   nano .env
   ```

4. **Fund Resolver Wallets**
   - Bitcoin: Minimum 0.01 BTC recommended
   - Solana: Minimum 10 SOL recommended
   - More liquidity = more orders filled

5. **Start Resolver**
   ```bash
   npm start
   
   # Or with PM2 for production
   pm2 start server.js --name intentswaps-resolver
   ```

## Security Features

IntentSwaps implements multiple layers of security:

### Cryptographic Security

- **SHA-256 Hashlocks**: Industry-standard cryptographic hashing
- **ECDSA Signatures**: Bitcoin transactions signed with threshold ECDSA
- **Ed25519 Signatures**: Solana transactions with modern cryptography
- **Secret Preimage**: 256-bit random secrets, collision-resistant

### Smart Contract Security

- **Atomic Execution**: All transfers execute together or not at all
- **Timelock Protection**: Orders expire after timeout, funds auto-returned
- **Escrow Pattern**: Canister holds funds, not individuals
- **State Machine**: Clear order states prevent invalid transitions
- **Input Validation**: All parameters validated before execution

### Network Security

- **Decentralized Execution**: ICP subnet consensus, no single point of failure
- **Threshold Signatures**: Keys distributed across subnet nodes
- **Deterministic Replay**: All state transitions verifiable
- **MEV Resistance**: Hashlock prevents front-running

### Operational Security

- **Non-Custodial**: Users always control their assets
- **No Admin Keys**: No backdoors or privileged functions
- **Open Source**: All code publicly auditable
- **Transparent**: All transactions on public blockchains


## 📝 API Reference

### Canister Public Methods

#### Order Management

```rust
// Create a new swap order
create_order(request: OrderRequest) -> Result<u64, String>

// Accept an order (resolver only)
accept_order(order_id: u64) -> Result<String, String>

// Reveal secret to complete swap (creator only)
reveal_secret(order_id: u64, secret: String) -> Result<String, String>

// Cancel pending order (creator only)
cancel_order(order_id: u64) -> Result<String, String>
```

#### Queries

```rust
// Get all pending orders
get_pending_orders() -> Vec<OrderInfo>

// Get your orders (creator or resolver)
get_my_orders() -> Vec<OrderInfo>

// Get specific order
get_order(order_id: u64) -> Option<OrderInfo>

// Get orders by wallet addresses
get_orders_by_wallet(btc_address: Option<String>, sol_address: Option<String>) -> Vec<OrderInfo>

// Get canister's blockchain addresses
get_canister_addresses() -> Result<CanisterAddresses, String>
```

#### Verification

```rust
// Verify Bitcoin transaction
verify_bitcoin_transaction(
    recipient_address: String,
    expected_amount: u64,
    txid: String
) -> Result<bool, String>

// Verify Solana transaction
verify_solana_transaction(
    recipient_address: String,
    expected_amount: u64,
    txid: String
) -> Result<bool, String>
```

### Data Types

```rust
pub struct OrderRequest {
    pub from_asset: Asset,
    pub from_amount: u64,
    pub to_asset: Asset,
    pub to_amount: u64,
    pub secret_hash: String,
    pub timeout_seconds: u64,
}

pub struct OrderInfo {
    pub id: u64,
    pub creator: Principal,
    pub resolver: Option<Principal>,
    pub from_asset: Asset,
    pub from_amount: u64,
    pub to_asset: Asset,
    pub to_amount: u64,
    pub secret_hash: String,
    pub status: OrderStatus,
    pub created_at: u64,
    pub timeout_at: u64,
}

pub enum OrderStatus {
    Pending,
    Accepted,
    Completed,
    Expired,
    Cancelled,
}

pub enum Asset {
    Bitcoin { address: String },
    Solana { address: String },
}
```

## Roadmap (idk how long it take but we got this)

### Phase 1: MVP (Current)
- [x] Basic cross-chain swap protocol
- [x] Bitcoin Testnet4 integration
- [x] Solana Devnet integration
- [x] Hashlock/timelock mechanism
- [x] Resolver automation
- [x] React frontend

### Phase 2: Production Hardening
- [ ] Bitcoin mainnet integration
- [ ] Solana mainnet integration
- [ ] Oracle price feeds (Chainlink, Pyth)
- [ ] Enhanced error handling
- [ ] Monitoring & alerting system
- [ ] EVM Compatibility

### Phase 3: Scale & Optimize
- [ ] Multi-resolver competition (Dutch auction)
- [ ] Partial order fills
- [ ] Order book UI
- [ ] Advanced order types (limit, stop-loss)
- [ ] Fee optimization
- [ ] Gas abstraction

### Phase 4: Advanced Features
- [ ] SPL token support (USDC, USDT)
- [ ] Lightning Network integration
- [ ] MEV protection enhancements
- [ ] Mobile app (iOS/Android)
- [ ] API for integrators
- [ ] Analytics dashboard

### Phase 5: Multi-Chain
- [ ] Ethereum integration
- [ ] Polygon integration
- [ ] Arbitrum/Optimism support
- [ ] Cross-chain routing
- [ ] Unified liquidity pools
