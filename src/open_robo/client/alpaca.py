import alpaca_trade_api as ap
import pandas
from .client import Client


class AlpacaClient(Client):
    def __init__(self, url):
        self.client = ap.REST(base_url = url)

    def buy(self, ticker, quantity, limit):
        self.client.submit_order(ticker, quantity, 'buy', 'limit', 'day', limit_price=limit)

    def sell(self, ticker, quantity, limit):
        self.client.submit_order(ticker, quantity, 'sell', 'limit', 'day', limit_price=limit)

    def positions(self):
        pos = self.client.list_positions()
        d = {"ticker": [], "quantity": [], "cost_basis": [], "market_value": []}
        for p in pos:
            d["ticker"].append(str(p.symbol))
            d["quantity"].append(int(p.qty))
            d["cost_basis"].append(float(p.cost_basis))
            d["market_value"].append(float(p.market_value))
        return pandas.DataFrame(d)

    def order_history(self):
        history = self.client.list_orders()
        d = {"ticker": [], "last_trade_timestamp": []}
        for h in history:
            d["ticker"].append(str(h.symbol))
            d["last_trade"].append(str(h.filled_at))
        return pandas.DataFrame(d)

    def cash(self):
        return float(self.client.get_account().cash)

    def ask_price(self, ticker):
        return self.client.polygon.last_quote(ticker).askprice
