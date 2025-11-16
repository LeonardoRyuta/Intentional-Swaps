#!/usr/bin/env node
/**
 * Bitcoin Private Key Checker
 * 
 * Helps verify Bitcoin private keys and show the derived address
 * Usage: node check-btc-key.js <your-private-key-wif>
 */

import * as bitcoin from 'bitcoinjs-lib';
import { ECPairFactory } from 'ecpair';
import * as ecc from 'tiny-secp256k1';

const ECPair = ECPairFactory(ecc);

const privateKey = process.argv[2];
const network = process.argv[3] || 'testnet';

if (!privateKey) {
    console.log('❌ No private key provided\n');
    console.log('Usage: node check-btc-key.js <wif-private-key> [network]\n');
    console.log('Examples:');
    console.log('  Testnet: node check-btc-key.js cQxxx... testnet');
    console.log('  Mainnet: node check-btc-key.js Kxxx... mainnet\n');
    process.exit(1);
}

try {
    const btcNetwork = network === 'mainnet'
        ? bitcoin.networks.bitcoin
        : bitcoin.networks.testnet;

    const cleanKey = privateKey.trim();
    let keyPair;

    // Try WIF format first
    try {
        keyPair = ECPair.fromWIF(cleanKey, btcNetwork);
    } catch (e) {
        // Try hex format
        if (cleanKey.length === 64) {
            const buffer = Buffer.from(cleanKey, 'hex');
            keyPair = ECPair.fromPrivateKey(buffer, { network: btcNetwork });
        } else {
            throw new Error('Invalid private key format');
        }
    }

    // Generate different address types
    const p2pkh = bitcoin.payments.p2pkh({ pubkey: keyPair.publicKey, network: btcNetwork });
    const p2wpkh = bitcoin.payments.p2wpkh({ pubkey: keyPair.publicKey, network: btcNetwork });
    const p2sh = bitcoin.payments.p2sh({
        redeem: bitcoin.payments.p2wpkh({ pubkey: keyPair.publicKey, network: btcNetwork }),
        network: btcNetwork
    });

    console.log('\n✅ Private key successfully parsed!\n');
    console.log('Network:', network);
    console.log('WIF format:', keyPair.toWIF());
    console.log('\n📋 Possible addresses from this key:\n');
    console.log('1. P2WPKH (Native SegWit):');
    console.log('   Address:', p2wpkh.address);
    console.log('   Format: Starts with "bc1" (mainnet) or "tb1" (testnet)');
    console.log('   ⭐ This is what the resolver uses\n');

    console.log('2. P2PKH (Legacy):');
    console.log('   Address:', p2pkh.address);
    console.log('   Format: Starts with "1" (mainnet) or "m/n" (testnet)\n');

    console.log('3. P2SH-P2WPKH (Wrapped SegWit):');
    console.log('   Address:', p2sh.address);
    console.log('   Format: Starts with "3" (mainnet) or "2" (testnet)\n');

    console.log('💡 Important:');
    console.log('   - Make sure your BTC is sent to the P2WPKH (Native SegWit) address above');
    console.log('   - If you have funds in a different address type, send them to the P2WPKH address');
    console.log('   - For .env file: BTC_PRIVATE_KEY=' + keyPair.toWIF() + '\n');

} catch (error) {
    console.error('\n❌ Error:', error.message);
    console.error('\nExpected format:');
    console.error('  - Testnet WIF: starts with "c" (e.g., cQxxx...)');
    console.error('  - Mainnet WIF: starts with "K" or "L" (e.g., Kxxx... or Lxxx...)');
    console.error('  - Hex: 64 character string (e.g., abc123...)\n');
    console.error('Make sure you\'re using the correct network (testnet/mainnet)\n');
    process.exit(1);
}
