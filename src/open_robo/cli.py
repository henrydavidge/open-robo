import argparse
import pprint
import toml

from client.alpaca import AlpacaClient
from invest import Invest


def parse_args():
    parser = argparse.ArgumentParser()
    parser.add_argument("config", help="TOML config file containing portfolio spec")
    return parser.parse_args()


def validate(cfg):
    assert "portfolio" in cfg, "Config must contain portfolio"
    _sum = 0
    for el in cfg["portfolio"]:
        assert el["allocation"] > 0, "Allocation of each portfolio element must be greater than 0"
        assert len(el["tickers"]) > 0, "Must have at least one ticker defined for each portfolio element"
        _sum += el["allocation"]
    assert abs(_sum - 1) < 0.01, f'Total allocation must be 1, was {_sum}'


if __name__ == '__main__':
    args = parse_args()
    cfg = toml.load(args.config)
    pprint.pprint(cfg, indent=2)
    validate(cfg)
    alpaca = AlpacaClient(cfg['alpaca']['base_url'])
    invest = Invest(alpaca, cfg)
    invest.invest()
