export const trades = `create table if not exists trades (
id int auto_increment primary key,
user_id varchar(64) not null,
operator_id varchar(64) not null,
event_name varchar(255) not null,
market_name varchar(255) not null,
runner_name varchar(255) not null,
event_start_date datetime not null,
slug varchar(64) not null,
trade_time bigint not null,
trade_odds float not null,
stake float not null,
cat enum ("SELL","BUY") not null,
market_exchange json not null,
target_profit float not null,
stop_loss float not null,
max_cap float not null,
created_at timestamp default current_timestamp
);`;

export const settlements = `create table if not exists settlements (
id int auto_increment primary key,
user_id varchar(64) not null,
operator_id varchar(64) not null,
event_name varchar(255) not null,
market_name varchar(255) not null,
runner_name varchar(255) not null,
event_start_date datetime not null,
slug varchar(64) not null,
trade_time bigint not null,
balance float not null,
trade_odds float not null,
co_req_odds float not null,
co_odds float not null,
stake float not null,
win_amt float not null,
bonus float not null,
target_profit float not null,
stop_loss float not null,
max_cap float not null,
reason varchar(32) not null,
updated_balance float not null,
updated_balance_at bigint not null,
cat enum ("SELL","BUY") not null,
status enum ("WIN", "LOSS") not null,
market_exchange json not null,
created_at timestamp default current_timestamp 
);`;


export const wallets = `create table if not exists wallets (
id int auto_increment primary key,
user_id varchar(64) not null,
operator_id varchar(64) not null,
txn_id varchar(128) default null,
balance float not null,
is_active boolean default true,
created_at timestamp default current_timestamp,
updated_at timestamp default current_timestamp on update current_timestamp
);`;

export const transactions = `create table if not exists transactions (
id int auto_increment primary key,
user_id varchar(64) not null,
operator_id varchar(64) not null,
session_token varchar(128) not null,
amount float not null,
updated_balance float not null,
type enum ("CREDIT", "DEBIT") not null,
credit_txn_id varchar(128) default null,
debit_txn_id varchar(128) not null,
created_at timestamp default current_timestamp,
updated_at timestamp default current_timestamp on update current_timestamp
);`;