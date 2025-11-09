import { useState, useEffect } from 'react';
import { Actor } from '@icp-sdk/core/agent';
import { HttpAgent } from '@icp-sdk/core/agent';
import { AuthClient } from '@dfinity/auth-client';
import { idlFactory, canisterId } from 'declarations/intentswaps_backend';
import md5 from 'md5';
import './App.css';

const network = 'local';

function App() {
  const [view, setView] = useState('swap'); // 'swap', 'orders', 'my-orders'
  const [orders, setOrders] = useState([]);
  const [myOrders, setMyOrders] = useState([]);
  const [balances, setBalances] = useState({ btc: 0n, sol: 0n });
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [connected, setConnected] = useState(false);
  const [principalText, setPrincipalText] = useState('');
  const [actor, setActor] = useState(null);
  const [authClient, setAuthClient] = useState(null);
  const [showSettings, setShowSettings] = useState(false);

  // Form states
  const [fromChain, setFromChain] = useState('Bitcoin');
  const [toChain, setToChain] = useState('Solana');
  const [fromAmount, setFromAmount] = useState('');
  const [toAmount, setToAmount] = useState('');
  const [secret, setSecret] = useState('');
  const [secretHash, setSecretHash] = useState('');
  const [timeoutMinutes, setTimeoutMinutes] = useState(60);

  // Exchange rate state
  const [exchangeRate, setExchangeRate] = useState(null);
  const [loadingRate, setLoadingRate] = useState(false);
  const [rateError, setRateError] = useState('');

  const identityProviderUrl = network === 'ic'
    ? 'https://identity.ic0.app' // Mainnet
    : `http://rdmx6-jaaaa-aaaaa-aaadq-cai.localhost:4943`; // Local

  const agentHost = network === 'ic'
    ? 'https://icp-api.io' // Mainnet
    : 'http://127.0.0.1:4943'; // Local replica

  // Initialize actor on mount with anonymous identity
  useEffect(() => {
    initializeActor();
  }, []);

  // Poll for orders when actor is available
  useEffect(() => {
    if (!actor) return;

    loadOrders();
    loadBalances();
    const interval = setInterval(() => {
      loadOrders();
      loadBalances();
    }, 5000);
    return () => clearInterval(interval);
  }, [actor]);

  // Fetch exchange rate on mount and periodically
  useEffect(() => {
    fetchExchangeRate();
    const interval = setInterval(fetchExchangeRate, 30000); // Update every 30 seconds
    return () => clearInterval(interval);
  }, []);

  const initializeActor = async () => {
    try {
      const agent = await HttpAgent.create({
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
    } catch (error) {
      console.error('Error initializing actor:', error);
      showMessage('Failed to connect to canister', true);
    }
  };

  const connect = async () => {
    try {
      const ac = await AuthClient.create();
      setAuthClient(ac);

      await ac.login({
        identityProvider: identityProviderUrl,
        onSuccess: async () => {
          const identity = ac.getIdentity();
          /*           const agent = await HttpAgent.create({
                      host: agentHost,
                      identity,
                    }); */
          const agent = new HttpAgent({
            identity,
          })

          // Fetch root key for local development
          if (network !== 'ic') {
            await agent.fetchRootKey().catch(() => { });
          }

          const authenticatedActor = Actor.createActor(idlFactory, {
            agent,
            canisterId,
          });

          setActor(authenticatedActor);
          setConnected(true);

          try {
            setPrincipalText(identity.getPrincipal().toText());
          } catch (e) {
            console.error('Error getting principal:', e);
          }

          showMessage('Connected successfully!');
        },
        onError: (error) => {
          console.error('Login error:', error);
          showMessage('Failed to connect: ' + error, true);
        },
      });
    } catch (err) {
      console.error('Error connecting auth client', err);
      showMessage('Failed to connect wallet: ' + (err.message || err), true);
    }
  };

  const disconnect = async () => {
    try {
      if (authClient) await authClient.logout();
    } catch (e) {
      console.error('Error during logout:', e);
    }

    // Re-initialize with anonymous identity
    await initializeActor();
    setConnected(false);
    setPrincipalText('');
    setAuthClient(null);
    showMessage('Disconnected');
  };

  const loadOrders = async () => {
    if (!actor) return;
    try {
      const pending = await actor.get_pending_orders();
      const mine = await actor.get_my_orders();
      setOrders(pending);
      setMyOrders(mine);
    } catch (error) {
      console.error('Error loading orders:', error);
    }
  };

  const loadBalances = async () => {
    if (!actor) return;
    try {
      const btc = await actor.get_balance({ Bitcoin: null });
      const sol = await actor.get_balance({ Solana: null });
      setBalances({ btc, sol });
    } catch (error) {
      console.error('Error loading balances:', error);
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

  // Auto-calculate toAmount when fromAmount or chains change
  useEffect(() => {
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

    if (fromChain === 'Bitcoin' && toChain === 'Solana') {
      // BTC to SOL: multiply by rate
      calculatedAmount = fromValue * exchangeRate;
    } else if (fromChain === 'Solana' && toChain === 'Bitcoin') {
      // SOL to BTC: divide by rate
      calculatedAmount = fromValue / exchangeRate;
    } else {
      // Same chain (shouldn't happen, but handle it)
      calculatedAmount = fromValue;
    }

    // Format to appropriate decimal places
    const formatted = toChain === 'Bitcoin'
      ? calculatedAmount.toFixed(8)
      : calculatedAmount.toFixed(4);

    setToAmount(formatted);
  }, [fromAmount, fromChain, toChain, exchangeRate]);

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

  const handleDeposit = async (chain, amount) => {
    if (!actor) return;
    setLoading(true);
    try {
      const chainVariant = chain === 'Bitcoin' ? { Bitcoin: null } : { Solana: null };
      const result = await actor.deposit_funds(chainVariant, BigInt(amount));

      if ('Ok' in result) {
        showMessage(result.Ok);
        await loadBalances();
      } else {
        showMessage(result.Err, true);
      }
    } catch (error) {
      showMessage('Error depositing funds: ' + error.message, true);
    }
    setLoading(false);
  };

  const handleCreateOrder = async (e) => {
    e.preventDefault();
    if (!actor) return;
    setLoading(true);

    try {
      if (!secretHash) {
        showMessage('Please generate a secret first', true);
        setLoading(false);
        return;
      }

      const fromChainVariant = fromChain === 'Bitcoin' ? { Bitcoin: null } : { Solana: null };
      const toChainVariant = toChain === 'Bitcoin' ? { Bitcoin: null } : { Solana: null };

      const request = {
        from_chain: fromChainVariant,
        to_chain: toChainVariant,
        from_amount: BigInt(Math.floor(parseFloat(fromAmount) * (fromChain === 'Bitcoin' ? 100000000 : 1000000000))),
        to_amount: BigInt(Math.floor(parseFloat(toAmount) * (toChain === 'Bitcoin' ? 100000000 : 1000000000))),
        secret_hash: secretHash,
        timeout_seconds: BigInt(timeoutMinutes * 60),
      };

      const result = await actor.create_order(request);

      if ('Ok' in result) {
        const orderId = result.Ok;
        // Store the secret for automatic reveal later
        storeSecret(orderId, secret);
        showMessage(`Order created successfully! Order ID: ${orderId}. Secret will be auto-revealed when accepted.`);
        await loadOrders();
        await loadBalances();
        // Reset form
        setFromAmount('');
        setToAmount('');
        setSecret('');
        setSecretHash('');
      } else {
        showMessage(result.Err, true);
      }
    } catch (error) {
      showMessage('Error creating order: ' + error.message, true);
    }
    setLoading(false);
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

  const formatAmount = (amount, chain) => {
    const amountNum = Number(amount);
    if (chain === 'Bitcoin') {
      return (amountNum / 100000000).toFixed(8) + ' BTC';
    } else {
      return (amountNum / 1000000000).toFixed(4) + ' SOL';
    }
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
          <div className="wallet-info">
            <div className="balance-compact">
              <span className="balance-label">BTC</span>
              <span className="balance-value">{formatAmount(balances.btc, 'Bitcoin')}</span>
            </div>
            <div className="balance-compact">
              <span className="balance-label">SOL</span>
              <span className="balance-value">{formatAmount(balances.sol, 'Solana')}</span>
            </div>
          </div>
          {connected ? (
            <div className="connected-wallet">
              <span className="wallet-address">
                {principalText ? principalText.substring(0, 6) + '...' + principalText.substring(principalText.length - 4) : 'Connected'}
              </span>
              <button className="btn-disconnect" onClick={disconnect}>Disconnect</button>
            </div>
          ) : (
            <button className="btn-connect" onClick={connect}>Connect Wallet</button>
          )}
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

              <form onSubmit={handleCreateOrder}>
                {/* From Token */}
                <div className="token-input-container">
                  <div className="token-input-header">
                    <label>You pay</label>
                    <span className="balance-display">
                      Balance: {formatAmount(
                        fromChain === 'Bitcoin' ? balances.btc : balances.sol,
                        fromChain
                      )}
                    </span>
                  </div>
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
                    <select
                      value={fromChain}
                      onChange={(e) => setFromChain(e.target.value)}
                      className="token-select"
                    >
                      <option value="Bitcoin">₿ Bitcoin</option>
                      <option value="Solana">◎ Solana</option>
                    </select>
                  </div>
                  <button
                    type="button"
                    className="deposit-btn"
                    onClick={() => {
                      const amount = prompt(`Enter amount in ${fromChain === 'Bitcoin' ? 'BTC' : 'SOL'}:`);
                      if (amount) {
                        const multiplier = fromChain === 'Bitcoin' ? 100000000 : 1000000000;
                        handleDeposit(fromChain, Math.floor(parseFloat(amount) * multiplier));
                      }
                    }}
                  >
                    + Deposit {fromChain === 'Bitcoin' ? 'BTC' : 'SOL'}
                  </button>
                </div>

                {/* Swap Arrow with Exchange Rate */}
                <div className="swap-arrow-container">
                  <button
                    type="button"
                    className="swap-arrow-btn"
                    onClick={() => {
                      const tempChain = fromChain;
                      const tempAmount = fromAmount;
                      setFromChain(toChain);
                      setFromAmount(toAmount);
                      setToChain(tempChain);
                      setToAmount(tempAmount);
                    }}
                    title="Switch tokens"
                  >
                    ⇅
                  </button>
                  {exchangeRate && (
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
                  {rateError && (
                    <div className="rate-error">{rateError}</div>
                  )}
                </div>

                {/* To Token */}
                <div className="token-input-container">
                  <div className="token-input-header">
                    <label>You receive (estimated)</label>
                    <span className="balance-display">
                      Balance: {formatAmount(
                        toChain === 'Bitcoin' ? balances.btc : balances.sol,
                        toChain
                      )}
                    </span>
                  </div>
                  <div className="token-input-row">
                    <input
                      type="number"
                      step="0.00000001"
                      value={toAmount}
                      onChange={(e) => setToAmount(e.target.value)}
                      placeholder="0.0"
                      className="amount-input calculated-amount"
                      title="Auto-calculated based on current exchange rate. You can edit this value."
                    />
                    <select
                      value={toChain}
                      onChange={(e) => setToChain(e.target.value)}
                      className="token-select"
                    >
                      <option value="Bitcoin">₿ Bitcoin</option>
                      <option value="Solana">◎ Solana</option>
                    </select>
                  </div>
                  {toAmount && (
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
                  disabled={loading || !secretHash}
                  className="btn-swap"
                >
                  {loading ? 'Creating Order...' : 'Create Swap Order'}
                </button>
              </form>
            </div>

            {/* Info Card */}
            <div className="info-card">
              <h3>💡 How it works</h3>
              <ol>
                <li>Generate a secret hash for your swap</li>
                <li>Create a swap order with your desired amounts</li>
                <li>A resolver will accept and fulfill your order</li>
                <li>Secret is automatically revealed to complete the swap ✨</li>
              </ol>
              <div className="info-feature">
                <span className="feature-badge">🤖 Automated</span>
                <p>Your secret is securely stored and automatically revealed when the order is accepted. No manual intervention needed!</p>
              </div>
              <div className="info-stats">
                <div className="stat">
                  <span className="stat-label">Network</span>
                  <span className="stat-value">Internet Computer</span>
                </div>
                <div className="stat">
                  <span className="stat-label">Total Orders</span>
                  <span className="stat-value">{orders.length + myOrders.length}</span>
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
                          {Object.keys(order.from_chain)[0] === 'Bitcoin' ? '₿' : '◎'}
                        </span>
                        <div className="token-details">
                          <div className="token-amount">
                            {formatAmount(order.from_amount, Object.keys(order.from_chain)[0])}
                          </div>
                          <div className="token-name">{Object.keys(order.from_chain)[0]}</div>
                        </div>
                      </div>

                      <div className="order-arrow">→</div>

                      <div className="order-token">
                        <span className="token-symbol">
                          {Object.keys(order.to_chain)[0] === 'Bitcoin' ? '₿' : '◎'}
                        </span>
                        <div className="token-details">
                          <div className="token-amount">
                            {formatAmount(order.to_amount, Object.keys(order.to_chain)[0])}
                          </div>
                          <div className="token-name">{Object.keys(order.to_chain)[0]}</div>
                        </div>
                      </div>
                    </div>

                    <div className="order-meta">
                      <span className="meta-label">Creator:</span>
                      <code className="meta-value">{order.creator.toString().substring(0, 12)}...</code>
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
                          {Object.keys(order.from_chain)[0] === 'Bitcoin' ? '₿' : '◎'}
                        </span>
                        <div className="token-details">
                          <div className="token-amount">
                            {formatAmount(order.from_amount, Object.keys(order.from_chain)[0])}
                          </div>
                          <div className="token-name">{Object.keys(order.from_chain)[0]}</div>
                        </div>
                      </div>

                      <div className="order-arrow">→</div>

                      <div className="order-token">
                        <span className="token-symbol">
                          {Object.keys(order.to_chain)[0] === 'Bitcoin' ? '₿' : '◎'}
                        </span>
                        <div className="token-details">
                          <div className="token-amount">
                            {formatAmount(order.to_amount, Object.keys(order.to_chain)[0])}
                          </div>
                          <div className="token-name">{Object.keys(order.to_chain)[0]}</div>
                        </div>
                      </div>
                    </div>

                    {order.resolver[0] && (
                      <div className="order-meta">
                        <span className="meta-label">Resolver:</span>
                        <code className="meta-value">{order.resolver[0].toString().substring(0, 12)}...</code>
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
