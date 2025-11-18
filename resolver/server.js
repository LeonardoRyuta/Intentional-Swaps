import express from 'express';
import { Actor, HttpAgent } from '@dfinity/agent';
import { idlFactory } from './declarations/intentswaps_backend/intentswaps_backend.did.js';
import dotenv from 'dotenv';
import { Connection, Keypair, PublicKey, SystemProgram, Transaction, LAMPORTS_PER_SOL, sendAndConfirmTransaction } from '@solana/web3.js';
import { getAssociatedTokenAddress, createAssociatedTokenAccountInstruction, createTransferInstruction, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID, getAccount } from '@solana/spl-token';
import * as bitcoin from 'bitcoinjs-lib';
import { ECPairFactory } from 'ecpair';
import * as ecc from 'tiny-secp256k1';
import axios from 'axios';
import bs58 from 'bs58';

dotenv.config();

const ECPair = ECPairFactory(ecc);

const app = express();
app.use(express.json());

// Configuration
const CANISTER_ID = process.env.CANISTER_ID || 'uxrrr-q7777-77774-qaaaq-cai';
const IC_HOST = process.env.IC_HOST || 'http://127.0.0.1:4943';
const POLL_INTERVAL = parseInt(process.env.POLL_INTERVAL) || 10000; // 10 seconds
const SOLANA_RPC = process.env.SOLANA_RPC || 'https://api.devnet.solana.com';
const BITCOIN_NETWORK = process.env.BITCOIN_NETWORK || 'testnet';

// Wallet configuration
let btcWallet = null;
let solWallet = null;
let btcAddress = null;
let solAddress = null;

// Resolver configuration
const RESOLVER_CONFIG = {
  minProfitMargin: parseFloat(process.env.MIN_PROFIT_MARGIN) || 0.5,
  maxBtcAmount: BigInt(process.env.MAX_BTC_AMOUNT) || BigInt(100000000), // 1 BTC
  maxSolAmount: BigInt(process.env.MAX_SOL_AMOUNT) || BigInt(100000000000), // 100 SOL
};

// State
let agent;
let actor;
let solanaConnection;
let isProcessing = false;
let processedOrders = new Set();
let acceptedOrders = new Map(); // Track orders we've accepted: orderId -> { acceptedAt, lastStatus }

// Initialize Bitcoin wallet from private key (WIF format or hex)
function initializeBitcoinWallet() {
  const btcPrivateKey = process.env.BTC_PRIVATE_KEY;

  if (!btcPrivateKey) {
    console.warn('⚠️  BTC_PRIVATE_KEY not set, Bitcoin functionality disabled');
    return false;
  }

  try {
    const network = BITCOIN_NETWORK === 'mainnet'
      ? bitcoin.networks.bitcoin
      : bitcoin.networks.testnet;

    // Remove any whitespace
    const cleanKey = btcPrivateKey.trim();

    // Try to parse the private key
    let keyPair;
    try {
      // First try WIF format (most common)
      keyPair = ECPair.fromWIF(cleanKey, network);
    } catch (e1) {
      try {
        // Try as hex string (64 characters)
        if (cleanKey.length === 64) {
          const buffer = Buffer.from(cleanKey, 'hex');
          keyPair = ECPair.fromPrivateKey(buffer, { network });
        } else {
          throw new Error('Invalid key format');
        }
      } catch (e2) {
        throw new Error(`Could not parse private key. Expected WIF format (starts with 'c' for testnet, 'K'/'L' for mainnet) or 64-character hex string. Got: ${cleanKey.substring(0, 10)}...`);
      }
    }

    btcWallet = keyPair;

    // Generate P2WPKH address (Native SegWit address format)
    const { address } = bitcoin.payments.p2wpkh({
      pubkey: btcWallet.publicKey,
      network
    });
    btcAddress = address;

    console.log('✅ Bitcoin wallet initialized');
    console.log('   Network:', BITCOIN_NETWORK);
    console.log('   Address:', btcAddress);
    console.log('   Address type: P2WPKH (Native SegWit)');
    return true;
  } catch (error) {
    console.error('❌ Failed to initialize Bitcoin wallet:', error.message);
    console.error('   Make sure your private key is in WIF format');
    console.error('   Testnet WIF starts with "c", Mainnet WIF starts with "K" or "L"');
    return false;
  }
}

// Initialize Solana wallet from private key (multiple formats supported)
function initializeSolanaWallet() {
  const solPrivateKey = process.env.SOL_PRIVATE_KEY;

  if (!solPrivateKey) {
    console.warn('⚠️  SOL_PRIVATE_KEY not set, Solana functionality disabled');
    return false;
  }

  try {
    const cleanKey = solPrivateKey.trim();
    let secretKey;

    // Try different formats
    if (cleanKey.startsWith('[')) {
      // JSON array format: [1,2,3,...]
      try {
        secretKey = new Uint8Array(JSON.parse(cleanKey));
      } catch (e) {
        throw new Error('Invalid JSON array format');
      }
    } else if (cleanKey.includes(',')) {
      // Comma-separated numbers: 1,2,3,...
      try {
        const numbers = cleanKey.split(',').map(n => parseInt(n.trim()));
        secretKey = new Uint8Array(numbers);
      } catch (e) {
        throw new Error('Invalid comma-separated format');
      }
    } else if (cleanKey.length === 128) {
      // Hex format (128 characters = 64 bytes)
      try {
        const buffer = Buffer.from(cleanKey, 'hex');
        secretKey = new Uint8Array(buffer);
      } catch (e) {
        throw new Error('Invalid hex format');
      }
    } else if (cleanKey.length >= 87 && cleanKey.length <= 88) {
      // Base58 format (typical length 87-88 characters)
      try {
        // Use bs58 decoding (Solana's standard format)
        secretKey = bs58.decode(cleanKey);
      } catch (e) {
        throw new Error('Invalid base58 format: ' + e.message);
      }
    } else {
      throw new Error(`Unknown private key format. Length: ${cleanKey.length}. Expected: JSON array [1,2,3,...], comma-separated (1,2,3,...), hex (128 chars), or base58 (87-88 chars)`);
    }

    // Validate key length
    if (secretKey.length !== 64) {
      throw new Error(`Invalid secret key length: ${secretKey.length} bytes. Expected 64 bytes. Your key format may be incorrect.`);
    }

    solWallet = Keypair.fromSecretKey(secretKey);
    solAddress = solWallet.publicKey.toBase58();
    solanaConnection = new Connection(SOLANA_RPC, 'confirmed');

    console.log('✅ Solana wallet initialized');
    console.log('   Network:', SOLANA_RPC.includes('devnet') ? 'Devnet' : 'Mainnet');
    console.log('   Address:', solAddress);
    console.log('   Key format detected:',
      cleanKey.startsWith('[') ? 'JSON array' :
        cleanKey.includes(',') ? 'Comma-separated' :
          cleanKey.length === 128 ? 'Hex' : 'Base58'
    );
    return true;
  } catch (error) {
    console.error('❌ Failed to initialize Solana wallet:', error.message);
    console.error('\n   Supported formats:');
    console.error('   1. JSON array:        [1,2,3,...] (from id.json file)');
    console.error('   2. Comma-separated:   1,2,3,...');
    console.error('   3. Hex string:        abc123... (128 characters)');
    console.error('   4. Base58 string:     5JK8... (87-88 characters)');
    console.error('\n   To get your Solana private key:');
    console.error('   - From Phantom: Settings → Show Private Key → Copy');
    console.error('   - From CLI: cat ~/.config/solana/id.json');
    return false;
  }
}

// Get Bitcoin wallet balance
async function getBitcoinBalance() {
  if (!btcAddress) return 0;

  try {
    // Use blockstream API for testnet
    const apiUrl = BITCOIN_NETWORK === 'mainnet'
      ? `https://blockstream.info/api/address/${btcAddress}`
      : `https://blockstream.info/testnet/api/address/${btcAddress}`;

    const response = await axios.get(apiUrl);
    const balanceSats = response.data.chain_stats.funded_txo_sum - response.data.chain_stats.spent_txo_sum;
    return balanceSats;
  } catch (error) {
    console.error('Error fetching Bitcoin balance:', error.message);
    return 0;
  }
}

// Get Solana wallet balance
async function getSolanaBalance() {
  if (!solWallet || !solanaConnection) return 0;

  try {
    const balance = await solanaConnection.getBalance(solWallet.publicKey);
    return balance;
  } catch (error) {
    console.error('Error fetching Solana balance:', error.message);
    return 0;
  }
}

// Send Bitcoin transaction
async function sendBitcoinTransaction(toAddress, amountSats) {
  if (!btcWallet || !btcAddress) {
    throw new Error('Bitcoin wallet not initialized');
  }

  console.log(`📤 Sending ${amountSats} satoshis to ${toAddress}`);

  // Note: This is a simplified version. In production, you'd need to:
  // 1. Fetch UTXOs for your address
  // 2. Build and sign the transaction properly
  // 3. Broadcast via a Bitcoin node or API

  // For now, we'll simulate this
  console.warn('⚠️  Bitcoin transaction sending not fully implemented - would send:', {
    from: btcAddress,
    to: toAddress,
    amount: amountSats
  });

  // Return a dummy txid for now
  return 'btc_dummy_txid_' + Date.now();
}

// Send Solana transaction
async function sendSolanaTransaction(toAddress, amountLamports) {
  if (!solWallet || !solanaConnection) {
    throw new Error('Solana wallet not initialized');
  }

  console.log(`📤 Sending ${amountLamports / LAMPORTS_PER_SOL} SOL to ${toAddress}`);

  try {
    const transaction = new Transaction().add(
      SystemProgram.transfer({
        fromPubkey: solWallet.publicKey,
        toPubkey: new PublicKey(toAddress),
        lamports: amountLamports,
      })
    );

    const signature = await sendAndConfirmTransaction(
      solanaConnection,
      transaction,
      [solWallet],
      { commitment: 'confirmed' }
    );

    console.log('✅ Solana transaction confirmed:', signature);
    return signature;
  } catch (error) {
    console.error('❌ Solana transaction failed:', error.message);
    throw error;
  }
}

// Send SPL Token transaction
async function sendSplTokenTransaction(toAddress, amountAtoms, mintAddress) {
  if (!solWallet || !solanaConnection) {
    throw new Error('Solana wallet not initialized');
  }

  console.log(`📤 Sending ${amountAtoms} token atoms (mint: ${mintAddress.substring(0, 8)}...) to ${toAddress}`);

  try {
    const mintPubkey = new PublicKey(mintAddress);
    const fromPubkey = solWallet.publicKey;
    const toPubkey = new PublicKey(toAddress);

    // Get Associated Token Accounts
    const fromATA = await getAssociatedTokenAddress(
      mintPubkey,
      fromPubkey,
      false,
      TOKEN_PROGRAM_ID,
      ASSOCIATED_TOKEN_PROGRAM_ID
    );

    const toATA = await getAssociatedTokenAddress(
      mintPubkey,
      toPubkey,
      false,
      TOKEN_PROGRAM_ID,
      ASSOCIATED_TOKEN_PROGRAM_ID
    );

    console.log(`   From ATA: ${fromATA.toString()}`);
    console.log(`   To ATA: ${toATA.toString()}`);

    // Check sender's token balance
    const fromTokenAccount = await getAccount(solanaConnection, fromATA);
    console.log(`   Token balance: ${fromTokenAccount.amount.toString()}`);

    if (fromTokenAccount.amount < BigInt(amountAtoms)) {
      throw new Error(`Insufficient token balance. Have ${fromTokenAccount.amount}, need ${amountAtoms}`);
    }

    const transaction = new Transaction();

    // Check if destination ATA exists, if not create it
    try {
      await getAccount(solanaConnection, toATA);
      console.log('   Destination ATA exists');
    } catch (ataError) {
      if (ataError.name === 'TokenAccountNotFoundError') {
        console.log('   Creating destination ATA...');
        transaction.add(
          createAssociatedTokenAccountInstruction(
            fromPubkey,
            toATA,
            toPubkey,
            mintPubkey,
            TOKEN_PROGRAM_ID,
            ASSOCIATED_TOKEN_PROGRAM_ID
          )
        );
      } else {
        throw ataError;
      }
    }

    // Add transfer instruction
    transaction.add(
      createTransferInstruction(
        fromATA,
        toATA,
        fromPubkey,
        BigInt(amountAtoms),
        [],
        TOKEN_PROGRAM_ID
      )
    );

    const signature = await sendAndConfirmTransaction(
      solanaConnection,
      transaction,
      [solWallet],
      { commitment: 'confirmed' }
    );

    console.log('✅ SPL Token transaction confirmed:', signature);
    return signature;
  } catch (error) {
    console.error('❌ SPL Token transaction failed:', error.message);
    throw error;
  }
}

// Initialize connection to ICP canister
async function initializeAgent() {
  try {
    // Use anonymous agent (no identity needed)
    agent = new HttpAgent({
      host: IC_HOST,
    });

    // Fetch root key for local development
    if (IC_HOST.includes('localhost') || IC_HOST.includes('127.0.0.1')) {
      await agent.fetchRootKey();
    }

    actor = Actor.createActor(idlFactory, {
      agent,
      canisterId: CANISTER_ID,
    });

    console.log('✅ Connected to ICP canister:', CANISTER_ID);
    return true;
  } catch (error) {
    console.error('❌ Failed to initialize agent:', error);
    return false;
  }
}

// Get asset info from Asset enum
function getAssetInfo(asset) {
  if (asset.Bitcoin !== undefined) {
    return { type: 'Bitcoin', decimals: 8 };
  } else if (asset.Solana !== undefined) {
    return { type: 'Solana', decimals: 9 };
  } else if (asset.SplToken !== undefined) {
    return {
      type: 'SplToken',
      mintAddress: asset.SplToken.mint_address,
      decimals: asset.SplToken.decimals
    };
  }
  return { type: 'Unknown', decimals: 0 };
}

// Format amount for display
function formatAmount(amount, asset) {
  const assetInfo = getAssetInfo(asset);
  const value = Number(amount) / Math.pow(10, assetInfo.decimals);

  if (assetInfo.type === 'Bitcoin') {
    return `${value.toFixed(8)} BTC`;
  } else if (assetInfo.type === 'Solana') {
    return `${value.toFixed(4)} SOL`;
  } else if (assetInfo.type === 'SplToken') {
    return `${value.toFixed(assetInfo.decimals)} (${assetInfo.mintAddress.substring(0, 8)}...)`;
  }
  return value.toString();
}

// Check if resolver has sufficient balance
async function hasSufficientBalance(order) {
  try {
    const toAssetInfo = getAssetInfo(order.to_asset);
    const toAmount = Number(order.to_amount);

    if (toAssetInfo.type === 'Bitcoin') {
      const btcBalance = await getBitcoinBalance();
      const hasFunds = btcBalance >= toAmount;
      console.log(`   BTC Balance: ${btcBalance / 100000000} BTC, Required: ${toAmount / 100000000} BTC`);
      return hasFunds;
    } else if (toAssetInfo.type === 'Solana') {
      const solBalance = await getSolanaBalance();
      const hasFunds = solBalance >= toAmount;
      console.log(`   SOL Balance: ${solBalance / LAMPORTS_PER_SOL} SOL, Required: ${toAmount / LAMPORTS_PER_SOL} SOL`);
      return hasFunds;
    } else if (toAssetInfo.type === 'SplToken') {
      // Check SPL token balance
      try {
        const mintPubkey = new PublicKey(toAssetInfo.mintAddress);
        const ata = await getAssociatedTokenAddress(
          mintPubkey,
          solWallet.publicKey,
          false,
          TOKEN_PROGRAM_ID,
          ASSOCIATED_TOKEN_PROGRAM_ID
        );

        const tokenAccount = await getAccount(solanaConnection, ata);
        const tokenBalance = Number(tokenAccount.amount);
        const hasFunds = tokenBalance >= toAmount;

        console.log(`   SPL Token Balance: ${tokenBalance / Math.pow(10, toAssetInfo.decimals)} tokens, Required: ${toAmount / Math.pow(10, toAssetInfo.decimals)} tokens`);
        console.log(`   Mint: ${toAssetInfo.mintAddress}`);

        return hasFunds;
      } catch (error) {
        if (error.name === 'TokenAccountNotFoundError') {
          console.log(`   ⚠️  No token account for mint ${toAssetInfo.mintAddress.substring(0, 8)}...`);
          return false;
        }
        throw error;
      }
    }

    return false;
  } catch (error) {
    console.error('Error checking balance:', error);
    return false;
  }
}

// Process a single order
async function processOrder(order) {
  const orderId = Number(order.id);

  if (processedOrders.has(orderId)) {
    return; // Already processed
  }

  const fromAssetInfo = getAssetInfo(order.from_asset);
  const toAssetInfo = getAssetInfo(order.to_asset);
  const fromAmount = Number(order.from_amount);
  const toAmount = Number(order.to_amount);

  console.log(`\n📋 New order detected: #${orderId}`);
  console.log(`   From: ${formatAmount(fromAmount, order.from_asset)}`);
  console.log(`   To: ${formatAmount(toAmount, order.to_asset)}`);
  console.log(`   Creator deposited: ${order.creator_deposited}`);
  console.log(`   Resolver deposited: ${order.resolver_deposited}`);

  // Check if we have the required wallet
  if (toAssetInfo.type === 'Bitcoin' && !btcWallet) {
    console.log(`⚠️  Bitcoin wallet not configured, skipping order #${orderId}`);
    processedOrders.add(orderId);
    return;
  }

  if ((toAssetInfo.type === 'Solana' || toAssetInfo.type === 'SplToken') && !solWallet) {
    console.log(`⚠️  Solana wallet not configured, skipping order #${orderId}`);
    processedOrders.add(orderId);
    return;
  }

  // Check if we have sufficient balance
  const hasBalance = await hasSufficientBalance(order);
  if (!hasBalance) {
    console.log(`⚠️  Insufficient balance for order #${orderId}, skipping`);
    processedOrders.add(orderId);
    return;
  }

  console.log(`✅ Order #${orderId} can be fulfilled, attempting to accept...`);

  try {
    // Accept the order with resolver's wallet addresses
    const resolverBtcAddr = btcAddress ? [btcAddress] : [];
    const resolverSolAddr = solAddress ? [solAddress] : [];

    const result = await actor.accept_order(BigInt(orderId), resolverBtcAddr, resolverSolAddr);

    if ('Ok' in result) {
      const canisterAddresses = result.Ok;
      console.log(`✅ Order #${orderId} accepted!`);
      console.log(`   Canister BTC address: ${canisterAddresses.bitcoin_address}`);
      console.log(`   Canister SOL address: ${canisterAddresses.solana_address}`);

      // Send the required funds to canister
      let txid;
      if (toAssetInfo.type === 'Bitcoin') {
        console.log(`📤 Sending ${formatAmount(toAmount, order.to_asset)} to canister...`);
        txid = await sendBitcoinTransaction(canisterAddresses.bitcoin_address, toAmount);
      } else if (toAssetInfo.type === 'Solana') {
        console.log(`📤 Sending ${formatAmount(toAmount, order.to_asset)} to canister...`);
        txid = await sendSolanaTransaction(canisterAddresses.solana_address, toAmount);
      } else if (toAssetInfo.type === 'SplToken') {
        console.log(`📤 Sending ${formatAmount(toAmount, order.to_asset)} to canister...`);
        console.log(`   Mint: ${toAssetInfo.mintAddress}`);
        txid = await sendSplTokenTransaction(canisterAddresses.solana_address, toAmount, toAssetInfo.mintAddress);
      }

      console.log(`   Transaction ID: ${txid}`);

      // Confirm the resolver deposit with the canister
      console.log(`📝 Confirming resolver deposit for order #${orderId}...`);
      const confirmResult = await actor.confirm_resolver_deposit(BigInt(orderId), txid);

      if ('Ok' in confirmResult) {
        console.log(`✅ Resolver deposit confirmed for order #${orderId}`);
        console.log(`   Message: ${confirmResult.Ok}`);
        processedOrders.add(orderId);
        acceptedOrders.set(orderId, {
          acceptedAt: Date.now(),
          lastStatus: 'ResolverDeposited',
          toAssetInfo,
          toAmount
        });
        console.log(`   👁️  Now monitoring order #${orderId} for completion...`);
      } else {
        console.error(`❌ Failed to confirm resolver deposit: ${confirmResult.Err}`);
      }

    } else {
      console.error(`❌ Failed to accept order #${orderId}: ${result.Err}`);
    }
  } catch (error) {
    console.error(`❌ Error processing order #${orderId}:`, error.message);
  }
}

// Monitor accepted orders for status changes
async function monitorAcceptedOrders() {
  if (acceptedOrders.size === 0) {
    return;
  }

  try {
    for (const [orderId, orderInfo] of acceptedOrders.entries()) {
      const result = await actor.get_order(BigInt(orderId));

      if (result.length > 0) {
        const order = result[0];
        const currentStatus = Object.keys(order.status)[0];

        if (currentStatus !== orderInfo.lastStatus) {
          console.log(`\n🔔 Order #${orderId} status changed: ${orderInfo.lastStatus} → ${currentStatus}`);

          if (currentStatus === 'Completed') {
            const { toAssetInfo, toAmount } = orderInfo;
            console.log(`✅ Order #${orderId} completed!`);

            // Build asset for display
            let asset;
            if (toAssetInfo.type === 'Bitcoin') {
              asset = { Bitcoin: null };
            } else if (toAssetInfo.type === 'Solana') {
              asset = { Solana: null };
            } else if (toAssetInfo.type === 'SplToken') {
              asset = { SplToken: { mint_address: toAssetInfo.mintAddress, decimals: toAssetInfo.decimals } };
            }

            console.log(`   Resolver should have received: ${formatAmount(toAmount, asset)}`);
            console.log(`   Check your ${toAssetInfo.type} wallet for funds.`);
            acceptedOrders.delete(orderId); // Stop monitoring
          } else if (currentStatus === 'Cancelled' || currentStatus === 'Expired') {
            console.log(`⚠️  Order #${orderId} ${currentStatus.toLowerCase()}`);
            console.log(`   Funds should be refunded automatically by the canister.`);
            acceptedOrders.delete(orderId); // Stop monitoring
          } else {
            // Update status
            orderInfo.lastStatus = currentStatus;
          }
        }
      } else {
        console.log(`⚠️  Order #${orderId} not found, removing from monitoring`);
        acceptedOrders.delete(orderId);
      }
    }
  } catch (error) {
    console.error('Error monitoring accepted orders:', error);
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
        // Only process orders that have received creator deposit
        const status = Object.keys(order.status)[0];
        if (status === 'DepositReceived') {
          await processOrder(order);
        }
      }
    }

    // Also monitor orders we've already accepted
    await monitorAcceptedOrders();
  } catch (error) {
    console.error('Error polling for orders:', error);
  } finally {
    isProcessing = false;
  }
}

// API endpoints

app.get('/health', async (req, res) => {
  const btcBalance = btcAddress ? await getBitcoinBalance() : 0;
  const solBalance = solAddress ? await getSolanaBalance() : 0;

  res.json({
    status: 'healthy',
    canisterId: CANISTER_ID,
    host: IC_HOST,
    processedOrders: processedOrders.size,
    acceptedOrders: acceptedOrders.size,
    monitoringOrders: Array.from(acceptedOrders.entries()).map(([id, info]) => ({
      orderId: id,
      status: info.lastStatus,
      acceptedAt: new Date(info.acceptedAt).toISOString()
    })),
    wallets: {
      bitcoin: {
        configured: !!btcAddress,
        address: btcAddress,
        balance: btcBalance / 100000000 + ' BTC'
      },
      solana: {
        configured: !!solAddress,
        address: solAddress,
        balance: solBalance / LAMPORTS_PER_SOL + ' SOL'
      }
    }
  });
});

app.get('/balances', async (req, res) => {
  try {
    const btcBalance = btcAddress ? await getBitcoinBalance() : 0;
    const solBalance = solAddress ? await getSolanaBalance() : 0;

    res.json({
      bitcoin: {
        address: btcAddress,
        balanceSats: btcBalance,
        balanceBTC: btcBalance / 100000000
      },
      solana: {
        address: solAddress,
        balanceLamports: solBalance,
        balanceSOL: solBalance / LAMPORTS_PER_SOL
      }
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/config', (req, res) => {
  res.json(RESOLVER_CONFIG);
});

app.post('/config', (req, res) => {
  const { minProfitMargin } = req.body;

  if (minProfitMargin !== undefined) {
    RESOLVER_CONFIG.minProfitMargin = parseFloat(minProfitMargin);
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
    const orderId = req.params.orderId;
    const orders = await actor.get_pending_orders();
    const order = orders.find(o => Number(o.id) === Number(orderId));

    if (!order) {
      return res.status(404).json({ success: false, error: 'Order not found' });
    }

    await processOrder(order);
    res.json({ success: true, message: `Processing order #${orderId}` });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Start server
const PORT = process.env.PORT || 3001;

async function start() {
  console.log('🚀 Starting IntentSwaps Resolver...\n');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  // Initialize wallets
  console.log('🔑 Initializing wallets...');
  const btcInitialized = initializeBitcoinWallet();
  const solInitialized = initializeSolanaWallet();

  if (!btcInitialized && !solInitialized) {
    console.error('\n❌ No wallets configured!');
    console.error('   Please set BTC_PRIVATE_KEY and/or SOL_PRIVATE_KEY in your .env file\n');
    process.exit(1);
  }

  console.log('');

  // Initialize ICP agent
  console.log('🔌 Connecting to ICP canister...');
  const initialized = await initializeAgent();

  if (!initialized) {
    console.error('Failed to initialize ICP agent, exiting...');
    process.exit(1);
  }

  console.log('');

  // Show initial balances
  if (btcAddress) {
    const btcBalance = await getBitcoinBalance();
    console.log(`💰 Initial BTC balance: ${(btcBalance / 100000000).toFixed(8)} BTC`);
  }
  if (solAddress) {
    const solBalance = await getSolanaBalance();
    console.log(`💰 Initial SOL balance: ${(solBalance / LAMPORTS_PER_SOL).toFixed(4)} SOL`);
  }

  console.log('');

  // Start polling for orders
  console.log(`⏱️  Starting order polling (every ${POLL_INTERVAL / 1000}s)...`);
  setInterval(pollForOrders, POLL_INTERVAL);

  // Do an immediate poll
  setTimeout(pollForOrders, 1000);

  // Start HTTP server
  app.listen(PORT, () => {
    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log(`\n🌐 Resolver API running on port ${PORT}`);
    console.log(`\n   📊 Health:        http://localhost:${PORT}/health`);
    console.log(`   💰 Balances:      http://localhost:${PORT}/balances`);
    console.log(`   📋 Orders:        http://localhost:${PORT}/orders/pending`);
    console.log(`   ⚙️  Config:        http://localhost:${PORT}/config`);
    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
  });
}

start();
