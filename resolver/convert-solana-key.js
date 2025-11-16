#!/usr/bin/env node
/**
 * Solana Private Key Converter
 * 
 * Helps convert Solana private keys between different formats
 * Usage: node convert-solana-key.js <your-private-key>
 */

import { Keypair } from '@solana/web3.js';
import bs58 from 'bs58';

const privateKey = process.argv[2];

if (!privateKey) {
    console.log('❌ No private key provided\n');
    console.log('Usage: node convert-solana-key.js <your-private-key>\n');
    console.log('Examples:');
    console.log('  From Phantom (base58):');
    console.log('    node convert-solana-key.js 5Jk8pq2W...\n');
    console.log('  From keypair file:');
    console.log('    node convert-solana-key.js "[1,2,3,...]"\n');
    process.exit(1);
}

try {
    const cleanKey = privateKey.trim().replace(/['"]/g, ''); // Remove quotes
    let secretKey;
    let format;

    // Detect and parse format
    if (cleanKey.startsWith('[')) {
        // JSON array
        secretKey = new Uint8Array(JSON.parse(cleanKey));
        format = 'JSON array';
    } else if (cleanKey.includes(',')) {
        // Comma-separated
        const numbers = cleanKey.split(',').map(n => parseInt(n.trim()));
        secretKey = new Uint8Array(numbers);
        format = 'Comma-separated';
    } else if (cleanKey.length === 128) {
        // Hex
        secretKey = new Uint8Array(Buffer.from(cleanKey, 'hex'));
        format = 'Hex';
    } else {
        // Assume base58
        secretKey = bs58.decode(cleanKey);
        format = 'Base58';
    }

    // Validate length
    if (secretKey.length !== 64) {
        throw new Error(`Invalid key length: ${secretKey.length} bytes (expected 64)`);
    }

    // Create keypair
    const keypair = Keypair.fromSecretKey(secretKey);
    const publicKey = keypair.publicKey.toBase58();

    console.log('\n✅ Private key successfully parsed!\n');
    console.log('Input format:', format);
    console.log('Public key:', publicKey);
    console.log('\n📋 For .env file, use any of these formats:\n');
    console.log('1. JSON array (recommended):');
    console.log(`   SOL_PRIVATE_KEY=[${Array.from(secretKey).join(',')}]`);
    console.log('\n2. Base58 (from Phantom):');
    console.log(`   SOL_PRIVATE_KEY=${bs58.encode(secretKey)}`);
    console.log('\n3. Hex:');
    console.log(`   SOL_PRIVATE_KEY=${Buffer.from(secretKey).toString('hex')}`);
    console.log('\n💡 Tip: Copy the JSON array format above and paste directly into your .env file\n');

} catch (error) {
    console.error('\n❌ Error:', error.message);
    console.error('\nMake sure your private key is in one of these formats:');
    console.error('  - Base58: 5Jk8pq2W... (from Phantom wallet)');
    console.error('  - JSON array: [1,2,3,...] (from id.json file)');
    console.error('  - Hex: abc123... (128 characters)');
    console.error('  - Comma-separated: 1,2,3,...\n');
    process.exit(1);
}
