use crate::{bitcoin_integration, solana_integration, storage::*, types::*};
use ic_cdk::api::time;

/// Helper function to verify deposit based on asset type
async fn verify_asset_deposit(
    asset: &Asset,
    canister_address: &str,
    amount: u64,
    txid: String,
) -> Result<bool, String> {
    match asset {
        Asset::Bitcoin => {
            bitcoin_integration::verify_bitcoin_transaction(
                canister_address.to_string(),
                amount,
                txid,
            )
            .await
        }
        Asset::Solana => {
            solana_integration::verify_solana_transaction(
                canister_address.to_string(),
                amount,
                txid,
            )
            .await
        }
        Asset::SplToken { mint_address, .. } => {
            solana_integration::verify_spl_token_transaction(
                canister_address.to_string(),
                amount,
                mint_address.clone(),
                txid,
            )
            .await
        }
    }
}

/// Helper function to send asset based on type
async fn send_asset(asset: &Asset, to_address: &str, amount: u64) -> Result<String, String> {
    match asset {
        Asset::Bitcoin => bitcoin_integration::send_bitcoin(to_address.to_string(), amount).await,
        Asset::Solana => solana_integration::send_solana(to_address.to_string(), amount).await,
        Asset::SplToken { mint_address, .. } => {
            solana_integration::send_spl_token(to_address.to_string(), amount, mint_address.clone())
                .await
        }
    }
}

/// Get the appropriate address for receiving an asset
fn get_receive_address(
    asset: &Asset,
    btc_addr: Option<&String>,
    sol_addr: Option<&String>,
) -> Result<String, String> {
    match asset {
        Asset::Bitcoin => Ok(btc_addr.ok_or("Bitcoin address not provided")?.clone()),
        Asset::Solana | Asset::SplToken { .. } => {
            Ok(sol_addr.ok_or("Solana address not provided")?.clone())
        }
    }
}

/// Create a new swap order
#[ic_cdk::update]
pub async fn create_order(
    request: OrderRequest,
    creator_btc_address: Option<String>,
    creator_sol_address: Option<String>,
) -> Result<(u64, CanisterAddresses), String> {
    let caller = ic_cdk::api::msg_caller();
    let current_time = time();

    let order_id = generate_order_id();

    let order = Order {
        id: order_id,
        creator: caller,
        creator_btc_address,
        creator_sol_address,
        from_asset: request.from_asset,
        to_asset: request.to_asset,
        from_amount: request.from_amount,
        to_amount: request.to_amount,
        secret_hash: request.secret_hash,
        secret: None,
        status: OrderStatus::AwaitingDeposit,
        resolver: None,
        resolver_btc_address: None,
        resolver_sol_address: None,
        created_at: current_time,
        expires_at: current_time + (request.timeout_seconds * 1_000_000_000),
        creator_txid: None,
        resolver_txid: None,
        creator_deposited: false,
        resolver_deposited: false,
    };

    ORDERS.with(|orders| {
        orders.borrow_mut().insert(order_id, order);
    });

    let canister_addresses = get_canister_addresses().await?;

    Ok((order_id, canister_addresses))
}

/// Confirm creator's deposit
#[ic_cdk::update]
pub async fn confirm_deposit(order_id: u64, txid: String) -> Result<String, String> {
    let caller = ic_cdk::api::caller();

    let order = ORDERS
        .with(|orders| orders.borrow().get(&order_id).cloned())
        .ok_or("Order not found")?;

    if order.creator != caller {
        return Err("Only order creator can confirm deposit".to_string());
    }

    if order.creator_deposited {
        return Err("Deposit already confirmed".to_string());
    }

    let canister_address = match &order.from_asset {
        Asset::Bitcoin => CANISTER_BTC_ADDRESS
            .with(|addr| addr.borrow().clone())
            .ok_or("Canister Bitcoin address not initialized")?,
        Asset::Solana | Asset::SplToken { .. } => CANISTER_SOL_ADDRESS
            .with(|addr| addr.borrow().clone())
            .ok_or("Canister Solana address not initialized")?,
    };

    let verified = verify_asset_deposit(
        &order.from_asset,
        &canister_address,
        order.from_amount,
        txid.clone(),
    )
    .await?;

    if !verified {
        return Err("Transaction not found or insufficient amount".to_string());
    }

    ORDERS.with(|orders| {
        if let Some(ord) = orders.borrow_mut().get_mut(&order_id) {
            ord.creator_txid = Some(txid);
            ord.creator_deposited = true;
            ord.status = OrderStatus::DepositReceived;
        }
    });

    Ok("Deposit confirmed! Order is now visible to resolvers.".to_string())
}

/// Resolver accepts an order
#[ic_cdk::update]
pub async fn accept_order(
    order_id: u64,
    resolver_btc_address: Option<String>,
    resolver_sol_address: Option<String>,
) -> Result<CanisterAddresses, String> {
    let caller = ic_cdk::api::caller();

    let order = ORDERS
        .with(|orders| orders.borrow().get(&order_id).cloned())
        .ok_or("Order not found")?;

    if !matches!(order.status, OrderStatus::DepositReceived) {
        return Err("Order not ready for acceptance".to_string());
    }

    // Check if resolver is trying to use the same wallet addresses as creator
    // This prevents self-dealing while allowing the same ICP principal to resolve
    if let Some(ref creator_btc) = order.creator_btc_address {
        if let Some(ref resolver_btc) = resolver_btc_address {
            if creator_btc == resolver_btc {
                return Err("Cannot accept order with your own Bitcoin address".to_string());
            }
        }
    }
    
    if let Some(ref creator_sol) = order.creator_sol_address {
        if let Some(ref resolver_sol) = resolver_sol_address {
            if creator_sol == resolver_sol {
                return Err("Cannot accept order with your own Solana address".to_string());
            }
        }
    }

    let canister_addresses = get_canister_addresses().await?;

    ORDERS.with(|orders| {
        if let Some(ord) = orders.borrow_mut().get_mut(&order_id) {
            ord.resolver = Some(caller);
            ord.resolver_btc_address = resolver_btc_address;
            ord.resolver_sol_address = resolver_sol_address;
        }
    });

    Ok(canister_addresses)
}

/// Resolver confirms their deposit
#[ic_cdk::update]
pub async fn confirm_resolver_deposit(order_id: u64, txid: String) -> Result<String, String> {
    let caller = ic_cdk::api::caller();

    let order = ORDERS
        .with(|orders| orders.borrow().get(&order_id).cloned())
        .ok_or("Order not found")?;

    if order.resolver != Some(caller) {
        return Err("Only resolver can confirm their deposit".to_string());
    }

    if order.resolver_deposited {
        return Err("Resolver deposit already confirmed".to_string());
    }

    let canister_address = match &order.to_asset {
        Asset::Bitcoin => CANISTER_BTC_ADDRESS
            .with(|addr| addr.borrow().clone())
            .ok_or("Canister Bitcoin address not initialized")?,
        Asset::Solana | Asset::SplToken { .. } => CANISTER_SOL_ADDRESS
            .with(|addr| addr.borrow().clone())
            .ok_or("Canister Solana address not initialized")?,
    };

    let verified = verify_asset_deposit(
        &order.to_asset,
        &canister_address,
        order.to_amount,
        txid.clone(),
    )
    .await?;

    if !verified {
        return Err("Transaction not found or insufficient amount".to_string());
    }

    ORDERS.with(|orders| {
        if let Some(ord) = orders.borrow_mut().get_mut(&order_id) {
            ord.resolver_txid = Some(txid);
            ord.resolver_deposited = true;
            ord.status = OrderStatus::ResolverDeposited;
        }
    });

    Ok("Resolver deposit confirmed!".to_string())
}

/// Reveal secret to complete the swap
#[ic_cdk::update]
pub async fn reveal_secret(order_id: u64, secret: String) -> Result<String, String> {
    let caller = ic_cdk::api::caller();
    let current_time = time();

    let order = ORDERS
        .with(|orders| orders.borrow().get(&order_id).cloned())
        .ok_or("Order not found")?;

    if order.creator != caller {
        return Err("Only order creator can reveal secret".to_string());
    }

    if !matches!(order.status, OrderStatus::ResolverDeposited) {
        return Err("Resolver has not deposited funds yet".to_string());
    }

    if current_time >= order.expires_at {
        return Err("Order has expired".to_string());
    }

    let secret_hash = format!("{:x}", md5::compute(&secret));
    if secret_hash != order.secret_hash {
        return Err("Secret does not match hash".to_string());
    }

    ic_cdk::println!("🔓 Secret verified for order {}. Starting atomic swap...", order_id);

    // Execute the atomic swap
    let resolver_address = get_receive_address(
        &order.from_asset,
        order.resolver_btc_address.as_ref(),
        order.resolver_sol_address.as_ref(),
    )?;

    ic_cdk::println!("💸 Sending {:?} (amount: {}) to resolver at {}", order.from_asset, order.from_amount, resolver_address);
    let resolver_tx = send_asset(&order.from_asset, &resolver_address, order.from_amount).await?;
    ic_cdk::println!("✅ Resolver payment sent successfully! TXID: {}", resolver_tx);

    let creator_address = get_receive_address(
        &order.to_asset,
        order.creator_btc_address.as_ref(),
        order.creator_sol_address.as_ref(),
    )?;

    ic_cdk::println!("💸 Sending {:?} (amount: {}) to creator at {}", order.to_asset, order.to_amount, creator_address);
    let creator_tx = send_asset(&order.to_asset, &creator_address, order.to_amount).await?;
    ic_cdk::println!("✅ Creator payment sent successfully! TXID: {}", creator_tx);

    ORDERS.with(|orders| {
        if let Some(ord) = orders.borrow_mut().get_mut(&order_id) {
            ord.secret = Some(secret);
            ord.status = OrderStatus::Completed;
        }
    });

    Ok(format!(
        "Swap completed! Transactions: Resolver: {}, Creator: {}",
        resolver_tx, creator_tx
    ))
}

/// Cancel an order and process refunds
#[ic_cdk::update]
pub async fn cancel_order(order_id: u64) -> Result<String, String> {
    let caller = ic_cdk::api::caller();

    let order = ORDERS
        .with(|orders| orders.borrow().get(&order_id).cloned())
        .ok_or("Order not found")?;

    if order.creator != caller {
        return Err("Only order creator can cancel the order".to_string());
    }

    match order.status {
        OrderStatus::Completed => {
            return Err("Cannot cancel completed order".to_string());
        }
        OrderStatus::Cancelled => {
            return Err("Order already cancelled".to_string());
        }
        _ => {}
    }

    if order.resolver_deposited {
        return Err(
            "Cannot cancel after resolver has deposited. Wait for expiry to process refund."
                .to_string(),
        );
    }

    ORDERS.with(|orders| {
        if let Some(ord) = orders.borrow_mut().get_mut(&order_id) {
            ord.status = OrderStatus::Cancelled;
        }
    });

    if order.creator_deposited {
        let refund_tx = process_refund_internal(&order, true, false).await?;
        return Ok(format!(
            "Order cancelled. Refund transaction: {}",
            refund_tx
        ));
    }

    Ok("Order cancelled successfully. No deposits to refund.".to_string())
}

/// Process refund for an expired or cancelled order
#[ic_cdk::update]
pub async fn process_refund(order_id: u64) -> Result<String, String> {
    let current_time = time();

    let order = ORDERS
        .with(|orders| orders.borrow().get(&order_id).cloned())
        .ok_or("Order not found")?;

    if current_time < order.expires_at {
        return Err("Order has not expired yet. Cannot process refund.".to_string());
    }

    match order.status {
        OrderStatus::Completed => {
            return Err("Order completed successfully. No refund needed.".to_string());
        }
        OrderStatus::Cancelled => {}
        _ => {}
    }

    let refund_creator = order.creator_deposited;
    let refund_resolver = order.resolver_deposited;

    if !refund_creator && !refund_resolver {
        return Err("No deposits to refund".to_string());
    }

    let refund_message = process_refund_internal(&order, refund_creator, refund_resolver).await?;

    ORDERS.with(|orders| {
        if let Some(ord) = orders.borrow_mut().get_mut(&order_id) {
            ord.status = OrderStatus::Cancelled;
        }
    });

    Ok(format!("Refund processed: {}", refund_message))
}

/// Internal function to process refunds
async fn process_refund_internal(
    order: &Order,
    refund_creator: bool,
    refund_resolver: bool,
) -> Result<String, String> {
    let mut refund_txs = Vec::new();

    if refund_creator {
        let creator_address = get_receive_address(
            &order.from_asset,
            order.creator_btc_address.as_ref(),
            order.creator_sol_address.as_ref(),
        )?;
        let creator_refund_tx =
            send_asset(&order.from_asset, &creator_address, order.from_amount).await?;
        refund_txs.push(format!("Creator refund: {}", creator_refund_tx));
    }

    if refund_resolver {
        let resolver_address = get_receive_address(
            &order.to_asset,
            order.resolver_btc_address.as_ref(),
            order.resolver_sol_address.as_ref(),
        )?;
        let resolver_refund_tx =
            send_asset(&order.to_asset, &resolver_address, order.to_amount).await?;
        refund_txs.push(format!("Resolver refund: {}", resolver_refund_tx));
    }

    if refund_txs.is_empty() {
        return Err("No refunds processed".to_string());
    }

    Ok(refund_txs.join(", "))
}

pub async fn get_canister_addresses() -> Result<CanisterAddresses, String> {
    let btc_address = CANISTER_BTC_ADDRESS.with(|addr| addr.borrow().clone());
    let sol_address = CANISTER_SOL_ADDRESS.with(|addr| addr.borrow().clone());

    let btc_address = if let Some(addr) = btc_address {
        addr
    } else {
        let addr = bitcoin_integration::get_canister_btc_address().await?;
        CANISTER_BTC_ADDRESS.with(|a| *a.borrow_mut() = Some(addr.clone()));
        addr
    };

    let sol_address = if let Some(addr) = sol_address {
        addr
    } else {
        let principal = ic_cdk::api::id();
        let addr = solana_integration::get_canister_sol_address(principal).await?;
        CANISTER_SOL_ADDRESS.with(|a| *a.borrow_mut() = Some(addr.clone()));
        addr
    };

    Ok(CanisterAddresses {
        bitcoin_address: btc_address,
        solana_address: sol_address,
    })
}
