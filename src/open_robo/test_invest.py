from client.fake_client import FakeClient
from invest import Invest
import pandas as pd
import unittest
from unittest.mock import MagicMock


class TestInvest(unittest.TestCase):
    def make_positions(self, data):
        return pd.DataFrame(data, columns=['ticker', 'quantity', 'cost_basis', 'market_value'])

    def make_portfolio(self, data):
        items = [{'category': d[0], 'tickers': d[1], 'allocation': d[2]} for d in data]
        return {'portfolio': items, 'cash_allocation': 0, 'do_trade': True}

    def test_empty_portfolio(self):
        portfolio = self.make_portfolio([['monkey', ['A'], 1.0]])
        client = FakeClient(10, self.make_positions([]))
        client.buy = MagicMock()
        Invest(client, portfolio).invest()
        client.buy.assert_called_with('A', 10, 1)

    def test_two_categories(self):
        portfolio = self.make_portfolio([['monkey', ['A'], 0.5], ['banana', ['B'], 0.5]])
        client = FakeClient(10, self.make_positions([]))
        client.buy = MagicMock()
        Invest(client, portfolio).invest()
        client.buy.assert_any_call('A', 5, 1)
        client.buy.assert_any_call('B', 5, 1)

    def test_already_invested(self):
        portfolio = self.make_portfolio([['monkey', ['A'], 1]])
        client = FakeClient(10, self.make_positions([['B', 10, 10, 10]]))
        client.buy = MagicMock()
        Invest(client, portfolio).invest()
        client.buy.assert_called_with('A', 10, 1)

    def test_prefer_existing_ticker(self):
        portfolio = self.make_portfolio([['monkey', ['B', 'A'], 1]])
        client = FakeClient(10, self.make_positions([['A', 1, 1, 1]]))
        client.buy = MagicMock()
        Invest(client, portfolio).invest()
        client.buy.assert_called_with('A', 10, 1)

    def test_buy_both(self):
        portfolio = self.make_portfolio([['monkey', ['A'], 0.5], ['banana', ['B'], 0.5]])
        client = FakeClient(10, self.make_positions([['A', 3, 1, 3], ['B', 5, 1, 5]]))
        client.buy = MagicMock()
        Invest(client, portfolio).invest()
        client.buy.assert_any_call('A', 6, 1)
        client.buy.assert_any_call('B', 4, 1)

    def test_round_down_ask_price(self):
        portfolio = self.make_portfolio([['monkey', ['A'], 1]])
        client = FakeClient(1.5, self.make_positions([]))
        client.buy = MagicMock()
        Invest(client, portfolio).invest()
        client.buy.assert_called_with('A', 1, 1)

    def test_cash_allocation(self):
        portfolio = self.make_portfolio([['monkey', ['A'], 1]])
        portfolio['cash_allocation'] = 0.5
        client = FakeClient(10, self.make_positions([['A', 2, 2, 2]]))
        client.buy = MagicMock()
        Invest(client, portfolio).invest()
        client.buy.assert_called_with('A', 4, 1)

    def test_no_trade(self):
        portfolio = self.make_portfolio([['monkey', ['A'], 1.0]])
        portfolio['do_trade'] = False
        client = FakeClient(10, self.make_positions([]))
        client.buy = MagicMock()
        Invest(client, portfolio).invest()
        client.buy.assert_not_called()


if __name__ == '__main__':
    unittest.main()
