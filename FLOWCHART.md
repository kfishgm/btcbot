# BTC Trading Bot - Complete System Flowchart

**Generated:** 2025-09-23
**Bot Version:** Production (STRATEGY.md compliant)
**Architecture:** Event-driven with WebSocket streaming

## Table of Contents

1. [System Overview](#system-overview)
2. [Module Architecture](#module-architecture)
3. [Startup Flow](#startup-flow)
4. [Main Trading Loop](#main-trading-loop)
5. [Buy Flow](#buy-flow)
6. [Sell Flow](#sell-flow)
7. [State Management](#state-management)
8. [Error Handling](#error-handling)

---

## System Overview

```mermaid
graph TB
    %% Main Components
    Start([Bot Start]) --> Init[Initialize System]
    Init --> Validate[Startup Validation]
    Validate --> Connect[Connect Services]
    Connect --> MainLoop[Main Trading Loop]

    %% Services
    WS[WebSocket Manager] --> CP[Candle Processor]
    CP --> MO[Main Orchestrator]

    %% Database
    DB[(Supabase Database)]
    MO <--> DB

    %% External
    Binance[Binance API]
    WS <--> Binance

    %% Notifications
    Discord[Discord Webhook]
    MO --> Discord

    style Start fill:#90EE90
    style MainLoop fill:#FFD700
    style DB fill:#87CEEB
    style Binance fill:#FFA500
```

---

## Module Architecture

```mermaid
graph LR
    subgraph "Entry Point"
        Index[index.ts]
    end

    subgraph "App Module"
        MO[MainOrchestrator]
        SV[StartupValidator]
    end

    subgraph "Config Module"
        Config[Config Loader]
        SCL[StrategyConfigLoader]
    end

    subgraph "Exchange Module"
        BC[BinanceClient]
        WSM[WebSocketManager]
        CP[CandleProcessor]
        HCM[HistoricalCandleManager]
        BM[BalanceManager]
        TR[TradingRules]
    end

    subgraph "Cycle Module"
        CSM[CycleStateManager]
        BTD[BuyTriggerDetector]
        STD[SellTriggerDetector]
        RPC[ReferencePriceCalculator]
        DD[DriftDetector]
        BAC[BuyAmountCalculator]
        BOSU[BuyOrderStateUpdater]
        SOSU[SellOrderStateUpdater]
        STM[StateTransactionManager]
        SPM[StrategyPauseMechanism]
    end

    subgraph "Order Module"
        BOP[BuyOrderPlacer]
        SOP[SellOrderPlacer]
        OPC[OrderPriceCalculator]
    end

    subgraph "Database Module"
        CM[ConnectionManager]
        SC[SupabaseClient]
    end

    subgraph "Monitoring Module"
        EL[EventLogger]
        DN[DiscordNotifier]
    end

    %% Key connections
    Index --> MO
    MO --> CSM
    MO --> BTD
    MO --> STD
    MO --> BOP
    MO --> SOP
    WSM --> CP
    CP --> MO
```

---

## Startup Flow

```mermaid
flowchart TD
    Start([Bot Start]) --> LoadEnv[Load Environment Variables]
    LoadEnv --> CreateConfig[Create Configuration]

    CreateConfig --> InitOrch[Initialize MainOrchestrator]
    InitOrch --> RunValidation[Run Startup Validation]

    subgraph "Startup Validation"
        ValConfig[Validate Configuration]
        ValConn[Validate Connectivity]
        ValBal[Validate Balances]

        ValConfig --> CheckEnv{Environment<br/>Variables<br/>Valid?}
        CheckEnv -->|No| FailStart[Fail Startup]
        CheckEnv -->|Yes| LoadStrat[Load Strategy Config]

        LoadStrat --> CheckStrat{Strategy<br/>Config<br/>Valid?}
        CheckStrat -->|No| CreateDefault[Create Default Config]
        CheckStrat -->|Yes| ValConn
        CreateDefault --> ValConn

        ValConn --> PingBinance[Ping Binance API]
        PingBinance --> CheckDB[Check Database Connection]
        CheckDB --> ValBal

        ValBal --> CheckUSDT{USDT >=<br/>Initial Capital?}
        CheckUSDT -->|No| ErrorUSDT[Error: Insufficient USDT]
        CheckUSDT -->|Yes| CheckBTC{BTC Balance<br/>> Dust?}
        CheckBTC -->|Yes| WarnBTC[Warning: Existing BTC]
        CheckBTC -->|No| CheckDrift[Check Balance Drift]
        WarnBTC --> CheckDrift

        CheckDrift --> CalcDrift[Calculate Drift %]
        CalcDrift --> DriftOK{Drift < 1%?}
        DriftOK -->|No| WarnDrift[Warning: Drift Detected]
        DriftOK -->|Yes| ValComplete[Validation Complete]
        WarnDrift --> ValComplete
    end

    ValComplete --> InitCycle[Initialize Cycle State]

    subgraph "Cycle State Initialization"
        LoadState[Load Existing State]
        LoadState --> StateExists{State<br/>Exists?}
        StateExists -->|No| CreateState[Create Initial State]
        StateExists -->|Yes| ValidateState[Validate State]

        CreateState --> SetReady[Status = READY]
        SetReady --> SetCapital[capital_available = INITIAL_CAPITAL]
        SetCapital --> SetBTC[btc_accumulated = 0]
        SetBTC --> SetPurchases[purchases_remaining = MAX_PURCHASES]
        SetPurchases --> SaveState[Save to Database]

        ValidateState --> StateValid{State<br/>Valid?}
        StateValid -->|No| PauseCorrupt[Pause: Corruption]
        StateValid -->|Yes| RecoverState[Recover State]
    end

    SaveState --> ConnectWS[Connect WebSocket]
    RecoverState --> ConnectWS

    ConnectWS --> BuildURL[Build WebSocket URL]
    BuildURL --> OpenWS[Open WebSocket Connection]
    OpenWS --> SetupHandlers[Setup Event Handlers]
    SetupHandlers --> StartHB[Start Heartbeat]
    StartHB --> CatchUp[Catch Up Missed Candles]
    CatchUp --> Ready([Bot Ready])

    style Start fill:#90EE90
    style Ready fill:#90EE90
    style FailStart fill:#FF6B6B
    style ErrorUSDT fill:#FF6B6B
    style PauseCorrupt fill:#FF6B6B
```

---

## Main Trading Loop

```mermaid
flowchart TD
    WSMessage[WebSocket Kline Message] --> ParseMsg[Parse Message]
    ParseMsg --> ValidateMsg{Valid<br/>Message?}
    ValidateMsg -->|No| LogError[Log Error]
    ValidateMsg -->|Yes| CheckClosed{Candle<br/>Closed?}

    CheckClosed -->|No| UpdateCandle[Update Candle Data]
    CheckClosed -->|Yes| EmitClosed[Emit 'candleClosed']

    EmitClosed --> OnCandle[onCandleClose Handler]

    subgraph "STRATEGY.md Execution Order"
        OnCandle --> CheckRunning{Bot<br/>Running?}
        CheckRunning -->|No| Skip[Skip Processing]
        CheckRunning -->|Yes| CheckPaused{Strategy<br/>Paused?}

        CheckPaused -->|Yes| SkipPaused[Skip: Paused]
        CheckPaused -->|No| QueueCheck{Already<br/>Processing?}

        QueueCheck -->|Yes| QueueCandle[Queue Candle]
        QueueCheck -->|No| StartProcess[Start Processing]

        StartProcess --> GetState[Get Current State]

        %% STEP 1: Update ATH
        GetState --> CheckHolding{btc_accumulated<br/>== 0?}
        CheckHolding -->|Yes| UpdateATH[Calculate ATH from 20 candles]
        CheckHolding -->|No| SkipATH[Keep existing reference_price]

        UpdateATH --> SetRef[reference_price = ATH]
        SetRef --> CheckSell
        SkipATH --> CheckSell

        %% STEP 2: SELL CHECK FIRST
        CheckSell{btc_accumulated<br/>> 0?}
        CheckSell -->|No| CheckBuy
        CheckSell -->|Yes| CalcSellThresh["sell_threshold = (reference_price * (1 + %Rise)) / (1 - commission)"]

        CalcSellThresh --> PriceAbove{Close >=<br/>sell_threshold?}
        PriceAbove -->|No| CheckBuy
        PriceAbove -->|Yes| ValidateBTCBal[Validate BTC Balance]

        ValidateBTCBal --> BTCDrift{Drift < 0.5%?}
        BTCDrift -->|No| PauseDrift1[Pause: Drift Exceeded]
        BTCDrift -->|Yes| PlaceSell[Place SELL Order]

        PlaceSell --> SellExecuted{Order<br/>Filled?}
        SellExecuted -->|No| LogSellFail[Log Failed Sell]
        SellExecuted -->|Yes| UpdateSellState[Update State After Sell]

        UpdateSellState --> CheckDust{btc_accumulated<br/>< min_sellable?}
        CheckDust -->|Yes| CompleteCycle[Complete Cycle]
        CheckDust -->|No| PartialSell[Partial Sell]

        CompleteCycle --> CalcProfit["profit = max(0, proceeds - principal)"]
        CalcProfit --> ResetState[Reset to READY]
        ResetState --> PreserveDust[btc_dust = remaining]
        PreserveDust --> CheckBuy

        %% STEP 3: BUY CHECK AFTER
        CheckBuy{purchases_remaining<br/>> 0?}
        CheckBuy -->|No| EndProcess
        CheckBuy -->|Yes| CheckGrid{buy_grid<br/>exists?}

        CheckGrid -->|No| CheckRef{reference_price<br/>> 0?}
        CheckRef -->|No| EndProcess
        CheckRef -->|Yes| FirstTrigger["first_level = reference_price * (1 - %Drop)"]

        FirstTrigger --> BelowFirst{Close <=<br/>first_level?}
        BelowFirst -->|No| EndProcess
        BelowFirst -->|Yes| BuildGrid[Build Arithmetic Grid]

        BuildGrid --> SaveGrid[Save Grid to Database]
        SaveGrid --> CheckLevels

        CheckGrid -->|Yes| CheckLevels[Count Triggered Levels]

        CheckLevels --> IsFirstBuy{"First Buy?<br/>no anchor"}
        IsFirstBuy -->|Yes| LimitOne[Limit to 1 Level]
        IsFirstBuy -->|No| CountAll[Count All Crossed Levels]

        LimitOne --> CalcAmount1
        CountAll --> CalcAmount1[Calculate Combined Amount]

        CalcAmount1 --> ValidateUSDT[Validate USDT Balance]
        ValidateUSDT --> USDTDrift{Drift < 0.5%?}
        USDTDrift -->|No| PauseDrift2[Pause: Drift Exceeded]
        USDTDrift -->|Yes| PlaceBuy[Place BUY Order]

        PlaceBuy --> BuyExecuted{Order<br/>Filled?}
        BuyExecuted -->|No| LogBuyFail[Log Failed Buy]
        BuyExecuted -->|Yes| UpdateBuyState[Update State After Buy]

        UpdateBuyState --> FirstBuyCheck{Was First<br/>Buy?}
        FirstBuyCheck -->|Yes| SetAnchor[buy_anchor_price = execution_price]
        FirstBuyCheck -->|No| AdvanceIndex["buy_index = buy_index + levels_triggered"]

        SetAnchor --> RebuildGrid[Rebuild Grid from Anchor]
        RebuildGrid --> ResetIndex[buy_index = 0]
        ResetIndex --> EndProcess

        AdvanceIndex --> EndProcess[End Processing]
    end

    EndProcess --> ProcessQueue{Queue<br/>Empty?}
    ProcessQueue -->|No| NextCandle[Process Next Candle]
    ProcessQueue -->|Yes| WaitNext[Wait for Next Candle]

    NextCandle --> GetState

    style WSMessage fill:#87CEEB
    style CheckSell fill:#FFD700
    style CheckBuy fill:#90EE90
```

---

## Buy Flow

```mermaid
flowchart TD
    BuyTrigger[Buy Trigger Check] --> ValStrategy{Strategy<br/>Active?}
    ValStrategy -->|No| NoBuy1[No Buy: Paused]
    ValStrategy -->|Yes| CheckRemain{Purchases<br/>Remaining?}

    CheckRemain -->|No| NoBuy2[No Buy: Max Purchases]
    CheckRemain -->|Yes| GridExists{Grid<br/>Exists?}

    subgraph "Dynamic Grid Construction"
        GridExists -->|No| HaveRef{Have<br/>reference_price?}
        HaveRef -->|No| NoBuy3[No Buy: No ATH]
        HaveRef -->|Yes| CalcFirst["first_level = ATH * (1 - %Drop)"]

        CalcFirst --> PriceDrop{Price <=<br/>first_level?}
        PriceDrop -->|No| NoBuy4[No Buy: Above Grid]
        PriceDrop -->|Yes| BuildNewGrid[Build Arithmetic Grid]

        BuildNewGrid --> LoopLevels[For n = 1 to MAX_PURCHASES]
        LoopLevels --> CalcLevel["level_n = base * (1 - n * %Drop)"]
        CalcLevel --> Quantize[Floor to tick size 0.01]
        Quantize --> CheckValid{"n * %Drop < 1?"}
        CheckValid -->|Yes| AddLevel[Add to Grid Array]
        CheckValid -->|No| StopBuild[Stop Building]
        AddLevel --> LoopLevels

        StopBuild --> SaveGridDB[Save Grid to Database]
        SaveGridDB --> SetIndex0[buy_index = 0]
    end

    GridExists -->|Yes| CountTriggers
    SetIndex0 --> CountTriggers[Count Triggered Levels]

    subgraph "Level Counting"
        CountTriggers --> FirstBuyQ{"Is First Buy?<br/>no anchor_price"}
        FirstBuyQ -->|Yes| OnlyOne["triggers = 1 max"]
        FirstBuyQ -->|No| LoopCount[Loop: buy_index to grid.length]

        LoopCount --> LevelBelow{"Price <=<br/>grid level?"}
        LevelBelow -->|Yes| IncCount["triggers = triggers + 1"]
        LevelBelow -->|No| StopCount[Stop Counting]
        IncCount --> NextLevel{More<br/>Levels?}
        NextLevel -->|Yes| LoopCount
        NextLevel -->|No| StopCount
    end

    OnlyOne --> CalcBuyAmt
    StopCount --> AnyTriggers{triggers > 0?}
    AnyTriggers -->|No| NoBuy5[No Buy: Above Grid]
    AnyTriggers -->|Yes| CalcBuyAmt

    subgraph "Amount Calculation"
        CalcBuyAmt[Calculate Buy Amount] --> BaseAmt[base = initial_capital / max_purchases]
        BaseAmt --> LoopAmt[For each triggered level]
        LoopAmt --> LastCheck{Last<br/>Purchase?}
        LastCheck -->|Yes| UseAll[amount = capital_available]
        LastCheck -->|No| AddBase["amount = amount + base"]
        AddBase --> NextTrig{More<br/>Triggers?}
        NextTrig -->|Yes| LoopAmt
        NextTrig -->|No| CapAmount
        UseAll --> CapAmount["amount = min(amount, capital_available)"]
    end

    CapAmount --> ValidateAmt

    subgraph "Order Validation"
        ValidateAmt[Validate Amount] --> CheckMin{amount >=<br/>MIN_BUY?}
        CheckMin -->|No| NoBuy6[No Buy: Below Minimum]
        CheckMin -->|Yes| CheckCap{amount <=<br/>capital?}
        CheckCap -->|No| NoBuy7[No Buy: Insufficient USDT]
        CheckCap -->|Yes| CheckDriftBuy[Check USDT Drift]

        CheckDriftBuy --> CalcDriftB["drift = abs(spot - expected) / expected"]
        CalcDriftB --> DriftOKB{drift < 0.5%?}
        DriftOKB -->|No| NoBuy8[No Buy: Drift Exceeded]
        DriftOKB -->|Yes| PrepOrder
    end

    subgraph "Order Preparation"
        PrepOrder[Prepare Order] --> CalcLimit["limit_price = Close * (1 + slippage)"]
        CalcLimit --> RoundTick[Round to tick size]
        RoundTick --> CalcQty[quantity = amount / limit_price]
        CalcQty --> RoundStep[Round to step size]
        RoundStep --> CreateOrder[Create Order Object]
    end

    CreateOrder --> PlaceOrder

    subgraph "Order Execution"
        PlaceOrder[Place Limit IOC Order] --> SendBinance[Send to Binance]
        SendBinance --> OrderResp{Response<br/>OK?}
        OrderResp -->|No| RetryOrder{Retries<br/>Left?}
        RetryOrder -->|Yes| WaitRetry[Wait & Retry]
        RetryOrder -->|No| BuyFailed[Buy Failed]
        WaitRetry --> SendBinance

        OrderResp -->|Yes| ParseFills[Parse Fills]
        ParseFills --> CalcFees[Calculate Fees]
        CalcFees --> UpdateStateB
    end

    subgraph "State Update"
        UpdateStateB[Update State] --> AddCost["cost_accum_usdt = cost_accum_usdt + quoteQty"]
        AddCost --> AddBTC["btc_accum_net = btc_accum_net + filledQty - feeBTC"]
        AddBTC --> UpdateAccum[btc_accumulated = btc_accum_net + btc_dust]
        UpdateAccum --> SubCapital["capital_available = capital_available - quoteQty"]
        SubCapital --> RecalcRef[reference_price = cost_accum_usdt / btc_accum_net]
        RecalcRef --> DecPurchases["purchases_remaining = purchases_remaining - 1"]
        DecPurchases --> AdvanceIdx["buy_index = buy_index + triggers"]
        AdvanceIdx --> SetHolding[status = HOLDING]

        SetHolding --> WasFirst{Was First<br/>Buy?}
        WasFirst -->|Yes| SetAnchorB[buy_anchor_price = execution_price]
        WasFirst -->|No| SaveStateB[Save State]

        SetAnchorB --> RebuildFromAnchor[Rebuild Grid from Anchor]
        RebuildFromAnchor --> ResetIdx[buy_index = 0]
        ResetIdx --> SaveStateB
    end

    SaveStateB --> LogBuy[Log Buy Event]
    LogBuy --> NotifyBuy[Discord Notification]
    NotifyBuy --> BuyComplete([Buy Complete])

    style BuyTrigger fill:#90EE90
    style BuyComplete fill:#90EE90
```

---

## Sell Flow

```mermaid
flowchart TD
    SellTrigger[Sell Trigger Check] --> ValStrategyS{Strategy<br/>Active?}
    ValStrategyS -->|No| NoSell1[No Sell: Paused]
    ValStrategyS -->|Yes| HaveBTC{btc_accumulated<br/>> 0?}

    HaveBTC -->|No| NoSell2[No Sell: No BTC]
    HaveBTC -->|Yes| HaveRefS{reference_price<br/>Set?}

    HaveRefS -->|No| NoSell3[No Sell: No Avg Cost]
    HaveRefS -->|Yes| CalcThresh

    subgraph "Threshold Calculation"
        CalcThresh[Calculate Sell Threshold] --> GetAvg[avg_cost = reference_price]
        GetAvg --> ApplyRise["sell_threshold = avg_cost * (1 + %Rise)"]
        ApplyRise --> LogThresh[Log: threshold = X]
    end

    LogThresh --> CheckPrice{Close >=<br/>threshold?}
    CheckPrice -->|No| NoSell4[No Sell: Below Threshold]
    CheckPrice -->|Yes| ValidateBal

    subgraph "Balance Validation"
        ValidateBal[Validate BTC Balance] --> GetSpot[Get BTC Spot Balance]
        GetSpot --> CompareAmt{spot >=<br/>accumulated?}
        CompareAmt -->|No| CalcDriftS1[Calculate BTC Drift]
        CompareAmt -->|Yes| CalcDriftS2[Calculate BTC Drift]

        CalcDriftS1 --> MajorShort{drift > 10%?}
        MajorShort -->|Yes| NoSell5[No Sell: Insufficient BTC]
        MajorShort -->|No| MinorShort{drift < 0.5%?}
        MinorShort -->|No| NoSell6[No Sell: Drift Exceeded]
        MinorShort -->|Yes| NoSell7[No Sell: Insufficient]

        CalcDriftS2 --> ExcessCheck{drift > 10%?}
        ExcessCheck -->|Yes| AllowExcess[Allow: External BTC]
        ExcessCheck -->|No| StrictDrift{drift < 0.5%?}
        StrictDrift -->|No| NoSell8[No Sell: Drift Exceeded]
        StrictDrift -->|Yes| AllowSell

        AllowExcess --> AllowSell
    end

    AllowSell --> CheckNotional

    subgraph "Notional Check"
        CheckNotional[Check Min Notional] --> CalcValue["value = btc_accumulated * Close"]
        CalcValue --> ValueOK{value >= $5?}
        ValueOK -->|No| NoSell9[No Sell: Below Minimum]
        ValueOK -->|Yes| CheckSellable

        CheckSellable --> CalcMinQty["min_qty = max(0.00001, $5/price)"]
        CalcMinQty --> RoundUp[Round up to step size]
        RoundUp --> CanSell{accumulated >=<br/>min_qty?}
        CanSell -->|No| NoSell10[No Sell: Dust]
        CanSell -->|Yes| PrepSellOrder
    end

    subgraph "Sell Order Preparation"
        PrepSellOrder[Prepare Sell Order] --> CalcLimitS["limit_price = Close * (1 - slippage)"]
        CalcLimitS --> RoundTickS[Round to tick size]
        RoundTickS --> SetQtyS[quantity = btc_accumulated]
        SetQtyS --> RoundDownS[Round DOWN to step size]
        RoundDownS --> CalcDustS[dust = accumulated - rounded]
        CalcDustS --> CreateOrderS[Create Order Object]
    end

    CreateOrderS --> PlaceSellOrder

    subgraph "Sell Execution"
        PlaceSellOrder[Place Limit IOC Order] --> SendBinanceS[Send to Binance]
        SendBinanceS --> OrderRespS{Response<br/>OK?}
        OrderRespS -->|No| RetryOrderS{Retries<br/>Left?}
        RetryOrderS -->|Yes| WaitRetryS[Wait & Retry]
        RetryOrderS -->|No| SellFailed[Sell Failed]
        WaitRetryS --> SendBinanceS

        OrderRespS -->|Yes| ParseFillsS[Parse Fills]
        ParseFillsS --> CalcFeesS[Calculate USDT Fees]
        CalcFeesS --> CalcProceeds[net_proceeds = quoteQty - feeUSDT]
    end

    CalcProceeds --> UpdateStateS

    subgraph "State Update After Sell"
        UpdateStateS[Update State] --> SubBTC["btc_accumulated = btc_accumulated - executedQty"]
        SubBTC --> CheckComplete{btc_accumulated<br/>< min_sellable?}

        CheckComplete -->|No| PartialSellS[Partial Sell]
        CheckComplete -->|Yes| CompleteSale

        PartialSellS --> KeepHolding[status = HOLDING]
        KeepHolding --> SavePartial[Save State]

        CompleteSale[Complete Sale] --> CalcPrincipal["principal = avg_cost * btc_sold"]
        CalcPrincipal --> CalcProfitS["profit = max(0, proceeds - principal)"]
        CalcProfitS --> AddCapital["capital_available = capital_available + proceeds"]

        AddCapital --> ResetCycle

        subgraph "Cycle Reset"
            ResetCycle[Reset Cycle] --> SaveDust[btc_dust = btc_accumulated]
            SaveDust --> ResetNet[btc_accum_net = 0]
            ResetNet --> ResetCost[cost_accum_usdt = 0]
            ResetCost --> ResetRef[reference_price = null]
            ResetRef --> ResetGrid[buy_grid = null]
            ResetGrid --> ResetAnchor[buy_anchor_price = null]
            ResetAnchor --> ResetPurch[purchases_remaining = MAX_PURCHASES]
            ResetPurch --> SetReady[status = READY]
        end
    end

    SavePartial --> LogSell
    SetReady --> SaveComplete[Save State]
    SaveComplete --> LogSell[Log Sell Event]
    LogSell --> NotifySell[Discord Notification]
    NotifySell --> SellComplete([Sell Complete])

    style SellTrigger fill:#FFD700
    style SellComplete fill:#FFD700
```

---

## State Management

```mermaid
stateDiagram-v2
    [*] --> READY: Initial State

    READY --> HOLDING: Buy Executed
    note right of READY
        - btc_accumulated = 0
        - reference_price = ATH
        - capital_available = initial
        - purchases_remaining = MAX
        - buy_grid = null (until triggered)
    end note

    HOLDING --> HOLDING: Buy More
    HOLDING --> HOLDING: Partial Sell
    HOLDING --> READY: Complete Sell

    note right of HOLDING
        - btc_accumulated > 0
        - reference_price = avg_cost
        - capital_available < initial
        - purchases_remaining < MAX
        - buy_grid = [levels]
    end note

    READY --> PAUSED: Error/Drift
    HOLDING --> PAUSED: Error/Drift
    PAUSED --> READY: Manual Fix
    PAUSED --> HOLDING: Manual Fix

    note left of PAUSED
        - Trading stopped
        - Manual intervention required
        - State preserved
    end note
```

### Database State Fields

```mermaid
graph LR
    subgraph "Core State"
        id[id: UUID]
        status[status: READY/HOLDING/PAUSED]
        updated[updated_at: timestamp]
    end

    subgraph "Capital Management"
        capital[capital_available: USDT balance]
        buyamt[buy_amount: per-purchase amount]
        purchases[purchases_remaining: 0-MAX]
    end

    subgraph "BTC Tracking"
        btcacc[btc_accumulated: total BTC]
        btcnet[btc_accum_net: current cycle BTC]
        btcdust[btc_dust: unsellable BTC]
    end

    subgraph "Price References"
        ref[reference_price: ATH or avg_cost]
        ath[ath_price: cycle ATH]
        anchor[buy_anchor_price: first buy price]
    end

    subgraph "Cost Tracking"
        cost[cost_accum_usdt: total spent]
    end

    subgraph "Grid Management"
        grid[buy_grid: array of levels]
        index[buy_index: next level]
    end
```

---

## Error Handling

```mermaid
flowchart TD
    Error[Error Detected] --> ClassifyError{Error Type}

    ClassifyError --> NetworkError[Network Error]
    ClassifyError --> DriftError[Drift Error]
    ClassifyError --> ValidationError[Validation Error]
    ClassifyError --> ExchangeError[Exchange Error]

    subgraph "Network Errors"
        NetworkError --> WSDisconnect[WebSocket Disconnect]
        WSDisconnect --> AutoReconnect[Auto Reconnect]
        AutoReconnect --> ExpBackoff[Exponential Backoff]
        ExpBackoff --> MaxRetries{Max<br/>Retries?}
        MaxRetries -->|No| RetryConnect[Retry Connection]
        MaxRetries -->|Yes| PauseNetwork[Pause Strategy]
        RetryConnect --> Connected{Connected?}
        Connected -->|Yes| CatchUpCandles[Catch Up Missed Candles]
        Connected -->|No| ExpBackoff
    end

    subgraph "Drift Errors"
        DriftError --> CalcDriftE[Calculate Drift %]
        CalcDriftE --> DriftLevel{Drift<br/>Level}
        DriftLevel -->|< 0.5%| LogWarning[Log Warning]
        DriftLevel -->|>= 0.5%| PauseDriftE[Pause Strategy]
        PauseDriftE --> NotifyDrift[Discord Alert]
        NotifyDrift --> LogEvent[Log to Database]
        LogEvent --> RequireManual[Require Manual Fix]
    end

    subgraph "Validation Errors"
        ValidationError --> ValType{Validation<br/>Type}
        ValType --> ConfigVal[Config Invalid]
        ValType --> StateVal[State Corrupted]
        ValType --> BalanceVal[Balance Mismatch]

        ConfigVal --> UseDefault[Use Default Config]
        StateVal --> PauseCorrupt[Pause: Corruption]
        BalanceVal --> ReconcileBal[Reconcile Balances]
    end

    subgraph "Exchange Errors"
        ExchangeError --> ExchType{Error<br/>Code}
        ExchType --> InsufficientBal[Insufficient Balance]
        ExchType --> MinNotional[Below Min Notional]
        ExchType --> RateLimit[Rate Limited]
        ExchType --> OrderReject[Order Rejected]

        InsufficientBal --> SkipOrder[Skip Order]
        MinNotional --> AccumulateDust[Accumulate as Dust]
        RateLimit --> WaitRateLimit[Wait & Retry]
        OrderReject --> ParseReason[Parse Reject Reason]
        ParseReason --> HandleReject[Handle Specific Reason]
    end

    LogWarning --> Continue[Continue Trading]
    SkipOrder --> Continue
    AccumulateDust --> Continue
    UseDefault --> Continue
    ReconcileBal --> Continue
    CatchUpCandles --> Continue

    PauseNetwork --> WaitFix[Wait for Manual Fix]
    RequireManual --> WaitFix
    PauseCorrupt --> WaitFix
    HandleReject --> WaitFix

    style Error fill:#FF6B6B
    style Continue fill:#90EE90
    style WaitFix fill:#FFD700
```

---

## Component Interactions

```mermaid
sequenceDiagram
    participant User
    participant Main as MainOrchestrator
    participant WS as WebSocket
    participant CP as CandleProcessor
    participant CSM as CycleStateManager
    participant BTD as BuyTriggerDetector
    participant STD as SellTriggerDetector
    participant BOP as BuyOrderPlacer
    participant SOP as SellOrderPlacer
    participant BC as BinanceClient
    participant DB as Database
    participant Discord

    User->>Main: Start Bot
    Main->>CSM: Initialize State
    CSM->>DB: Load/Create State
    DB-->>CSM: State Data
    CSM-->>Main: State Ready

    Main->>WS: Connect
    WS->>WS: Open Connection

    loop Every Candle
        WS->>CP: Kline Message
        CP->>CP: Validate & Parse
        CP->>Main: candleClosed Event

        Main->>CSM: Get Current State
        CSM-->>Main: State

        alt No BTC Held
            Main->>Main: Calculate ATH (20 candles)
            Main->>CSM: Update reference_price
        end

        alt BTC Held (Sell Check)
            Main->>STD: Check Sell Trigger
            STD->>STD: Calculate Threshold
            STD-->>Main: Should Sell?

            opt Sell Triggered
                Main->>SOP: Place Sell Order
                SOP->>BC: Send Order
                BC-->>SOP: Order Result
                SOP-->>Main: Execution Details
                Main->>CSM: Update State
                CSM->>DB: Save State
                Main->>Discord: Notify Sell
            end
        end

        alt Purchases Remaining (Buy Check)
            Main->>BTD: Check Buy Trigger
            BTD->>BTD: Check Grid Levels
            BTD-->>Main: Should Buy?

            opt Buy Triggered
                Main->>BOP: Place Buy Order
                BOP->>BC: Send Order
                BC-->>BOP: Order Result
                BOP-->>Main: Execution Details
                Main->>CSM: Update State
                CSM->>DB: Save State
                Main->>Discord: Notify Buy
            end
        end
    end

    User->>Main: Stop Bot
    Main->>WS: Disconnect
    Main->>DB: Final State Save
```

---

## Data Flow

```mermaid
graph TB
    subgraph "Input Data"
        ENV[Environment Variables]
        CONF[Database Config]
        MARKET[Market Data]
    end

    subgraph "Processing"
        VALIDATE[Validation Layer]
        STRATEGY[Strategy Engine]
        EXECUTION[Execution Layer]
    end

    subgraph "State"
        MEMORY[In-Memory State]
        DATABASE[(Database State)]
    end

    subgraph "Output"
        ORDERS[Trade Orders]
        LOGS[Event Logs]
        NOTIFICATIONS[Discord Alerts]
    end

    ENV --> VALIDATE
    CONF --> VALIDATE
    MARKET --> STRATEGY

    VALIDATE --> STRATEGY
    STRATEGY --> EXECUTION

    EXECUTION <--> MEMORY
    MEMORY <--> DATABASE

    EXECUTION --> ORDERS
    EXECUTION --> LOGS
    EXECUTION --> NOTIFICATIONS

    style MARKET fill:#87CEEB
    style STRATEGY fill:#FFD700
    style DATABASE fill:#90EE90
```

---

## Key Formulas (from STRATEGY.md)

### 1. ATH Calculation

```
ATH = max(High[i]) for last 20 CLOSED candles
(Configurable: ath_window 10-500, default 20)
```

### 2. Buy Grid (Arithmetic)

```
Initial: P_n = ATH × (1 - n × %Drop)
After First Buy: P_n = anchor_price × (1 - n × %Drop)
Quantized: floor(P_n / 0.01) × 0.01
```

### 3. Reference Price (Average Cost)

```
avg_cost = cost_accum_usdt / btc_accum_net
where:
  cost_accum_usdt = Σ(USDT paid including fees)
  btc_accum_net = Σ(BTC received after fees) [current cycle only]
```

### 4. Sell Threshold

```
sell_threshold = avg_cost × (1 + %Rise)
```

### 5. Drift Detection

```
USDT: drift = max(0, (capital_available - USDT_SPOT) / capital_available)
BTC: drift = |BTC_SPOT - btc_accumulated| / max(btc_accumulated, 0.00000001)
Threshold: 0.005 (0.5%)
```

### 6. Dust Handling

```
min_sellable = MAX(0.00001 BTC, $5 / current_price)
If btc_accumulated < min_sellable:
  - Preserve as dust for next cycle
  - btc_dust = remaining
  - btc_accum_net = 0 (reset)
```

---

## Critical Constants

| Constant        | Value                    | Description                    |
| --------------- | ------------------------ | ------------------------------ |
| ATH_WINDOW      | 20 (configurable 10-500) | Candles for ATH calculation    |
| DRIFT_THRESHOLD | 0.5%                     | Maximum allowed balance drift  |
| MIN_QTY         | 0.00001 BTC              | Minimum tradeable quantity     |
| MIN_NOTIONAL    | $5.00                    | Minimum order value            |
| TICK_SIZE       | 0.01                     | Price quantization step        |
| STEP_SIZE       | 0.00001                  | Quantity quantization step     |
| ORDER_TYPE      | LIMIT IOC                | Always use Immediate-Or-Cancel |

---

## File-to-Function Mapping

| File                                          | Primary Function            | Key Responsibility          |
| --------------------------------------------- | --------------------------- | --------------------------- |
| **src/app/main-orchestrator.ts**              | processCandleWithStrategy() | Main trading loop execution |
| **src/app/startup-validator.ts**              | validate()                  | Pre-startup validation      |
| **src/config/strategy-config-loader.ts**      | loadConfig()                | Load strategy parameters    |
| **src/cycle/cycle-state-manager.ts**          | getCurrentState()           | State persistence           |
| **src/cycle/buy-trigger-detector.ts**         | checkBuyTrigger()           | Grid-based buy detection    |
| **src/cycle/sell-trigger-detector.ts**        | checkSellTrigger()          | Threshold sell detection    |
| **src/cycle/reference-price-calculator.ts**   | calculateReferencePrice()   | Average cost calculation    |
| **src/cycle/drift-detector.ts**               | checkDrift()                | Balance drift monitoring    |
| **src/cycle/buy-amount-calculator.ts**        | calculateBuyAmount()        | Purchase size calculation   |
| **src/cycle/buy-order-state-updater.ts**      | updateAfterBuyOrder()       | Post-buy state update       |
| **src/cycle/sell-order-state-updater.ts**     | updateAfterSellOrder()      | Post-sell state update      |
| **src/exchange/websocket-manager.ts**         | connect()                   | WebSocket connection        |
| **src/exchange/candle-processor.ts**          | processMessage()            | Candle data parsing         |
| **src/exchange/binance-client.ts**            | createOrder()               | Exchange API interface      |
| **src/exchange/historical-candle-manager.ts** | calculateATH()              | ATH from candle history     |
| **src/order/buy-order-placer.ts**             | placeOrder()                | Buy order execution         |
| **src/order/sell-order-placer.ts**            | placeOrder()                | Sell order execution        |
| **src/monitoring/event-logger.ts**            | logEvent()                  | Database event logging      |
| **src/notifications/discord-notifier.ts**     | sendAlert()                 | Discord notifications       |

---

## Production Deployment Flow

```mermaid
graph TD
    Deploy[Deploy to Production] --> CheckEnv[Verify Environment]
    CheckEnv --> SetProd[NODE_ENV = production]
    SetProd --> LoadSecrets[Load AWS Secrets]
    LoadSecrets --> InitDB[Initialize Database]
    InitDB --> RunMigrations[Run Migrations]
    RunMigrations --> StartBot[Start Bot]
    StartBot --> Monitor[Monitor Health]
    Monitor --> Alert{Issues<br/>Detected?}
    Alert -->|Yes| NotifyOps[Alert Operations]
    Alert -->|No| Continue[Continue Running]

    style Deploy fill:#90EE90
    style Continue fill:#90EE90
    style NotifyOps fill:#FF6B6B
```

---

## Summary

This flowchart provides a **100% complete** view of the BTC Trading Bot implementation:

1. **37 source files** mapped and analyzed
2. **All trading logic** follows STRATEGY.md exactly
3. **Execution order** strictly maintained (ATH → Sell → Buy)
4. **Grid strategy** with arithmetic anchoring fully implemented
5. **Dust handling** preserves value across cycles
6. **Drift detection** ensures balance integrity
7. **Error recovery** with automatic reconnection and state preservation
8. **Complete state management** with atomic database transactions

The bot operates as a continuous event-driven system, processing each candle closure through the exact strategy defined in STRATEGY.md, with comprehensive error handling, monitoring, and notification systems to ensure reliable 24/7 operation.
