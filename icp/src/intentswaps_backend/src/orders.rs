use crate::{
    bitcoin_integration, solana_integration,
    storage::*,
    types::*,
};
use ic_cdk::api::time;

/// Create a new swap order
#[ic_cdk::update]
pub async fn create_order(
    request: OrderRequest,
    creator_btc_address: Option<String>,
    creator_sol_address: Option<String>,
) -> Result<(u64, CanisterAddresses), String> {
    let caller = ic_cdk::api::caller();
    let current_time = time();

    let order_id = generate_order_id();

    let order = Order {
        id: order_id,
        creator: caller,
        creator_btc_address,
        creator_sol_address,
        from_chain: request.from_chain,
        to_chain: request.to_chain,
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

    let canister_address = match order.from_chain {
        Chain::Bitcoin => CANISTER_BTC_ADDRESS
            .with(|addr| addr.borrow().clone())
            .ok_or("Canister Bitcoin address not initialized")?,
        Chain::Solana => CANISTER_SOL_ADDRESS
            .with(|addr| addr.borrow().clone())
            .ok_or("Canister Solana address not initialized")?,
    };

    let verified = match order.from_chain {
        Chain::Bitcoin => {
            bitcoin_integration::verify_bitcoin_transaction(
                canister_address,
                order.from_amount,
                txid.clone(),
            )
            .await?
        }
        Chain::Solana => {
            solana_integration::verify_solana_transaction(canister_address, order.from_amount, txid.clone())
                .await?
        }
    };

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

    if order.creator == caller {
        return Err("Cannot accept your own order".to_string());
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

    let canister_address = match order.to_chain {
        Chain::Bitcoin => CANISTER_BTC_ADDRESS
            .with(|addr| addr.borrow().clone())
            .ok_or("Canister Bitcoin address not initialized")?,
        Chain::Solana => CANISTER_SOL_ADDRESS
            .with(|addr| addr.borrow().clone())
            .ok_or("Canister Solana address not initialized")?,
    };

    let verified = match order.to_chain {
        Chain::Bitcoin => {
            bitcoin_integration::verify_bitcoin_transaction(canister_address, order.to_amount, txid.clone())
                .await?
        }
        Chain::Solana => {
            solana_integration::verify_solana_transaction(canister_address, order.to_amount, txid.clone())
                .await?
        }
    };

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

    // Execute the atomic swap
    let resolver_tx = match order.from_chain {
        Chain::Bitcoin => {
            let resolver_btc_address = order
                .resolver_btc_address
                .as_ref()
                .ok_or("Resolver Bitcoin address not provided")?;
            bitcoin_integration::send_bitcoin(resolver_btc_address.clone(), order.from_amount).await?
        }
        Chain::Solana => {
            let resolver_sol_address = order
                .resolver_sol_address
                .as_ref()
                .ok_or("Resolver Solana address not provided")?;
            solana_integration::send_solana(resolver_sol_address.clone(), order.from_amount).await?
        }
    };

    let creator_tx = match order.to_chain {
        Chain::Bitcoin => {
            let creator_btc_address = order
                .creator_btc_address
                .as_ref()
                .ok_or("Creator Bitcoin address not provided")?;
            bitcoin_integration::send_bitcoin(creator_btc_address.clone(), order.to_amount).await?
        }
        Chain::Solana => {
            let creator_sol_address = order
                .creator_sol_address
                .as_ref()
                .ok_or("Creator Solana address not provided")?;
            solana_integration::send_solana(creator_sol_address.clone(), order.to_amount).await?
        }
    };

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
        return Err("Cannot cancel after resolver has deposited. Wait for expiry to process refund.".to_string());
    }

    ORDERS.with(|orders| {
        if let Some(ord) = orders.borrow_mut().get_mut(&order_id) {
            ord.status = OrderStatus::Cancelled;
        }
    });

    if order.creator_deposited {
        let refund_tx = process_refund_internal(&order, true, false).await?;
        return Ok(format!("Order cancelled. Refund transaction: {}", refund_tx));
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
        let creator_refund_tx = match order.from_chain {
            Chain::Bitcoin => {
                let creator_address = order
                    .creator_btc_address
                    .as_ref()
                    .ok_or("Creator Bitcoin address not available for refund")?;
                bitcoin_integration::send_bitcoin(creator_address.clone(), order.from_amount).await?
            }
            Chain::Solana => {
                let creator_address = order
                    .creator_sol_address
                    .as_ref()
                    .ok_or("Creator Solana address not available for refund")?;
                solana_integration::send_solana(creator_address.clone(), order.from_amount).await?
            }
        };
        refund_txs.push(format!("Creator refund: {}", creator_refund_tx));
    }

    if refund_resolver {
        let resolver_refund_tx = match order.to_chain {
            Chain::Bitcoin => {
                let resolver_address = order
                    .resolver_btc_address
                    .as_ref()
                    .ok_or("Resolver Bitcoin address not available for refund")?;
                bitcoin_integration::send_bitcoin(resolver_address.clone(), order.to_amount).await?
            }
            Chain::Solana => {
                let resolver_address = order
                    .resolver_sol_address
                    .as_ref()
                    .ok_or("Resolver Solana address not available for refund")?;
                solana_integration::send_solana(resolver_address.clone(), order.to_amount).await?
            }
        };
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
