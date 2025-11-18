import { useState, useEffect } from 'react';
import { Actor, HttpAgent } from '@dfinity/agent';
import { idlFactory, canisterId } from 'declarations/intentswaps_backend';
import md5 from 'md5';
import './App.css';

const network = 'local';

function App() {
    const [view, setView] = useState('swap'); // 'swap', 'orders', 'my-orders'
    const [orders, setOrders] = useState([]);
    const [myOrders, setMyOrders] = useState([]);
    const [loading, setLoading] = useState(false);
    const [message, setMessage] = useState('');
    const [actor, setActor] = useState(null);
    const [showSettings, setShowSettings] = useState(false);

    // Wallet states
    const [phantomWallet, setPhantomWallet] = useState(null);
    const [phantomAddress, setPhantomAddress] = useState('');
    const [phantomBalance, setPhantomBalance] = useState(0);
    const [unisatWallet, setUnisatWallet] = useState(null);
    const [unisatAddress, setUnisatAddress] = useState('');
    const [unisatBalance, setUnisatBalance] = useState(0);
    const [walletConnecting, setWalletConnecting] = useState(false);

    // Form states - now using Asset enum
    const [fromAssetType, setFromAssetType] = useState('Bitcoin'); // 'Bitcoin', 'Solana', 'SplToken'
    const [toAssetType, setToAssetType] = useState('Solana');
    const [fromAmount, setFromAmount] = useState('');
    const [toAmount, setToAmount] = useState('');
    const [secret, setSecret] = useState('');
    const [secretHash, setSecretHash] = useState('');
    const [timeoutMinutes, setTimeoutMinutes] = useState(60);

    // SPL Token specific fields
    const [fromMintAddress, setFromMintAddress] = useState('');
    const [fromDecimals, setFromDecimals] = useState(9);
    const [toMintAddress, setToMintAddress] = useState('');
    const [toDecimals, setToDecimals] = useState(9);

    // Exchange rate state
    const [exchangeRate, setExchangeRate] = useState(null);
    const [loadingRate, setLoadingRate] = useState(false);
    const [rateError, setRateError] = useState('');

    const agentHost = network === 'ic'
        ? 'https://icp-api.io' // Mainnet
        : 'http://127.0.0.1:4943'; // Local replica

    // Initialize anonymous actor on mount
    useEffect(() => {
        initializeActor();
        checkWalletAvailability();
    }, []);

    // Check if wallets are available
    const checkWalletAvailability = () => {
        // Check for Phantom
        if (window.solana?.isPhantom) {
            console.log('Phantom wallet detected');
        }
        // Check for Unisat
        if (window.unisat) {
            console.log('Unisat wallet detected');
        }
    };

    // Poll for orders when actor is available
    useEffect(() => {
        if (!actor) return;

        loadOrders();
        const interval = setInterval(() => {
            loadOrders();
        }, 5000);
        return () => clearInterval(interval);
    }, [actor]);

    // Poll wallet balances when wallets are connected
    useEffect(() => {
        if (phantomWallet && phantomAddress) {
            loadPhantomBalance();
            const interval = setInterval(loadPhantomBalance, 10000); // Every 10 seconds
            return () => clearInterval(interval);
        }
    }, [phantomWallet, phantomAddress]);

    useEffect(() => {
        if (unisatWallet && unisatAddress) {
            loadUnisatBalance();
            const interval = setInterval(loadUnisatBalance, 30000); // Every 30 seconds
            return () => clearInterval(interval);
        }
    }, [unisatWallet, unisatAddress]);

    // Fetch exchange rate on mount and periodically
    useEffect(() => {
        fetchExchangeRate();
        const interval = setInterval(fetchExchangeRate, 30000); // Update every 30 seconds
        return () => clearInterval(interval);
    }, []);

    const initializeActor = async () => {
        try {
            // Create anonymous agent (no identity needed)
            const agent = new HttpAgent({
                host: agentHost,
            });

            // Fetch root key for local development
            if (network !== 'ic') {
                await agent.fetchRootKey().catch(() => { });
            }

            const backendActor = Actor.createActor(idlFactory, {
                agent,
                canisterId,
            });

            setActor(backendActor);
            console.log('Anonymous actor initialized');
        } catch (error) {
            console.error('Error initializing actor:', error);
            showMessage('Failed to connect to canister', true);
        }
    };

    // Connect Phantom Wallet
    const connectPhantom = async () => {
        if (!window.solana?.isPhantom) {
            showMessage('Phantom wallet not found! Please install it from phantom.app', true);
            window.open('https://phantom.app/', '_blank');
            return;
        }

        setWalletConnecting(true);
        try {
            console.log('Connecting to Phantom...');
            const response = await window.phantom.solana.connect();
            console.log('Phantom connected:', response);
            const address = response.publicKey.toString();
            setPhantomWallet(window.phantom.solana);
            setPhantomAddress(address);
            showMessage(`Phantom connected: ${address.substring(0, 8)}...`);

            // Load balance immediately after connecting
            setTimeout(async () => {
                try {
                    const { Connection, PublicKey, LAMPORTS_PER_SOL } = await import('@solana/web3.js');
                    const connection = new Connection('https://api.devnet.solana.com', 'confirmed');
                    const publicKey = new PublicKey(address);
                    const balance = await connection.getBalance(publicKey);
                    const solBalance = balance / LAMPORTS_PER_SOL;
                    setPhantomBalance(solBalance);
                } catch (error) {
                    console.error('Error loading initial Phantom balance:', error);
                }
            }, 500);

            // Listen for account changes
            window.phantom.solana.on('accountChanged', (publicKey) => {
                if (publicKey) {
                    const newAddress = publicKey.toString();
                    setPhantomAddress(newAddress);
                    setPhantomBalance(0); // Reset balance until loaded
                    showMessage(`Phantom account changed to: ${newAddress.substring(0, 8)}...`);
                } else {
                    setPhantomWallet(null);
                    setPhantomAddress('');
                    setPhantomBalance(0);
                    showMessage('Phantom disconnected');
                }
            });
        } catch (error) {
            console.error('Phantom connection error:', error);
            showMessage('Failed to connect Phantom wallet: ' + error.message, true);
        }
        setWalletConnecting(false);
    };

    // Disconnect Phantom
    const disconnectPhantom = async () => {
        if (phantomWallet) {
            try {
                await phantomWallet.disconnect();
            } catch (error) {
                console.error('Error disconnecting Phantom:', error);
            }
        }
        setPhantomWallet(null);
        setPhantomAddress('');
        setPhantomBalance(0);
        showMessage('Phantom disconnected');
    };

    // Connect Unisat Wallet
    const connectUnisat = async () => {
        if (!window.unisat) {
            showMessage('Unisat wallet not found! Please install it from unisat.io', true);
            window.open('https://unisat.io/', '_blank');
            return;
        }

        setWalletConnecting(true);
        try {
            // Request accounts
            const accounts = await window.unisat.requestAccounts();
            if (accounts.length > 0) {
                const address = accounts[0];
                setUnisatWallet(window.unisat);
                setUnisatAddress(address);

                // Switch to testnet
                try {
                    await window.unisat.switchNetwork('testnet');
                    showMessage(`Unisat connected (Testnet): ${address.substring(0, 8)}...`);
                } catch (switchError) {
                    console.warn('Could not switch to testnet:', switchError);
                    showMessage(`Unisat connected: ${address.substring(0, 8)}... (Please ensure you're on Testnet)`, true);
                }

                // Load balance immediately after connecting
                setTimeout(async () => {
                    try {
                        const balance = await window.unisat.getBalance();
                        const btcBalance = balance.total / 100000000;
                        setUnisatBalance(btcBalance);
                    } catch (error) {
                        console.error('Error loading initial Unisat balance:', error);
                    }
                }, 500);

                // Listen for account changes
                window.unisat.on('accountsChanged', (accounts) => {
                    if (accounts.length > 0) {
                        const newAddress = accounts[0];
                        setUnisatAddress(newAddress);
                        setUnisatBalance(0); // Reset balance until loaded
                        showMessage(`Unisat account changed to: ${newAddress.substring(0, 8)}...`);
                    } else {
                        setUnisatWallet(null);
                        setUnisatAddress('');
                        setUnisatBalance(0);
                        showMessage('Unisat disconnected');
                    }
                });
            }
        } catch (error) {
            console.error('Unisat connection error:', error);
            showMessage('Failed to connect Unisat wallet: ' + error.message, true);
        }
        setWalletConnecting(false);
    };

    // Disconnect Unisat
    const disconnectUnisat = () => {
        setUnisatWallet(null);
        setUnisatAddress('');
        setUnisatBalance(0);
        showMessage('Unisat disconnected');
    };

    const loadOrders = async () => {
        if (!actor) return;
        try {
            const allPending = await actor.get_pending_orders();

            // "Orders" view shows ALL pending orders (for resolvers to see available swaps)
            setOrders(allPending);

            // "My Orders" view shows only orders created BY or accepted BY the current user's wallets
            if (unisatAddress || phantomAddress) {
                const myFilteredOrders = allPending.filter(order => {
                    // Check if this order was created by current wallet addresses
                    const creatorBtcAddr = order.creator_btc_address;
                    const creatorSolAddr = order.creator_sol_address;

                    // Check if this order was accepted by current wallet addresses (resolver)
                    const resolverBtcAddr = order.resolver_btc_address;
                    const resolverSolAddr = order.resolver_sol_address;

                    const isCreator = (unisatAddress && creatorBtcAddr === unisatAddress) ||
                        (phantomAddress && creatorSolAddr === phantomAddress);

                    const isResolver = (unisatAddress && resolverBtcAddr === unisatAddress) ||
                        (phantomAddress && resolverSolAddr === phantomAddress);

                    return isCreator || isResolver;
                });
                setMyOrders(myFilteredOrders);
            } else {
                setMyOrders([]);
            }
        } catch (error) {
            console.error('Error loading orders:', error);
        }
    };

    // Load Phantom (Solana) wallet balance
    const loadPhantomBalance = async () => {
        if (!phantomWallet || !phantomAddress) return;

        try {
            const { Connection, PublicKey, LAMPORTS_PER_SOL } = await import('@solana/web3.js');
            const connection = new Connection('https://api.devnet.solana.com', 'confirmed');
            const publicKey = new PublicKey(phantomAddress);
            const balance = await connection.getBalance(publicKey);
            const solBalance = balance / LAMPORTS_PER_SOL;
            setPhantomBalance(solBalance);
            console.log(`Phantom balance: ${solBalance} SOL`);
        } catch (error) {
            console.error('Error loading Phantom balance:', error);
        }
    };

    // Load Unisat (Bitcoin) wallet balance
    const loadUnisatBalance = async () => {
        if (!unisatWallet || !unisatAddress) return;

        try {
            const balance = await unisatWallet.getBalance();
            const btcBalance = balance.total / 100000000; // Convert satoshis to BTC
            setUnisatBalance(btcBalance);
            console.log(`Unisat balance: ${btcBalance} BTC`);
        } catch (error) {
            console.error('Error loading Unisat balance:', error);
        }
    };

    // Fetch BTC/SOL exchange rate from public APIs
    const fetchExchangeRate = async () => {
        setLoadingRate(true);
        setRateError('');
        try {
            // Try CoinGecko API first
            const response = await fetch(
                'https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,solana&vs_currencies=usd'
            );

            if (!response.ok) throw new Error('Failed to fetch rates');

            const data = await response.json();
            const btcPrice = data.bitcoin?.usd;
            const solPrice = data.solana?.usd;

            if (btcPrice && solPrice) {
                // Calculate BTC/SOL rate (how many SOL per 1 BTC)
                const rate = btcPrice / solPrice;
                setExchangeRate(rate);
                console.log(`Exchange rate updated: 1 BTC = ${rate.toFixed(2)} SOL`);
            } else {
                throw new Error('Invalid price data');
            }
        } catch (error) {
            console.error('Error fetching exchange rate:', error);
            setRateError('Unable to fetch live rates');
            // Set a fallback rate if needed
            setExchangeRate(3600); // Approximate fallback
        } finally {
            setLoadingRate(false);
        }
    };

    // Auto-calculate toAmount when fromAmount or assets change
    useEffect(() => {
        // Only auto-calculate for BTC <-> SOL swaps
        if (fromAssetType === 'SplToken' || toAssetType === 'SplToken') {
            // For SPL tokens, user must enter manually
            return;
        }

        if (!fromAmount || !exchangeRate) {
            setToAmount('');
            return;
        }

        const fromValue = parseFloat(fromAmount);
        if (isNaN(fromValue) || fromValue <= 0) {
            setToAmount('');
            return;
        }

        let calculatedAmount;

        if (fromAssetType === 'Bitcoin' && toAssetType === 'Solana') {
            // BTC to SOL: multiply by rate
            calculatedAmount = fromValue * exchangeRate;
        } else if (fromAssetType === 'Solana' && toAssetType === 'Bitcoin') {
            // SOL to BTC: divide by rate
            calculatedAmount = fromValue / exchangeRate;
        } else {
            // Same asset (shouldn't happen, but handle it)
            calculatedAmount = fromValue;
        }

        // Format to appropriate decimal places
        const formatted = toAssetType === 'Bitcoin'
            ? calculatedAmount.toFixed(8)
            : calculatedAmount.toFixed(4);

        setToAmount(formatted);
    }, [fromAmount, fromAssetType, toAssetType, exchangeRate]);

    const generateSecret = () => {
        const randomSecret = Math.random().toString(36).substring(2, 15) +
            Math.random().toString(36).substring(2, 15);
        setSecret(randomSecret);

        // Use MD5 hash to match backend verification
        const hash = md5(randomSecret);
        setSecretHash(hash);
        showMessage('Secret generated! It will be automatically revealed when your order is accepted.');
    };

    // Store secret in localStorage when order is created
    const storeSecret = (orderId, secret) => {
        try {
            const secrets = JSON.parse(localStorage.getItem('orderSecrets') || '{}');
            secrets[orderId.toString()] = secret;
            localStorage.setItem('orderSecrets', JSON.stringify(secrets));
        } catch (error) {
            console.error('Error storing secret:', error);
        }
    };

    // Retrieve secret from localStorage
    const getStoredSecret = (orderId) => {
        try {
            const secrets = JSON.parse(localStorage.getItem('orderSecrets') || '{}');
            return secrets[orderId.toString()] || null;
        } catch (error) {
            console.error('Error retrieving secret:', error);
            return null;
        }
    };

    // Remove secret from localStorage after revealing
    const removeStoredSecret = (orderId) => {
        try {
            const secrets = JSON.parse(localStorage.getItem('orderSecrets') || '{}');
            delete secrets[orderId.toString()];
            localStorage.setItem('orderSecrets', JSON.stringify(secrets));
        } catch (error) {
            console.error('Error removing secret:', error);
        }
    };

    // Automatically reveal secrets for accepted orders
    useEffect(() => {
        if (!actor || !myOrders.length) return;

        const autoRevealSecrets = async () => {
            for (const order of myOrders) {
                const orderId = Number(order.id);
                const status = Object.keys(order.status)[0];

                // If order is accepted and we have the secret stored
                if (status === 'Accepted') {
                    const storedSecret = getStoredSecret(orderId);
                    if (storedSecret) {
                        console.log(`Auto-revealing secret for order ${orderId}`);
                        try {
                            const result = await actor.reveal_secret(BigInt(orderId), storedSecret);
                            if ('Ok' in result) {
                                showMessage(`Secret automatically revealed for Order #${orderId}!`);
                                removeStoredSecret(orderId);
                                await loadOrders();
                                await loadBalances();
                            } else {
                                console.error(`Failed to reveal secret for order ${orderId}:`, result.Err);
                            }
                        } catch (error) {
                            console.error(`Error auto-revealing secret for order ${orderId}:`, error);
                        }
                    }
                }
            }
        };

        autoRevealSecrets();
    }, [myOrders, actor]);

    const showMessage = (msg, isError = false) => {
        setMessage(msg);
        setTimeout(() => setMessage(''), 5000);
    };



    const handleCreateOrder = async (e) => {
        e.preventDefault();
        if (!actor) return;

        // Validate wallet connections based on asset types
        if (fromAssetType === 'Bitcoin' && !unisatAddress) {
            showMessage('Please connect your Unisat wallet first', true);
            return;
        }
        if ((fromAssetType === 'Solana' || fromAssetType === 'SplToken') && !phantomAddress) {
            showMessage('Please connect your Phantom wallet first', true);
            return;
        }
        if (toAssetType === 'Bitcoin' && !unisatAddress) {
            showMessage('Please connect your Unisat wallet to receive BTC', true);
            return;
        }
        if ((toAssetType === 'Solana' || toAssetType === 'SplToken') && !phantomAddress) {
            showMessage('Please connect your Phantom wallet to receive tokens', true);
            return;
        }

        // Validate SPL token fields
        if (fromAssetType === 'SplToken' && !fromMintAddress) {
            showMessage('Please enter the SPL token mint address', true);
            return;
        }
        if (toAssetType === 'SplToken' && !toMintAddress) {
            showMessage('Please enter the SPL token mint address', true);
            return;
        }

        setLoading(true);

        try {
            if (!secretHash) {
                showMessage('Please generate a secret first', true);
                setLoading(false);
                return;
            }

            // Build Asset variants based on asset type
            const fromAssetVariant = fromAssetType === 'Bitcoin'
                ? { Bitcoin: null }
                : fromAssetType === 'Solana'
                    ? { Solana: null }
                    : { SplToken: { mint_address: fromMintAddress, decimals: fromDecimals } };

            const toAssetVariant = toAssetType === 'Bitcoin'
                ? { Bitcoin: null }
                : toAssetType === 'Solana'
                    ? { Solana: null }
                    : { SplToken: { mint_address: toMintAddress, decimals: toDecimals } };

            // Calculate smallest unit multiplier based on asset type
            const fromMultiplier = fromAssetType === 'Bitcoin'
                ? 100000000 // satoshis
                : fromAssetType === 'Solana'
                    ? 1000000000 // lamports
                    : Math.pow(10, fromDecimals); // token atoms

            const toMultiplier = toAssetType === 'Bitcoin'
                ? 100000000
                : toAssetType === 'Solana'
                    ? 1000000000
                    : Math.pow(10, toDecimals);

            const request = {
                from_asset: fromAssetVariant,
                to_asset: toAssetVariant,
                from_amount: BigInt(Math.floor(parseFloat(fromAmount) * fromMultiplier)),
                to_amount: BigInt(Math.floor(parseFloat(toAmount) * toMultiplier)),
                secret_hash: secretHash,
                timeout_seconds: BigInt(timeoutMinutes * 60),
            };

            // Pass user's wallet addresses to backend
            const creatorBtcAddr = unisatAddress ? [unisatAddress] : [];
            const creatorSolAddr = phantomAddress ? [phantomAddress] : [];

            showMessage('Creating order on canister...');
            const result = await actor.create_order(request, creatorBtcAddr, creatorSolAddr);

            if ('Ok' in result) {
                const [orderId, canisterAddresses] = result.Ok;

                // Store the secret for automatic reveal later
                storeSecret(orderId, secret);

                showMessage(`Order #${orderId} created! Now sending funds from your wallet...`);

                // Now send the transaction from user's wallet
                let txid;
                try {
                    if (fromAssetType === 'Bitcoin') {
                        txid = await sendBitcoinTransaction(
                            canisterAddresses.bitcoin_address,
                            parseFloat(fromAmount)
                        );
                    } else if (fromAssetType === 'Solana') {
                        txid = await sendSolanaTransaction(
                            canisterAddresses.solana_address,
                            parseFloat(fromAmount)
                        );
                    } else {
                        // SPL Token
                        txid = await sendSplTokenTransaction(
                            canisterAddresses.solana_address,
                            parseFloat(fromAmount),
                            fromMintAddress,
                            fromDecimals
                        );
                    }

                    if (txid) {
                        showMessage(`Transaction sent! Confirming deposit... (txid: ${txid.substring(0, 10)}...)`);

                        // Confirm the deposit with the canister
                        const confirmResult = await actor.confirm_deposit(BigInt(orderId), txid);

                        if ('Ok' in confirmResult) {
                            showMessage(`✅ Order #${orderId} created and deposit confirmed! Waiting for resolver...`);
                            await loadOrders();
                            // Reload wallet balances
                            if (fromAssetType === 'Bitcoin') {
                                await loadUnisatBalance();
                            } else {
                                await loadPhantomBalance();
                            }
                            // Reset form
                            setFromAmount('');
                            setToAmount('');
                            setSecret('');
                            setSecretHash('');
                        } else {
                            showMessage(`Order created but deposit confirmation failed: ${confirmResult.Err}. Please confirm manually with txid: ${txid}`, true);
                        }
                    }
                } catch (txError) {
                    const depositAddress = fromAssetType === 'Bitcoin'
                        ? canisterAddresses.bitcoin_address
                        : canisterAddresses.solana_address;
                    showMessage(`Order #${orderId} created but transaction failed: ${txError.message}. Please send funds manually to: ${depositAddress}`, true);
                }
            } else {
                showMessage(result.Err, true);
            }
        } catch (error) {
            showMessage('Error creating order: ' + error.message, true);
        }
        setLoading(false);
    };

    // Send Bitcoin transaction via Unisat
    const sendBitcoinTransaction = async (toAddress, amountBTC) => {
        if (!unisatWallet) {
            throw new Error('Unisat wallet not connected');
        }

        try {
            // Convert BTC to satoshis
            const amountSatoshis = Math.floor(amountBTC * 100000000);

            showMessage('Please confirm the Bitcoin transaction in your Unisat wallet...');

            // Send transaction using Unisat API
            const txid = await unisatWallet.sendBitcoin(toAddress, amountSatoshis);

            console.log('Bitcoin transaction sent:', txid);
            return txid;
        } catch (error) {
            console.error('Bitcoin transaction error:', error);
            if (error.message?.includes('User rejected')) {
                throw new Error('Transaction cancelled by user');
            }
            throw new Error('Bitcoin transaction failed: ' + error.message);
        }
    };

    // Send Solana transaction via Phantom
    const sendSolanaTransaction = async (toAddress, amountSOL) => {
        if (!phantomWallet) {
            throw new Error('Phantom wallet not connected');
        }

        try {
            // Import Solana web3 dynamically
            const { Connection, PublicKey, SystemProgram, Transaction, LAMPORTS_PER_SOL } = await import('@solana/web3.js');

            // Connect to Solana devnet
            const connection = new Connection('https://api.devnet.solana.com', 'confirmed');

            // Convert SOL to lamports
            const amountLamports = Math.floor(amountSOL * LAMPORTS_PER_SOL);

            // Create transaction
            const transaction = new Transaction().add(
                SystemProgram.transfer({
                    fromPubkey: phantomWallet.publicKey,
                    toPubkey: new PublicKey(toAddress),
                    lamports: amountLamports,
                })
            );

            // Get recent blockhash
            transaction.feePayer = phantomWallet.publicKey;
            const { blockhash } = await connection.getLatestBlockhash();
            transaction.recentBlockhash = blockhash;

            showMessage('Please confirm the Solana transaction in your Phantom wallet...');

            // Sign and send transaction via Phantom
            const signed = await phantomWallet.signAndSendTransaction(transaction);
            const txid = signed.signature;

            console.log('Solana transaction sent:', txid);

            // Wait for confirmation
            showMessage('Waiting for Solana transaction confirmation...');
            await connection.confirmTransaction(txid);

            return txid;
        } catch (error) {
            console.error('Solana transaction error:', error);
            if (error.message?.includes('User rejected')) {
                throw new Error('Transaction cancelled by user');
            }
            throw new Error('Solana transaction failed: ' + error.message);
        }
    };

    // Send SPL Token transaction via Phantom
    const sendSplTokenTransaction = async (toAddress, amountTokens, mintAddress, decimals) => {
        if (!phantomWallet) {
            throw new Error('Phantom wallet not connected');
        }

        try {
            // Import Solana web3 and SPL Token dynamically
            const { Connection, PublicKey, Transaction, SystemProgram } = await import('@solana/web3.js');
            const {
                getAssociatedTokenAddress,
                createAssociatedTokenAccountInstruction,
                createTransferInstruction,
                TOKEN_PROGRAM_ID,
                ASSOCIATED_TOKEN_PROGRAM_ID,
                getAccount
            } = await import('@solana/spl-token');

            // Connect to Solana devnet
            const connection = new Connection('https://api.devnet.solana.com', 'confirmed');

            // Convert token amount to smallest unit
            const amountAtoms = Math.floor(amountTokens * Math.pow(10, decimals));

            const mintPubkey = new PublicKey(mintAddress);
            const fromPubkey = phantomWallet.publicKey;
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

            console.log('From ATA:', fromATA.toString());
            console.log('To ATA:', toATA.toString());

            // Create transaction
            const transaction = new Transaction();

            // Check if destination ATA exists, if not create it
            try {
                await getAccount(connection, toATA, 'confirmed');
                console.log('Destination ATA exists');
            } catch (ataError) {
                if (ataError.name === 'TokenAccountNotFoundError') {
                    console.log('Destination ATA does not exist, will create it');
                    // Add instruction to create the ATA
                    transaction.add(
                        createAssociatedTokenAccountInstruction(
                            fromPubkey, // payer
                            toATA, // ata
                            toPubkey, // owner
                            mintPubkey, // mint
                            TOKEN_PROGRAM_ID,
                            ASSOCIATED_TOKEN_PROGRAM_ID
                        )
                    );
                    showMessage('Creating token account for receiver...');
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
                    amountAtoms,
                    [],
                    TOKEN_PROGRAM_ID
                )
            );

            // Get recent blockhash
            transaction.feePayer = fromPubkey;
            const { blockhash } = await connection.getLatestBlockhash();
            transaction.recentBlockhash = blockhash;

            showMessage('Please confirm the SPL token transfer in your Phantom wallet...');

            // Sign and send transaction via Phantom
            const signed = await phantomWallet.signAndSendTransaction(transaction);


            const txid = signed.signature;

            console.log('SPL Token transaction sent:', txid);

            // Wait for confirmation
            showMessage('Waiting for SPL token transaction confirmation...');
            await connection.confirmTransaction(txid);

            return txid;
        } catch (error) {
            console.error('SPL Token transaction error:', error);
            if (error.message?.includes('User rejected')) {
                throw new Error('Transaction cancelled by user');
            }
            throw new Error('SPL Token transaction failed: ' + error.message);
        }
    };

    const handleRevealSecret = async (orderId) => {
        if (!actor) return;

        // Try to get stored secret first
        let secretToReveal = secret || getStoredSecret(orderId);

        if (!secretToReveal) {
            showMessage('No secret found for this order', true);
            return;
        }

        setLoading(true);
        try {
            const result = await actor.reveal_secret(BigInt(orderId), secretToReveal);

            if ('Ok' in result) {
                showMessage(result.Ok);
                removeStoredSecret(orderId);
                await loadOrders();
                await loadBalances();
                setSecret('');
            } else {
                showMessage(result.Err, true);
            }
        } catch (error) {
            showMessage('Error revealing secret: ' + error.message, true);
        }
        setLoading(false);
    };

    const handleCancelOrder = async (orderId) => {
        if (!actor) return;
        setLoading(true);
        try {
            const result = await actor.cancel_order(BigInt(orderId));

            if ('Ok' in result) {
                showMessage(result.Ok);
                await loadOrders();
                await loadBalances();
            } else {
                showMessage(result.Err, true);
            }
        } catch (error) {
            showMessage('Error cancelling order: ' + error.message, true);
        }
        setLoading(false);
    };

    const formatAmount = (amount, asset) => {
        const amountNum = Number(amount);

        // Handle different asset types
        if (asset.Bitcoin !== undefined) {
            return (amountNum / 100000000).toFixed(8) + ' BTC';
        } else if (asset.Solana !== undefined) {
            return (amountNum / 1000000000).toFixed(4) + ' SOL';
        } else if (asset.SplToken !== undefined) {
            const decimals = asset.SplToken.decimals;
            const formatted = (amountNum / Math.pow(10, decimals)).toFixed(decimals);
            const shortMint = asset.SplToken.mint_address.substring(0, 6);
            return `${formatted} (${shortMint}...)`;
        }
        return amountNum.toString();
    };

    const getAssetSymbol = (asset) => {
        if (asset.Bitcoin !== undefined) return '₿';
        if (asset.Solana !== undefined) return '◎';
        if (asset.SplToken !== undefined) return '🪙';
        return '?';
    };

    const getAssetName = (asset) => {
        if (asset.Bitcoin !== undefined) return 'Bitcoin';
        if (asset.Solana !== undefined) return 'Solana';
        if (asset.SplToken !== undefined) {
            const shortMint = asset.SplToken.mint_address.substring(0, 8);
            return `SPL (${shortMint}...)`;
        }
        return 'Unknown';
    };

    const getStatusColor = (status) => {
        const statusKey = Object.keys(status)[0];
        switch (statusKey) {
            case 'Pending': return '#ffa500';
            case 'Accepted': return '#4169e1';
            case 'Completed': return '#32cd32';
            case 'Cancelled': return '#dc143c';
            case 'Expired': return '#808080';
            default: return '#ffffff';
        }
    };

    return (
        <div className="app">
            {/* Top Navigation Bar */}
            <nav className="navbar">
                <div className="nav-left">
                    <div className="logo">
                        <span className="logo-icon">🔄</span>
                        <span className="logo-text">IntentSwaps</span>
                    </div>
                    <div className="nav-links">
                        <button
                            className={view === 'swap' ? 'nav-link active' : 'nav-link'}
                            onClick={() => setView('swap')}
                        >
                            Swap
                        </button>
                        <button
                            className={view === 'orders' ? 'nav-link active' : 'nav-link'}
                            onClick={() => setView('orders')}
                        >
                            Orders
                            {orders.length > 0 && <span className="badge">{orders.length}</span>}
                        </button>
                        <button
                            className={view === 'my-orders' ? 'nav-link active' : 'nav-link'}
                            onClick={() => setView('my-orders')}
                        >
                            My Orders
                            {myOrders.length > 0 && <span className="badge">{myOrders.length}</span>}
                        </button>
                    </div>
                </div>

                <div className="nav-right">
                    {/* External Wallets */}
                    <div className="external-wallets">
                        {/* Bitcoin Wallet */}
                        {unisatAddress ? (
                            <div className="wallet-connected bitcoin">
                                <div className="wallet-info-top">
                                    <span className="wallet-icon">₿</span>
                                    <span className="wallet-address-short">
                                        {unisatAddress.substring(0, 6)}...{unisatAddress.substring(unisatAddress.length - 4)}
                                    </span>
                                    <button className="btn-disconnect-small" onClick={disconnectUnisat} title="Disconnect Unisat">×</button>
                                </div>
                                <div className="wallet-balance-display">
                                    {unisatBalance.toFixed(8)} BTC
                                </div>
                            </div>
                        ) : (
                            <button
                                className="btn-connect-wallet bitcoin"
                                onClick={connectUnisat}
                                disabled={walletConnecting}
                                title="Connect Unisat (Bitcoin Testnet)"
                            >
                                ₿ Unisat
                            </button>
                        )}

                        {/* Solana Wallet */}
                        {phantomAddress ? (
                            <div className="wallet-connected solana">
                                <div className="wallet-info-top">
                                    <span className="wallet-icon">◎</span>
                                    <span className="wallet-address-short">
                                        {phantomAddress.substring(0, 6)}...{phantomAddress.substring(phantomAddress.length - 4)}
                                    </span>
                                    <button className="btn-disconnect-small" onClick={disconnectPhantom} title="Disconnect Phantom">×</button>
                                </div>
                                <div className="wallet-balance-display">
                                    {phantomBalance.toFixed(4)} SOL
                                </div>
                            </div>
                        ) : (
                            <button
                                className="btn-connect-wallet solana"
                                onClick={connectPhantom}
                                disabled={walletConnecting}
                                title="Connect Phantom (Solana Devnet)"
                            >
                                ◎ Phantom
                            </button>
                        )}
                    </div>

                </div>
            </nav>

            {/* Main Content Area */}
            <main className="main-content">
                {message && (
                    <div className={`message ${message.includes('Error') || message.includes('failed') ? 'error' : 'success'}`}>
                        {message}
                    </div>
                )}

                {/* Swap View */}
                {view === 'swap' && (
                    <div className="swap-container">
                        <div className="swap-card">
                            <div className="swap-header">
                                <h2>Swap</h2>
                                <button
                                    className="settings-btn"
                                    onClick={() => setShowSettings(!showSettings)}
                                    title="Settings"
                                >
                                    ⚙️
                                </button>
                            </div>

                            {showSettings && (
                                <div className="settings-panel">
                                    <div className="setting-item">
                                        <label>Timeout (minutes)</label>
                                        <input
                                            type="number"
                                            value={timeoutMinutes}
                                            onChange={(e) => setTimeoutMinutes(parseInt(e.target.value))}
                                            min="5"
                                        />
                                    </div>
                                </div>
                            )}

                            {/* Wallet Connection Notice */}
                            {(!unisatAddress || !phantomAddress) && (
                                <div className="wallet-notice">
                                    <div className="notice-icon">🔐</div>
                                    <div className="notice-content">
                                        <h4>Connect Your Wallets</h4>
                                        <p>You need to connect both wallets to create swaps:</p>
                                        <div className="wallet-requirements">
                                            {!unisatAddress && (
                                                <div className="wallet-requirement">
                                                    <span className="requirement-icon">₿</span>
                                                    <span>Unisat wallet for Bitcoin (Testnet)</span>
                                                    <button className="btn-connect-inline" onClick={connectUnisat}>
                                                        Connect Unisat
                                                    </button>
                                                </div>
                                            )}
                                            {!phantomAddress && (
                                                <div className="wallet-requirement">
                                                    <span className="requirement-icon">◎</span>
                                                    <span>Phantom wallet for Solana (Devnet)</span>
                                                    <button className="btn-connect-inline" onClick={connectPhantom}>
                                                        Connect Phantom
                                                    </button>
                                                </div>
                                            )}
                                        </div>
                                        <p className="notice-info">
                                            💡 Your wallet addresses are used to send deposits and receive swapped funds
                                        </p>
                                    </div>
                                </div>
                            )}

                            <form onSubmit={handleCreateOrder}>
                                {/* From Asset */}
                                <div className="token-input-container">
                                    <div className="token-input-header">
                                        <label>You pay</label>
                                        <span className="balance-display">
                                            Balance: {fromAssetType === 'Bitcoin'
                                                ? `${unisatBalance.toFixed(8)} BTC`
                                                : `${phantomBalance.toFixed(4)} SOL`}
                                        </span>
                                    </div>

                                    {/* Asset Type Selector */}
                                    <div className="asset-type-selector">
                                        <label className="radio-option">
                                            <input
                                                type="radio"
                                                name="fromAssetType"
                                                value="Bitcoin"
                                                checked={fromAssetType === 'Bitcoin'}
                                                onChange={(e) => setFromAssetType(e.target.value)}
                                            />
                                            <span>₿ Bitcoin</span>
                                        </label>
                                        <label className="radio-option">
                                            <input
                                                type="radio"
                                                name="fromAssetType"
                                                value="Solana"
                                                checked={fromAssetType === 'Solana'}
                                                onChange={(e) => setFromAssetType(e.target.value)}
                                            />
                                            <span>◎ Solana</span>
                                        </label>
                                        <label className="radio-option">
                                            <input
                                                type="radio"
                                                name="fromAssetType"
                                                value="SplToken"
                                                checked={fromAssetType === 'SplToken'}
                                                onChange={(e) => setFromAssetType(e.target.value)}
                                            />
                                            <span>🪙 SPL Token</span>
                                        </label>
                                    </div>

                                    {/* SPL Token Fields */}
                                    {fromAssetType === 'SplToken' && (
                                        <div className="spl-token-fields">
                                            <input
                                                type="text"
                                                value={fromMintAddress}
                                                onChange={(e) => setFromMintAddress(e.target.value)}
                                                placeholder="Token Mint Address (e.g., EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v for USDC)"
                                                className="mint-address-input"
                                                required={fromAssetType === 'SplToken'}
                                            />
                                            <input
                                                type="number"
                                                value={fromDecimals}
                                                onChange={(e) => setFromDecimals(parseInt(e.target.value))}
                                                placeholder="Decimals"
                                                min="0"
                                                max="18"
                                                className="decimals-input"
                                                required={fromAssetType === 'SplToken'}
                                            />
                                            <div className="popular-tokens">
                                                <span className="popular-label">Popular:</span>
                                                <button
                                                    type="button"
                                                    className="token-shortcut"
                                                    onClick={() => {
                                                        setFromMintAddress('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');
                                                        setFromDecimals(6);
                                                    }}
                                                >
                                                    USDC
                                                </button>
                                                <button
                                                    type="button"
                                                    className="token-shortcut"
                                                    onClick={() => {
                                                        setFromMintAddress('Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB');
                                                        setFromDecimals(6);
                                                    }}
                                                >
                                                    USDT
                                                </button>
                                            </div>
                                        </div>
                                    )}

                                    <div className="token-input-row">
                                        <input
                                            type="number"
                                            step="0.00000001"
                                            value={fromAmount}
                                            onChange={(e) => setFromAmount(e.target.value)}
                                            placeholder="0.0"
                                            className="amount-input"
                                            required
                                        />
                                    </div>
                                </div>

                                {/* Swap Arrow with Exchange Rate */}
                                <div className="swap-arrow-container">
                                    <button
                                        type="button"
                                        className="swap-arrow-btn"
                                        onClick={() => {
                                            const tempAssetType = fromAssetType;
                                            const tempAmount = fromAmount;
                                            const tempMint = fromMintAddress;
                                            const tempDecimals = fromDecimals;

                                            setFromAssetType(toAssetType);
                                            setFromAmount(toAmount);
                                            setFromMintAddress(toMintAddress);
                                            setFromDecimals(toDecimals);

                                            setToAssetType(tempAssetType);
                                            setToAmount(tempAmount);
                                            setToMintAddress(tempMint);
                                            setToDecimals(tempDecimals);
                                        }}
                                        title="Switch tokens"
                                    >
                                        ⇅
                                    </button>
                                    {exchangeRate && fromAssetType !== 'SplToken' && toAssetType !== 'SplToken' && (
                                        <div className="exchange-rate-display">
                                            {loadingRate ? (
                                                <span className="rate-loading">Updating rate...</span>
                                            ) : (
                                                <>
                                                    <span className="rate-label">Rate:</span>
                                                    <span className="rate-value">
                                                        1 BTC = {exchangeRate.toFixed(2)} SOL
                                                    </span>
                                                </>
                                            )}
                                        </div>
                                    )}
                                    {rateError && fromAssetType !== 'SplToken' && toAssetType !== 'SplToken' && (
                                        <div className="rate-error">{rateError}</div>
                                    )}
                                    {(fromAssetType === 'SplToken' || toAssetType === 'SplToken') && (
                                        <div className="spl-rate-notice">
                                            💡 Manual pricing for SPL tokens - set your desired exchange rate
                                        </div>
                                    )}
                                </div>

                                {/* To Asset */}
                                <div className="token-input-container">
                                    <div className="token-input-header">
                                        <label>You receive</label>
                                        <span className="balance-display">
                                            Balance: {toAssetType === 'Bitcoin'
                                                ? `${unisatBalance.toFixed(8)} BTC`
                                                : `${phantomBalance.toFixed(4)} SOL`}
                                        </span>
                                    </div>

                                    {/* Asset Type Selector */}
                                    <div className="asset-type-selector">
                                        <label className="radio-option">
                                            <input
                                                type="radio"
                                                name="toAssetType"
                                                value="Bitcoin"
                                                checked={toAssetType === 'Bitcoin'}
                                                onChange={(e) => setToAssetType(e.target.value)}
                                            />
                                            <span>₿ Bitcoin</span>
                                        </label>
                                        <label className="radio-option">
                                            <input
                                                type="radio"
                                                name="toAssetType"
                                                value="Solana"
                                                checked={toAssetType === 'Solana'}
                                                onChange={(e) => setToAssetType(e.target.value)}
                                            />
                                            <span>◎ Solana</span>
                                        </label>
                                        <label className="radio-option">
                                            <input
                                                type="radio"
                                                name="toAssetType"
                                                value="SplToken"
                                                checked={toAssetType === 'SplToken'}
                                                onChange={(e) => setToAssetType(e.target.value)}
                                            />
                                            <span>🪙 SPL Token</span>
                                        </label>
                                    </div>

                                    {/* SPL Token Fields */}
                                    {toAssetType === 'SplToken' && (
                                        <div className="spl-token-fields">
                                            <input
                                                type="text"
                                                value={toMintAddress}
                                                onChange={(e) => setToMintAddress(e.target.value)}
                                                placeholder="Token Mint Address (e.g., EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v for USDC)"
                                                className="mint-address-input"
                                                required={toAssetType === 'SplToken'}
                                            />
                                            <input
                                                type="number"
                                                value={toDecimals}
                                                onChange={(e) => setToDecimals(parseInt(e.target.value))}
                                                placeholder="Decimals"
                                                min="0"
                                                max="18"
                                                className="decimals-input"
                                                required={toAssetType === 'SplToken'}
                                            />
                                            <div className="popular-tokens">
                                                <span className="popular-label">Popular:</span>
                                                <button
                                                    type="button"
                                                    className="token-shortcut"
                                                    onClick={() => {
                                                        setToMintAddress('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');
                                                        setToDecimals(6);
                                                    }}
                                                >
                                                    USDC
                                                </button>
                                                <button
                                                    type="button"
                                                    className="token-shortcut"
                                                    onClick={() => {
                                                        setToMintAddress('Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB');
                                                        setToDecimals(6);
                                                    }}
                                                >
                                                    USDT
                                                </button>
                                            </div>
                                        </div>
                                    )}

                                    <div className="token-input-row">
                                        <input
                                            type="number"
                                            step="0.00000001"
                                            value={toAmount}
                                            onChange={(e) => setToAmount(e.target.value)}
                                            placeholder="0.0"
                                            className="amount-input"
                                            required
                                        />
                                    </div>
                                    {toAmount && fromAssetType !== 'SplToken' && toAssetType !== 'SplToken' && (
                                        <div className="auto-calc-indicator">
                                            <span>💡</span> Auto-calculated at current market rate
                                        </div>
                                    )}
                                </div>

                                {/* Secret Section */}
                                <div className="secret-container">
                                    {!secret ? (
                                        <button
                                            type="button"
                                            onClick={generateSecret}
                                            className="btn-generate-secret"
                                        >
                                            🔐 Generate Secret Hash
                                        </button>
                                    ) : (
                                        <div className="secret-display">
                                            <div className="secret-label">
                                                🔐 Your Secret (save this!)
                                            </div>
                                            <code className="secret-code">{secret}</code>
                                            <div className="secret-hash">
                                                Hash: {secretHash}
                                            </div>
                                        </div>
                                    )}
                                </div>

                                {/* Submit Button */}
                                <button
                                    type="submit"
                                    disabled={loading || !secretHash || !unisatAddress || !phantomAddress}
                                    className="btn-swap"
                                >
                                    {loading ? 'Processing...' :
                                        !unisatAddress || !phantomAddress ? 'Connect Both Wallets First' :
                                            !secretHash ? 'Generate Secret First' :
                                                'Create Swap & Send Deposit'}
                                </button>
                                {(unisatAddress && phantomAddress) && (
                                    <div className="swap-info-text">
                                        ✓ Transaction will be sent from your wallet automatically
                                    </div>
                                )}
                            </form>
                        </div>

                        {/* Info Card */}
                        <div className="info-card">
                            <h3>💡 How it works</h3>
                            <ol>
                                <li>Connect both Unisat (Bitcoin) and Phantom (Solana) wallets</li>
                                <li>Choose assets: Bitcoin, Solana, or any SPL token</li>
                                <li>Generate a secret hash for your swap</li>
                                <li>Create order - your wallet automatically sends the deposit</li>
                                <li>A resolver accepts and fulfills your order</li>
                                <li>Secret is auto-revealed and you receive funds in your wallet ✨</li>
                            </ol>
                            <div className="info-feature">
                                <span className="feature-badge">🔐 Non-Custodial</span>
                                <p>You maintain full control of your funds. Your wallet signs all transactions, and the canister verifies them on-chain.</p>
                            </div>
                            <div className="info-feature">
                                <span className="feature-badge">🤖 Automated</span>
                                <p>Deposits are sent automatically from your wallet. Secrets are revealed automatically. Just connect and swap!</p>
                            </div>
                            <div className="info-feature">
                                <span className="feature-badge">🪙 SPL Token Support</span>
                                <p>Swap Bitcoin with ANY Solana SPL token! Support for USDC, USDT, BONK, and any custom token by mint address.</p>
                            </div>
                            <div className="info-stats">
                                <div className="stat">
                                    <span className="stat-label">Network</span>
                                    <span className="stat-value">BTC Testnet • SOL Devnet</span>
                                </div>
                                <div className="stat">
                                    <span className="stat-label">Active Orders</span>
                                    <span className="stat-value">{orders.length}</span>
                                </div>
                                <div className="stat">
                                    <span className="stat-label">Assets</span>
                                    <span className="stat-value">BTC • SOL • SPL Tokens</span>
                                </div>
                            </div>
                        </div>
                    </div>
                )}

                {/* Pending Orders View */}
                {view === 'orders' && (
                    <div className="orders-view">
                        <div className="orders-header">
                            <h2>Pending Orders</h2>
                            <p className="orders-subtitle">Available swaps waiting for resolvers</p>
                        </div>

                        {orders.length === 0 ? (
                            <div className="empty-state">
                                <div className="empty-icon">📭</div>
                                <h3>No pending orders</h3>
                                <p>Create a swap order to get started</p>
                                <button className="btn-primary" onClick={() => setView('swap')}>
                                    Create Order
                                </button>
                            </div>
                        ) : (
                            <div className="orders-grid">
                                {orders.map(order => (
                                    <div key={Number(order.id)} className="order-card">
                                        <div className="order-card-header">
                                            <div className="order-id">Order #{Number(order.id)}</div>
                                            <span
                                                className="order-status"
                                                style={{ backgroundColor: getStatusColor(order.status) }}
                                            >
                                                {Object.keys(order.status)[0]}
                                            </span>
                                        </div>

                                        <div className="order-swap-info">
                                            <div className="order-token">
                                                <span className="token-symbol">
                                                    {getAssetSymbol(order.from_asset)}
                                                </span>
                                                <div className="token-details">
                                                    <div className="token-amount">
                                                        {formatAmount(order.from_amount, order.from_asset)}
                                                    </div>
                                                    <div className="token-name">{getAssetName(order.from_asset)}</div>
                                                </div>
                                            </div>

                                            <div className="order-arrow">→</div>

                                            <div className="order-token">
                                                <span className="token-symbol">
                                                    {getAssetSymbol(order.to_asset)}
                                                </span>
                                                <div className="token-details">
                                                    <div className="token-amount">
                                                        {formatAmount(order.to_amount, order.to_asset)}
                                                    </div>
                                                    <div className="token-name">{getAssetName(order.to_asset)}</div>
                                                </div>
                                            </div>
                                        </div>

                                        <div className="order-meta">
                                            {order.creator_btc_address?.[0] && (
                                                <div>
                                                    <span className="meta-label">Creator BTC:</span>
                                                    <code className="meta-value">{order.creator_btc_address[0].substring(0, 8)}...{order.creator_btc_address[0].substring(order.creator_btc_address[0].length - 4)}</code>
                                                </div>
                                            )}
                                            {order.creator_sol_address?.[0] && (
                                                <div>
                                                    <span className="meta-label">Creator SOL:</span>
                                                    <code className="meta-value">{order.creator_sol_address[0].substring(0, 8)}...{order.creator_sol_address[0].substring(order.creator_sol_address[0].length - 4)}</code>
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                )}

                {/* My Orders View */}
                {view === 'my-orders' && (
                    <div className="orders-view">
                        <div className="orders-header">
                            <h2>My Orders</h2>
                            <p className="orders-subtitle">Track your swap orders</p>
                        </div>

                        {myOrders.length === 0 ? (
                            <div className="empty-state">
                                <div className="empty-icon">📋</div>
                                <h3>No orders yet</h3>
                                <p>Your created orders will appear here</p>
                                <button className="btn-primary" onClick={() => setView('swap')}>
                                    Create Order
                                </button>
                            </div>
                        ) : (
                            <div className="orders-grid">
                                {myOrders.map(order => (
                                    <div key={Number(order.id)} className="order-card my-order">
                                        <div className="order-card-header">
                                            <div className="order-id">Order #{Number(order.id)}</div>
                                            <span
                                                className="order-status"
                                                style={{ backgroundColor: getStatusColor(order.status) }}
                                            >
                                                {Object.keys(order.status)[0]}
                                            </span>
                                        </div>

                                        <div className="order-swap-info">
                                            <div className="order-token">
                                                <span className="token-symbol">
                                                    {getAssetSymbol(order.from_asset)}
                                                </span>
                                                <div className="token-details">
                                                    <div className="token-amount">
                                                        {formatAmount(order.from_amount, order.from_asset)}
                                                    </div>
                                                    <div className="token-name">{getAssetName(order.from_asset)}</div>
                                                </div>
                                            </div>

                                            <div className="order-arrow">→</div>

                                            <div className="order-token">
                                                <span className="token-symbol">
                                                    {getAssetSymbol(order.to_asset)}
                                                </span>
                                                <div className="token-details">
                                                    <div className="token-amount">
                                                        {formatAmount(order.to_amount, order.to_asset)}
                                                    </div>
                                                    <div className="token-name">{getAssetName(order.to_asset)}</div>
                                                </div>
                                            </div>
                                        </div>

                                        {(order.resolver_btc_address?.[0] || order.resolver_sol_address?.[0]) && (
                                            <div className="order-meta">
                                                {order.resolver_btc_address?.[0] && (
                                                    <div>
                                                        <span className="meta-label">Resolver BTC:</span>
                                                        <code className="meta-value">{order.resolver_btc_address[0].substring(0, 8)}...{order.resolver_btc_address[0].substring(order.resolver_btc_address[0].length - 4)}</code>
                                                    </div>
                                                )}
                                                {order.resolver_sol_address?.[0] && (
                                                    <div>
                                                        <span className="meta-label">Resolver SOL:</span>
                                                        <code className="meta-value">{order.resolver_sol_address[0].substring(0, 8)}...{order.resolver_sol_address[0].substring(order.resolver_sol_address[0].length - 4)}</code>
                                                    </div>
                                                )}
                                            </div>
                                        )}

                                        <div className="order-actions">
                                            {Object.keys(order.status)[0] === 'Accepted' && getStoredSecret(Number(order.id)) && (
                                                <div className="auto-reveal-status">
                                                    <div className="status-indicator">
                                                        <span className="spinner">⏳</span>
                                                        <span>Secret will be automatically revealed...</span>
                                                    </div>
                                                    <button
                                                        onClick={() => handleRevealSecret(Number(order.id))}
                                                        disabled={loading}
                                                        className="btn-reveal-manual"
                                                    >
                                                        {loading ? 'Revealing...' : 'Reveal Now'}
                                                    </button>
                                                </div>
                                            )}
                                            {Object.keys(order.status)[0] === 'Accepted' && !getStoredSecret(Number(order.id)) && (
                                                <div className="reveal-secret-section">
                                                    <input
                                                        type="text"
                                                        placeholder="Enter your secret to complete swap"
                                                        value={secret}
                                                        onChange={(e) => setSecret(e.target.value)}
                                                        className="secret-input"
                                                    />
                                                    <button
                                                        onClick={() => handleRevealSecret(Number(order.id))}
                                                        disabled={loading}
                                                        className="btn-reveal"
                                                    >
                                                        {loading ? 'Revealing...' : 'Reveal Secret'}
                                                    </button>
                                                </div>
                                            )}
                                            {Object.keys(order.status)[0] === 'Pending' && (
                                                <div className="pending-order-actions">
                                                    {getStoredSecret(Number(order.id)) && (
                                                        <div className="secret-stored-indicator">
                                                            <span>✓</span> Secret secured - will auto-reveal when accepted
                                                        </div>
                                                    )}
                                                    <button
                                                        onClick={() => handleCancelOrder(Number(order.id))}
                                                        disabled={loading}
                                                        className="btn-cancel"
                                                    >
                                                        {loading ? 'Canceling...' : 'Cancel Order'}
                                                    </button>
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                )}
            </main>
        </div>
    );
}

export default App;
