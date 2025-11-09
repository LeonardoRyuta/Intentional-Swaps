# IntentSwaps Resolver Service

This is a resolver service that monitors the IntentSwaps ICP canister for new cross-chain swap orders and automatically fulfills profitable ones.

## Setup

1. Install dependencies:
```bash
npm install
```

2. Copy the environment file:
```bash
cp .env.example .env
```

3. Update the `.env` file with your canister ID and preferences.

## Running the Resolver

```bash
npm start
```

For development with auto-reload:
```bash
npm run dev
```

## How It Works

1. The resolver polls the ICP canister every 5 seconds (configurable)
2. When a new order is detected, it checks if the order is profitable
3. If profitable, it automatically accepts the order and locks its funds
4. The resolver waits for the user to reveal the secret
5. Once the secret is revealed, funds are transferred to both parties

## API Endpoints

- `GET /health` - Health check
- `GET /config` - Get current configuration
- `POST /config` - Update configuration
- `GET /orders/pending` - Get all pending orders
- `GET /orders/processed` - Get orders processed by this resolver
- `POST /orders/:orderId/accept` - Manually accept a specific order

## Configuration

Adjust these environment variables to customize the resolver behavior:

- `MIN_PROFIT_MARGIN` - Minimum profit margin percentage to accept orders (default: 0.5%)
- `MAX_BTC_AMOUNT` - Maximum BTC amount the resolver will handle (in satoshis)
- `MAX_SOL_AMOUNT` - Maximum SOL amount the resolver will handle (in lamports)
- `BTC_TO_SOL_RATE` - Exchange rate from BTC to SOL
- `SOL_TO_BTC_RATE` - Exchange rate from SOL to BTC

## Notes

- In production, you should fetch exchange rates from a reliable oracle
- The resolver needs to have funds deposited in the canister to fulfill orders
- Make sure to monitor the resolver logs for any errors or issues
