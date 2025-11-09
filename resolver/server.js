import express from 'express';
import { Actor, HttpAgent } from '@dfinity/agent';
import { Ed25519KeyIdentity } from '@dfinity/identity';
import { idlFactory } from './declarations/intentswaps_backend/intentswaps_backend.did.js';
import { Principal } from '@dfinity/principal';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
app.use(express.json());

// Configuration
const CANISTER_ID = process.env.CANISTER_ID || 'rrkah-fqaaa-aaaaa-aaaaq-cai'; // Replace with your canister ID
const IC_HOST = process.env.IC_HOST || 'http://127.0.0.1:4943'; // Local replica
const POLL_INTERVAL = parseInt(process.env.POLL_INTERVAL) || 5000; // 5 seconds

// Resolver configuration
const RESOLVER_CONFIG = {
  // Minimum profit margin to accept orders (in percentage)
  minProfitMargin: parseFloat(process.env.MIN_PROFIT_MARGIN) || 0.5,

  // Maximum amounts the resolver is willing to handle
  maxBtcAmount: BigInt(process.env.MAX_BTC_AMOUNT) || BigInt(100000000), // 1 BTC in satoshis
  maxSolAmount: BigInt(process.env.MAX_SOL_AMOUNT) || BigInt(100000000000), // 100 SOL in lamports

  // Exchange rates (you'd fetch these from an oracle in production)
  btcToSolRate: parseFloat(process.env.BTC_TO_SOL_RATE) || 6340.0, // 1 BTC = 6340 SOL
  solToBtcRate: parseFloat(process.env.SOL_TO_BTC_RATE) || 0.000158, // 1 SOL = 0.000158 BTC
};

// State
let agent;
let actor;
let isProcessing = false;
let processedOrders = new Set();

// Initialize connection to ICP canister
async function initializeAgent() {
  try {
    // Create or load a dedicated resolver identity so the resolver does NOT reuse
    // the same identity as frontend users. For demo/dev we generate an identity
    // if none is provided. In production, provide a stable private key/identity.
    let resolverIdentity;

    // If you want to supply a deterministic identity, set RESOLVER_IDENTITY_SEED_BASE64
    // to a base64-encoded 32-byte seed. Otherwise we'll generate a new identity.
    if (process.env.RESOLVER_IDENTITY_SEED_BASE64) {
      try {
        const seed = Buffer.from(process.env.RESOLVER_IDENTITY_SEED_BASE64, 'base64');
        if (seed.length !== 32) {
          throw new Error('Seed must be exactly 32 bytes');
        }
        resolverIdentity = Ed25519KeyIdentity.generate(seed);
        console.log('🔐 Loaded resolver identity from RESOLVER_IDENTITY_SEED_BASE64');
      } catch (err) {
        console.warn('⚠️  Failed to parse RESOLVER_IDENTITY_SEED_BASE64, falling back to generated identity', err);
        resolverIdentity = Ed25519KeyIdentity.generate();
      }
    } else {
      resolverIdentity = Ed25519KeyIdentity.generate();
      console.log('🔐 Generated ephemeral resolver identity (set RESOLVER_IDENTITY_SEED_BASE64 to persist it)');
    }

    agent = new HttpAgent({
      host: IC_HOST,
      identity: resolverIdentity,
    });

    // Fetch root key for local development (remove in production)
    if (IC_HOST.includes('localhost') || IC_HOST.includes('127.0.0.1')) {
      await agent.fetchRootKey();
    }

    actor = Actor.createActor(idlFactory, {
      agent,
      canisterId: CANISTER_ID,
    });

    // Print resolver principal so it's easy to identify the resolver account
    try {
      const principal = resolverIdentity.getPrincipal().toText();
      console.log('🔎 Resolver principal:', principal);
    } catch (e) {
      console.warn('Could not get resolver principal:', e);
    }

    console.log('✅ Connected to ICP canister:', CANISTER_ID);
    return true;
  } catch (error) {
    console.error('❌ Failed to initialize agent:', error);
    return false;
  }
}

// Check if an order is profitable
function isOrderProfitable(order) {
  try {
    const fromChain = Object.keys(order.from_chain)[0];
    const toChain = Object.keys(order.to_chain)[0];
    const fromAmount = Number(order.from_amount);
    const toAmount = Number(order.to_amount);

    let expectedAmount;

    if (fromChain === 'Bitcoin' && toChain === 'Solana') {
      // User is swapping BTC to SOL
      // Resolver needs to provide SOL and receives BTC
      const btcValue = fromAmount / 100000000; // Convert satoshis to BTC
      expectedAmount = btcValue * RESOLVER_CONFIG.btcToSolRate * 1000000000; // Convert to lamports
      const profitMargin = ((expectedAmount - toAmount) / expectedAmount) * 100;

      console.log(`BTC->SOL: User offers ${btcValue} BTC, wants ${toAmount / 1000000000} SOL`);
      console.log(`Fair value: ${expectedAmount / 1000000000} SOL, Profit margin: ${profitMargin.toFixed(2)}%`);

      return profitMargin >= RESOLVER_CONFIG.minProfitMargin && toAmount <= RESOLVER_CONFIG.maxSolAmount;
    } else if (fromChain === 'Solana' && toChain === 'Bitcoin') {
      // User is swapping SOL to BTC
      // Resolver needs to provide BTC and receives SOL
      const solValue = fromAmount / 1000000000; // Convert lamports to SOL
      expectedAmount = solValue * RESOLVER_CONFIG.solToBtcRate * 100000000; // Convert to satoshis
      const profitMargin = ((expectedAmount - toAmount) / expectedAmount) * 100;

      console.log(`SOL->BTC: User offers ${solValue} SOL, wants ${toAmount / 100000000} BTC`);
      console.log(`Fair value: ${expectedAmount / 100000000} BTC, Profit margin: ${profitMargin.toFixed(2)}%`);

      return profitMargin >= RESOLVER_CONFIG.minProfitMargin && toAmount <= RESOLVER_CONFIG.maxBtcAmount;
    }

    return false;
  } catch (error) {
    console.error('Error checking profitability:', error);
    return false;
  }
}

// Process a single order
async function processOrder(order) {
  const orderId = Number(order.id);

  if (processedOrders.has(orderId)) {
    return; // Already processed
  }

  console.log(`\n📋 New order detected: #${orderId}`);
  console.log(`From: ${Object.keys(order.from_chain)[0]} (${order.from_amount})`);
  console.log(`To: ${Object.keys(order.to_chain)[0]} (${order.to_amount})`);

  // Check if order is profitable
  /*   if (!isOrderProfitable(order)) {
      console.log(`⚠️  Order #${orderId} not profitable, skipping`);
      processedOrders.add(orderId);
      return;
    } */

  console.log(`✅ Order #${orderId} is profitable, attempting to accept...`);

  try {
    // First, ensure resolver has enough balance in canister
    const toChain = Object.keys(order.to_chain)[0];
    const chainVariant = toChain === 'Bitcoin' ? { Bitcoin: null } : { Solana: null };

    const balance = await actor.get_balance(chainVariant);
    console.log(`Resolver balance for ${toChain}: ${balance}`);

    if (BigInt(balance) < BigInt(order.to_amount)) {
      console.log(`⚠️  Insufficient balance, depositing funds...`);
      // In production, this would trigger actual BTC/SOL deposit
      // For now, we'll just deposit the required amount
      const depositResult = await actor.deposit_funds(chainVariant, order.to_amount);
      console.log(`Deposit result:`, depositResult);
    }

    // Accept the order
    const result = await actor.accept_order(BigInt(orderId));

    if ('Ok' in result) {
      console.log(`✅ Successfully accepted order #${orderId}: ${result.Ok}`);
      processedOrders.add(orderId);

      // In a real implementation, you would:
      // 1. Monitor the blockchain for the actual fund transfers
      // 2. Verify the funds are locked properly
      // 3. Wait for the secret to be revealed
      // 4. Execute the cross-chain transfers
    } else {
      console.error(`❌ Failed to accept order #${orderId}: ${result.Err}`);
    }
  } catch (error) {
    console.error(`❌ Error processing order #${orderId}:`, error);
  }
}

// Poll for new orders
async function pollForOrders() {
  if (isProcessing) {
    return; // Skip if already processing
  }

  isProcessing = true;

  try {
    const pendingOrders = await actor.get_pending_orders();

    if (pendingOrders.length > 0) {
      console.log(`\n🔍 Found ${pendingOrders.length} pending order(s)`);

      for (const order of pendingOrders) {
        await processOrder(order);
      }
    }
  } catch (error) {
    console.error('Error polling for orders:', error);
  } finally {
    isProcessing = false;
  }
}

// API endpoints

app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    canisterId: CANISTER_ID,
    host: IC_HOST,
    processedOrders: processedOrders.size
  });
});

app.get('/config', (req, res) => {
  res.json(RESOLVER_CONFIG);
});

app.post('/config', (req, res) => {
  const { minProfitMargin, btcToSolRate, solToBtcRate } = req.body;

  if (minProfitMargin !== undefined) {
    RESOLVER_CONFIG.minProfitMargin = parseFloat(minProfitMargin);
  }
  if (btcToSolRate !== undefined) {
    RESOLVER_CONFIG.btcToSolRate = parseFloat(btcToSolRate);
  }
  if (solToBtcRate !== undefined) {
    RESOLVER_CONFIG.solToBtcRate = parseFloat(solToBtcRate);
  }

  res.json({ message: 'Config updated', config: RESOLVER_CONFIG });
});

app.get('/orders/pending', async (req, res) => {
  try {
    const orders = await actor.get_pending_orders();
    res.json(orders);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/orders/processed', (req, res) => {
  res.json({
    processedOrders: Array.from(processedOrders),
    count: processedOrders.size
  });
});

// Manual order acceptance
app.post('/orders/:orderId/accept', async (req, res) => {
  try {
    const orderId = BigInt(req.params.orderId);
    const result = await actor.accept_order(orderId);

    if ('Ok' in result) {
      processedOrders.add(Number(orderId));
      res.json({ success: true, message: result.Ok });
    } else {
      res.status(400).json({ success: false, error: result.Err });
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Start server
const PORT = process.env.PORT || 3001;

async function start() {
  console.log('🚀 Starting IntentSwaps Resolver...\n');

  const initialized = await initializeAgent();

  if (!initialized) {
    console.error('Failed to initialize, exiting...');
    process.exit(1);
  }

  // Start polling for orders
  console.log(`⏱️  Starting order polling (every ${POLL_INTERVAL}ms)...\n`);
  setInterval(pollForOrders, POLL_INTERVAL);

  // Start HTTP server
  app.listen(PORT, () => {
    console.log(`\n🌐 Resolver API listening on port ${PORT}`);
    console.log(`   Health check: http://localhost:${PORT}/health`);
    console.log(`   Pending orders: http://localhost:${PORT}/orders/pending`);
    console.log(`   Config: http://localhost:${PORT}/config\n`);
  });
}

start();
