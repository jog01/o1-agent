use alloy::{
    primitives::{Address, B256, U256, address},
    providers::{Provider, ProviderBuilder},
    rpc::types::{Filter, Log},
    sol,
    sol_types::SolEvent,
};
use axum::{
    Json, Router,
    extract::{
        State,
        ws::{Message, WebSocket, WebSocketUpgrade},
    },
    response::IntoResponse,
    routing::get,
};
use clap::Parser;
use serde::{Deserialize, Serialize};
use std::{collections::HashMap, sync::Arc, time::Duration};
use tokio::{
    io::AsyncWriteExt,
    sync::{RwLock, broadcast},
};

sol! {
    event Launched(address indexed token, bytes32 indexed poolId, address indexed originalCreator, address quoteToken, uint256 launchSupply, int24 tickSpacing);
    event Trade(bytes32 indexed poolId, address indexed executor, address indexed referrer, address quoteCurrency, uint256 quoteFeeAmount, bytes32 comment);
    #[sol(rpc)]
    interface IERC20Meta {
        function name() external view returns (string);
        function symbol() external view returns (string);
    }
}

/// Current o1 Launchpad suites on Base (from docs.o1.exchange launch-contract-suites.json).
const SUITES: &[(&str, Address, Address)] = &[
    (
        "standard",
        address!("1176122eb77AD6a2339322Cda7C4D7ea9BfA63dC"),
        address!("1f91c998e7c2F4b690D75BDBf6502BDcD6e02AcC"),
    ),
    (
        "tax",
        address!("53C59d8d335681d58F564cF62073fA3C57cF81ee"),
        address!("9C7155D7216454D9d894F792c8B5C564F2c66AcC"),
    ),
    (
        "wsto",
        address!("AC7Bd3254d7182a32ae3Ce7Fcd0ab86c88fcD91F"),
        address!("Aa4B4fABf41754E759338778e6031A156EeA6aCc"),
    ),
    (
        "pads",
        address!("fF6ff1DFa6938707Db8dD78D7E74999e8177126f"),
        address!("Fe97d6f3f59Ec48f2953c702e55e0ca199392aCC"),
    ),
];

#[derive(Parser)]
struct Args {
    #[arg(
        long,
        env = "BASE_RPC_URL",
        default_value = "https://base-rpc.publicnode.com"
    )]
    rpc: String,
    #[arg(long, default_value = "0.0.0.0:7070")]
    listen: String,
    /// Blocks to backfill on start (Base: ~2s blocks, 43200 = 1 day).
    #[arg(long, default_value_t = 43200)]
    backfill: u64,
    #[arg(long, default_value_t = 5000)]
    chunk: u64,
    /// Append every event to this JSONL file (used to build demo recordings).
    #[arg(long)]
    record: Option<String>,
    /// Demo mode: replay a recorded JSONL file instead of reading the chain.
    #[arg(long)]
    replay: Option<String>,
    /// Replay speed multiplier against original block timestamps.
    #[arg(long, default_value_t = 60.0)]
    speed: f64,
}

#[derive(Clone, Serialize, Deserialize, Debug)]
#[serde(tag = "kind", rename_all = "snake_case")]
enum Event {
    Launch {
        suite: String,
        token: Address,
        pool_id: B256,
        creator: Address,
        quote_token: Address,
        launch_supply: U256,
        block: u64,
        ts: u64,
        tx: B256,
        name: String,
        symbol: String,
    },
    Trade {
        suite: String,
        pool_id: B256,
        executor: Address,
        quote_currency: Address,
        quote_fee: U256,
        block: u64,
        ts: u64,
        tx: B256,
    },
}

#[derive(Clone, Serialize, Default)]
struct TokenStats {
    suite: String,
    token: Address,
    pool_id: B256,
    creator: Address,
    quote_token: Address,
    name: String,
    symbol: String,
    launched_block: u64,
    launched_ts: u64,
    trades: u64,
    unique_traders: usize,
    first_minute_traders: usize,
    quote_fees: U256,
    last_trade_ts: u64,
    #[serde(skip)]
    traders: HashMap<Address, u64>,
}

#[derive(Default)]
struct Store {
    tokens: HashMap<Address, TokenStats>,
    pools: HashMap<B256, Address>,
    head_block: u64,
    events_seen: u64,
}

impl Store {
    fn apply(&mut self, e: &Event) {
        self.events_seen += 1;
        match e {
            Event::Launch {
                suite,
                token,
                pool_id,
                creator,
                quote_token,
                block,
                ts,
                name,
                symbol,
                ..
            } => {
                self.pools.insert(*pool_id, *token);
                self.tokens.entry(*token).or_insert_with(|| TokenStats {
                    suite: suite.clone(),
                    token: *token,
                    pool_id: *pool_id,
                    creator: *creator,
                    quote_token: *quote_token,
                    name: name.clone(),
                    symbol: symbol.clone(),
                    launched_block: *block,
                    launched_ts: *ts,
                    ..Default::default()
                });
                self.head_block = self.head_block.max(*block);
            }
            Event::Trade {
                pool_id,
                executor,
                quote_fee,
                block,
                ts,
                ..
            } => {
                self.head_block = self.head_block.max(*block);
                let Some(t) = self.pools.get(pool_id).and_then(|a| self.tokens.get_mut(a)) else {
                    return;
                };
                t.trades += 1;
                t.quote_fees += *quote_fee;
                t.last_trade_ts = *ts;
                t.traders.entry(*executor).or_insert(*ts);
                t.unique_traders = t.traders.len();
                t.first_minute_traders = t
                    .traders
                    .values()
                    .filter(|&&s| s <= t.launched_ts + 60)
                    .count();
            }
        }
    }
}

#[derive(Clone)]
struct App {
    store: Arc<RwLock<Store>>,
    tx: broadcast::Sender<Event>,
}

async fn emit(app: &App, e: Event, rec: &mut Option<tokio::fs::File>) {
    app.store.write().await.apply(&e);
    if let Some(f) = rec.as_mut() {
        let mut line = serde_json::to_vec(&e).unwrap();
        line.push(b'\n');
        let _ = f.write_all(&line).await;
    }
    let _ = app.tx.send(e);
}

async fn decode(
    provider: &impl Provider,
    logs: Vec<Log>,
    ts_cache: &mut HashMap<u64, u64>,
) -> Vec<Event> {
    let mut out = Vec::new();
    for log in logs {
        let block = log.block_number.unwrap_or_default();
        let tx = log.transaction_hash.unwrap_or_default();
        let ts = match log
            .block_timestamp
            .or_else(|| ts_cache.get(&block).copied())
        {
            Some(t) => t,
            None => {
                let t = provider
                    .get_block_by_number(block.into())
                    .await
                    .ok()
                    .flatten()
                    .map(|b| b.header.timestamp)
                    .unwrap_or_default();
                ts_cache.insert(block, t);
                t
            }
        };
        let Some(suite) = SUITES
            .iter()
            .find(|s| s.1 == log.address() || s.2 == log.address())
            .map(|s| s.0.to_string())
        else {
            continue;
        };
        if let Ok(l) = log.log_decode::<Launched>() {
            let d = l.inner.data;
            let meta = IERC20Meta::new(d.token, provider);
            let name = meta.name().call().await.unwrap_or_default();
            let symbol = meta.symbol().call().await.unwrap_or_default();
            out.push(Event::Launch {
                suite,
                token: d.token,
                pool_id: d.poolId,
                creator: d.originalCreator,
                quote_token: d.quoteToken,
                launch_supply: d.launchSupply,
                block,
                ts,
                tx,
                name,
                symbol,
            });
        } else if let Ok(l) = log.log_decode::<Trade>() {
            let d = l.inner.data;
            out.push(Event::Trade {
                suite,
                pool_id: d.poolId,
                executor: d.executor,
                quote_currency: d.quoteCurrency,
                quote_fee: d.quoteFeeAmount,
                block,
                ts,
                tx,
            });
        }
    }
    out
}

async fn run_chain(app: App, args: Arc<Args>) -> anyhow::Result<()> {
    let provider = ProviderBuilder::new().connect_http(args.rpc.parse()?);
    let mut rec = match &args.record {
        Some(p) => Some(
            tokio::fs::OpenOptions::new()
                .create(true)
                .append(true)
                .open(p)
                .await?,
        ),
        None => None,
    };
    let addrs: Vec<Address> = SUITES.iter().flat_map(|s| [s.1, s.2]).collect();
    let filter = Filter::new()
        .address(addrs)
        .event_signature(vec![Launched::SIGNATURE_HASH, Trade::SIGNATURE_HASH]);
    let head = provider.get_block_number().await?;
    let mut from = head.saturating_sub(args.backfill);
    let mut ts_cache = HashMap::new();
    tracing::info!(from, head, "backfilling");
    loop {
        let head = provider.get_block_number().await?;
        while from <= head {
            let to = (from + args.chunk - 1).min(head);
            let t0 = std::time::Instant::now();
            match provider
                .get_logs(&filter.clone().from_block(from).to_block(to))
                .await
            {
                Ok(logs) => {
                    let n = logs.len();
                    for e in decode(&provider, logs, &mut ts_cache).await {
                        emit(&app, e, &mut rec).await;
                    }
                    tracing::info!(
                        from,
                        to,
                        logs = n,
                        ms = t0.elapsed().as_millis() as u64,
                        "range"
                    );
                    from = to + 1;
                }
                Err(e) => {
                    tracing::warn!(%e, "get_logs failed, retrying");
                    tokio::time::sleep(Duration::from_secs(2)).await;
                }
            }
        }
        app.store.write().await.head_block = head;
        if ts_cache.len() > 10_000 {
            ts_cache.clear();
        }
        tokio::time::sleep(Duration::from_millis(1500)).await;
    }
}

async fn run_replay(app: App, path: String, speed: f64) -> anyhow::Result<()> {
    loop {
        let text = tokio::fs::read_to_string(&path).await?;
        let events: Vec<Event> = text
            .lines()
            .filter_map(|l| serde_json::from_str(l).ok())
            .collect();
        tracing::info!(n = events.len(), "replaying recording");
        *app.store.write().await = Store::default();
        let mut prev: Option<u64> = None;
        for e in events {
            let ts = match &e {
                Event::Launch { ts, .. } | Event::Trade { ts, .. } => *ts,
            };
            if let Some(p) = prev {
                let gap = ts.saturating_sub(p) as f64 / speed;
                if gap > 0.0 {
                    tokio::time::sleep(Duration::from_secs_f64(gap.min(5.0))).await;
                }
            }
            prev = Some(ts);
            emit(&app, e, &mut None).await;
        }
        tokio::time::sleep(Duration::from_secs(10)).await;
    }
}

async fn tokens(State(app): State<App>) -> impl IntoResponse {
    let s = app.store.read().await;
    let mut v: Vec<TokenStats> = s.tokens.values().cloned().collect();
    v.sort_by(|a, b| b.launched_ts.cmp(&a.launched_ts));
    Json(v)
}

async fn health(State(app): State<App>) -> impl IntoResponse {
    let s = app.store.read().await;
    Json(
        serde_json::json!({ "ok": true, "head_block": s.head_block, "tokens": s.tokens.len(), "events": s.events_seen }),
    )
}

async fn ws(ws: WebSocketUpgrade, State(app): State<App>) -> impl IntoResponse {
    ws.on_upgrade(move |socket| stream(socket, app))
}

async fn stream(mut socket: WebSocket, app: App) {
    let mut rx = app.tx.subscribe();
    while let Ok(e) = rx.recv().await {
        if socket
            .send(Message::Text(serde_json::to_string(&e).unwrap().into()))
            .await
            .is_err()
        {
            break;
        }
    }
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::fmt().init();
    let args = Arc::new(Args::parse());
    let (tx, _) = broadcast::channel(4096);
    let app = App {
        store: Default::default(),
        tx,
    };
    let worker = {
        let (app, args) = (app.clone(), args.clone());
        tokio::spawn(async move {
            let r = match args.replay.clone() {
                Some(p) => run_replay(app, p, args.speed).await,
                None => run_chain(app, args).await,
            };
            if let Err(e) = r {
                tracing::error!(%e, "worker stopped");
            }
        })
    };
    let router = Router::new()
        .route("/health", get(health))
        .route("/tokens", get(tokens))
        .route("/stream", get(ws))
        .with_state(app);
    let listener = tokio::net::TcpListener::bind(&args.listen).await?;
    tracing::info!(listen = %args.listen, "indexer up");
    tokio::select! { r = axum::serve(listener, router) => r?, _ = worker => {} }
    Ok(())
}
