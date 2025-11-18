use crate::types::{Chain, Order, OrderInfo};
use candid::Principal;
use ic_cdk::api::time;
use std::cell::RefCell;
use std::collections::HashMap;

// Storage
thread_local! {
    pub static ORDERS: RefCell<HashMap<u64, Order>> = RefCell::new(HashMap::new());
    pub static NEXT_ORDER_ID: RefCell<u64> = RefCell::new(1);
    pub static CANISTER_BTC_ADDRESS: RefCell<Option<String>> = RefCell::new(None);
    pub static CANISTER_SOL_ADDRESS: RefCell<Option<String>> = RefCell::new(None);
}

// Helper functions
pub fn generate_order_id() -> u64 {
    NEXT_ORDER_ID.with(|id| {
        let current = *id.borrow();
        *id.borrow_mut() = current + 1;
        current
    })
}

/// Get all orders awaiting resolver acceptance
pub fn get_pending_orders() -> Vec<OrderInfo> {
    let current_time = time();
    let canister_btc = CANISTER_BTC_ADDRESS
        .with(|addr| addr.borrow().clone())
        .unwrap_or_default();
    let canister_sol = CANISTER_SOL_ADDRESS
        .with(|addr| addr.borrow().clone())
        .unwrap_or_default();

    ORDERS.with(|orders| {
        orders
            .borrow()
            .values()
            .filter(|order| {
                matches!(order.status, crate::types::OrderStatus::DepositReceived)
                    && current_time < order.expires_at
            })
            .map(|order| order_to_info(order, &canister_btc, &canister_sol))
            .collect()
    })
}

/// Get order details
pub fn get_order(order_id: u64) -> Option<OrderInfo> {
    let canister_btc = CANISTER_BTC_ADDRESS
        .with(|addr| addr.borrow().clone())
        .unwrap_or_default();
    let canister_sol = CANISTER_SOL_ADDRESS
        .with(|addr| addr.borrow().clone())
        .unwrap_or_default();

    ORDERS.with(|orders| {
        orders
            .borrow()
            .get(&order_id)
            .map(|order| order_to_info(order, &canister_btc, &canister_sol))
    })
}

/// Get all orders created by the caller
pub fn get_my_orders(caller: Principal) -> Vec<OrderInfo> {
    let canister_btc = CANISTER_BTC_ADDRESS
        .with(|addr| addr.borrow().clone())
        .unwrap_or_default();
    let canister_sol = CANISTER_SOL_ADDRESS
        .with(|addr| addr.borrow().clone())
        .unwrap_or_default();

    ORDERS.with(|orders| {
        orders
            .borrow()
            .values()
            .filter(|order| order.creator == caller || order.resolver == Some(caller))
            .map(|order| order_to_info(order, &canister_btc, &canister_sol))
            .collect()
    })
}

/// Get all orders associated with a Bitcoin or Solana wallet address
pub fn get_orders_by_wallet(
    btc_address: Option<String>,
    sol_address: Option<String>,
) -> Vec<OrderInfo> {
    let canister_btc = CANISTER_BTC_ADDRESS
        .with(|addr| addr.borrow().clone())
        .unwrap_or_default();
    let canister_sol = CANISTER_SOL_ADDRESS
        .with(|addr| addr.borrow().clone())
        .unwrap_or_default();

    ORDERS.with(|orders| {
        orders
            .borrow()
            .values()
            .filter(|order| {
                // Check if the wallet address matches either creator or resolver addresses
                let btc_match = btc_address.as_ref().map_or(false, |addr| {
                    order.creator_btc_address.as_ref().map_or(false, |ca| ca == addr)
                        || order.resolver_btc_address.as_ref().map_or(false, |ra| ra == addr)
                });

                let sol_match = sol_address.as_ref().map_or(false, |addr| {
                    order.creator_sol_address.as_ref().map_or(false, |ca| ca == addr)
                        || order.resolver_sol_address.as_ref().map_or(false, |ra| ra == addr)
                });

                btc_match || sol_match
            })
            .map(|order| order_to_info(order, &canister_btc, &canister_sol))
            .collect()
    })
}

/// Get all expired orders that need refunds
pub fn get_expired_orders() -> Vec<OrderInfo> {
    let current_time = time();
    let canister_btc = CANISTER_BTC_ADDRESS
        .with(|addr| addr.borrow().clone())
        .unwrap_or_default();
    let canister_sol = CANISTER_SOL_ADDRESS
        .with(|addr| addr.borrow().clone())
        .unwrap_or_default();

    ORDERS.with(|orders| {
        orders
            .borrow()
            .values()
            .filter(|order| {
                current_time >= order.expires_at
                    && !matches!(
                        order.status,
                        crate::types::OrderStatus::Completed | crate::types::OrderStatus::Cancelled
                    )
                    && (order.creator_deposited || order.resolver_deposited)
            })
            .map(|order| order_to_info(order, &canister_btc, &canister_sol))
            .collect()
    })
}

// Helper to convert Order to OrderInfo
fn order_to_info(order: &Order, canister_btc: &str, canister_sol: &str) -> OrderInfo {
    OrderInfo {
        id: order.id,
        creator: order.creator,
        creator_btc_address: order.creator_btc_address.clone(),
        creator_sol_address: order.creator_sol_address.clone(),
        from_asset: order.from_asset.clone(),
        to_asset: order.to_asset.clone(),
        from_amount: order.from_amount,
        to_amount: order.to_amount,
        secret_hash: order.secret_hash.clone(),
        status: order.status.clone(),
        resolver: order.resolver,
        resolver_btc_address: order.resolver_btc_address.clone(),
        resolver_sol_address: order.resolver_sol_address.clone(),
        created_at: order.created_at,
        expires_at: order.expires_at,
        canister_btc_address: canister_btc.to_string(),
        canister_sol_address: canister_sol.to_string(),
        creator_deposited: order.creator_deposited,
        resolver_deposited: order.resolver_deposited,
    }
}
