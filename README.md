# 🔄 IntentSwaps - Cross-Chain Swap Protocol on ICP

An intent-based cross-chain swapping protocol built on the Internet Computer Protocol (ICP) network, enabling seamless Bitcoin ↔ Solana swaps using hashlocks and timelocks.

## 🌟 Features

- **Cross-Chain Swaps**: Swap Bitcoin for Solana and vice versa
- **Intent-Based Architecture**: Users create swap intents, resolvers fulfill them
- **Hashlock & Timelock Security**: Similar to 1inch Fusion+ protocol
- **Decentralized Execution**: Funds are held in the ICP canister until swap completion
- **Automatic Resolver**: Express server that monitors and fulfills profitable orders
- **Modern UI**: React-based frontend for easy order creation and management

## 🏗️ Architecture

### Components

1. **ICP Canister Backend** (`intentswaps_backend`)
   - Order management and storage
   - Fund custody during swaps
   - Hashlock/timelock verification
   - Written in Rust

2. **React Frontend** (`intentswaps_frontend`)
   - User interface for creating and managing orders
   - Balance management
   - Order status tracking

3. **Resolver Service** (`resolver/`)
   - Node.js Express server
   - Monitors canister for new orders
   - Automatically fulfills profitable orders
   - Configurable profit margins and limits

### Swap Flow

1. **User Creates Order**:
   - User generates a secret and its hash
   - Deposits funds (BTC or SOL) into the canister
   - Creates swap order with desired amounts and secret hash
   - Funds are locked in the canister

2. **Resolver Accepts Order**:
   - Resolver monitors for new pending orders
   - Checks profitability based on exchange rates
   - Deposits counter-party funds into canister
   - Accepts the order, locking their funds

3. **User Reveals Secret**:
   - Once resolver's funds are locked, user reveals the secret
   - Secret is verified against the hash
   - If valid, funds are transferred to both parties

4. **Timeout Protection**:
   - If secret isn't revealed before timeout, order expires
   - Funds are returned to original owners

## 🚀 Getting Started

### Prerequisites

- Node.js (v18+)
- dfx (Internet Computer SDK)
- Rust toolchain

### Installation

1. **Clone the repository**:
```bash
cd /workspaces/Intentional-Swaps/icp
```

2. **Install dependencies**:
```bash
# Install frontend dependencies
cd src/intentswaps_frontend
npm install
cd ../..

# Install resolver dependencies
cd ../resolver
npm install
cd ..
```

3. **Start local ICP replica**:
```bash
cd icp
dfx start --clean --background
```

4. **Deploy the canister**:
```bash
dfx deploy
```

5. **Note your canister ID**:
```bash
dfx canister id intentswaps_backend
```

6. **Configure resolver**:
```bash
cd ../resolver
cp .env.example .env
# Edit .env and update CANISTER_ID with your backend canister ID
```

7. **Start the resolver**:
```bash
npm start
```

8. **Access the frontend**:
The frontend will be available at the URL shown after deployment, typically:
```
http://localhost:4943/?canisterId={frontend_canister_id}
```

## 📖 Usage Guide

### For Users (Swappers)

1. **Deposit Funds**:
   - Click "Deposit BTC" or "Deposit SOL" buttons
   - Enter the amount you want to deposit
   - Funds will be held in the canister

2. **Create a Swap Order**:
   - Navigate to "Create Order" tab
   - Select source chain and amount (e.g., 0.1 BTC)
   - Select destination chain and amount (e.g., 634 SOL)
   - Click "Generate Secret" - **SAVE THIS SECRET!**
   - Set timeout duration (minimum 5 minutes)
   - Click "Create Order"

3. **Wait for Resolver**:
   - Your order appears in "Pending Orders"
   - Resolvers will evaluate and potentially accept it
   - Status changes to "Accepted" when a resolver locks their funds

4. **Complete the Swap**:
   - Once order is accepted, go to "My Orders"
   - Enter your saved secret
   - Click "Reveal Secret"
   - Funds are transferred to both parties

### For Resolvers

1. **Setup Resolver Service**:
   - Configure exchange rates in `.env`
   - Set profit margins and limits
   - Deposit funds into canister for both chains

2. **Run Resolver**:
```bash
npm start
```

3. **Monitor Orders**:
   - Resolver automatically polls for new orders every 5 seconds
   - Checks profitability based on configured rates
   - Automatically accepts and fulfills profitable orders

4. **API Endpoints**:
   - `GET /health` - Service health check
   - `GET /config` - View current configuration
   - `POST /config` - Update configuration
   - `GET /orders/pending` - List pending orders
   - `POST /orders/:id/accept` - Manually accept order

## 🔧 Configuration

### Resolver Configuration

Edit `resolver/.env`:

```env
# Minimum profit margin to accept orders (percentage)
MIN_PROFIT_MARGIN=0.5

# Maximum amounts to handle
MAX_BTC_AMOUNT=100000000      # 1 BTC in satoshis
MAX_SOL_AMOUNT=100000000000   # 100 SOL in lamports

# Exchange rates (update regularly)
BTC_TO_SOL_RATE=6340.0
SOL_TO_BTC_RATE=0.000158

# Polling interval (milliseconds)
POLL_INTERVAL=5000
```

## 🔐 Security Features

- **Hashlocks**: Secret must match hash for swap completion
- **Timelocks**: Orders expire if not completed within timeout
- **Escrow**: Funds held in canister, not by any party
- **Atomic Swaps**: Both parties receive funds or no one does

## 📝 API Reference

### Canister Methods

#### `create_order(request: OrderRequest) -> Result<u64, String>`
Create a new swap order.

#### `accept_order(order_id: u64) -> Result<String, String>`
Resolver accepts and locks funds for an order.

#### `reveal_secret(order_id: u64, secret: String) -> Result<String, String>`
User reveals secret to complete swap.

#### `cancel_order(order_id: u64) -> Result<String, String>`
Cancel a pending order.

#### `deposit_funds(chain: Chain, amount: u64) -> Result<String, String>`
Deposit funds into canister.

#### `get_balance(chain: Chain) -> u64`
Get your balance for a chain.

#### `get_pending_orders() -> Vec<OrderInfo>`
Get all pending orders.

#### `get_my_orders() -> Vec<OrderInfo>`
Get orders you created or accepted.

## 🛣️ Roadmap

- [ ] Real Bitcoin integration (BIP-340, Schnorr signatures)
- [ ] Real Solana integration (SPL tokens)
- [ ] Oracle integration for real-time exchange rates
- [ ] Multi-resolver competition
- [ ] Partial fills
- [ ] Order book UI
- [ ] Advanced security audits
- [ ] Mainnet deployment

## ⚠️ Important Notes

**This is an MVP/Demo Implementation**:
- Uses simplified hashing (MD5 instead of SHA256)
- No real Bitcoin/Solana blockchain integration
- Funds are simulated, not actual crypto
- Not audited - DO NOT use with real funds

**For Production**:
- Implement proper SHA256 hashing
- Integrate with Bitcoin and Solana networks
- Add comprehensive security audits
- Implement proper key management
- Add oracle integration for rates
- Add monitoring and alerting

## 🤝 Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## 📄 License

MIT License - see LICENSE file for details

## 🙏 Acknowledgments

- Inspired by 1inch Fusion+ protocol
- Built on Internet Computer Protocol (ICP)
- Uses Bitcoin and Solana blockchain concepts

## 📞 Support

For questions and support, please open an issue on GitHub.

---

**⚠️ WARNING**: This is a demonstration project. Do not use with real funds without proper security audits and testing.
