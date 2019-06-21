import abc


class Client(abc.ABC):

    @abc.abstractmethod
    def buy(self, ticker, quantity, limit):
        pass

    @abc.abstractmethod
    def sell(self, ticker, quantity, limit):
        pass

    @abc.abstractmethod
    def positions(self):
        pass

    @abc.abstractmethod
    def order_history(self):
        pass

    @abc.abstractmethod
    def cash(self):
        pass

    @abc.abstractmethod
    def ask_price(self, ticker):
        pass
