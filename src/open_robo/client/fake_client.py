from .client import Client


class FakeClient(Client):
    def __init__(self, cash, positions):
        self._cash = cash
        self._positions = positions

    def buy(self, ticker, quantity, limit):
        return None

    def sell(self, ticker, quantity, limit):
        return None

    def positions(self):
        return self._positions

    def order_history(self):
        return None

    def cash(self):
        return self._cash

    def ask_price(self, ticker):
        return 1
