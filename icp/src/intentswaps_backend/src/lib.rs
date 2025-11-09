use candid::{CandidType, Deserialize, Principal};
use ic_cdk::api::time;
use std::cell::RefCell;
use std::collections::HashMap;

// Type definitions
#[derive(CandidType, Deserialize, Clone, Debug)]
pub enum OrderStatus {
    Pending,           // Order created, waiting for resolver
    Accepted,          // Resolver accepted, funds locked
    Completed,         // Secret revealed, funds transferred
    Cancelled,         // Order cancelled (timeout or user cancellation)
    Expired,           // Order expired due to timelock
}

#[derive(CandidType, Deserialize, Clone, Debug)]
pub enum Chain {
    Bitcoin,
    Solana,
}

#[derive(CandidType, Deserialize, Clone, Debug)]
pub struct OrderRequest {
    pub from_chain: Chain,
    pub to_chain: Chain,
    pub from_amount: u64,        // Amount in satoshis for BTC or lamports for SOL
    pub to_amount: u64,          // Amount in satoshis for BTC or lamports for SOL
    pub secret_hash: String,     // SHA256 hash of the secret
    pub timeout_seconds: u64,    // Time before order expires
}

#[derive(CandidType, Deserialize, Clone, Debug)]
pub struct Order {
    pub id: u64,
    pub creator: Principal,
    pub from_chain: Chain,
    pub to_chain: Chain,
    pub from_amount: u64,
    pub to_amount: u64,
    pub secret_hash: String,
    pub secret: Option<String>,
    pub status: OrderStatus,
    pub resolver: Option<Principal>,
    pub created_at: u64,
    pub expires_at: u64,
    pub from_funds_locked: bool,
    pub to_funds_locked: bool,
}

#[derive(CandidType, Deserialize, Clone, Debug)]
pub struct OrderInfo {
    pub id: u64,
    pub creator: Principal,
    pub from_chain: Chain,
    pub to_chain: Chain,
    pub from_amount: u64,
    pub to_amount: u64,
    pub secret_hash: String,
    pub status: OrderStatus,
    pub resolver: Option<Principal>,
    pub created_at: u64,
    pub expires_at: u64,
}

// Storage
thread_local! {
    static ORDERS: RefCell<HashMap<u64, Order>> = RefCell::new(HashMap::new());
    static NEXT_ORDER_ID: RefCell<u64> = RefCell::new(1);
    // In a real implementation, you'd track actual BTC/SOL balances
    static USER_BALANCES: RefCell<HashMap<(Principal, String), u64>> = RefCell::new(HashMap::new());
}

// Helper functions
fn generate_order_id() -> u64 {
    NEXT_ORDER_ID.with(|id| {
        let current = *id.borrow();
        *id.borrow_mut() = current + 1;
        current
    })
}

// Canister methods

/// Create a new swap order
/// The user must have already deposited funds into the canister
#[ic_cdk::update]
fn create_order(request: OrderRequest) -> Result<u64, String> {
    let caller = ic_cdk::api::msg_caller();
    let current_time = time();
    
    // Validate request
    if request.from_amount == 0 || request.to_amount == 0 {
        return Err("Invalid amounts".to_string());
    }
    
    if request.secret_hash.is_empty() {
        return Err("Secret hash required".to_string());
    }
    
    if request.timeout_seconds < 300 {
        return Err("Timeout must be at least 5 minutes".to_string());
    }
    
    // Check if user has sufficient balance
    let chain_key = format!("{:?}", request.from_chain);
    let balance_key = (caller, chain_key.clone());
    
    let has_balance = USER_BALANCES.with(|balances| {
        balances.borrow().get(&balance_key).map_or(false, |&balance| balance >= request.from_amount)
    });
    
    if !has_balance {
        return Err("Insufficient balance in canister".to_string());
    }
    
    // Create order
    let order_id = generate_order_id();
    let expires_at = current_time + (request.timeout_seconds * 1_000_000_000);
    
    let order = Order {
        id: order_id,
        creator: caller,
        from_chain: request.from_chain.clone(),
        to_chain: request.to_chain.clone(),
        from_amount: request.from_amount,
        to_amount: request.to_amount,
        secret_hash: request.secret_hash,
        secret: None,
        status: OrderStatus::Pending,
        resolver: None,
        created_at: current_time,
        expires_at,
        from_funds_locked: false,
        to_funds_locked: false,
    };
    
    ORDERS.with(|orders| {
        orders.borrow_mut().insert(order_id, order);
    });
    
    // Lock user's funds
    USER_BALANCES.with(|balances| {
        if let Some(balance) = balances.borrow_mut().get_mut(&balance_key) {
            *balance -= request.from_amount;
        }
    });
    
    // Mark funds as locked in order
    ORDERS.with(|orders| {
        if let Some(order) = orders.borrow_mut().get_mut(&order_id) {
            order.from_funds_locked = true;
        }
    });
    
    Ok(order_id)
}

/// Deposit funds into the canister (simplified - in production use Bitcoin/Solana integration)
#[ic_cdk::update]
fn deposit_funds(chain: Chain, amount: u64) -> Result<String, String> {
    let caller = ic_cdk::api::msg_caller();
    
    if amount == 0 {
        return Err("Amount must be greater than 0".to_string());
    }
    
    let chain_key = format!("{:?}", chain);
    let balance_key = (caller, chain_key.clone());
    
    USER_BALANCES.with(|balances| {
        let mut balances = balances.borrow_mut();
        let balance = balances.entry(balance_key).or_insert(0);
        *balance += amount;
    });
    
    Ok(format!("Deposited {} to {:?} balance", amount, chain))
}

/// Get user balance for a specific chain
#[ic_cdk::query]
fn get_balance(chain: Chain) -> u64 {
    let caller = ic_cdk::api::msg_caller();
    let chain_key = format!("{:?}", chain);
    let balance_key = (caller, chain_key);
    
    USER_BALANCES.with(|balances| {
        *balances.borrow().get(&balance_key).unwrap_or(&0)
    })
}

/// Resolver accepts an order and locks their funds
#[ic_cdk::update]
fn accept_order(order_id: u64) -> Result<String, String> {
    let caller = ic_cdk::api::msg_caller();
    let current_time = time();
    
    let order = ORDERS.with(|orders| {
        orders.borrow().get(&order_id).cloned()
    });
    
    let mut order = order.ok_or("Order not found")?;
    
    // Validate order can be accepted
    if !matches!(order.status, OrderStatus::Pending) {
        return Err("Order is not pending".to_string());
    }
    
    if current_time >= order.expires_at {
        return Err("Order has expired".to_string());
    }
    
    if order.creator == caller {
        return Err("Cannot accept your own order".to_string());
    }
    
    // Check resolver has sufficient balance
    let chain_key = format!("{:?}", order.to_chain);
    let balance_key = (caller, chain_key.clone());
    
    let has_balance = USER_BALANCES.with(|balances| {
        balances.borrow().get(&balance_key).map_or(false, |&balance| balance >= order.to_amount)
    });
    
    if !has_balance {
        return Err("Insufficient balance to fulfill order".to_string());
    }
    
    // Lock resolver's funds
    USER_BALANCES.with(|balances| {
        if let Some(balance) = balances.borrow_mut().get_mut(&balance_key) {
            *balance -= order.to_amount;
        }
    });
    
    // Update order
    order.resolver = Some(caller);
    order.status = OrderStatus::Accepted;
    order.to_funds_locked = true;
    
    ORDERS.with(|orders| {
        orders.borrow_mut().insert(order_id, order);
    });
    
    Ok("Order accepted and funds locked".to_string())
}

/// Reveal secret to complete the swap
#[ic_cdk::update]
fn reveal_secret(order_id: u64, secret: String) -> Result<String, String> {
    let caller = ic_cdk::api::msg_caller();
    let current_time = time();
    
    let order = ORDERS.with(|orders| {
        orders.borrow().get(&order_id).cloned()
    });
    
    let mut order = order.ok_or("Order not found")?;
    
    // Validate
    if order.creator != caller {
        return Err("Only order creator can reveal secret".to_string());
    }
    
    if !matches!(order.status, OrderStatus::Accepted) {
        return Err("Order is not in accepted state".to_string());
    }
    
    if current_time >= order.expires_at {
        return Err("Order has expired".to_string());
    }
    
    // Verify secret matches hash (simplified)
    // In production, use proper SHA256 verification
    let secret_hash = format!("{:x}", md5::compute(&secret));
    if secret_hash != order.secret_hash {
        return Err("Secret does not match hash".to_string());
    }
    
    // Complete the swap
    order.secret = Some(secret.clone());
    order.status = OrderStatus::Completed;
    
    let resolver = order.resolver.ok_or("No resolver found")?;
    
    // Transfer funds
    // Creator gets to_amount of to_chain
    let creator_chain_key = format!("{:?}", order.to_chain);
    let creator_balance_key = (order.creator, creator_chain_key);
    
    USER_BALANCES.with(|balances| {
        let mut balances = balances.borrow_mut();
        let balance = balances.entry(creator_balance_key).or_insert(0);
        *balance += order.to_amount;
    });
    
    // Resolver gets from_amount of from_chain
    let resolver_chain_key = format!("{:?}", order.from_chain);
    let resolver_balance_key = (resolver, resolver_chain_key);
    
    USER_BALANCES.with(|balances| {
        let mut balances = balances.borrow_mut();
        let balance = balances.entry(resolver_balance_key).or_insert(0);
        *balance += order.from_amount;
    });
    
    ORDERS.with(|orders| {
        orders.borrow_mut().insert(order_id, order);
    });
    
    Ok("Swap completed successfully".to_string())
}

/// Get all pending orders (for resolvers to monitor)
#[ic_cdk::query]
fn get_pending_orders() -> Vec<OrderInfo> {
    let current_time = time();
    
    ORDERS.with(|orders| {
        orders
            .borrow()
            .values()
            .filter(|order| {
                matches!(order.status, OrderStatus::Pending) && current_time < order.expires_at
            })
            .map(|order| OrderInfo {
                id: order.id,
                creator: order.creator,
                from_chain: order.from_chain.clone(),
                to_chain: order.to_chain.clone(),
                from_amount: order.from_amount,
                to_amount: order.to_amount,
                secret_hash: order.secret_hash.clone(),
                status: order.status.clone(),
                resolver: order.resolver,
                created_at: order.created_at,
                expires_at: order.expires_at,
            })
            .collect()
    })
}

/// Get order details
#[ic_cdk::query]
fn get_order(order_id: u64) -> Option<OrderInfo> {
    ORDERS.with(|orders| {
        orders.borrow().get(&order_id).map(|order| OrderInfo {
            id: order.id,
            creator: order.creator,
            from_chain: order.from_chain.clone(),
            to_chain: order.to_chain.clone(),
            from_amount: order.from_amount,
            to_amount: order.to_amount,
            secret_hash: order.secret_hash.clone(),
            status: order.status.clone(),
            resolver: order.resolver,
            created_at: order.created_at,
            expires_at: order.expires_at,
        })
    })
}

/// Get user's orders
#[ic_cdk::query]
fn get_my_orders() -> Vec<OrderInfo> {
    let caller = ic_cdk::api::msg_caller();
    
    ORDERS.with(|orders| {
        orders
            .borrow()
            .values()
            .filter(|order| order.creator == caller || order.resolver == Some(caller))
            .map(|order| OrderInfo {
                id: order.id,
                creator: order.creator,
                from_chain: order.from_chain.clone(),
                to_chain: order.to_chain.clone(),
                from_amount: order.from_amount,
                to_amount: order.to_amount,
                secret_hash: order.secret_hash.clone(),
                status: order.status.clone(),
                resolver: order.resolver,
                created_at: order.created_at,
                expires_at: order.expires_at,
            })
            .collect()
    })
}

/// Cancel an order (only if pending and before expiry)
#[ic_cdk::update]
fn cancel_order(order_id: u64) -> Result<String, String> {
    let caller = ic_cdk::api::msg_caller();
    
    let order = ORDERS.with(|orders| {
        orders.borrow().get(&order_id).cloned()
    });
    
    let mut order = order.ok_or("Order not found")?;
    
    if order.creator != caller {
        return Err("Only order creator can cancel".to_string());
    }
    
    if !matches!(order.status, OrderStatus::Pending) {
        return Err("Can only cancel pending orders".to_string());
    }
    
    // Return funds to creator
    if order.from_funds_locked {
        let chain_key = format!("{:?}", order.from_chain);
        let balance_key = (order.creator, chain_key);
        
        USER_BALANCES.with(|balances| {
            let mut balances = balances.borrow_mut();
            let balance = balances.entry(balance_key).or_insert(0);
            *balance += order.from_amount;
        });
    }
    
    order.status = OrderStatus::Cancelled;
    
    ORDERS.with(|orders| {
        orders.borrow_mut().insert(order_id, order);
    });
    
    Ok("Order cancelled and funds returned".to_string())
}

// Export candid interface
ic_cdk::export_candid!();
