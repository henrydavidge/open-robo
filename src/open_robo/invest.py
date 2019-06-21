import math
import numpy as np


class Invest:
    def __init__(self, client, config):
        self.client = client
        self.config = config

    def __add_category(self, ticker):
        for el in self.config["portfolio"]:
            if ticker in el["tickers"]:
                return el["category"]

    def __investable_total(self, positions, cash):
        total = positions['market_value'].agg(np.sum) + cash
        return total * (1 - self.config['cash_allocation'])

    def __add_value(self, df, cash):
        investable = self.__investable_total(df, cash)
        for el in self.config["portfolio"]:
            category = el["category"]
            existing_categories = set(df.index.tolist())
            if category not in existing_categories:
                df.loc[category, "market_value"] = 0
            df.loc[category, "desired_value"] = el["allocation"] * investable
        return df

    def __ticker_to_buy(self, category, positions):
        if category in positions['category'].tolist():
            return positions.loc[positions['category'] == category, 'ticker'].iloc[0]

        for el in self.config["portfolio"]:
            if category == el["category"]:
                return el["tickers"][0]

    def invest(self):
        cash = self.client.cash()
        print(f"Cash is {cash}")
        positions = self.client.positions()
        positions["category"] = positions["ticker"].apply(self.__add_category)
        categorized = positions.groupby("category").agg({"market_value": np.sum})
        categorized = self.__add_value(categorized, cash)
        categorized["delta"] = categorized["desired_value"] - categorized["market_value"]
        categorized.loc[categorized['delta'] < 0, 'delta'] = 0
        total_delta = categorized["delta"].agg(np.sum)
        total_value = cash + positions['market_value'].agg(np.sum)
        cash_to_spend = max(0, cash - self.config['cash_allocation'] * total_value)
        categorized["to_buy"] = categorized["delta"] / total_delta * cash_to_spend
        for category in categorized.itertuples():
            if category.to_buy <= 0:
                continue
            ticker = self.__ticker_to_buy(category.Index, positions)
            ask_price = self.client.ask_price(ticker)
            if ask_price == 0:
                print(f"No current ask price for {ticker}... Skipping this time around.")
                continue

            num_shares = math.floor(category.to_buy / ask_price)
            print(f"Will buy {num_shares} of {ticker} at price {ask_price}")

            if self.config['do_trade']:
                self.client.buy(ticker, num_shares, ask_price)
            else:
                print('Cowardly refusing to trade')

